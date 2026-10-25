"use client";

import { motion, useScroll, useSpring, useTransform } from "motion/react";
import { useRef } from "react";
import { Demo } from "./Demo";
import { DownloadButton } from "./Download";
import { EASE } from "./ui";

const LINES = [
  ["Record.", "Polish."],
  ["Share", "in", "seconds."],
];

export function Hero() {
  const stage = useRef<HTMLDivElement>(null);
  // The product tilts back like a laptop lid, then settles flat as you scroll to it.
  const { scrollYProgress } = useScroll({ target: stage, offset: ["start end", "start 0.25"] });
  const progress = useSpring(scrollYProgress, { stiffness: 120, damping: 30 });
  const rotateX = useTransform(progress, [0, 1], [22, 0]);
  const scale = useTransform(progress, [0, 1], [0.9, 1]);
  const y = useTransform(progress, [0, 1], [40, 0]);

  let i = 0;
  return (
    <section id="top" className="relative px-4 pt-36 pb-20 text-center sm:pt-44">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[720px] bg-[radial-gradient(60%_50%_at_50%_0%,rgb(111_181_239/0.45),transparent_70%)]" />
      <motion.a
        href="#compare"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: EASE }}
        className="group mx-auto inline-flex items-center gap-2 rounded-full bg-white/80 py-1.5 pr-3 pl-1.5 text-sm font-medium shadow-[0_0_0_1px_rgb(14_17_30/0.07),0_6px_20px_rgb(14_17_30/0.06)] backdrop-blur"
      >
        <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-white">Free</span>
        Open source · commercial use included
        <span className="text-muted transition-transform group-hover:translate-x-0.5">→</span>
      </motion.a>

      <h1 className="mx-auto mt-7 max-w-4xl text-[clamp(44px,8.5vw,96px)] leading-[0.98] font-extrabold tracking-[-0.045em]">
        {LINES.map((line, l) => (
          <span key={l} className="block">
            {line.map((word) => {
              const delay = 0.1 + i++ * 0.08;
              return (
                <motion.span
                  key={word}
                  className={`inline-block pr-[0.22em] last:pr-0 ${word === "Share" ? "bg-[linear-gradient(120deg,#116ff5,#6fb5ef)] bg-clip-text text-transparent" : ""}`}
                  initial={{ opacity: 0, y: 30, filter: "blur(10px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  transition={{ duration: 0.9, ease: EASE, delay }}
                >
                  {word}
                </motion.span>
              );
            })}
          </span>
        ))}
      </h1>

      <motion.p
        className="mx-auto mt-6 max-w-xl text-lg text-pretty text-muted sm:text-xl"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: EASE, delay: 0.55 }}
      >
        Umi records your screen, camera and voice, then makes it look made by a pro: smooth zooms, a calm cursor, captions and clean sound. On your computer, free forever.
      </motion.p>

      <motion.div
        className="mt-9 flex flex-wrap items-center justify-center gap-3"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: EASE, delay: 0.7 }}
      >
        <DownloadButton size="lg" />
        <a href="#modes" className="btn btn-secondary btn-lg">
          See how it works
        </a>
      </motion.div>
      <motion.p className="mt-4 text-sm text-muted" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.9, duration: 0.8 }}>
        No account · no watermark · no time limit
      </motion.p>

      <div ref={stage} className="mx-auto mt-16 max-w-6xl [perspective:1600px]">
        <motion.div
          style={{ rotateX, scale, y, transformOrigin: "50% 0%" }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1, delay: 0.8 }}
        >
          <Demo />
        </motion.div>
      </div>
    </section>
  );
}

/** A slow, endless strip of what Umi does. */
export function Ticker() {
  const items = ["Auto zoom", "Cursor smoothing", "Captions in 90+ languages", "Noise removal", "Background removal", "Keystrokes", "Draw on screen", "AI voiceover", "Privacy blur", "Loom import", "4K · 60 fps", "GIF export"];
  return (
    <section aria-label="What Umi does" className="relative overflow-hidden py-6 [mask-image:linear-gradient(90deg,transparent,#000_12%,#000_88%,transparent)]">
      <div className="flex w-max animate-marquee gap-3 hover:[animation-play-state:paused]">
        {[...items, ...items].map((item, k) => (
          <span key={k} className="flex items-center gap-3 rounded-full bg-white px-5 py-2.5 text-sm font-semibold whitespace-nowrap shadow-[0_0_0_1px_rgb(14_17_30/0.06)]">
            <i className="size-1.5 rounded-full bg-accent" />
            {item}
          </span>
        ))}
      </div>
    </section>
  );
}
