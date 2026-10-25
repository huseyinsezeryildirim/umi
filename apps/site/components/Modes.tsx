"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { EASE, Reveal, SectionHead } from "./ui";

const MODES = [
  {
    id: "instant",
    name: "Instant",
    hint: "Stop → link ready",
    steps: [
      ["Press record", "Screen, camera and mic. A 3-second countdown, then go."],
      ["Press stop", "The link is already on your clipboard; the video uploads while it’s made."],
      ["Paste it anywhere", "People watch in the browser, react and comment. No account needed."],
    ],
  },
  {
    id: "studio",
    name: "Studio",
    hint: "Stop → open the editor",
    steps: [
      ["Record in full quality", "Up to 4K at 60 fps. Screen, camera and every mic on their own tracks."],
      ["Polish in minutes", "Zooms follow your clicks; captions, cuts and backgrounds are one click away."],
      ["Export or share", "MP4, MOV or GIF in 4K — or a link, like everything else."],
    ],
  },
  {
    id: "shot",
    name: "Screenshot",
    hint: "Grab → beautify → paste",
    steps: [
      ["Hit ⌥⇧4", "Pick a window or drag an area."],
      ["Make it nice", "Background, padding, shadow, arrows, boxes, text and blur."],
      ["Copy and paste", "It’s on your clipboard, ready for docs, tickets and posts."],
    ],
  },
] as const;

const CYCLE = 7000;

export function Modes() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  // Moves on by itself until someone picks a mode.
  useEffect(() => {
    if (paused) return;
    const t = setTimeout(() => setActive((a) => (a + 1) % MODES.length), CYCLE);
    return () => clearTimeout(t);
  }, [active, paused]);
  const mode = MODES[active];

  return (
    <section id="modes" className="px-4 py-28">
      <SectionHead tag="Three ways to record" title="One app for every kind of video">
        A quick answer, a launch video or a perfect screenshot. Pick a mode, press record.
      </SectionHead>
      <Reveal className="mx-auto max-w-5xl">
        <div role="tablist" className="mx-auto mb-10 grid max-w-2xl grid-cols-3 gap-1 rounded-2xl bg-white p-1.5 shadow-[0_0_0_1px_rgb(14_17_30/0.06),0_10px_30px_rgb(14_17_30/0.06)]">
          {MODES.map((m, i) => (
            <button
              key={m.id}
              role="tab"
              aria-selected={i === active}
              onClick={() => (setActive(i), setPaused(true))}
              className="relative rounded-xl px-2 py-3 text-center"
            >
              {i === active && (
                <motion.span layoutId="mode-pill" className="absolute inset-0 rounded-xl bg-ink" transition={{ type: "spring", stiffness: 380, damping: 32 }} />
              )}
              <span className={`relative block text-sm font-bold sm:text-base ${i === active ? "text-white" : "text-ink"}`}>{m.name}</span>
              <span className={`relative hidden text-xs sm:block ${i === active ? "text-white/70" : "text-muted"}`}>{m.hint}</span>
              {i === active && !paused && (
                <motion.span
                  key={`bar-${active}`}
                  className="absolute inset-x-4 bottom-1 h-0.5 origin-left rounded bg-white/40"
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ duration: CYCLE / 1000, ease: "linear" }}
                />
              )}
            </button>
          ))}
        </div>

        <div className="card grid items-center gap-8 p-6 sm:p-10 md:grid-cols-[1fr_1.1fr]">
          <AnimatePresence mode="wait">
            <motion.ol
              key={mode.id}
              className="grid gap-6"
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 16 }}
              transition={{ duration: 0.4, ease: EASE }}
            >
              {mode.steps.map(([title, text], i) => (
                <motion.li
                  key={title}
                  className="flex gap-4"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.08 * i + 0.1, duration: 0.5, ease: EASE }}
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-tint text-sm font-bold text-accent">{i + 1}</span>
                  <div>
                    <b className="block text-lg">{title}</b>
                    <span className="text-muted">{text}</span>
                  </div>
                </motion.li>
              ))}
            </motion.ol>
          </AnimatePresence>
          <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-[linear-gradient(135deg,#e7f1fc,#cfe3f8)]">
            <AnimatePresence mode="wait">
              <motion.div
                key={mode.id}
                className="absolute inset-0 grid place-items-center p-6"
                initial={{ opacity: 0, scale: 0.96, filter: "blur(6px)" }}
                animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                exit={{ opacity: 0, scale: 1.02, filter: "blur(6px)" }}
                transition={{ duration: 0.45, ease: EASE }}
              >
                {mode.id === "instant" ? <InstantArt /> : mode.id === "studio" ? <StudioArt /> : <ShotArt />}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

function InstantArt() {
  return (
    <div className="relative w-full max-w-sm">
      <div className="overflow-hidden rounded-xl bg-white shadow-[0_20px_50px_rgb(17_60_130/0.18)]">
        <div className="grid aspect-video place-items-center bg-[linear-gradient(135deg,#9eccfa,#2e5eb8)]">
          <span className="grid size-12 place-items-center rounded-full bg-white/90 shadow-lg">
            <i className="ml-1 border-y-[9px] border-l-[14px] border-y-transparent border-l-ink" />
          </span>
        </div>
        <div className="p-3">
          <div className="h-1.5 overflow-hidden rounded bg-ink/10">
            <motion.div className="h-full rounded bg-accent" initial={{ width: "0%" }} animate={{ width: "64%" }} transition={{ duration: 2.4, ease: "easeOut" }} />
          </div>
          <div className="mt-3 flex gap-2 text-sm">
            {["👍 4", "🎉 2", "❤️ 3"].map((r, i) => (
              <motion.span key={r} className="rounded-full bg-ink/5 px-2.5 py-1" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.6 + i * 0.15, type: "spring" }}>
                {r}
              </motion.span>
            ))}
          </div>
        </div>
      </div>
      <motion.div
        className="absolute -top-5 -right-3 flex items-center gap-3 rounded-2xl bg-ink px-4 py-3 text-left text-white shadow-xl"
        initial={{ y: -16, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.3, type: "spring", stiffness: 300, damping: 22 }}
      >
        <span className="grid size-7 place-items-center rounded-full bg-[#13d18e] text-sm font-bold text-ink">✓</span>
        <span>
          <b className="block text-sm">Link copied</b>
          <small className="text-white/60">umi.cam/v/q4-roadmap</small>
        </span>
      </motion.div>
    </div>
  );
}

