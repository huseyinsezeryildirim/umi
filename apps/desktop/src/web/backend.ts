// The Mac app's Rust side, in the browser: the same editor UI talks to this through the same
// commands. Editing and drawing are the same Rust code (umi-web, WebAssembly + WebGPU);
// recordings live in this browser (IndexedDB) and never leave it.
import { cloudCanShare, cloudStatus, shareDelete, shareInsights, shareStart, shareState, shareUpdate, syncEdit } from "./cloud";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { ALL_FORMATS, BlobSource, CanvasSink, Input } from "mediabunny";
import music from "../../src-tauri/resources/music.json";
import { deleteRecording, fileNames, getFile, getRecording, listRecordings, putFile, putRecording, type StoredRecording } from "./db";
import { Session } from "./engine";
import { combineTakes, exportVideo, type ExportRequest } from "./exporter";
import { trackFace } from "./face";
import { downloadLoom } from "./loom";
import { maskRectAt, type PrivacyMask } from "../editor/types";
import { trackRegion } from "./pkg/umi_web.js";
import { loadSegmenter } from "./segment";
import { voice16k, waveform } from "./sound";

type Args = Record<string, unknown>;
type Progress<T> = { onmessage: (value: T) => void };

const sessions = new Map<string, Session>();
/** Files picked or downloaded but not yet in a recording, by the made-up path handed out. */
const staged = new Map<string, Blob>();
/** Exported files, to download again ("Show in Finder" here). */
const exported = new Map<string, Blob>();
/** Save-dialog choices (where the browser can write files directly). */
const saveHandles = new Map<string, FileSystemFileHandle>();
const exports = new Map<string, AbortController>();

