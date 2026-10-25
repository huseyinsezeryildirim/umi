import { invoke } from "@tauri-apps/api/core";
import { createResource, For, Show } from "solid-js";
import { Button, Section, SliderField } from "@umi/ui";
import { BadgeCheck, ImagePlus, Trash2 } from "lucide-solid";
import type { Editor } from "../store";
import type { EditSettings } from "../types";
import { bundlePath, chooseIntoBundle, IMAGE_EXTENSIONS } from "./files";

type Corner = "topLeft" | "topRight" | "bottomLeft" | "bottomRight";
const CORNERS: [Corner, string][] = [
  ["topLeft", "↖"],
  ["topRight", "↗"],
  ["bottomLeft", "↙"],
  ["bottomRight", "↘"],
];

/** Your logo in a corner of every frame. */
export function BrandSection(props: { editor: Editor; gesture: object }) {
  const ed = props.editor;
  const edit = () => ed.state().edit;
  const set = (change: (e: EditSettings) => void) => void ed.update(change);
  const [thumb] = createResource(
    () => edit().watermark?.file,
    (file) => invoke<string>("image_thumbnail", { path: bundlePath(ed, file) }).catch(() => ""),
  );

  const choose = async () => {
    const file = await chooseIntoBundle(ed, "Logo", IMAGE_EXTENSIONS, "logo");
    if (file) set((e) => (e.watermark = { file: file.name, corner: e.watermark?.corner ?? "bottomRight", size: e.watermark?.size ?? 0.12, opacity: e.watermark?.opacity ?? 0.9 }));
  };

  return (
    <Section title="Logo" icon={<BadgeCheck size={15} />} hint={edit().watermark ? undefined : "Put your logo in a corner of the video. PNGs with transparency look best."}>
      <Show
        when={edit().watermark}
        fallback={
          <Button size="sm" onClick={() => void choose()}>
            <ImagePlus size={14} /> Add logo…
          </Button>
        }
      >
        {(w) => (
          <>
            <div class="ed-logo">
              <Show when={thumb()}>
                <img src={thumb()} alt="" />
              </Show>
              <div class="ed-corners">
                <For each={CORNERS}>
                  {([corner, arrow]) => (
                    <button type="button" class="ed-chip" data-selected={w().corner === corner ? "true" : "false"} aria-label={corner} onClick={() => set((e) => (e.watermark!.corner = corner))}>
                      {arrow}
                    </button>
                  )}
                </For>
              </div>
            </div>
            <SliderField label="Size" value={w().size} min={0.04} max={0.4} format={(v) => `${Math.round(v * 100)}%`} onInput={(v) => set((e) => (e.watermark!.size = v))} {...props.gesture} />
            <SliderField label="Opacity" value={w().opacity} min={0.1} max={1} format={(v) => `${Math.round(v * 100)}%`} onInput={(v) => set((e) => (e.watermark!.opacity = v))} {...props.gesture} />
            <div class="ed-row">
              <Button size="sm" onClick={() => void choose()}>
                <ImagePlus size={14} /> Change
              </Button>
              <Button size="sm" variant="danger" onClick={() => set((e) => delete e.watermark)}>
                <Trash2 size={14} /> Remove
              </Button>
            </div>
          </>
        )}
      </Show>
    </Section>
  );
}
