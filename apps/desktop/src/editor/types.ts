// Mirrors of the Rust types the editor exchanges (umi-project JSON, camelCase).

export type Point = [number, number];
export type Rect = [[number, number], [number, number]];
export type Id = string;

export type GradientPreset = "sky" | "ice" | "navy" | "graphite" | "mist" | "mint" | "sand" | "dusk" | "ocean" | "peach" | "grape" | "night" | "umay";
export type Background =
  | { gradient: { _0: GradientPreset } }
  | { color: { _0: { r: number; g: number; b: number; a: number } } }
  | { image: { _0: string } }
  | { blurredScreen: Record<string, never> };

export type AspectRatio = "auto" | "wide" | "vertical" | "square" | "classic" | "portrait";
export type DeviceFrame = "none" | "macOS" | "windows" | "browser" | "macBook";
export type CornerStyle = "rounded" | "squircle";
export type Smoothing = "off" | "slow" | "smooth" | "fast";
export type CameraShape = "circle" | "squircle" | "square";
export type MaskStyle = "blur" | "pixelate" | "highlight";
export type SceneLayout = "default" | "cameraOnly" | "hideCamera" | "splitScreen" | "floating";
export type GradePreset = "none" | "cinematic" | "noir" | "vintage" | "frost" | "golden" | "midnight" | "vivid" | "dreamy";
export type TextStyle = "title" | "lowerThird" | "kicker" | "bigStat" | "quote" | "typewriter";
export type TextAnimation = "fade" | "slide" | "pop" | "typewriter";
export type MoveKind = "glide" | "unfold" | "pullBack";

export interface Clip {
  start: number;
  end: number;
  speed: number;
}

export interface ZoomSegment {
  id: Id;
  start: number;
  end: number;
  scale: number;
  focus?: Point;
}

export interface PrivacyMask {
  id: Id;
  start: number;
  end: number;
  rect: Rect;
  style: MaskStyle;
  amount: number;
  /** Where the mask is over time (hand-placed or tracked). */
  keyframes?: { t: number; rect: Rect }[];
  /** Stuck to the content under it (keyframes come from tracking). */
  follow?: boolean;
}

/** Recording time shown at output time `t`. */
export function sourceTimeAt(placements: Placement[], t: number) {
  const p = [...placements].reverse().find((p) => t >= p.outputStart - 1e-4) ?? placements[0];
  if (!p) return t;
  return Math.min(p.clip.start + (t - p.outputStart) * p.clip.speed, p.clip.end);
}

/** A mask's rect at recording time `t` (same easing as the renderer). */
export function maskRectAt(m: PrivacyMask, t: number): Rect {
  const k = m.keyframes ?? [];
  if (!k.length) return m.rect;
  if (t <= k[0].t) return k[0].rect;
  if (t >= k[k.length - 1].t) return k[k.length - 1].rect;
  let i = 0;
  while (i + 1 < k.length && k[i + 1].t <= t) i++;
  const a = k[i];
  const b = k[Math.min(i + 1, k.length - 1)];
  const span = Math.max(b.t - a.t, 1e-6);
  const x = Math.min(Math.max((t - a.t) / span, 0), 1);
  const f = span < 0.2 ? x : x * x * (3 - 2 * x);
  const l = (p: number, q: number) => p + (q - p) * f;
  return [
    [l(a.rect[0][0], b.rect[0][0]), l(a.rect[0][1], b.rect[0][1])],
    [l(a.rect[1][0], b.rect[1][0]), l(a.rect[1][1], b.rect[1][1])],
  ];
}

/** Sets the mask's rect at `t`: a keyframe when it moves over time, else the fixed rect. */
export function setMaskRectAt(m: PrivacyMask, t: number, rect: Rect) {
  if (!m.keyframes?.length) {
    m.rect = rect;
    return;
  }
  const near = m.keyframes.find((k) => Math.abs(k.t - t) < 1 / 60);
  if (near) near.rect = rect;
  else {
    m.keyframes.push({ t, rect });
    m.keyframes.sort((a, b) => a.t - b.t);
  }
}

export interface SceneSegment {
  id: Id;
  start: number;
  end: number;
  layout: SceneLayout;
  transition: number;
}

export interface TextOverlay {
  id: Id;
  start: number;
  end: number;
  style: TextStyle;
  text: string;
  detail: string;
  position: Point;
  animation: TextAnimation;
}

export interface CameraMove {
  id: Id;
  start: number;
  end: number;
  kind: MoveKind;
}

export interface MediaOverlay {
  id: Id;
  file: string;
  kind: "video" | "image";
  start: number;
  end: number;
  mediaOffset: number;
  mode: "fill" | "pictureInPicture";
  center: Point;
  width: number;
  lane?: number;
}

export interface EditSettings {
  background: Background;
  backgroundAngle: number;
  backgroundNoise: number;
  frame: DeviceFrame;
  aspect: AspectRatio;
  crop?: Rect;
  padding: number;
  cornerRadius: number;
  cornerStyle: CornerStyle;
  shadow: number;
  border: number;
  cursor: { visible: boolean; size: number; smoothing: Smoothing; clickRings: boolean; style: "arrow" | "dot"; motionBlur: boolean; hideWhenIdle: boolean };
  camera: { visible: boolean; shape: CameraShape; size: number; position: Point; mirrored: boolean };
  zoom: {
    auto: boolean;
    scale: number;
    segments: ZoomSegment[];
    trigger?: "clicks" | "smart";
    speed?: "slow" | "normal" | "fast";
    follow?: "cursor" | "clicks";
    glide?: boolean;
  };
  masks: PrivacyMask[];
  scenes: SceneSegment[];
  grade: { preset: GradePreset; exposure: number; contrast: number; saturation: number; vignette: number; grain: number };
  texts: TextOverlay[];
  moves: CameraMove[];
  captions: { enabled: boolean; words: { id: Id; start: number; end: number; text: string }[]; language: string; size: number; position: number; highlightActiveWord: boolean };
  clips: Clip[];
  crossfade: number;
  music?: { file: string; title?: string; volume: number; fadeOut: number };
  overlays: MediaOverlay[];
  watermark?: { file: string; corner: "topLeft" | "topRight" | "bottomLeft" | "bottomRight"; size: number; opacity: number };
  voiceovers?: Voiceover[];
  sound?: { denoise: boolean; levelVoice: boolean; microphoneVolume: number; systemVolume: number };
}

export interface Voiceover {
  id: Id;
  file: string;
  start: number;
  end: number;
  text?: string;
  volume: number;
}

export interface Placement {
  clip: Clip;
  outputStart: number;
}

export type Selection =
  | { kind: "clip"; id: number }
  | { kind: "zoom" | "mask" | "scene" | "text" | "move" | "overlay" | "voiceover"; id: Id }
  | { kind: "music" };

export interface EditorState {
  id: string;
  name: string;
  edit: EditSettings;
  placements: Placement[];
  outputDuration: number;
  zoomSegments: ZoomSegment[];
  recording: { duration: number; width: number; height: number; hasCamera: boolean; bundle: string };
  canUndo: boolean;
  canRedo: boolean;
  selection: Selection | null;
}

export interface RecordingSummary {
  path: string;
  name: string;
  duration: number;
  createdAt: string;
}

export const placementEnd = (p: Placement) => p.outputStart + (p.clip.end - p.clip.start) / p.clip.speed;
