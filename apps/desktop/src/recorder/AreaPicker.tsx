import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { recorder } from "./api";

/** Drag a rectangle over the screen; Enter or double-click keeps it, Esc cancels. */
export function AreaPicker() {
  const [rect, setRect] = createSignal<{ x: number; y: number; w: number; h: number } | null>(null);
  let dragging: { ox: number; oy: number; mode: "new" | "move"; start?: { x: number; y: number } } | null = null;

  const done = async (keep: boolean) => {
    const r = rect();
    const mode = await invoke<string>("area_mode");
    setRect(null);
    await recorder.hide("area");
    if (!keep || !r || r.w < 40 || r.h < 40) {
      if (mode !== "screenshot") await recorder.show("launcher");
      return;
    }
    const { displays } = await recorder.sources();
    const target = { kind: "area" as const, display: displays[0]?.id ?? 1, x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.w) & ~1, height: Math.round(r.h) & ~1 };
    if (mode === "screenshot") {
      // Let the picker fade away first so it isn't in the picture.
      await new Promise((ok) => setTimeout(ok, 120));
      await invoke("screenshot_take", { target });
      await recorder.show("shot");
      return;
    }
    const settings = await recorder.settings();
    settings.target = target;
    settings.cameraOnly = false;
    await recorder.save(settings);
    await recorder.show("launcher");
  };

  onMount(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") void done(false);
      if (e.key === "Enter") void done(true);
    };
    window.addEventListener("keydown", key);
    onCleanup(() => window.removeEventListener("keydown", key));
  });

  const down = (e: PointerEvent) => {
    const r = rect();
    const inside = r && e.clientX >= r.x && e.clientX <= r.x + r.w && e.clientY >= r.y && e.clientY <= r.y + r.h;
    dragging = inside ? { ox: e.clientX, oy: e.clientY, mode: "move", start: { x: r!.x, y: r!.y } } : { ox: e.clientX, oy: e.clientY, mode: "new" };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent) => {
    if (!dragging) return;
    if (dragging.mode === "new") {
      setRect({ x: Math.min(dragging.ox, e.clientX), y: Math.min(dragging.oy, e.clientY), w: Math.abs(e.clientX - dragging.ox), h: Math.abs(e.clientY - dragging.oy) });
    } else if (dragging.start && rect()) {
      setRect({ ...rect()!, x: dragging.start.x + e.clientX - dragging.ox, y: dragging.start.y + e.clientY - dragging.oy });
    }
  };

  return (
    <div class="area" onPointerDown={down} onPointerMove={move} onPointerUp={() => (dragging = null)} onDblClick={() => void done(true)}>
      <Show when={rect()} fallback={<div class="area__hint">Drag to select the area to record · Esc to cancel</div>}>
        {(r) => (
          <>
            <div class="area__box" style={{ left: `${r().x}px`, top: `${r().y}px`, width: `${r().w}px`, height: `${r().h}px` }}>
              <span class="area__size">
                {Math.round(r().w)} × {Math.round(r().h)}
              </span>
            </div>
            <div class="area__actions" style={{ left: `${r().x + r().w / 2}px`, top: `${Math.min(r().y + r().h + 12, window.innerHeight - 52)}px` }}>
              <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={() => void done(true)}>
                Record this area
              </button>
              <button type="button" class="area__cancel" onPointerDown={(e) => e.stopPropagation()} onClick={() => void done(false)}>
                Cancel
              </button>
            </div>
          </>
        )}
      </Show>
    </div>
  );
}
