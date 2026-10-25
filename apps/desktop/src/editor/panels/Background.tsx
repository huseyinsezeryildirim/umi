import { invoke } from "@tauri-apps/api/core";
import { createResource, createSignal, For, Show } from "solid-js";
import { Button, Section, SliderField, Spinner, Swatch, TextField, toast } from "@umi/ui";
import { Blend, Droplets, Search, Image as ImageIcon, ImagePlus, Mountain, PaintBucket, Palette, Shuffle } from "lucide-solid";
import type { JSX } from "solid-js";
import type { Editor } from "../store";
import type { Background, EditSettings, GradientPreset } from "../types";
import { bundlePath, chooseIntoBundle, IMAGE_EXTENSIONS } from "./files";

export const GRADIENTS: Record<GradientPreset, [string, string]> = {
  sky: ["#9eccfa", "#2e5eb8"],
  ice: ["#f2f7fc", "#ccdff7"],
  navy: ["#2e5487", "#0f172b"],
  graphite: ["#40454f", "#0f121a"],
  mist: ["#edf0f5", "#b8bfcf"],
  mint: ["#8cedc2", "#1c8c8c"],
  sand: ["#f5e8d1", "#d1b594"],
  dusk: ["#fa736b", "#6b4adb"],
  ocean: ["#2199f2", "#14338c"],
  peach: ["#ffcc9e", "#f57885"],
  grape: ["#cc73f2", "#4d2699"],
  night: ["#333847", "#0d0d17"],
  umay: ["#ff9ec7", "#8cc7ff"],
};
const PICKABLE: GradientPreset[] = ["sky", "ice", "navy", "graphite", "mist", "mint", "sand", "dusk", "ocean", "peach", "grape", "night"];
const COLORS = ["#0e111e", "#ffffff", "#f1f7fc", "#116ff5", "#13a874", "#f0443a", "#ffc83d", "#7a5af8"];

type Kind = "gradient" | "color" | "wallpaper" | "image" | "blurred";
const KINDS: [Kind, string, () => JSX.Element][] = [
  ["gradient", "Gradient", () => <Blend size={16} />],
  ["color", "Color", () => <PaintBucket size={16} />],
  ["wallpaper", "Wallpaper", () => <Mountain size={16} />],
  ["image", "Image", () => <ImageIcon size={16} />],
  ["blurred", "Blur", () => <Droplets size={16} />],
];

interface Wallpaper {
  name: string;
  path: string;
  thumb: string;
}
/** Loaded once per app run (thumbnails take a moment). */
let wallpaperCache: Promise<Wallpaper[]> | null = null;

function kindOf(b: Background): Kind {
  if ("color" in b) return "color";
  if ("blurredScreen" in b) return "blurred";
  if ("image" in b) return isSystemImage(b.image._0) ? "wallpaper" : "image";
  return "gradient";
}
const isSystemImage = (p: string) => p.startsWith("/System/") || /^[a-zA-Z]:\\Windows\\/.test(p) || p.startsWith("/usr/share/");

export function hexToRgba(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255, a: 1 };
}

