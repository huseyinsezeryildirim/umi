import { createSignal, For, Match, Show, Switch as SolidSwitch } from "solid-js";
import { Button, Progress, Section, Segmented, SliderField, Swatch, SwitchRow, Tabs, TextField, toast } from "@umi/ui";
import { Channel, invoke } from "@tauri-apps/api/core";
import {
  AudioLines,
  Camera,
  Clapperboard,
  Crosshair,
  Merge,
  Image,
  Monitor,
  MousePointer2,
  Palette,
  Scissors,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Type,
  ZoomIn,
} from "lucide-solid";
import type { Editor } from "./store";
import type { AspectRatio, Background, DeviceFrame, EditorState, EditSettings, GradePreset, GradientPreset, Selection } from "./types";

type Tab = "background" | "screen" | "cursor" | "camera" | "zoom" | "color" | "audio";

const GRADIENTS: Record<GradientPreset, [string, string]> = {
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
const PICKABLE: GradientPreset[] = ["sky", "ice", "navy", "graphite", "mist", "mint", "sand", "dusk"];
const GRADES: GradePreset[] = ["none", "cinematic", "vivid", "golden", "frost", "midnight", "vintage", "noir", "dreamy"];

const pct = (v: number) => `${Math.round(v * 100)}%`;

export function Inspector(props: { editor: Editor }) {
  const ed = props.editor;
  const [tab, setTab] = createSignal<Tab>("background");
  const edit = () => ed.state().edit;
  const set = (change: (e: EditSettings) => void) => void ed.update(change);
  const gesture = { onGestureStart: () => void ed.gestureStart(), onGestureEnd: () => void ed.gestureEnd() };

  return (
    <aside class="ed-inspector umi-panel">
      <Show when={ed.selection()}>{(s) => <SelectionPanel editor={ed} selection={s()} />}</Show>

      <div class="ed-inspector__tabs">
        <Tabs<Tab>
          value={tab()}
          onChange={setTab}
          tabs={[
            { id: "background", label: "Background", icon: <Palette size={17} /> },
            { id: "screen", label: "Screen", icon: <Monitor size={17} /> },
            { id: "cursor", label: "Cursor", icon: <MousePointer2 size={17} /> },
            { id: "camera", label: "Camera", icon: <Camera size={17} /> },
            { id: "zoom", label: "Zoom", icon: <ZoomIn size={17} /> },
            { id: "color", label: "Color & effects", icon: <Sparkles size={17} /> },
            { id: "audio", label: "Audio", icon: <AudioLines size={17} /> },
          ]}
        />
      </div>

      <div class="ed-inspector__body">
        <SolidSwitch>
          <Match when={tab() === "background"}>
            <Section title="Background" icon={<Palette size={15} />}>
              <Segmented
                value={backgroundKind(edit().background)}
                onChange={(kind) => set((e) => (e.background = defaultBackground(kind)))}
                options={[
                  { value: "gradient", label: "Gradient" },
                  { value: "color", label: "Color" },
                  { value: "blurred", label: "Blur" },
                ]}
              />
              <Show when={"gradient" in edit().background}>
                <div class="ed-swatches">
                  <For each={PICKABLE}>
                    {(g) => (
                      <Swatch
                        label={g}
                        background={`linear-gradient(135deg, ${GRADIENTS[g][0]}, ${GRADIENTS[g][1]})`}
                        selected={"gradient" in edit().background && (edit().background as { gradient: { _0: string } }).gradient._0 === g}
                        onClick={() => set((e) => (e.background = { gradient: { _0: g } }))}
                      />
                    )}
                  </For>
                </div>
                <SliderField label="Angle" value={edit().backgroundAngle} min={0} max={360} step={1} format={(v) => `${Math.round(v)}°`} onInput={(v) => set((e) => (e.backgroundAngle = v))} {...gesture} />
              </Show>
              <Show when={"color" in edit().background}>
                <div class="ed-swatches">
                  <For each={["#0e111e", "#ffffff", "#f1f7fc", "#116ff5", "#13a874", "#f0443a", "#ffc83d", "#7a5af8"]}>
                    {(hex) => (
                      <Swatch
                        label={hex}
                        background={hex}
                        selected={colorHex(edit().background) === hex}
                        onClick={() => set((e) => (e.background = { color: { _0: hexToRgba(hex) } }))}
                      />
                    )}
                  </For>
                </div>
              </Show>
              <SliderField label="Grain" value={edit().backgroundNoise} format={pct} onInput={(v) => set((e) => (e.backgroundNoise = v))} {...gesture} />
            </Section>
            <Section title="Shape" icon={<Clapperboard size={15} />}>
              <Segmented<AspectRatio>
                value={edit().aspect}
                onChange={(a) => set((e) => (e.aspect = a))}
                options={[
                  { value: "auto", label: "Auto" },
                  { value: "wide", label: "16:9" },
                  { value: "vertical", label: "9:16" },
                  { value: "square", label: "1:1" },
                  { value: "classic", label: "4:3" },
                ]}
              />
            </Section>
          </Match>

          <Match when={tab() === "screen"}>
            <Section title="Frame" icon={<Monitor size={15} />}>
              <div class="ed-chips">
                <For each={[["none", "None"], ["macOS", "macOS"], ["windows", "Windows"], ["browser", "Browser"], ["macBook", "MacBook"]] as [DeviceFrame, string][]}>
                  {([value, label]) => (
                    <button type="button" class="ed-chip" data-selected={edit().frame === value ? "true" : "false"} onClick={() => set((e) => (e.frame = value))}>
                      {label}
                    </button>
                  )}
                </For>
              </div>
              <SliderField label="Padding" value={edit().padding} max={0.4} format={pct} onInput={(v) => set((e) => (e.padding = v))} {...gesture} />
              <SliderField label="Corners" value={edit().cornerRadius} max={0.08} format={(v) => pct(v / 0.08)} onInput={(v) => set((e) => (e.cornerRadius = v))} {...gesture} />
              <Segmented
                value={edit().cornerStyle}
                onChange={(c) => set((e) => (e.cornerStyle = c))}
                options={[
                  { value: "rounded", label: "Rounded" },
                  { value: "squircle", label: "Squircle" },
                ]}
              />
              <SliderField label="Shadow" value={edit().shadow} format={pct} onInput={(v) => set((e) => (e.shadow = v))} {...gesture} />
              <SliderField label="Border" value={edit().border} max={0.02} format={(v) => pct(v / 0.02)} onInput={(v) => set((e) => (e.border = v))} {...gesture} />
            </Section>
          </Match>

          <Match when={tab() === "cursor"}>
            <Section title="Cursor" icon={<MousePointer2 size={15} />}>
              <SwitchRow label="Show cursor" checked={edit().cursor.visible} onChange={(v) => set((e) => (e.cursor.visible = v))} />
              <Segmented
                value={edit().cursor.style}
                onChange={(v) => set((e) => (e.cursor.style = v))}
                options={[
                  { value: "arrow", label: "Arrow" },
                  { value: "dot", label: "Touch" },
                ]}
              />
              <SliderField label="Size" value={edit().cursor.size} min={0.5} max={4} format={(v) => `${v.toFixed(1)}×`} onInput={(v) => set((e) => (e.cursor.size = v))} {...gesture} />
              <Segmented
                value={edit().cursor.smoothing}
                onChange={(v) => set((e) => (e.cursor.smoothing = v))}
                options={[
                  { value: "off", label: "Raw" },
                  { value: "slow", label: "Slow" },
                  { value: "smooth", label: "Smooth" },
                  { value: "fast", label: "Snappy" },
                ]}
              />
              <SwitchRow label="Click rings" checked={edit().cursor.clickRings} onChange={(v) => set((e) => (e.cursor.clickRings = v))} />
              <SwitchRow label="Motion blur" checked={edit().cursor.motionBlur} onChange={(v) => set((e) => (e.cursor.motionBlur = v))} />
              <SwitchRow label="Hide when idle" checked={edit().cursor.hideWhenIdle} onChange={(v) => set((e) => (e.cursor.hideWhenIdle = v))} />
            </Section>
          </Match>

          <Match when={tab() === "camera"}>
            <Section title="Camera" icon={<Camera size={15} />} hint={ed.state().recording.hasCamera ? undefined : "This recording has no camera."}>
              <SwitchRow label="Show camera" checked={edit().camera.visible} onChange={(v) => set((e) => (e.camera.visible = v))} />
              <Segmented
                value={edit().camera.shape}
                onChange={(v) => set((e) => (e.camera.shape = v))}
                options={[
                  { value: "circle", label: "Circle" },
                  { value: "squircle", label: "Squircle" },
                  { value: "square", label: "Square" },
                ]}
              />
              <SliderField label="Size" value={edit().camera.size} min={0.1} max={0.5} format={pct} onInput={(v) => set((e) => (e.camera.size = v))} {...gesture} />
              <SwitchRow label="Mirror" checked={edit().camera.mirrored} onChange={(v) => set((e) => (e.camera.mirrored = v))} />
            </Section>
          </Match>

          <Match when={tab() === "zoom"}>
            <Section title="Zoom" icon={<ZoomIn size={15} />} hint="Press Z to add a zoom at the playhead. Drag a zoom on the timeline to move it.">
              <SwitchRow label="Zoom on clicks" checked={edit().zoom.auto} onChange={(v) => set((e) => (e.zoom.auto = v))} />
              <SliderField label="Default zoom" value={edit().zoom.scale} min={1.2} max={3.5} format={(v) => `${v.toFixed(1)}×`} onInput={(v) => set((e) => (e.zoom.scale = v))} {...gesture} />
              <Button size="sm" onClick={() => void ed.apply({ op: "addZoom", time: ed.time() })}>
                <ZoomIn size={14} /> Add zoom here
              </Button>
            </Section>
          </Match>

          <Match when={tab() === "color"}>
            <Section title="Look" icon={<Sparkles size={15} />}>
              <div class="ed-chips">
                <For each={GRADES}>
                  {(g) => (
                    <button type="button" class="ed-chip" data-selected={edit().grade.preset === g ? "true" : "false"} onClick={() => set((e) => (e.grade.preset = g))}>
                      {g === "none" ? "Original" : g[0].toUpperCase() + g.slice(1)}
                    </button>
                  )}
                </For>
              </div>
              <SliderField label="Exposure" value={edit().grade.exposure} min={-1} max={1} format={(v) => v.toFixed(2)} onInput={(v) => set((e) => (e.grade.exposure = v))} {...gesture} />
              <SliderField label="Contrast" value={edit().grade.contrast} min={-1} max={1} format={(v) => v.toFixed(2)} onInput={(v) => set((e) => (e.grade.contrast = v))} {...gesture} />
              <SliderField label="Saturation" value={edit().grade.saturation} min={-1} max={1} format={(v) => v.toFixed(2)} onInput={(v) => set((e) => (e.grade.saturation = v))} {...gesture} />
              <SliderField label="Vignette" value={edit().grade.vignette} format={pct} onInput={(v) => set((e) => (e.grade.vignette = v))} {...gesture} />
              <SliderField label="Film grain" value={edit().grade.grain} format={pct} onInput={(v) => set((e) => (e.grade.grain = v))} {...gesture} />
            </Section>
          </Match>

          <Match when={tab() === "audio"}>
            <Section title="Clips" icon={<Scissors size={15} />} hint="Blends each cut into the next clip.">
              <SliderField label="Crossfade" value={edit().crossfade} max={1.5} format={(v) => `${v.toFixed(1)}s`} onInput={(v) => set((e) => (e.crossfade = v))} {...gesture} />
            </Section>
            <Section title="Music" icon={<AudioLines size={15} />} hint={edit().music ? undefined : "Music plays under your voice and loops to the length of the video."}>
              <Show when={edit().music}>
                {(m) => (
                  <>
                    <div class="ed-file">{m().title ?? m().file}</div>
                    <SliderField label="Volume" value={m().volume} format={pct} onInput={(v) => set((e) => (e.music!.volume = v))} {...gesture} />
                    <SliderField label="Fade out" value={m().fadeOut} max={6} format={(v) => `${v.toFixed(1)}s`} onInput={(v) => set((e) => (e.music!.fadeOut = v))} {...gesture} />
                    <Button size="sm" variant="danger" onClick={() => set((e) => delete e.music)}>
                      <Trash2 size={14} /> Remove music
                    </Button>
                  </>
                )}
              </Show>
            </Section>
          </Match>
        </SolidSwitch>
      </div>
    </aside>
  );
}

/** Settings for the selected timeline item, above the tabs. */
function SelectionPanel(props: { editor: Editor; selection: Selection }) {
  const ed = props.editor;
  const edit = () => ed.state().edit;
  const set = (change: (e: EditSettings) => void) => void ed.update(change);
  const gesture = { onGestureStart: () => void ed.gestureStart(), onGestureEnd: () => void ed.gestureEnd() };
  const s = props.selection;
  const header = (title: string, icon: any) => (
    <div class="ed-sel__header">
      {icon}
      <span>{title}</span>
      <Button size="sm" variant="danger" onClick={() => void ed.deleteSelection()} tip="Delete" shortcut="⌫">
        <Trash2 size={14} />
      </Button>
    </div>
  );

  return (
    <div class="ed-sel">
      <SolidSwitch>
        <Match when={s.kind === "clip" && ed.state().placements[(s as { id: number }).id]}>
          {(p) => (
            <>
              {header(`Clip ${(s as { id: number }).id + 1}`, <Scissors size={15} />)}
              <Segmented
                value={p().clip.speed}
                onChange={(v) => void ed.apply({ op: "setSpeed", index: (s as { id: number }).id, speed: v })}
                options={[0.5, 1, 1.5, 2, 4].map((v) => ({ value: v, label: `${v}×` }))}
              />
              <Show when={(s as { id: number }).id + 1 < ed.state().placements.length}>
                <Button size="sm" tip="Join with the next clip, bringing back anything cut between them" shortcut="⌘J" onClick={() => void ed.apply({ op: "joinClips", index: (s as { id: number }).id })}>
                  <Merge size={14} /> Join with next clip
                </Button>
              </Show>
            </>
          )}
        </Match>
        <Match when={s.kind === "zoom" && ed.state().zoomSegments.find((z) => z.id === (s as { id: string }).id)}>
          {(z) => (
            <>
              {header("Zoom", <ZoomIn size={15} />)}
              <SliderField
                label="Zoom"
                value={z().scale}
                min={1}
                max={4.5}
                format={(v) => `${v.toFixed(1)}×`}
                onInput={(v) =>
                  set((e) => {
                    // Editing a generated zoom turns the generated ones into manual zooms.
                    if (e.zoom.auto) {
                      e.zoom.segments = structuredClone(ed.state().zoomSegments);
                      e.zoom.auto = false;
                    }
                    const seg = e.zoom.segments.find((x) => x.id === z().id);
                    if (seg) seg.scale = v;
                  })
                }
                {...gesture}
              />
              <SwitchRow
                label="Follow the cursor"
                checked={!z().focus}
                onChange={(follow) =>
                  set((e) => {
                    if (e.zoom.auto) {
                      e.zoom.segments = structuredClone(ed.state().zoomSegments);
                      e.zoom.auto = false;
                    }
                    const seg = e.zoom.segments.find((x) => x.id === z().id);
                    if (seg) follow ? delete seg.focus : (seg.focus = [0.5, 0.5]);
                  })
                }
              />
            </>
          )}
        </Match>
        <Match when={s.kind === "mask" && edit().masks.find((m) => m.id === (s as { id: string }).id)}>
          {(m) => (
            <>
              {header("Privacy mask", <SlidersHorizontal size={15} />)}
              <Segmented
                value={m().style}
                onChange={(v) => set((e) => (e.masks.find((x) => x.id === m().id)!.style = v))}
                options={[
                  { value: "blur", label: "Blur" },
                  { value: "pixelate", label: "Pixelate" },
                  { value: "highlight", label: "Spotlight" },
                ]}
              />
              <SliderField label="Strength" value={m().amount} format={pct} onInput={(v) => set((e) => (e.masks.find((x) => x.id === m().id)!.amount = v))} {...gesture} />
              <MaskMotion editor={ed} maskId={m().id} />
            </>
          )}
        </Match>
        <Match when={s.kind === "text" && edit().texts.find((t) => t.id === (s as { id: string }).id)}>
          {(t) => (
            <>
              {header("Text", <Type size={15} />)}
              <TextField value={t().text} onInput={(ev) => set((e) => (e.texts.find((x) => x.id === t().id)!.text = ev.currentTarget.value))} />
              <Show when={t().style === "lowerThird" || t().style === "bigStat" || t().style === "quote"}>
                <TextField value={t().detail} placeholder="Second line" onInput={(ev) => set((e) => (e.texts.find((x) => x.id === t().id)!.detail = ev.currentTarget.value))} />
              </Show>
              <Segmented
                value={t().animation}
                onChange={(v) => set((e) => (e.texts.find((x) => x.id === t().id)!.animation = v))}
                options={[
                  { value: "fade", label: "Fade" },
                  { value: "slide", label: "Slide" },
                  { value: "pop", label: "Pop" },
                  { value: "typewriter", label: "Type" },
                ]}
              />
            </>
          )}
        </Match>
        <Match when={s.kind === "scene" && edit().scenes.find((x) => x.id === (s as { id: string }).id)}>
          {(sc) => (
            <>
              {header("Scene", <Image size={15} />)}
              <Segmented
                value={sc().layout}
                onChange={(v) => set((e) => (e.scenes.find((x) => x.id === sc().id)!.layout = v))}
                options={[
                  { value: "default", label: "Default" },
                  { value: "cameraOnly", label: "Camera" },
                  { value: "splitScreen", label: "Split" },
                  { value: "floating", label: "Float" },
                  { value: "hideCamera", label: "Screen" },
                ]}
              />
            </>
          )}
        </Match>
        <Match when={true}>{header("Selected", <Clapperboard size={15} />)}</Match>
      </SolidSwitch>
    </div>
  );
}

function backgroundKind(b: Background): "gradient" | "color" | "blurred" {
  if ("color" in b) return "color";
  if ("blurredScreen" in b) return "blurred";
  return "gradient";
}

function defaultBackground(kind: "gradient" | "color" | "blurred"): Background {
  if (kind === "color") return { color: { _0: hexToRgba("#f1f7fc") } };
  if (kind === "blurred") return { blurredScreen: {} };
  return { gradient: { _0: "sky" } };
}

function hexToRgba(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255, a: 1 };
}

