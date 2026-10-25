"use client";

import { useEffect, useRef } from "react";

/**
 * The product in the hero: a recording being polished while you watch — the cursor
 * glides, clicks ring, the view zooms where the action is, keys and captions show up,
 * and the editor's playhead runs along zoom segments. One loop, driven by a single
 * animation frame (paused while off screen).
 */

const LOOP = 12;
type P = [number, number];
// Cursor path (percent of the screen) over time.
const PATH: [number, P][] = [
  [0, [72, 78]],
  [1.2, [38, 11]],
  [3.4, [38, 11]],
  [5.4, [84, 86]],
  [8.6, [84, 86]],
  [10.4, [60, 60]],
  [12, [72, 78]],
];
const CLICKS = [1.25, 5.5];
const ZOOMS = [
  { start: 0.9, end: 3.8, scale: 1.9, focus: [38, 14] as P },
  { start: 5.0, end: 8.6, scale: 2.2, focus: [80, 82] as P },
];
const KEYS = [1.4, 2.8];
const TYPED = "revenue";
const TYPE_AT = [1.7, 2.9];
const WORDS: [number, string][] = [
  [0.2, "Here’s"],
  [0.5, "the"],
  [0.7, "new"],
  [1.0, "dashboard."],
  [1.8, "Search"],
  [2.1, "anything"],
  [2.4, "with"],
  [2.7, "⌘K,"],
  [4.4, "then"],
  [4.7, "invite"],
  [5.0, "your"],
  [5.3, "team"],
  [5.8, "in"],
  [6.0, "one"],
  [6.3, "click."],
];

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));

function cursorAt(t: number): P {
  for (let i = 0; i < PATH.length - 1; i++) {
    const [t0, a] = PATH[i];
    const [t1, b] = PATH[i + 1];
    if (t >= t0 && t <= t1) {
      const k = ease((t - t0) / Math.max(t1 - t0, 1e-6));
      return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
    }
  }
  return PATH[0][1];
}

/** Zoom scale and focus at `t`, eased in and out over 0.7 s. */
function zoomAt(t: number) {
  for (const z of ZOOMS) {
    if (t >= z.start - 0.01 && t <= z.end + 0.01) {
      const k = ease(clamp((t - z.start) / 0.7)) * ease(clamp((z.end - t) / 0.7));
      return { scale: 1 + (z.scale - 1) * k, focus: z.focus, k };
    }
  }
  return { scale: 1, focus: [50, 50] as P, k: 0 };
}

