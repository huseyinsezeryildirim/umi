import { listen } from "@tauri-apps/api/event";
import { createSignal, For, onCleanup, onMount } from "solid-js";
import { type Layout, recorder } from "./api";

/** Little pictures of each layout: the screen as a frame, the camera as a dot or a block. */
const LAYOUTS: { layout: Layout; label: string; icon: string }[] = [
  { layout: "default", label: "Screen and camera", icon: `<rect x="3" y="5" width="18" height="14" rx="2.5"/><circle cx="16.5" cy="14.5" r="2.4" fill="currentColor" stroke="none"/>` },
  { layout: "splitScreen", label: "Side by side", icon: `<rect x="3" y="5" width="18" height="14" rx="2.5"/><rect x="13.5" y="8" width="5" height="8" rx="1.2" fill="currentColor" stroke="none"/>` },
  { layout: "cameraOnly", label: "Camera only", icon: `<rect x="3" y="5" width="18" height="14" rx="2.5"/><circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none"/>` },
  { layout: "hideCamera", label: "Screen only", icon: `<rect x="3" y="5" width="18" height="14" rx="2.5"/><rect x="6" y="8" width="12" height="8" rx="1" fill="currentColor" stroke="none" opacity=".35"/>` },
];

/** The column on the right while recording: switch the video's layout from now. Like every Umi
 *  window it's left out of the recording. */
export function Layouts() {
  const [current, setCurrent] = createSignal<Layout>("default");
  onMount(() => {
    void recorder.status().then((s) => setCurrent(s.layout ?? "default"), () => {});
    const off = listen<Layout>("record:layout", (e) => setCurrent(e.payload));
    onCleanup(() => void off.then((f) => f()));
  });
  const pick = (layout: Layout) => {
    setCurrent(layout);
    void recorder.layout(layout);
  };
  return (
    <div class="layouts" data-tauri-drag-region>
      <For each={LAYOUTS}>
        {(l) => (
          <button type="button" class="layouts__btn" data-on={current() === l.layout ? "true" : "false"} onClick={() => pick(l.layout)} title={l.label} aria-label={l.label}>
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.7" innerHTML={l.icon} />
          </button>
        )}
      </For>
    </div>
  );
}
