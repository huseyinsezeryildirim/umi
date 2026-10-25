"use client";

import { animate, motion, useInView } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Check, Mark, Reveal, SectionHead, onSpotlight } from "./ui";

function Card({ title, text, className = "", children, delay = 0 }: { title: string; text: string; className?: string; children: React.ReactNode; delay?: number }) {
  return (
    <Reveal delay={delay} className={className}>
      <article onPointerMove={onSpotlight} className="card spotlight group flex h-full flex-col p-6 transition-transform duration-500 hover:-translate-y-1">
        <div aria-hidden className="relative mb-6 grid h-40 place-items-center overflow-hidden rounded-2xl bg-[linear-gradient(135deg,#f3f8fe,#e1eefc)]">
          {children}
        </div>
        <h3 className="text-lg font-bold tracking-tight">{title}</h3>
        <p className="mt-1.5 text-[15px] text-pretty text-muted">{text}</p>
      </article>
    </Reveal>
  );
}

export function Features() {
  return (
    <section id="features" className="px-4 py-28">
      <SectionHead tag="The editor" title="Looks edited. Took a minute.">
        Everything that makes a recording pleasant to watch, done for you and all of it adjustable.
      </SectionHead>
      <div className="mx-auto grid max-w-6xl gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="Zooms that follow you" text="Umi watches your clicks and typing and zooms where the action is, with springy, natural motion.">
          <ZoomArt />
        </Card>
        <Card delay={0.05} title="Captions, on your computer" text="Transcribed privately on your device in 90+ languages. Export SRT and VTT.">
          <CaptionsArt />
        </Card>
        <Card title="Studio-clean sound" text="Background noise removed and your voice levelled, without plug-ins.">
          <WaveArt />
        </Card>
        <Card delay={0.05} title="Edit by deleting words" text="Cut the video from its transcript. Remove every “um” and long pause in one click.">
          <p className="max-w-[85%] text-center text-[15px] leading-relaxed">
            So <Strike>um</Strike> this is the <Strike delay={0.4}>uh</Strike> new dashboard, <Strike delay={0.8}>you know</Strike> and it’s fast.
          </p>
        </Card>
        <Card delay={0.1} title="Camera, minus the room" text="Blur or remove your background without a green screen. The bubble moves out of the cursor’s way.">
          <CameraArt />
        </Card>
        <Card className="lg:col-span-2" title="Draw, point, show shortcuts" text="Draw on screen while recording (it fades on its own), magnify with a loupe, and show the keys you press.">
          <DrawArt />
        </Card>
        <Card delay={0.05} title="AI voiceover" text="Type a script and a natural voice reads it, generated on your computer.">
          <VoiceArt />
        </Card>
        <Card title="Private stays private" text="Blur, pixelate or spotlight parts of the screen; masks follow what’s under them.">
          <div className="relative rounded-lg bg-white px-4 py-3 font-mono text-sm shadow">
            api_key: sk-live-48f9c2a1…
            <motion.span
              className="absolute inset-y-1.5 right-2 left-[42%] rounded-md bg-ink/10 backdrop-blur-md"
              initial={{ scaleX: 0 }}
              whileInView={{ scaleX: 1 }}
              viewport={{ once: true }}
              style={{ originX: 0 }}
              transition={{ duration: 0.7, delay: 0.3 }}
            />
          </div>
        </Card>
        <Card delay={0.05} title="Bring your Loom library" text="Paste Loom links and they become editable Umi projects. Free.">
          <div className="flex items-center gap-4">
            <span className="rounded-xl bg-[#625df5] px-3 py-2 text-sm font-bold text-white shadow">Loom</span>
            <motion.span className="text-2xl text-muted" animate={{ x: [0, 6, 0] }} transition={{ duration: 1.6, repeat: Infinity }}>
              →
            </motion.span>
            <span className="grid size-12 place-items-center rounded-xl bg-white shadow">
              <Mark className="size-8 text-ink" />
            </span>
          </div>
        </Card>
      </div>
    </section>
  );
}