export function Demo() {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const q = <T extends HTMLElement>(sel: string) => el.querySelector<T>(sel)!;
    const screen = q("[data-screen]");
    const cursor = q("[data-cursor]");
    const ring = q("[data-ring]");
    const keys = q("[data-keys]");
    const caption = q("[data-caption]");
    const typed = q("[data-typed]");
    const playhead = q("[data-playhead]");
    const segs = [...el.querySelectorAll<HTMLElement>("[data-seg]")];
    const button = q("[data-target]");
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

    let visible = true;
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    io.observe(el);
    const start = performance.now();
    let frame = 0;
    let lastWords = "";

    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      if (!visible) return;
      const t = reduced ? 2.2 : ((now - start) / 1000) % LOOP;
      const [cx, cy] = cursorAt(t);
      const z = zoomAt(t);
      // Zoom toward the focus point, but keep the edges inside the frame.
      const fx = 50 + (z.focus[0] - 50) * z.k;
      const fy = 50 + (z.focus[1] - 50) * z.k;
      screen.style.transformOrigin = `${fx}% ${fy}%`;
      screen.style.transform = `scale(${z.scale.toFixed(4)})`;
      cursor.style.left = `${cx}%`;
      cursor.style.top = `${cy}%`;
      cursor.style.transform = `translate(-18%, -12%) scale(${1 / z.scale})`;

      const click = CLICKS.find((c) => t >= c && t < c + 0.6);
      if (click !== undefined) {
        const k = (t - click) / 0.6;
        ring.style.left = `${cx}%`;
        ring.style.top = `${cy}%`;
        ring.style.opacity = `${1 - k}`;
        ring.style.transform = `translate(-50%, -50%) scale(${(0.4 + k * 1.4) / z.scale})`;
      } else ring.style.opacity = "0";

      keys.style.opacity = t >= KEYS[0] && t < KEYS[1] ? "1" : "0";
      keys.style.transform = `translate(-50%, ${t >= KEYS[0] && t < KEYS[1] ? 0 : 8}px)`;

      const n = clamp((t - TYPE_AT[0]) / (TYPE_AT[1] - TYPE_AT[0])) * TYPED.length;
      typed.textContent = t < TYPE_AT[0] || t > 4.6 ? "" : TYPED.slice(0, Math.round(n));
      button.dataset.pressed = t >= 5.5 && t < 5.75 ? "true" : "false";
      button.dataset.done = t >= 5.75 && t < 9 ? "true" : "false";

      // Captions: the current sentence, word by word, the newest word highlighted.
      const sentenceStart = t < 1.8 ? 0 : t < 4.4 ? 4 : 8;
      const shown = WORDS.slice(sentenceStart).filter(([w], i) => w <= t && (i === 0 || t < 7.4));
      const words = t > 7.4 ? "" : shown.map(([, w]) => w).join(" ");
      if (words !== lastWords) {
        lastWords = words;
        caption.innerHTML = shown
          .map(([, w], i) => `<span class="${i === shown.length - 1 ? "text-white" : "text-white/70"}">${w}</span>`)
          .join(" ");
        caption.style.opacity = words ? "1" : "0";
      }

      playhead.style.left = `${(t / LOOP) * 100}%`;
      segs.forEach((s, i) => (s.dataset.on = t >= ZOOMS[i].start && t <= ZOOMS[i].end ? "true" : "false"));
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      io.disconnect();
    };
  }, []);

  return (
    <div
      ref={root}
      role="img"
      aria-label="Umi turning a screen recording into a polished video: zooms follow the cursor, captions appear as you speak"
      className="overflow-hidden rounded-[22px] bg-white text-left shadow-[0_0_0_1px_rgb(14_17_30/0.08),0_40px_100px_-20px_rgb(17_60_130/0.35)]"
    >
      {/* Window bar */}
      <div className="flex h-11 items-center gap-3 border-b border-hairline px-4">
        <span className="flex gap-1.5">
          <i className="size-3 rounded-full bg-[#ff5f57]" />
          <i className="size-3 rounded-full bg-[#febc2e]" />
          <i className="size-3 rounded-full bg-[#28c840]" />
        </span>
        <span className="truncate text-[13px] font-semibold">Product demo</span>
        <span className="ml-auto rounded-lg bg-tint px-3 py-1 text-xs font-medium text-accent">Share</span>
        <span className="rounded-lg bg-ink px-3 py-1 text-xs font-semibold text-white">Export</span>
      </div>

      <div className="flex">
        {/* Canvas: the recording on a gradient, with camera and captions */}
        <div className="relative flex-1 bg-[#f6f9fd] p-3 sm:p-5">
          <div className="relative aspect-[16/10] overflow-hidden rounded-2xl bg-[linear-gradient(135deg,#9eccfa,#2e5eb8)] p-[5%]">
            <div className="relative size-full overflow-hidden rounded-xl bg-white shadow-[0_20px_50px_rgb(10_30_80/0.35)]">
              <div data-screen className="absolute inset-0 will-change-transform">
                <FakeApp />
                <svg data-cursor viewBox="0 0 24 24" className="absolute z-20 size-[5.5%] min-w-3 drop-shadow-[0_2px_3px_rgb(0_0_0/0.3)]">
                  <path d="M5 3l14 7.5-6.2 1.6L10 18.5z" fill="#0e111e" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" />
                </svg>
                <span data-ring className="absolute z-10 size-[9%] rounded-full border-2 border-accent bg-accent/15 opacity-0" />
              </div>
              <span
                data-keys
                className="absolute bottom-[7%] left-1/2 z-30 flex gap-1 rounded-xl bg-ink/85 p-1.5 opacity-0 backdrop-blur transition-all duration-300 [&_kbd]:h-6 [&_kbd]:min-w-6 [&_kbd]:text-[11px]"
              >
                <kbd>⌘</kbd>
                <kbd>K</kbd>
              </span>
            </div>
            {/* Camera bubble */}
            <div className="absolute bottom-[6%] left-[3%] z-30 aspect-square w-[15%] animate-float overflow-hidden rounded-full border-[3px] border-white bg-[radial-gradient(circle_at_50%_38%,#f5d3b8_0_17%,transparent_18%),radial-gradient(ellipse_at_50%_100%,#2e3b55_0_42%,transparent_43%),linear-gradient(160deg,#cfe3f8,#8fb6e6)] shadow-[0_10px_30px_rgb(0_0_0/0.3)]" />
            {/* Captions */}
            <div
              data-caption
              className="absolute bottom-[4%] left-1/2 z-30 max-w-[70%] -translate-x-1/2 rounded-lg bg-ink/80 px-3 py-1.5 text-center text-[clamp(9px,1.4vw,15px)] font-semibold opacity-0 backdrop-blur transition-opacity duration-300"
            />
          </div>
        </div>
        {/* Inspector */}
        <aside aria-hidden className="hidden w-52 shrink-0 border-l border-hairline p-4 text-xs lg:block">
          <p className="mb-2 font-semibold">Background</p>
          <div className="mb-4 grid grid-cols-4 gap-1.5">
            {["#9eccfa,#2e5eb8", "#f2f7fc,#ccdff7", "#fa736b,#6b4adb", "#8cedc2,#1c8c8c"].map((g, i) => (
              <i key={g} className={`aspect-square rounded-lg bg-[linear-gradient(135deg,${g.split(",")[0]},${g.split(",")[1]})] ${i === 0 ? "ring-2 ring-accent ring-offset-2" : ""}`} style={{ background: `linear-gradient(135deg, ${g})` }} />
            ))}
          </div>
          {[
            ["Auto zoom", true],
            ["Captions", true],
            ["Smooth cursor", true],
            ["Remove “um”s", false],
          ].map(([label, on]) => (
            <div key={label as string} className="mb-2.5 flex items-center justify-between">
              <span className="text-text">{label}</span>
              <span className={`relative h-4 w-7 rounded-full ${on ? "bg-accent" : "bg-ink/15"}`}>
                <i className={`absolute top-0.5 size-3 rounded-full bg-white shadow ${on ? "left-3.5" : "left-0.5"}`} />
              </span>
            </div>
          ))}
          <p className="mt-4 mb-2 font-semibold">Padding</p>
          <div className="h-1.5 rounded-full bg-ink/10">
            <div className="h-full w-3/5 rounded-full bg-accent" />
          </div>
        </aside>
      </div>

      {/* Timeline */}
      <div aria-hidden className="relative border-t border-hairline px-4 py-3">
        <div className="mb-2 flex h-7 gap-1">
          <i className="flex-[7] rounded-md bg-[repeating-linear-gradient(90deg,#c9dcf3_0_18px,#b6cff0_18px_36px)]" />
          <i className="flex-[5] rounded-md bg-[repeating-linear-gradient(90deg,#c9dcf3_0_18px,#b6cff0_18px_36px)]" />
        </div>
        <div className="relative h-6">
          {ZOOMS.map((z, i) => (
            <b
              key={i}
              data-seg={i}
              style={{ left: `${(z.start / LOOP) * 100}%`, width: `${((z.end - z.start) / LOOP) * 100}%` }}
              className="absolute top-0 grid h-full place-items-center rounded-md bg-tint text-[11px] font-semibold text-accent transition-colors duration-300 data-[on=true]:bg-accent data-[on=true]:text-white"
            >
              {z.scale}× zoom
            </b>
          ))}
        </div>
        <span data-playhead className="absolute top-1 bottom-1 w-0.5 -translate-x-1/2 rounded bg-record shadow-[0_0_0_3px_rgb(255_77_77/0.15)]" />
      </div>
    </div>
  );
}

