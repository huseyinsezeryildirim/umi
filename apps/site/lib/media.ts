// Reading and writing the recordings with WebCodecs (through Mediabunny): the fast export, the
// voice for transcription, and where on screen things happen (for automatic zoom).
import {
  ALL_FORMATS,
  AudioBufferSink,
  AudioBufferSource,
  BlobSource,
  BufferTarget,
  CanvasSink,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  StreamTarget,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
} from "mediabunny";
import { type Look, type Word, type Zoom, canvasSize, paint } from "./look";
import { cameraWithBackground, loadSegmenter } from "./segment";
import type { Range } from "./timeline";

export const canExportFast = () => typeof VideoEncoder !== "undefined" && typeof VideoDecoder !== "undefined" && typeof OffscreenCanvas !== "undefined";

const open = (blob: Blob) => new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });

type ExportJob = {
  screen: Blob;
  camera: Blob | null;
  look: Look;
  kept: Range[];
  zooms: Zoom[];
  lines: Word[][];
  onProgress: (p: number) => void;
  signal: AbortSignal;
  /** Where to write. Without it the file is built in memory and returned. */
  file?: FileSystemWritableFileStream;
};

const FPS = 30;

/** This browser can't encode the recording's sound; the caller falls back to real-time export. */
export class NoAudioEncoder extends Error {}

/**
 * Renders the edited video frame by frame, as fast as the computer's video hardware allows
 * (usually several times faster than real time), and encodes it to MP4.
 */
export async function exportFast(job: ExportJob): Promise<Blob | null> {
  const screenIn = open(job.screen);
  const cameraIn = job.camera ? open(job.camera) : null;
  const video = await screenIn.getPrimaryVideoTrack();
  if (!video) throw new Error("The recording has no video.");
  const audio = await screenIn.getPrimaryAudioTrack();
  const camTrack = cameraIn && job.look.camera ? await cameraIn.getPrimaryVideoTrack() : null;

  const [W, H] = canvasSize(job.look, video.displayWidth, video.displayHeight);
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext("2d")!;

  const output = new Output({
    format: new Mp4OutputFormat(job.file ? {} : { fastStart: "in-memory" }),
    target: job.file ? new StreamTarget(job.file, { chunked: true }) : new BufferTarget(),
  });
  const vcodec = await getFirstEncodableVideoCodec(["avc", "hevc", "vp9", "av1"], { width: W, height: H });
  if (!vcodec) throw new Error("This browser can’t encode video.");
  const frames = new CanvasSource(canvas, { codec: vcodec, quality: QUALITY_HIGH });
  output.addVideoTrack(frames, { frameRate: FPS });
  let sound: AudioBufferSource | null = null;
  if (audio) {
    const acodec = await getFirstEncodableAudioCodec(["aac", "opus"], { numberOfChannels: audio.numberOfChannels, sampleRate: audio.sampleRate });
    // No encoder for the sound here (some Safari and Firefox versions): don't make a silent video.
    if (!acodec) throw new NoAudioEncoder();
    sound = new AudioBufferSource({ codec: acodec, quality: QUALITY_HIGH });
    output.addAudioTrack(sound);
  }
  if (job.look.camera && job.look.camBg !== "none") await loadSegmenter();
  await output.start();

  // Every output frame's time in the recording.
  const times: number[] = [];
  for (const [a, b] of job.kept) for (let t = a; t < b - 1e-6; t += 1 / FPS) times.push(t);
  const screens = new CanvasSink(video, { poolSize: 3 }).canvasesAtTimestamps(times);
  const cams = camTrack ? new CanvasSink(camTrack, { poolSize: 3, width: 480, height: 480, fit: "cover" }).canvasesAtTimestamps(times) : null;
  const audioSink = audio && sound ? new AudioBufferSink(audio) : null;

  // Frames and sound go in together, a range at a time, so the file stays interleaved.
  let i = 0;
  for (const [a, b] of job.kept) {
    for (let step = a; step < b; step += 2) {
      const until = Math.min(b, step + 2);
      while (i < times.length && times[i] < until - 1e-6) {
        if (job.signal.aborted) {
          await output.cancel();
          return null;
        }
        const s = (await screens.next()).value;
        const c = cams ? (await cams.next()).value : null;
        const cam = c ? (cameraWithBackground(c.canvas, 480, 480, 480, job.look.camBg) ?? c.canvas) : null;
        paint(ctx, {
          look: job.look,
          screen: s?.canvas ?? null,
          screenSize: [video.displayWidth, video.displayHeight],
          camera: cam,
          cameraSize: [480, 480],
          time: times[i],
          zooms: job.zooms,
          lines: job.lines,
        });
        await frames.add(i / FPS, 1 / FPS);
        i++;
        if (i % 15 === 0) job.onProgress(i / times.length);
      }
      if (audioSink && sound) await addAudio(audioSink, sound, step, until);
    }
  }
  await output.finalize();
  job.onProgress(1);
  if (job.file) return null;
  return new Blob([(output.target as BufferTarget).buffer!], { type: "video/mp4" });
}

