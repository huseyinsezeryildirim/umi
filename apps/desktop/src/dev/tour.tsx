// The website's guided demo (demo build, `?tour`): first a recording on a Mac desktop
// (`?view=desktop`), then the real editor (`?open&from=N` continues the tour there).
// One thing is lit at a time with a numbered hint; clicking it moves on. Clicks elsewhere
// are held back (the hint gives a little shake) so people can't get lost.
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import "./tour.css";

type Chapter = "Record" | "Look" | "Captions" | "Share";
interface Step {
  chapter: Chapter;
  text: string;
  /** What to light up; `null` = nothing to click, moves on by itself. */
  target: (() => Element | null) | null;
  /** For steps without a target: how long to wait. */
  wait?: number;
}

const byText = (selector: string, text: string) => () => [...document.querySelectorAll(selector)].find((e) => e.textContent?.trim().startsWith(text)) ?? null;
const sel = (selector: string) => () => document.querySelector(selector);

const STEPS: Step[] = [
  { chapter: "Record", text: "Click Umi in the menu bar.", target: sel("#demo-umi") },
  { chapter: "Record", text: "Turn on your camera to be in the video too.", target: () => document.querySelectorAll(".rec-row")[1] ?? null },
  { chapter: "Record", text: "Press Start recording.", target: sel(".rec-start") },
  { chapter: "Record", text: "Umi records your screen, camera and voice. Clicks are kept for the edit.", target: null, wait: 7200 },
  { chapter: "Record", text: "Click Stop. The editor opens with the recording.", target: sel(".controls__stop") },
  { chapter: "Look", text: "Pick a background. The whole video changes at once.", target: sel('.umi-swatch[aria-label="dusk"]') },
  { chapter: "Look", text: "Press play. Umi zooms in wherever the cursor clicks.", target: sel(".ed-play") },
  { chapter: "Look", text: "No keyframes: the zooms come from your clicks.", target: null, wait: 5200 },
  { chapter: "Captions", text: "Open Captions.", target: sel('[aria-label="Captions & transcript"]') },
  { chapter: "Captions", text: "Transcribe the voice. It runs on your computer.", target: byText(".ed-inspector button", "Generate captions") },
  { chapter: "Captions", text: "Captions are in. Press play to watch them.", target: sel(".ed-play") },
  { chapter: "Share", text: "Click Share to get a link.", target: byText(".ed-topbar button", "Share") },
  { chapter: "Share", text: "Copy it. People watch in their browser and you see who did.", target: byText("[role=dialog] button", "Copy") },
  { chapter: "Share", text: "Or export a file: MP4, MOV or GIF, up to 4K.", target: byText(".ed-topbar button", "Export") },
];
const CHAPTERS: { name: Chapter; color: string; tint: string }[] = [
  { name: "Record", color: "#d92d20", tint: "#fee4e2" },
  { name: "Look", color: "#116ff5", tint: "#dbeafe" },
  { name: "Captions", color: "#7c4dff", tint: "#ede7ff" },
  { name: "Share", color: "#e8590c", tint: "#ffe8d9" },
];

/** The current step, for the desktop scene to follow. */
const [index, setIndex] = createSignal(-1);
export const tourIndex = index;
const params = new URLSearchParams(location.search);
const onDesktop = params.get("view") === "desktop";
const FIRST_EDITOR_STEP = STEPS.findIndex((s) => s.chapter !== "Record");

