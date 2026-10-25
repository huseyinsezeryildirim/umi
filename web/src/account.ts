// Deleting an account and everything it holds (the right to erasure under GDPR / KVKK).
import { type Account, authenticate } from "./auth";
import { purgeVideoFiles } from "./api";
import type { AppEnv } from "./env";
import { verifyPassword } from "./crypto";
import { HttpError, json, readJson } from "./http";
import { deleteSocialData } from "./social";
import type { VideoRow } from "./videos";

/**
 * DELETE /api/auth/account { password } — removes the account at once: its videos and their files,
 * comments, reactions and views, its sessions and links, and workspaces it owns. Videos other
 * people put in those workspaces stay theirs.
 */
export async function deleteAccount(request: Request, env: AppEnv): Promise<Response> {
  const account: Account = await authenticate(request, env);
  const { password } = await readJson<{ password?: unknown }>(request);
  const row = await env.DB.prepare("SELECT password_hash FROM accounts WHERE id = ?").bind(account.id).first<{ password_hash: string | null }>();
  if (row?.password_hash && !(typeof password === "string" && (await verifyPassword(password, row.password_hash)))) {
    throw new HttpError(403, "bad_credentials", "That password isn't right.");
  }

  const { results: videos } = await env.DB.prepare("SELECT * FROM videos WHERE account_id = ?").bind(account.id).all<VideoRow>();
  for (const v of videos) {
    if (v.status !== "deleted") await purgeVideoFiles(env, v);
    await deleteSocialData(env, v.id);
  }

  const owned = (await env.DB.prepare("SELECT id FROM workspaces WHERE owner_id = ?").bind(account.id).all<{ id: string }>()).results.map((w) => w.id);
  const db = env.DB;
  const steps = [
    ...owned.flatMap((id) => [
      db.prepare("UPDATE videos SET workspace_id = NULL WHERE workspace_id = ?").bind(id),
      db.prepare("DELETE FROM workspace_presets WHERE workspace_id = ?").bind(id),
      db.prepare("DELETE FROM workspace_members WHERE workspace_id = ?").bind(id),
      db.prepare("DELETE FROM workspaces WHERE id = ?").bind(id),
    ]),
    // Presets this person saved in other people's workspaces are kept, credited to the owner.
    db.prepare("UPDATE workspace_presets SET updated_by = (SELECT owner_id FROM workspaces w WHERE w.id = workspace_presets.workspace_id) WHERE updated_by = ?").bind(account.id),
    db.prepare("DELETE FROM workspace_members WHERE account_id = ?").bind(account.id),
    db.prepare("DELETE FROM videos WHERE account_id = ?").bind(account.id),
    db.prepare("DELETE FROM sessions WHERE account_id = ?").bind(account.id),
    db.prepare("DELETE FROM email_tokens WHERE account_id = ?").bind(account.id),
    db.prepare("DELETE FROM login_failures WHERE key = ?").bind(`email:${account.email}`),
    db.prepare("DELETE FROM accounts WHERE id = ?").bind(account.id),
  ];
  await db.batch(steps);
  return json({ ok: true });
}
