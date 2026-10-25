/** Shared HTML shell, helpers and assets for the viewer (/v/:id) and embed (/e/:id) pages. */

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** JSON for a `<script type="application/json">` block: `<` can't close the tag, so no HTML injection. */
export const safeJson = (value: unknown) =>
  JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

export function formatDuration(ms: number | null): string {
  if (!ms) return "";
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

export const formatDate = (ms: number) =>
  new Date(ms).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });

export const newNonce = () => crypto.randomUUID().replace(/-/g, "");

export interface PageOptions {
  status: number;
  title: string;
  description: string;
  canonical: string;
  body: string;
  nonce: string;
  og?: { image?: string; video?: { url: string; width: number | null; height: number | null; type?: string } };
  /** oEmbed discovery URL (public videos only). */
  oembed?: string;
  /** "embed" = chrome-less, frameable by any site. "page" (default) = full page, never framed. */
  variant?: "page" | "embed";
  headers?: Record<string, string>;
}

export function page(o: PageOptions): Response {
  const embed = o.variant === "embed";
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
      `<meta property="og:video:type" content="${esc(v.type ?? "video/mp4")}">`,
    );
    if (v.width && v.height) {
      meta.push(`<meta property="og:video:width" content="${v.width}">`, `<meta property="og:video:height" content="${v.height}">`);
    }
  }
  if (o.oembed) {
    meta.push(`<link rel="alternate" type="application/json+oembed" href="${esc(o.oembed)}" title="${esc(o.title)}">`);
  }

  const chrome = embed
    ? `<main class="embed">${o.body}</main>`
    : `<header class="top"><a class="brand" href="https://umi.cam" rel="noopener">${LOGO}<span>Umi</span></a></header>
<main>${o.body}</main>
<footer class="foot">Recorded with <a href="https://umi.cam" rel="noopener">Umi</a> — the free screen recorder for Mac</footer>`;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(o.title)} · Umi</title>
<meta name="description" content="${esc(o.description)}">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="${embed ? "dark" : "light dark"}">
<meta name="theme-color" content="#F1F7FC" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0E111E" media="(prefers-color-scheme: dark)">
<link rel="canonical" href="${esc(o.canonical)}">
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(ICON)}">
${meta.join("\n")}
<style nonce="${o.nonce}">${embed ? EMBED_CSS : CSS}</style>
</head>
<body${embed ? ' class="embed"' : ""}>
${chrome}
</body>
</html>`;

  const csp = [
    "default-src 'none'",
    "img-src 'self' data:",
    "media-src 'self'",
    "connect-src 'self'",
    `style-src 'nonce-${o.nonce}'`,
    `script-src 'nonce-${o.nonce}'`,
    "form-action 'self'",
    "base-uri 'none'",
    // The viewer page is never framed; the embed exists to be framed by any site.
    embed ? "frame-ancestors *" : "frame-ancestors 'none'",
  ].join("; ");
  const headers: Record<string, string> = {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-content-type-options": "nosniff",
    "content-security-policy": csp,
  };
  if (!embed) headers["x-frame-options"] = "DENY";
  return new Response(html, { status: o.status, headers: { ...headers, ...o.headers } });
}

export function messageCard(icon: string, heading: string, text: string): string {
  return `<section class="card message"><div class="icon">${icon}</div><h1>${esc(heading)}</h1><p>${esc(text)}</p></section>`;
}

export function passwordCard(id: string, t: string | null, error: boolean, embed = false): string {
  return `<section class="card message">
  <div class="icon">${LOCK}</div>
  <h1>This video is password-protected</h1>
  <p>Enter the password the sender shared with you.</p>
  <form method="post" action="/v/${id}/unlock" class="unlock">
    ${t ? `<input type="hidden" name="t" value="${esc(t)}">` : ""}
    ${embed ? `<input type="hidden" name="embed" value="1">` : ""}
    <input type="password" name="password" placeholder="Password" autocomplete="current-password" required${embed ? "" : " autofocus"}
      aria-label="Password"${error ? ' aria-invalid="true" aria-describedby="pw-err"' : ""}>
    <button type="submit">Watch</button>
  </form>
  ${error ? `<p id="pw-err" class="error" role="alert">Wrong password. Try again.</p>` : ""}
