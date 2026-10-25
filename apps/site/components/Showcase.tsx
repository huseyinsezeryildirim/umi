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
                <Mark className="relative mt-24 size-16 text-white" mono />
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
        {/* The camera: a bubble, or the whole frame in "Camera only". Heights keep circles round (16:9). */}
        <motion.div
          className="absolute overflow-hidden bg-[#1a1d29]"
          animate={
            i === 1
              ? { left: "0%", top: "0%", width: "100%", height: "100%", borderRadius: "0%", boxShadow: "0 0 0 0px #fff" }
              : i === 2
                ? { left: "63%", top: "21%", width: "33%", height: `${33 * (16 / 9)}%`, borderRadius: "50%", boxShadow: "0 0 0 2px #fff" }
                : i === 3
                  ? { left: "70%", top: "52%", width: "22%", height: `${22 * (16 / 9)}%`, borderRadius: "50%", boxShadow: "0 0 0 2px #fff" }
                  : { left: "5%", top: "62%", width: "17%", height: `${17 * (16 / 9)}%`, borderRadius: "50%", boxShadow: "0 0 0 2px #fff" }
          }
          transition={{ duration: 0.7, ease: EASE }}
        >
          <video src="/media/camera.mp4" poster="/media/camera.jpg" autoPlay muted loop playsInline className="absolute inset-0 size-full object-cover" />
        </motion.div>
      </div>
      <div className="mt-2.5 flex justify-center">
        <Pills items={layouts} active={i} tint="#7c4dff" />
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
  const i = useBeat(ref, [1800, 1800, 2200]);
  return (
    <div ref={ref} className="w-[82%]">
      <div className="relative aspect-[16/10]">
        <Win className="h-full" />
        {/* The camera sits in the corner of the recording, as in the editor. */}
        {i < 2 ? (
          <motion.span
            key="bubble"
            className="absolute right-[-4%] bottom-[-6%] aspect-square w-[34%] overflow-hidden rounded-full border-[2.5px] border-white shadow-[0_10px_24px_rgb(0_0_0/0.25)]"
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.5, ease: EASE }}
          >
            <video src="/media/camera.mp4" poster="/media/camera.jpg" autoPlay muted loop playsInline className={`absolute inset-0 size-full object-cover transition-opacity duration-500 ${i === 1 ? "opacity-0" : ""}`} />
            <video src="/media/camera-blur.mp4" autoPlay muted loop playsInline className={`absolute inset-0 size-full object-cover transition-opacity duration-500 ${i === 1 ? "" : "opacity-0"}`} />
          </motion.span>
        ) : (
          <motion.div key="cutout" className="absolute right-[-2%] bottom-0 w-[44%]" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: EASE }}>
            <Cutout />
          </motion.div>
        )}
      </div>
      <div className="mt-3 flex justify-center">
        <Pills items={["Original", "Blur", "Remove"]} active={i} tint="#7c4dff" />
      </div>
    </div>
  );
}

/** Umi's own cut-out: the camera with its person matte (from Umi's segmentation) as alpha. */
function Cutout() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const cam = useRef<HTMLVideoElement>(null);
  const matte = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const c = canvas.current!;
    const g = c.getContext("2d", { willReadFrequently: true })!;
    const off = document.createElement("canvas");
    off.width = c.width;
    off.height = c.height;
    const og = off.getContext("2d", { willReadFrequently: true })!;
    // Only while on screen: combining the matte reads pixels every frame.
    let frame = 0;
    const draw = () => {
      const a = cam.current;
      const m = matte.current;
      if (a && m && a.readyState >= 2 && m.readyState >= 2) {
        if (Math.abs(a.currentTime - m.currentTime) > 0.06) m.currentTime = a.currentTime;
        g.clearRect(0, 0, c.width, c.height);
        g.drawImage(a, 0, 0, c.width, c.height);
        og.drawImage(m, 0, 0, c.width, c.height);
        const px = g.getImageData(0, 0, c.width, c.height);
        const mk = og.getImageData(0, 0, c.width, c.height).data;
        for (let k = 0; k < px.data.length; k += 4) px.data[k + 3] = mk[k];
        g.putImageData(px, 0, 0);
      }
      frame = requestAnimationFrame(draw);
    };
    const videos = () => [cam.current, matte.current].filter((v): v is HTMLVideoElement => !!v);
    const io = new IntersectionObserver(([e]) => {
      cancelAnimationFrame(frame);
      if (e.isIntersecting && !document.hidden) {
        videos().forEach((v) => void v.play().catch(() => {}));
        frame = requestAnimationFrame(draw);
      } else videos().forEach((v) => v.pause());
    });
    io.observe(c);
    return () => {
      io.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);
  return (
    <>
      <video ref={cam} src="/media/camera.mp4" muted loop playsInline className="hidden" />
      <video ref={matte} src="/media/camera-matte.mp4" muted loop playsInline className="hidden" />
      <canvas ref={canvas} width={200} height={200} className="block w-full drop-shadow-[0_8px_14px_rgb(0_0_0/0.25)]" />
    </>
  );
}

