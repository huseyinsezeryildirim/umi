#!/usr/bin/env node
// End-to-end check against a running `wrangler dev`:
//   node scripts/e2e.mjs [--base http://localhost:8787] [--token umi_dev_token] [--file video.mp4] [--thumb thumb.jpg]
// Without --file it generates a ~20 s test MP4 (+ thumbnail) with ffmpeg, large enough to need several parts.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const { values: args } = parseArgs({
  options: {
    base: { type: "string", default: "http://localhost:8787" },
    token: { type: "string", default: "umi_dev_token" },
    "free-token": { type: "string", default: "umi_free_token" },
    "team-token": { type: "string", default: "umi_team_token" },
    file: { type: "string" },
    thumb: { type: "string" },
  },
});
const BASE = args.base.replace(/\/+$/, "");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

let failures = 0;
function check(cond, label) {
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}`);
  if (!cond) failures++;
}

function sampleFiles() {
  if (args.file) return { file: args.file, thumb: args.thumb };
  const dir = join(root, ".e2e");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "sample.mp4");
  const thumb = join(dir, "sample.jpg");
  if (!existsSync(file)) {
    console.log("Generating sample video with ffmpeg…");
    execFileSync("ffmpeg", [
      "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30,noise=alls=12:allf=t",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
      "-t", "20", "-c:v", "libx264", "-b:v", "6M", "-minrate", "6M", "-maxrate", "6M", "-bufsize", "2M",
      "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", file,
    ]);
  }
  if (!existsSync(thumb)) {
    execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-ss", "2", "-i", file, "-frames:v", "1", "-vf", "scale=1280:-2", thumb]);
  }
  return { file, thumb };
}

async function api(method, path, body, token = args.token) {
  const res = await fetch(BASE + path, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

/** The flow the macOS app follows: create → PUT parts (+thumbnail) → complete. */
async function upload(bytes, thumbBytes, meta, gifBytes = null) {
  const created = await api("POST", "/api/videos", { sizeBytes: bytes.length, contentType: "video/mp4", ...meta });
  if (created.status !== 201) throw new Error(`create failed: ${created.status} ${JSON.stringify(created.data)}`);
  const { video, upload: plan } = created.data;

  const parts = [];
  for (const { partNumber, url } of plan.parts) {
    const chunk = bytes.subarray((partNumber - 1) * plan.partSize, partNumber * plan.partSize);
    const res = await fetch(url, { method: "PUT", body: chunk });
    if (!res.ok) throw new Error(`part ${partNumber} failed: ${res.status} ${await res.text()}`);
    parts.push({ partNumber, etag: res.headers.get("etag") });
  }
  if (thumbBytes) {
    const res = await fetch(plan.thumbnailUrl, { method: "PUT", body: thumbBytes, headers: { "content-type": "image/jpeg" } });
    if (!res.ok) throw new Error(`thumbnail failed: ${res.status}`);
  }
  if (gifBytes) {
    const res = await fetch(plan.gifUrl, { method: "PUT", body: gifBytes, headers: { "content-type": "image/gif" } });
    if (!res.ok) throw new Error(`gif failed: ${res.status}`);
  }
  const done = await api("POST", `/api/videos/${video.id}/complete`, { parts });
  if (done.status !== 200) throw new Error(`complete failed: ${done.status} ${JSON.stringify(done.data)}`);
  return { video: done.data.video, plan };
}

// Smallest valid GIF (1×1), stands in for the app's animated preview.
const GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

/** Viewer-side JSON call (no bearer token; optional unlock cookie). */
async function viewer(method, path, body, cookie) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => null), headers: res.headers };
}

const sha = (buf) => createHash("sha256").update(buf).digest("hex");
const get = (path, init) => fetch(BASE + path, { redirect: "manual", ...init });

async function main() {
  const health = await get("/healthz").catch(() => null);
  if (!health?.ok) throw new Error(`No server at ${BASE}. Start it with: npm run dev`);

  const { file, thumb } = sampleFiles();
  const bytes = readFileSync(file);
  const thumbBytes = thumb ? readFileSync(thumb) : null;
  console.log(`Uploading ${file} (${(statSync(file).size / 1048576).toFixed(1)} MiB)`);

  console.log("\nAuth & billing hook");
  check((await api("POST", "/api/videos", { sizeBytes: 1 }, "nope")).status === 401, "bad token → 401");
  // Plans (src/plans.ts): share links are a paid feature; Free exports or self-hosts.
  check((await api("POST", "/api/videos", { sizeBytes: 1 }, args["free-token"])).status === 402, "free plan has no cloud links → 402");

  console.log("\nUpload");
  const { video, plan } = await upload(bytes, thumbBytes, {
    title: "Umi e2e — sample recording",
    durationMs: 20_000,
    width: 1280,
    height: 720,
    allowDownload: true,
  }, GIF);
  check(plan.partCount >= 2, `multipart with ${plan.partCount} parts of ${plan.partSize} bytes`);
  check(video.status === "ready" && video.sizeBytes === bytes.length, "complete → ready, size matches");
  check(video.thumbnailUrl !== null, "thumbnail stored");
  check(typeof plan.gifUrl === "string" && video.previewGifUrl === `${video.url}/preview.gif`, "GIF preview stored (gifUrl slot)");
  check(video.allowComments === true && video.embedUrl.endsWith(`/e/${video.id}`), "allowComments defaults to true, embedUrl");
  const refreshed = await api("POST", `/api/videos/${video.id}/upload-urls`);
  check(refreshed.status === 409, "upload-urls after completion → 409");
  check((await api("GET", `/api/videos/${video.id}`)).data?.video?.id === video.id, "GET /api/videos/:id");
  check((await api("GET", `/api/videos`)).data?.videos?.some((v) => v.id === video.id), "GET /api/videos lists it");

  console.log("\nViewer");
  const pagePath = `/v/${video.id}`;
  let html = await (await get(pagePath)).text();
  check(html.includes(`<video id="video" src="/v/${video.id}/video.mp4"`), "page has <video>");
  check(html.includes('property="og:image"') && html.includes('name="twitter:card" content="summary_large_image"'), "OG/Twitter tags with thumbnail");
  check(html.includes("?download=1"), "download button when allowed");
  const range = await get(`${pagePath}/video.mp4`, { headers: { range: "bytes=100-199" } });
  const rangeBody = Buffer.from(await range.arrayBuffer());
  check(range.status === 206 && rangeBody.equals(bytes.subarray(100, 200)), "Range request → 206 with exact bytes");
  check(range.headers.get("content-range") === `bytes 100-199/${bytes.length}`, "Content-Range header");
  const suffix = await get(`${pagePath}/video.mp4`, { headers: { range: "bytes=-50" } });
  check(Buffer.from(await suffix.arrayBuffer()).equals(bytes.subarray(-50)), "suffix Range");
  const full = await get(`${pagePath}/video.mp4?download=1`);
  check(full.status === 200 && sha(Buffer.from(await full.arrayBuffer())) === sha(bytes), "download → identical file (sha256)");
  check(/attachment/.test(full.headers.get("content-disposition") ?? ""), "Content-Disposition: attachment");
  check((await get(`${pagePath}/thumbnail.jpg`)).headers.get("content-type") === "image/jpeg", "thumbnail served");

  check(html.includes('type="application/json+oembed"') && html.includes("/oembed?url="), "oEmbed discovery link in <head>");
  check(html.includes('class="react"') && html.includes('data-emoji="🎉"') && html.includes('id="cform"'), "reaction bar + comment form rendered");
  check(html.includes('id="copyat"'), "copy-at-current-time button");
  check(html.includes("parseT(new URLSearchParams(location.search).get(\"t\"))"), "?t= start time handled");
  check((await get(pagePath)).headers.get("x-frame-options") === "DENY", "/v/ still sends X-Frame-Options: DENY");

  console.log("\nGIF preview");
  const gif = await get(`${pagePath}/preview.gif`);
  check(gif.status === 200 && gif.headers.get("content-type") === "image/gif", "preview.gif served as image/gif");
  check(Buffer.from(await gif.arrayBuffer()).equals(GIF), "preview.gif bytes identical");
  check(/^public, max-age=\d+/.test(gif.headers.get("cache-control") ?? "") && !!gif.headers.get("etag"), "preview.gif cacheable (public + ETag)");
  check((await get(`${pagePath}/preview.gif`, { headers: { "if-none-match": gif.headers.get("etag") } })).status === 304, "If-None-Match → 304");

  console.log("\nComments");
  const cPath = `${pagePath}/comments`;
  const c1 = await viewer("POST", cPath, { authorName: "  Ada  ", body: "Great walkthrough!" });
  check(c1.status === 201 && c1.data?.comment?.authorName === "Ada" && c1.data.comment.timeMs === null, "post comment → 201 (trimmed, no time)");
  const c2 = await viewer("POST", cPath, { authorName: "Linus", body: "Bug shows up here\nsecond line", timeMs: 4200 });
  check(c2.status === 201 && c2.data?.comment?.timeMs === 4200, "comment pinned at 0:04 (timeMs 4200)");
  const xss = '<img src=x onerror=alert(1)></script><script>alert(2)</script>';
  const c3 = await viewer("POST", cPath, { authorName: "<b>Mallory</b>", body: xss, timeMs: 1000 });
  check(c3.status === 201 && c3.data?.comment?.body === xss, "HTML stored verbatim as text");
  check((await viewer("POST", cPath, { authorName: "Ada", body: "   " })).status === 400, "empty body → 400");
  check((await viewer("POST", cPath, { authorName: "", body: "hi" })).status === 400, "empty name → 400");
  check((await viewer("POST", cPath, { authorName: "x".repeat(61), body: "hi" })).status === 400, "name > 60 chars → 400");
  check((await viewer("POST", cPath, { authorName: "Ada", body: "x".repeat(2001) })).status === 400, "body > 2000 chars → 400");
  check((await viewer("POST", cPath, { authorName: "Ada", body: "hi", timeMs: 999_999_999 })).status === 400, "timeMs past the end → 400");
  const textPlain = await fetch(BASE + cPath, { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify({ authorName: "A", body: "b" }) });
  check(textPlain.status === 415, "non-JSON content type → 415 (CSRF guard)");
  const list = await viewer("GET", cPath);
  const ids = list.data?.comments?.map((c) => c.id) ?? [];
  check(list.status === 200 && list.data.allowComments === true && ids.join() === [c1, c2, c3].map((c) => c.data.comment.id).join(), "list comments, oldest first");
  html = await (await get(pagePath)).text();
  check(!html.includes("<img src=x") && !html.includes("<script>alert(2)") && html.includes("\\u003cimg src=x"), "page inlines comments without HTML injection");
  const owner = await api("GET", `/api/videos/${video.id}/comments`);
  check(owner.status === 200 && owner.data?.comments?.length === 3, "owner GET /api/videos/:id/comments");
  check((await api("DELETE", `/api/videos/${video.id}/comments/${c3.data.comment.id}`, undefined, args["free-token"])).status === 404, "other account can't delete → 404");
  check((await viewer("DELETE", `/api/videos/${video.id}/comments/${c3.data.comment.id}`)).status === 401, "delete without token → 401");
  check((await api("DELETE", `/api/videos/${video.id}/comments/${c3.data.comment.id}`)).status === 200, "owner deletes comment → 200");
  check((await api("DELETE", `/api/videos/${video.id}/comments/${c3.data.comment.id}`)).status === 404, "delete again → 404");
  check(!(await viewer("GET", cPath)).data?.comments?.some((c) => c.id === c3.data.comment.id), "deleted comment no longer listed");
  const off = await api("PATCH", `/api/videos/${video.id}`, { allowComments: false });
  check(off.data?.video?.allowComments === false, "PATCH allowComments: false");
  check((await api("PATCH", `/api/videos/${video.id}`, { allowComments: "no" })).status === 400, "allowComments must be boolean");
  const disabled = await viewer("POST", cPath, { authorName: "Ada", body: "hello?" });
  check(disabled.status === 403 && disabled.data?.error?.code === "comments_disabled", "comments disabled → 403");
  const offList = await viewer("GET", cPath);
  check(offList.data?.allowComments === false && offList.data.comments.length === 0, "disabled → list hidden");
  check(!(await (await get(pagePath)).text()).includes('id="cform"'), "disabled → no comment form on page");
  await api("PATCH", `/api/videos/${video.id}`, { allowComments: true });

  console.log("\nReactions");
  const rPath = `${pagePath}/reactions`;
  const r1 = await viewer("POST", rPath, { emoji: "👍", timeMs: 1500 });
  check(r1.status === 201 && r1.data?.reaction?.emoji === "👍" && r1.data.counts["👍"] === 1, "👍 reaction → 201 + counts");
  check((await viewer("POST", rPath, { emoji: "❤️", timeMs: 8000 })).status === 201, "❤️ reaction → 201");
  check((await viewer("POST", rPath, { emoji: "👍", timeMs: 9000 })).status === 201, "second 👍 → 201");
  check((await viewer("POST", rPath, { emoji: "💩", timeMs: 1000 })).status === 400, "emoji outside the allowed set → 400");
  check((await viewer("POST", rPath, { emoji: "<b>", timeMs: 1000 })).status === 400, "arbitrary string emoji → 400");
  check((await viewer("POST", rPath, { emoji: "🎉" })).status === 400, "missing timeMs → 400");
  const rs = await viewer("GET", rPath);
  check(rs.data?.counts?.["👍"] === 2 && rs.data.counts["❤️"] === 1 && rs.data.counts["😂"] === 0, "reaction counts per emoji");
  check(rs.data?.reactions?.length === 3 && rs.data.reactions.some((r) => r.emoji === "❤️" && r.timeMs === 8000), "reaction markers with times");

  console.log("\nViewer insights");
  const vPath = `${pagePath}/view`;
  const session = () => Array.from(crypto.getRandomValues(new Uint8Array(20)), (b) => (b % 36).toString(36)).join("");
  const sA = session(), sB = session();
  check((await viewer("POST", vPath, { session: sA, buckets: "11111000000000000000", watchedMs: 5000 })).status === 200, "view report → 200");
  check((await viewer("POST", vPath, { session: sA, buckets: "00000111110000000000", watchedMs: 9000 })).status === 200, "same session again (merged)");
  check((await viewer("POST", vPath, { session: sB, buckets: "11111111111111111111", watchedMs: 20000, embedded: true })).status === 200, "second viewer watched it all (embed)");
  check((await viewer("POST", vPath, { session: "bad", buckets: "1", watchedMs: 1 })).status === 400, "malformed report → 400");
  check((await viewer("POST", vPath, { session: session(), buckets: "1".repeat(20), watchedMs: 1e12 })).status === 200, "huge watch time accepted but capped");
  const ins = await api("GET", `/api/videos/${video.id}/insights`);
  check(ins.status === 200 && ins.data?.views === 3, `3 views counted (${ins.data?.views})`);
  check(Math.abs(ins.data?.retention?.[0] - 1) < 1e-9 && Math.abs(ins.data?.retention?.[12] - 2 / 3) < 1e-9, "retention per twentieth (merged buckets)");
  check(ins.data?.embeddedViews === 1 && Math.abs(ins.data?.completion - 2 / 3) < 1e-9, "embed views + completion");
  check(ins.data?.watchedSeconds <= 9 + 20 + (video.durationMs ?? 0) * 2 / 1000 + 1, "watch time capped by video length");
  check((await api("GET", `/api/videos/${video.id}/insights`, undefined, args["free-token"])).status === 404, "other account can't read insights → 404");
  check(html.includes('"/view"'), "player reports views");

  console.log("\nWorkspaces");
  const team = args["team-token"];
  check((await api("POST", "/api/workspaces", { name: "Nope" }, args["free-token"])).status === 402, "free plan can't create a workspace → 402");
  check((await api("POST", "/api/workspaces", { name: "  " })).status === 400, "empty name → 400");
  const ws = await api("POST", "/api/workspaces", { name: "Umi Team" });
  const wsId = ws.data?.workspace?.id;
  const code = ws.data?.workspace?.inviteCode;
  check(ws.status === 201 && ws.data.workspace.role === "owner" && typeof code === "string" && code.length >= 16, "create workspace → owner with invite code");
  check((await api("GET", `/api/workspaces/${wsId}`, undefined, team)).status === 404, "non-member can't see it → 404");
  check((await api("POST", "/api/workspaces/join", { code: "wrong" }, team)).status === 404, "wrong invite code → 404");
  const joined = await api("POST", "/api/workspaces/join", { code }, team);
  check(joined.status === 200 && joined.data.workspace.role === "member" && joined.data.workspace.inviteCode === null, "join with code → member (no invite code shown)");
  check((await api("POST", "/api/workspaces/join", { code }, team)).status === 200, "joining twice is harmless");
  const detail = await api("GET", `/api/workspaces/${wsId}`, undefined, team);
  check(detail.data?.members?.length === 2 && detail.data.members.some((m) => m.you && m.role === "member"), "members listed");
  check((await api("POST", `/api/workspaces/${wsId}/invite-code`, undefined, team)).status === 403, "member can't rotate the code → 403");
  check((await api("GET", `/api/videos/${video.id}`, undefined, team)).status === 404, "member can't see a video outside the team");
  const moved = await api("PATCH", `/api/videos/${video.id}`, { workspaceId: wsId });
  check(moved.data?.video?.workspaceId === wsId, "owner moves a video into the workspace");
  check((await api("PATCH", `/api/videos/${video.id}`, { workspaceId: "nonexistent1" })).status === 404, "unknown workspace → 404");
  const teamVideos = await api("GET", `/api/workspaces/${wsId}/videos`, undefined, team);
  check(teamVideos.data?.videos?.some((v) => v.id === video.id && v.yours === false && v.owner === "dev@umi.local"), "member sees the team's videos");
  check((await api("GET", `/api/videos/${video.id}/insights`, undefined, team)).data?.views === 3, "member sees the video's insights");
  check((await api("PATCH", `/api/videos/${video.id}`, { title: "hijack" }, team)).status === 404, "member can't change someone else's video");
  check((await api("DELETE", `/api/videos/${video.id}`, undefined, team)).status === 404, "member can't delete someone else's video");
  const preset = { name: "Brand look", edit: { padding: 0.1, background: { gradient: { _0: "sky" } } } };
  check((await api("PUT", `/api/workspaces/${wsId}/presets/P1`, preset, team)).status === 200, "member shares a style");
  check((await api("PUT", `/api/workspaces/${wsId}/presets/P2`, { name: "Bad", edit: "x" })).status === 400, "style must be an object");
  const presets = await api("GET", `/api/workspaces/${wsId}/presets`);
  check(presets.data?.presets?.length === 1 && presets.data.presets[0].edit.padding === 0.1 && presets.data.presets[0].updatedBy === "team@umi.local", "owner gets the shared style");
  const rotated = await api("POST", `/api/workspaces/${wsId}/invite-code`);
  check(rotated.data?.workspace?.inviteCode && rotated.data.workspace.inviteCode !== code, "owner rotates the invite code");
  check((await api("POST", "/api/workspaces/join", { code }, args["free-token"])).status === 402, "joining needs a plan → 402");
  check((await api("DELETE", `/api/workspaces/${wsId}/members/acc_dev`, undefined, team)).status === 403, "member can't remove the owner");
  check((await api("DELETE", `/api/workspaces/${wsId}/members/acc_team`, undefined, team)).status === 200, "member leaves");
  check((await api("GET", `/api/workspaces/${wsId}/videos`, undefined, team)).status === 404, "after leaving, the team is gone for them");
  check((await api("POST", "/api/workspaces/join", { code }, team)).status === 404, "the old invite code no longer works");
  check((await api("POST", "/api/workspaces/join", { code: rotated.data.workspace.inviteCode }, team)).status === 200, "the new one does");
  await api("DELETE", `/api/workspaces/${wsId}/members/acc_team`, undefined, team);
  check((await api("GET", "/api/workspaces")).data?.workspaces?.some((w) => w.id === wsId && w.members === 1), "workspace list with member count");
  check((await api("DELETE", `/api/workspaces/${wsId}`)).status === 200, "owner deletes the workspace");
  check((await api("GET", `/api/videos/${video.id}`)).data?.video?.workspaceId === null, "its videos stay with their owner");

  console.log("\nEmbed & oEmbed");
  const embed = await get(`/e/${video.id}?t=5`);
  const embedHtml = await embed.text();
  check(embed.status === 200 && embedHtml.includes(`<video id="video" src="/v/${video.id}/video.mp4"`) && embedHtml.includes(`poster="/v/${video.id}/thumbnail.jpg"`), "/e/:id renders player with poster");
  check(!embedHtml.includes('class="top"') && !embedHtml.includes('class="foot"'), "embed is chrome-less");
  check(embed.headers.get("x-frame-options") === null, "embed has no X-Frame-Options");
  const embedCsp = embed.headers.get("content-security-policy") ?? "";
  check(!embedCsp.includes("frame-ancestors 'none'") && embedCsp.includes("frame-ancestors *"), "embed CSP allows framing");
  const oe = await get(`/oembed?url=${encodeURIComponent(video.url)}&format=json`);
  const oj = await oe.json().catch(() => null);
  check(oe.status === 200 && oj?.type === "video" && oj.version === "1.0" && oj.provider_name === "Umi", "oEmbed JSON (type video)");
  check(oj?.width === 1280 && oj.height === 720 && oj.html?.includes(`src="${BASE}/e/${video.id}"`) && oj.html.includes("<iframe"), "oEmbed iframe html + video dimensions");
  check(oj?.thumbnail_url === `${video.url}/thumbnail.jpg`, "oEmbed thumbnail_url");
  const oeSmall = await (await get(`/oembed?url=${encodeURIComponent(video.url + "?t=12")}&maxwidth=640`)).json();
  check(oeSmall.width === 640 && oeSmall.height === 360 && oeSmall.html.includes(`/e/${video.id}?t=12`), "oEmbed maxwidth + ?t= passthrough");
  check((await get(`/oembed?url=${encodeURIComponent(video.url)}&format=xml`)).status === 501, "oEmbed format=xml → 501");
  check((await get(`/oembed?url=${encodeURIComponent("https://evil.example/v/" + video.id)}`)).status === 404, "oEmbed foreign URL → 404");

  console.log("\nDownload toggle");
  await api("PATCH", `/api/videos/${video.id}`, { allowDownload: false });
  check((await get(`${pagePath}/video.mp4?download=1`)).status === 403, "download disabled → 403");
  check(!(await (await get(pagePath)).text()).includes("?download=1"), "no download button");

  console.log("\nPassword");
  const pw = await api("PATCH", `/api/videos/${video.id}`, { password: "hunter22" });
  check(pw.data?.video?.hasPassword === true, "password set");
  html = await (await get(pagePath)).text();
  check(html.includes('name="password"') && !html.includes("<video"), "password prompt instead of player");
  check(!html.includes('property="og:image"'), "no thumbnail in unfurl while locked");
  check((await get(`${pagePath}/video.mp4`)).status === 401, "video locked → 401");
  check((await get(`${pagePath}/thumbnail.jpg`)).status === 401, "thumbnail locked → 401");
  check((await get(`${pagePath}/preview.gif`)).status === 404, "preview.gif locked → 404");
  check((await viewer("POST", `${pagePath}/comments`, { authorName: "Eve", body: "hi" })).status === 401, "comment without unlock → 401");
  check((await viewer("GET", `${pagePath}/comments`)).status === 401, "list comments without unlock → 401");
  check((await viewer("POST", `${pagePath}/reactions`, { emoji: "👍", timeMs: 0 })).status === 401, "reaction without unlock → 401");
  const lockedEmbed = await (await get(`/e/${video.id}`)).text();
  check(lockedEmbed.includes('name="password"') && lockedEmbed.includes('name="embed" value="1"') && !lockedEmbed.includes("<video"), "embed shows unlock form");
  const lockedOe = await (await get(`/oembed?url=${encodeURIComponent(video.url)}`)).json();
  check(lockedOe.title === "Password-protected video" && !("thumbnail_url" in lockedOe), "oEmbed of locked video is anonymous");
  const form = (p) => ({ method: "POST", body: new URLSearchParams({ password: p, t: "5" }) });
  check((await get(`${pagePath}/unlock`, form("wrong"))).status === 401, "wrong password → 401");
  const ok = await get(`${pagePath}/unlock`, form("hunter22"));
  const cookie = ok.headers.get("set-cookie")?.split(";")[0] ?? "";
  check(ok.status === 303 && ok.headers.get("location") === `${pagePath}?t=5` && cookie.startsWith("umi_unlock_"), "right password → 303 + cookie, keeps ?t=");
  check((await get(`${pagePath}/video.mp4`, { headers: { cookie, range: "bytes=0-9" } })).status === 206, "video plays with cookie");
  check((await viewer("POST", `${pagePath}/comments`, { authorName: "Bob", body: "unlocked!" }, cookie)).status === 201, "comment with unlock cookie → 201");
  check((await get(`${pagePath}/preview.gif`, { headers: { cookie } })).status === 200, "preview.gif with unlock cookie → 200");
  const embedForm = { method: "POST", body: new URLSearchParams({ password: "hunter22", t: "5", embed: "1" }) };
  const eok = await get(`${pagePath}/unlock`, embedForm);
  const ecookie = eok.headers.get("set-cookie") ?? "";
  check(eok.status === 303 && eok.headers.get("location") === `/e/${video.id}?t=5` && /Path=\//.test(ecookie), "embed unlock → 303 back to /e/ with Path=/ cookie");
  const ecv = ecookie.split(";")[0];
  check((await (await get(`/e/${video.id}`, { headers: { cookie: ecv } })).text()).includes("<video"), "embed plays after unlock");
  check((await get(`${pagePath}/video.mp4`, { headers: { cookie: ecv, range: "bytes=0-9" } })).status === 206, "embed cookie unlocks media");
  const wrongEmbed = await get(`${pagePath}/unlock`, { method: "POST", body: new URLSearchParams({ password: "nope", embed: "1" }) });
  check(wrongEmbed.status === 401 && (await wrongEmbed.text()).includes('name="embed"'), "wrong password in embed → 401 embed form");
  await api("PATCH", `/api/videos/${video.id}`, { password: "changed!" });
  check((await get(`${pagePath}/video.mp4`, { headers: { cookie } })).status === 401, "changing password invalidates cookie");
  await api("PATCH", `/api/videos/${video.id}`, { password: null, allowDownload: true });

  console.log("\nExpiry");
  check((await api("PATCH", `/api/videos/${video.id}`, { expiresAt: "2001-01-01T00:00:00Z" })).status === 400, "past expiresAt rejected");
  await api("PATCH", `/api/videos/${video.id}`, { expiresAt: new Date(Date.now() + 1500).toISOString() });
  check((await get(pagePath)).status === 200, "before expiry → 200");
  await new Promise((r) => setTimeout(r, 2000));
  const expired = await get(pagePath);
  check(expired.status === 410 && (await expired.text()).includes("expired"), "after expiry → 410 expired page");
  check((await get(`${pagePath}/video.mp4`)).status === 410, "video after expiry → 410");
  check((await viewer("POST", `${pagePath}/comments`, { authorName: "Ada", body: "late" })).status === 410, "comment after expiry → 410");
  check((await get(`/e/${video.id}`)).status === 410, "embed after expiry → 410");
  check((await api("GET", `/api/videos/${video.id}`)).data?.video?.expired === true, "API reports expired");
  await api("PATCH", `/api/videos/${video.id}`, { expiresAt: null });
  check((await get(pagePath)).status === 200, "clearing expiry restores the link");

  console.log("\nRevoke (second upload)");
  const small = bytes.subarray(0, Math.min(bytes.length, 1024 * 1024));
  const { video: doomed, plan: doomedPlan } = await upload(small, null, { title: "to be deleted", allowComments: false });
  check(doomed.allowComments === false && doomed.previewGifUrl === null, "create with allowComments: false, no GIF");
  check((await fetch(doomedPlan.gifUrl, { method: "PUT", body: "not a gif" })).status === 409, "GIF upload after completion → 409");
  const pending = await api("POST", "/api/videos", { sizeBytes: 1024, title: "bad gif" });
  check((await fetch(pending.data.upload.gifUrl, { method: "PUT", body: "definitely not a gif" })).status === 400, "non-GIF bytes → 400 invalid_gif");
  check((await fetch(pending.data.upload.gifUrl + "x", { method: "PUT", body: GIF })).status === 403, "tampered GIF URL → 403");
  await api("DELETE", `/api/videos/${pending.data.video.id}`);

  check((await api("DELETE", `/api/videos/${doomed.id}`)).status === 200, "DELETE → 200");
  check((await get(`/v/${doomed.id}`)).status === 410, "revoked page → 410");
  check((await get(`/v/${doomed.id}/video.mp4`)).status === 410, "revoked video → 410");
  check((await api("GET", `/api/videos/${doomed.id}`)).status === 404, "revoked video gone from API");
  check((await get(`/v/doesNotExist1`)).status === 404, "unknown id → 404");
  console.log("\nRate limit (separate video)");
  const { video: spam } = await upload(small, null, { title: "rate limit" });
  let limited = 0, accepted = 0;
  for (let i = 0; i < 12; i++) {
    limited = (await viewer("POST", `/v/${spam.id}/comments`, { authorName: "Spammer", body: `spam ${i}` })).status;
    if (limited === 201) accepted++;
  }
  check(accepted === 10 && limited === 429, "per-IP comment rate limit: 10 accepted, then 429");
  await api("DELETE", `/api/videos/${spam.id}`);

  console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
  console.log(`\nViewer: ${video.url}\n        ${video.url}?t=12`);
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
