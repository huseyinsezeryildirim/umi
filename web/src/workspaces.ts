// Team workspaces (Umi Cloud): create one, invite people with a code, put videos in it so
// everyone in the team sees them (and their insights), and share styles (presets).

import { type Account, requireTeam } from "./auth";
import { randomId } from "./crypto";
import type { AppEnv } from "./env";
import { HttpError, json, readJson } from "./http";
import { type VideoRow, getVideo, toJson } from "./videos";

type Role = "owner" | "member";

interface WorkspaceRow {
  id: string;
  name: string;
  owner_id: string;
  invite_code: string;
  created_at: number;
}

const MAX_NAME = 80;
const MAX_PRESET_BYTES = 64 * 1024;
const MAX_WORKSPACES = 20;

function parseName(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name || name.length > MAX_NAME) throw new HttpError(400, "invalid_field", `name must be 1–${MAX_NAME} characters.`);
  return name;
}

/** Long and random: an invite code is the only key to join. */
const inviteCode = () => randomId(20);

async function role(env: AppEnv, workspaceId: string, account: Account): Promise<Role | null> {
  const row = await env.DB.prepare("SELECT role FROM workspace_members WHERE workspace_id = ? AND account_id = ?")
    .bind(workspaceId, account.id)
    .first<{ role: Role }>();
  return row?.role ?? null;
}

/** The workspace, when `account` is in it (404 otherwise, so ids don't leak). */
async function memberOf(env: AppEnv, id: string, account: Account): Promise<{ workspace: WorkspaceRow; role: Role }> {
  const workspace = await env.DB.prepare("SELECT * FROM workspaces WHERE id = ?").bind(id).first<WorkspaceRow>();
  const r = workspace ? await role(env, id, account) : null;
  if (!workspace || !r) throw new HttpError(404, "not_found", "Workspace not found.");
  return { workspace, role: r };
}

async function workspaceJson(env: AppEnv, w: WorkspaceRow, r: Role) {
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM workspace_members WHERE workspace_id = ?").bind(w.id).first<{ n: number }>();
  return {
    id: w.id,
    name: w.name,
    role: r,
    members: count?.n ?? 1,
    // Only the owner can invite.
    inviteCode: r === "owner" ? w.invite_code : null,
    createdAt: new Date(w.created_at).toISOString(),
  };
}

/** Whether `account` may put a video in (or read videos of) `workspaceId`. */
export async function canUseWorkspace(env: AppEnv, workspaceId: string, account: Account): Promise<boolean> {
  return (await role(env, workspaceId, account)) !== null;
}

/** A video the account owns, or one in a workspace the account belongs to (read-only use). */
export async function visibleVideo(env: AppEnv, account: Account, id: string): Promise<VideoRow> {
  const video = await getVideo(env, id);
  const workspaceId = video?.workspace_id;
  const visible =
    video && video.status !== "deleted" && (video.account_id === account.id || (workspaceId ? await canUseWorkspace(env, workspaceId, account) : false));
  if (!visible) throw new HttpError(404, "not_found", "Video not found.");
  return video;
}

/** `workspaceId` field of a create/update body: undefined = unchanged, null = none. */
export async function parseWorkspaceId(env: AppEnv, account: Account, value: unknown): Promise<string | null | undefined> {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !(await canUseWorkspace(env, value, account))) {
    throw new HttpError(404, "not_found", "Workspace not found.");
  }
  return value;
}

