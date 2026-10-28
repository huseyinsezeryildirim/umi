import { emit } from "@tauri-apps/api/event";
import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { Camera, CameraOff, MonitorUp, Pause, Play, RotateCcw, Trash2 } from "lucide-solid";
import { formatClock, recorder } from "./api";

/** The bar while recording, a column on the left like the web recorder's, in groups: stop and
 *  time · pause and start over · camera · discard. Draggable. (Drawing is along the bottom, Draw.tsx.) */
export function Controls() {
  const [elapsed, setElapsed] = createSignal(0);
  const [paused, setPaused] = createSignal(false);
  const [confirm, setConfirm] = createSignal(false);
  /** Whether this recording has a camera, and whether it's showing. */
  const [hasCamera, setHasCamera] = createSignal(false);
  const [cameraOn, setCameraOn] = createSignal(true);

  onMount(() => {
    void recorder.settings().then((s) => setHasCamera(s.cameraOn && !s.cameraOnly));
    // Made ahead and hidden until a recording starts: only ask while it's showing.
    const timer = window.setInterval(async () => {
      if (document.hidden) return;
      const s = await recorder.status();
      setElapsed(s.elapsed);
      setPaused(s.paused);
      setCameraOn(s.cameraVisible);
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
      <button type="button" class="controls__btn controls__stop" onClick={() => void emit("record:stop")} title="Stop (⌥⇧L)">
        <span />
      </button>
      <span class="controls__time umi-tabular" data-paused={paused() ? "true" : "false"} data-tauri-drag-region>
        {formatClock(elapsed())}
      </span>
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
        <i class="controls__line" />
        <button type="button" class="controls__btn" onClick={() => void emit("record:pause")} title={paused() ? "Resume (⌥⇧P)" : "Pause (⌥⇧P)"}>
          <Show when={paused()} fallback={<Pause size={19} fill="currentColor" />}>
            <Play size={19} fill="currentColor" />
          </Show>
        </button>
        <button type="button" class="controls__btn" onClick={() => void restart()} title="Start over">
          <RotateCcw size={19} />
        </button>
        <i class="controls__line" />
        <button type="button" class="controls__btn" onClick={() => void recorder.show("sources")} title="Record another screen or window">
          <MonitorUp size={19} />
        </button>
        <Show when={hasCamera()}>
          <button
            type="button"
            class="controls__btn"
            onClick={() => {
              setCameraOn(!cameraOn());
              void recorder.camera(cameraOn());
            }}
            title={cameraOn() ? "Turn the camera off" : "Turn the camera on"}
          >
            <Show when={cameraOn()} fallback={<CameraOff size={19} />}>
              <Camera size={19} />
            </Show>
          </button>
          <i class="controls__line" />
        </Show>
        <button type="button" class="controls__btn controls__btn--danger" onClick={() => setConfirm(true)} title="Discard (⌥⇧C)">
          <Trash2 size={19} />
        </button>
      </Show>
    </div>
  );
}
