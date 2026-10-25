"use client";

// Umi in the browser, recorded the way Loom does it on the web: camera and microphone are allowed
// once, your camera bubble and the recorder card appear on the page, Start asks what to share,
// a countdown runs, and a control bar stays on the left while recording. Screen and camera are
// recorded as two videos, so the editor (the Mac app's, at /editor) can still move and restyle
// the camera.
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { type BrowserInfo, browserInfo } from "@/lib/browser";
import type { CameraShape, Corner, Take } from "@/lib/library";
import { Mark, copyText } from "./ui";

const EASE = [0.25, 1, 0.5, 1] as const;

/** The first recording format this browser can write (MP4 where possible). */
function mime(kinds: string[]) {
  return kinds.find((k) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(k)) ?? "";
}
const VIDEO_TYPES = ["video/mp4;codecs=avc1,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

type Surface = "monitor" | "window" | "browser";
const SURFACES: [Surface, string][] = [
  ["monitor", "Full screen"],
  ["window", "Window"],
  ["browser", "Tab"],
];
const SIZES = { S: 150, M: 210, L: 300 } as const;
const SHAPES: CameraShape[] = ["circle", "rounded", "square"];
type Size = keyof typeof SIZES;
type Place = { x: number; y: number; size: Size; shape: CameraShape; mirror: boolean };

type Session = {
  pause: () => void;
  resume: () => void;
  stop: () => void;
  restart: () => void;
  discard: () => void;
  /** Camera off/on in the video from now (the camera keeps recording). */
  camera: (visible: boolean) => void;
};

/** `onTake` gets the finished recording (the page saves it and opens the editor). */
export function Recorder({ account, onTake, onCancel }: { account?: React.ReactNode; onTake: (take: Take) => void; onCancel?: () => void }) {
  const [stage, setStage] = useState<"setup" | "countdown" | "recording" | "edit">("setup");
  const [supported, setSupported] = useState(true);
  const [browser, setBrowser] = useState<BrowserInfo | null>(null);
  const [soundOk, setSoundOk] = useState(false);
  const [surface, setSurface] = useState<Surface>("monitor");
  const [devices, setDevices] = useState<{ cams: MediaDeviceInfo[]; mics: MediaDeviceInfo[] }>({ cams: [], mics: [] });
  const [camId, setCamId] = useState<string | null>(null);
  const [micId, setMicId] = useState<string | null>(null);
  const [camOn, setCamOn] = useState(true);
  const [micOn, setMicOn] = useState(true);
  const [blocked, setBlocked] = useState("");
  const [camera, setCamera] = useState<MediaStream | null>(null);
  const [mic, setMic] = useState<MediaStream | null>(null);
  const [bubble, setBubble] = useState<Place>({ x: 24, y: -1, size: "M", shape: "circle", mirror: true });
  const [count, setCount] = useState(3);
  const [elapsed, setElapsed] = useState(0);
  const [paused, setPaused] = useState(false);
  /** The camera is shown (it can be turned off and on while recording). */
  const [camShown, setCamShown] = useState(true);
  const session = useRef<Session | null>(null);
  const skipCountdown = useRef<() => void>(() => {});

  useEffect(() => {
    setSupported(!!navigator.mediaDevices?.getDisplayMedia && typeof MediaRecorder !== "undefined");
    setBrowser(browserInfo());
  }, []);

  // Camera and microphone: asked for up front, like Loom, then kept live for the bubble and the meter.
  const live = stage === "setup";
  useEffect(() => {
    if (!live) return;
    let gone = false;
    const streams: MediaStream[] = [];
    void (async () => {
      try {
        if (camOn) {
          const s = await navigator.mediaDevices.getUserMedia({ video: { deviceId: camId ? { exact: camId } : undefined, width: 1280, height: 720 } });
          if (gone) return s.getTracks().forEach((t) => t.stop());
          streams.push(s);
          setCamera(s);
        } else setCamera(null);
        if (micOn) {
          const s = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: micId ? { exact: micId } : undefined, echoCancellation: true, noiseSuppression: true } });
          if (gone) return s.getTracks().forEach((t) => t.stop());
          streams.push(s);
          setMic(s);
        } else setMic(null);
        setBlocked("");
        const all = await navigator.mediaDevices.enumerateDevices();
        setDevices({ cams: all.filter((d) => d.kind === "videoinput"), mics: all.filter((d) => d.kind === "audioinput") });
      } catch {
        setBlocked("Umi can’t use your camera or microphone. Allow them from the icon in the address bar.");
      }
    })();
    return () => {
      gone = true;
      // While recording, the session owns the streams and stops them when it ends.
      if (!session.current) streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    };
  }, [live, camOn, micOn, camId, micId]);

  const start = useCallback(async () => {
    let display: MediaStream;
    try {
      display = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: surface, frameRate: 30 },
        // Chromium: offer the computer's sound too, and keep hearing it while sharing.
        audio: { suppressLocalAudioPlayback: false },
        systemAudio: "include",
        surfaceSwitching: "include",
        monitorTypeSurfaces: "include",
      } as DisplayMediaStreamOptions);
    } catch {
      return; // The visitor closed the picker.
    }

    const label = display.getVideoTracks()[0]?.label.trim() ?? "";

    // One sound source is recorded as it is; the screen's sound and the voice together are mixed
    // into one track. The mixer starts suspended unless it's told to run.
    const sources = [display, ...(mic ? [mic] : [])].filter((s) => s.getAudioTracks().length);
    let audio: AudioContext | null = null;
    let sound: MediaStreamTrack[] = sources.length === 1 ? sources[0].getAudioTracks() : [];
    if (sources.length > 1) {
      audio = new AudioContext();
      await audio.resume();
      const out = audio.createMediaStreamDestination();
      for (const s of sources) audio.createMediaStreamSource(s).connect(out);
      sound = out.stream.getAudioTracks();
    }
    const screenStream = new MediaStream([...display.getVideoTracks(), ...sound]);
    const settings = display.getVideoTracks()[0].getSettings();
    const cam = camOn ? camera : null;
    const owned = [display, camera, mic];
    // From here the session owns the camera and microphone streams.
    session.current = { pause() {}, resume() {}, stop() {}, restart() {}, discard() {}, camera() {} };

    // 3, 2, 1 on the page; Skip starts at once.
    setStage("countdown");
    await new Promise<void>((done) => {
      let n = 3;
      setCount(n);
      const id = setInterval(() => {
        n--;
        if (n <= 0) {
          clearInterval(id);
          done();
        } else setCount(n);
      }, 900);
      skipCountdown.current = () => {
        clearInterval(id);
        done();
      };
    });

    const type = mime(VIDEO_TYPES);
    let recorders: { rec: MediaRecorder; chunks: Blob[] }[] = [];
    let active = 0; // seconds recorded before the current stretch
    let since = 0; // when the current stretch started (0 while paused)
    const now = () => active + (since ? (performance.now() - since) / 1000 : 0);
    // Where the camera was turned off: the editor hides it there.
    let cameraOff: [number, number][] = [];
    let offSince: number | null = null;
    const begin = () => {
      recorders = [screenStream, cam].filter(Boolean).map((s) => {
        const rec = new MediaRecorder(s!, type ? { mimeType: type, videoBitsPerSecond: s === cam ? 2_500_000 : 8_000_000 } : undefined);
        const chunks: Blob[] = [];
        rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
        return { rec, chunks };
      });
      recorders.forEach((r) => r.rec.start(1000));
      active = 0;
      since = performance.now();
      cameraOff = [];
      offSince = null;
      setCamShown(true);
      setPaused(false);
      setElapsed(0);
    };
    begin();
    setStage("recording");
    const tick = setInterval(() => setElapsed(active + (since ? (performance.now() - since) / 1000 : 0)), 250);

    let ended = false;
    const end = async (keep: boolean) => {
      if (ended) return;
      ended = true;
      clearInterval(tick);
      const duration = now();
      if (offSince !== null) cameraOff.push([offSince, duration]);
      const blobs = await Promise.all(
        recorders.map(
          (r) =>
            new Promise<Blob>((done) => {
              const finish = () => done(new Blob(r.chunks, { type: r.rec.mimeType || "video/webm" }));
              if (r.rec.state === "inactive") return finish();
              r.rec.onstop = finish;
              r.rec.stop();
            }),
        ),
      );
      owned.forEach((s) => s?.getTracks().forEach((t) => t.stop()));
      void audio?.close();
      session.current = null;
      setCamera(null);
      setMic(null);
      if (!keep) return setStage("setup");
      const [screen, camBlob] = blobs;
      // The editor puts the camera in the corner where the bubble was.
      const b = bubbleRef.current;
      const d = SIZES[b.size];
      const top = b.y >= 0 && b.y + d / 2 < innerHeight / 2;
      const left = b.x + d / 2 < innerWidth / 2;
      onTake({
        screen,
        camera: camBlob ?? null,
        duration,
        width: settings.width ?? 1920,
        height: settings.height ?? 1080,
        corner: `${top ? "t" : "b"}${left ? "l" : "r"}` as Corner,
        camSize: b.size === "S" ? 0.18 : b.size === "M" ? 0.24 : 0.32,
        camShape: b.shape,
        mirror: b.mirror,
        cameraOff,
        // Some browsers name the shared window here (others only "screen:0:0" and the like).
        windowTitle: /^(screen|window|tab|display|web-contents|monitor)\b|:\d/i.test(label) ? undefined : label || undefined,
      });
      setStage("edit");
    };

    session.current = {
      pause: () => {
        recorders.forEach((r) => r.rec.state === "recording" && r.rec.pause());
        active += (performance.now() - since) / 1000;
        since = 0;
        setPaused(true);
      },
      resume: () => {
        recorders.forEach((r) => r.rec.state === "paused" && r.rec.resume());
        since = performance.now();
        setPaused(false);
      },
      stop: () => void end(true),
      restart: () => {
        recorders.forEach((r) => r.rec.state !== "inactive" && r.rec.stop());
        begin();
      },
      discard: () => void end(false),
      camera: (visible) => {
        if (!visible && offSince === null) offSince = now();
        if (visible && offSince !== null) {
          cameraOff.push([offSince, now()]);
          offSince = null;
        }
        setCamShown(visible);
      },
    };
    // The browser's own "Stop sharing" button ends it too.
    display.getVideoTracks()[0].addEventListener("ended", () => void end(true));
  }, [surface, mic, camera, camOn]);

  const bubbleRef = useRef(bubble);
  bubbleRef.current = bubble;


  return (
    <div className="relative min-h-[100svh] overflow-hidden bg-[radial-gradient(120%_80%_at_50%_0%,#dcebfc_0%,#fff_60%)]">
      <header className="flex h-16 items-center justify-between px-5">
        <div className="flex items-center gap-4">
          <a href="/" className="flex items-center gap-2 text-[17px] font-semibold">
            <Mark className="size-6" /> Umi
          </a>
          {onCancel && stage === "setup" && (
            <button type="button" onClick={onCancel} className="text-[14px] text-muted hover:text-ink">
              ← Your recordings
            </button>
          )}
        </div>
        {account}
      </header>

      {/* Behind the card: a quiet welcome. */}
      <div className="grid min-h-[calc(100svh-64px)] place-items-center px-6 pb-24 lg:pr-[400px]">
        <div className="max-w-md text-center">
          <h1 className="h-display text-[clamp(32px,5vw,48px)]">{stage === "recording" ? (paused ? "Paused." : "Recording.") : "Record in your browser."}</h1>
          <p className="lead mt-3">{stage === "recording" ? "Go to what you want to show. Come back here to stop, or use the bar on the left." : "Nothing to install. Your video stays on this computer until you download it."}</p>
          {!supported && <p className="mt-8 rounded-2xl bg-[#fff4e5] px-5 py-4 text-[15px] text-[#8a5300]">Screen recording needs a computer. Open this page in Chrome, Edge, Firefox or Safari on a Mac or PC.</p>}
        </div>
      </div>

      <AnimatePresence>
        {stage === "setup" && supported && (
          <motion.aside
            key="card"
            className="fixed top-20 right-5 z-30 w-[340px] max-w-[calc(100vw-40px)] rounded-[24px] bg-white p-4 shadow-[0_0_0_1px_rgb(17_24_39/0.06),0_30px_70px_-20px_rgb(20_40_90/0.35)]"
            initial={{ opacity: 0, y: -10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.98 }}
            transition={{ duration: 0.35, ease: EASE }}
          >
            <p className="flex items-center gap-2 px-1 pb-3 text-[16px] font-semibold">
              <Mark className="size-5" /> Umi
            </p>
            <div className="grid grid-cols-3 gap-1 rounded-xl bg-[#f1f3f6] p-1">
              {SURFACES.map(([k, label]) => (
                <button key={k} type="button" onClick={() => setSurface(k)} className={`h-9 rounded-lg text-[13px] font-medium transition-colors ${surface === k ? "bg-white text-ink shadow-sm" : "text-muted hover:text-ink"}`}>
                  {label}
                </button>
              ))}
            </div>
            <div className="mt-2 grid gap-2">
              <DeviceRow kind="camera" on={camOn} onToggle={() => setCamOn((v) => !v)} devices={devices.cams} value={camId ?? camera?.getVideoTracks()[0]?.getSettings().deviceId ?? ""} onPick={setCamId} />
              <DeviceRow kind="mic" on={micOn} onToggle={() => setMicOn((v) => !v)} devices={devices.mics} value={micId ?? mic?.getAudioTracks()[0]?.getSettings().deviceId ?? ""} onPick={setMicId} stream={mic} />
            </div>
            {blocked && <p className="mt-3 rounded-xl bg-[#fef3f2] px-3 py-2 text-[13px] text-[#b42318]">{blocked}</p>}
            {browser && <SoundNote browser={browser} dismissed={soundOk} onDismiss={() => setSoundOk(true)} />}
            <button type="button" onClick={() => void start()} className="mt-4 flex h-12 w-full items-center justify-center gap-2.5 rounded-xl bg-ink text-[15px] font-semibold text-white transition-transform active:scale-[0.99]">
              <span className="size-2.5 rounded-full bg-record" />
              Start recording
            </button>
            <p className="mt-2.5 text-center text-[12px] text-faint">You’ll pick the {SURFACES.find(([k]) => k === surface)![1].toLowerCase()} next · No time limit</p>
          </motion.aside>
        )}
      </AnimatePresence>

      {camera && camOn && camShown && stage !== "edit" && <Bubble stream={camera} place={bubble} onPlace={setBubble} />}

      <AnimatePresence>
        {stage === "countdown" && (
          <motion.div key="count" className="fixed inset-0 z-40 grid place-items-center bg-ink/40 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <button type="button" onClick={() => skipCountdown.current()} className="grid size-52 place-items-center rounded-full bg-accent text-white shadow-[0_0_0_14px_rgb(17_111_245/0.18),0_30px_80px_-20px_rgb(17_111_245/0.7)]">
              <span className="grid justify-items-center">
                <motion.span key={count} className="text-[104px] leading-none font-semibold tabular-nums" initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.35, ease: EASE }}>
                  {count}
                </motion.span>
                <span className="mt-2 text-[15px] font-semibold">Skip</span>
              </span>
            </button>
          </motion.div>
        )}
        {stage === "recording" && <Controls key="controls" elapsed={elapsed} paused={paused} session={session} hasCamera={!!camera && camOn} camShown={camShown} />}
      </AnimatePresence>
    </div>
  );
}

