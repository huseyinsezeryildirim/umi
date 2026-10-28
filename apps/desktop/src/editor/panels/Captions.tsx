import { Channel, invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { createMemo, createSignal, For, Show } from "solid-js";
import { Button, Progress, Section, Segmented, SliderField, SwitchRow, toast } from "@umi/ui";
import { Captions, FileDown, Scissors, Sparkles, Timer, Wand2 } from "lucide-solid";
import type { Editor } from "../store";
import type { EditorState, EditSettings } from "../types";

type Word = EditSettings["captions"]["words"][number];

const LANGUAGES: [string, string][] = [
  ["auto", "Detect automatically"],
  ["en", "English"],
  ["tr", "Türkçe"],
  ["de", "Deutsch"],
  ["es", "Español"],
  ["fr", "Français"],
  ["it", "Italiano"],
  ["pt", "Português"],
  ["nl", "Nederlands"],
  ["pl", "Polski"],
  ["ru", "Русский"],
  ["uk", "Українська"],
  ["ar", "العربية"],
  ["hi", "हिन्दी"],
  ["ja", "日本語"],
  ["ko", "한국어"],
  ["zh", "中文"],
];

/** Same fillers the Rust side cuts (for highlighting). */
const FILLERS = new Set(["um", "umm", "uh", "uhh", "uhm", "er", "erm", "ah", "hmm", "mm", "mhm", "ıı", "ııı", "ee", "eee", "eh", "hı", "şey", "ehm", "euh", "äh", "ähm", "hum", "ehh"]);
const bare = (w: string) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "").toLowerCase();
export const isFiller = (w: string) => FILLERS.has(bare(w));

