//! Motion over time: the smoothed cursor, the zoom level/focus and 3D camera moves.

use crate::math::{Point, Rect, ease};
use umi_project::edit::{CameraMove, MoveKind, Zoom, ZoomFollow, ZoomSegment};
use umi_project::project::{CursorClick, CursorData, CursorMove, MouseButton};
use umi_project::zoom::generated_segments;

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
    loupes: Vec<ZoomSegment>,
    /// The point a cursor-following zoom looks at: a slow, damped cursor (so the view
    /// glides), or a point that pans from click to click.
    follow: CursorTrack,
    ramp: f64,
    glide: bool,
}

/// Zooms closer than this stay zoomed in and glide from one to the next.
const GLIDE_GAP: f64 = 1.6;

impl ZoomTrack {
    pub fn new(settings: &Zoom, cursor: &CursorData, duration: f64) -> Self {
        let mut segments = settings.segments.clone();
        if settings.auto {
            segments.extend(generated_segments(settings, cursor, duration));
        }
        segments.sort_by(|a, b| a.start.total_cmp(&b.start));
        // Magnifiers are drawn on their own; the view zoom ignores them.
        let (loupes, segments): (Vec<ZoomSegment>, Vec<ZoomSegment>) = segments.into_iter().partition(|s| s.loupe);
        let spring = Some(settings.speed.spring());
        let follow = match settings.follow {
            ZoomFollow::Cursor => CursorTrack::new(cursor, duration, spring),
            ZoomFollow::Clicks => CursorTrack::new(&click_path(cursor), duration, spring),
        };
        Self { segments, loupes, follow, ramp: settings.speed.ramp(), glide: settings.glide }
    }

    /// The magnifier at `t`: how far in (0…1, eased), its magnification and focus.
    pub fn loupe(&self, t: f64) -> Option<(f64, f64, Point)> {
        let segment = self.loupes.iter().find(|s| t >= s.start && t <= s.end)?;
        let ramp = self.ramp.min((segment.end - segment.start) / 2.0);
        let amount = ease(((t - segment.start) / ramp).min((segment.end - t) / ramp).min(1.0));
        Some((amount, segment.scale, self.focus(segment, t)))
    }

    /// All segments (view zooms and magnifiers), for the timeline.
    pub fn all(&self) -> Vec<ZoomSegment> {
        let mut all: Vec<ZoomSegment> = self.segments.iter().chain(&self.loupes).cloned().collect();
        all.sort_by(|a, b| a.start.total_cmp(&b.start));
        all
    }

    /// Zoom factor (≥ 1) and focus, normalized to the screen (top-left origin).
    pub fn state(&self, t: f64) -> (f64, Point) {
        if self.glide {
            return self.glided(t);
        }
        let mut best: Option<(f64, &ZoomSegment)> = None;
        for segment in self.segments.iter().filter(|s| t >= s.start && t <= s.end) {
            let ramp = self.ramp.min((segment.end - segment.start) / 2.0);
            let amount = ((t - segment.start) / ramp).min((segment.end - t) / ramp).min(1.0);
            if amount > best.map_or(0.0, |b| b.0) {
                best = Some((amount, segment));
            }
        }
        let Some((amount, segment)) = best else { return (1.0, Point::new(0.5, 0.5)) };
        let eased = ease(amount);
        (1.0 + (segment.scale - 1.0) * eased, self.focus(segment, t))
    }

    fn focus(&self, segment: &ZoomSegment, t: f64) -> Point {
        segment.focus.or_else(|| self.follow.position(t)).unwrap_or(Point::new(0.5, 0.5))
    }

    /// Zooms close together form one run: in at its start, out at its end, and in between
    /// the scale and focus glide from one zoom to the next.
    fn glided(&self, t: f64) -> (f64, Point) {
        // The run around t.
        let mut run: Option<(usize, usize)> = None;
        let mut i = 0;
        while i < self.segments.len() {
            let first = i;
            let mut end = self.segments[i].end;
            while i + 1 < self.segments.len() && self.segments[i + 1].start - end < GLIDE_GAP {
                i += 1;
                end = end.max(self.segments[i].end);
            }
            if t >= self.segments[first].start && t <= end {
                run = Some((first, i));
                break;
            }
            i += 1;
        }
        let Some((first, last)) = run else { return (1.0, Point::new(0.5, 0.5)) };
        let segs = &self.segments[first..=last];
        let (start, end) = (segs[0].start, segs.iter().map(|s| s.end).fold(f64::MIN, f64::max));
        let ramp = self.ramp.min((end - start) / 2.0);
        let amount = ease(((t - start) / ramp).min((end - t) / ramp).min(1.0));

        // The zoom in charge (latest started), blending from the previous one meanwhile.
        let k = segs.iter().rposition(|s| s.start <= t).unwrap_or(0);
        let (mut scale, mut focus) = (segs[k].scale, self.focus(&segs[k], t));
        if t > segs[k].end && k + 1 < segs.len() {
            // In a gap: glide toward the next one.
            let (a, b) = (&segs[k], &segs[k + 1]);
            let p = ease(((t - a.end) / (b.start - a.end).max(1e-6)).clamp(0.0, 1.0));
            scale = lerp(a.scale, b.scale, p);
            focus = lerp_point(self.focus(a, t), self.focus(b, t), p);
        } else if k > 0 {
            let (a, b) = (&segs[k - 1], &segs[k]);
            let from = if b.start > a.end { None } else { Some(b.start) };
            if let Some(from) = from {
                // Overlapping: change over one ramp after the newer one starts.
                let p = ease(((t - from) / self.ramp).clamp(0.0, 1.0));
                scale = lerp(a.scale, b.scale, p);
                focus = lerp_point(self.focus(a, t), self.focus(b, t), p);
            }
        }
        (1.0 + (scale - 1.0) * amount, focus)
    }
}

