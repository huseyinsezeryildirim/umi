import { createSignal, onMount, Show } from "solid-js";
import { Button, toast } from "@umi/ui";
import type { Update } from "@tauri-apps/plugin-updater";
import { onWeb } from "./platform";

/** "Umi 0.3.0 is available → Restart": checks GitHub Releases once at launch (signed builds only). */
export function UpdatePrompt() {
  const [update, setUpdate] = createSignal<Update | null>(null);
  const [busy, setBusy] = createSignal(false);

  onMount(() => {
    // Only the installed app updates itself: not the web editor, the website demo or `tauri dev`.
    if (onWeb || import.meta.env.DEV || import.meta.env.VITE_DEMO) return;
    window.setTimeout(async () => {
      try {
        const { check } = await import("@tauri-apps/plugin-updater");
        setUpdate(await check());
      } catch {
        // Offline, no release yet, or an unsigned build: try again next launch.
      }
    }, 5000);
  });

  const restart = async () => {
    const u = update();
    if (!u) return;
    setBusy(true);
    try {
      await u.downloadAndInstall();
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (e) {
      setBusy(false);
      toast(`Couldn't update: ${e}`);
    }
  };

  return (
    <Show when={update()}>
      {(u) => (
        <div class="update-prompt umi-toast umi-floating" role="status">
          <span>Umi {u().version} is available</span>
          <Button size="sm" variant="ghost" disabled={busy()} onClick={() => setUpdate(null)}>
            Later
          </Button>
          <Button size="sm" variant="ink" disabled={busy()} onClick={() => void restart()}>
            {busy() ? "Updating…" : "Restart to update"}
          </Button>
        </div>
      )}
    </Show>
  );
}
