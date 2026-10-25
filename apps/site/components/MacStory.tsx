"use client";

import { AnimatePresence, motion, useInView } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Mark } from "./ui";

/**
 * Umi, used: on a MacBook, the recorder drops from the menu bar, counts down, records
 * (camera bubble, timer, click rings), stops, and the editor opens with the zoom already
 * in place. Everything is sized in container units so it scales with the laptop.
 */

type Step = "desk" | "launcher" | "count" | "rec" | "editor";
const STEPS: [Step, number][] = [
  ["desk", 1400],
  ["launcher", 2600],
  ["count", 2700],
  ["rec", 5200],
  ["editor", 5600],
];
const EASE = [0.25, 1, 0.5, 1] as const;

/** Where the cursor goes in each step (percent of the screen). */
const CURSOR: Record<Step, { x: number[]; y: number[]; times?: number[]; duration: number }> = {
  desk: { x: [58, 86.5], y: [62, 2.2], duration: 1.2 },
  launcher: { x: [86.5, 84], y: [2.2, 34.5], duration: 1.6 },
  count: { x: [84, 60], y: [34.5, 58], duration: 1.4 },
  rec: { x: [60, 34, 34, 56, 56, 50.6], y: [58, 42, 42, 56, 56, 91], times: [0, 0.22, 0.4, 0.62, 0.8, 1], duration: 4.8 },
  editor: { x: [50.6, 62, 62], y: [91, 70, 70], duration: 1.4 },
};

