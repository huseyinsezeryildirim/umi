"use client";

import { AnimatePresence, motion, useScroll, useSpring, useTransform } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { DownloadButton } from "./Download";
import { BrowserIcon, LinuxIcon, LoomIcon, WindowsIcon } from "./icons";

const EASE = [0.25, 1, 0.5, 1] as const;

const LINES = ["that look edited.", "with captions built in.", "that zoom on their own.", "that sound like a studio.", "that cost nothing."];

/** The second line of the headline rewrites itself: erase back to the caret, type the next one. */
function Typed() {
  const [text, setText] = useState(LINES[0]);
  useEffect(() => {
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let line = 0;
    let timer = 0;
    const wait = (ms: number) => new Promise<void>((r) => (timer = window.setTimeout(r, ms)));
    let alive = true;
    (async () => {
      while (alive) {
        await wait(2800);
        const next = LINES[(line + 1) % LINES.length];
        if (still) {
          line = (line + 1) % LINES.length;
          setText(next);
          continue;
        }
        for (let n = LINES[line].length; n >= 0 && alive; n--) {
          setText(LINES[line].slice(0, n));
          await wait(28);
        }
        await wait(250);
        line = (line + 1) % LINES.length;
        for (let n = 1; n <= next.length && alive; n++) {
          setText(next.slice(0, n));
          await wait(55);
        }
      }
    })();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);
  return (
    <span className="whitespace-nowrap" aria-live="off">
      {text}
      <span aria-hidden className="ml-[0.04em] inline-block h-[0.86em] w-[0.06em] translate-y-[0.1em] animate-[caret_1s_steps(1)_infinite] rounded-full bg-accent" />
      {!text && "\u200b"}
    </span>
  );
}

export function Hero() {
  const stage = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: stage, offset: ["start end", "center center"] });
  const p = useSpring(scrollYProgress, { stiffness: 140, damping: 32 });
  const scale = useTransform(p, [0, 1], [0.92, 1]);
  const y = useTransform(p, [0, 1], [60, 0]);

  return (
    <section id="top" className="px-4 pt-36 text-center sm:pt-44">
      <motion.h1
        className="h-display mx-auto max-w-4xl text-[clamp(30px,min(11vw,calc((100vw-32px)/10)),84px)]"
        initial={{ opacity: 0, y: 24, filter: "blur(10px)" }}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        transition={{ duration: 1.2, ease: EASE }}
      >
        Screen recordings
        <br />
        <Typed />
      </motion.h1>
      <motion.p className="lead mx-auto mt-6 max-w-md" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 1, ease: EASE, delay: 0.2 }}>
        Record. Umi does the zooms, captions and sound. Free forever.
      </motion.p>
      <motion.div className="mt-9 flex flex-col items-center gap-6" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 1, ease: EASE, delay: 0.35 }}>
        <DownloadButton />
        <a href="#loom" className="group flex items-center gap-2 text-[15px] text-muted">
          <LoomIcon className="size-[18px]" />
          Switching from Loom?
          <span className="border-b border-ink/30 text-ink transition-colors group-hover:border-ink">Import your library</span>
          <span className="transition-transform duration-300 group-hover:translate-x-0.5">→</span>
        </a>
        <div className="flex items-center gap-4 text-[15px] text-faint">
          Also on
          <span className="flex items-center gap-3.5 text-[#5f6673]">
            <WindowsIcon className="size-[18px]" />
            <LinuxIcon className="size-5" />
            <a href="/signup" title="Record in your browser" className="transition-colors hover:text-ink">
              <BrowserIcon className="size-5" />
            </a>
          </span>
        </div>
      </motion.div>

      <motion.div ref={stage} style={{ scale, y }} className="mx-auto mt-16 max-w-6xl sm:mt-20">
        <LiveDemo />
      </motion.div>
    </section>
  );
}

/**
 * The real Umi editor. A picture until asked; then the app itself loads in place (the
 * same interface, running in the browser on a sample recording).
 */
function LiveDemo() {
  const [live, setLive] = useState(false);
  const [ready, setReady] = useState(false);
  // The app is laid out at a desktop size and scaled to fit, so it looks like the picture.
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(el.clientWidth / 1440));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div className="relative overflow-hidden rounded-[28px] p-[3%] shadow-[0_50px_120px_-40px_rgb(20_60_130/0.45)] sm:rounded-[36px]">
      <img src="/photos/sky.jpg" alt="" className="absolute inset-0 size-full object-cover" />
      {/* A Mac window's corner at this scale: the toolbar buttons sit close to it, so a bigger
          radius would clip Export. */}
      <div ref={box} style={{ borderRadius: Math.max(3, 12 * scale) }} className="relative aspect-[16/10] overflow-hidden bg-white shadow-[0_0_0_0.5px_rgb(0_0_0/0.2),0_30px_70px_-20px_rgb(0_0_0/0.4)]">
        <img src="/media/editor.jpg" alt="The Umi editor" className="absolute inset-0 size-full object-cover" />
        {live && (
          <iframe
            src="/demo/index.html?view=desktop&demo&tour"
            title="Umi editor, guided demo"
            onLoad={() => setTimeout(() => setReady(true), 600)}
            style={{ width: 1440, height: 900, transform: `scale(${scale})`, transformOrigin: "0 0" }}
            className={`absolute top-0 left-0 border-0 transition-opacity duration-700 ${ready ? "opacity-100" : "opacity-0"}`}
          />
        )}
        <AnimatePresence>
          {!live && (
            <motion.div
              className="absolute inset-0 hidden place-items-center bg-ink/5 md:grid"
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5 }}
            >
              <motion.button
                type="button"
                onClick={() => setLive(true)}
                className="btn-glass"
                initial={{ opacity: 0, scale: 0.9 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.8, ease: EASE, delay: 0.3 }}
              >
                <span className="relative grid size-6 place-items-center">
                  <span className="absolute inset-0 animate-ping rounded-full bg-accent/30" />
                  <span className="relative size-2.5 rounded-full bg-accent" />
                </span>
                Start interactive demo
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
