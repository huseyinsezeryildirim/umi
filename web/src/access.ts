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
  const raw = cookies
    .split(/;\s*/)
    .find((c) => c.startsWith(`${name}=`))
    ?.slice(name.length + 1);
  if (!raw) return false;
  const [expStr, sig] = raw.split(".");
  const exp = Number(expStr);
  if (!exp || exp < Date.now() || !sig) return false;
  return hmacVerify(env.SIGNING_SECRET, unlockMessage(video, exp), sig);
}

export async function unlockCookie(request: Request, env: AppEnv, video: VideoRow): Promise<string> {
  const exp = Date.now() + UNLOCK_TTL_MS;
  const sig = await hmacSign(env.SIGNING_SECRET, unlockMessage(video, exp));
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${cookieName(video.id)}=${exp}.${sig}; Path=/v/${video.id}; Max-Age=${UNLOCK_TTL_MS / 1000}; HttpOnly; SameSite=Lax${secure}`;
}
