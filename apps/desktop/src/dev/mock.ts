// Development only: a stand-in for the Rust side so the UI runs in a plain browser (for
// design reviews and UI tests). Frames are real renders of a fixture recording.
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import frame1 from "./frame-1.jpg";
import frame4 from "./frame-4.jpg";
import frame8 from "./frame-8.jpg";
import fixture from "./state.json";
import music from "../../src-tauri/resources/music.json";
import type { EditorState, EditSettings, Selection } from "../editor/types";

const frames: [number, string][] = [
  [1, frame1],
  [4, frame4],
  [8, frame8],
];
const images = new Map<string, HTMLImageElement>();
const loaded = Promise.all(
  frames.map(
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

let state: EditorState = {
  id: "fixture",
  name: "Product demo",
  canUndo: false,
  canRedo: false,
  selection: null,
  ...(fixture as unknown as Omit<EditorState, "id" | "name" | "canUndo" | "canRedo" | "selection">),
};
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

function frameAt(time: number, width: number, height: number): ArrayBuffer {
  const url = frames.reduce((best, f) => (Math.abs(f[0] - time) < Math.abs(best[0] - time) ? f : best))[1];
  const img = images.get(url)!;
  const canvas = new OffscreenCanvas(width, height);
  const g = canvas.getContext("2d")!;
  const aspect = img.naturalWidth / Math.max(img.naturalHeight, 1) || 16 / 10;
  const w = Math.min(width, height * aspect);
  const h = w / aspect;
  g.fillStyle = "#cfe3f8";
  g.fillRect(0, 0, width, height);
  if (img.complete) g.drawImage(img, (width - w) / 2, (height - h) / 2, w, h);
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
          { path: "/fixture/Product demo.umi", name: "Product demo", duration: 10.1, createdAt: "2026-10-24T21:33:09Z" },
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
        return frame4;
      case "cloud_status":
        return { connected: true, server: "https://umi.cam" };
      case "share_state":
      case "share_update":
        return { id: "s2Zty2QoHiLz", url: "https://umi.cam/v/s2Zty2QoHiLz", title: "Product demo", status: "ready", allowDownload: true, hasPassword: false, allowComments: true, expiresAt: null };
      case "share_insights":
        return { views: 42, watchedSeconds: 2310, averageSeconds: 55, completion: 0.62, retention: [1, 0.97, 0.95, 0.93, 0.9, 0.88, 0.86, 0.85, 0.83, 0.82, 0.8, 0.79, 0.77, 0.75, 0.74, 0.72, 0.7, 0.68, 0.65, 0.62], embeddedViews: 9, countries: [{ country: "TR", count: 30 }, { country: "DE", count: 8 }, { country: "US", count: 4 }] };
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
      default:
        console.info("mock: unhandled", cmd, p);
        return null;
    }
  },
  { shouldMockEvents: true },
);
