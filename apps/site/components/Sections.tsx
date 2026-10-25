"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { DownloadButton } from "./Download";
import { Check, EASE, Mark, Reveal, SectionHead } from "./ui";

const ROWS: [string, string, string, string, string][] = [
  ["Free for commercial use", "✓", "Limited", "—", "—"],
  ["Unlimited local recordings", "✓", "—", "✓", "✓"],
  ["Auto zoom & cursor smoothing", "✓", "—", "✓", "✓"],
  ["Captions & AI on your device", "✓", "Paid", "Paid", "✓"],
  ["Remove filler words", "✓", "Paid", "—", "✓"],
  ["Camera background removal", "✓", "✓", "—", "✓"],
  ["Loom import", "Free", "—", "Paid", "—"],
  ["Mac, Windows, Linux & Chrome", "✓", "No Linux", "No Linux", "Mac only"],
  ["Open source", "✓", "—", "✓", "—"],
];

export function Compare() {
  return (
    <section id="compare" className="px-4 py-28">
      <SectionHead tag="Compare" title="Everything others charge for. Free.">
        Recording, editing and on-device AI cost nothing — including for work.
      </SectionHead>
      <Reveal className="mx-auto max-w-5xl overflow-x-auto rounded-3xl bg-white shadow-[0_0_0_1px_rgb(14_17_30/0.06),0_20px_50px_rgb(14_17_30/0.06)]">
        <table className="w-full min-w-[640px] border-collapse text-left text-[15px]">
          <thead>
            <tr className="border-b border-hairline">
              <th className="p-4" />
              {["Umi", "Loom", "Cap", "Screen Studio"].map((n, i) => (
                <th key={n} scope="col" className={`p-4 text-center font-bold ${i === 0 ? "bg-tint text-accent" : "text-muted"}`}>
                  {i === 0 ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Mark className="size-5" /> Umi
                    </span>
                  ) : (
                    n
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map(([label, ...cells], r) => (
              <motion.tr
                key={label}
                className="border-b border-hairline last:border-0"
                initial={{ opacity: 0, x: -10 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: r * 0.04, duration: 0.5, ease: EASE }}
              >
                <th scope="row" className="p-4 font-medium">
                  {label}
                </th>
                {cells.map((c, i) => (
                  <td key={i} className={`p-4 text-center ${i === 0 ? "bg-tint font-semibold text-accent" : "text-muted"}`}>
                    {c === "✓" ? <Check className={`mx-auto ${i === 0 ? "text-accent" : "text-[#13a874]"}`} /> : c}
                  </td>
                ))}
              </motion.tr>
            ))}
          </tbody>
        </table>
      </Reveal>
      <p className="mx-auto mt-4 max-w-5xl text-center text-xs text-muted">Based on each product’s public plans in October 2026.</p>
    </section>
  );
}

export function Pricing() {
  return (
    <section id="pricing" className="px-4 py-28">
      <SectionHead tag="Pricing" title="Free where it matters">
        Your computer does the work, so it costs nothing. You only pay when we host things for you.
      </SectionHead>
      <div className="mx-auto grid max-w-4xl gap-4 md:grid-cols-2">
        <Reveal>
          <article className="card flex h-full flex-col p-8">
            <h3 className="text-lg font-bold">Umi</h3>
            <p className="mt-3 flex items-baseline gap-2">
              <b className="text-5xl font-extrabold tracking-tight">$0</b>
              <span className="text-muted">forever</span>
            </p>
            <p className="mt-2 text-muted">Everything on your computer, for personal and commercial use.</p>
            <ul className="my-7 grid gap-3">
              {["Unlimited recordings, no watermark", "The full editor, 4K export, GIF", "On-device captions, voiceover and clean-up", "Loom import"].map((t) => (
                <li key={t} className="flex items-center gap-3">
                  <Check className="text-accent" /> {t}
                </li>
              ))}
            </ul>
            <div className="mt-auto [&>a]:w-full">
              <DownloadButton />
            </div>
          </article>
        </Reveal>
        <Reveal delay={0.08}>
          <article className="card relative flex h-full flex-col p-8 shadow-[0_0_0_2px_var(--color-accent),0_30px_60px_-20px_rgb(17_111_245/0.35)]">
            <span className="absolute top-6 right-6 rounded-full bg-tint px-3 py-1 text-xs font-semibold text-accent">Early access</span>
            <h3 className="text-lg font-bold">Umi Cloud</h3>
            <p className="mt-3 flex items-baseline gap-2">
              <b className="text-5xl font-extrabold tracking-tight">Soon</b>
              <span className="text-muted">pricing at launch</span>
            </p>
            <p className="mt-2 text-muted">Links, insights and teams, on top of everything free.</p>
            <ul className="my-7 grid gap-3">
              {["Links that upload while you record", "Viewer insights, comments and reactions", "Team workspaces and shared styles", "Passwords, expiry and embeds"].map((t) => (
                <li key={t} className="flex items-center gap-3">
                  <Check className="text-accent" /> {t}
                </li>
              ))}
            </ul>
            <a href="https://github.com/umi-cam/umi" className="btn btn-secondary mt-auto w-full">
              Follow on GitHub
            </a>
          </article>
        </Reveal>
      </div>
    </section>
  );
}

const QUESTIONS: [string, string][] = [
  ["Is Umi really free?", "Yes. Recording, editing, exporting and all the AI that runs on your computer are free with no time limit and no watermark, including for work. Only hosted features (links, insights, teams) are paid."],
  ["Does my video leave my computer?", "Not unless you share a link. Captions, voiceover, noise removal and background removal all run on your device."],
  ["Which computers does it run on?", "macOS 13 or later (Apple silicon and Intel), Windows 10 and 11, popular Linux distributions, and Chrome through the extension."],
  ["Can I move from Loom?", "Paste your Loom links into Umi and they become projects you can edit, for free."],
  ["Is it open source?", "Yes. The code is on GitHub; you’re welcome to read it, build it and contribute."],
];

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id="faq" className="px-4 py-28">
      <SectionHead tag="FAQ" title="Questions" />
      <Reveal className="mx-auto grid max-w-3xl gap-2">
        {QUESTIONS.map(([q, a], i) => (
          <div key={q} className="card">
            <button
              type="button"
              aria-expanded={open === i}
              onClick={() => setOpen(open === i ? null : i)}
              className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left text-[17px] font-semibold"
            >
              {q}
              <motion.span animate={{ rotate: open === i ? 45 : 0 }} transition={{ duration: 0.3, ease: EASE }} className="grid size-7 shrink-0 place-items-center rounded-full bg-tint text-lg text-accent">
                +
              </motion.span>
            </button>
            <AnimatePresence initial={false}>
              {open === i && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.35, ease: EASE }} className="overflow-hidden">
                  <p className="px-6 pb-5 text-muted">{a}</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ))}
      </Reveal>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-hairline px-4 py-10">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 text-sm text-muted sm:flex-row">
        <a href="#top" className="flex items-center gap-2 text-base font-bold text-ink">
          <Mark className="size-6" /> Umi
        </a>
        <nav aria-label="Footer" className="flex gap-5">
          <a href="#features" className="hover:text-ink">Features</a>
          <a href="#pricing" className="hover:text-ink">Pricing</a>
          <a href="#faq" className="hover:text-ink">FAQ</a>
          <a href="https://github.com/umi-cam/umi" className="hover:text-ink">GitHub</a>
        </nav>
        <p>Made for people who explain things.</p>
      </div>
    </footer>
  );
}
