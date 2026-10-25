import { Channel, invoke } from "@tauri-apps/api/core";
import { createEffect, createSignal, on, Show } from "solid-js";
import { Button, Dialog, Progress, Segmented, toast } from "@umi/ui";
import { Sparkles } from "lucide-solid";
import type { Editor } from "./store";
import type { EditorState } from "./types";

/**
 * AI voiceover: type what to say; a natural voice (Kokoro, on this computer) speaks it onto
 * the Voice track at the playhead. Other sound dips while it plays.
 */
export function VoiceoverDialog(props: { editor: Editor }) {
  const ed = props.editor;
  const [text, setText] = createSignal("");
  const [speed, setSpeed] = createSignal(1);
  const [job, setJob] = createSignal<{ stage: string; value: number } | null>(null);
  const replacing = () => {
    const id = ed.voiceSheet()?.replace;
    return id ? (ed.state().edit.voiceovers ?? []).find((v) => v.id === id) : undefined;
  };
  createEffect(on(() => ed.voiceSheet(), (sheet) => sheet && setText(replacing()?.text ?? "")));

  const generate = async () => {
    const channel = new Channel<{ stage: string; value: number }>();
    channel.onmessage = setJob;
    setJob({ stage: "speak", value: 0 });
    try {
      const next = await invoke<EditorState>("editor_voiceover", {
        id: ed.state().id,
        text: text(),
        speed: speed(),
        time: replacing()?.start ?? ed.time(),
        replace: replacing()?.id ?? null,
        progress: channel,
      });
      ed.replaceState(next);
      if (next.selection) ed.setSelection(next.selection);
      void invoke("editor_save", { id: next.id });
      ed.closeVoiceover();
    } catch (e) {
      toast(String(e));
    } finally {
      setJob(null);
    }
  };

  return (
    <Dialog open={!!ed.voiceSheet()} title={replacing() ? "Edit voiceover" : "AI voiceover"} onClose={() => !job() && ed.closeVoiceover()} width={500}>
      <div class="ed-export">
        <div class="umi-section__hint" style={{ "margin-top": "-6px" }}>
          A natural voice reads your script at the playhead. It's made on this computer, free. English for now.
        </div>
        <textarea
          class="umi-input ed-script"
          placeholder="Welcome! In this video I'll show you how to…"
          value={text()}
          autofocus
          onInput={(e) => setText(e.currentTarget.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void generate();
          }}
        />
        <div class="umi-field-label">Pace</div>
        <Segmented
          value={speed()}
          onChange={setSpeed}
          options={[
            { value: 0.85, label: "Calm" },
            { value: 1, label: "Natural" },
            { value: 1.15, label: "Brisk" },
          ]}
        />
        <Show when={job()}>
          {(j) => (
            <>
              <div class="umi-section__hint">{j().stage === "download" ? `Getting the voice (once, 93 MB)… ${Math.round(j().value * 100)}%` : "Speaking…"}</div>
              <Progress value={j().stage === "download" ? j().value : 0.6} />
            </>
          )}
        </Show>
        <div class="ed-export__actions">
          <span class="ed-export__pct umi-section__hint">{text().trim() ? `${text().trim().split(/\s+/).length} words · about ${Math.max(1, Math.round(text().trim().split(/\s+/).length / 2.6 / speed()))} s` : ""}</span>
          <Button variant="ghost" onClick={() => ed.closeVoiceover()} disabled={!!job()}>
            Cancel
          </Button>
          <Button variant="ink" onClick={() => void generate()} disabled={!text().trim() || !!job()}>
            <Sparkles size={15} /> {replacing() ? "Speak again" : "Add voiceover"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