/** A recording's id from its id or its bundle path (`/web/<id>`, what the editor state carries). */
const idOf = (path: unknown) => String(path).replace(/^\/web\//, "").split("/")[0];

const editor = (id: unknown) => {
  const s = sessions.get(String(id));
  if (!s) throw new Error("This recording isn't open.");
  return s;
};

const fallbackName = (r: StoredRecording) => {
  const d = new Date(r.createdAt);
  return `Recording ${d.toLocaleDateString(undefined, { day: "numeric", month: "short" })} at ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
};

function download(blob: Blob, name: string) {
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}

const dataUrl = (blob: Blob) =>
  new Promise<string>((done, fail) => {
    const r = new FileReader();
    r.onload = () => done(String(r.result));
    r.onerror = () => fail(r.error);
    r.readAsDataURL(blob);
  });

/** JPEG data URLs of the screen at `times`, `height` px tall. */
async function stills(blob: Blob, times: number[], height: number): Promise<string[]> {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
  const track = await input.getPrimaryVideoTrack();
  if (!track) return [];
  const width = Math.max(2, Math.round((height * track.displayWidth) / track.displayHeight));
  const sink = new CanvasSink(track, { width, height, fit: "fill", poolSize: 1 });
  const out: string[] = [];
  const canvas = new OffscreenCanvas(width, height);
  const g = canvas.getContext("2d")!;
  for await (const frame of sink.canvasesAtTimestamps(times)) {
    if (!frame) {
      out.push(out[out.length - 1] ?? "");
      continue;
    }
    g.drawImage(frame.canvas, 0, 0);
    out.push(await dataUrl(await canvas.convertToBlob({ type: "image/jpeg", quality: 0.75 })));
  }
  return out;
}

const previews = new Map<string, Promise<string[]>>();
const waves = new Map<string, Promise<number[]>>();

async function screenOf(id: string) {
  const blob = sessions.get(id)?.file("screen.webm") ?? (await getFile(id, "screen.webm"));
  if (!blob) throw new Error("This recording has no video.");
  return blob;
}

/** Where the voice is quiet for `min` seconds or more (recording time). */
async function silences(id: string, min: number): Promise<[number, number][]> {
  waves.set(id, waves.get(id) ?? screenOf(id).then((b) => waveform(b)));
  const peaks = await waves.get(id)!;
  const out: [number, number][] = [];
  let start = -1;
  for (let i = 0; i <= peaks.length; i++) {
    const quiet = i < peaks.length && peaks[i] < 0.02;
    if (quiet && start < 0) start = i;
    if (!quiet && start >= 0) {
      if ((i - start) / 50 >= min) out.push([start / 50, i / 50]);
      start = -1;
    }
  }
  return out;
}

async function mediaDuration(blob: Blob) {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
  return input.computeDuration();
}

// MARK: Presets (this browser)

type Library = { presets: { id: string; name: string }[]; defaultId: string | null };
const PRESETS = "umi-presets";
const presets = (): Library => {
  try {
    return JSON.parse(localStorage.getItem(PRESETS) ?? "") as Library;
  } catch {
    return { presets: [], defaultId: null };
  }
};
const storePresets = (l: Library) => {
  localStorage.setItem(PRESETS, JSON.stringify(l));
  return l;
};

// MARK: Recordings

/** A recording made on the website (the recorder hands it over through IndexedDB). */
export async function addRecording(r: StoredRecording, files: Record<string, Blob>) {
  for (const [name, blob] of Object.entries(files)) await putFile(r.id, name, blob);
  await putRecording(r);
}

async function openEditor(id: string) {
  // The editor draws with the GPU (the same renderer as the Mac app): WebGPU, or WebGL2.
  if (!("gpu" in navigator) && !new OffscreenCanvas(1, 1).getContext("webgl2"))
    throw new Error("This browser can't draw the editor (no WebGPU or WebGL2). Try an up-to-date Chrome, Edge, Firefox or Safari.");
  const open = sessions.get(id);
  if (open) return open.state();
  const r = await getRecording(id);
  if (!r) throw new Error("Recording not found.");
  const library = presets();
  const preset = library.defaultId ? library.presets.find((p) => p.id === library.defaultId) : undefined;
  const session = await Session.open(id, fallbackName(r), r.project, r.cursor, r.mediaDuration, await fileNames(id), preset ? JSON.stringify(preset) : undefined);
  sessions.set(id, session);
  // A title it picked up on opening (from the window that was shared) goes into the library now.
  await save(id);
  return session.state();
}

async function save(id: string) {
  const s = sessions.get(id);
  if (!s || !s.wasm.dirty()) return;
  const r = await getRecording(id);
  if (!r) return;
  await putRecording({ ...r, project: JSON.parse(s.wasm.project()) });
  // A link made from it shows the new look.
  void syncEdit(s, id);
}

/** Speech to text with Whisper in a worker (the model downloads once, then stays cached). */
async function transcribe(id: string, language: string, progress: Progress<{ stage: string; value: number }>) {
  const s = editor(id);
  progress.onmessage({ stage: "transcribe", value: 0 });
  const audio = await voice16k(await screenOf(id));
  if (!audio || audio.length < 1600) throw new Error("This recording has no sound to transcribe.");
  const words = await new Promise<{ text: string; start: number; end: number }[]>((done, fail) => {
    const worker = new Worker(new URL("./transcribe.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<{ type: string; progress?: number; words?: { text: string; start: number; end: number }[]; message?: string }>) => {
      const m = e.data;
      if (m.type === "loading") progress.onmessage({ stage: "download", value: m.progress ?? 0 });
      else if (m.type === "working") progress.onmessage({ stage: "transcribe", value: m.progress ?? 0 });
      else if (m.type === "done") {
        worker.terminate();
        done(m.words ?? []);
      } else {
        worker.terminate();
        fail(new Error(m.message ?? "Transcription failed."));
      }
    };
    worker.postMessage({ audio, language: language === "auto" ? "" : language }, [audio.buffer]);
  });
  const state = s.setWords(words, language === "auto" ? "" : language);
  await save(id);
  return state;
}

// MARK: Picking files

function pick(multiple: boolean, extensions: string[]): Promise<string[]> {
  return new Promise((done) => {
    const input = Object.assign(document.createElement("input"), { type: "file", multiple, accept: extensions.map((e) => `.${e}`).join(",") });
    input.onchange = () => {
      const paths = [...(input.files ?? [])].map((f) => {
        const path = `picked:${crypto.randomUUID()}/${f.name}`;
        staged.set(path, f);
        return path;
      });
      done(paths);
    };
    input.oncancel = () => done([]);
    input.click();
  });
}

async function importInto(id: string, file: string, base: string) {
  const blob = staged.get(file) ?? (file.startsWith("/web/") ? sessions.get(idOf(file))?.file(file.split("/").slice(3).join("/")) : null);
  if (!blob) throw new Error("Couldn't add that file.");
  const ext = (file.split(".").pop() ?? "bin").toLowerCase();
  const name = `${base}-${crypto.randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase()}.${ext}`;
  await putFile(id, name, blob);
  sessions.get(id)?.addFile(name, blob);
  return name;
}

/** Videos picked in the library become recordings (`title`: the name for a single one). */
async function importVideos(paths: string[], title?: string) {
  const made: string[] = [];
  for (const p of paths) {
    const blob = staged.get(p);
    if (!blob) continue;
    const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
    const track = await input.getPrimaryVideoTrack();
    if (!track) continue;
    const duration = await input.computeDuration();
    const id = crypto.randomUUID();
    const name = title ?? p.split("/").pop()!.replace(/\.[^.]+$/, "");
    const project = {
      version: 1,
      createdAt: new Date().toISOString(),
      duration,
      screen: { pixelWidth: track.displayWidth, pixelHeight: track.displayHeight, captureRect: [[0, 0], [track.displayWidth, track.displayHeight]], fps: 30 },
      audio: (await input.getPrimaryAudioTrack()) ? { microphoneTrack: 0 } : {},
      title: name,
    };
    await addRecording({ id, createdAt: project.createdAt, project, mediaDuration: duration }, { "screen.webm": blob });
    made.push(id);
  }
  return made;
}

// MARK: Tracking, voiceover, combining

/** Sticks a mask to the content under it (the Mac app's tracker, in WebAssembly). */
async function trackMask(id: string, maskId: string, anchorAt: number | null, progress: Progress<number>) {
  const s = editor(id);
  const edit = structuredClone(s.current.edit) as { masks: PrivacyMask[] };
  const m = edit.masks.find((x) => x.id === maskId);
  if (!m) throw new Error("mask not found");
  const anchor = Math.min(Math.max(anchorAt ?? m.start, m.start), m.end);
  const rect = maskRectAt(m, anchor);
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(await screenOf(id)) });
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error("This recording has no video.");
  const width = Math.min(480, track.displayWidth);
  const height = Math.max(1, Math.round((track.displayHeight * width) / track.displayWidth));
  const times: number[] = [];
  for (let k = 0; ; k++) {
    const t = Math.min(m.start + k / 30, m.end);
    times.push(t);
    if (t >= m.end) break;
  }
  const luma = new Uint8Array(width * height * times.length);
  const canvas = new OffscreenCanvas(width, height);
  const g = canvas.getContext("2d", { willReadFrequently: true })!;
  let i = 0;
  for await (const frame of new CanvasSink(track, { width, height, fit: "fill", poolSize: 1 }).canvasesAtTimestamps(times)) {
    if (frame) {
      g.drawImage(frame.canvas, 0, 0);
      const px = g.getImageData(0, 0, width, height).data;
      const base = i * width * height;
      for (let k = 0; k < width * height; k++) luma[base + k] = (77 * px[k * 4] + 150 * px[k * 4 + 1] + 29 * px[k * 4 + 2]) >> 8;
    }
    i++;
    if (i % 5 === 0) progress.onmessage((0.9 * i) / times.length);
  }
  const keyframes = JSON.parse(trackRegion(JSON.stringify(rect), anchor, new Float64Array(times), width, height, luma));
  progress.onmessage(1);
  Object.assign(m, { rect, keyframes, follow: true });
  const state = s.apply({ op: "setEdit", edit });
  await save(id);
  return state;
}

/** 16-bit mono WAV. */
function wav(samples: Float32Array, rate: number) {
  const out = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const str = (at: number, t: string) => [...t].forEach((c, k) => out.setUint8(at + k, c.charCodeAt(0)));
  str(0, "RIFF");
  out.setUint32(4, 36 + samples.length * 2, true);
  str(8, "WAVEfmt ");
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true);
  out.setUint16(22, 1, true);
  out.setUint32(24, rate, true);
  out.setUint32(28, rate * 2, true);
  out.setUint16(32, 2, true);
  out.setUint16(34, 16, true);
  str(36, "data");
  out.setUint32(40, samples.length * 2, true);
  samples.forEach((v, k) => out.setInt16(44 + k * 2, Math.max(-1, Math.min(1, v)) * 0x7fff, true));
  return new Blob([out.buffer], { type: "audio/wav" });
}

/** AI voiceover (Kokoro, af_heart) onto the Voice track at `time`, or replacing one. */
async function voiceover(id: string, text: string, speed: number, time: number, replace: string | null, progress: Progress<{ stage: string; value: number }>) {
  const s = editor(id);
  if (!text.trim()) throw new Error("Type what to say.");
  progress.onmessage({ stage: "speak", value: 0 });
  const { audio, rate } = await new Promise<{ audio: Float32Array; rate: number }>((done, fail) => {
    const worker = new Worker(new URL("./voice.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<{ type: string; progress?: number; audio?: Float32Array; rate?: number; message?: string }>) => {
      const m = e.data;
      if (m.type === "loading") progress.onmessage({ stage: "download", value: m.progress ?? 0 });
      else if (m.type === "done") {
        worker.terminate();
        done({ audio: m.audio!, rate: m.rate! });
      } else {
        worker.terminate();
        fail(new Error(m.message ?? "Couldn't make the voiceover."));
      }
    };
    worker.postMessage({ text, speed });
  });
  progress.onmessage({ stage: "speak", value: 1 });
  const name = `voiceover-${crypto.randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase()}.wav`;
  const blob = wav(audio, rate);
  await putFile(id, name, blob);
  s.addFile(name, blob);
  const state = s.apply({ op: "addVoiceover", file: name, text, start: time, duration: audio.length / rate, replace });
  await save(id);
  return state;
}

/** Recordings end to end in a new recording (each with its edit). */
async function combine(ids: string[], progress: Progress<number>) {
  if (ids.length < 2) throw new Error("Pick two or more recordings.");
  const library = presets();
  const preset = library.defaultId ? library.presets.find((x) => x.id === library.defaultId) : undefined;
  // Fresh copies: the shape is changed for combining, not in the recordings themselves.
  const takes: Session[] = [];
  try {
    for (const id of ids) {
      const r = await getRecording(id);
      if (!r) throw new Error("Recording not found.");
      takes.push(await Session.open(id, fallbackName(r), r.project, r.cursor, r.mediaDuration, await fileNames(id), preset ? JSON.stringify(preset) : undefined));
    }
    const { blob, duration, width, height } = await combineTakes(takes, (v) => progress.onmessage(v * 0.97), new AbortController().signal);
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const d = new Date();
    const project = {
      version: 1,
      createdAt,
      duration,
      screen: { pixelWidth: width, pixelHeight: height, captureRect: [[0, 0], [width, height]], fps: 30 },
      audio: { microphoneTrack: 0 },
      title: `Combined ${d.toLocaleDateString(undefined, { day: "numeric", month: "short" })} at ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`,
    };
    await addRecording({ id, createdAt, project, mediaDuration: duration }, { "screen.webm": blob });
    progress.onmessage(1);
    return id;
  } finally {
    for (const t of takes) t.close();
  }
}

// MARK: Commands

async function handle(cmd: string, p: Args): Promise<unknown> {
  switch (cmd) {
    case "list_recordings": {
      const list = await listRecordings();
      return list
        .map((r) => ({ path: r.id, name: (r.project.title as string) || fallbackName(r), duration: (r.project.duration as number) ?? r.mediaDuration, createdAt: r.createdAt }))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    case "recording_preview": {
      const id = idOf(p.path);
      if (!previews.has(id)) {
        const r = await getRecording(id);
        const d = (r?.project.duration as number) ?? 1;
        previews.set(id, screenOf(id).then((b) => stills(b, Array.from({ length: 24 }, (_, i) => ((i + 0.5) / 24) * d), 180)));
      }
      return previews.get(id);
    }
    case "recording_thumbnails": {
      const id = idOf(p.path);
      const r = await getRecording(id);
      const d = (r?.project.duration as number) ?? 1;
      const count = Math.max(1, Math.min(200, Number(p.count) || 24));
      return stills(await screenOf(id), Array.from({ length: count }, (_, i) => ((i + 0.5) / count) * d), Number(p.height) * 2 || 128);
    }
    case "recording_waveform": {
      const id = idOf(p.path);
      waves.set(id, waves.get(id) ?? screenOf(id).then((b) => waveform(b)));
      return waves.get(id);
    }
    case "recording_still": {
      const id = idOf(p.path);
      const [url] = await stills(await screenOf(id), [Number(p.time) || 0], Math.min(Number(p.maxSide) || 1400, 1080));
      return url;
    }
    case "recording_rename": {
      const id = idOf(p.path);
      const title = String(p.title ?? "").trim().slice(0, 120);
      const open = sessions.get(id);
      if (open) {
        open.apply({ op: "setTitle", title });
        await save(id);
      } else {
        const r = await getRecording(id);
        if (r) await putRecording({ ...r, project: { ...r.project, title: title || undefined, titleAuto: undefined } });
      }
      return title;
    }
    case "recording_trash": {
      const id = idOf(p.path);
      sessions.get(id)?.close();
      sessions.delete(id);
      await deleteRecording(id);
      return null;
    }
    case "recording_reveal": {
      const path = String(p.path);
      const blob = exported.get(path);
      if (blob) download(blob, path);
      return null;
    }
    case "open_editor":
      return openEditor(String(p.path));
    case "editor_apply": {
      const s = editor(p.id);
      const op = p.op as Args;
      if (op.op === "addOverlay" && op.kind === "video" && op.duration == null) {
        const blob = s.file(String(op.file));
        if (blob) op.duration = await mediaDuration(blob);
      }
      const quiet = op.op === "hideCameraInSilence" ? await silences(String(p.id), Number(op.min) || 1.5) : undefined;
      return s.apply(op, quiet);
    }
    case "editor_save":
      await save(String(p.id));
      return null;
    case "editor_close": {
      await save(String(p.id));
      sessions.get(String(p.id))?.close();
      sessions.delete(String(p.id));
      return null;
    }
    case "editor_frame": {
      const s = editor(p.id);
      if (!p.playing) s.pause();
      return s.frame(Number(p.time), Number(p.width), Number(p.height), !!p.flat, !!p.playing);
    }
    case "editor_layout":
      return editor(p.id).layout(Number(p.time));
    case "editor_audio":
      return editor(p.id).audio(Number(p.time), Number(p.seconds));
    case "editor_transcribe":
      return transcribe(String(p.id), String(p.language ?? "auto"), p.progress as Progress<{ stage: string; value: number }>);
    case "editor_insights": {
      const found = editor(p.id).wasm.insights();
      return JSON.parse(found);
    }
    case "editor_save_subtitles": {
      const name = String(p.destination);
      const text = editor(p.id).wasm.subtitles(name.toLowerCase().endsWith(".vtt"));
      const handle = saveHandles.get(name);
      const blob = new Blob([text], { type: "text/plain" });
      if (handle) {
        const w = await handle.createWritable();
        await w.write(blob);
        await w.close();
      } else download(blob, name);
      return null;
    }
    case "export_default_path":
      return `${String(p.name).replace(/[\\/:*?"<>|]/g, "-")}.${p.extension}`;
    case "editor_export": {
      const s = editor(p.id);
      const req = p.request as ExportRequest;
      const progress = p.progress as Progress<number>;
      const abort = new AbortController();
      exports.set(String(p.id), abort);
      const handle = saveHandles.get(req.destination) ?? null;
      try {
        const blob = await exportVideo(s, req, (v) => progress.onmessage(v), abort.signal, handle);
        if (abort.signal.aborted) throw "cancelled";
        if (blob) {
          exported.set(req.destination, blob);
          download(blob, req.destination);
        }
        return req.destination;
      } finally {
        exports.delete(String(p.id));
      }
    }
    case "editor_export_cancel":
      exports.get(String(p.id))?.abort();
      return null;
    case "editor_camera_effects": {
      const s = editor(p.id);
      if (!s.hasCamera) return [];
      return s.file("camera-face.json") ? ["blur", "remove", "face"] : ["blur", "remove"];
    }
    case "editor_camera_effect": {
      const s = editor(p.id);
      const progress = p.progress as Progress<{ stage: string; value: number }>;
      if (p.effect === "face") {
        const camera = s.file("camera.webm");
        if (!camera) throw new Error("This recording has no camera.");
        const keys = await trackFace(camera, (stage, value) => progress.onmessage({ stage, value }));
        if (!keys.length) throw new Error("No face found in the camera.");
        const blob = new Blob([JSON.stringify(keys)], { type: "application/json" });
        await putFile(s.id, "camera-face.json", blob);
        s.addFile("camera-face.json", blob);
        return null;
      }
      progress.onmessage({ stage: "download", value: 0.2 });
      await loadSegmenter();
      progress.onmessage({ stage: "process", value: 1 });
      return null;
    }
    case "editor_track_mask":
      return trackMask(String(p.id), String(p.mask), p.anchor as number | null, p.progress as Progress<number>);
    case "editor_voiceover":
      return voiceover(String(p.id), String(p.text), Number(p.speed) || 1, Number(p.time) || 0, (p.replace as string | null) ?? null, p.progress as Progress<{ stage: string; value: number }>);
    case "bundle_import":
      return importInto(idOf(p.bundle), String(p.file), String(p.base));
    case "image_thumbnail": {
      const path = String(p.path);
      const blob = staged.get(path) ?? (path.startsWith("/web/") ? sessions.get(idOf(path))?.file(path.split("/").slice(3).join("/")) : null);
      if (!blob) return "";
      const bitmap = await createImageBitmap(blob);
      const k = 320 / Math.max(bitmap.width, bitmap.height);
      const c = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * k)), Math.max(1, Math.round(bitmap.height * k)));
      c.getContext("2d")!.drawImage(bitmap, 0, 0, c.width, c.height);
      bitmap.close();
      return dataUrl(await c.convertToBlob({ type: "image/jpeg", quality: 0.8 }));
    }
    case "music_tracks":
      return (music as { url: string }[]).map((t) => ({ ...t, downloaded: [...staged.keys()].some((k) => k.endsWith(`/${t.url.split("/").pop()}`)) }));
    case "music_fetch": {
      const url = String(p.url);
      if (!url.startsWith("https://archive.org/download/freepd/")) throw new Error("not a library track");
      const name = url.split("/").pop()!;
      const have = [...staged.keys()].find((k) => k.endsWith(`/${name}`));
      if (have) return have;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Couldn't download (${res.status}).`);
      const path = `picked:music/${name}`;
      staged.set(path, await res.blob());
      return path;
    }
    case "presets_list":
      return presets();
    case "preset_save": {
      const l = presets();
      l.presets.push(JSON.parse(editor(p.id).wasm.presetFromEdit(String(p.name))));
      return storePresets(l);
    }
    case "preset_apply": {
      const s = editor(p.id);
      const preset = presets().presets.find((x) => x.id === p.preset);
      if (!preset) throw new Error("preset not found");
      s.current = JSON.parse(s.wasm.applyPreset(JSON.stringify(preset)));
      return s.current;
    }
    case "preset_delete": {
      const l = presets();
      l.presets = l.presets.filter((x) => x.id !== p.preset);
      if (l.defaultId === p.preset) l.defaultId = null;
      return storePresets(l);
    }
    case "preset_set_default":
      return storePresets({ ...presets(), defaultId: (p.preset as string | null) ?? null });
    case "system_wallpapers":
      return [];
    case "pexels_status":
      return false;
    case "ai_models":
      return [];
    case "cloud_status":
      return cloudStatus();
    case "cloud_can_share":
      return cloudCanShare();
    case "share_state":
      return shareState(String(p.id));
    case "share_insights":
      return shareInsights(String(p.id));
    case "share_start": {
      const s = editor(p.id);
      const r = await getRecording(String(p.id));
      return shareStart(s, String(p.id), s.wasm.title(), r?.cursor, p.progress as Progress<{ stage: string; value: number }>);
    }
    case "share_update":
      return shareUpdate(String(p.id), p.settings as Record<string, unknown>);
    case "share_delete":
      return shareDelete(String(p.id));
    case "cloud_connect":
      throw new Error("Sign in on umi.cam to share links.");
    case "team_list":
    case "team_videos":
    case "team_presets":
      return [];
    case "import_videos":
      return importVideos((p.paths as string[]) ?? []);
    case "import_loom": {
      const progress = p.progress as Progress<number>;
      const { video, title } = await downloadLoom(String(p.link), (v) => progress.onmessage(v));
      const path = `picked:loom/${title}.mp4`;
      staged.set(path, video);
      const [id] = await importVideos([path], title);
      staged.delete(path);
      progress.onmessage(1);
      return id;
    }
    case "library_combine":
      return combine((p.paths as string[]).map(idOf), p.progress as Progress<number>);
    case "copy_text_to_clipboard":
      await navigator.clipboard?.writeText(String(p.text));
      return null;
    case "shortcuts_get":
    case "shortcuts_set":
      return [];
    case "window_show":
      // New recording: the website's recorder (it opens the recording here when done).
      if (p.view === "launcher") window.parent.postMessage({ umi: "record" }, location.origin);
      return null;
    case "window_hide":
    case "window_resize":
      return null;
    case "plugin:dialog|open": {
      const o = (p.options ?? {}) as { multiple?: boolean; filters?: { extensions: string[] }[] };
      const paths = await pick(!!o.multiple, o.filters?.flatMap((f) => f.extensions) ?? []);
      return o.multiple ? paths : (paths[0] ?? null);
    }
    case "plugin:dialog|save": {
      const o = (p.options ?? {}) as { defaultPath?: string; filters?: { name: string; extensions: string[] }[] };
      const suggested = (o.defaultPath ?? "Umi").split("/").pop()!;
      const picker = (window as unknown as { showSaveFilePicker?: (o: unknown) => Promise<FileSystemFileHandle> }).showSaveFilePicker;
      if (!picker) return suggested;
      try {
        const ext = o.filters?.[0]?.extensions[0];
        const handle = await picker({ suggestedName: suggested, types: ext ? [{ description: o.filters![0].name, accept: { "application/octet-stream": [`.${ext}`] } }] : undefined });
        saveHandles.set(handle.name, handle);
        return handle.name;
      } catch {
        return null;
      }
    }
    case "plugin:opener|open_url":
      window.open(String(p.url), "_blank", "noopener");
      return null;
    case "plugin:event|listen":
    case "plugin:event|unlisten":
    case "plugin:event|emit":
      return null;
    default:
      console.info("web: not available here", cmd, p);
      return null;
  }
}

