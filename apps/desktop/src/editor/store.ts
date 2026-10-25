import { Channel, invoke } from "@tauri-apps/api/core";
import { batch, createSignal } from "solid-js";
import type { EditorState, EditSettings, Selection } from "./types";
import { placementEnd } from "./types";

type Op =
  | { op: "setEdit"; edit: EditSettings }
  | { op: "split"; time: number }
  | { op: "cut"; start: number; end: number }
  | { op: "deleteClip"; index: number }
  | { op: "joinClips"; index: number }
  | { op: "trimClip"; index: number; start?: number; end?: number }
  | { op: "setSpeed"; index: number; speed: number }
  | { op: "moveClip"; from: number; to: number }
  | { op: "clipToVideo2"; index: number; time: number }
  | { op: "addZoom"; time: number }
  | { op: "addMask"; time: number; style?: "blur" | "pixelate" | "highlight" }
  | { op: "addScene"; layout: string; time: number }
  | { op: "addText"; style: string; time: number }
  | { op: "addMove"; kind: string; time: number }
  | { op: "addOverlay"; file: string; kind: "video" | "image"; duration?: number; time: number }
  | { op: "retime"; selection: Selection; start: number; end: number }
  | { op: "delete"; selection: Selection }
  | { op: "deleteMany"; selections: Selection[] }
  | { op: "shiftMany"; selections: Selection[]; delta: number }
  | { op: "editCaptionLine"; ids: string[]; text: string }
  | { op: "cutWords"; ids: string[] }
  | { op: "removeFillers" }
  | { op: "removePauses"; min: number }
  | { op: "speedUpTyping"; speed: number }
  | { op: "beginGesture" }
  | { op: "endGesture" }
  | { op: "undo" }
  | { op: "redo" };

/** Rust's Selection enum is `{kind, id}` (adjacently tagged); music has no id. */
function toRust(selection: Selection) {
  return selection.kind === "music" ? { kind: "music" } : selection;
}

/**
 * One open editor: the state from Rust plus UI-only state (playhead, selection, zoom).
 * Every change goes through Rust (`apply`) so editing logic exists once.
 */
