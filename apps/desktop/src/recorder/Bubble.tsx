import { emit, listen } from "@tauri-apps/api/event";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { FlipHorizontal2 } from "lucide-solid";
import { recorder, type CameraStyle, type RecordSettings } from "./api";

const SIZES = { S: 160, M: 220, L: 300 } as const;

/** The camera bubble: always on top, draggable; size (three dots) and mirror on hover. */
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
    // The launcher shows these settings too.
    void recorder.save(next).then(() => emit("record:settings"));
  };
  const setSize = (key: keyof typeof SIZES) => {
    update((c) => (c.size = key === "S" ? 0.16 : key === "M" ? 0.24 : 0.34));
    void recorder.resize(SIZES[key], SIZES[key]);
  };

  return (
    <div class="bubble" data-shape={style()?.shape ?? "circle"} onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)} data-tauri-drag-region>
      <Show when={frame()} fallback={<div class="bubble__wait" data-tauri-drag-region>{error() ?? "Starting camera…"}</div>}>
        <img src={frame()!} alt="" draggable={false} data-tauri-drag-region style={{ transform: style()?.mirrored ? "scaleX(-1)" : "none" }} />
      </Show>
      <Show when={hover()}>
        <div class="bubble__pill">
          <For each={["S", "M", "L"] as const}>
            {(k, i) => (
              <button type="button" data-on={settings() && sizeOf(style()!) === SIZES[k] ? "true" : "false"} onClick={() => setSize(k)} aria-label={["Small", "Medium", "Large"][i()]} title={["Small", "Medium", "Large"][i()]}>
                <span class="bubble__dot" style={{ width: `${4 + i() * 3}px`, height: `${4 + i() * 3}px` }} />
              </button>
            )}
          </For>
          <button type="button" data-on={style()?.mirrored ? "true" : "false"} onClick={() => update((c) => (c.mirrored = !c.mirrored))} aria-label="Mirror" title="Mirror">
            <FlipHorizontal2 size={13} />
          </button>
        </div>
      </Show>
    </div>
  );
}
