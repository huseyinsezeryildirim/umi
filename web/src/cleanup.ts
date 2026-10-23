import { type AppEnv, EXPIRED_GRACE_MS, STALE_UPLOAD_MS } from "./env";
import { purgeVideoFiles } from "./api";
import type { VideoRow } from "./videos";

/**
 * Cron: free storage for links nobody can watch anymore.
 * - uploads never completed within STALE_UPLOAD_MS → abort multipart, drop thumbnail
 * - expired more than EXPIRED_GRACE_MS ago → delete files (the grace period lets owners extend a link)
 */
export async function cleanup(env: AppEnv): Promise<{ purged: number }> {
  const now = Date.now();
  const { results } = await env.DB.prepare(
    `SELECT * FROM videos
     WHERE (status = 'uploading' AND updated_at < ?)
        OR (status = 'ready' AND expires_at IS NOT NULL AND expires_at < ?)
     LIMIT 200`,
  )
    .bind(now - STALE_UPLOAD_MS, now - EXPIRED_GRACE_MS)
    .all<VideoRow>();

  for (const video of results) {
    await purgeVideoFiles(env, video);
    await env.DB.prepare(
      "UPDATE videos SET status = 'deleted', upload_id = NULL, password_hash = NULL, deleted_at = ?, updated_at = ? WHERE id = ?",
    )
      .bind(now, now, video.id)
      .run();
  }
  return { purged: results.length };
}