function BlurScene() {
  const ref = useRef<HTMLDivElement>(null);
  // Blur, then pixelate, then spotlight.
  const i = useBeat(ref, [1800, 1800, 1800]);
  return (
    <div ref={ref} className="relative w-[80%]">
      <Win>
        <div className="relative grid gap-2 p-3 text-[10.5px]">
          <i className="h-2 w-1/3 rounded bg-ink/15" />
          <div className={`relative z-10 flex items-center gap-2 rounded-md border border-black/10 bg-white px-2 py-1.5 font-mono text-ink transition-shadow duration-500 ${i === 2 ? "shadow-[0_0_0_3px_rgb(255_255_255/0.9),0_8px_20px_rgb(0_0_0/0.25)]" : ""}`}>
            <span className="text-muted">Password</span>
            <span className="relative ml-auto tracking-wider">
              hunter2-prod
              {i === 0 && <motion.span layoutId="mask" className="absolute -inset-1 rounded-[4px] bg-white/10 backdrop-blur-[3.5px]" />}
              {i === 1 && (
                <motion.span
                  layoutId="mask"
                  className="absolute -inset-1 rounded-[3px]"
                  style={{ background: "repeating-conic-gradient(#9aa3b2 0 25%, #c9ced8 0 50%) 0 0 / 8px 8px" }}
                />
              )}
            </span>
          </div>
          <i className="h-2 w-2/3 rounded bg-ink/10" />
          <i className="h-2 w-1/2 rounded bg-ink/10" />
          {/* Highlight: everything dims except the field. */}
          <motion.span
            className="pointer-events-none absolute inset-0 bg-ink/45"
            style={{ maskImage: "linear-gradient(#000,#000)", WebkitMaskImage: "linear-gradient(#000,#000)" }}
            animate={{ opacity: i === 2 ? 1 : 0 }}
            transition={{ duration: 0.5 }}
          />
        </div>
      </Win>
      <div className="mt-2.5 flex justify-center">
        <Pills items={["Blur", "Pixelate", "Highlight"]} active={i} />
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

function ZoomScene() {
  const ref = useRef<HTMLDivElement>(null);
  const i = useBeat(ref, [1400, 2200, 1000]);
  return (
    <div ref={ref} className="w-[80%]">
      <div className="relative aspect-[16/9] overflow-hidden rounded-[10px] bg-[linear-gradient(135deg,#e4edf9,#c9daf2)]">
        {/* The whole picture zooms toward the click, like the export does. */}
        <motion.div className="absolute inset-0 p-[7%]" style={{ transformOrigin: "84% 26%" }} animate={{ scale: i === 1 ? 1.6 : 1 }} transition={{ duration: 0.9, ease: EASE }}>
          <div className="relative h-full overflow-hidden rounded-[8px] bg-white shadow-[0_0_0_0.5px_rgb(0_0_0/0.12),0_10px_24px_-10px_rgb(20_40_90/0.35)]">
            <div className="flex gap-[4px] border-b border-black/5 px-2 py-1.5">
              <i className="size-[6px] rounded-full bg-[#ff5f57]" />
              <i className="size-[6px] rounded-full bg-[#febc2e]" />
              <i className="size-[6px] rounded-full bg-[#28c840]" />
            </div>
            <div className="grid gap-1.5 p-2.5">
              <div className="flex items-center gap-2">
                <i className="h-2 w-1/3 rounded bg-ink/20" />
                <motion.i className="ml-auto h-3.5 w-[24%] rounded bg-ink" animate={{ scale: i === 1 ? [1, 0.92, 1] : 1 }} transition={{ delay: 0.9, duration: 0.3 }} />
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                <i className="h-5 rounded bg-ink/[0.07]" />
                <i className="h-5 rounded bg-ink/[0.07]" />
                <i className="h-5 rounded bg-ink/[0.07]" />
              </div>
              <div className="flex h-7 items-end gap-1">
                {[40, 55, 45, 70, 62, 85, 76].map((h, k) => (
                  <i key={k} className="flex-1 rounded-t-[2px] bg-accent/45" style={{ height: `${h}%` }} />
                ))}
              </div>
            </div>
          </div>
          <motion.div className="absolute" animate={{ left: i === 0 ? "45%" : "82%", top: i === 0 ? "62%" : "27%" }} transition={{ duration: 0.8, ease: EASE }}>
            <Cursor />
          </motion.div>
        </motion.div>
      </div>
      <div className="relative mt-2.5 h-5 rounded-md bg-white shadow-[0_0_0_1px_rgb(17_24_39/0.08)]">
        <span className="absolute inset-y-1 left-[30%] w-[38%] rounded bg-accent/15 text-center text-[9px] leading-3 font-semibold text-accent">1.6× zoom</span>
        <motion.span className="absolute top-0 bottom-0 w-0.5 rounded bg-record" animate={{ left: ["8%", "92%"] }} transition={{ duration: 4.6, repeat: Infinity, ease: "linear" }} />
      </div>
    </div>
  );
}

function UmsScene() {
  const ref = useRef<HTMLDivElement>(null);
  // Found → button pressed → cut.
  const i = useBeat(ref, [1500, 700, 2300]);
  const words: [string, boolean][] = [
    ["So", false],
    ["um", true],
    ["this", false],
    ["is", false],
    ["uh", true],
    ["the", false],
    ["new", false],
    ["like", true],
    ["page.", false],
  ];
  const cut = i === 2;
  return (
    <div ref={ref} className="w-[84%] overflow-hidden rounded-[10px] bg-white text-left shadow-[0_0_0_0.5px_rgb(0_0_0/0.12),0_12px_30px_-10px_rgb(20_40_90/0.3)]">
      {/* The editor's Captions panel. */}
      <div className="flex items-center justify-between border-b border-black/5 px-3 py-2">
        <span className="text-[10.5px] font-semibold">Transcript</span>
        <motion.span
          className="rounded-md px-2 py-1 text-[9.5px] font-semibold"
          animate={{ backgroundColor: i === 1 ? "#0e62d6" : cut ? "rgb(17 24 39 / 0.06)" : "#116ff5", color: cut ? "#6b7280" : "#ffffff", scale: i === 1 ? 0.94 : 1 }}
          transition={{ duration: 0.25 }}
        >
          {cut ? "3 removed · 1.4 s" : "Remove filler words · 3"}
        </motion.span>
      </div>
      <p className="flex flex-wrap gap-x-1 gap-y-1 px-3 py-2.5 text-[12px] leading-tight">
        {words.map(([w, f], k) => (
          <motion.span
            key={k}
            className={`overflow-hidden rounded-[4px] whitespace-nowrap ${f ? "px-1" : ""}`}
            animate={{
              backgroundColor: f && !cut ? "rgb(255 59 48 / 0.12)" : "rgb(255 59 48 / 0)",
              color: f ? "#e5372c" : "#111827",
              width: f && cut ? 0 : "auto",
              opacity: f && cut ? 0 : 1,
              paddingLeft: f && cut ? 0 : f ? 4 : 0,
              paddingRight: f && cut ? 0 : f ? 4 : 0,
            }}
            transition={{ duration: 0.5, ease: EASE }}
          >
            {w}
          </motion.span>
        ))}
      </p>
      {/* The timeline: the cut stretches close up. */}
      <div className="border-t border-black/5 bg-[#f7f9fc] px-3 py-2.5">
        <div className="flex h-5 gap-[3px]">
          {words.map(([, f], k) => (
            <motion.i
              key={k}
              className="rounded-[3px]"
              style={{ flexBasis: 0 }}
              animate={{ flexGrow: f && cut ? 0.0001 : f ? 0.6 : 1, backgroundColor: f ? "#ffc9c4" : "#b9d0f2", marginRight: f && cut ? -3 : 0 }}
              transition={{ duration: 0.55, ease: EASE }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

const CARDS: [string, string, () => React.ReactNode][] = [
  ["Blur, pixelate or highlight", "Hide a password or a face, or make one spot stand out. It follows the content.", () => <BlurScene />],
  ["Scenes for screen and camera", "Switch any stretch to camera only, split or floating.", () => <LayoutScene />],
  ["Automatic zoom", "Zooms come from your clicks. Change them on the timeline.", () => <ZoomScene />],
  ["Captions, on your computer", "Words appear as you say them, the current one lit.", () => <CaptionScene />],
  ["Cut the ums", "One click cuts every um and uh. Or delete words in the transcript.", () => <UmsScene />],
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

// ───── Where recordings go ─────

const PLACES = [
  { name: "Your computer", line: "Every recording is a folder on your disk. Free, offline, yours.", icon: "M4 5h16v11H4zM8 20h8M12 16v4", tint: "#116ff5" },
  { name: "A file", line: "MP4, MOV or GIF, up to 4K. Send it anywhere.", icon: "M7 3h7l5 5v13H7zM14 3v5h5", tint: "#13a874" },
  { name: "Umi Cloud", line: "A link the moment you stop, with comments and insights.", icon: "M7 18a4 4 0 0 1-.5-8A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9z", tint: "#7c4dff" },
  { name: "Self hosted", line: "Umi Cloud is open source: run it on your own account and bucket.", icon: "M4 5h16v6H4zM4 13h16v6H4zM8 8h.01M8 16h.01", tint: "#e8590c" },
];

export function Storage() {
  const ref = useRef<HTMLDivElement>(null);
  // On a phone the section is taller than the screen, so "in view" means any of it.
  const inView = useInView(ref, { amount: 0.15 });
  const [active, setActive] = useState(0);
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!inView) return;
    // Loops forever; a tap holds the chosen place a little longer, then the loop carries on.
    const id = setTimeout(() => (setHeld(false), setActive((v) => (v + 1) % PLACES.length)), held ? 9000 : 3600);
    return () => clearTimeout(id);
  }, [active, inView, held]);
  // The recording sits in the middle of a 600×380 box; two places on each side, as logos.
  const spots = [
    [70, 105],
    [70, 275],
    [530, 105],
    [530, 275],
  ];
  const path = (k: number) => {
    const [x, y] = spots[k];
    const left = x < 300;
    const from = left ? 205 : 395;
    const to = left ? x + 34 : x - 34;
    const mid = (from + to) / 2;
    return `M ${from} 190 C ${mid} 190 ${mid} ${y} ${to} ${y}`;
  };

  return (
    <section className="px-4 pt-40">
      <Rise className="mx-auto max-w-3xl text-center">
        <p className="text-[15px] font-medium text-accent">Open source</p>
        <h2 className="h-display mt-3 text-[clamp(34px,5vw,60px)]">Your recordings. Actually yours.</h2>
        <p className="lead mx-auto mt-4 max-w-xl">They live on your computer. Share them through Umi Cloud, or run the cloud yourself.</p>
      </Rise>
      <div ref={ref} className="mx-auto mt-14 grid max-w-6xl gap-3 rounded-[32px] bg-panel p-3 lg:grid-cols-[1.25fr_1fr]">
        <Rise className="relative self-center overflow-hidden rounded-[24px] bg-white">
          <svg viewBox="0 0 600 380" className="block w-full" aria-hidden>
            {spots.map((_, k) => (
              <path key={k} d={path(k)} fill="none" stroke={k === active ? PLACES[k].tint : "#e3e8ef"} strokeWidth={k === active ? 2 : 1.5} strokeDasharray={k === active ? "0" : "4 5"} style={{ transition: "stroke 0.4s" }} />
            ))}
            {/* Animated in script every frame, so only while it can be seen. */}
            {inView && <motion.circle
              key={active}
              r="6"
              fill={PLACES[active].tint}
              initial={{ offsetDistance: "0%" } as never}
              animate={{ offsetDistance: "100%" } as never}
              transition={{ duration: 1.3, ease: EASE, repeat: Infinity, repeatDelay: 0.6 }}
              style={{ offsetPath: `path("${path(active)}")` } as never}
            />}
          </svg>
          {/* The recording */}
          <div className="absolute top-1/2 left-1/2 w-[30%] -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-[1.6%] shadow-[0_0_0_1px_rgb(17_24_39/0.06),0_18px_40px_-16px_rgb(20_40_90/0.35)]">
            <div className="relative aspect-[16/10] overflow-hidden rounded-lg bg-[linear-gradient(135deg,#e4edf9,#c9daf2)] p-[10%]">
              <div className="h-full rounded-[5px] bg-white shadow-sm">
                <div className="grid gap-1 p-1.5">
                  <i className="h-1 w-1/2 rounded bg-ink/15" />
                  <i className="h-1 w-1/3 rounded bg-ink/10" />
                </div>
              </div>
              <video src="/media/camera.mp4" autoPlay muted loop playsInline className="absolute bottom-[8%] left-[6%] aspect-square w-[24%] rounded-full border border-white object-cover" />
            </div>
            <div className="mt-1.5 flex items-center gap-1.5 px-0.5">
              <Mark className="size-3.5 shrink-0 text-accent" />
              <p className="truncate text-[11px] font-semibold sm:text-[12px]">demo.umi</p>
            </div>
          </div>
          {/* The places, as logos */}
          {PLACES.map((p, k) => (
            <button
              key={p.name}
              type="button"
              aria-label={p.name}
              title={p.name}
              onClick={() => (setActive(k), setHeld(true))}
              className="absolute grid aspect-square w-[11.5%] place-items-center rounded-[28%] bg-white transition-all duration-500"
              style={{
                left: `${(spots[k][0] / 600) * 100}%`,
                top: `${(spots[k][1] / 380) * 100}%`,
                color: k === active ? p.tint : "#9aa4b2",
                boxShadow: k === active ? `0 0 0 2px ${p.tint}, 0 14px 30px -10px ${p.tint}aa` : "0 0 0 1px rgb(17 24 39 / 0.08), 0 6px 16px -10px rgb(20 40 90 / 0.3)",
                transform: `translate(-50%, -50%) scale(${k === active ? 1.08 : 1})`,
              }}
            >
              <svg viewBox="0 0 24 24" className="size-[48%]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d={p.icon} />
              </svg>
            </button>
          ))}
        </Rise>
        <div className="flex flex-col justify-center gap-1 p-2">
          {PLACES.map((p, k) => (
            <button
              key={p.name}
              type="button"
              onClick={() => (setActive(k), setHeld(true))}
              className={`rounded-2xl px-5 py-4 text-left transition-all duration-500 ${k === active ? "bg-white shadow-[0_0_0_1px_rgb(17_24_39/0.05),0_12px_30px_-16px_rgb(20_40_90/0.3)]" : ""}`}
            >
              <span className={`flex items-center gap-2.5 text-[18px] font-semibold tracking-tight transition-colors ${k === active ? "text-ink" : "text-faint"}`}>
                <i className="size-2 rounded-[2px]" style={{ background: k === active ? p.tint : "#d4dae3" }} />
                {p.name}
              </span>
              <span className={`mt-1 block pl-[18px] text-[14.5px] transition-colors ${k === active ? "text-muted" : "text-faint"}`}>{p.line}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
