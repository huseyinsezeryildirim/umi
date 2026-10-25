"use client";

import { AnimatePresence, motion, useInView } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { AppleIcon, ChromeIcon, LinuxIcon, LoomIcon, WindowsIcon } from "./icons";
import { PLATFORMS } from "./Download";
import { Mark } from "./ui";

const EASE = [0.25, 1, 0.5, 1] as const;

export function Rise({ children, className = "", delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
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

function Head({ eyebrow, title, lead, align = "center" }: { eyebrow: string; title: React.ReactNode; lead?: string; align?: "center" | "left" }) {
  return (
    <Rise className={align === "center" ? "mx-auto max-w-3xl text-center" : "max-w-xl"}>
      <p className="text-[15px] font-medium text-accent">{eyebrow}</p>
      <h2 className="h-display mt-3 text-[clamp(34px,5vw,56px)]">{title}</h2>
      {lead && <p className={`lead mt-4 ${align === "center" ? "mx-auto max-w-xl" : ""}`}>{lead}</p>}
    </Rise>
  );
}

// ───── Modes ─────

const MODES = [
  { name: "Instant", line: "Stop, and the link is already on your clipboard.", media: "share" },
  { name: "Studio", line: "Record in full quality, polish it in the editor.", media: "studio" },
  { name: "Screenshot", line: "⌥⇧4, make it nice, paste it anywhere.", media: "shot" },
] as const;
const CYCLE = 6000;

export function Modes() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.4 });
  const [active, setActive] = useState(0);
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!inView || held) return;
    const t = setTimeout(() => setActive((a) => (a + 1) % MODES.length), CYCLE);
    return () => clearTimeout(t);
  }, [active, inView, held]);

  return (
    <section id="features" className="px-4 pt-40">
      <div ref={ref} className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-[0.85fr_1.15fr]">
        <div>
          <Head align="left" eyebrow="Three ways to record" title="One app for every kind of video." />
          <Rise className="mt-10" delay={0.1}>
            {MODES.map((m, i) => (
              <button
                key={m.name}
                type="button"
                onClick={() => (setActive(i), setHeld(true))}
                className="relative block w-full border-t border-line py-5 text-left last:border-b"
              >
                <span className={`block text-[22px] font-semibold tracking-tight transition-colors duration-500 ${i === active ? "text-ink" : "text-faint"}`}>{m.name}</span>
                <AnimatePresence initial={false}>
                  {i === active && (
                    <motion.span
                      className="block overflow-hidden text-[17px] text-muted"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.5, ease: EASE }}
                    >
                      <span className="block pt-1.5">{m.line}</span>
                    </motion.span>
                  )}
                </AnimatePresence>
                {i === active && !held && inView && (
                  <motion.span
                    key={`p${active}`}
                    className="absolute -top-px left-0 h-px origin-left bg-ink"
                    initial={{ width: "0%" }}
                    animate={{ width: "100%" }}
                    transition={{ duration: CYCLE / 1000, ease: "linear" }}
                  />
                )}
              </button>
            ))}
          </Rise>
        </div>
        <Rise delay={0.15}>
          <div className="relative aspect-[16/11] overflow-hidden rounded-[28px] bg-panel">
            <img src="/photos/dawn.jpg" alt="" className="absolute inset-0 size-full object-cover" />
            <AnimatePresence mode="popLayout">
              <motion.div
                key={MODES[active].media}
                className="absolute inset-0 flex items-center justify-center p-[6%]"
                initial={{ opacity: 0, y: 24, scale: 0.97, filter: "blur(8px)" }}
                animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: -16, scale: 0.98, filter: "blur(8px)" }}
                transition={{ duration: 0.7, ease: EASE }}
              >
                {MODES[active].media === "share" && <img src="/media/share-top.png" alt="The Share window: link and viewer insights" className="w-[86%] drop-shadow-[0_30px_40px_rgb(0_0_0/0.35)]" />}
                {MODES[active].media === "studio" && (
                  <video src="/media/after.mp4" autoPlay muted loop playsInline className="w-full rounded-xl shadow-[0_30px_60px_-15px_rgb(0_0_0/0.45)]" />
                )}
                {MODES[active].media === "shot" && <img src="/media/screenshot.jpg" alt="The screenshot editor" className="w-full rounded-xl shadow-[0_30px_60px_-15px_rgb(0_0_0/0.45)]" />}
              </motion.div>
            </AnimatePresence>
          </div>
        </Rise>
      </div>
    </section>
  );
}

