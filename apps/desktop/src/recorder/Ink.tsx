import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { createSignal, onCleanup, onMount } from "solid-js";

/** Pen colors, shared with the drawing tools. */
export const INK_COLORS = ["#ff4d4d", "#ffd23f", "#2f8cff", "#13d18e", "#ffffff"] as const;

/** What the drawing tools can do: draw with one of these, light up the pointer, or nothing. */
export type InkTool = "pointer" | "pen" | "highlighter" | "arrow" | "box" | "spotlight";
/** The tools that take the mouse (the rest let clicks through to the apps below). */
export const DRAWS: InkTool[] = ["pen", "highlighter", "arrow", "box"];

/** How long a stroke stays, then how long it takes to fade (like Loom's drawing). */
const HOLD_MS = 2500;
const FADE_MS = 600;

interface Stroke {
  tool: InkTool;
  color: string;
  /** Freehand: every point. Arrow and box: where the drag started and where it is. */
  points: [number, number][];
  /** When the pen lifted; `null` while still drawing. */
  done: number | null;
}

/** Fading strokes for a stroke list at time `now` (also drops the gone ones). `keep`: none fade. */
export function visibleStrokes(strokes: Stroke[], now: number, keep = false) {
  return strokes
    .map((s) => ({ stroke: s, alpha: s.done === null || keep ? 1 : 1 - Math.min(1, Math.max(0, (now - s.done - HOLD_MS) / FADE_MS)) }))
    .filter((s) => s.alpha > 0);
}

/** A freehand line through `p`, smoothed with midpoint curves. */
function freehand(ctx: CanvasRenderingContext2D, p: [number, number][]) {
  ctx.beginPath();
  ctx.moveTo(p[0][0], p[0][1]);
  for (let i = 1; i < p.length - 1; i++) ctx.quadraticCurveTo(p[i][0], p[i][1], (p[i][0] + p[i + 1][0]) / 2, (p[i][1] + p[i + 1][1]) / 2);
  ctx.lineTo(p[p.length - 1][0], p[p.length - 1][1]);
  if (p.length === 1) ctx.lineTo(p[0][0] + 0.1, p[0][1]);
  ctx.stroke();
}

function stroke(ctx: CanvasRenderingContext2D, s: Stroke) {
  const p = s.points;
  if (!p.length) return;
  ctx.strokeStyle = s.color;
  ctx.lineWidth = 5;
  ctx.shadowColor = "rgba(0,0,0,0.25)";
  ctx.shadowBlur = 4;
  if (s.tool === "highlighter") {
    // A broad, see-through marker: what's under it stays readable.
    ctx.globalAlpha *= 0.35;
    ctx.lineWidth = 22;
    ctx.shadowBlur = 0;
    ctx.lineCap = "butt";
    freehand(ctx, p);
    ctx.lineCap = "round";
    return;
  }
  if (s.tool === "pen") return freehand(ctx, p);
  const [a, b] = [p[0], p[p.length - 1]];
  if (s.tool === "box") {
    ctx.beginPath();
    ctx.roundRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]), 10);
    ctx.stroke();
    return;
  }
  // Arrow: the line, then a head at the end that grows a little with the length.
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len < 2) return;
  const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const head = Math.min(26, 10 + len * 0.12);
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]);
  ctx.lineTo(b[0], b[1]);
  ctx.moveTo(b[0] - head * Math.cos(angle - 0.5), b[1] - head * Math.sin(angle - 0.5));
  ctx.lineTo(b[0], b[1]);
  ctx.lineTo(b[0] - head * Math.cos(angle + 0.5), b[1] - head * Math.sin(angle + 0.5));
  ctx.stroke();
}

/**
 * The see-through layer over the screen that people draw on while recording (the tools are
 * along the bottom, in Draw.tsx). It is part of the recording; while not drawing, clicks pass
 * through it (set from Rust). The spotlight dims everything but a circle around the pointer.
 */
