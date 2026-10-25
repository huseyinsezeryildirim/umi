import { Channel, invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { createEffect, createSignal, Match, on, Show, Switch } from "solid-js";
import { Button, Dialog, Progress, Segmented } from "@umi/ui";
import { CheckCircle2, FolderOpen } from "lucide-solid";
import type { Editor } from "./store";

type Format = "mp4" | "mov" | "gif";
type Phase = { kind: "setup" } | { kind: "running"; progress: number } | { kind: "done"; path: string } | { kind: "failed"; message: string };

/** Export: format, size and frame rate, where to save; progress, then show the file. */
export function ExportDialog(props: { editor: Editor; open: boolean; onClose: () => void }) {
  const ed = props.editor;
  const [format, setFormat] = createSignal<Format>("mp4");
  const [resolution, setResolution] = createSignal(1080);
  const [fps, setFps] = createSignal(60);
  const [destination, setDestination] = createSignal("");
  const [phase, setPhase] = createSignal<Phase>({ kind: "setup" });

  // A fresh default file name whenever the dialog opens or the format changes.
  createEffect(
    on([() => props.open, format], ([open]) => {
      if (!open || phase().kind === "running") return;
      if (phase().kind !== "setup") setPhase({ kind: "setup" });
      void invoke<string>("export_default_path", { name: ed.state().name, extension: format() }).then(setDestination);
    }),
  );

  const choose = async () => {
    const path = await save({ defaultPath: destination(), filters: [{ name: format().toUpperCase(), extensions: [format()] }] });
    if (path) setDestination(path);
  };

  const run = async () => {
    const channel = new Channel<number>();
    channel.onmessage = (p) => setPhase({ kind: "running", progress: p });
    setPhase({ kind: "running", progress: 0 });
    try {
      const path = await invoke<string>("editor_export", {
        id: ed.state().id,
        request: { format: format(), resolution: format() === "gif" ? Math.min(resolution(), 540) : resolution(), fps: fps(), destination: destination() },
        progress: channel,
      });
      setPhase({ kind: "done", path });
    } catch (e) {
      setPhase(String(e) === "cancelled" ? { kind: "setup" } : { kind: "failed", message: String(e) });
    }
  };

  const close = () => {
    if (phase().kind === "running") return;
    props.onClose();
  };

  const fileName = () => destination().split(/[\\/]/).pop() ?? "";

  return (
    <Dialog open={props.open} title="Export" onClose={close} width={440}>
      <div class="ed-export">
        <Switch>
          <Match when={phase().kind === "setup" || phase().kind === "failed"}>
            <div class="umi-field-label">Format</div>
            <Segmented
              value={format()}
              onChange={setFormat}
              options={[
                { value: "mp4", label: "MP4" },
                { value: "mov", label: "MOV" },
                { value: "gif", label: "GIF" },
              ]}
            />
            <div class="umi-field-label">Quality</div>
            <Show
              when={format() !== "gif"}
              fallback={<div class="umi-section__hint">GIFs are made at 540p and 15 fps to stay small.</div>}
            >
              <Segmented
                value={resolution()}
                onChange={setResolution}
                options={[
                  { value: 720, label: "720p" },
                  { value: 1080, label: "1080p" },
                  { value: 1440, label: "1440p" },
                  { value: 2160, label: "4K" },
                ]}
              />
              <Segmented
                value={fps()}
                onChange={setFps}
                options={[
                  { value: 30, label: "30 fps" },
                  { value: 60, label: "60 fps" },
                ]}
              />
            </Show>
            <div class="umi-field-label">Save to</div>
            <button type="button" class="ed-export__file" onClick={() => void choose()} title={destination()}>
              <FolderOpen size={15} />
              <span>{fileName()}</span>
              <em>Change…</em>
            </button>
            <Show when={phase().kind === "failed"}>
              <div class="ed-export__error">Couldn't export: {(phase() as { message: string }).message}</div>
            </Show>
            <div class="ed-export__actions">
              <Button variant="ghost" onClick={close}>Cancel</Button>
              <Button variant="ink" onClick={() => void run()} disabled={!destination()}>
                Export
              </Button>
            </div>
          </Match>
          <Match when={phase().kind === "running"}>
            <div class="umi-section__hint">Exporting {fileName()}…</div>
            <Progress value={(phase() as { progress: number }).progress} />
            <div class="ed-export__actions">
              <span class="umi-tabular ed-export__pct">{Math.round((phase() as { progress: number }).progress * 100)}%</span>
              <Button variant="ghost" onClick={() => void invoke("editor_export_cancel", { id: ed.state().id })}>Cancel</Button>
            </div>
          </Match>
          <Match when={phase().kind === "done"}>
            <div class="ed-export__done">
              <CheckCircle2 size={28} />
              <div>
                <strong>Exported</strong>
                <div class="umi-section__hint">{fileName()}</div>
              </div>
            </div>
            <div class="ed-export__actions">
              <Button onClick={() => void invoke("recording_reveal", { path: (phase() as { path: string }).path })}>
                <FolderOpen size={15} /> Show in Finder
              </Button>
              <Button variant="ink" onClick={props.onClose}>
                Done
              </Button>
            </div>
          </Match>
        </Switch>
      </div>
    </Dialog>
  );
}
