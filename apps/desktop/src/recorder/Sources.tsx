import { invoke } from "@tauri-apps/api/core";
import { createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { AppWindow, Monitor } from "lucide-solid";
import { recorder } from "./api";

/**
 * What to record, switched while recording (the control bar's button): a display or a window.
 * The recording carries on; the new source is fitted into the video. Closes when you click
 * elsewhere.
 */
export function Sources() {
  const [sources, { refetch }] = createResource(() => recorder.sources());
  const [error, setError] = createSignal("");

  let box!: HTMLDivElement;
  onMount(() => {
    const ro = new ResizeObserver(() => void recorder.resize(300, Math.min(520, Math.ceil(box.scrollHeight) + 8)));
    ro.observe(box);
    onCleanup(() => ro.disconnect());
    // Made ahead and hidden: read the windows again each time it opens.
    const opened = () => {
      setError("");
      void refetch();
    };
    const close = () => void recorder.hide("sources");
    const key = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("focus", opened);
    window.addEventListener("blur", close);
    window.addEventListener("keydown", key);
    onCleanup(() => {
      window.removeEventListener("focus", opened);
      window.removeEventListener("blur", close);
      window.removeEventListener("keydown", key);
    });
  });

  const pick = async (target: { kind: "display" | "window"; id: number }) => {
    try {
      await invoke("record_switch", { target });
      await recorder.hide("sources");
    } catch (e) {
      setError(`Couldn't switch: ${e}`);
    }
  };

  return (
    <div ref={box} class="cam-menu sources">
      <p class="cam-menu__title">Record instead</p>
      <For each={sources()?.displays ?? []}>
        {(d) => (
          <button type="button" class="cam-menu__row" onClick={() => void pick({ kind: "display", id: d.id })}>
            <Monitor size={16} />
            <span>{d.name}</span>
          </button>
        )}
      </For>
      <Show when={(sources()?.windows ?? []).length > 0}>
        <i class="cam-menu__line" />
        <For each={sources()?.windows ?? []}>
          {(w) => (
            <button type="button" class="cam-menu__row" onClick={() => void pick({ kind: "window", id: w.id })} title={w.title}>
              <AppWindow size={16} />
              <span>{w.title ? `${w.app} — ${w.title}` : w.app}</span>
            </button>
          )}
        </For>
      </Show>
      <Show when={error()}>
        <p class="sources__error">{error()}</p>
      </Show>
    </div>
  );
}
