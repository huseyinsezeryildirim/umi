"use client";

// The headline's second line, changing every few seconds: the old line leaves word by word,
// the new one comes in word by word. Each change is one short animation; nothing runs between
// changes or while the headline is off screen.
import { AnimatePresence, motion, useInView } from "motion/react";
import { useEffect, useRef, useState } from "react";

export const LINES = ["that look edited.", "with captions built in.", "that zoom on their own.", "that sound like a studio.", "that cost nothing."];

const EASE = [0.25, 1, 0.5, 1] as const;
const HOLD = 2800;

export function Headline() {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref);
  const [line, setLine] = useState(0);
  useEffect(() => {
    if (!inView || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => !document.hidden && setLine((l) => (l + 1) % LINES.length), HOLD);
    return () => clearInterval(id);
  }, [inView]);
  const text = LINES[line];

  return (
    // Every line takes the same box (the widest one sets the width), so nothing below jumps.
    <span ref={ref} className="relative inline-grid justify-items-center overflow-hidden py-[0.08em] [clip-path:inset(0)] align-top whitespace-nowrap">
      {LINES.map((l) => (
        <span key={l} aria-hidden className="invisible col-start-1 row-start-1">
          {l}
        </span>
      ))}
      <AnimatePresence initial={false} mode="wait">
        <motion.span key={text} className="col-start-1 row-start-1" initial="hidden" animate="shown" exit="gone" variants={LINE}>
          {text.split(" ").map((w, i, all) => (
            <motion.span key={i} className="inline-block" variants={WORD}>
              {w}
              {i < all.length - 1 ? "\u00a0" : ""}
            </motion.span>
          ))}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

const LINE = {
  hidden: {},
  shown: { transition: { staggerChildren: 0.07 } },
  gone: { transition: { staggerChildren: 0.04 } },
};
const WORD = {
  hidden: { y: "70%", opacity: 0, filter: "blur(6px)" },
  shown: { y: 0, opacity: 1, filter: "blur(0px)", transition: { duration: 0.55, ease: EASE } },
  gone: { y: "-45%", opacity: 0, filter: "blur(6px)", transition: { duration: 0.35, ease: [0.5, 0, 0.75, 0] as const } },
};