export function MacStory() {
  const root = useRef<HTMLDivElement>(null);
  const inView = useInView(root, { amount: 0.3 });
  const [step, setStep] = useState<Step>("desk");
  const [n, setN] = useState(3);
  const [seconds, setSeconds] = useState(0);
  const [clicks, setClicks] = useState(0);

  useEffect(() => {
    if (!inView) return;
    const index = STEPS.findIndex(([s]) => s === step);
    const t = setTimeout(() => setStep(STEPS[(index + 1) % STEPS.length][0]), STEPS[index][1]);
    return () => clearTimeout(t);
  }, [step, inView]);

  // Countdown, recording timer and click rings inside their steps.
  useEffect(() => {
    if (step === "count") {
      setN(3);
      const a = setTimeout(() => setN(2), 850);
      const b = setTimeout(() => setN(1), 1700);
      return () => (clearTimeout(a), clearTimeout(b));
    }
    if (step === "rec") {
      setSeconds(0);
      setClicks(0);
      const tick = setInterval(() => setSeconds((s) => s + 1), 1000);
      const c1 = setTimeout(() => setClicks(1), 1300);
      const c2 = setTimeout(() => setClicks(2), 3100);
      return () => (clearInterval(tick), clearTimeout(c1), clearTimeout(c2));
    }
  }, [step]);

  const cursor = CURSOR[step];
  const recording = step === "rec";

  return (
    <div ref={root} className="mx-auto w-full max-w-[1100px]" aria-label="Umi recording a screen and opening the editor" role="img">
      {/* Lid */}
      <div className="relative rounded-[3.2%/4.8%] bg-[#0d0d0f] p-[1.3%] shadow-[0_0_0_1px_#2a2a2e,0_50px_120px_-30px_rgb(20_50_110/0.45)]">
        <div className="relative aspect-[16/10] overflow-hidden rounded-[1.4%/2.2%] [container-type:inline-size]">
          {/* Wallpaper */}
          <img src="/photos/sky.jpg" alt="" className="absolute inset-0 size-full object-cover" draggable={false} />
          <MenuBar recording={recording} highlight={step === "launcher"} />

          {/* The app being recorded */}
          <motion.div
            className="mac-window absolute top-[12%] left-[18%] w-[60%] text-[1.15cqw]"
            animate={{ opacity: step === "editor" ? 0 : 1, scale: step === "editor" ? 0.96 : 1 }}
            transition={{ duration: 0.6, ease: EASE }}
          >
            <Doc clicks={clicks} />
          </motion.div>

          <AnimatePresence>
            {step === "launcher" && (
              <motion.div
                key="launcher"
                className="absolute top-[4.6%] right-[3%] w-[26%]"
                initial={{ opacity: 0, y: -12, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.97 }}
                transition={{ duration: 0.45, ease: EASE }}
              >
                <Launcher />
              </motion.div>
            )}
            {step === "count" && (
              <motion.div
                key="count"
                className="absolute top-1/2 left-1/2 grid size-[14%] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-[5cqw] font-semibold text-white backdrop-blur-xl"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.1 }}
                transition={{ duration: 0.4, ease: EASE }}
              >
                <AnimatePresence mode="popLayout">
                  <motion.span key={n} initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.4 }} transition={{ duration: 0.35, ease: EASE }}>
                    {n}
                  </motion.span>
                </AnimatePresence>
              </motion.div>
            )}
            {(step === "count" || recording) && (
              <motion.div
                key="bubble"
                className="absolute bottom-[6%] left-[3%] aspect-square w-[13%] overflow-hidden rounded-full border-[0.25cqw] border-white/90 shadow-[0_1cqw_3cqw_rgb(0_0_0/0.35)]"
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ duration: 0.5, ease: EASE }}
              >
                <Person />
              </motion.div>
            )}
            {recording && (
              <motion.div
                key="controls"
                className="absolute bottom-[4.5%] left-1/2 flex -translate-x-1/2 items-center gap-[0.8cqw] rounded-[1.3cqw] bg-[#16181f]/90 p-[0.6cqw] pr-[1.2cqw] text-[1.15cqw] text-white shadow-[0_1cqw_3cqw_rgb(0_0_0/0.35)] backdrop-blur-xl"
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                transition={{ duration: 0.45, ease: EASE }}
              >
                <span className="grid size-[2.6cqw] place-items-center rounded-[0.8cqw] bg-record">
                  <i className="size-[0.9cqw] rounded-[0.15cqw] bg-white" />
                </span>
                <span className="flex items-center gap-[0.5cqw] font-semibold tabular-nums">
                  <i className="size-[0.6cqw] animate-pulse rounded-full bg-record" />
                  0:{String(seconds).padStart(2, "0")}
                </span>
                <span className="flex h-[1.4cqw] items-center gap-[0.2cqw]">
                  {[0.5, 1, 0.7, 0.9].map((h, i) => (
                    <motion.i key={i} className="w-[0.25cqw] rounded-full bg-[#30d158]" animate={{ height: [`${h * 40}%`, `${h * 100}%`, `${h * 50}%`] }} transition={{ duration: 0.6 + i * 0.1, repeat: Infinity }} />
                  ))}
                </span>
              </motion.div>
            )}
            {step === "editor" && (
              <motion.div
                key="editor"
                className="absolute inset-x-[7%] top-[9%] bottom-[5%]"
                initial={{ opacity: 0, y: "4%", scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ duration: 0.7, ease: EASE }}
              >
                <EditorWindow />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Click ring */}
          <AnimatePresence>
            {recording && clicks > 0 && (
              <motion.span
                key={clicks}
                className="pointer-events-none absolute size-[3.4cqw] -translate-x-1/2 -translate-y-1/2 rounded-full border-[0.2cqw] border-accent bg-accent/20"
                style={{ left: `${clicks === 1 ? 34 : 56}%`, top: `${clicks === 1 ? 42 : 56}%` }}
                initial={{ scale: 0.3, opacity: 1 }}
                animate={{ scale: 1.6, opacity: 0 }}
                transition={{ duration: 0.7, ease: "easeOut" }}
              />
            )}
          </AnimatePresence>

          {/* Cursor */}
          <motion.svg
            key={step}
            viewBox="0 0 24 24"
            className="pointer-events-none absolute z-50 w-[1.7cqw] drop-shadow-[0_0.15cqw_0.25cqw_rgb(0_0_0/0.35)]"
            initial={{ left: `${cursor.x[0]}%`, top: `${cursor.y[0]}%` }}
            animate={{ left: cursor.x.map((v) => `${v}%`), top: cursor.y.map((v) => `${v}%`) }}
            transition={{ duration: cursor.duration, times: cursor.times, ease: EASE }}
          >
            <path d="M5 3l14 7.5-6.2 1.6L10 18.5z" fill="#000" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" />
          </motion.svg>
        </div>
        {/* Camera notch */}
        <span className="absolute top-[0.35%] left-1/2 h-[2.6%] w-[11%] -translate-x-1/2 rounded-b-[0.8cqw] bg-[#0d0d0f]" />
      </div>
      {/* Base */}
      <div className="relative mx-auto h-[14px] w-[112%] max-w-[1232px] -translate-x-[5.4%] rounded-b-[18px] bg-[linear-gradient(180deg,#d9dbe0,#a9adb5)] shadow-[0_20px_40px_-10px_rgb(0_0_0/0.35)] sm:h-[18px]">
        <span className="absolute top-0 left-1/2 h-[45%] w-[14%] -translate-x-1/2 rounded-b-[10px] bg-[#9da1a9]" />
      </div>
    </div>
  );
}

