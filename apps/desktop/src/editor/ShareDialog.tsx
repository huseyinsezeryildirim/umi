import { Channel, invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { createEffect, createSignal, For, Match, on, Show, Switch } from "solid-js";
import { Button, Dialog, Progress, Segmented, SwitchRow, TextField, toast } from "@umi/ui";
import { Check, Copy, ExternalLink, Link2, Lock, Trash2 } from "lucide-solid";
import type { Editor } from "./store";
import { teamsEnabled } from "../platform";

interface Video {
  id: string;
  url: string;
  title: string;
  status: string;
  allowDownload: boolean;
  hasPassword: boolean;
  allowComments?: boolean;
  expiresAt?: string | null;
  workspaceId?: string | null;
  durationMs?: number | null;
  /** A free link: it's deleted at `expiresAt` unless you upgrade. */
  keptByUpgrade?: boolean;
  /** "raw": made while recording, so there's nothing to prepare or upload. */
  kind?: string;
  /** False until shared: an unshared raw link is deleted after a day. */
  shared?: boolean;
}
interface Insights {
  views: number;
  watchedSeconds: number;
  averageSeconds: number;
  completion: number;
  retention: number[];
  embeddedViews: number;
  countries: { country: string; count: number }[];
}
type Progress = { stage: string; value: number; video?: Video };

const EXPIRY: [string, number | null][] = [
  ["Never", null],
  ["1 day", 1],
  ["7 days", 7],
  ["30 days", 30],
];

/** Get a link: upload to Umi Cloud, copy, embed, and the link's settings. */
export function ShareDialog(props: { editor: Editor; open: boolean; onClose: () => void }) {
  const ed = props.editor;
  const [connected, setConnected] = createSignal<boolean | null>(null);
  const [server, setServer] = createSignal("https://umi.cam");
  const [token, setToken] = createSignal("");
  const [video, setVideo] = createSignal<Video | null>(null);
  const [job, setJob] = createSignal<Progress | null>(null);
  const [atTime, setAtTime] = createSignal(false);
  const [embedKind, setEmbedKind] = createSignal<"responsive" | "fixed" | "gif">("responsive");
  const [password, setPassword] = createSignal("");
  const [copied, setCopied] = createSignal<string | null>(null);
  const [insights, setInsights] = createSignal<Insights | null>(null);
  const [teams, setTeams] = createSignal<{ id: string; name: string }[]>([]);

  createEffect(
    on(
      () => props.open,
      async (open) => {
        if (!open) return;
        const status = await invoke<{ connected: boolean; server: string }>("cloud_status");
        setConnected(status.connected);
        setServer(status.server);
        let shared = await invoke<Video | null>("share_state", { id: ed.state().id });
        // Made while recording: the link is already there; opening Share keeps it.
        if (shared?.kind === "raw" && shared.shared === false) {
          shared = await invoke<Video | null>("live_share", { id: ed.state().id }).catch((e) => {
            toast(String(e));
            return shared;
          });
        }
        setVideo(shared);
        setInsights(null);
        if (shared?.status === "ready") invoke<Insights | null>("share_insights", { id: ed.state().id }).then(setInsights, () => {});
        if (status.connected && teamsEnabled) invoke<{ id: string; name: string }[]>("team_list").then(setTeams, () => setTeams([]));
      },
    ),
  );

  const connect = async () => {
    try {
      await invoke("cloud_connect", { server: server(), token: token() });
      setConnected(true);
      setToken("");
    } catch (e) {
      toast(String(e));
    }
  };

  const start = async () => {
    const channel = new Channel<Progress>();
    channel.onmessage = (p) => {
      setJob(p);
      if (p.video) setVideo(p.video);
      if (p.stage === "link") toast("Link copied — it works as soon as the upload finishes");
    };
    // Links made from the recording itself go straight to uploading (an older recording on the Mac
    // says "export" first).
    setJob({ stage: "upload", value: 0 });
    try {
      setVideo(await invoke<Video>("share_start", { id: ed.state().id, progress: channel }));
    } catch (e) {
      toast(String(e));
    } finally {
      setJob(null);
    }
  };

  const link = () => {
    const v = video();
    if (!v) return "";
    const t = Math.floor(ed.time());
    return atTime() && t >= 1 ? `${v.url}${v.url.includes("?") ? "&" : "?"}t=${t}` : v.url;
  };
  const embed = () => {
    const v = video();
    if (!v) return "";
    const e = v.url.replace("/v/", "/e/");
    if (embedKind() === "fixed") return `<iframe src="${e}" width="640" height="360" frameborder="0" allow="fullscreen; picture-in-picture" allowfullscreen></iframe>`;
    if (embedKind() === "gif") return `<a href="${v.url}"><img src="${v.url}/preview.gif" alt="Watch the video" width="480"></a>`;
    return `<div style="position:relative;padding-bottom:56.25%;height:0"><iframe src="${e}" style="position:absolute;inset:0;width:100%;height:100%" frameborder="0" allow="fullscreen; picture-in-picture" allowfullscreen></iframe></div>`;
  };
  const copy = async (text: string, what: string) => {
    await invoke("copy_text_to_clipboard", { text });
    setCopied(what);
    window.setTimeout(() => setCopied(null), 1500);
  };
  const update = async (settings: Record<string, unknown>) => {
    try {
      setVideo(await invoke<Video>("share_update", { id: ed.state().id, settings }));
    } catch (e) {
      toast(String(e));
    }
  };
  const remove = async () => {
    try {
      await invoke("share_delete", { id: ed.state().id });
      setVideo(null);
      toast("Link deleted");
    } catch (e) {
      toast(String(e));
    }
  };

  const stageLabel = (p: Progress) => (p.stage === "export" ? `Preparing the video… ${Math.round(p.value * 100)}%` : `Uploading… ${Math.round(p.value * 100)}%`);

  return (
    <Dialog open={props.open} title="Share" onClose={props.onClose} width={500}>
      <div class="ed-export">
        <Switch>
          <Match when={connected() === false}>
            <div class="umi-section__hint" style={{ "margin-top": "-6px" }}>
              Links are made by Umi Cloud. Recording, editing and exporting stay free on your computer.
            </div>
            <div class="umi-field-label">Server</div>
            <TextField value={server()} onInput={(e) => setServer(e.currentTarget.value)} />
            <div class="umi-field-label">Access token</div>
            <TextField value={token()} placeholder="From your Umi Cloud account page" onInput={(e) => setToken(e.currentTarget.value)} type="password" />
            <div class="ed-export__actions">
              <Button variant="ghost" onClick={props.onClose}>Cancel</Button>
              <Button variant="ink" disabled={!token().trim()} onClick={() => void connect()}>
                Connect
              </Button>
            </div>
          </Match>
          <Match when={job()}>
            {(j) => (
              <>
                <div class="umi-section__hint">{stageLabel(j())}</div>
                <Progress value={j().stage === "export" ? j().value * 0.5 : 0.5 + j().value * 0.5} />
                <Show when={video()}>
                  <div class="ed-share__link">
                    <Link2 size={15} />
                    <span>{video()!.url}</span>
                  </div>
                </Show>
              </>
            )}
          </Match>
          <Match when={connected() && !video()}>
            <div class="umi-section__hint" style={{ "margin-top": "-6px" }}>
              Uploads this video and copies a link anyone can watch in their browser, no account needed.
            </div>
            <div class="ed-export__actions">
              <Button variant="ghost" onClick={props.onClose}>Cancel</Button>
              <Button variant="ink" onClick={() => void start()}>
                <Link2 size={15} /> Create link
              </Button>
            </div>
          </Match>
          <Match when={connected() && video()}>
            {(v) => (
              <>
                <div class="ed-share__row">
                  <div class="ed-share__link">
                    <Link2 size={15} />
                    <span>{link()}</span>
                  </div>
                  <Button variant="ink" onClick={() => void copy(link(), "link")}>
                    <Show when={copied() === "link"} fallback={<Copy size={14} />}>
                      <Check size={14} />
                    </Show>
                    {copied() === "link" ? "Copied" : "Copy"}
                  </Button>
                </div>
                <Show when={insights()}>{(i) => <ViewerInsights insights={i()} seconds={(v().durationMs ?? 0) / 1000} />}</Show>
                <SwitchRow label={`Start at ${Math.floor(ed.time() / 60)}:${String(Math.floor(ed.time() % 60)).padStart(2, "0")}`} checked={atTime()} onChange={setAtTime} />
                <Show when={teams().length}>
                  <div class="umi-field-label">Team</div>
                  <div class="ed-chips">
                    <button type="button" class="ed-chip" data-selected={!v().workspaceId ? "true" : "false"} onClick={() => void update({ workspaceId: null })}>
                      Only me
                    </button>
                    <For each={teams()}>
                      {(t) => (
                        <button type="button" class="ed-chip" data-selected={v().workspaceId === t.id ? "true" : "false"} onClick={() => void update({ workspaceId: t.id })}>
                          {t.name}
                        </button>
                      )}
                    </For>
                  </div>
                </Show>
                <SwitchRow label="Viewers can download" checked={v().allowDownload} onChange={(on) => void update({ allowDownload: on })} />
                <SwitchRow label="Comments" checked={v().allowComments ?? true} onChange={(on) => void update({ allowComments: on })} />
                <Show when={v().keptByUpgrade && v().expiresAt}>
                  <div class="ed-share__free">
                    <span>
                      Free links stay up for 7 days: this one is deleted {new Date(v().expiresAt!).toLocaleDateString(undefined, { day: "numeric", month: "long" })}.
                    </span>
                    <Button onClick={() => void openUrl("https://umi.cam/#pricing")}>
                      Keep it with Pro
                    </Button>
                  </div>
                </Show>
                <Show when={!v().keptByUpgrade}>
                <div class="umi-field-label">Expires</div>
                <div class="ed-chips">
                  <For each={EXPIRY}>
                    {([label, days]) => (
                      <button
                        type="button"
                        class="ed-chip"
                        data-selected={(days === null && !v().expiresAt) ? "true" : "false"}
                        onClick={() => void update({ expiresAt: days === null ? null : new Date(Date.now() + days * 86_400_000).toISOString() })}
                      >
                        {label}
                      </button>
                    )}
                  </For>
                </div>
                <Show when={v().expiresAt}>
                  <div class="umi-section__hint">Expires {new Date(v().expiresAt!).toLocaleString()}</div>
                </Show>
                </Show>
                <div class="umi-field-label">Password</div>
                <Show when={v().keptByUpgrade}>
                  <div class="umi-section__hint">Passwords on links are part of Umi Pro.</div>
                </Show>
                <Show when={!v().keptByUpgrade}>
                <div class="ed-share__row">
                  <TextField value={password()} placeholder={v().hasPassword ? "Password set · type to change" : "No password"} onInput={(e) => setPassword(e.currentTarget.value)} type="password" />
                  <Button onClick={() => void update({ password: password() }).then(() => setPassword(""))} disabled={!password()}>
                    <Lock size={14} /> Set
                  </Button>
                  <Show when={v().hasPassword}>
                    <Button variant="ghost" onClick={() => void update({ password: "" })}>Remove</Button>
                  </Show>
                </div>
                </Show>
                <div class="umi-field-label">Embed</div>
                <Segmented
                  value={embedKind()}
                  onChange={setEmbedKind}
                  options={[
                    { value: "responsive", label: "Responsive" },
                    { value: "fixed", label: "Fixed size" },
                    { value: "gif", label: "GIF preview" },
                  ]}
                />
                <div class="ed-share__row">
                  <code class="ed-share__code">{embed()}</code>
                  <Button onClick={() => void copy(embed(), "embed")}>{copied() === "embed" ? "Copied" : "Copy"}</Button>
                </div>
                <div class="ed-export__actions">
                  <Button variant="danger" onClick={() => void remove()}>
                    <Trash2 size={14} /> Delete link
                  </Button>
                  <span style={{ flex: 1 }} />
                  <Button onClick={() => void openUrl(v().url)}>
                    <ExternalLink size={14} /> Open
                  </Button>
                  <Button variant="ghost" onClick={props.onClose}>
                    Done
                  </Button>
                </div>
              </>
            )}
          </Match>
        </Switch>
      </div>
    </Dialog>
  );
}

const duration = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`);

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/**
 * Share of viewers still watching across the video (0–100%), with the biggest drop marked
 * and the value under the pointer.
 */
function RetentionChart(props: { retention: number[]; seconds: number }) {
  const W = 320;
  const H = 84;
  const points = () => props.retention.map((r, k, all) => [(k / Math.max(all.length - 1, 1)) * W, H - r * H] as const);
  const line = () => points().map(([x, y], k) => `${k ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area = () => `${line()} L${W} ${H} L0 ${H} Z`;
  /** Where the most viewers leave between two points. */
  const drop = () => {
    const r = props.retention;
    let best = -1;
    let size = 0;
    for (let k = 1; k < r.length; k++) if (r[k - 1] - r[k] > size) (size = r[k - 1] - r[k]), (best = k);
    return size >= 0.05 ? best : -1;
  };
  const [hover, setHover] = createSignal<number | null>(null);
  const at = (k: number) => (props.seconds ? clock((k / Math.max(props.retention.length - 1, 1)) * props.seconds) : `${Math.round((k / Math.max(props.retention.length - 1, 1)) * 100)}%`);
  const last = () => props.retention[props.retention.length - 1] ?? 0;
  return (
    <div class="ed-retention">
      <div class="ed-retention__plot">
        <span class="ed-retention__axis">
          <i>100%</i>
          <i>50%</i>
          <i>0</i>
        </span>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          onPointerMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setHover(Math.round(((e.clientX - r.left) / r.width) * (props.retention.length - 1)));
          }}
          onPointerLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id="retention-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="#116ff5" stop-opacity="0.28" />
              <stop offset="1" stop-color="#116ff5" stop-opacity="0.02" />
            </linearGradient>
          </defs>
          <line x1="0" x2={W} y1={H / 2} y2={H / 2} class="ed-retention__grid" />
          <path d={area()} fill="url(#retention-fill)" />
          <path d={line()} class="ed-retention__line" />
          <Show when={drop() >= 0}>
            <circle cx={points()[drop()][0]} cy={points()[drop()][1]} r="3.5" class="ed-retention__drop" />
          </Show>
          <Show when={hover() !== null}>
            <line x1={points()[hover()!][0]} x2={points()[hover()!][0]} y1="0" y2={H} class="ed-retention__cursor" />
          </Show>
        </svg>
        <span class="ed-retention__end">{Math.round(last() * 100)}%</span>
        <Show when={hover() !== null}>
          <span class="ed-retention__tip" style={{ left: `${(hover()! / Math.max(props.retention.length - 1, 1)) * 100}%` }}>
            {at(hover()!)} · {Math.round(props.retention[hover()!] * 100)}% watching
          </span>
        </Show>
      </div>
      <div class="ed-retention__times">
        <span>0:00</span>
        <Show when={drop() >= 0}>
          <span class="ed-retention__note">Most leave around {at(drop())}</span>
        </Show>
        <span>{props.seconds ? clock(props.seconds) : "end"}</span>
      </div>
    </div>
  );
}

