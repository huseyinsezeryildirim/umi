// The website demo's first chapter: a Mac desktop where Umi records. The recorder card, the
// control bar, the layout column, the drawing tools and the ink layer are the app's own
// components; the rest of the desktop is scenery. A small card shows what viewers will see as
// the layout changes.
import { listen } from "@tauri-apps/api/event";
import { createEffect, createSignal, For, on, onCleanup, Show } from "solid-js";
import { Launcher } from "../recorder/Launcher";
import { Controls } from "../recorder/Controls";
import { Bubble } from "../recorder/Bubble";
import { Layouts } from "../recorder/Layouts";
import { Draw } from "../recorder/Draw";
import { Ink } from "../recorder/Ink";
import type { Layout } from "../recorder/api";
import cameraFace from "./camera.jpg";
import type { DemoStroke } from "./mock";

/** Kept for the editor chapter (the next page); private browsing may refuse. */
const keep = (key: string, value: string | null) => {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    // The editor then shows the sample as it is.
  }
};
import { tourIndex } from "./tour";
import wallpaper from "./wallpaper.jpg";
import screen from "./screen-a.jpg";
import "./desktop.css";

/** Where the cursor goes while recording (percent of the app window), and the clicks. */
const PATH: [number, number, number][] = [
  [0, 50, 70],
  [1.1, 30, 28],
  [2.2, 32, 30],
  [3.4, 66, 60],
  [4.6, 92, 12],
  [6, 88, 16],
];
const CLICKS = [1.2, 4.7];

