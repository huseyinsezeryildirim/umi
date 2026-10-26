"use client";

import { AnimatePresence, motion, useMotionValueEvent, useScroll } from "motion/react";
import { useState } from "react";
import { NavDownload } from "./Download";
import { Mark } from "./ui";

const LINKS = [
  ["Features", "#features"],
  ["Pricing", "#pricing"],
  ["Questions", "#faq"],
  ["GitHub", "https://github.com/huseyinsezeryildirim/umi"],
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
        className={`grid w-full grid-cols-[1fr_auto] items-center gap-4 md:grid-cols-[1fr_auto_1fr] ${
          floating ? "max-w-4xl rounded-full bg-white/70 py-2 pr-2 pl-5 shadow-[0_0_0_1px_rgb(17_24_39/0.06),0_10px_30px_rgb(17_24_39/0.08)] backdrop-blur-xl" : "max-w-6xl px-4 py-3"
        }`}
      >
        <a href="#top" className="flex items-center gap-2 text-lg font-semibold tracking-tight" aria-label="Umi home">
          <Mark className="size-7" /> Umi
          <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-semibold tracking-wide text-accent uppercase">Beta</span>
        </a>
        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {LINKS.map(([label, href]) => (
            <a key={href} href={href} className="rounded-full px-3 py-1.5 text-[14px] whitespace-nowrap text-text transition-colors hover:text-ink">
              {label}
            </a>
          ))}
        </nav>
        <div className="flex items-center justify-end gap-2">
          <a href="/login" className="hidden rounded-full px-3 py-1.5 text-[14px] font-medium whitespace-nowrap text-text transition-colors hover:text-ink sm:block">
            Sign in
          </a>
          <NavDownload />
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
