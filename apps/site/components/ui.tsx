"use client";

import { motion, type HTMLMotionProps } from "motion/react";

/** The logo: two rings of dots, in the current text color. */
export function Mark({ className = "size-7" }: { className?: string }) {
  return <span aria-hidden className={`mark ${className}`} />;
}

const ease = [0.22, 1, 0.36, 1] as const;

/** Fades up (and un-blurs) the first time it scrolls into view. */
export function Reveal({ delay = 0, y = 24, className, children, ...rest }: HTMLMotionProps<"div"> & { delay?: number; y?: number }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y, filter: "blur(6px)" }}
      whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.8, ease, delay }}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

export function SectionHead({ tag, title, children }: { tag: string; title: React.ReactNode; children?: React.ReactNode }) {
  return (
    <Reveal className="mx-auto mb-14 max-w-2xl text-center">
      <span className="tag">{tag}</span>
      <h2 className="mt-5 text-4xl font-bold tracking-[-0.03em] text-balance sm:text-5xl">{title}</h2>
      {children && <p className="mt-4 text-lg text-pretty text-muted">{children}</p>}
    </Reveal>
  );
}

/** Tracks the pointer over a `.spotlight` element for its glow. */
export function onSpotlight(e: React.PointerEvent<HTMLElement>) {
  const r = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`);
  e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`);
}

export function Check({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={`size-5 shrink-0 ${className}`} aria-hidden>
      <circle cx="10" cy="10" r="10" fill="currentColor" opacity="0.12" />
      <path d="M6 10.2l2.6 2.6L14.2 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export const EASE = ease;
