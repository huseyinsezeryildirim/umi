import { invoke } from "@tauri-apps/api/core";
import { createEffect, createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { Spinner, toast } from "@umi/ui";
import { Film } from "lucide-solid";
import { Editor } from "./editor/Editor";
import { createEditor, formatTime, type Editor as EditorModel } from "./editor/store";
import type { EditorState, RecordingSummary } from "./editor/types";

export function App() {
  const [editor, setEditor] = createSignal<EditorModel | null>(null);
  const [opening, setOpening] = createSignal<string | null>(null);
  const [recordings, { refetch }] = createResource(() => invoke<RecordingSummary[]>("list_recordings"));

  const open = async (path: string) => {
    setOpening(path);
    try {
      const state = await invoke<EditorState>("open_editor", { path });
      setEditor(createEditor(state));
    } catch (e) {
      toast(`Couldn't open: ${e}`);
    } finally {
      setOpening(null);
    }
  };

  const back = async () => {
    const ed = editor();
    if (ed) await invoke("editor_save", { id: ed.state().id });
    setEditor(null);
    void refetch();
  };

  return (
    <Show when={editor()} fallback={<Library recordings={recordings() ?? []} loading={recordings.loading} opening={opening()} onOpen={open} />}>
      {(ed) => <Editor editor={ed()} onBack={back} />}
    </Show>
  );
}

function Library(props: { recordings: RecordingSummary[]; loading: boolean; opening: string | null; onOpen: (path: string) => void }) {
  return (
    <div class="lib" data-tauri-drag-region>
      <header class="lib__header" data-tauri-drag-region>
        <h1>Recordings</h1>
      </header>
      <Show when={!props.loading} fallback={<Spinner />}>
        <div class="lib__grid">
          <For each={props.recordings} fallback={<p class="lib__empty">No recordings yet.</p>}>
            {(r, i) => <RecordingCard recording={r} index={i()} opening={props.opening === r.path} onOpen={() => props.onOpen(r.path)} />}
          </For>
        </div>
      </Show>
    </div>
  );
}

/** A recording: poster, and on hover short snippets from across it (not the whole video). */
function RecordingCard(props: { recording: RecordingSummary; index: number; opening: boolean; onOpen: () => void }) {
  const [frames, setFrames] = createSignal<string[]>([]);
  const [frame, setFrame] = createSignal(0);
  const [hover, setHover] = createSignal(false);
  // Stagger loading so the first cards appear first and the disk isn't flooded.
  onMount(() => {
    const timer = window.setTimeout(() => {
      void invoke<string[]>("recording_preview", { path: props.recording.path }).then(setFrames, () => {});
    }, props.index * 120);
    onCleanup(() => window.clearTimeout(timer));
  });
  createEffect(() => {
    if (!hover() || frames().length < 2) return setFrame(0);
    const timer = window.setInterval(() => setFrame((f) => (f + 1) % frames().length), 125);
    onCleanup(() => window.clearInterval(timer));
  });
  const segment = () => Math.floor(frame() / 6);
  return (
    <button type="button" class="lib__card umi-card" onClick={props.onOpen} onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)}>
      <div class="lib__thumb">
        <Show when={frames().length} fallback={<Film size={28} />}>
          <img src={frames()[frame()]} alt="" draggable={false} />
        </Show>
        <Show when={hover() && frames().length > 6}>
          <div class="lib__dots">
            <For each={[0, 1, 2, 3]}>{(s) => <i data-on={s === segment() ? "true" : "false"} />}</For>
          </div>
        </Show>
        <Show when={props.opening}>
          <div class="lib__opening">
            <Spinner />
          </div>
        </Show>
        <span class="lib__duration">{formatTime(props.recording.duration, false)}</span>
      </div>
      <div class="lib__meta">
        <div class="lib__name">{props.recording.name}</div>
        <div class="lib__sub">{new Date(props.recording.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</div>
      </div>
    </button>
  );
}
