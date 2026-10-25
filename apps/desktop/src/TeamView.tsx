import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { createResource, createSignal, For, Show } from "solid-js";
import { Button, Menu, Spinner, TextField, toast } from "@umi/ui";
import { Copy, ExternalLink, LogOut, Palette, Plus, RefreshCw, Share2, Trash2, UserMinus, Users } from "lucide-solid";
import { formatTime } from "./editor/store";

export interface Workspace {
  id: string;
  name: string;
  role: "owner" | "member";
  members: number;
  inviteCode?: string | null;
}
interface Member {
  id: string;
  email: string | null;
  role: string;
  you: boolean;
}
interface TeamVideo {
  id: string;
  url: string;
  title: string;
  durationMs: number | null;
  thumbnailUrl: string | null;
  owner: string | null;
  yours: boolean;
  createdAt?: string;
}
interface TeamPreset {
  id: string;
  name: string;
  edit: unknown;
  updatedBy: string | null;
}
interface LocalPreset {
  id: string;
  name: string;
}

const run = async <T,>(cmd: string, args?: Record<string, unknown>) => {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    toast(String(e));
    throw e;
  }
};

/** The library's Team tab: workspaces on Umi Cloud, their videos and shared styles. */
export function TeamView() {
  const [status] = createResource(() => invoke<{ connected: boolean }>("cloud_status"));
  const [teams, { refetch }] = createResource(
    () => status()?.connected,
    () => invoke<Workspace[]>("team_list").catch((e) => (toast(String(e)), [] as Workspace[])),
  );
  const [chosen, setChosen] = createSignal<string | null>(null);
  const current = () => teams()?.find((t) => t.id === chosen()) ?? teams()?.[0];

  return (
    <div class="team">
      <Show when={!status.loading && !teams.loading} fallback={<Spinner />}>
        <Show
          when={status()?.connected}
          fallback={<p class="lib__empty">Team workspaces are part of Umi Cloud. Connect from Share in the editor first.</p>}
        >
          <Show when={teams()?.length} fallback={<Start onDone={(w) => (setChosen(w.id), void refetch())} />}>
            <Show when={(teams()?.length ?? 0) > 1}>
              <div class="team__tabs">
                <For each={teams()}>
                  {(t) => (
                    <button type="button" class="ed-chip" data-selected={current()?.id === t.id ? "true" : "false"} onClick={() => setChosen(t.id)}>
                      {t.name}
                    </button>
                  )}
                </For>
              </div>
            </Show>
            <Show when={current()} keyed>
              {(w) => <Workspace workspace={w} onChanged={() => void refetch()} />}
            </Show>
          </Show>
        </Show>
      </Show>
    </div>
  );
}

/** No team yet: make one or join one. */
function Start(props: { onDone: (w: Workspace) => void }) {
  const [name, setName] = createSignal("");
  const [code, setCode] = createSignal("");
  return (
    <div class="team__start">
      <div class="team__card umi-card">
        <Users size={22} />
        <h2>Create a team</h2>
        <p>Share videos and styles with your team. Everyone joins with an invite code.</p>
        <TextField value={name()} placeholder="Team name" onInput={(e) => setName(e.currentTarget.value)} />
        <Button variant="ink" disabled={!name().trim()} onClick={() => void run<Workspace>("team_create", { name: name() }).then(props.onDone)}>
          <Plus size={14} /> Create
        </Button>
      </div>
      <div class="team__card umi-card">
        <Share2 size={22} />
        <h2>Join a team</h2>
        <p>Paste the invite code someone on the team gave you.</p>
        <TextField value={code()} placeholder="Invite code" onInput={(e) => setCode(e.currentTarget.value)} />
        <Button disabled={!code().trim()} onClick={() => void run<Workspace>("team_join", { code: code() }).then(props.onDone)}>
          Join
        </Button>
      </div>
    </div>
  );
}

