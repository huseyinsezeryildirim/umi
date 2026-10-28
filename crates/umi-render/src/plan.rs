//! The frame planner: turns the edit, the moment in time and the available textures into
//! render operations. A one-to-one port of the Swift `FrameRenderer.compose`.
//!
//! Layer order: background → screen card (masks, device frame, shadow, cursor) with its 3D
//! move → zoom → media → camera → color grade → text → captions → watermark.

use crate::math::{Point, Rect, RectExt, ease};
use crate::motion::{CursorTrack, MovePose, ZoomTrack, move_pose, perspective_corners};
use crate::ops::*;
use crate::raster::Assets;
use crate::scene::{DeviceFrameGeometry, SceneLayoutEngine};
use umi_project::edit::*;
use umi_project::project::{FaceKey, KeyPress};
use umi_project::{CursorData, RecordingProject};
use uuid::Uuid;

/// Everything about a recording that doesn't change from frame to frame.
pub struct FramePlanner {
    pub settings: EditSettings,
    pub project: RecordingProject,
    /// Off while placing masks or a zoom focus on the preview, so handles line up.
    pub apply_zoom_and_moves: bool,
    cursor: CursorTrack,
    zoom: ZoomTrack,
    scenes: SceneLayoutEngine,
    keys: Vec<KeyPress>,
    /// The face's path in the camera (for keeping it framed).
    pub faces: Vec<FaceKey>,
    /// When the bubble sits on the other side to stay clear of the cursor.
    camera_away: Vec<(f64, f64)>,
}

/// Per-frame inputs: times and which video textures are available this frame.
#[derive(Debug, Clone, Default)]
pub struct FrameInputs {
    /// Recording time shown.
    pub time: f64,
    /// Output (timeline) time, for Media-track items.
    pub output_time: Option<f64>,
    pub has_screen: bool,
    pub has_camera: bool,
    /// Overlay video frames available this frame.
    pub overlays: Vec<Uuid>,
}

const WHITE: [f32; 4] = [1.0, 1.0, 1.0, 1.0];
const ACCENT: [f32; 4] = [0.067, 0.435, 0.96, 1.0];

fn black(alpha: f64) -> [f32; 4] {
    [0.0, 0.0, 0.0, alpha as f32]
}

/// Linear-light premultiplied color from sRGB components.
pub fn srgb(r: f64, g: f64, b: f64, a: f64) -> [f32; 4] {
    let lin = |c: f64| if c <= 0.04045 { c / 12.92 } else { ((c + 0.055) / 1.055).powf(2.4) };
    [(lin(r) * a) as f32, (lin(g) * a) as f32, (lin(b) * a) as f32, a as f32]
}

impl FramePlanner {
    pub fn new(project: RecordingProject, settings: EditSettings, cursor_data: &CursorData, apply_zoom_and_moves: bool) -> Self {
        let crop = settings.crop.unwrap_or(Rect::UNIT);
        let aspect = (project.screen.pixel_width as f64 * crop.width()) / (project.screen.pixel_height.max(1) as f64 * crop.height());
        let mut planner = Self {
            cursor: CursorTrack::new(cursor_data, project.duration, settings.cursor.smoothing.spring()),
            zoom: ZoomTrack::new(&settings.zoom, cursor_data, project.duration),
            scenes: SceneLayoutEngine::new(settings.clone(), aspect, project.camera.is_some()),
            keys: cursor_data.keys.clone(),
            faces: vec![],
            camera_away: vec![],
            settings,
            project,
            apply_zoom_and_moves,
        };
        if planner.settings.camera.avoid_cursor && planner.project.camera.is_some() {
            planner.camera_away = planner.cursor_near_camera();
        }
        planner
    }

    /// Times when the cursor works close to the camera bubble (so it moves aside): near for
    /// 0.3 s to move away, clear for 1.5 s to come back.
    fn cursor_near_camera(&self) -> Vec<(f64, f64)> {
        let (w, h) = umi_project::timeline::render_size(&self.project, &self.settings, 1080);
        let canvas = Rect::new(0.0, 0.0, w as f64, h as f64);
        let mut spans: Vec<(f64, f64)> = Vec::new();
        let (mut away, mut since) = (false, 0.0);
        let mut t = 0.0;
        while t <= self.project.duration {
            let scene = self.scenes.state(t, canvas);
            let near = match self.cursor.position(t) {
                Some(p) if scene.camera_alpha > 0.0 => {
                    let content = DeviceFrameGeometry::content_rect(self.settings.frame, scene.screen_rect);
                    let p = self.to_content(p);
                    let (x, y) = (content.min_x() + p.x * content.width(), content.max_y() - p.y * content.height());
                    let r = scene.camera_rect.inset(-canvas.short_side() * 0.06, -canvas.short_side() * 0.06);
                    x >= r.min_x() && x <= r.max_x() && y >= r.min_y() && y <= r.max_y()
                }
                _ => false,
            };
            if near != away {
                if since == 0.0 {
                    since = t;
                }
                if t - since >= if near { 0.3 } else { 1.5 } {
                    away = near;
                    if away {
                        spans.push((since, f64::MAX));
                    } else if let Some(last) = spans.last_mut() {
                        last.1 = since;
                    }
                    since = 0.0;
                }
            } else {
                since = 0.0;
            }
            t += 0.1;
        }
        spans
    }

    /// 0 = the bubble where it was put, 1 = mirrored to the other side.
    fn camera_shift(&self, t: f64) -> f64 {
        const GLIDE: f64 = 0.45;
        self.camera_away.iter().map(|&(a, b)| ease(((t - a) / GLIDE).min((b - t) / GLIDE).clamp(0.0, 1.0))).fold(0.0, f64::max)
    }

    /// The face at `t`, interpolated (`None` without a face path).
    fn face_at(&self, t: f64) -> Option<FaceKey> {
        let faces = &self.faces;
        let i = faces.partition_point(|f| f.t <= t);
        match (i.checked_sub(1).and_then(|j| faces.get(j)), faces.get(i)) {
            (Some(a), Some(b)) => {
                let k = ((t - a.t) / (b.t - a.t).max(1e-6)).clamp(0.0, 1.0);
                Some(FaceKey { t, x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, size: a.size + (b.size - a.size) * k })
            }
            (Some(a), None) => Some(*a),
            (None, Some(b)) => Some(*b),
            (None, None) => None,
        }
    }