function colorHex(b: Background) {
  if (!("color" in b)) return null;
  const c = b.color._0;
  const h = (v: number) => Math.round(v * 255).toString(16).padStart(2, "0");
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

/** Fixed or moving mask, and automatic tracking of the area under it. */
function MaskMotion(props: { editor: Editor; maskId: string }) {
  const ed = props.editor;
  const [progress, setProgress] = createSignal<number | null>(null);
  const mask = () => ed.state().edit.masks.find((m) => m.id === props.maskId);
  const moving = () => (mask()?.keyframes?.length ?? 0) > 0;

  const setMoving = (on: boolean) =>
    void ed.update((e) => {
      const m = e.masks.find((x) => x.id === props.maskId);
      if (!m) return;
      // Turning motion on starts with one keyframe at the mask's start (its current place).
      m.keyframes = on ? [{ t: m.start, rect: m.rect }] : [];
    });

  const track = async () => {
    setProgress(0);
    try {
      const channel = new Channel<number>();
      channel.onmessage = (p) => setProgress(p);
      const next = await invoke<EditorState>("editor_track_mask", { id: ed.state().id, mask: props.maskId, progress: channel });
      ed.replaceState(next);
      toast("The mask now follows that area");
    } catch (e) {
      toast(`Tracking failed: ${e}`);
    } finally {
      setProgress(null);
    }
  };

  return (
    <>
      <Segmented
        value={moving() ? "moving" : "fixed"}
        onChange={(v) => setMoving(v === "moving")}
        options={[
          { value: "fixed", label: "Fixed" },
          { value: "moving", label: "Moving" },
        ]}
      />
      <Show
        when={progress() === null}
        fallback={
          <div style={{ display: "flex", "flex-direction": "column", gap: "6px" }}>
            <div class="umi-section__hint">Following the area… {Math.round((progress() ?? 0) * 100)}%</div>
            <Progress value={progress() ?? 0} />
          </div>
        }
      >
        <Button size="sm" onClick={() => void track()} tip="Place the mask on something, then let Umi follow it as it moves">
          <Crosshair size={14} /> Track this area
        </Button>
      </Show>
      <div class="umi-section__hint">{moving() ? "Move the mask on the preview at different moments; it glides between them." : "Pick Moving to place the mask at different moments, or track an area."}</div>
    </>
  );
}
