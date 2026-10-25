// A stand-in for the Rust side so the UI runs in a plain browser: design reviews, UI tests
// and the interactive demo on the website. Frames are Umi renders of a made-up dashboard
// recording (no personal content).
import { emit } from "@tauri-apps/api/event";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import frame1 from "./frame-1.jpg";
import frame4 from "./frame-4.jpg";
import frame8 from "./frame-8.jpg";
import screenA from "./screen-a.jpg";
import screenB from "./screen-b.jpg";
import cameraFace from "./camera.jpg";
import cameraClip from "./camera.mp4";
import { GRADIENTS } from "../editor/panels/Background";
import fixture from "./state.json";
import music from "../../src-tauri/resources/music.json";
import type { EditorState, EditSettings, Selection } from "../editor/types";

const frames: [number, string][] = [
  [1, frame1],
  [2.6, frame4],
  [6.2, frame8],
];
/** The raw screen of the sample recording (before 6 s, after the share popover opens). */
const screens: [number, string][] = [
  [0, screenA],
  [6, screenB],
];
/** What the narrator of the sample recording says. */
const SAMPLE_WORDS = (() => {
  const text = "Good morning. This is the Northwind dashboard. Revenue is up twelve percent this week. To share it, click Share report and copy the link.";
  const words = text.split(" ");
  const start = 0.3;
  const step = 9.2 / words.length;
  return words.map((w, i) => ({ id: `W${i}`, start: start + i * step, end: start + (i + 0.85) * step, text: w }));
})();

/** Where the cursor was (0…1 of the screen) — the same path the sample recording used. */
const CURSOR_KEYS: [number, number, number][] = [
  [0, 0.55, 0.62],
  [1.6, 0.34, 0.25],
  [2.6, 0.36, 0.27],
  [3.8, 0.6, 0.55],
  [5.2, 0.915, 0.11],
  [6.6, 0.9, 0.13],
  [8.5, 0.7, 0.5],
  [10, 0.68, 0.52],
];
function cursorAt(t: number): [number, number] {
  for (let i = 0; i < CURSOR_KEYS.length - 1; i++) {
    const [t0, x0, y0] = CURSOR_KEYS[i];
    const [t1, x1, y1] = CURSOR_KEYS[i + 1];
    if (t >= t0 && t <= t1) {
      let k = (t - t0) / (t1 - t0);
      k = k * k * (3 - 2 * k);
      return [x0 + (x1 - x0) * k, y0 + (y1 - y0) * k];
    }
  }
  const last = CURSOR_KEYS[CURSOR_KEYS.length - 1];
  return [last[1], last[2]];
}
const images = new Map<string, HTMLImageElement>();
const loaded = Promise.all(
  [...frames, ...screens, [0, cameraFace] as [number, string]].map(
    ([, url]) =>
      new Promise<void>((done) => {
        const img = new Image();
        img.onload = () => done();
        img.onerror = () => done();
        img.src = url;
        images.set(url, img);
      }),
  ),
);

/** The webcam: a looping stock clip (Pexels), drawn in the camera bubble. */
const webcam = Object.assign(document.createElement("video"), { src: cameraClip, muted: true, loop: true, playsInline: true, autoplay: true });
void webcam.play().catch(() => {});

let state: EditorState = {
  id: "fixture",
  name: "Product demo",
  canUndo: false,
  canRedo: false,
  selection: null,
  ...(fixture as unknown as Omit<EditorState, "id" | "name" | "canUndo" | "canRedo" | "selection">),
};
{
  state = structuredClone(state);
  // The sample recording's zooms (its clicks at 2.0 s and 5.6 s).
  state.zoomSegments = [
    { id: "Z1", start: 1.2, end: 3.6, scale: 1.8 },
    { id: "Z2", start: 4.9, end: 7.8, scale: 2 },
  ];
  state.recording.duration = 10;
  // The guided demo transcribes during the tour; screenshots start with captions.
  const touring = new URLSearchParams(location.search).has("tour");
  state.edit.captions = { ...state.edit.captions, enabled: !touring, words: touring ? [] : SAMPLE_WORDS, language: "en" };
  state.name = "Northwind walkthrough";
  state.recording.hasCamera = true;
  state.edit.camera = { ...state.edit.camera, visible: true, shape: "circle", position: [0.9, 0.82], mirrored: false };
}
let recordSettings = {
  target: null,
  fps: 60,
  resolution: "native",
  systemAudio: true,
  microphone: "",
  camera: null,
  cameraOn: true,
  cameraStyle: { visible: true, shape: "circle", size: 0.24, position: [0.14, 0.8], mirrored: true },
  countdown: true,
  flow: "studio",
  cameraOnly: false,
};
const history: EditSettings[] = [];
const future: EditSettings[] = [];
const uuid = () => crypto.randomUUID().toUpperCase();

