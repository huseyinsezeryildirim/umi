"use client";

import { motion } from "motion/react";
import { useState } from "react";
import { DownloadButton } from "./Download";
import { Rise } from "./Sections";

// Pricing: Free forever for everything on your computer; Pro, a strip under it, for links that stay up.

type Billing = "monthly" | "yearly";
const PRICE = { monthly: 12, yearly: 8 } as const;
const SAVE = Math.round((1 - PRICE.yearly / PRICE.monthly) * 100);

const FREE = ["Unlimited recordings, no watermark", "The whole editor, 4K and GIF export", "Captions, voiceover and clean-up on your computer", "Import from Loom", "3 share links at a time, up to 5 minutes, kept a week", "Commercial use included"];
const PRO = ["Links that stay up, up to 4 hours each", "200 GB of cloud storage", "Who watched, and for how long", "Passwords and expiry dates on links"];

function Toggle({ billing, onChange, dark = false }: { billing: Billing; onChange: (b: Billing) => void; dark?: boolean }) {
  return (
    <div role="radiogroup" aria-label="Billing" className={`relative inline-flex rounded-full p-1 text-[14px] font-medium ${dark ? "bg-white/10" : "bg-ink/[0.05]"}`}>
      {(["monthly", "yearly"] as const).map((b) => (
        <button
          key={b}
          type="button"
          role="radio"
          aria-checked={billing === b}
          onClick={() => onChange(b)}
          className={`relative z-10 flex h-9 items-center gap-2 rounded-full px-4 transition-colors ${billing === b ? (dark ? "text-ink" : "text-ink") : dark ? "text-white/70 hover:text-white" : "text-muted hover:text-ink"}`}
        >
          {billing === b && <motion.span layoutId={`billing-${dark}`} className="absolute inset-0 -z-10 rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/0.12)]" transition={{ type: "spring", stiffness: 500, damping: 40 }} />}
          {b === "monthly" ? "Monthly" : "Yearly"}
          {b === "yearly" && <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${billing === b ? "bg-accent/10 text-accent" : dark ? "bg-white/10 text-white/80" : "bg-accent/10 text-accent"}`}>−{SAVE}%</span>}
        </button>
      ))}
    </div>
  );
}

function Price({ value, className = "" }: { value: number; className?: string }) {
  return (
    <motion.b key={value} initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }} className={`inline-block tabular-nums ${className}`}>
      ${value}
    </motion.b>
  );
}

const Check = ({ className = "text-accent" }: { className?: string }) => (
  <svg viewBox="0 0 16 16" className={`mt-[3px] size-4 shrink-0 ${className}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="m3.5 8.5 3 3 6-7" />
  </svg>
);

function Heading({ children }: { children?: React.ReactNode }) {
  return (
    <Rise className="text-center">
      <h2 className="h-display text-[clamp(36px,5.6vw,60px)]">Free. Not a trial.</h2>
      <p className="lead mx-auto mt-4 max-w-lg">Everything that happens on your computer costs nothing, including for work. You only pay when we host things for you.</p>
      {children}
    </Rise>
  );
}

/** Free takes the stage, its features a plain two-column list; Pro is a strip under it. */
function Strip({ billing, setBilling }: { billing: Billing; setBilling: (b: Billing) => void }) {
  return (
    <>
      <Heading />
      <Rise className="mx-auto mt-14 max-w-5xl overflow-hidden rounded-[32px] bg-white text-left shadow-[0_0_0_1px_rgb(17_24_39/0.08),0_30px_60px_-30px_rgb(17_24_39/0.25)]">
        <div className="grid gap-10 p-8 sm:p-10 md:grid-cols-[1fr_1.5fr]">
          <div>
            <p className="text-[15px] font-medium text-muted">Umi</p>
            <p className="mt-2 text-6xl font-semibold tracking-tight">$0</p>
            <p className="mt-1 text-muted">Forever. For everyone, including work.</p>
            <div className="mt-7">
              <DownloadButton />
            </div>
          </div>
          <ul className="grid content-start gap-x-8 sm:grid-cols-2">
            {FREE.map((t) => (
              <li key={t} className="flex gap-3 border-t border-line py-3.5 text-[15px] leading-snug text-text first:border-t-0 first:pt-0 sm:nth-[2]:border-t-0 sm:nth-[2]:pt-0">
                <Check />
                {t}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col gap-5 border-t border-line bg-panel/70 p-8 sm:px-10 md:flex-row md:items-center">
          <div className="flex-1">
            <p className="text-lg font-semibold">
              Need links that stay up? <span className="text-accent">Umi Pro</span>
              <span className="ml-2 align-middle text-[12px] font-medium text-muted">launching soon</span>
            </p>
            <p className="mt-1 text-[14px] text-muted">{PRO.join(" · ")}</p>
          </div>
          <div className="flex items-center gap-5">
            <Toggle billing={billing} onChange={setBilling} />
            <p className="whitespace-nowrap">
              <Price value={PRICE[billing]} className="text-3xl font-semibold" />
              <span className="text-muted"> /mo</span>
            </p>
          </div>
        </div>
      </Rise>
    </>
  );
}

export function Pricing() {
  const [billing, setBilling] = useState<Billing>("yearly");
  return (
    <section id="pricing" className="px-4 pt-40 pb-10">
      <Strip billing={billing} setBilling={setBilling} />
    </section>
  );
}
