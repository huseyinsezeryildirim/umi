// Camera background in the browser: MediaPipe's selfie segmenter finds the person, then the
// room is blurred or cut away (what the Mac app makes once as camera-blur / camera-matte).
// The runtime and the small model (~250 KB) load on first use.
import { FilesetResolver, ImageSegmenter } from "@mediapipe/tasks-vision";

// Served from Umi's own site (copied at build, see vite.config.ts), so no other server sees viewers.
const WASM = `${import.meta.env.BASE_URL}mediapipe`;
const MODEL = new URL("./models/selfie_segmenter.tflite", import.meta.url).href;

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

type Layers = { w: number; h: number; person: OffscreenCanvas; mask: OffscreenCanvas; out: OffscreenCanvas };
let layers: Layers | null = null;

/**
 * The camera frame with its background blurred ("blur") or removed ("remove": the person on
 * transparency), at most 640 px wide. Null until the segmenter has loaded.
 */
export function cameraEffect(src: CanvasImageSource, srcW: number, srcH: number, mode: "blur" | "remove"): OffscreenCanvas | null {
  if (!ready) {
    void loadSegmenter();
    return null;
  }
  const k = Math.min(1, 640 / srcW);
  const w = Math.max(2, Math.round(srcW * k));
  const h = Math.max(2, Math.round(srcH * k));
  if (!layers || layers.w !== w || layers.h !== h) layers = { w, h, person: new OffscreenCanvas(w, h), mask: new OffscreenCanvas(w, h), out: new OffscreenCanvas(w, h) };
  const { person, mask, out } = layers;
  const p = person.getContext("2d")!;
  p.globalCompositeOperation = "source-over";
  p.drawImage(src, 0, 0, w, h);

  // Timestamps must only go up, whichever video (preview or export) is being drawn.
  clock = Math.max(clock + 1, Math.round(performance.now()));
  const result = ready.segmentForVideo(person, clock);
  const conf = result.confidenceMasks?.[0];
  if (!conf) {
    result.close();
    return null;
  }
  const data = conf.getAsFloat32Array();
  const alpha = new ImageData(conf.width, conf.height);
  for (let i = 0; i < data.length; i++) alpha.data[i * 4 + 3] = Math.round(Math.min(1, Math.max(0, (data[i] - 0.3) / 0.4)) * 255);
  if (mask.width !== conf.width || mask.height !== conf.height) {
    mask.width = conf.width;
    mask.height = conf.height;
  }
  result.close();
  mask.getContext("2d")!.putImageData(alpha, 0, 0);

  const o = out.getContext("2d")!;
  o.globalCompositeOperation = "source-over";
  o.clearRect(0, 0, w, h);
  if (mode === "blur") {
    o.filter = `blur(${Math.round(Math.min(w, h) * 0.035)}px)`;
    o.drawImage(person, 0, 0);
    o.filter = "none";
  }
  // The person, cut out with the (softened) mask, on top.
  p.globalCompositeOperation = "destination-in";
  p.filter = `blur(${Math.max(1, Math.round(Math.min(w, h) * 0.004))}px)`;
  p.drawImage(mask, 0, 0, w, h);
  p.filter = "none";
  p.globalCompositeOperation = "source-over";
  o.drawImage(person, 0, 0);
  return out;
}
