"use client";

import { AnimatePresence, animate, motion, useInView, useMotionValue, useMotionValueEvent, useTransform } from "motion/react";
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

// ───── Before / after ─────

/** The same recording, as captured and as Umi exports it. Drag to compare. */
export function BeforeAfter() {
  const box = useRef<HTMLDivElement>(null);
  const before = useRef<HTMLVideoElement>(null);
  const after = useRef<HTMLVideoElement>(null);
  const inView = useInView(box, { amount: 0.4 });
  const split = useMotionValue(50);
  const clip = useTransform(split, (v) => `inset(0 ${100 - v}% 0 0)`);
  const left = useTransform(split, (v) => `${v}%`);
  const [touched, setTouched] = useState(false);
  const [pct, setPct] = useState(50);
  useMotionValueEvent(split, "change", (v) => setPct(Math.round(v)));

  // Keep both videos on the same frame; play only while visible.
  useEffect(() => {
    const a = before.current;
    const b = after.current;
    if (!a || !b) return;
    if (!inView) {
      a.pause();
      b.pause();
      return;
    }
    void a.play().catch(() => {});
    void b.play().catch(() => {});
    const sync = setInterval(() => {
      if (Math.abs(a.currentTime - b.currentTime) > 0.08) a.currentTime = b.currentTime;
    }, 500);
    return () => clearInterval(sync);
  }, [inView]);

  // Until someone drags, the divider sweeps once to show both sides.
  useEffect(() => {
    if (!inView || touched) return;
    const c = animate(split, [50, 82, 18, 50], { duration: 4.5, ease: "easeInOut", delay: 0.6 });
    return () => c.stop();
  }, [inView, touched, split]);

  const move = (clientX: number) => {
    const r = box.current!.getBoundingClientRect();
    split.set(Math.min(98, Math.max(2, ((clientX - r.left) / r.width) * 100)));
  };

  return (
    <section className="px-4 pt-40">
      <Head eyebrow="Same recording" title="Captured on the left. Exported by Umi on the right." />
      <Rise className="mx-auto mt-14 max-w-6xl" delay={0.1}>
        <div
          ref={box}
          className="relative aspect-[16/10] cursor-ew-resize touch-none overflow-hidden rounded-[28px] bg-panel select-none sm:rounded-[36px]"
          onPointerDown={(e) => {
            setTouched(true);
            e.currentTarget.setPointerCapture(e.pointerId);
            move(e.clientX);
          }}
          onPointerMove={(e) => e.buttons && move(e.clientX)}
          role="slider"
          aria-label="Compare the raw recording with Umi's export"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") (setTouched(true), split.set(Math.max(2, split.get() - 5)));
            if (e.key === "ArrowRight") (setTouched(true), split.set(Math.min(98, split.get() + 5)));
          }}
        >
          <video ref={after} src="/media/after.mp4" poster="/media/after-poster.jpg" muted loop playsInline preload="metadata" className="absolute inset-0 size-full object-cover" />
          <motion.video ref={before} src="/media/before.mp4" muted loop playsInline preload="metadata" style={{ clipPath: clip }} className="absolute inset-0 size-full object-cover" />
          <motion.div style={{ left }} className="pointer-events-none absolute inset-y-0 w-px -translate-x-1/2 bg-white shadow-[0_0_0_0.5px_rgb(0_0_0/0.15)]">
            <span className="absolute top-1/2 left-1/2 grid size-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white text-ink shadow-[0_6px_20px_rgb(0_0_0/0.25)]">
              <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 6l-5 6 5 6M15 6l5 6-5 6" />
              </svg>
            </span>
          </motion.div>
          <span className="pointer-events-none absolute bottom-5 left-5 rounded-full bg-black/55 px-3 py-1 text-[13px] font-medium text-white backdrop-blur">Recorded</span>
          <span className="pointer-events-none absolute right-5 bottom-5 rounded-full bg-white/85 px-3 py-1 text-[13px] font-medium text-ink backdrop-blur">With Umi</span>
        </div>
      </Rise>
    </section>
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

// ───── Editor features ─────

