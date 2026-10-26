"use client";

import { useEffect, useState } from "react";
import { type Account, me } from "@/lib/account";
import { type Cycle, billingConfig, openCheckout, openPortal } from "@/lib/billing";
import { Shell } from "./AuthForm";

const PRICE: Record<Cycle, string> = { monthly: "$12 a month", yearly: "$96 a year ($8 a month)" };

/**
 * /upgrade?cycle=yearly: signs in if needed, then opens Paddle's checkout. Paddle tells Umi Cloud
 * about the payment, so after paying we wait for the account to turn Pro.
 */
export function Upgrade() {
  const [cycle, setCycle] = useState<Cycle>("yearly");
  const [account, setAccount] = useState<Account | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "off" | "paying" | "done" | "already">("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const c: Cycle = params.get("cycle") === "monthly" ? "monthly" : "yearly";
    setCycle(c);
    void (async () => {
      const config = await billingConfig();
      if (!config.enabled) return setState("off");
      const a = await me().catch(() => null);
      if (!a) return location.replace(`/signup?next=${encodeURIComponent(`/upgrade?cycle=${c}`)}`);
      setAccount(a);
      if (a.plan !== "free") return setState("already");
      setState("ready");
      void start(c, a);
    })();
  }, []);

  const start = async (c: Cycle, a: Account) => {
    setError("");
    try {
      await openCheckout(c, a, (name) => {
        if (name === "checkout.completed") {
          setState("paying");
          void waitForPro();
        }
      });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // The webhook usually lands within seconds.
  const waitForPro = async () => {
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const a = await me().catch(() => null);
      if (a && a.plan !== "free") return setState("done");
    }
    setState("done");
  };

  if (state === "off")
    return (
      <Shell title="Umi Pro is coming soon" lead="Until then, everything on your computer is free, and so are 3 share links at a time.">
        <a href="/app" className="btn-dark mt-6 inline-flex">Open Umi</a>
      </Shell>
    );
  if (state === "already")
    return (
      <Shell title="You’re on Pro" lead="Your links stay up and insights are on. You can cancel or change your card any time.">
        <div className="mt-6 flex flex-wrap gap-2">
          <a href="/app" className="btn-dark inline-flex">Open Umi</a>
          <button type="button" onClick={() => void openPortal().catch((e) => setError(e.message))} className="h-11 rounded-xl px-4 text-[15px] font-medium shadow-[0_0_0_1px_rgb(17_24_39/0.12)]">
            Manage subscription
          </button>
        </div>
        {error && <p className="mt-3 text-[14px] text-[#b42318]">{error}</p>}
      </Shell>
    );
  if (state === "paying" || state === "done")
    return (
      <Shell title={state === "done" ? "Welcome to Umi Pro" : "Finishing up…"} lead={state === "done" ? "Thanks! Your links now stay up, with insights and passwords. A receipt is on its way from Paddle." : "Payment received. Turning on Pro for your account."}>
        {state === "done" && <a href="/app" className="btn-dark mt-6 inline-flex">Open Umi</a>}
      </Shell>
    );
  return (
    <Shell title="Upgrade to Umi Pro" lead={`${PRICE[cycle]}. Links that stay up, 200 GB, insights and passwords. Cancel any time; full refund within 14 days.`}>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button type="button" disabled={!account} onClick={() => account && void start(cycle, account)} className="btn-dark inline-flex disabled:opacity-60">
          {state === "loading" ? "Loading…" : "Continue to payment"}
        </button>
        <button type="button" onClick={() => setCycle(cycle === "yearly" ? "monthly" : "yearly")} className="text-[14px] font-medium text-accent">
          {cycle === "yearly" ? "Pay monthly instead" : "Pay yearly and save 33%"}
        </button>
      </div>
      {error && <p className="mt-3 text-[14px] text-[#b42318]">{error}</p>}
      <p className="mt-6 text-[12px] text-faint">
        Payments are handled by Paddle, our reseller. See the <a className="underline" href="/terms">Terms</a> and <a className="underline" href="/refunds">Refund Policy</a>.
      </p>
    </Shell>
  );
}
