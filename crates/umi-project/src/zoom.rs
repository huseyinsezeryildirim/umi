//! Zoom segments generated from clicks.

use crate::edit::{EditSettings, ZoomSegment};
use crate::project::{CursorClick, MouseButton};
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
        let segment = ZoomSegment { id, start: begin, end: duration.min(end + 1.8), scale, focus: None };
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

/// Manual plus (when auto is on) generated zooms, sorted by start.
pub fn all_segments(edit: &EditSettings, clicks: &[CursorClick], duration: f64) -> Vec<ZoomSegment> {
    let mut all = edit.zoom.segments.clone();
    if edit.zoom.auto {
        all.extend(auto_segments(clicks, edit.zoom.scale, duration));
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
}
