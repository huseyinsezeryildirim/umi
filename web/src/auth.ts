import type { AppEnv } from "./env";
import { hashPassword, randomId, sha256Hex, verifyPassword } from "./crypto";
import { HttpError, json, readJson } from "./http";
import { buttonEmail, sendEmail } from "./email";
import { type Entitlements, type Plan, entitlements, isPlan } from "./plans";
import { throttle } from "./limits";

export interface Account {
  id: string;
  email: string | null;
  is_paid: number;
  email_verified?: number;
  plan?: string;
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
    "SELECT a.id, a.email, a.is_paid, a.email_verified, a.plan FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = ?",
  )
    .bind(hash)
    .first<Account>();
  if (session) {
    await env.DB.prepare("UPDATE sessions SET last_used = ? WHERE token_hash = ?").bind(Date.now(), hash).run();
    return session;
  }
  const account = await env.DB.prepare("SELECT id, email, is_paid, email_verified, plan FROM accounts WHERE token_hash = ?").bind(hash).first<Account>();
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

function credentials(body: { email?: unknown; password?: unknown }, devName = false): { email: string; password: string } {
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  // Local development (DEV_TOOLS=1) also signs in seeded accounts by a short name, like "sezer".
  if (devName && /^[a-z0-9_.-]{2,32}$/.test(email)) return { email, password };
  if (!EMAIL.test(email) || email.length > 254) throw new HttpError(400, "invalid_email", "Enter a valid email address.");
  return { email, password };
}

const publicAccount = (a: Account) => ({
  id: a.id,
  email: a.email,
  isPaid: planOf(a) !== "free",
  emailVerified: a.email_verified === 1,
  plan: planOf(a),
  entitlements: entitlements(planOf(a)),
});

/** Links a lapsed paid account keeps before they go (time to export or renew). */
const DOWNGRADE_GRACE_DAYS = 30;

/**
 * Changes an account's plan (billing calls this too). Upgrading keeps the links the free plan
 * would have deleted after a week. Going back to Free (a subscription ended or was refunded)
 * gives links without an end date 30 days, so "pay a month, upload a lot, cancel" doesn't leave
 * storage behind for good; renewing in time keeps them.
 */
export async function setPlan(env: AppEnv, accountId: string, plan: Plan): Promise<void> {
  await env.DB.prepare("UPDATE accounts SET plan = ?, is_paid = ? WHERE id = ?").bind(plan, plan === "free" ? 0 : 1, accountId).run();
  const now = Date.now();
  if (entitlements(plan).linkDays === null) {
    await env.DB.prepare("UPDATE videos SET expires_at = NULL, plan_expiry = 0, updated_at = ? WHERE account_id = ? AND plan_expiry = 1 AND status != 'deleted'")
      .bind(now, accountId)
      .run();
  } else {
    await env.DB.prepare(
      "UPDATE videos SET expires_at = ?, plan_expiry = 1, updated_at = ? WHERE account_id = ? AND status != 'deleted' AND (expires_at IS NULL OR expires_at > ?)",
    )
      .bind(now + DOWNGRADE_GRACE_DAYS * 24 * 60 * 60 * 1000, now, accountId, now + DOWNGRADE_GRACE_DAYS * 24 * 60 * 60 * 1000)
      .run();
  }
}

/** The account's plan (older rows only have the paid flag). */
export const planOf = (a: Account): Plan => (isPlan(a.plan) ? a.plan : a.is_paid === 1 ? "pro" : "free");
export const can = (a: Account): Entitlements => entitlements(planOf(a));

// ───── Wrong-password limit ─────

const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_EMAIL = 8;
const MAX_PER_IP = 40;

/** Refuses a sign-in when this email or this address has failed too often in the last 15 minutes. */
async function checkLimit(env: AppEnv, keys: [string, number][]): Promise<void> {
  const now = Date.now();
  for (const [key, max] of keys) {
    const row = await env.DB.prepare("SELECT count, window_start FROM login_failures WHERE key = ?").bind(key).first<{ count: number; window_start: number }>();
    if (row && now - row.window_start < WINDOW_MS && row.count >= max) {
      const minutes = Math.ceil((row.window_start + WINDOW_MS - now) / 60000);
      throw new HttpError(429, "too_many_attempts", `Too many tries. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}, or reset your password.`);
    }
  }
}

async function recordFailure(env: AppEnv, keys: string[]): Promise<void> {
  const now = Date.now();
  for (const key of keys) {
    await env.DB.prepare(
      `INSERT INTO login_failures (key, count, window_start) VALUES (?1, 1, ?2)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE WHEN ?2 - window_start >= ?3 THEN 1 ELSE count + 1 END,
         window_start = CASE WHEN ?2 - window_start >= ?3 THEN ?2 ELSE window_start END`,
    )
      .bind(key, now, WINDOW_MS)
      .run();
  }
}