// ───── On-device AI ─────

/** What the narrator says in the sample video (same timing as the app demo). */
const NARRATION = (() => {
  const text = "Here’s the new dashboard. Open any card to see more. This week is our best one yet. To share it, click Share and copy the link.";
  const words = text.split(" ");
  const step = 9.2 / words.length;
  return words.map((w, i) => ({ w, start: 0.3 + i * step, end: 0.3 + (i + 0.85) * step }));
})();
const CHAPTERS = [
  { at: 0, title: "The new dashboard" },
  { at: 4.2, title: "This week" },
  { at: 6.6, title: "Sharing it" },
];
const TITLE = "Dashboard walkthrough";
const SUMMARY = "A short tour of the new dashboard, this week’s numbers and how to share them with a link.";

/** Types `text` once when `start` turns true. */
function useTyped(text: string, start: boolean, speed = 22) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!start || n >= text.length) return;
    const t = setTimeout(() => setN((v) => v + 1), speed);
    return () => clearTimeout(t);
  }, [start, n, text, speed]);
  return text.slice(0, n);
}

const AI_ITEMS = [
  { tab: "Transcript", title: "Auto transcription", line: "Every word, on your computer, in 90+ languages. Click one to jump there." },
  { tab: "Summary", title: "Titles, summaries and chapters", line: "Written when you stop recording, with chapters viewers can skim." },
  { tab: "Comments", title: "Comments and reactions", line: "Viewers answer at the exact second. You see it on the timeline." },
] as const;
type AiTab = (typeof AI_ITEMS)[number]["tab"];
const COMMENTS = [
  { who: "Ada", at: 2, text: "The new cards are so much easier to read." },
  { who: "Lin", at: 6, text: "Sharing it with the team now 🙌" },
];

