"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { DownloadButton } from "./Download";
import { Rise } from "./Sections";
import { Mark } from "./ui";

const EASE = [0.25, 1, 0.5, 1] as const;

// ───── Privacy ─────

export function Privacy() {
  const [toggles, setToggles] = useState([true, true, true, false]);
  const labels = ["Transcribe on this computer", "Remove background noise on this computer", "Only upload when I share a link", "Send anonymous crash reports"];
  return (
    <section className="px-3 pt-40 sm:px-4">
      <div className="relative mx-auto max-w-[1400px] overflow-hidden rounded-[40px] px-6 pt-28 pb-0 text-center text-white sm:px-12">
        <img src="/photos/night.jpg" alt="" className="absolute inset-0 size-full object-cover" />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgb(5_10_25/0.55),rgb(5_10_25/0.2)_60%,rgb(5_10_25/0.6))]" />
        <div className="relative">
          <Rise>
            <h2 className="h-display text-[clamp(36px,5.6vw,60px)]">
              Your recordings
              <br />
              stay yours
            </h2>
            <p className="mx-auto mt-5 max-w-lg text-lg text-white/75">
              Captions, voices and background removal run on your computer. Nothing is uploaded unless you share a link.
            </p>
          </Rise>
          <Rise className="mx-auto mt-14 max-w-xl text-left text-ink" delay={0.15}>
            <div className="overflow-hidden rounded-t-2xl bg-[#ececec]/95 shadow-[0_0_0_0.5px_rgb(0_0_0/0.3),0_30px_80px_rgb(0_0_0/0.5)] backdrop-blur-xl">
              <div className="relative flex items-center justify-center border-b border-black/10 py-2.5 text-[13px] font-semibold">
                <span className="mac-lights absolute left-4">
                  <i />
                  <i />
                  <i />
                </span>
                Privacy
              </div>
              <div className="p-5 pb-8">
                <p className="mb-2 px-1 text-[11px] font-semibold tracking-wide text-black/45 uppercase">On your computer</p>
                <div className="overflow-hidden rounded-xl bg-white">
                  {labels.map((l, k) => (
                    <div key={l} className={`flex items-center justify-between gap-4 px-4 py-3 text-[14px] ${k < labels.length - 1 ? "border-b border-black/5" : ""} ${k === 3 ? "mt-0" : ""}`}>
                      {l}
                      <button
                        type="button"
                        aria-pressed={toggles[k]}
                        aria-label={l}
                        onClick={() => setToggles((t) => t.map((v, j) => (j === k ? !v : v)))}
                        className={`relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors duration-300 ${toggles[k] ? "bg-accent" : "bg-black/15"}`}
                      >
                        <motion.i layout transition={{ type: "spring", stiffness: 500, damping: 32 }} className={`absolute top-[2px] block size-[18px] rounded-full bg-white shadow ${toggles[k] ? "right-[2px]" : "left-[2px]"}`} />
                      </button>
                    </div>
                  ))}
                </div>
                <p className="mt-3 px-1 text-[12px] text-black/45">Your recordings are never used to train AI models.</p>
              </div>
            </div>
          </Rise>
        </div>
      </div>
    </section>
  );
}

// ───── Pricing, questions, ending ─────

export function Pricing() {
  return (
    <section id="pricing" className="px-4 pt-40 pb-10">
      <Rise className="text-center">
        <h2 className="h-display text-[clamp(36px,5.6vw,60px)]">Free. Not a trial.</h2>
        <p className="lead mx-auto mt-4 max-w-lg">Everything that happens on your computer costs nothing, including for work. You only pay when we host things for you.</p>
      </Rise>
      <div className="mx-auto mt-16 grid max-w-4xl gap-px overflow-hidden rounded-[28px] bg-line md:grid-cols-2">
        {[
          {
            name: "Umi",
            price: "$0",
            note: "forever",
            items: ["Unlimited recordings, no watermark", "The whole editor, 4K and GIF export", "Captions, voiceover and clean-up on your computer", "Import from Loom", "3 share links at a time, up to 5 minutes, kept for a week"],
          },
          {
            name: "Umi Pro",
            price: "$8",
            note: "a month billed yearly ($12 monthly) · launching soon",
            items: ["Links that stay up as long as you like, up to 4 hours each", "200 GB of cloud storage", "Who watched, and for how long", "Passwords, expiry dates, your own domain, no Umi badge"],
          },
        ].map((p, k) => (
          <Rise key={p.name} delay={k * 0.08} className="bg-white p-9">
            <p className="text-[15px] font-medium text-muted">{p.name}</p>
            <p className="mt-2 flex items-baseline gap-2">
              <b className="text-5xl font-semibold tracking-tight">{p.price}</b>
              <span className="text-muted">{p.note}</span>
            </p>
            <ul className="mt-7 grid gap-3 text-[15px] text-text">
              {p.items.map((t) => (
                <li key={t} className="flex gap-3">
                  <span className="mt-[9px] size-1.5 shrink-0 rounded-full bg-accent" />
                  {t}
                </li>
              ))}
            </ul>
          </Rise>
        ))}
      </div>
    </section>
  );
}