fn lerp(a: f64, b: f64, p: f64) -> f64 {
    a + (b - a) * p
}
fn lerp_point(a: Point, b: Point, p: f64) -> Point {
    Point::new(lerp(a.x, b.x, p), lerp(a.y, b.y, p))
}

/// A path that holds still and jumps to each click (from the first cursor position); a
/// spring then turns the jumps into smooth pans.
fn click_path(cursor: &CursorData) -> CursorData {
    let mut moves: Vec<CursorMove> = cursor.moves.first().copied().into_iter().collect();
    for c in cursor.clicks.iter().filter(|c| c.button == MouseButton::Left) {
        if let Some(prev) = moves.last().copied() {
            moves.push(CursorMove { t: (c.t - 0.001).max(prev.t), x: prev.x, y: prev.y });
        }
        moves.push(CursorMove { t: c.t, x: c.x, y: c.y });
    }
    CursorData { moves, clicks: cursor.clicks.clone(), keys: vec![] }
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
        let data = CursorData { moves: vec![CursorMove { t: 0.0, x: 0.0, y: 0.0 }, CursorMove { t: 0.1, x: 1.0, y: 1.0 }], clicks: vec![], keys: vec![] };
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
            segments: vec![ZoomSegment { id: uuid::Uuid::nil(), start: 1.0, end: 3.0, scale: 2.0, focus: Some(Point::new(0.2, 0.3)), loupe: false }],
            glide: false,
            ..Zoom::default()
        };
        let track = ZoomTrack::new(&z, &CursorData::default(), 5.0);
        assert_eq!(track.state(0.5).0, 1.0);
        assert!((track.state(2.0).0 - 2.0).abs() < 1e-9);
        assert_eq!(track.state(2.0).1, Point::new(0.2, 0.3));
        let mid = track.state(1.25).0;
        assert!(mid > 1.0 && mid < 2.0);
    }

    #[test]
    fn glides_between_close_zooms() {
        let seg = |start: f64, end: f64, scale: f64, x: f64| ZoomSegment { id: uuid::Uuid::new_v4(), start, end, scale, focus: Some(Point::new(x, 0.5)), loupe: false };
        let mut z = Zoom { auto: false, segments: vec![seg(1.0, 3.0, 2.0, 0.2), seg(4.0, 6.0, 3.0, 0.8)], glide: false, ..Zoom::default() };
        // Without glide it zooms out in the gap.
        assert!(ZoomTrack::new(&z, &CursorData::default(), 8.0).state(3.5).0 < 1.5);
        z.glide = true;
        let track = ZoomTrack::new(&z, &CursorData::default(), 8.0);
        let (scale, focus) = track.state(3.5);
        assert!((scale - 2.5).abs() < 1e-9 && (focus.x - 0.5).abs() < 1e-9, "{scale} {focus:?}");
        assert!((track.state(2.0).0 - 2.0).abs() < 1e-9 && (track.state(5.0).0 - 3.0).abs() < 1e-9);
        assert_eq!(track.state(0.5).0, 1.0);
        assert_eq!(track.state(7.0).0, 1.0);
        // Far apart: zooms out between.
        z.segments[1] = seg(6.0, 8.0, 3.0, 0.8);
        assert_eq!(ZoomTrack::new(&z, &CursorData::default(), 9.0).state(4.5).0, 1.0);
    }

    #[test]
    fn click_follow_pans_to_clicks() {
        let data = CursorData {
            moves: vec![CursorMove { t: 0.0, x: 0.1, y: 0.1 }, CursorMove { t: 2.5, x: 0.9, y: 0.9 }],
            clicks: vec![CursorClick { t: 1.0, x: 0.3, y: 0.3, button: MouseButton::Left }, CursorClick { t: 3.0, x: 0.7, y: 0.6, button: MouseButton::Left }],
            keys: vec![],
        };
        let z = Zoom { auto: false, follow: ZoomFollow::Clicks, segments: vec![ZoomSegment { id: uuid::Uuid::nil(), start: 0.0, end: 6.0, scale: 2.0, focus: None, loupe: false }], ..Zoom::default() };
        let track = ZoomTrack::new(&z, &data, 6.0);
        // Holds on the first click while the cursor wanders off, then settles on the next.
        let p = track.state(2.6).1;
        assert!((p.x - 0.3).abs() < 0.02, "{p:?}");
        let q = track.state(5.5).1;
        assert!((q.x - 0.7).abs() < 0.02 && (q.y - 0.6).abs() < 0.02, "{q:?}");
    }
}
