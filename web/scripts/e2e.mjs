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
async function upload(bytes, thumbBytes, meta) {
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
  const done = await api("POST", `/api/videos/${video.id}/complete`, { parts });
  if (done.status !== 200) throw new Error(`complete failed: ${done.status} ${JSON.stringify(done.data)}`);
  return { video: done.data.video, plan };
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
  check((await api("POST", "/api/videos", { sizeBytes: 1 }, args["free-token"])).status === 402, "unpaid account → 402");

  console.log("\nUpload");
  const { video, plan } = await upload(bytes, thumbBytes, {
    title: "Umi e2e — sample recording",
    durationMs: 20_000,
    width: 1280,
    height: 720,
    allowDownload: true,
  });
  check(plan.partCount >= 2, `multipart with ${plan.partCount} parts of ${plan.partSize} bytes`);
  check(video.status === "ready" && video.sizeBytes === bytes.length, "complete → ready, size matches");
  check(video.thumbnailUrl !== null, "thumbnail stored");
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
  const form = (p) => ({ method: "POST", body: new URLSearchParams({ password: p, t: "5" }) });
  check((await get(`${pagePath}/unlock`, form("wrong"))).status === 401, "wrong password → 401");
  const ok = await get(`${pagePath}/unlock`, form("hunter22"));
  const cookie = ok.headers.get("set-cookie")?.split(";")[0] ?? "";
  check(ok.status === 303 && ok.headers.get("location") === `${pagePath}?t=5` && cookie.startsWith("umi_unlock_"), "right password → 303 + cookie, keeps ?t=");
  check((await get(`${pagePath}/video.mp4`, { headers: { cookie, range: "bytes=0-9" } })).status === 206, "video plays with cookie");
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
  check((await api("GET", `/api/videos/${video.id}`)).data?.video?.expired === true, "API reports expired");
  await api("PATCH", `/api/videos/${video.id}`, { expiresAt: null });
  check((await get(pagePath)).status === 200, "clearing expiry restores the link");

  console.log("\nRevoke (second upload)");
  const small = bytes.subarray(0, Math.min(bytes.length, 1024 * 1024));
  const { video: doomed } = await upload(small, null, { title: "to be deleted" });
  check((await api("DELETE", `/api/videos/${doomed.id}`)).status === 200, "DELETE → 200");
  check((await get(`/v/${doomed.id}`)).status === 410, "revoked page → 410");
  check((await get(`/v/${doomed.id}/video.mp4`)).status === 410, "revoked video → 410");
  check((await api("GET", `/api/videos/${doomed.id}`)).status === 404, "revoked video gone from API");
  check((await get(`/v/doesNotExist1`)).status === 404, "unknown id → 404");

  console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
  console.log(`\nViewer: ${video.url}\n        ${video.url}?t=12`);
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