/**
 * A small stand-in renderer: the sample screen on the edit's background with its padding,
 * corners, shadow, zooms and cursor, so changes in the demo show up at once.
 */
function frameAt(time: number, width: number, height: number): ArrayBuffer {
  const edit = state.edit;
  const canvas = new OffscreenCanvas(width, height);
  const g = canvas.getContext("2d")!;
  const screen = images.get(screens.reduce((best, s) => (time >= s[0] ? s : best), screens[0])[1])!;

  // Background.
  const b = edit.background as Record<string, { _0: unknown }>;
  if ("color" in b) {
    const c = b.color._0 as { r: number; g: number; b: number };
    g.fillStyle = `rgb(${c.r * 255},${c.g * 255},${c.b * 255})`;
  } else {
    const [from, to] = GRADIENTS[("gradient" in b ? b.gradient._0 : "sky") as keyof typeof GRADIENTS] ?? GRADIENTS.sky;
    const a = ((edit.backgroundAngle ?? 135) - 90) * (Math.PI / 180);
    const r = Math.hypot(width, height) / 2;
    const grad = g.createLinearGradient(width / 2 - Math.cos(a) * r, height / 2 - Math.sin(a) * r, width / 2 + Math.cos(a) * r, height / 2 + Math.sin(a) * r);
    grad.addColorStop(0, from);
    grad.addColorStop(1, to);
    g.fillStyle = grad;
  }
  g.fillRect(0, 0, width, height);
  if ("blurredScreen" in b) {
    g.filter = "blur(24px) brightness(0.8)";
    g.drawImage(screen, -40, -40, width + 80, height + 80);
    g.filter = "none";
  }

  // The screen, inset by the padding and kept 16:10.
  const pad = edit.padding * Math.min(width, height) * 1.6;
  let w = width - pad * 2;
  let h = w / 1.6;
  if (h > height - pad * 2) {
    h = height - pad * 2;
    w = h * 1.6;
  }
  const x = (width - w) / 2;
  const y = (height - h) / 2;
  const radius = edit.cornerRadius * Math.min(w, h) * 0.9;

  // Zoom: eased in and out over 0.6 s toward the cursor.
  const seg = state.zoomSegments.find((z) => time >= z.start && time <= z.end);
  let scale = 1;
  let [fx, fy] = cursorAt(time);
  if (seg) {
    const ease = (v: number) => 1 - Math.pow(1 - Math.min(Math.max(v, 0), 1), 3);
    const k = Math.min(ease((time - seg.start) / 0.6), ease((seg.end - time) / 0.6));
    scale = 1 + (seg.scale - 1) * k;
    if (seg.focus) [fx, fy] = seg.focus;
  }

  g.save();
  g.shadowColor = `rgba(0,0,0,${0.45 * edit.shadow})`;
  g.shadowBlur = 50 * edit.shadow;
  g.shadowOffsetY = 18 * edit.shadow;
  g.beginPath();
  g.roundRect(x, y, w, h, radius);
  g.fillStyle = "#fff";
  g.fill();
  g.restore();
  g.save();
  g.beginPath();
  g.roundRect(x, y, w, h, radius);
  g.clip();
  // Keep the zoomed view inside the screen's edges.
  const vw = w / scale;
  const vh = h / scale;
  const sx = Math.min(Math.max(fx * w - vw / 2, 0), w - vw);
  const sy = Math.min(Math.max(fy * h - vh / 2, 0), h - vh);
  g.translate(x, y);
  g.scale(scale, scale);
  g.translate(-sx, -sy);
  if (screen.complete) g.drawImage(screen, 0, 0, w, h);
  // Cursor.
  if (edit.cursor.visible) {
    const [cx, cy] = cursorAt(time);
    const size = (w / 60) * (edit.cursor.size || 1);
    g.translate(cx * w, cy * h);
    g.scale(size / 24, size / 24);
    g.fillStyle = "#000";
    g.strokeStyle = "#fff";
    g.lineWidth = 1.6;
    g.lineJoin = "round";
    const p = new Path2D("M5 3l14 7.5-6.2 1.6L10 18.5z");
    g.translate(-5, -3);
    g.stroke(p);
    g.fill(p);
  }
  g.restore();

  // Camera bubble (a stock portrait stands in for the webcam).
  const cam = edit.camera;
  const face = images.get(cameraFace);
  if (cam.visible && face?.complete) {
    const d = Math.min(width, height) * (cam.size || 0.22) * 0.85;
    const [px, py] = cam.position ?? [0.9, 0.82];
    const cx = Math.min(Math.max(px * width, d / 2 + 8), width - d / 2 - 8);
    const cy = Math.min(Math.max(py * height, d / 2 + 8), height - d / 2 - 8);
    const r = cam.shape === "circle" ? d / 2 : cam.shape === "squircle" ? d * 0.28 : d * 0.08;
    g.save();
    g.shadowColor = "rgba(0,0,0,0.35)";
    g.shadowBlur = d * 0.12;
    g.shadowOffsetY = d * 0.04;
    g.beginPath();
    g.roundRect(cx - d / 2 - 3, cy - d / 2 - 3, d + 6, d + 6, r + 3);
    g.fillStyle = "#fff";
    g.fill();
    g.restore();
    g.save();
    g.beginPath();
    g.roundRect(cx - d / 2, cy - d / 2, d, d, r);
    g.clip();
    if (cam.mirrored) {
      g.translate(cx * 2, 0);
      g.scale(-1, 1);
    }
    g.drawImage(webcam.readyState >= 2 ? webcam : face, cx - d / 2, cy - d / 2, d, d);
    g.restore();
  }

  // Captions: the current line, the spoken word bright.
  const caps = edit.captions;
  if (caps.enabled && caps.words.length) {
    const i = caps.words.findIndex((w) => time >= w.start && time <= w.end + 0.25);
    if (i >= 0) {
      const from = Math.floor(i / 6) * 6;
      const line = caps.words.slice(from, from + 6);
      const size = Math.round(height * (caps.size || 0.045));
      g.font = `600 ${size}px -apple-system, "SF Pro Text", sans-serif`;
      const gap = size * 0.3;
      const widths = line.map((w) => g.measureText(w.text).width);
      const total = widths.reduce((a, b) => a + b, 0) + gap * (line.length - 1);
      const py = height * (caps.position ?? 0.88);
      const px = (width - total) / 2;
      g.fillStyle = "rgba(0,0,0,0.72)";
      g.beginPath();
      g.roundRect(px - size * 0.6, py - size * 0.95, total + size * 1.2, size * 1.45, size * 0.35);
      g.fill();
      let x = px;
      line.forEach((w, k) => {
        g.fillStyle = caps.highlightActiveWord && from + k === i ? "#ffd60a" : "#fff";
        g.fillText(w.text, x, py);
        x += widths[k] + gap;
      });
    }
  }

  const pixels = g.getImageData(0, 0, width, height).data;
  const out = new Uint8Array(8 + pixels.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, width, true);
  view.setUint32(4, height, true);
  out.set(pixels, 8);
  return out.buffer;
}