/** The camera on the page: drag it anywhere; hover for size, shape, mirror and off. */
function Bubble({ stream, place, onPlace }: { stream: MediaStream; place: Place; onPlace: (p: Place) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [hover, setHover] = useState(false);
  const [view, setView] = useState({ w: 1200, h: 800 });
  useEffect(() => {
    const fit = () => setView({ w: innerWidth, h: innerHeight });
    fit();
    addEventListener("resize", fit);
    return () => removeEventListener("resize", fit);
  }, []);
  useEffect(() => {
    if (video.current) video.current.srcObject = stream;
  }, [stream]);
  const d = SIZES[place.size];
  // Bottom-left to start with, and always fully on screen.
  const x = Math.min(Math.max(8, place.x), view.w - d - 8);
  const y = place.y < 0 ? view.h - d - 24 : Math.min(Math.max(8, place.y), view.h - d - 8);
  const drag = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    const ox = e.clientX - x;
    const oy = e.clientY - y;
    const move = (ev: PointerEvent) => onPlace({ ...place, x: ev.clientX - ox, y: ev.clientY - oy });
    const up = () => (removeEventListener("pointermove", move), removeEventListener("pointerup", up));
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
  };
  return (
    <motion.div
      className="fixed z-50 cursor-grab touch-none overflow-hidden bg-[#1a1d29] shadow-[0_0_0_3px_#fff] select-none active:cursor-grabbing"
      style={{ left: x, top: y, width: d, height: d, borderRadius: place.shape === "circle" ? "50%" : place.shape === "rounded" ? "28%" : "8%", transition: "width .3s, height .3s, border-radius .3s" }}
      initial={{ opacity: 0, scale: 0.7 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4, ease: EASE }}
      onPointerDown={drag}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
    >
      <video ref={video} autoPlay muted playsInline className={`pointer-events-none size-full object-cover ${place.mirror ? "-scale-x-100" : ""}`} />
      {hover && (
        // Size (three dots), shape (one button that cycles) and mirror, across the middle.
        <div className="absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-0.5 rounded-full bg-[rgb(14_17_30/0.72)] p-1 backdrop-blur-md">
          {(Object.keys(SIZES) as Size[]).map((s, i) => (
            <PillButton key={s} label={["Small", "Medium", "Large"][i]} on={place.size === s} onClick={() => onPlace({ ...place, size: s })}>
              <span className="rounded-full bg-current" style={{ width: 4 + i * 3, height: 4 + i * 3 }} />
            </PillButton>
          ))}
          <span className="mx-0.5 h-3.5 w-px bg-white/20" />
          <PillButton label="Shape" on={false} onClick={() => onPlace({ ...place, shape: SHAPES[(SHAPES.indexOf(place.shape) + 1) % SHAPES.length] })}>
            <span className={`size-2.5 border-[1.5px] border-current ${place.shape === "circle" ? "rounded-full" : place.shape === "rounded" ? "rounded-[35%]" : "rounded-[2px]"}`} />
          </PillButton>
          <PillButton label="Mirror" on={place.mirror} onClick={() => onPlace({ ...place, mirror: !place.mirror })}>
            <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3v18M8 7 3 12l5 5zM16 7l5 5-5 5z" />
            </svg>
          </PillButton>
        </div>
      )}
    </motion.div>
  );
}

