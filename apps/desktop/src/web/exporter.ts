// Export in the browser: every output frame drawn by the same GPU renderer as the preview
// (from exactly decoded frames), the soundtrack from the same mixer, encoded with the
// browser's hardware encoders (WebCodecs, through Mediabunny) as fast as they go.
import {
  ALL_FORMATS,
  AudioSample,
  AudioSampleSource,
  BlobSource,
  BufferTarget,
  Input,
  MovOutputFormat,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  StreamTarget,
  VideoSample,
  VideoSampleSink,
  VideoSampleSource,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
} from "mediabunny";
import type { Moment, Session } from "./engine";
import { GifEncoder } from "./pkg/umi_web.js";
import { cameraEffect, loadSegmenter } from "./segment";

export type ExportRequest = { format: "mp4" | "mov" | "gif"; resolution: number; fps: number; destination: string };

/** Reads exact frames of one file for a known, ordered list of times. */
class Frames {
  private it: AsyncGenerator<VideoSample | null, void, unknown> | null = null;
  private last: VideoSample | null = null;
  readonly times: number[] = [];
  constructor(private blob: Blob) {}
  async next(): Promise<VideoSample | null> {
    if (!this.it) {
      const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(this.blob) });
      const track = await input.getPrimaryVideoTrack();
      if (!track) return null;
      this.it = new VideoSampleSink(track).samplesAtTimestamps(this.times);
    }
    const s = (await this.it.next()).value ?? null;
    // The same frame can come back for several times; close it once it's replaced.
    if (s !== this.last) this.last?.close();
    this.last = s;
    return s;
  }
  close() {
    this.last?.close();
    void this.it?.return();
  }
}

/** Where a take's frames and sound go. */
type Sink = {
  width: number;
  height: number;
  fps: number;
  /** Output time of the take's start (takes laid end to end). */
  offset: number;
  frame: (bitmap: ImageBitmap, t: number) => Promise<void>;
  sound: ((data: Float32Array, t: number) => Promise<void>) | null;
};

/**
 * Draws a recording's whole edit at the sink's size, every frame from exactly decoded video,
 * and its mixed sound. Returns false when cancelled.
 */
