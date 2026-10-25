// The visitor's Umi account: sign-up, sign-in and the session token, against the Umi Cloud API.
// The token is kept in this browser only (localStorage) and sent as a bearer token.

export const API = (process.env.NEXT_PUBLIC_UMI_API ?? "http://localhost:8799").replace(/\/+$/, "");
const KEY = "umi.session";

export type Account = { id: string; email: string | null; isPaid: boolean; emailVerified: boolean };

export function getToken(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(KEY, token);
    else localStorage.removeItem(KEY);
  } catch {
    // Private mode: signed in for this page only.
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...init.headers },
    });
  } catch {
    throw new Error("Can’t reach Umi right now. Check your connection and try again.");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body?.error?.message ?? "Something went wrong."), { status: res.status });
  return body as T;
}

export async function signUp(email: string, password: string): Promise<Account> {
  const r = await call<{ token: string; account: Account }>("/api/auth/signup", { method: "POST", body: JSON.stringify({ email, password }) });
  setToken(r.token);
  return r.account;
}

export async function signIn(email: string, password: string): Promise<Account> {
  const r = await call<{ token: string; account: Account }>("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
  setToken(r.token);
  return r.account;
}

/** The signed-in account, or null (a stale token is forgotten). */
export async function me(): Promise<Account | null> {
  if (!getToken()) return null;
  try {
    return (await call<{ account: Account }>("/api/auth/me")).account;
  } catch (e) {
    if ((e as { status?: number }).status === 401) setToken(null);
    throw e;
  }
}

export async function signOut() {
  await call("/api/auth/logout", { method: "POST" }).catch(() => {});
  setToken(null);
}

export async function verifyEmail(token: string) {
  await call("/api/auth/verify", { method: "POST", body: JSON.stringify({ token }) });
}

export async function resendVerification() {
  await call("/api/auth/resend-verification", { method: "POST" });
}

export async function forgotPassword(email: string) {
  await call("/api/auth/forgot", { method: "POST", body: JSON.stringify({ email }) });
}

export async function resetPassword(token: string, password: string): Promise<Account> {
  const r = await call<{ token: string; account: Account }>("/api/auth/reset", { method: "POST", body: JSON.stringify({ token, password }) });
  setToken(r.token);
  return r.account;
}
