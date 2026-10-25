"use client";

// Umi in the browser: record the screen, camera and voice with nothing to install, then edit it
// (WebEditor). Screen and camera are recorded as two separate videos, so every look choice stays
// editable afterwards.
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { type BrowserInfo, browserInfo } from "@/lib/browser";
import { Mark } from "./ui";
import { Editor, Option, type Take } from "./WebEditor";

const EASE = [0.25, 1, 0.5, 1] as const;

/** The first recording format this browser can write (MP4 where possible). */
function mime(kinds: string[]) {
  return kinds.find((k) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(k)) ?? "";
}
const VIDEO_TYPES = ["video/mp4;codecs=avc1,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export function Recorder({ account }: { account?: React.ReactNode }) {
  const [stage, setStage] = useState<"setup" | "countdown" | "recording" | "edit">("setup");
  const [supported, setSupported] = useState(true);
  const [browser, setBrowser] = useState<BrowserInfo | null>(null);
  const [soundOk, setSoundOk] = useState(false);
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
    setBrowser(browserInfo());
    // Development only: `?take=/__test__/take.mp4` opens the editor on a ready-made recording.
    const test = process.env.NODE_ENV !== "production" ? new URLSearchParams(location.search).get("take") : null;
    if (test)
      void fetch(test)
        .then((r) => r.blob())
        .then((blob) => {
          const v = document.createElement("video");
          v.src = URL.createObjectURL(blob);
          v.onloadedmetadata = () => {
            setTake({ screen: blob, camera: null, duration: v.duration, width: v.videoWidth, height: v.videoHeight, hasSound: true });
            setStage("edit");
          };
        });
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
      // Chromium: offer the computer's sound too, and keep hearing it while sharing.
      display = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: { suppressLocalAudioPlayback: false }, systemAudio: "include" } as DisplayMediaStreamOptions);
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

    // One sound source is recorded as it is; the screen's sound and the voice together are mixed
    // into one track. The mixer starts suspended unless it's told to run.
    const sources = [display, ...extra].filter((s) => s.getAudioTracks().length);
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
            new Promise<Blob>((done) => {
              r.rec.onstop = () => done(new Blob(r.chunks, { type: r.rec.mimeType || "video/webm" }));
              r.rec.stop();
            }),
        ),
      ).then(([screen, cam]) => {
        [display, camera, ...extra].forEach((s) => s?.getTracks().forEach((t) => t.stop()));
        void audio?.close();
        setTake({ screen, camera: cam ?? null, duration, width: settings.width ?? 1920, height: settings.height ?? 1080, hasSound: screenStream.getAudioTracks().length > 0 });
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
                {browser && <SoundNote browser={browser} dismissed={soundOk} onDismiss={() => setSoundOk(true)} />}
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

function CameraOff() {
  return (
    <svg viewBox="0 0 24 24" className="size-10 text-faint" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 3l18 18M10.5 6H14a2 2 0 0 1 2 2v2.5l5-3v9M16 16a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2" />
    </svg>
  );
}

/**
 * What sound this browser can record, said before recording starts. Safari and Firefox only get the
 * microphone; the visitor decides whether that's fine or switches browser.
 */
function SoundNote({ browser, dismissed, onDismiss }: { browser: BrowserInfo; dismissed: boolean; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false);
  if (browser.sound === "full")
    return <p className="mx-auto mt-5 max-w-xs text-[13px] text-muted">To include your computer’s sound, turn on “Share audio” in the next window.</p>;
  if (browser.sound === "tab")
    return <p className="mx-auto mt-5 max-w-xs text-[13px] text-muted">{browser.name} can record a tab’s sound: pick a tab and turn on “Share tab audio”. Sound from other apps isn’t included.</p>;
  if (dismissed) return null;
  return (
    <div className="mx-auto mt-6 max-w-sm rounded-2xl bg-[#fff8eb] p-4 text-left text-[14px] text-[#7a4b00] shadow-[inset_0_0_0_1px_rgb(181_120_0/0.18)]">
      <p className="font-semibold">{browser.name} records your voice, not your computer’s sound.</p>
      <p className="mt-1 text-[#8a5a0f]">Sound from videos, calls or apps won’t be in the recording. For that, we recommend Chrome, Edge, Brave or Opera.</p>
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={onDismiss} className="h-8 rounded-full bg-[#7a4b00] px-3.5 text-[13px] font-medium text-white">
          Continue in {browser.name}
        </button>
        <button
          type="button"
          onClick={() => void navigator.clipboard.writeText(location.href).then(() => setCopied(true))}
          className="h-8 rounded-full px-3.5 text-[13px] font-medium text-[#7a4b00] shadow-[inset_0_0_0_1px_rgb(122_75_0/0.3)]"
        >
          {copied ? "Link copied" : "Copy link for Chrome"}
        </button>
      </div>
    </div>
  );
}
