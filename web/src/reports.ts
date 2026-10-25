import type { AppEnv } from "./env";
import { hmacSign, randomId } from "./crypto";
import { HttpError, json } from "./http";
import { sendEmail } from "./email";
import { clientIp, throttle } from "./limits";
import { getVideo } from "./videos";

const REASONS = ["spam", "abuse", "copyright", "illegal", "other"] as const;
/**
 * Different people reporting a video before it's hidden for review: 2 for illegal content, 3
 * otherwise. Never one, so a single person (a rival, a troll) can't take a video down.
 */
const HIDE_AFTER = 3;
const HIDE_AFTER_ILLEGAL = 2;

/** POST /v/:id/report — { reason, details? } from the viewer page. */
export async function postReport(request: Request, env: AppEnv, id: string): Promise<Response> {
  if (!/^application\/json\b/i.test(request.headers.get("content-type") ?? "")) {
    throw new HttpError(415, "unsupported_media_type", "Send JSON with Content-Type: application/json.");
  }
  const body = (await request.json().catch(() => ({}))) as { reason?: unknown; details?: unknown };
  const reason = REASONS.find((r) => r === body.reason);
  if (!reason) throw new HttpError(400, "invalid_field", `reason must be one of: ${REASONS.join(", ")}.`);
  const details = typeof body.details === "string" ? body.details.trim().slice(0, 1000) : null;
  const video = await getVideo(env, id);
  if (!video || video.status === "deleted") throw new HttpError(404, "not_found", "Video not found.");

  const ip = clientIp(request);
  await throttle(env, `report:${ip}`, 10, 60 * 60 * 1000);
  const ipHash = (await hmacSign(env.SIGNING_SECRET, `ip:${ip}`)).slice(0, 22);
  const now = Date.now();
  // One report per person and video (a second one changes nothing).
  await env.DB.prepare("INSERT OR IGNORE INTO reports (id, video_id, reason, details, ip_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(randomId(), id, reason, details || null, ipHash, now)
    .run();
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM reports WHERE video_id = ?").bind(id).first<{ n: number }>();
  const n = count?.n ?? 0;
  const illegal = await env.DB.prepare("SELECT COUNT(*) AS n FROM reports WHERE video_id = ? AND reason = 'illegal'").bind(id).first<{ n: number }>();
  const hide = n >= HIDE_AFTER || (illegal?.n ?? 0) >= HIDE_AFTER_ILLEGAL;
  if (!video.flagged_at && hide) {
    await env.DB.prepare("UPDATE videos SET flagged_at = ? WHERE id = ? AND flagged_at IS NULL").bind(now, id).run();
  }
  const to = env.ABUSE_EMAIL;
  if (to) {
    await sendEmail(env, {
      to,
      subject: `Report (${reason}) on video ${id}`,
      html: "",
      text: `Video ${id} ("${video.title}") was reported: ${reason}.\n${details ?? ""}\nReports so far: ${n}.\nHidden for review: ${video.flagged_at || hide ? "yes" : "no"}.`,
    }).catch(() => {});
  }
  return json({ ok: true });
}
