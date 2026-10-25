import { type AppEnv, baseUrl } from "./env";
import { resolveAccess, unlockCookie } from "./access";
import { verifyPassword } from "./crypto";
import { handleEmbed } from "./embed";
import {
  CHAT,
  CLOCK,
  CLOCK_LINK,
  DOWNLOAD,
  EXPAND,
  LINK,
  MISSING,
  PARSE_T_JS,
  esc,
  formatDate,
  formatDuration,
  messageCard,
  newNonce,
  page,
  passwordCard,
  safeJson,
} from "./page";
import { MAX_AUTHOR_NAME, MAX_COMMENT_BODY, REACTION_EMOJIS, type ReactionSummary, socialState } from "./social";
import type { VideoRow } from "./videos";

type Social = Awaited<ReturnType<typeof socialState>>;

function reactionBar(reactions: ReactionSummary): string {
  return REACTION_EMOJIS.map(
    (e) =>
      `<button type="button" class="rx" data-emoji="${e}" aria-label="React with ${e}"><span class="e" aria-hidden="true">${e}</span><span class="n">${reactions.counts[e] ?? 0}</span></button>`,
  ).join("");
}

function commentsSection(social: Social): string {
  if (!social.allowComments) {
    return `<section class="card comments off" id="comments">${CHAT}<span>Comments are turned off for this video.</span></section>`;
  }
  return `<section class="card comments" id="comments" aria-labelledby="c-h">
  <h2 id="c-h">Comments <span class="ccount" id="ccount"></span></h2>
  <ol class="clist" id="clist"></ol>
  <p class="empty" id="cempty">No comments yet. Be the first to say something.</p>
  <form class="cform" id="cform" novalidate>
    <label class="sr" for="cname">Your name</label>
    <input id="cname" name="authorName" maxlength="${MAX_AUTHOR_NAME}" placeholder="Your name" autocomplete="name" required>
    <label class="sr" for="cbody">Comment</label>
    <textarea id="cbody" name="body" maxlength="${MAX_COMMENT_BODY}" rows="2" placeholder="Add a comment…" required></textarea>
    <div class="crow">
      <button type="button" class="chip" id="cat" aria-pressed="true" title="Pin this comment to the current time">at 0:00</button>
      <span class="grow"></span>
      <span class="len" id="clen" aria-live="polite"></span>
      <button type="submit" class="primary" id="cpost">Post</button>
    </div>
    <p class="error" id="cerr" role="alert" hidden></p>
  </form>
</section>`;
}

function playerBody(video: VideoRow, nonce: string, social: Social): string {
  const ratio = video.width && video.height ? `${video.width} / ${video.height}` : "16 / 9";
  const poster = video.has_thumbnail ? ` poster="/v/${video.id}/thumbnail.jpg"` : "";
  const meta = [formatDate(video.created_at), formatDuration(video.duration_ms)].filter(Boolean).join(" · ");
  const expiry = video.expires_at
    ? `<span class="pill" title="${new Date(video.expires_at).toISOString()}">Link expires ${formatDate(video.expires_at)}</span>`
    : "";
  const speeds = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]
    .map((s) => `<option value="${s}"${s === 1 ? " selected" : ""}>${s}×</option>`)
    .join("");
  const data = { id: video.id, durationMs: video.duration_ms, emojis: REACTION_EMOJIS, ...social };
  return `<style nonce="${nonce}">.stage,.timeline{--ratio:${ratio}}</style>
<div class="stage" id="stage">
  <video id="video" src="/v/${video.id}/video.mp4" controls playsinline preload="metadata"${poster}></video>
  <div class="floats" id="floats" aria-hidden="true"></div>
</div>
<div class="timeline"><div class="track" id="track" title="Reactions and comments"><div class="played" id="played"></div><div id="markers"></div></div></div>
<section class="info">
  <div class="titles">
    <h1>${esc(video.title)}</h1>
    <p class="meta">${esc(meta)} ${expiry}</p>
  </div>
  <div class="actions">
    <label class="speed" title="Playback speed (&lt; / &gt;)"><span class="sr">Playback speed</span>
      <select id="speed">${speeds}</select>
    </label>
    <button type="button" id="copy" title="Copy link">${LINK}<span>Copy link</span></button>
    <button type="button" id="copyat" title="Copy link at current time">${CLOCK_LINK}<span id="copyat-l" class="tnum">Copy at 0:00</span></button>
    <button type="button" id="fs" title="Fullscreen (F)">${EXPAND}<span class="sr">Fullscreen</span></button>
    ${video.allow_download ? `<a class="button" href="/v/${video.id}/video.mp4?download=1" download>${DOWNLOAD}<span>Download</span></a>` : ""}
  </div>
</section>
<section class="react" aria-label="Reactions">${reactionBar(social.reactions)}</section>
${commentsSection(social)}
<div class="toast" id="toast" role="status" aria-live="polite"></div>
<script type="application/json" id="umi-data">${safeJson(data)}</script>`;
}