function StudioArt() {
  return (
    <div className="w-full max-w-sm overflow-hidden rounded-xl bg-white p-3 shadow-[0_20px_50px_rgb(17_60_130/0.18)]">
      <div className="relative aspect-video overflow-hidden rounded-lg bg-[linear-gradient(135deg,#fa736b,#6b4adb)] p-[6%]">
        <motion.div
          className="size-full rounded-md bg-white shadow-lg"
          animate={{ scale: [1, 1.5, 1.5, 1], x: ["0%", "-14%", "-14%", "0%"], y: ["0%", "-10%", "-10%", "0%"] }}
          transition={{ duration: 4, repeat: Infinity, times: [0, 0.3, 0.7, 1], ease: "easeInOut" }}
        >
          <div className="grid size-full grid-cols-3 gap-1.5 p-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <i key={i} className={`rounded ${i === 1 ? "bg-accent/60" : "bg-ink/8"}`} />
            ))}
          </div>
        </motion.div>
        <span className="absolute right-[4%] bottom-[6%] size-[20%] rounded-full border-2 border-white bg-[radial-gradient(circle_at_50%_38%,#f5d3b8_0_17%,transparent_18%),radial-gradient(ellipse_at_50%_100%,#2e3b55_0_42%,transparent_43%),#cfe3f8]" />
      </div>
      <div className="relative mt-3 grid gap-1.5">
        <i className="h-5 rounded bg-[repeating-linear-gradient(90deg,#c9dcf3_0_14px,#b6cff0_14px_28px)]" />
        <div className="flex gap-1.5">
          <i className="h-4 w-[30%] rounded bg-accent/70" />
          <i className="ml-[15%] h-4 w-[25%] rounded bg-accent/70" />
        </div>
        <motion.span className="absolute top-0 bottom-0 w-0.5 rounded bg-record" animate={{ left: ["0%", "100%"] }} transition={{ duration: 4, repeat: Infinity, ease: "linear" }} />
      </div>
    </div>
  );
}

function ShotArt() {
  return (
    <div className="relative w-full max-w-sm rounded-xl bg-[linear-gradient(135deg,#8cedc2,#1c8c8c)] p-[7%] shadow-[0_20px_50px_rgb(17_60_130/0.18)]">
      <div className="grid aspect-[4/3] grid-cols-2 gap-2 rounded-lg bg-white p-3 shadow-xl">
        <i className="col-span-2 rounded bg-ink/8" />
        <i className="rounded bg-accent/30" />
        <i className="rounded bg-ink/8" />
      </div>
      <svg viewBox="0 0 120 60" className="absolute top-[18%] right-[8%] w-1/2 overflow-visible">
        <motion.path d="M6 52 C40 50 70 30 104 12" fill="none" stroke="#ff4d4d" strokeWidth="4" strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.8, delay: 0.2 }} />
        <motion.path d="M92 10 L106 11 L100 24" fill="none" stroke="#ff4d4d" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.3, delay: 0.95 }} />
      </svg>
      <motion.span className="absolute top-[8%] right-[6%] rounded-lg bg-[#ff4d4d] px-2.5 py-1 text-sm font-bold text-white shadow-lg" initial={{ scale: 0, rotate: -8 }} animate={{ scale: 1, rotate: -4 }} transition={{ delay: 1.1, type: "spring" }}>
        New!
      </motion.span>
    </div>
  );
}
