import { listen } from "@tauri-apps/api/event";
import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { Minus, Pause, Play, Plus, X } from "lucide-solid";
import { recorder, type RecordSettings } from "./api";

/**
 * Speaker notes near the camera, never in the recording. Before recording you write or
 * paste them; while recording they scroll at your pace.
 */
export function Prompter() {
  let scroller!: HTMLDivElement;
  const [settings, setSettings] = createSignal<RecordSettings | null>(null);
  const [rolling, setRolling] = createSignal(false);
  const [recording, setRecording] = createSignal(false);

  const save = (change: (s: RecordSettings) => void) => {
    const next = structuredClone(settings()!);
    change(next);
    setSettings(next);
    void recorder.save(next);
  };

  onMount(async () => {
    setSettings(await recorder.settings());
    setRecording((await recorder.status()).recording);
    const off = listen<string>("recording", (e) => {
      const on = e.payload === "started" || e.payload === "resumed";
      setRecording(e.payload !== "stopped" && e.payload !== "cancelled");
      setRolling(on);
      if (e.payload === "started") scroller.scrollTop = 0;
    });
    // Scroll: lines per minute → pixels per frame.
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const s = settings();
      if (rolling() && s) scroller.scrollTop += ((s.notesSpeed * s.notesSize * 1.5) / 60) * dt;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    onCleanup(() => {
      cancelAnimationFrame(raf);
      void off.then((f) => f());
    });
  });

  return (
    <Show when={settings()}>
      {(s) => (
        <div class="prompter" data-tauri-drag-region>
          <div class="prompter__bar" data-tauri-drag-region>
            <span data-tauri-drag-region>Notes · only you see this</span>
            <span class="rec-spacer" data-tauri-drag-region />
            <button type="button" title={rolling() ? "Hold" : "Roll"} onClick={() => setRolling(!rolling())}>
              <Show when={rolling()} fallback={<Play size={13} fill="currentColor" />}>
                <Pause size={13} fill="currentColor" />
              </Show>
            </button>
            <button type="button" title="Slower" onClick={() => save((x) => (x.notesSpeed = Math.max(4, x.notesSpeed - 4)))}>
              <Minus size={13} />
            </button>
            <span class="prompter__speed">{Math.round(s().notesSpeed)}</span>
            <button type="button" title="Faster" onClick={() => save((x) => (x.notesSpeed = Math.min(80, x.notesSpeed + 4)))}>
              <Plus size={13} />
            </button>
            <button type="button" title="Smaller text" onClick={() => save((x) => (x.notesSize = Math.max(14, x.notesSize - 2)))}>
              A−
            </button>
            <button type="button" title="Bigger text" onClick={() => save((x) => (x.notesSize = Math.min(44, x.notesSize + 2)))}>
              A+
            </button>
            <button type="button" title="Close notes" onClick={() => void recorder.hide("prompter")}>
              <X size={13} />
            </button>
          </div>
          <div ref={scroller} class="prompter__text" style={{ "font-size": `${s().notesSize}px` }}>
            <Show
              when={!recording()}
              fallback={
                <>
                  <div class="prompter__pad" />
                  {s().notes || "Write your notes before you start."}
                  <div class="prompter__pad" />
                </>
              }
            >
              <textarea placeholder="Write or paste what you want to say…" value={s().notes} onInput={(e) => save((x) => (x.notes = e.currentTarget.value))} style={{ "font-size": `${s().notesSize}px` }} />
            </Show>
          </div>
        </div>
      )}
    </Show>
  );
}