    pub fn zoom_segments(&self) -> Vec<ZoomSegment> {
        self.zoom.all()
    }

    /// The screen content rect at `time` (bottom-left canvas px), e.g. for editor handles.
    pub fn screen_content_rect(&self, time: f64, canvas: Rect) -> Rect {
        DeviceFrameGeometry::content_rect(self.settings.frame, self.scenes.state(time, canvas).screen_rect)
    }

    /// Plans one frame into `dst` (a canvas-sized target).
    pub fn plan(&self, inputs: &FrameInputs, size: (u32, u32), assets: &mut dyn Assets, dst: Target, ops: &mut Vec<Op>) {
        let s = &self.settings;
        let canvas = Rect::new(0.0, 0.0, size.0 as f64, size.1 as f64);
        let short = canvas.short_side();
        let t = inputs.time;
        let active_overlays: Vec<&MediaOverlay> = match inputs.output_time {
            Some(ot) => s.overlays.iter().filter(|o| ot >= o.start && ot <= o.end).collect(),
            None => vec![],
        };
        // B-roll in fill mode replaces the screen, so click zoom steps aside meanwhile.
        let fill_amount = active_overlays
            .iter()
            .filter(|o| o.mode == OverlayMode::Fill)
            .map(|o| overlay_fade(o, inputs.output_time.unwrap_or(0.0)))
            .fold(0.0, f64::max);
        let scene = self.scenes.state(t, canvas);
        let mv = if self.apply_zoom_and_moves { move_pose(&s.moves, t, canvas) } else { None };

        // Background into the composite.
        let mut composite = Target::Composite;
        self.plan_background(inputs, canvas, assets, composite, ops);
        if let Some(mv) = mv
            && mv.amount > 0.0
        {
            // Shallow focus: the background softens while the card moves in 3D.
            blur_in_place(composite, short * 0.006 * mv.amount, canvas, ops);
        }

        // Screen card on its own layer, so a 3D move tilts it as a whole.
        if inputs.has_screen && scene.screen_alpha > 0.001 {
            ops.push(Op::Clear { target: Target::Card, color: [0.0; 4] });
            self.plan_card(inputs, scene.screen_rect, canvas, assets, ops);
            let flip = Homography::rect(canvas);
            let transform = match mv {
                Some(mv) => perspective(scene.screen_rect, self.card_extent(scene.screen_rect, short), &mv).map_or(flip, |p| flip.then(&p)),
                None => flip,
            };
            ops.push(Op::Draw {
                target: composite,
                draw: Draw {
                    size: (canvas.width(), canvas.height()),
                    transform,
                    fill: Fill::Texture { tint: WHITE, mirror: false },
                    texture: TexRef::Target(Target::Card),
                    uv: Rect::UNIT,
                    mask: Mask::NONE,
                    alpha: scene.screen_alpha,
                },
            });
        }

        // Zoom the composed screen (not the camera), keeping the view inside the canvas.
        let (raw_scale, raw_focus) = if self.apply_zoom_and_moves { self.zoom.state(t) } else { (1.0, Point::new(0.5, 0.5)) };
        let focus = self.to_content(raw_focus);
        let scale = 1.0 + (raw_scale - 1.0) * scene.zoom_allowance * (1.0 - fill_amount);
        if scale > 1.001 {
            let content = DeviceFrameGeometry::content_rect(s.frame, scene.screen_rect);
            let (vw, vh) = (canvas.width() / scale, canvas.height() / scale);
            let cx = content.min_x() + focus.x * content.width();
            let cy = content.max_y() - focus.y * content.height();
            let ox = (cx - vw / 2.0).max(0.0).min(canvas.width() - vw);
            let oy = (cy - vh / 2.0).max(0.0).min(canvas.height() - vh);
            // Visible window in texture uv (top-left origin).
            let uv = Rect::new(ox / canvas.width(), 1.0 - (oy + vh) / canvas.height(), vw / canvas.width(), vh / canvas.height());
            ops.push(Op::Draw { target: Target::Composite2, draw: full_canvas(canvas, TexRef::Target(composite), uv, 1.0) });
            composite = Target::Composite2;
        }

        // Magnifier: a round, enlarged view around the focus, over the screen.
        if self.apply_zoom_and_moves
            && let Some((amount, magnification, raw)) = self.zoom.loupe(t)
            && amount > 0.001
            && inputs.has_screen
        {
            let content = DeviceFrameGeometry::content_rect(s.frame, scene.screen_rect);
            let focus = self.to_content(raw);
            let (fx, fy) = (content.min_x() + focus.x * content.width(), content.max_y() - focus.y * content.height());
            let d = short * 0.36 * (0.55 + 0.45 * amount);
            let cx = fx.clamp(d / 2.0, canvas.width() - d / 2.0);
            let cy = fy.clamp(d / 2.0, canvas.height() - d / 2.0);
            let rect = Rect::new(cx - d / 2.0, cy - d / 2.0, d, d);
            // What's shown inside: a window around the focus, `magnification` times smaller.
            let m = 1.0 + (magnification.max(1.2) - 1.0) * amount;
            let w = d / m;
            let (wx, wy) = ((fx - w / 2.0).clamp(0.0, canvas.width() - w), (fy - w / 2.0).clamp(0.0, canvas.height() - w));
            let uv = Rect::new(wx / canvas.width(), 1.0 - (wy + w) / canvas.height(), w / canvas.width(), w / canvas.height());
            let dst = if composite == Target::Composite { Target::Composite2 } else { Target::Composite };
            ops.push(Op::Draw { target: dst, draw: full_canvas(canvas, TexRef::Target(composite), Rect::UNIT, 1.0) });
            ops.push(Op::Draw { target: dst, draw: shadow(rect.offset(0.0, -d * 0.03), d / 2.0, d * 0.06, black(0.45 * amount), 1.0) });
            ops.push(Op::Draw {
                target: dst,
                draw: Draw {
                    size: (d, d),
                    transform: Homography::rect(rect),
                    fill: Fill::Texture { tint: WHITE, mirror: false },
                    texture: TexRef::Target(composite),
                    uv,
                    mask: Mask { kind: MaskKind::Rounded, rect: Rect::new(0.0, 0.0, d, d), radius: d / 2.0 },
                    alpha: amount,
                },
            });
            ops.push(Op::Draw { target: dst, draw: ring(rect, (d * 0.012).max(2.0), 0.0, srgb(1.0, 1.0, 1.0, 0.95), amount) });
            composite = dst;
        }

        let screen_content = DeviceFrameGeometry::content_rect(s.frame, scene.screen_rect);
        for overlay in &active_overlays {
            self.plan_overlay(overlay, inputs, canvas, screen_content, assets, composite, ops);
        }

        if inputs.has_camera && scene.camera_alpha > 0.001 {
            self.plan_camera(t, canvas, assets, scene.camera_rect, scene.camera_radius, scene.camera_alpha, short, composite, ops);
        }

        // Grade into the destination (or copy when there's nothing to grade).
        let grade = grade_params(&s.grade, t);
        let graded = if grade.is_identity() {
            composite
        } else {
            let bloom = (grade.bloom > 0.0).then(|| {
                let target = Target::Scratch(3);
                ops.push(Op::Blur { src: TexRef::Target(composite), dst: target, sigma: short * 0.02, scale: 0.25 });
                target
            });
            ops.push(Op::Grade {
                src: composite,
                dst: Target::Graded,
                params: GradeParams { grain_seed: (t * 977.0 % 512.0) as f32, ..grade },
                bloom,
            });
            Target::Graded
        };

        for text in &s.texts {
            self.plan_text(text, t, canvas, assets, graded, ops);
        }
        self.plan_captions(t, canvas, assets, graded, ops);
        if s.keystrokes.enabled {
            self.plan_keystrokes(t, canvas, assets, graded, ops);
        }
        if let Some(mark) = &s.watermark {
            self.plan_watermark(mark, canvas, assets, graded, ops);
        }

        ops.push(Op::Draw { target: dst, draw: full_canvas(canvas, TexRef::Target(graded), Rect::UNIT, 1.0) });
    }