function MenuBar({ recording, highlight }: { recording: boolean; highlight: boolean }) {
  return (
    <div className="absolute inset-x-0 top-0 z-40 flex h-[3.6%] items-center gap-[1.6cqw] bg-white/30 px-[1.4cqw] text-[1cqw] font-medium text-black/85 backdrop-blur-2xl">
      <svg viewBox="0 0 24 24" className="h-[60%]" aria-hidden>
        <path fill="currentColor" d="M16.4 12.6c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.1-2.8.9-3.5.9-.7 0-1.8-.9-3-.8-1.5 0-3 .9-3.8 2.3-1.6 2.8-.4 7 1.2 9.3.8 1.1 1.7 2.4 2.9 2.3 1.2 0 1.6-.7 3-.7s1.8.7 3 .7c1.3 0 2.1-1.1 2.8-2.3.9-1.3 1.3-2.6 1.3-2.6s-2.5-1-2.5-3.8ZM14.1 5.8c.6-.8 1.1-1.9 1-3-.9 0-2.1.6-2.7 1.4-.6.7-1.1 1.8-1 2.9 1.1.1 2.1-.5 2.7-1.3Z" />
      </svg>
      <b className="font-semibold">Notes</b>
      <span className="hidden sm:inline">File</span>
      <span className="hidden sm:inline">Edit</span>
      <span className="hidden sm:inline">View</span>
      <span className="ml-auto flex items-center gap-[1.4cqw]">
        <span className={`grid h-[2.6cqw] place-items-center rounded-[0.5cqw] px-[0.6cqw] transition-colors duration-300 ${highlight ? "bg-black/15" : ""}`}>
          {recording ? <i className="size-[1cqw] rounded-full bg-record" /> : <Mark className="size-[1.6cqw]" />}
        </span>
        <span>Sat 9:41</span>
      </span>
    </div>
  );
}

