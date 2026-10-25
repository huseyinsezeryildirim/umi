import { limitStreaming } from "./limits";
import type { AppEnv } from "./env";
import { gifKey, thumbnailKey, videoKey } from "./env";
import { resolveAccess } from "./access";

function denied(state: string): Response {
  const status = state === "locked" ? 401 : state === "expired" || state === "gone" ? 410 : state === "review" ? 451 : 404;
  return new Response(state, { status, headers: { "cache-control": "no-store" } });
}

type ParsedRange = { offset: number; length?: number } | { suffix: number } | "invalid" | null;

function parseRange(header: string | null, size: number): ParsedRange {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return "invalid";
  if (m[1] === "") {
    const suffix = Number(m[2]);
    return suffix > 0 ? { suffix: Math.min(suffix, size) } : "invalid";
  }
  const start = Number(m[1]);
  if (start >= size) return "invalid";
  if (m[2] === "") return { offset: start };
  const end = Math.min(Number(m[2]), size - 1);
  return end >= start ? { offset: start, length: end - start + 1 } : "invalid";
}

/** Cache only as long as the link is guaranteed to stay valid. */
function cacheControl(expiresAt: number | null, isPrivate: boolean): string {
  const ttl = expiresAt === null ? 3600 : Math.max(0, Math.min(3600, Math.floor((expiresAt - Date.now()) / 1000)));
  return `${isPrivate ? "private" : "public"}, max-age=${ttl}`;
}

/** GET|HEAD /v/:id/video.mp4[?download=1] — range-capable streaming from R2. */
export async function serveVideo(request: Request, env: AppEnv, id: string): Promise<Response> {
  await limitStreaming(env, request, id);
  const access = await resolveAccess(request, env, id);
  if (access.state !== "ok") return denied(access.state);
  const { video } = access;
  const url = new URL(request.url);
  const download = url.searchParams.has("download");
  if (download && video.allow_download !== 1) return new Response("Downloads are disabled.", { status: 403 });

  const headers = new Headers({
    "content-type": video.content_type,
    "accept-ranges": "bytes",
    "cache-control": cacheControl(video.expires_at, video.password_hash !== null),
    "x-content-type-options": "nosniff",
  });
  if (download) {
    const name = (video.title.replace(/[^\p{L}\p{N} ._-]+/gu, "").trim() || "umi-recording").slice(0, 100);
    headers.set("content-disposition", `attachment; filename="${name.replace(/"/g, "")}.mp4"; filename*=UTF-8''${encodeURIComponent(name)}.mp4`);
  }

  const range = parseRange(request.headers.get("range"), video.size_bytes);
  if (range === "invalid") {
    headers.set("content-range", `bytes */${video.size_bytes}`);
    return new Response(null, { status: 416, headers });
  }

  if (request.method === "HEAD") {
    const head = await env.VIDEOS.head(videoKey(id));
    if (!head) return new Response("missing", { status: 404 });
    headers.set("content-length", String(head.size));
    headers.set("etag", head.httpEtag);
    return new Response(null, { status: 200, headers });
  }

  const object = await env.VIDEOS.get(videoKey(id), range ? { range } : {});
  if (!object) return new Response("missing", { status: 404 });
  headers.set("etag", object.httpEtag);

  if (range && object.range) {
    const r = object.range as { offset?: number; length?: number; suffix?: number };
    const start = r.suffix !== undefined ? object.size - r.suffix : (r.offset ?? 0);
    const length = r.suffix !== undefined ? r.suffix : (r.length ?? object.size - start);
    headers.set("content-range", `bytes ${start}-${start + length - 1}/${object.size}`);
    headers.set("content-length", String(length));
    return new Response(object.body, { status: 206, headers });
  }
  headers.set("content-length", String(object.size));
  return new Response(object.body, { status: 200, headers });
}

/** GET /v/:id/thumbnail.jpg — public for unfurls unless the video is password-protected. */
export async function serveThumbnail(request: Request, env: AppEnv, id: string): Promise<Response> {
  const access = await resolveAccess(request, env, id);
  if (access.state !== "ok") return denied(access.state);
  const object = await env.VIDEOS.get(thumbnailKey(id));
  if (!object) return new Response("no thumbnail", { status: 404 });
  return new Response(object.body, {
    headers: {
      "content-type": "image/jpeg",
      "content-length": String(object.size),
      etag: object.httpEtag,
      "cache-control": cacheControl(access.video.expires_at, access.video.password_hash !== null),
    },
  });
}

/**
 * GET /v/:id/preview.gif — animated preview for embeds and email. Unlike the poster, a password-protected
 * video answers 404 without a valid unlock cookie, so mail clients and unfurlers never learn it exists.
 */
export async function servePreviewGif(request: Request, env: AppEnv, id: string): Promise<Response> {
  const access = await resolveAccess(request, env, id);
  if (access.state === "locked") return new Response("not found", { status: 404, headers: { "cache-control": "no-store" } });
  if (access.state !== "ok") return denied(access.state);
  if (access.video.has_gif !== 1) return new Response("no preview", { status: 404, headers: { "cache-control": "no-store" } });
  const etagHeader = request.headers.get("if-none-match");
  const object = await env.VIDEOS.get(gifKey(id), etagHeader ? { onlyIf: { etagDoesNotMatch: etagHeader.replace(/^W\//, "").replace(/"/g, "") } } : {});
  if (!object) return new Response("no preview", { status: 404, headers: { "cache-control": "no-store" } });
  const headers = new Headers({
    "content-type": "image/gif",
    etag: object.httpEtag,
    "cache-control": cacheControl(access.video.expires_at, access.video.password_hash !== null),
    "x-content-type-options": "nosniff",
  });
  if (!("body" in object)) return new Response(null, { status: 304, headers });
  headers.set("content-length", String(object.size));
  return new Response(object.body, { headers });
}