export function Ai() {
  const box = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const inView = useInView(box, { amount: 0.35 });
  const [t, setT] = useState(0);
  const [active, setActive] = useState(0);
  const [held, setHeld] = useState(false);
  const tab: AiTab = AI_ITEMS[active].tab;
  const title = useTyped(TITLE, inView, 28);
  const summary = useTyped(SUMMARY, inView && title.length === TITLE.length, 12);

  useEffect(() => {
    if (!inView || held) return;
    const id = setTimeout(() => setActive((v) => (v + 1) % AI_ITEMS.length), 6500);
    return () => clearTimeout(id);
  }, [active, inView, held]);
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (!inView) return void v.pause();
    void v.play().catch(() => {});
    let frame = requestAnimationFrame(function tick() {
      setT(v.currentTime);
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [inView]);
  const seek = (to: number) => {
    if (video.current) video.current.currentTime = to;
  };

  const current = NARRATION.findIndex((w) => t >= w.start && t <= w.end + 0.2);
  const line = current >= 0 ? NARRATION.slice(Math.floor(current / 6) * 6, Math.floor(current / 6) * 6 + 6) : [];
  const chapter = CHAPTERS.reduce((best, c, i) => (t >= c.at ? i : best), 0);

  return (
    <section className="px-3 pt-40 sm:px-4">
      <div className="mx-auto max-w-[1400px] rounded-[40px] bg-panel px-4 py-24 sm:px-10">
        <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-[1.25fr_0.75fr]">
          {/* Umi's share page, as viewers see it. */}
          <Rise>
            <div ref={box} className="relative overflow-hidden rounded-[28px] p-[3.5%] shadow-[0_40px_80px_-30px_rgb(20_60_130/0.45)]">
              <img src="/photos/dawn.jpg" alt="" className="absolute inset-0 size-full object-cover" />
              <div className="relative overflow-hidden rounded-xl bg-white shadow-[0_0_0_0.5px_rgb(0_0_0/0.15),0_24px_50px_-20px_rgb(0_0_0/0.4)]">
                <div className="flex items-center gap-3 border-b border-black/5 bg-[#f6f6f6] px-4 py-2.5">
                  <span className="mac-lights">
                    <i />
                    <i />
                    <i />
                  </span>
                  <span className="mx-auto rounded-md bg-black/5 px-10 py-0.5 text-[11px] text-black/50">umi.cam/v/dashboard-walkthrough</span>
                </div>
                <div className="grid gap-4 p-4 md:grid-cols-[1.35fr_1fr]">
                  <div className="min-w-0">
                    <div className="flex items-center gap-3">
                      <span className="grid size-8 place-items-center rounded-full bg-tint">
                        <Mark className="size-5 text-accent" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[14px] font-semibold">{title || " "}</p>
                        <p className="text-[11px] text-muted">Ada · just now · 0:10</p>
                      </div>
                      <span className="rounded-lg bg-accent px-3 py-1.5 text-[12px] font-semibold text-white">Share</span>
                    </div>
                    <div className="relative mt-3 aspect-[16/10] overflow-hidden rounded-lg bg-[#6d9be0]">
                      <video ref={video} src="/media/after.mp4" poster="/media/after-poster.jpg" muted loop playsInline preload="metadata" className="absolute inset-0 size-full object-cover" />
                      <video src="/media/camera.mp4" poster="/media/camera.jpg" autoPlay muted loop playsInline className="absolute right-[4%] bottom-[14%] aspect-square w-[17%] rounded-full border-2 border-white object-cover shadow-lg" />
                      <div className="absolute inset-x-0 bottom-[5%] flex justify-center px-[20%]">
                        {line.length > 0 && (
                          <p className="rounded-md bg-black/75 px-2 py-1 text-center text-[clamp(9px,1vw,13px)] font-semibold text-white">
                            {line.map((w, k) => (
                              <span key={k} className={NARRATION.indexOf(w) === current ? "text-[#ffd60a]" : ""}>
                                {w.w}{" "}
                              </span>
                            ))}
                          </p>
                        )}
                      </div>
                      <div className="absolute inset-x-[3%] bottom-[2%] h-1 overflow-hidden rounded bg-white/40">
                        <i className="block h-full bg-white" style={{ width: `${(t / 10) * 100}%` }} />
                      </div>
                    </div>
                    <div className="mt-3 flex items-center gap-2 text-[12px]">
                      {["👍 4", "🎉 2", "❤️ 3"].map((r) => (
                        <span key={r} className="rounded-full bg-black/5 px-2.5 py-1">
                          {r}
                        </span>
                      ))}
                      <span className="ml-auto text-muted">42 views</span>
                    </div>
                  </div>
                  {/* Tabs */}
                  <div className="flex min-h-[300px] flex-col rounded-lg border border-black/5">
                    <div className="flex gap-4 border-b border-black/5 px-3 text-[12px]">
                      {(["Comments", "Summary", "Transcript"] as const).map((name) => (
                        <button
                          key={name}
                          type="button"
                          onClick={() => (setActive(AI_ITEMS.findIndex((x) => x.tab === name)), setHeld(true))}
                          className={`relative py-2.5 font-medium ${tab === name ? "text-ink" : "text-muted"}`}
                        >
                          {name}
                          {tab === name && <motion.i layoutId="ai-tab" className="absolute inset-x-0 -bottom-px h-0.5 rounded bg-ink" />}
                        </button>
                      ))}
                    </div>
                    <AnimatePresence mode="wait">
                      <motion.div
                        key={tab}
                        className="flex-1 p-3 text-[12.5px]"
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{ duration: 0.3 }}
                      >
                        {tab === "Summary" && (
                          <>
                            <p className="flex items-center gap-2 text-[10.5px] font-semibold tracking-wide text-muted uppercase">
                              Summary
                              <span className="rounded-full bg-[#ede7ff] px-1.5 py-0.5 text-[10px] tracking-normal text-[#7c4dff] normal-case">✦ Umi AI</span>
                            </p>
                            <p className="mt-2 min-h-[4.5em] leading-relaxed text-ink">{summary}</p>
                            <p className="mt-3 text-[10.5px] font-semibold tracking-wide text-muted uppercase">Chapters</p>
                            <div className="mt-1 grid">
                              {CHAPTERS.map((c, k) => (
                                <button key={c.title} type="button" onClick={() => seek(c.at)} className={`flex gap-3 rounded-md px-1.5 py-1.5 text-left transition-colors ${k === chapter ? "bg-tint" : "hover:bg-black/5"}`}>
                                  <span className="w-7 font-mono text-[11px] text-muted tabular-nums">0:{String(Math.floor(c.at)).padStart(2, "0")}</span>
                                  {c.title}
                                </button>
                              ))}
                            </div>
                          </>
                        )}
                        {tab === "Transcript" && (
                          <p className="leading-relaxed">
                            {NARRATION.map((w, k) => (
                              <button key={k} type="button" onClick={() => seek(w.start)} className={`rounded-[3px] transition-colors duration-150 ${k === current ? "bg-[#ffd60a]/60 text-ink" : k < current ? "text-ink" : "text-faint"}`}>
                                {w.w}&nbsp;
                              </button>
                            ))}
                          </p>
                        )}
                        {tab === "Comments" && (
                          <div className="grid gap-2.5">
                            {COMMENTS.map((c) => (
                              <div key={c.who} className={`flex gap-2.5 rounded-lg p-1.5 transition-colors ${t >= c.at && t < c.at + 2.5 ? "bg-tint" : ""}`}>
                                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent text-[10px] font-bold text-white">{c.who[0]}</span>
                                <p>
                                  <b>{c.who}</b> <button type="button" onClick={() => seek(c.at)} className="text-accent">0:0{c.at}</button>
                                  <span className="block text-text">{c.text}</span>
                                </p>
                              </div>
                            ))}
                          </div>
                        )}
                      </motion.div>
                    </AnimatePresence>
                  </div>
                </div>
              </div>
            </div>
          </Rise>
          <div>
            <Head align="left" eyebrow="Umi AI · on your computer" title="Every recording, understood." lead="The work after the recording is already done, and none of it leaves your Mac." />
            <Rise className="mt-8" delay={0.1}>
              {AI_ITEMS.map((it, i) => (
                <button key={it.title} type="button" onClick={() => (setActive(i), setHeld(true))} className="relative block w-full border-t border-line py-5 text-left last:border-b">
                  <span className={`block text-[20px] font-semibold tracking-tight transition-colors duration-500 ${i === active ? "text-ink" : "text-faint"}`}>{it.title}</span>
                  <AnimatePresence initial={false}>
                    {i === active && (
                      <motion.span className="block overflow-hidden text-[15px] text-muted" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.5, ease: EASE }}>
                        <span className="block pt-1.5">{it.line}</span>
                      </motion.span>
                    )}
                  </AnimatePresence>
                  {i === active && !held && inView && (
                    <motion.span key={`a${active}`} className="absolute -top-px left-0 h-px origin-left bg-ink" initial={{ width: "0%" }} animate={{ width: "100%" }} transition={{ duration: 6.5, ease: "linear" }} />
                  )}
                </button>
              ))}
            </Rise>
          </div>
        </div>
      </div>
    </section>
  );
}

