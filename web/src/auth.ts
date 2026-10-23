import type { AppEnv } from "./env";
import { sha256Hex } from "./crypto";
import { HttpError } from "./http";

export interface Account {
  id: string;
  email: string | null;
  is_paid: number;
}

/**
 * Stub auth: one opaque API token per account, stored as SHA-256 in D1.
 * TODO(accounts): replace with real sign-in (e.g. Sign in with Apple → session → per-device tokens)
 * once accounts and billing exist. The macOS app only needs to send `Authorization: Bearer <token>`.
 */
export async function authenticate(request: Request, env: AppEnv): Promise<Account> {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  if (!match?.[1]) throw new HttpError(401, "unauthorized", "Missing bearer token.");
  const account = await env.DB.prepare("SELECT id, email, is_paid FROM accounts WHERE token_hash = ?")
    .bind(await sha256Hex(match[1]))
    .first<Account>();
  if (!account) throw new HttpError(401, "unauthorized", "Invalid API token.");
  return account;
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
