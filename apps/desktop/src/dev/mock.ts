// A stand-in for the Rust side so the UI runs in a plain browser: design reviews, UI tests
// and the interactive demo on the website. Frames are Umi renders of a made-up dashboard
// recording (no personal content).
import { emit } from "@tauri-apps/api/event";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import frame1 from "./frame-1.jpg";
import frame4 from "./frame-4.jpg";
import frame8 from "./frame-8.jpg";
import screenA from "./screen-a.jpg";
import screenB from "./screen-b.jpg";
import cameraFace from "./camera.jpg";
import cameraClip from "./camera.mp4";
import { GRADIENTS } from "../editor/panels/Background";
import { windowsDesk } from "./os";
import fixture from "./state.json";
import music from "../../src-tauri/resources/music.json";
import { maskRectAt, sourceTimeAt, type Clip, type EditorState, type EditSettings, type Selection } from "../editor/types";
import { isFiller } from "../editor/panels/Captions";

const frames: [number, string][] = [
  [1, frame1],
  [2.6, frame4],
  [6.2, frame8],
];
/** The raw screen of the sample recording (before 6 s, after the share popover opens). */
const screens: [number, string][] = [
  [0, screenA],
  [6, screenB],
];
/** What the narrator of the sample recording says. */
const SAMPLE_WORDS = (() => {
  // `?fillers`: the take as it was really said, ums and all (for the "cut the ums" demo).
  const text = new URLSearchParams(location.search).has("fillers")
    ? "So um here’s the new dashboard. Uh open any card to see more. This week is um our best one yet. To share it, click Share and copy the link."
    : "Here’s the new dashboard. Open any card to see more. This week is our best one yet. To share it, click Share and copy the link.";
  const words = text.split(" ");
  const start = 0.3;
  const step = 9.2 / words.length;
  return words.map((w, i) => ({ id: `W${i}`, start: start + i * step, end: start + (i + 0.85) * step, text: w }));
})();

/** Where the cursor was (0…1 of the screen) — the same path the sample recording used. */
const CURSOR_KEYS: [number, number, number][] = [
  [0, 0.55, 0.62],
  [1.6, 0.34, 0.25],
  [2.6, 0.36, 0.27],
  [3.8, 0.6, 0.55],
  [5.2, 0.915, 0.11],
  [6.6, 0.9, 0.13],
  [8.5, 0.7, 0.5],
  [10, 0.68, 0.52],
];
function cursorAt(t: number): [number, number] {
  for (let i = 0; i < CURSOR_KEYS.length - 1; i++) {
    const [t0, x0, y0] = CURSOR_KEYS[i];
    const [t1, x1, y1] = CURSOR_KEYS[i + 1];
    if (t >= t0 && t <= t1) {
      let k = (t - t0) / (t1 - t0);
      k = k * k * (3 - 2 * k);
      return [x0 + (x1 - x0) * k, y0 + (y1 - y0) * k];
    }
  }
  const last = CURSOR_KEYS[CURSOR_KEYS.length - 1];
  return [last[1], last[2]];
}
const images = new Map<string, HTMLImageElement>();
const loaded = Promise.all(
  [...frames, ...screens, [0, cameraFace] as [number, string]].map(
    ([, url]) =>
      new Promise<void>((done) => {
        const img = new Image();
        img.onload = () => done();
        img.onerror = () => done();
        img.src = url;
        images.set(url, img);
      }),
  ),
);

/** The webcam: a looping stock clip (Pexels), drawn in the camera bubble. */
const webcam = Object.assign(document.createElement("video"), { src: cameraClip, muted: true, loop: true, playsInline: true, autoplay: true });
void webcam.play().catch(() => {});

let state: EditorState = {
  id: "fixture",
  name: "Product demo",
  canUndo: false,
  canRedo: false,
  selection: null,
  ...(fixture as unknown as Omit<EditorState, "id" | "name" | "canUndo" | "canRedo" | "selection">),
};
{
  state = structuredClone(state);
  // The sample recording's zooms (its clicks at 2.0 s and 5.6 s).
  state.zoomSegments = [
    { id: "Z1", start: 1.2, end: 3.6, scale: 1.8 },
    { id: "Z2", start: 4.9, end: 7.8, scale: 2 },
  ];
  state.recording.duration = 10;
  // The guided demo transcribes during the tour; screenshots start with captions.
  const touring = new URLSearchParams(location.search).has("tour");
  state.edit.captions = { ...state.edit.captions, enabled: !touring, words: touring ? [] : SAMPLE_WORDS, language: "en" };
  state.name = "Dashboard walkthrough";
  state.recording.hasCamera = true;
  state.edit.camera = { ...state.edit.camera, visible: true, shape: "circle", position: [0.9, 0.82], mirrored: false };
}
let demoCameraVisible = true;
let recordSettings = {
  target: null,
  fps: 60,
  resolution: "native",
  systemAudio: true,
  microphone: "",
  camera: null,
  // The website's desktop demo asks the visitor to turn the camera on.
  cameraOn: new URLSearchParams(location.search).get("view") !== "desktop",
  cameraStyle: { visible: true, shape: "circle", size: 0.24, position: [0.14, 0.8], mirrored: true },
  countdown: true,
  flow: "studio",
  cameraOnly: false,
};
/** The camera preview: frames of the stock webcam clip, as JPEG, like the real camera sends. */
let previewTimer = 0;
function cameraPreview(camera: string | null, frames: { onmessage: (b: ArrayBuffer) => void }) {
  clearInterval(previewTimer);
  if (camera === null) return null;
  const canvas = new OffscreenCanvas(320, 320);
  const ctx = canvas.getContext("2d")!;
  void webcam.play().catch(() => {});
  previewTimer = window.setInterval(() => {
    if (webcam.readyState < 2) return;
    const s = Math.min(webcam.videoWidth, webcam.videoHeight);
    ctx.drawImage(webcam, (webcam.videoWidth - s) / 2, (webcam.videoHeight - s) / 2, s, s, 0, 0, 320, 320);
    void canvas.convertToBlob({ type: "image/jpeg", quality: 0.8 }).then((b) => b.arrayBuffer().then((buf) => frames.onmessage(buf)));
  }, 1000 / 24);
  return null;
}

