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

type Box = { left: number; top: number; width: number; height: number };

/**
 * A box over the preview in canvas units (0…1, top-left origin) that drags to move and,
 * when `onResize` is given, resizes from its corners (keeping its aspect).
 */
function CanvasBox(props: {
  editor: Editor;
  frame: Box;
  /** Box in canvas units. */
  box: Box;
  round?: boolean;
  /** No dimming around it; the outline shows on hover (always-available handles). */
  soft?: boolean;
  label?: string;
  onMove: (dx: number, dy: number) => void;
  onResize?: (scale: number) => void;
}) {
  const ed = props.editor;
  const px = () => ({
    left: props.frame.left + props.box.left * props.frame.width,
    top: props.frame.top + props.box.top * props.frame.height,
    width: props.box.width * props.frame.width,
    height: props.box.height * props.frame.height,
  });
  const drag = (corner: Corner, e: PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const ox = e.clientX;
    const oy = e.clientY;
    const start = px();
    let last = { x: 0, y: 0, k: 1 };
    void ed.gestureStart();
    const move = (m: PointerEvent) => {
      const dx = (m.clientX - ox) / props.frame.width;
      const dy = (m.clientY - oy) / props.frame.height;
      if (corner === "move") {
        props.onMove(dx - last.x, dy - last.y);
        last = { ...last, x: dx, y: dy };
      } else if (props.onResize) {
        // Grow from the center by how far the corner moved outward.
        const sx = corner.includes("e") ? 1 : -1;
        const sy = corner.includes("s") ? 1 : -1;
        const grow = ((m.clientX - ox) * sx + (m.clientY - oy) * sy) / 2;
        const k = Math.max(0.2, (start.width + 2 * grow) / start.width);
        props.onResize(k / last.k);
        last = { ...last, k };
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      void ed.gestureEnd();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return (
    <div
      class="ed-handle-box"
      data-round={props.round ? "true" : "false"}
      data-soft={props.soft ? "true" : "false"}
      style={{ left: `${px().left}px`, top: `${px().top}px`, width: `${px().width}px`, height: `${px().height}px` }}
      onPointerDown={(e) => drag("move", e)}
    >
      <Show when={props.onResize}>
        <For each={["nw", "ne", "sw", "se"] as Corner[]}>{(corner) => <div class={`ed-handle ed-handle--${corner}`} onPointerDown={(e) => drag(corner, e)} />}</For>
      </Show>
      <Show when={props.label}>
        <span class="ed-handle-badge">{props.label}</span>
      </Show>
    </div>
  );
}

const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1);

/** Drag the selected text to place it. */
export function TextHandle(props: { editor: Editor; id: string; frame: Box }) {
  const ed = props.editor;
  const text = () => ed.state().edit.texts.find((t) => t.id === props.id);
  const box = () => {
    const t = text()!;
    const w = t.style === "lowerThird" ? 0.34 : t.style === "kicker" ? 0.22 : 0.42;
    const h = t.style === "bigStat" || t.style === "quote" ? 0.2 : 0.1;
    return { left: t.position[0] - w / 2, top: t.position[1] - h / 2, width: w, height: h };
  };
  return (
    <Show when={text()}>
      <CanvasBox
        editor={ed}
        frame={props.frame}
        box={box()}
        label="Drag to move"
        onMove={(dx, dy) =>
          void ed.update((e) => {
            const t = e.texts.find((x) => x.id === props.id);
            if (t) t.position = [clamp01(t.position[0] + dx), clamp01(t.position[1] + dy)];
          })
        }
      />
    </Show>
  );
}

/** Drag the camera bubble; corners resize it. */
export function CameraHandle(props: { editor: Editor; frame: Box }) {
  const ed = props.editor;
  const cam = () => ed.state().edit.camera;
  const box = () => {
    const short = Math.min(props.frame.width, props.frame.height);
    const w = (cam().size * short) / props.frame.width;
    const h = (cam().size * short) / props.frame.height;
    return { left: cam().position[0] - w / 2, top: cam().position[1] - h / 2, width: w, height: h };
  };
  return (
    <CanvasBox
      editor={ed}
      frame={props.frame}
      box={box()}
      soft
      round={cam().shape === "circle"}
      onMove={(dx, dy) => void ed.update((e) => (e.camera.position = [clamp01(e.camera.position[0] + dx), clamp01(e.camera.position[1] + dy)]))}
      onResize={(k) => void ed.update((e) => (e.camera.size = Math.min(Math.max(e.camera.size * k, 0.1), 0.6)))}
    />
  );
}

/** Drag a picture-in-picture image or video; corners resize it. */
export function OverlayHandle(props: { editor: Editor; id: string; frame: Box }) {
  const ed = props.editor;
  const overlay = () => ed.state().edit.overlays.find((o) => o.id === props.id);
  const box = () => {
    const o = overlay()!;
    const aspect = o.lane === 2 ? ed.state().recording.width / Math.max(ed.state().recording.height, 1) : 16 / 9;
    const w = o.width;
    const h = (w * props.frame.width) / aspect / props.frame.height;
    return { left: o.center[0] - w / 2, top: o.center[1] - h / 2, width: w, height: h };
  };
  return (
    <Show when={overlay()?.mode === "pictureInPicture"}>
      <CanvasBox
        editor={ed}
        frame={props.frame}
        box={box()}
        onMove={(dx, dy) =>
          void ed.update((e) => {
            const o = e.overlays.find((x) => x.id === props.id);
            if (o) o.center = [clamp01(o.center[0] + dx), clamp01(o.center[1] + dy)];
          })
        }
        onResize={(k) =>
          void ed.update((e) => {
            const o = e.overlays.find((x) => x.id === props.id);
            if (o) o.width = Math.min(Math.max(o.width * k, 0.1), 0.95);
          })
        }
      />
    </Show>
  );
}

/**
 * The selected zoom's focus: click anywhere on the screen to pin the zoom there, drag the
 * marker to move it. Without a focus the zoom follows the cursor.
 */
export function ZoomFocusHandle(props: { editor: Editor; id: string; frame: Box }) {
  const ed = props.editor;
  const [content, setContent] = createSignal<[number, number, number, number] | null>(null);
  createEffect(
    on([ed.time, () => ed.state().edit], () => {
      void invoke<[number, number, number, number]>("editor_layout", { id: ed.state().id, time: ed.time() }).then(setContent, () => {});
    }),
  );
  const zoom = () => ed.state().zoomSegments.find((z) => z.id === props.id);
  const crop = (): Rect => ed.state().edit.crop ?? [[0, 0], [1, 1]];

  /** Stage px → screen-normalized point (clamped). */
  const toScreen = (clientX: number, clientY: number, stage: DOMRect): [number, number] | null => {
    const c = content();
    if (!c) return null;
    const [[cx, cy], [cw, ch]] = crop();
    const fx = (clientX - stage.left - props.frame.left) / props.frame.width;
    const fy = (clientY - stage.top - props.frame.top) / props.frame.height;
    return [clamp01(cx + ((fx - c[0]) / c[2]) * cw), clamp01(cy + ((fy - c[1]) / c[3]) * ch)];
  };
  const marker = () => {
    const c = content();
    const f = zoom()?.focus;
    if (!c || !f) return null;
    const [[cx, cy], [cw, ch]] = crop();
    return {
      left: props.frame.left + (c[0] + ((f[0] - cx) / cw) * c[2]) * props.frame.width,
      top: props.frame.top + (c[1] + ((f[1] - cy) / ch) * c[3]) * props.frame.height,
    };
  };

  const setFocus = (focus: [number, number]) =>
    void ed.update((e) => {
      // Editing a generated zoom turns the generated ones into manual zooms.
      if (e.zoom.auto) {
        e.zoom.segments = structuredClone(ed.state().zoomSegments);
        e.zoom.auto = false;
      }
      const z = e.zoom.segments.find((x) => x.id === props.id);
      if (z) z.focus = focus;
    });

  const press = (e: PointerEvent) => {
    const stage = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const p = toScreen(e.clientX, e.clientY, stage);
    if (!p) return;
    e.preventDefault();
    void ed.gestureStart();
    setFocus(p);
    const move = (m: PointerEvent) => {
      const q = toScreen(m.clientX, m.clientY, stage);
      if (q) setFocus(q);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      void ed.gestureEnd();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div class="ed-focus-layer" onPointerDown={press}>
      <Show when={marker()} fallback={<span class="ed-focus-hint">Click where the zoom should look · it follows the cursor until then</span>}>
        {(m) => <div class="ed-focus" style={{ left: `${m().left}px`, top: `${m().top}px` }} />}
      </Show>
    </div>
  );
}
