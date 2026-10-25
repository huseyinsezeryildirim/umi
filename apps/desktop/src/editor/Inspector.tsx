import { createEffect, createSignal, For, Match, Show, Switch as SolidSwitch } from "solid-js";
import { Button, Progress, Section, Segmented, SliderField, Swatch, SwitchRow, Tabs, TextField, toast } from "@umi/ui";
import {
  AudioLines,
  Captions,
  Camera,
  Clapperboard,
  Crop,
  Crosshair,
  EyeOff,
  Sun,
  Layers,
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
import { CropDialog } from "./CropDialog";
import { BackgroundSection } from "./panels/Background";
import { CaptionsSection } from "./panels/Captions";
import { BrandSection } from "./panels/Brand";
import { MusicSection } from "./panels/Music";
import type { Editor } from "./store";
import { maskRectAt, sourceTimeAt, type AspectRatio, type Background, type DeviceFrame, type EditSettings, type GradePreset, type MediaOverlay, type GradientPreset, type Selection } from "./types";

type Tab = "background" | "screen" | "cursor" | "camera" | "zoom" | "color" | "captions" | "audio";

const GRADES: GradePreset[] = ["none", "cinematic", "vivid", "golden", "frost", "midnight", "vintage", "noir", "dreamy"];

const pct = (v: number) => `${Math.round(v * 100)}%`;
const ASPECTS: [AspectRatio, string][] = [
  ["auto", "Auto"],
  ["wide", "16:9"],
  ["vertical", "9:16"],
  ["square", "1:1"],
  ["classic", "4:3"],
  ["portrait", "4:5"],
];

export function Inspector(props: { editor: Editor }) {
  const ed = props.editor;
  const [tab, setTab] = createSignal<Tab>("background");
  const [cropping, setCropping] = createSignal(false);
  createEffect(() => {
    const request = ed.panelRequest();
    if (request) setTab(request.tab as Tab);
  });
  const edit = () => ed.state().edit;
  const set = (change: (e: EditSettings) => void) => void ed.update(change);
  const gesture = { onGestureStart: () => void ed.gestureStart(), onGestureEnd: () => void ed.gestureEnd() };

  return (
    <aside class="ed-inspector umi-panel">
      <Show when={ed.selected().length > 1} fallback={<Show when={ed.selection()}>{(s) => <SelectionPanel editor={ed} selection={s()} />}</Show>}>
        <div class="ed-sel">
          <div class="ed-sel__header">
            <Layers size={15} />
            <span>{ed.selected().length} items selected</span>
            <Button size="sm" variant="danger" onClick={() => void ed.deleteSelection()} tip="Delete all" shortcut="⌫">
              <Trash2 size={14} />
            </Button>
          </div>
          <div class="umi-section__hint">Drag one of them on the timeline to move them together. Shift-click to add or remove items.</div>
        </div>
      </Show>

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
            { id: "captions", label: "Captions & transcript", icon: <Captions size={17} /> },
            { id: "audio", label: "Audio", icon: <AudioLines size={17} /> },
          ]}
        />
      </div>

      <div class="ed-inspector__body">
        <SolidSwitch>
          <Match when={tab() === "background"}>
            <BackgroundSection editor={ed} gesture={gesture} />
            <Section title="Shape" icon={<Clapperboard size={15} />}>
              <div class="ed-chips">
                <For each={ASPECTS}>
                  {([value, label]) => (
                    <button type="button" class="ed-chip" data-selected={edit().aspect === value ? "true" : "false"} onClick={() => set((e) => (e.aspect = value))}>
                      {label}
                    </button>
                  )}
                </For>
              </div>
            </Section>
            <BrandSection editor={ed} gesture={gesture} />
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
              <Button size="sm" onClick={() => setCropping(true)}>
                <Crop size={14} /> {edit().crop ? "Change crop…" : "Crop…"}
              </Button>
              <CropDialog editor={ed} open={cropping()} onClose={() => setCropping(false)} />
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
            <Section title="Automatic zoom" icon={<ZoomIn size={15} />}>
              <SwitchRow label="Zoom automatically" checked={edit().zoom.auto} onChange={(v) => set((e) => (e.zoom.auto = v))} />
              <Show when={edit().zoom.auto}>
                <Segmented
                  value={edit().zoom.trigger ?? "clicks"}
                  onChange={(v) => set((e) => (e.zoom.trigger = v))}
                  options={[
                    { value: "clicks", label: "On clicks" },
                    { value: "smart", label: "Smart" },
                  ]}
                />
                <div class="umi-section__hint">
                  {(edit().zoom.trigger ?? "clicks") === "smart"
                    ? "Zooms where you click and type, just enough to fit the area you work in. Up to the zoom below."
                    : "Zooms in on every group of clicks, at the zoom below."}
                </div>
              </Show>
              <SliderField label={(edit().zoom.trigger ?? "clicks") === "smart" ? "Max zoom" : "Zoom"} value={edit().zoom.scale} min={1.2} max={3.5} format={(v) => `${v.toFixed(1)}×`} onInput={(v) => set((e) => (e.zoom.scale = v))} {...gesture} />
            </Section>
            <Section title="Motion" icon={<Sparkles size={15} />}>
              <div class="umi-field-label">Speed</div>
              <Segmented
                value={edit().zoom.speed ?? "normal"}
                onChange={(v) => set((e) => (e.zoom.speed = v))}
                options={[
                  { value: "slow", label: "Slow" },
                  { value: "normal", label: "Normal" },
                  { value: "fast", label: "Fast" },
                ]}
              />
              <div class="umi-field-label">While zoomed in, follow</div>
              <Segmented
                value={edit().zoom.follow ?? "cursor"}
                onChange={(v) => set((e) => (e.zoom.follow = v))}
                options={[
                  { value: "cursor", label: "Cursor" },
                  { value: "clicks", label: "Clicks" },
                ]}
              />
              <div class="umi-section__hint">
                {(edit().zoom.follow ?? "cursor") === "clicks" ? "The view holds still and pans smoothly to each click." : "The view glides after the cursor."}
              </div>
              <SwitchRow label="Glide between zooms" checked={edit().zoom.glide ?? false} onChange={(v) => set((e) => (e.zoom.glide = v))} />
              <div class="umi-section__hint">Zooms close together stay zoomed in and pan from one to the next instead of zooming out and back in.</div>
            </Section>
            <Section title="Manual zoom" icon={<ZoomIn size={15} />} hint="Press Z to add a zoom at the playhead. Drag a zoom on the timeline to move it.">
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

          <Match when={tab() === "captions"}>
            <CaptionsSection editor={ed} gesture={gesture} />
          </Match>

          <Match when={tab() === "audio"}>
            <Section title="Clips" icon={<Scissors size={15} />} hint="Blends each cut into the next clip.">
              <SliderField label="Crossfade" value={edit().crossfade} max={1.5} format={(v) => `${v.toFixed(1)}s`} onInput={(v) => set((e) => (e.crossfade = v))} {...gesture} />
            </Section>
            <MusicSection editor={ed} gesture={gesture} />
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
              <Show
                when={m().style === "highlight"}
                fallback={
                  <>
                    {header("Blur", <EyeOff size={15} />)}
                    <Segmented
                      value={m().style}
                      onChange={(v) => set((e) => (e.masks.find((x) => x.id === m().id)!.style = v))}
                      options={[
                        { value: "blur", label: "Blur" },
                        { value: "pixelate", label: "Pixelate" },
                      ]}
                    />
                  </>
                }
              >
                {header("Spotlight", <Sun size={15} />)}
                <div class="umi-section__hint">Keeps this area bright and dims the rest of the screen.</div>
              </Show>
              <SliderField label={m().style === "highlight" ? "Dim the rest" : "Strength"} value={m().amount} format={pct} onInput={(v) => set((e) => (e.masks.find((x) => x.id === m().id)!.amount = v))} {...gesture} />
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
        <Match when={s.kind === "overlay" && edit().overlays.find((x) => x.id === (s as { id: string }).id)}>
          {(o) => {
            const setO = (change: (x: MediaOverlay) => void) =>
              set((e) => {
                const x = e.overlays.find((y) => y.id === o().id);
                if (x) change(x);
              });
            return (
              <>
                {header(o().lane === 2 ? "Video 2" : o().kind === "video" ? "Video" : "Image", <Image size={15} />)}
                <Show when={o().lane !== 2}>
                  <div class="ed-file">{o().file}</div>
                </Show>
                <Segmented
                  value={o().mode}
                  onChange={(v) => setO((x) => (x.mode = v))}
                  options={[
                    { value: "fill", label: "Fill" },
                    { value: "pictureInPicture", label: "Picture in picture" },
                  ]}
                />
                <Show when={o().mode === "pictureInPicture"}>
                  <SliderField label="Size" value={o().width} min={0.15} max={0.9} format={pct} onInput={(v) => setO((x) => (x.width = v))} {...gesture} />
                  <div class="umi-section__hint">Drag it on the preview to place it.</div>
                </Show>
                <Show when={o().mode === "fill"}>
                  <div class="umi-section__hint">Covers the screen; background and camera stay.</div>
                </Show>
              </>
            );
          }}
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

/**
 * How the mask moves: fixed, stuck to the content under it (tracked, redone when moved), or
 * placed by hand at different moments (keyframes).
 */
function MaskMotion(props: { editor: Editor; maskId: string }) {
  const ed = props.editor;
  const mask = () => ed.state().edit.masks.find((m) => m.id === props.maskId);
  const mode = () => (mask()?.follow ? "stick" : (mask()?.keyframes?.length ?? 0) > 0 ? "keys" : "fixed");
  const job = () => (ed.tracking()?.mask === props.maskId ? ed.tracking() : null);
  const anchor = () => {
    const m = mask();
    const t = sourceTimeAt(ed.state().placements, ed.time());
    return m ? Math.min(Math.max(t, m.start), m.end) : t;
  };

  const setMode = (next: string) => {
    const m = mask();
    if (!m) return;
    if (next === "stick") {
      void ed.trackMask(props.maskId, anchor()).then(
        () => toast("Stuck to the content: it moves when the screen moves"),
        (e) => toast(`Couldn't follow that area: ${e}`),
      );
      return;
    }
    // Leaving "stick" keeps the place it has at the playhead.
    const here = maskRectAt(m, anchor());
    void ed.update((e) => {
      const x = e.masks.find((k) => k.id === props.maskId);
      if (!x) return;
      x.follow = false;
      x.rect = here;
      x.keyframes = next === "keys" ? [{ t: anchor(), rect: here }] : [];
    });
  };

  return (
    <>
      <Segmented
        value={mode()}
        onChange={setMode}
        options={[
          { value: "fixed", label: "Fixed" },
          { value: "stick", label: "Follow" },
          { value: "keys", label: "Manual" },
        ]}
      />
      <Show when={job()}>
        {(j) => (
          <div style={{ display: "flex", "flex-direction": "column", gap: "6px" }}>
            <div class="umi-section__hint">Following the content… {Math.round(j().progress * 100)}%</div>
            <Progress value={j().progress} />
          </div>
        )}
      </Show>
      <div class="umi-section__hint">
        {mode() === "stick"
          ? "Automatic: the mask sticks to what's under it and moves when the page scrolls. Drag it on the preview to stick it somewhere else."
          : mode() === "keys"
            ? "You place it: move the mask on the preview at different moments and it glides between those spots."
            : "The mask stays in one place. Follow makes it move with scrolling content; Manual lets you place it over time."}
      </div>
    </>
  );
}
