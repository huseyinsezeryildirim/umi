//! Device chrome around the screen: macOS and Windows title bars, a browser bar, and the
//! MacBook bezel with its base. The content area is left transparent.

use super::{RasterImage, from_pixmap};
use crate::scene::DeviceFrameGeometry;
use tiny_skia::{
    Color, FillRule, GradientStop, LinearGradient, Paint, PathBuilder, Pixmap, Point as SkPoint, Rect as SkRect, Shader, SpreadMode,
    Stroke, Transform,
};
use umi_project::Rect;
use umi_project::edit::DeviceFrame;

/// Corner radius of the screen inside the chrome (`None` for no chrome).
pub fn content_radius(frame: DeviceFrame, outer_width: f64) -> Option<f64> {
    let insets = DeviceFrameGeometry::insets(frame);
    let cw = outer_width / (1.0 + insets.left + insets.right);
    match frame {
        DeviceFrame::None => None,
        DeviceFrame::MacOs | DeviceFrame::Browser => Some(cw * 0.012),
        DeviceFrame::Windows | DeviceFrame::MacBook => Some(cw * 0.004),
    }
}

fn gray(v: f32, a: f32) -> Color {
    Color::from_rgba(v, v, v, a).unwrap_or(Color::BLACK)
}

fn paint(color: Color) -> Paint<'static> {
    let mut p = Paint::default();
    p.set_color(color);
    p.anti_alias = true;
    p
}

fn rounded(r: Rect, radius: f64) -> Option<tiny_skia::Path> {
    let mut pb = PathBuilder::new();
    let (x, y, w, h) = (r.min_x() as f32, r.min_y() as f32, r.width() as f32, r.height() as f32);
    let rad = (radius as f32).min(w / 2.0).min(h / 2.0);
    // Rounded rect from lines and quarter-circle cubics.
    let k = 0.552_284_8 * rad;
    pb.move_to(x + rad, y);
    pb.line_to(x + w - rad, y);
    pb.cubic_to(x + w - rad + k, y, x + w, y + rad - k, x + w, y + rad);
    pb.line_to(x + w, y + h - rad);
    pb.cubic_to(x + w, y + h - rad + k, x + w - rad + k, y + h, x + w - rad, y + h);
    pb.line_to(x + rad, y + h);
    pb.cubic_to(x + rad - k, y + h, x, y + h - rad + k, x, y + h - rad);
    pb.line_to(x, y + rad);
    pb.cubic_to(x, y + rad - k, x + rad - k, y, x + rad, y);
    pb.close();
    pb.finish()
}

fn ellipse(r: Rect) -> Option<tiny_skia::Path> {
    PathBuilder::from_oval(SkRect::from_xywh(r.min_x() as f32, r.min_y() as f32, r.width() as f32, r.height() as f32)?)
}

