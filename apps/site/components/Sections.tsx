"use client";

import { AnimatePresence, motion, useInView } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { AppleIcon, ChromeIcon, LinuxIcon, WindowsIcon } from "./icons";
import { PLATFORMS } from "./Download";

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

export function Ai() {
  const box = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const inView = useInView(box, { amount: 0.35 });
  const [t, setT] = useState(0);
  const title = useTyped(TITLE, inView, 28);
  const summary = useTyped(SUMMARY, inView && title.length === TITLE.length, 12);

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

  const current = NARRATION.findIndex((w) => t >= w.start && t <= w.end + 0.2);
  const line = current >= 0 ? NARRATION.slice(Math.floor(current / 6) * 6, Math.floor(current / 6) * 6 + 6) : [];
  const chapter = CHAPTERS.reduce((best, c, i) => (t >= c.at ? i : best), 0);

  return (
    <section className="px-3 pt-40 sm:px-4">
      <div className="mx-auto max-w-[1400px] rounded-[40px] bg-panel px-4 py-24 sm:px-10">
        <Head eyebrow="AI, on your computer" title="Every recording, understood." lead="Captions, a title, a summary and chapters. Nothing leaves your Mac to make them." />
        <Rise className="mx-auto mt-14 grid max-w-6xl gap-4 lg:grid-cols-[1.55fr_1fr]" delay={0.1}>
          <div ref={box} className="relative aspect-[16/10] overflow-hidden rounded-[24px] bg-[#6d9be0] shadow-[0_40px_80px_-30px_rgb(20_60_130/0.45)] lg:aspect-auto">
            <video ref={video} src="/media/after.mp4" poster="/media/after-poster.jpg" muted loop playsInline preload="metadata" className="absolute inset-0 size-full object-cover" />
            <video src="/media/camera.mp4" poster="/media/camera.jpg" autoPlay muted loop playsInline className="absolute right-[4%] bottom-[17%] aspect-square w-[15%] rounded-full border-[3px] border-white object-cover shadow-[0_10px_30px_rgb(0_0_0/0.3)]" />
            <div className="absolute inset-x-0 bottom-[6%] flex justify-center px-[22%]">
              <AnimatePresence>
                {line.length > 0 && (
                  <motion.p
                    key={line[0].start}
                    className="rounded-lg bg-black/75 px-3 py-1.5 text-center text-[clamp(12px,1.5vw,19px)] font-semibold text-white backdrop-blur"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.25 }}
                  >
                    {line.map((w, k) => (
                      <span key={k} className={NARRATION.indexOf(w) === current ? "text-[#ffd60a]" : ""}>
                        {w.w}{" "}
                      </span>
                    ))}
                  </motion.p>
                )}
              </AnimatePresence>
            </div>
          </div>
          <div className="flex flex-col gap-3">
            <div className="rounded-[20px] bg-white p-5 shadow-[0_0_0_1px_rgb(17_24_39/0.05)]">
              <p className="flex items-center gap-1.5 text-[12px] font-semibold text-accent">
                <svg viewBox="0 0 24 24" className="size-3.5" fill="currentColor" aria-hidden>
                  <path d="M12 2l2 6.5L20.5 10 14 12l-2 6.5-2-6.5L3.5 10 10 8.5z" />
                </svg>
                Written by Umi
              </p>
              <p className="mt-2 min-h-[1.4em] text-[18px] font-semibold tracking-tight">
                {title}
                {title.length < TITLE.length && <span className="animate-pulse text-accent">|</span>}
              </p>
              <p className="mt-1 min-h-[3em] text-[14px] text-muted">{summary}</p>
            </div>
            <div className="rounded-[20px] bg-white p-5 shadow-[0_0_0_1px_rgb(17_24_39/0.05)]">
              <p className="text-[12px] font-semibold text-muted">Chapters</p>
              <div className="mt-2 grid gap-1">
                {CHAPTERS.map((c, k) => (
                  <div key={c.title} className={`flex items-center gap-3 rounded-lg px-2 py-1.5 text-[14px] transition-colors duration-300 ${k === chapter ? "bg-tint text-ink" : "text-muted"}`}>
                    <span className="w-8 font-mono text-[12px] tabular-nums">0:{String(Math.floor(c.at)).padStart(2, "0")}</span>
                    {c.title}
                  </div>
                ))}
              </div>
            </div>
            <div className="flex-1 rounded-[20px] bg-white p-5 shadow-[0_0_0_1px_rgb(17_24_39/0.05)]">
              <p className="text-[12px] font-semibold text-muted">Transcript</p>
              <p className="mt-2 text-[14px] leading-relaxed">
                {NARRATION.map((w, k) => (
                  <span key={k} className={`rounded-[3px] transition-colors duration-150 ${k === current ? "bg-[#ffd60a]/60 text-ink" : k < current ? "text-ink" : "text-faint"}`}>
                    {w.w}{" "}
                  </span>
                ))}
              </p>
            </div>
          </div>
        </Rise>
      </div>
    </section>
  );
}