</section>`;
}

/** Client-side `?t=` parser shared by both pages: 90 | 1:30 | 1m30s | 1h2m3s. */
export const PARSE_T_JS = `function parseT(s) {
    if (!s) return 0;
    if (/^\\d+(\\.\\d+)?$/.test(s)) return parseFloat(s);
    if (/^[\\d:]+$/.test(s)) return s.split(":").reduce((a, n) => a * 60 + (+n || 0), 0);
    const m = /^(?:(\\d+)h)?(?:(\\d+)m)?(?:(\\d+)s)?$/.exec(s);
    return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0;
  }`;

// ---------------------------------------------------------------- assets

const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="9" fill="#116FF5"/><circle cx="16" cy="16" r="6" fill="#fff"/></svg>`;
export const LOGO = `<svg viewBox="0 0 32 32" width="22" height="22" aria-hidden="true"><rect width="32" height="32" rx="9" fill="var(--accent)"/><circle cx="16" cy="16" r="6" fill="#fff"/></svg>`;
const svg = (d: string) =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const LINK = svg(`<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>`);
export const CLOCK_LINK = svg(`<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>`);
export const EXPAND = svg(`<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>`);
export const DOWNLOAD = svg(`<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>`);
export const LOCK = svg(`<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>`);
export const CLOCK = svg(`<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>`);
export const MISSING = svg(`<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>`);
export const CHAT = svg(`<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12z"/>`);

