import { Channel, invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";

export type Target =
  | { kind: "display"; id: number }
  | { kind: "window"; id: number }
  | { kind: "area"; display: number; x: number; y: number; width: number; height: number };

export interface CameraStyle {
  visible: boolean;
  shape: "circle" | "squircle" | "square";
  size: number;
  position: [number, number];
  mirrored: boolean;
}

export interface RecordSettings {
  target: Target | null;
  fps: number;
  resolution: "native" | "1080p" | "720p";
  systemAudio: boolean;
  microphone: string | null;
  camera: string | null;
  cameraOn: boolean;
  cameraStyle: CameraStyle;
  countdown: boolean;
  flow: "studio" | "instant";
  cameraOnly: boolean;
  notes: string;
  notesOn: boolean;
  notesSpeed: number;
  notesSize: number;
}

export interface Display {
  id: number;
  name: string;
  width: number;
  height: number;
  scale: number;
  x: number;
  y: number;
}
export interface Window {
  id: number;
  title: string;
  app: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface Sources {
  displays: Display[];
  windows: Window[];
  microphones: { id: string; name: string; isDefault: boolean }[];
  cameras: { id: string; name: string }[];
  missingPermission: string | null;
}
export interface Status {
  recording: boolean;
  paused: boolean;
  elapsed: number;
  level: number;
}

export const recorder = {
  settings: () => invoke<RecordSettings>("record_settings"),
  save: (settings: RecordSettings) => invoke("record_settings_save", { settings }),
  sources: () => invoke<Sources>("record_sources"),
  meter: (microphone: string | null) => invoke("record_meter", { microphone }),
  status: () => invoke<Status>("record_status"),
  cameraPreview: (camera: string | null, onFrame: (jpeg: ArrayBuffer) => void) => {
    const frames = new Channel<ArrayBuffer>();
    frames.onmessage = onFrame;
    return invoke("record_camera_preview", { camera, frames });
  },
  /** Asks the main window to run the recording flow (countdown, controls, editor). */
  start: () => emit("record:start"),
  show: (view: string, x?: number, y?: number) => invoke("window_show", { view, x, y }),
  hide: (view: string) => invoke("window_hide", { view }),
  resize: (width: number, height: number) => invoke("window_resize", { width, height }),
};

export const formatClock = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
};
