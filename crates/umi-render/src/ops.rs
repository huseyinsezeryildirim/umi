//! The render plan: GPU-independent operations produced by the planner and executed by the
//! GPU backend. Keeping "what to draw" apart from "how" lets the planner be unit tested
//! and lets other backends (e.g. WebGPU in the browser) reuse it.

use crate::math::{Point, Rect};
use uuid::Uuid;

/// Offscreen surfaces a frame is built in (all canvas sized unless noted).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Target {
    /// Background, then everything composited on top.
    Composite,
    /// Second composite (after zoom) — the planner ping-pongs between the two.
    Composite2,
    /// The screen card (shadow, chrome, screen, cursor) before its 3D move.
    Card,
    /// The screen with privacy masks applied, at its own (content) size.
    Screen { width: u32, height: u32 },
    /// Blur scratch surfaces at a fraction of their source size.
    Scratch(u8),
    /// Graded output.
    Graded,
    /// A whole planned frame (two of them for clip dissolves).
    Frame(u8),
    /// The final frame (sRGB, 8-bit).
    Output,
}

/// A texture a draw samples from.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum TexRef {
    /// No texture (solid, gradient, shadow, ring draws).
    None,
    Screen,
    Camera,
    /// A Media-track / Video 2 video frame.
    Overlay(Uuid),
    /// A CPU-rasterized image (chrome, text card, cursor, decoded image file), by key.
    Raster(String),
    /// Another target's contents.
    Target(Target),
}

