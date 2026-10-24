//! The arrow cursor drawn on recordings (the OS cursor is hidden while capturing, so the
//! renderer draws its own, identical on every platform). Rasterized at 4× its point size.

use super::{RasterImage, from_pixmap};
use tiny_skia::{Color, FillRule, Paint, PathBuilder, Pixmap, Stroke, Transform};
use umi_project::{Point, Size};

/// Size and hot spot in points (top-left origin), like the macOS arrow.
pub const SIZE: Size = Size::new(17.0, 25.0);
pub const HOT_SPOT: Point = Point::new(4.0, 3.0);

const SCALE: f32 = 4.0;

pub fn arrow() -> RasterImage {
    let (w, h) = ((SIZE.width as f32 * SCALE) as u32, (SIZE.height as f32 * SCALE) as u32);
    let mut pm = Pixmap::new(w, h).expect("cursor pixmap");
    // Classic arrow outline, tip at the hot spot (points).
    let shape = [(0.0, 0.0), (0.0, 16.3), (3.9, 12.6), (6.5, 18.7), (9.1, 17.6), (6.6, 11.7), (11.8, 11.7)];
    let mut pb = PathBuilder::new();
    for (i, (x, y)) in shape.iter().enumerate() {
        let (px, py) = ((HOT_SPOT.x as f32 + x) * SCALE, (HOT_SPOT.y as f32 + y) * SCALE);
        if i == 0 { pb.move_to(px, py) } else { pb.line_to(px, py) }
    }
    pb.close();
    let Some(path) = pb.finish() else { return from_pixmap(pm) };

    // Soft drop shadow, then white outline, then black fill.
    let mut shadow = Paint::default();
    shadow.set_color(Color::from_rgba(0.0, 0.0, 0.0, 0.28).unwrap_or(Color::BLACK));
    shadow.anti_alias = true;
    pm.stroke_path(
        &path,
        &shadow,
        &Stroke { width: 3.4 * SCALE, line_join: tiny_skia::LineJoin::Round, ..Default::default() },
        Transform::from_translate(0.0, 0.8 * SCALE),
        None,
    );
    let mut white = Paint::default();
    white.set_color(Color::WHITE);
    white.anti_alias = true;
    pm.stroke_path(
        &path,
        &white,
        &Stroke { width: 2.2 * SCALE, line_join: tiny_skia::LineJoin::Round, ..Default::default() },
        Transform::identity(),
        None,
    );
    let mut black = Paint::default();
    black.set_color(Color::BLACK);
    black.anti_alias = true;
    pm.fill_path(&path, &black, FillRule::Winding, Transform::identity(), None);
    from_pixmap(pm)
}
