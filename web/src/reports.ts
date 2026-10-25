import type { AppEnv } from "./env";
import { hmacSign, randomId } from "./crypto";
import { HttpError, json } from "./http";
import { sendEmail } from "./email";
import { clientIp, throttle } from "./limits";
import { getVideo } from "./videos";

const REASONS = ["spam", "abuse", "copyright", "illegal", "other"] as const;

/**
 * POST /v/:id/report — { reason, details? } from the viewer page. Reports wait in the moderation
 * panel (/adagiris) for a decision; nothing is hidden or deleted automatically.
 */
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
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM reports WHERE video_id = ? AND resolved_at IS NULL").bind(id).first<{ n: number }>();
  const n = count?.n ?? 0;
  const to = env.ABUSE_EMAIL;
  if (to) {
    await sendEmail(env, {
      to,
      subject: `Report (${reason}) on video ${id}`,
      html: "",
      text: `Video ${id} ("${video.title}") was reported: ${reason}.\n${details ?? ""}\nOpen reports on it: ${n}.\nDecide in the moderation panel: ${new URL("/adagiris", request.url).toString()}`,
    }).catch(() => {});
  }
  return json({ ok: true });
}