/** A drawing from the desktop chapter (see desktop.tsx): points are 0…1 of the app's screen. */
/** `from`/`until`: seconds into the demo recording the pen went down and lifted. */
export type DemoStroke = { tool: string; color: string; points: [number, number][]; width: number; from: number; until: number };
const stored = <T>(key: string, fallback: T): T => {
  try {
    return JSON.parse(sessionStorage.getItem(key) ?? "null") ?? fallback;
  } catch {
    return fallback;
  }
};
/**
 * The visitor's recording on the demo desktop maps onto the sample one: at its own times when it
 * fits, squeezed to the sample's length when it was longer.
 */
const demoScale = Math.min(1, state.recording.duration / stored("umi.demo.length", state.recording.duration));
/** What the visitor drew while recording, so the editor shows it when they drew it. */
const demoInk: DemoStroke[] = stored<DemoStroke[]>("umi.demo.ink", []).filter((s) => typeof s.from === "number");
/** Like the real drawing: a stroke stays this long after the pen lifts, then fades (Ink.tsx). */
const INK_HOLD = 2.5;
const INK_FADE = 0.6;
{
  // The layouts picked while recording: each one a scene until the next pick (or the end).
  const picks = stored<{ at: number; layout: string }[]>("umi.demo.layouts", []);
  if (new URLSearchParams(location.search).has("open")) {
    const end = state.recording.duration;
    state.edit.scenes = picks
      .map((p, i) => ({ id: crypto.randomUUID().toUpperCase(), start: p.at * demoScale, end: i + 1 < picks.length ? picks[i + 1].at * demoScale : end, layout: p.layout, transition: 0.5 }))
      .filter((sc) => sc.layout !== "default" && sc.end - sc.start > 0.2) as EditSettings["scenes"];
  }
}

/** The visitor's drawings on the sample screen (`w`×`h`), shown for a few seconds, then fading. */
function drawInk(g: OffscreenCanvasRenderingContext2D, time: number, w: number, h: number) {
  g.save();
  g.lineCap = "round";
  g.lineJoin = "round";
  for (const s of demoInk) {
    const [from, until] = [s.from * demoScale, s.until * demoScale];
    const alpha = time < from ? 0 : 1 - Math.min(1, Math.max(0, (time - until - INK_HOLD) / INK_FADE));
    if (alpha <= 0) continue;
    const p = s.points.map(([px, py]) => [px * w, py * h] as [number, number]);
    if (!p.length) continue;
    const k = w / s.width;
    g.strokeStyle = s.color;
    g.lineWidth = 5 * k;
    g.save();
    g.globalAlpha *= alpha;
    if (s.tool === "highlighter") {
      g.globalAlpha *= 0.35;
      g.lineWidth = 22 * k;
    }
    g.beginPath();
    if (s.tool === "box") {
      const [[ax, ay], [bx, by]] = [p[0], p[p.length - 1]];
      g.roundRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay), 10 * k);
    } else if (s.tool === "arrow") {
      const [[ax, ay], [bx, by]] = [p[0], p[p.length - 1]];
      const angle = Math.atan2(by - ay, bx - ax);
      const head = Math.min(26 * k, 10 * k + Math.hypot(bx - ax, by - ay) * 0.12);
      g.moveTo(ax, ay);
      g.lineTo(bx, by);
      g.moveTo(bx - head * Math.cos(angle - 0.5), by - head * Math.sin(angle - 0.5));
      g.lineTo(bx, by);
      g.lineTo(bx - head * Math.cos(angle + 0.5), by - head * Math.sin(angle + 0.5));
    } else {
      g.moveTo(p[0][0], p[0][1]);
      for (const [px, py] of p.slice(1)) g.lineTo(px, py);
    }
    g.stroke();
    g.restore();
  }
  g.restore();
}

