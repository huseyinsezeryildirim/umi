import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { Check, ChevronRight, Mic, ScanFace, Sparkles } from "lucide-solid";
import { recorder, type RecordSettings } from "./api";

/**
 * The camera menu next to the bubble (its adjust button): which camera, Center Stage, and
 * macOS's own panels for what only macOS can change (Portrait, Studio Light, backgrounds,
 * microphone modes). Closes when you click elsewhere.
 */
export function CameraMenu() {
  const [settings, setSettings] = createSignal<RecordSettings | null>(null);
  const [sources, { refetch }] = createResource(() => recorder.sources());
  const [centerStage, setCenterStage] = createSignal<boolean | null>(null);

  let box!: HTMLDivElement;
  onMount(() => {
    // The window fits the menu.
    const ro = new ResizeObserver(() => void recorder.resize(280, Math.ceil(box.scrollHeight) + 8));
    ro.observe(box);
    onCleanup(() => ro.disconnect());
    void recorder.settings().then(setSettings);
    void invoke<boolean | null>("camera_center_stage").then(setCenterStage);
    // Made ahead and hidden: read the cameras and settings again each time it opens.
    const opened = () => {
      void refetch();
      void recorder.settings().then(setSettings);
      void invoke<boolean | null>("camera_center_stage").then(setCenterStage);
    };
    window.addEventListener("focus", opened);
    onCleanup(() => window.removeEventListener("focus", opened));
    const close = () => void recorder.hide("camera");
    const key = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("blur", close);
    window.addEventListener("keydown", key);
    onCleanup(() => {
      window.removeEventListener("blur", close);
      window.removeEventListener("keydown", key);
    });
  });

  const pick = async (id: string) => {
    const next = structuredClone(settings()!);
    next.camera = id;
    setSettings(next);
    await recorder.save(next);
    // The bubble and the launcher show the new camera.
    await emit("record:settings");
  };
  const current = () => settings()?.camera ?? sources()?.cameras[0]?.id ?? "";

  return (
    <div ref={box} class="cam-menu">
      <p class="cam-menu__title">Camera</p>
      <For each={sources()?.cameras ?? []}>
        {(c) => (
          <button type="button" class="cam-menu__row" onClick={() => void pick(c.id)}>
            <span>{c.name}</span>
            <Show when={current() === c.id || (current() === "" && c === sources()!.cameras[0])}>
              <Check size={15} />
            </Show>
          </button>
        )}
      </For>
      <Show when={centerStage() !== null}>
        <i class="cam-menu__line" />
        <button
          type="button"
          class="cam-menu__row"
          role="switch"
          aria-checked={centerStage() ? "true" : "false"}
          onClick={async () => setCenterStage(await invoke<boolean | null>("camera_center_stage", { on: !centerStage() }))}
        >
          <ScanFace size={16} />
          <span>Center Stage</span>
          <span class="cam-menu__switch" data-on={centerStage() ? "true" : "false"} />
        </button>
      </Show>
      <i class="cam-menu__line" />
      <button type="button" class="cam-menu__row" onClick={() => void invoke("show_video_effects")} title="Portrait, Studio Light, Edge Light, backgrounds and reactions are switched in macOS">
        <Sparkles size={16} />
        <span>Portrait, light and background</span>
        <ChevronRight size={15} />
      </button>
      <button type="button" class="cam-menu__row" onClick={() => void invoke("show_video_effects", { microphone: true })}>
        <Mic size={16} />
        <span>Microphone mode</span>
        <ChevronRight size={15} />
      </button>
    </div>
  );
}
