import { type AppEnv, baseUrl } from "./env";
import { resolveAccess, unlockCookie } from "./access";
import { verifyPassword } from "./crypto";
import type { VideoRow } from "./videos";

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function formatDuration(ms: number | null): string {
  if (!ms) return "";
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

const formatDate = (ms: number) =>
  new Date(ms).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });

interface PageOptions {
  status: number;
  title: string;
  description: string;
  canonical: string;
  body: string;
  nonce: string;
  og?: { image?: string; video?: { url: string; width: number | null; height: number | null } };
  headers?: Record<string, string>;
}

function page(o: PageOptions): Response {
  const meta = [
    `<meta property="og:site_name" content="Umi">`,
    `<meta property="og:title" content="${esc(o.title)}">`,
    `<meta property="og:description" content="${esc(o.description)}">`,
    `<meta property="og:url" content="${esc(o.canonical)}">`,
    `<meta property="og:type" content="${o.og?.video ? "video.other" : "website"}">`,
    `<meta name="twitter:title" content="${esc(o.title)}">`,
    `<meta name="twitter:description" content="${esc(o.description)}">`,
    `<meta name="twitter:card" content="${o.og?.image ? "summary_large_image" : "summary"}">`,
  ];
  if (o.og?.image) {
    meta.push(
      `<meta property="og:image" content="${esc(o.og.image)}">`,
      `<meta property="og:image:alt" content="${esc(o.title)}">`,
      `<meta name="twitter:image" content="${esc(o.og.image)}">`,
    );
  }
  if (o.og?.video) {
    const v = o.og.video;
    meta.push(
      `<meta property="og:video" content="${esc(v.url)}">`,
      `<meta property="og:video:secure_url" content="${esc(v.url)}">`,
      `<meta property="og:video:type" content="video/mp4">`,
    );
    if (v.width && v.height) {
      meta.push(`<meta property="og:video:width" content="${v.width}">`, `<meta property="og:video:height" content="${v.height}">`);
    }
  }

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(o.title)} · Umi</title>
<meta name="description" content="${esc(o.description)}">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#f6f6f4" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#111113" media="(prefers-color-scheme: dark)">
<link rel="canonical" href="${esc(o.canonical)}">
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(ICON)}">
${meta.join("\n")}
<style nonce="${o.nonce}">${CSS}</style>
</head>
<body>
<header class="top"><a class="brand" href="https://umi.cam" rel="noopener">${LOGO}<span>Umi</span></a></header>
<main>${o.body}</main>
<footer class="foot">Recorded with <a href="https://umi.cam" rel="noopener">Umi</a> — the free screen recorder for Mac</footer>
</body>
</html>`;
  return new Response(html, {
    status: o.status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": "strict-origin-when-cross-origin",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "content-security-policy": `default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'nonce-${o.nonce}'; script-src 'nonce-${o.nonce}'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
      ...o.headers,
    },
  });
}

function messageCard(icon: string, heading: string, text: string): string {
  return `<section class="card message"><div class="icon">${icon}</div><h1>${esc(heading)}</h1><p>${esc(text)}</p></section>`;
}

function passwordCard(id: string, t: string | null, error: boolean): string {
  return `<section class="card message">
  <div class="icon">${LOCK}</div>
  <h1>This video is password-protected</h1>
  <p>Enter the password the sender shared with you.</p>
  <form method="post" action="/v/${id}/unlock" class="unlock">
    ${t ? `<input type="hidden" name="t" value="${esc(t)}">` : ""}
    <input type="password" name="password" placeholder="Password" autocomplete="current-password" required autofocus
      aria-label="Password"${error ? ' aria-invalid="true" aria-describedby="pw-err"' : ""}>
    <button type="submit">Watch</button>
  </form>
  ${error ? `<p id="pw-err" class="error" role="alert">Wrong password. Try again.</p>` : ""}
</section>`;
}