const QUESTIONS: [string, string][] = [
  ["Is it really free?", "Yes. Recording, editing, exporting and everything that runs on your computer is free, with no time limit or watermark, for personal and commercial use. Share links are free for a week (3 at a time, up to 5 minutes); keeping them and longer videos are Umi Pro."],
  ["Does my video leave my computer?", "Only if you share a link. Captions, voiceover, noise removal and background removal all run locally."],
  ["Which computers does it run on?", "macOS 13 or later on Apple silicon and Intel, Windows 10 and 11, and most Linux distributions. You can also record and edit right in your browser, nothing to install."],
  ["Can I bring my Loom videos?", "Paste your Loom links and they become Umi projects you can edit. It’s free."],
  ["Is the code public?", "Yes, Umi is open source. You can read it, build it yourself and contribute on GitHub."],
];

export function Faq() {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <section id="faq" className="px-4 pt-32 pb-10">
      <div className="mx-auto max-w-3xl">
        <Rise>
          <h2 className="h-display text-center text-[clamp(36px,5.6vw,60px)]">Questions?</h2>
        </Rise>
        <Rise className="mt-12" delay={0.1}>
          {QUESTIONS.map(([q, a], k) => (
            <div key={q} className="border-b border-line">
              <button type="button" aria-expanded={open === k} onClick={() => setOpen(open === k ? null : k)} className="flex w-full items-center justify-between gap-6 py-6 text-left text-[19px] font-medium">
                {q}
                <motion.svg viewBox="0 0 24 24" className="size-5 shrink-0 text-muted" animate={{ rotate: open === k ? 45 : 0 }} transition={{ duration: 0.4, ease: EASE }}>
                  <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </motion.svg>
              </button>
              <AnimatePresence initial={false}>
                {open === k && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.45, ease: EASE }} className="overflow-hidden">
                    <p className="max-w-2xl pb-6 text-[17px] text-muted">{a}</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </Rise>
      </div>
    </section>
  );
}

export function Ending() {
  return (
    <section id="download" className="px-3 pt-32 pb-6 sm:px-4">
      <div className="relative mx-auto max-w-[1400px] overflow-hidden rounded-[40px] px-6 py-32 text-center">
        <img src="/photos/sky.jpg" alt="" className="absolute inset-0 size-full object-cover" />
        <div className="absolute inset-0 bg-white/30" />
        <Rise className="relative">
          <h2 className="h-display text-[clamp(40px,6.4vw,72px)]">
            Press{" "}
            <span className="keys">
              {["⌥", "⇧", "L"].map((k, i) => (
                <span key={k} className="keycap" style={{ animationDelay: `${i * 0.16}s` }}>
                  <span className="keycap__g">{k}</span>
                </span>
              ))}
            </span>
            <br />
            and start recording.
          </h2>
          <div className="mt-10">
            <DownloadButton />
          </div>
          <p className="mt-4 text-[15px] text-ink/60">Also for Windows, Linux and your browser</p>
        </Rise>
      </div>
    </section>
  );
}

export function Footer() {
  const cols: [string, [string, string][]][] = [
    ["Product", [["Download", "#download"], ["Pricing", "#pricing"], ["Questions", "#faq"]]],
    ["Open source", [["GitHub", "https://github.com/huseyinsezeryildirim/umi"], ["Releases", "https://github.com/huseyinsezeryildirim/umi/releases"], ["Report a bug", "https://github.com/huseyinsezeryildirim/umi/issues"]]],
    ["Platforms", [["macOS", "#download"], ["Windows", "#download"], ["Linux", "#download"], ["Browser", "/signup"]]],
    ["Legal", [["Terms", "/terms"], ["Privacy", "/privacy"], ["Copyright", "/copyright"]]],
  ];
  return (
    <footer className="px-5 pt-20 pb-12">
      <div className="mx-auto grid max-w-6xl grid-cols-3 gap-x-4 gap-y-10 border-t border-line pt-12 sm:grid-cols-[1.4fr_repeat(4,1fr)]">
        <div className="col-span-3 sm:col-span-1">
          <a href="#top" className="flex items-center gap-2 text-lg font-semibold">
            <Mark className="size-6" /> Umi
          </a>
          <p className="mt-3 max-w-xs text-sm text-muted">The free screen recorder for people who explain things.</p>
        </div>
        {cols.map(([title, links]) => (
          <div key={title}>
            <p className="text-sm font-semibold">{title}</p>
            <ul className="mt-3 grid gap-2 text-sm text-muted">
              {links.map(([l, h]) => (
                <li key={l}>
                  <a href={h} className="transition-colors hover:text-ink">
                    {l}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="mx-auto mt-14 flex max-w-6xl items-center justify-between text-xs text-faint">
        <p>© 2026 Umi</p>
        <p>
          Created by{" "}
          <a href="https://sezer.website/" className="text-muted transition-colors hover:text-ink">
            sezer.website
          </a>
        </p>
      </div>
    </footer>
  );
}
