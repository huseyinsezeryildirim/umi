"use client";

// Umi in the browser: record the screen, camera and voice with nothing to install, then give it
// the Umi look (background, padding, corners, camera bubble), trim it and download it.
// Screen and camera are recorded as two separate videos, so every look choice stays editable.
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Mark } from "./ui";

const EASE = [0.25, 1, 0.5, 1] as const;

const GRADIENTS: Record<string, [string, string]> = {
  sky: ["#9eccfa", "#2e5eb8"],
  ice: ["#f2f7fc", "#ccdff7"],
  navy: ["#2e5487", "#0f172b"],
  graphite: ["#40454f", "#0f121a"],
  mist: ["#edf0f5", "#b8bfcf"],
  mint: ["#8cedc2", "#1c8c8c"],
  sand: ["#f5e8d1", "#d1b594"],
  dusk: ["#fa736b", "#6b4adb"],
  ocean: ["#2199f2", "#14338c"],
  peach: ["#ffcc9e", "#f57885"],
  grape: ["#cc73f2", "#4d2699"],
  night: ["#333847", "#0d0d17"],
};

type Aspect = "auto" | "wide" | "square" | "vertical";
const ASPECTS: [Aspect, string][] = [
  ["auto", "Auto"],
  ["wide", "16:9"],
  ["square", "1:1"],
  ["vertical", "9:16"],
];
type Corner = "tl" | "tr" | "bl" | "br";

type Look = { gradient: string; padding: number; radius: number; aspect: Aspect; camera: boolean; corner: Corner; camSize: number };
const LOOK: Look = { gradient: "sky", padding: 0.08, radius: 0.025, aspect: "auto", camera: true, corner: "br", camSize: 0.24 };

type Take = { screen: string; camera: string | null; duration: number; width: number; height: number };

