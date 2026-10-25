import { invoke } from "@tauri-apps/api/core";
import { createResource, createSignal, For, Show } from "solid-js";
import { Button, Section, SliderField, Spinner, Swatch } from "@umi/ui";
import { ImagePlus, Palette, Shuffle } from "lucide-solid";
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
const KINDS: [Kind, string][] = [
  ["gradient", "Gradient"],
  ["color", "Color"],
  ["wallpaper", "Wallpaper"],
  ["image", "Image"],
  ["blurred", "Blur"],
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
      <div class="ed-chips">
        <For each={KINDS}>
          {([value, label]) => (
            <button type="button" class="ed-chip" data-selected={kind() === value ? "true" : "false"} onClick={() => pick(value)}>
              {label}
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
      </Show>
      <Show when={kind() === "blurred"}>
        <div class="umi-section__hint">Your recording, blurred and dimmed behind the screen.</div>
      </Show>
      <SliderField label="Grain" value={edit().backgroundNoise} format={(v) => `${Math.round(v * 100)}%`} onInput={(v) => set((e) => (e.backgroundNoise = v))} {...props.gesture} />
    </Section>
  );
}
