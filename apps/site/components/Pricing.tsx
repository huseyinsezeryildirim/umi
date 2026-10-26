"use client";

import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { DownloadButton } from "./Download";
import { Rise } from "./Sections";

// Pricing: Free forever for everything on your computer; Pro for links that stay up.
// Five designs to choose from (the picker at the bottom right is temporary).

type Billing = "monthly" | "yearly";
const PRICE = { monthly: 12, yearly: 8 } as const;
const SAVE = Math.round((1 - PRICE.yearly / PRICE.monthly) * 100);

const FREE = ["Unlimited recordings, no watermark", "The whole editor, 4K and GIF export", "Captions, voiceover and clean-up on your computer", "Import from Loom", "3 share links at a time, up to 5 minutes, kept a week"];
const PRO = ["Links that stay up, up to 4 hours each", "200 GB of cloud storage", "Who watched, and for how long", "Passwords and expiry dates on links", "Your own domain, no Umi badge"];
const ROWS: [string, string | boolean, string | boolean][] = [
  ["Recording and editing", "Unlimited", "Unlimited"],
  ["4K, GIF and MOV export", true, true],
  ["Captions, voiceover, noise and background removal", "On your computer", "On your computer"],
  ["Commercial use, no watermark", true, true],
  ["Import from Loom", true, true],
  ["Share links", "3 at a time, 5 min, 7 days", "Unlimited, 4 h each"],
  ["Cloud storage", "—", "200 GB"],
  ["Viewer insights", false, true],
  ["Passwords and expiry dates", false, true],
  ["Your own domain, no badge", false, true],
];

const DESIGNS = ["Cards", "Table", "Split", "Strip", "Editorial"] as const;
type Design = (typeof DESIGNS)[number];

const proNote = (b: Billing) => (b === "yearly" ? `$${PRICE.yearly * 12} billed yearly` : "billed monthly");

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

function List({ items, dark = false }: { items: string[]; dark?: boolean }) {
  return (
    <ul className={`grid gap-3 text-[15px] ${dark ? "text-white/85" : "text-text"}`}>
      {items.map((t) => (
        <li key={t} className="flex gap-3">
          <Check className={dark ? "text-white" : "text-accent"} />
          {t}
        </li>
      ))}
    </ul>
  );
}

const ProButton = ({ dark = false }: { dark?: boolean }) => (
  <span className={`inline-flex h-11 items-center rounded-full px-5 text-[15px] font-medium ${dark ? "bg-white text-ink" : "bg-ink text-white"} cursor-default opacity-90`} title="Umi Pro is launching soon">
    Launching soon
  </span>
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

// 1 — Two cards; Pro is the dark one.
function Cards({ billing, setBilling }: { billing: Billing; setBilling: (b: Billing) => void }) {
  return (
    <>
      <Heading>
        <div className="mt-10">
          <Toggle billing={billing} onChange={setBilling} />
        </div>
      </Heading>
      <div className="mx-auto mt-12 grid max-w-4xl gap-4 md:grid-cols-2">
        <Rise className="flex flex-col rounded-[28px] bg-white p-8 shadow-[0_0_0_1px_rgb(17_24_39/0.08)]">
          <p className="text-[15px] font-medium text-muted">Umi</p>
          <p className="mt-3 flex items-baseline gap-2">
            <b className="text-5xl font-semibold tracking-tight">$0</b>
            <span className="text-muted">forever</span>
          </p>
          <p className="mt-2 text-[14px] text-muted">For everyone, including work.</p>
          <div className="my-7 h-px bg-line" />
          <List items={FREE} />
          <div className="mt-auto pt-8">
            <DownloadButton />
          </div>
        </Rise>
        <Rise delay={0.08} className="relative flex flex-col overflow-hidden rounded-[28px] bg-ink p-8 text-white">
          <div className="pointer-events-none absolute -top-24 -right-24 size-64 rounded-full bg-accent/40 blur-3xl" />
          <p className="relative text-[15px] font-medium text-white/70">Umi Pro</p>
          <p className="relative mt-3 flex items-baseline gap-2">
            <Price value={PRICE[billing]} className="text-5xl font-semibold tracking-tight" />
            <span className="text-white/60">a month</span>
          </p>
          <p className="relative mt-2 text-[14px] text-white/60">{proNote(billing)}</p>
          <div className="relative my-7 h-px bg-white/10" />
          <p className="relative mb-3 text-[13px] font-medium tracking-wide text-white/50 uppercase">Everything in Umi, plus</p>
          <div className="relative">
            <List items={PRO} dark />
          </div>
          <div className="relative mt-auto pt-8">
            <ProButton dark />
          </div>
        </Rise>
      </div>
    </>
  );
}

// 2 — A comparison table with the prices in its header.
function Table({ billing, setBilling }: { billing: Billing; setBilling: (b: Billing) => void }) {
  const cell = (v: string | boolean) =>
    v === true ? <Check className="mx-auto text-accent" /> : v === false ? <span className="text-faint">—</span> : <span className="text-[14px] text-text">{v}</span>;
  return (
    <>
      <Heading />
      <Rise className="mx-auto mt-14 max-w-4xl overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-left">
          <thead>
            <tr className="align-bottom">
              <th className="w-[44%] pb-6">
                <Toggle billing={billing} onChange={setBilling} />
              </th>
              <th className="pb-6 text-center font-normal">
                <p className="text-[15px] font-medium text-muted">Umi</p>
                <p className="mt-1 text-4xl font-semibold tracking-tight">$0</p>
                <p className="text-[13px] text-muted">forever</p>
              </th>
              <th className="rounded-t-2xl bg-panel pb-6 pt-5 text-center font-normal">
                <p className="text-[15px] font-medium text-accent">Umi Pro</p>
                <p className="mt-1 text-4xl font-semibold tracking-tight">
                  <Price value={PRICE[billing]} />
                </p>
                <p className="text-[13px] text-muted">a month, {proNote(billing)}</p>
              </th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map(([name, free, pro]) => (
              <tr key={name} className="border-t border-line">
                <td className="py-3.5 pr-4 text-[15px] text-ink">{name}</td>
                <td className="py-3.5 text-center">{cell(free)}</td>
                <td className="bg-panel py-3.5 text-center">{cell(pro)}</td>
              </tr>
            ))}
            <tr className="border-t border-line">
              <td />
              <td className="py-6 text-center">
                <DownloadButton />
              </td>
              <td className="rounded-b-2xl bg-panel py-6 text-center">
                <ProButton />
              </td>
            </tr>
          </tbody>
        </table>
      </Rise>
    </>
  );
}

