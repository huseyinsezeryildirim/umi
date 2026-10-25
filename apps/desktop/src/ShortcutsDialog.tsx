import { invoke } from "@tauri-apps/api/core";
import { createSignal, For, Show } from "solid-js";
import { Button, Dialog, Kbd, toast } from "@umi/ui";
import { AlertTriangle, RotateCcw } from "lucide-solid";

interface Row {
  action: string;
  label: string;
  keys: string;
  default: string;
  conflict: boolean;
}

const mac = navigator.platform.toLowerCase().includes("mac");
/** "Alt+Shift+L" → "⌥⇧L" on a Mac, as is elsewhere. */
export const pretty = (keys: string) =>
  !keys ? "Off" : mac ? keys.replace(/Alt\+/g, "⌥").replace(/Shift\+/g, "⇧").replace(/(Super|Cmd|Command|Meta)\+/g, "⌘").replace(/(Ctrl|Control)\+/g, "⌃") : keys;

/** Keys pressed → an accelerator ("Alt+Shift+L"), or null while only modifiers are down. */
function accelerator(e: KeyboardEvent): string | null {
  const code = e.code;
  let key: string | null = null;
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
  else if (/^Digit\d$/.test(code)) key = code.slice(5);
  else if (/^F\d{1,2}$/.test(code)) key = code;
  else if (["Space", "Enter", "Tab", "Escape", "Backspace"].includes(code)) key = code;
  if (!key) return null;
  const mods = [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Super"].filter(Boolean);
  // A global shortcut needs at least one modifier (or a function key).
  if (!mods.length && !/^F\d/.test(key)) return null;
  return [...mods, key].join("+");
}

/** Change the global shortcuts; a shortcut another app already uses is flagged. */
export function ShortcutsDialog(props: { open: boolean; onClose: () => void }) {
  const [rows, setRows] = createSignal<Row[]>([]);
  const [recording, setRecording] = createSignal<string | null>(null);
  const load = async () => setRows(await invoke<Row[]>("shortcuts_get"));
  const set = async (action: string, keys: string) => {
    try {
      setRows(await invoke<Row[]>("shortcuts_set", { change: { action, keys } }));
    } catch (e) {
      toast(String(e));
    }
  };
  const listen = (action: string) => {
    setRecording(action);
    const key = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") return done();
      const acc = accelerator(e);
      if (acc) {
        void set(action, acc);
        done();
      }
    };
    const done = () => {
      window.removeEventListener("keydown", key, true);
      setRecording(null);
    };
    window.addEventListener("keydown", key, true);
  };

  return (
    <Dialog open={props.open} title="Keyboard shortcuts" onClose={props.onClose} width={460}>
      <div ref={() => void load()} class="sc-list">
        <For each={rows()}>
          {(r) => (
            <div class="sc-row">
              <span>{r.label}</span>
              <Show when={r.conflict}>
                <span class="sc-warn" title="Another app uses these keys. Pick different ones.">
                  <AlertTriangle size={14} /> In use
                </span>
              </Show>
              <button type="button" class="sc-keys" data-on={recording() === r.action ? "true" : "false"} onClick={() => listen(r.action)}>
                {recording() === r.action ? "Press keys…" : <Kbd>{pretty(r.keys)}</Kbd>}
              </button>
              <button type="button" class="sc-reset" title="Back to the default" onClick={() => void set(r.action, r.default)} disabled={r.keys === r.default}>
                <RotateCcw size={13} />
              </button>
            </div>
          )}
        </For>
      </div>
      <p class="umi-section__hint">These work from any app. Click a shortcut, then press the new keys (Esc to cancel).</p>
      <div style={{ display: "flex", "justify-content": "flex-end", "margin-top": "12px" }}>
        <Button variant="ink" onClick={props.onClose}>
          Done
        </Button>
      </div>
    </Dialog>
  );
}