function PillButton({ label, on, onClick, children }: { label: string; on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`grid h-[22px] min-w-[22px] place-items-center rounded-full px-[3px] text-[11px] font-semibold ${on ? "bg-white/[0.18] text-white" : "text-white/75 hover:text-white"}`}
    >
      {children}
    </button>
  );
}

/** The bar on the left while recording: stop, time, pause, start over, delete. */
function Controls({ elapsed, paused, session, hasCamera, camShown }: { elapsed: number; paused: boolean; session: React.RefObject<Session | null>; hasCamera: boolean; camShown: boolean }) {
  const [confirm, setConfirm] = useState<"restart" | "discard" | null>(null);
  return (
    <motion.div
      className="fixed top-1/2 left-4 z-50 flex -translate-y-1/2 flex-col items-center gap-1 rounded-[20px] bg-ink/90 p-2 text-white shadow-[0_20px_50px_-12px_rgb(0_0_0/0.5)] backdrop-blur"
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.35, ease: EASE }}
    >
      <BarButton label="Stop and edit" onClick={() => session.current?.stop()}>
        <span className="size-4 rounded-[4px] bg-record" />
      </BarButton>
      <span className={`py-1 text-[13px] font-semibold tabular-nums ${paused ? "text-white/50" : ""}`}>{clock(elapsed)}</span>
      <BarButton label={paused ? "Resume" : "Pause"} onClick={() => (paused ? session.current?.resume() : session.current?.pause())}>
        {paused ? (
          <svg viewBox="0 0 24 24" className="size-5" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" className="size-5" fill="currentColor">
            <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" />
          </svg>
        )}
      </BarButton>
      {hasCamera && (
        <BarButton label={camShown ? "Turn the camera off" : "Turn the camera on"} onClick={() => session.current?.camera(!camShown)}>
          {camShown ? (
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 10l5-3v10l-5-3z" />
              <rect x="3" y="6" width="12" height="12" rx="2" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 10l5-3v10l-5-3zM3 3l18 18M7 6h6a2 2 0 0 1 2 2v6M15 18H5a2 2 0 0 1-2-2V8a2 2 0 0 1 1-1.7" />
            </svg>
          )}
        </BarButton>
      )}
      <BarButton label="Start over" onClick={() => setConfirm("restart")}>
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4" />
        </svg>
      </BarButton>
      <BarButton label="Delete" onClick={() => setConfirm("discard")}>
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
        </svg>
      </BarButton>
      <AnimatePresence>
        {confirm && (
          <motion.div className="absolute top-1/2 left-[calc(100%+10px)] w-52 -translate-y-1/2 rounded-2xl bg-white p-3 text-ink shadow-[0_20px_50px_-12px_rgb(0_0_0/0.4)]" initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -6 }}>
            <p className="text-[14px] font-semibold">{confirm === "restart" ? "Start over?" : "Delete this recording?"}</p>
            <p className="mt-0.5 text-[12px] text-muted">What you’ve recorded so far is thrown away.</p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  if (confirm === "restart") session.current?.restart();
                  else session.current?.discard();
                  setConfirm(null);
                }}
                className="h-8 flex-1 rounded-lg bg-[#d92d20] text-[13px] font-medium text-white"
              >
                {confirm === "restart" ? "Start over" : "Delete"}
              </button>
              <button type="button" onClick={() => setConfirm(null)} className="h-8 flex-1 rounded-lg bg-[#f1f3f6] text-[13px] font-medium">
                Keep
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function BarButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="grid size-11 place-items-center rounded-xl text-white/85 transition-colors hover:bg-white/10 hover:text-white">
      {children}
    </button>
  );
}

