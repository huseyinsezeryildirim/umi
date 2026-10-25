"use client";

import { motion, useInView } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { CapIcon, LoomIcon } from "./icons";
import { Mark } from "./ui";
import { Rise } from "./Sections";

const EASE = [0.25, 1, 0.5, 1] as const;

// ───── Not just another screen recorder ─────

/** Free limits and the price for work, from loom.com/pricing and cap.so/pricing (October 25, 2026). */
const PLANS = [
  { name: "Loom", logo: <LoomIcon className="size-5" />, price: "$18", per: "per user / month", free: ["25 videos", "5 min each", "720p"], h: 150 },
  { name: "Cap", logo: <CapIcon className="size-5" />, price: "$29", per: "per year for work", free: ["Personal use only", "Links up to 5 min"], h: 290 },
];

export function NotJust() {
  const bars = useRef<HTMLDivElement>(null);
  const inView = useInView(bars, { once: true, amount: 0.3 });
  return (
    <section className="px-3 pt-40 sm:px-4">
      <div className="relative mx-auto max-w-[1400px] overflow-hidden rounded-[40px] bg-[linear-gradient(180deg,#eaf3fe,#f7fbff_70%,#ffffff)]">
        <div className="relative mx-auto grid max-w-6xl gap-14 px-6 pt-24 pb-16 sm:px-12 lg:grid-cols-[0.9fr_1.1fr] lg:items-end">
          <Rise className="lg:mb-[220px]">
            <h2 className="h-display text-[clamp(36px,5vw,64px)]">
              Not just another
              <br />
              screen recorder
            </h2>
            <p className="lead mt-5 max-w-sm">The others charge to use them for work or stop you at five minutes. Umi doesn’t.</p>
            <p className="mt-8 text-[12px] text-faint">Prices from loom.com and cap.so, October 2026.</p>
          </Rise>
          <div ref={bars} className="flex h-[640px] items-end justify-center gap-3 sm:gap-4">
            {PLANS.map((p, i) => (
              <div key={p.name} className="flex w-1/3 max-w-[210px] flex-col items-center">
                <motion.div className="mb-4 text-center" initial={{ opacity: 0, y: 10 }} animate={inView ? { opacity: 1, y: 0 } : {}} transition={{ delay: 0.5 + i * 0.25, duration: 0.7 }}>
                  <b className="block text-[clamp(30px,3.6vw,48px)] leading-none font-semibold tracking-tight text-[#8ea6c8]">{p.price}</b>
                  <span className="mt-2 block text-[11px] font-semibold tracking-[0.12em] text-[#8ea6c8] uppercase">{p.per}</span>
                </motion.div>
                <motion.div
                  className="flex w-full flex-col justify-end gap-1 rounded-t-[18px] bg-[linear-gradient(180deg,#c9d9f1,#edf3fb)] p-4"
                  initial={{ height: 0 }}
                  animate={inView ? { height: p.h } : {}}
                  transition={{ delay: 0.2 + i * 0.25, duration: 1.2, ease: EASE }}
                >
                  <span className="text-[11px] font-semibold tracking-[0.1em] text-[#7c93b4] uppercase">Free</span>
                  {p.free.map((f) => (
                    <span key={f} className="text-[13px] leading-snug text-[#506685]">
                      {f}
                    </span>
                  ))}
                </motion.div>
                <span className="mt-4 flex items-center gap-2 text-[15px] text-muted">
                  {p.logo}
                  {p.name}
                </span>
              </div>
            ))}
            <div className="flex w-1/3 max-w-[230px] flex-col items-center">
              <motion.div className="mb-4 text-center" initial={{ opacity: 0, y: 10 }} animate={inView ? { opacity: 1, y: 0 } : {}} transition={{ delay: 1.3, duration: 0.8 }}>
                <b className="block text-[clamp(40px,5vw,72px)] leading-none font-semibold tracking-tight">$0</b>
                <span className="mt-2 block text-[11px] font-semibold tracking-[0.12em] text-muted uppercase">work included</span>
              </motion.div>
              <motion.div
                className="relative flex w-full flex-col items-center justify-between overflow-hidden rounded-t-[18px] p-5 shadow-[0_40px_80px_-25px_rgb(17_80_180/0.55)]"
                initial={{ height: 0 }}
                animate={inView ? { height: 480 } : {}}
                transition={{ delay: 0.7, duration: 1.4, ease: EASE }}
              >
                <img src="/photos/sky.jpg" alt="" className="absolute inset-0 size-full object-cover" />
                <Mark className="relative mt-24 size-16 text-white" />
                <span className="relative grid gap-0.5 rounded-xl bg-white/85 px-3 py-2 text-center text-[13px] leading-snug font-medium text-ink backdrop-blur">
                  <span>Unlimited videos</span>
                  <span className="whitespace-nowrap">Any length, 4K</span>
                </span>
              </motion.div>
              <span className="mt-4 flex items-center gap-2 text-[15px] font-semibold text-ink">
                <Mark className="size-5" />
                Umi
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ───── The editor, card by card ─────

/** Runs `steps` (ms each) in a loop while the card is on screen. */
function useBeat(ref: React.RefObject<HTMLElement | null>, steps: number[]) {
  const inView = useInView(ref, { amount: 0.5 });
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!inView) return;
    const t = setTimeout(() => setI((v) => (v + 1) % steps.length), steps[i]);
    return () => clearTimeout(t);
  }, [i, inView, steps]);
  return i;
}

