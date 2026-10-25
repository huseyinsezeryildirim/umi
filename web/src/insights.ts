// Viewer insights (Umi Cloud): the player reports what was watched; owners see views,
// watch time, how far people get and where they drop off.

import type { AppEnv } from "./env";
import { HttpError, json, readJson } from "./http";
import type { VideoRow } from "./videos";

const BUCKETS = 20;
const SESSION = /^[0-9a-z]{16,32}$/;

/** POST /v/:id/view — { session, buckets: "0101…" (20), watchedMs, embedded } (merged, idempotent). */
export async function postView(request: Request, env: AppEnv, video: VideoRow): Promise<Response> {
  if (Number(request.headers.get("content-length")) > 2048) throw new HttpError(413, "too_large", "Request body is too large.");
  const input = await readJson<{ session?: unknown; buckets?: unknown; watchedMs?: unknown; embedded?: unknown }>(request);
  const session = typeof input.session === "string" ? input.session : "";
  const buckets = typeof input.buckets === "string" ? input.buckets : "";
  const watched = typeof input.watchedMs === "number" && Number.isFinite(input.watchedMs) ? Math.max(0, Math.round(input.watchedMs)) : 0;
  if (!SESSION.test(session) || !/^[01]{20}$/.test(buckets)) throw new HttpError(400, "invalid_field", "Bad view report.");
  // Never more than the video's length (×2 for re-watching parts), so numbers stay honest.
  const cap = (video.duration_ms ?? 3_600_000) * 2;
  const now = Date.now();
  const existing = await env.DB.prepare("SELECT video_id, buckets, watched_ms FROM views WHERE id = ?").bind(session).first<{ video_id: string; buckets: string; watched_ms: number }>();
  if (existing && existing.video_id !== video.id) throw new HttpError(409, "conflict", "Session belongs to another video.");
  const merged = existing ? [...buckets].map((b, i) => (b === "1" || existing.buckets[i] === "1" ? "1" : "0")).join("") : buckets;
  const total = Math.min(cap, Math.max(existing?.watched_ms ?? 0, watched));
  const country = (request as Request & { cf?: { country?: string } }).cf?.country ?? null;
  await env.DB.prepare(
    `INSERT INTO views (id, video_id, started_at, last_at, watched_ms, buckets, country, embedded) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET last_at = excluded.last_at, watched_ms = excluded.watched_ms, buckets = excluded.buckets`,
  )
    .bind(session, video.id, now, now, total, merged, country, input.embedded ? 1 : 0)
    .run();
  return json({ ok: true });
}

/** GET /api/videos/:id/insights — for the owner. */
export async function videoInsights(env: AppEnv, video: VideoRow): Promise<Response> {
  const { results } = await env.DB.prepare("SELECT started_at, watched_ms, buckets, country, embedded FROM views WHERE video_id = ? ORDER BY started_at DESC LIMIT 5000")
    .bind(video.id)
    .all<{ started_at: number; watched_ms: number; buckets: string; country: string | null; embedded: number }>();
  const views = results.filter((r) => r.watched_ms >= 2000 || r.buckets.includes("1"));
  const retention = Array.from({ length: BUCKETS }, (_, i) => (views.length ? views.filter((v) => v.buckets[i] === "1").length / views.length : 0));
  const watchedMs = views.reduce((s, v) => s + v.watched_ms, 0);
  const finished = views.filter((v) => v.buckets.slice(-2).includes("1")).length;
  const countries = new Map<string, number>();
  for (const v of views) if (v.country) countries.set(v.country, (countries.get(v.country) ?? 0) + 1);
  return json({
    views: views.length,
    watchedSeconds: Math.round(watchedMs / 1000),
    averageSeconds: views.length ? Math.round(watchedMs / views.length / 1000) : 0,
    completion: views.length ? finished / views.length : 0,
    retention,
    embeddedViews: views.filter((v) => v.embedded).length,
    countries: [...countries.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([country, count]) => ({ country, count })),
    recent: views.slice(0, 20).map((v) => ({ at: new Date(v.started_at).toISOString(), seconds: Math.round(v.watched_ms / 1000), country: v.country })),
  });
}

/** Player code shared by the viewer page and the embed: reports what's watched. */
export const TRACK_JS = `
  (() => {
    const vid = document.getElementById("video");
    if (!vid) return;
    const id = location.pathname.split("/")[2];
    const session = Array.from(crypto.getRandomValues(new Uint8Array(20)), b => (b % 36).toString(36)).join("");
    const seen = new Array(20).fill("0");
    let watched = 0, last = null, dirty = false;
    vid.addEventListener("timeupdate", () => {
      if (!vid.duration) return;
      seen[Math.min(19, Math.floor(vid.currentTime / vid.duration * 20))] = "1";
      const now = performance.now();
      if (!vid.paused && last !== null) watched += Math.min(1000, now - last) * vid.playbackRate;
      last = now; dirty = true;
    });
    vid.addEventListener("pause", () => { last = null; send(); });
    const send = () => {
      if (!dirty) return;
      dirty = false;
      const body = JSON.stringify({ session, buckets: seen.join(""), watchedMs: Math.round(watched), embedded: location.pathname.startsWith("/e/") });
      const url = "/v/" + id + "/view";
      if (!(navigator.sendBeacon && navigator.sendBeacon(url, new Blob([body], { type: "application/json" })))) fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => {});
    };
    setInterval(send, 10000);
    addEventListener("pagehide", send);
  })();
`;
