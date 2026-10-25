// The website demo's first chapter: a Mac desktop where Umi records. The recorder card and
// the control bar are the app's own components; the rest of the desktop is scenery.
import { createEffect, createSignal, For, on, onCleanup, Show } from "solid-js";
import { Launcher } from "../recorder/Launcher";
import { Controls } from "../recorder/Controls";
import { tourIndex } from "./tour";
import wallpaper from "./wallpaper.jpg";
import screen from "./screen-a.jpg";
import webcam from "./camera.mp4";
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
  const [camera, setCamera] = createSignal(false);
  const [t, setT] = createSignal(0);
  // Steps (see tour.tsx): 0 menu bar, 1 camera, 2 start, 3 recording, 4 stop.
  const launcher = () => tourIndex() >= 1 && tourIndex() <= 2;

  createEffect(
    on(tourIndex, (i) => {
      if (i === 2) setCamera(true);
      if (i === 3 && !recording()) {
        setCount(3);
        const a = setTimeout(() => setCount(2), 900);
        const b = setTimeout(() => setCount(1), 1800);
        const c = setTimeout(() => {
          setCount(null);
          setRecording(true);
          (window as unknown as { __demoRecStart: number }).__demoRecStart = performance.now();
        }, 2700);
        onCleanup(() => [a, b, c].forEach(clearTimeout));
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

      <div class="desk__app">
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

      <Show when={camera()}>
        <div class="desk__bubble">
          <video src={webcam} autoplay muted loop playsinline />
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
        <div class="desk__controls">
          <Controls />
        </div>
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