// ───── Platforms ─────

const OS = [
  { key: "mac", name: "macOS", line: "Apple silicon and Intel. macOS 13 or newer.", icon: <AppleIcon className="size-7" />, href: PLATFORMS[0].href, label: "Download for macOS", bg: "radial-gradient(120% 90% at 0% 0%, #b9dafc 0%, transparent 55%), radial-gradient(90% 80% at 100% 100%, #e3dafc 0%, transparent 60%), #eef4fb" },
  { key: "windows", name: "Windows", line: "Windows 10 and 11.", icon: <WindowsIcon className="size-6 text-[#0b0f19]" />, href: PLATFORMS[2].href, label: "Download for Windows", bg: "radial-gradient(110% 90% at 100% 0%, #d6cbfb 0%, transparent 55%), radial-gradient(90% 80% at 0% 100%, #f8dbe9 0%, transparent 60%), #f2f1fb" },
  { key: "linux", name: "Linux", line: "AppImage and .deb for Ubuntu, Debian and more.", icon: <LinuxIcon className="size-7" />, href: PLATFORMS[3].href, label: "Download for Linux", bg: "radial-gradient(110% 90% at 0% 100%, #bdebd6 0%, transparent 55%), radial-gradient(90% 80% at 100% 100%, #fbe9c9 0%, transparent 60%), #eef7f2" },
];

/** Which OS this visitor is on (for the "Your device" badge). */
function useOs() {
  const [os, setOs] = useState<string | null>(null);
  useEffect(() => {
    const ua = navigator.userAgent;
    setOs(/Android|iPhone|iPad/.test(ua) ? null : /Mac/.test(ua) ? "mac" : /Win/.test(ua) ? "windows" : /Linux/.test(ua) ? "linux" : null);
  }, []);
  return os;
}