export async function handleViewer(request: Request, env: AppEnv, id: string, wrongPassword = false): Promise<Response> {
  const url = new URL(request.url);
  const origin = baseUrl(env, request);
  const canonical = `${origin}/v/${id}`;
  const nonce = newNonce();
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
      const social = await socialState(env, v);
      return page({
        ...base,
        status: 200,
        title: v.title,
        description: [formatDuration(v.duration_ms), "Watch on Umi"].filter(Boolean).join(" · "),
        og: isPublic
          ? {
              image: v.has_thumbnail ? `${canonical}/thumbnail.jpg` : undefined,
              video: { url: `${canonical}/video.mp4`, width: v.width, height: v.height, type: v.content_type },
            }
          : undefined,
        oembed: isPublic ? `${origin}/oembed?url=${encodeURIComponent(canonical)}&format=json` : undefined,
        body: `${playerBody(v, nonce, social)}<script nonce="${nonce}">${SCRIPT}</script>`,
      });
    }
  }
}

/** POST /v/:id/unlock — from the viewer page, or from the embed when the form carries `embed=1`. */
export async function handleUnlock(request: Request, env: AppEnv, id: string): Promise<Response> {
  const access = await resolveAccess(request, env, id);
  const form = await request.formData().catch(() => null);
  const embed = form?.get("embed") === "1";
  const target = new URL(`/${embed ? "e" : "v"}/${id}`, request.url);
  const t = form?.get("t");
  if (typeof t === "string" && t) target.searchParams.set("t", t);
  if (access.state !== "locked") return Response.redirect(target.toString(), 303);
  const password = form?.get("password");

  if (typeof password === "string" && (await verifyPassword(password, access.video.password_hash!))) {
    return new Response(null, {
      status: 303,
      headers: {
        location: target.pathname + target.search,
        "set-cookie": await unlockCookie(request, env, access.video, { embed }),
      },
    });
  }
  // TODO(abuse): rate-limit attempts per video/IP (e.g. Workers Rate Limiting binding).
  const retry = new Request(target, { headers: request.headers });
  return embed ? handleEmbed(retry, env, id, true) : handleViewer(retry, env, id, true);
}

