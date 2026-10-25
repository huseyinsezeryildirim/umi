import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { createSignal, onCleanup, onMount } from "solid-js";

/** Pen colors, shared with the control bar. */
export const INK_COLORS = ["#ff4d4d", "#ffd23f", "#2f8cff", "#13d18e", "#ffffff"] as const;

/** How long a stroke stays, then how long it takes to fade (like Loom's drawing). */
const HOLD_MS = 2500;
const FADE_MS = 600;

interface Stroke {
  color: string;
  points: [number, number][];
  /** When the pen lifted; `null` while still drawing. */
  done: number | null;
}

/** Fading strokes for a stroke list at time `now` (also drops the gone ones). */
export function visibleStrokes(strokes: Stroke[], now: number) {
  return strokes
    .map((s) => ({ stroke: s, alpha: s.done === null ? 1 : 1 - Math.min(1, Math.max(0, (now - s.done - HOLD_MS) / FADE_MS)) }))
    .filter((s) => s.alpha > 0);
}

/**
 * The see-through layer over the screen that people draw on while recording. It is part
 * of the recording; while not drawing, clicks pass through it (set from Rust).
 */
export function Ink() {
  let canvas!: HTMLCanvasElement;
  const [drawing, setDrawing] = createSignal(false);
  let color: string = INK_COLORS[0];
  let strokes: Stroke[] = [];
  let current: Stroke | null = null;
  let frame = 0;

  const draw = () => {
    frame = 0;
    const ctx = canvas.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const now = performance.now();
    const shown = visibleStrokes(strokes, now);
    strokes = shown.map((s) => s.stroke);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const { stroke, alpha } of shown) {
      const p = stroke.points;
      if (!p.length) continue;
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = 5;
      ctx.shadowColor = "rgba(0,0,0,0.25)";
      ctx.shadowBlur = 4;
      ctx.beginPath();
      ctx.moveTo(p[0][0], p[0][1]);
      // Midpoint curves keep fast strokes smooth.
      for (let i = 1; i < p.length - 1; i++) ctx.quadraticCurveTo(p[i][0], p[i][1], (p[i][0] + p[i + 1][0]) / 2, (p[i][1] + p[i + 1][1]) / 2);
      ctx.lineTo(p[p.length - 1][0], p[p.length - 1][1]);
      if (p.length === 1) ctx.lineTo(p[0][0] + 0.1, p[0][1]);
      ctx.stroke();
    }
    if (strokes.length) frame = requestAnimationFrame(draw);
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

  onMount(() => {
    resize();
    window.addEventListener("resize", resize);
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") void invoke("ink_set", { drawing: false });
      if (e.key === "z" && (e.metaKey || e.ctrlKey)) {
        strokes.pop();
        redraw();
      }
    };
    window.addEventListener("keydown", key);
    const off = listen<{ drawing: boolean; color?: string | null }>("ink:mode", (e) => {
      setDrawing(e.payload.drawing);
      if (e.payload.color) color = e.payload.color;
    });
    onCleanup(() => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", key);
      void off.then((f) => f());
      cancelAnimationFrame(frame);
    });
  });

  const down = (e: PointerEvent) => {
    if (!drawing() || e.button !== 0) return;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic events have no capturable pointer.
    }
    current = { color, points: [[e.clientX, e.clientY]], done: null };
    strokes.push(current);
    redraw();
  };
  const move = (e: PointerEvent) => {
    if (!current) return;
    const all = e.getCoalescedEvents?.() ?? [];
    for (const c of all.length ? all : [e]) current.points.push([c.clientX, c.clientY]);
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