export function Platforms() {
  const os = useOs();
  return (
    <section className="px-4 pt-40">
      <Head eyebrow="Every platform" title="Native on Mac, Windows and Linux." lead="One app, the same editor everywhere, plus an extension for the browser." />
      <div className="mx-auto mt-14 grid max-w-6xl gap-3 md:grid-cols-3">
        {OS.map((o, i) => (
          <Rise key={o.key} delay={i * 0.07}>
            <div className="group relative flex h-full flex-col rounded-[28px] p-7 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.6)]" style={{ background: o.bg }}>
              <div className="flex items-start justify-between">
                <span className="grid size-14 place-items-center rounded-2xl bg-white shadow-[0_8px_20px_-8px_rgb(20_40_90/0.3)] transition-transform duration-500 group-hover:-translate-y-0.5">{o.icon}</span>
                {os === o.key && <span className="rounded-full bg-white/80 px-3 py-1 font-mono text-[11px] tracking-[0.12em] text-muted uppercase">Your device</span>}
              </div>
              <h3 className="mt-14 text-[clamp(30px,3.4vw,42px)] font-semibold tracking-[-0.03em]">{o.name}</h3>
              <p className="mt-1 text-[15px] text-text">{o.line}</p>
              <a href={o.href} className="mt-6 inline-flex h-11 w-fit items-center rounded-xl bg-white/90 px-5 text-[15px] font-medium text-ink shadow-[0_0_0_1px_rgb(17_24_39/0.08),0_6px_16px_-8px_rgb(20_40_90/0.35)] transition-transform duration-300 hover:-translate-y-0.5">
                {o.label}
              </a>
            </div>
          </Rise>
        ))}
        <Rise className="md:col-span-1" delay={0.05}>
          <div className="relative flex h-full flex-col justify-end overflow-hidden rounded-[28px] bg-[#f3f5f8] p-7">
            <ChromeScene />
            <h3 className="mt-6 text-[22px] font-semibold tracking-tight">Chrome extension</h3>
            <p className="mt-1 text-[15px] text-muted">Record a tab or your whole screen without leaving the browser.</p>
          </div>
        </Rise>
        <Rise className="md:col-span-2" delay={0.1}>
          <div className="flex h-full flex-col rounded-[28px] bg-[#f3f5f8] p-7">
            <h3 className="text-[22px] font-semibold tracking-tight">Build it yourself</h3>
            <p className="mt-1 text-[15px] text-muted">Umi is open source. Read it, change it, ship your own.</p>
            <div className="mt-6 flex-1 rounded-2xl bg-[#0f1115] p-5 font-mono text-[13.5px] leading-7 text-white/85">
              <p>
                <span className="text-white/35">$ </span>git clone https://github.com/umi-cam/umi
              </p>
              <p>
                <span className="text-white/35">$ </span>pnpm install
              </p>
              <p>
                <span className="text-white/35">$ </span>pnpm dev
              </p>
              <p className="text-[#30d158]">✓ Umi is running</p>
            </div>
          </div>
        </Rise>
      </div>
    </section>
  );
}

/** A browser with the extension's popup recording a tab. */
function ChromeScene() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.5 });
  const [rec, setRec] = useState(false);
  useEffect(() => {
    if (!inView) return;
    const id = setTimeout(() => setRec((v) => !v), rec ? 2600 : 1600);
    return () => clearTimeout(id);
  }, [rec, inView]);
  return (
    <div ref={ref} className="relative overflow-hidden rounded-xl bg-white shadow-[0_0_0_0.5px_rgb(0_0_0/0.12),0_16px_36px_-16px_rgb(20_40_90/0.35)]">
      <div className="flex items-center gap-2 border-b border-black/5 bg-[#f1f3f6] px-3 py-2">
        <span className="mac-lights [&_i]:size-2.5">
          <i />
          <i />
          <i />
        </span>
        <span className="h-4 flex-1 rounded-md bg-white" />
        <span className={`grid size-5 place-items-center rounded-md transition-colors ${rec ? "bg-record/15" : "bg-tint"}`}>
          {rec ? <i className="size-2 animate-pulse rounded-full bg-record" /> : <Mark className="size-3.5 text-accent" />}
        </span>
      </div>
      <div className="relative grid gap-1.5 p-3">
        <i className="h-2 w-1/2 rounded bg-ink/12" />
        <i className="h-2 w-2/3 rounded bg-ink/8" />
        <i className="h-10 rounded bg-ink/[0.05]" />
        <AnimatePresence>
          {!rec && (
            <motion.div
              className="absolute top-1.5 right-2 w-[52%] rounded-lg bg-white p-2 text-[10.5px] shadow-[0_0_0_1px_rgb(17_24_39/0.08),0_10px_24px_-10px_rgb(20_40_90/0.4)]"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.3 }}
            >
              <p className="rounded-md bg-ink px-2 py-1.5 text-center font-semibold text-white">Record this tab</p>
              <p className="mt-1 px-2 py-1 text-center text-muted">Whole screen</p>
            </motion.div>
          )}
        </AnimatePresence>
        {rec && <span className="pointer-events-none absolute inset-1 rounded-md ring-2 ring-record/70" />}
      </div>
    </div>
  );
}