export function Tour() {
  const [rect, setRect] = createSignal<DOMRect | null>(null);
  const [shake, setShake] = createSignal(0);
  const step = () => STEPS[index()];
  const chapter = () => CHAPTERS.find((c) => c.name === step()?.chapter) ?? CHAPTERS[0];
  const done = () => index() >= STEPS.length;

  let frame = 0;
  let waiting = 0;
  /** Set while the tour clicks something itself (closing the share window). */
  let bypass = false;
  const follow = () => {
    const s = step();
    const el = s?.target?.();
    setRect(el ? el.getBoundingClientRect() : null);
    frame = requestAnimationFrame(follow);
  };
  const go = (i: number) => {
    clearTimeout(waiting);
    // The recording is done: on to the editor, where the tour carries on.
    if (onDesktop && i >= FIRST_EDITOR_STEP && i < STEPS.length) {
      setTimeout(() => location.replace(`?demo&open&tour&from=${i}`), 250);
      return;
    }
    // Close the share window when the tour moves past it.
    const close = byText("[role=dialog] button", "Done")() as HTMLElement | null;
    if (STEPS[i]?.text.startsWith("Or export") && close) {
      bypass = true;
      close.click();
      bypass = false;
    }
    setIndex(i);
    const s = STEPS[i];
    if (s && !s.target) waiting = window.setTimeout(() => go(i + 1), s.wait ?? 3000);
  };

  onMount(() => {
    setTimeout(() => go(Number(params.get("from")) || 0), 900);
    frame = requestAnimationFrame(follow);
    // Only the lit thing (and the tour itself) can be clicked.
    const guard = (e: MouseEvent) => {
      const s = step();
      if (bypass || !s || done()) return;
      const t = e.target as Element;
      if (t.closest(".demo-tour")) return;
      const el = s.target?.();
      if (el && el.contains(t)) {
        if (e.type === "click") setTimeout(() => go(index() + 1), s.text.startsWith("Press play") ? 400 : 450);
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (e.type === "click") setShake((v) => v + 1);
    };
    for (const type of ["pointerdown", "mousedown", "click"]) document.addEventListener(type, guard as EventListener, true);
    onCleanup(() => {
      cancelAnimationFrame(frame);
      clearTimeout(waiting);
      for (const type of ["pointerdown", "mousedown", "click"]) document.removeEventListener(type, guard as EventListener, true);
    });
  });

  /** Where the hint sits: left of the target when there's room, else below/above. */
  const hint = () => {
    const r = rect();
    const W = 300;
    if (!r) return { left: innerWidth / 2 - W / 2, top: innerHeight * 0.38 };
    if (r.left > W + 40) return { left: r.left - W - 18, top: Math.min(Math.max(16, r.top + r.height / 2 - 50), innerHeight - 140) };
    const below = r.bottom + 120 < innerHeight;
    return { left: Math.min(Math.max(16, r.left + r.width / 2 - W / 2), innerWidth - W - 16), top: below ? r.bottom + 16 : r.top - 126 };
  };

  const restart = () => {
    setIndex(-1);
    location.replace("?view=desktop&demo&tour");
  };

  return (
    <div class="demo-tour">
      <Show when={!done() && index() >= 0}>
        {/* Dim everything but the target. */}
        <Show
          when={rect()}
          fallback={<div class="demo-tour__dim" />}
        >
          {(r) => (
            <>
              <div class="demo-tour__hole" style={{ left: `${r().left - 6}px`, top: `${r().top - 6}px`, width: `${r().width + 12}px`, height: `${r().height + 12}px` }} />
              <div class="demo-tour__ring" style={{ left: `${r().left - 6}px`, top: `${r().top - 6}px`, width: `${r().width + 12}px`, height: `${r().height + 12}px`, "border-color": chapter().color }} />
            </>
          )}
        </Show>
        <div class="demo-tour__hint" data-shake={shake() % 2 ? "a" : "b"} style={{ left: `${hint().left}px`, top: `${hint().top}px` }}>
          <span class="demo-tour__chip" style={{ background: chapter().tint, color: chapter().color }}>
            {step().chapter}
          </span>
          <p>
            <b style={{ background: chapter().tint, color: chapter().color }}>{index() + 1}</b>
            <span>{step().text}</span>
          </p>
        </div>
      </Show>

      <Show when={done()}>
        <div class="demo-tour__dim" />
        <div class="demo-tour__end">
          <span class="demo-tour__chip" style={{ background: "#dcfce7", color: "#15803d" }}>
            Demo complete
          </span>
          <h2>Try Umi for yourself</h2>
          <p>Free for Mac, Windows and Linux. Record, edit and share in minutes.</p>
          <div>
            <a class="demo-tour__primary" href="/#download" target="_top">
              Download Umi free
            </a>
            <button type="button" onClick={restart}>
              Replay the demo
            </button>
          </div>
        </div>
      </Show>

      {/* Chapters and progress. */}
      <div class="demo-tour__bar">
        <For each={CHAPTERS}>
          {(c) => (
            <span class="demo-tour__chapter" style={step()?.chapter === c.name && !done() ? { background: c.tint, color: c.color } : {}}>
              {c.name}
            </span>
          )}
        </For>
        <span class="demo-tour__progress">
          <i style={{ width: `${(Math.min(index() + 1, STEPS.length) / STEPS.length) * 100}%` }} />
        </span>
        <span class="demo-tour__count">
          {Math.max(1, Math.min(index() + 1, STEPS.length))} / {STEPS.length}
        </span>
        <Show when={!done()} fallback={<button type="button" onClick={restart}>Replay</button>}>
          <button type="button" onClick={() => go(STEPS.length)}>
            Skip demo
          </button>
        </Show>
      </div>
    </div>
  );
}