// 3 — The promise on the left, the two plans stacked on the right.
function Split({ billing, setBilling }: { billing: Billing; setBilling: (b: Billing) => void }) {
  return (
    <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-[1fr_1.1fr] lg:items-start">
      <Rise className="text-left lg:sticky lg:top-32">
        <h2 className="h-display text-[clamp(40px,6vw,72px)]">
          Free.
          <br />
          Not a trial.
        </h2>
        <p className="lead mt-5 max-w-md">Everything that happens on your computer costs nothing, including for work. You only pay when we host things for you.</p>
        <div className="mt-8">
          <Toggle billing={billing} onChange={setBilling} />
        </div>
      </Rise>
      <div className="grid gap-4">
        <Rise className="rounded-[28px] bg-white p-7 text-left shadow-[0_0_0_1px_rgb(17_24_39/0.08)]">
          <div className="flex items-baseline justify-between gap-4">
            <p className="text-xl font-semibold">Umi</p>
            <p className="flex items-baseline gap-1.5">
              <b className="text-3xl font-semibold">$0</b>
              <span className="text-muted">forever</span>
            </p>
          </div>
          <div className="mt-5">
            <List items={FREE} />
          </div>
        </Rise>
        <Rise delay={0.08} className="rounded-[28px] bg-[linear-gradient(160deg,#eef5fd,#dfeafd)] p-7 text-left shadow-[0_0_0_1px_rgb(17_111_245/0.15)]">
          <div className="flex items-baseline justify-between gap-4">
            <p className="text-xl font-semibold">
              Umi Pro <span className="ml-1 align-middle text-[12px] font-medium text-accent">Launching soon</span>
            </p>
            <p className="flex items-baseline gap-1.5">
              <Price value={PRICE[billing]} className="text-3xl font-semibold" />
              <span className="text-muted">/mo</span>
            </p>
          </div>
          <p className="mt-1 text-right text-[13px] text-muted">{proNote(billing)}</p>
          <div className="mt-4">
            <List items={PRO} />
          </div>
        </Rise>
      </div>
    </div>
  );
}

