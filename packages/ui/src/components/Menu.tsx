import { createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js";
import { Portal } from "solid-js/web";
import { Check } from "lucide-solid";

export type MenuEntry =
  | { kind?: "item"; label: string; icon?: JSX.Element; shortcut?: string; checked?: boolean; disabled?: boolean; onSelect: () => void }
  | { kind: "separator" }
  | { kind: "label"; label: string };

/**
 * A dropdown menu anchored to its trigger. Opens on click, closes on outside click,
 * Escape or selection; arrow keys move the highlight.
 */
export function Menu(props: { trigger: (open: () => void, isOpen: () => boolean) => JSX.Element; entries: MenuEntry[]; align?: "start" | "end"; width?: number }) {
  const [anchor, setAnchor] = createSignal<DOMRect | null>(null);
  let host!: HTMLSpanElement;
  const open = () => {
    // Wrappers (tooltips) use `display: contents` and have no box: find the real trigger.
    let el: Element | null = host.firstElementChild;
    while (el && getComputedStyle(el).display === "contents") el = el.firstElementChild;
    setAnchor((el ?? host).getBoundingClientRect());
  };
  const close = () => setAnchor(null);
  return (
    <span ref={host} style={{ display: "contents" }}>
      {props.trigger(open, () => anchor() !== null)}
      <Show when={anchor()}>
        {(rect) => <MenuPopover rect={rect()} entries={props.entries} align={props.align} width={props.width} onClose={close} />}
      </Show>
    </span>
  );
}

function MenuPopover(props: { rect: DOMRect; entries: MenuEntry[]; align?: "start" | "end"; width?: number; onClose: () => void }) {
  let el!: HTMLDivElement;
  const [hi, setHi] = createSignal(-1);
  const items = () => props.entries.map((e, i) => ({ e, i })).filter(({ e }) => (e.kind ?? "item") === "item" && !(e as { disabled?: boolean }).disabled);
  const [pos, setPos] = createSignal({ x: props.rect.left, y: props.rect.bottom + 6 });
  const [maxHeight, setMaxHeight] = createSignal<number | undefined>(undefined);

  onMount(() => {
    // Keep the menu on screen, flipping above the trigger when there's no room below.
    const r = el.getBoundingClientRect();
    let x = props.align === "end" ? props.rect.right - r.width : props.rect.left;
    x = Math.min(Math.max(8, x), window.innerWidth - r.width - 8);
    // Below the trigger if it fits, else above, else on whichever side has more room
    // (scrolling inside).
    const below = window.innerHeight - props.rect.bottom - 14;
    const above = props.rect.top - 14;
    let y: number;
    let max: number | undefined;
    if (r.height <= below) y = props.rect.bottom + 6;
    else if (r.height <= above) y = props.rect.top - r.height - 6;
    else if (above > below) {
      max = above;
      y = 8;
    } else {
      max = below;
      y = props.rect.bottom + 6;
    }
    setPos({ x, y });
    setMaxHeight(max);
    const outside = (e: PointerEvent) => !el.contains(e.target as Node) && props.onClose();
    const key = (e: KeyboardEvent) => {
      const list = items();
      if (e.key === "Escape") props.onClose();
      else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const at = list.findIndex(({ i }) => i === hi());
        const next = e.key === "ArrowDown" ? (at + 1) % list.length : (at - 1 + list.length) % list.length;
        setHi(list[next]?.i ?? -1);
      } else if (e.key === "Enter" && hi() >= 0) {
        const entry = props.entries[hi()] as { onSelect: () => void };
        props.onClose();
        entry.onSelect();
      } else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("keydown", key, true);
    window.addEventListener("blur", props.onClose);
    onCleanup(() => {
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", props.onClose);
    });
  });

  return (
    <Portal>
      <div ref={el} class="umi-popover umi-floating" role="menu" style={{ left: `${pos().x}px`, top: `${pos().y}px`, "min-width": `${props.width ?? 200}px`, ...(maxHeight() ? { "max-height": `${maxHeight()}px`, "overflow-y": "auto" } : {}) }}>
        <For each={props.entries}>
          {(entry, index) => {
            if (entry.kind === "separator") return <div class="umi-menu__separator" />;
            if (entry.kind === "label") return <div class="umi-menu__label">{entry.label}</div>;
            return (
              <button
                type="button"
                role="menuitem"
                class="umi-menu__item"
                disabled={entry.disabled}
                style={{ opacity: entry.disabled ? 0.45 : 1 }}
                data-highlighted={hi() === index() ? "true" : "false"}
                onPointerEnter={() => setHi(index())}
                onClick={() => {
                  props.onClose();
                  entry.onSelect();
                }}
              >
                {entry.icon}
                <span>{entry.label}</span>
                <Show when={entry.checked}>
                  <Check size={14} class="umi-menu__check" />
                </Show>
                <Show when={entry.shortcut && !entry.checked}>
                  <span class="umi-menu__shortcut">{entry.shortcut}</span>
                </Show>
              </button>
            );
          }}
        </For>
      </div>
    </Portal>
  );
}