function Strike({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  return (
    <span className="relative inline-block text-muted">
      {children}
      <motion.span
        className="absolute inset-x-0 top-1/2 h-0.5 rounded bg-record"
        initial={{ scaleX: 0 }}
        whileInView={{ scaleX: 1 }}
        viewport={{ once: true }}
        style={{ originX: 0 }}
        transition={{ duration: 0.4, delay: 0.4 + delay }}
      />
    </span>
  );
}

function ZoomArt() {
  return (
    <div className="relative h-full w-[86%] py-4">
      <motion.div
        className="relative size-full origin-[72%_62%] rounded-xl bg-white p-3 shadow-lg"
        animate={{ scale: [1, 1.9, 1.9, 1] }}
        transition={{ duration: 5, times: [0, 0.3, 0.75, 1], repeat: Infinity, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="grid size-full grid-cols-4 gap-2">
          <i className="col-span-4 rounded bg-ink/6" />
          <i className="col-span-2 rounded bg-ink/6" />
          <i className="rounded bg-ink/6" />
          <i className="rounded bg-accent/70" />
        </div>
        <motion.svg
          viewBox="0 0 24 24"
          className="absolute size-5"
          animate={{ left: ["20%", "70%", "70%", "20%"], top: ["30%", "60%", "60%", "30%"] }}
          transition={{ duration: 5, times: [0, 0.25, 0.8, 1], repeat: Infinity, ease: "easeInOut" }}
        >
          <path d="M5 3l14 7.5-6.2 1.6L10 18.5z" fill="#0e111e" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" />
        </motion.svg>
      </motion.div>
    </div>
  );
}

function CaptionsArt() {
  const words = ["Captions", "appear", "as", "you", "speak"];
  const [n, setN] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setN((v) => (v + 1) % (words.length + 3)), 450);
    return () => clearInterval(t);
  }, [words.length]);
  return (
    <p className="rounded-xl bg-ink/85 px-4 py-2 text-[15px] font-semibold text-white/50 shadow-lg">
      {words.map((w, i) => (
        <span key={w} className={`transition-colors duration-200 ${i < n ? (i === n - 1 ? "text-[#ffd23f]" : "text-white") : ""}`}>
          {w}{" "}
        </span>
      ))}
    </p>
  );
}

function WaveArt() {
  return (
    <div className="flex h-20 items-center gap-1">
      {Array.from({ length: 22 }).map((_, i) => (
        <motion.i
          key={i}
          className="w-1.5 rounded-full bg-accent"
          animate={{ height: [`${20 + ((i * 37) % 60)}%`, `${30 + ((i * 53) % 50)}%`, `${20 + ((i * 37) % 60)}%`] }}
          transition={{ duration: 1.2 + (i % 4) * 0.2, repeat: Infinity, ease: "easeInOut" }}
        />
      ))}
    </div>
  );
}

function CameraArt() {
  const face = "bg-[radial-gradient(circle_at_50%_38%,#f5d3b8_0_17%,transparent_18%),radial-gradient(ellipse_at_50%_100%,#2e3b55_0_42%,transparent_43%)]";
  return (
    <div className="flex items-center gap-5">
      <span className={`size-24 rounded-full border-4 border-white shadow-lg ${face} bg-[#c8b49a]`} />
      <motion.span className="text-xl text-muted" animate={{ x: [0, 5, 0] }} transition={{ duration: 1.6, repeat: Infinity }}>
        →
      </motion.span>
      <span className={`size-24 rounded-full border-4 border-white shadow-lg ${face} bg-[linear-gradient(135deg,#9eccfa,#2e5eb8)]`} />
    </div>
  );
}

function DrawArt() {
  return (
    <div className="relative size-full">
      <svg viewBox="0 0 300 120" className="absolute inset-0 size-full">
        <motion.path
          d="M30 80 C70 20 120 20 150 64 S230 105 280 40"
          fill="none"
          stroke="#ff4d4d"
          strokeWidth="5"
          strokeLinecap="round"
          animate={{ pathLength: [0, 1, 1, 1], opacity: [1, 1, 1, 0] }}
          transition={{ duration: 4, times: [0, 0.35, 0.8, 1], repeat: Infinity }}
        />
      </svg>
      <div className="absolute right-6 bottom-5 flex gap-1.5">
        {["⌘", "⇧", "S"].map((k, i) => (
          <motion.kbd key={k} animate={{ y: [8, 0, 0, 8], opacity: [0, 1, 1, 0] }} transition={{ duration: 4, times: [0.4, 0.5, 0.85, 0.95], repeat: Infinity, delay: i * 0.05 }}>
            {k}
          </motion.kbd>
        ))}
      </div>
    </div>
  );
}

function VoiceArt() {
  const text = "Welcome to the new Umi…";
  const [n, setN] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setN((v) => (v >= text.length + 12 ? 0 : v + 1)), 70);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="grid justify-items-center gap-3">
      <p className="rounded-lg bg-white px-3 py-2 font-mono text-sm shadow">
        {text.slice(0, n)}
        <span className="animate-pulse text-accent">|</span>
      </p>
      <div className="flex h-8 items-center gap-1">
        {Array.from({ length: 12 }).map((_, i) => (
          <motion.i key={i} className="w-1 rounded-full bg-accent" animate={{ height: n > text.length ? ["30%", "100%", "40%"] : "15%" }} transition={{ duration: 0.5, repeat: Infinity, delay: i * 0.04 }} />
        ))}
      </div>
    </div>
  );
}

