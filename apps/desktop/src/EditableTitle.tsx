import { createSignal, onCleanup, Show } from "solid-js";

/**
 * A title you can rename by double-clicking. A single click still does `onClick` (after a beat,
 * so a double click doesn't trigger it); Enter or clicking away saves, Escape cancels.
 */
export function EditableTitle(props: { value: string; class: string; onRename: (title: string) => void; onClick?: () => void }) {
  const [editing, setEditing] = createSignal(false);
  let timer = 0;
  onCleanup(() => window.clearTimeout(timer));
  const commit = (text: string) => {
    setEditing(false);
    if (text.trim() !== props.value) props.onRename(text);
  };
  return (
    <Show
      when={editing()}
      fallback={
        <div
          class={props.class}
          title="Double-click to rename"
          onClick={(e) => {
            if (!props.onClick) return;
            e.stopPropagation();
            window.clearTimeout(timer);
            timer = window.setTimeout(() => props.onClick?.(), 240);
          }}
          onDblClick={(e) => {
            e.stopPropagation();
            window.clearTimeout(timer);
            setEditing(true);
          }}
        >
          {props.value}
        </div>
      }
    >
      <input
        class={`${props.class} title-input`}
        value={props.value}
        aria-label="Title"
        ref={(el) => queueMicrotask(() => (el.focus(), el.select()))}
        onClick={(e) => e.stopPropagation()}
        onDblClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") commit(e.currentTarget.value);
          if (e.key === "Escape") setEditing(false);
        }}
        onBlur={(e) => editing() && commit(e.currentTarget.value)}
      />
    </Show>
  );
}
