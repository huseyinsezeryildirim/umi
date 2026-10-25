import { invoke } from "@tauri-apps/api/core";
import { createEffect, createResource, createSignal, For, on, Show } from "solid-js";
import { Button, Dialog, Spinner } from "@umi/ui";
import type { Editor } from "./store";
import { sourceTimeAt, type Rect } from "./types";

type Ratio = { label: string; value: number | null };

/** Keep part of the recording: drag the box or its corners; ratios lock its shape. */
export function CropDialog(props: { editor: Editor; open: boolean; onClose: () => void }) {
  const ed = props.editor;
  const rec = () => ed.state().recording;
  const screenAspect = () => rec().width / Math.max(rec().height, 1);
  const RATIOS: Ratio[] = [
    { label: "Free", value: null },
    { label: "Screen", value: -1 },
    { label: "16:9", value: 16 / 9 },
    { label: "9:16", value: 9 / 16 },
    { label: "1:1", value: 1 },
    { label: "4:3", value: 4 / 3 },
  ];
  const [ratio, setRatio] = createSignal<number | null>(null);
  const [rect, setRect] = createSignal<Rect>([[0, 0], [1, 1]]);
  let image!: HTMLDivElement;

  const [still] = createResource(
    () => (props.open ? sourceTimeAt(ed.state().placements, ed.time()) : null),
    (time) => invoke<string>("recording_still", { path: rec().bundle, time, maxSide: 1400 }),
  );
  createEffect(on(() => props.open, (open) => open && setRect(ed.state().edit.crop ?? [[0, 0], [1, 1]])));

  /** Ratio of the box in normalized units (width/height of the picture differ). */
  const lockFor = (r: number | null) => (r === null ? null : (r === -1 ? screenAspect() : r) / screenAspect());

  const fit = (r: number | null) => {
    setRatio(r);
    const lock = lockFor(r);
    if (lock === null) return;
    // The biggest box of that shape, centered on the current one.
    const [[x, y], [w, h]] = rect();
    const cx = x + w / 2;
    const cy = y + h / 2;
    let nw = 1;
    let nh = nw / lock;
    if (nh > 1) {
      nh = 1;
      nw = lock;
    }
    setRect([[clamp(cx - nw / 2, 0, 1 - nw), clamp(cy - nh / 2, 0, 1 - nh)], [nw, nh]]);
  };

  const drag = (corner: "move" | "nw" | "ne" | "sw" | "se", e: PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const box = image.getBoundingClientRect();
    const start = rect();
    const ox = e.clientX;
    const oy = e.clientY;
    const lock = lockFor(ratio());
    const move = (m: PointerEvent) => {
      const dx = (m.clientX - ox) / box.width;
      const dy = (m.clientY - oy) / box.height;
      let [[x, y], [w, h]] = start;
      if (corner === "move") {
        x = clamp(x + dx, 0, 1 - w);
        y = clamp(y + dy, 0, 1 - h);
      } else {
        const right = x + w;
        const bottom = y + h;
        if (corner.includes("w")) x = clamp(x + dx, 0, right - 0.05);
        if (corner.includes("e")) w = clamp(w + dx, 0.05, 1 - x);
        if (corner.includes("n")) y = clamp(y + dy, 0, bottom - 0.05);
        if (corner.includes("s")) h = clamp(h + dy, 0.05, 1 - y);
        if (corner.includes("w")) w = right - x;
        if (corner.includes("n")) h = bottom - y;
        if (lock !== null) {
          // Height follows width; keep the dragged corner's opposite edge fixed.
          h = w / lock;
          if (corner.includes("n")) y = bottom - h;
          if (y < 0 || y + h > 1) {
            h = corner.includes("n") ? bottom : 1 - y;
            w = h * lock;
            if (corner.includes("n")) y = bottom - h;
            if (corner.includes("w")) x = right - w;
          }
        }
      }
      setRect([[x, y], [w, h]]);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const apply = () => {
    const [[x, y], [w, h]] = rect();
    const full = x < 0.002 && y < 0.002 && w > 0.996 && h > 0.996;
    void ed.update((e) => {
      if (full) delete e.crop;
      else e.crop = [[x, y], [w, h]];
    });
    props.onClose();
  };

  const pct = (v: number) => `${v * 100}%`;
  const px = () => ({ w: Math.round(rect()[1][0] * rec().width), h: Math.round(rect()[1][1] * rec().height) });

  return (
    <Dialog open={props.open} title="Crop" onClose={props.onClose} width={860}>
      <div class="ed-chips" style={{ "margin-bottom": "12px" }}>
        <For each={RATIOS}>
          {(r) => (
            <button type="button" class="ed-chip" data-selected={ratio() === r.value ? "true" : "false"} onClick={() => fit(r.value)}>
              {r.label}
            </button>
          )}
        </For>
      </div>
      <div class="ed-crop" style={{ "aspect-ratio": `${rec().width} / ${rec().height}`, "max-width": `calc(62vh * ${screenAspect()})` }}>
        <Show when={still()} fallback={<Spinner />}>
          <div ref={image} class="ed-crop__image" style={{ "background-image": `url(${still()})` }}>
            <div
              class="ed-crop__box"
              style={{ left: pct(rect()[0][0]), top: pct(rect()[0][1]), width: pct(rect()[1][0]), height: pct(rect()[1][1]) }}
              onPointerDown={(e) => drag("move", e)}
            >
              <i class="ed-crop__grid" />
              <For each={["nw", "ne", "sw", "se"] as const}>{(c) => <div class={`ed-handle ed-handle--${c}`} onPointerDown={(e) => drag(c, e)} />}</For>
            </div>
          </div>
        </Show>
      </div>
      <div class="ed-export__actions">
        <span class="umi-tabular ed-export__pct">
          {px().w} × {px().h}
        </span>
        <Button variant="ghost" onClick={() => setRect([[0, 0], [1, 1]])}>Reset</Button>
        <Button variant="ghost" onClick={props.onClose}>Cancel</Button>
        <Button variant="ink" onClick={apply}>
          Crop
        </Button>
      </div>
    </Dialog>
  );
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
