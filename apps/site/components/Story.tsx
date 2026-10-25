"use client";

import { AnimatePresence, motion, useInView } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { DownloadButton } from "./Download";
import { MacStory } from "./MacStory";
import { Mark } from "./ui";

const EASE = [0.25, 1, 0.5, 1] as const;

function Rise({ children, className = "", delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.9, ease: EASE, delay }}
    >
      {children}
    </motion.div>
  );
}

/** Repeats `steps` (ms) while on screen; returns the current index. */
function useLoop(steps: number[], ref: React.RefObject<HTMLElement | null>) {
  const inView = useInView(ref, { amount: 0.4 });
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!inView) return;
    const t = setTimeout(() => setI((v) => (v + 1) % steps.length), steps[i]);
    return () => clearTimeout(t);
  }, [i, inView, steps]);
  return i;
}

// ───── Hero ─────

export function Hero() {
  return (
    <section id="top" className="px-4 pt-36 text-center sm:pt-44">
      <motion.p className="text-[15px] text-muted" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1 }}>
        Free and open source · Mac, Windows, Linux
      </motion.p>
      <motion.h1
        className="h-display mx-auto mt-5 max-w-4xl text-[clamp(44px,7.6vw,80px)]"
        initial={{ opacity: 0, y: 20, filter: "blur(8px)" }}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        transition={{ duration: 1.1, ease: EASE, delay: 0.1 }}
      >
        Screen recordings
        <br />
        that look edited
      </motion.h1>
      <motion.p className="lead mx-auto mt-6 max-w-xl" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 1, ease: EASE, delay: 0.3 }}>
        Record your screen and camera. Umi adds the zooms, captions and clean sound, so you can just hit share.
      </motion.p>
      <motion.div className="mt-9" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 1, ease: EASE, delay: 0.45 }}>
        <DownloadButton />
        <p className="mt-4 text-sm text-faint">Free forever · No account needed</p>
      </motion.div>
      <motion.div className="mt-16 sm:mt-20" initial={{ opacity: 0, y: 60 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 1.4, ease: EASE, delay: 0.6 }}>
        <MacStory />
      </motion.div>
    </section>
  );
}

// ───── Zoom ─────

