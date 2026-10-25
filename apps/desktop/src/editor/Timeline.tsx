import { createEffect, createMemo, createSignal, Index, on, For, onCleanup, onMount, Show } from "solid-js";
import { Menu, tokens, toast } from "@umi/ui";
import { Clapperboard, Cuboid, EyeOff, ImagePlus, Layers, Link2, Mic, Music, Plus, Sun, Type, ZoomIn } from "lucide-solid";
import { chooseIntoBundle, extensionOf, IMAGE_EXTENSIONS, VIDEO_EXTENSIONS } from "./panels/files";
import { formatTime, sameSelection, type Editor } from "./store";
import { placementEnd, type Placement, type Selection } from "./types";

const LABEL_W = 96;
const SCENE_LABELS = { default: "Default", cameraOnly: "Camera only", hideCamera: "Screen only", splitScreen: "Split screen", floating: "Floating" } as const;
const MASK_LABELS = { blur: "Blur", pixelate: "Pixelate", highlight: "Spotlight" } as const;
const MOVE_LABELS = { glide: "Glide across", unfold: "Unfold", pullBack: "Pull back" } as const;
const RULER_H = 26;
const CLIP_H = 58;
const LANE_H = 34;

interface Item {
  selection: Selection;
  start: number;
  end: number;
  label: string;
  color: string;
  dashed?: boolean;
  /** Timed on the output timeline (media) rather than the recording. */
  output?: boolean;
  /** Keyframe times (recording time) shown as diamonds; many become a tracked line. */
  marks?: number[];
  /** Moves but can't be trimmed (a voiceover is as long as its audio). */
  fixedLength?: boolean;
}

/** Maps a recording time to output time through the placements (null if cut away). */
function outputTimeOf(placements: Placement[], t: number) {
  const p = placements.find((p) => t >= p.clip.start && t <= p.clip.end);
  return p ? p.outputStart + (t - p.clip.start) / p.clip.speed : null;
}

function outputRange(placements: Placement[], start: number, end: number, total: number): [number, number] | null {
  const p = placements.find((p) => start >= p.clip.start && start <= p.clip.end);
  if (!p) return null;
  const a = p.outputStart + (start - p.clip.start) / p.clip.speed;
  const b = outputTimeOf(placements, end) ?? p.outputStart + (Math.min(end, p.clip.end) - p.clip.start) / p.clip.speed;
  return [a, Math.max(a, Math.min(b, total))];
}