    /// The card layer's bounds as Core Image sees them (the blurred shadow grows them). The
    /// Swift renderer maps these bounds, not the screen, onto the projected corners.
    fn card_extent(&self, outer: Rect, short: f64) -> Rect {
        if self.settings.shadow <= 0.0 {
            return outer;
        }
        let sigma = short * 0.025 * self.settings.shadow;
        let grow = (sigma * 3.0).ceil();
        let shadow = outer.offset(0.0, -short * 0.012).inset(-grow, -grow);
        let x0 = outer.min_x().min(shadow.min_x());
        let y0 = outer.min_y().min(shadow.min_y());
        let x1 = outer.max_x().max(shadow.max_x());
        let y1 = outer.max_y().max(shadow.max_y());
        Rect::new(x0, y0, x1 - x0, y1 - y0)
    }

    // MARK: Background

    fn plan_background(&self, inputs: &FrameInputs, canvas: Rect, assets: &mut dyn Assets, target: Target, ops: &mut Vec<Op>) {
        let s = &self.settings;
        ops.push(Op::Clear { target, color: [0.0, 0.0, 0.0, 1.0] });
        match &s.background {
            Background::BlurredScreen => {
                if inputs.has_screen
                    && let Some((w, h)) = assets.size(&TexRef::Screen)
                {
                    // The recording itself, filling the canvas, heavily blurred and dimmed.
                    let k = (canvas.width() / w as f64).max(canvas.height() / h as f64) * 1.1;
                    let rect = centered(canvas, w as f64 * k, h as f64 * k);
                    let sigma = canvas.short_side() * 0.04;
                    ops.push(Op::Blur { src: TexRef::Screen, dst: Target::Scratch(0), sigma: sigma / k, scale: 0.25 });
                    // Dimmed and a little more saturated (CIColorControls −0.12 / 1.2).
                    let dim = GradeParams { manual_saturation: 1.2, manual_brightness: -0.12, ..GradeParams::IDENTITY };
                    ops.push(Op::Grade { src: Target::Scratch(0), dst: Target::Scratch(5), params: dim, bloom: None });
                    ops.push(Op::Draw {
                        target,
                        draw: Draw {
                            size: (rect.width(), rect.height()),
                            transform: Homography::rect(rect),
                            fill: Fill::Texture { tint: WHITE, mirror: false },
                            texture: TexRef::Target(Target::Scratch(5)),
                            uv: Rect::UNIT,
                            mask: Mask::NONE,
                            alpha: 1.0,
                        },
                    });
                } else {
                    ops.push(solid(canvas, srgb(0.12, 0.13, 0.16, 1.0), target));
                }
            }
            Background::Color(c) => ops.push(solid(canvas, srgb(c.r, c.g, c.b, c.a), target)),
            Background::Gradient(preset) => {
                let (a, b) = preset.colors();
                let angle = s.background_angle.to_radians();
                let half = canvas.width().hypot(canvas.height()) / 2.0;
                let (dx, dy) = (angle.cos() * half, angle.sin() * half);
                // Canvas (bottom-left) → quad-local (top-left) for the gradient endpoints.
                let from = Point::new(canvas.mid_x() - dx, canvas.height() - (canvas.mid_y() - dy));
                let to = Point::new(canvas.mid_x() + dx, canvas.height() - (canvas.mid_y() + dy));
                ops.push(Op::Draw {
                    target,
                    draw: Draw {
                        size: (canvas.width(), canvas.height()),
                        transform: Homography::rect(canvas),
                        fill: Fill::Gradient { from, to, a: srgb(a.r, a.g, a.b, 1.0), b: srgb(b.r, b.g, b.b, 1.0) },
                        texture: TexRef::None,
                        uv: Rect::UNIT,
                        mask: Mask::NONE,
                        alpha: 1.0,
                    },
                });
            }
            Background::Image(path) => match assets.image(path) {
                Some((key, (w, h))) => {
                    let k = (canvas.width() / w as f64).max(canvas.height() / h as f64);
                    let rect = centered(canvas, w as f64 * k, h as f64 * k);
                    ops.push(Op::Draw { target, draw: textured(rect, TexRef::Raster(key), 1.0) });
                }
                None => ops.push(solid(canvas, srgb(0.2, 0.22, 0.27, 1.0), target)),
            },
        }
        if s.background_noise > 0.0 {
            let params = GradeParams { grain: s.background_noise as f32, ..GradeParams::IDENTITY };
            ops.push(Op::Grade { src: target, dst: Target::Scratch(4), params, bloom: None });
            ops.push(Op::Draw { target, draw: full_canvas(canvas, TexRef::Target(Target::Scratch(4)), Rect::UNIT, 1.0) });
        }
    }