// User content (names, comment bodies) is only ever inserted with textContent / DOM properties.
const SCRIPT = `(() => {
  const $ = (id) => document.getElementById(id);
  const v = $("video"), stage = $("stage"), speed = $("speed"), toast = $("toast");
  const data = JSON.parse($("umi-data").textContent);
  const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } },
                  set(k, x) { try { localStorage.setItem(k, x); } catch {} } };
  const fmt = (sec) => { sec = Math.max(0, Math.floor(sec)); const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = String(sec % 60).padStart(2, "0");
    return h ? h + ":" + String(m).padStart(2, "0") + ":" + s : m + ":" + s; };

  ${PARSE_T_JS}
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
  $("fs").addEventListener("click", fullscreen);

  let toastTimer;
  function show(msg) { toast.textContent = msg; toast.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove("show"), 2000); }
  async function copyLink(atTime) {
    const u = new URL(location.href); u.search = ""; u.hash = "";
    const t = Math.floor(v.currentTime);
    if (atTime && t > 0) u.searchParams.set("t", String(t));
    try { await navigator.clipboard.writeText(u.toString()); show(atTime && t > 0 ? "Link copied at " + fmt(t) : "Link copied"); }
    catch { prompt("Copy this link", u.toString()); }
  }
  $("copy").addEventListener("click", () => copyLink(false));
  $("copyat").addEventListener("click", () => copyLink(true));
  const copyAtLabel = $("copyat-l");

  function seek(sec) { v.currentTime = sec; if (v.paused) v.play().catch(() => {}); }

  // ---- timeline: progress + reaction/comment markers
  const track = $("track"), played = $("played"), markers = $("markers");
  const duration = () => (isFinite(v.duration) && v.duration > 0 ? v.duration : (data.durationMs || 0) / 1000);
  const hue = (s) => { let h = 0; for (const ch of s) h = (h * 31 + ch.codePointAt(0)) % 360; return h; };
  function drawMarkers() {
    const d = duration();
    markers.replaceChildren();
    if (!d) return;
    const add = (sec, el, label) => {
      el.style.left = Math.min(100, Math.max(0, sec / d * 100)) + "%";
      el.title = label;
      el.addEventListener("click", (e) => { e.stopPropagation(); seek(sec); });
      markers.append(el);
    };
    for (const r of data.reactions.reactions) {
      const el = document.createElement("span"); el.className = "mk rx"; el.textContent = r.emoji;
      add(r.timeMs / 1000, el, r.emoji + " at " + fmt(r.timeMs / 1000));
    }
    for (const c of data.comments) {
      if (c.timeMs == null) continue;
      const el = document.createElement("span"); el.className = "mk cm";
      el.textContent = [...c.authorName][0].toUpperCase();
      el.style.background = "hsl(" + hue(c.authorName) + " 65% 48%)";
      add(c.timeMs / 1000, el, c.authorName + " at " + fmt(c.timeMs / 1000) + ": " + c.body.slice(0, 120));
    }
  }
  track.addEventListener("click", (e) => {
    const d = duration(); if (!d) return;
    const rect = track.getBoundingClientRect();
    seek(Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)) * d);
  });
  v.addEventListener("loadedmetadata", drawMarkers);
  v.addEventListener("timeupdate", () => {
    const d = duration();
    played.style.width = d ? Math.min(100, v.currentTime / d * 100) + "%" : "0";
    copyAtLabel.textContent = "Copy at " + fmt(v.currentTime);
    if (cat && pinnedAt == null) cat.textContent = "at " + fmt(v.currentTime);
  });

  // ---- reactions
  const rxButtons = [...document.querySelectorAll(".react .rx")];
  function drawCounts() { for (const b of rxButtons) b.querySelector(".n").textContent = data.reactions.counts[b.dataset.emoji] || 0; }
  function floatEmoji(emoji) {
    const el = document.createElement("span"); el.className = "fl"; el.textContent = emoji;
    el.style.left = (8 + Math.random() * 80) + "%";
    $("floats").append(el); setTimeout(() => el.remove(), 1800);
  }
  async function api(path, body) {
    const res = await fetch(path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {});
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new Error(json && json.error ? json.error.message : "Something went wrong.");
    return json;
  }
  for (const b of rxButtons) b.addEventListener("click", async () => {
    const emoji = b.dataset.emoji, timeMs = Math.round(v.currentTime * 1000);
    floatEmoji(emoji);
    data.reactions.counts[emoji] = (data.reactions.counts[emoji] || 0) + 1;
    data.reactions.reactions.push({ emoji, timeMs });
    b.classList.add("mine"); drawCounts(); drawMarkers();
    try { const r = await api("/v/" + data.id + "/reactions", { emoji, timeMs }); data.reactions.counts = r.counts; drawCounts(); }
    catch (err) {
      data.reactions.counts[emoji]--; data.reactions.reactions.pop(); drawCounts(); drawMarkers(); show(err.message);
    }
  });

  // ---- comments
  const list = $("clist"), form = $("cform");
  const cat = $("cat"), cname = $("cname"), cbody = $("cbody"), cerr = $("cerr"), clen = $("clen");
  let pinnedAt = null; // seconds captured when the viewer starts typing
  function rel(iso) {
    const s = (Date.now() - Date.parse(iso)) / 1000;
    if (s < 45) return "just now";
    if (s < 3600) return Math.round(s / 60) + "m ago";
    if (s < 86400) return Math.round(s / 3600) + "h ago";
    if (s < 7 * 86400) return Math.round(s / 86400) + "d ago";
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }
  function renderComment(c) {
    const li = document.createElement("li"); li.className = "c"; li.id = "c-" + c.id;
    const av = document.createElement("div"); av.className = "av"; av.setAttribute("aria-hidden", "true");
    av.textContent = [...c.authorName][0].toUpperCase(); av.style.background = "hsl(" + hue(c.authorName) + " 65% 48%)";
    const cb = document.createElement("div"); cb.className = "cb";
    const ch = document.createElement("div"); ch.className = "ch";
    const name = document.createElement("strong"); name.textContent = c.authorName; ch.append(name);
    if (c.timeMs != null) {
      const t = document.createElement("button"); t.type = "button"; t.className = "chip"; t.textContent = fmt(c.timeMs / 1000);
      t.title = "Jump to " + fmt(c.timeMs / 1000); t.addEventListener("click", () => seek(c.timeMs / 1000)); ch.append(t);
    }
    const time = document.createElement("time"); time.dateTime = c.createdAt; time.title = new Date(c.createdAt).toLocaleString();
    time.textContent = rel(c.createdAt); ch.append(time);
    const p = document.createElement("p"); p.textContent = c.body;
    cb.append(ch, p); li.append(av, cb); return li;
  }
  function drawComments() {
    if (!list) return;
    list.replaceChildren(...data.comments.map(renderComment));
    $("cempty").hidden = data.comments.length > 0;
    $("ccount").textContent = data.comments.length ? String(data.comments.length) : "";
  }
  if (form) {
    cname.value = store.get("umi.name") || "";
    const updateLen = () => { const n = [...cbody.value].length; clen.textContent = n > ${MAX_COMMENT_BODY} - 200 ? n + " / ${MAX_COMMENT_BODY}" : ""; };
    cbody.addEventListener("input", updateLen);
    cbody.addEventListener("focus", () => { if (pinnedAt == null && cat.getAttribute("aria-pressed") === "true") { pinnedAt = v.currentTime; cat.textContent = "at " + fmt(pinnedAt); } });
    cat.addEventListener("click", () => {
      const on = cat.getAttribute("aria-pressed") !== "true";
      cat.setAttribute("aria-pressed", String(on));
      if (!on) pinnedAt = null; else { pinnedAt = v.currentTime; cat.textContent = "at " + fmt(pinnedAt); }
    });
    form.addEventListener("submit", async (e) => {
      e.preventDefault(); cerr.hidden = true;
      const authorName = cname.value.trim(), body = cbody.value.trim();
      if (!authorName) { cerr.textContent = "Please enter your name."; cerr.hidden = false; return cname.focus(); }
      if (!body) { cerr.textContent = "Write a comment first."; cerr.hidden = false; return cbody.focus(); }
      const pinned = cat.getAttribute("aria-pressed") === "true";
      const timeMs = pinned ? Math.round((pinnedAt ?? v.currentTime) * 1000) : null;
      const btn = $("cpost"); btn.disabled = true;
      try {
        const r = await api("/v/" + data.id + "/comments", { authorName, body, timeMs });
        store.set("umi.name", authorName);
        data.comments.push(r.comment); drawComments(); drawMarkers();
        cbody.value = ""; updateLen(); pinnedAt = null;
        document.getElementById("c-" + r.comment.id).scrollIntoView({ block: "nearest", behavior: "smooth" });
      } catch (err) { cerr.textContent = err.message; cerr.hidden = false; }
      finally { btn.disabled = false; }
    });
  }
  drawComments(); drawMarkers();

  // Pick up other viewers' comments and reactions while the page is open.
  setInterval(async () => {
    if (document.hidden) return;
    try {
      const [c, r] = await Promise.all([api("/v/" + data.id + "/comments"), api("/v/" + data.id + "/reactions")]);
      data.comments = c.comments; data.reactions = r; drawComments(); drawCounts(); drawMarkers();
    } catch {}
  }, 30000);
  setInterval(() => { for (const t of document.querySelectorAll(".ch time")) t.textContent = rel(t.dateTime); }, 60000);

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