async function renderTake(session: Session, sink: Sink, onProgress: (p: number) => void, signal: AbortSignal): Promise<boolean> {
  const wasm = session.wasm;
  const { width: W, height: H, fps } = sink;
  const duration = wasm.duration();
  const count = Math.max(1, Math.round(duration * fps));
  const state = session.current;
  const effect = state.edit.camera?.background === "blur" || state.edit.camera?.background === "remove" ? (state.edit.camera.background as "blur" | "remove") : null;
  if (effect) await loadSegmenter();

  // Which frames of which file each output frame needs, in order.
  const readers = new Map<string, Frames>();
  const reader = (key: string, file: string) => {
    let r = readers.get(key);
    if (!r) {
      const blob = session.file(file);
      if (!blob) return null;
      r = new Frames(blob);
      readers.set(key, r);
    }
    return r;
  };
  type Need = { key: string; slot: string };
  const plan: { m: Moment; a: Need[]; b: Need[]; overlays: Need[] }[] = [];
  const layer = (set: number, t: number): Need[] => {
    const out: Need[] = [];
    const s = reader(`screen#${set}`, "screen.webm");
    if (s) {
      s.times.push(t);
      out.push({ key: `screen#${set}`, slot: "screen" });
    }
    const c = session.hasCamera ? reader(`camera#${set}`, "camera.webm") : null;
    if (c) {
      c.times.push(t);
      out.push({ key: `camera#${set}`, slot: "camera" });
    }
    return out;
  };
  for (let i = 0; i < count; i++) {
    const m = JSON.parse(wasm.moment(i / fps)) as Moment;
    const overlays: Need[] = [];
    for (const o of m.overlays) {
      const r = reader(`overlay:${o.id}`, o.file);
      if (!r) continue;
      r.times.push(o.time);
      overlays.push({ key: `overlay:${o.id}`, slot: o.id });
    }
    plan.push({ m, a: layer(m.layer.clip % 2, m.layer.sourceTime), b: m.dissolve ? layer(m.dissolve.clip % 2, m.dissolve.sourceTime) : [], overlays });
  }

  /** Uploads what one side of the frame needs; returns which slots got a frame. */
  const upload = async (needs: Need[]) => {
    const got = new Set<string>();
    for (const n of needs) {
      const sample = await readers.get(n.key)!.next();
      if (!sample) continue;
      const frame = sample.toVideoFrame();
      try {
        const made = n.slot === "camera" && effect ? cameraEffect(frame, frame.displayWidth, frame.displayHeight, effect) : null;
        if (made) wasm.upload(n.slot, made, made.width, made.height);
        else wasm.upload(n.slot, frame, frame.displayWidth, frame.displayHeight);
        got.add(n.slot);
      } finally {
        frame.close();
      }
    }
    return got;
  };

  const mixer = sink.sound ? session.soundMixer() : null;
  let soundAt = 0;
  try {
    for (let i = 0; i < count; i++) {
      if (signal.aborted) return false;
      const { m, a, b, overlays } = plan[i];
      const t = i / fps;
      const shown = await upload(overlays);
      const ids = overlays.map((o) => o.slot).filter((s) => shown.has(s));
      const ga = await upload(a);
      if (m.dissolve) {
        wasm.draw(W, H, m.layer.sourceTime, t, ga.has("screen"), ga.has("camera"), ids, 0, false);
        const gb = await upload(b);
        wasm.draw(W, H, m.dissolve.sourceTime, t, gb.has("screen"), gb.has("camera"), ids, 1, false);
        wasm.dissolve(W, H, m.dissolve.progress);
      } else {
        wasm.draw(W, H, m.layer.sourceTime, t, ga.has("screen"), ga.has("camera"), ids, undefined, false);
      }
      const bitmap = wasm.present();
      await sink.frame(bitmap, sink.offset + t);
      bitmap.close();
      // Sound a second at a time, kept just ahead of the picture.
      while (sink.sound && mixer && soundAt <= t + 1 / fps && soundAt < duration) {
        const seconds = Math.min(1, duration - soundAt);
        await sink.sound(await mixer.render(soundAt, Math.round(seconds * 48000)), sink.offset + soundAt);
        soundAt += seconds;
      }
      if (i % 10 === 0) onProgress(i / count);
    }
  } finally {
    for (const r of readers.values()) r.close();
  }
  return true;
}

/** An MP4/MOV being written: video and sound sources. */
async function videoFile(format: "mp4" | "mov", width: number, height: number, fps: number, withSound: boolean, file: FileSystemFileHandle | null) {
  const output = new Output({
    format: format === "mov" ? new MovOutputFormat() : new Mp4OutputFormat(file ? {} : { fastStart: "in-memory" }),
    target: file ? new StreamTarget(await file.createWritable(), { chunked: true }) : new BufferTarget(),
  });
  const vcodec = await getFirstEncodableVideoCodec(["avc", "hevc", "vp9", "av1"], { width, height });
  if (!vcodec) throw new Error("This browser can’t encode video.");
  const video = new VideoSampleSource({ codec: vcodec, bitrate: QUALITY_HIGH });
  output.addVideoTrack(video, { frameRate: fps });
  let audio: AudioSampleSource | null = null;
  if (withSound) {
    const acodec = await getFirstEncodableAudioCodec(format === "mov" ? ["aac"] : ["aac", "opus"], { numberOfChannels: 2, sampleRate: 48000 });
    if (!acodec) throw new Error("This browser can’t encode the sound — try Chrome or Edge.");
    audio = new AudioSampleSource({ codec: acodec, bitrate: QUALITY_HIGH });
    output.addAudioTrack(audio);
  }
  await output.start();
  const sink = (offset: number): Sink => ({
    width,
    height,
    fps,
    offset,
    frame: async (bitmap, t) => {
      const sample = new VideoSample(bitmap, { timestamp: t, duration: 1 / fps });
      await video.add(sample);
      sample.close();
    },
    sound: audio
      ? async (data, t) => {
          const chunk = new AudioSample({ data, format: "f32", numberOfChannels: 2, sampleRate: 48000, timestamp: t });
          await audio!.add(chunk);
          chunk.close();
        }
      : null,
  });
  const finish = async () => {
    await output.finalize();
    if (file) return null;
    return new Blob([(output.target as BufferTarget).buffer!], { type: format === "mov" ? "video/quicktime" : "video/mp4" });
  };
  return { sink, finish, cancel: () => output.cancel() };
}