function playerBody(video: VideoRow, nonce: string): string {
  const ratio = video.width && video.height ? `${video.width} / ${video.height}` : "16 / 9";
  const poster = video.has_thumbnail ? ` poster="/v/${video.id}/thumbnail.jpg"` : "";
  const meta = [formatDate(video.created_at), formatDuration(video.duration_ms)].filter(Boolean).join(" · ");
  const expiry = video.expires_at
    ? `<span class="pill" title="${new Date(video.expires_at).toISOString()}">Link expires ${formatDate(video.expires_at)}</span>`
    : "";
  const speeds = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]
    .map((s) => `<option value="${s}"${s === 1 ? " selected" : ""}>${s}×</option>`)
    .join("");
  return `<style nonce="${nonce}">.stage{--ratio:${ratio}}</style>
<div class="stage" id="stage">
  <video id="video" src="/v/${video.id}/video.mp4" controls playsinline preload="metadata"${poster}></video>
</div>
<section class="info">
  <div class="titles">
    <h1>${esc(video.title)}</h1>
    <p class="meta">${esc(meta)} ${expiry}</p>
  </div>
  <div class="actions">
    <label class="speed" title="Playback speed (&lt; / &gt;)"><span class="sr">Playback speed</span>
      <select id="speed">${speeds}</select>
    </label>
    <button type="button" id="copy" title="Copy link at current time">${LINK}<span>Copy link</span></button>
    <button type="button" id="fs" title="Fullscreen (F)">${EXPAND}<span class="sr">Fullscreen</span></button>
    ${video.allow_download ? `<a class="button" href="/v/${video.id}/video.mp4?download=1" download>${DOWNLOAD}<span>Download</span></a>` : ""}
  </div>
</section>
<div class="toast" id="toast" role="status" aria-live="polite"></div>`;
}

export async function handleViewer(request: Request, env: AppEnv, id: string, wrongPassword = false): Promise<Response> {
  const url = new URL(request.url);
  const canonical = `${baseUrl(env, request)}/v/${id}`;
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const access = await resolveAccess(request, env, id);
  const base = { canonical, nonce };

  switch (access.state) {
    case "not_found":
      return page({ ...base, status: 404, title: "Video not found", description: "This link doesn't exist.",
        body: messageCard(MISSING, "Video not found", "Check the link and try again.") });
    case "gone":
      return page({ ...base, status: 410, title: "Video removed", description: "This video is no longer available.",
        body: messageCard(MISSING, "This video was removed", "The owner deleted this video or revoked the link.") });
    case "expired":
      return page({ ...base, status: 410, title: "Link expired", description: "This video link has expired.",
        body: messageCard(CLOCK, "This link has expired", "Ask the sender for a new link.") });
    case "processing":
      return page({ ...base, status: 202, title: "Video uploading", description: "This video is still uploading.",
        headers: { refresh: "10" },
        body: messageCard(CLOCK, "Still uploading…", "This page refreshes automatically when the video is ready.") });
    case "locked":
      return page({ ...base, status: wrongPassword ? 401 : 200, title: "Password-protected video",
        description: "Enter the password to watch this video on Umi.",
        body: passwordCard(id, url.searchParams.get("t"), wrongPassword) });
    case "ok": {
      const v = access.video;
      const isPublic = v.password_hash === null;
      return page({
        ...base,
        status: 200,
        title: v.title,
        description: [formatDuration(v.duration_ms), "Watch on Umi"].filter(Boolean).join(" · "),
        og: isPublic
          ? {
              image: v.has_thumbnail ? `${canonical}/thumbnail.jpg` : undefined,
              video: { url: `${canonical}/video.mp4`, width: v.width, height: v.height },
            }
          : undefined,
        body: `${playerBody(v, nonce)}<script nonce="${nonce}">${SCRIPT}</script>`,
      });
    }
  }
}

/** POST /v/:id/unlock */
export async function handleUnlock(request: Request, env: AppEnv, id: string): Promise<Response> {
  const access = await resolveAccess(request, env, id);
  if (access.state !== "locked") return Response.redirect(new URL(`/v/${id}`, request.url).toString(), 303);
  const form = await request.formData().catch(() => null);
  const password = form?.get("password");
  const t = form?.get("t");
  const target = new URL(`/v/${id}`, request.url);
  if (typeof t === "string" && t) target.searchParams.set("t", t);

  if (typeof password === "string" && (await verifyPassword(password, access.video.password_hash!))) {
    return new Response(null, {
      status: 303,
      headers: { location: target.pathname + target.search, "set-cookie": await unlockCookie(request, env, access.video) },
    });
  }
  // TODO(abuse): rate-limit attempts per video/IP (e.g. Workers Rate Limiting binding).
  return handleViewer(new Request(target, { headers: request.headers }), env, id, true);
}