function setEdit(edit: EditSettings, selection: Selection | null = null) {
  history.push(state.edit);
  future.length = 0;
  state = { ...state, edit, canUndo: true, canRedo: false, selection };
  return state;
}

function apply(op: Record<string, unknown>): EditorState {
  const e: EditSettings = structuredClone(state.edit);
  const time = (op.time as number) ?? 0;
  switch (op.op) {
    case "setEdit":
      return setEdit(op.edit as EditSettings);
    case "undo": {
      const prev = history.pop();
      if (prev) {
        future.push(state.edit);
        state = { ...state, edit: prev, canUndo: history.length > 0, canRedo: true, selection: null };
      }
      return state;
    }
    case "redo": {
      const next = future.pop();
      if (next) {
        history.push(state.edit);
        state = { ...state, edit: next, canUndo: true, canRedo: future.length > 0, selection: null };
      }
      return state;
    }
    case "addZoom": {
      const id = uuid();
      e.zoom.segments.push({ id, start: time, end: time + 3, scale: e.zoom.scale });
      state = { ...state, zoomSegments: [...state.zoomSegments, { id, start: time, end: time + 3, scale: e.zoom.scale }] };
      return setEdit(e, { kind: "zoom", id });
    }
    case "addMask": {
      const id = uuid();
      e.masks.push({ id, start: time, end: time + 3, rect: [[0.35, 0.35], [0.3, 0.2]], style: (op.style as "blur") ?? "blur", amount: 0.6 });
      return setEdit(e, { kind: "mask", id });
    }
    case "addText": {
      const id = uuid();
      e.texts.push({ id, start: time, end: time + 3, style: op.style as "title", text: "Your title", detail: "", position: [0.5, 0.2], animation: "fade" } as EditSettings["texts"][number]);
      return setEdit(e, { kind: "text", id });
    }
    case "addScene": {
      const id = uuid();
      e.scenes.push({ id, start: time, end: time + 3, layout: op.layout as "cameraOnly", transition: 0.4 } as EditSettings["scenes"][number]);
      return setEdit(e, { kind: "scene", id });
    }
    case "addMove": {
      const id = uuid();
      e.moves.push({ id, start: time, end: time + 3, kind: op.kind as "glide" });
      return setEdit(e, { kind: "move", id });
    }
    case "delete":
    case "deleteMany": {
      const list = (op.selections as Selection[]) ?? [op.selection as Selection];
      for (const s of list) {
        if (!("id" in s)) continue;
        e.masks = e.masks.filter((x) => x.id !== s.id);
        e.texts = e.texts.filter((x) => x.id !== s.id);
        e.scenes = e.scenes.filter((x) => x.id !== s.id);
        e.moves = e.moves.filter((x) => x.id !== s.id);
        e.zoom.segments = e.zoom.segments.filter((x) => x.id !== s.id);
      }
      return setEdit(e);
    }
    default:
      return state;
  }
}

