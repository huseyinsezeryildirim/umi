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
        Self {
            cursor: CursorTrack::new(cursor_data, project.duration, settings.cursor.smoothing.spring()),
            zoom: ZoomTrack::new(&settings.zoom, cursor_data, project.duration),
            scenes: SceneLayoutEngine::new(settings.clone(), aspect, project.camera.is_some()),
            settings,
            project,
            apply_zoom_and_moves,
        }
    }

    pub fn zoom_segments(&self) -> &[ZoomSegment] {
        &self.zoom.segments
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

        let screen_content = DeviceFrameGeometry::content_rect(s.frame, scene.screen_rect);
        for overlay in &active_overlays {
            self.plan_overlay(overlay, inputs, canvas, screen_content, assets, composite, ops);
        }

        if inputs.has_camera && scene.camera_alpha > 0.001 {
            self.plan_camera(assets, scene.camera_rect, scene.camera_radius, scene.camera_alpha, short, composite, ops);
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
            // Mask rect (normalized to the full recording) → layer px (top-left origin).
            let local = Rect::new(
                (mask.rect.min_x() - crop.min_x()) / crop.width() * layer.width(),
                (mask.rect.min_y() - crop.min_y()) / crop.height() * layer.height(),
                mask.rect.width() / crop.width() * layer.width(),
                mask.rect.height() / crop.height() * layer.height(),
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
    fn plan_camera(&self, assets: &mut dyn Assets, rect: Rect, radius: f64, alpha: f64, _short: f64, target: Target, ops: &mut Vec<Op>) {
        let Some(size) = assets.size(&TexRef::Camera) else { return };
        let side = rect.short_side();
        ops.push(Op::Draw { target, draw: shadow(rect.offset(0.0, -side * 0.02), radius, side * 0.04, black(0.4 * alpha), 1.0) });
        ops.push(Op::Draw { target, draw: aspect_fill(rect, radius, TexRef::Camera, size, self.settings.camera.mirrored, alpha) });
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
        let lines = caption_lines(&c.words);
        let Some(line) = lines.iter().find(|l| t >= l[0].start - 0.05 && t <= l[l.len() - 1].end + 0.4) else { return };
        let active = if c.highlight_active_word { line.iter().position(|w| t >= w.start && t < w.end) } else { None };
        let words: Vec<String> = line.iter().map(|w| w.text.clone()).collect();
        let Some((key, (w, h))) = assets.caption(&words, active, canvas.height() * c.size, ACCENT) else { return };
        let (w, h) = (w as f64, h as f64);
        let center = Point::new(canvas.mid_x(), (1.0 - c.position) * canvas.height());
        ops.push(Op::Draw { target, draw: textured(Rect::new(center.x - w / 2.0, center.y - h / 2.0, w, h), TexRef::Raster(key), 1.0) });
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

/// Media items fade in and out over a quarter second.
pub fn overlay_fade(overlay: &MediaOverlay, t: f64) -> f64 {
    ease(((t - overlay.start) / 0.25).min((overlay.end - t) / 0.25).min(1.0))
}

/// Groups caption words into short lines: up to 7 words or 2.6 s, breaking at sentence ends
/// and pauses.
pub fn caption_lines(words: &[CaptionWord]) -> Vec<Vec<CaptionWord>> {
    let mut sorted = words.to_vec();
    sorted.sort_by(|a, b| a.start.total_cmp(&b.start));
    let (mut lines, mut current): (Vec<Vec<CaptionWord>>, Vec<CaptionWord>) = (vec![], vec![]);
    for word in sorted {
        if let Some(first) = current.first() {
            let gap = current.last().is_some_and(|l| word.start - l.end > 0.8);
            if current.len() >= 7 || word.end - first.start > 2.6 || gap {
                lines.push(std::mem::take(&mut current));
            }
        }
        let ends = word.text.ends_with(['.', '?', '!']);
        current.push(word);
        if ends {
            lines.push(std::mem::take(&mut current));
        }
    }
    if !current.is_empty() {
        lines.push(current);
    }
    lines
}

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