/**
 * Development: `?seed=<screen url>[&camera=<camera url>]` (repeat `seed` for more recordings;
 * the camera goes with the first) adds recordings to try things on.
 */
async function seed() {
  const q = new URLSearchParams(location.search);
  const screens = q.getAll("seed");
  if (!screens.length || (await listRecordings()).length) return;
  const cameraUrl = q.get("camera");
  for (const [k, screenUrl] of screens.entries()) {
    const screen = await (await fetch(screenUrl)).blob();
    const camera = k === 0 && cameraUrl ? await (await fetch(cameraUrl)).blob() : null;
    const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(screen) });
    const track = (await input.getPrimaryVideoTrack())!;
    const duration = await input.computeDuration();
    const createdAt = new Date(Date.now() - k * 60_000).toISOString();
    const project = {
      version: 1,
      createdAt,
      duration,
      screen: { pixelWidth: track.displayWidth, pixelHeight: track.displayHeight, captureRect: [[0, 0], [track.displayWidth, track.displayHeight]], fps: 30 },
      ...(camera ? { camera: {} } : {}),
      audio: { microphoneTrack: 0 },
    };
    await addRecording({ id: crypto.randomUUID(), createdAt, project, mediaDuration: duration }, camera ? { "screen.webm": screen, "camera.webm": camera } : { "screen.webm": screen });
  }
}

export async function installWebBackend() {
  if (import.meta.env.DEV) await seed();
  mockWindows("main");
  mockIPC(
    (cmd, payload) =>
      handle(cmd, (payload ?? {}) as Args).catch((e: unknown) => {
        // The UI shows errors as text, like the Rust side's.
        throw e instanceof Error ? e.message : e;
      }),
    { shouldMockEvents: true },
  );
}