/// How a quad is filled.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Fill {
    Solid([f32; 4]),
    /// Texture, tinted (multiplied) by a color.
    Texture {
        tint: [f32; 4],
        mirror: bool,
    },
    /// Gradient between two points in quad-local px.
    Gradient {
        from: Point,
        to: Point,
        a: [f32; 4],
        b: [f32; 4],
    },
    /// Soft shadow of the mask rect.
    Shadow {
        color: [f32; 4],
        sigma: f64,
    },
    /// Stroke of the mask rect.
    Ring {
        color: [f32; 4],
        width: f64,
    },
    /// Texture in blocks of `size` px, anchored at the mask rect's origin.
    Pixelate {
        size: f64,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MaskKind {
    None,
    Rounded,
    Squircle,
    /// Everything except the rounded rect.
    Inverted,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Mask {
    pub kind: MaskKind,
    /// In quad-local px (top-left origin).
    pub rect: Rect,
    pub radius: f64,
}

impl Mask {
    pub const NONE: Mask = Mask { kind: MaskKind::None, rect: Rect::new(0.0, 0.0, 0.0, 0.0), radius: 0.0 };
}

/// A 3×3 homography, row major: canvas(bottom-left px) = H · (local x, local y, 1).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Homography(pub [[f64; 3]; 3]);

/// One textured/filled quad.
#[derive(Debug, Clone, PartialEq)]
pub struct Draw {
    /// Quad size in local px.
    pub size: (f64, f64),
    pub transform: Homography,
    pub fill: Fill,
    pub texture: TexRef,
    /// Sub-rect of the texture, normalized, top-left origin.
    pub uv: Rect,
    pub mask: Mask,
    pub alpha: f64,
}

/// Color grade parameters (see grade.wgsl). Presets are baked 3D LUTs (made from the
/// Swift app's Core Image chains), so colors match on every platform.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct GradeParams {
    pub lut: Option<umi_project::edit::GradePreset>,
    pub bloom: f32,
    pub vignette: f32,
    pub grain: f32,
    pub grain_seed: f32,
    pub manual_exposure: f32,
    pub manual_saturation: f32,
    pub manual_contrast: f32,
    pub manual_brightness: f32,
}

impl GradeParams {
    pub const IDENTITY: GradeParams = GradeParams {
        lut: None,
        bloom: 0.0,
        vignette: 0.0,
        grain: 0.0,
        grain_seed: 0.0,
        manual_exposure: 0.0,
        manual_saturation: 1.0,
        manual_contrast: 1.0,
        manual_brightness: 0.0,
    };

    pub fn is_identity(&self) -> bool {
        *self == Self::IDENTITY
    }
}

#[derive(Debug, Clone, PartialEq)]
#[allow(clippy::large_enum_variant)] // ops live in one reused Vec per renderer; boxing would only add allocations
pub enum Op {
    /// Clear a target (premultiplied color).
    Clear {
        target: Target,
        color: [f32; 4],
    },
    Draw {
        target: Target,
        draw: Draw,
    },
    /// Gaussian blur `src` into `dst` (dst may be smaller: `scale` of the source size).
    Blur {
        src: TexRef,
        dst: Target,
        sigma: f64,
        scale: f64,
    },
    Grade {
        src: Target,
        dst: Target,
        params: GradeParams,
        bloom: Option<Target>,
    },
}

/// Texture sizes the planner needs to place things (aspect fill, card sizes).
pub trait SizeSource {
    fn size(&self, texture: &TexRef) -> Option<(u32, u32)>;
}

impl Homography {
    pub const IDENTITY: Homography = Homography([[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]]);

    /// Maps a quad-local rect (top-left origin, `w`×`h`) onto `rect` in canvas space
    /// (bottom-left origin): local (x, y) → (rect.x + x, rect.max_y − y).
    pub fn rect(rect: Rect) -> Homography {
        Homography([[1.0, 0.0, rect.min_x()], [0.0, -1.0, rect.max_y()], [0.0, 0.0, 1.0]])
    }

    /// Like [`rect`](Self::rect) but stretching a `w`×`h` local quad to fill `rect`.
    pub fn stretch(w: f64, h: f64, rect: Rect) -> Homography {
        Homography([[rect.width() / w, 0.0, rect.min_x()], [0.0, -rect.height() / h, rect.max_y()], [0.0, 0.0, 1.0]])
    }

    pub fn then(&self, next: &Homography) -> Homography {
        let (a, b) = (&self.0, &next.0);
        let mut m = [[0.0; 3]; 3];
        for (i, row) in m.iter_mut().enumerate() {
            for (j, cell) in row.iter_mut().enumerate() {
                *cell = (0..3).map(|k| b[i][k] * a[k][j]).sum();
            }
        }
        Homography(m)
    }

    pub fn apply(&self, p: Point) -> Point {
        let m = &self.0;
        let w = m[2][0] * p.x + m[2][1] * p.y + m[2][2];
        Point::new((m[0][0] * p.x + m[0][1] * p.y + m[0][2]) / w, (m[1][0] * p.x + m[1][1] * p.y + m[1][2]) / w)
    }

    /// The projective map taking the four `from` points to the four `to` points.
    pub fn from_points(from: [Point; 4], to: [Point; 4]) -> Option<Homography> {
        // Solve the 8×8 linear system A·h = b (h33 = 1) by Gaussian elimination.
        let mut a = [[0.0f64; 9]; 8];
        for i in 0..4 {
            let (x, y) = (from[i].x, from[i].y);
            let (u, v) = (to[i].x, to[i].y);
            a[2 * i] = [x, y, 1.0, 0.0, 0.0, 0.0, -u * x, -u * y, u];
            a[2 * i + 1] = [0.0, 0.0, 0.0, x, y, 1.0, -v * x, -v * y, v];
        }
        for col in 0..8 {
            let pivot = (col..8).max_by(|&r1, &r2| a[r1][col].abs().total_cmp(&a[r2][col].abs()))?;
            if a[pivot][col].abs() < 1e-12 {
                return None;
            }
            a.swap(col, pivot);
            let pivot_row = a[col];
            for (row, values) in a.iter_mut().enumerate() {
                if row != col {
                    let f = values[col] / pivot_row[col];
                    for (v, p) in values.iter_mut().zip(pivot_row.iter()).skip(col) {
                        *v -= f * p;
                    }
                }
            }
        }
        let h: Vec<f64> = (0..8).map(|i| a[i][8] / a[i][i]).collect();
        Some(Homography([[h[0], h[1], h[2]], [h[3], h[4], h[5]], [h[6], h[7], 1.0]]))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn homography_maps_corners() {
        let from = [Point::new(0.0, 0.0), Point::new(10.0, 0.0), Point::new(10.0, 10.0), Point::new(0.0, 10.0)];
        let to = [Point::new(1.0, 2.0), Point::new(12.0, 3.0), Point::new(11.0, 14.0), Point::new(0.0, 12.0)];
        let h = Homography::from_points(from, to).unwrap();
        for (f, t) in from.iter().zip(to) {
            let p = h.apply(*f);
            assert!((p.x - t.x).abs() < 1e-6 && (p.y - t.y).abs() < 1e-6);
        }
    }

    #[test]
    fn rect_flips_y() {
        let h = Homography::rect(Rect::new(10.0, 20.0, 100.0, 50.0));
        assert_eq!(h.apply(Point::new(0.0, 0.0)), Point::new(10.0, 70.0));
        assert_eq!(h.apply(Point::new(100.0, 50.0)), Point::new(110.0, 20.0));
    }
}