// ───── Agents ─────

const SESSION: { kind: "prompt" | "say" | "tool" | "out"; text: string }[] = [
  { kind: "prompt", text: "Clean up my last recording: cut the ums, add captions, export it" },
  { kind: "say", text: "I’ll find it, transcribe it, cut the fillers, turn captions on and export a 1080p MP4." },
  { kind: "tool", text: "umi.list_recordings" },
  { kind: "out", text: "[{ \"name\": \"Dashboard walkthrough\", \"duration\": 10.1 }]" },
  { kind: "tool", text: "umi.transcribe  { \"language\": \"auto\" }" },
  { kind: "out", text: "24 words · en" },
  { kind: "tool", text: "umi.edit  [remove_fillers, captions on]" },
  { kind: "out", text: "3 fillers cut · captions on" },
  { kind: "tool", text: "umi.export  { \"format\": \"mp4\", \"resolution\": 1080 }" },
  { kind: "out", text: "~/Movies/Umi/Exports/Dashboard walkthrough.mp4" },
];

export function Agents() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.3 });
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (!inView || shown >= SESSION.length) return;
    const id = setTimeout(() => setShown((v) => v + 1), shown === 0 ? 400 : SESSION[shown - 1].kind === "tool" ? 650 : 450);
    return () => clearTimeout(id);
  }, [inView, shown]);
  const finished = shown >= SESSION.length;
  return (
    <section className="px-3 pt-40 sm:px-4">
      <Head eyebrow="Umi for agents" title="Your AI agent can edit too." lead="Umi has a local MCP server, so Claude Code, Cursor or any agent can find, transcribe, cut and export your recordings. Nothing runs without you asking." />
      <Rise className="mx-auto mt-14 max-w-[1400px]" delay={0.1}>
        <div ref={ref} className="grid gap-6 rounded-[36px] bg-[#111216] p-5 sm:p-8 lg:grid-cols-[1fr_1fr]">
          <div className="rounded-[22px] bg-[#17181d] p-5 font-mono text-[13px] leading-6 text-white/80 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.06)]">
            <div className="mb-4 flex items-center gap-3 border-b border-white/10 pb-3">
              <span className="mac-lights">
                <i />
                <i />
                <i />
              </span>
              <span className="text-[11px] tracking-[0.12em] text-white/40 uppercase">Agent session · ~/videos</span>
            </div>
            {SESSION.slice(0, shown).map((l, i) => (
              <motion.div key={i} className="mb-2" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
                {l.kind === "prompt" && (
                  <p className="font-sans text-[15px] text-white">
                    <span className="mr-2 text-white/40">›</span>
                    {l.text}
                  </p>
                )}
                {l.kind === "say" && (
                  <p className="mt-3 flex gap-2.5 font-sans text-[14px] text-white/85">
                    <i className="mt-1.5 size-2.5 shrink-0 rounded-[3px] bg-[#a78bfa]" />
                    {l.text}
                  </p>
                )}
                {l.kind === "tool" && (
                  <p className="mt-3 flex items-center gap-2">
                    <span className="grid size-4 place-items-center rounded-full bg-[#30d158] text-[10px] text-black">✓</span>
                    <span className="text-white">{l.text}</span>
                  </p>
                )}
                {l.kind === "out" && <p className="pl-6 text-[#7dd3fc]">└ {l.text}</p>}
              </motion.div>
            ))}
            {!finished && <span className="inline-block h-4 w-2 animate-pulse bg-white/70 align-middle" />}
          </div>
          {/* The result: the exported file, playing. */}
          <div className="relative grid place-items-center overflow-hidden rounded-[22px] p-[6%]">
            <img src="/photos/dawn.jpg" alt="" className="absolute inset-0 size-full object-cover opacity-90" />
            <motion.div
              className="relative w-full overflow-hidden rounded-xl bg-[#1d1f24] shadow-[0_30px_60px_-20px_rgb(0_0_0/0.6)]"
              initial={{ opacity: 0, y: 20, scale: 0.97 }}
              animate={finished ? { opacity: 1, y: 0, scale: 1 } : {}}
              transition={{ duration: 0.7, ease: EASE }}
            >
              <div className="flex items-center gap-3 px-3 py-2 text-[11px] text-white/60">
                <span className="mac-lights [&_i]:size-2.5">
                  <i />
                  <i />
                  <i />
                </span>
                <span className="mx-auto">Dashboard walkthrough.mp4</span>
              </div>
              <video src="/media/after.mp4" poster="/media/after-poster.jpg" autoPlay muted loop playsInline className="block w-full" />
            </motion.div>
          </div>
        </div>
      </Rise>
    </section>
  );
}

