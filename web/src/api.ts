import { type Account, authenticate, requirePaid } from "./auth";
import { type AppEnv, gifKey, maxUploadBytes, thumbnailKey, videoKey } from "./env";
import { hashPassword, randomId } from "./crypto";
import { HttpError, json, readJson } from "./http";
import { deleteSocialData, ownerDeleteComment, ownerListComments } from "./social";
import { videoInsights } from "./insights";
import { buildUploadPlan } from "./uploads";
import { type VideoRow, getVideo, toJson } from "./videos";

interface CreateVideoBody {
  title?: string;
  sizeBytes: number;
  contentType?: string;
  durationMs?: number;
  width?: number;
  height?: number;
  password?: string | null;
  expiresAt?: string | null;
  allowDownload?: boolean;
  allowComments?: boolean;
}

interface UpdateVideoBody {
  title?: string;
  password?: string | null;
  expiresAt?: string | null;
  allowDownload?: boolean;
  allowComments?: boolean;
}

interface CompleteBody {
  parts: { partNumber: number; etag: string }[];
  /** For links reserved before the video existed. */
  durationMs?: number;
  width?: number;
  height?: number;
}

const MAX_TITLE = 200;
const MIN_PASSWORD = 4;
const MAX_PASSWORD = 128;

function optionalInt(value: unknown, field: string): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new HttpError(400, "invalid_field", `${field} must be a non-negative number.`);
  }
  return Math.round(value);
}

function parseTitle(value: unknown): string {
  if (value === undefined || value === null) return "Umi recording";
  if (typeof value !== "string") throw new HttpError(400, "invalid_field", "title must be a string.");
  return value.trim().slice(0, MAX_TITLE) || "Umi recording";
}

/** undefined = leave unchanged, null = clear. */
function parseExpiresAt(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const ms = typeof value === "string" ? Date.parse(value) : NaN;
  if (Number.isNaN(ms)) throw new HttpError(400, "invalid_field", "expiresAt must be an ISO 8601 timestamp or null.");
  if (ms <= Date.now()) throw new HttpError(400, "invalid_field", "expiresAt must be in the future.");
  return ms;
}

/** undefined = leave unchanged, null/"" = remove password. */
async function parsePassword(value: unknown): Promise<string | null | undefined> {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string" || value.length < MIN_PASSWORD || value.length > MAX_PASSWORD) {
    throw new HttpError(400, "invalid_field", `password must be ${MIN_PASSWORD}–${MAX_PASSWORD} characters.`);
  }
  return hashPassword(value);
}

async function ownedVideo(env: AppEnv, account: Account, id: string): Promise<VideoRow> {
  const video = await getVideo(env, id);
  if (!video || video.account_id !== account.id || video.status === "deleted") {
    throw new HttpError(404, "not_found", "Video not found.");
  }
  return video;
}

