// The player of a link made while recording (/editor/player.html?id=…, inside the viewer page
// on Umi Cloud). The recording is the raw screen (and camera) as it was uploaded; the look —
// zooms, background, camera bubble, captions, cuts — is drawn here with the editor's renderer,
// so nothing was rendered on the recorder's computer and later edits show up at once.
//
// The page around it talks to it with postMessage (play, pause, seek, speed) and hears its time,
// so comments at a moment, `?t=` links and view counts work like with a plain <video>. Without a
// GPU the renderer can't run: the plain recording plays instead.
import { RATE } from "./sound";
import { type Remote, Session, start } from "./engine";

const params = new URLSearchParams(location.search);
const id = params.get("id") ?? "";
// Umi Cloud's address (the site and the cloud share one in production).
const api = (params.get("api") ?? location.origin).replace(/\/+$/, "");
const file = (name: string) => `${api}/v/${id}/raw/${name}`;

const style = document.createElement("style");
style.textContent = `
html,body{margin:0;height:100%;background:#000;overflow:hidden;font:13px -apple-system,BlinkMacSystemFont,"Inter","Segoe UI",sans-serif;color:#fff;-webkit-font-smoothing:antialiased}
canvas,video.plain{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}
.bar{position:absolute;left:0;right:0;bottom:0;display:flex;align-items:center;gap:10px;padding:28px 14px 10px;background:linear-gradient(transparent,rgba(0,0,0,.55));opacity:0;transition:opacity .2s}
body:hover .bar,body.paused .bar{opacity:1}
.bar button{all:unset;cursor:pointer;display:grid;place-items:center;width:28px;height:28px;border-radius:8px}
.bar button:hover{background:rgba(255,255,255,.14)}
.bar button:focus-visible{outline:2px solid #116ff5}
.seek{flex:1;height:18px;display:flex;align-items:center;cursor:pointer;touch-action:none}
.seek i{position:relative;display:block;width:100%;height:4px;border-radius:2px;background:rgba(255,255,255,.3)}
.seek b{position:absolute;left:0;top:0;bottom:0;border-radius:2px;background:#fff}
.time{font-variant-numeric:tabular-nums;opacity:.9;white-space:nowrap}
.big{position:absolute;inset:0;display:grid;place-items:center;cursor:pointer}
.big span{display:grid;place-items:center;width:76px;height:76px;border-radius:50%;background:rgba(255,255,255,.92);color:#111;box-shadow:0 8px 30px rgba(0,0,0,.3)}
body:not(.paused) .big{display:none}
.wait{position:absolute;inset:0;display:grid;place-items:center;color:rgba(255,255,255,.7)}
`;
document.head.append(style);

