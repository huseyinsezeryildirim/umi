import { type AppEnv, baseUrl } from "./env";

export type VideoStatus = "uploading" | "ready" | "deleted";

export interface VideoRow {
  id: string;
  account_id: string;
  title: string;
  status: VideoStatus;
  upload_id: string | null;
  content_type: string;
  size_bytes: number;
  duration_ms: number | null;
  width: number | null;
  height: number | null;
  has_thumbnail: number;
  password_hash: string | null;
  expires_at: number | null;
  allow_download: number;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

/** Shape returned to the owner (macOS app). */
export interface VideoJson {
  id: string;
  url: string;
  title: string;
  status: VideoStatus;
  contentType: string;
  sizeBytes: number;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  thumbnailUrl: string | null;
  allowDownload: boolean;
  hasPassword: boolean;
  expiresAt: string | null;
  expired: boolean;
  createdAt: string;
  updatedAt: string;
}

export async function getVideo(env: AppEnv, id: string): Promise<VideoRow | null> {
  if (!/^[0-9A-Za-z]{6,32}$/.test(id)) return null;
  return env.DB.prepare("SELECT * FROM videos WHERE id = ?").bind(id).first<VideoRow>();
}

export function isExpired(video: VideoRow, now = Date.now()): boolean {
  return video.expires_at !== null && video.expires_at <= now;
}

export function toJson(video: VideoRow, env: AppEnv, request: Request): VideoJson {
  const base = baseUrl(env, request);
  return {
    id: video.id,
    url: `${base}/v/${video.id}`,
    title: video.title,
    status: video.status,
    contentType: video.content_type,
    sizeBytes: video.size_bytes,
    durationMs: video.duration_ms,
    width: video.width,
    height: video.height,
    thumbnailUrl: video.has_thumbnail ? `${base}/v/${video.id}/thumbnail.jpg` : null,
    allowDownload: video.allow_download === 1,
    hasPassword: video.password_hash !== null,
    expiresAt: video.expires_at === null ? null : new Date(video.expires_at).toISOString(),
    expired: isExpired(video),
    createdAt: new Date(video.created_at).toISOString(),
    updatedAt: new Date(video.updated_at).toISOString(),
  };
}
