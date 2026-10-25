import { invoke } from "@tauri-apps/api/core";
import { createEffect, createSignal, on, onCleanup, onMount, Show } from "solid-js";
import { MaskHandles } from "./Handles";
import type { Editor } from "./store";

/**
 * The preview stage: frames are rendered by the Rust compositor at the canvas' pixel size
 * and drawn here. Only the newest request matters, so scrubbing never queues up.
 */
export function Preview(props: { editor: Editor }) {
  const ed = props.editor;
  let stage!: HTMLDivElement;
  let canvas!: HTMLCanvasElement;
  const [box, setBox] = createSignal({ w: 0, h: 0 });
  const [frameSize, setFrameSize] = createSignal({ w: 16, h: 9 });
  let inFlight = false;
  let wanted: number | null = null;

  /** The selected mask (handles are shown and the preview is drawn flat while paused). */
  const selectedMask = () => {
    const s = ed.selection();
    return s?.kind === "mask" ? ed.state().edit.masks.find((m) => m.id === s.id) : undefined;
  };
  const flat = () => !ed.playing() && !!selectedMask();

  const request = (t: number) => {
    wanted = t;
    if (!inFlight) void pump();
  };

  const pump = async () => {
    if (wanted === null) return;
    const t = wanted;
    wanted = null;
    inFlight = true;
    try {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const { w, h } = box();
      if (w < 10 || h < 10) return;
      const buffer = await invoke<ArrayBuffer>("editor_frame", {
        id: ed.state().id,
        time: t,
        width: Math.round(w * dpr),
        height: Math.round(h * dpr),
        flat: flat(),
      });
      const view = new DataView(buffer);
      const fw = view.getUint32(0, true);
      const fh = view.getUint32(4, true);
      const pixels = new Uint8ClampedArray(buffer, 8, fw * fh * 4);
      if (canvas.width !== fw || canvas.height !== fh) {
        canvas.width = fw;
        canvas.height = fh;
      }
      canvas.getContext("2d")!.putImageData(new ImageData(pixels, fw, fh), 0, 0);
      setFrameSize({ w: fw, h: fh });
    } catch (e) {
      if (String(e) !== "superseded") console.warn("frame", e);
    } finally {
      inFlight = false;
      if (wanted !== null) void pump();
    }
  };

  onMount(() => {
    const ro = new ResizeObserver(([entry]) => {
      const r = entry.contentRect;
      setBox({ w: r.width, h: r.height });
    });
    ro.observe(stage);
    onCleanup(() => ro.disconnect());
  });

  // Re-render on time, edit or size changes.
  createEffect(on([ed.time, () => ed.state().edit, box, flat], () => request(ed.time())));

  // Playback clock: advances the playhead in real time; frames follow as fast as they render.
  createEffect(
    on(ed.playing, (playing) => {
      if (!playing) return;
      let last = performance.now();
      let raf = 0;
      const tick = (now: number) => {
        const next = ed.time() + (now - last) / 1000;
        last = now;
        if (next >= ed.state().outputDuration) {
          ed.setTime(ed.state().outputDuration);
          ed.setPlaying(false);
          return;
        }
        ed.setTime(next);
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      onCleanup(() => cancelAnimationFrame(raf));
    }),
  );

  // Fit the frame inside the stage keeping its aspect.
  const fittedBox = () => {
    const { w, h } = box();
    const a = frameSize().w / frameSize().h;
    const width = Math.min(w, h * a);
    const height = width / a;
    return { left: (w - width) / 2, top: (h - height) / 2, width, height };
  };

  return (
    <div ref={stage} class="ed-stage">
      <canvas ref={canvas} class="ed-canvas" style={{ width: `${fittedBox().width}px`, height: `${fittedBox().height}px` }} />
      <Show when={flat() && selectedMask()}>{(m) => <MaskHandles editor={ed} mask={m()} frame={fittedBox()} />}</Show>
    </div>
  );
}
