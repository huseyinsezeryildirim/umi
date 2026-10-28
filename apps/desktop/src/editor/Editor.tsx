import { EditableTitle } from "../EditableTitle";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { Button, IconButton, Kbd, Toaster, toast } from "@umi/ui";
import {
  ArrowLeft,
  Link,
  Pause,
  Play,
  Redo2,
  RotateCcw,
  Scissors,
  SkipBack,
  SkipForward,
  Share,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-solid";
import { CommandMenu, type Command } from "./CommandMenu";
import { ExportDialog } from "./ExportDialog";
import { Inspector } from "./Inspector";
import { PresetsMenu } from "./Presets";
import { ShareDialog } from "./ShareDialog";
import { VoiceoverDialog } from "./VoiceoverDialog";
import { Preview } from "./Preview";
import { formatTime, type Editor as EditorModel } from "./store";
import { Timeline } from "./Timeline";
import "./editor.css";

export function Editor(props: { editor: EditorModel; onBack: () => void }) {
  const ed = props.editor;
  const revert = async () => {
    await ed.revert();
    toast("Back to the original recording. Undo brings your edits back.");
  };
  const [exporting, setExporting] = createSignal(false);
  const [commanding, setCommanding] = createSignal(false);
  const [sharing, setSharing] = createSignal((import.meta.env.DEV || import.meta.env.VITE_DEMO) && new URLSearchParams(location.search).has("share"));

  const commands = (): Command[] => {
    const at = () => ed.time();
    const panel = (tab: string, title: string, keywords?: string): Command => ({ title, group: "Panel", keywords, run: () => ed.requestPanel(tab) });
    const list: Command[] = [
      { title: "Play / pause", group: "Playback", shortcut: "Space", run: ed.togglePlay },
      { title: "Go to start", group: "Playback", run: () => ed.setTime(0) },
      { title: "Split at playhead", group: "Edit", shortcut: "S", keywords: "cut clip", run: () => void ed.split() },
      { title: "Cut tool", group: "Edit", shortcut: "B", keywords: "blade scissors", run: () => ed.setBlade(true) },
      { title: "Undo", group: "Edit", shortcut: "⌘Z", run: () => void ed.undo() },
      { title: "Redo", group: "Edit", shortcut: "⇧⌘Z", run: () => void ed.redo() },
      { title: "Revert to original", group: "Edit", keywords: "reset raw start over undo all", run: () => void revert() },
      { title: "Add zoom", group: "Add", shortcut: "Z", run: () => void ed.apply({ op: "addZoom", time: at() }) },
      { title: "Add blur", group: "Add", keywords: "privacy hide mask", run: () => void ed.apply({ op: "addMask", time: at(), style: "blur" }) },
      { title: "Add spotlight", group: "Add", keywords: "highlight focus dim", run: () => void ed.apply({ op: "addMask", time: at(), style: "highlight" }) },
      { title: "Add title", group: "Add", keywords: "text", run: () => void ed.apply({ op: "addText", style: "title", time: at() }) },
      { title: "Add lower third", group: "Add", keywords: "text name", run: () => void ed.apply({ op: "addText", style: "lowerThird", time: at() }) },
      { title: "Add camera-only scene", group: "Add", keywords: "layout face", run: () => void ed.apply({ op: "addScene", layout: "cameraOnly", time: at() }) },
      { title: "Add split screen", group: "Add", keywords: "layout scene", run: () => void ed.apply({ op: "addScene", layout: "splitScreen", time: at() }) },
      { title: "Add 3D glide", group: "Add", keywords: "move perspective", run: () => void ed.apply({ op: "addMove", kind: "glide", time: at() }) },
      { title: "AI voiceover…", group: "Add", keywords: "voice speech narrate tts kokoro", run: () => ed.requestVoiceover() },
      { title: "Remove filler words", group: "Clean up", keywords: "um uh transcript", run: () => void ed.apply({ op: "removeFillers" }) },
      { title: "Shorten long pauses", group: "Clean up", keywords: "silence gaps", run: () => void ed.apply({ op: "removePauses", min: 1.0 }) },
      { title: "Speed up typing", group: "Clean up", keywords: "keyboard fast skip", run: () => void ed.apply({ op: "speedUpTyping", speed: 3 }) },
      { title: "Export…", group: "File", shortcut: "⌘E", keywords: "save mp4 gif mov", run: () => setExporting(true) },
      panel("background", "Background", "wallpaper gradient color"),
      panel("screen", "Screen frame", "padding corners shadow crop device"),
      panel("cursor", "Cursor", "pointer click keystrokes keys"),
      panel("camera", "Camera", "webcam bubble face"),
      panel("zoom", "Zoom settings", "smart click magnifier"),
      panel("color", "Color & effects", "grade look lut"),
      panel("captions", "Captions & transcript", "subtitles whisper srt text editing"),
      panel("audio", "Audio", "music noise volume voice"),
    ];
    for (const [value, label] of [
      ["wide", "16:9"],
      ["vertical", "9:16"],
      ["square", "1:1"],
      ["portrait", "4:5"],
    ] as const) {
      list.push({ title: `Shape ${label}`, group: "Format", keywords: "aspect ratio", run: () => void ed.update((e) => (e.aspect = value)) });
    }
    return list;
  };

  // Keyboard: Space, S, B, Z, ⌫, Esc, ←/→, ⌘Z/⇧⌘Z.
  // ⌘Z / ⇧⌘Z come from the app menu: in a text field they undo typing, otherwise the edit.
  onMount(() => {
    const unlisten = listen<string>("menu", (event) => {
      const typing = document.activeElement?.closest("input, textarea, [contenteditable]");
      if (typing) document.execCommand(event.payload);
      else void (event.payload === "redo" ? ed.redo() : ed.undo());
    });
    onCleanup(() => void unlisten.then((f) => f()));
  });

  onMount(() => {
    const key = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, [contenteditable]")) return;
      const mod = e.metaKey || e.ctrlKey;
      // ⌘Z is handled by the menu on macOS; Ctrl+Z (Windows/Linux, or Ctrl on a Mac) here.
      const mac = navigator.platform.toLowerCase().includes("mac");
      if (mac && e.ctrlKey && !e.metaKey && e.key.toLowerCase() === "z") {
        void (e.shiftKey ? ed.redo() : ed.undo());
      } else if (e.ctrlKey && !e.metaKey && e.key.toLowerCase() === "y") {
        void ed.redo();
      } else if (mod && e.key.toLowerCase() === "a") {
        // Select everything on the timeline.
        ed.setSelected([...document.querySelectorAll<HTMLElement>(".ed-timeline [data-sel]")].map((el) => JSON.parse(el.dataset.sel!)));
      } else if (mod && e.key.toLowerCase() === "k") {
        setCommanding(true);
      } else if (mod && e.key.toLowerCase() === "e") {
        setExporting(true);
      } else if (mod && e.key.toLowerCase() === "j" && ed.selection()?.kind === "clip") {
        void ed.apply({ op: "joinClips", index: (ed.selection() as { id: number }).id });
      } else if (mod) {
        return;
      } else if (e.key === " ") {
        ed.togglePlay();
      } else if (e.key === "s") {
        void ed.split();
      } else if (e.key === "b") {
        ed.setBlade(!ed.blade());
      } else if (e.key === "z") {
        void ed.apply({ op: "addZoom", time: ed.time() });
      } else if (e.key === "Backspace" || e.key === "Delete") {
        void ed.deleteSelection();
      } else if (e.key === "Escape") {
        if (ed.blade()) ed.setBlade(false);
        else {
          ed.setSelection(null);
          ed.setRange(null);
        }
      } else if (e.key === "ArrowLeft") {
        ed.setTime(ed.time() - (e.shiftKey ? 1 : 1 / 30));
      } else if (e.key === "ArrowRight") {
        ed.setTime(ed.time() + (e.shiftKey ? 1 : 1 / 30));
      } else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", key);
    onCleanup(() => window.removeEventListener("keydown", key));
  });

  return (
    <div class="ed">
      <header class="ed-topbar" data-tauri-drag-region onDblClick={() => void getCurrentWindow().toggleMaximize()}>
        <div class="ed-topbar__left" data-tauri-drag-region>
          <IconButton label="All recordings" onClick={props.onBack}>
            <ArrowLeft size={17} />
          </IconButton>
          <EditableTitle class="ed-title" value={ed.state().name} onRename={(title) => void ed.apply({ op: "setTitle", title })} />
        </div>
        <div class="ed-topbar__right">
          <IconButton label="Undo" shortcut="⌘Z" disabled={!ed.state().canUndo} onClick={() => void ed.undo()}>
            <Undo2 size={17} />
          </IconButton>
          <IconButton label="Redo" shortcut="⇧⌘Z" disabled={!ed.state().canRedo} onClick={() => void ed.redo()}>
            <Redo2 size={17} />
          </IconButton>
          <IconButton label="Revert to the original recording" onClick={() => void revert()}>
            <RotateCcw size={17} />
          </IconButton>
          <PresetsMenu editor={ed} />
          <div class="umi-divider umi-divider--vertical" />
          <Button tip="Get a link to this video" onClick={() => setSharing(true)}>
            <Link size={15} /> Share
          </Button>
          <Button variant="ink" tip="Save a video file" shortcut="⌘E" onClick={() => setExporting(true)}>
            <Share size={15} /> Export
          </Button>
        </div>
      </header>

      <main class="ed-main">
        <div class="ed-center">
          <Preview editor={ed} />
          <div class="ed-transport">
            <div class="ed-time umi-tabular">
              <span>{formatTime(ed.time())}</span>
              <span class="ed-time__total"> / {formatTime(ed.state().outputDuration)}</span>
            </div>
            <div class="ed-transport__center">
              <IconButton label="Previous cut" onClick={ed.previousEdge}>
                <SkipBack size={17} />
              </IconButton>
              <button type="button" class="ed-play" aria-label={ed.playing() ? "Pause" : "Play"} onClick={ed.togglePlay}>
                <Show when={ed.playing()} fallback={<Play size={20} fill="currentColor" />}>
                  <Pause size={20} fill="currentColor" />
                </Show>
              </button>
              <IconButton label="Next cut" onClick={ed.nextEdge}>
                <SkipForward size={17} />
              </IconButton>
            </div>
            <div class="ed-transport__right">
              <IconButton label="Cut tool" shortcut="B" active={ed.blade()} onClick={() => ed.setBlade(!ed.blade())}>
                <Scissors size={17} />
              </IconButton>
              <div class="umi-divider umi-divider--vertical" />
              <IconButton label="Zoom out timeline" size="sm" onClick={() => ed.setTimelineZoom(ed.timelineZoom() / 1.5)}>
                <ZoomOut size={15} />
              </IconButton>
              <IconButton label="Zoom in timeline" size="sm" onClick={() => ed.setTimelineZoom(ed.timelineZoom() * 1.5)}>
                <ZoomIn size={15} />
              </IconButton>
            </div>
          </div>
          <Timeline editor={ed} />
          <Show when={ed.blade()}>
            <div class="ed-hint umi-floating">
              Click the timeline to cut · <Kbd>Esc</Kbd> to stop
            </div>
          </Show>
        </div>
        <Inspector editor={ed} />
      </main>
      <ExportDialog editor={ed} open={exporting()} onClose={() => setExporting(false)} />
      <VoiceoverDialog editor={ed} />
      <ShareDialog editor={ed} open={sharing()} onClose={() => setSharing(false)} />
      <CommandMenu editor={ed} commands={commands} open={commanding()} onClose={() => setCommanding(false)} />
      <Toaster />
    </div>
  );
}