// ───── Agent kit ─────

const KIT = [
  { dot: "#7fb2f4", title: "One line to set up", text: "Point Claude Code, Cursor or Codex at Umi’s MCP server and it’s ready.", cmd: "$ claude mcp add umi -- umi-mcp" },
  { dot: "#b9a4f7", title: "Answers come back as data", text: "Every tool returns JSON, so agents and scripts can chain them.", cmd: "→ list_recordings  [{ \"name\": … }]" },
  { dot: "#7fd4ad", title: "Local only, zero secrets", text: "The server runs on your machine and reads your library. No keys pass through the model.", cmd: "$ umi-mcp" },
  { dot: "#f4b77f", title: "You stay in charge", text: "It edits and exports. It never records you or uploads anything on its own.", cmd: "list · describe · transcribe · edit · export" },
];

const KIT_TABS = {
  MCP: ['describe_recording { "recording": "Dashboard walkthrough" }', 'edit { "operations": [{ "op": "remove_fillers" }] }', 'export { "format": "mp4" }'],
  Config: ['"mcpServers": {', '  "umi": { "command": "umi-mcp" }', "}"],
} as const;

export function AgentKit() {
  const [tab, setTab] = useState<keyof typeof KIT_TABS>("MCP");
  return (
    <section className="px-3 pt-6 sm:px-4">
      <div className="mx-auto grid max-w-[1400px] gap-3 lg:grid-cols-[1fr_1fr_1.25fr]">
        <div className="grid gap-3 sm:grid-cols-2 lg:col-span-2">
          {KIT.map((k, i) => (
            <Rise key={k.title} delay={i * 0.06}>
              <div className="flex h-full flex-col rounded-[28px] bg-[#f3f5f8] p-7">
                <i className="size-2" style={{ background: k.dot }} />
                <h3 className="mt-5 text-[22px] font-semibold tracking-tight">{k.title}</h3>
                <p className="mt-2 flex-1 text-[15px] text-muted">{k.text}</p>
                <p className="mt-6 rounded-xl bg-white px-4 py-3 font-mono text-[13px] text-ink shadow-[0_0_0_1px_rgb(17_24_39/0.06)]">
                  <span className="text-faint">{k.cmd.slice(0, 2).trim() === "$" || k.cmd.startsWith("→") ? k.cmd.slice(0, 2) : ""}</span>
                  {k.cmd.startsWith("$ ") || k.cmd.startsWith("→ ") ? k.cmd.slice(2) : k.cmd}
                </p>
              </div>
            </Rise>
          ))}
        </div>
        <Rise delay={0.12}>
          <div className="flex h-full flex-col rounded-[28px] bg-[#f3f5f8] p-7">
            <div className="flex w-fit gap-1 rounded-full bg-white p-1 shadow-[0_0_0_1px_rgb(17_24_39/0.06)]">
              {(Object.keys(KIT_TABS) as (keyof typeof KIT_TABS)[]).map((t) => (
                <button key={t} type="button" onClick={() => setTab(t)} className={`relative h-9 rounded-full px-5 text-[14px] font-medium transition-colors ${tab === t ? "text-white" : "text-muted hover:text-ink"}`}>
                  {tab === t && <motion.span layoutId="kit-tab" className="absolute inset-0 rounded-full bg-ink" transition={{ duration: 0.35, ease: EASE }} />}
                  <span className="relative">{t}</span>
                </button>
              ))}
            </div>
            <div className="mt-5 min-h-36 rounded-2xl bg-[#0f1115] p-5 font-mono text-[13px] leading-7 text-white/85">
              <AnimatePresence mode="wait">
                <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.25 }}>
                  {KIT_TABS[tab].map((l) => (
                    <p key={l} className="break-words whitespace-pre-wrap">
                      {tab === "MCP" && <span className="text-white/35">→ </span>}
                      {l}
                    </p>
                  ))}
                </motion.div>
              </AnimatePresence>
            </div>
            <p className="mt-5 text-[15px] text-muted">Find a recording, read its transcript, cut it and export it from any agent that speaks MCP.</p>
            <a href="https://github.com/umi-cam/umi" className="mt-6 inline-flex h-11 w-fit items-center rounded-xl bg-white px-5 text-[15px] font-medium shadow-[0_0_0_1px_rgb(17_24_39/0.08)] transition-transform duration-300 hover:-translate-y-0.5">
              Read the MCP docs
            </a>
          </div>
        </Rise>
      </div>
    </section>
  );
}