const history: EditSettings[] = [];
const future: EditSettings[] = [];
const uuid = () => crypto.randomUUID().toUpperCase();

/** A window's title bar over the screen: traffic lights, Windows' buttons, or a browser's address bar. */
function drawTitleBar(g: OffscreenCanvasRenderingContext2D, frame: string, x: number, y: number, w: number, bar: number, radius: number, alpha: number) {
  g.save();
  g.globalAlpha = alpha;
  g.beginPath();
  g.roundRect(x, y, w, bar, [radius, radius, 0, 0]);
  g.fillStyle = frame === "windows" ? "#f3f3f3" : frame === "browser" ? "#e8eaed" : "#ececec";
  g.fill();
  const mid = y + bar / 2;
  const r = bar * 0.16;
  if (frame === "windows") {
    // Minimise, maximise, close on the right.
    g.strokeStyle = "#333";
    g.lineWidth = Math.max(1, bar * 0.04);
    const s = bar * 0.16;
    const cx = [x + w - bar * 2.6, x + w - bar * 1.6, x + w - bar * 0.6];
    g.beginPath();
    g.moveTo(cx[0] - s, mid);
    g.lineTo(cx[0] + s, mid);
    g.rect(cx[1] - s, mid - s, s * 2, s * 2);
    g.moveTo(cx[2] - s, mid - s);
    g.lineTo(cx[2] + s, mid + s);
    g.moveTo(cx[2] + s, mid - s);
    g.lineTo(cx[2] - s, mid + s);
    g.stroke();
  } else {
    ["#ff5f57", "#febc2e", "#28c840"].forEach((c, i) => {
      g.beginPath();
      g.arc(x + bar * 0.5 + i * r * 3.2, mid, r, 0, Math.PI * 2);
      g.fillStyle = c;
      g.fill();
    });
    if (frame === "browser") {
      g.beginPath();
      g.roundRect(x + w * 0.25, mid - bar * 0.28, w * 0.5, bar * 0.56, bar * 0.28);
      g.fillStyle = "#fff";
      g.fill();
    }
  }
  g.restore();
}

/**
 * A small stand-in renderer: the sample screen on the edit's background with its padding,
 * corners, shadow, zooms and cursor, so changes in the demo show up at once.
 */
