import { invoke } from "@tauri-apps/api/core";
import { createMemo, createResource, createSignal, For, onCleanup, Show } from "solid-js";
import { Button, Dialog, Section, SliderField, Spinner, toast } from "@umi/ui";
import { AudioLines, Check, Download, FileAudio, Library, Pause, Play, Trash2 } from "lucide-solid";
import type { Editor } from "../store";
import type { EditSettings } from "../types";
import { AUDIO_EXTENSIONS, chooseIntoBundle, importIntoBundle } from "./files";

interface Track {
  title: string;
  category: string;
  seconds: number;
  bytes: number;
  url: string;
  downloaded: boolean;
}

/** Music under the video: the built-in library (free CC0 tracks) or your own file. */
export function MusicSection(props: { editor: Editor; gesture: object }) {
  const ed = props.editor;
  const edit = () => ed.state().edit;
  const set = (change: (e: EditSettings) => void) => void ed.update(change);
  const [library, setLibrary] = createSignal(false);

  const chooseFile = async () => {
    const file = await chooseIntoBundle(ed, "Music", AUDIO_EXTENSIONS, "music");
    if (file) set((e) => (e.music = { file: file.name, title: file.source.split(/[\\/]/).pop(), volume: e.music?.volume ?? 0.35, fadeOut: e.music?.fadeOut ?? 3 }));
  };

  return (
    <Section title="Music" icon={<AudioLines size={15} />} hint={edit().music ? undefined : "Music plays under your voice and loops to the length of the video."}>
      <Show
        when={edit().music}
        fallback={
          <div class="ed-row">
            <Button size="sm" onClick={() => setLibrary(true)}>
              <Library size={14} /> Music library
            </Button>
            <Button size="sm" onClick={() => void chooseFile()}>
              <FileAudio size={14} /> Your file…
            </Button>
          </div>
        }
      >
        {(m) => (
          <>
            <div class="ed-file">{m().title ?? m().file}</div>
            <SliderField label="Volume" value={m().volume} format={(v) => `${Math.round(v * 100)}%`} onInput={(v) => set((e) => (e.music!.volume = v))} {...props.gesture} />
            <SliderField label="Fade out" value={m().fadeOut} max={6} format={(v) => `${v.toFixed(1)}s`} onInput={(v) => set((e) => (e.music!.fadeOut = v))} {...props.gesture} />
            <div class="ed-row">
              <Button size="sm" onClick={() => setLibrary(true)}>
                <Library size={14} /> Change
              </Button>
              <Button size="sm" variant="danger" onClick={() => set((e) => delete e.music)}>
                <Trash2 size={14} /> Remove
              </Button>
            </div>
          </>
        )}
      </Show>
      <MusicLibrary editor={ed} open={library()} onClose={() => setLibrary(false)} />
    </Section>
  );
}

function MusicLibrary(props: { editor: Editor; open: boolean; onClose: () => void }) {
  const ed = props.editor;
  const [tracks, { mutate }] = createResource(() => props.open, () => invoke<Track[]>("music_tracks"));
  const [category, setCategory] = createSignal<string | null>(null);
  const [playing, setPlaying] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal<string | null>(null);
  const categories = createMemo(() => [...new Set((tracks() ?? []).map((t) => t.category))]);
  const shown = () => (tracks() ?? []).filter((t) => !category() || t.category === category());

  // Previews stream straight from the archive; nothing is saved until a track is used.
  const audio = new Audio();
  audio.onended = () => setPlaying(null);
  onCleanup(() => audio.pause());
  const preview = (t: Track) => {
    if (playing() === t.url) {
      audio.pause();
      return setPlaying(null);
    }
    audio.src = t.url;
    void audio.play().catch(() => toast("Couldn't play the preview"));
    setPlaying(t.url);
  };

  const use = async (t: Track) => {
    setBusy(t.url);
    try {
      const local = await invoke<string>("music_fetch", { url: t.url });
      mutate((list) => list?.map((x) => (x.url === t.url ? { ...x, downloaded: true } : x)));
      const file = await importIntoBundle(ed, local, "music");
      if (!file) return;
      void ed.update((e) => (e.music = { file: file.name, title: t.title, volume: e.music?.volume ?? 0.35, fadeOut: e.music?.fadeOut ?? 3 }));
      audio.pause();
      setPlaying(null);
      props.onClose();
    } catch (e) {
      toast(String(e));
    } finally {
      setBusy(null);
    }
  };

  const close = () => {
    audio.pause();
    setPlaying(null);
    props.onClose();
  };

  const minutes = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  return (
    <Dialog open={props.open} title="Music library" onClose={close} width={520}>
      <div class="umi-section__hint" style={{ "margin-top": "-6px" }}>
        Free to use anywhere, even commercially (CC0, from the FreePD archive). A track downloads when you use it.
      </div>
      <div class="ed-chips" style={{ margin: "12px 0" }}>
        <button type="button" class="ed-chip" data-selected={!category() ? "true" : "false"} onClick={() => setCategory(null)}>
          All
        </button>
        <For each={categories()}>
          {(c) => (
            <button type="button" class="ed-chip" data-selected={category() === c ? "true" : "false"} onClick={() => setCategory(c)}>
              {c}
            </button>
          )}
        </For>
      </div>
      <Show when={!tracks.loading} fallback={<Spinner />}>
        <div class="ed-tracks">
          <For each={shown()}>
            {(t) => (
              <div class="ed-track" data-current={ed.state().edit.music?.title === t.title ? "true" : "false"}>
                <button type="button" class="ed-track__play" aria-label={playing() === t.url ? "Pause" : "Play preview"} onClick={() => preview(t)}>
                  <Show when={playing() === t.url} fallback={<Play size={14} fill="currentColor" />}>
                    <Pause size={14} fill="currentColor" />
                  </Show>
                </button>
                <div class="ed-track__meta">
                  <div class="ed-track__title">{t.title}</div>
                  <div class="ed-track__sub">
                    {t.category} · {minutes(t.seconds)}
                  </div>
                </div>
                <Button size="sm" variant={t.downloaded ? "glass" : "ghost"} disabled={!!busy()} onClick={() => void use(t)}>
                  <Show when={busy() === t.url} fallback={t.downloaded ? <Check size={14} /> : <Download size={14} />}>
                    <Spinner />
                  </Show>
                  Use
                </Button>
              </div>
            )}
          </For>
        </div>
      </Show>
    </Dialog>
  );
}
