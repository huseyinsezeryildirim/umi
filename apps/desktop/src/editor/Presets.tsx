import { invoke } from "@tauri-apps/api/core";
import { createSignal, For, Show } from "solid-js";
import { Button, Dialog, IconButton, Menu, TextField, toast, type MenuEntry } from "@umi/ui";
import { Palette, Plus, Settings2, Star, Trash2 } from "lucide-solid";
import type { Editor } from "./store";
import type { EditorState } from "./types";

interface Preset {
  id: string;
  name: string;
}
interface Library {
  presets: Preset[];
  defaultId?: string;
}

/** Saved looks: apply one, save the current look, pick the default for new recordings. */
export function PresetsMenu(props: { editor: Editor }) {
  const ed = props.editor;
  const [library, setLibrary] = createSignal<Library>({ presets: [] });
  const [saving, setSaving] = createSignal(false);
  const [managing, setManaging] = createSignal(false);
  const [name, setName] = createSignal("");
  const refresh = () => invoke<Library>("presets_list").then(setLibrary);
  void refresh();

  const apply = async (p: Preset) => {
    const next = await invoke<EditorState>("preset_apply", { id: ed.state().id, preset: p.id });
    ed.replaceState(next);
    void invoke("editor_save", { id: next.id });
    toast(`Applied “${p.name}”`);
  };
  const save = async () => {
    if (!name().trim()) return;
    setLibrary(await invoke<Library>("preset_save", { id: ed.state().id, name: name() }));
    setSaving(false);
    toast(`Saved “${name().trim()}”`);
    setName("");
  };

  const entries = (): MenuEntry[] => [
    ...(library().presets.length ? [{ kind: "label" as const, label: "Apply a look" }] : []),
    ...library().presets.map((p) => ({ label: p.name, icon: <Palette size={15} />, checked: p.id === library().defaultId, onSelect: () => void apply(p) })),
    ...(library().presets.length ? [{ kind: "separator" as const }] : []),
    { label: "Save current look…", icon: <Plus size={15} />, onSelect: () => setSaving(true) },
    ...(library().presets.length ? [{ label: "Manage looks…", icon: <Settings2 size={15} />, onSelect: () => setManaging(true) }] : []),
  ];

  return (
    <>
      <Menu
        align="end"
        width={230}
        trigger={(open) => (
          <IconButton label="Looks" onClick={() => void refresh().then(open)}>
            <Palette size={17} />
          </IconButton>
        )}
        entries={entries()}
      />
      <Dialog open={saving()} title="Save this look" onClose={() => setSaving(false)} width={380}>
        <div class="umi-section__hint" style={{ "margin-top": "-6px", "margin-bottom": "12px" }}>
          Background, frame, padding, corners, shadow, cursor, camera style and color. Not cuts, zooms or text.
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <TextField value={name()} placeholder="Name, e.g. Product demos" autofocus onInput={(e) => setName(e.currentTarget.value)} />
          <div class="ed-export__actions">
            <Button type="button" variant="ghost" onClick={() => setSaving(false)}>
              Cancel
            </Button>
            <Button variant="ink" type="submit" disabled={!name().trim()}>
              Save
            </Button>
          </div>
        </form>
      </Dialog>
      <Dialog open={managing()} title="Looks" onClose={() => setManaging(false)} width={420}>
        <div class="umi-section__hint" style={{ "margin-top": "-6px", "margin-bottom": "8px" }}>
          The starred look is how new recordings start.
        </div>
        <div class="ed-presets">
          <For each={library().presets}>
            {(p) => (
              <div class="ed-preset">
                <span>{p.name}</span>
                <IconButton
                  label={p.id === library().defaultId ? "Default for new recordings" : "Use for new recordings"}
                  size="sm"
                  active={p.id === library().defaultId}
                  onClick={async () => setLibrary(await invoke<Library>("preset_set_default", { preset: p.id === library().defaultId ? null : p.id }))}
                >
                  <Star size={14} fill={p.id === library().defaultId ? "currentColor" : "none"} />
                </IconButton>
                <IconButton label="Delete" size="sm" onClick={async () => setLibrary(await invoke<Library>("preset_delete", { preset: p.id }))}>
                  <Trash2 size={14} />
                </IconButton>
              </div>
            )}
          </For>
          <Show when={!library().presets.length}>
            <div class="umi-section__hint">No saved looks.</div>
          </Show>
        </div>
      </Dialog>
    </>
  );
}