export function Zoom() {
  const ref = useRef<HTMLDivElement>(null);
  const i = useLoop([1600, 2600, 1400], ref);
  const zoomed = i === 1;
  return (
    <section id="features" className="px-4 pt-40 pb-12 text-center">
      <Rise>
        <h2 className="h-display text-[clamp(36px,5.6vw,60px)]">
          Zooms in where you{" "}
          <span className="relative inline-block">
            click
            <motion.span
              className="absolute top-1/2 left-1/2 size-[1.4em] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-accent"
              animate={{ scale: [0.4, 1.3], opacity: [0.9, 0] }}
              transition={{ duration: 1.4, repeat: Infinity, repeatDelay: 0.8, ease: "easeOut" }}
            />
          </span>
          .
        </h2>
        <p className="lead mx-auto mt-4 max-w-lg">Umi follows your cursor, zooms in on what you’re showing and glides back out. No keyframes.</p>
      </Rise>
      <Rise className="mx-auto mt-14 max-w-6xl" delay={0.1}>
        <div ref={ref} className="relative aspect-[16/9] overflow-hidden rounded-[28px] [container-type:inline-size]">
          <img src="/photos/dawn.jpg" alt="" className="absolute inset-0 size-full object-cover" />
          <div className="absolute inset-[9%_12%]">
            <motion.div
              className="mac-window size-full origin-[74%_70%] text-[1.2cqw]"
              animate={{ scale: zoomed ? 2 : 1 }}
              transition={{ duration: 1.1, ease: EASE }}
            >
              <div className="flex items-center gap-[1cqw] border-b border-black/5 bg-[#f6f6f6] px-[1.2cqw] py-[0.9cqw]">
                <span className="mac-lights [&_i]:size-[0.9cqw]">
                  <i />
                  <i />
                  <i />
                </span>
                <span className="mx-auto w-[40%] rounded-[0.5cqw] bg-black/5 py-[0.3cqw] text-[0.95cqw] text-black/50">acme.app/settings/team</span>
              </div>
              <div className="flex h-full text-left">
                <aside className="w-[22%] border-r border-black/5 p-[1.6cqw] text-black/55">
                  {["General", "Team", "Billing", "Security"].map((t, k) => (
                    <p key={t} className={`mb-[0.6cqw] rounded-[0.5cqw] px-[0.6cqw] py-[0.35cqw] ${k === 1 ? "bg-black/5 font-medium text-black" : ""}`}>
                      {t}
                    </p>
                  ))}
                </aside>
                <div className="flex-1 p-[2.2cqw]">
                  <p className="text-[1.8cqw] font-semibold">Team</p>
                  <p className="text-black/50">People who can see and edit your projects.</p>
                  <div className="mt-[1.6cqw] grid gap-[0.7cqw]">
                    {["Ada Lovelace", "Lin Chen", "Sam Ortiz"].map((n, k) => (
                      <div key={n} className="flex items-center gap-[0.8cqw] rounded-[0.7cqw] border border-black/5 px-[1cqw] py-[0.7cqw]">
                        <i className="size-[2cqw] rounded-full" style={{ background: ["#f5a97f", "#8bb8f0", "#9ad6b4"][k] }} />
                        {n}
                        <span className="ml-auto text-black/40">{k === 0 ? "Owner" : "Editor"}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-[1.6cqw] flex justify-end">
                    <motion.span
                      className="rounded-[0.6cqw] px-[1.3cqw] py-[0.6cqw] font-medium text-white"
                      animate={{ backgroundColor: zoomed ? "#13a874" : "#111827", scale: i === 1 ? [1, 0.94, 1] : 1 }}
                      transition={{ duration: 0.4, delay: zoomed ? 0.9 : 0 }}
                    >
                      {zoomed ? "Invite sent" : "Invite people"}
                    </motion.span>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
          <motion.svg
            viewBox="0 0 24 24"
            className="absolute z-10 w-[2.2cqw] drop-shadow-[0_0.2cqw_0.3cqw_rgb(0_0_0/0.35)]"
            animate={{ left: i === 0 ? "40%" : "79%", top: i === 0 ? "38%" : "75%" }}
            transition={{ duration: 1.2, ease: EASE }}
          >
            <path d="M5 3l14 7.5-6.2 1.6L10 18.5z" fill="#000" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" />
          </motion.svg>
        </div>
      </Rise>
    </section>
  );
}

// ───── Rows on the blue panel ─────

function Row({ title, text, children, flip = false }: { title: React.ReactNode; text: string; children: React.ReactNode; flip?: boolean }) {
  return (
    <div className={`grid items-center gap-10 md:grid-cols-2 md:gap-16 ${flip ? "md:[&>*:first-child]:order-2" : ""}`}>
      <Rise>
        <h3 className="h-display text-[clamp(30px,4vw,44px)]">{title}</h3>
        <p className="lead mt-4 max-w-md">{text}</p>
      </Rise>
      <Rise delay={0.1}>{children}</Rise>
    </div>
  );
}

const SENTENCE = ["So", "this", "is", "the", "new", "settings", "page,", "and", "inviting", "people", "takes", "one", "click."];

function CaptionsScene() {
  const ref = useRef<HTMLDivElement>(null);
  const [n, setN] = useState(0);
  const inView = useInView(ref, { amount: 0.4 });
  useEffect(() => {
    if (!inView) return;
    const t = setTimeout(() => setN((v) => (v + 1) % (SENTENCE.length + 4)), 380);
    return () => clearTimeout(t);
  }, [n, inView]);
  const shown = SENTENCE.slice(Math.max(0, Math.min(n, SENTENCE.length) - 6), Math.min(n, SENTENCE.length));
  return (
    <div ref={ref} className="relative aspect-[4/3] overflow-hidden rounded-[24px] bg-[linear-gradient(140deg,#cfe3f8,#9ec3ec)] [container-type:inline-size]">
      <div className="mac-window absolute inset-[10%_8%_24%] grid place-items-center bg-[linear-gradient(135deg,#2a3b5c,#16223a)]">
        <div className="aspect-square w-[22%] overflow-hidden rounded-full border-[0.4cqw] border-white/80">
          <div className="size-full bg-[radial-gradient(circle_at_50%_36%,#e8b896_0_15%,transparent_15.5%),radial-gradient(ellipse_at_50%_102%,#3b4a63_0_40%,transparent_40.5%),radial-gradient(circle_at_50%_28%,#3a2a20_0_17%,transparent_17.5%),linear-gradient(170deg,#e9e4dc,#cfc6b8)]" />
        </div>
      </div>
      <div className="absolute inset-x-[8%] bottom-[9%] flex min-h-[9cqw] items-center justify-center rounded-[2cqw] bg-black/75 px-[3cqw] text-center text-[3.6cqw] leading-snug font-semibold text-white/60 backdrop-blur">
        {shown.map((w, k) => (
          <span key={`${w}-${k}`} className={k === shown.length - 1 ? "text-[#ffd60a]" : "text-white"}>
            {w}&nbsp;
          </span>
        ))}
      </div>
    </div>
  );
}

function FillerScene() {
  const ref = useRef<HTMLDivElement>(null);
  const i = useLoop([1800, 1800, 2400], ref);
  const words: [string, boolean][] = [
    ["So", false],
    ["um,", true],
    ["this", false],
    ["is", false],
    ["the", false],
    ["uh,", true],
    ["new", false],
    ["settings", false],
    ["page,", false],
    ["you know,", true],
    ["and", false],
    ["it’s", false],
    ["fast.", false],
  ];
  return (
    <div ref={ref} className="mac-window p-7 text-left">
      <p className="text-sm font-medium text-muted">Transcript</p>
      <p className="mt-3 text-[clamp(18px,2.2vw,24px)] leading-relaxed">
        {words.map(([w, filler], k) => (
          <motion.span
            key={k}
            className="inline-block overflow-hidden whitespace-pre align-bottom"
            animate={{
              width: filler && i === 2 ? 0 : "auto",
              opacity: filler && i === 2 ? 0 : 1,
              color: filler && i >= 1 ? "#ff3b30" : "#111827",
              textDecorationLine: filler && i >= 1 ? "line-through" : "none",
            }}
            transition={{ duration: 0.6, ease: EASE }}
          >
            {w}{" "}
          </motion.span>
        ))}
      </p>
      <div className="mt-7 flex h-9 gap-1">
        {words.map(([, filler], k) => (
          <motion.i
            key={k}
            className="rounded-[5px]"
            animate={{ flexGrow: filler && i === 2 ? 0.0001 : 1, backgroundColor: filler && i >= 1 ? "#ffd2cf" : "#c9dcf3", marginRight: filler && i === 2 ? -4 : 0 }}
            transition={{ duration: 0.6, ease: EASE }}
            style={{ flexBasis: 0 }}
          />
        ))}
      </div>
      <div className="mt-5 flex items-center justify-between text-sm">
        <span className="text-muted">{i === 2 ? "3 filler words removed · 1.4 s shorter" : "3 filler words found"}</span>
        <span className="rounded-full bg-ink px-3.5 py-1.5 font-medium text-white">Remove all</span>
      </div>
    </div>
  );
}

function LinkScene() {
  const ref = useRef<HTMLDivElement>(null);
  const i = useLoop([1500, 1700, 3200], ref);
  return (
    <div ref={ref} className="relative aspect-[4/3] overflow-hidden rounded-[24px] bg-[linear-gradient(140deg,#dfeaf7,#bcd3ee)] [container-type:inline-size]">
      <AnimatePresence mode="wait">
        {i < 2 ? (
          <motion.div key="stop" className="absolute inset-0 grid place-items-center" exit={{ opacity: 0, scale: 0.96 }} transition={{ duration: 0.4 }}>
            <div className="flex items-center gap-[2cqw] rounded-[3cqw] bg-[#16181f] p-[1.6cqw] pr-[3cqw] text-[3cqw] text-white shadow-2xl">
              <motion.span className="grid size-[7cqw] place-items-center rounded-[2cqw] bg-record" animate={{ scale: i === 1 ? [1, 0.88, 1] : 1 }} transition={{ duration: 0.3 }}>
                <i className="size-[2.4cqw] rounded-[0.4cqw] bg-white" />
              </motion.span>
              <span className="font-semibold tabular-nums">2:14</span>
            </div>
            <AnimatePresence>
              {i === 1 && (
                <motion.div
                  className="absolute top-[12%] flex items-center gap-[1.6cqw] rounded-[2.4cqw] bg-white px-[2.4cqw] py-[1.8cqw] text-left text-[2.6cqw] shadow-xl"
                  initial={{ opacity: 0, y: -16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, ease: EASE }}
                >
                  <span className="grid size-[4.4cqw] place-items-center rounded-full bg-[#30d158] text-[2.4cqw] font-bold text-white">✓</span>
                  <span>
                    <b className="block">Link copied</b>
                    <span className="text-muted">umi.cam/v/settings-tour</span>
                  </span>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        ) : (
          <motion.div
            key="viewer"
            className="mac-window absolute inset-[8%] text-[2.2cqw]"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6, ease: EASE }}
          >
            <div className="flex items-center gap-[1.4cqw] border-b border-black/5 bg-[#f6f6f6] px-[1.6cqw] py-[1.2cqw]">
              <span className="mac-lights [&_i]:size-[1.4cqw]">
                <i />
                <i />
                <i />
              </span>
              <span className="mx-auto rounded-[0.8cqw] bg-black/5 px-[3cqw] py-[0.4cqw] text-black/50">umi.cam/v/settings-tour</span>
            </div>
            <div className="p-[2.4cqw]">
              <div className="aspect-[16/8] rounded-[1.4cqw] bg-[linear-gradient(135deg,#9eccfa,#2e5eb8)]" />
              <p className="mt-[1.6cqw] font-semibold">Settings tour</p>
              <div className="mt-[1.2cqw] flex gap-[1cqw]">
                {["👍 4", "🎉 2", "👀 7 views"].map((r, k) => (
                  <motion.span key={r} className="rounded-full bg-black/5 px-[1.4cqw] py-[0.5cqw]" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 + k * 0.2 }}>
                    {r}
                  </motion.span>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function Panel() {
  return (
    <section className="px-3 py-20 sm:px-4">
      <div className="mx-auto max-w-[1400px] rounded-[40px] bg-panel px-6 py-24 sm:px-12 lg:px-20">
        <div className="mx-auto grid max-w-6xl gap-28">
          <Row title="Captions write themselves" text="Transcribed on your computer in more than 90 languages. Fix a word by typing it.">
            <CaptionsScene />
          </Row>
          <Row flip title={<>Said “um”? It’s gone.</>} text="Delete words from the transcript to cut the video. Filler words and long pauses go in one click.">
            <FillerScene />
          </Row>
          <Row title="The link is copied before you let go" text="Press stop and paste. People watch in their browser, comment at the exact second, and you see who watched.">
            <LinkScene />
          </Row>
        </div>
      </div>
    </section>
  );
}

// ───── Privacy ─────

export function Privacy() {
  const [toggles, setToggles] = useState([true, true, true, false]);
  const labels = ["Transcribe on this computer", "Remove background noise on this computer", "Only upload when I share a link", "Send anonymous crash reports"];
  return (
    <section className="px-3 sm:px-4">
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
                    <div key={l} className={`flex items-center justify-between px-4 py-3 text-[14px] ${k < labels.length - 1 ? "border-b border-black/5" : ""} ${k === 3 ? "mt-0" : ""}`}>
                      {l}
                      <button
                        type="button"
                        aria-pressed={toggles[k]}
                        aria-label={l}
                        onClick={() => setToggles((t) => t.map((v, j) => (j === k ? !v : v)))}
                        className={`relative h-[22px] w-[38px] rounded-full transition-colors duration-300 ${toggles[k] ? "bg-accent" : "bg-black/15"}`}
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
            items: ["Unlimited recordings, no watermark", "The whole editor, 4K and GIF export", "Captions, voiceover and clean-up on your computer", "Import from Loom"],
          },
          {
            name: "Umi Cloud",
            price: "Soon",
            note: "pricing at launch",
            items: ["Links that upload while you record", "Who watched, and for how long", "Team spaces with shared videos and styles", "Passwords, expiry dates and embeds"],
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
  ["Is it really free?", "Yes. Recording, editing, exporting and everything that runs on your computer is free, with no time limit or watermark, for personal and commercial use. Only hosted features like share links and team spaces will be paid."],
  ["Does my video leave my computer?", "Only if you share a link. Captions, voiceover, noise removal and background removal all run locally."],
  ["Which computers does it run on?", "macOS 13 or later on Apple silicon and Intel, Windows 10 and 11, and most Linux distributions. There’s also a Chrome extension."],
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
            Press <kbd>⌥</kbd>
            <kbd>⇧</kbd>
            <kbd>L</kbd>
            <br />
            and start recording.
          </h2>
          <div className="mt-10">
            <DownloadButton />
          </div>
          <p className="mt-4 text-[15px] text-ink/60">Also for Windows, Linux and Chrome</p>
        </Rise>
      </div>
    </section>
  );
}

export function Footer() {
  const cols: [string, [string, string][]][] = [
    ["Product", [["Download", "#download"], ["Pricing", "#pricing"], ["Questions", "#faq"]]],
    ["Open source", [["GitHub", "https://github.com/umi-cam/umi"], ["Releases", "https://github.com/umi-cam/umi/releases"], ["Report a bug", "https://github.com/umi-cam/umi/issues"]]],
    ["Platforms", [["macOS", "#download"], ["Windows", "#download"], ["Linux", "#download"], ["Chrome", "#download"]]],
  ];
  return (
    <footer className="px-4 pt-20 pb-12">
      <div className="mx-auto grid max-w-6xl gap-10 sm:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div>
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
      <p className="mx-auto mt-14 max-w-6xl text-xs text-faint">© 2026 Umi · Photos from Pexels</p>
    </footer>
  );
}
