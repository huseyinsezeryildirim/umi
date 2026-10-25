"use client";

import Lenis from "lenis";
import { MotionConfig } from "motion/react";
import { useEffect } from "react";

/** Smooth scrolling (Lenis, also for in-page links) and motion that respects reduced-motion settings. */
export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // Smooth scrolling is for the marketing pages; the app pages scroll natively (nested panels too).
    if (matchMedia("(prefers-reduced-motion: reduce)").matches || /^\/(app|login|signup|forgot|reset|verify)/.test(location.pathname)) return;
    const lenis = new Lenis({ duration: 1.1, easing: (t) => 1 - Math.pow(1 - t, 4), anchors: { offset: -80 } });
    // Lenis needs a tick every frame, but only while something moves: the loop runs from the
    // first wheel, touch, key or click until scrolling has been still for half a second.
    let frame = 0;
    let busy = performance.now();
    const loop = (time: number) => {
      lenis.raf(time);
      if (lenis.isScrolling) busy = time;
      frame = time - busy < 500 ? requestAnimationFrame(loop) : 0;
    };
    const wake = () => {
      busy = performance.now();
      if (!frame) frame = requestAnimationFrame(loop);
    };
    const events = ["wheel", "touchstart", "touchmove", "keydown", "pointerdown", "scroll"] as const;
    events.forEach((e) => addEventListener(e, wake, { passive: true }));
    wake();
    return () => {
      cancelAnimationFrame(frame);
      events.forEach((e) => removeEventListener(e, wake));
      lenis.destroy();
    };
  }, []);
  useAutoplay();
  usePauseOffscreen();
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

/**
 * Autoplay videos play only while they're on screen (and the tab is visible): a page full of
 * looping videos otherwise keeps decoding all of them and gets sluggish after a while.
 * iOS only autoplays a video it knows is muted (React doesn't write the `muted` attribute) and,
 * in Low Power Mode, only after the visitor touches the page, so a touch tries again.
 */
function useAutoplay() {
  useEffect(() => {
    const visible = new Set<HTMLVideoElement>();
    const play = (v: HTMLVideoElement) => {
      v.muted = true;
      v.defaultMuted = true;
      v.setAttribute("muted", "");
      v.setAttribute("playsinline", "");
      if (v.paused && !document.hidden) v.play().catch(() => {});
    };
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const v = e.target as HTMLVideoElement;
          if (e.isIntersecting) {
            visible.add(v);
            play(v);
          } else {
            visible.delete(v);
            v.pause();
          }
        }
      },
      { rootMargin: "200px 0px" },
    );
    const watched = new WeakSet<HTMLVideoElement>();
    const watch = () =>
      document.querySelectorAll<HTMLVideoElement>("video[autoplay]").forEach((v) => {
        if (watched.has(v)) return;
        watched.add(v);
        // Started by the observer when it comes into view.
        v.pause();
        io.observe(v);
      });
    watch();
    const mo = new MutationObserver(watch);
    mo.observe(document.body, { childList: true, subtree: true });
    const retry = () => visible.forEach(play);
    const onVisibility = () => (document.hidden ? visible.forEach((v) => v.pause()) : retry());
    document.addEventListener("visibilitychange", onVisibility);
    addEventListener("touchstart", retry, { passive: true, once: true });
    return () => {
      io.disconnect();
      mo.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      removeEventListener("touchstart", retry);
    };
  }, []);
}

/**
 * CSS animations in a section that isn't on screen stop (`data-offscreen`, see globals.css):
 * a looping animation anywhere on the page otherwise keeps the browser redrawing all the time.
 */
function usePauseOffscreen() {
  useEffect(() => {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) e.target.toggleAttribute("data-offscreen", !e.isIntersecting);
    });
    const watched = new WeakSet<Element>();
    const watch = () =>
      document.querySelectorAll("section, footer").forEach((el) => {
        if (watched.has(el)) return;
        watched.add(el);
        io.observe(el);
      });
    watch();
    const mo = new MutationObserver(watch);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      io.disconnect();
      mo.disconnect();
    };
  }, []);
}