const ICON = {
  play: `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.6-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>`,
  pause: `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>`,
  full: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>`,
  sound: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/></svg>`,
  mute: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="m22 9-6 6M16 9l6 6"/></svg>`,
};
const clock = (s: number) => {
  const t = Math.max(0, Math.floor(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};

/** Tells the page around the player what happened (it mirrors a <video> element). */
function tell(type: string, state: { currentTime: number; duration: number; paused: boolean; playbackRate: number }) {
  if (parent !== window) parent.postMessage({ umiPlayer: type, ...state }, "*");
}

async function main() {
  document.body.className = "paused";
  const wait = Object.assign(document.createElement("div"), { className: "wait", textContent: "Loading…" });
  document.body.append(wait);
  const [project, cursor, camera] = await Promise.all([
    fetch(file("edit.json")).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))),
    fetch(file("cursor.json")).then((r) => (r.ok ? r.json() : undefined)).catch(() => undefined),
    fetch(file("camera.mp4"), { method: "HEAD" }).then((r) => r.ok).catch(() => false),
  ]);
  // A Mac recording keeps system sound and the microphone on their own tracks: both play.
  const sound = project.edit?.sound ?? {};
  const gains: number[] = [];
  const mic = sound.microphoneVolume ?? 1;
  if (typeof project.audio?.systemTrack === "number") gains[project.audio.systemTrack] = mic > 0 ? (sound.systemVolume ?? 1) / mic : 0;
  if (typeof project.audio?.microphoneTrack === "number") gains[project.audio.microphoneTrack] = 1;
  const remote: Remote = { url: (name) => (name === "screen.mp4" || (name === "camera.mp4" && camera) ? file(name) : null), gains: gains.length ? Array.from(gains, (g) => g ?? 0) : undefined };

  let session: Session;
  try {
    await start();
    session = new Session(id, project.title ?? "Umi", project, cursor, project.duration ?? 0, new Map(), undefined, remote);
    // The images the edit names (a wallpaper behind the video, image overlays) came along as JPEGs.
    const names = [project.edit?.background?.image?._0, ...(project.edit?.overlays ?? []).filter((o: { kind?: string }) => o.kind === "image").map((o: { file: string }) => o.file)];
    await Promise.all(
      names.filter((n): n is string => typeof n === "string").map(async (name) => {
        const r = await fetch(`${api}/v/${id}/raw/asset?name=${encodeURIComponent(name)}`).catch(() => null);
        if (r?.ok) await session.addFile(name, await r.blob());
      }),
    );
    // Fails without WebGPU/WebGL: the plain recording plays below.
    await session.frame(0, 64, 64, false, false);
  } catch (e) {
    console.warn("Umi player: plain video instead", e);
    wait.remove();
    return plain();
  }
  wait.remove();
  run(session);
}

/** No renderer here (no GPU): the recording as it was made, with the browser's own controls. */
function plain() {
  const video = Object.assign(document.createElement("video"), { src: file("screen.mp4"), controls: true, playsInline: true, className: "plain" });
  document.body.className = "";
  document.body.append(video);
  const state = () => ({ currentTime: video.currentTime, duration: video.duration || 0, paused: video.paused, playbackRate: video.playbackRate });
  for (const type of ["loadedmetadata", "play", "pause", "timeupdate", "ended", "seeked", "ratechange"]) video.addEventListener(type, () => tell(type, state()));
  addEventListener("message", (e) => {
    const m = e.data;
    if (!m || typeof m.umiCommand !== "string") return;
    if (m.umiCommand === "play") void video.play();
    if (m.umiCommand === "pause") video.pause();
    if (m.umiCommand === "seek") video.currentTime = Number(m.value) || 0;
    if (m.umiCommand === "rate") video.playbackRate = Number(m.value) || 1;
    if (m.umiCommand === "mute") video.muted = !!m.value;
  });
}

function run(session: Session) {
  const canvas = document.createElement("canvas");
  const g = canvas.getContext("2d")!;
  document.body.append(canvas);
  const duration = () => session.current.outputDuration as number;

  // ── Controls ──
  const big = Object.assign(document.createElement("div"), { className: "big", innerHTML: `<span>${ICON.play.replace(/18/g, "30")}</span>` });
  const bar = Object.assign(document.createElement("div"), { className: "bar" });
  const playBtn = Object.assign(document.createElement("button"), { type: "button", innerHTML: ICON.play, ariaLabel: "Play" });
  const seek = Object.assign(document.createElement("div"), { className: "seek", innerHTML: "<i><b></b></i>" });
  const fill = seek.querySelector("b")!;
  const time = Object.assign(document.createElement("span"), { className: "time" });
  const muteBtn = Object.assign(document.createElement("button"), { type: "button", innerHTML: ICON.sound, ariaLabel: "Mute" });
  const fullBtn = Object.assign(document.createElement("button"), { type: "button", innerHTML: ICON.full, ariaLabel: "Full screen" });
  bar.append(playBtn, seek, time, muteBtn, fullBtn);
  document.body.append(big, bar);

  // ── Clock and sound: frames and sound follow one clock (sound may be held back until the
  // viewer interacts, so the clock doesn't depend on it) ──
  const audio = new AudioContext({ sampleRate: RATE });
  const gain = audio.createGain();
  gain.connect(audio.destination);
  let playing = false;
  let rate = 1;
  let at = 0; // output time when paused, or when the clock started
  let startedAt = 0; // performance.now() / 1000 at that moment
  let scheduledTo = 0; // output time sound is queued up to
  let sources: AudioBufferSourceNode[] = [];
  const seconds = () => performance.now() / 1000;
  const now = () => (playing ? Math.min(duration(), at + (seconds() - startedAt) * rate) : at);
  const state = () => ({ currentTime: now(), duration: duration(), paused: !playing, playbackRate: rate });

  const queueSound = async () => {
    // A second ahead, in half-second pieces.
    while (playing && scheduledTo < Math.min(duration(), now() + 1)) {
      const from = scheduledTo;
      scheduledTo += 0.5;
      const samples = new Float32Array(await session.audio(from, 0.5));
      if (!playing) return;
      const frames = samples.length / 2;
      const buffer = audio.createBuffer(2, frames, RATE);
      const l = buffer.getChannelData(0);
      const r = buffer.getChannelData(1);
      for (let i = 0; i < frames; i++) {
        l[i] = samples[i * 2];
        r[i] = samples[i * 2 + 1];
      }
      const src = audio.createBufferSource();
      src.buffer = buffer;
      src.playbackRate.value = rate;
      src.connect(gain);
      src.start(Math.max(audio.currentTime, audio.currentTime + (from - now()) / rate));
      sources.push(src);
      src.onended = () => (sources = sources.filter((s) => s !== src));
    }
  };
  const stopSound = () => {
    for (const s of sources) s.stop();
    sources = [];
  };

  const play = async () => {
    if (playing) return;
    if (at >= duration() - 0.05) at = 0;
    void audio.resume().catch(() => {});
    playing = true;
    startedAt = seconds();
    scheduledTo = at;
    document.body.className = "";
    playBtn.innerHTML = ICON.pause;
    tell("play", state());
    void queueSound();
  };
  const pause = () => {
    if (!playing) return;
    at = now();
    playing = false;
    stopSound();
    session.pause();
    document.body.className = "paused";
    playBtn.innerHTML = ICON.play;
    tell("pause", state());
    void draw();
  };
  const seekTo = (t: number) => {
    const wasPlaying = playing;
    if (playing) {
      playing = false;
      stopSound();
    }
    at = Math.max(0, Math.min(duration(), t));
    if (wasPlaying) {
      playing = true;
      startedAt = seconds();
      scheduledTo = at;
      void queueSound();
    }
    tell("seeked", state());
    void draw();
  };
  const setRate = (r: number) => {
    at = now();
    startedAt = seconds();
    rate = r;
    if (playing) {
      stopSound();
      scheduledTo = at;
      void queueSound();
    }
    tell("ratechange", state());
  };

  // ── Frames ──
  let drawing = false;
  const draw = async () => {
    if (drawing) return;
    drawing = true;
    try {
      const k = Math.min(devicePixelRatio || 1, 2);
      const w = Math.max(16, Math.round(innerWidth * k));
      const h = Math.max(16, Math.round(innerHeight * k));
      // At most 1080p tall: smooth on modest machines.
      const s = Math.min(1, 1080 / h);
      const bitmap = await session.frame(now(), Math.round(w * s), Math.round(h * s), false, playing);
      if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) Object.assign(canvas, { width: bitmap.width, height: bitmap.height });
      g.drawImage(bitmap, 0, 0);
      bitmap.close();
    } finally {
      drawing = false;
    }
  };
  let lastTold = 0;
  const tick = () => {
    requestAnimationFrame(tick);
    const t = now();
    fill.style.width = `${(t / Math.max(duration(), 0.001)) * 100}%`;
    time.textContent = `${clock(t)} / ${clock(duration())}`;
    if (!playing) return;
    if (t >= duration()) {
      pause();
      at = duration();
      tell("ended", state());
      return;
    }
    void queueSound();
    void draw();
    if (performance.now() - lastTold > 250) {
      lastTold = performance.now();
      tell("timeupdate", state());
    }
  };
  requestAnimationFrame(tick);

  // ── Input ──
  const toggle = () => (playing ? pause() : void play());
  playBtn.onclick = toggle;
  big.onclick = toggle;
  canvas.onclick = toggle;
  const mute = (muted: boolean) => {
    gain.gain.value = muted ? 0 : 1;
    muteBtn.innerHTML = muted ? ICON.mute : ICON.sound;
  };
  muteBtn.onclick = () => mute(gain.gain.value > 0);
  fullBtn.onclick = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {});
  const seekAt = (e: PointerEvent) => {
    const r = seek.getBoundingClientRect();
    seekTo(((e.clientX - r.left) / r.width) * duration());
  };
  seek.onpointerdown = (e) => {
    seek.setPointerCapture(e.pointerId);
    seekAt(e);
    seek.onpointermove = seekAt;
  };
  seek.onpointerup = () => (seek.onpointermove = null);
  addEventListener("keydown", (e) => {
    if (e.key === " " || e.key === "k") (e.preventDefault(), toggle());
    if (e.key === "ArrowRight") seekTo(now() + 5);
    if (e.key === "ArrowLeft") seekTo(now() - 5);
  });
  addEventListener("resize", () => void draw());
  addEventListener("message", (e) => {
    const m = e.data;
    if (!m || typeof m.umiCommand !== "string") return;
    if (m.umiCommand === "play") void play();
    if (m.umiCommand === "pause") pause();
    if (m.umiCommand === "seek") seekTo(Number(m.value) || 0);
    if (m.umiCommand === "rate") setRate(Number(m.value) || 1);
    if (m.umiCommand === "mute") mute(!!m.value);
  });

  const t0 = Number(params.get("t"));
  if (t0 > 0) at = Math.min(duration(), t0);
  tell("loadedmetadata", state());
  void draw();
  // The first frame may be drawn before the recording has loaded (a file whose index is at its
  // end takes a moment): draw it again a few times while nobody has pressed play.
  for (const ms of [800, 2000, 4500]) setTimeout(() => !playing && void draw(), ms);
}

void main().catch((e) => {
  console.warn("Umi player:", e);
  document.querySelector(".wait")?.remove();
  plain();
});
