import { createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js";
import { Portal } from "solid-js/web";

// ───── Dialog ─────

export function Dialog(props: { open: boolean; title?: string; onClose: () => void; children: JSX.Element; width?: number }) {
  return (
    <Show when={props.open}>
      <DialogBody {...props} />
    </Show>
  );
}

function DialogBody(props: { title?: string; onClose: () => void; children: JSX.Element; width?: number }) {
  onMount(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
    window.addEventListener("keydown", key);
    onCleanup(() => window.removeEventListener("keydown", key));
  });
  return (
    <Portal>
      <div class="umi-scrim" onPointerDown={(e) => e.target === e.currentTarget && props.onClose()}>
        <div class="umi-dialog umi-floating" role="dialog" aria-modal="true" style={props.width ? { width: `min(${props.width}px, calc(100vw - 48px))` } : {}}>
          <Show when={props.title}>
            <h2 class="umi-dialog__title">{props.title}</h2>
          </Show>
          {props.children}
        </div>
      </div>
    </Portal>
  );
}

// ───── Toasts ─────

interface ToastItem {
  id: number;
  text: string;
  icon?: JSX.Element;
}

const [toasts, setToasts] = createSignal<ToastItem[]>([]);
let nextId = 1;

/** Shows a short message at the bottom of the window. */
export function toast(text: string, icon?: JSX.Element, ms = 2600) {
  const id = nextId++;
  setToasts((list) => [...list, { id, text, icon }]);
  window.setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), ms);
}

export function Toaster() {
  return (
    <Portal>
      <div class="umi-toasts" aria-live="polite">
        <For each={toasts()}>
          {(t) => (
            <div class="umi-toast umi-floating">
              {t.icon}
              {t.text}
            </div>
          )}
        </For>
      </div>
    </Portal>
  );
}