// ───── Testimonials ─────
// Placeholder quotes until real ones come in. Replace before launch.

const QUOTES = [
  "A quote from an early user goes here. Two or three sentences about what Umi changed for them.",
  "A short quote.",
  "A longer quote from someone who switched from Loom. What they liked about the editor, the captions and the price, and how long it took to move their team over.",
  "A quote about recording a bug report and sending the link in seconds.",
  "A quote from a developer who used the MCP server with their agent.",
  "A quote about how the exports look edited without editing anything.",
];

export function Testimonials() {
  return (
    <section className="px-4 pt-40">
      <Head eyebrow="Testimonials" title="Loved by the people who use it." lead="What early users say about recording with Umi." />
      <div className="mx-auto mt-14 max-w-6xl columns-1 gap-3 sm:columns-2 lg:columns-3">
        {QUOTES.map((q, i) => (
          <Rise key={i} delay={(i % 3) * 0.06} className="mb-3 break-inside-avoid">
            <figure className="rounded-[24px] bg-white p-7 shadow-[0_0_0_1px_rgb(17_24_39/0.07),0_10px_30px_-20px_rgb(20_40_90/0.25)]">
              <blockquote className="text-[16px] leading-relaxed text-text">{q}</blockquote>
              <figcaption className="mt-6 flex items-center gap-3">
                <span className="size-10 rounded-full bg-gradient-to-br from-[#dbe7f7] to-[#eadff8]" />
                <span>
                  <span className="block text-[15px] font-medium">Name Surname</span>
                  <span className="block text-[14px] text-faint">@handle</span>
                </span>
              </figcaption>
            </figure>
          </Rise>
        ))}
      </div>
    </section>
  );
}

// ───── Loom ─────

export function Loom() {
  return (
    <section id="loom" className="px-4 pt-32">
      <Rise className="mx-auto flex max-w-5xl flex-col items-center gap-8 rounded-[28px] bg-panel px-8 py-12 text-center md:flex-row md:text-left">
        <div className="flex-1">
          <p className="flex items-center justify-center gap-2 text-[15px] font-medium text-[#625df5] md:justify-start">
            <LoomIcon className="size-4" />
            Switching from Loom
          </p>
          <h3 className="h-display mt-2 text-[clamp(26px,3.2vw,34px)]">Bring your whole Loom library.</h3>
          <p className="mt-2 text-muted">Paste the links or drop in your library’s CSV. They become Umi projects you can edit.</p>
        </div>
        <div className="flex w-full max-w-md flex-col items-center gap-3 md:items-end">
          <div className="flex w-full items-center gap-2 rounded-full bg-white p-1.5 pl-5 shadow-[0_0_0_1px_rgb(17_24_39/0.06)]">
            <span className="flex-1 truncate text-left text-[15px] text-faint">
              loom.com/share/…<span className="hidden sm:inline"> or library.csv</span>
            </span>
            <a href="#download" className="btn-dark h-10">
              Import
              <span aria-hidden>→</span>
            </a>
          </div>
          <p className="flex items-center gap-2 text-[14px] text-muted">
            <span className="grid size-5 place-items-center rounded-full bg-[#30d158]/15 text-[11px] text-[#1f9d47]">✓</span>
            Free. No account needed.
          </p>
        </div>
      </Rise>
    </section>
  );
}
