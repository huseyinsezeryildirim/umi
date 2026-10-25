"use client";

import Lenis from "lenis";
import { MotionConfig } from "motion/react";
import { useEffect } from "react";

/** Smooth scrolling (Lenis, also for in-page links) and motion that respects reduced-motion settings. */
export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const lenis = new Lenis({ duration: 1.1, easing: (t) => 1 - Math.pow(1 - t, 4), anchors: { offset: -80 } });
    let frame = requestAnimationFrame(function loop(time) {
      lenis.raf(time);
      frame = requestAnimationFrame(loop);
    });
    return () => {
      cancelAnimationFrame(frame);
      lenis.destroy();
    };
  }, []);
  useAutoplay();
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

/** iOS only autoplays a video it knows is muted (React doesn't write the `muted` attribute) and,
 *  in Low Power Mode, only after the visitor touches the page. Start every autoplay video,
 *  including ones mounted later, and try again on the first touch or scroll. */
function useAutoplay() {
  useEffect(() => {
    const start = (v: HTMLVideoElement) => {
      v.muted = true;
      v.defaultMuted = true;
      v.setAttribute("muted", "");
      v.setAttribute("playsinline", "");
      if (v.paused) v.play().catch(() => {});
    };
    const all = () => document.querySelectorAll<HTMLVideoElement>("video[autoplay]").forEach(start);
    all();
    const observer = new MutationObserver(all);
    observer.observe(document.body, { childList: true, subtree: true });
    const events = ["touchstart", "pointerdown", "scroll"] as const;
    events.forEach((e) => addEventListener(e, all, { passive: true }));
    return () => {
      observer.disconnect();
      events.forEach((e) => removeEventListener(e, all));
    };
  }, []);
}