// ───── Emailed links ─────

const VERIFY_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;

async function emailToken(env: AppEnv, accountId: string, kind: "verify" | "reset", ttl: number): Promise<string> {
  const token = randomId(40);
  // One live link per purpose: a new email replaces the old link.
  await env.DB.prepare("DELETE FROM email_tokens WHERE account_id = ? AND kind = ?").bind(accountId, kind).run();
  await env.DB.prepare("INSERT INTO email_tokens (token_hash, account_id, kind, expires_at) VALUES (?, ?, ?, ?)")
    .bind(await sha256Hex(token), accountId, kind, Date.now() + ttl)
    .run();
  return token;
}

/** Spends a link's token; returns its account, or throws if it's wrong, used or expired. */
async function useToken(env: AppEnv, token: unknown, kind: "verify" | "reset"): Promise<string> {
  if (typeof token !== "string" || !token) throw new HttpError(400, "invalid_link", "This link isn't valid.");
  const hash = await sha256Hex(token);
  const row = await env.DB.prepare("SELECT account_id, expires_at, used_at FROM email_tokens WHERE token_hash = ? AND kind = ?")
    .bind(hash, kind)
    .first<{ account_id: string; expires_at: number; used_at: number | null }>();
  if (!row || row.used_at) throw new HttpError(400, "invalid_link", "This link has already been used or isn't valid. Ask for a new one.");
  if (row.expires_at < Date.now()) throw new HttpError(400, "expired_link", "This link has expired. Ask for a new one.");
  await env.DB.prepare("UPDATE email_tokens SET used_at = ? WHERE token_hash = ?").bind(Date.now(), hash).run();
  return row.account_id;
}

const site = (env: AppEnv) => String(env.SITE_URL || "https://umi.cam").replace(/\/+$/, "");

async function sendVerification(env: AppEnv, accountId: string, email: string): Promise<void> {
  const token = await emailToken(env, accountId, "verify", VERIFY_TTL_MS);
  const link = `${site(env)}/verify?token=${token}`;
  try {
    await sendEmail(env, buttonEmail(email, "Confirm your email for Umi", "Confirm this is your email to finish setting up your Umi account.", "Confirm email", link, "The link works for 3 days. If you didn't sign up for Umi, you can ignore this email."));
  } catch (e) {
    console.error("verification email failed", e);
  }
}

// ───── Routes ─────

/**
 * POST /api/auth/signup, login, logout, verify, resend-verification, forgot, reset; GET /api/auth/me.
 */
