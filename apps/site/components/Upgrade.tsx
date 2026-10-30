"use client";

import { useEffect, useState } from "react";
import { type Account, me } from "@/lib/account";
import { type Cycle, billingConfig, openCheckout, openPortal } from "@/lib/billing";
import { Shell } from "./AuthForm";
import { Mark } from "./ui";

const PRICE: Record<Cycle, string> = { monthly: "$12 a month", yearly: "$96 a year ($8 a month)" };
// Prices are before tax: where the buyer's country has VAT or sales tax, Paddle adds it at checkout.

/**
 * /upgrade?cycle=yearly: signs in if needed, shows the terms, and opens Paddle's checkout on the button. Paddle tells Umi Cloud
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
      // Signed out (or the session ended): sign up or in first. Any other problem is shown, not
      // retried, so the two pages never bounce between each other.
      let a: Account | null;
      try {
        a = await me();
      } catch (e) {
        setError((e as Error).message);
        return setState("ready");
      }
      if (!a) return location.replace(`/signup?next=${encodeURIComponent(`/upgrade?cycle=${c}`)}`);
      setAccount(a);
      if (a.plan !== "free") return setState("already");
      // The terms below are read before paying: checkout opens on the button, not by itself.
      setState("ready");
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

  // Until we know who's here: no card that might vanish a moment later.
  if (state === "loading")
    return (
      <main className="grid min-h-[100svh] place-items-center">
        <Mark className="size-8 animate-pulse text-accent" />
      </main>
    );
  if (state === "off")
    return (
      <Shell title="Umi Pro is coming soon" lead="Until then, everything on your computer is free.">
        <a href="/app" className="btn-dark mt-6 inline-flex">Open Umi</a>
      </Shell>
    );
  if (state === "already")
    return (
      <Shell title="You’re on Pro" lead="Share links and insights are on. You can cancel or change your card any time.">
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
      <Shell title={state === "done" ? "Welcome to Umi Pro" : "Finishing up…"} lead={state === "done" ? "Thanks! Share links are on, with insights and passwords. A receipt is on its way from Paddle." : "Payment received. Turning on Pro for your account."}>
        {state === "done" && <a href="/app" className="btn-dark mt-6 inline-flex">Open Umi</a>}
      </Shell>
    );
  return (
    <Shell title="Upgrade to Umi Pro" lead={`${PRICE[cycle]}, plus local tax where it applies. Share links, 200 GB, insights and passwords.`}>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button type="button" disabled={!account} onClick={() => account && void start(cycle, account)} className="btn-dark inline-flex disabled:opacity-60">
          Continue to payment
        </button>
        <button type="button" onClick={() => setCycle(cycle === "yearly" ? "monthly" : "yearly")} className="text-[14px] font-medium text-accent">
          {cycle === "yearly" ? "Pay monthly instead" : "Pay yearly and save 33%"}
        </button>
      </div>
      {error && <p className="mt-3 text-[14px] text-[#b42318]">{error}</p>}
      <ul className="mt-6 list-disc space-y-1 pl-5 text-[13px] text-muted">
        <li>Renews automatically every {cycle === "yearly" ? "year" : "month"} at the same price until you cancel.</li>
        <li>Cancel any time from Manage subscription; Pro stays on until the end of the period you paid for.</li>
        <li>Changed your mind? A full refund within 14 days of a payment, no questions asked.</li>
      </ul>
      <p className="mt-4 text-[12px] text-faint">
        Payments are handled by Paddle, our reseller, who sends the receipt and handles tax. By continuing you agree to the{" "}
        <a className="underline" href="/terms">Terms</a>, <a className="underline" href="/refunds">Refund Policy</a> and{" "}
        <a className="underline" href="/privacy">Privacy Policy</a>.
      </p>
    </Shell>
  );
}