/** POST /api/videos */
async function createVideo(request: Request, env: AppEnv, account: Account): Promise<Response> {
  requirePaid(account);
  const body = await readJson<CreateVideoBody>(request);
  const size = body.sizeBytes;
  if (typeof size !== "number" || !Number.isInteger(size) || size <= 0) {
    throw new HttpError(400, "invalid_field", "sizeBytes must be a positive integer.");
  }
  if (size > maxUploadBytes(env)) throw new HttpError(413, "too_large", "Video exceeds the maximum upload size.");
  const contentType = body.contentType ?? "video/mp4";
  // MP4 from the desktop app; WebM from the Chrome extension (plays in every current browser).
  if (contentType !== "video/mp4" && contentType !== "video/webm") throw new HttpError(400, "invalid_field", "Only video/mp4 and video/webm are supported.");

  const id = randomId();
  const upload = await env.VIDEOS.createMultipartUpload(videoKey(id), {
    httpMetadata: { contentType },
  });
  const now = Date.now();
  const expiresAt = parseExpiresAt(body.expiresAt) ?? null;
  const passwordHash = (await parsePassword(body.password)) ?? null;

  await env.DB.prepare(
    `INSERT INTO videos (id, account_id, title, status, upload_id, content_type, size_bytes, duration_ms, width, height,
       password_hash, expires_at, allow_download, allow_comments, created_at, updated_at)
     VALUES (?, ?, ?, 'uploading', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      account.id,
      parseTitle(body.title),
      upload.uploadId,
      contentType,
      size,
      optionalInt(body.durationMs, "durationMs"),
      optionalInt(body.width, "width"),
      optionalInt(body.height, "height"),
      passwordHash,
      expiresAt,
      body.allowDownload === true ? 1 : 0,
      body.allowComments === false ? 0 : 1,
      now,
      now,
    )
    .run();

  const video = (await getVideo(env, id))!;
  return json({ video: toJson(video, env, request), upload: await buildUploadPlan(env, request, video) }, 201);
}

/** POST /api/videos/:id/upload-urls — fresh URLs to resume/retry an upload. */
async function refreshUploadUrls(request: Request, env: AppEnv, account: Account, id: string): Promise<Response> {
  const video = await ownedVideo(env, account, id);
  if (video.status !== "uploading") throw new HttpError(409, "not_uploading", "Upload already completed.");
  const text = await request.text();
  let body: { partNumbers?: number[] } = {};
  try {
    if (text.trim()) body = JSON.parse(text);
  } catch {
    throw new HttpError(400, "invalid_json", "Request body must be valid JSON.");
  }
  const upload = await buildUploadPlan(env, request, video, body.partNumbers);
  return json({ video: toJson(video, env, request), upload });
}

/** POST /api/videos/:id/complete */
async function completeVideo(request: Request, env: AppEnv, account: Account, id: string): Promise<Response> {
  const video = await ownedVideo(env, account, id);
  if (video.status === "ready") return json({ video: toJson(video, env, request) });
  const body = await readJson<CompleteBody>(request);
  if (!Array.isArray(body.parts) || body.parts.length === 0) {
    throw new HttpError(400, "invalid_field", "parts must be a non-empty array.");
  }
  const parts = body.parts
    .map((p) => ({ partNumber: Number(p.partNumber), etag: String(p.etag ?? "").replace(/^W\//, "").replace(/"/g, "") }))
    .sort((a, b) => a.partNumber - b.partNumber);
  // A link reserved before recording finished learns these now.
  const meta = [optionalInt(body.durationMs, "durationMs"), optionalInt(body.width, "width"), optionalInt(body.height, "height")];

  try {
    await env.VIDEOS.resumeMultipartUpload(videoKey(id), video.upload_id!).complete(parts);
  } catch (err) {
    throw new HttpError(400, "complete_failed", `Could not complete upload: ${(err as Error).message}`);
  }

  const [object, thumb, gif] = await Promise.all([
    env.VIDEOS.head(videoKey(id)),
    env.VIDEOS.head(thumbnailKey(id)),
    hasValidGif(env, id),
  ]);
  if (!object) throw new HttpError(500, "complete_failed", "Upload completed but object is missing.");
  await env.DB.prepare(
    `UPDATE videos SET status = 'ready', upload_id = NULL, size_bytes = ?, has_thumbnail = ?, has_gif = ?, updated_at = ?,
       duration_ms = COALESCE(?, duration_ms), width = COALESCE(?, width), height = COALESCE(?, height) WHERE id = ?`,
  )
    .bind(
      object.size,
      thumb ? 1 : 0,
      gif ? 1 : 0,
      Date.now(),
      ...meta,
      id,
    )
    .run();
  return json({ video: toJson((await getVideo(env, id))!, env, request) });
}

/**
 * The proxied upload route checks the GIF magic bytes itself; direct-to-R2 uploads can't be inspected on the
 * way in, so check the first bytes here and drop anything that isn't a GIF.
 */
async function hasValidGif(env: AppEnv, id: string): Promise<boolean> {
  const obj = await env.VIDEOS.get(gifKey(id), { range: { offset: 0, length: 6 } });
  if (!obj) return false;
  const magic = new TextDecoder().decode(await obj.arrayBuffer());
  if (magic === "GIF87a" || magic === "GIF89a") return true;
  await env.VIDEOS.delete(gifKey(id));
  return false;
}

/** PATCH /api/videos/:id */
async function updateVideo(request: Request, env: AppEnv, account: Account, id: string): Promise<Response> {
  await ownedVideo(env, account, id);
  const body = await readJson<UpdateVideoBody>(request);
  const sets: string[] = [];
  const values: unknown[] = [];
  if (body.title !== undefined) sets.push("title = ?"), values.push(parseTitle(body.title));
  if (body.allowDownload !== undefined) {
    if (typeof body.allowDownload !== "boolean") throw new HttpError(400, "invalid_field", "allowDownload must be boolean.");
    sets.push("allow_download = ?"), values.push(body.allowDownload ? 1 : 0);
  }
  if (body.allowComments !== undefined) {
    if (typeof body.allowComments !== "boolean") throw new HttpError(400, "invalid_field", "allowComments must be boolean.");
    sets.push("allow_comments = ?"), values.push(body.allowComments ? 1 : 0);
  }
  const expiresAt = parseExpiresAt(body.expiresAt);
  if (expiresAt !== undefined) sets.push("expires_at = ?"), values.push(expiresAt);
  const passwordHash = await parsePassword(body.password);
  if (passwordHash !== undefined) sets.push("password_hash = ?"), values.push(passwordHash);
  if (sets.length > 0) {
    await env.DB.prepare(`UPDATE videos SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`)
      .bind(...values, Date.now(), id)
      .run();
  }
  return json({ video: toJson((await getVideo(env, id))!, env, request) });
}

/** DELETE /api/videos/:id — revokes the link immediately and deletes the files. */
async function deleteVideo(env: AppEnv, account: Account, id: string): Promise<Response> {
  const video = await ownedVideo(env, account, id);
  await purgeVideoFiles(env, video);
  const now = Date.now();
  await env.DB.prepare(
    "UPDATE videos SET status = 'deleted', upload_id = NULL, password_hash = NULL, deleted_at = ?, updated_at = ? WHERE id = ?",
  )
    .bind(now, now, id)
    .run();
  await deleteSocialData(env, id);
  return json({ ok: true });
}

export async function purgeVideoFiles(env: AppEnv, video: VideoRow): Promise<void> {
  if (video.status === "uploading" && video.upload_id) {
    await env.VIDEOS.resumeMultipartUpload(videoKey(video.id), video.upload_id)
      .abort()
      .catch(() => {});
  }
  await env.VIDEOS.delete([videoKey(video.id), thumbnailKey(video.id), gifKey(video.id)]);
}

/** GET /api/videos — the account's videos, newest first. */
async function listVideos(request: Request, env: AppEnv, account: Account): Promise<Response> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM videos WHERE account_id = ? AND status != 'deleted' ORDER BY created_at DESC LIMIT 200",
  )
    .bind(account.id)
    .all<VideoRow>();
  return json({ videos: results.map((v) => toJson(v, env, request)) });
}

export async function handleApi(request: Request, env: AppEnv, path: string): Promise<Response> {
  const account = await authenticate(request, env);
  const method = request.method;

  if (path === "/api/videos") {
    if (method === "POST") return createVideo(request, env, account);
    if (method === "GET") return listVideos(request, env, account);
  }
  const c = /^\/api\/videos\/([0-9A-Za-z]+)\/comments(?:\/([0-9A-Za-z]+))?$/.exec(path);
  if (c) {
    const video = await ownedVideo(env, account, c[1]!);
    if (method === "GET" && !c[2]) return ownerListComments(env, video);
    if (method === "DELETE" && c[2]) return ownerDeleteComment(env, video, c[2]);
  }
  const ins = /^\/api\/videos\/([0-9A-Za-z]+)\/insights$/.exec(path);
  if (ins && method === "GET") return videoInsights(env, await ownedVideo(env, account, ins[1]!));
  const m = /^\/api\/videos\/([0-9A-Za-z]+)(\/complete|\/upload-urls)?$/.exec(path);
  if (m) {
    const id = m[1]!;
    switch (`${method} ${m[2] ?? ""}`) {
      case "GET ":
        return json({ video: toJson(await ownedVideo(env, account, id), env, request) });
      case "PATCH ":
        return updateVideo(request, env, account, id);
      case "DELETE ":
        return deleteVideo(env, account, id);
      case "POST /complete":
        return completeVideo(request, env, account, id);
      case "POST /upload-urls":
        return refreshUploadUrls(request, env, account, id);
    }
  }
  throw new HttpError(404, "not_found", "No such endpoint.");
}
