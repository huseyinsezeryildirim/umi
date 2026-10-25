// Face framing in the browser: MediaPipe's face detector finds the face 5 times a second and
// its smoothed path is saved like the Mac app's camera-face.json ({t, x, y, size}, 0…1).
// The runtime and the small model (~230 KB) load on first use.
import { FaceDetector, FilesetResolver } from "@mediapipe/tasks-vision";
import { ALL_FORMATS, BlobSource, CanvasSink, Input } from "mediabunny";

const WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/wasm";
const MODEL = "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite";

export type FaceKey = { t: number; x: number; y: number; size: number };

let loading: Promise<FaceDetector> | null = null;
function detector() {
  loading ??= (async () => {
    const files = await FilesetResolver.forVisionTasks(WASM);
    const make = (delegate: "GPU" | "CPU") => FaceDetector.createFromOptions(files, { baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: "IMAGE" });
    return make("GPU").catch(() => make("CPU"));
  })();
  return loading;
}

export async function trackFace(camera: Blob, progress: (stage: "download" | "process", p: number) => void): Promise<FaceKey[]> {
  progress("download", 0);
  const faces = await detector();
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(camera) });
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error("This recording has no camera.");
  const duration = await track.computeDuration();
  const start = await track.getFirstTimestamp();
  const times: number[] = [];
  for (let t = start; t < start + duration; t += 0.2) times.push(t);
  const width = Math.min(640, track.displayWidth);
  const height = Math.round((width * track.displayHeight) / track.displayWidth);
  const keys: FaceKey[] = [];
  let i = 0;
  for await (const frame of new CanvasSink(track, { width, height, fit: "fill", poolSize: 1 }).canvasesAtTimestamps(times)) {
    const t = times[i++];
    if (frame) {
      const found = faces.detect(frame.canvas as HTMLCanvasElement).detections;
      // The biggest face is the speaker.
      const box = found.map((d) => d.boundingBox!).filter(Boolean).sort((a, b) => b.width * b.height - a.width * a.height)[0];
      if (box) {
        const raw = { t: t - start, x: (box.originX + box.width / 2) / width, y: (box.originY + box.height / 2) / height, size: box.height / height };
        // Ease toward each detection so the framing glides instead of twitching.
        const p = keys[keys.length - 1];
        keys.push(p ? { t: raw.t, x: p.x + (raw.x - p.x) * 0.5, y: p.y + (raw.y - p.y) * 0.5, size: p.size + (raw.size - p.size) * 0.3 } : raw);
      }
    }
    progress("process", Math.min(0.99, i / times.length));
  }
  progress("process", 1);
  return keys;
}
