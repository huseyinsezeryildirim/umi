// The website's guided demo (demo build, `?tour`): first a recording on a Mac desktop
// (`?view=desktop`), then the real editor (`?open&from=N` continues the tour there).
// A small card suggests the next thing and rings it; doing it moves on, and Back/Next are
// always there. Nothing is dimmed or blocked: visitors can click around the app freely.
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
  const step = () => STEPS[index()];
  const chapter = () => CHAPTERS.find((c) => c.name === step()?.chapter) ?? CHAPTERS[0];
  const done = () => index() >= STEPS.length;

  let frame = 0;
  let waiting = 0;
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
    if (STEPS[i]?.text.startsWith("Or export") && close) close.click();
    setIndex(i);
    const s = STEPS[i];
    if (s && !s.target) waiting = window.setTimeout(() => go(i + 1), s.wait ?? 3000);
  };

  onMount(() => {
    setTimeout(() => go(Number(params.get("from")) || 0), 900);
    frame = requestAnimationFrame(follow);
    // Doing the suggested thing moves on; everything else still works as usual.
    const watch = (e: MouseEvent) => {
      const s = step();
      if (!s || done() || !s.target) return;
      const el = s.target();
      const t = e.target as Element;
      if (el && el.contains(t) && !t.closest(".demo-tour")) {
        const at = index();
        setTimeout(() => index() === at && go(at + 1), s.text.startsWith("Press play") ? 400 : 450);
      }
    };
    document.addEventListener("click", watch, true);
    onCleanup(() => {
      cancelAnimationFrame(frame);
      clearTimeout(waiting);
      document.removeEventListener("click", watch, true);
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

  /** Next: does the suggested thing (so the app keeps up), or just moves on. */
  const next = () => {
    const el = step()?.target?.() as HTMLElement | null | undefined;
    if (el) el.click();
    else go(index() + 1);
  };
  // Back within this page (the desktop scene and the editor are separate pages).
  const canBack = () => index() > (onDesktop ? 0 : FIRST_EDITOR_STEP);

  const restart = () => {
    setIndex(-1);
    location.replace("?view=desktop&demo&tour");
  };

  return (
    <div class="demo-tour">
      <Show when={!done() && index() >= 0}>
        {/* A ring around the suggestion; the rest of the app stays as it is. */}
        <Show when={rect()}>
          {(r) => <div class="demo-tour__ring" style={{ left: `${r().left - 6}px`, top: `${r().top - 6}px`, width: `${r().width + 12}px`, height: `${r().height + 12}px`, "border-color": chapter().color }} />}
        </Show>
        <div class="demo-tour__hint" style={{ left: `${hint().left}px`, top: `${hint().top}px` }}>
          <span class="demo-tour__chip" style={{ background: chapter().tint, color: chapter().color }}>
            {step().chapter}
          </span>
          <p>
            <b style={{ background: chapter().tint, color: chapter().color }}>{index() + 1}</b>
            <span>{step().text}</span>
          </p>
          <Show when={!step().target}>
            {/* Moves on by itself: how long until it does. */}
            <span class="demo-tour__wait">
              <i style={{ "animation-duration": `${step().wait ?? 3000}ms` }} />
            </span>
          </Show>
          <div class="demo-tour__nav">
            <Show when={canBack()}>
              <button type="button" onClick={() => go(index() - 1)}>
                Back
              </button>
            </Show>
            <button type="button" class="demo-tour__next" style={{ background: chapter().color }} onClick={next}>
              Next
            </button>
          </div>
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
