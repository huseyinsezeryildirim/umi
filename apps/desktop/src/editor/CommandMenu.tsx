import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { Kbd } from "@umi/ui";
import { Search } from "lucide-solid";
import type { Editor } from "./store";

export interface Command {
  title: string;
  /** Group shown on the right. */
  group: string;
  shortcut?: string;
  /** Extra words that should find it. */
  keywords?: string;
  run: () => void;
}

/** ⌘K: find any action by typing a few letters. */
export function CommandMenu(props: { editor: Editor; commands: () => Command[]; open: boolean; onClose: () => void }) {
  const [query, setQuery] = createSignal("");
  const [active, setActive] = createSignal(0);
  let input!: HTMLInputElement;

  const results = createMemo(() => {
    const words = query().toLowerCase().split(/\s+/).filter(Boolean);
    const all = props.commands();
    if (!words.length) return all;
    return all
      .map((c) => {
        const hay = `${c.title} ${c.group} ${c.keywords ?? ""}`.toLowerCase();
        if (!words.every((w) => hay.includes(w))) return null;
        // Titles starting with the query first.
        const score = c.title.toLowerCase().startsWith(words[0]) ? 0 : c.title.toLowerCase().includes(words[0]) ? 1 : 2;
        return { c, score };
      })
      .filter((x): x is { c: Command; score: number } => !!x)
      .sort((a, b) => a.score - b.score)
      .map((x) => x.c);
  });

  const run = (c: Command | undefined) => {
    if (!c) return;
    props.onClose();
    setQuery("");
    queueMicrotask(c.run);
  };

  return (
    <Show when={props.open}>
      <Portal>
        <div class="umi-scrim ed-cmd-scrim" onPointerDown={(e) => e.target === e.currentTarget && props.onClose()}>
          <div class="ed-cmd umi-floating" role="dialog" aria-label="Commands">
            <CommandFocus onMount={() => input.focus()} onClose={props.onClose} />
            <div class="ed-cmd__search">
              <Search size={16} />
              <input
                ref={input}
                placeholder="Type a command…"
                value={query()}
                onInput={(e) => {
                  setQuery(e.currentTarget.value);
                  setActive(0);
                }}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setActive((a) => Math.min(a + 1, results().length - 1));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setActive((a) => Math.max(a - 1, 0));
                  } else if (e.key === "Enter") {
                    run(results()[active()]);
                  } else if (e.key === "Escape") {
                    props.onClose();
                  }
                }}
              />
            </div>
            <div class="ed-cmd__list">
              <For each={results()} fallback={<div class="ed-cmd__empty">Nothing found</div>}>
                {(c, i) => (
                  <button
                    type="button"
                    class="ed-cmd__item"
                    data-active={i() === active() ? "true" : "false"}
                    ref={(el) => i() === active() && queueMicrotask(() => el.scrollIntoView({ block: "nearest" }))}
                    onPointerMove={() => setActive(i())}
                    onClick={() => run(c)}
                  >
                    <span>{c.title}</span>
                    <em>{c.group}</em>
                    <Show when={c.shortcut}>
                      <Kbd>{c.shortcut}</Kbd>
                    </Show>
                  </button>
                )}
              </For>
            </div>
          </div>
        </div>
      </Portal>
    </Show>
  );
}

function CommandFocus(props: { onMount: () => void; onClose: () => void }) {
  onMount(() => {
    props.onMount();
    const key = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
    window.addEventListener("keydown", key);
    onCleanup(() => window.removeEventListener("keydown", key));
  });
  return null;
}