    // MARK: Screen card

    /// Shadow, device chrome, the masked screen with rounded corners, border and cursor.
    fn plan_card(&self, inputs: &FrameInputs, outer: Rect, canvas: Rect, assets: &mut dyn Assets, ops: &mut Vec<Op>) {
        let s = &self.settings;
        let short = canvas.short_side();
        let content = DeviceFrameGeometry::content_rect(s.frame, outer);
        let chrome = assets.chrome(s.frame, outer.width().round() as u32, outer.height().round() as u32);
        let chrome_radius = chrome.as_ref().map(|c| c.content_radius);
        let radius = chrome_radius.unwrap_or(s.corner_radius * content.short_side());
        let squircle = s.corner_style == CornerStyle::Squircle && chrome_radius.is_none();

        if s.shadow > 0.0 {
            // The MacBook's shadow follows the lid and base; others follow the card.
            let shadow_radius = if s.frame == DeviceFrame::None { radius } else { outer.short_side() * 0.02 };
            let sigma = short * 0.025 * s.shadow;
            let shadow_rect = outer.offset(0.0, -short * 0.012);
            ops.push(Op::Draw { target: Target::Card, draw: shadow(shadow_rect, shadow_radius, sigma, black(0.55 * s.shadow), 1.0) });
        }
        if let Some(chrome) = chrome {
            ops.push(Op::Draw { target: Target::Card, draw: textured(outer, TexRef::Raster(chrome.key), 1.0) });
        }

        // The screen with masks, at its on-canvas size, then placed with rounded corners.
        let (sw, sh) = (content.width().round().max(1.0) as u32, content.height().round().max(1.0) as u32);
        let screen_target = Target::Screen { width: sw, height: sh };
        self.plan_screen_layer(inputs.time, sw, sh, assets, screen_target, ops);
        ops.push(Op::Draw {
            target: Target::Card,
            draw: Draw {
                size: (content.width(), content.height()),
                transform: Homography::rect(content),
                fill: Fill::Texture { tint: WHITE, mirror: false },
                texture: TexRef::Target(screen_target),
                uv: Rect::UNIT,
                mask: Mask {
                    kind: if squircle { MaskKind::Squircle } else { MaskKind::Rounded },
                    rect: Rect::new(0.0, 0.0, content.width(), content.height()),
                    radius,
                },
                alpha: 1.0,
            },
        });

        if s.border > 0.0 && s.frame == DeviceFrame::None {
            let width = (s.border * content.short_side()).max(1.0);
            let ring = content.inset(-width, -width);
            ops.push(Op::Draw {
                target: Target::Card,
                draw: Draw {
                    size: (ring.width(), ring.height()),
                    transform: Homography::rect(ring),
                    fill: Fill::Ring { color: srgb(1.0, 1.0, 1.0, 0.9), width },
                    texture: TexRef::None,
                    uv: Rect::UNIT,
                    mask: Mask {
                        kind: if squircle { MaskKind::Squircle } else { MaskKind::Rounded },
                        rect: Rect::new(0.0, 0.0, ring.width(), ring.height()),
                        radius: radius + width,
                    },
                    alpha: 1.0,
                },
            });
        }
        self.plan_cursor(inputs.time, content, assets, ops);
    }

    /// The (cropped) screen at `w`×`h` with the privacy masks active at `t`.
    fn plan_screen_layer(&self, t: f64, w: u32, h: u32, assets: &mut dyn Assets, target: Target, ops: &mut Vec<Op>) {
        let s = &self.settings;
        let crop = s.crop.unwrap_or(Rect::UNIT);
        let layer = Rect::new(0.0, 0.0, w as f64, h as f64);
        ops.push(Op::Draw { target, draw: Draw { uv: crop, ..textured(layer, TexRef::Screen, 1.0) } });

        let screen_size = assets.size(&TexRef::Screen).unwrap_or((w, h));
        for mask in s.masks.iter().filter(|m| t >= m.start && t <= m.end) {
            let fade = ((t - mask.start) / 0.2).min((mask.end - t) / 0.2).min(1.0);
            // Mask rect (normalized to the full recording, moving over time) → layer px.
            let rect = mask.rect_at(t);
            let local = Rect::new(
                (rect.min_x() - crop.min_x()) / crop.width() * layer.width(),
                (rect.min_y() - crop.min_y()) / crop.height() * layer.height(),
                rect.width() / crop.width() * layer.width(),
                rect.height() / crop.height() * layer.height(),
            );
            let Some(local) = local.intersection(&layer) else { continue };
            let px_per_screen_px = layer.width() / (screen_size.0 as f64 * crop.width()).max(1.0);
            let radius = local.short_side() * 0.08;
            let rounded = Mask { kind: MaskKind::Rounded, rect: local, radius };
            // Layer quad, but drawn in the layer's own coordinates (top-left = canvas of the layer).
            let quad = |fill: Fill, texture: TexRef, uv: Rect, mask: Mask, alpha: f64| Draw {
                size: (layer.width(), layer.height()),
                transform: Homography::rect(layer),
                fill,
                texture,
                uv,
                mask,
                alpha,
            };
            match mask.style {
                MaskStyle::Blur => {
                    let sigma = (6.0 + 34.0 * mask.amount) * px_per_screen_px;
                    ops.push(Op::Blur { src: TexRef::Target(target), dst: Target::Scratch(2), sigma, scale: 0.5 });
                    ops.push(Op::Draw {
                        target,
                        draw: quad(
                            Fill::Texture { tint: WHITE, mirror: false },
                            TexRef::Target(Target::Scratch(2)),
                            Rect::UNIT,
                            rounded,
                            fade,
                        ),
                    });
                }
                MaskStyle::Pixelate => {
                    let size = screen_size.0.max(screen_size.1) as f64 * (0.008 + 0.035 * mask.amount) * px_per_screen_px;
                    ops.push(Op::Draw { target, draw: quad(Fill::Pixelate { size }, TexRef::Screen, crop, rounded, fade) });
                }
                MaskStyle::Highlight => {
                    // Dim everything except the rect.
                    let dim = black((0.25 + 0.55 * mask.amount) * fade);
                    ops.push(Op::Draw {
                        target,
                        draw: quad(Fill::Solid(dim), TexRef::None, Rect::UNIT, Mask { kind: MaskKind::Inverted, ..rounded }, 1.0),
                    });
                }
            }
        }
    }