export async function handleAuth(request: Request, env: AppEnv, path: string): Promise<Response | null> {
  const method = request.method;
  if (path === "/api/auth/signup" && method === "POST") {
    const { email, password } = credentials(await readJson(request));
    checkPassword(password);
    // Accounts per address: free links can't be multiplied by signing up again and again.
    await throttle(env, `signup:${request.headers.get("cf-connecting-ip") ?? "local"}`, String(env.DEV_TOOLS ?? "") === "1" ? 100 : 5, 60 * 60 * 1000);
    const taken = await env.DB.prepare("SELECT 1 FROM accounts WHERE email = ?").bind(email).first();
    if (taken) throw new HttpError(409, "email_taken", "There's already an account with this email. Sign in instead.");
    const id = `acc_${randomId(16)}`;
    // token_hash is required by the original schema; a random value nobody holds.
    await env.DB.prepare("INSERT INTO accounts (id, email, token_hash, password_hash, is_paid, email_verified, created_at) VALUES (?, ?, ?, ?, 0, 0, ?)")
      .bind(id, email, await sha256Hex(randomId(40)), await hashPassword(password), Date.now())
      .run();
    await sendVerification(env, id, email);
    return json({ token: await newSession(env, id), account: publicAccount({ id, email, is_paid: 0, email_verified: 0, plan: "free" }) }, 201);
  }
  if (path === "/api/auth/login" && method === "POST") {
    const { email, password } = credentials(await readJson(request), String(env.DEV_TOOLS ?? "") === "1");
    const ip = request.headers.get("cf-connecting-ip") ?? "local";
    await checkLimit(env, [
      [`email:${email}`, MAX_PER_EMAIL],
      [`ip:${ip}`, MAX_PER_IP],
    ]);
    const row = await env.DB.prepare("SELECT id, email, is_paid, email_verified, plan, password_hash FROM accounts WHERE email = ?")
      .bind(email)
      .first<Account & { password_hash: string | null }>();
    // Same answer whether the email or the password is wrong.
    if (!row?.password_hash || !(await verifyPassword(password, row.password_hash))) {
      await recordFailure(env, [`email:${email}`, `ip:${ip}`]);
      throw new HttpError(401, "bad_credentials", "Wrong email or password.");
    }
    await env.DB.prepare("DELETE FROM login_failures WHERE key = ?").bind(`email:${email}`).run();
    return json({ token: await newSession(env, row.id), account: publicAccount(row) });
  }
  if (path === "/api/auth/logout" && method === "POST") {
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256Hex(bearer(request))).run();
    return json({ ok: true });
  }
  if (path === "/api/auth/me" && method === "GET") {
    return json({ account: publicAccount(await authenticate(request, env)) });
  }
  if (path === "/api/auth/verify" && method === "POST") {
    const token = (await readJson<{ token?: unknown }>(request)).token;
    // Opening the link twice (or a mail scanner opening it first) still confirms.
    if (typeof token === "string" && token) {
      const done = await env.DB.prepare(
        "SELECT 1 FROM email_tokens t JOIN accounts a ON a.id = t.account_id WHERE t.token_hash = ? AND t.kind = 'verify' AND t.used_at IS NOT NULL AND a.email_verified = 1",
      )
        .bind(await sha256Hex(token))
        .first();
      if (done) return json({ ok: true });
    }
    const accountId = await useToken(env, token, "verify");
    await env.DB.prepare("UPDATE accounts SET email_verified = 1 WHERE id = ?").bind(accountId).run();
    return json({ ok: true });
  }
  if (path === "/api/auth/resend-verification" && method === "POST") {
    const a = await authenticate(request, env);
    if (a.email && a.email_verified !== 1) await sendVerification(env, a.id, a.email);
    return json({ ok: true });
  }
  if (path === "/api/auth/forgot" && method === "POST") {
    const { email } = credentials({ ...(await readJson<{ email?: unknown }>(request)), password: "" });
    const row = await env.DB.prepare("SELECT id FROM accounts WHERE email = ?").bind(email).first<{ id: string }>();
    // The same answer either way, so nobody can find out who has an account.
    if (row) {
      const token = await emailToken(env, row.id, "reset", RESET_TTL_MS);
      try {
        await sendEmail(env, buttonEmail(email, "Reset your Umi password", "Someone asked to reset the password for your Umi account. If it was you, choose a new one.", "Choose a new password", `${site(env)}/reset?token=${token}`, "The link works for 1 hour. If you didn't ask, ignore this email; your password stays the same."));
      } catch (e) {
        console.error("reset email failed", e);
      }
    }
    return json({ ok: true });
  }
  if (path === "/api/auth/reset" && method === "POST") {
    const body = await readJson<{ token?: unknown; password?: unknown }>(request);
    const password = typeof body.password === "string" ? body.password : "";
    checkPassword(password);
    const accountId = await useToken(env, body.token, "reset");
    // A reset signs out every device and proves the email works.
    await env.DB.prepare("UPDATE accounts SET password_hash = ?, email_verified = 1 WHERE id = ?").bind(await hashPassword(password), accountId).run();
    await env.DB.prepare("DELETE FROM sessions WHERE account_id = ?").bind(accountId).run();
    const row = await env.DB.prepare("SELECT id, email, is_paid, email_verified, plan FROM accounts WHERE id = ?").bind(accountId).first<Account>();
    if (row?.email) await env.DB.prepare("DELETE FROM login_failures WHERE key = ?").bind(`email:${row.email}`).run();
    return json({ token: await newSession(env, accountId), account: publicAccount(row!) });
  }
  // Local development only (DEV_TOOLS=1 in .dev.vars): switch your own plan to try each one.
  if (path === "/api/auth/dev-plan" && method === "POST") {
    if (String(env.DEV_TOOLS ?? "") !== "1") throw new HttpError(404, "not_found", "Not found.");
    const a = await authenticate(request, env);
    const plan = (await readJson<{ plan?: unknown }>(request)).plan;
    if (!isPlan(plan)) throw new HttpError(400, "invalid_field", "plan must be free, pro or team.");
    await setPlan(env, a.id, plan);
    return json({ account: publicAccount({ ...a, plan, is_paid: plan === "free" ? 0 : 1 }) });
  }
  return null;
}

function checkPassword(password: string) {
  if (password.length < 8) throw new HttpError(400, "weak_password", "Use at least 8 characters.");
  if (password.length > 200) throw new HttpError(400, "weak_password", "That password is too long.");
}

/** Share links on Umi Cloud, if the plan has them. */
export function canShareToCloud(account: Account): boolean {
  return can(account).cloudLinks;
}

export function requirePaid(account: Account): void {
  if (!canShareToCloud(account)) {
    throw new HttpError(402, "payment_required", "Cloud sharing isn't part of your plan.");
  }
}

/** Shared workspaces are a Team feature. */
export function requireTeam(account: Account): void {
  if (!can(account).workspaces) throw new HttpError(402, "payment_required", "Shared workspaces are part of Umi Team.");
}