/** Captions from the voice, on this computer; editing the video by its words. */
export function CaptionsSection(props: { editor: Editor; gesture: object }) {
  const ed = props.editor;
  const edit = () => ed.state().edit;
  const set = (change: (e: EditSettings) => void) => void ed.update(change);
  const [language, setLanguage] = createSignal("auto");
  const [job, setJob] = createSignal<{ stage: string; value: number } | null>(null);
  const words = () => edit().captions.words;
  const fillers = () => words().filter((w) => isFiller(w.text) && ed.isKept(w.start)).length;

  const generate = async () => {
    const channel = new Channel<{ stage: string; value: number }>();
    channel.onmessage = setJob;
    setJob({ stage: "transcribe", value: 0 });
    try {
      const next = await invoke<EditorState>("editor_transcribe", { id: ed.state().id, language: language(), progress: channel });
      ed.replaceState(next);
      void invoke("editor_save", { id: next.id });
      toast(`${next.edit.captions.words.length} words transcribed`);
    } catch (e) {
      toast(String(e));
    } finally {
      setJob(null);
    }
  };

  const exportSubtitles = async (ext: "srt" | "vtt") => {
    const path = await save({ defaultPath: `${ed.state().name}.${ext}`, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
    if (!path) return;
    try {
      await invoke("editor_save_subtitles", { id: ed.state().id, destination: path });
      toast(`Saved ${path.split(/[\\/]/).pop()}`);
    } catch (e) {
      toast(String(e));
    }
  };

  return (
    <>
      <Section title="Captions" icon={<Captions size={15} />} hint="Transcribed on this computer. Your voice never leaves it.">
        <div class="umi-field-label">Spoken language</div>
        <select class="umi-input" value={language()} onChange={(e) => setLanguage(e.currentTarget.value)}>
          <For each={LANGUAGES}>{([code, name]) => <option value={code}>{name}</option>}</For>
        </select>
        <Show
          when={job()}
          fallback={
            <Button variant={words().length ? "glass" : "accent"} onClick={() => void generate()}>
              <Sparkles size={15} /> {words().length ? "Transcribe again" : "Generate captions"}
            </Button>
          }
        >
          {(j) => (
            <>
              <div class="umi-section__hint">{j().stage === "download" ? `Getting the speech model (once, 570 MB)… ${Math.round(j().value * 100)}%` : `Listening… ${Math.round(j().value * 100)}%`}</div>
              <Progress value={j().value} />
            </>
          )}
        </Show>
        <Show when={words().length}>
          <SwitchRow label="Show captions in the video" checked={edit().captions.enabled} onChange={(v) => set((e) => (e.captions.enabled = v))} />
          <Segmented
            value={edit().captions.style ?? "pill"}
            onChange={(v) => set((e) => (e.captions.style = v))}
            options={[
              { value: "pill", label: "Box" },
              { value: "bold", label: "Bold" },
              { value: "minimal", label: "Minimal" },
            ]}
          />
          <SwitchRow label="Words appear as they're said" checked={edit().captions.reveal ?? false} onChange={(v) => set((e) => (e.captions.reveal = v))} />
          <SwitchRow label="Highlight the spoken word" checked={edit().captions.highlightActiveWord} onChange={(v) => set((e) => (e.captions.highlightActiveWord = v))} />
          <SliderField label="Size" value={edit().captions.size} min={0.025} max={0.08} format={(v) => `${Math.round(v * 1000) / 10}%`} onInput={(v) => set((e) => (e.captions.size = v))} {...props.gesture} />
          <SliderField label="Position" value={edit().captions.position} min={0.1} max={0.95} format={(v) => `${Math.round(v * 100)}%`} onInput={(v) => set((e) => (e.captions.position = v))} {...props.gesture} />
          <div class="ed-row">
            <Button size="sm" onClick={() => void exportSubtitles("srt")}>
              <FileDown size={14} /> SRT
            </Button>
            <Button size="sm" onClick={() => void exportSubtitles("vtt")}>
              <FileDown size={14} /> VTT
            </Button>
          </div>
        </Show>
      </Section>
      <Show when={words().length}>
        <Section title="Clean up" icon={<Wand2 size={15} />}>
          <Button size="sm" disabled={!fillers()} onClick={() => void ed.apply({ op: "removeFillers" }).then(() => toast("Filler words removed"))}>
            <Scissors size={14} /> Remove filler words{fillers() ? ` (${fillers()})` : ""}
          </Button>
          <Button size="sm" onClick={() => void ed.apply({ op: "removePauses", min: 1.0 }).then(() => toast("Long pauses shortened"))}>
            <Timer size={14} /> Shorten pauses over 1 s
          </Button>
          <div class="umi-section__hint">Both are cuts on the timeline: undo brings everything back.</div>
        </Section>
        <InsightsSection editor={ed} />
        <Transcript editor={ed} />
      </Show>
    </>
  );
}

/**
 * The transcript, word by word: click a word to jump there, drag or Shift-click to select
 * words, Delete to cut them from the video. Double-click a line to fix its text.
 */
function Transcript(props: { editor: Editor }) {
  const ed = props.editor;
  const [selected, setSelected] = createSignal<Set<string>>(new Set());
  const [anchor, setAnchor] = createSignal<number | null>(null);
  const [editing, setEditing] = createSignal<number | null>(null);
  const sorted = createMemo(() => [...ed.state().edit.captions.words].sort((a, b) => a.start - b.start));
  const lines = createMemo(() => {
    const out: { words: Word[]; index: number[] }[] = [];
    let current: { words: Word[]; index: number[] } = { words: [], index: [] };
    sorted().forEach((w, i) => {
      const first = current.words[0];
      const last = current.words[current.words.length - 1];
      if (first && (current.words.length >= 7 || w.end - first.start > 2.6 || w.start - last.end > 0.8)) {
        out.push(current);
        current = { words: [], index: [] };
      }
      current.words.push(w);
      current.index.push(i);
      if (/[.?!]$/.test(w.text)) {
        out.push(current);
        current = { words: [], index: [] };
      }
    });
    if (current.words.length) out.push(current);
    return out;
  });

  const choose = (i: number, extend: boolean) => {
    const a = anchor();
    if (extend && a !== null) {
      const [lo, hi] = a < i ? [a, i] : [i, a];
      setSelected(new Set(sorted().slice(lo, hi + 1).map((w) => w.id)));
    } else {
      setAnchor(i);
      setSelected(new Set([sorted()[i].id]));
      const t = ed.outputTimeAt(sorted()[i].start);
      if (t !== null) ed.setTime(t);
    }
  };

  const cut = async () => {
    const ids = [...selected()].filter((id) => {
      const w = sorted().find((x) => x.id === id);
      return w && ed.isKept(w.start);
    });
    if (!ids.length) return;
    await ed.apply({ op: "cutWords", ids });
    setSelected(new Set<string>());
    toast(`Cut ${ids.length} word${ids.length > 1 ? "s" : ""}`);
  };

  const key = (e: KeyboardEvent) => {
    if ((e.key === "Backspace" || e.key === "Delete") && selected().size) {
      e.preventDefault();
      e.stopPropagation();
      void cut();
    }
    if (e.key === "Escape") setSelected(new Set<string>());
  };

  const playing = () => {
    const t = ed.time();
    const p = ed.state().placements.find((p) => t >= p.outputStart && t <= p.outputStart + (p.clip.end - p.clip.start) / p.clip.speed);
    return p ? p.clip.start + (t - p.outputStart) * p.clip.speed : -1;
  };

  return (
    <Section
      title="Transcript"
      icon={<Scissors size={15} />}
      actions={
        <Show when={selected().size}>
          <Button size="sm" variant="ink" tip="Cut from the video" shortcut="⌫" onClick={() => void cut()}>
            <Scissors size={13} /> Cut
          </Button>
        </Show>
      }
      hint="Select words and press Delete to cut them from the video. Double-click a line to fix its text."
    >
      <div class="ed-transcript" tabIndex={0} onKeyDown={key}>
        <For each={lines()}>
          {(line, li) => (
            <Show
              when={editing() === li()}
              fallback={
                <p onDblClick={() => setEditing(li())}>
                  <For each={line.words}>
                    {(w, k) => (
                      <span
                        class="ed-word"
                        data-selected={selected().has(w.id) ? "true" : "false"}
                        data-cut={ed.isKept(w.start) ? "false" : "true"}
                        data-filler={isFiller(w.text) ? "true" : "false"}
                        data-now={playing() >= w.start && playing() < w.end ? "true" : "false"}
                        onPointerDown={(e) => {
                          e.preventDefault();
                          (e.currentTarget.closest(".ed-transcript") as HTMLElement).focus();
                          choose(line.index[k()], e.shiftKey);
                        }}
                        onPointerEnter={(e) => e.buttons === 1 && choose(line.index[k()], true)}
                      >
                        {w.text}{" "}
                      </span>
                    )}
                  </For>
                </p>
              }
            >
              <input
                class="umi-input ed-transcript__edit"
                value={line.words.map((w) => w.text).join(" ")}
                autofocus
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") {
                    void ed.apply({ op: "editCaptionLine", ids: line.words.map((w) => w.id), text: e.currentTarget.value });
                    setEditing(null);
                  }
                  if (e.key === "Escape") setEditing(null);
                }}
                onBlur={() => setEditing(null)}
              />
            </Show>
          )}
        </For>
      </div>
    </Section>
  );
}