/** A camera or microphone: on/off, which device, and for the mic a live level. */
function DeviceRow({
  kind,
  on,
  onToggle,
  devices,
  value,
  onPick,
  stream,
}: {
  kind: "camera" | "mic";
  on: boolean;
  onToggle: () => void;
  devices: MediaDeviceInfo[];
  value: string;
  onPick: (id: string) => void;
  stream?: MediaStream | null;
}) {
  const label = kind === "camera" ? "Camera" : "Microphone";
  const level = useLevel(on ? stream : null);
  return (
    <div className="flex h-12 min-w-0 items-center gap-2.5 rounded-xl bg-[#f6f7f9] px-3">
      <span className="grid size-6 shrink-0 place-items-center text-muted">
        {kind === "camera" ? (
          <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="6" width="13" height="12" rx="2.5" />
            <path d="m16 10 5-3v10l-5-3" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
          </svg>
        )}
      </span>
      {on && devices.some((d) => d.label) ? (
        // A select is as wide as its longest option unless its box says otherwise.
        <span className="relative min-w-0 flex-1">
          <select value={value} onChange={(e) => onPick(e.currentTarget.value)} className="w-full min-w-0 cursor-pointer appearance-none truncate bg-transparent pr-5 text-[14px] font-medium outline-none" aria-label={label}>
            {devices.map((d, i) => (
              <option key={d.deviceId} value={d.deviceId}>
                {(d.label || `${label} ${i + 1}`).replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)$/i, "")}
              </option>
            ))}
          </select>
          <svg viewBox="0 0 24 24" className="pointer-events-none absolute top-1/2 right-0 size-3.5 -translate-y-1/2 text-muted" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      ) : (
        <span className="flex-1 text-[14px] font-medium text-muted">{on ? label : `No ${label.toLowerCase()}`}</span>
      )}
      {kind === "mic" && on && (
        <span className="flex h-3.5 items-end gap-[2px]" aria-hidden>
          {[0, 1, 2, 3, 4].map((i) => (
            <i key={i} className={`w-[3px] rounded-full transition-colors ${level > (i + 0.5) / 5 ? "bg-[#30d158]" : "bg-black/15"}`} style={{ height: `${40 + i * 15}%` }} />
          ))}
        </span>
      )}
      <button type="button" onClick={onToggle} aria-pressed={on} aria-label={`${label} ${on ? "on" : "off"}`} className={`relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors ${on ? "bg-accent" : "bg-black/15"}`}>
        <span className={`absolute top-[2px] size-[18px] rounded-full bg-white shadow transition-all ${on ? "left-[18px]" : "left-[2px]"}`} />
      </button>
    </div>
  );
}