function frameAt(output: number, boxWidth: number, boxHeight: number): ArrayBuffer {
  const edit = state.edit;
  // The canvas' shape (Auto: the recording's 16:10), as large as fits the stage.
  const ratio = ({ wide: 16 / 9, vertical: 9 / 16, square: 1, classic: 4 / 3, portrait: 4 / 5 } as Record<string, number>)[edit.aspect] ?? 1.6;
  const width = Math.round(Math.min(boxWidth, boxHeight * ratio));
  const height = Math.round(Math.min(boxHeight, boxWidth / ratio));
  // Everything below is in recording time, like the Rust renderer.
  const time = sourceTimeAt(state.placements, output);
  const canvas = new OffscreenCanvas(width, height);
  const g = canvas.getContext("2d")!;
  const screen = images.get(screens.reduce((best, s) => (time >= s[0] ? s : best), screens[0])[1])!;

  // Background.
  const b = edit.background as Record<string, { _0: unknown }>;
  if ("color" in b) {
    const c = b.color._0 as { r: number; g: number; b: number };
    g.fillStyle = `rgb(${c.r * 255},${c.g * 255},${c.b * 255})`;
  } else {
    const [from, to] = GRADIENTS[("gradient" in b ? b.gradient._0 : "sky") as keyof typeof GRADIENTS] ?? GRADIENTS.sky;
    const a = ((edit.backgroundAngle ?? 135) - 90) * (Math.PI / 180);
    const r = Math.hypot(width, height) / 2;
    const grad = g.createLinearGradient(width / 2 - Math.cos(a) * r, height / 2 - Math.sin(a) * r, width / 2 + Math.cos(a) * r, height / 2 + Math.sin(a) * r);
    grad.addColorStop(0, from);
    grad.addColorStop(1, to);
    g.fillStyle = grad;
  }
  g.fillRect(0, 0, width, height);
  if ("blurredScreen" in b) {
    g.filter = "blur(24px) brightness(0.8)";
    g.drawImage(screen, -40, -40, width + 80, height + 80);
    g.filter = "none";
  }

  // The screen, inset by the padding and kept 16:10.
  const pad = edit.padding * Math.min(width, height) * 1.6;
  let w = width - pad * 2;
  let h = w / 1.6;
  if (h > height - pad * 2) {
    h = height - pad * 2;
    w = h * 1.6;
  }
  // A window frame adds a title bar above the screen (the Mac, Windows or a browser's).
  const barK = edit.frame === "macOS" || edit.frame === "windows" || edit.frame === "browser" ? 0.07 : 0;
  w /= 1 + barK;
  h /= 1 + barK;
  let x = (width - w) / 2;
  let y = (height - h * (1 + barK)) / 2 + h * barK;
  const radius = edit.cornerRadius * Math.min(w, h) * 0.9;

  // A scene (side by side, camera only, screen only) eases in and out over its transition.
  const scene = edit.scenes.find((sc) => time >= sc.start && time <= sc.end);
  const tr = Math.max(scene?.transition ?? 0.4, 0.01);
  const k = scene ? Math.min(1, (time - scene.start) / tr, (scene.end - time) / tr) : 0;
  const ease = k * k * (3 - 2 * k);
  const lerp = (a: number, b: number) => a + (b - a) * ease;
  /** Where the camera goes in this scene (null: it stays the bubble). */
  let cameraRect: [number, number, number, number] | null = null;
  if (scene?.layout === "splitScreen") {
    // The screen on the left, the camera beside it, both the same height.
    const gap = pad * 0.6;
    const sw = (width - pad * 2 - gap) * 0.64;
    const sh = Math.min(sw / 1.6, height - pad * 2);
    const sx = pad;
    const sy = (height - sh) / 2;
    cameraRect = [sx + sw + gap, sy, width - pad - (sx + sw + gap), sh];
    [x, y, w, h] = [lerp(x, sx), lerp(y, sy), lerp(w, sw), lerp(h, sh)];
  } else if (scene?.layout === "cameraOnly") {
    cameraRect = [x, y, w, h];
  }
  const screenAlpha = scene?.layout === "cameraOnly" ? 1 - ease : 1;
  const cameraAlpha = scene?.layout === "hideCamera" ? 1 - ease : 1;

  // Zoom: eased in and out over 0.6 s toward the cursor.
  const seg = state.zoomSegments.find((z) => time >= z.start && time <= z.end);
  let scale = 1;
  let [fx, fy] = cursorAt(time);
  if (seg) {
    const ease = (v: number) => 1 - Math.pow(1 - Math.min(Math.max(v, 0), 1), 3);
    const k = Math.min(ease((time - seg.start) / 0.6), ease((seg.end - time) / 0.6));
    scale = 1 + (seg.scale - 1) * k;
    if (seg.focus) [fx, fy] = seg.focus;
  }

  const bar = h * barK;
  g.save();
  g.globalAlpha = screenAlpha;
  g.shadowColor = `rgba(0,0,0,${0.45 * edit.shadow})`;
  g.shadowBlur = 50 * edit.shadow;
  g.shadowOffsetY = 18 * edit.shadow;
  g.beginPath();
  g.roundRect(x, y - bar, w, h + bar, radius);
  g.fillStyle = "#fff";
  g.fill();
  g.restore();
  if (bar) drawTitleBar(g, edit.frame, x, y - bar, w, bar, radius, screenAlpha);
  g.save();
  g.globalAlpha = screenAlpha;
  g.beginPath();
  g.roundRect(x, y, w, h, bar ? [0, 0, radius, radius] : radius);
  g.clip();
  // Keep the zoomed view inside the screen's edges.
  const vw = w / scale;
  const vh = h / scale;
  const sx = Math.min(Math.max(fx * w - vw / 2, 0), w - vw);
  const sy = Math.min(Math.max(fy * h - vh / 2, 0), h - vh);
  g.translate(x, y);
  g.scale(scale, scale);
  g.translate(-sx, -sy);
  if (screen.complete) g.drawImage(screen, 0, 0, w, h);
  // What the visitor drew on the desktop: on the screen, a few seconds, then fading.
  drawInk(g, time, w, h);
  // Privacy masks: blur, pixelate, or dim everything but the highlighted spot.
  for (const m of edit.masks) {
    if (time < m.start || time > m.end) continue;
    const [[rx, ry], [rw, rh]] = maskRectAt(m, time);
    const [mx, my, mw, mh] = [rx * w, ry * h, rw * w, rh * h];
    g.save();
    if (m.style === "highlight") {
      g.beginPath();
      g.rect(-w, -h, w * 3, h * 3);
      g.roundRect(mx, my, mw, mh, 8);
      g.fillStyle = `rgba(10,12,20,${0.25 + m.amount * 0.5})`;
      g.fill("evenodd");
    } else {
      g.beginPath();
      g.roundRect(mx, my, mw, mh, 6);
      g.clip();
      if (m.style === "blur") {
        g.filter = `blur(${4 + m.amount * 16}px)`;
        g.drawImage(screen, 0, 0, w, h);
      } else {
        const cells = Math.max(4, Math.round(30 - m.amount * 24));
        const tiny = new OffscreenCanvas(cells, Math.max(2, Math.round((cells * mh) / mw)));
        const t = tiny.getContext("2d")!;
        t.drawImage(screen, (mx / w) * screen.naturalWidth, (my / h) * screen.naturalHeight, (mw / w) * screen.naturalWidth, (mh / h) * screen.naturalHeight, 0, 0, tiny.width, tiny.height);
        g.imageSmoothingEnabled = false;
        g.drawImage(tiny, mx, my, mw, mh);
      }
    }
    g.restore();
  }
  // Cursor.
  if (edit.cursor.visible) {
    const [cx, cy] = cursorAt(time);
    const size = (w / 60) * (edit.cursor.size || 1);
    g.translate(cx * w, cy * h);
    g.scale(size / 24, size / 24);
    g.fillStyle = "#000";
    g.strokeStyle = "#fff";
    g.lineWidth = 1.6;
    g.lineJoin = "round";
    const p = new Path2D("M5 3l14 7.5-6.2 1.6L10 18.5z");
    g.translate(-5, -3);
    g.stroke(p);
    g.fill(p);
  }
  g.restore();

  // Camera bubble (a stock portrait stands in for the webcam).
  const cam = edit.camera;
  const face = images.get(cameraFace);
  if (cam.visible && face?.complete && cameraAlpha > 0) {
    const d = Math.min(width, height) * (cam.size || 0.22) * 0.85;
    const [px, py] = cam.position ?? [0.9, 0.82];
    const bx = Math.min(Math.max(px * width, d / 2 + 8), width - d / 2 - 8) - d / 2;
    const by = Math.min(Math.max(py * height, d / 2 + 8), height - d / 2 - 8) - d / 2;
    const br = cam.shape === "circle" ? d / 2 : cam.shape === "squircle" ? d * 0.28 : d * 0.08;
    // The bubble, or (in a scene) on its way to the scene's panel.
    const [cx, cy, cw, ch] = cameraRect ? [lerp(bx, cameraRect[0]), lerp(by, cameraRect[1]), lerp(d, cameraRect[2]), lerp(d, cameraRect[3])] : [bx, by, d, d];
    const r = cameraRect ? lerp(br, radius) : br;
    g.save();
    g.globalAlpha = cameraAlpha;
    g.shadowColor = "rgba(0,0,0,0.35)";
    g.shadowBlur = Math.min(cw, ch) * 0.12;
    g.shadowOffsetY = Math.min(cw, ch) * 0.04;
    g.beginPath();
    g.roundRect(cx - 3, cy - 3, cw + 6, ch + 6, r + 3);
    g.fillStyle = "#fff";
    g.fill();
    g.restore();
    g.save();
    g.globalAlpha = cameraAlpha;
    g.beginPath();
    g.roundRect(cx, cy, cw, ch, r);
    g.clip();
    if (cam.mirrored) {
      g.translate((cx + cw / 2) * 2, 0);
      g.scale(-1, 1);
    }
    // Cover the panel: crop the webcam to its shape.
    const src = webcam.readyState >= 2 ? webcam : face;
    const [iw, ih] = src instanceof HTMLVideoElement ? [src.videoWidth, src.videoHeight] : [src.naturalWidth, src.naturalHeight];
    const scale = Math.max(cw / iw, ch / ih);
    g.drawImage(src, cx + (cw - iw * scale) / 2, cy + (ch - ih * scale) / 2, iw * scale, ih * scale);
    g.restore();
  }

  // Captions: the current line, the spoken word bright.
  const caps = edit.captions;
  if (caps.enabled && caps.words.length) {
    const i = caps.words.findIndex((w) => time >= w.start && time <= w.end + 0.25);
    if (i >= 0) {
      const from = Math.floor(i / 6) * 6;
      const line = caps.words.slice(from, from + 6);
      const size = Math.round(height * (caps.size || 0.045));
      g.font = `600 ${size}px -apple-system, "SF Pro Text", sans-serif`;
      const gap = size * 0.3;
      const widths = line.map((w) => g.measureText(w.text).width);
      const total = widths.reduce((a, b) => a + b, 0) + gap * (line.length - 1);
      const py = height * (caps.position ?? 0.88);
      const px = (width - total) / 2;
      g.fillStyle = "rgba(0,0,0,0.72)";
      g.beginPath();
      g.roundRect(px - size * 0.6, py - size * 0.95, total + size * 1.2, size * 1.45, size * 0.35);
      g.fill();
      let x = px;
      line.forEach((w, k) => {
        g.fillStyle = caps.highlightActiveWord && from + k === i ? "#ffd60a" : "#fff";
        g.fillText(w.text, x, py);
        x += widths[k] + gap;
      });
    }
  }

  const pixels = g.getImageData(0, 0, width, height).data;
  const out = new Uint8Array(8 + pixels.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, width, true);
  view.setUint32(4, height, true);
  out.set(pixels, 8);
  return out.buffer;
}

