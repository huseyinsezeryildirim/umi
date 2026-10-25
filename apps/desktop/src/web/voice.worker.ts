// AI voiceover in the browser: Kokoro-82M with the af_heart voice (the Mac app's voice), in a
// worker. The model (~90 MB) downloads once from Hugging Face and the browser keeps it cached.
import { KokoroTTS } from "kokoro-js";

type In = { text: string; speed: number };
export type Out = { type: "loading"; progress: number } | { type: "done"; audio: Float32Array; rate: number } | { type: "error"; message: string };

const MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";
let tts: Promise<KokoroTTS> | null = null;
const post = (m: Out, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);

async function load() {
  const files = new Map<string, number>();
  const gpu = "gpu" in navigator && !!(await (navigator as Navigator & { gpu: { requestAdapter(): Promise<unknown> } }).gpu.requestAdapter().catch(() => null));
  return KokoroTTS.from_pretrained(MODEL, {
    dtype: gpu ? "fp32" : "q8",
    device: gpu ? "webgpu" : "wasm",
    progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
      if (p.status === "progress" && p.file && p.total) {
        files.set(p.file, (p.loaded ?? 0) / p.total);
        post({ type: "loading", progress: [...files.values()].reduce((a, b) => a + b, 0) / Math.max(files.size, 1) });
      }
    },
  });
}

self.onmessage = async (e: MessageEvent<In>) => {
  try {
    tts ??= load();
    const voice = await tts;
    const out = await voice.generate(e.data.text, { voice: "af_heart", speed: e.data.speed });
    const audio = out.audio as Float32Array;
    post({ type: "done", audio, rate: out.sampling_rate }, [audio.buffer]);
  } catch (err) {
    post({ type: "error", message: (err as Error).message || "Couldn't make the voiceover." });
  }
};