// ───── Platforms ─────

export function Platforms() {
  const items = [
    { name: "macOS", note: "13 or later", icon: <AppleIcon className="size-8" />, href: PLATFORMS[0].href },
    { name: "Windows", note: "10 and 11", icon: <WindowsIcon className="size-7 text-[#0078d4]" />, href: PLATFORMS[2].href },
    { name: "Linux", note: "AppImage · .deb", icon: <LinuxIcon className="size-8" />, href: PLATFORMS[3].href },
    { name: "Chrome", note: "Extension", icon: <ChromeIcon className="size-8" />, href: PLATFORMS[4].href },
  ];
  return (
    <section className="px-4 pt-40">
      <Head eyebrow="Every platform" title="Native on Mac, Windows and Linux." />
      <div className="mx-auto mt-14 grid max-w-5xl grid-cols-2 gap-3 lg:grid-cols-4">
        {items.map((it, i) => (
          <Rise key={it.name} delay={i * 0.06}>
            <a href={it.href} className="group flex flex-col items-center rounded-[24px] bg-panel px-4 py-10 transition-transform duration-500 hover:-translate-y-1">
              <span className="grid size-16 place-items-center rounded-2xl bg-white shadow-[0_8px_20px_-8px_rgb(20_60_130/0.3)] transition-transform duration-500 group-hover:scale-105">{it.icon}</span>
              <span className="mt-5 text-[17px] font-semibold">{it.name}</span>
              <span className="text-[14px] text-muted">{it.note}</span>
            </a>
          </Rise>
        ))}
      </div>
    </section>
  );
}

// ───── Agents ─────

const LINES: [string, string][] = [
  ["$", "claude mcp add umi -- umi-mcp"],
  [">", "Remove the ums from my last recording and export it"],
  ["·", "describe_recording  “Dashboard walkthrough”, 0:10"],
  ["·", "edit  remove_fillers → 3 words, 1.4 s"],
  ["·", "export  mp4, 1080p"],
  ["✓", "Saved to Movies/Umi/Exports/Dashboard walkthrough.mp4"],
];

export function Agents() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.5 });
  return (
    <section className="px-4 pt-40">
      <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-2">
        <Head align="left" eyebrow="Umi for agents" title="Your AI agent can edit too." lead="Umi speaks MCP. Claude and other agents can list, transcribe, cut and export your recordings." />
        <Rise delay={0.1}>
          <div ref={ref} className="overflow-hidden rounded-[24px] bg-[#0f1115] font-mono text-[13.5px] leading-7 text-white/85 shadow-[0_40px_80px_-30px_rgb(0_0_0/0.5)]">
            <div className="flex items-center gap-2 border-b border-white/10 px-5 py-3">
              <span className="mac-lights">
                <i />
                <i />
                <i />
              </span>
              <span className="ml-3 text-[12px] text-white/40">Terminal</span>
            </div>
            <div className="p-6">
              {LINES.map(([mark, text], i) => (
                <motion.p
                  key={i}
                  className="flex gap-3"
                  initial={{ opacity: 0, y: 4 }}
                  animate={inView ? { opacity: 1, y: 0 } : {}}
                  transition={{ delay: 0.3 + i * 0.45, duration: 0.4 }}
                >
                  <span className={mark === "✓" ? "text-[#30d158]" : mark === ">" ? "text-[#6fb5ef]" : "text-white/35"}>{mark}</span>
                  <span className={mark === ">" ? "text-white" : ""}>{text}</span>
                </motion.p>
              ))}
            </div>
          </div>
        </Rise>
      </div>
    </section>
  );
}

// ───── Loom ─────

export function Loom() {
  return (
    <section id="loom" className="px-4 pt-32">
      <Rise className="mx-auto flex max-w-5xl flex-col items-center gap-6 rounded-[28px] bg-panel px-8 py-12 text-center md:flex-row md:text-left">
        <div className="flex-1">
          <p className="text-[15px] font-medium text-[#625df5]">Switching from Loom</p>
          <h3 className="h-display mt-2 text-[clamp(26px,3.2vw,34px)]">Bring your whole Loom library.</h3>
          <p className="mt-2 text-muted">Paste the links. They become Umi projects you can edit. Free.</p>
        </div>
        <div className="flex w-full max-w-md items-center gap-2 rounded-full bg-white p-1.5 pl-5 shadow-[0_0_0_1px_rgb(17_24_39/0.06)]">
          <span className="flex-1 truncate text-left text-[15px] text-faint">loom.com/share/…</span>
          <a href="#download" className="btn-dark h-10">
            Import in Umi
          </a>
        </div>
      </Rise>
    </section>
  );
}
