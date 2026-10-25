import { getCurrentWindow } from "@tauri-apps/api/window";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { FlipHorizontal2, X } from "lucide-solid";
import { recorder, type CameraStyle, type RecordSettings } from "./api";

const SIZES = { S: 160, M: 220, L: 300 } as const;

/** The camera bubble: always on top, draggable; size, shape and mirror on hover. */
export function Bubble() {
  const [settings, setSettings] = createSignal<RecordSettings | null>(null);
  const [frame, setFrame] = createSignal<string | null>(null);
  const [hover, setHover] = createSignal(false);
  let lastUrl: string | null = null;

  onMount(async () => {
    const s = await recorder.settings();
    setSettings(s);
    await getCurrentWindow().setSize(new (await import("@tauri-apps/api/dpi")).LogicalSize(sizeOf(s.cameraStyle), sizeOf(s.cameraStyle)));
    void recorder.cameraPreview(s.camera ?? "", (jpeg) => {
      const url = URL.createObjectURL(new Blob([jpeg], { type: "image/jpeg" }));
      setFrame(url);
      if (lastUrl) URL.revokeObjectURL(lastUrl);
      lastUrl = url;
    });
    onCleanup(() => void recorder.cameraPreview(null, () => {}));
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
      <Show when={frame()} fallback={<div class="bubble__wait" data-tauri-drag-region>Starting camera…</div>}>
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
          <button type="button" onClick={close} aria-label="Turn camera off">
            <X size={13} />
          </button>
        </div>
      </Show>
    </div>
  );
}
