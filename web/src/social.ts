import type { AppEnv } from "./env";
import { type Access, resolveAccess } from "./access";
import { hmacSign, randomId } from "./crypto";
import { HttpError, json, readJson } from "./http";
import type { VideoRow } from "./videos";

/** Reactions a viewer can leave. Order = order of the bar on the page. */
export const REACTION_EMOJIS = ["👍", "❤️", "😂", "😮", "🎉", "👏"] as const;
export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];

export const MAX_AUTHOR_NAME = 60;
export const MAX_COMMENT_BODY = 2000;

/**
 * Abuse limits, counted per (video, client IP) straight from D1 — no KV/Durable Object needed.
 * The IP is stored only as an HMAC (`ip_hash`), never in clear. Counting then inserting is not atomic,
 * so a burst of parallel requests can overshoot by a few; that's fine for a spam brake. For real
 * protection in production, add a Workers Rate Limiting binding or Turnstile in front of these routes.
 */
export const COMMENT_LIMIT = { max: 10, windowMs: 10 * 60 * 1000 };
export const REACTION_LIMIT = { max: 30, windowMs: 60 * 1000 };
/** Markers drawn on the timeline (newest N reactions). Counts always cover all reactions. */
const MAX_REACTION_MARKERS = 500;

interface CommentRow {
  id: string;
  video_id: string;
  author_name: string;
  body: string;
  time_ms: number | null;
  created_at: number;
  deleted_at: number | null;
}

export interface CommentJson {
  id: string;
  authorName: string;
  body: string;
  timeMs: number | null;
  createdAt: string;
}

export interface ReactionSummary {
  counts: Record<string, number>;
  reactions: { emoji: string; timeMs: number }[];
}

const toCommentJson = (c: CommentRow): CommentJson => ({
  id: c.id,
  authorName: c.author_name,
  body: c.body,
  timeMs: c.time_ms,
  createdAt: new Date(c.created_at).toISOString(),
});

export async function listComments(env: AppEnv, videoId: string): Promise<CommentJson[]> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM comments WHERE video_id = ? AND deleted_at IS NULL ORDER BY created_at ASC, id ASC LIMIT 1000",
  )
    .bind(videoId)
    .all<CommentRow>();
  return results.map(toCommentJson);
}

export async function reactionSummary(env: AppEnv, videoId: string): Promise<ReactionSummary> {
  const [counts, markers] = await env.DB.batch([
    env.DB.prepare("SELECT emoji, COUNT(*) AS n FROM reactions WHERE video_id = ? GROUP BY emoji").bind(videoId),
    env.DB.prepare("SELECT emoji, time_ms FROM reactions WHERE video_id = ? ORDER BY created_at DESC LIMIT ?").bind(
      videoId,
      MAX_REACTION_MARKERS,
    ),
  ]);
  const out: Record<string, number> = Object.fromEntries(REACTION_EMOJIS.map((e) => [e, 0]));
  for (const r of (counts?.results ?? []) as { emoji: string; n: number }[]) out[r.emoji] = r.n;
  return {
    counts: out,
    reactions: ((markers?.results ?? []) as { emoji: string; time_ms: number }[])
      .map((r) => ({ emoji: r.emoji, timeMs: r.time_ms }))
      .reverse(),
  };
}

/** Comments + reactions for a viewable video (also inlined into the viewer page). */
export async function socialState(env: AppEnv, video: VideoRow) {
  const [comments, reactions] = await Promise.all([
    video.allow_comments === 1 ? listComments(env, video.id) : Promise.resolve([]),
    reactionSummary(env, video.id),
  ]);
  return { allowComments: video.allow_comments === 1, comments, reactions };
}

// ------------------------------------------------------------------ public (viewer) endpoints

/** Same rules as the player: password (unlock cookie), expiry, revoked, still uploading. */
export async function viewableVideo(request: Request, env: AppEnv, id: string): Promise<VideoRow> {
  const access: Access = await resolveAccess(request, env, id);
  switch (access.state) {
    case "ok":
      return access.video;
    case "locked":
      throw new HttpError(401, "locked", "This video is password-protected.");
    case "expired":
      throw new HttpError(410, "expired", "This link has expired.");
    case "gone":
      throw new HttpError(410, "gone", "This video was removed.");
    case "review":
      throw new HttpError(451, "under_review", "This video is under review.");
    case "processing":
      throw new HttpError(409, "processing", "This video is still uploading.");
    default:
      throw new HttpError(404, "not_found", "Video not found.");
  }
}

async function readViewerJson<T>(request: Request): Promise<T> {
  // Requiring application/json forces a CORS preflight for cross-site requests (which we never approve),
  // so other sites can't post comments/reactions with a viewer's unlock cookie.
  if (!/^application\/json\b/i.test(request.headers.get("content-type") ?? "")) {
    throw new HttpError(415, "unsupported_media_type", "Send JSON with Content-Type: application/json.");
  }
  if (Number(request.headers.get("content-length")) > 16 * 1024) {
    throw new HttpError(413, "too_large", "Request body is too large.");
  }
  return readJson<T>(request);
}

async function clientHash(request: Request, env: AppEnv): Promise<string> {
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  return (await hmacSign(env.SIGNING_SECRET, `ip:${ip}`)).slice(0, 22);
}