/** The microphone's loudness, 0–1. */
function useLevel(stream: MediaStream | null | undefined) {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (!stream?.getAudioTracks().length) return;
    const ctx = new AudioContext();
    const an = ctx.createAnalyser();
    an.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(an);
    const data = new Float32Array(an.fftSize);
    let frame = requestAnimationFrame(function loop() {
      an.getFloatTimeDomainData(data);
      let peak = 0;
      for (const v of data) peak = Math.max(peak, Math.abs(v));
      setLevel(Math.min(1, peak * 3));
      frame = requestAnimationFrame(loop);
    });
    return () => {
      cancelAnimationFrame(frame);
      void ctx.close();
    };
  }, [stream]);
  return level;
}

/**
 * What sound this browser can record, said before recording starts. Safari and Firefox only get the
 * microphone; the visitor decides whether that's fine or switches browser.
 */
function SoundNote({ browser, dismissed, onDismiss }: { browser: BrowserInfo; dismissed: boolean; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false);
  if (browser.sound === "full") return <p className="mt-3 px-1 text-[12px] text-muted">In the next window, click your screen’s preview, then Share. For your computer’s sound, keep “Share audio” on.</p>;
  if (browser.sound === "tab") return <p className="mt-3 px-1 text-[12px] text-muted">{browser.name} records a tab’s sound: pick a tab and turn on “Share tab audio”.</p>;
  if (dismissed) return null;
  return (
    <div className="mt-3 rounded-xl bg-[#fff8eb] p-3 text-[13px] text-[#7a4b00] shadow-[inset_0_0_0_1px_rgb(181_120_0/0.18)]">
      <p className="font-semibold">{browser.name} records your voice, not your computer’s sound.</p>
      <p className="mt-1 text-[#8a5a0f]">For sound from videos, calls or apps, we recommend Chrome, Edge, Brave or Opera.</p>
      <div className="mt-2.5 flex gap-2">
        <button type="button" onClick={onDismiss} className="h-7 rounded-full bg-[#7a4b00] px-3 text-[12px] font-medium text-white">
          Continue in {browser.name}
        </button>
        <button type="button" onClick={() => void copyText(location.href).then(() => setCopied(true))} className="h-7 rounded-full px-3 text-[12px] font-medium text-[#7a4b00] shadow-[inset_0_0_0_1px_rgb(122_75_0/0.3)]">
          {copied ? "Link copied" : "Copy link"}
        </button>
      </div>
    </div>
  );
}
