//! Motion over time: the smoothed cursor, the zoom level/focus and 3D camera moves.

use crate::math::{Point, Rect, ease};
use umi_project::edit::{CameraMove, MoveKind, Zoom, ZoomSegment};
use umi_project::project::{CursorClick, CursorData, CursorMove};
use umi_project::zoom::auto_segments;

/// Cursor position over time, raw or spring-smoothed. Normalized to the captured area,
/// top-left origin.
#[derive(Debug, Clone, Default)]
pub struct CursorTrack {
    times: Vec<f64>,
    points: Vec<Point>,
    pub clicks: Vec<CursorClick>,
}

const STEP: f64 = 1.0 / 120.0;

impl CursorTrack {
    pub fn new(data: &CursorData, duration: f64, spring: Option<(f64, f64)>) -> Self {
        let clicks = data.clicks.clone();
        let raw = &data.moves;
        let Some(first) = raw.first() else { return Self { clicks, ..Default::default() } };
        let Some((tension, friction)) = spring else {
            return Self { times: raw.iter().map(|m| m.t).collect(), points: raw.iter().map(|m| Point::new(m.x, m.y)).collect(), clicks };
        };

        // Integrate a damped spring chasing the raw cursor at a fixed rate.
        let capacity = (duration / STEP) as usize + 2;
        let mut times = Vec::with_capacity(capacity);
        let mut points = Vec::with_capacity(capacity);
        let (mut t, mut index) = (0.0, 0usize);
        let mut position = Point::new(first.x, first.y);
        let (mut vx, mut vy) = (0.0, 0.0);
        while t <= duration + STEP {
            while index + 1 < raw.len() && raw[index + 1].t <= t {
                index += 1;
            }
            let target = interpolate(raw, t, index);
            let ax = tension * (target.x - position.x) - friction * vx;
            let ay = tension * (target.y - position.y) - friction * vy;
            vx += ax * STEP;
            vy += ay * STEP;
            position.x += vx * STEP;
            position.y += vy * STEP;
            times.push(t);
            points.push(position);
            t += STEP;
        }
        Self { times, points, clicks }
    }

    pub fn is_empty(&self) -> bool {
        self.points.is_empty()
    }

    pub fn position(&self, t: f64) -> Option<Point> {
        let (first, last) = (*self.times.first()?, *self.times.last()?);
        if t <= first {
            return self.points.first().copied();
        }
        if t >= last {
            return self.points.last().copied();
        }
        // Last sample at or before t.
        let low = self.times.partition_point(|&x| x <= t).saturating_sub(1);
        let next = (low + 1).min(self.times.len() - 1);
        let span = self.times[next] - self.times[low];
        let f = if span > 0.0 { (t - self.times[low]) / span } else { 0.0 };
        let (a, b) = (self.points[low], self.points[next]);
        Some(Point::new(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f))
    }
}

fn interpolate(raw: &[CursorMove], t: f64, index: usize) -> Point {
    let a = raw[index];
    if index + 1 >= raw.len() || t <= a.t {
        return Point::new(a.x, a.y);
    }
    let b = raw[index + 1];
    let f = ((t - a.t) / (b.t - a.t).max(0.0001)).clamp(0.0, 1.0);
    Point::new(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f)
}

/// Zoom level and focus over time, from manual and generated segments.
#[derive(Debug, Clone)]
pub struct ZoomTrack {
    pub segments: Vec<ZoomSegment>,
    /// A slow, heavily damped cursor the zoom follows, so the view glides.
    follow: CursorTrack,
}

const RAMP: f64 = 0.5;

impl ZoomTrack {
    pub fn new(settings: &Zoom, cursor: &CursorData, duration: f64) -> Self {
        let mut segments = settings.segments.clone();
        if settings.auto {
            segments.extend(auto_segments(&cursor.clicks, settings.scale, duration));
        }
        segments.sort_by(|a, b| a.start.total_cmp(&b.start));
        Self { segments, follow: CursorTrack::new(cursor, duration, Some((30.0, 11.0))) }
    }

    /// Zoom factor (≥ 1) and focus, normalized to the screen (top-left origin).
    pub fn state(&self, t: f64) -> (f64, Point) {
        let mut best: Option<(f64, &ZoomSegment)> = None;
        for segment in self.segments.iter().filter(|s| t >= s.start && t <= s.end) {
            let ramp = RAMP.min((segment.end - segment.start) / 2.0);
            let amount = ((t - segment.start) / ramp).min((segment.end - t) / ramp).min(1.0);
            if amount > best.map_or(0.0, |b| b.0) {
                best = Some((amount, segment));
            }
        }
        let Some((amount, segment)) = best else { return (1.0, Point::new(0.5, 0.5)) };
        let eased = ease(amount);
        let focus = segment.focus.or_else(|| self.follow.position(t)).unwrap_or(Point::new(0.5, 0.5));
        (1.0 + (segment.scale - 1.0) * eased, focus)
    }
}