export function DesktopDemo() {
  const [count, setCount] = createSignal<number | null>(null);
  const [recording, setRecording] = createSignal(false);
  // The camera bubble is the app's own, shown and sized the way the app asks for its window.
  const [bubble, setBubble] = createSignal(false);
  const [bubbleSize, setBubbleSize] = createSignal(220);
  const onWindow = (e: Event) => {
    const { view, shown } = (e as CustomEvent<{ view: string; shown: boolean }>).detail;
    if (view === "bubble") setBubble(shown);
  };
  const onResize = (e: Event) => {
    // Only the bubble asks for a square window.
    const { width, height } = (e as CustomEvent<{ width: number; height: number }>).detail;
    if (width === height) setBubbleSize(width);
  };
  addEventListener("demo:window", onWindow);
  addEventListener("demo:resize", onResize);
  onCleanup(() => (removeEventListener("demo:window", onWindow), removeEventListener("demo:resize", onResize)));
  // The layout picked in the column on the right (the preview card follows it).
  const [layout, setLayout] = createSignal<Layout>("default");
  // Seconds into the demo recording, so the editor shows things when they happened.
  const now = () => (performance.now() - ((window as unknown as { __demoRecStart?: number }).__demoRecStart ?? performance.now())) / 1000;
  let picks: { at: number; layout: Layout }[] = [];
  const offLayout = listen<Layout>("record:layout", (e) => {
    setLayout(e.payload);
    if (!recording()) return;
    picks = [...picks, { at: now(), layout: e.payload }];
    keep("umi.demo.layouts", JSON.stringify(picks));
  });
  onCleanup(() => void offLayout.then((f) => f()));

  // What the visitor draws, kept (0…1 of the app window) so the editor chapter shows it on the
  // sample recording (mock.ts).
  let app!: HTMLDivElement;
  let ink = { drawing: false, tool: "pointer", color: "#ff4d4d" };
  const strokes: DemoStroke[] = [];
  let stroke: DemoStroke | null = null;
  const offInk = listen<{ drawing: boolean; tool?: string; color?: string }>("ink:mode", (e) => {
    ink = { drawing: e.payload.drawing, tool: e.payload.tool ?? ink.tool, color: e.payload.color ?? ink.color };
  });
  const at = (e: PointerEvent): [number, number] => {
    const r = app.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
  };
  const down = (e: PointerEvent) => {
    // Only what's drawn on the ink layer (not clicks on the panels while a tool is on).
    if (!ink.drawing || !recording() || !(e.target as Element | null)?.closest?.(".ink")) return;
    stroke = { tool: ink.tool, color: ink.color, points: [at(e)], width: app.getBoundingClientRect().width, from: now(), until: now() };
  };
  const move = (e: PointerEvent) => {
    if (!stroke) return;
    if (stroke.tool === "arrow" || stroke.tool === "box") stroke.points[1] = at(e);
    else stroke.points.push(at(e));
  };
  const up = () => {
    if (!stroke) return;
    const [a, b] = [stroke.points[0], stroke.points[stroke.points.length - 1]];
    // A tap isn't a drawing.
    stroke.until = now();
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 0.01) strokes.push(stroke);
    stroke = null;
    keep("umi.demo.ink", JSON.stringify(strokes.slice(-20)));
  };
  addEventListener("pointerdown", down, true);
  addEventListener("pointermove", move, true);
  addEventListener("pointerup", up, true);
  onCleanup(() => {
    void offInk.then((f) => f());
    removeEventListener("pointerdown", down, true);
    removeEventListener("pointermove", move, true);
    removeEventListener("pointerup", up, true);
  });
  const [t, setT] = createSignal(0);
  // Steps (see tour.tsx): 0 menu bar, 1 camera, 2 start, 3 recording, 4–6 draw and layout, 7 stop.
  const launcher = () => tourIndex() >= 1 && tourIndex() <= 2;

  // The countdown carries on when the visitor clicks ahead; going back before it stops it.
  let timers: number[] = [];
  const stopCountdown = () => {
    timers.forEach(clearTimeout);
    timers = [];
    setCount(null);
  };
  onCleanup(stopCountdown);
  createEffect(
    on(tourIndex, (i) => {
      if (i < 3) stopCountdown();
      if (i === 3 && !recording() && !timers.length) {
        setCount(3);
        const a = window.setTimeout(() => setCount(2), 900);
        const b = window.setTimeout(() => setCount(1), 1800);
        const c = window.setTimeout(() => {
          timers = [];
          setCount(null);
          // A new recording: nothing drawn or picked yet.
          keep("umi.demo.ink", null);
          keep("umi.demo.layouts", null);
          keep("umi.demo.length", null);
          strokes.length = 0;
          picks = [];
          setRecording(true);
          (window as unknown as { __demoRecStart: number }).__demoRecStart = performance.now();
        }, 2700);
        timers = [a, b, c];
      }
    }),
  );

  // The cursor's walk over the app while recording.
  createEffect(() => {
    if (!recording()) return;
    const start = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      setT(((now - start) / 1000) % 7);
      frame = requestAnimationFrame(tick);
    });
    onCleanup(() => cancelAnimationFrame(frame));
  });
  const cursor = () => {
    const time = t();
    for (let k = 0; k < PATH.length - 1; k++) {
      const [t0, x0, y0] = PATH[k];
      const [t1, x1, y1] = PATH[k + 1];
      if (time >= t0 && time <= t1) {
        let f = (time - t0) / (t1 - t0);
        f = f * f * (3 - 2 * f);
        return [x0 + (x1 - x0) * f, y0 + (y1 - y0) * f];
      }
    }
    return [PATH[PATH.length - 1][1], PATH[PATH.length - 1][2]];
  };
  const ring = () => CLICKS.find((c) => t() >= c && t() < c + 0.6);

  return (
    <div class="desk" style={{ "background-image": `url(${wallpaper})` }}>
      <header class="desk__menubar">
        <svg viewBox="0 0 24 24" class="desk__apple" aria-hidden="true">
          <path fill="currentColor" d="M16.4 12.6c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.1-2.8.9-3.5.9-.7 0-1.8-.9-3-.8-1.5 0-3 .9-3.8 2.3-1.6 2.8-.4 7 1.2 9.3.8 1.1 1.7 2.4 2.9 2.3 1.2 0 1.6-.7 3-.7s1.8.7 3 .7c1.3 0 2.1-1.1 2.8-2.3.9-1.3 1.3-2.6 1.3-2.6s-2.5-1-2.5-3.8ZM14.1 5.8c.6-.8 1.1-1.9 1-3-.9 0-2.1.6-2.7 1.4-.6.7-1.1 1.8-1 2.9 1.1.1 2.1-.5 2.7-1.3Z" />
        </svg>
        <b>Finder</b>
        <For each={["File", "Edit", "View", "Go", "Window", "Help"]}>{(m) => <span>{m}</span>}</For>
        <span class="desk__spacer" />
        <button type="button" id="demo-umi" class="desk__umi" data-on={launcher() ? "true" : "false"} aria-label="Umi">
          <Show when={recording()} fallback={<img src="/umi-mark.svg" alt="" />}>
            <i class="desk__rec" />
          </Show>
        </button>
        <span>Sat 9:41</span>
      </header>

      <div class="desk__app" ref={app}>
        <img src={screen} alt="" />
        <Show when={recording()}>
          <svg viewBox="0 0 24 24" class="desk__cursor" style={{ left: `${cursor()[0]}%`, top: `${cursor()[1]}%` }}>
            <path d="M5 3l14 7.5-6.2 1.6L10 18.5z" fill="#000" stroke="#fff" stroke-width="1.5" stroke-linejoin="round" />
          </svg>
          <Show when={ring() !== undefined}>
            <span class="desk__ring" style={{ left: `${cursor()[0]}%`, top: `${cursor()[1]}%`, "--k": `${(t() - (ring() ?? 0)) / 0.6}` }} />
          </Show>
        </Show>
      </div>

      <Show when={launcher()}>
        <div class="desk__launcher">
          <Launcher />
        </div>
      </Show>

      <Show when={bubble()}>
        <div class="desk__bubble" style={{ width: `${bubbleSize() + 12}px`, height: `${bubbleSize() + 12}px` }}>
          <Bubble />
        </div>
      </Show>

      <Show when={count() !== null}>
        <div class="desk__countdown">
          <div class="countdown">
            <span class="countdown__n">{count()}</span>
          </div>
        </div>
      </Show>

      <Show when={recording()}>
        <div class="desk__ink">
          <Ink />
        </div>
        <div class="desk__controls">
          <Controls />
        </div>
        <div class="desk__layouts">
          <Layouts />
        </div>
        <div class="desk__draw">
          <Draw />
        </div>
        {/* What viewers see: the screen and the camera in the picked layout. */}
        <figure class="desk__preview" data-layout={layout()}>
          <img class="desk__preview-screen" src={screen} alt="" />
          <img class="desk__preview-camera" src={cameraFace} alt="" />
          <figcaption>What viewers see</figcaption>
        </figure>
      </Show>

      <div class="desk__dock">
        <For each={["#2f8cff", "#13d18e", "#ffb020", "#ff5f57", "#7a5af8"]}>{(c) => <i style={{ background: `linear-gradient(160deg, ${c}, ${c}cc)` }} />}</For>
        <i class="desk__dock-umi">
          <img src="/umi-mark.svg" alt="" />
        </i>
      </div>
    </div>
  );
}
