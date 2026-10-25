import type { AppEnv } from "./env";
import { HttpError } from "./http";

/**
 * Counts one more `key` in a fixed window and refuses past `max` (sign-ups, new links,
 * reports: rare enough that a database row per key is fine).
 */
export async function throttle(env: AppEnv, key: string, max: number, windowMs: number): Promise<void> {
  const now = Date.now();
  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (key, count, window_start) VALUES (?1, 1, ?2)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN ?2 - window_start >= ?3 THEN 1 ELSE count + 1 END,
       window_start = CASE WHEN ?2 - window_start >= ?3 THEN ?2 ELSE window_start END
     RETURNING count, window_start`,
  )
    .bind(key, now, windowMs)
    .first<{ count: number; window_start: number }>();
  if (row && row.count > max) {
    const minutes = Math.max(1, Math.ceil((row.window_start + windowMs - now) / 60000));
    throw new HttpError(429, "rate_limited", `Too many requests. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`);
  }
}

/** The visitor's address (Cloudflare sets it; "local" in development). */
export const clientIp = (request: Request) => request.headers.get("cf-connecting-ip") ?? "local";

interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/**
 * Streaming requests per visitor and video (the `VIEW_LIMIT` binding in wrangler.jsonc, when
 * it's set up): stops one address from using a link as free bandwidth. Watching normally
 * stays far below it; the CDN cache answers repeat requests.
 */
export async function limitStreaming(env: AppEnv, request: Request, videoId: string): Promise<void> {
  const limiter = (env as unknown as { VIEW_LIMIT?: RateLimiter }).VIEW_LIMIT;
  if (!limiter) return;
  const { success } = await limiter.limit({ key: `${clientIp(request)}:${videoId}` });
  if (!success) throw new HttpError(429, "rate_limited", "Too many requests for this video. Try again in a minute.");
}
