import { invoke } from "@tauri-apps/api/core";
import { createEffect, createSignal, For, on, onCleanup, onMount, Show } from "solid-js";
import { Button, IconButton, SliderField, Toaster, toast } from "@umi/ui";
import { ArrowUpRight, Copy, Download, Grid2x2, Highlighter, Square, Type, Undo2 } from "lucide-solid";

type Tool = "arrow" | "box" | "text" | "highlight" | "blur";
type Shape =
  | { kind: "arrow" | "box" | "highlight" | "blur"; x0: number; y0: number; x1: number; y1: number; color: string }
  | { kind: "text"; x: number; y: number; text: string; color: string };

const COLORS = ["#ff3b30", "#ffcc00", "#34c759", "#116ff5", "#0e111e", "#ffffff"];
const BACKGROUNDS: [string, string, string][] = [
  ["None", "", ""],
  ["Sky", "#9eccfa", "#2e5eb8"],
  ["Dusk", "#fa736b", "#6b4adb"],
  ["Mint", "#8cedc2", "#1c8c8c"],
  ["Ice", "#f2f7fc", "#ccdff7"],
  ["Night", "#333847", "#0d0d17"],
];

/** Screenshot editor: mark up, dress up, copy or save. */
export function ScreenshotEditor() {
  let view!: HTMLCanvasElement;
  const [image, setImage] = createSignal<HTMLImageElement | null>(null);
  const [tool, setTool] = createSignal<Tool>("arrow");
  const [color, setColor] = createSignal(COLORS[0]);
  const [shapes, setShapes] = createSignal<Shape[]>([]);
  const [draft, setDraft] = createSignal<Shape | null>(null);
  const [bg, setBg] = createSignal(1);
  const [padding, setPadding] = createSignal(0.08);
  const [radius, setRadius] = createSignal(0.02);
  const [shadow, setShadow] = createSignal(0.5);
  /** Where a text label is being typed (image px, and stage px for the input). */
  const [typing, setTyping] = createSignal<{ x: number; y: number; left: number; top: number } | null>(null);
  const commitText = (value: string) => {
    const t = typing();
    if (t && value.trim()) setShapes([...shapes(), { kind: "text", x: t.x, y: t.y, text: value.trim(), color: color() }]);
    setTyping(null);
  };

  const load = async () => {
    const url = await invoke<string | null>("screenshot_current");
    if (!url) return;
    const img = new Image();
    img.onload = () => {
      setShapes([]);
      setImage(img);
    };
    img.src = url;
  };

  /** Everything drawn at `scale` (1 = full resolution) onto `g`; returns the layout. */
  const paint = (g: CanvasRenderingContext2D, scale: number) => {
    const img = image();
    if (!img) return;
    const [, a, b] = BACKGROUNDS[bg()];
    const pad = a ? Math.round(Math.max(img.width, img.height) * padding()) : 0;
    const W = (img.width + pad * 2) * scale;
    const H = (img.height + pad * 2) * scale;
    g.canvas.width = Math.round(W);
    g.canvas.height = Math.round(H);
    g.save();
    g.scale(scale, scale);
    if (a) {
      const grad = g.createLinearGradient(0, 0, img.width + pad * 2, img.height + pad * 2);
      grad.addColorStop(0, a);
      grad.addColorStop(1, b);
      g.fillStyle = grad;
      g.fillRect(0, 0, img.width + pad * 2, img.height + pad * 2);
    }
    const r = a ? Math.min(img.width, img.height) * radius() : 0;
    const clip = () => {
      g.beginPath();
      g.roundRect(pad, pad, img.width, img.height, r);
    };
    if (a && shadow() > 0) {
      g.save();
      g.shadowColor = `rgba(0,0,0,${0.45 * shadow()})`;
      g.shadowBlur = Math.max(img.width, img.height) * 0.04 * shadow();
      g.shadowOffsetY = Math.max(img.width, img.height) * 0.012;
      clip();
      g.fillStyle = "#000";
      g.fill();
      g.restore();
    }
    g.save();
    clip();
    g.clip();
    g.drawImage(img, pad, pad);
    g.translate(pad, pad);
    for (const s of [...shapes(), ...(draft() ? [draft()!] : [])]) drawShape(g, s, img);
    g.restore();
    g.restore();
  };

  const drawShape = (g: CanvasRenderingContext2D, s: Shape, img: HTMLImageElement) => {
    const lw = Math.max(3, Math.min(img.width, img.height) * 0.006);
    g.save();
    g.strokeStyle = s.color;
    g.fillStyle = s.color;
    g.lineWidth = lw;
    g.lineCap = "round";
    g.lineJoin = "round";
    if (s.kind === "text") {
      g.font = `700 ${Math.round(lw * 9)}px -apple-system, "Segoe UI", sans-serif`;
      g.lineWidth = lw * 1.4;
      g.strokeStyle = s.color === "#ffffff" ? "#0e111e" : "#ffffff";
      g.strokeText(s.text, s.x, s.y);
      g.fillText(s.text, s.x, s.y);
    } else {
      const x = Math.min(s.x0, s.x1);
      const y = Math.min(s.y0, s.y1);
      const w = Math.abs(s.x1 - s.x0);
      const h = Math.abs(s.y1 - s.y0);
      if (s.kind === "box") {
        g.beginPath();
        g.roundRect(x, y, w, h, lw * 2);
        g.stroke();
      } else if (s.kind === "highlight") {
        g.globalAlpha = 0.35;
        g.fillRect(x, y, w, h);
      } else if (s.kind === "blur" && w > 2 && h > 2) {
        // Pixelate the area.
        const cell = Math.max(8, Math.round(Math.min(img.width, img.height) * 0.018));
        const tmp = document.createElement("canvas");
        tmp.width = Math.max(1, Math.round(w / cell));
        tmp.height = Math.max(1, Math.round(h / cell));
        tmp.getContext("2d")!.drawImage(img, x, y, w, h, 0, 0, tmp.width, tmp.height);
        g.imageSmoothingEnabled = false;
        g.drawImage(tmp, 0, 0, tmp.width, tmp.height, x, y, w, h);
      } else if (s.kind === "arrow") {
        const angle = Math.atan2(s.y1 - s.y0, s.x1 - s.x0);
        const head = lw * 5;
        g.beginPath();
        g.moveTo(s.x0, s.y0);
        g.lineTo(s.x1 - Math.cos(angle) * head * 0.6, s.y1 - Math.sin(angle) * head * 0.6);
        g.stroke();
        g.beginPath();
        g.moveTo(s.x1, s.y1);
        g.lineTo(s.x1 - head * Math.cos(angle - 0.45), s.y1 - head * Math.sin(angle - 0.45));
        g.lineTo(s.x1 - head * Math.cos(angle + 0.45), s.y1 - head * Math.sin(angle + 0.45));
        g.closePath();
        g.fill();
      }
    }
    g.restore();
  };

  // On-screen scale: fit the composed picture in the view.
  const fitScale = () => {
    const img = image();
    if (!img) return 1;
    const pad = BACKGROUNDS[bg()][1] ? Math.max(img.width, img.height) * padding() : 0;
    const box = view.parentElement!.getBoundingClientRect();
    return Math.min((box.width - 32) / (img.width + pad * 2), (box.height - 32) / (img.height + pad * 2), 1) * (window.devicePixelRatio || 1);
  };
  const redraw = () => {
    const g = view.getContext("2d");
    if (!g) return;
    const scale = fitScale();
    paint(g, scale);
    view.style.width = `${view.width / (window.devicePixelRatio || 1)}px`;
    view.style.height = `${view.height / (window.devicePixelRatio || 1)}px`;
  };
  createEffect(on([image, shapes, draft, bg, padding, radius, shadow], redraw));

  /** Pointer → image pixel coordinates. */
  const toImage = (e: PointerEvent) => {
    const img = image()!;
    const rect = view.getBoundingClientRect();
    const pad = BACKGROUNDS[bg()][1] ? Math.max(img.width, img.height) * padding() : 0;
    const k = (img.width + pad * 2) / rect.width;
    return { x: (e.clientX - rect.left) * k - pad, y: (e.clientY - rect.top) * k - pad };
  };

  const down = (e: PointerEvent) => {
    if (!image()) return;
    const p = toImage(e);
    if (tool() === "text") {
      const stage = view.parentElement!.getBoundingClientRect();
      setTyping({ x: p.x, y: p.y, left: e.clientX - stage.left, top: e.clientY - stage.top });
      return;
    }
    const kind = tool() as "arrow" | "box" | "highlight" | "blur";
    setDraft({ kind, x0: p.x, y0: p.y, x1: p.x, y1: p.y, color: color() });
    view.setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent) => {
    const d = draft();
    if (!d || d.kind === "text") return;
    const p = toImage(e);
    setDraft({ ...d, x1: p.x, y1: p.y });
  };
  const up = () => {
    const d = draft();
    if (d && d.kind !== "text" && Math.hypot(d.x1 - d.x0, d.y1 - d.y0) > 4) setShapes([...shapes(), d]);
    setDraft(null);
  };

  const png = async () => {
    const c = document.createElement("canvas");
    paint(c.getContext("2d")!, 1);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/png"));
    return Array.from(new Uint8Array(await blob!.arrayBuffer()));
  };
  const copy = async () => {
    try {
      await invoke("screenshot_copy", { png: await png() });
      toast("Copied — paste it anywhere");
    } catch (e) {
      toast(String(e));
    }
  };
  const save = async () => {
    try {
      const path = await invoke<string>("screenshot_save", { png: await png(), path: null });
      toast(`Saved to ${path.split(/[\\/]/).slice(-2).join("/")}`);
    } catch (e) {
      toast(String(e));
    }
  };

  onMount(() => {
    void load();
    const focus = () => void load();
    const key = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === "c") void copy();
      else if (mod && e.key === "s") void save();
      else if (mod && e.key === "z") setShapes(shapes().slice(0, -1));
      else if (!mod && "abthx".includes(e.key)) setTool(({ a: "arrow", b: "box", t: "text", h: "highlight", x: "blur" } as const)[e.key as "a"]);
      else return;
      e.preventDefault();
    };
    const ro = new ResizeObserver(redraw);
    ro.observe(view.parentElement!);
    window.addEventListener("focus", focus);
    window.addEventListener("keydown", key);
    onCleanup(() => {
      ro.disconnect();
      window.removeEventListener("focus", focus);
      window.removeEventListener("keydown", key);
    });
  });

  const tools: [Tool, string, () => any][] = [
    ["arrow", "Arrow (A)", () => <ArrowUpRight size={17} />],
    ["box", "Box (B)", () => <Square size={17} />],
    ["text", "Text (T)", () => <Type size={17} />],
    ["highlight", "Highlight (H)", () => <Highlighter size={17} />],
    ["blur", "Blur (X)", () => <Grid2x2 size={17} />],
  ];

  return (
    <div class="shot">
      <header class="shot__bar">
        <div class="shot__tools">
          <For each={tools}>
            {([t, label, icon]) => (
              <IconButton label={label} active={tool() === t} onClick={() => setTool(t)}>
                {icon()}
              </IconButton>
            )}
          </For>
          <i class="shot__sep" />
          <For each={COLORS}>{(c) => <button type="button" class="shot__color" data-on={color() === c ? "true" : "false"} style={{ background: c }} onClick={() => setColor(c)} aria-label={c} />}</For>
          <i class="shot__sep" />
          <IconButton label="Undo (⌘Z)" onClick={() => setShapes(shapes().slice(0, -1))} disabled={!shapes().length}>
            <Undo2 size={17} />
          </IconButton>
        </div>
        <div class="shot__actions">
          <Button onClick={() => void save()}>
            <Download size={15} /> Save
          </Button>
          <Button variant="ink" onClick={() => void copy()}>
            <Copy size={15} /> Copy
          </Button>
        </div>
      </header>
      <main class="shot__main">
        <div class="shot__stage">
          <Show when={image()} fallback={<div class="shot__empty">Press ⌥⇧4 to take a screenshot.</div>}>
            <span />
          </Show>
          <canvas ref={view} onPointerDown={down} onPointerMove={move} onPointerUp={up} style={{ cursor: tool() === "text" ? "text" : "crosshair" }} />
          <Show when={typing()}>
            {(t) => (
              <input
                class="shot__text"
                style={{ left: `${t().left}px`, top: `${t().top - 16}px`, color: color() }}
                placeholder="Type, then Enter"
                autofocus
                ref={(el) => queueMicrotask(() => el.focus())}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") commitText(e.currentTarget.value);
                  if (e.key === "Escape") setTyping(null);
                }}
                onBlur={(e) => commitText(e.currentTarget.value)}
              />
            )}
          </Show>
        </div>
        <aside class="shot__side umi-panel">
          <div class="umi-field-label">Background</div>
          <div class="shot__bgs">
            <For each={BACKGROUNDS}>
              {([name, a, b], i) => (
                <button type="button" class="shot__bg" data-on={bg() === i() ? "true" : "false"} title={name} style={{ background: a ? `linear-gradient(135deg, ${a}, ${b})` : "repeating-conic-gradient(#e7edf4 0 25%, #fff 0 50%) 0 0 / 10px 10px" }} onClick={() => setBg(i())} />
              )}
            </For>
          </div>
          <Show when={bg() > 0}>
            <SliderField label="Padding" value={padding()} max={0.25} format={(v) => `${Math.round(v * 100)}%`} onInput={setPadding} />
            <SliderField label="Corners" value={radius()} max={0.08} format={(v) => `${Math.round((v / 0.08) * 100)}%`} onInput={setRadius} />
            <SliderField label="Shadow" value={shadow()} format={(v) => `${Math.round(v * 100)}%`} onInput={setShadow} />
          </Show>
        </aside>
      </main>
      <Toaster />
    </div>
  );
}
