// Speech to text in the browser: Whisper (base, with word timings), on the GPU when there is one.
// The model (~80 MB) downloads once from Hugging Face and the browser keeps it cached.
import { type AutomaticSpeechRecognitionPipeline, pipeline } from "@huggingface/transformers";

/** `language`: a Whisper language name or code; empty lets Whisper detect it. */
type In = { audio: Float32Array; language?: string };
export type Out =
  | { type: "loading"; progress: number }
  | { type: "working"; progress: number }
  | { type: "done"; words: { text: string; start: number; end: number }[] }
  | { type: "error"; message: string };

const MODEL = "onnx-community/whisper-base_timestamped";
let asr: Promise<AutomaticSpeechRecognitionPipeline> | null = null;

const post = (m: Out) => (self as unknown as Worker).postMessage(m);

async function load(): Promise<AutomaticSpeechRecognitionPipeline> {
  const files = new Map<string, number>();
  const progress_callback = (p: { status: string; file?: string; loaded?: number; total?: number }) => {
    if (p.status === "progress" && p.file && p.total) {
      files.set(p.file, (p.loaded ?? 0) / p.total);
      post({ type: "loading", progress: [...files.values()].reduce((a, b) => a + b, 0) / Math.max(files.size, 1) });
    }
  };
  const gpu = "gpu" in navigator && !!(await (navigator as Navigator & { gpu: { requestAdapter(): Promise<unknown> } }).gpu.requestAdapter().catch(() => null));
  return (await pipeline("automatic-speech-recognition", MODEL, {
    device: gpu ? "webgpu" : "wasm",
    dtype: gpu ? { encoder_model: "fp32", decoder_model_merged: "q4" } : "q8",
    progress_callback,
  })) as AutomaticSpeechRecognitionPipeline;
}

self.onmessage = async (e: MessageEvent<In>) => {
  try {
    asr ??= load();
    const run = await asr;
    const { audio, language } = e.data;
    const words: { text: string; start: number; end: number }[] = [];
    // 30-second pieces, so progress shows and long recordings don't hold everything at once.
    const piece = 16000 * 30;
    for (let at = 0; at < audio.length; at += piece) {
      post({ type: "working", progress: at / audio.length });
      const part = audio.subarray(at, Math.min(audio.length, at + piece));
      if (part.length < 1600) continue;
      const out = (await run(part, { return_timestamps: "word", ...(language ? { language } : {}) })) as { chunks?: { text: string; timestamp: [number, number | null] }[] };
      const offset = at / 16000;
      for (const c of out.chunks ?? []) {
        const text = c.text.trim();
        if (!text) continue;
        const start = offset + c.timestamp[0];
        words.push({ text, start, end: offset + (c.timestamp[1] ?? c.timestamp[0] + 0.3) });
      }
    }
    post({ type: "done", words });
  } catch (err) {
    post({ type: "error", message: (err as Error).message || "Transcription failed." });
  }
};