export function Ink() {
  let canvas!: HTMLCanvasElement;
  const [drawing, setDrawing] = createSignal(false);
  let tool: InkTool = "pen";
  let color: string = INK_COLORS[0];
  let keep = false;
  let strokes: Stroke[] = [];
  let current: Stroke | null = null;
  let spot: [number, number] | null = null;
  let frame = 0;

  const draw = () => {
    frame = 0;
    const ctx = canvas.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const now = performance.now();
    const shown = visibleStrokes(strokes, now, keep);
    strokes = shown.map((s) => s.stroke);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const { stroke: s, alpha } of shown) {
      ctx.save();
      ctx.globalAlpha = alpha;
      stroke(ctx, s);
      ctx.restore();
    }
    if (spot) {
      // Dim the screen, with a soft-edged hole where the pointer is.
      const glow = ctx.createRadialGradient(spot[0], spot[1], 90, spot[0], spot[1], 130);
      glow.addColorStop(0, "rgba(0,0,0,0)");
      glow.addColorStop(1, "rgba(0,0,0,0.55)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, innerWidth, innerHeight);
    }
    // Fading strokes keep animating; kept ones and the spotlight redraw when something changes.
    if (!keep && strokes.some((s) => s.done !== null)) frame = requestAnimationFrame(draw);
  };
  const redraw = () => {
    if (!frame) frame = requestAnimationFrame(draw);
  };

  const resize = () => {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(innerWidth * dpr);
    canvas.height = Math.round(innerHeight * dpr);
    redraw();
  };

  /** Letters that pick a tool while drawing (this layer has the keyboard then). */
  const KEYS: Record<string, InkTool> = { p: "pen", h: "highlighter", a: "arrow", b: "box", s: "spotlight" };

  onMount(() => {
    resize();
    window.addEventListener("resize", resize);
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") void emit("ink:pick", { tool: "pointer" });
      else if (e.key === "z" && (e.metaKey || e.ctrlKey)) void emit("ink:action", { action: "undo" });
      else if (!e.metaKey && !e.ctrlKey && KEYS[e.key.toLowerCase()]) void emit("ink:pick", { tool: KEYS[e.key.toLowerCase()] });
    };
    window.addEventListener("keydown", key);
    const offs = [
      listen<{ drawing: boolean; color?: string | null; tool?: InkTool | null }>("ink:mode", (e) => {
        setDrawing(e.payload.drawing);
        if (e.payload.color) color = e.payload.color;
        if (e.payload.tool) tool = e.payload.tool;
      }),
      listen<{ action: "undo" | "clear" | "keep"; value?: boolean }>("ink:action", (e) => {
        const { action, value } = e.payload;
        if (action === "undo") strokes.pop();
        if (action === "clear") strokes = [];
        if (action === "keep") {
          keep = !!value;
          // Turned off: what was kept starts fading now.
          if (!keep) for (const s of strokes) if (s.done !== null) s.done = performance.now();
        }
        redraw();
      }),
      listen<[number, number] | null>("ink:cursor", (e) => {
        spot = e.payload;
        redraw();
      }),
    ];
    onCleanup(() => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", key);
      for (const off of offs) void off.then((f) => f());
      cancelAnimationFrame(frame);
    });
  });

  const down = (e: PointerEvent) => {
    if (!drawing() || e.button !== 0 || !DRAWS.includes(tool)) return;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic events have no capturable pointer.
    }
    current = { tool, color, points: [[e.clientX, e.clientY]], done: null };
    strokes.push(current);
    redraw();
  };
  const move = (e: PointerEvent) => {
    if (!current) return;
    if (current.tool === "arrow" || current.tool === "box") current.points[1] = [e.clientX, e.clientY];
    else {
      const all = e.getCoalescedEvents?.() ?? [];
      for (const c of all.length ? all : [e]) current.points.push([c.clientX, c.clientY]);
    }
    redraw();
  };
  const up = () => {
    if (!current) return;
    current.done = performance.now();
    current = null;
    redraw();
  };

  return (
    <canvas
      ref={canvas}
      class="ink"
      data-drawing={drawing() ? "true" : "false"}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    />
  );
}

/** Turns the ink layer to `tool` (pointer: clicks go through; spotlight: they do, and it follows). */
export async function applyTool(tool: InkTool, color: string) {
  if (tool === "spotlight") return invoke("ink_spotlight", { on: true });
  await invoke("ink_spotlight", { on: false });
  await invoke("ink_set", { drawing: DRAWS.includes(tool), color, tool });
}
