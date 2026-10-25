import { Channel, invoke } from "@tauri-apps/api/core";
import { createResource, createSignal, Show } from "solid-js";
import { Button, Progress, Section, Segmented, SwitchRow, toast } from "@umi/ui";
import { EyeOff, Wand2 } from "lucide-solid";
import type { Editor } from "../store";
import type { EditSettings } from "../types";

type Effect = "blur" | "remove" | "face";

/** Camera clean-up made on this computer: background blur/removal, face framing, moving
 *  out of the cursor's way, hiding the camera while nobody talks. */
export function CameraFxSection(props: { editor: Editor }) {
  const ed = props.editor;
  const edit = () => ed.state().edit;
  const set = (change: (e: EditSettings) => void) => void ed.update(change);
  const [made, { refetch }] = createResource(() => invoke<Effect[]>("editor_camera_effects", { id: ed.state().id }).catch(() => [] as Effect[]));
  const [job, setJob] = createSignal<{ effect: Effect; stage: string; value: number } | null>(null);

  /** Makes the effect if it isn't there yet, then applies `after`. */
  const ensure = async (effect: Effect, after: () => void) => {
    if (made()?.includes(effect)) return after();
    const channel = new Channel<{ stage: string; value: number }>();
    channel.onmessage = (m) => setJob({ effect, ...m });
    setJob({ effect, stage: "process", value: 0 });
    try {
      await invoke("editor_camera_effect", { id: ed.state().id, effect, progress: channel });
      await refetch();
      after();
    } catch (e) {
      toast(String(e));
    } finally {
      setJob(null);
    }
  };

  const label = (j: { effect: Effect; stage: string; value: number }) =>
    j.stage === "download"
      ? `Getting the model (once, small)… ${Math.round(j.value * 100)}%`
      : j.effect === "face"
        ? `Finding your face… ${Math.round(j.value * 100)}%`
        : `Going through the camera… ${Math.round(j.value * 100)}%`;

  return (
    <Section title="Camera effects" icon={<Wand2 size={15} />} hint="Made on this computer, once per recording.">
      <div class="umi-field-label">Background</div>
      <Segmented
        value={edit().camera.background ?? "original"}
        onChange={(v) => {
          if (v === "original") set((e) => (e.camera.background = "original"));
          else void ensure(v, () => set((e) => (e.camera.background = v)));
        }}
        options={[
          { value: "original", label: "Original" },
          { value: "blur", label: "Blur" },
          { value: "remove", label: "Remove" },
        ]}
      />
      <Show when={job()}>
        {(j) => (
          <>
            <div class="umi-section__hint">{label(j())}</div>
            <Progress value={j().value} />
          </>
        )}
      </Show>
      <SwitchRow label="Keep my face centered" checked={edit().camera.followFace ?? false} onChange={(v) => (v ? void ensure("face", () => set((e) => (e.camera.followFace = true))) : set((e) => (e.camera.followFace = false)))} />
      <SwitchRow label="Move away from the cursor" checked={edit().camera.avoidCursor ?? false} onChange={(v) => set((e) => (e.camera.avoidCursor = v))} />
      <Button size="sm" onClick={() => void ed.apply({ op: "hideCameraInSilence", min: 4 }).then(() => toast("The camera hides when nobody talks"))}>
        <EyeOff size={14} /> Hide camera while not talking
      </Button>
    </Section>
  );
}
