import { invoke } from "@tauri-apps/api/core";
import { createEffect, createSignal, For, on, Show } from "solid-js";
import type { Editor } from "./store";
import { maskRectAt, setMaskRectAt, sourceTimeAt, type PrivacyMask, type Rect } from "./types";

type Corner = "nw" | "ne" | "sw" | "se" | "move";

/**
 * Handles drawn over the preview for the selected mask: drag to move, corners to resize.
 * On a moving mask (keyframes) every change is a keyframe at the playhead.
 * `frame` is the canvas' box inside the stage, in CSS px.
 */
export function MaskHandles(props: { editor: Editor; mask: PrivacyMask; frame: { left: number; top: number; width: number; height: number } }) {
  const ed = props.editor;
  const [content, setContent] = createSignal<[number, number, number, number] | null>(null);

  // Where the screen sits on the canvas (changes with padding, frame, aspect, scenes…).
  createEffect(
    on([ed.time, () => ed.state().edit], () => {
      void invoke<[number, number, number, number]>("editor_layout", { id: ed.state().id, time: ed.time() }).then(setContent, () => {});
    }),
  );

  const crop = (): Rect => ed.state().edit.crop ?? [[0, 0], [1, 1]];
  const source = () => sourceTimeAt(ed.state().placements, ed.time());
  const active = () => source() >= props.mask.start && source() <= props.mask.end;

  /** Mask rect (screen-normalized) → CSS px box over the preview. */
  const box = () => {
    const c = content();
    if (!c) return null;
    const [[cx, cy], [cw, ch]] = crop();
    const [[x, y], [w, h]] = maskRectAt(props.mask, source());
    const f = props.frame;
    const sx = f.left + (c[0] + ((x - cx) / cw) * c[2]) * f.width;
    const sy = f.top + (c[1] + ((y - cy) / ch) * c[3]) * f.height;
    return { left: sx, top: sy, width: (w / cw) * c[2] * f.width, height: (h / ch) * c[3] * f.height };
  };

  const drag = (corner: Corner, e: PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const c = content();
    if (!c) return;
    const start = maskRectAt(props.mask, source());
    const [, [cw, ch]] = crop();
    // CSS px → screen-normalized units.
    const kx = cw / (c[2] * props.frame.width);
    const ky = ch / (c[3] * props.frame.height);
    const ox = e.clientX;
    const oy = e.clientY;
    const t = source();
    const id = props.mask.id;
    void ed.gestureStart();
    const move = (m: PointerEvent) => {
      const dx = (m.clientX - ox) * kx;
      const dy = (m.clientY - oy) * ky;
      let [[x, y], [w, h]] = start;
      if (corner === "move") {
        x += dx;
        y += dy;
      } else {
        if (corner.includes("w")) {
          x += dx;
          w -= dx;
        }
        if (corner.includes("e")) w += dx;
        if (corner.includes("n")) {
          y += dy;
          h -= dy;
        }
        if (corner.includes("s")) h += dy;
      }
      w = Math.max(w, 0.02);
      h = Math.max(h, 0.02);
      x = Math.min(Math.max(x, 0), 1 - w);
      y = Math.min(Math.max(y, 0), 1 - h);
      void ed.update((edit) => {
        const mask = edit.masks.find((k) => k.id === id);
        if (mask) setMaskRectAt(mask, t, [[x, y], [w, h]]);
      });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      void ed.gestureEnd().then(() => {
        // A mask stuck to content follows from where it was just put.
        if (props.mask.follow) void ed.trackMask(id, t);
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <Show when={active() && box()}>
      {(b) => (
        <div class="ed-handle-box" style={{ left: `${b().left}px`, top: `${b().top}px`, width: `${b().width}px`, height: `${b().height}px` }} onPointerDown={(e) => drag("move", e)}>
          <For each={["nw", "ne", "sw", "se"] as Corner[]}>{(corner) => <div class={`ed-handle ed-handle--${corner}`} onPointerDown={(e) => drag(corner, e)} />}</For>
          <Show when={ed.tracking()?.mask === props.mask.id} fallback={
            <Show when={props.mask.follow} fallback={<Show when={props.mask.keyframes?.length}><span class="ed-handle-badge">Keyframe at {source().toFixed(1)}s</span></Show>}>
              <span class="ed-handle-badge">Following content</span>
            </Show>
          }>
            <span class="ed-handle-badge">Following… {Math.round((ed.tracking()?.progress ?? 0) * 100)}%</span>
          </Show>
        </div>
      )}
    </Show>
  );
}
