import { listen } from "@tauri-apps/api/event";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { FlipHorizontal2, Sparkles, X } from "lucide-solid";
import { recorder, type CameraStyle, type RecordSettings } from "./api";

const SIZES = { S: 160, M: 220, L: 300 } as const;

/** The camera bubble: always on top, draggable; size, shape and mirror on hover. */
export function Bubble() {
  const [settings, setSettings] = createSignal<RecordSettings | null>(null);
  const [frame, setFrame] = createSignal<string | null>(null);
  const [hover, setHover] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  let lastUrl: string | null = null;

  /** Reads the settings, fits the window and starts the camera (again after being hidden). */
  const start = async () => {
    const s = await recorder.settings();
    setSettings(s);
    setFrame(null);
    void recorder.resize(sizeOf(s.cameraStyle), sizeOf(s.cameraStyle));
    await recorder.cameraPreview(s.camera ?? "", (jpeg) => {
      const url = URL.createObjectURL(new Blob([jpeg], { type: "image/jpeg" }));
      setFrame(url);
      if (lastUrl) URL.revokeObjectURL(lastUrl);
      lastUrl = url;
    });
  };
  onMount(() => {
    void start().catch((e) => setError(String(e)));
    const off = listen("bubble:shown", () => void start().catch((e) => setError(String(e))));
    onCleanup(() => {
      void off.then((f) => f());
      void recorder.cameraPreview(null, () => {});
    });
  });


  const sizeOf = (style: CameraStyle) => (style.size >= 0.3 ? SIZES.L : style.size >= 0.2 ? SIZES.M : SIZES.S);
  const style = () => settings()?.cameraStyle;
  const update = (change: (c: CameraStyle) => void) => {
    const next = structuredClone(settings()!);
    change(next.cameraStyle);
    setSettings(next);
    void recorder.save(next);
  };
  const setSize = (key: keyof typeof SIZES) => {
    update((c) => (c.size = key === "S" ? 0.16 : key === "M" ? 0.24 : 0.34));
    void recorder.resize(SIZES[key], SIZES[key]);
  };
  const close = () => {
    const next = structuredClone(settings()!);
    next.cameraOn = false;
    void recorder.save(next);
    void recorder.hide("bubble");
  };

  return (
    <div class="bubble" data-shape={style()?.shape ?? "circle"} onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)} data-tauri-drag-region>
      <Show when={frame()} fallback={<div class="bubble__wait" data-tauri-drag-region>{error() ?? "Starting camera…"}</div>}>
        <img src={frame()!} alt="" draggable={false} data-tauri-drag-region style={{ transform: style()?.mirrored ? "scaleX(-1)" : "none" }} />
      </Show>
      <Show when={hover()}>
        <div class="bubble__pill">
          <For each={["S", "M", "L"] as const}>
            {(k) => (
              <button type="button" data-on={settings() && sizeOf(style()!) === SIZES[k] ? "true" : "false"} onClick={() => setSize(k)}>
                {k}
              </button>
            )}
          </For>
          <i />
          <For each={["circle", "squircle", "square"] as const}>
            {(shape) => (
              <button type="button" data-on={style()?.shape === shape ? "true" : "false"} onClick={() => update((c) => (c.shape = shape))} aria-label={shape}>
                <span class={`bubble__shape bubble__shape--${shape}`} />
              </button>
            )}
          </For>
          <i />
          <button type="button" data-on={style()?.mirrored ? "true" : "false"} onClick={() => update((c) => (c.mirrored = !c.mirrored))} aria-label="Mirror">
            <FlipHorizontal2 size={13} />
          </button>
          <Show when={navigator.platform.toLowerCase().includes("mac")}>
            <button type="button" onClick={() => void invoke("show_video_effects")} aria-label="Video effects" title="Center Stage, Portrait, Studio Light">
              <Sparkles size={13} />
            </button>
          </Show>
          <button type="button" onClick={close} aria-label="Turn camera off">
            <X size={13} />
          </button>
        </div>
      </Show>
    </div>
  );
}