/** The first recording format this browser can write (MP4 where possible). */
function mime(kinds: string[]) {
  return kinds.find((k) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(k)) ?? "";
}
const VIDEO_TYPES = ["video/mp4;codecs=avc1,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export function Recorder({ account }: { account?: React.ReactNode }) {
  const [stage, setStage] = useState<"setup" | "countdown" | "recording" | "edit">("setup");
  const [supported, setSupported] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [micOn, setMicOn] = useState(true);
  const [count, setCount] = useState(3);
  const [elapsed, setElapsed] = useState(0);
  const [take, setTake] = useState<Take | null>(null);
  const [error, setError] = useState("");

  const preview = useRef<HTMLVideoElement>(null);
  const camStream = useRef<MediaStream | null>(null);
  const session = useRef<{ stop: () => void } | null>(null);

  useEffect(() => {
    setSupported(!!navigator.mediaDevices?.getDisplayMedia && typeof MediaRecorder !== "undefined");
  }, []);

  // The camera preview on the setup screen.
  useEffect(() => {
    if (stage !== "setup" || !camOn) return;
    let stream: MediaStream | null = null;
    let gone = false;
    navigator.mediaDevices
      ?.getUserMedia({ video: { width: 640, height: 640, facingMode: "user" } })
      .then((s) => {
        if (gone) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        camStream.current = s;
        if (preview.current) preview.current.srcObject = s;
      })
      .catch(() => setCamOn(false));
    return () => {
      gone = true;
      stream?.getTracks().forEach((t) => t.stop());
      camStream.current = null;
    };
  }, [stage, camOn]);

  const start = useCallback(async () => {
    setError("");
    let display: MediaStream;
    try {
      display = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true });
    } catch {
      return; // The visitor closed the picker.
    }
    const extra: MediaStream[] = [];
    let camera: MediaStream | null = null;
    try {
      if (camOn) camera = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 640, facingMode: "user" } });
      if (micOn) extra.push(await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }));
    } catch {
      setError("Camera or microphone was blocked. Recording the screen only.");
    }

    // Mix the screen's sound and the voice into one track.
    const audio = new AudioContext();
    const out = audio.createMediaStreamDestination();
    for (const s of [display, ...extra]) if (s.getAudioTracks().length) audio.createMediaStreamSource(s).connect(out);
    const screenStream = new MediaStream([...display.getVideoTracks(), ...out.stream.getAudioTracks()]);
    const settings = display.getVideoTracks()[0].getSettings();

    setStage("countdown");
    for (const n of [3, 2, 1]) {
      setCount(n);
      await new Promise((r) => setTimeout(r, 900));
    }

    const type = mime(VIDEO_TYPES);
    const recorders: { rec: MediaRecorder; chunks: Blob[] }[] = [screenStream, camera].filter(Boolean).map((s) => {
      const rec = new MediaRecorder(s!, type ? { mimeType: type, videoBitsPerSecond: s === camera ? 2_500_000 : 8_000_000 } : undefined);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      return { rec, chunks };
    });
    const began = performance.now();
    recorders.forEach((r) => r.rec.start(1000));
    setElapsed(0);
    setStage("recording");
    const tick = setInterval(() => setElapsed((performance.now() - began) / 1000), 250);

    // The camera floats over every window while recording, where the browser allows it.
    if (camera && preview.current && document.pictureInPictureEnabled) {
      preview.current.srcObject = camera;
      preview.current.play().then(() => preview.current?.requestPictureInPicture().catch(() => {}));
    }

    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      clearInterval(tick);
      const duration = (performance.now() - began) / 1000;
      if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
      Promise.all(
        recorders.map(
          (r) =>
            new Promise<string>((done) => {
              r.rec.onstop = () => done(URL.createObjectURL(new Blob(r.chunks, { type: r.rec.mimeType || "video/webm" })));
              r.rec.stop();
            }),
        ),
      ).then(([screen, cam]) => {
        [display, camera, ...extra].forEach((s) => s?.getTracks().forEach((t) => t.stop()));
        audio.close();
        setTake({ screen, camera: cam ?? null, duration, width: settings.width ?? 1920, height: settings.height ?? 1080 });
        setStage("edit");
      });
    };
    session.current = { stop };
    // The browser's own "Stop sharing" button ends it too.
    display.getVideoTracks()[0].addEventListener("ended", stop);
  }, [camOn, micOn]);

  if (stage === "edit" && take) return <Editor take={take} account={account} onRestart={() => (setTake(null), setStage("setup"))} />;

  return (
    <div className="grid min-h-[100svh] place-items-center bg-[radial-gradient(120%_80%_at_50%_0%,#dcebfc_0%,#fff_60%)] px-4 py-24">
      <a href="/" className="fixed top-5 left-5 flex items-center gap-2 text-[17px] font-semibold">
        <Mark className="size-6" /> Umi
      </a>
      {account && <div className="fixed top-4 right-4 z-40">{account}</div>}
      <AnimatePresence mode="wait">
        {stage === "setup" && (
          <motion.div key="setup" className="w-full max-w-md text-center" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }} transition={{ duration: 0.5, ease: EASE }}>
            <h1 className="h-display text-[clamp(34px,6vw,48px)]">Record in your browser.</h1>
            <p className="lead mt-3">Nothing to install. Your video stays on this computer until you download it.</p>
            {!supported ? (
              <p className="mt-10 rounded-2xl bg-[#fff4e5] px-5 py-4 text-[15px] text-[#8a5300]">Screen recording needs a computer. Open this page in Chrome, Edge, Firefox or Safari on a Mac or PC.</p>
            ) : (
              <>
                <div className="relative mx-auto mt-10 grid size-40 place-items-center overflow-hidden rounded-full bg-[#eef2f7] shadow-[0_0_0_4px_#fff,0_20px_40px_-16px_rgb(20_40_90/0.45)]">
                  {camOn ? <video ref={preview} autoPlay muted playsInline className="size-full -scale-x-100 object-cover" /> : <CameraOff />}
                </div>
                <div className="mx-auto mt-8 grid max-w-xs gap-2 text-left">
                  <Option label="Camera" on={camOn} onToggle={() => setCamOn((v) => !v)} />
                  <Option label="Microphone" on={micOn} onToggle={() => setMicOn((v) => !v)} />
                </div>
                <button type="button" onClick={() => void start()} className="btn-glass mt-8">
                  <span className="size-3 rounded-full bg-record" />
                  Start recording
                </button>
                <p className="mt-4 text-[13px] text-faint">You’ll choose a screen, window or tab next.</p>
                {error && <p className="mt-4 text-[14px] text-[#b42318]">{error}</p>}
              </>
            )}
          </motion.div>
        )}
        {stage === "countdown" && (
          <motion.div key="count" className="grid size-48 place-items-center rounded-full bg-ink/85 text-[96px] font-semibold text-white tabular-nums backdrop-blur" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.1 }}>
            <motion.span key={count} initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.35, ease: EASE }}>
              {count}
            </motion.span>
          </motion.div>
        )}
        {stage === "recording" && (
          <motion.div key="rec" className="text-center" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
            <video ref={preview} autoPlay muted playsInline className="pointer-events-none fixed size-px opacity-0" />
            <p className="flex items-center justify-center gap-3 text-[15px] text-muted">
              <span className="size-2.5 animate-pulse rounded-full bg-record" />
              Recording
            </p>
            <p className="mt-2 text-[64px] font-semibold tabular-nums">{clock(elapsed)}</p>
            <button type="button" onClick={() => session.current?.stop()} className="mt-6 inline-flex h-12 items-center gap-3 rounded-full bg-ink px-7 text-[16px] font-medium text-white">
              <span className="size-3 rounded-[3px] bg-record" />
              Stop
            </button>
            <p className="mt-4 text-[13px] text-faint">Or use your browser’s “Stop sharing” button.</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Option({ label, on, onToggle }: { label: string; on: boolean; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle} aria-pressed={on} className="flex w-full items-center justify-between gap-4 rounded-xl bg-white px-4 py-3 text-[15px] shadow-[0_0_0_1px_rgb(17_24_39/0.07)]">
      {label}
      <span className={`relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors ${on ? "bg-accent" : "bg-black/15"}`}>
        <span className={`absolute top-[2px] size-[18px] rounded-full bg-white shadow transition-all ${on ? "left-[18px]" : "left-[2px]"}`} />
      </span>
    </button>
  );
}

function CameraOff() {
  return (
    <svg viewBox="0 0 24 24" className="size-10 text-faint" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 3l18 18M10.5 6H14a2 2 0 0 1 2 2v2.5l5-3v9M16 16a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2" />
    </svg>
  );
}

// ───── Editor ─────

/** The output size for a look: 1080 tall (or wide for vertical), even numbers. */
function canvasSize(look: Look, take: Take): [number, number] {
  if (look.aspect === "wide") return [1920, 1080];
  if (look.aspect === "square") return [1080, 1080];
  if (look.aspect === "vertical") return [1080, 1920];
  const h = 1080;
  return [Math.round(((h * take.width) / take.height) / 2) * 2, h];
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** Draws one frame of the finished video. */
function paint(ctx: CanvasRenderingContext2D, look: Look, screen: HTMLVideoElement, cam: HTMLVideoElement | null) {
  const { width: W, height: H } = ctx.canvas;
  const [a, b] = GRADIENTS[look.gradient];
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, a);
  g.addColorStop(1, b);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  const pad = look.padding * Math.min(W, H);
  const sw = screen.videoWidth || 16;
  const sh = screen.videoHeight || 9;
  const scale = Math.min((W - pad * 2) / sw, (H - pad * 2) / sh);
  const w = sw * scale;
  const h = sh * scale;
  const x = (W - w) / 2;
  const y = (H - h) / 2;
  const r = look.radius * Math.min(W, H);

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = pad > 0 ? Math.min(W, H) * 0.04 : 0;
  ctx.shadowOffsetY = pad > 0 ? Math.min(W, H) * 0.012 : 0;
  roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = "#000";
  ctx.fill();
  ctx.restore();
  ctx.save();
  roundRect(ctx, x, y, w, h, r);
  ctx.clip();
  if (screen.readyState >= 2) ctx.drawImage(screen, x, y, w, h);
  ctx.restore();

  if (look.camera && cam && cam.readyState >= 2) {
    const d = look.camSize * Math.min(W, H);
    const m = Math.max(pad * 0.5, Math.min(W, H) * 0.03);
    const cx = look.corner.endsWith("l") ? m + d / 2 : W - m - d / 2;
    const cy = look.corner.startsWith("t") ? m + d / 2 : H - m - d / 2;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.35)";
    ctx.shadowBlur = d * 0.12;
    ctx.beginPath();
    ctx.arc(cx, cy, d / 2 + d * 0.02, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, d / 2, 0, Math.PI * 2);
    ctx.clip();
    const s = Math.min(cam.videoWidth, cam.videoHeight);
    // Mirrored, like the preview the speaker saw.
    ctx.translate(cx * 2, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(cam, (cam.videoWidth - s) / 2, (cam.videoHeight - s) / 2, s, s, cx - d / 2, cy - d / 2, d, d);
    ctx.restore();
  }
}

function Editor({ take, account, onRestart }: { take: Take; account?: React.ReactNode; onRestart: () => void }) {
  const [look, setLook] = useState<Look>({ ...LOOK, camera: !!take.camera });
  const [trim, setTrim] = useState<[number, number]>([0, take.duration]);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [exporting, setExporting] = useState<number | null>(null);

  const canvas = useRef<HTMLCanvasElement>(null);
  const screen = useRef<HTMLVideoElement>(null);
  const cam = useRef<HTMLVideoElement>(null);
  const audio = useRef<{ ctx: AudioContext; out: MediaStreamAudioDestinationNode } | null>(null);
  const lookRef = useRef(look);
  lookRef.current = look;
  const trimRef = useRef(trim);
  trimRef.current = trim;

  // Recorded WebM has no length until it's been seeked to the end once.
  useEffect(() => {
    const v = screen.current!;
    const fix = () => {
      if (v.duration === Infinity) {
        v.currentTime = 1e9;
        v.addEventListener("seeked", () => (v.currentTime = 0), { once: true });
      }
    };
    v.addEventListener("loadedmetadata", fix, { once: true });
  }, []);

  // Draw continuously; keep the camera in step with the screen.
  useEffect(() => {
    let frame = requestAnimationFrame(function loop() {
      const s = screen.current;
      const c = cam.current;
      const ctx = canvas.current?.getContext("2d");
      if (s && ctx) {
        const [w, h] = canvasSize(lookRef.current, take);
        if (ctx.canvas.width !== w || ctx.canvas.height !== h) {
          ctx.canvas.width = w;
          ctx.canvas.height = h;
        }
        if (c && Math.abs(c.currentTime - s.currentTime) > 0.15) c.currentTime = s.currentTime;
        if (!s.paused && s.currentTime >= trimRef.current[1]) {
          s.pause();
          c?.pause();
          setPlaying(false);
        }
        paint(ctx, lookRef.current, s, c);
        setTime(s.currentTime);
      }
      frame = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(frame);
  }, [take]);

  const sound = () => {
    if (!audio.current) {
      const ctx = new AudioContext();
      const src = ctx.createMediaElementSource(screen.current!);
      const out = ctx.createMediaStreamDestination();
      src.connect(ctx.destination);
      src.connect(out);
      audio.current = { ctx, out };
    }
    void audio.current.ctx.resume();
    return audio.current;
  };

  const seek = (t: number) => {
    screen.current!.currentTime = t;
    if (cam.current) cam.current.currentTime = t;
  };

  const toggle = () => {
    const s = screen.current!;
    sound();
    if (s.paused) {
      if (s.currentTime >= trim[1] - 0.05 || s.currentTime < trim[0]) seek(trim[0]);
      void s.play();
      void cam.current?.play();
      setPlaying(true);
    } else {
      s.pause();
      cam.current?.pause();
      setPlaying(false);
    }
  };

  /** Plays the trimmed video once through the canvas and records it. */
  const exportVideo = async () => {
    const s = screen.current!;
    const c = cam.current;
    const { out } = sound();
    s.pause();
    c?.pause();
    seek(trim[0]);
    await new Promise((r) => s.addEventListener("seeked", r, { once: true }));
    const stream = new MediaStream([...canvas.current!.captureStream(30).getVideoTracks(), ...out.stream.getAudioTracks()]);
    const type = mime(VIDEO_TYPES);
    const rec = new MediaRecorder(stream, type ? { mimeType: type, videoBitsPerSecond: 10_000_000 } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    setExporting(0);
    const done = new Promise<void>((r) => (rec.onstop = () => r()));
    rec.start(1000);
    s.muted = false;
    await s.play();
    void c?.play();
    setPlaying(true);
    await new Promise<void>((r) => {
      const id = setInterval(() => {
        setExporting(Math.min(1, (s.currentTime - trim[0]) / (trim[1] - trim[0])));
        if (s.paused || s.currentTime >= trim[1]) {
          clearInterval(id);
          r();
        }
      }, 100);
    });
    s.pause();
    c?.pause();
    setPlaying(false);
    rec.stop();
    await done;
    const blob = new Blob(chunks, { type: rec.mimeType || "video/webm" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `Umi recording.${blob.type.includes("mp4") ? "mp4" : "webm"}`;
    a.click();
    setExporting(null);
  };

  const set = (patch: Partial<Look>) => setLook((l) => ({ ...l, ...patch }));
  const span = take.duration || 1;
  const busy = exporting !== null;

  return (
    <div className="min-h-[100svh] bg-[#f5f7fa]">
      <header className="flex h-14 items-center gap-4 border-b border-line bg-white px-4">
        <a href="/" className="flex items-center gap-2 font-semibold">
          <Mark className="size-5" /> Umi
        </a>
        <span className="text-[14px] text-muted">Recording · {clock(trim[1] - trim[0])}</span>
        <span className="flex-1" />
        <button type="button" onClick={onRestart} disabled={busy} className="h-9 rounded-full px-4 text-[14px] font-medium text-muted transition-colors hover:text-ink disabled:opacity-40">
          New recording
        </button>
        <button type="button" onClick={() => void exportVideo()} disabled={busy} className="btn-dark disabled:opacity-60">
          {busy ? `Exporting ${Math.round((exporting ?? 0) * 100)}%` : "Download"}
        </button>
        {account}
      </header>

      <div className="mx-auto grid max-w-[1400px] gap-4 p-4 lg:grid-cols-[1fr_320px]">
        <div>
          <div className="grid place-items-center rounded-2xl bg-white p-4 shadow-[0_0_0_1px_rgb(17_24_39/0.05)]">
            <canvas ref={canvas} className="max-h-[62svh] max-w-full rounded-lg" />
          </div>
          {/* Playback and trim */}
          <div className="mt-3 rounded-2xl bg-white p-4 shadow-[0_0_0_1px_rgb(17_24_39/0.05)]">
            <div className="flex items-center gap-3">
              <button type="button" onClick={toggle} disabled={busy} aria-label={playing ? "Pause" : "Play"} className="grid size-10 shrink-0 place-items-center rounded-full bg-ink text-white disabled:opacity-50">
                {playing ? (
                  <svg viewBox="0 0 24 24" className="size-4" fill="currentColor">
                    <path d="M7 5h3v14H7zM14 5h3v14h-3z" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" className="ml-0.5 size-4" fill="currentColor">
                    <path d="M7 4.5v15l12-7.5z" />
                  </svg>
                )}
              </button>
              <span className="w-24 shrink-0 font-mono text-[13px] text-muted tabular-nums">
                {clock(time)} / {clock(span)}
              </span>
              <Trim span={span} trim={trim} time={time} disabled={busy} onTrim={setTrim} onSeek={seek} />
            </div>
            <p className="mt-2 pl-[148px] text-[12px] text-faint">Drag the handles to cut the start and the end.</p>
          </div>
        </div>

        {/* Look */}
        <aside className="grid content-start gap-5 rounded-2xl bg-white p-5 shadow-[0_0_0_1px_rgb(17_24_39/0.05)]">
          <Field title="Background">
            <div className="grid grid-cols-6 gap-2">
              {Object.entries(GRADIENTS).map(([k, [a, b]]) => (
                <button
                  key={k}
                  type="button"
                  aria-label={k}
                  onClick={() => set({ gradient: k })}
                  className={`aspect-square rounded-lg transition-shadow ${look.gradient === k ? "shadow-[0_0_0_2px_#fff,0_0_0_4px_var(--color-accent)]" : ""}`}
                  style={{ background: `linear-gradient(135deg, ${a}, ${b})` }}
                />
              ))}
            </div>
          </Field>
          <Field title="Shape">
            <div className="grid grid-cols-4 gap-1 rounded-xl bg-[#f1f3f6] p-1">
              {ASPECTS.map(([k, label]) => (
                <button key={k} type="button" onClick={() => set({ aspect: k })} className={`h-8 rounded-lg text-[13px] font-medium transition-colors ${look.aspect === k ? "bg-white text-ink shadow-sm" : "text-muted"}`}>
                  {label}
                </button>
              ))}
            </div>
          </Field>
          <Slider label="Padding" value={look.padding} max={0.2} onChange={(v) => set({ padding: v })} />
          <Slider label="Corners" value={look.radius} max={0.06} onChange={(v) => set({ radius: v })} />
          {take.camera && (
            <Field title="Camera">
              <Option label="Show camera" on={look.camera} onToggle={() => set({ camera: !look.camera })} />
              {look.camera && (
                <>
                  <div className="mt-3 grid grid-cols-4 gap-1 rounded-xl bg-[#f1f3f6] p-1">
                    {(["tl", "tr", "bl", "br"] as Corner[]).map((c) => (
                      <button key={c} type="button" aria-label={`Camera ${c}`} onClick={() => set({ corner: c })} className={`grid h-9 place-items-center rounded-lg transition-colors ${look.corner === c ? "bg-white shadow-sm" : ""}`}>
                        <span className="relative h-4 w-6 rounded-[3px] shadow-[inset_0_0_0_1.5px_currentColor] text-faint">
                          <span className={`absolute size-1.5 rounded-full ${look.corner === c ? "bg-accent" : "bg-faint"} ${c[0] === "t" ? "top-[3px]" : "bottom-[3px]"} ${c[1] === "l" ? "left-[3px]" : "right-[3px]"}`} />
                        </span>
                      </button>
                    ))}
                  </div>
                  <div className="mt-3">
                    <Slider label="Size" value={look.camSize} min={0.12} max={0.4} onChange={(v) => set({ camSize: v })} />
                  </div>
                </>
              )}
            </Field>
          )}
          <p className="text-[12px] text-faint">Exporting plays the video once, so it takes as long as the video. Want zooms, captions and more? Get the Umi app.</p>
        </aside>
      </div>

      <video ref={screen} src={take.screen} playsInline preload="auto" className="hidden" />
      {take.camera && <video ref={cam} src={take.camera} muted playsInline preload="auto" className="hidden" />}
    </div>
  );
}

function Field({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-[13px] font-semibold">{title}</p>
      {children}
    </div>
  );
}

function Slider({ label, value, min = 0, max, onChange }: { label: string; value: number; min?: number; max: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex justify-between text-[13px]">
        <span className="font-semibold">{label}</span>
        <span className="text-muted tabular-nums">{Math.round(((value - min) / (max - min)) * 100)}%</span>
      </span>
      <input type="range" min={min} max={max} step={(max - min) / 100} value={value} onChange={(e) => onChange(Number(e.currentTarget.value))} className="w-full accent-[var(--color-accent)]" />
    </label>
  );
}

/** A bar with two handles for the cut, and the playhead. */
function Trim({ span, trim, time, disabled, onTrim, onSeek }: { span: number; trim: [number, number]; time: number; disabled: boolean; onTrim: (t: [number, number]) => void; onSeek: (t: number) => void }) {
  const bar = useRef<HTMLDivElement>(null);
  const at = (clientX: number) => {
    const r = bar.current!.getBoundingClientRect();
    return Math.min(span, Math.max(0, ((clientX - r.left) / r.width) * span));
  };
  const drag = (which: 0 | 1) => (e: React.PointerEvent) => {
    if (disabled) return;
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const t = at(ev.clientX);
      const next: [number, number] = which === 0 ? [Math.min(t, trim[1] - 0.5), trim[1]] : [trim[0], Math.max(t, trim[0] + 0.5)];
      onTrim(next);
      onSeek(next[which]);
    };
    const up = () => (removeEventListener("pointermove", move), removeEventListener("pointerup", up));
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
  };
  const pct = (t: number) => `${(t / span) * 100}%`;
  return (
    <div ref={bar} className="relative h-10 flex-1 cursor-pointer touch-none rounded-lg bg-[#eef2f7]" onPointerDown={(e) => !disabled && onSeek(at(e.clientX))}>
      <div className="absolute inset-y-0 rounded-lg bg-accent/15 shadow-[inset_0_0_0_2px_var(--color-accent)]" style={{ left: pct(trim[0]), right: `calc(100% - ${pct(trim[1])})` }} />
      {([0, 1] as const).map((k) => (
        <span key={k} onPointerDown={drag(k)} className="absolute inset-y-0 z-10 w-3 -translate-x-1/2 cursor-ew-resize rounded-md bg-accent" style={{ left: pct(trim[k]) }} />
      ))}
      <span className="pointer-events-none absolute inset-y-[-4px] w-0.5 -translate-x-1/2 rounded bg-record" style={{ left: pct(time) }} />
    </div>
  );
}