    fn plan_cursor(&self, t: f64, screen: Rect, assets: &mut dyn Assets, ops: &mut Vec<Op>) {
        let s = &self.settings;
        let Some(raw) = self.cursor.position(t).filter(|_| s.cursor.visible) else { return };
        let p = self.to_content(raw);
        if !(-0.02..=1.02).contains(&p.x) || !(-0.02..=1.02).contains(&p.y) {
            return;
        }
        // Points → canvas px: the screen rect spans the (cropped) captured width in points.
        let crop_w = s.crop.map_or(1.0, |c| c.width());
        let point_scale = screen.width() / (self.project.screen.capture_rect.width() * crop_w).max(1.0);
        let to_canvas = |q: Point| Point::new(screen.min_x() + q.x * screen.width(), screen.max_y() - q.y * screen.height());
        let anchor = to_canvas(p);

        if s.cursor.click_rings {
            for click in self.cursor.clicks.iter().filter(|c| t >= c.t && t - c.t < 0.45) {
                let progress = (t - click.t) / 0.45;
                let d = (24.0 + 36.0 * progress) * point_scale * s.cursor.size.max(1.0);
                let c = to_canvas(self.to_content(Point::new(click.x, click.y)));
                let rect = Rect::new(c.x - d / 2.0, c.y - d / 2.0, d, d);
                let alpha = 0.9 * (1.0 - progress);
                // White ring with a faint dark outline (like the Swift ring image).
                ops.push(Op::Draw { target: Target::Card, draw: ring(rect, d * 18.0 / 256.0, d * 12.0 / 256.0, WHITE, alpha) });
                ops.push(Op::Draw { target: Target::Card, draw: ring(rect, d * 4.0 / 256.0, d * 2.0 / 256.0, black(0.25), alpha) });
            }
        }

        let scale = point_scale * s.cursor.size;
        let fade = if s.cursor.hide_when_idle { self.idle_alpha(t) } else { 1.0 };
        if fade <= 0.01 {
            return;
        }
        // Motion blur: fading copies along the recent path when the cursor moves fast.
        if s.cursor.motion_blur {
            for k in (1..=4).rev() {
                let Some(past) = self.cursor.position(t - k as f64 / 120.0) else { continue };
                let q = self.to_content(past);
                let distance = ((q.x - p.x) * screen.width()).hypot((q.y - p.y) * screen.height());
                if distance <= 6.0 * k as f64 {
                    continue;
                }
                self.cursor_draw(to_canvas(q), scale, fade * 0.16 * (5 - k) as f64, assets, ops);
            }
        }
        self.cursor_draw(anchor, scale, fade, assets, ops);
    }

    /// The cursor drawn with its hot spot at `anchor`.
    fn cursor_draw(&self, anchor: Point, scale: f64, alpha: f64, assets: &mut dyn Assets, ops: &mut Vec<Op>) {
        match self.settings.cursor.style {
            CursorStyle::Arrow => {
                let arrow = assets.cursor_arrow();
                let (w, h) = (arrow.size.width * scale, arrow.size.height * scale);
                let rect = Rect::new(anchor.x - arrow.hot_spot.x * scale, anchor.y - (arrow.size.height - arrow.hot_spot.y) * scale, w, h);
                ops.push(Op::Draw { target: Target::Card, draw: textured(rect, TexRef::Raster(arrow.key), alpha) });
            }
            CursorStyle::Dot => {
                let d = 22.0 * scale;
                let rect = Rect::new(anchor.x - d / 2.0, anchor.y - d / 2.0, d, d);
                let round = Mask { kind: MaskKind::Rounded, rect: Rect::new(0.0, 0.0, d, d), radius: d / 2.0 };
                ops.push(Op::Draw {
                    target: Target::Card,
                    draw: Draw { mask: round, ..solid_draw(rect, srgb(0.2, 0.25, 0.35, 0.45), alpha) },
                });
                ops.push(Op::Draw { target: Target::Card, draw: ring(rect, (d * 0.08).max(1.5), 0.0, srgb(1.0, 1.0, 1.0, 0.95), alpha) });
            }
        }
    }

    /// 1 while the cursor moves; fades to 0 once it has rested for 1.5 s.
    fn idle_alpha(&self, t: f64) -> f64 {
        let Some(now) = self.cursor.position(t) else { return 1.0 };
        let mut rest = 0.0;
        while rest < 3.0 {
            match self.cursor.position(t - rest - 0.1) {
                Some(past) if (past.x - now.x).hypot(past.y - now.y) < 0.002 => rest += 0.1,
                _ => break,
            }
        }
        (1.0 - (rest - 1.5) / 0.4).clamp(0.0, 1.0)
    }

    // MARK: Media, camera, text

