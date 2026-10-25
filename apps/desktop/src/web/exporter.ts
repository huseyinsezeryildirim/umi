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

export async function exportVideo(session: Session, req: ExportRequest, onProgress: (p: number) => void, signal: AbortSignal, file: FileSystemFileHandle | null): Promise<Blob | null> {
  if (req.format === "gif") throw new Error("GIF export is in the Mac app for now — export an MP4 here.");
  const wasm = session.wasm;
  const fps = req.fps;
  const duration = wasm.duration();
  const [W, H] = wasm.frameSize(0, req.resolution);
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

  const output = new Output({
    format: req.format === "mov" ? new MovOutputFormat() : new Mp4OutputFormat(file ? {} : { fastStart: "in-memory" }),
    target: file ? new StreamTarget(await file.createWritable(), { chunked: true }) : new BufferTarget(),
  });
  const vcodec = await getFirstEncodableVideoCodec(["avc", "hevc", "vp9", "av1"], { width: W, height: H });
  if (!vcodec) throw new Error("This browser can’t encode video.");
  const video = new VideoSampleSource({ codec: vcodec, bitrate: QUALITY_HIGH });
  output.addVideoTrack(video, { frameRate: fps });
  const mixer = session.soundMixer();
  let sound: AudioSampleSource | null = null;
  if (mixer) {
    const acodec = await getFirstEncodableAudioCodec(req.format === "mov" ? ["aac"] : ["aac", "opus"], { numberOfChannels: 2, sampleRate: 48000 });
    if (!acodec) throw new Error("This browser can’t encode the sound — try Chrome or Edge.");
    sound = new AudioSampleSource({ codec: acodec, bitrate: QUALITY_HIGH });
    output.addAudioTrack(sound);
  }
  await output.start();

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

  let soundAt = 0;
  try {
    for (let i = 0; i < count; i++) {
      if (signal.aborted) {
        await output.cancel();
        return null;
      }
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
      const sample = new VideoSample(bitmap, { timestamp: t, duration: 1 / fps });
      await video.add(sample);
      sample.close();
      bitmap.close();
      // Sound a second at a time, kept just ahead of the picture.
      while (sound && mixer && soundAt <= t + 1 / fps && soundAt < duration) {
        const seconds = Math.min(1, duration - soundAt);
        const frames = Math.round(seconds * 48000);
        const data = await mixer.render(soundAt, frames);
        const chunk = new AudioSample({ data, format: "f32", numberOfChannels: 2, sampleRate: 48000, timestamp: soundAt });
        await sound.add(chunk);
        chunk.close();
        soundAt += seconds;
      }
      if (i % 10 === 0) onProgress(i / count);
    }
    await output.finalize();
  } finally {
    for (const r of readers.values()) r.close();
  }
  onProgress(1);
  if (file) return null;
  return new Blob([(output.target as BufferTarget).buffer!], { type: req.format === "mov" ? "video/quicktime" : "video/mp4" });
}
