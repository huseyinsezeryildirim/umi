// The soundtrack in the browser, mixed like the Mac app's AudioMixer: every kept clip's sound
// (crossfaded, at the clip's speed), the music bed (looped, faded out at the end), voiceovers
// (everything else dips under them) and click sounds. 48 kHz stereo interleaved f32.
import { ALL_FORMATS, AudioBufferSink, BlobSource, Input, type InputAudioTrack, UrlSource } from "mediabunny";

export const RATE = 48000;

/**
 * Reads any stretch of a file's sound as 48 kHz stereo: a file in memory, or one on Umi Cloud
 * (read in ranges as it plays). `gains` mixes several tracks (a Mac recording keeps system sound
 * and the microphone apart); without it the primary track plays.
 */
export class SoundFile {
  private sinks: Promise<{ sink: AudioBufferSink; gain: number }[]>;
  /** The last decoded stretch, so sequential reads don't decode twice. */
  private cache: { from: number; to: number; left: Float32Array; right: Float32Array } | null = null;
  duration: Promise<number>;

  constructor(file: Blob | string, gains?: number[]) {
    const input = new Input({ formats: ALL_FORMATS, source: typeof file === "string" ? new UrlSource(file) : new BlobSource(file) });
    const tracks: Promise<{ track: InputAudioTrack; gain: number }[]> = gains
      ? input.getAudioTracks().then((all) => all.map((track, i) => ({ track, gain: gains[i] ?? 1 })).filter((t) => t.gain > 0))
      : input.getPrimaryAudioTrack().then((track) => (track ? [{ track, gain: 1 }] : []));
    const safe = tracks.catch(() => []);
    this.sinks = safe.then((ts) => ts.map(({ track, gain }) => ({ sink: new AudioBufferSink(track), gain })));
    this.duration = safe.then(async (ts) => (ts[0] ? await ts[0].track.computeDuration() : 0)).catch(() => 0);
  }

  /** Decoded sound between `from` and `to` seconds (48 kHz), cached. */
  private async range(from: number, to: number) {
    const c = this.cache;
    if (c && from >= c.from && to <= c.to) return c;
    // Decode a little ahead so the next chunks come from memory.
    const start = Math.max(0, from - 0.05);
    const end = Math.max(to, from + 4);
    const n = Math.ceil((end - start) * RATE);
    const left = new Float32Array(n);
    const right = new Float32Array(n);
    for (const { sink, gain } of await this.sinks) {
      for await (const { buffer, timestamp } of sink.buffers(start, end)) {
        const step = buffer.sampleRate / RATE;
        const l = buffer.getChannelData(0);
        const r = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : l;
        const first = Math.round((timestamp - start) * RATE);
        const count = Math.floor(buffer.length / step);
        for (let i = 0; i < count; i++) {
          const at = first + i;
          if (at < 0 || at >= n) continue;
          const src = Math.floor(i * step);
          left[at] += l[src] * gain;
          right[at] += r[src] * gain;
        }
      }
    }
    this.cache = { from: start, to: end, left, right };
    return this.cache;
  }

  /**
   * `count` output frames starting at file time `from`, played at `speed` (pitch moves with
   * speed, unlike the Mac's time stretch), added into `out` at frame `offset` times `gain`.
   */
  async mixInto(out: Float32Array, offset: number, count: number, from: number, speed: number, gain: (k: number) => number) {
    const to = from + (count * speed) / RATE;
    const c = await this.range(from, to + 0.01);
    for (let k = 0; k < count; k++) {
      const pos = (from - c.from) * RATE + k * speed;
      const i = Math.floor(pos);
      const f = pos - i;
      if (i < 0 || i + 1 >= c.left.length) continue;
      const g = gain(k);
      if (g === 0) continue;
      out[(offset + k) * 2] += (c.left[i] * (1 - f) + c.left[i + 1] * f) * g;
      out[(offset + k) * 2 + 1] += (c.right[i] * (1 - f) + c.right[i + 1] * f) * g;
    }
  }
}

type Placement = { clip: { start: number; end: number; speed: number }; outputStart: number };
type Edit = {
  // Left out of the JSON while it has the default values.
  sound?: { microphoneVolume?: number; systemVolume?: number; clickSounds?: boolean };
  music?: { file: string; volume: number; fadeOut: number } | null;
  voiceovers?: { file: string; start: number; end: number; volume: number }[];
  transitions?: unknown;
};

const DUCK = 0.3;
const DUCK_RAMP = 0.25;

/** A soft, short mouse click (the same sound the Mac app makes). */
const CLICK = (() => {
  const n = Math.round(0.045 * RATE);
  let seed = 12345;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = (((seed >>> 9) / (1 << 23)) * 2 - 1) * Math.exp(-t / 0.003);
    const tone = Math.sin(t * 2400 * Math.PI * 2) * Math.exp(-t / 0.012) + Math.sin(t * 1150 * Math.PI * 2) * Math.exp(-t / 0.02) * 0.5;
    out[i] = (tone * 0.22 + noise * 0.12) * (1 - Math.exp(-t / 0.0006));
  }
  return out;
})();

export class Mixer {
  constructor(
    private files: (name: string) => SoundFile | null,
    private screen: SoundFile,
    private placements: Placement[],
    private crossfade: number,
    private duration: number,
    private edit: Edit,
    /** Output times of clicks (for click sounds). */
    private clicks: number[],
  ) {}