const wallpaper = (a: string, b: string) => {
  const c = document.createElement("canvas");
  c.width = 160;
  c.height = 100;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 160, 100);
  grad.addColorStop(0, a);
  grad.addColorStop(1, b);
  g.fillStyle = grad;
  g.fillRect(0, 0, 160, 100);
  return c.toDataURL("image/jpeg");
};

mockWindows("main");
mockIPC(
  (cmd, payload) => {
    const p = (payload ?? {}) as Record<string, unknown>;
    switch (cmd) {
      case "list_recordings":
        return [
          { path: "/fixture/Product demo.umi", name: "Northwind walkthrough", duration: 10.1, createdAt: "2026-10-24T21:33:09Z" },
          { path: "/fixture/Onboarding walkthrough.umi", name: "Onboarding walkthrough", duration: 184.2, createdAt: "2026-10-23T10:12:00Z" },
          { path: "/fixture/Bug report.umi", name: "Bug report", duration: 42.7, createdAt: "2026-10-21T15:40:00Z" },
        ];
      case "recording_preview":
        return Array.from({ length: 24 }, (_, i) => frames[Math.floor(i / 8)][1]);
      case "recording_thumbnails":
      {
        const count = (p.count as number) ?? 24;
        return Array.from({ length: count }, (_, i) => frames[Math.min(2, Math.floor((i / count) * 3))][1]);
      }
      case "recording_waveform":
        return Array.from({ length: 506 }, (_, i) => Math.abs(Math.sin(i / 9) * Math.sin(i / 37)) * (i % 120 < 90 ? 1 : 0.05));
      case "open_editor":
        return state;
      case "editor_apply":
        return apply(p.op as Record<string, unknown>);
      case "editor_frame":
        return loaded.then(() => frameAt(p.time as number, p.width as number, p.height as number));
      case "editor_layout":
        return [0.08, 0.08, 0.84, 0.84];
      case "editor_audio":
        return new Float32Array(Math.round(48000 * (p.seconds as number)) * 2).buffer;
      case "presets_list":
        return { presets: [{ id: "A", name: "Product demos" }, { id: "B", name: "Tutorials" }], defaultId: "A" };
      case "music_tracks":
        return (music as unknown[]).map((t) => ({ ...(t as object), downloaded: false }));
      case "system_wallpapers":
        return [
          ["Sonoma", "#f4a35e", "#6a3fa0"],
          ["Ventura", "#ef8a3c", "#1e2f6f"],
          ["Sequoia", "#2e6f5e", "#0c2230"],
          ["Mac Blue", "#3e8bf0", "#0d2c74"],
          ["Mac Pink", "#f7a1c4", "#a03a77"],
          ["Radial Sky", "#bfe2ff", "#2a76d2"],
        ].map(([name, a, b]) => ({ name, path: `/System/Library/Desktop Pictures/${name}.heic`, thumb: wallpaper(a, b) }));
      case "export_default_path":
        return `/Users/you/Movies/Umi/Exports/${p.name}.${p.extension}`;
      case "ai_models":
        return [];
      case "image_thumbnail":
        return wallpaper("#ddd", "#999");
      case "screenshot_current":
        return frames[0][1];
      case "cloud_status":
        return { connected: true, server: "https://umi.cam" };
      case "share_state":
      case "share_update":
        return { id: "s2Zty2QoHiLz", url: "https://umi.cam/v/s2Zty2QoHiLz", title: "Product demo", status: "ready", allowDownload: true, hasPassword: false, allowComments: true, expiresAt: null };
      case "share_insights":
        return { views: 42, watchedSeconds: 2310, averageSeconds: 55, completion: 0.62, retention: [1, 0.97, 0.95, 0.93, 0.9, 0.88, 0.86, 0.85, 0.83, 0.82, 0.8, 0.79, 0.77, 0.75, 0.74, 0.72, 0.7, 0.68, 0.65, 0.62], embeddedViews: 9, countries: [{ country: "TR", count: 21 }, { country: "DE", count: 9 }, { country: "US", count: 7 }, { country: "NL", count: 5 }] };
      case "team_list":
        return [{ id: "W1", name: "Umi Team", role: "owner", members: 3, inviteCode: "k3Jd9aQpLx2mZt7RbV0c" }];
      case "team_detail":
        return {
          workspace: { id: "W1", name: "Umi Team", role: "owner", members: 3, inviteCode: "k3Jd9aQpLx2mZt7RbV0c" },
          members: [
            { id: "a", email: "you@umi.cam", role: "owner", you: true },
            { id: "b", email: "ada@umi.cam", role: "member", you: false },
            { id: "c", email: "lin@umi.cam", role: "member", you: false },
          ],
        };
      case "team_videos":
        return [
          { id: "v1", url: "https://umi.cam/v/v1", title: "Onboarding walkthrough", durationMs: 184000, thumbnailUrl: frames[0][1], owner: "ada@umi.cam", yours: false },
          { id: "v2", url: "https://umi.cam/v/v2", title: "Q4 roadmap", durationMs: 312000, thumbnailUrl: frames[1][1], owner: "you@umi.cam", yours: true },
          { id: "v3", url: "https://umi.cam/v/v3", title: "Bug repro: export", durationMs: 46000, thumbnailUrl: frames[2][1], owner: "lin@umi.cam", yours: false },
        ];
      case "team_presets":
        return [{ id: "P1", name: "Brand look", edit: {}, updatedBy: "ada@umi.cam" }];
      case "pexels_status":
        return true;
      case "pexels_search":
        return { photos: [frame1, frame4, frame8, frame1, frame4, frame8].map((f, i) => ({ id: i + 1, thumb: f, full: f, photographer: "Ada", photographerUrl: "", pageUrl: "", color: "#88a" })), hasMore: true };
      case "pexels_use":
        return `background-pexels-${p.id}.jpg`;
      case "ink_set":
        void emit("ink:mode", { drawing: p.drawing, color: p.color });
        return null;
      case "copy_text_to_clipboard":
        return null;
      case "record_settings":
        return recordSettings;
      case "record_settings_save":
        recordSettings = p.settings as typeof recordSettings;
        return null;
      case "record_sources":
        return {
          displays: [{ id: 1, name: "Main display", width: 1728, height: 1117, scale: 2, x: 0, y: 0 }],
          windows: [
            { id: 11, title: "Umi — Product demo", app: "Umi", x: 0, y: 0, width: 1440, height: 900 },
            { id: 12, title: "Inbox", app: "Mail", x: 0, y: 0, width: 1200, height: 800 },
          ],
          microphones: [
            { id: "mbp", name: "MacBook Pro Microphone", isDefault: true },
            { id: "usb", name: "USB Microphone", isDefault: false },
          ],
          cameras: [{ id: "0", name: "FaceTime HD Camera" }],
          missingPermission: null,
        };
      case "record_status":
        return { recording: true, paused: false, elapsed: (performance.now() / 1000) % 600, level: Math.abs(Math.sin(performance.now() / 300)) * 0.5 };
      case "record_meter":
      case "record_camera_preview":
      case "window_show":
      case "window_hide":
      case "window_resize":
      case "editor_save":
      case "editor_close":
      case "plugin:event|listen":
      case "plugin:event|unlisten":
        return null;
      case "editor_export":
        // Pretend to render for a moment.
        return new Promise((done) => setTimeout(() => done((p.request as { destination: string }).destination), 1800));
      case "editor_transcribe":
        state = { ...state, edit: { ...state.edit, captions: { ...state.edit.captions, enabled: true, words: SAMPLE_WORDS } } };
        return state;
      default:
        console.info("mock: unhandled", cmd, p);
        return null;
    }
  },
  { shouldMockEvents: true },
);