/** A plain app window: traffic lights and grey content. */
function Win({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return (
    <div className={`relative overflow-hidden rounded-[10px] bg-white shadow-[0_0_0_0.5px_rgb(0_0_0/0.12),0_12px_30px_-10px_rgb(20_40_90/0.3)] ${className}`}>
      <div className="flex gap-[5px] border-b border-black/5 px-2.5 py-2">
        <i className="size-[7px] rounded-full bg-[#ff5f57]" />
        <i className="size-[7px] rounded-full bg-[#febc2e]" />
        <i className="size-[7px] rounded-full bg-[#28c840]" />
      </div>
      {children ?? <Skeleton />}
    </div>
  );
}
function Skeleton() {
  return (
    <div className="grid gap-2 p-3">
      <div className="flex gap-2">
        <i className="h-2 w-1/3 rounded bg-ink/12" />
        <i className="ml-auto h-3 w-1/5 rounded bg-accent/70" />
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        <i className="h-6 rounded bg-ink/[0.05]" />
        <i className="h-6 rounded bg-ink/[0.05]" />
        <i className="h-6 rounded bg-ink/[0.05]" />
      </div>
      <div className="flex h-10 items-end gap-1">
        {[40, 55, 45, 70, 62, 85, 76].map((h, i) => (
          <i key={i} className="flex-1 rounded-t-[2px] bg-ink/[0.08]" style={{ height: `${h}%` }} />
        ))}
      </div>
    </div>
  );
}
const Cursor = ({ className = "" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={`size-4 drop-shadow ${className}`}>
    <path d="M5 3l14 7.5-6.2 1.6L10 18.5z" fill="#000" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" />
  </svg>
);
/** The webcam: a stock portrait (Pexels), as the camera bubble shows it. */
const Face = ({ className = "", mode = "original" }: { className?: string; mode?: "original" | "blur" | "remove" }) => (
  <span className={`relative block aspect-square overflow-hidden rounded-full border-2 border-white bg-[linear-gradient(135deg,#e4edf9,#c9daf2)] shadow-md ${className}`}>
    {mode !== "remove" && <video src="/media/camera.mp4" poster="/media/camera.jpg" autoPlay muted loop playsInline className={`absolute inset-0 size-full object-cover transition-[filter] duration-500 ${mode === "blur" ? "blur-[3px]" : ""}`} />}
    {mode !== "original" && (
      <video src="/media/camera.mp4" poster="/media/camera.jpg" autoPlay muted loop playsInline className="absolute inset-0 size-full object-cover [mask-image:radial-gradient(ellipse_34%_46%_at_50%_55%,#000_72%,transparent_100%)]" />
    )}
  </span>
);
const Pills = ({ items, active, tint = "#116ff5" }: { items: string[]; active: number; tint?: string }) => (
  <div className="flex gap-1 rounded-lg bg-white p-1 text-[10.5px] font-medium shadow-[0_0_0_1px_rgb(17_24_39/0.06)]">
    {items.map((t, i) => (
      <span key={t} className="relative rounded-md px-2 py-1 whitespace-nowrap">
        {i === active && <motion.span layoutId={`pill-${items.join()}`} className="absolute inset-0 rounded-md" style={{ background: `${tint}1f` }} transition={{ type: "spring", stiffness: 400, damping: 34 }} />}
        <span className="relative" style={{ color: i === active ? tint : "#6b7280" }}>
          {t}
        </span>
      </span>
    ))}
  </div>
);

function BlurScene() {
  const ref = useRef<HTMLDivElement>(null);
  const i = useBeat(ref, [1200, 1600, 1600]);
  return (
    <div ref={ref} className="relative w-[78%]">
      <Win>
        <div className="grid gap-2 p-3 text-[10px]">
          <i className="h-2 w-1/3 rounded bg-ink/12" />
          <div className="relative flex items-center gap-2 rounded-md border border-black/5 px-2 py-1.5 font-mono text-ink">
            Password <span className="ml-auto tracking-wider">hunter2-prod</span>
            <motion.span
              className="absolute inset-y-0.5 right-0.5 left-[48%] rounded border border-dashed border-accent bg-white/30 backdrop-blur-[4px]"
              style={{ originX: 0 }}
              animate={{ scaleX: i === 0 ? 0 : 1, opacity: i === 0 ? 0 : 1 }}
              transition={{ duration: 0.6, ease: EASE }}
            />
          </div>
          <i className="h-2 w-2/3 rounded bg-ink/8" />
          <i className="h-2 w-1/2 rounded bg-ink/8" />
        </div>
      </Win>
      <motion.div className="absolute" animate={{ left: i === 0 ? "48%" : "96%", top: i === 0 ? "52%" : "64%" }} transition={{ duration: 0.9, ease: EASE }}>
        <Cursor />
      </motion.div>
      <div className="mt-2.5 flex justify-center">
        <Pills items={["Blur", "Pixelate", "Spotlight"]} active={i === 2 ? 1 : 0} />
      </div>
    </div>
  );
}

function LayoutScene() {
  const ref = useRef<HTMLDivElement>(null);
  const i = useBeat(ref, [1500, 1500, 1500, 1500]);
  const layouts = ["Default", "Camera only", "Split", "Floating"];
  return (
    <div ref={ref} className="w-[80%]">
      <div className="relative aspect-[16/9] overflow-hidden rounded-[10px] bg-[linear-gradient(135deg,#e4edf9,#c9daf2)]">
        <motion.div className="absolute" animate={{ left: i === 2 ? "4%" : "8%", top: "10%", width: i === 1 ? "0%" : i === 2 ? "56%" : "84%", height: "80%", opacity: i === 1 ? 0 : 1 }} transition={{ duration: 0.7, ease: EASE }}>
          <Win className="h-full" />
        </motion.div>
        <motion.div
          className="absolute"
          animate={
            i === 1
              ? { left: "34%", top: "8%", width: "32%" }
              : i === 2
                ? { left: "63%", top: "18%", width: "33%" }
                : i === 3
                  ? { left: "70%", top: "52%", width: "22%" }
                  : { left: "5%", top: "62%", width: "17%" }
          }
          transition={{ duration: 0.7, ease: EASE }}
        >
          <Face className="w-full" />
        </motion.div>
      </div>
      <div className="mt-2.5 flex justify-center">
        <Pills items={layouts} active={i} tint="#7c4dff" />
      </div>
    </div>
  );
}

function ZoomScene() {
  const ref = useRef<HTMLDivElement>(null);
  const i = useBeat(ref, [1300, 2000, 1000]);
  return (
    <div ref={ref} className="w-[78%]">
      <div className="relative aspect-[16/9] overflow-hidden rounded-[10px] bg-[linear-gradient(135deg,#e4edf9,#c9daf2)] p-[6%]">
        <motion.div className="h-full origin-[86%_22%]" animate={{ scale: i === 1 ? 2 : 1 }} transition={{ duration: 0.9, ease: EASE }}>
          <Win className="h-full" />
        </motion.div>
        <motion.div className="absolute" animate={{ left: i === 0 ? "40%" : "84%", top: i === 0 ? "62%" : "26%" }} transition={{ duration: 0.8, ease: EASE }}>
          <Cursor />
        </motion.div>
      </div>
      <div className="relative mt-2.5 h-5 rounded-md bg-white shadow-[0_0_0_1px_rgb(17_24_39/0.06)]">
        <span className="absolute inset-y-1 left-[30%] w-[38%] rounded bg-accent/15 text-center text-[9px] leading-3 font-semibold text-accent">2× zoom</span>
        <motion.span className="absolute top-0 bottom-0 w-0.5 rounded bg-record" animate={{ left: ["8%", "92%"] }} transition={{ duration: 4.3, repeat: Infinity, ease: "linear" }} />
      </div>
    </div>
  );
}

function CaptionScene() {
  const ref = useRef<HTMLDivElement>(null);
  const words = ["Here’s", "the", "new", "dashboard"];
  const i = useBeat(ref, [450, 450, 450, 450, 1400]);
  return (
    <div ref={ref} className="relative w-[78%]">
      <Win />
      <div className="absolute inset-x-0 bottom-3 flex justify-center">
        <p className="rounded-md bg-ink/85 px-2.5 py-1 text-[12px] font-semibold text-white/35">
          {words.map((w, k) => (
            <span key={w} className={k <= i && i < 4 ? (k === i ? "text-[#ffd60a]" : "text-white") : i === 4 ? "text-white" : ""}>
              {w}{" "}
            </span>
          ))}
        </p>
      </div>
    </div>
  );
}

function UmsScene() {
  const ref = useRef<HTMLDivElement>(null);
  const i = useBeat(ref, [1300, 1200, 1800]);
  const words: [string, boolean][] = [
    ["So", false],
    ["um,", true],
    ["this", false],
    ["is", false],
    ["uh,", true],
    ["fast.", false],
  ];
  return (
    <div ref={ref} className="w-[80%] rounded-[10px] bg-white p-3.5 shadow-[0_0_0_0.5px_rgb(0_0_0/0.12),0_12px_30px_-10px_rgb(20_40_90/0.3)]">
      <p className="text-[15px] font-medium">
        {words.map(([w, f], k) => (
          <motion.span
            key={k}
            className="inline-block overflow-hidden align-bottom whitespace-pre"
            animate={{ width: f && i === 2 ? 0 : "auto", opacity: f && i === 2 ? 0 : 1, color: f && i >= 1 ? "#ff3b30" : "#111827", textDecorationLine: f && i >= 1 ? "line-through" : "none" }}
            transition={{ duration: 0.5, ease: EASE }}
          >
            {w}{" "}
          </motion.span>
        ))}
      </p>
      <div className="mt-3 flex h-4 gap-[3px]">
        {words.map(([, f], k) => (
          <motion.i key={k} className="rounded-[3px]" style={{ flexBasis: 0 }} animate={{ flexGrow: f && i === 2 ? 0.0001 : 1, backgroundColor: f && i >= 1 ? "#ffd2cf" : "#c9dcf3" }} transition={{ duration: 0.5, ease: EASE }} />
        ))}
      </div>
    </div>
  );
}

function TextScene() {
  const ref = useRef<HTMLDivElement>(null);
  const i = useBeat(ref, [1600, 1600, 1600]);
  return (
    <div ref={ref} className="relative w-[78%]">
      <Win />
      <div className="absolute inset-0 top-6 grid place-items-center">
        <motion.div key={i} initial={{ opacity: 0, y: 10, scale: 0.94 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.5, ease: EASE }}>
          {i === 0 && <span className="rounded-lg bg-ink px-3 py-1.5 text-[16px] font-bold tracking-tight text-white shadow-lg">Q4 launch</span>}
          {i === 1 && (
            <span className="block rounded-md bg-white px-3 py-1.5 text-left shadow-lg">
              <b className="block text-[12px]">Ada Lovelace</b>
              <span className="text-[10px] text-muted">Head of product</span>
            </span>
          )}
          {i === 2 && <span className="rounded-lg bg-accent px-3 py-1 text-[22px] font-bold text-white shadow-lg">+42%</span>}
        </motion.div>
      </div>
      <div className="mt-2.5 flex justify-center">
        <Pills items={["Title", "Lower third", "Big stat"]} active={i} tint="#e8590c" />
      </div>
    </div>
  );
}

function BackgroundScene() {
  const ref = useRef<HTMLDivElement>(null);
  const i = useBeat(ref, [1400, 1400, 1400, 1400]);
  const bgs = ["linear-gradient(135deg,#9eccfa,#2e5eb8)", "linear-gradient(135deg,#fa736b,#6b4adb)", "url(/photos/dawn.jpg) center/cover", "linear-gradient(135deg,#8cedc2,#1c8c8c)"];
  return (
    <div ref={ref} className="w-[78%]">
      <div className="relative aspect-[16/9] overflow-hidden rounded-[10px]">
        {bgs.map((b, k) => (
          <motion.div key={k} className="absolute inset-0" style={{ background: b }} animate={{ opacity: k === i ? 1 : 0 }} transition={{ duration: 0.6 }} />
        ))}
        <div className="absolute inset-[11%]">
          <Win className="h-full" />
        </div>
      </div>
      <div className="mt-2.5 flex justify-center gap-1.5">
        {bgs.map((b, k) => (
          <span key={k} className={`size-6 rounded-md transition-shadow duration-300 ${k === i ? "ring-2 ring-accent ring-offset-2" : ""}`} style={{ background: b }} />
        ))}
      </div>
    </div>
  );
}

function CameraScene() {
  const ref = useRef<HTMLDivElement>(null);
  const i = useBeat(ref, [1500, 1500, 1500]);
  return (
    <div ref={ref} className="flex w-[78%] flex-col items-center">
      <div className="relative">
        <Face className="w-32" mode={i === 0 ? "original" : i === 1 ? "blur" : "remove"} />
      </div>
      <div className="mt-3">
        <Pills items={["Original", "Blur", "Remove"]} active={i} tint="#7c4dff" />
      </div>
    </div>
  );
}

function ClipsScene() {
  const ref = useRef<HTMLDivElement>(null);
  const i = useBeat(ref, [1200, 1200, 1600]);
  return (
    <div ref={ref} className="w-[82%] rounded-[10px] bg-white p-3 shadow-[0_0_0_0.5px_rgb(0_0_0/0.12),0_12px_30px_-10px_rgb(20_40_90/0.3)]">
      <div className="relative flex h-7 gap-1">
        <motion.i className="rounded-md bg-[#b6cff0]" animate={{ flexGrow: 1 }} style={{ flexBasis: 0 }} />
        <motion.i className="relative rounded-md bg-[#9ec3f5]" animate={{ flexGrow: i === 2 ? 0.5 : 1, opacity: i >= 1 ? 1 : 0.0001 }} style={{ flexBasis: 0 }} transition={{ duration: 0.6, ease: EASE }}>
          {i === 2 && <span className="absolute top-1 right-1 rounded bg-ink px-1 text-[9px] font-bold text-white">2×</span>}
        </motion.i>
        <motion.span className="absolute top-[-4px] bottom-[-4px] w-0.5 rounded bg-record" animate={{ left: i === 0 ? "50%" : "50%" }} />
      </div>
      <div className="mt-1.5 flex h-5 items-center gap-[2px] rounded-md bg-[#e2f5ec] px-1.5">
        {Array.from({ length: 32 }).map((_, k) => (
          <i key={k} className="w-[2px] rounded-full bg-[#13a874]" style={{ height: `${30 + ((k * 37) % 60)}%` }} />
        ))}
      </div>
      <p className="mt-2 text-center text-[10px] text-muted">{i === 0 ? "Split at 0:12" : i === 1 ? "Two clips" : "Second clip at 2×"}</p>
    </div>
  );
}

const CARDS: [string, string, () => React.ReactNode][] = [
  ["Blur what’s private", "Drop a mask over a password or a face. It follows the content.", () => <BlurScene />],
  ["Scenes for screen and camera", "Switch any stretch to camera only, split or floating.", () => <LayoutScene />],
  ["Automatic zoom", "Zooms come from your clicks. Change them on the timeline.", () => <ZoomScene />],
  ["Captions, on your computer", "Words appear as you say them, the current one lit.", () => <CaptionScene />],
  ["Cut the ums", "Delete words in the transcript to cut the video.", () => <UmsScene />],
  ["Text that animates", "Titles, lower thirds and big numbers, in and out.", () => <TextScene />],
  ["Any background", "Gradients, photos, your wallpaper or your own image.", () => <BackgroundScene />],
  ["Camera without the room", "Blur or remove your background. No green screen.", () => <CameraScene />],
  ["Clips, speed and music", "Split, speed up and lay music underneath.", () => <ClipsScene />],
];

export function EditorGrid() {
  return (
    <section className="px-4 pt-40">
      <Rise className="mx-auto max-w-3xl text-center">
        <p className="text-[15px] font-medium text-accent">The editor</p>
        <h2 className="h-display mt-3 text-[clamp(34px,5vw,56px)]">Polish it before anyone sees it.</h2>
      </Rise>
      <div className="mx-auto mt-14 grid max-w-6xl gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {CARDS.map(([title, line, Scene], k) => (
          <motion.article
            key={title}
            className="rounded-[24px] bg-[#f4f6f9] p-2.5 pb-5"
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ duration: 0.8, ease: EASE, delay: (k % 3) * 0.08 }}
          >
            <div className="grid aspect-[4/3] place-items-center overflow-hidden rounded-[18px] bg-white shadow-[0_0_0_1px_rgb(17_24_39/0.04)]">
              <Scene />
            </div>
            <h3 className="mt-4 px-2.5 text-[17px] font-semibold tracking-tight">{title}</h3>
            <p className="mt-1 px-2.5 text-[14.5px] text-pretty text-muted">{line}</p>
          </motion.article>
        ))}
      </div>
    </section>
  );
}
