import { invoke } from "@tauri-apps/api/core";

const RATE = 48000;
/** Seconds per chunk asked from Rust, and how far ahead of the clock to keep. */
const CHUNK = 0.5;
const AHEAD = 0.9;

/**
 * Plays the edit's soundtrack (mixed in Rust exactly like export) while previewing, and
 * serves as the playback clock so picture and sound stay together.
 */
export function createAudioPlayer(editorId: () => string) {
  let ctx: AudioContext | null = null;
  let session = 0;
  let sources: AudioBufferSourceNode[] = [];
  let startAt = 0;
  let startTime = 0;

  const context = () => {
    ctx ??= new AudioContext({ sampleRate: RATE, latencyHint: "interactive" });
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  };

  const stop = () => {
    session++;
    for (const s of sources) {
      try {
        s.stop();
      } catch {
        // Already ended.
      }
    }
    sources = [];
  };

  /** Starts playing at output time `t`; `end` is where the video ends. */
  const start = (t: number, end: number) => {
    stop();
    const ac = context();
    const mine = session;
    startAt = ac.currentTime + 0.06;
    startTime = t;
    let nextTime = t;
    let nextAt = startAt;
    let fetching = false;

    const pump = async () => {
      if (mine !== session || fetching || nextTime >= end) return;
      fetching = true;
      try {
        while (mine === session && nextTime < end && nextAt - ac.currentTime < AHEAD) {
          const seconds = Math.min(CHUNK, end - nextTime);
          const bytes = await invoke<ArrayBuffer>("editor_audio", { id: editorId(), time: nextTime, seconds });
          if (mine !== session) return;
          const samples = new Float32Array(bytes);
          const frames = samples.length / 2;
          if (frames > 0) {
            const buffer = ac.createBuffer(2, frames, RATE);
            const left = buffer.getChannelData(0);
            const right = buffer.getChannelData(1);
            for (let i = 0; i < frames; i++) {
              left[i] = samples[2 * i];
              right[i] = samples[2 * i + 1];
            }
            const node = ac.createBufferSource();
            node.buffer = buffer;
            node.connect(ac.destination);
            // A late chunk starts part-way in so sound stays on the clock.
            const late = ac.currentTime - nextAt;
            if (late > 0) node.start(ac.currentTime, Math.min(late, buffer.duration));
            else node.start(nextAt);
            node.onended = () => (sources = sources.filter((s) => s !== node));
            sources.push(node);
          }
          nextTime += seconds;
          nextAt += seconds;
        }
      } catch (e) {
        console.warn("audio", e);
      } finally {
        fetching = false;
      }
    };
    void pump();
    const timer = window.setInterval(() => (mine === session ? void pump() : window.clearInterval(timer)), 120);
  };

  /** Output time now, by the audio clock. */
  const clock = () => (ctx ? startTime + Math.max(0, ctx.currentTime - startAt) : startTime);

  return { start, stop, clock };
}