const TOOLS: [string, string, Mini][] = [
  ["Auto zoom", "Follows your clicks.", "zoom"],
  ["Smooth cursor", "Calm, never jittery.", "cursor"],
  ["Captions", "On your computer.", "captions"],
  ["Cut the ums", "Delete words to cut.", "ums"],
  ["Blur private things", "Masks follow the content.", "blur"],
  ["Camera background", "Blur or remove it.", "camera"],
  ["Keystrokes", "Shows what you press.", "keys"],
  ["AI voiceover", "Type it, hear it.", "voice"],
];
type Mini = "zoom" | "cursor" | "captions" | "ums" | "blur" | "camera" | "keys" | "voice";
const LOOP = { repeat: Infinity, repeatDelay: 1.2, ease: EASE } as const;

/** A small looping picture of each tool, in the same quiet style. */
function MiniArt({ kind }: { kind: Mini }) {
  switch (kind) {
    case "zoom":
      return (
        <div className="relative h-full w-[78%] overflow-hidden rounded-lg bg-white shadow-sm">
          <motion.div className="grid size-full origin-[72%_68%] grid-cols-3 gap-1 p-1.5" animate={{ scale: [1, 2.1, 2.1, 1] }} transition={{ duration: 3.2, times: [0, 0.3, 0.7, 1], ...LOOP }}>
            <i className="col-span-3 rounded-sm bg-ink/8" />
            <i className="rounded-sm bg-ink/8" />
            <i className="rounded-sm bg-ink/8" />
            <i className="rounded-sm bg-accent/70" />
          </motion.div>
        </div>
      );
    case "cursor":
      return (
        <svg viewBox="0 0 120 50" className="h-full w-[85%] overflow-visible">
          <path d="M6 40 L18 22 L27 36 L38 12 L49 33 L60 18 L72 38 L84 14 L96 30 L112 10" fill="none" stroke="rgb(17 24 39 / 0.15)" strokeWidth="1.5" />
          <motion.path d="M6 40 C30 30 60 10 112 10" fill="none" stroke="#116ff5" strokeWidth="2.5" strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: [0, 1, 1] }} transition={{ duration: 2.6, times: [0, 0.6, 1], ...LOOP }} />
        </svg>
      );
    case "captions":
      return <CaptionsMini />;
    case "ums":
      return (
        <p className="text-[15px] font-medium">
          So{" "}
          <motion.span className="inline-block overflow-hidden whitespace-nowrap align-bottom text-record" animate={{ opacity: [1, 1, 0, 0, 1], width: ["1.9em", "1.9em", "0em", "0em", "1.9em"] }} transition={{ duration: 3.4, times: [0, 0.35, 0.5, 0.9, 1], ...LOOP }}>
            <s>um,</s>
          </motion.span>{" "}
          it’s fast.
        </p>
      );
    case "blur":
      return (
        <div className="relative rounded-md bg-white px-3 py-1.5 font-mono text-[12px] shadow-sm">
          sk-live-48f9c2a1
          <motion.span className="absolute inset-y-1 right-1.5 left-[38%] rounded bg-ink/10 backdrop-blur-[3px]" style={{ originX: 0 }} animate={{ scaleX: [0, 1, 1, 0] }} transition={{ duration: 3, times: [0, 0.25, 0.8, 1], ...LOOP }} />
        </div>
      );
    case "camera":
      return (
        <motion.span
          className="aspect-square h-[78%] rounded-full border-2 border-white shadow-md"
          style={{ backgroundImage: "radial-gradient(circle at 50% 36%,#e8b896 0 15%,transparent 15.5%),radial-gradient(ellipse at 50% 102%,#3b4a63 0 40%,transparent 40.5%),radial-gradient(circle at 50% 28%,#3a2a20 0 17%,transparent 17.5%)" }}
          animate={{ backgroundColor: ["#c9b9a3", "#c9b9a3", "#6fb5ef", "#6fb5ef", "#c9b9a3"] }}
          transition={{ duration: 3.4, times: [0, 0.3, 0.45, 0.85, 1], ...LOOP }}
        />
      );
    case "keys":
      return (
        <div className="flex gap-1.5 text-[18px]">
          {["⌘", "⇧", "4"].map((k, i) => (
            <motion.kbd key={k} animate={{ y: [0, 2, 0], boxShadow: ["inset 0 -2px 0 rgb(17 24 39/0.15), 0 0 0 1px rgb(17 24 39/0.12)", "inset 0 0 0 rgb(17 24 39/0.15), 0 0 0 1px rgb(17 24 39/0.2)", "inset 0 -2px 0 rgb(17 24 39/0.15), 0 0 0 1px rgb(17 24 39/0.12)"] }} transition={{ duration: 0.35, delay: i * 0.12, repeat: Infinity, repeatDelay: 2.4 }}>
              {k}
            </motion.kbd>
          ))}
        </div>
      );
    case "voice":
      return (
        <div className="flex h-[60%] items-center gap-[3px]">
          {Array.from({ length: 16 }).map((_, i) => (
            <motion.i key={i} className="w-[3px] rounded-full bg-accent" animate={{ height: ["20%", `${35 + ((i * 47) % 65)}%`, "20%"] }} transition={{ duration: 0.9 + (i % 5) * 0.15, repeat: Infinity, ease: "easeInOut", delay: i * 0.04 }} />
          ))}
        </div>
      );
  }
}

