// Camera without the room, in the browser: MediaPipe's selfie segmenter finds the person, and the
// background is blurred or replaced. The runtime and the small model (~250 KB) load on first use.
import { FilesetResolver, ImageSegmenter } from "@mediapipe/tasks-vision";

const WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/wasm";
const MODEL = "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite";

export type CameraBackground = "none" | "blur" | "remove";

let loading: Promise<ImageSegmenter> | null = null;
let ready: ImageSegmenter | null = null;
let clock = 0;

/** Starts loading the segmenter; resolves once it can be used. */
export function loadSegmenter(): Promise<ImageSegmenter> {
  loading ??= (async () => {
    const files = await FilesetResolver.forVisionTasks(WASM);
    const make = (delegate: "GPU" | "CPU") =>
      ImageSegmenter.createFromOptions(files, { baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: "VIDEO", outputConfidenceMasks: true, outputCategoryMask: false });
    ready = await make("GPU").catch(() => make("CPU"));
    return ready;
  })();
  return loading;
}

type Layers = { size: number; person: OffscreenCanvas; mask: OffscreenCanvas; out: OffscreenCanvas };
let layers: Layers | null = null;

/**
 * The camera's square centre with its background blurred or removed, `size` pixels across.
 * Returns null until the segmenter has loaded (callers draw the plain camera meanwhile).
 */
export function cameraWithBackground(src: CanvasImageSource, srcW: number, srcH: number, size: number, mode: CameraBackground, fill = "#e8edf5"): OffscreenCanvas | null {
  if (mode === "none" || !ready) return null;
  if (!layers || layers.size !== size) layers = { size, person: new OffscreenCanvas(size, size), mask: new OffscreenCanvas(size, size), out: new OffscreenCanvas(size, size) };
  const { person, mask, out } = layers;
  const s = Math.min(srcW, srcH);
  const p = person.getContext("2d")!;
  p.globalCompositeOperation = "source-over";
  p.drawImage(src, (srcW - s) / 2, (srcH - s) / 2, s, s, 0, 0, size, size);

  // Timestamps must only go up, whichever video (preview or export) is being drawn.
  clock = Math.max(clock + 1, Math.round(performance.now()));
  const result = ready.segmentForVideo(person, clock);
  const conf = result.confidenceMasks?.[0];
  if (!conf) {
    result.close();
    return null;
  }
  const data = conf.getAsFloat32Array();
  const mw = conf.width;
  const mh = conf.height;
  const alpha = new ImageData(mw, mh);
  for (let i = 0; i < data.length; i++) alpha.data[i * 4 + 3] = Math.round(Math.min(1, Math.max(0, (data[i] - 0.3) / 0.4)) * 255);
  result.close();
  const m = mask.getContext("2d")!;
  if (mask.width !== mw || mask.height !== mh) {
    mask.width = mw;
    mask.height = mh;
  }
  m.putImageData(alpha, 0, 0);

  const o = out.getContext("2d")!;
  o.globalCompositeOperation = "source-over";
  o.filter = "none";
  if (mode === "blur") {
    o.filter = `blur(${Math.round(size * 0.035)}px)`;
    o.drawImage(person, 0, 0);
    o.filter = "none";
  } else {
    o.fillStyle = fill;
    o.fillRect(0, 0, size, size);
  }
  // The person, cut out with the (softened) mask, on top.
  p.globalCompositeOperation = "destination-in";
  p.filter = `blur(${Math.max(1, Math.round(size * 0.004))}px)`;
  p.drawImage(mask, 0, 0, size, size);
  p.filter = "none";
  p.globalCompositeOperation = "source-over";
  o.drawImage(person, 0, 0);
  return out;
}