interface Insights {
  title: string;
  summary: string;
  chapters: { start: number; title: string }[];
  chapterText: string;
}

/** Title, summary and chapters from the transcript, ready to paste into a description. */
export function InsightsSection(props: { editor: Editor }) {
  const ed = props.editor;
  const [found, setFound] = createSignal<Insights | null | undefined>(undefined);
  const make = async () => {
    const result = await invoke<Insights | null>("editor_insights", { id: ed.state().id });
    setFound(result);
    if (!result) toast("Not enough speech for a summary yet");
  };
  const copy = (text: string) => void invoke("copy_text_to_clipboard", { text }).then(() => toast("Copied"));
  return (
    <Section title="Title, summary & chapters" icon={<Sparkles size={15} />} hint="From what you said, on this computer.">
      <Show
        when={found()}
        fallback={
          <Button size="sm" onClick={() => void make()}>
            <Sparkles size={14} /> Write them
          </Button>
        }
      >
        {(i) => (
          <div class="ed-insights">
            <div class="umi-field-label">Title</div>
            <div class="ed-insights__box" onClick={() => copy(i().title)} title="Copy">
              {i().title}
            </div>
            <div class="umi-field-label">Summary</div>
            <div class="ed-insights__box" onClick={() => copy(i().summary)} title="Copy">
              {i().summary}
            </div>
            <div class="umi-field-label">Chapters</div>
            <div class="ed-insights__box ed-insights__chapters" onClick={() => copy(i().chapterText)} title="Copy">
              {i().chapterText}
            </div>
            <div class="ed-row">
              <Button size="sm" onClick={() => copy(`${i().title}\n\n${i().summary}\n\n${i().chapterText}`)}>Copy all</Button>
              <Button size="sm" variant="ghost" onClick={() => void make()}>
                Again
              </Button>
            </div>
          </div>
        )}
      </Show>
    </Section>
  );
}
