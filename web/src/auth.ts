import type { AppEnv } from "./env";
import { hashPassword, randomId, sha256Hex, verifyPassword } from "./crypto";
import { HttpError, json, readJson } from "./http";

export interface Account {
  id: string;
  email: string | null;
  is_paid: number;
}

function bearer(request: Request): string {
  const match = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "");
  if (!match?.[1]) throw new HttpError(401, "unauthorized", "Missing bearer token.");
  return match[1];
}

/**
 * Bearer tokens: a session from signing in (one per device), or the account's own API token
 * (the desktop app and dev seeds). Both are stored only as SHA-256.
 */
export async function authenticate(request: Request, env: AppEnv): Promise<Account> {
  const hash = await sha256Hex(bearer(request));
  const session = await env.DB.prepare(
    "SELECT a.id, a.email, a.is_paid FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = ?",
  )
    .bind(hash)
    .first<Account>();
  if (session) {
    await env.DB.prepare("UPDATE sessions SET last_used = ? WHERE token_hash = ?").bind(Date.now(), hash).run();
    return session;
  }
  const account = await env.DB.prepare("SELECT id, email, is_paid FROM accounts WHERE token_hash = ?").bind(hash).first<Account>();
  if (!account) throw new HttpError(401, "unauthorized", "Invalid or expired sign-in.");
  return account;
}

// ───── Sign up, sign in, sign out ─────

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function newSession(env: AppEnv, accountId: string): Promise<string> {
  const token = `umi_${randomId(40)}`;
  const now = Date.now();
  await env.DB.prepare("INSERT INTO sessions (token_hash, account_id, created_at, last_used) VALUES (?, ?, ?, ?)")
    .bind(await sha256Hex(token), accountId, now, now)
    .run();
  return token;
}

function credentials(body: { email?: unknown; password?: unknown }): { email: string; password: string } {
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!EMAIL.test(email) || email.length > 254) throw new HttpError(400, "invalid_email", "Enter a valid email address.");
  return { email, password };
}

/** POST /api/auth/signup, /api/auth/login, /api/auth/logout; GET /api/auth/me. */
export async function handleAuth(request: Request, env: AppEnv, path: string): Promise<Response | null> {
  const method = request.method;
  if (path === "/api/auth/signup" && method === "POST") {
    const { email, password } = credentials(await readJson(request));
    if (password.length < 8) throw new HttpError(400, "weak_password", "Use at least 8 characters.");
    if (password.length > 200) throw new HttpError(400, "weak_password", "That password is too long.");
    const taken = await env.DB.prepare("SELECT 1 FROM accounts WHERE email = ?").bind(email).first();
    if (taken) throw new HttpError(409, "email_taken", "There's already an account with this email. Sign in instead.");
    const id = `acc_${randomId(16)}`;
    // token_hash is required by the original schema; a random value nobody holds.
    await env.DB.prepare("INSERT INTO accounts (id, email, token_hash, password_hash, is_paid, created_at) VALUES (?, ?, ?, ?, 0, ?)")
      .bind(id, email, await sha256Hex(randomId(40)), await hashPassword(password), Date.now())
      .run();
    return json({ token: await newSession(env, id), account: { id, email, isPaid: false } }, 201);
  }
  if (path === "/api/auth/login" && method === "POST") {
    const { email, password } = credentials(await readJson(request));
    const row = await env.DB.prepare("SELECT id, email, is_paid, password_hash FROM accounts WHERE email = ?")
      .bind(email)
      .first<Account & { password_hash: string | null }>();
    // Same answer whether the email or the password is wrong.
    if (!row?.password_hash || !(await verifyPassword(password, row.password_hash))) {
      throw new HttpError(401, "bad_credentials", "Wrong email or password.");
    }
    return json({ token: await newSession(env, row.id), account: { id: row.id, email: row.email, isPaid: row.is_paid === 1 } });
  }
  if (path === "/api/auth/logout" && method === "POST") {
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256Hex(bearer(request))).run();
    return json({ ok: true });
  }
  if (path === "/api/auth/me" && method === "GET") {
    const a = await authenticate(request, env);
    return json({ account: { id: a.id, email: a.email, isPaid: a.is_paid === 1 } });
  }
  return null;
}

/**
 * Hook for the paid-only cloud sharing rule. Local recording/editing is free; only uploads need a plan.
 * TODO(billing): check the account's subscription (e.g. via a Stripe/App Store webhook-maintained table)
 * instead of the `is_paid` flag, and add per-plan storage quotas here.
 */
export function canShareToCloud(account: Account): boolean {
  return account.is_paid === 1;
}

export function requirePaid(account: Account): void {
  if (!canShareToCloud(account)) {
    throw new HttpError(402, "payment_required", "Cloud sharing requires an Umi Cloud plan.");
  }
}