function setEdit(edit: EditSettings, selection: Selection | null = null) {
  history.push(state.edit);
  future.length = 0;
  state = { ...state, edit, canUndo: true, canRedo: false, selection };
  return state;
}

/** Lays clips end to end (what the Rust side does after any cut). */
function setClips(clips: Clip[]) {
  let t = 0;
  const placements = clips.map((clip) => {
    const p = { clip, outputStart: t };
    t += (clip.end - clip.start) / clip.speed;
    return p;
  });
  state = { ...state, placements, outputDuration: t };
}
const clips = () => state.placements.map((p) => ({ ...p.clip }));

/** Takes recording-time ranges out of the video. */
function cutSource(ranges: [number, number][]) {
  let list = clips();
  for (const [a, b] of ranges) {
    list = list.flatMap((c) => {
      if (b <= c.start || a >= c.end) return [c];
      const out: Clip[] = [];
      if (a > c.start + 0.05) out.push({ ...c, end: a });
      if (b < c.end - 0.05) out.push({ ...c, start: b });
      return out;
    });
  }
  setClips(list);
}

function apply(op: Record<string, unknown>): EditorState {
  const e: EditSettings = structuredClone(state.edit);
  const time = (op.time as number) ?? 0;
  switch (op.op) {
    case "setEdit":
      return setEdit(op.edit as EditSettings);
    case "undo": {
      const prev = history.pop();
      if (prev) {
        future.push(state.edit);
        state = { ...state, edit: prev, canUndo: history.length > 0, canRedo: true, selection: null };
      }
      return state;
    }
    case "redo": {
      const next = future.pop();
      if (next) {
        history.push(state.edit);
        state = { ...state, edit: next, canUndo: true, canRedo: future.length > 0, selection: null };
      }
      return state;
    }
    case "addZoom": {
      const id = uuid();
      e.zoom.segments.push({ id, start: time, end: time + 3, scale: e.zoom.scale });
      state = { ...state, zoomSegments: [...state.zoomSegments, { id, start: time, end: time + 3, scale: e.zoom.scale }] };
      return setEdit(e, { kind: "zoom", id });
    }
    case "addMask": {
      const id = uuid();
      e.masks.push({ id, start: time, end: time + 3, rect: [[0.35, 0.35], [0.3, 0.2]], style: (op.style as "blur") ?? "blur", amount: 0.6 });
      return setEdit(e, { kind: "mask", id });
    }
    case "addText": {
      const id = uuid();
      e.texts.push({ id, start: time, end: time + 3, style: op.style as "title", text: "Your title", detail: "", position: [0.5, 0.2], animation: "fade" } as EditSettings["texts"][number]);
      return setEdit(e, { kind: "text", id });
    }
    case "addScene": {
      const id = uuid();
      e.scenes.push({ id, start: time, end: time + 3, layout: op.layout as "cameraOnly", transition: 0.4 } as EditSettings["scenes"][number]);
      return setEdit(e, { kind: "scene", id });
    }
    case "addMove": {
      const id = uuid();
      e.moves.push({ id, start: time, end: time + 3, kind: op.kind as "glide" });
      return setEdit(e, { kind: "move", id });
    }
    case "split": {
      const at = sourceTimeAt(state.placements, time);
      setClips(clips().flatMap((c) => (at > c.start + 0.05 && at < c.end - 0.05 ? [{ ...c, end: at }, { ...c, start: at }] : [c])));
      return { ...state, selection: null };
    }
    case "cut": {
      cutSource([[sourceTimeAt(state.placements, op.start as number), sourceTimeAt(state.placements, op.end as number)]]);
      return state;
    }
    case "deleteClip": {
      setClips(clips().filter((_, i) => i !== op.index));
      return state;
    }
    case "setSpeed": {
      setClips(clips().map((c, i) => (i === op.index ? { ...c, speed: op.speed as number } : c)));
      return state;
    }
    case "removeFillers":
    case "cutWords": {
      const words = state.edit.captions.words;
      const ids = new Set((op.ids as string[]) ?? []);
      cutSource(
        words.flatMap((w, i) => {
          if (op.op === "removeFillers" ? !isFiller(w.text) : !ids.has(w.id)) return [];
          const next = words[i + 1];
          return [[w.start - 0.02, next && next.start - w.end < 0.4 ? next.start - 0.01 : w.end] as [number, number]];
        }),
      );
      return state;
    }
    case "setTitle":
      state = { ...state, name: String(op.title).trim() || "Dashboard walkthrough" };
      return state;
    case "delete":
    case "deleteMany": {
      const list = (op.selections as Selection[]) ?? [op.selection as Selection];
      // Clips go first, last index first, so the others keep their place.
      const clipIndexes = list.filter((s) => s.kind === "clip").map((s) => (s as { id: number }).id).sort((a, b) => b - a);
      if (clipIndexes.length) setClips(clips().filter((_, i) => !clipIndexes.includes(i)));
      for (const s of list) {
        if (!("id" in s) || s.kind === "clip") continue;
        e.masks = e.masks.filter((x) => x.id !== s.id);
        e.texts = e.texts.filter((x) => x.id !== s.id);
        e.scenes = e.scenes.filter((x) => x.id !== s.id);
        e.moves = e.moves.filter((x) => x.id !== s.id);
        e.zoom.segments = e.zoom.segments.filter((x) => x.id !== s.id);
      }
      return setEdit(e);
    }
    default:
      return state;
  }
}

