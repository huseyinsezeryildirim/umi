//! Where the screen card and the camera sit on the canvas at a moment in time, for every
//! scene layout, blended over transitions. Canvas pixels, bottom-left origin.

use crate::math::{Rect, RectExt, ease, lerp};
use umi_project::edit::{CameraShape, DeviceFrame, EditSettings, SceneLayout};

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SceneState {
    /// Outer rect of the screen card, including device chrome.
    pub screen_rect: Rect,
    pub screen_alpha: f64,
    pub camera_rect: Rect,
    pub camera_radius: f64,
    pub camera_alpha: f64,
    /// How much click/manual zoom applies (none when the canvas is shared with the camera).
    pub zoom_allowance: f64,
}

impl SceneState {
    pub fn lerp(&self, other: &SceneState, t: f64) -> SceneState {
        SceneState {
            screen_rect: self.screen_rect.lerp(&other.screen_rect, t),
            screen_alpha: lerp(self.screen_alpha, other.screen_alpha, t),
            camera_rect: self.camera_rect.lerp(&other.camera_rect, t),
            camera_radius: lerp(self.camera_radius, other.camera_radius, t),
            camera_alpha: lerp(self.camera_alpha, other.camera_alpha, t),
            zoom_allowance: lerp(self.zoom_allowance, other.zoom_allowance, t),
        }
    }
}

/// Computes `SceneState` for each layout and blends between them over time.
#[derive(Debug, Clone)]
pub struct SceneLayoutEngine {
    settings: EditSettings,
    /// Screen aspect ratio (width / height) of the (cropped) recording.
    screen_aspect: f64,
    has_camera: bool,
}

impl SceneLayoutEngine {
    pub fn new(settings: EditSettings, screen_aspect: f64, has_camera: bool) -> Self {
        let mut settings = settings;
        settings.scenes.sort_by(|a, b| a.start.total_cmp(&b.start));
        Self { settings, screen_aspect, has_camera }
    }

    pub fn state(&self, t: f64, canvas: Rect) -> SceneState {
        let segments = &self.settings.scenes;
        let Some(index) = segments.iter().position(|s| t >= s.start && t < s.end) else {
            // After a segment ends, ease back to the default layout.
            if let Some(previous) = segments.iter().rev().find(|s| s.end <= t)
                && t - previous.end < previous.transition
            {
                let p = ease((t - previous.end) / previous.transition);
                return self.state_for(previous.layout, canvas).lerp(&self.state_for(SceneLayout::Default, canvas), p);
            }
            return self.state_for(SceneLayout::Default, canvas);
        };
        let segment = &segments[index];
        let current = self.state_for(segment.layout, canvas);
        let into = t - segment.start;
        if into >= segment.transition {
            return current;
        }
        // Blend from whatever came right before: the previous segment if it touches, else default.
        let before = if index > 0 && (segments[index - 1].end - segment.start).abs() < 0.05 {
            segments[index - 1].layout
        } else {
            SceneLayout::Default
        };
        self.state_for(before, canvas).lerp(&current, ease(into / segment.transition))
    }

    pub fn state_for(&self, layout: SceneLayout, canvas: Rect) -> SceneState {
        let s = &self.settings;
        let short = canvas.short_side();
        let inset = s.padding * short;
        let available = canvas.inset(inset, inset);
        let bubble = self.bubble_rect(canvas);
        let bubble_radius = self.camera_radius(bubble);
        let camera_visible = if self.has_camera && s.camera.visible { 1.0 } else { 0.0 };
        let has_camera = if self.has_camera { 1.0 } else { 0.0 };
        let fit = |b: Rect| DeviceFrameGeometry::fit(s.frame, self.screen_aspect, b);

        match layout {
            SceneLayout::Default => SceneState {
                screen_rect: fit(available),
                screen_alpha: 1.0,
                camera_rect: bubble,
                camera_radius: bubble_radius,
                camera_alpha: camera_visible,
                zoom_allowance: 1.0,
            },
            SceneLayout::HideCamera => SceneState {
                screen_rect: fit(available),
                screen_alpha: 1.0,
                camera_rect: bubble,
                camera_radius: bubble_radius,
                camera_alpha: 0.0,
                zoom_allowance: 1.0,
            },
            SceneLayout::CameraOnly => SceneState {
                screen_rect: fit(available.inset(available.width() * 0.2, available.height() * 0.2)),
                screen_alpha: 0.0,
                camera_rect: available,
                camera_radius: s.corner_radius * available.short_side() * 1.6,
                camera_alpha: has_camera,
                zoom_allowance: 0.0,
            },
            SceneLayout::SplitScreen => {
                let gap = short * 0.03;
                let camera_width = available.width() * 0.34;
                let screen =
                    fit(Rect::new(available.min_x(), available.min_y(), available.width() - camera_width - gap, available.height()));
                let camera = Rect::new(available.max_x() - camera_width, screen.min_y(), camera_width, screen.height());
                SceneState {
                    screen_rect: screen,
                    screen_alpha: 1.0,
                    camera_rect: camera,
                    camera_radius: s.corner_radius * camera.short_side() * 1.6,
                    camera_alpha: has_camera,
                    zoom_allowance: 0.0,
                }
            }
            SceneLayout::Floating => {
                let screen = fit(Rect::new(
                    available.min_x(),
                    available.min_y() + available.height() * 0.1,
                    available.width() * 0.78,
                    available.height() * 0.9,
                ));
                let camera_width = available.width() * 0.3;
                let camera = Rect::new(available.max_x() - camera_width, available.min_y(), camera_width, camera_width * 1.15);
                SceneState {
                    screen_rect: screen,
                    screen_alpha: 1.0,
                    camera_rect: camera,
                    camera_radius: camera_width * 0.08,
                    camera_alpha: has_camera,
                    zoom_allowance: 0.0,
                }
            }
        }
    }

