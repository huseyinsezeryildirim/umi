import { emit, listen } from "@tauri-apps/api/event";
import { createSignal, For, onCleanup, onMount } from "solid-js";
import { applyTool, INK_COLORS, type InkTool } from "./Ink";

const svg = (d: string) => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

const TOOLS: { tool: InkTool; label: string; key: string; icon: string }[] = [
  { tool: "pointer", label: "Pointer", key: "Esc", icon: svg(`<path d="M5 3l14 8-6 2-2 6z"/>`) },
  { tool: "pen", label: "Pen", key: "P", icon: svg(`<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>`) },
  { tool: "highlighter", label: "Highlighter", key: "H", icon: svg(`<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>`) },
  { tool: "arrow", label: "Arrow", key: "A", icon: svg(`<path d="M5 19 19 5M9 5h10v10"/>`) },
  { tool: "box", label: "Box", key: "B", icon: svg(`<rect x="4" y="6" width="16" height="12" rx="2"/>`) },
  { tool: "spotlight", label: "Spotlight", key: "S", icon: svg(`<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>`) },
];
const UNDO = svg(`<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>`);
const CLEAR = svg(`<path d="m7 21-4-4 10-10 8 8-6 6z"/><path d="M14 21h7"/>`);
const KEEP = svg(`<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>`);

/**
 * The drawing tools along the bottom while recording, like Loom's: pointer, pen, highlighter,
 * arrow, box, spotlight, colors, undo, clear, and keep (drawings stay instead of fading). Like
 * every Umi window it's left out of the recording; the drawings (the ink layer) are in it.
 */
export function Draw() {
  const [tool, setTool] = createSignal<InkTool>("pointer");
  const [color, setColor] = createSignal<string>(INK_COLORS[0]);
  const [keep, setKeep] = createSignal(false);

  const pick = (t: InkTool) => {
    setTool(t);
    void applyTool(t, color());
  };
  const paint = (c: string) => {
    setColor(c);
    // A color picks the pen when nothing that draws is on.
    void applyTool(tool() === "pointer" || tool() === "spotlight" ? (setTool("pen"), "pen") : tool(), c);
  };

  onMount(() => {
    // From the ink layer's keys, and the draw shortcut.
    const off = listen<{ tool: InkTool }>("ink:pick", (e) => pick(e.payload.tool));
    onCleanup(() => void off.then((f) => f()));
  });

  return (
    <div class="draw" data-tauri-drag-region>
      <For each={TOOLS}>
        {(t) => (
          <button type="button" class="draw__btn" data-on={tool() === t.tool ? "true" : "false"} onClick={() => pick(t.tool)} title={`${t.label} · ${t.key}`} aria-label={t.label} innerHTML={t.icon} />
        )}
      </For>
      <i class="draw__line" />
      <For each={INK_COLORS}>
        {(c) => <button type="button" class="draw__dot" data-on={color() === c ? "true" : "false"} style={{ background: c }} onClick={() => paint(c)} title="Color" aria-label={`Color ${c}`} />}
      </For>
      <i class="draw__line" />
      <button type="button" class="draw__btn" onClick={() => void emit("ink:action", { action: "undo" })} title="Undo · ⌘Z" aria-label="Undo" innerHTML={UNDO} />
      <button type="button" class="draw__btn" onClick={() => void emit("ink:action", { action: "clear" })} title="Clear all" aria-label="Clear all" innerHTML={CLEAR} />
      <button
        type="button"
        class="draw__btn"
        data-on={keep() ? "true" : "false"}
        onClick={() => {
          setKeep(!keep());
          void emit("ink:action", { action: "keep", value: keep() });
        }}
        title={keep() ? "Drawings stay (click to let them fade)" : "Drawings fade (click to keep them)"}
        aria-label="Keep drawings"
        innerHTML={KEEP}
      />
    </div>
  );
}