async function enforceLimit(
  env: AppEnv,
  table: "comments" | "reactions",
  videoId: string,
  ipHash: string,
  limit: { max: number; windowMs: number },
): Promise<void> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM ${table} WHERE video_id = ? AND ip_hash = ? AND created_at > ?`,
  )
    .bind(videoId, ipHash, Date.now() - limit.windowMs)
    .first<{ n: number }>();
  if ((row?.n ?? 0) >= limit.max) {
    throw new HttpError(429, "rate_limited", "Too many requests. Please slow down and try again in a few minutes.");
  }
}

/** Trim, collapse control characters (keeping newlines in bodies), cap by code points. */
function cleanText(value: unknown, field: string, max: number, multiline: boolean): string {
  if (typeof value !== "string") throw new HttpError(400, "invalid_field", `${field} must be a string.`);
  const cleaned = value
    .replace(/\r\n?/g, "\n")
    .replace(multiline ? /[\u0000-\u0009\u000B-\u001F\u007F]/g : /[\u0000-\u001F\u007F]/g, multiline ? "" : " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!cleaned) throw new HttpError(400, "invalid_field", `${field} must not be empty.`);
  if ([...cleaned].length > max) throw new HttpError(400, "invalid_field", `${field} must be at most ${max} characters.`);
  return cleaned;
}

function parseTimeMs(value: unknown, video: VideoRow, required: boolean): number | null {
  if (value === undefined || value === null) {
    if (required) throw new HttpError(400, "invalid_field", "timeMs is required.");
    return null;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new HttpError(400, "invalid_field", "timeMs must be a non-negative number of milliseconds.");
  }
  const cap = video.duration_ms ? video.duration_ms + 1000 : 24 * 60 * 60 * 1000;
  if (value > cap) throw new HttpError(400, "invalid_field", "timeMs is past the end of the video.");
  return Math.round(value);
}

/** GET /v/:id/comments */
export async function getComments(request: Request, env: AppEnv, id: string): Promise<Response> {
  const video = await viewableVideo(request, env, id);
  return json({
    allowComments: video.allow_comments === 1,
    comments: video.allow_comments === 1 ? await listComments(env, id) : [],
  });
}

/** POST /v/:id/comments  { authorName, body, timeMs? } */
export async function postComment(request: Request, env: AppEnv, id: string): Promise<Response> {
  const video = await viewableVideo(request, env, id);
  if (video.allow_comments !== 1) throw new HttpError(403, "comments_disabled", "Comments are turned off for this video.");
  const input = await readViewerJson<{ authorName?: unknown; body?: unknown; timeMs?: unknown }>(request);
  const authorName = cleanText(input.authorName, "authorName", MAX_AUTHOR_NAME, false);
  const body = cleanText(input.body, "body", MAX_COMMENT_BODY, true);
  const timeMs = parseTimeMs(input.timeMs, video, false);
  const ipHash = await clientHash(request, env);
  await enforceLimit(env, "comments", id, ipHash, COMMENT_LIMIT);

  const row: CommentRow = {
    id: randomId(16),
    video_id: id,
    author_name: authorName,
    body,
    time_ms: timeMs,
    created_at: Date.now(),
    deleted_at: null,
  };
  await env.DB.prepare(
    "INSERT INTO comments (id, video_id, author_name, body, time_ms, ip_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(row.id, id, authorName, body, timeMs, ipHash, row.created_at)
    .run();
  return json({ comment: toCommentJson(row) }, 201);
}

/** GET /v/:id/reactions */
export async function getReactions(request: Request, env: AppEnv, id: string): Promise<Response> {
  await viewableVideo(request, env, id);
  return json(await reactionSummary(env, id));
}

/** POST /v/:id/reactions  { emoji, timeMs } */
export async function postReaction(request: Request, env: AppEnv, id: string): Promise<Response> {
  const video = await viewableVideo(request, env, id);
  const input = await readViewerJson<{ emoji?: unknown; timeMs?: unknown }>(request);
  // Accept the heart with or without the emoji variation selector.
  const emoji = input.emoji === "❤" ? "❤️" : input.emoji;
  if (typeof emoji !== "string" || !(REACTION_EMOJIS as readonly string[]).includes(emoji)) {
    throw new HttpError(400, "invalid_field", `emoji must be one of ${REACTION_EMOJIS.join(" ")}.`);
  }
  const timeMs = parseTimeMs(input.timeMs, video, true)!;
  const ipHash = await clientHash(request, env);
  await enforceLimit(env, "reactions", id, ipHash, REACTION_LIMIT);

  const now = Date.now();
  await env.DB.prepare("INSERT INTO reactions (id, video_id, emoji, time_ms, ip_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(randomId(16), id, emoji, timeMs, ipHash, now)
    .run();
  const { counts } = await reactionSummary(env, id);
  return json({ reaction: { emoji, timeMs, createdAt: new Date(now).toISOString() }, counts }, 201);
}

// ------------------------------------------------------------------ owner endpoints (called from api.ts)

/** GET /api/videos/:id/comments — includes comments while commenting is turned off. */
export async function ownerListComments(env: AppEnv, video: VideoRow): Promise<Response> {
  const [comments, reactions] = await Promise.all([listComments(env, video.id), reactionSummary(env, video.id)]);
  return json({ comments, reactionCounts: reactions.counts });
}

/** DELETE /api/videos/:id/comments/:commentId — soft delete. */
export async function ownerDeleteComment(env: AppEnv, video: VideoRow, commentId: string): Promise<Response> {
  const res = await env.DB.prepare(
    "UPDATE comments SET deleted_at = ? WHERE id = ? AND video_id = ? AND deleted_at IS NULL",
  )
    .bind(Date.now(), commentId, video.id)
    .run();
  if (!res.meta.changes) throw new HttpError(404, "not_found", "Comment not found.");
  return json({ ok: true });
}

/** Drop viewer-generated data when a video is revoked or purged. */
export async function deleteSocialData(env: AppEnv, videoId: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM comments WHERE video_id = ?").bind(videoId),
    env.DB.prepare("DELETE FROM reactions WHERE video_id = ?").bind(videoId),
    env.DB.prepare("DELETE FROM views WHERE video_id = ?").bind(videoId),
  ]);
}