function Workspace(props: { workspace: Workspace; onChanged: () => void }) {
  const w = () => props.workspace;
  const [detail, { refetch: refetchDetail }] = createResource(() => invoke<{ workspace: Workspace; members: Member[] }>("team_detail", { id: w().id }));
  const [videos] = createResource(() => invoke<TeamVideo[]>("team_videos", { id: w().id }).catch(() => []));
  const [presets, { refetch: refetchPresets }] = createResource(() => invoke<TeamPreset[]>("team_presets", { id: w().id }).catch(() => []));
  const [mine] = createResource(() => invoke<{ presets: LocalPreset[] }>("presets_list").then((l) => l.presets));
  const owner = () => w().role === "owner";
  const code = () => detail()?.workspace.inviteCode ?? w().inviteCode;

  const copy = (text: string, what: string) => void invoke("copy_text_to_clipboard", { text }).then(() => toast(`${what} copied`));
  const leave = async () => {
    const me = detail()?.members.find((m) => m.you);
    if (me) await run("team_remove_member", { id: w().id, member: me.id });
    props.onChanged();
  };

  return (
    <div class="team__body">
      <section class="team__head">
        <div>
          <h2>{w().name}</h2>
          <p>
            {w().members} {w().members === 1 ? "member" : "members"} · {owner() ? "You own this team" : "Member"}
          </p>
        </div>
        <div class="lib__actions">
          <Show when={owner() && code()}>
            <Button size="sm" onClick={() => copy(code()!, "Invite code")} tip="Send it to people you want in the team">
              <Copy size={14} /> Copy invite code
            </Button>
            <Button size="sm" variant="ghost" tip="Make a new code; the old one stops working" onClick={() => void run("team_rotate_invite", { id: w().id }).then(() => void refetchDetail())}>
              <RefreshCw size={14} />
            </Button>
          </Show>
          <Show
            when={owner()}
            fallback={
              <Button size="sm" variant="ghost" onClick={() => void leave()}>
                <LogOut size={14} /> Leave
              </Button>
            }
          >
            <Button size="sm" variant="danger" onClick={() => void run("team_delete", { id: w().id }).then(props.onChanged)}>
              <Trash2 size={14} /> Delete team
            </Button>
          </Show>
        </div>
      </section>

      <section>
        <h3>Videos</h3>
        <Show when={!videos.loading} fallback={<Spinner />}>
          <div class="lib__grid">
            <For each={videos()} fallback={<p class="lib__empty">No team videos yet. In Share, choose this team to add one.</p>}>
              {(v) => (
                <div
                  role="button"
                  tabIndex={0}
                  class="lib__card umi-card"
                  onClick={() => void openUrl(v.url)}
                  onKeyDown={(e) => e.key === "Enter" && void openUrl(v.url)}
                >
                  <div class="lib__thumb">
                    <Show when={v.thumbnailUrl}>
                      <img src={v.thumbnailUrl!} alt="" draggable={false} />
                    </Show>
                    <Show when={v.durationMs}>
                      <span class="lib__duration">{formatTime((v.durationMs ?? 0) / 1000, false)}</span>
                    </Show>
                  </div>
                  <div class="lib__meta">
                    <div class="lib__name">{v.title}</div>
                    <div class="lib__sub team__by">
                      <span>{v.yours ? "You" : (v.owner ?? "Someone")}</span>
                      <span class="team__icons" onClick={(e) => e.stopPropagation()}>
                        <button type="button" title="Copy link" onClick={() => copy(v.url, "Link")}>
                          <Copy size={13} />
                        </button>
                        <button type="button" title="Open" onClick={() => void openUrl(v.url)}>
                          <ExternalLink size={13} />
                        </button>
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>
      </section>

      <section>
        <div class="team__row">
          <h3>Shared styles</h3>
          <Show when={mine()?.length}>
            <Menu
              align="end"
              trigger={(open) => (
                <Button size="sm" onClick={open}>
                  <Palette size={14} /> Share a style
                </Button>
              )}
              entries={(mine() ?? []).map((p) => ({
                label: p.name,
                onSelect: () => void run("team_preset_share", { id: w().id, preset: p.id }).then(() => (toast(`“${p.name}” shared with the team`), void refetchPresets())),
              }))}
            />
          </Show>
        </div>
        <div class="team__list">
          <For each={presets()} fallback={<p class="lib__empty">Save a look with Presets in the editor, then share it here.</p>}>
            {(p) => (
              <div class="team__item">
                <Palette size={15} />
                <span class="team__item-name">{p.name}</span>
                <span class="team__item-sub">{p.updatedBy ?? ""}</span>
                <Button size="sm" onClick={() => void run("team_preset_save", { preset: p }).then(() => toast(`“${p.name}” added to your presets`))}>
                  Add to my presets
                </Button>
                <Show when={owner()}>
                  <Button size="sm" variant="ghost" tip="Remove from the team" onClick={() => void run("team_preset_delete", { id: w().id, preset: p.id }).then(() => void refetchPresets())}>
                    <Trash2 size={14} />
                  </Button>
                </Show>
              </div>
            )}
          </For>
        </div>
      </section>

      <section>
        <h3>Members</h3>
        <div class="team__list">
          <For each={detail()?.members}>
            {(m) => (
              <div class="team__item">
                <span class="team__avatar">{(m.email ?? "?").slice(0, 1).toUpperCase()}</span>
                <span class="team__item-name">
                  {m.email ?? m.id}
                  {m.you ? " (you)" : ""}
                </span>
                <span class="team__item-sub">{m.role === "owner" ? "Owner" : "Member"}</span>
                <Show when={owner() && !m.you}>
                  <Button size="sm" variant="ghost" tip="Remove from the team" onClick={() => void run("team_remove_member", { id: w().id, member: m.id }).then(() => void refetchDetail())}>
                    <UserMinus size={14} />
                  </Button>
                </Show>
              </div>
            )}
          </For>
        </div>
      </section>
    </div>
  );
}