const CSS = `
:root{--bg:#F1F7FC;--bg2:#E1EFFC;--surface:rgba(255,255,255,.72);--surface-solid:#fff;--text:#0E111E;--muted:#5A6378;--border:rgba(14,17,30,.10);
  --accent:#116FF5;--accent-text:#fff;--accent-soft:rgba(17,111,245,.10);--stage:#000;--radius:14px;--danger:#E5484D;
  --shadow:0 1px 2px rgba(14,17,30,.05),0 6px 18px rgba(17,111,245,.07);
  color-scheme:light;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Inter","Segoe UI",Roboto,sans-serif}
@media (prefers-color-scheme:dark){:root{--bg:#0E111E;--bg2:#0A0D17;--surface:rgba(255,255,255,.06);--surface-solid:#161A2A;--text:#EEF3FA;
  --muted:#98A1B5;--border:rgba(255,255,255,.10);--accent:#2F80FF;--accent-soft:rgba(47,128,255,.16);--shadow:0 1px 2px rgba(0,0,0,.3);color-scheme:dark}}
*{box-sizing:border-box}
html{background:var(--bg2)}
html,body{margin:0;color:var(--text);-webkit-font-smoothing:antialiased}
body{min-height:100dvh;display:flex;flex-direction:column;background:linear-gradient(180deg,var(--bg) 0%,var(--bg2) 100%) fixed;overflow-x:hidden}
a{color:inherit}
.top{padding:14px max(16px,env(safe-area-inset-left));display:flex;align-items:center}
.brand{display:inline-flex;align-items:center;gap:8px;text-decoration:none;font-weight:650;letter-spacing:-.01em}
main{flex:1;width:100%;max-width:1120px;margin:0 auto;padding:0 16px}
.stage{position:relative;background:var(--stage);border-radius:var(--radius);overflow:hidden;aspect-ratio:var(--ratio);max-height:calc(100dvh - 250px);margin:0 auto;
  width:min(100%, calc((100dvh - 250px) * (var(--ratio))));box-shadow:0 1px 2px rgba(14,17,30,.08),0 16px 44px rgba(14,17,30,.16)}
.stage:fullscreen{border-radius:0;max-height:none;width:100%;height:100%;aspect-ratio:auto}
video{display:block;width:100%;height:100%;background:#000;object-fit:contain}
.floats{position:absolute;inset:0;pointer-events:none;overflow:hidden}
.fl{position:absolute;bottom:56px;font-size:34px;line-height:1;animation:float 1.7s cubic-bezier(.2,.7,.3,1) forwards;filter:drop-shadow(0 2px 6px rgba(0,0,0,.35))}
@keyframes float{0%{transform:translateY(0) scale(.6);opacity:0}15%{opacity:1;transform:translateY(-20px) scale(1.1)}100%{transform:translateY(-220px) scale(1);opacity:0}}
.timeline{margin:10px auto 0;width:min(100%, calc((100dvh - 250px) * (var(--ratio))));padding:0 2px}
.track{position:relative;height:26px;cursor:pointer;touch-action:manipulation}
.track::before{content:"";position:absolute;left:0;right:0;top:50%;height:4px;margin-top:-2px;border-radius:2px;background:var(--border)}
.played{position:absolute;left:0;top:50%;height:4px;margin-top:-2px;border-radius:2px;background:var(--accent);width:0}
.mk{position:absolute;top:50%;transform:translate(-50%,-50%);font-size:15px;line-height:1;cursor:pointer;user-select:none;transition:transform .12s}
.mk:hover{transform:translate(-50%,-50%) scale(1.35);z-index:2}
.mk.cm{width:16px;height:16px;border-radius:50%;border:2px solid var(--surface-solid);color:#fff;font-size:9px;font-weight:700;display:grid;place-items:center;
  box-shadow:0 1px 3px rgba(0,0,0,.25)}
.info{display:flex;flex-wrap:wrap;gap:12px 24px;align-items:flex-start;justify-content:space-between;padding:12px 2px 8px}
.titles{min-width:0;flex:1 1 320px}
h1{font-size:clamp(18px,2.4vw,22px);line-height:1.25;margin:0 0 4px;font-weight:650;letter-spacing:-.015em;overflow-wrap:anywhere}
h2{font-size:16px;margin:0;font-weight:650;letter-spacing:-.01em;display:flex;align-items:center;gap:8px}
.meta{margin:0;color:var(--muted);font-size:14px;display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.pill{border:1px solid var(--border);border-radius:999px;padding:1px 8px;font-size:12px}
.actions{display:flex;gap:8px;flex-wrap:wrap}
button,.button,select{font:inherit;font-size:14px;color:var(--text);background:var(--surface);border:1px solid var(--border);border-radius:10px;
  height:38px;padding:0 12px;display:inline-flex;align-items:center;gap:6px;cursor:pointer;white-space:nowrap;text-decoration:none;
  -webkit-backdrop-filter:blur(14px) saturate(1.4);backdrop-filter:blur(14px) saturate(1.4);box-shadow:var(--shadow);transition:background .15s,border-color .15s,transform .1s}
button:hover,.button:hover,select:hover{border-color:var(--accent)}
button:active{transform:scale(.97)}
button:focus-visible,.button:focus-visible,select:focus-visible,input:focus-visible,textarea:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
button[disabled]{opacity:.55;cursor:default}
select{appearance:none;-webkit-appearance:none;padding-right:12px;font-variant-numeric:tabular-nums}
.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-text);font-weight:600}
.primary:hover{border-color:var(--accent);filter:brightness(1.06)}
.tnum{font-variant-numeric:tabular-nums}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);-webkit-backdrop-filter:blur(18px) saturate(1.4);backdrop-filter:blur(18px) saturate(1.4);box-shadow:var(--shadow)}
.react{display:flex;flex-wrap:wrap;gap:8px;padding:4px 2px 4px}
.rx{height:36px;padding:0 10px;border-radius:999px;gap:6px}
.rx .e{font-size:18px;line-height:1}
.rx .n{font-size:13px;color:var(--muted);font-variant-numeric:tabular-nums;min-width:1ch}
.rx.mine{border-color:var(--accent);background:var(--accent-soft)}
.comments{margin:16px 0 8px;padding:18px 18px 16px}
.comments.off{color:var(--muted);font-size:14px;display:flex;align-items:center;gap:8px}
.ccount{color:var(--muted);font-weight:500;font-size:14px}
.clist{list-style:none;margin:12px 0 0;padding:0;display:flex;flex-direction:column;gap:14px}
.c{display:flex;gap:10px;min-width:0}
.av{flex:none;width:30px;height:30px;border-radius:50%;display:grid;place-items:center;color:#fff;font-weight:650;font-size:13px}
.cb{min-width:0;flex:1}
.ch{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;font-size:14px}
.ch strong{font-weight:620;overflow-wrap:anywhere}
.ch time{color:var(--muted);font-size:12px}
.cb p{margin:3px 0 0;font-size:14.5px;line-height:1.45;white-space:pre-wrap;overflow-wrap:anywhere}
.chip{height:22px;padding:0 8px;border-radius:999px;font-size:12px;font-weight:600;color:var(--accent);background:var(--accent-soft);border-color:transparent;
  box-shadow:none;-webkit-backdrop-filter:none;backdrop-filter:none;font-variant-numeric:tabular-nums}
.chip[aria-pressed=false]{color:var(--muted);background:transparent;border-color:var(--border);text-decoration:line-through}
.empty{color:var(--muted);font-size:14px;margin:10px 0 0}
.cform{margin-top:16px;display:grid;gap:8px}
.cform input,.cform textarea{font:inherit;font-size:16px;width:100%;padding:9px 12px;border-radius:10px;border:1px solid var(--border);background:var(--surface-solid);color:var(--text)}
.cform input{height:40px;max-width:280px}
.cform textarea{resize:vertical;min-height:64px;line-height:1.4}
.crow{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.crow .grow{flex:1}
.crow .len{color:var(--muted);font-size:12px;font-variant-numeric:tabular-nums}
.message{max-width:420px;margin:12vh auto 0;padding:32px 28px;text-align:center}
.message .icon{width:44px;height:44px;border-radius:12px;display:grid;place-items:center;margin:0 auto 14px;background:var(--accent-soft);color:var(--accent)}
.message .icon svg{width:22px;height:22px}
.message p{color:var(--muted);margin:6px 0 0;line-height:1.5}
.unlock{display:flex;gap:8px;margin-top:20px}
.unlock input{flex:1;min-width:0;font:inherit;font-size:16px;height:42px;padding:0 12px;border-radius:10px;border:1px solid var(--border);background:var(--surface-solid);color:var(--text)}
.unlock input[aria-invalid=true]{border-color:var(--danger)}
.unlock button{height:42px;background:var(--accent);border-color:var(--accent);color:var(--accent-text);font-weight:600}
.error{color:var(--danger) !important;font-size:14px;margin:0}
.toast{position:fixed;left:50%;bottom:24px;transform:translate(-50%,20px);background:var(--text);color:var(--bg);padding:8px 14px;border-radius:10px;
  font-size:14px;opacity:0;pointer-events:none;transition:opacity .2s,transform .2s;max-width:calc(100vw - 32px)}
.toast.show{opacity:1;transform:translate(-50%,0)}
.report{margin:4px 0 0;font-size:13px;color:var(--muted)}
.report summary{cursor:pointer;list-style:none;display:inline}
.report summary::-webkit-details-marker{display:none}
.report summary:hover{color:var(--text)}
.report form{display:grid;gap:8px;max-width:420px;margin-top:10px}
.report select,.report textarea,.report button{font:inherit;font-size:16px;padding:8px 12px;border-radius:10px;border:1px solid var(--border);background:var(--surface-solid);color:var(--text)}
.report button{cursor:pointer;justify-self:start}
.foot{text-align:center;color:var(--muted);font-size:13px;padding:28px 16px calc(20px + env(safe-area-inset-bottom))}
@media (max-width:640px){main{padding:0}.stage{border-radius:0;max-height:none;width:100%;box-shadow:none}
  .timeline{width:auto;padding:0 16px}.info{padding:10px 16px 4px}.react{padding:4px 16px;flex-wrap:nowrap;gap:6px}.react .rx{flex:1 1 0;min-width:0;padding:0 4px;justify-content:center}.comments{margin:14px 16px 8px;padding:16px 14px}
  .report{margin:4px 16px 0}.cform input{max-width:none}.actions{width:100%}.actions>*{flex:1 1 auto;justify-content:center}.message{margin:8vh 16px 0}}
@media (prefers-reduced-motion:reduce){*{transition:none !important}.fl{animation:none;opacity:0}}
`;

