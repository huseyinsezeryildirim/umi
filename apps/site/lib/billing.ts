// Umi Pro through Paddle: the checkout opens over the page (Paddle.js); Umi Cloud hears about the
// subscription from Paddle and the account's plan follows it.
import { API, getToken } from "./account";

export type Cycle = "monthly" | "yearly";
export type BillingConfig =
  | { enabled: false }
  | { enabled: true; environment: "sandbox" | "production"; clientToken: string; prices: Record<Cycle, string> };
export type Subscription = { status: string; interval: "month" | "year" | null; renewsAt: string | null; cancelsAt: string | null };

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body?.error?.message ?? "Something went wrong."), { status: res.status });
  return body as T;
}

let config: Promise<BillingConfig> | null = null;
/** Whether Pro can be bought yet, and how. Off (and "launching soon") when the API can't say. */
export function billingConfig(): Promise<BillingConfig> {
  config ??= call<BillingConfig>("/api/billing/config").catch(() => ({ enabled: false }) as const);
  return config;
}

export async function subscription(): Promise<Subscription | null> {
  return (await call<{ subscription: Subscription | null }>("/api/billing")).subscription;
}

/** Paddle's page for cancelling, changing the card and invoices. */
export async function openPortal(): Promise<void> {
  const tab = window.open("", "_blank");
  try {
    const { url } = await call<{ url: string }>("/api/billing/portal", { method: "POST" });
    if (tab) tab.location.href = url;
    else location.assign(url);
  } catch (e) {
    tab?.close();
    throw e;
  }
}

type PaddleJs = {
  Environment: { set(env: string): void };
  Initialize(o: { token: string; eventCallback?: (e: { name: string }) => void }): void;
  Checkout: { open(o: unknown): void };
};

let paddle: Promise<PaddleJs> | null = null;
function loadPaddle(c: Extract<BillingConfig, { enabled: true }>, onEvent: (name: string) => void): Promise<PaddleJs> {
  paddle ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.paddle.com/paddle/v2/paddle.js";
    s.onload = () => {
      const P = (window as unknown as { Paddle: PaddleJs }).Paddle;
      if (c.environment === "sandbox") P.Environment.set("sandbox");
      P.Initialize({ token: c.clientToken, eventCallback: (e) => onEvent(e.name) });
      resolve(P);
    };
    s.onerror = () => reject(new Error("Couldn’t load the checkout. Check your connection and try again."));
    document.head.append(s);
  });
  return paddle;
}

/** Opens the checkout for the signed-in account. `onEvent` hears Paddle's events (checkout.completed, checkout.closed…). */
export async function openCheckout(cycle: Cycle, account: { id: string; email: string | null }, onEvent: (name: string) => void): Promise<void> {
  const c = await billingConfig();
  if (!c.enabled) throw new Error("Umi Pro isn’t on sale yet.");
  const P = await loadPaddle(c, onEvent);
  P.Checkout.open({
    items: [{ priceId: c.prices[cycle], quantity: 1 }],
    customer: account.email ? { email: account.email } : undefined,
    customData: { account_id: account.id },
    settings: { displayMode: "overlay", theme: "light", showAddDiscounts: false },
  });
}
