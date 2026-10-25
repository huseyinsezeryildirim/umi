import type { AppEnv } from "./env";
import { videoKey } from "./env";
import { hmacSign, hmacVerify } from "./crypto";
import { HttpError } from "./http";
import { clientIp, throttle } from "./limits";
import { esc, LOGO } from "./page";
import { purgeVideoFiles } from "./api";
import { deleteSocialData } from "./social";
import { getVideo } from "./videos";

/**
 * The moderation panel at /adagiris: reported videos wait here for a decision (hide, show again,
 * delete, or dismiss the reports). One moderator, signed in with ADMIN_EMAIL and the
 * ADMIN_PASSWORD secret; the session is a signed cookie scoped to /adagiris.
 */

const BASE = "/adagiris";
const COOKIE = "umi_admin";
const SESSION_MS = 12 * 60 * 60 * 1000;

const REASON_NAMES: Record<string, string> = {
  spam: "Spam or misleading",
  abuse: "Harassment or hateful",
  copyright: "Copyright",
  illegal: "Illegal content",
  other: "Something else",
};

export async function handleAdmin(request: Request, env: AppEnv, path: string): Promise<Response> {
  const method = request.method;
  if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) {
    return new Response("The moderation panel isn't set up (ADMIN_EMAIL, ADMIN_PASSWORD).", { status: 503 });
  }
  if (method === "POST" && !sameOrigin(request)) throw new HttpError(403, "forbidden", "Cross-site request refused.");

  if (path === `${BASE}/login` && method === "POST") return login(request, env);
  if (path === `${BASE}/logout` && method === "POST") return redirect(BASE, clearCookie());

  const signedIn = await session(request, env);
  if (!signedIn) {
    if (method === "GET" && (path === BASE || path === `${BASE}/`)) return loginPage(false);
    return redirect(BASE);
  }

  if (method === "GET" && (path === BASE || path === `${BASE}/`)) {
    const show = new URL(request.url).searchParams.get("show") === "all" ? "all" : "open";
    return panel(env, show);
  }
  let m: RegExpExecArray | null;
  if ((m = /^\/adagiris\/videos\/([0-9A-Za-z]+)\/video\.mp4$/.exec(path)) && method === "GET") return preview(request, env, m[1]!);
  if ((m = /^\/adagiris\/videos\/([0-9A-Za-z]+)\/(hide|unhide|delete|dismiss)$/.exec(path)) && method === "POST") {
    await decide(env, m[1]!, m[2] as Action, signedIn);
    return redirect(BASE);
  }
  return new Response("Not found", { status: 404 });
}

// ───── Sign-in ─────

