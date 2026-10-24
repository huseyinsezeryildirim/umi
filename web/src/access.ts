import type { AppEnv } from "./env";
import { hmacSign, hmacVerify } from "./crypto";
import { type VideoRow, getVideo, isExpired } from "./videos";

export type Access =
  | { state: "ok"; video: VideoRow }
  | { state: "locked"; video: VideoRow }
  | { state: "expired"; video: VideoRow }
  | { state: "processing"; video: VideoRow }
  | { state: "gone" }
  | { state: "not_found" };

const UNLOCK_TTL_MS = 24 * 60 * 60 * 1000;
const cookieName = (id: string) => `umi_unlock_${id}`;

// The password hash is part of the signed message, so changing or removing the password
// invalidates every unlock cookie issued before.
const unlockMessage = (video: VideoRow, exp: number) => `unlock:${video.id}:${exp}:${video.password_hash}`;

export async function resolveAccess(request: Request, env: AppEnv, id: string): Promise<Access> {
  const video = await getVideo(env, id);
  if (!video) return { state: "not_found" };
  if (video.status === "deleted") return { state: "gone" };
  if (isExpired(video)) return { state: "expired", video };
  if (video.status !== "ready") return { state: "processing", video };
  if (video.password_hash && !(await hasUnlockCookie(request, env, video))) return { state: "locked", video };
  return { state: "ok", video };
}

async function hasUnlockCookie(request: Request, env: AppEnv, video: VideoRow): Promise<boolean> {
  const cookies = request.headers.get("cookie") ?? "";
  const name = cookieName(video.id);
  // There can be two cookies with this name (Path=/v/:id from the page, Path=/ from an embed unlock).
  const values = cookies
    .split(/;\s*/)
    .filter((c) => c.startsWith(`${name}=`))
    .map((c) => c.slice(name.length + 1));
  for (const raw of values) {
    const [expStr, sig] = raw.split(".");
    const exp = Number(expStr);
    if (!exp || exp < Date.now() || !sig) continue;
    if (await hmacVerify(env.SIGNING_SECRET, unlockMessage(video, exp), sig)) return true;
  }
  return false;
}

/**
 * Page unlocks are scoped to /v/:id (page, media, comments, reactions all live there).
 * Embed unlocks (`embed: true`) happen inside a third-party iframe, so the cookie must cover /e/:id and
 * /v/:id/* (Path=/) and, on HTTPS, be `SameSite=None; Secure; Partitioned` (CHIPS) so browsers that block
 * third-party cookies still keep it — partitioned to the embedding site.
 */
export async function unlockCookie(
  request: Request,
  env: AppEnv,
  video: VideoRow,
  opts: { embed?: boolean } = {},
): Promise<string> {
  const exp = Date.now() + UNLOCK_TTL_MS;
  const sig = await hmacSign(env.SIGNING_SECRET, unlockMessage(video, exp));
  const https = new URL(request.url).protocol === "https:";
  const base = `${cookieName(video.id)}=${exp}.${sig}; Max-Age=${UNLOCK_TTL_MS / 1000}; HttpOnly`;
  if (opts.embed) {
    return `${base}; Path=/; ${https ? "SameSite=None; Secure; Partitioned" : "SameSite=Lax"}`;
  }
  return `${base}; Path=/v/${video.id}; SameSite=Lax${https ? "; Secure" : ""}`;
}