const EMBED_CSS = `
:root{--text:#EEF3FA;--muted:#98A1B5;--border:rgba(255,255,255,.14);--accent:#116FF5;--surface:rgba(14,17,30,.72);--danger:#FF6B6F;
  color-scheme:dark;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Inter","Segoe UI",Roboto,sans-serif}
*{box-sizing:border-box}
html,body{margin:0;height:100%;background:#000;color:var(--text);overflow:hidden;-webkit-font-smoothing:antialiased}
main.embed{position:fixed;inset:0;display:grid;place-items:center}
video{position:absolute;inset:0;width:100%;height:100%;background:#000;object-fit:contain}
.badge{position:absolute;top:10px;left:10px;right:10px;display:flex;align-items:center;gap:8px;text-decoration:none;color:#fff;font-size:14px;font-weight:600;
  opacity:0;transition:opacity .2s;pointer-events:none;text-shadow:0 1px 3px rgba(0,0,0,.6)}
.badge span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.badge svg{flex:none}
.paused .badge,main.embed:hover .badge{opacity:1;pointer-events:auto}
.card{background:var(--surface);border:1px solid var(--border);border-radius:14px;-webkit-backdrop-filter:blur(18px);backdrop-filter:blur(18px)}
.message{width:min(400px,calc(100% - 24px));padding:20px 18px;text-align:center}
.message .icon{width:36px;height:36px;border-radius:10px;display:grid;place-items:center;margin:0 auto 10px;background:rgba(17,111,245,.2);color:#7DB2FF}
.message h1{font-size:16px;margin:0 0 4px;font-weight:650}
.message p{color:var(--muted);margin:4px 0 0;font-size:14px;line-height:1.45}
.unlock{display:flex;gap:8px;margin-top:14px}
.unlock input{flex:1;min-width:0;font:inherit;font-size:16px;height:40px;padding:0 12px;border-radius:10px;border:1px solid var(--border);background:rgba(255,255,255,.08);color:var(--text)}
.unlock input[aria-invalid=true]{border-color:var(--danger)}
.unlock button{font:inherit;font-size:14px;height:40px;padding:0 14px;border-radius:10px;border:0;background:var(--accent);color:#fff;font-weight:600;cursor:pointer}
button:focus-visible,input:focus-visible,a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.error{color:var(--danger) !important}
.open{display:inline-block;margin-top:10px;font-size:13px;color:var(--muted)}
@media (prefers-reduced-motion:reduce){*{transition:none !important}}
`;