  /** The soundtrack from output time `t0` for `frames` frames. */
  async render(t0: number, frames: number): Promise<Float32Array> {
    const out = new Float32Array(frames * 2);
    const t1 = t0 + frames / RATE;
    const fade = this.crossfade;
    const ps = this.placements;
    const volume = this.edit.sound?.microphoneVolume ?? 1;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      const end = p.outputStart + (p.clip.end - p.clip.start) / p.clip.speed;
      const a = Math.max(t0, p.outputStart);
      const b = Math.min(t1, end);
      if (b <= a) continue;
      const offset = Math.round((a - t0) * RATE);
      const count = Math.min(Math.round((b - a) * RATE), frames - offset);
      if (count <= 0) continue;
      const source = p.clip.start + (a - p.outputStart) * p.clip.speed;
      const next = ps[i + 1];
      await this.screen.mixInto(out, offset, count, source, p.clip.speed, (k) => {
        const t = a + k / RATE;
        let g = volume;
        if (fade > 0) {
          if (i > 0 && t < p.outputStart + fade) g *= Math.min(1, Math.max(0, (t - p.outputStart) / fade));
          if (next && t > next.outputStart) g *= Math.min(1, Math.max(0, 1 - (t - next.outputStart) / fade));
        }
        return g;
      });
    }
    await this.music(t0, out);
    await this.voices(t0, out);
    this.clickSounds(t0, out);
    for (let i = 0; i < out.length; i++) out[i] = Math.max(-1, Math.min(1, out[i]));
    return out;
  }

  private async music(t0: number, out: Float32Array) {
    const m = this.edit.music;
    const file = m ? this.files(m.file) : null;
    if (!m || !file) return;
    const length = await file.duration;
    if (length < 0.1) return;
    const frames = out.length / 2;
    const total = this.duration;
    const fade = Math.min(m.fadeOut ?? 2, total);
    let written = 0;
    while (written < frames) {
      const t = t0 + written / RATE;
      if (t >= total) break;
      const into = t % length;
      const n = Math.min(frames - written, Math.max(1, Math.floor((length - into) * RATE)));
      const base = written;
      await file.mixInto(out, written, n, into, 1, (k) => {
        const tt = t0 + (base + k) / RATE;
        if (tt >= total) return 0;
        let g = m.volume ?? 0.35;
        if (fade > 0 && tt > total - fade) g *= Math.min(1, Math.max(0, (total - tt) / fade));
        return g;
      });
      written += n;
    }
  }

  private async voices(t0: number, out: Float32Array) {
    const voices = this.edit.voiceovers ?? [];
    if (!voices.length) return;
    const frames = out.length / 2;
    const t1 = t0 + frames / RATE;
    for (let k = 0; k < frames; k++) {
      const t = t0 + k / RATE;
      let near = 0;
      for (const v of voices) near = Math.max(near, Math.min(1, Math.max(0, Math.min((t - (v.start - DUCK_RAMP)) / DUCK_RAMP, (v.end + DUCK_RAMP - t) / DUCK_RAMP))));
      const g = 1 - (1 - DUCK) * near;
      if (g < 1) {
        out[k * 2] *= g;
        out[k * 2 + 1] *= g;
      }
    }
    for (const v of voices) {
      const a = Math.max(t0, v.start);
      const b = Math.min(t1, v.end);
      const file = this.files(v.file);
      if (b <= a || !file) continue;
      const offset = Math.round((a - t0) * RATE);
      const count = Math.min(Math.round((b - a) * RATE), frames - offset);
      await file.mixInto(out, offset, count, a - v.start, 1, () => v.volume ?? 1);
    }
  }

  private clickSounds(t0: number, out: Float32Array) {
    if (!this.edit.sound?.clickSounds) return;
    const frames = out.length / 2;
    for (const at of this.clicks) {
      for (let k = 0; k < frames; k++) {
        const i = Math.round((t0 + k / RATE - at) * RATE);
        if (i >= 0 && i < CLICK.length) {
          out[k * 2] += CLICK[i];
          out[k * 2 + 1] += CLICK[i];
        }
      }
    }
  }
}

/** Loudness peaks, `perSecond` a second (the timeline's waveform). */
export async function waveform(blob: Blob, perSecond = 50): Promise<number[]> {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
  const track = await input.getPrimaryAudioTrack();
  if (!track) return [];
  const peaks: number[] = [];
  for await (const { buffer, timestamp } of new AudioBufferSink(track).buffers()) {
    const per = buffer.sampleRate / perSecond;
    const data = buffer.getChannelData(0);
    for (let i = 0; i < buffer.length; i++) {
      const bucket = Math.floor(timestamp * perSecond + i / per);
      const v = Math.abs(data[i]);
      if (bucket >= 0) peaks[bucket] = Math.max(peaks[bucket] ?? 0, v);
    }
  }
  for (let i = 0; i < peaks.length; i++) peaks[i] ??= 0;
  return peaks;
}

/** The voice as 16 kHz mono (what speech recognition wants). */
export async function voice16k(blob: Blob): Promise<Float32Array | null> {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
  const track = await input.getPrimaryAudioTrack();
  if (!track) return null;
  const parts: { at: number; data: Float32Array }[] = [];
  let length = 0;
  for await (const { buffer, timestamp } of new AudioBufferSink(track).buffers()) {
    const step = buffer.sampleRate / 16000;
    const n = Math.floor(buffer.length / step);
    const data = new Float32Array(n);
    const chans = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
    for (let k = 0; k < n; k++) {
      let v = 0;
      for (const ch of chans) v += ch[Math.floor(k * step)];
      data[k] = v / chans.length;
    }
    const at = Math.round(timestamp * 16000);
    parts.push({ at, data });
    length = Math.max(length, at + n);
  }
  const all = new Float32Array(length);
  for (const p of parts) if (p.at >= 0) all.set(p.data.subarray(0, Math.max(0, length - p.at)), p.at);
  return all;
}