    #[allow(clippy::too_many_arguments)]
    fn plan_overlay(
        &self,
        overlay: &MediaOverlay,
        inputs: &FrameInputs,
        canvas: Rect,
        screen_rect: Rect,
        assets: &mut dyn Assets,
        target: Target,
        ops: &mut Vec<Op>,
    ) {
        let alpha = overlay_fade(overlay, inputs.output_time.unwrap_or(0.0));
        if alpha <= 0.001 {
            return;
        }
        let (texture, (w, h)) = match overlay.kind {
            MediaKind::Image => match assets.image(&overlay.file) {
                Some((key, size)) => (TexRef::Raster(key), size),
                None => return,
            },
            MediaKind::Video => {
                if !inputs.overlays.contains(&overlay.id) {
                    return;
                }
                let tex = TexRef::Overlay(overlay.id);
                match assets.size(&tex) {
                    Some(size) => (tex, size),
                    None => return,
                }
            }
        };
        let (rect, radius) = match overlay.mode {
            OverlayMode::Fill => (screen_rect, self.settings.corner_radius * screen_rect.short_side()),
            OverlayMode::PictureInPicture => {
                let pw = canvas.width() * overlay.width;
                let ph = pw * h as f64 / (w as f64).max(1.0);
                let r =
                    Rect::new(overlay.center.x * canvas.width() - pw / 2.0, (1.0 - overlay.center.y) * canvas.height() - ph / 2.0, pw, ph);
                (r, r.short_side() * 0.04)
            }
        };
        if overlay.mode == OverlayMode::PictureInPicture {
            let short = canvas.short_side();
            ops.push(Op::Draw { target, draw: shadow(rect.offset(0.0, -short * 0.01), radius, short * 0.02, black(0.45 * alpha), 1.0) });
        }
        ops.push(Op::Draw { target, draw: aspect_fill(rect, radius, texture, (w, h), false, alpha) });
    }

    #[allow(clippy::too_many_arguments)]
    #[allow(clippy::too_many_arguments)]
    fn plan_camera(
        &self,
        t: f64,
        canvas: Rect,
        assets: &mut dyn Assets,
        rect: Rect,
        radius: f64,
        alpha: f64,
        _short: f64,
        target: Target,
        ops: &mut Vec<Op>,
    ) {
        let Some(size) = assets.size(&TexRef::Camera) else { return };
        let cam = &self.settings.camera;
        // Out of the cursor's way: glide to the mirrored spot.
        let shift = self.camera_shift(t);
        let rect = if shift > 0.0 {
            let mirrored_x = canvas.width() - rect.max_x();
            rect.offset((mirrored_x - rect.min_x()) * shift, 0.0)
        } else {
            rect
        };
        let mut draw = aspect_fill(rect, radius, TexRef::Camera, size, cam.mirrored, alpha);
        if cam.follow_face
            && let Some(face) = self.face_at(t)
        {
            draw.uv = face_crop(rect, size, face);
        }
        if cam.background == CameraBackground::Remove {
            // The person alone, standing on the bottom edge below where the bubble was (no
            // bubble, no shadow), a bit bigger to make up for the missing frame.
            let uv = draw.uv;
            let aspect = (uv.width() * size.0 as f64) / (uv.height() * size.1 as f64).max(1.0);
            let height = rect.height() * 1.35;
            let width = height * aspect;
            let x = (rect.mid_x() - width / 2.0).clamp(canvas.min_x() - width * 0.15, canvas.max_x() - width * 0.85);
            let mut d = aspect_fill(Rect::new(x, canvas.min_y(), width, height), 0.0, TexRef::Camera, size, cam.mirrored, alpha);
            d.uv = uv;
            d.mask = Mask::NONE;
            ops.push(Op::Draw { target, draw: d });
            return;
        }
        let side = rect.short_side();
        ops.push(Op::Draw { target, draw: shadow(rect.offset(0.0, -side * 0.02), radius, side * 0.04, black(0.4 * alpha), 1.0) });
        ops.push(Op::Draw { target, draw });
    }

    fn plan_text(&self, text: &TextOverlay, t: f64, canvas: Rect, assets: &mut dyn Assets, target: Target, ops: &mut Vec<Op>) {
        if t < text.start || t > text.end {
            return;
        }
        let p_in = ease((t - text.start) / 0.35);
        let p_out = ease((text.end - t) / 0.3);
        let visible = p_in.min(p_out);
        // Typewriter reveals characters over up to 1.2 s.
        let count = text.text.chars().count();
        let mut characters = count;
        if text.animation == TextAnimation::Typewriter || text.style == TextStyle::Typewriter {
            let typing = 1.2f64.min((text.end - text.start) / 2.0);
            characters = (count as f64 * ((t - text.start) / typing.max(0.01)).min(1.0)).floor() as usize;
        }
        let Some((key, (w, h))) = assets.text_card(text, characters, canvas.height()) else { return };
        let anchor = Point::new(text.position.x * canvas.width(), (1.0 - text.position.y) * canvas.height());
        let (mut w, mut h) = (w as f64, h as f64);
        let mut center = anchor;
        match text.animation {
            TextAnimation::Slide => center.y -= (1.0 - visible) * canvas.height() * 0.04,
            TextAnimation::Pop => {
                let k = 0.82 + 0.18 * visible;
                w *= k;
                h *= k;
            }
            TextAnimation::Fade | TextAnimation::Typewriter => {}
        }
        let rect = Rect::new(center.x - w / 2.0, center.y - h / 2.0, w, h);
        ops.push(Op::Draw { target, draw: textured(rect, TexRef::Raster(key), visible) });
    }