/** The app being recorded: a little analytics dashboard. */
function FakeApp() {
  return (
    <div className="flex size-full bg-[#fbfcfe] text-[clamp(6px,1vw,12px)]">
      <aside className="flex w-[13%] flex-col items-center gap-[6%] border-r border-hairline py-[4%]">
        <span className="mark size-[45%] text-accent" />
        {[0, 1, 2, 3, 4].map((i) => (
          <i key={i} className={`h-[3.5%] w-[48%] rounded ${i === 2 ? "bg-accent/70" : "bg-ink/10"}`} />
        ))}
      </aside>
      <div className="flex flex-1 flex-col gap-[4%] p-[4%]">
        <div className="flex items-center gap-[3%]">
          <div className="flex h-[1.9em] flex-1 items-center gap-1 rounded-md bg-ink/5 px-[2%] text-muted">
            <span>⌕</span>
            <b data-typed className="font-medium text-ink" />
            <span className="h-[1em] w-px animate-pulse bg-accent" />
          </div>
          <i className="size-[1.9em] rounded-full bg-[linear-gradient(135deg,#ffcc9e,#f57885)]" />
        </div>
        <div className="grid flex-1 grid-cols-2 gap-[4%]">
          {[
            ["Revenue", "$48.2k", "M0 24 L15 20 L30 22 L45 14 L60 16 L75 8 L100 4"],
            ["Active users", "12,840", "M0 20 L20 18 L40 21 L55 12 L70 13 L85 6 L100 7"],
          ].map(([label, value, d]) => (
            <div key={label} className="flex flex-col rounded-lg bg-white p-[6%] shadow-[0_0_0_1px_rgb(14_17_30/0.06)]">
              <small className="text-muted">{label}</small>
              <strong className="text-[1.5em] tracking-tight">{value}</strong>
              <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="mt-auto h-[35%] w-full">
                <path d={d} fill="none" stroke="#116ff5" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
              </svg>
            </div>
          ))}
          <div className="col-span-2 flex flex-col rounded-lg bg-white p-[3%] shadow-[0_0_0_1px_rgb(14_17_30/0.06)]">
            <small className="text-muted">This week</small>
            <div className="mt-[2%] flex flex-1 items-end gap-[3%]">
              {[40, 62, 48, 80, 66, 92, 74].map((h, i) => (
                <i key={i} style={{ height: `${h}%` }} className="flex-1 rounded-t bg-[linear-gradient(180deg,#6fb5ef,#116ff5)]" />
              ))}
            </div>
          </div>
        </div>
        <div className="flex justify-end">
          <span
            data-target
            className="rounded-md bg-ink px-[3%] py-[1.2%] font-semibold text-white transition-all duration-200 data-[done=true]:bg-[#13a874] data-[pressed=true]:scale-95"
          >
            Invite team
          </span>
        </div>
      </div>
    </div>
  );
}
