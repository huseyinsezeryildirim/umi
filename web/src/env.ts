/** Worker env plus optional secrets that `wrangler types` can't see. */
export interface AppEnv extends Env {
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
}

export function baseUrl(env: AppEnv, request: Request): string {
  const configured = (env.PUBLIC_BASE_URL as string).replace(/\/+$/, "");
  return configured || new URL(request.url).origin;
}

export function partSize(env: AppEnv): number {
  return Number(env.PART_SIZE_BYTES) || 10 * 1024 * 1024;
}

export function maxUploadBytes(env: AppEnv): number {
  return Number(env.MAX_UPLOAD_BYTES) || 5 * 1024 * 1024 * 1024;
}

export const videoKey = (id: string) => `videos/${id}/video.mp4`;
export const thumbnailKey = (id: string) => `videos/${id}/thumbnail.jpg`;
export const gifKey = (id: string) => `videos/${id}/preview.gif`;

/** Upload URLs are valid this long; clients can re-request fresh ones to resume. */
export const UPLOAD_URL_TTL_MS = 6 * 60 * 60 * 1000;
/** Uploads not completed within this window are aborted by the cron cleanup. */
export const STALE_UPLOAD_MS = 24 * 60 * 60 * 1000;
/** Expired videos keep their files this long so the owner can still extend the link. */
export const EXPIRED_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_THUMBNAIL_BYTES = 5 * 1024 * 1024;
export const MAX_GIF_BYTES = 10 * 1024 * 1024;