const wallpaper = (a: string, b: string) => {
  const c = document.createElement("canvas");
  c.width = 160;
  c.height = 100;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 160, 100);
  grad.addColorStop(0, a);
  grad.addColorStop(1, b);
  g.fillStyle = grad;
  g.fillRect(0, 0, 160, 100);
  return c.toDataURL("image/jpeg");
};

mockWindows("main");
/** The desktop demo's layout (the column on the right while recording). */
let demoLayout = "default";
const spotlightMove = (e: PointerEvent) => void emit("ink:cursor", [e.clientX, e.clientY]);

mockIPC(
  (cmd, payload) => {
    const p = (payload ?? {}) as Record<string, unknown>;
    switch (cmd) {
      case "recording_rename":
        return String(p.title);
      case "list_recordings":
        return [
          { path: "/fixture/Product demo.umi", name: "Dashboard walkthrough", duration: 10.1, createdAt: "2026-10-24T21:33:09Z" },
          { path: "/fixture/Onboarding walkthrough.umi", name: "Onboarding walkthrough", duration: 184.2, createdAt: "2026-10-23T10:12:00Z" },
          { path: "/fixture/Bug report.umi", name: "Bug report", duration: 42.7, createdAt: "2026-10-21T15:40:00Z" },
        ];
      case "recording_preview":
        return Array.from({ length: 24 }, (_, i) => frames[Math.floor(i / 8)][1]);
      case "recording_thumbnails":
      {
        const count = (p.count as number) ?? 24;
        return Array.from({ length: count }, (_, i) => frames[Math.min(2, Math.floor((i / count) * 3))][1]);
      }
      case "recording_waveform":
        return Array.from({ length: 506 }, (_, i) => Math.abs(Math.sin(i / 9) * Math.sin(i / 37)) * (i % 120 < 90 ? 1 : 0.05));
      case "open_editor":
        return state;
      case "editor_apply":
        return apply(p.op as Record<string, unknown>);
      case "editor_revert":
        // The edit the demo opened with (history's first entry), captions kept.
        return apply({ op: "setEdit", edit: { ...(history[0] ?? state.edit), captions: state.edit.captions } });
      case "editor_frame":
        return loaded.then(() => frameAt(p.time as number, p.width as number, p.height as number));
      case "editor_layout":
        return [0.08, 0.08, 0.84, 0.84];
      case "editor_audio":
        return new Float32Array(Math.round(48000 * (p.seconds as number)) * 2).buffer;
      case "presets_list":
        return { presets: [{ id: "A", name: "Product demos" }, { id: "B", name: "Tutorials" }], defaultId: "A" };
      case "music_fetch":
        return `/tmp/${String(p.url).split("/").pop()}`;
      case "bundle_import":
        return `${p.base}-A1B2C3.${String(p.file).split(".").pop()}`;
      case "music_tracks":
        return (music as unknown[]).map((t) => ({ ...(t as object), downloaded: false }));
      case "system_wallpapers":
        return [
          ["Sonoma", "#f4a35e", "#6a3fa0"],
          ["Ventura", "#ef8a3c", "#1e2f6f"],
          ["Sequoia", "#2e6f5e", "#0c2230"],
          ["Mac Blue", "#3e8bf0", "#0d2c74"],
          ["Mac Pink", "#f7a1c4", "#a03a77"],
          ["Radial Sky", "#bfe2ff", "#2a76d2"],
        ].map(([name, a, b]) => ({ name, path: `/System/Library/Desktop Pictures/${name}.heic`, thumb: wallpaper(a, b) }));
      case "export_default_path":
        return `/Users/you/Movies/Umi/Exports/${p.name}.${p.extension}`;
      case "ai_models":
        return [];
      case "image_thumbnail":
        return wallpaper("#ddd", "#999");
      case "screenshot_current":
        return frames[0][1];
      case "cloud_status":
        return { connected: true, server: "https://umi.cam" };
      case "cloud_can_share":
        return true;
      case "share_state":
      case "share_update":
        return { durationMs: 192000, id: "s2Zty2QoHiLz", url: "https://umi.cam/v/s2Zty2QoHiLz", title: "Product demo", status: "ready", allowDownload: true, hasPassword: false, allowComments: true, expiresAt: null };
      case "share_insights":
        return { views: 42, watchedSeconds: 2310, averageSeconds: 55, completion: 0.62, retention: [1, 0.92, 0.86, 0.83, 0.82, 0.81, 0.8, 0.79, 0.78, 0.77, 0.66, 0.64, 0.63, 0.63, 0.62, 0.61, 0.6, 0.59, 0.58, 0.55], embeddedViews: 9, countries: [{ country: "TR", count: 21 }, { country: "DE", count: 9 }, { country: "US", count: 7 }, { country: "NL", count: 5 }] };
      case "team_list":
        return [{ id: "W1", name: "Umi Team", role: "owner", members: 3, inviteCode: "k3Jd9aQpLx2mZt7RbV0c" }];
      case "team_detail":
        return {
          workspace: { id: "W1", name: "Umi Team", role: "owner", members: 3, inviteCode: "k3Jd9aQpLx2mZt7RbV0c" },
          members: [
            { id: "a", email: "you@umi.cam", role: "owner", you: true },
            { id: "b", email: "ada@umi.cam", role: "member", you: false },
            { id: "c", email: "lin@umi.cam", role: "member", you: false },
          ],
        };
      case "team_videos":
        return [
          { id: "v1", url: "https://umi.cam/v/v1", title: "Onboarding walkthrough", durationMs: 184000, thumbnailUrl: frames[0][1], owner: "ada@umi.cam", yours: false },
          { id: "v2", url: "https://umi.cam/v/v2", title: "Q4 roadmap", durationMs: 312000, thumbnailUrl: frames[1][1], owner: "you@umi.cam", yours: true },
          { id: "v3", url: "https://umi.cam/v/v3", title: "Bug repro: export", durationMs: 46000, thumbnailUrl: frames[2][1], owner: "lin@umi.cam", yours: false },
        ];
      case "team_presets":
        return [{ id: "P1", name: "Brand look", edit: {}, updatedBy: "ada@umi.cam" }];
      case "pexels_status":
        return true;
      case "pexels_search":
        return { photos: [frame1, frame4, frame8, frame1, frame4, frame8].map((f, i) => ({ id: i + 1, thumb: f, full: f, photographer: "Ada", photographerUrl: "", pageUrl: "", color: "#88a" })), hasMore: true };
      case "pexels_use":
        return `background-pexels-${p.id}.jpg`;
      case "ink_set":
        void emit("ink:mode", { drawing: p.drawing, color: p.color, tool: p.tool });
        return null;
      // The spotlight follows the pointer (the app reads it from the system; here, the page).
      case "ink_spotlight":
        removeEventListener("pointermove", spotlightMove);
        if (p.on) {
          void emit("ink:mode", { drawing: false, tool: "spotlight" });
          addEventListener("pointermove", spotlightMove);
        } else void emit("ink:cursor", null);
        return null;
      case "record_layout":
        demoLayout = String(p.layout);
        demoCameraVisible = demoLayout !== "hideCamera";
        dispatchEvent(new CustomEvent("demo:window", { detail: { view: "bubble", shown: demoCameraVisible } }));
        void emit("record:layout", demoLayout);
        return null;
      case "copy_text_to_clipboard":
        return null;
      case "record_settings":
        return recordSettings;
      case "record_settings_save":
        recordSettings = p.settings as typeof recordSettings;
        return null;
      case "record_sources":
        return {
          displays: [{ id: 1, name: "Main display", width: 1728, height: 1117, scale: 2, x: 0, y: 0 }],
          windows: [
            { id: 11, title: "Umi — Product demo", app: "Umi", x: 0, y: 0, width: 1440, height: 900 },
            { id: 12, title: "Inbox", app: "Mail", x: 0, y: 0, width: 1200, height: 800 },
          ],
          microphones: [
            { id: "mbp", name: windowsDesk ? "Microphone (Realtek Audio)" : "MacBook Pro Microphone", isDefault: true },
            { id: "usb", name: "USB Microphone", isDefault: false },
          ],
          cameras: [{ id: "0", name: windowsDesk ? "Integrated Camera" : "FaceTime HD Camera" }],
          missingPermission: null,
        };
      case "record_camera":
        demoCameraVisible = Boolean(p.visible);
        dispatchEvent(new CustomEvent("demo:window", { detail: { view: "bubble", shown: demoCameraVisible } }));
        return null;
      case "record_status":
        // The desktop demo starts its recording at `__demoRecStart`.
        return { recording: true, paused: false, elapsed: (performance.now() - ((window as unknown as { __demoRecStart?: number }).__demoRecStart ?? 0)) / 1000, level: Math.abs(Math.sin(performance.now() / 300)) * 0.5, cameraVisible: demoCameraVisible, layout: demoLayout };
      case "record_camera_preview":
        return cameraPreview(p.camera as string | null, p.frames as { onmessage: (b: ArrayBuffer) => void });
      // The desktop demo draws the app's floating windows itself; tell it what to show.
      case "window_show":
      case "window_hide":
        dispatchEvent(new CustomEvent("demo:window", { detail: { view: p.view, shown: cmd === "window_show" } }));
        return null;
      case "window_resize":
        dispatchEvent(new CustomEvent("demo:resize", { detail: { width: p.width, height: p.height } }));
        return null;
      case "record_meter":
      case "editor_save":
      case "editor_close":
      case "plugin:event|listen":
      case "plugin:event|unlisten":
        return null;
      case "editor_export":
        // Pretend to render for a moment.
        return new Promise((done) => setTimeout(() => done((p.request as { destination: string }).destination), 1800));
      case "editor_transcribe":
        state = { ...state, edit: { ...state.edit, captions: { ...state.edit.captions, enabled: true, words: SAMPLE_WORDS } } };
        return state;
      default:
        console.info("mock: unhandled", cmd, p);
        return null;
    }
  },
  { shouldMockEvents: true },
);