    /// The default camera bubble from the camera settings.
    fn bubble_rect(&self, canvas: Rect) -> Rect {
        let c = &self.settings.camera;
        let d = c.size * canvas.short_side();
        let cx = c.position.x * canvas.width();
        let cy = (1.0 - c.position.y) * canvas.height();
        Rect::new(cx - d / 2.0, cy - d / 2.0, d, d)
    }

    fn camera_radius(&self, rect: Rect) -> f64 {
        match self.settings.camera.shape {
            CameraShape::Circle => rect.width() / 2.0,
            CameraShape::Squircle => rect.width() * 0.24,
            CameraShape::Square => rect.width() * 0.06,
        }
    }
}

/// Proportions of each device frame's chrome, relative to the content (screen) width.
pub struct DeviceFrameGeometry;

#[derive(Debug, Clone, Copy)]
pub struct Insets {
    pub top: f64,
    pub left: f64,
    pub right: f64,
    pub bottom: f64,
}

impl DeviceFrameGeometry {
    pub fn insets(frame: DeviceFrame) -> Insets {
        match frame {
            DeviceFrame::None => Insets { top: 0.0, left: 0.0, right: 0.0, bottom: 0.0 },
            DeviceFrame::MacOs => Insets { top: 0.034, left: 0.0, right: 0.0, bottom: 0.0 },
            DeviceFrame::Windows => Insets { top: 0.032, left: 0.0, right: 0.0, bottom: 0.0 },
            DeviceFrame::Browser => Insets { top: 0.062, left: 0.0, right: 0.0, bottom: 0.0 },
            // Bezel all around, plus the wider base below.
            DeviceFrame::MacBook => Insets { top: 0.032, left: 0.09, right: 0.09, bottom: 0.068 },
            // An even bezel all around.
            DeviceFrame::Phone => Insets { top: 0.05, left: 0.05, right: 0.05, bottom: 0.05 },
        }
    }

    /// Largest outer rect in `bx` whose content keeps `aspect`.
    pub fn fit(frame: DeviceFrame, aspect: f64, bx: Rect) -> Rect {
        let i = Self::insets(frame);
        let width_factor = 1.0 + i.left + i.right;
        let height_factor = 1.0 / aspect + i.top + i.bottom;
        let content_width = (bx.width() / width_factor).min(bx.height() / height_factor);
        let (w, h) = (content_width * width_factor, content_width * height_factor);
        Rect::new(bx.mid_x() - w / 2.0, bx.mid_y() - h / 2.0, w, h).integral()
    }

    /// The screen content inside an outer frame rect (bottom-left origin).
    pub fn content_rect(frame: DeviceFrame, outer: Rect) -> Rect {
        let i = Self::insets(frame);
        let content_width = outer.width() / (1.0 + i.left + i.right);
        Rect::new(
            outer.min_x() + i.left * content_width,
            outer.min_y() + i.bottom * content_width,
            content_width,
            outer.height() - (i.top + i.bottom) * content_width,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_layout_fits_with_padding() {
        let edit = EditSettings::default();
        let engine = SceneLayoutEngine::new(edit, 16.0 / 9.0, true);
        let s = engine.state(0.0, Rect::new(0.0, 0.0, 1920.0, 1080.0));
        // padding 0.08 of 1080 = 86.4 → available height 907.2, width follows 16:9.
        assert!((s.screen_rect.height() - 908.0).abs() <= 1.0, "{:?}", s.screen_rect);
        assert_eq!(s.camera_alpha, 1.0);
    }
}