    fn plan_captions(&self, t: f64, canvas: Rect, assets: &mut dyn Assets, target: Target, ops: &mut Vec<Op>) {
        let c = &self.settings.captions;
        if !c.enabled || c.words.is_empty() {
            return;
        }
        let lines = caption_lines(&umi_project::captions::kept_words(&c.words, &self.settings.clips));
        let Some(line) = lines.iter().find(|l| t >= l[0].start - 0.05 && t <= l[l.len() - 1].end + 0.4) else { return };
        let active = if c.highlight_active_word { line.iter().position(|w| t >= w.start && t < w.end) } else { None };
        let words: Vec<String> = line.iter().map(|w| w.text.clone()).collect();
        let shown = if c.reveal { line.iter().filter(|w| w.start <= t + 0.02).count().max(1) } else { words.len() };
        let Some((key, (w, h))) = assets.caption(&words, active, canvas.height() * c.size, ACCENT, c.style, shown) else { return };
        let (w, h) = (w as f64, h as f64);
        let center = Point::new(canvas.mid_x(), (1.0 - c.position) * canvas.height());
        ops.push(Op::Draw { target, draw: textured(Rect::new(center.x - w / 2.0, center.y - h / 2.0, w, h), TexRef::Raster(key), 1.0) });
    }

    /// The latest shortcut (or, if wanted, the words being typed) as keycaps, held 1.4 s
    /// after the key and faded out.
    fn plan_keystrokes(&self, t: f64, canvas: Rect, assets: &mut dyn Assets, target: Target, ops: &mut Vec<Op>) {
        let k = &self.settings.keystrokes;
        let Some((caps, last)) = keystroke_caps(&self.keys, t, k.include_typing) else { return };
        let alpha = ease(((t - last) / 0.08).min((last + 1.4 - t) / 0.3).clamp(0.0, 1.0));
        if alpha <= 0.0 {
            return;
        }
        let Some((key, (w, h))) = assets.keycaps(&caps, canvas.height() * k.size) else { return };
        let (w, h) = (w as f64, h as f64);
        let center = Point::new(canvas.mid_x(), (1.0 - k.position) * canvas.height());
        let pop = 0.9 + 0.1 * alpha;
        let (w, h) = (w * pop, h * pop);
        ops.push(Op::Draw { target, draw: textured(Rect::new(center.x - w / 2.0, center.y - h / 2.0, w, h), TexRef::Raster(key), alpha) });
    }

    fn plan_watermark(&self, mark: &Watermark, canvas: Rect, assets: &mut dyn Assets, target: Target, ops: &mut Vec<Op>) {
        let Some((key, (lw, lh))) = assets.image(&mark.file) else { return };
        let w = canvas.width() * mark.size;
        let h = lh as f64 * w / (lw as f64).max(1.0);
        let margin = canvas.short_side() * 0.035;
        let x = if matches!(mark.corner, Corner::TopLeft | Corner::BottomLeft) { margin } else { canvas.width() - w - margin };
        let y = if matches!(mark.corner, Corner::BottomLeft | Corner::BottomRight) { margin } else { canvas.height() - h - margin };
        ops.push(Op::Draw { target, draw: textured(Rect::new(x, y, w, h), TexRef::Raster(key), mark.opacity) });
    }

    /// A point normalized to the full recording, normalized to the cropped content instead.
    fn to_content(&self, p: Point) -> Point {
        match self.settings.crop {
            Some(c) => Point::new((p.x - c.min_x()) / c.width().max(0.001), (p.y - c.min_y()) / c.height().max(0.001)),
            None => p,
        }
    }
}

// MARK: Helpers

/// What the keystroke overlay shows at recording time `t`: the newest shortcut as separate
/// caps (["⌘", "⇧", "K"]) or, with `typing`, the text typed in the current burst as one cap.
/// Also returns the time of the key that set it.
pub fn keystroke_caps(keys: &[KeyPress], t: f64, typing: bool) -> Option<(Vec<String>, f64)> {
    const HOLD: f64 = 1.4;
    let end = keys.partition_point(|k| k.t <= t);
    let last = keys[..end].last().filter(|k| t - k.t <= HOLD)?;
    let is_shortcut = |k: &KeyPress| k.modifiers.iter().any(|m| m != "⇧") || k.key.chars().count() > 1;
    if is_shortcut(last) {
        let mut caps = last.modifiers.clone();
        caps.push(last.key.clone());
        return Some((caps, last.t));
    }
    if !typing {
        return None;
    }
    // The run of plain characters typed with short gaps, newest last (up to 28).
    let mut text = String::new();
    let mut previous = last.t;
    for k in keys[..end].iter().rev() {
        if is_shortcut(k) || previous - k.t > 1.0 || text.chars().count() >= 28 {
            break;
        }
        text.insert_str(0, &k.key);
        previous = k.t;
    }
    (!text.trim().is_empty()).then(|| (vec![text], last.t))
}

/// Media items fade in and out over a quarter second.
pub fn overlay_fade(overlay: &MediaOverlay, t: f64) -> f64 {
    ease(((t - overlay.start) / 0.25).min((overlay.end - t) / 0.25).min(1.0))
}

pub use umi_project::captions::caption_lines;

/// Color grade → shader parameters (matching the Swift Core Image chain).
pub fn grade_params(grade: &ColorGrade, _t: f64) -> GradeParams {
    let mut p = GradeParams::IDENTITY;
    if grade.preset != GradePreset::None {
        p.lut = Some(grade.preset);
    }
    if grade.preset == GradePreset::Dreamy {
        p.bloom = 0.45;
    }
    p.manual_exposure = (grade.exposure * 1.5) as f32;
    p.manual_saturation = (1.0 + grade.saturation) as f32;
    p.manual_contrast = (1.0 + grade.contrast * 0.5) as f32;
    p.vignette = (grade.vignette * 1.6) as f32;
    p.grain = grade.grain as f32;
    p
}

fn centered(canvas: Rect, w: f64, h: f64) -> Rect {
    Rect::new(canvas.mid_x() - w / 2.0, canvas.mid_y() - h / 2.0, w, h)
}

fn solid_draw(rect: Rect, color: [f32; 4], alpha: f64) -> Draw {
    Draw {
        size: (rect.width(), rect.height()),
        transform: Homography::rect(rect),
        fill: Fill::Solid(color),
        texture: TexRef::None,
        uv: Rect::UNIT,
        mask: Mask::NONE,
        alpha,
    }
}

fn solid(rect: Rect, color: [f32; 4], target: Target) -> Op {
    Op::Draw { target, draw: solid_draw(rect, color, 1.0) }
}