function CaptionsMini() {
  const words = ["Here’s", "the", "new", "report"];
  const [n, setN] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setN((v) => (v + 1) % (words.length + 3)), 420);
    return () => clearTimeout(t);
  }, [n, words.length]);
  return (
    <p className="rounded-md bg-ink/85 px-2.5 py-1 text-[13px] font-semibold text-white/35">
      {words.map((w, i) => (
        <span key={w} className={`transition-colors duration-200 ${i < n ? (i === n - 1 ? "text-[#ffd60a]" : "text-white") : ""}`}>
          {w}{" "}
        </span>
      ))}
    </p>
  );
}

export function Tools() {
  return (
    <section className="px-4 pt-40">
      <Head eyebrow="The editor" title="Everything a good video needs." />
      <div className="mx-auto mt-14 grid max-w-6xl grid-cols-2 gap-3 lg:grid-cols-4">
        {TOOLS.map(([title, line, kind], i) => (
          <motion.div
            key={title}
            className="group rounded-[24px] bg-panel p-3 pb-5 transition-transform duration-500 hover:-translate-y-1"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ duration: 0.8, ease: EASE, delay: (i % 4) * 0.07 }}
          >
            <div aria-hidden className="grid h-28 place-items-center rounded-[18px] bg-[linear-gradient(160deg,#ffffff,#e9f2fd)] sm:h-32">
              <MiniArt kind={kind} />
            </div>
            <p className="mt-4 px-2 text-[16px] font-semibold tracking-tight">{title}</p>
            <p className="px-2 text-[14px] text-muted">{line}</p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

// ───── On-device AI ─────

export function Ai() {
  return (
    <section className="px-3 pt-40 sm:px-4">
      <div className="mx-auto max-w-[1400px] rounded-[40px] bg-panel px-6 py-24 sm:px-12">
        <div className="mx-auto grid max-w-6xl items-center gap-14 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <Head align="left" eyebrow="AI, on your computer" title="Every recording, understood." lead="Captions, titles, chapters and summaries. Nothing leaves your Mac to make them." />
            <Rise className="mt-8 grid gap-3 text-[16px] text-text" delay={0.1}>
              {["Transcribed locally with Whisper", "Titles and chapters written for you", "Fillers and long pauses found for you"].map((t) => (
                <p key={t} className="flex items-center gap-3">
                  <span className="size-1.5 rounded-full bg-accent" />
                  {t}
                </p>
              ))}
            </Rise>
          </div>
          <Rise delay={0.15}>
            <img src="/media/captions.jpg" alt="The editor with the Captions panel" className="w-full rounded-2xl shadow-[0_0_0_0.5px_rgb(0_0_0/0.12),0_40px_80px_-30px_rgb(20_60_130/0.45)]" />
          </Rise>
        </div>
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
  ["·", "describe_recording  “Northwind walkthrough”, 0:10"],
  ["·", "edit  remove_fillers → 3 words, 1.4 s"],
  ["·", "export  mp4, 1080p"],
  ["✓", "Saved to Movies/Umi/Exports/Northwind walkthrough.mp4"],
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
