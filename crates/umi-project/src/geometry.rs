//! Points, sizes and rects encoded like CoreGraphics' Codable conformances:
//! `CGPoint` → `[x, y]`, `CGSize` → `[w, h]`, `CGRect` → `[[x, y], [w, h]]`.

use serde::{Deserialize, Deserializer, Serialize, Serializer};

#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

impl Point {
    pub const fn new(x: f64, y: f64) -> Self {
        Self { x, y }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Size {
    pub width: f64,
    pub height: f64,
}

impl Size {
    pub const fn new(width: f64, height: f64) -> Self {
        Self { width, height }
    }
}

/// A rectangle with a top-left origin (as stored; the renderer converts as needed).
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Rect {
    pub origin: Point,
    pub size: Size,
}

impl Rect {
    pub const fn new(x: f64, y: f64, width: f64, height: f64) -> Self {
        Self { origin: Point::new(x, y), size: Size::new(width, height) }
    }

    pub const UNIT: Rect = Rect::new(0.0, 0.0, 1.0, 1.0);

    pub fn min_x(&self) -> f64 {
        self.origin.x
    }
    pub fn min_y(&self) -> f64 {
        self.origin.y
    }
    pub fn max_x(&self) -> f64 {
        self.origin.x + self.size.width
    }
    pub fn max_y(&self) -> f64 {
        self.origin.y + self.size.height
    }
    pub fn width(&self) -> f64 {
        self.size.width
    }
    pub fn height(&self) -> f64 {
        self.size.height
    }
    pub fn mid_x(&self) -> f64 {
        self.origin.x + self.size.width / 2.0
    }
    pub fn mid_y(&self) -> f64 {
        self.origin.y + self.size.height / 2.0
    }

    pub fn contains(&self, p: Point) -> bool {
        p.x >= self.min_x() && p.x <= self.max_x() && p.y >= self.min_y() && p.y <= self.max_y()
    }

    /// Overlap of two rects (empty → `None`).
    pub fn intersection(&self, other: &Rect) -> Option<Rect> {
        let x0 = self.min_x().max(other.min_x());
        let y0 = self.min_y().max(other.min_y());
        let x1 = self.max_x().min(other.max_x());
        let y1 = self.max_y().min(other.max_y());
        (x1 > x0 && y1 > y0).then(|| Rect::new(x0, y0, x1 - x0, y1 - y0))
    }
}

impl Serialize for Point {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        [self.x, self.y].serialize(s)
    }
}

impl<'de> Deserialize<'de> for Point {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let [x, y] = <[f64; 2]>::deserialize(d)?;
        Ok(Point { x, y })
    }
}

impl Serialize for Size {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        [self.width, self.height].serialize(s)
    }
}

impl<'de> Deserialize<'de> for Size {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let [width, height] = <[f64; 2]>::deserialize(d)?;
        Ok(Size { width, height })
    }
}

impl Serialize for Rect {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        (self.origin, self.size).serialize(s)
    }
}

impl<'de> Deserialize<'de> for Rect {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let (origin, size) = <(Point, Size)>::deserialize(d)?;
        Ok(Rect { origin, size })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_like_core_graphics() {
        let r = Rect::new(1.0, 2.0, 3.0, 4.0);
        assert_eq!(serde_json::to_string(&r).unwrap(), "[[1.0,2.0],[3.0,4.0]]");
        let back: Rect = serde_json::from_str("[[1,2],[3,4]]").unwrap();
        assert_eq!(back, r);
    }
}