// ---------------------------------------------------------------- assets

const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="9" fill="#ff5a36"/><circle cx="16" cy="16" r="6" fill="#fff"/></svg>`;
const LOGO = `<svg viewBox="0 0 32 32" width="22" height="22" aria-hidden="true"><rect width="32" height="32" rx="9" fill="var(--accent)"/><circle cx="16" cy="16" r="6" fill="#fff"/></svg>`;
const svg = (d: string) =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const LINK = svg(`<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>`);
const EXPAND = svg(`<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>`);
const DOWNLOAD = svg(`<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>`);
const LOCK = svg(`<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>`);
const CLOCK = svg(`<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>`);
const MISSING = svg(`<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>`);

const CSS = `
:root{--bg:#f6f6f4;--surface:#fff;--text:#18181b;--muted:#6b6b72;--border:#e4e4e0;--accent:#ff5a36;--accent-text:#fff;--stage:#000;--radius:14px;
  color-scheme:light;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Inter","Segoe UI",Roboto,sans-serif}
@media (prefers-color-scheme:dark){:root{--bg:#111113;--surface:#1b1b1e;--text:#f2f2f3;--muted:#9a9aa2;--border:#2c2c31;--accent:#ff6a48;color-scheme:dark}}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--text);-webkit-font-smoothing:antialiased}
body{min-height:100dvh;display:flex;flex-direction:column}
a{color:inherit}
.top{padding:14px max(16px,env(safe-area-inset-left));display:flex;align-items:center}
.brand{display:inline-flex;align-items:center;gap:8px;text-decoration:none;font-weight:650;letter-spacing:-.01em}
main{flex:1;width:100%;max-width:1120px;margin:0 auto;padding:0 16px}
.stage{background:var(--stage);border-radius:var(--radius);overflow:hidden;aspect-ratio:var(--ratio);max-height:calc(100dvh - 210px);margin:0 auto;
  width:min(100%, calc((100dvh - 210px) * (var(--ratio))));box-shadow:0 1px 2px rgba(0,0,0,.06),0 12px 40px rgba(0,0,0,.12)}
.stage:fullscreen{border-radius:0;max-height:none;width:100%;height:100%;aspect-ratio:auto}
video{display:block;width:100%;height:100%;background:#000;object-fit:contain}
.info{display:flex;flex-wrap:wrap;gap:12px 24px;align-items:flex-start;justify-content:space-between;padding:18px 2px 8px}
.titles{min-width:0;flex:1 1 320px}
h1{font-size:clamp(18px,2.4vw,22px);line-height:1.25;margin:0 0 4px;font-weight:650;letter-spacing:-.015em;overflow-wrap:anywhere}
.meta{margin:0;color:var(--muted);font-size:14px;display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.pill{border:1px solid var(--border);border-radius:999px;padding:1px 8px;font-size:12px}
.actions{display:flex;gap:8px;flex-wrap:wrap}
button,.button,select{font:inherit;font-size:14px;color:var(--text);background:var(--surface);border:1px solid var(--border);border-radius:10px;
  height:38px;padding:0 12px;display:inline-flex;align-items:center;gap:6px;cursor:pointer;white-space:nowrap;text-decoration:none;transition:background .15s,border-color .15s}
button:hover,.button:hover,select:hover{border-color:var(--muted)}
button:focus-visible,.button:focus-visible,select:focus-visible,input:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
select{appearance:none;-webkit-appearance:none;padding-right:12px;font-variant-numeric:tabular-nums}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius)}
.message{max-width:420px;margin:12vh auto 0;padding:32px 28px;text-align:center}
.message .icon{width:44px;height:44px;border-radius:12px;display:grid;place-items:center;margin:0 auto 14px;background:var(--bg);color:var(--muted)}
.message .icon svg{width:22px;height:22px}
.message p{color:var(--muted);margin:6px 0 0;line-height:1.5}
.unlock{display:flex;gap:8px;margin-top:20px}
.unlock input{flex:1;min-width:0;font:inherit;font-size:16px;height:42px;padding:0 12px;border-radius:10px;border:1px solid var(--border);background:var(--bg);color:var(--text)}
.unlock input[aria-invalid=true]{border-color:#e5484d}
.unlock button{height:42px;background:var(--accent);border-color:var(--accent);color:var(--accent-text);font-weight:600}
.error{color:#e5484d !important;font-size:14px}
.toast{position:fixed;left:50%;bottom:24px;transform:translate(-50%,20px);background:var(--text);color:var(--bg);padding:8px 14px;border-radius:10px;
  font-size:14px;opacity:0;pointer-events:none;transition:opacity .2s,transform .2s}
.toast.show{opacity:1;transform:translate(-50%,0)}
.foot{text-align:center;color:var(--muted);font-size:13px;padding:28px 16px calc(20px + env(safe-area-inset-bottom))}
@media (max-width:640px){main{padding:0}.stage{border-radius:0;max-height:none;width:100%;box-shadow:none}.info{padding:14px 16px 4px}
  .actions{width:100%}.actions>*{flex:1;justify-content:center}.message{margin:8vh 16px 0}}
@media (prefers-reduced-motion:reduce){*{transition:none !important}}
`;

const SCRIPT = `(() => {
  const v = document.getElementById("video"), stage = document.getElementById("stage");
  const speed = document.getElementById("speed"), toast = document.getElementById("toast");
  const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } },
                  set(k, x) { try { localStorage.setItem(k, x); } catch {} } };

  // ?t=90 | 1:30 | 1m30s | 1h2m3s
  function parseT(s) {
    if (!s) return 0;
    if (/^\\d+(\\.\\d+)?$/.test(s)) return parseFloat(s);
    if (/^[\\d:]+$/.test(s)) return s.split(":").reduce((a, n) => a * 60 + (+n || 0), 0);
    const m = /^(?:(\\d+)h)?(?:(\\d+)m)?(?:(\\d+)s)?$/.exec(s);
    return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0;
  }
  const start = parseT(new URLSearchParams(location.search).get("t"));
  if (start > 0) v.addEventListener("loadedmetadata", () => { v.currentTime = Math.min(start, v.duration || start); }, { once: true });

  const rates = [...speed.options].map(o => +o.value);
  function setRate(r) { v.playbackRate = v.defaultPlaybackRate = r; speed.value = String(r); store.set("umi.rate", String(r)); }
  const saved = parseFloat(store.get("umi.rate") || "");
  if (rates.includes(saved)) setRate(saved);
  speed.addEventListener("change", () => setRate(+speed.value));
  v.addEventListener("ratechange", () => { if (rates.includes(v.playbackRate)) speed.value = String(v.playbackRate); });

  function fullscreen() {
    if (document.fullscreenElement) return document.exitFullscreen();
    if (stage.requestFullscreen) return stage.requestFullscreen().catch(() => v.webkitEnterFullscreen && v.webkitEnterFullscreen());
    if (v.webkitEnterFullscreen) v.webkitEnterFullscreen(); // iOS Safari
  }
  document.getElementById("fs").addEventListener("click", fullscreen);

  let toastTimer;
  function show(msg) { toast.textContent = msg; toast.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove("show"), 1800); }
  document.getElementById("copy").addEventListener("click", async () => {
    const u = new URL(location.href); u.search = "";
    const t = Math.floor(v.currentTime);
    if (t > 0) u.searchParams.set("t", String(t));
    try { await navigator.clipboard.writeText(u.toString()); show(t > 0 ? "Link copied at " + Math.floor(t / 60) + ":" + String(t % 60).padStart(2, "0") : "Link copied"); }
    catch { prompt("Copy this link", u.toString()); }
  });

  document.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(e.target.tagName)) return;
    const i = rates.indexOf(v.playbackRate);
    if (e.key === "f") { fullscreen(); e.preventDefault(); }
    else if (e.key === "k" || (e.key === " " && e.target !== v)) { v.paused ? v.play() : v.pause(); e.preventDefault(); }
    else if (e.key === ">" ) setRate(rates[Math.min(rates.length - 1, (i < 0 ? 2 : i) + 1)]);
    else if (e.key === "<") setRate(rates[Math.max(0, (i < 0 ? 2 : i) - 1)]);
    else if (e.key === "ArrowRight" && e.target !== v) v.currentTime += 5;
    else if (e.key === "ArrowLeft" && e.target !== v) v.currentTime -= 5;
  });
})();`;