export async function exportVideo(session: Session, req: ExportRequest, onProgress: (p: number) => void, signal: AbortSignal, file: FileSystemFileHandle | null): Promise<Blob | null> {
  if (req.format === "gif") return exportGif(session, req, onProgress, signal, file);
  const [W, H] = session.wasm.frameSize(0, req.resolution);
  const out = await videoFile(req.format, W, H, req.fps, !!session.soundMixer(), file);
  if (!(await renderTake(session, out.sink(0), onProgress, signal))) {
    await out.cancel();
    return null;
  }
  const blob = await out.finish();
  onProgress(1);
  return blob;
}

/** GIF: 540p at most, 15 fps, no sound (like the Mac app). */
async function exportGif(session: Session, req: ExportRequest, onProgress: (p: number) => void, signal: AbortSignal, file: FileSystemFileHandle | null): Promise<Blob | null> {
  const [W, H] = session.wasm.frameSize(0, Math.min(req.resolution, 540));
  const gif = new GifEncoder(W, H, 15);
  const canvas = new OffscreenCanvas(W, H);
  const g = canvas.getContext("2d", { willReadFrequently: true })!;
  const sink: Sink = {
    width: W,
    height: H,
    fps: 15,
    offset: 0,
    frame: async (bitmap) => {
      g.drawImage(bitmap, 0, 0, W, H);
      gif.push(new Uint8Array(g.getImageData(0, 0, W, H).data.buffer));
    },
    sound: null,
  };
  if (!(await renderTake(session, sink, onProgress, signal))) {
    gif.free();
    return null;
  }
  const blob = new Blob([gif.finish() as Uint8Array<ArrayBuffer>], { type: "image/gif" });
  onProgress(1);
  if (file) {
    const w = await file.createWritable();
    await w.write(blob);
    await w.close();
    return null;
  }
  return blob;
}

/**
 * Several recordings end to end in one video (Combine in the library): each drawn with its own
 * edit, all in the first one's shape (16:9 when it has none), 1080p, 30 fps.
 */
export async function combineTakes(sessions: Session[], onProgress: (p: number) => void, signal: AbortSignal): Promise<{ blob: Blob; duration: number; width: number; height: number }> {
  const first = sessions[0];
  const aspect = first.current.edit.aspect && first.current.edit.aspect !== "auto" ? first.current.edit.aspect : "wide";
  for (const s of sessions) s.apply({ op: "setEdit", edit: { ...s.current.edit, aspect } });
  const [W, H] = first.wasm.frameSize(0, 1080);
  const out = await videoFile("mp4", W, H, 30, sessions.some((s) => !!s.soundMixer()), null);
  let offset = 0;
  for (const [i, s] of sessions.entries()) {
    const sink = out.sink(offset);
    // A take without sound leaves a gap in the sound track (silence).
    if (!s.soundMixer()) sink.sound = null;
    if (!(await renderTake(s, sink, (p) => onProgress((i + p) / sessions.length), signal))) {
      await out.cancel();
      throw "cancelled";
    }
    offset += Math.round(s.wasm.duration() * 30) / 30;
  }
  const blob = (await out.finish())!;
  onProgress(1);
  return { blob, duration: offset, width: W, height: H };
}