export async function handleWorkspaces(request: Request, env: AppEnv, account: Account, path: string): Promise<Response | null> {
  const method = request.method;
  if (path === "/api/workspaces") {
    if (method === "GET") {
      const { results } = await env.DB.prepare(
        `SELECT w.*, m.role FROM workspaces w JOIN workspace_members m ON m.workspace_id = w.id
         WHERE m.account_id = ? ORDER BY w.created_at`,
      )
        .bind(account.id)
        .all<WorkspaceRow & { role: Role }>();
      return json({ workspaces: await Promise.all(results.map((w) => workspaceJson(env, w, w.role))) });
    }
    if (method === "POST") {
      requireTeam(account);
      const body = await readJson<{ name?: unknown }>(request);
      const name = parseName(body.name);
      const owned = await env.DB.prepare("SELECT COUNT(*) AS n FROM workspaces WHERE owner_id = ?").bind(account.id).first<{ n: number }>();
      if ((owned?.n ?? 0) >= MAX_WORKSPACES) throw new HttpError(409, "limit", "You already have the maximum number of workspaces.");
      const w: WorkspaceRow = { id: randomId(), name, owner_id: account.id, invite_code: inviteCode(), created_at: Date.now() };
      await env.DB.batch([
        env.DB.prepare("INSERT INTO workspaces (id, name, owner_id, invite_code, created_at) VALUES (?, ?, ?, ?, ?)").bind(
          w.id,
          w.name,
          w.owner_id,
          w.invite_code,
          w.created_at,
        ),
        env.DB.prepare("INSERT INTO workspace_members (workspace_id, account_id, role, joined_at) VALUES (?, ?, 'owner', ?)").bind(
          w.id,
          account.id,
          w.created_at,
        ),
      ]);
      return json({ workspace: await workspaceJson(env, w, "owner") }, 201);
    }
  }
  if (path === "/api/workspaces/join" && method === "POST") {
    requireTeam(account);
    const body = await readJson<{ code?: unknown }>(request);
    const code = typeof body.code === "string" ? body.code.trim() : "";
    const w = code ? await env.DB.prepare("SELECT * FROM workspaces WHERE invite_code = ?").bind(code).first<WorkspaceRow>() : null;
    if (!w) throw new HttpError(404, "not_found", "That invite code isn't valid (it may have been changed).");
    const existing = await role(env, w.id, account);
    if (!existing) {
      await env.DB.prepare("INSERT INTO workspace_members (workspace_id, account_id, role, joined_at) VALUES (?, ?, 'member', ?)")
        .bind(w.id, account.id, Date.now())
        .run();
    }
    return json({ workspace: await workspaceJson(env, w, existing ?? "member") });
  }

  const m = /^\/api\/workspaces\/([0-9A-Za-z]+)(?:\/(members|videos|presets|invite-code)(?:\/([0-9A-Za-z_-]+))?)?$/.exec(path);
  if (!m) return null;
  const { workspace, role: myRole } = await memberOf(env, m[1]!, account);
  const owner = myRole === "owner";
  const sub = m[2];
  const item = m[3];

  if (!sub) {
    if (method === "GET") {
      const { results } = await env.DB.prepare(
        `SELECT a.id, a.email, m.role, m.joined_at FROM workspace_members m JOIN accounts a ON a.id = m.account_id
         WHERE m.workspace_id = ? ORDER BY m.joined_at`,
      )
        .bind(workspace.id)
        .all<{ id: string; email: string | null; role: Role; joined_at: number }>();
      return json({
        workspace: await workspaceJson(env, workspace, myRole),
        members: results.map((r) => ({ id: r.id, email: r.email, role: r.role, joinedAt: new Date(r.joined_at).toISOString(), you: r.id === account.id })),
      });
    }
    if (method === "PATCH" && owner) {
      const body = await readJson<{ name?: unknown }>(request);
      await env.DB.prepare("UPDATE workspaces SET name = ? WHERE id = ?").bind(parseName(body.name), workspace.id).run();
      return json({ workspace: await workspaceJson(env, { ...workspace, name: parseName(body.name) }, myRole) });
    }
    if (method === "DELETE" && owner) {
      // Videos stay with their owners; they just leave the team.
      await env.DB.batch([
        env.DB.prepare("UPDATE videos SET workspace_id = NULL WHERE workspace_id = ?").bind(workspace.id),
        env.DB.prepare("DELETE FROM workspace_presets WHERE workspace_id = ?").bind(workspace.id),
        env.DB.prepare("DELETE FROM workspace_members WHERE workspace_id = ?").bind(workspace.id),
        env.DB.prepare("DELETE FROM workspaces WHERE id = ?").bind(workspace.id),
      ]);
      return json({ ok: true });
    }
    if (method === "PATCH" || method === "DELETE") throw new HttpError(403, "forbidden", "Only the workspace owner can do that.");
  }

  if (sub === "invite-code" && method === "POST") {
    if (!owner) throw new HttpError(403, "forbidden", "Only the workspace owner can change the invite code.");
    const code = inviteCode();
    await env.DB.prepare("UPDATE workspaces SET invite_code = ? WHERE id = ?").bind(code, workspace.id).run();
    return json({ workspace: await workspaceJson(env, { ...workspace, invite_code: code }, myRole) });
  }

  if (sub === "members" && item && method === "DELETE") {
    const leaving = item === account.id;
    if (!leaving && !owner) throw new HttpError(403, "forbidden", "Only the workspace owner can remove people.");
    if (item === workspace.owner_id) throw new HttpError(409, "owner", "The owner can't leave; delete the workspace instead.");
    // Their videos leave the team with them.
    await env.DB.batch([
      env.DB.prepare("UPDATE videos SET workspace_id = NULL WHERE workspace_id = ? AND account_id = ?").bind(workspace.id, item),
      env.DB.prepare("DELETE FROM workspace_members WHERE workspace_id = ? AND account_id = ?").bind(workspace.id, item),
    ]);
    return json({ ok: true });
  }

  if (sub === "videos" && !item && method === "GET") {
    const { results } = await env.DB.prepare(
      `SELECT v.*, a.email AS owner_email FROM videos v JOIN accounts a ON a.id = v.account_id
       WHERE v.workspace_id = ? AND v.status = 'ready' ORDER BY v.created_at DESC LIMIT 500`,
    )
      .bind(workspace.id)
      .all<VideoRow & { owner_email: string | null }>();
    return json({
      videos: results.map((v) => ({ ...toJson(v, env, request), owner: v.owner_email, yours: v.account_id === account.id })),
    });
  }

  if (sub === "presets") {
    if (!item && method === "GET") {
      const { results } = await env.DB.prepare(
        `SELECT p.id, p.name, p.data, p.updated_at, a.email FROM workspace_presets p JOIN accounts a ON a.id = p.updated_by
         WHERE p.workspace_id = ? ORDER BY p.name`,
      )
        .bind(workspace.id)
        .all<{ id: string; name: string; data: string; updated_at: number; email: string | null }>();
      return json({
        presets: results.map((p) => ({ id: p.id, name: p.name, edit: JSON.parse(p.data), updatedBy: p.email, updatedAt: new Date(p.updated_at).toISOString() })),
      });
    }
    if (item && method === "PUT") {
      if (Number(request.headers.get("content-length")) > MAX_PRESET_BYTES + 1024) throw new HttpError(413, "too_large", "That style is too big.");
      const body = await readJson<{ name?: unknown; edit?: unknown }>(request);
      const data = JSON.stringify(body.edit ?? null);
      if (typeof body.edit !== "object" || body.edit === null || data.length > MAX_PRESET_BYTES) {
        throw new HttpError(400, "invalid_field", "edit must be the style's settings object.");
      }
      await env.DB.prepare(
        `INSERT INTO workspace_presets (workspace_id, id, name, data, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(workspace_id, id) DO UPDATE SET name = excluded.name, data = excluded.data, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
      )
        .bind(workspace.id, item, parseName(body.name), data, account.id, Date.now())
        .run();
      return json({ ok: true });
    }
    if (item && method === "DELETE") {
      await env.DB.prepare("DELETE FROM workspace_presets WHERE workspace_id = ? AND id = ?").bind(workspace.id, item).run();
      return json({ ok: true });
    }
  }
  throw new HttpError(404, "not_found", "No such endpoint.");
}