function sameOrigin(request: Request): boolean {
  if (request.headers.get("sec-fetch-site") === "same-origin") return true;
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

/** Constant-time string comparison (through HMAC, so lengths don't leak either). */
async function equal(env: AppEnv, a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([hmacSign(env.SIGNING_SECRET, `cmp:${a}`), hmacSign(env.SIGNING_SECRET, `cmp:${b}`)]);
  return x === y;
}

async function login(request: Request, env: AppEnv): Promise<Response> {
  await throttle(env, `admin:${clientIp(request)}`, String(env.DEV_TOOLS ?? "") === "1" ? 100 : 5, 15 * 60 * 1000);
  const form = await request.formData().catch(() => null);
  const email = String(form?.get("email") ?? "").trim().toLowerCase();
  const password = String(form?.get("password") ?? "");
  const ok = (await equal(env, email, env.ADMIN_EMAIL!.trim().toLowerCase())) && (await equal(env, password, env.ADMIN_PASSWORD!));
  if (!ok) return loginPage(true);
  const exp = Date.now() + SESSION_MS;
  const sig = await hmacSign(env.SIGNING_SECRET, `admin:${email}:${exp}`);
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return redirect(BASE, `${COOKIE}=${exp}.${sig}; Path=${BASE}; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MS / 1000}${secure}`);
}

/** The signed-in moderator's email, or null. */
async function session(request: Request, env: AppEnv): Promise<string | null> {
  const raw = (request.headers.get("cookie") ?? "")
    .split(/;\s*/)
    .find((c) => c.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  const [expStr, sig] = (raw ?? "").split(".");
  const exp = Number(expStr);
  if (!exp || exp < Date.now() || !sig) return null;
  const email = env.ADMIN_EMAIL!.trim().toLowerCase();
  return (await hmacVerify(env.SIGNING_SECRET, `admin:${email}:${exp}`, sig)) ? email : null;
}

const clearCookie = () => `${COOKIE}=; Path=${BASE}; HttpOnly; SameSite=Strict; Max-Age=0`;

function redirect(to: string, cookie?: string): Response {
  const headers = new Headers({ location: to, "cache-control": "no-store" });
  if (cookie) headers.set("set-cookie", cookie);
  return new Response(null, { status: 303, headers });
}

// ───── Decisions ─────

type Action = "hide" | "unhide" | "delete" | "dismiss";

async function decide(env: AppEnv, id: string, action: Action, by: string): Promise<void> {
  const video = await getVideo(env, id);
  if (!video) throw new HttpError(404, "not_found", "Video not found.");
  const now = Date.now();
  if (action === "hide") {
    await env.DB.prepare("UPDATE videos SET flagged_at = ?, updated_at = ? WHERE id = ?").bind(now, now, id).run();
  } else if (action === "unhide") {
    await env.DB.prepare("UPDATE videos SET flagged_at = NULL, updated_at = ? WHERE id = ?").bind(now, id).run();
  } else if (action === "delete" && video.status !== "deleted") {
    await purgeVideoFiles(env, video);
    await env.DB.prepare(
      "UPDATE videos SET status = 'deleted', upload_id = NULL, password_hash = NULL, deleted_at = ?, updated_at = ? WHERE id = ?",
    )
      .bind(now, now, id)
      .run();
    await deleteSocialData(env, id);
  }
  // Any decision closes the open reports (hiding keeps them visible under "All").
  await env.DB.prepare("UPDATE reports SET resolved_at = ? WHERE video_id = ? AND resolved_at IS NULL").bind(now, id).run();
  await env.DB.prepare("INSERT INTO moderation_log (video_id, action, by_email, created_at) VALUES (?, ?, ?, ?)").bind(id, action, by, now).run();
}

/** The reported video itself, whatever its link settings (password, expiry, hidden). */
async function preview(request: Request, env: AppEnv, id: string): Promise<Response> {
  const video = await getVideo(env, id);
  if (!video || video.status !== "ready") return new Response("missing", { status: 404 });
  const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.get("range") ?? "");
  const object = await env.VIDEOS.get(
    videoKey(id),
    range ? { range: { offset: Number(range[1]), ...(range[2] ? { length: Number(range[2]) - Number(range[1]) + 1 } : {}) } } : {},
  );
  if (!object) return new Response("missing", { status: 404 });
  const headers = new Headers({ "content-type": video.content_type, "accept-ranges": "bytes", "cache-control": "private, no-store" });
  if (range && object.range) {
    const r = object.range as { offset?: number; length?: number };
    const start = r.offset ?? 0;
    const length = r.length ?? object.size - start;
    headers.set("content-range", `bytes ${start}-${start + length - 1}/${object.size}`);
    headers.set("content-length", String(length));
    return new Response(object.body, { status: 206, headers });
  }
  headers.set("content-length", String(object.size));
  return new Response(object.body, { status: 200, headers });
}

// ───── Pages ─────

interface Row {
  id: string;
  title: string;
  status: string;
  flagged_at: number | null;
  created_at: number;
  duration_ms: number | null;
  email: string | null;
  open: number;
  total: number;
  last_at: number;
}

async function panel(env: AppEnv, show: "open" | "all"): Promise<Response> {
  const { results: videos } = await env.DB.prepare(
    `SELECT v.id, v.title, v.status, v.flagged_at, v.created_at, v.duration_ms, a.email,
            SUM(CASE WHEN r.resolved_at IS NULL THEN 1 ELSE 0 END) AS open, COUNT(r.id) AS total, MAX(r.created_at) AS last_at
     FROM reports r JOIN videos v ON v.id = r.video_id LEFT JOIN accounts a ON a.id = v.account_id
     ${show === "open" ? "WHERE v.status != 'deleted'" : ""}
     GROUP BY v.id
     ${show === "open" ? "HAVING open > 0" : ""}
     ORDER BY open DESC, last_at DESC
     LIMIT 200`,
  ).all<Row>();
  const ids = videos.map((v) => v.id);
  const { results: reports } = ids.length
    ? await env.DB.prepare(
        `SELECT video_id, reason, details, created_at, resolved_at FROM reports WHERE video_id IN (${ids.map(() => "?").join(",")}) ORDER BY created_at DESC`,
      )
        .bind(...ids)
        .all<{ video_id: string; reason: string; details: string | null; created_at: number; resolved_at: number | null }>()
    : { results: [] };

  const when = (ms: number) => new Date(ms).toISOString().replace("T", " ").slice(0, 16) + " UTC";
  const cards = videos
    .map((v) => {
      const mine = reports.filter((r) => r.video_id === v.id);
      const state = v.status === "deleted" ? "Deleted" : v.flagged_at ? "Hidden" : "Visible";
      const button = (action: Action, label: string, kind = "") =>
        `<form method="post" action="${BASE}/videos/${v.id}/${action}"${action === "delete" ? ` data-confirm="Delete this video for good?"` : ""}><button class="${kind}">${label}</button></form>`;
      const actions =
        v.status === "deleted"
          ? ""
          : [
              v.flagged_at ? button("unhide", "Show again") : button("hide", "Hide"),
              button("delete", "Delete", "danger"),
              v.open > 0 ? button("dismiss", "Dismiss reports", "ghost") : "",
            ].join("");
      return `<article class="card">
  <div class="media">${v.status === "ready" ? `<video src="${BASE}/videos/${v.id}/video.mp4" controls preload="metadata"></video>` : `<div class="gone">${state}</div>`}</div>
  <div class="body">
    <div class="head"><h2>${esc(v.title)}</h2><span class="state ${state.toLowerCase()}">${state}</span></div>
    <p class="meta">${esc(v.email ?? "unknown owner")} · uploaded ${when(v.created_at)} · <a href="/v/${v.id}" target="_blank" rel="noopener">/v/${v.id}</a></p>
    <p class="count"><b>${v.open}</b> open report${v.open === 1 ? "" : "s"}${v.total > v.open ? ` · ${v.total - v.open} closed` : ""}</p>
    <ul>${mine
      .map((r) => `<li class="${r.resolved_at ? "closed" : ""}"><b>${esc(REASON_NAMES[r.reason] ?? r.reason)}</b>${r.details ? ` — ${esc(r.details)}` : ""}<span>${when(r.created_at)}</span></li>`)
      .join("")}</ul>
    <div class="actions">${actions}</div>
  </div>
</article>`;
    })
    .join("");

  const body = `<header><div class="brand">${LOGO}<b>Umi moderation</b></div>
<nav><a class="${show === "open" ? "on" : ""}" href="${BASE}">Waiting (${show === "open" ? videos.length : "…"})</a><a class="${show === "all" ? "on" : ""}" href="${BASE}?show=all">All reported</a></nav>
<form method="post" action="${BASE}/logout"><button class="ghost">Sign out</button></form></header>
<main>${cards || `<p class="empty">${show === "open" ? "Nothing waiting. Reports from viewers show up here." : "No reports yet."}</p>`}</main>`;
  return adminPage("Moderation", body);
}

function loginPage(wrong: boolean): Response {
  return adminPage(
    "Sign in",
    `<main class="login"><div class="card">${LOGO}<h1>Umi moderation</h1>
<form method="post" action="${BASE}/login">
<input name="email" type="email" placeholder="Email" autocomplete="username" required autofocus>
<input name="password" type="password" placeholder="Password" autocomplete="current-password" required>
${wrong ? `<p class="error">Wrong email or password.</p>` : ""}
<button>Sign in</button></form></div></main>`,
    wrong ? 401 : 200,
  );
}

function adminPage(title: string, body: string, status = 200): Response {
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${title} · Umi</title>
<style nonce="${nonce}">${CSS}</style></head><body>${body}
<script nonce="${nonce}">document.querySelectorAll("form[data-confirm]").forEach(f => f.addEventListener("submit", e => { if (!confirm(f.dataset.confirm)) e.preventDefault(); }));</script>
</body></html>`;
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-frame-options": "DENY",
      // Not "no-referrer": that makes browsers send `Origin: null` on our own forms.
      "referrer-policy": "same-origin",
      "content-security-policy": `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; media-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`,
    },
  });
}

const CSS = `:root{--bg:#F1F7FC;--card:#fff;--text:#0E111E;--muted:#5A6378;--border:rgba(14,17,30,.10);--accent:#116FF5;--danger:#E5484D;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--bg:#0E111E;--card:#161A2A;--text:#EEF3FA;--muted:#98A1B5;--border:rgba(255,255,255,.10);--accent:#2F80FF}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif}
header{position:sticky;top:0;z-index:1;display:flex;align-items:center;gap:16px;padding:12px 20px;background:var(--bg);border-bottom:1px solid var(--border)}
.brand{display:flex;align-items:center;gap:8px}nav{display:flex;gap:4px;flex:1}
nav a{padding:6px 12px;border-radius:999px;color:var(--muted);text-decoration:none}nav a.on{background:var(--card);color:var(--text);box-shadow:0 0 0 1px var(--border)}
main{max-width:1000px;margin:0 auto;padding:20px 16px 60px;display:grid;gap:16px}
.card{display:grid;grid-template-columns:320px 1fr;gap:18px;padding:16px;background:var(--card);border:1px solid var(--border);border-radius:16px}
.media video,.gone{width:100%;aspect-ratio:16/9;border-radius:10px;background:#000}.gone{display:grid;place-items:center;color:#fff}
.head{display:flex;align-items:center;gap:10px}h2{margin:0;font-size:17px;flex:1;overflow-wrap:anywhere}
.state{font-size:12px;padding:2px 8px;border-radius:999px;background:rgba(17,111,245,.12);color:var(--accent)}.state.hidden{background:rgba(229,72,77,.12);color:var(--danger)}.state.deleted{color:var(--muted);background:var(--border)}
.meta{margin:4px 0;color:var(--muted);font-size:13px}.meta a{color:var(--accent)}.count{margin:8px 0 4px}
ul{margin:0;padding:0;list-style:none;display:grid;gap:6px}li{font-size:14px;padding:8px 10px;border-radius:10px;background:var(--bg)}li span{display:block;font-size:12px;color:var(--muted)}li.closed{opacity:.55}
.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}.actions form{margin:0}
button{font:inherit;padding:8px 14px;border-radius:10px;border:1px solid var(--border);background:var(--card);color:var(--text);cursor:pointer}
button:hover{border-color:var(--accent)}button.danger{color:var(--danger)}button.danger:hover{border-color:var(--danger)}button.ghost{background:transparent}
.empty{text-align:center;color:var(--muted);padding:60px 0}
.login{min-height:100vh;display:grid;place-items:center}.login .card{display:block;width:min(360px,100%);text-align:center}
.login h1{font-size:20px;margin:10px 0 18px}.login form{display:grid;gap:10px}
.login input{font:inherit;font-size:16px;padding:10px 12px;border-radius:10px;border:1px solid var(--border);background:var(--bg);color:var(--text)}
.login button{background:var(--accent);color:#fff;border:0;padding:10px}.error{margin:0;color:var(--danger);font-size:14px}
@media (max-width:720px){.card{grid-template-columns:1fr}header{flex-wrap:wrap}}`;