export function Timeline(props: { editor: Editor }) {
  const ed = props.editor;
  let scroller!: HTMLDivElement;
  const [width, setWidth] = createSignal(800);
  const [hoverX, setHoverX] = createSignal<number | null>(null);
  const [marquee, setMarquee] = createSignal<{ left: number; top: number; right: number; bottom: number } | null>(null);
  const [magnet, setMagnet] = createSignal<{ index: number; mode: "start" | "end" } | null>(null);

  let content!: HTMLDivElement;
  onMount(() => {
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(scroller);
    // The cut tool takes the click before clips and items see it (capture phase).
    const bladeDown = (e: PointerEvent) => {
      if (!ed.blade() || e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      void ed.apply({ op: "split", time: timeAt(e.clientX) });
    };
    content.addEventListener("pointerdown", bladeDown, true);
    onCleanup(() => {
      ro.disconnect();
      content.removeEventListener("pointerdown", bladeDown, true);
    });
  });

  const duration = () => Math.max(ed.state().outputDuration, 0.1);
  const contentWidth = () => Math.max(width() - LABEL_W - 24, 100) * ed.timelineZoom();
  const scale = () => contentWidth() / duration();
  const x = (t: number) => t * scale();

  const lanes = createMemo(() => {
    const s = ed.state();
    const e = s.edit;
    const c = tokens.color.lanes;
    const list: { id: string; title: string; items: Item[] }[] = [];
    const zooms: Item[] = s.zoomSegments.map((z) => ({
      selection: { kind: "zoom", id: z.id },
      start: z.start,
      end: z.end,
      label: `${z.loupe ? "Magnifier " : ""}${z.scale.toFixed(1)}×${z.focus ? "" : " · follow"}`,
      color: c.zoom,
      dashed: !e.zoom.segments.some((m) => m.id === z.id),
    }));
    const video2 = e.overlays.filter((o) => o.lane === 2);
    if (video2.length) list.push({ id: "video2", title: "Video 2", items: video2.map((o) => ({ selection: { kind: "overlay", id: o.id }, start: o.start, end: o.end, label: `Clip · ${formatTime(o.mediaOffset, false)}`, color: c.video2, output: true })) });
    const media = e.overlays.filter((o) => o.lane !== 2);
    if (media.length) list.push({ id: "media", title: "Media", items: media.map((o) => ({ selection: { kind: "overlay", id: o.id }, start: o.start, end: o.end, label: o.file, color: c.media, output: true })) });
    const voices = e.voiceovers ?? [];
    if (voices.length) list.push({ id: "voice", title: "Voice", items: voices.map((v) => ({ selection: { kind: "voiceover", id: v.id }, start: v.start, end: v.end, label: v.text || "Voiceover", color: c.voice, output: true, fixedLength: true })) });
    if (zooms.length) list.push({ id: "zoom", title: "Zoom", items: zooms });
    if (e.scenes.length) list.push({ id: "scenes", title: "Scenes", items: e.scenes.map((x) => ({ selection: { kind: "scene", id: x.id }, start: x.start, end: x.end, label: SCENE_LABELS[x.layout], color: c.scene })) });
    const maskItem = (x: (typeof e.masks)[number]) => ({
      selection: { kind: "mask", id: x.id } as Selection,
      start: x.start,
      end: x.end,
      label: MASK_LABELS[x.style] + ((x.keyframes?.length ?? 0) > 20 ? " · tracked" : ""),
      color: x.style === "highlight" ? c.scene : c.mask,
      marks: x.keyframes?.map((k) => k.t),
    });
    const blurs = e.masks.filter((m) => m.style !== "highlight");
    const spots = e.masks.filter((m) => m.style === "highlight");
    if (blurs.length) list.push({ id: "blur", title: "Blur", items: blurs.map(maskItem) });
    if (spots.length) list.push({ id: "spotlight", title: "Spotlight", items: spots.map(maskItem) });
    if (e.texts.length) list.push({ id: "text", title: "Text", items: e.texts.map((x) => ({ selection: { kind: "text", id: x.id }, start: x.start, end: x.end, label: x.text, color: c.text })) });
    if (e.moves.length) list.push({ id: "moves", title: "3D", items: e.moves.map((x) => ({ selection: { kind: "move", id: x.id }, start: x.start, end: x.end, label: MOVE_LABELS[x.kind], color: c.move })) });
    return list;
  });


  // ───── Interactions ─────

  const timeAt = (clientX: number) => {
    const r = scroller.getBoundingClientRect();
    return (clientX - r.left + scroller.scrollLeft - LABEL_W - 12) / scale();
  };

  /**
   * Pointer down on an empty part of a lane: a click seeks (and clears the selection), a
   * drag draws a box that selects everything it touches (Shift adds to the selection).
   */
  const laneDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const r0 = content.getBoundingClientRect();
    const sx = e.clientX - r0.left;
    const sy = e.clientY - r0.top;
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    const before = additive ? ed.selected() : [];
    let boxing = false;
    const move = (m: PointerEvent) => {
      const r = content.getBoundingClientRect();
      const mx = m.clientX - r.left;
      const my = m.clientY - r.top;
      if (!boxing && Math.hypot(mx - sx, my - sy) < 5) return;
      boxing = true;
      const box = { left: Math.min(sx, mx), top: Math.min(sy, my), right: Math.max(sx, mx), bottom: Math.max(sy, my) };
      setMarquee(box);
      const hit: Selection[] = [];
      content.querySelectorAll<HTMLElement>("[data-sel]").forEach((el) => {
        const b = el.getBoundingClientRect();
        const l = b.left - r.left;
        const t = b.top - r.top;
        if (l < box.right && l + b.width > box.left && t < box.bottom && t + b.height > box.top) hit.push(JSON.parse(el.dataset.sel!));
      });
      const merged = [...before];
      for (const s of hit) if (!merged.some((x) => sameSelection(x, s))) merged.push(s);
      ed.setSelected(merged);
    };
    const up = (u: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setMarquee(null);
      if (!boxing) {
        if (!additive) ed.setSelection(null);
        ed.setTime(timeAt(u.clientX));
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const seek = (e: PointerEvent) => {
    ed.setTime(timeAt(e.clientX));
    const move = (m: PointerEvent) => ed.setTime(timeAt(m.clientX));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // Drag on the ruler selects a span (Delete cuts it); a click seeks.
  const rulerDown = (e: PointerEvent) => {
    const start = timeAt(e.clientX);
    let moved = false;
    ed.setRange(null);
    const move = (m: PointerEvent) => {
      const t = timeAt(m.clientX);
      if (Math.abs(t - start) * scale() > 4) moved = true;
      if (moved) {
        ed.setSelection(null);
        ed.setRange([Math.max(0, Math.min(start, t)), Math.min(duration(), Math.max(start, t))]);
      }
    };
    const up = (u: PointerEvent) => {
      if (!moved) ed.setTime(timeAt(u.clientX));
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // Zoom with ⌘/Ctrl + wheel or a pinch, around the pointer.
  const wheel = (e: WheelEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const anchor = timeAt(e.clientX);
    const before = x(anchor) - scroller.scrollLeft;
    ed.setTimelineZoom(ed.timelineZoom() * Math.exp(-e.deltaY * 0.01));
    requestAnimationFrame(() => (scroller.scrollLeft = x(anchor) + LABEL_W + 12 - (e.clientX - scroller.getBoundingClientRect().left)));
    void before;
  };

  /** Drag an item (move) or its edges (trim). Times move in source or output units. */
  const dragItem = (item: Item, mode: "move" | "start" | "end", e: PointerEvent) => {
    e.stopPropagation();
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      ed.toggleSelection(item.selection);
      return;
    }
    // Dragging one of several selected items moves them all.
    const group = mode === "move" && ed.isSelected(item.selection) && ed.selected().length > 1 ? ed.selected().filter((s) => s.kind !== "clip") : null;
    if (!group) ed.setSelection(item.selection);
    const origin = { start: item.start, end: item.end, x: e.clientX };
    let started = false;
    let applied = 0;
    const move = (m: PointerEvent) => {
      const dt = (m.clientX - origin.x) / scale();
      if (!started) {
        if (Math.abs(m.clientX - origin.x) < 3) return;
        started = true;
        void ed.gestureStart();
      }
      if (group) {
        // Incremental, so each step moves everything by what changed since the last one.
        void ed.apply({ op: "shiftMany", selections: group, delta: dt - applied });
        applied = dt;
        return;
      }
      const start = mode === "end" ? origin.start : origin.start + dt;
      const end = mode === "start" ? origin.end : origin.end + dt;
      void ed.apply({ op: "retime", selection: item.selection, start, end });
    };
    const up = () => {
      if (started) void ed.gestureEnd();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /** Clip: drag to reorder, down onto Video 2 to lay it over, edges to trim. */
  const dragClip = (index: number, p: Placement, mode: "move" | "start" | "end", e: PointerEvent) => {
    e.stopPropagation();
    if (ed.blade()) return;
    if (mode === "move" && (e.shiftKey || e.metaKey || e.ctrlKey)) {
      ed.toggleSelection({ kind: "clip", id: index });
      return;
    }
    ed.setSelection({ kind: "clip", id: index });
    const ox = e.clientX;
    const oy = e.clientY;
    const target = e.currentTarget as HTMLElement;
    let started = false;
    // Magnet join: dragging an edge onto the cut next to it snaps there; releasing joins.
    const placements = ed.state().placements;
    const neighbour = mode === "end" ? placements[index + 1] : mode === "start" ? placements[index - 1] : undefined;
    const joinable = !!neighbour && (mode === "end" ? neighbour.clip.start >= p.clip.end - 1e-6 : neighbour.clip.end <= p.clip.start + 1e-6);
    let armed = false;
    const move = (m: PointerEvent) => {
      const dx = m.clientX - ox;
      if (!started) {
        if (Math.hypot(dx, m.clientY - oy) < 4) return;
        started = true;
        void ed.gestureStart();
      }
      if (mode === "move") {
        target.style.transform = `translate(${dx}px, ${Math.max(0, m.clientY - oy)}px)`;
        target.dataset.lifted = m.clientY - oy > CLIP_H * 0.7 ? "true" : "false";
      } else {
        const dt = (dx / scale()) * p.clip.speed;
        let value = mode === "start" ? p.clip.start + dt : p.clip.end + dt;
        if (joinable && neighbour) {
          const seam = mode === "end" ? neighbour.clip.start : neighbour.clip.end;
          const snapPx = 12;
          const near = Math.abs(value - seam) * (scale() / p.clip.speed) < snapPx;
          const past = mode === "end" ? value >= seam : value <= seam;
          armed = near || past;
          if (armed) value = seam;
          setMagnet(armed ? { index, mode } : null);
        }
        void ed.apply({ op: "trimClip", index, ...(mode === "start" ? { start: value } : { end: value }) });
      }
    };
    const up = (u: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (mode === "move" && started) {
        target.style.transform = "";
        const dx = u.clientX - ox;
        if (u.clientY - oy > CLIP_H * 0.7 && ed.state().placements.length > 1) {
          void ed.apply({ op: "clipToVideo2", index, time: p.outputStart + dx / scale() });
        } else {
          const center = p.outputStart + (placementEnd(p) - p.outputStart) / 2 + dx / scale();
          const to = Math.max(0, ed.state().placements.findLastIndex((q) => q.outputStart <= center));
          if (to !== index) void ed.apply({ op: "moveClip", from: index, to });
        }
        delete target.dataset.lifted;
      }
      if (armed) {
        // The two clips now meet at the cut: make them one.
        void ed.apply({ op: "joinClips", index: mode === "end" ? index : index - 1 }).then(() => void ed.gestureEnd());
        toast("Clips joined");
      } else if (started) void ed.gestureEnd();
      setMagnet(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // While playing, keep the playhead in view: when it leaves the visible part, page so it
  // sits near the left. A manual scroll during playback pauses following until the next play.
  let following = true;
  let programmatic = false;
  createEffect(on(ed.playing, (playing) => (following = playing)));
  createEffect(() => {
    const t = ed.time();
    if (!ed.playing() || !following || !scroller) return;
    const px = LABEL_W + 12 + x(t);
    const left = scroller.scrollLeft + LABEL_W;
    const right = scroller.scrollLeft + scroller.clientWidth;
    if (px > right - 40 || px < left) {
      programmatic = true;
      scroller.scrollTo({ left: Math.max(0, px - LABEL_W - scroller.clientWidth * 0.15), behavior: "smooth" });
    }
  });
  const userScroll = () => {
    if (programmatic) {
      // A smooth scroll fires many events; it ends when the position settles.
      window.clearTimeout(settle);
      settle = window.setTimeout(() => (programmatic = false), 120);
      return;
    }
    if (ed.playing()) following = false;
  };
  let settle: number | undefined;

  const ticks = createMemo(() => {
    const pps = scale();
    const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    const major = steps.find((s) => s * pps >= 84) ?? 600;
    const minor = major / 5;
    const list: { t: number; major: boolean }[] = [];
    for (let i = 0; i * minor <= duration() + 1e-6; i++) list.push({ t: i * minor, major: i % 5 === 0 });
    return { list, major };
  });

  return (
    <div class="ed-timeline umi-panel">
      <div ref={scroller} class="ed-tl-scroll" onWheel={wheel} onScroll={userScroll}>
        <div class="ed-tl-labels">
          <div style={{ height: `${RULER_H}px`, flex: "none", display: "flex", "align-items": "center" }}>
            <AddMenu editor={ed} />
          </div>
          <div class="ed-tl-label" style={{ height: `${CLIP_H}px` }}>
            Video
          </div>
          <For each={lanes()}>
            {(lane) => (
              <div class="ed-tl-label" style={{ height: `${LANE_H}px` }}>
                {lane.title}
              </div>
            )}
          </For>
        </div>
        <div
          ref={content}
          class="ed-tl-content"
          style={{ width: `${contentWidth() + 24}px` }}
          data-blade={ed.blade() ? "true" : "false"}
          onPointerMove={(e) => ed.blade() && setHoverX(e.clientX - scroller.getBoundingClientRect().left + scroller.scrollLeft - LABEL_W)}
          onPointerLeave={() => setHoverX(null)}
          onPointerDown={(e) => {
            // Empty space anywhere in the timeline (below or between lanes) starts a selection box.
            if (e.target === e.currentTarget) laneDown(e);
          }}
        >
          {/* Ruler */}
          <div class="ed-ruler" style={{ height: `${RULER_H}px` }} onPointerDown={rulerDown}>
            <For each={ticks().list}>
              {(tick) => (
                <div class="ed-tick" data-major={tick.major ? "true" : "false"} style={{ left: `${12 + x(tick.t)}px` }}>
                  <Show when={tick.major}>
                    <span>{formatTime(tick.t, ticks().major < 1)}</span>
                  </Show>
                </div>
              )}
            </For>
          </div>

          {/* Clips */}
          <div class="ed-lane ed-lane--clips" style={{ height: `${CLIP_H}px` }} onPointerDown={laneDown}>
            <Index each={ed.state().placements}>
              {(p, i) => {
                // Index keeps each clip's element while its placement changes (smooth trims).
                const selected = () => ed.isSelected({ kind: "clip", id: i });
                const width = () => Math.max(x(placementEnd(p()) - p().outputStart) - 2, 8);
                return (
                  <div
                    class="ed-clip"
                    data-selected={selected() ? "true" : "false"}
                    data-magnet={magnet()?.index === i ? magnet()!.mode : ""}
                    data-sel={JSON.stringify({ kind: "clip", id: i })}
                    style={{ left: `${12 + x(p().outputStart)}px`, width: `${width()}px` }}
                    onPointerDown={(e) => dragClip(i, p(), "move", e)}
                  >
                    <Filmstrip editor={ed} placement={p()} width={width()} />
                    <Waveform editor={ed} placement={p()} width={width()} />
                    <span class="ed-clip__label">
                      Clip {i + 1}
                      <Show when={p().clip.speed !== 1}>
                        <b>{p().clip.speed}×</b>
                      </Show>
                    </span>
                    <div class="ed-trim ed-trim--start" onPointerDown={(e) => dragClip(i, p(), "start", e)} />
                    <div class="ed-trim ed-trim--end" onPointerDown={(e) => dragClip(i, p(), "end", e)} />
                  </div>
                );
              }}
            </Index>
          </div>

          {/* Join buttons on the seams between clips (undo a split or a cut). */}
          <For each={ed.state().placements.slice(0, -1)}>
            {(p, i) => (
              <Show when={!ed.blade()}>
                <button
                  type="button"
                  class="ed-seam"
                  title="Join these clips"
                  style={{ left: `${12 + x(placementEnd(p))}px`, top: `${RULER_H + 6 + CLIP_H / 2}px` }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => void ed.apply({ op: "joinClips", index: i() })}
                >
                  <Link2 size={12} />
                </button>
              </Show>
            )}
          </For>

          {/* Lanes */}
          <For each={lanes()}>
            {(lane) => (
              <div class="ed-lane" style={{ height: `${LANE_H}px` }} onPointerDown={laneDown}>
                <For each={lane.items}>
                  {(item) => {
                    const span = () => (item.output ? ([item.start, item.end] as [number, number]) : outputRange(ed.state().placements, item.start, item.end, duration()));
                    return (
                      <Show when={span()}>
                        {(r) => (
                          <div
                            class="ed-item"
                            data-selected={ed.isSelected(item.selection) ? "true" : "false"}
                            data-sel={JSON.stringify(item.selection)}
                            data-dashed={item.dashed ? "true" : "false"}
                            style={{ left: `${12 + x(r()[0])}px`, width: `${Math.max(x(r()[1] - r()[0]) - 2, 12)}px`, "--lane": item.color }}
                            onPointerDown={(e) => dragItem(item, "move", e)}
                          >
                            <span>{item.label}</span>
                            <Show when={item.marks && item.marks.length > 0 && item.marks.length <= 20}>
                              <For each={item.marks}>
                                {(m) => {
                                  const at = () => outputTimeOf(ed.state().placements, m);
                                  return (
                                    <Show when={at() !== null}>
                                      <i class="ed-key" style={{ left: `${x(at()! - r()[0])}px` }} />
                                    </Show>
                                  );
                                }}
                              </For>
                            </Show>
                            <Show when={!item.fixedLength}>
                              <div class="ed-trim ed-trim--start" onPointerDown={(e) => dragItem(item, "start", e)} />
                              <div class="ed-trim ed-trim--end" onPointerDown={(e) => dragItem(item, "end", e)} />
                            </Show>
                          </div>
                        )}
                      </Show>
                    );
                  }}
                </For>
              </div>
            )}
          </For>

          {/* Selection box */}
          <Show when={marquee()}>
            {(m) => <div class="ed-marquee" style={{ left: `${m().left}px`, top: `${m().top}px`, width: `${m().right - m().left}px`, height: `${m().bottom - m().top}px` }} />}
          </Show>

          {/* Selected span */}
          <Show when={ed.range()}>
            {(r) => <div class="ed-range" style={{ left: `${12 + x(r()[0])}px`, width: `${Math.max(x(r()[1] - r()[0]), 2)}px` }} />}
          </Show>

          {/* Blade line */}
          <Show when={ed.blade() && hoverX() !== null}>
            <div class="ed-blade" style={{ left: `${hoverX()}px` }}>
              <span>{formatTime(Math.max(0, (hoverX()! - 12) / scale()))}</span>
            </div>
          </Show>

          {/* Playhead */}
          <div class="ed-playhead" style={{ transform: `translateX(${12 + x(ed.time())}px)` }}>
            <div class="ed-playhead__knob" onPointerDown={(e) => (e.stopPropagation(), seek(e))} />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Pictures along a clip: one tile per ~tile width, each the recording near that moment. */
function Filmstrip(props: { editor: Editor; placement: Placement; width: number }) {
  const tiles = createMemo(() => {
    const thumbs = props.editor.thumbnails();
    if (!thumbs.length) return [];
    const total = props.editor.state().recording.duration || 1;
    const { start, end } = props.placement.clip;
    const tileW = CLIP_H * 1.6;
    const n = Math.max(1, Math.ceil(props.width / tileW));
    return Array.from({ length: n }, (_, i) => {
      const t = start + ((i + 0.5) / n) * (end - start);
      return thumbs[Math.min(thumbs.length - 1, Math.floor((t / total) * thumbs.length))];
    });
  });
  return (
    <div class="ed-clip__film">
      <For each={tiles()}>{(src) => <img src={src} alt="" draggable={false} />}</For>
    </div>
  );
}

/** The voice's loudness along the clip, drawn as a soft mirrored shape at the bottom. */
function Waveform(props: { editor: Editor; placement: Placement; width: number }) {
  const path = createMemo(() => {
    const peaks = props.editor.waveform();
    if (!peaks.length) return "";
    const { start, end } = props.placement.clip;
    const w = props.width;
    const h = 18;
    const steps = Math.max(2, Math.floor(w / 2));
    let top = `M0 ${h}`;
    for (let i = 0; i <= steps; i++) {
      const t = start + (i / steps) * (end - start);
      const v = peaks[Math.min(peaks.length - 1, Math.floor(t * 50))] ?? 0;
      top += ` L${((i / steps) * w).toFixed(1)} ${(h - Math.max(v * h, 0.6)).toFixed(1)}`;
    }
    return `${top} L${w} ${h} Z`;
  });
  return (
    <svg class="ed-clip__wave" width={props.width} height={18} viewBox={`0 0 ${props.width} 18`} preserveAspectRatio="none">
      <path d={path()} />
    </svg>
  );
}

/** Asks for an image or video and lays it on the Media track at the playhead. */
async function addMedia(ed: Editor) {
  const time = ed.time();
  const file = await chooseIntoBundle(ed, "Image or video", [...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS], "media");
  if (!file) return;
  const kind = VIDEO_EXTENSIONS.includes(extensionOf(file.name)) ? "video" : "image";
  await ed.apply({ op: "addOverlay", file: file.name, kind, time });
}

/** Adds things at the playhead (zooms, masks, text, scenes, 3D moves). */
function AddMenu(props: { editor: Editor }) {
  const ed = props.editor;
  return (
    <Menu
      width={210}
      trigger={(open, isOpen) => (
        <button type="button" class="ed-add" data-open={isOpen() ? "true" : "false"} onClick={open}>
          <Plus size={14} /> Add
        </button>
      )}
      entries={[
        { label: "Zoom", icon: <ZoomIn size={15} />, shortcut: "Z", onSelect: () => void ed.apply({ op: "addZoom", time: ed.time() }) },
        { label: "Blur", icon: <EyeOff size={15} />, onSelect: () => void ed.apply({ op: "addMask", time: ed.time(), style: "blur" }) },
        { label: "Spotlight", icon: <Sun size={15} />, onSelect: () => void ed.apply({ op: "addMask", time: ed.time(), style: "highlight" }) },
        { label: "Image or video…", icon: <ImagePlus size={15} />, onSelect: () => void addMedia(ed) },
        { label: "Music…", icon: <Music size={15} />, onSelect: () => ed.requestPanel("audio") },
        { label: "AI voiceover…", icon: <Mic size={15} />, onSelect: () => ed.requestVoiceover() },
        { kind: "separator" },
        { kind: "label", label: "Text" },
        { label: "Title", icon: <Type size={15} />, onSelect: () => void ed.apply({ op: "addText", style: "title", time: ed.time() }) },
        { label: "Lower third", icon: <Type size={15} />, onSelect: () => void ed.apply({ op: "addText", style: "lowerThird", time: ed.time() }) },
        { label: "Big stat", icon: <Type size={15} />, onSelect: () => void ed.apply({ op: "addText", style: "bigStat", time: ed.time() }) },
        { kind: "separator" },
        { kind: "label", label: "Layout" },
        { label: "Camera only", icon: <Clapperboard size={15} />, onSelect: () => void ed.apply({ op: "addScene", layout: "cameraOnly", time: ed.time() }) },
        { label: "Split screen", icon: <Layers size={15} />, onSelect: () => void ed.apply({ op: "addScene", layout: "splitScreen", time: ed.time() }) },
        { label: "Floating camera", icon: <Layers size={15} />, onSelect: () => void ed.apply({ op: "addScene", layout: "floating", time: ed.time() }) },
        { label: "3D move", icon: <Cuboid size={15} />, onSelect: () => void ed.apply({ op: "addMove", kind: "glide", time: ed.time() }) },
      ]}
    />
  );
}
