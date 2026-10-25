import { Channel, invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { createEffect, createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { Button, Dialog, IconButton, Menu, Progress, Spinner, toast } from "@umi/ui";
import { Circle, Download, Film, FolderOpen, MoreHorizontal, Trash2, Upload } from "lucide-solid";
import { Editor } from "./editor/Editor";
import { installRecordingFlow } from "./recorder/flow";
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

  // Recording (launcher, tray, shortcuts) is run from here; a finished recording opens.
  installRecordingFlow((bundle) => {
    void refetch();
    void open(bundle);
  });

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
  const [loom, setLoom] = createSignal(false);
  const importFiles = async () => {
    const picked = await openDialog({ title: "Import videos", multiple: true, filters: [{ name: "Videos", extensions: ["mp4", "mov", "m4v", "webm", "mkv"] }] });
    const paths = Array.isArray(picked) ? picked : picked ? [picked] : [];
    if (!paths.length) return;
    try {
      const made = await invoke<string[]>("import_videos", { paths });
      toast(made.length === 1 ? "Video imported" : `${made.length} videos imported`);
      props.onChanged();
    } catch (e) {
      toast(String(e));
    }
  };
  return (
    <div class="lib" data-tauri-drag-region>
      <header class="lib__header" data-tauri-drag-region>
        <h1>Recordings</h1>
        <div class="lib__actions">
          <Button size="sm" variant="ink" onClick={() => void invoke("window_show", { view: "launcher" })}>
            <Circle size={10} fill="#ff4d4d" stroke="none" /> New recording
          </Button>
          <Button size="sm" onClick={() => void importFiles()}>
            <Upload size={14} /> Import video
          </Button>
          <Button size="sm" onClick={() => setLoom(true)}>
            <Download size={14} /> Import from Loom
          </Button>
        </div>
      </header>
      <LoomImport open={loom()} onClose={() => setLoom(false)} onDone={props.onChanged} />
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

/** Paste Loom share links; each video downloads into the library (free, no account needed). */
function LoomImport(props: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [links, setLinks] = createSignal("");
  const [progress, setProgress] = createSignal<{ index: number; total: number; value: number } | null>(null);
  const run = async () => {
    const list = links()
      .split(/\s+/)
      .map((l) => l.trim())
      .filter((l) => l.includes("loom.com/"));
    if (!list.length) return toast("Paste one or more loom.com/share/… links");
    let done = 0;
    for (const [index, link] of list.entries()) {
      const channel = new Channel<number>();
      channel.onmessage = (value) => setProgress({ index, total: list.length, value });
      setProgress({ index, total: list.length, value: 0 });
      try {
        await invoke("import_loom", { link, progress: channel });
        done++;
      } catch (e) {
        toast(String(e));
      }
    }
    setProgress(null);
    if (done) {
      toast(done === 1 ? "Loom video imported" : `${done} Loom videos imported`);
      props.onDone();
      setLinks("");
      props.onClose();
    }
  };
  return (
    <Dialog open={props.open} title="Import from Loom" onClose={() => !progress() && props.onClose()} width={480}>
      <p class="umi-section__hint" style={{ "margin-top": "-6px" }}>
        Paste share links, one per line. Videos must be viewable by anyone with the link. They're downloaded to this computer and become recordings you can edit.
      </p>
      <textarea class="umi-input ed-script" style={{ "min-height": "110px", width: "100%" }} placeholder="https://www.loom.com/share/…" value={links()} onInput={(e) => setLinks(e.currentTarget.value)} />
      <Show when={progress()}>
        {(p) => (
          <div style={{ display: "flex", "flex-direction": "column", gap: "6px", "margin-top": "10px" }}>
            <div class="umi-section__hint">
              Downloading {p().index + 1} of {p().total}… {Math.round(p().value * 100)}%
            </div>
            <Progress value={p().value} />
          </div>
        )}
      </Show>
      <div style={{ display: "flex", gap: "8px", "justify-content": "flex-end", "margin-top": "14px" }}>
        <Button onClick={props.onClose} disabled={!!progress()}>
          Cancel
        </Button>
        <Button variant="ink" onClick={() => void run()} disabled={!!progress() || !links().trim()}>
          <Download size={14} /> Import
        </Button>
      </div>
    </Dialog>
  );
}