/// Draws the chrome for an outer rect of `width`×`height` px (top-left origin).
pub fn draw(frame: DeviceFrame, width: u32, height: u32) -> Option<RasterImage> {
    let mut pm = Pixmap::new(width.max(1), height.max(1))?;
    let (w, h) = (width as f64, height as f64);
    // Content rect in top-left coordinates (DeviceFrameGeometry is bottom-left).
    let c_bl = DeviceFrameGeometry::content_rect(frame, Rect::new(0.0, 0.0, w, h));
    let content = Rect::new(c_bl.min_x(), h - c_bl.max_y(), c_bl.width(), c_bl.height());
    let cw = content.width();
    let bounds = Rect::new(0.0, 0.0, w, h);
    let title_bar = Rect::new(content.min_x(), 0.0, content.width(), content.min_y());
    let t = Transform::identity();

    match frame {
        DeviceFrame::None => return None,
        DeviceFrame::MacOs | DeviceFrame::Browser => {
            pm.fill_path(&rounded(bounds, cw * 0.012)?, &paint(gray(0.96, 1.0)), FillRule::Winding, t, None);
            // Title bar separator.
            pm.fill_rect(
                SkRect::from_xywh(0.0, (content.min_y() - (cw * 0.0008).max(1.0)) as f32, w as f32, (cw * 0.0008).max(1.0) as f32)?,
                &paint(gray(0.84, 1.0)),
                t,
                None,
            );
            // Traffic lights.
            let d = cw * 0.0105;
            let gap = d * 0.75;
            let cy = title_bar.mid_y();
            let lights = [Color::from_rgba8(255, 94, 87, 255), Color::from_rgba8(255, 189, 46, 255), Color::from_rgba8(40, 201, 64, 255)];
            for (i, color) in lights.into_iter().enumerate() {
                let r = Rect::new(cw * 0.014 + i as f64 * (d + gap), cy - d / 2.0, d, d);
                pm.fill_path(&ellipse(r)?, &paint(color), FillRule::Winding, t, None);
            }
            if frame == DeviceFrame::Browser {
                // Address bar pill with a lock and a faint URL line.
                let pill = Rect::new(bounds.mid_x() - cw * 0.22, cy - title_bar.height() * 0.27, cw * 0.44, title_bar.height() * 0.54);
                let path = rounded(pill, pill.height() / 2.0)?;
                pm.fill_path(&path, &paint(gray(1.0, 1.0)), FillRule::Winding, t, None);
                pm.stroke_path(
                    &path,
                    &paint(gray(0.82, 1.0)),
                    &Stroke { width: (cw * 0.0007).max(1.0) as f32, ..Default::default() },
                    t,
                    None,
                );
                let lock = pill.height() * 0.32;
                pm.fill_rect(
                    SkRect::from_xywh(
                        (pill.min_x() + pill.height() * 0.5) as f32,
                        (pill.mid_y() - lock * 0.35) as f32,
                        (lock * 0.8) as f32,
                        (lock * 0.7) as f32,
                    )?,
                    &paint(gray(0.55, 1.0)),
                    t,
                    None,
                );
                let url = Rect::new(
                    pill.min_x() + pill.height() * 1.1,
                    pill.mid_y() - pill.height() * 0.09,
                    pill.width() * 0.32,
                    pill.height() * 0.18,
                );
                pm.fill_path(&rounded(url, pill.height() * 0.09)?, &paint(gray(0.78, 1.0)), FillRule::Winding, t, None);
            }
        }
        DeviceFrame::Windows => {
            pm.fill_path(&rounded(bounds, cw * 0.004)?, &paint(gray(0.98, 1.0)), FillRule::Winding, t, None);
            let line = (cw * 0.0008).max(1.0);
            pm.fill_rect(SkRect::from_xywh(0.0, (content.min_y() - line) as f32, w as f32, line as f32)?, &paint(gray(0.86, 1.0)), t, None);
            // Minimize, maximize, close glyphs on the right.
            let g = title_bar.height() * 0.3;
            let cy = title_bar.mid_y();
            let step = title_bar.height() * 1.45;
            let stroke = Stroke { width: line as f32, ..Default::default() };
            let ink = paint(gray(0.25, 1.0));
            let mut x = bounds.max_x() - step * 2.5;
            let mut pb = PathBuilder::new();
            pb.move_to((x - g / 2.0) as f32, cy as f32);
            pb.line_to((x + g / 2.0) as f32, cy as f32);
            x += step;
            pb.push_rect(SkRect::from_xywh((x - g / 2.0) as f32, (cy - g / 2.0) as f32, g as f32, g as f32)?);
            x += step;
            pb.move_to((x - g / 2.0) as f32, (cy - g / 2.0) as f32);
            pb.line_to((x + g / 2.0) as f32, (cy + g / 2.0) as f32);
            pb.move_to((x - g / 2.0) as f32, (cy + g / 2.0) as f32);
            pb.line_to((x + g / 2.0) as f32, (cy - g / 2.0) as f32);
            pm.stroke_path(&pb.finish()?, &ink, &stroke, t, None);
        }
        DeviceFrame::MacBook => {
            // Lid: black bezel with rounded corners around the content.
            let bezel = cw * 0.032;
            let lid =
                Rect::new(content.min_x() - bezel, content.min_y() - bezel, content.width() + bezel * 2.0, content.height() + bezel * 2.0);
            let lid_radius = cw * 0.03;
            pm.fill_path(&rounded(lid, lid_radius)?, &paint(gray(0.08, 1.0)), FillRule::Winding, t, None);
            let edge = Rect::new(lid.min_x() + 1.0, lid.min_y() + 1.0, lid.width() - 2.0, lid.height() - 2.0);
            pm.stroke_path(
                &rounded(edge, lid_radius)?,
                &paint(gray(0.35, 1.0)),
                &Stroke { width: (cw * 0.0012).max(1.0) as f32, ..Default::default() },
                t,
                None,
            );
            // Base: a wider aluminium slab with a thumb notch.
            let base_top = lid.max_y();
            let base = Rect::new(0.0, base_top, w, h - base_top);
            let shader = LinearGradient::new(
                SkPoint::from_xy(0.0, h as f32),
                SkPoint::from_xy(0.0, base_top as f32),
                vec![
                    GradientStop::new(0.0, gray(0.62, 1.0)),
                    GradientStop::new(0.6, gray(0.86, 1.0)),
                    GradientStop::new(1.0, gray(0.78, 1.0)),
                ],
                SpreadMode::Pad,
                Transform::identity(),
            )
            .unwrap_or(Shader::SolidColor(gray(0.8, 1.0)));
            let mut base_paint = Paint { shader, ..Default::default() };
            base_paint.anti_alias = true;
            pm.fill_path(&rounded(base, base.height() * 0.45)?, &base_paint, FillRule::Winding, t, None);
            let notch_h = base.height() * 0.45;
            let notch = Rect::new(bounds.mid_x() - cw * 0.08, base_top, cw * 0.16, notch_h);
            pm.fill_path(&rounded(notch, notch_h * 0.5)?, &paint(gray(0.6, 1.0)), FillRule::Winding, t, None);
        }
    }

    // Leave the content area empty; the screen is composited there.
    let mut clear = Paint::default();
    clear.set_color(Color::TRANSPARENT);
    clear.blend_mode = tiny_skia::BlendMode::Clear;
    pm.fill_rect(
        SkRect::from_xywh(content.min_x() as f32, content.min_y() as f32, content.width() as f32, content.height() as f32)?,
        &clear,
        t,
        None,
    );
    Some(from_pixmap(pm))
}