// 4 — Free takes the stage; Pro is a strip under it.
function Strip({ billing, setBilling }: { billing: Billing; setBilling: (b: Billing) => void }) {
  return (
    <>
      <Heading />
      <Rise className="mx-auto mt-14 max-w-5xl overflow-hidden rounded-[32px] bg-white text-left shadow-[0_0_0_1px_rgb(17_24_39/0.08),0_30px_60px_-30px_rgb(17_24_39/0.25)]">
        <div className="grid gap-8 p-8 sm:p-10 md:grid-cols-[1fr_1.4fr]">
          <div>
            <p className="text-[15px] font-medium text-muted">Umi</p>
            <p className="mt-2 text-6xl font-semibold tracking-tight">$0</p>
            <p className="mt-1 text-muted">Forever. For everyone, including work.</p>
            <div className="mt-7">
              <DownloadButton />
            </div>
          </div>
          <div className="grid content-start gap-3 sm:grid-cols-2">
            {FREE.map((t) => (
              <div key={t} className="flex gap-3 rounded-2xl bg-ink/[0.03] p-4 text-[14px] text-text">
                <Check />
                {t}
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-5 border-t border-line bg-panel/70 p-8 sm:px-10 md:flex-row md:items-center">
          <div className="flex-1">
            <p className="text-lg font-semibold">
              Need links that stay up? <span className="text-accent">Umi Pro</span>
            </p>
            <p className="mt-1 text-[14px] text-muted">{PRO.slice(0, 4).join(" · ")}</p>
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

// 5 — Typographic: two columns, big numbers, hairlines, the billing choice in the sentence.
function Editorial({ billing, setBilling }: { billing: Billing; setBilling: (b: Billing) => void }) {
  const opt = (b: Billing, label: string) => (
    <button type="button" onClick={() => setBilling(b)} className={`underline decoration-2 underline-offset-[6px] transition-colors ${billing === b ? "text-ink decoration-accent" : "text-faint decoration-transparent hover:text-muted"}`}>
      {label}
    </button>
  );
  return (
    <div className="mx-auto max-w-5xl text-left">
      <Rise>
        <h2 className="h-display text-[clamp(36px,5.6vw,60px)]">Free. Not a trial.</h2>
        <p className="lead mt-4 max-w-xl">Everything that happens on your computer costs nothing, including for work. You only pay when we host things for you.</p>
      </Rise>
      <div className="mt-14 grid border-t border-ink md:grid-cols-2">
        <Rise className="border-b border-line py-10 md:border-r md:border-b-0 md:pr-12">
          <p className="text-[13px] font-semibold tracking-[0.14em] text-muted uppercase">Umi</p>
          <p className="mt-4 text-[96px] leading-none font-semibold tracking-tighter">$0</p>
          <p className="mt-3 text-muted">forever</p>
          <div className="mt-10">
            <List items={FREE} />
          </div>
        </Rise>
        <Rise delay={0.08} className="py-10 md:pl-12">
          <p className="text-[13px] font-semibold tracking-[0.14em] text-accent uppercase">Umi Pro · launching soon</p>
          <p className="mt-4 text-[96px] leading-none font-semibold tracking-tighter">
            <Price value={PRICE[billing]} />
          </p>
          <p className="mt-3 text-[17px] text-muted">
            a month, billed {opt("monthly", "monthly")} or {opt("yearly", "yearly")}
            {billing === "yearly" && <span className="ml-2 text-[13px] font-semibold text-accent">save {SAVE}%</span>}
          </p>
          <div className="mt-10">
            <List items={PRO} />
          </div>
        </Rise>
      </div>
    </div>
  );
}

/** Temporary: switches between the five designs (remembered in this browser). */
function Picker({ design, onPick }: { design: Design; onPick: (d: Design) => void }) {
  return (
    <div className="fixed right-4 bottom-4 z-50 flex items-center gap-1 rounded-full bg-ink/90 p-1 pl-3 text-[12px] text-white shadow-lg backdrop-blur">
      <span className="mr-1 text-white/60">Pricing</span>
      {DESIGNS.map((d, i) => (
        <button key={d} type="button" onClick={() => onPick(d)} title={d} className={`h-7 rounded-full px-2.5 transition-colors ${design === d ? "bg-white text-ink" : "hover:bg-white/15"}`}>
          {i + 1}
          <span className="hidden sm:inline"> {d}</span>
        </button>
      ))}
    </div>
  );
}

export function Pricing() {
  const [billing, setBilling] = useState<Billing>("yearly");
  const [design, setDesign] = useState<Design>("Cards");
  useEffect(() => {
    try {
      const saved = localStorage.getItem("umi.pricing-design") as Design | null;
      if (saved && DESIGNS.includes(saved)) setDesign(saved);
    } catch {
      // Storage blocked: the first design.
    }
  }, []);
  const pick = (d: Design) => {
    setDesign(d);
    try {
      localStorage.setItem("umi.pricing-design", d);
    } catch {
      // Not remembered; still switches.
    }
  };
  const props = { billing, setBilling };
  return (
    <section id="pricing" className="px-4 pt-40 pb-10">
      {design === "Cards" && <Cards {...props} />}
      {design === "Table" && <Table {...props} />}
      {design === "Split" && <Split {...props} />}
      {design === "Strip" && <Strip {...props} />}
      {design === "Editorial" && <Editorial {...props} />}
      <Picker design={design} onPick={pick} />
    </section>
  );
}