/// Pose of an active 3D move: rotation (radians), scale, shift (canvas px) and how far in
/// (0…1, for the background focus blur).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MovePose {
    pub yaw: f64,
    pub pitch: f64,
    pub scale: f64,
    pub shift: Point,
    pub amount: f64,
}

pub fn move_pose(moves: &[CameraMove], t: f64, canvas: Rect) -> Option<MovePose> {
    let mv = moves.iter().find(|m| t >= m.start && t <= m.end)?;
    let duration = (mv.end - mv.start).max(0.1);
    let p = (t - mv.start) / duration;
    let ramp = 1.0f64.min((t - mv.start) / 0.6).min((mv.end - t) / 0.6);
    let amount = ease(ramp);
    let w = canvas.width();
    Some(match mv.kind {
        // Tilted, sliding from right to left across the frame.
        MoveKind::Glide => MovePose {
            yaw: -0.32 * amount,
            pitch: 0.12 * amount,
            scale: 1.0 + 0.12 * amount,
            shift: Point::new((0.12 - 0.24 * p) * w * amount, 0.0),
            amount,
        },
        // Starts leaning back and flattens out.
        MoveKind::Unfold => {
            let lean = (1.0 - ease((p / 0.6).min(1.0))) * 0.75 + 0.08;
            MovePose { yaw: 0.0, pitch: lean * amount, scale: 1.0, shift: Point::default(), amount }
        }
        // Close and tilted, pulling back to show the whole frame.
        MoveKind::PullBack => {
            let q = ease(p);
            MovePose {
                yaw: (0.25 - 0.4 * q) * amount,
                pitch: 0.18 * amount,
                scale: 1.0 + (0.45 - 0.6 * q) * amount,
                shift: Point::default(),
                amount,
            }
        }
    })
}

/// Corners of `rect` rotated by yaw/pitch around its center, scaled and shifted, as seen by
/// a camera at 2.2× the rect's longest side: top-left, top-right, bottom-right, bottom-left.
pub fn perspective_corners(rect: Rect, pose: &MovePose) -> [Point; 4] {
    let (cx, cy) = (rect.mid_x(), rect.mid_y());
    let distance = rect.width().max(rect.height()) * 2.2;
    let project = |x: f64, y: f64| {
        let (mut px, mut py, mut pz) = (x, y, 0.0);
        let x1 = px * pose.yaw.cos() + pz * pose.yaw.sin();
        let z1 = -px * pose.yaw.sin() + pz * pose.yaw.cos();
        px = x1;
        pz = z1;
        let y2 = py * pose.pitch.cos() - pz * pose.pitch.sin();
        let z2 = py * pose.pitch.sin() + pz * pose.pitch.cos();
        py = y2;
        pz = z2;
        let f = distance / (distance + pz);
        Point::new(cx + px * f * pose.scale + pose.shift.x, cy + py * f * pose.scale + pose.shift.y)
    };
    let (hw, hh) = (rect.width() / 2.0, rect.height() / 2.0);
    [project(-hw, hh), project(hw, hh), project(hw, -hh), project(-hw, -hh)]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spring_cursor_settles_on_target() {
        let data = CursorData { moves: vec![CursorMove { t: 0.0, x: 0.0, y: 0.0 }, CursorMove { t: 0.1, x: 1.0, y: 1.0 }], clicks: vec![] };
        let track = CursorTrack::new(&data, 3.0, Some((170.0, 26.0)));
        let p = track.position(3.0).unwrap();
        assert!((p.x - 1.0).abs() < 0.01 && (p.y - 1.0).abs() < 0.01);
        let early = track.position(0.05).unwrap();
        assert!(early.x < 0.5);
    }

    #[test]
    fn zoom_ramps_in_and_out() {
        let z = Zoom {
            auto: false,
            scale: 2.0,
            segments: vec![ZoomSegment { id: uuid::Uuid::nil(), start: 1.0, end: 3.0, scale: 2.0, focus: Some(Point::new(0.2, 0.3)) }],
        };
        let track = ZoomTrack::new(&z, &CursorData::default(), 5.0);
        assert_eq!(track.state(0.5).0, 1.0);
        assert!((track.state(2.0).0 - 2.0).abs() < 1e-9);
        assert_eq!(track.state(2.0).1, Point::new(0.2, 0.3));
        let mid = track.state(1.25).0;
        assert!(mid > 1.0 && mid < 2.0);
    }
}
