"use client";

import { AnimatePresence, motion, useMotionValueEvent, useScroll } from "motion/react";
import { useState } from "react";
import { Mark } from "./ui";

const LINKS = [
  ["Features", "#features"],
  ["How it works", "#modes"],
  ["Compare", "#compare"],
  ["Pricing", "#pricing"],
  ["FAQ", "#faq"],
] as const;

/** Full width at the top; once you scroll it tucks into a floating glass pill. */
export function Nav() {
  const { scrollY } = useScroll();
  const [floating, setFloating] = useState(false);
  const [open, setOpen] = useState(false);
  useMotionValueEvent(scrollY, "change", (y) => setFloating(y > 40));

  return (
    <header className="fixed inset-x-0 top-0 z-50 flex justify-center px-3 pt-3">
      <motion.div
        layout
        transition={{ type: "spring", stiffness: 260, damping: 30 }}
        className={`flex w-full items-center justify-between gap-4 ${
          floating ? "max-w-4xl rounded-2xl bg-white/75 px-3 py-2 shadow-[0_0_0_1px_rgb(14_17_30/0.06),0_12px_40px_rgb(14_17_30/0.1)] backdrop-blur-xl" : "max-w-6xl px-4 py-3"
        }`}
      >
        <a href="#top" className="flex items-center gap-2 text-lg font-bold tracking-tight" aria-label="Umi home">
          <Mark className="size-7" /> Umi
        </a>
        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {LINKS.map(([label, href]) => (
            <a key={href} href={href} className="rounded-lg px-3 py-2 text-sm font-medium text-text transition-colors hover:bg-ink/5 hover:text-ink">
              {label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <a href="https://github.com/umi-cam/umi" className="btn btn-ghost btn-sm hidden sm:inline-flex">
            <svg viewBox="0 0 16 16" className="size-4" aria-hidden>
              <path fill="currentColor" d="M8 0a8 8 0 0 0-2.53 15.59c.4.07.55-.17.55-.38v-1.33c-2.23.48-2.7-1.07-2.7-1.07-.36-.92-.89-1.17-.89-1.17-.73-.5.06-.49.06-.49.8.06 1.23.83 1.23.83.72 1.22 1.88.87 2.34.66.07-.52.28-.87.5-1.07-1.78-.2-3.65-.89-3.65-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.03 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.28.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48v2.2c0 .21.15.46.55.38A8 8 0 0 0 8 0Z" />
            </svg>
            GitHub
          </a>
          <a href="#download" className="btn btn-ink btn-sm">
            Download
          </a>
          <button
            type="button"
            aria-label="Menu"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            className="grid size-9 place-items-center rounded-[10px] text-ink hover:bg-ink/5 md:hidden"
          >
            <span className="relative block h-3 w-4">
              <span className={`absolute left-0 h-0.5 w-4 rounded bg-current transition-all duration-300 ${open ? "top-[5px] rotate-45" : "top-0"}`} />
              <span className={`absolute left-0 h-0.5 w-4 rounded bg-current transition-all duration-300 ${open ? "top-[5px] -rotate-45" : "top-2.5"}`} />
            </span>
          </button>
        </div>
      </motion.div>
      <AnimatePresence>
        {open && (
          <motion.nav
            aria-label="Mobile"
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.25 }}
            className="absolute inset-x-3 top-[68px] grid gap-1 rounded-2xl bg-white/95 p-2 shadow-[0_0_0_1px_rgb(14_17_30/0.06),0_20px_50px_rgb(14_17_30/0.15)] backdrop-blur-xl md:hidden"
          >
            {LINKS.map(([label, href]) => (
              <a key={href} href={href} onClick={() => setOpen(false)} className="rounded-xl px-4 py-3 text-base font-medium hover:bg-ink/5">
                {label}
              </a>
            ))}
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  );
}