export function createEditor(initial: EditorState) {
  const [state, setState] = createSignal(initial);
  const [time, setTime] = createSignal(0);
  const [playing, setPlaying] = createSignal(false);
  /** Selected items; the last one is the "primary" one the inspector shows. */
  const [selected, setSelected] = createSignal<Selection[]>([]);
  const selection = () => selected()[selected().length - 1] ?? null;
  const setSelection = (s: Selection | null) => setSelected(s ? [s] : []);
  const isSelected = (s: Selection) => selected().some((x) => sameSelection(x, s));
  const toggleSelection = (s: Selection) =>
    setSelected((list) => (list.some((x) => sameSelection(x, s)) ? list.filter((x) => !sameSelection(x, s)) : [...list, s]));
  const [range, setRange] = createSignal<[number, number] | null>(null);
  const [timelineZoom, setTimelineZoom] = createSignal(1);
  const [blade, setBlade] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  /** The AI voiceover sheet (open, and which voiceover it edits). */
  const [voiceSheet, setVoiceSheet] = createSignal<{ replace?: string } | null>(null);
  /** An inspector tab something asked to show (e.g. "Add → Music…"). */
  const [panelRequest, requestPanel] = createSignal<{ tab: string } | null>(null);
  /** Mask being stuck to content, and how far along (0…1). */
  const [tracking, setTracking] = createSignal<{ mask: string; progress: number } | null>(null);
  /** Filmstrip pictures evenly over the recording, and voice peaks at 50/s. */
  const [thumbnails, setThumbnails] = createSignal<string[]>([]);
  const [waveform, setWaveform] = createSignal<number[]>([]);
  const bundle = initial.recording.bundle;
  void invoke<string[]>("recording_thumbnails", { path: bundle, count: Math.min(120, Math.max(24, Math.round(initial.recording.duration * 2))), height: 64 }).then(setThumbnails, () => {});
  void invoke<number[]>("recording_waveform", { path: bundle }).then(setWaveform, () => {});
  let saveTimer: number | undefined;

  const apply = async (op: Op) => {
    const body =
      op.op === "retime" || op.op === "delete"
        ? { ...op, selection: toRust(op.selection) }
        : op.op === "deleteMany" || op.op === "shiftMany"
          ? { ...op, selections: op.selections.map(toRust) }
          : op;
    const next = await invoke<EditorState>("editor_apply", { id: state().id, op: body });
    batch(() => {
      setState(next);
      if (next.selection) setSelection(next.selection);
      // Keep the playhead inside the (possibly shorter) video.
      if (time() > next.outputDuration) setTime(next.outputDuration);
    });
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => invoke("editor_save", { id: next.id }), 500);
    return next;
  };

  /** Changes the edit with a function (inspector controls). */
  const update = (change: (edit: EditSettings) => void) => {
    const edit = structuredClone(state().edit);
    change(edit);
    // Optimistic: show the change at once, then take Rust's version.
    setState({ ...state(), edit });
    return apply({ op: "setEdit", edit });
  };

  const edges = () => [0, ...state().placements.map(placementEnd)];

  return {
    state,
    time,
    playing,
    selection,
    selected,
    setSelected,
    isSelected,
    toggleSelection,
    range,
    timelineZoom,
    blade,
    busy,
    thumbnails,
    waveform,
    panelRequest,
    voiceSheet,
    requestVoiceover: (replace?: string) => setVoiceSheet({ replace }),
    closeVoiceover: () => setVoiceSheet(null),
    /** Whether a recording time is still in the video (not cut out). */
    isKept: (source: number) => state().placements.some((p) => source >= p.clip.start - 1e-3 && source <= p.clip.end + 1e-3),
    /** Output time showing recording time `source`, or null if it's cut out. */
    outputTimeAt: (source: number) => {
      const p = state().placements.find((p) => source >= p.clip.start - 1e-3 && source <= p.clip.end + 1e-3);
      return p ? p.outputStart + (source - p.clip.start) / p.clip.speed : null;
    },
    requestPanel: (tab: string) => requestPanel({ tab }),
    setTime: (t: number) => setTime(Math.min(Math.max(t, 0), state().outputDuration)),
    setPlaying,
    tracking,
    /**
     * Sticks a mask to the content under it at recording time `anchor`: follows it forward
     * and backward across the mask's span (Rust), then shows the result.
     */
    trackMask: async (mask: string, anchor: number) => {
      if (tracking()) return;
      setTracking({ mask, progress: 0 });
      try {
        const channel = new Channel<number>();
        channel.onmessage = (p) => setTracking({ mask, progress: p });
        const next = await invoke<EditorState>("editor_track_mask", { id: state().id, mask, anchor, progress: channel });
        setState(next);
      } finally {
        setTracking(null);
      }
    },
    /** Takes a state computed by a longer Rust job (tracking, imports). */
    replaceState: (next: EditorState) => setState(next),
    /** Play/pause; at the end, playing starts over from the beginning. */
    togglePlay: () => {
      if (playing()) return setPlaying(false);
      if (time() >= state().outputDuration - 0.05) setTime(0);
      setPlaying(true);
    },
    setSelection,
    setRange,
    setTimelineZoom: (z: number) => setTimelineZoom(Math.min(Math.max(z, 1), 24)),
    setBlade,
    setBusy,
    apply,
    update,
    gestureStart: () => apply({ op: "beginGesture" }),
    gestureEnd: () => apply({ op: "endGesture" }),
    undo: () => apply({ op: "undo" }),
    redo: () => apply({ op: "redo" }),
    split: () => apply({ op: "split", time: time() }),
    previousEdge: () => setTime(Math.max(0, ...edges().filter((e) => e < time() - 0.05))),
    nextEdge: () => setTime(Math.min(state().outputDuration, ...edges().filter((e) => e > time() + 0.05))),
    deleteSelection: async () => {
      const list = selected();
      if (list.length > 1) {
        await apply({ op: "deleteMany", selections: list });
        setSelection(null);
      } else if (list.length === 1) {
        await apply({ op: "delete", selection: list[0] });
        setSelection(null);
      } else if (range()) {
        const [a, b] = range()!;
        await apply({ op: "cut", start: a, end: b });
        setRange(null);
        setTime(a);
      }
    },
  };
}

export type Editor = ReturnType<typeof createEditor>;

/** Seconds as 0:07.4 (or 1:02:07 for long ones). */
export function formatTime(seconds: number, precise = true) {
  const s = Math.max(seconds, 0);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  if (m >= 60) return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}:${String(Math.floor(rest)).padStart(2, "0")}`;
  return precise ? `${m}:${rest.toFixed(1).padStart(4, "0")}` : `${m}:${String(Math.floor(rest)).padStart(2, "0")}`;
}

export function sameSelection(a: Selection | null, b: Selection) {
  return !!a && a.kind === b.kind && ("id" in a ? a.id === (b as { id: unknown }).id : true);
}
