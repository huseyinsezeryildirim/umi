import { listen } from "@tauri-apps/api/event";
import { createSignal, onCleanup, onMount } from "solid-js";

/** 3 · 2 · 1, centered on screen while the recording warms up. */
export function Countdown() {
  const [n, setN] = createSignal(3);
  onMount(() => {
    const off = listen<number>("countdown", (e) => setN(e.payload));
    onCleanup(() => void off.then((f) => f()));
  });
  return (
    <div class="countdown">
      {/* Re-keyed so each number animates in. */}
      {(() => {
        const value = n();
        return (
          <span class="countdown__n" data-n={value}>
            {value}
          </span>
        );
      })()}
    </div>
  );
}
