import { createSignal, onCleanup, Show, type JSX } from "solid-js";
import { Portal } from "solid-js/web";

let warm = false;
let coolTimer: number | undefined;

/**
 * A tooltip on hover/focus. The first one waits 500 ms; while one was shown recently the
 * next appears at once (like native toolbars).
 */
export function Tooltip(props: { text: string; shortcut?: string; children: JSX.Element; placement?: "top" | "bottom" }) {
  const [pos, setPos] = createSignal<{ x: number; y: number; below: boolean } | null>(null);
  let timer: number | undefined;
  let host: HTMLElement | undefined;

  const show = () => {
    if (!host) return;
    const r = host.getBoundingClientRect();
    const below = props.placement === "bottom" || r.top < 40;
    setPos({ x: r.left + r.width / 2, y: below ? r.bottom + 8 : r.top - 8, below });
    warm = true;
    window.clearTimeout(coolTimer);
  };
  const enter = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(show, warm ? 0 : 500);
  };
  const leave = () => {
    window.clearTimeout(timer);
    setPos(null);
    coolTimer = window.setTimeout(() => (warm = false), 400);
  };
  onCleanup(() => window.clearTimeout(timer));

  return (
    <span
      ref={host}
      style={{ display: "contents" }}
      onPointerEnter={enter}
      onPointerLeave={leave}
      onPointerDown={leave}
      onFocusIn={enter}
      onFocusOut={leave}
    >
      {props.children}
      <Show when={pos()}>
        {(p) => (
          <Portal>
            <div
              class="umi-tooltip"
              role="tooltip"
              style={{
                left: `${p().x}px`,
                top: `${p().y}px`,
                transform: `translate(-50%, ${p().below ? "0" : "-100%"})`,
              }}
            >
              {props.text}
              <Show when={props.shortcut}>
                <kbd>{props.shortcut}</kbd>
              </Show>
            </div>
          </Portal>
        )}
      </Show>
    </span>
  );
}