/** "TR" → 🇹🇷 and the country's name in the reader's language. */
const flag = (code: string) => String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1a5 + c.charCodeAt(0)));
const countryName = (code: string) => {
  try {
    return new Intl.DisplayNames(undefined, { type: "region" }).of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
};

/** Views, watch time and where people stop watching (Umi Cloud). */
function ViewerInsights(props: { insights: Insights; seconds: number }) {
  const i = () => props.insights;
  const top = () => i().countries.slice(0, 4);
  const most = () => Math.max(1, ...top().map((c) => c.count));
  return (
    <div class="ed-viewers">
      <div class="ed-viewers__stats">
        <div>
          <b>{i().views}</b>
          <span>{i().views === 1 ? "view" : "views"}</span>
        </div>
        <div>
          <b>{duration(i().averageSeconds)}</b>
          <span>avg. watch</span>
        </div>
        <div>
          <b>{Math.round(i().completion * 100)}%</b>
          <span>finished</span>
        </div>
        <div>
          <b>{i().embeddedViews}</b>
          <span>from embeds</span>
        </div>
      </div>
      <Show when={i().views > 0}>
        <div class="ed-viewers__block">
          <span class="ed-viewers__label">Still watching, through the video</span>
          <RetentionChart retention={i().retention} seconds={props.seconds} />
        </div>
        <Show when={top().length}>
          <div class="ed-viewers__block">
            <span class="ed-viewers__label">Where they watched from</span>
            <For each={top()}>
              {(c) => (
                <div class="ed-viewers__country">
                  <span class="ed-viewers__flag">{flag(c.country)}</span>
                  <span class="ed-viewers__name">{countryName(c.country)}</span>
                  <span class="ed-viewers__bar">
                    <i style={{ width: `${(c.count / most()) * 100}%` }} />
                  </span>
                  <b>{c.count}</b>
                </div>
              )}
            </For>
          </div>
        </Show>
      </Show>
    </div>
  );
}