fn textured(rect: Rect, texture: TexRef, alpha: f64) -> Draw {
    Draw {
        size: (rect.width(), rect.height()),
        transform: Homography::rect(rect),
        fill: Fill::Texture { tint: WHITE, mirror: false },
        texture,
        uv: Rect::UNIT,
        mask: Mask::NONE,
        alpha,
    }
}

fn full_canvas(canvas: Rect, texture: TexRef, uv: Rect, alpha: f64) -> Draw {
    Draw { uv, ..textured(canvas, texture, alpha) }
}

/// A texture cropped to fill `rect` (aspect fill), with rounded corners.
/// The part of the camera frame that keeps the face centered at a comfortable size (the
/// face about 40 % of the bubble's height), staying inside the frame.
fn face_crop(rect: Rect, (w, h): (u32, u32), face: FaceKey) -> Rect {
    let (w, h) = (w as f64, h as f64);
    let target_aspect = rect.width() / rect.height().max(1.0);
    // Crop height in frame-height units, and width to match the bubble's shape.
    let mut ch = (face.size / 0.4).clamp(0.3, 1.0);
    let mut cw = ch * h * target_aspect / w;
    if cw > 1.0 {
        ch /= cw;
        cw = 1.0;
    }
    // Slightly above the face center: eyes sit a bit high in a good frame.
    let cx = (face.x - cw / 2.0).clamp(0.0, 1.0 - cw);
    let cy = (face.y + face.size * 0.08 - ch / 2.0).clamp(0.0, 1.0 - ch);
    Rect::new(cx, cy, cw, ch)
}

fn aspect_fill(rect: Rect, radius: f64, texture: TexRef, (w, h): (u32, u32), mirror: bool, alpha: f64) -> Draw {
    let (w, h) = (w as f64, h as f64);
    let target_aspect = rect.width() / rect.height().max(1.0);
    let uv = if w / h > target_aspect {
        let cw = h * target_aspect / w;
        Rect::new((1.0 - cw) / 2.0, 0.0, cw, 1.0)
    } else {
        let ch = w / target_aspect / h;
        Rect::new(0.0, (1.0 - ch) / 2.0, 1.0, ch)
    };
    Draw {
        size: (rect.width(), rect.height()),
        transform: Homography::rect(rect),
        fill: Fill::Texture { tint: WHITE, mirror },
        texture,
        uv,
        mask: Mask { kind: MaskKind::Rounded, rect: Rect::new(0.0, 0.0, rect.width(), rect.height()), radius },
        alpha,
    }
}

/// A soft shadow for `rect` (canvas px), drawn on a quad grown by 3σ.
fn shadow(rect: Rect, radius: f64, sigma: f64, color: [f32; 4], alpha: f64) -> Draw {
    let grow = sigma * 3.0;
    let quad = rect.inset(-grow, -grow);
    Draw {
        size: (quad.width(), quad.height()),
        transform: Homography::rect(quad),
        fill: Fill::Shadow { color, sigma },
        texture: TexRef::None,
        uv: Rect::UNIT,
        mask: Mask { kind: MaskKind::Rounded, rect: Rect::new(grow, grow, rect.width(), rect.height()), radius },
        alpha,
    }
}

/// A circular ring of `width` inset by `inset` from `rect`'s edge.
fn ring(rect: Rect, width: f64, inset: f64, color: [f32; 4], alpha: f64) -> Draw {
    let r = rect.inset(inset, inset);
    Draw {
        size: (r.width(), r.height()),
        transform: Homography::rect(r),
        fill: Fill::Ring { color, width },
        texture: TexRef::None,
        uv: Rect::UNIT,
        mask: Mask { kind: MaskKind::Rounded, rect: Rect::new(0.0, 0.0, r.width(), r.height()), radius: r.width() / 2.0 },
        alpha,
    }
}

/// Blurs a canvas-sized target in place (via a scratch surface).
fn blur_in_place(target: Target, sigma: f64, canvas: Rect, ops: &mut Vec<Op>) {
    if sigma < 0.3 {
        return;
    }
    ops.push(Op::Blur { src: TexRef::Target(target), dst: Target::Scratch(1), sigma, scale: 0.5 });
    ops.push(Op::Draw { target, draw: full_canvas(canvas, TexRef::Target(Target::Scratch(1)), Rect::UNIT, 1.0) });
}

/// The card layer's full-canvas homography for a 3D move: the screen rect's corners go to
/// their projected positions, everything else on the layer follows.
fn perspective(screen: Rect, extent: Rect, pose: &MovePose) -> Option<Homography> {
    let [tl, tr, br, bl] = perspective_corners(screen, pose);
    let from = [
        Point::new(extent.min_x(), extent.max_y()),
        Point::new(extent.max_x(), extent.max_y()),
        Point::new(extent.max_x(), extent.min_y()),
        Point::new(extent.min_x(), extent.min_y()),
    ];
    Homography::from_points(from, [tl, tr, br, bl])
}

#[cfg(test)]
mod keystroke_tests {
    use super::*;

    fn key(t: f64, key: &str, modifiers: &[&str]) -> KeyPress {
        KeyPress { t, key: key.into(), modifiers: modifiers.iter().map(|m| m.to_string()).collect() }
    }

    #[test]
    fn shows_shortcuts_and_typing() {
        let keys = vec![key(1.0, "h", &[]), key(1.2, "i", &[]), key(1.4, "!", &["⇧"]), key(3.0, "K", &["⇧", "⌘"])];
        assert_eq!(keystroke_caps(&keys, 0.5, true), None);
        assert_eq!(keystroke_caps(&keys, 1.5, true).unwrap().0, vec!["hi!"]);
        assert_eq!(keystroke_caps(&keys, 1.5, false), None, "typing hidden unless asked");
        assert_eq!(keystroke_caps(&keys, 3.5, false).unwrap().0, vec!["⇧", "⌘", "K"]);
        assert_eq!(keystroke_caps(&keys, 5.0, true), None, "gone after the hold");
    }
}
