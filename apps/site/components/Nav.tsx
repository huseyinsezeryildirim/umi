"use client";

import { AnimatePresence, motion, useMotionValueEvent, useScroll } from "motion/react";
import { useState } from "react";
import { Mark } from "./ui";

const LINKS = [
  ["Features", "#features"],
  ["Pricing", "#pricing"],
  ["Questions", "#faq"],
  ["GitHub", "https://github.com/umi-cam/umi"],
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
          floating ? "max-w-3xl rounded-full bg-white/70 py-2 pr-2 pl-5 shadow-[0_0_0_1px_rgb(17_24_39/0.06),0_10px_30px_rgb(17_24_39/0.08)] backdrop-blur-xl" : "max-w-6xl px-4 py-3"
        }`}
      >
        <a href="#top" className="flex items-center gap-2 text-lg font-semibold tracking-tight" aria-label="Umi home">
          <Mark className="size-7" /> Umi
        </a>
        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {LINKS.map(([label, href]) => (
            <a key={href} href={href} className="rounded-full px-3 py-1.5 text-[14px] text-text transition-colors hover:text-ink">
              {label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <a href="/login" className="hidden rounded-full px-3 py-1.5 text-[14px] font-medium text-text transition-colors hover:text-ink sm:block">
            Sign in
          </a>
          <a href="#download" className="btn-dark">
            <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
              <path fill="currentColor" d="M16.4 12.6c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.1-2.8.9-3.5.9-.7 0-1.8-.9-3-.8-1.5 0-3 .9-3.8 2.3-1.6 2.8-.4 7 1.2 9.3.8 1.1 1.7 2.4 2.9 2.3 1.2 0 1.6-.7 3-.7s1.8.7 3 .7c1.3 0 2.1-1.1 2.8-2.3.9-1.3 1.3-2.6 1.3-2.6s-2.5-1-2.5-3.8ZM14.1 5.8c.6-.8 1.1-1.9 1-3-.9 0-2.1.6-2.7 1.4-.6.7-1.1 1.8-1 2.9 1.1.1 2.1-.5 2.7-1.3Z" />
            </svg>
            Download
          </a>
          <button
            type="button"
            aria-label="Menu"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            className="grid size-9 place-items-center rounded-full text-ink hover:bg-ink/5 md:hidden"
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
            <a href="/login" className="rounded-xl px-4 py-3 text-base font-medium hover:bg-ink/5">
              Sign in
            </a>
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  );
}