/** Adds the sound between `from` and `to`, cut exactly at both ends. */
async function addAudio(sink: AudioBufferSink, sound: AudioBufferSource, from: number, to: number) {
  for await (const { buffer, timestamp } of sink.buffers(from, to)) {
    const rate = buffer.sampleRate;
    const start = Math.max(0, Math.round((from - timestamp) * rate));
    const end = Math.min(buffer.length, Math.round((to - timestamp) * rate));
    if (end <= start) continue;
    if (start === 0 && end === buffer.length) {
      await sound.add(buffer);
      continue;
    }
    const part = new AudioBuffer({ length: end - start, numberOfChannels: buffer.numberOfChannels, sampleRate: rate });
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) part.copyToChannel(buffer.getChannelData(ch).subarray(start, end), ch);
    await sound.add(part);
  }
}

/** The voice as 16 kHz mono, which is what speech recognition wants. */
export async function voice16k(blob: Blob): Promise<Float32Array | null> {
  const track = await open(blob).getPrimaryAudioTrack();
  if (!track) return null;
  const parts: Float32Array[] = [];
  let length = 0;
  let carry = 0;
  for await (const { buffer } of new AudioBufferSink(track).buffers()) {
    const step = buffer.sampleRate / 16000;
    const chans = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
    const n = Math.floor((buffer.length - carry) / step);
    const out = new Float32Array(Math.max(0, n));
    for (let k = 0; k < out.length; k++) {
      const at = Math.floor(carry + k * step);
      let v = 0;
      for (const ch of chans) v += ch[at];
      out[k] = v / chans.length;
    }
    carry = carry + out.length * step - buffer.length;
    if (carry < 0) carry = 0;
    parts.push(out);
    length += out.length;
  }
  const all = new Float32Array(length);
  let at = 0;
  for (const p of parts) {
    all.set(p, at);
    at += p.length;
  }
  return all;
}

/**
 * Automatic zoom without clicks: the browser can't see clicks outside its own tab, so Umi looks at
 * what changes on screen instead. A small, steady change (typing, a menu, a button) gets a zoom
 * centred on it; big changes (a new page, scrolling) don't.
 */
export async function findZooms(blob: Blob, duration: number, onProgress?: (p: number) => void): Promise<Zoom[]> {
  const track = await open(blob).getPrimaryVideoTrack();
  if (!track) return [];
  const w = 160;
  const h = Math.max(2, Math.round((w * track.displayHeight) / track.displayWidth));
  const step = 0.25;
  const times: number[] = [];
  for (let t = 0; t < duration; t += step) times.push(t);
  const sink = new CanvasSink(track, { width: w, height: h, fit: "fill", poolSize: 2 });
  const scratch = new OffscreenCanvas(w, h).getContext("2d", { willReadFrequently: true })!;
  let prev: Uint8ClampedArray | null = null;
  const spots: { t: number; x: number; y: number }[] = [];
  let i = 0;
  for await (const frame of sink.canvasesAtTimestamps(times)) {
    const t = times[i++];
    if (!frame) continue;
    scratch.drawImage(frame.canvas, 0, 0);
    const px = scratch.getImageData(0, 0, w, h).data;
    if (prev) {
      let n = 0;
      let sx = 0;
      let sy = 0;
      for (let p = 0; p < px.length; p += 4) {
        const d = Math.abs(px[p] - prev[p]) + Math.abs(px[p + 1] - prev[p + 1]) + Math.abs(px[p + 2] - prev[p + 2]);
        if (d > 60) {
          const k = p / 4;
          n++;
          sx += k % w;
          sy += Math.floor(k / w);
        }
      }
      const share = n / (w * h);
      // More than a cursor's worth, less than a page change.
      if (share > 0.0015 && share < 0.12) spots.push({ t, x: sx / n / w, y: sy / n / h });
    }
    prev = new Uint8ClampedArray(px);
    if (i % 20 === 0) onProgress?.(i / times.length);
  }

  // Group nearby activity into zooms of at least 1.5 s, apart by at least 1 s.
  const zooms: Zoom[] = [];
  for (const s of spots) {
    const last = zooms[zooms.length - 1];
    if (last && s.t - last.end < 1.5 && Math.hypot(s.x - last.x, s.y - last.y) < 0.25) {
      last.end = s.t + 0.8;
      last.x = (last.x * 3 + s.x) / 4;
      last.y = (last.y * 3 + s.y) / 4;
    } else if (!last || s.t > last.end + 1) {
      zooms.push({ start: Math.max(0.3, s.t - 0.4), end: s.t + 1.2, x: s.x, y: s.y });
    }
  }
  return zooms.filter((z) => z.end - z.start >= 1.5).map((z) => ({ ...z, end: Math.min(z.end, duration) }));
}
