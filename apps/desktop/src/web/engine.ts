// An open recording in the browser: the Rust editing session and GPU renderer (umi-web, on
// WebGPU) fed with frames the browser decodes. Preview frames come from video elements
// (seeked while paused, playing along while the editor plays); export reads exact frames.
import init, { addFont, openGpu, Editor as Wasm } from "./pkg/umi_web.js";
import wasmUrl from "./pkg/umi_web_bg.wasm?url";
import { getFile } from "./db";
import { cameraEffect, loadSegmenter } from "./segment";
import { Mixer, SoundFile } from "./sound";

const fontUrls = import.meta.glob("./fonts/*.ttf", { query: "?url", import: "default", eager: true }) as Record<string, string>;

let starting: Promise<void> | null = null;
/** Loads the WebAssembly module and the fonts (once). */
export function start(): Promise<void> {
  starting ??= (async () => {
    await init({ module_or_path: wasmUrl });
    await Promise.all(
      Object.values(fontUrls).map(async (url) => {
        const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
        addFont(bytes);
      }),
    );
  })();
  return starting;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EditorStateLike = any;

export type Moment = {
  outputTime: number;
  layer: { clip: number; sourceTime: number };
  dissolve: null | { clip: number; sourceTime: number; progress: number };
  overlays: { id: string; file: string; time: number }[];
};

// HEIC/TIFF: a Mac wallpaper named by a link made while recording (sent as JPEG).
const IMAGE = /\.(png|jpe?g|webp|gif|avif|bmp|heic|heif|tiff?)$/i;

/** A hidden video element showing one file, seekable to a time. */
class Player {
  readonly video: HTMLVideoElement;
  private seeking: Promise<void> | null = null;
  constructor(url: string) {
    this.video = Object.assign(document.createElement("video"), { src: url, muted: true, playsInline: true, preload: "auto", crossOrigin: "anonymous" });
    // Rendered (not display:none) so the browser keeps decoding frames.
    Object.assign(this.video.style, { position: "fixed", left: "0", top: "0", width: "2px", height: "2px", opacity: "0", pointerEvents: "none" });
    document.body.append(this.video);
  }
  get ready() {
    return this.video.readyState >= 2 && this.video.videoWidth > 0;
  }
  /** Shows file time `t`: exact when paused; while playing it plays along at `speed`. */
  async show(t: number, playing: boolean, speed: number) {
    const v = this.video;
    if (playing) {
      if (v.playbackRate !== speed) v.playbackRate = speed;
      if (v.paused || Math.abs(v.currentTime - t) > 0.3) {
        v.currentTime = t;
        void v.play().catch(() => {});
        await this.seeked();
      }
      return;
    }
    if (!v.paused) v.pause();
    if (Math.abs(v.currentTime - t) > 1 / 240 || !this.ready) {
      v.currentTime = t;
      await this.seeked();
    }
    // Just opened: the first frame may not be decoded yet (slow disks, Safari).
    if (!this.ready) await this.loaded();
    // Safari can call a video ready before its frame can be copied: wait (once) until the
    // browser has actually shown one.
    if (!this.shownOnce) {
      this.shownOnce = true;
      const rvfc = (v as HTMLVideoElement & { requestVideoFrameCallback?: (f: () => void) => number }).requestVideoFrameCallback;
      if (rvfc) await Promise.race([new Promise<void>((done) => rvfc.call(v, () => done())), new Promise((r) => setTimeout(r, 500))]);
    }
  }
  private shownOnce = false;
  private loaded() {
    const v = this.video;
    return new Promise<void>((done) => {
      const finish = () => {
        v.removeEventListener("loadeddata", finish);
        v.removeEventListener("canplay", finish);
        clearTimeout(timer);
        done();
      };
      const timer = setTimeout(finish, 4000);
      v.addEventListener("loadeddata", finish);
      v.addEventListener("canplay", finish);
      if (this.ready) finish();
    });
  }
  pause() {
    if (!this.video.paused) this.video.pause();
  }
  private seeked() {
    const v = this.video;
    this.seeking = new Promise<void>((done) => {
      const finish = () => {
        v.removeEventListener("seeked", finish);
        v.removeEventListener("loadeddata", finish);
        clearTimeout(timer);
        done();
      };
      const timer = setTimeout(finish, 1500);
      v.addEventListener("seeked", finish);
      v.addEventListener("loadeddata", finish);
    });
    return this.seeking;
  }
  dispose() {
    this.video.pause();
    this.video.removeAttribute("src");
    this.video.load();
    this.video.remove();
  }
}

/** Where a link's files are (on Umi Cloud) and how its sound tracks mix. */
export type Remote = { url: (name: string) => string | null; gains?: number[] };

export class Session {
  readonly wasm: Wasm;
  private canvas = new OffscreenCanvas(16, 16);
  private attached: Promise<void>;
  private urls = new Map<string, string>();
  private players = new Map<string, Player>();
  private images = new Set<string>();
  private sounds = new Map<string, SoundFile>();
  private mixer: { key: string; mixer: Mixer } | null = null;
  hasCamera: boolean;
  /** The last state (kept so frames don't ask Rust for it each time). */
  current: EditorStateLike;
  /** Recordings in the browser are WebM; a link made while recording on the Mac is MP4. */
  private screenFile: string;
  private cameraFile: string;

  constructor(
    readonly id: string,
    name: string,
    project: Record<string, unknown>,
    cursor: Record<string, unknown> | undefined,
    mediaDuration: number,
    private files: Map<string, Blob>,
    preset?: string,
    /** Files read from Umi Cloud instead of memory (the player of a link made while recording). */
    private remote?: Remote,
  ) {
    this.wasm = new Wasm(id, name, JSON.stringify(project), cursor ? JSON.stringify(cursor) : "", mediaDuration, preset);
    this.screenFile = remote ? "screen.mp4" : "screen.webm";
    this.cameraFile = remote ? "camera.mp4" : "camera.webm";
    this.hasCamera = (files.has(this.cameraFile) || !!remote?.url(this.cameraFile)) && !!project.camera;
    this.current = JSON.parse(this.wasm.state(undefined));
    this.attached = openGpu(this.canvas).then(async (gpu) => {
      this.wasm.attach(gpu);
      // The face's path, when face framing was made.
      const faces = files.get("camera-face.json");
      if (faces) this.wasm.setFaces(await faces.text());
    });
    void this.registerImages();
  }

  static async open(id: string, name: string, project: Record<string, unknown>, cursor: Record<string, unknown> | undefined, mediaDuration: number, names: string[], preset?: string) {
    await start();
    const files = new Map<string, Blob>();
    await Promise.all(names.map(async (n) => {
      const b = await getFile(id, n);
      if (b) files.set(n, b);
    }));
    return new Session(id, name, project, cursor, mediaDuration, files, preset);
  }

  state(selection?: unknown) {
    this.current = JSON.parse(this.wasm.state(selection === undefined || selection === null ? undefined : JSON.stringify(selection)));
    return this.current;
  }

  apply(op: unknown, silences?: [number, number][]) {
    this.current = JSON.parse(this.wasm.apply(JSON.stringify(op), silences ? JSON.stringify(silences) : undefined));
    void this.registerImages();
    return this.current;
  }

  setWords(words: { start: number; end: number; text: string }[], language: string) {
    this.current = JSON.parse(this.wasm.setWords(JSON.stringify(words), language));
    return this.current;
  }

  /** A file was added to the recording (image, music, voiceover, face path). Resolves once an image is ready to draw. */
  addFile(name: string, blob: Blob): Promise<void> {
    this.files.set(name, blob);
    this.sounds.delete(name);
    const images = this.registerImages();
    if (name === "camera-face.json") void this.attached.then(async () => this.wasm.setFaces(await blob.text()));
    return images;
  }

  file(name: string) {
    return this.files.get(name) ?? null;
  }

  url(name: string) {
    let url = this.urls.get(name);
    if (!url) {
      const blob = this.files.get(name);
      if (!blob) return this.remote?.url(name) ?? null;
      url = URL.createObjectURL(blob);
      this.urls.set(name, url);
    }
    return url;
  }

  /** Images the edit names (background, overlays, logo) go to the renderer once. */
  private async registerImages() {
    await this.attached;
    const text = JSON.stringify(this.current.edit);
    for (const [name, blob] of this.files) {
      if (!IMAGE.test(name) || this.images.has(name) || !text.includes(JSON.stringify(name))) continue;
      this.images.add(name);
      try {
        const bitmap = await createImageBitmap(blob);
        const k = Math.min(1, 3200 / Math.max(bitmap.width, bitmap.height));
        const w = Math.max(1, Math.round(bitmap.width * k));
        const h = Math.max(1, Math.round(bitmap.height * k));
        const c = new OffscreenCanvas(w, h);
        const g = c.getContext("2d")!;
        g.drawImage(bitmap, 0, 0, w, h);
        bitmap.close();
        this.wasm.addImage(name, w, h, new Uint8Array(g.getImageData(0, 0, w, h).data.buffer));
      } catch {
        this.images.delete(name);
      }
    }
  }

  private player(key: string, file: string) {
    let p = this.players.get(key);
    if (!p) {
      const url = this.url(file);
      if (!url) return null;
      p = new Player(url);
      this.players.set(key, p);
    }
    return p;
  }

  private cameraBackground(): "blur" | "remove" | null {
    const bg = this.current.edit.camera?.background;
    return bg === "blur" || bg === "remove" ? bg : null;
  }

  /** Uploads screen and camera for one clip set at recording time `t`. */
  private async uploadLayer(set: number, t: number, playing: boolean, speed: number) {
    const screen = this.player(`screen#${set}`, this.screenFile);
    const camera = this.hasCamera ? this.player(`camera#${set}`, this.cameraFile) : null;
    await Promise.all([screen?.show(t, playing, speed), camera?.show(t, playing, speed)]);
    let hasScreen = false;
    let hasCamera = false;
    if (screen?.ready) {
      this.wasm.upload("screen", screen.video, screen.video.videoWidth, screen.video.videoHeight);
      hasScreen = true;
    }
    if (camera?.ready) {
      const v = camera.video;
      const effect = this.cameraBackground();
      const made = effect ? cameraEffect(v, v.videoWidth, v.videoHeight, effect) : null;
      if (made) this.wasm.upload("camera", made, made.width, made.height);
      else this.wasm.upload("camera", v, v.videoWidth, v.videoHeight);
      hasCamera = true;
    }
    return { hasScreen, hasCamera };
  }

  /** Renders output time `time` at most `width` × `height`; returns the frame as a bitmap. */
  async frame(time: number, width: number, height: number, flat: boolean, playing: boolean): Promise<ImageBitmap> {
    await this.attached;
    const m = JSON.parse(this.wasm.moment(time)) as Moment;
    const [w, h] = this.wasm.frameSize(width, height);
    const speedOf = (clip: number) => this.current.placements[clip]?.clip.speed ?? 1;
    const overlays: string[] = [];
    await Promise.all(
      m.overlays.map(async (o) => {
        const p = this.player(`overlay:${o.id}`, o.file);
        if (!p) return;
        await p.show(o.time, playing, 1);
        if (p.ready) {
          this.wasm.upload(o.id, p.video, p.video.videoWidth, p.video.videoHeight);
          overlays.push(o.id);
        }
      }),
    );
    // Overlays no longer on screen stop playing.
    for (const [key, p] of this.players) if (key.startsWith("overlay:") && !m.overlays.some((o) => key === `overlay:${o.id}`)) p.pause();

    const a = await this.uploadLayer(m.layer.clip % 2, m.layer.sourceTime, playing, speedOf(m.layer.clip));
    if (m.dissolve) {
      this.wasm.draw(w, h, m.layer.sourceTime, time, a.hasScreen, a.hasCamera, overlays, 0, flat);
      const b = await this.uploadLayer(m.dissolve.clip % 2, m.dissolve.sourceTime, playing, speedOf(m.dissolve.clip));
      this.wasm.draw(w, h, m.dissolve.sourceTime, time, b.hasScreen, b.hasCamera, overlays, 1, flat);
      this.wasm.dissolve(w, h, m.dissolve.progress);
    } else {
      // The other clip set isn't needed: keep its videos still.
      for (const k of ["screen#", "camera#"]) this.players.get(`${k}${(m.layer.clip + 1) % 2}`)?.pause();
      this.wasm.draw(w, h, m.layer.sourceTime, time, a.hasScreen, a.hasCamera, overlays, undefined, flat);
    }
    return this.wasm.present();
  }

  /** Stops the videos (playback ended or paused). */
  pause() {
    for (const p of this.players.values()) p.pause();
  }

  layout(time: number): [number, number, number, number] {
    return Array.from(this.wasm.layout(time)) as [number, number, number, number];
  }

  /** The soundtrack from output time `time` for `seconds`, 48 kHz stereo interleaved. */
  async audio(time: number, seconds: number): Promise<ArrayBuffer> {
    const mixer = this.soundMixer();
    const frames = Math.round(Math.max(0, Math.min(seconds, 10)) * 48000);
    if (!mixer) return new Float32Array(frames * 2).buffer;
    return (await mixer.render(time, frames)).buffer as ArrayBuffer;
  }

  soundMixer(): Mixer | null {
    const s = this.current;
    const key = JSON.stringify([s.placements, s.edit.sound, s.edit.music, s.edit.voiceovers, this.wasm.crossfade()]);
    if (this.mixer?.key === key) return this.mixer.mixer;
    const screen = this.sound(this.screenFile);
    if (!screen) return null;
    const clicks = Array.from(this.wasm.clickTimes());
    const mixer = new Mixer((name) => this.sound(name), screen, s.placements, this.wasm.crossfade(), s.outputDuration, s.edit, clicks);
    this.mixer = { key, mixer };
    return mixer;
  }

  sound(name: string) {
    let s = this.sounds.get(name);
    if (!s) {
      const blob = this.files.get(name);
      const url = blob ? null : this.remote?.url(name);
      if (!blob && !url) return null;
      s = blob ? new SoundFile(blob) : new SoundFile(url!, name === this.screenFile ? this.remote?.gains : undefined);
      this.sounds.set(name, s);
    }
    return s;
  }

  /** Readies the camera effect the edit asks for (the segmentation model loads once). */
  prepareCameraEffect() {
    return loadSegmenter();
  }

  close() {
    for (const p of this.players.values()) p.dispose();
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.players.clear();
    this.urls.clear();
    this.wasm.free();
  }
}