function Count({ to, suffix = "" }: { to: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  useEffect(() => {
    if (!inView || !ref.current) return;
    const el = ref.current;
    const c = animate(0, to, { duration: 1.6, ease: [0.22, 1, 0.36, 1], onUpdate: (v) => (el.textContent = `${Math.round(v)}${suffix}`) });
    return () => c.stop();
  }, [inView, to, suffix]);
  return <span ref={ref}>0{suffix}</span>;
}

export function Stats() {
  const stats: [number, string, string][] = [
    [0, "$", "for everything on your computer, forever"],
    [4, "", "platforms: Mac, Windows, Linux, Chrome"],
    [100, "%", "of the AI runs on your device"],
    [60, " fps", "up to 4K, every track kept separate"],
  ];
  return (
    <section aria-label="Umi in numbers" className="px-4 py-12">
      <Reveal className="mx-auto grid max-w-6xl grid-cols-2 gap-px overflow-hidden rounded-3xl bg-hairline shadow-[0_0_0_1px_rgb(14_17_30/0.06)] lg:grid-cols-4">
        {stats.map(([n, unit, text]) => (
          <div key={text} className="bg-white p-6 sm:p-8">
            <b className="block text-4xl font-extrabold tracking-tight sm:text-5xl">
              {unit === "$" ? "$" : ""}
              <Count to={n} suffix={unit === "$" ? "" : unit} />
            </b>
            <span className="mt-2 block text-sm text-muted">{text}</span>
          </div>
        ))}
      </Reveal>
    </section>
  );
}

export function Cloud() {
  const curve = [100, 97, 95, 94, 91, 90, 88, 87, 86, 84, 83, 81, 80, 79, 77, 76, 75, 74, 72, 71];
  return (
    <section id="cloud" className="px-4 py-28">
      <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-2">
        <Reveal>
          <span className="tag">Umi Cloud</span>
          <h2 className="mt-5 text-4xl font-bold tracking-[-0.03em] text-balance sm:text-5xl">Share it as a link. See who watched.</h2>
          <p className="mt-4 text-lg text-muted">
            When you want a link instead of a file, Umi Cloud hosts it: people watch in any browser, comment and react at the exact moment, and you see views, watch time and where they stop.
          </p>
          <ul className="mt-6 grid gap-3">
            {["Link on your clipboard the moment you stop", "Passwords, expiry dates and download control", "Team workspaces with shared videos and styles", "Embeds and GIF previews for email and docs"].map((t) => (
              <li key={t} className="flex items-center gap-3 font-medium">
                <Check className="text-accent" /> {t}
              </li>
            ))}
          </ul>
        </Reveal>
        <Reveal delay={0.1}>
          <div className="card p-6 shadow-[0_0_0_1px_rgb(14_17_30/0.06),0_40px_80px_-20px_rgb(17_60_130/0.25)]">
            <div className="flex items-center justify-between">
              <b>Q4 roadmap</b>
              <span className="rounded-full bg-tint px-2.5 py-1 text-xs font-semibold text-accent">Insights</span>
            </div>
            <div className="mt-5 grid grid-cols-3 gap-3">
              {[
                ["248", "views"],
                ["2m 41s", "avg. watch"],
                ["71%", "finished"],
              ].map(([v, l]) => (
                <div key={l} className="rounded-2xl bg-ice-top p-3">
                  <b className="block text-xl sm:text-2xl">{v}</b>
                  <small className="text-muted">{l}</small>
                </div>
              ))}
            </div>
            <div className="mt-5 flex h-28 items-end gap-1">
              {curve.map((h, i) => (
                <motion.i
                  key={i}
                  className="flex-1 rounded-t-md bg-[linear-gradient(180deg,#6fb5ef,#116ff5)]"
                  initial={{ height: 0 }}
                  whileInView={{ height: `${h}%` }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.8, delay: i * 0.03, ease: [0.22, 1, 0.36, 1] }}
                />
              ))}
            </div>
            <div className="mt-5 flex items-center gap-3 rounded-2xl bg-ice-top p-3 text-sm">
              <span className="grid size-8 place-items-center rounded-full bg-accent text-xs font-bold text-white">A</span>
              <p>
                <b>Ada</b> <span className="text-muted">at 1:12</span> — Love this flow 🎉
              </p>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