function Launcher() {
  const row = "flex items-center gap-[0.7cqw] rounded-[0.8cqw] bg-white px-[0.9cqw] py-[0.75cqw] shadow-[0_0_0_1px_rgb(0_0_0/0.05)]";
  const toggle = (on: boolean) => (
    <i className={`ml-auto h-[1.4cqw] w-[2.4cqw] rounded-full p-[0.18cqw] ${on ? "bg-ink" : "bg-black/15"}`}>
      <i className={`block size-[1.04cqw] rounded-full bg-white transition-transform ${on ? "translate-x-[1cqw]" : ""}`} />
    </i>
  );
  return (
    <div className="rounded-[1.4cqw] bg-[#f4f7fb]/95 p-[0.9cqw] text-[1cqw] text-ink shadow-[0_0_0_1px_rgb(0_0_0/0.08),0_2cqw_4cqw_-1cqw_rgb(0_0_0/0.3)] backdrop-blur-xl">
      <div className="mb-[0.8cqw] flex items-center gap-[0.5cqw] px-[0.3cqw] font-semibold">
        <Mark className="size-[1.5cqw]" /> Umi
      </div>
      <div className="grid gap-[0.5cqw]">
        <div className={row}>
          <Icon d="M3 5h18v11H3zM8 20h8M12 16v4" /> Full Screen
        </div>
        <div className={row}>
          <Icon d="M3 7h12v10H3zM15 10l6-3v10l-6-3" /> FaceTime HD Camera {toggle(true)}
        </div>
        <div className={row}>
          <Icon d="M9 3h6v11H9zM5 11a7 7 0 0 0 14 0M12 18v3" /> MacBook Microphone {toggle(true)}
        </div>
        <div className={row}>
          <Icon d="M4 9h4l5-4v14l-5-4H4zM17 9a4 4 0 0 1 0 6" /> System audio {toggle(false)}
        </div>
        <div className="mt-[0.3cqw] flex h-[2.8cqw] items-center justify-center gap-[0.6cqw] rounded-full bg-ink font-semibold text-white">
          <i className="size-[0.8cqw] rounded-full bg-record" /> Start recording
        </div>
      </div>
    </div>
  );
}

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" className="size-[1.3cqw] shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

