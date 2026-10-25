//! Zoom segments generated from clicks.

use crate::edit::{EditSettings, Zoom, ZoomSegment, ZoomTrigger};
use crate::geometry::Point;
use crate::project::{CursorClick, CursorData, MouseButton};
use uuid::Uuid;

/// Clicks close together become one segment that starts just before the first click and
/// holds a moment after the last. Ids come from the start time, so a generated zoom stays
/// selected across rebuilds (same ids as the Swift app).
pub fn auto_segments(clicks: &[CursorClick], scale: f64, duration: f64) -> Vec<ZoomSegment> {
    let mut lefts: Vec<&CursorClick> = clicks.iter().filter(|c| c.button == MouseButton::Left).collect();
    lefts.sort_by(|a, b| a.t.total_cmp(&b.t));

    let mut result: Vec<ZoomSegment> = Vec::new();
    let mut group: Option<(f64, f64)> = None;
    let flush = |group: Option<(f64, f64)>, result: &mut Vec<ZoomSegment>| {
        let Some((start, end)) = group else { return };
        let begin = (start - 0.6).max(0.0);
        let id = Uuid::parse_str(&format!("00000000-0000-4000-8000-{:012x}", (begin * 1000.0) as u64)).unwrap_or_else(|_| Uuid::new_v4());
        let segment = ZoomSegment { id, start: begin, end: duration.min(end + 1.8), scale, focus: None, loupe: false };
        match result.last_mut() {
            Some(last) if segment.start <= last.end => last.end = segment.end,
            _ => result.push(segment),
        }
    };
    for click in lefts {
        match group {
            Some((start, end)) if click.t - end < 3.0 => group = Some((start, click.t)),
            _ => {
                flush(group, &mut result);
                group = Some((click.t, click.t));
            }
        }
    }
    flush(group, &mut result);
    result
}

/// Smart zoom: clicks and typing grouped into moments of work; each is zoomed just enough
/// that the area the cursor covers meanwhile fits comfortably (never past `max_scale`), so
/// small precise work gets close and broad work stays wide. A lone shortcut doesn't zoom.
pub fn smart_segments(cursor: &CursorData, max_scale: f64, duration: f64) -> Vec<ZoomSegment> {
    // (time, is_key)
    let mut events: Vec<(f64, bool)> = cursor.clicks.iter().filter(|c| c.button == MouseButton::Left).map(|c| (c.t, false)).collect();
    events.extend(cursor.keys.iter().map(|k| (k.t, true)));
    events.sort_by(|a, b| a.0.total_cmp(&b.0));

    let mut groups: Vec<(f64, f64, usize, usize)> = Vec::new(); // start, end, clicks, keys
    for (t, key) in events {
        match groups.last_mut() {
            Some(g) if t - g.1 < 2.5 => {
                g.1 = t;
                if key { g.3 += 1 } else { g.2 += 1 }
            }
            _ => groups.push((t, t, usize::from(!key), usize::from(key))),
        }
    }

    let mut result: Vec<ZoomSegment> = Vec::new();
    for (start, end, clicks, keys) in groups {
        if clicks == 0 && keys < 4 {
            continue;
        }
        // Area worked in: cursor positions and clicks during the moment.
        let (mut x0, mut y0, mut x1, mut y1) = (f64::MAX, f64::MAX, f64::MIN, f64::MIN);
        let mut add = |p: Point| {
            x0 = x0.min(p.x);
            y0 = y0.min(p.y);
            x1 = x1.max(p.x);
            y1 = y1.max(p.y);
        };
        for m in cursor.moves.iter().filter(|m| m.t >= start - 0.3 && m.t <= end + 0.3) {
            add(Point::new(m.x, m.y));
        }
        for c in cursor.clicks.iter().filter(|c| c.t >= start && c.t <= end) {
            add(Point::new(c.x, c.y));
        }
        let fit = if x1 >= x0 { (0.6 / (x1 - x0).max(0.01)).min(0.6 / (y1 - y0).max(0.01)) } else { max_scale };
        let scale = fit.clamp(1.3_f64.min(max_scale), max_scale);
        let begin = (start - 0.6).max(0.0);
        let id = Uuid::parse_str(&format!("00000000-0000-4000-9000-{:012x}", (begin * 1000.0) as u64)).unwrap_or_else(|_| Uuid::new_v4());
        let segment = ZoomSegment { id, start: begin, end: duration.min(end + 1.8), scale, focus: None, loupe: false };
        match result.last_mut() {
            Some(last) if segment.start <= last.end => {
                last.end = segment.end;
                last.scale = last.scale.min(segment.scale);
            }
            _ => result.push(segment),
        }
    }
    result
}

/// Generated zooms for the chosen trigger.
pub fn generated_segments(zoom: &Zoom, cursor: &CursorData, duration: f64) -> Vec<ZoomSegment> {
    match zoom.trigger {
        ZoomTrigger::Clicks => auto_segments(&cursor.clicks, zoom.scale, duration),
        ZoomTrigger::Smart => smart_segments(cursor, zoom.scale, duration),
    }
}

/// Manual plus (when auto is on) generated zooms, sorted by start.
pub fn all_segments(edit: &EditSettings, cursor: &CursorData, duration: f64) -> Vec<ZoomSegment> {
    let mut all = edit.zoom.segments.clone();
    if edit.zoom.auto {
        all.extend(generated_segments(&edit.zoom, cursor, duration));
    }
    all.sort_by(|a, b| a.start.total_cmp(&b.start));
    all
}

#[cfg(test)]
mod tests {
    use super::*;

    fn click(t: f64) -> CursorClick {
        CursorClick { t, x: 0.5, y: 0.5, button: MouseButton::Left }
    }

    #[test]
    fn groups_nearby_clicks_with_stable_ids() {
        let segs = auto_segments(&[click(1.0), click(2.0), click(10.0)], 1.8, 20.0);
        assert_eq!(segs.len(), 2);
        assert!((segs[0].start - 0.4).abs() < 1e-9);
        assert!((segs[0].end - 3.8).abs() < 1e-9);
        assert_eq!(segs[0].id.to_string(), "00000000-0000-4000-8000-000000000190");
    }

    #[test]
    fn smart_fits_the_worked_area() {
        use crate::project::{CursorMove, KeyPress};
        let mv = |t: f64, x: f64, y: f64| CursorMove { t, x, y };
        // Precise work in a small corner, then broad clicks across the screen.
        let cursor = CursorData {
            moves: vec![mv(1.0, 0.10, 0.10), mv(2.0, 0.15, 0.12), mv(9.0, 0.1, 0.1), mv(10.0, 0.9, 0.8)],
            clicks: vec![
                CursorClick { t: 1.5, x: 0.12, y: 0.11, button: MouseButton::Left },
                CursorClick { t: 9.0, x: 0.1, y: 0.1, button: MouseButton::Left },
                CursorClick { t: 10.0, x: 0.9, y: 0.8, button: MouseButton::Left },
            ],
            keys: (0..2).map(|i| KeyPress { t: 20.0 + i as f64 * 0.2, key: "A".into(), modifiers: vec![] }).collect(),
        };
        let segs = smart_segments(&cursor, 2.5, 30.0);
        assert_eq!(segs.len(), 2, "{segs:?}");
        assert!((segs[0].scale - 2.5).abs() < 1e-9, "small area zooms in fully");
        assert!(segs[1].scale < 1.4, "broad area stays wide: {}", segs[1].scale);
    }
}
