// The finished video's look, and one function that draws a frame of it. The editor's preview and
// the export both draw with `paint`, so what you see is what you download.

export const GRADIENTS: Record<string, [string, string]> = {
  sky: ["#9eccfa", "#2e5eb8"],
  ice: ["#f2f7fc", "#ccdff7"],
  navy: ["#2e5487", "#0f172b"],
  graphite: ["#40454f", "#0f121a"],
  mist: ["#edf0f5", "#b8bfcf"],
  mint: ["#8cedc2", "#1c8c8c"],
  sand: ["#f5e8d1", "#d1b594"],
  dusk: ["#fa736b", "#6b4adb"],
  ocean: ["#2199f2", "#14338c"],
  peach: ["#ffcc9e", "#f57885"],
  grape: ["#cc73f2", "#4d2699"],
  night: ["#333847", "#0d0d17"],
};

export type Aspect = "auto" | "wide" | "square" | "vertical";
export type Corner = "tl" | "tr" | "bl" | "br";
export const ASPECTS: [Aspect, string][] = [
  ["auto", "Auto"],
  ["wide", "16:9"],
  ["square", "1:1"],
  ["vertical", "9:16"],
];

export type Look = {
  gradient: string;
  padding: number;
  radius: number;
  aspect: Aspect;
  camera: boolean;
  corner: Corner;
  camSize: number;
  captions: boolean;
  zoom: boolean;
  zoomScale: number;
};

export const LOOK: Look = { gradient: "sky", padding: 0.08, radius: 0.025, aspect: "auto", camera: true, corner: "br", camSize: 0.24, captions: true, zoom: true, zoomScale: 1.6 };

/** A word with its time in the recording, in seconds. */
export type Word = { text: string; start: number; end: number };
/** Zoom in on (x, y) — fractions of the screen — from start to end. */
export type Zoom = { start: number; end: number; x: number; y: number };

/** The output size for a look: 1080 tall (or 1920 tall for vertical), even numbers. */
export function canvasSize(look: Look, width: number, height: number): [number, number] {
  if (look.aspect === "wide") return [1920, 1080];
  if (look.aspect === "square") return [1080, 1080];
  if (look.aspect === "vertical") return [1080, 1920];
  return [Math.round((1080 * width) / height / 2) * 2, 1080];
}

const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const RAMP = 0.6;

/** How far in (1 = not zoomed) and where, at a time in the recording. */
export function zoomAt(zooms: Zoom[], time: number, scale: number): { s: number; x: number; y: number } {
  for (const z of zooms) {
    if (time < z.start - RAMP || time > z.end + RAMP) continue;
    const k = time < z.start ? ease((time - (z.start - RAMP)) / RAMP) : time > z.end ? ease(1 - (time - z.end) / RAMP) : 1;
    return { s: 1 + (scale - 1) * k, x: z.x, y: z.y };
  }
  return { s: 1, x: 0.5, y: 0.5 };
}

/** Caption lines: up to 7 words, broken at pauses and sentence ends. */
export function captionLines(words: Word[]): Word[][] {
  const lines: Word[][] = [];
  let line: Word[] = [];
  for (const w of words) {
    const prev = line[line.length - 1];
    if (line.length && (line.length >= 7 || w.start - prev.end > 0.7 || /[.!?]$/.test(prev.text))) {
      lines.push(line);
      line = [];
    }
    line.push(w);
  }
  if (line.length) lines.push(line);
  return lines;
}

export type Frame = {
  look: Look;
  screen: CanvasImageSource | null;
  screenSize: [number, number];
  camera: CanvasImageSource | null;
  cameraSize: [number, number];
  /** Time in the recording, for zooms and captions. */
  time: number;
  zooms: Zoom[];
  lines: Word[][];
};

/** Draws one frame of the finished video. */
export function paint(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, f: Frame) {
  const { width: W, height: H } = ctx.canvas;
  const { look } = f;
  const m = Math.min(W, H);
  const [a, b] = GRADIENTS[look.gradient];
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, a);
  g.addColorStop(1, b);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  const pad = look.padding * m;
  const [sw, sh] = f.screenSize;
  const fit = Math.min((W - pad * 2) / sw, (H - pad * 2) / sh);
  const w = sw * fit;
  const h = sh * fit;
  const x = (W - w) / 2;
  const y = (H - h) / 2;
  const r = look.radius * m;

  ctx.save();
  if (pad > 0) {
    ctx.shadowColor = "rgba(0,0,0,0.35)";
    ctx.shadowBlur = m * 0.04;
    ctx.shadowOffsetY = m * 0.012;
  }
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = "#000";
  ctx.fill();
  ctx.restore();

  if (f.screen) {
    // Zoom: show a smaller part of the screen, centred on the action but never past its edges.
    const z = look.zoom ? zoomAt(f.zooms, f.time, look.zoomScale) : { s: 1, x: 0.5, y: 0.5 };
    const cw = sw / z.s;
    const ch = sh / z.s;
    const cx = Math.min(sw - cw, Math.max(0, z.x * sw - cw / 2));
    const cy = Math.min(sh - ch, Math.max(0, z.y * sh - ch / 2));
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.clip();
    ctx.drawImage(f.screen, cx, cy, cw, ch, x, y, w, h);
    ctx.restore();
  }

  if (look.camera && f.camera) {
    const d = look.camSize * m;
    const edge = Math.max(pad * 0.5, m * 0.03);
    const cx = look.corner.endsWith("l") ? edge + d / 2 : W - edge - d / 2;
    const cy = look.corner.startsWith("t") ? edge + d / 2 : H - edge - d / 2;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.35)";
    ctx.shadowBlur = d * 0.12;
    ctx.beginPath();
    ctx.arc(cx, cy, d / 2 + d * 0.02, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, d / 2, 0, Math.PI * 2);
    ctx.clip();
    const [vw, vh] = f.cameraSize;
    const s = Math.min(vw, vh);
    // Mirrored, like the preview the speaker saw.
    ctx.translate(cx * 2, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(f.camera, (vw - s) / 2, (vh - s) / 2, s, s, cx - d / 2, cy - d / 2, d, d);
    ctx.restore();
  }

  if (look.captions) drawCaption(ctx, f.lines, f.time, W, H, m);
}

/** The line being spoken, on a dark pill, the current word lit. */
function drawCaption(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, lines: Word[][], time: number, W: number, H: number, m: number) {
  const line = lines.find((l) => time >= l[0].start - 0.1 && time <= l[l.length - 1].end + 0.4);
  if (!line) return;
  const size = Math.round(m * 0.042);
  ctx.save();
  ctx.font = `600 ${size}px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`;
  ctx.textBaseline = "middle";
  const space = ctx.measureText(" ").width;
  const widths = line.map((w) => ctx.measureText(w.text).width);
  const total = widths.reduce((a, b) => a + b, 0) + space * (line.length - 1);
  const padX = size * 0.7;
  const boxW = total + padX * 2;
  const boxH = size * 1.8;
  const bx = (W - boxW) / 2;
  const by = H - m * 0.06 - boxH;
  ctx.fillStyle = "rgba(14,17,30,0.78)";
  ctx.beginPath();
  ctx.roundRect(bx, by, boxW, boxH, boxH * 0.3);
  ctx.fill();
  let cx = bx + padX;
  line.forEach((w, i) => {
    ctx.fillStyle = time >= w.start && time < w.end + 0.05 ? "#ffd60a" : "#fff";
    ctx.fillText(w.text, cx, by + boxH / 2);
    cx += widths[i] + space;
  });
  ctx.restore();
}
