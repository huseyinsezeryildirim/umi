import { emit } from "@tauri-apps/api/event";
import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { Pause, Play, RotateCcw, Square, Trash2 } from "lucide-solid";
import { formatClock, recorder } from "./api";

/** The bar while recording: time, mic level, pause, stop, restart, discard. Draggable. */
export function Controls() {
  const [elapsed, setElapsed] = createSignal(0);
  const [paused, setPaused] = createSignal(false);
  const [level, setLevel] = createSignal(0);
  const [confirm, setConfirm] = createSignal(false);

  onMount(() => {
    const timer = window.setInterval(async () => {
      const s = await recorder.status();
      setElapsed(s.elapsed);
      setPaused(s.paused);
      setLevel(s.level);
    }, 100);
    onCleanup(() => window.clearInterval(timer));
  });

  const restart = async () => {
    await emit("record:discard");
    await new Promise((r) => setTimeout(r, 300));
    await emit("record:start");
  };

  return (
    <div class="controls" data-tauri-drag-region>
      <button type="button" class="controls__stop" onClick={() => void emit("record:stop")} title="Stop (⌥⇧L)">
        <Square size={13} fill="currentColor" />
      </button>
      <div class="controls__time" data-tauri-drag-region>
        <i data-paused={paused() ? "true" : "false"} />
        <span class="umi-tabular">{formatClock(elapsed())}</span>
      </div>
      <div class="controls__level" data-tauri-drag-region>
        <i style={{ transform: `scaleY(${Math.max(0.08, Math.min(1, level() * 1.6))})` }} />
        <i style={{ transform: `scaleY(${Math.max(0.08, Math.min(1, level() * 2.2))})` }} />
        <i style={{ transform: `scaleY(${Math.max(0.08, Math.min(1, level() * 1.3))})` }} />
      </div>
      <span class="controls__spacer" data-tauri-drag-region />
      <Show
        when={!confirm()}
        fallback={
          <>
            <button type="button" class="controls__text controls__text--danger" onClick={() => void emit("record:discard")}>
              Discard
            </button>
            <button type="button" class="controls__text" onClick={() => setConfirm(false)}>
              Keep
            </button>
          </>
        }
      >
        <button type="button" class="controls__btn" onClick={() => void emit("record:pause")} title={paused() ? "Resume (⌥⇧P)" : "Pause (⌥⇧P)"}>
          <Show when={paused()} fallback={<Pause size={15} fill="currentColor" />}>
            <Play size={15} fill="currentColor" />
          </Show>
        </button>
        <button type="button" class="controls__btn" onClick={() => void restart()} title="Start over">
          <RotateCcw size={15} />
        </button>
        <button type="button" class="controls__btn" onClick={() => setConfirm(true)} title="Discard (⌥⇧C)">
          <Trash2 size={15} />
        </button>
      </Show>
    </div>
  );
}
