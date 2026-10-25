"use client";

// The web editor: the Umi look, captions, cutting filler words and pauses, automatic zoom, and a
// fast export. Everything runs in this browser; nothing is uploaded.
import { useEffect, useMemo, useRef, useState } from "react";
import { type Corner, type Look, type Word, type Zoom, ASPECTS, GRADIENTS, LOOK, canvasSize, captionLines, paint } from "@/lib/look";
import { canExportFast, exportFast, findZooms, voice16k } from "@/lib/media";
import { type Range, fillerCuts, isFiller, keptRanges, pauseCuts, skipCut, total } from "@/lib/timeline";
import type { Out as TranscribeOut } from "@/lib/transcribe.worker";
import { Mark } from "./ui";

export type Take = { screen: Blob; camera: Blob | null; duration: number; width: number; height: number; hasSound: boolean };

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

type Job = { phase: "idle" } | { phase: "loading" | "working"; progress: number } | { phase: "done" } | { phase: "error"; message: string };

export function Editor({ take, account, onRestart }: { take: Take; account?: React.ReactNode; onRestart: () => void }) {
  const [look, setLook] = useState<Look>({ ...LOOK, camera: !!take.camera });
  const [trim, setTrim] = useState<Range>([0, take.duration]);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [exporting, setExporting] = useState<number | null>(null);
  const [exportNote, setExportNote] = useState("");
  const [words, setWords] = useState<Word[] | null>(null);
  const [captionJob, setCaptionJob] = useState<Job>({ phase: "idle" });
  const [cutFillers, setCutFillers] = useState(true);
  const [cutPauses, setCutPauses] = useState(false);
  const [zooms, setZooms] = useState<Zoom[]>([]);
  const [zoomJob, setZoomJob] = useState<Job>({ phase: "idle" });

  const canvas = useRef<HTMLCanvasElement>(null);
  const screen = useRef<HTMLVideoElement>(null);
  const cam = useRef<HTMLVideoElement>(null);
  const abort = useRef<AbortController | null>(null);
  const urls = useMemo(() => ({ screen: URL.createObjectURL(take.screen), camera: take.camera ? URL.createObjectURL(take.camera) : null }), [take]);
  useEffect(() => () => (URL.revokeObjectURL(urls.screen), urls.camera && URL.revokeObjectURL(urls.camera), undefined), [urls]);

  // What's cut, what's kept, and the caption lines (without the filler words once they're cut).
  const cuts = useMemo(() => (words ? [...(cutFillers ? fillerCuts(words) : []), ...(cutPauses ? pauseCuts(words) : [])] : []), [words, cutFillers, cutPauses]);
  const kept = useMemo(() => keptRanges(trim, cuts), [trim, cuts]);
  const lines = useMemo(() => (words ? captionLines(cutFillers ? words.filter((w) => !isFiller(w)) : words) : []), [words, cutFillers]);
  const fillers = useMemo(() => (words ? fillerCuts(words).length : 0), [words]);
  const pauses = useMemo(() => (words ? pauseCuts(words).length : 0), [words]);

  // Development only: lets tests reach the recording.
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") (window as unknown as { __umiTake: Take }).__umiTake = take;
  }, [take]);

  const state = useRef({ look, kept, zooms, lines });
  state.current = { look, kept, zooms, lines };

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

  // Automatic zoom: look for where things happen, in the background.
  useEffect(() => {
    let alive = true;
    setZoomJob({ phase: "working", progress: 0 });
    findZooms(take.screen, take.duration, (p) => alive && setZoomJob({ phase: "working", progress: p }))
      .then((z) => alive && (setZooms(z), setZoomJob({ phase: "done" })))
      .catch((e) => alive && setZoomJob({ phase: "error", message: (e as Error).message }));
    return () => {
      alive = false;
    };
  }, [take]);

  // Draw continuously; keep the camera in step and jump over the cuts.
  useEffect(() => {
    let frame = requestAnimationFrame(function loop() {
      const s = screen.current;
      const c = cam.current;
      const ctx = canvas.current?.getContext("2d");
      if (s && ctx) {
        const { look, kept, zooms, lines } = state.current;
        const [w, h] = canvasSize(look, take.width, take.height);
        if (ctx.canvas.width !== w || ctx.canvas.height !== h) {
          ctx.canvas.width = w;
          ctx.canvas.height = h;
        }
        if (!s.paused) {
          const jump = skipCut(kept, s.currentTime);
          const end = kept.length ? kept[kept.length - 1][1] : 0;
          if (jump !== null) s.currentTime = jump;
          else if (s.currentTime >= end) {
            s.pause();
            c?.pause();
            setPlaying(false);
          }
        }
        if (c && Math.abs(c.currentTime - s.currentTime) > 0.15) c.currentTime = s.currentTime;
        paint(ctx, {
          look,
          screen: s.readyState >= 2 ? s : null,
          screenSize: [s.videoWidth || take.width, s.videoHeight || take.height],
          camera: c && c.readyState >= 2 ? c : null,
          cameraSize: [c?.videoWidth || 1, c?.videoHeight || 1],
          time: s.currentTime,
          zooms,
          lines,
        });
        setTime(s.currentTime);
      }
      frame = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(frame);
  }, [take]);

  const seek = (t: number) => {
    screen.current!.currentTime = t;
    if (cam.current) cam.current.currentTime = t;
  };

  const toggle = () => {
    const s = screen.current!;
    if (s.paused) {
      const end = kept.length ? kept[kept.length - 1][1] : trim[1];
      if (s.currentTime >= end - 0.05 || s.currentTime < trim[0]) seek(kept[0]?.[0] ?? trim[0]);
      void s.play();
      void cam.current?.play();
      setPlaying(true);
    } else {
      s.pause();
      cam.current?.pause();
      setPlaying(false);
    }
  };

  const transcribe = async () => {
    setCaptionJob({ phase: "working", progress: 0 });
    try {
      const audio = await voice16k(take.screen);
      if (!audio) throw new Error("This recording has no sound.");
      const worker = new Worker(new URL("../lib/transcribe.worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (e: MessageEvent<TranscribeOut>) => {
        const m = e.data;
        if (m.type === "loading" || m.type === "working") setCaptionJob({ phase: m.type, progress: m.progress });
        else if (m.type === "done") {
          setWords(m.words);
          set({ captions: true });
          setCaptionJob({ phase: "done" });
          worker.terminate();
        } else {
          setCaptionJob({ phase: "error", message: m.message });
          worker.terminate();
        }
      };
      worker.postMessage({ audio }, [audio.buffer]);
    } catch (e) {
      setCaptionJob({ phase: "error", message: (e as Error).message });
    }
  };

  /** Fast: renders frame by frame with the video hardware. Chrome and Edge write straight to disk. */
  const exportVideo = async () => {
    const s = screen.current!;
    s.pause();
    cam.current?.pause();
    setPlaying(false);
    setExportNote("");
    const name = `Umi recording ${new Date().toISOString().slice(0, 10)}.mp4`;
    if (!canExportFast()) return exportRealtime();
    let file: FileSystemWritableFileStream | undefined;
    const picker = (window as Window & { showSaveFilePicker?: (o: unknown) => Promise<FileSystemFileHandle> }).showSaveFilePicker;
    if (picker) {
      try {
        const handle = await picker({ suggestedName: name, types: [{ description: "MP4 video", accept: { "video/mp4": [".mp4"] } }] });
        file = await handle.createWritable();
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
      }
    }
    abort.current = new AbortController();
    setExporting(0);
    const started = performance.now();
    try {
      const blob = await exportFast({ screen: take.screen, camera: take.camera, look, kept, zooms, lines, file, signal: abort.current.signal, onProgress: setExporting });
      if (blob) download(blob, name);
      if (!abort.current.signal.aborted) {
        const took = (performance.now() - started) / 1000;
        setExportNote(`Exported ${clock(total(kept))} of video in ${took < 60 ? `${Math.max(1, Math.round(took))}s` : clock(took)}.`);
      }
    } catch (e) {
      setExportNote(`Export failed: ${(e as Error).message}`);
    }
    setExporting(null);
  };

  /** For browsers without WebCodecs: plays the video once through the canvas and records it. */
  const exportRealtime = async () => {
    const s = screen.current!;
    const ctx = new AudioContext();
    const src = ctx.createMediaElementSource(s);
    const out = ctx.createMediaStreamDestination();
    src.connect(ctx.destination);
    src.connect(out);
    const stream = new MediaStream([...canvas.current!.captureStream(30).getVideoTracks(), ...out.stream.getAudioTracks()]);
    const type = ["video/mp4", "video/webm"].find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
    const rec = new MediaRecorder(stream, type ? { mimeType: type, videoBitsPerSecond: 10_000_000 } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise<void>((r) => (rec.onstop = () => r()));
    seek(kept[0]?.[0] ?? trim[0]);
    await new Promise((r) => s.addEventListener("seeked", r, { once: true }));
    setExporting(0);
    rec.start(1000);
    await s.play();
    void cam.current?.play();
    setPlaying(true);
    const length = total(kept);
    await new Promise<void>((r) => {
      let played = 0;
      let last = s.currentTime;
      const id = setInterval(() => {
        played += Math.max(0, Math.min(0.5, s.currentTime - last));
        last = s.currentTime;
        setExporting(Math.min(1, played / length));
        if (s.paused) {
          clearInterval(id);
          r();
        }
      }, 100);
    });
    rec.stop();
    await done;
    void ctx.close();
    download(new Blob(chunks, { type: rec.mimeType || "video/webm" }), `Umi recording.${rec.mimeType.includes("mp4") ? "mp4" : "webm"}`);
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
        <span className="text-[14px] text-muted">Recording · {clock(total(kept))}</span>
        <span className="flex-1" />
        <button type="button" onClick={onRestart} disabled={busy} className="h-9 rounded-full px-4 text-[14px] font-medium whitespace-nowrap text-muted transition-colors hover:text-ink disabled:opacity-40">
          New recording
        </button>
        {busy ? (
          <button type="button" onClick={() => abort.current?.abort()} className="btn-dark">
            Exporting {Math.round((exporting ?? 0) * 100)}% · Cancel
          </button>
        ) : (
          <button type="button" onClick={() => void exportVideo()} className="btn-dark">
            Download
          </button>
        )}
        {account}
      </header>
      {exportNote && <p className="border-b border-line bg-[#effaf3] px-4 py-2 text-center text-[13px] text-[#1f7a3d]">{exportNote}</p>}

      <div className="mx-auto grid max-w-[1400px] gap-4 p-4 lg:grid-cols-[1fr_340px]">
        <div>
          <div className="grid place-items-center rounded-2xl bg-white p-4 shadow-[0_0_0_1px_rgb(17_24_39/0.05)]">
            <canvas ref={canvas} className="max-h-[62svh] max-w-full rounded-lg" />
          </div>
          {/* Playback, trim, cuts and zooms */}
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
              <Timeline span={span} trim={trim} cuts={cuts} zooms={look.zoom ? zooms : []} time={time} disabled={busy} onTrim={setTrim} onSeek={seek} />
            </div>
            <p className="mt-2 pl-[148px] text-[12px] text-faint">Drag the handles to cut the start and the end. Striped parts are cut; blue marks are zooms.</p>
          </div>
        </div>

        <aside className="grid content-start gap-5 rounded-2xl bg-white p-5 shadow-[0_0_0_1px_rgb(17_24_39/0.05)] lg:max-h-[calc(100svh-88px)] lg:overflow-y-auto">
          <Field title="Captions">
            {words ? (
              <div className="grid gap-2">
                <Option label="Show captions" on={look.captions} onToggle={() => set({ captions: !look.captions })} />
                <Option label={`Cut filler words${fillers ? ` (${fillers})` : ""}`} on={cutFillers} onToggle={() => setCutFillers((v) => !v)} />
                <Option label={`Shorten long pauses${pauses ? ` (${pauses})` : ""}`} on={cutPauses} onToggle={() => setCutPauses((v) => !v)} />
                <p className="text-[12px] text-faint">
                  {words.length} words · {clock(trim[1] - trim[0] - total(kept))} cut
                </p>
              </div>
            ) : captionJob.phase === "idle" || captionJob.phase === "error" ? (
              <>
                <button type="button" onClick={() => void transcribe()} disabled={!take.hasSound} className="h-10 w-full rounded-xl bg-ink text-[14px] font-medium text-white disabled:opacity-40">
                  Generate captions
                </button>
                <p className="mt-2 text-[12px] text-faint">
                  {captionJob.phase === "error" ? captionJob.message : take.hasSound ? "Runs on this computer. Also finds filler words and long pauses to cut. The first time downloads about 80 MB." : "This recording has no sound."}
                </p>
              </>
            ) : (
              <Progress label={captionJob.phase === "loading" ? "Downloading the speech model…" : "Listening…"} value={captionJob.phase === "loading" || captionJob.phase === "working" ? captionJob.progress : 1} />
            )}
          </Field>
          <Field title="Zoom">
            <Option label={`Automatic zoom${zoomJob.phase === "done" ? ` (${zooms.length})` : ""}`} on={look.zoom} onToggle={() => set({ zoom: !look.zoom })} />
            {zoomJob.phase === "working" && <Progress label="Finding where things happen…" value={zoomJob.progress} />}
            {zoomJob.phase === "done" && !zooms.length && <p className="mt-2 text-[12px] text-faint">Nothing to zoom on: no small, steady changes on screen.</p>}
            {look.zoom && zooms.length > 0 && (
              <div className="mt-3">
                <Slider label="Zoom in" value={look.zoomScale} min={1.2} max={2.4} format={(v) => `${v.toFixed(1)}×`} onChange={(v) => set({ zoomScale: v })} />
              </div>
            )}
          </Field>
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
                        <span className="relative h-4 w-6 rounded-[3px] text-faint shadow-[inset_0_0_0_1.5px_currentColor]">
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
        </aside>
      </div>

      <video ref={screen} src={urls.screen} playsInline preload="auto" className="hidden" />
      {urls.camera && <video ref={cam} src={urls.camera} muted playsInline preload="auto" className="hidden" />}
    </div>
  );
}

function download(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}

export function Option({ label, on, onToggle }: { label: string; on: boolean; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle} aria-pressed={on} className="flex w-full items-center justify-between gap-4 rounded-xl bg-white px-4 py-3 text-left text-[15px] shadow-[0_0_0_1px_rgb(17_24_39/0.07)]">
      {label}
      <span className={`relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors ${on ? "bg-accent" : "bg-black/15"}`}>
        <span className={`absolute top-[2px] size-[18px] rounded-full bg-white shadow transition-all ${on ? "left-[18px]" : "left-[2px]"}`} />
      </span>
    </button>
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

function Progress({ label, value }: { label: string; value: number }) {
  return (
    <div className="mt-2">
      <p className="flex justify-between text-[12px] text-muted">
        {label}
        <span className="tabular-nums">{Math.round(value * 100)}%</span>
      </p>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#eef2f7]">
        <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${value * 100}%` }} />
      </div>
    </div>
  );
}

function Slider({ label, value, min = 0, max, format, onChange }: { label: string; value: number; min?: number; max: number; format?: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex justify-between text-[13px]">
        <span className="font-semibold">{label}</span>
        <span className="text-muted tabular-nums">{format ? format(value) : `${Math.round(((value - min) / (max - min)) * 100)}%`}</span>
      </span>
      <input type="range" min={min} max={max} step={(max - min) / 100} value={value} onChange={(e) => onChange(Number(e.currentTarget.value))} className="w-full accent-[var(--color-accent)]" />
    </label>
  );
}

/** The trim handles, the cuts (striped), the zooms (blue marks) and the playhead. */
function Timeline({
  span,
  trim,
  cuts,
  zooms,
  time,
  disabled,
  onTrim,
  onSeek,
}: {
  span: number;
  trim: Range;
  cuts: Range[];
  zooms: Zoom[];
  time: number;
  disabled: boolean;
  onTrim: (t: Range) => void;
  onSeek: (t: number) => void;
}) {
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
      const next: Range = which === 0 ? [Math.min(t, trim[1] - 0.5), trim[1]] : [trim[0], Math.max(t, trim[0] + 0.5)];
      onTrim(next);
      onSeek(next[which]);
    };
    const up = () => (removeEventListener("pointermove", move), removeEventListener("pointerup", up));
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
  };
  const pct = (t: number) => `${(t / span) * 100}%`;
  return (
    <div className="flex-1">
      <div ref={bar} className="relative h-10 cursor-pointer touch-none rounded-lg bg-[#eef2f7]" onPointerDown={(e) => !disabled && onSeek(at(e.clientX))}>
        <div className="absolute inset-y-0 rounded-lg bg-accent/15 shadow-[inset_0_0_0_2px_var(--color-accent)]" style={{ left: pct(trim[0]), right: `calc(100% - ${pct(trim[1])})` }} />
        {cuts.map(([a, b], i) => (
          <div key={i} className="pointer-events-none absolute inset-y-[2px] bg-[repeating-linear-gradient(135deg,rgb(17_24_39/0.22)_0_3px,transparent_3px_6px)]" style={{ left: pct(a), width: pct(b - a) }} />
        ))}
        {([0, 1] as const).map((k) => (
          <span key={k} onPointerDown={drag(k)} className="absolute inset-y-0 z-10 w-3 -translate-x-1/2 cursor-ew-resize rounded-md bg-accent" style={{ left: pct(trim[k]) }} />
        ))}
        <span className="pointer-events-none absolute inset-y-[-4px] w-0.5 -translate-x-1/2 rounded bg-record" style={{ left: pct(time) }} />
      </div>
      <div className="relative mt-1.5 h-1.5">
        {zooms.map((z, i) => (
          <span key={i} className="absolute h-full rounded-full bg-accent/60" style={{ left: pct(z.start), width: pct(z.end - z.start) }} />
        ))}
      </div>
    </div>
  );
}