function Doc({ clicks }: { clicks: number }) {
  return (
    <>
      <div className="flex items-center gap-[1cqw] border-b border-black/5 bg-[#f6f6f6] px-[1cqw] py-[0.8cqw]">
        <span className="mac-lights [&_i]:size-[0.95cqw]">
          <i />
          <i />
          <i />
        </span>
        <span className="font-semibold text-black/70">Launch plan</span>
      </div>
      <div className="px-[3cqw] py-[2.2cqw] text-left">
        <p className="text-[1.9cqw] font-bold tracking-tight">Q4 launch plan</p>
        <p className="mt-[0.6cqw] text-black/50">Owner: Product · Updated today</p>
        <ul className="mt-[1.6cqw] grid gap-[0.9cqw]">
          {["Ship the new onboarding", "Record walkthroughs for every feature", "Invite the beta group", "Publish the changelog"].map((t, i) => (
            <li key={t} className="flex items-center gap-[0.8cqw]">
              <span
                className={`grid size-[1.4cqw] place-items-center rounded-full border-[0.15cqw] transition-colors duration-300 ${
                  (i === 1 && clicks >= 1) || (i === 2 && clicks >= 2) || i === 0 ? "border-[#ffb800] bg-[#ffb800] text-white" : "border-black/25"
                }`}
              >
                {((i === 1 && clicks >= 1) || (i === 2 && clicks >= 2) || i === 0) && <span className="text-[0.9cqw] leading-none">✓</span>}
              </span>
              {t}
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

function Person() {
  return (
    <div className="size-full bg-[radial-gradient(circle_at_50%_36%,#e8b896_0_15%,transparent_15.5%),radial-gradient(ellipse_at_50%_102%,#3b4a63_0_40%,transparent_40.5%),radial-gradient(circle_at_50%_28%,#3a2a20_0_17%,transparent_17.5%),linear-gradient(170deg,#e9e4dc,#cfc6b8)]" />
  );
}

function EditorWindow() {
  const [zoomed, setZoomed] = useState(false);
  useEffect(() => {
    const a = setTimeout(() => setZoomed(true), 1300);
    const b = setTimeout(() => setZoomed(false), 4200);
    return () => (clearTimeout(a), clearTimeout(b));
  }, []);
  return (
    <div className="mac-window flex size-full flex-col text-[1cqw]">
      <div className="flex items-center gap-[1cqw] border-b border-black/5 px-[1.2cqw] py-[0.8cqw]">
        <span className="mac-lights [&_i]:size-[0.95cqw]">
          <i />
          <i />
          <i />
        </span>
        <span className="font-semibold">Q4 launch plan</span>
        <span className="ml-auto rounded-[0.6cqw] bg-accent/10 px-[0.9cqw] py-[0.35cqw] font-medium text-accent">Share</span>
        <span className="rounded-[0.6cqw] bg-ink px-[0.9cqw] py-[0.35cqw] font-semibold text-white">Export</span>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="grid flex-1 place-items-center bg-[#f5f7fa] p-[1.5cqw]">
          <div className="relative aspect-[16/10] h-full max-w-full overflow-hidden rounded-[0.8cqw] bg-[linear-gradient(135deg,#9eccfa,#2e5eb8)] p-[5%]">
            <motion.div
              className="size-full origin-[30%_55%] overflow-hidden rounded-[0.6cqw] bg-white shadow-[0_1cqw_2.5cqw_rgb(10_30_80/0.35)]"
              animate={{ scale: zoomed ? 1.9 : 1 }}
              transition={{ duration: 0.9, ease: EASE }}
            >
              <div className="px-[6%] py-[5%] text-left text-[0.85cqw]">
                <p className="text-[1.5cqw] font-bold">Q4 launch plan</p>
                <ul className="mt-[4%] grid gap-[0.5cqw]">
                  {["Ship the new onboarding", "Record walkthroughs", "Invite the beta group", "Publish the changelog"].map((t, i) => (
                    <li key={t} className="flex items-center gap-[0.5cqw]">
                      <i className={`size-[0.9cqw] rounded-full ${i < 3 ? "bg-[#ffb800]" : "border border-black/25"}`} />
                      {t}
                    </li>
                  ))}
                </ul>
              </div>
            </motion.div>
            <span className="absolute bottom-[6%] left-[3%] aspect-square w-[15%] overflow-hidden rounded-full border-[0.2cqw] border-white">
              <Person />
            </span>
            <motion.span
              className="absolute bottom-[5%] left-1/2 -translate-x-1/2 rounded-[0.4cqw] bg-black/70 px-[0.8cqw] py-[0.3cqw] text-[0.9cqw] font-semibold whitespace-nowrap text-white"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.8 }}
            >
              Three of four are done this week.
            </motion.span>
          </div>
        </div>
        <aside className="hidden w-[22%] border-l border-black/5 p-[1.2cqw] text-left sm:block">
          <p className="mb-[0.8cqw] font-semibold">Background</p>
          <div className="mb-[1.4cqw] grid grid-cols-4 gap-[0.4cqw]">
            {["#9eccfa,#2e5eb8", "#f2f7fc,#ccdff7", "#fa736b,#6b4adb", "#8cedc2,#1c8c8c"].map((g, i) => (
              <i key={g} className={`aspect-square rounded-[0.4cqw] ${i === 0 ? "ring-[0.15cqw] ring-accent ring-offset-[0.15cqw]" : ""}`} style={{ background: `linear-gradient(135deg, ${g})` }} />
            ))}
          </div>
          {["Auto zoom", "Captions", "Smooth cursor"].map((l) => (
            <div key={l} className="mb-[0.7cqw] flex items-center justify-between">
              {l}
              <i className="h-[1.2cqw] w-[2.1cqw] rounded-full bg-accent p-[0.15cqw]">
                <i className="ml-auto block size-[0.9cqw] rounded-full bg-white" />
              </i>
            </div>
          ))}
        </aside>
      </div>
      <div className="relative border-t border-black/5 px-[1.2cqw] py-[0.9cqw]">
        <i className="block h-[1.6cqw] rounded-[0.4cqw] bg-[repeating-linear-gradient(90deg,#c9dcf3_0_2cqw,#b6cff0_2cqw_4cqw)]" />
        <div className="relative mt-[0.5cqw] h-[1.3cqw]">
          <span className="absolute left-[22%] grid h-full w-[38%] place-items-center rounded-[0.4cqw] bg-accent/15 text-[0.8cqw] font-semibold text-accent">1.9× zoom</span>
        </div>
        <motion.span className="absolute top-[0.6cqw] bottom-[0.6cqw] w-[0.15cqw] rounded bg-record" initial={{ left: "2%" }} animate={{ left: "96%" }} transition={{ duration: 5.4, ease: "linear" }} />
      </div>
    </div>
  );
}
