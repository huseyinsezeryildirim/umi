import { invoke } from "@tauri-apps/api/core";
import { createEffect, createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { Button, Dialog, IconButton, Menu, Spinner, toast } from "@umi/ui";
import { Film, FolderOpen, MoreHorizontal, Trash2 } from "lucide-solid";
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
    <Show when={editor()} fallback={<Library recordings={recordings() ?? []} loading={recordings.loading} opening={opening()} onOpen={open} onChanged={() => void refetch()} />}>
      {(ed) => <Editor editor={ed()} onBack={back} />}
    </Show>
  );
}

function Library(props: { recordings: RecordingSummary[]; loading: boolean; opening: string | null; onOpen: (path: string) => void; onChanged: () => void }) {
  return (
    <div class="lib" data-tauri-drag-region>
      <header class="lib__header" data-tauri-drag-region>
        <h1>Recordings</h1>
      </header>
      <Show when={!props.loading} fallback={<Spinner />}>
        <div class="lib__grid">
          <For each={props.recordings} fallback={<p class="lib__empty">No recordings yet.</p>}>
            {(r, i) => <RecordingCard recording={r} index={i()} opening={props.opening === r.path} onOpen={() => props.onOpen(r.path)} onChanged={props.onChanged} />}
          </For>
        </div>
      </Show>
    </div>
  );
}

/** A recording: poster, and on hover short snippets from across it (not the whole video). */
function RecordingCard(props: { recording: RecordingSummary; index: number; opening: boolean; onOpen: () => void; onChanged: () => void }) {
  const [confirm, setConfirm] = createSignal(false);
  const trash = async () => {
    try {
      await invoke("recording_trash", { path: props.recording.path });
      toast("Moved to the Trash");
      props.onChanged();
    } catch (e) {
      toast(`Couldn't delete: ${e}`);
    }
  };
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
    <div role="button" tabIndex={0} class="lib__card umi-card" onClick={props.onOpen} onKeyDown={(e) => e.key === "Enter" && props.onOpen()} onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)}>
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
        <div class="lib__more" onClick={(e) => e.stopPropagation()}>
          <Menu
            align="end"
            trigger={(open) => (
              <IconButton label="More" size="sm" variant="glass" onClick={open}>
                <MoreHorizontal size={15} />
              </IconButton>
            )}
            entries={[
              { label: "Open", icon: <Film size={15} />, onSelect: props.onOpen },
              { label: "Show in Finder", icon: <FolderOpen size={15} />, onSelect: () => void invoke("recording_reveal", { path: props.recording.path }) },
              { kind: "separator" },
              { label: "Move to Trash", icon: <Trash2 size={15} />, onSelect: () => setConfirm(true) },
            ]}
          />
        </div>
      </div>
      <Dialog open={confirm()} title="Move this recording to the Trash?" onClose={() => setConfirm(false)} width={420}>
        <p class="umi-section__hint" style={{ "margin-top": 0 }}>
          “{props.recording.name}” goes to the Trash with its edits. You can put it back from there.
        </p>
        <div style={{ display: "flex", gap: "8px", "justify-content": "flex-end", "margin-top": "16px" }}>
          <Button onClick={() => setConfirm(false)}>Cancel</Button>
          <Button
            variant="ink"
            onClick={() => {
              setConfirm(false);
              void trash();
            }}
          >
            Move to Trash
          </Button>
        </div>
      </Dialog>
      <div class="lib__meta">
        <div class="lib__name">{props.recording.name}</div>
        <div class="lib__sub">{new Date(props.recording.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</div>
      </div>
    </div>
  );
}
