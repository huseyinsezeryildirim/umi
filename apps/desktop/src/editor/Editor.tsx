import { getCurrentWindow } from "@tauri-apps/api/window";
import { onCleanup, onMount, Show } from "solid-js";
import { Button, IconButton, Kbd, Toaster } from "@umi/ui";
import {
  ArrowLeft,
  Link,
  Pause,
  Play,
  Redo2,
  Scissors,
  SkipBack,
  SkipForward,
  Share,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-solid";
import { Inspector } from "./Inspector";
import { Preview } from "./Preview";
import { formatTime, type Editor as EditorModel } from "./store";
import { Timeline } from "./Timeline";
import "./editor.css";

export function Editor(props: { editor: EditorModel; onBack: () => void }) {
  const ed = props.editor;

  // Keyboard: Space, S, B, Z, ⌫, Esc, ←/→, ⌘Z/⇧⌘Z.
  onMount(() => {
    const key = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, [contenteditable]")) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        void (e.shiftKey ? ed.redo() : ed.undo());
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
          <div class="ed-title" data-tauri-drag-region>
            {ed.state().name}
          </div>
        </div>
        <div class="ed-topbar__right">
          <IconButton label="Undo" shortcut="⌘Z" disabled={!ed.state().canUndo} onClick={() => void ed.undo()}>
            <Undo2 size={17} />
          </IconButton>
          <IconButton label="Redo" shortcut="⇧⌘Z" disabled={!ed.state().canRedo} onClick={() => void ed.redo()}>
            <Redo2 size={17} />
          </IconButton>
          <div class="umi-divider umi-divider--vertical" />
          <Button variant="glass" tip="Get a link to this video">
            <Link size={15} /> Share
          </Button>
          <Button variant="ink">
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
      <Toaster />
    </div>
  );
}
