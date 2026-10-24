//! Small geometry helpers. Layout math uses canvas pixels with a **bottom-left** origin
//! (like Core Image in the Swift app) so the formulas port one to one; the GPU stage flips.

pub use umi_project::{Point, Rect, Size};

/// easeInOutCubic on 0…1 (input clamped).
pub fn ease(x: f64) -> f64 {
    let x = x.clamp(0.0, 1.0);
    if x < 0.5 { 4.0 * x * x * x } else { 1.0 - (-2.0 * x + 2.0).powi(3) / 2.0 }
}

pub fn lerp(a: f64, b: f64, t: f64) -> f64 {
    a + (b - a) * t
}

pub trait RectExt {
    fn inset(&self, dx: f64, dy: f64) -> Rect;
    fn offset(&self, dx: f64, dy: f64) -> Rect;
    /// Smallest rect with integer coordinates containing this one (`CGRect.integral`).
    fn integral(&self) -> Rect;
    fn lerp(&self, other: &Rect, t: f64) -> Rect;
    fn short_side(&self) -> f64;
}

impl RectExt for Rect {
    fn inset(&self, dx: f64, dy: f64) -> Rect {
        Rect::new(self.min_x() + dx, self.min_y() + dy, self.width() - 2.0 * dx, self.height() - 2.0 * dy)
    }

    fn offset(&self, dx: f64, dy: f64) -> Rect {
        Rect::new(self.min_x() + dx, self.min_y() + dy, self.width(), self.height())
    }

    fn integral(&self) -> Rect {
        let x0 = self.min_x().floor();
        let y0 = self.min_y().floor();
        let x1 = self.max_x().ceil();
        let y1 = self.max_y().ceil();
        Rect::new(x0, y0, x1 - x0, y1 - y0)
    }

    fn lerp(&self, other: &Rect, t: f64) -> Rect {
        Rect::new(
            lerp(self.min_x(), other.min_x(), t),
            lerp(self.min_y(), other.min_y(), t),
            lerp(self.width(), other.width(), t),
            lerp(self.height(), other.height(), t),
        )
    }

    fn short_side(&self) -> f64 {
        self.width().min(self.height())
    }
}

/// A 2D affine transform (column-major like CGAffineTransform: x' = a·x + c·y + tx).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Affine {
    pub a: f64,
    pub b: f64,
    pub c: f64,
    pub d: f64,
    pub tx: f64,
    pub ty: f64,
}

impl Affine {
    pub const IDENTITY: Affine = Affine { a: 1.0, b: 0.0, c: 0.0, d: 1.0, tx: 0.0, ty: 0.0 };

    pub fn translate(tx: f64, ty: f64) -> Self {
        Affine { tx, ty, ..Self::IDENTITY }
    }

    pub fn scale(sx: f64, sy: f64) -> Self {
        Affine { a: sx, d: sy, ..Self::IDENTITY }
    }

    /// `self` then `next` (CGAffineTransform.concatenating).
    pub fn then(&self, next: &Affine) -> Affine {
        Affine {
            a: self.a * next.a + self.b * next.c,
            b: self.a * next.b + self.b * next.d,
            c: self.c * next.a + self.d * next.c,
            d: self.c * next.b + self.d * next.d,
            tx: self.tx * next.a + self.ty * next.c + next.tx,
            ty: self.tx * next.b + self.ty * next.d + next.ty,
        }
    }

    pub fn apply(&self, p: Point) -> Point {
        Point::new(self.a * p.x + self.c * p.y + self.tx, self.b * p.x + self.d * p.y + self.ty)
    }

    pub fn inverse(&self) -> Affine {
        let det = self.a * self.d - self.b * self.c;
        let inv = if det.abs() < 1e-12 { 0.0 } else { 1.0 / det };
        Affine {
            a: self.d * inv,
            b: -self.b * inv,
            c: -self.c * inv,
            d: self.a * inv,
            tx: (self.c * self.ty - self.d * self.tx) * inv,
            ty: (self.b * self.tx - self.a * self.ty) * inv,
        }
    }
}