function colorHex(b: Background) {
  if (!("color" in b)) return null;
  const c = b.color._0;
  const h = (v: number) => Math.round(v * 255).toString(16).padStart(2, "0");
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

/** Background: gradient, color, the computer's wallpapers, your own image, or the blurred screen. */
export function BackgroundSection(props: { editor: Editor; gesture: object }) {
  const ed = props.editor;
  const edit = () => ed.state().edit;
  const set = (change: (e: EditSettings) => void) => void ed.update(change);
  // The kind picked, even before something of that kind is chosen (wallpaper, image).
  const [picked, setPicked] = createSignal<Kind | null>(null);
  const kind = () => picked() ?? kindOf(edit().background);

  const pick = (k: Kind) => {
    setPicked(k);
    if (k === "gradient") set((e) => (e.background = { gradient: { _0: "sky" } }));
    if (k === "color") set((e) => (e.background = { color: { _0: hexToRgba("#f1f7fc") } }));
    if (k === "blurred") set((e) => (e.background = { blurredScreen: {} }));
  };
  const setBackground = (b: Background) => {
    setPicked(null);
    set((e) => (e.background = b));
  };

  const [wallpapers] = createResource(
    () => kind() === "wallpaper",
    () => (wallpaperCache ??= invoke<Wallpaper[]>("system_wallpapers")),
  );
  const currentImage = () => ("image" in edit().background ? (edit().background as { image: { _0: string } }).image._0 : null);
  const [imageThumb] = createResource(
    () => (kind() === "image" ? currentImage() : null),
    (name) => invoke<string>("image_thumbnail", { path: bundlePath(ed, name) }).catch(() => ""),
  );

  const chooseImage = async () => {
    const file = await chooseIntoBundle(ed, "Background image", IMAGE_EXTENSIONS, "background");
    if (file) setBackground({ image: { _0: file.name } });
  };

  const shuffle = () => {
    const g = PICKABLE[Math.floor(Math.random() * PICKABLE.length)];
    set((e) => {
      e.background = { gradient: { _0: g } };
      e.backgroundAngle = Math.round(Math.random() * 8) * 45;
    });
    setPicked(null);
  };

  return (
    <Section
      title="Background"
      icon={<Palette size={15} />}
      actions={
        <Button size="sm" variant="ghost" tip="Surprise me" onClick={shuffle}>
          <Shuffle size={14} />
        </Button>
      }
    >
      <div class="ed-tiles">
        <For each={KINDS}>
          {([value, label, icon]) => (
            <button type="button" class="ed-tile" data-selected={kind() === value ? "true" : "false"} onClick={() => pick(value)}>
              {icon()}
              <span>{label}</span>
            </button>
          )}
        </For>
      </div>
      <Show when={kind() === "gradient"}>
        <div class="ed-swatches">
          <For each={PICKABLE}>
            {(g) => (
              <Swatch
                label={g}
                background={`linear-gradient(135deg, ${GRADIENTS[g][0]}, ${GRADIENTS[g][1]})`}
                selected={"gradient" in edit().background && (edit().background as { gradient: { _0: string } }).gradient._0 === g}
                onClick={() => setBackground({ gradient: { _0: g } })}
              />
            )}
          </For>
        </div>
        <SliderField label="Angle" value={edit().backgroundAngle} min={0} max={360} step={1} format={(v) => `${Math.round(v)}°`} onInput={(v) => set((e) => (e.backgroundAngle = v))} {...props.gesture} />
      </Show>
      <Show when={kind() === "color"}>
        <div class="ed-swatches">
          <For each={COLORS}>{(hex) => <Swatch label={hex} background={hex} selected={colorHex(edit().background) === hex} onClick={() => setBackground({ color: { _0: hexToRgba(hex) } })} />}</For>
          <label class="ed-color-input" title="Any color">
            <input type="color" value={colorHex(edit().background) ?? "#116ff5"} onInput={(e) => setBackground({ color: { _0: hexToRgba(e.currentTarget.value) } })} />
          </label>
        </div>
      </Show>
      <Show when={kind() === "wallpaper"}>
        <Show when={!wallpapers.loading} fallback={<Spinner />}>
          <Show when={wallpapers()?.length} fallback={<div class="umi-section__hint">No wallpapers found on this computer.</div>}>
            <div class="ed-wallpapers">
              <For each={wallpapers()}>
                {(w) => (
                  <button type="button" class="ed-wallpaper" title={w.name} data-selected={currentImage() === w.path ? "true" : "false"} onClick={() => setBackground({ image: { _0: w.path } })}>
                    <img src={w.thumb} alt={w.name} draggable={false} />
                  </button>
                )}
              </For>
            </div>
          </Show>
        </Show>
      </Show>
      <Show when={kind() === "image"}>
        <Show when={currentImage() && imageThumb()}>
          <img class="ed-image-preview" src={imageThumb()} alt="" />
        </Show>
        <Button size="sm" onClick={() => void chooseImage()}>
          <ImagePlus size={14} /> {currentImage() ? "Choose another image…" : "Choose image…"}
        </Button>
        <StockPhotos editor={ed} current={currentImage()} onPick={(name) => setBackground({ image: { _0: name } })} />
      </Show>
      <Show when={kind() === "blurred"}>
        <div class="umi-section__hint">Your recording, blurred and dimmed behind the screen.</div>
      </Show>
      <SliderField label="Grain" value={edit().backgroundNoise} format={(v) => `${Math.round(v * 100)}%`} onInput={(v) => set((e) => (e.backgroundNoise = v))} {...props.gesture} />
    </Section>
  );
}

interface Photo {
  id: number;
  thumb: string;
  full: string;
  photographer: string;
  photographerUrl: string;
  pageUrl: string;
  color?: string | null;
}

/** Free stock photos from Pexels (people add their own free API key once). */
function StockPhotos(props: { editor: Editor; current: string | null; onPick: (name: string) => void }) {
  const [connected, setConnected] = createSignal<boolean | null>(null);
  const [key, setKey] = createSignal("");
  const [query, setQuery] = createSignal("");
  const [photos, setPhotos] = createSignal<Photo[]>([]);
  const [page, setPage] = createSignal(1);
  const [more, setMore] = createSignal(false);
  const [loading, setLoading] = createSignal(false);
  const [using, setUsing] = createSignal<number | null>(null);
  let timer = 0;

  const load = async (reset: boolean) => {
    setLoading(true);
    try {
      const next = reset ? 1 : page() + 1;
      const result = await invoke<{ photos: Photo[]; hasMore: boolean }>("pexels_search", { query: query(), page: next });
      setPhotos(reset ? result.photos : [...photos(), ...result.photos]);
      setPage(next);
      setMore(result.hasMore);
    } catch (e) {
      toast(String(e));
    } finally {
      setLoading(false);
    }
  };
  void invoke<boolean>("pexels_status").then((on) => {
    setConnected(on);
    if (on) void load(true);
  });

  const connect = async () => {
    try {
      await invoke("pexels_connect", { key: key() });
      setKey("");
      setConnected(true);
      void load(true);
    } catch (e) {
      toast(String(e));
    }
  };
  const search = (text: string) => {
    setQuery(text);
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void load(true), 350);
  };
  const use = async (p: Photo) => {
    setUsing(p.id);
    try {
      props.onPick(await invoke<string>("pexels_use", { bundle: props.editor.state().recording.bundle, id: p.id, url: p.full }));
    } catch (e) {
      toast(String(e));
    } finally {
      setUsing(null);
    }
  };

  return (
    <div class="ed-stock">
      <div class="umi-field-label">Free photos</div>
      <Show
        when={connected()}
        fallback={
          <Show when={connected() === false}>
            <div class="umi-section__hint">
              Add a free Pexels API key to search millions of photos. Get one at{" "}
              <a href="https://www.pexels.com/api/" target="_blank" rel="noreferrer">
                pexels.com/api
              </a>
              .
            </div>
            <div class="ed-share__row">
              <TextField value={key()} placeholder="Pexels API key" type="password" onInput={(e) => setKey(e.currentTarget.value)} />
              <Button size="sm" disabled={!key().trim()} onClick={() => void connect()}>
                Add
              </Button>
            </div>
          </Show>
        }
      >
        <label class="ed-stock__search">
          <Search size={14} />
          <input value={query()} placeholder="Search photos (mountains, office, sky…)" onInput={(e) => search(e.currentTarget.value)} />
        </label>
        <div class="ed-wallpapers ed-stock__grid">
          <For each={photos()}>
            {(p) => (
              <button
                type="button"
                class="ed-wallpaper"
                title={`Photo by ${p.photographer} on Pexels`}
                style={{ background: p.color ?? undefined }}
                data-selected={props.current === `background-pexels-${p.id}.jpg` ? "true" : "false"}
                data-busy={using() === p.id ? "true" : "false"}
                onClick={() => void use(p)}
              >
                <img src={p.thumb} alt={`Photo by ${p.photographer}`} loading="lazy" draggable={false} />
              </button>
            )}
          </For>
        </div>
        <Show when={loading()}>
          <Spinner />
        </Show>
        <Show when={more() && !loading()}>
          <Button size="sm" variant="ghost" onClick={() => void load(false)}>
            More photos
          </Button>
        </Show>
        <div class="umi-section__hint">
          Photos provided by{" "}
          <a href="https://www.pexels.com" target="_blank" rel="noreferrer">
            Pexels
          </a>
          .
        </div>
      </Show>
    </div>
  );
}
