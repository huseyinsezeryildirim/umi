//! What plays at each moment of the output timeline: which clip(s) (and their recording
//! times, dissolving across crossfades) and which Media/Video 2 items (and their media
//! times). Pure; shared by the player and the exporter.

use crate::Placement;
use crate::edit::{EditSettings, MediaKind};
use crate::timeline::{effective_crossfade, kept_clips, layout};
use uuid::Uuid;

/// One clip's contribution to a frame.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Layer {
    pub clip: usize,
    /// Recording time shown.
    pub source_time: f64,
}

/// Everything shown at an output time.
#[derive(Debug, Clone, PartialEq)]
pub struct Moment {
    pub output_time: f64,
    pub layer: Layer,
    /// The next clip dissolving in, with its progress (0 → 1).
    pub dissolve: Option<(Layer, f64)>,
    /// Active video overlays: id, file, media time.
    pub overlays: Vec<(Uuid, String, f64)>,
}

#[derive(Debug, Clone)]
pub struct Schedule {
    pub placements: Vec<Placement>,
    pub crossfade: f64,
    pub duration: f64,
    overlays: Vec<(Uuid, String, f64, f64, f64)>,
}

impl Schedule {
    /// `total` is the usable length of the recording (see `Document::total`).
    pub fn new(edit: &EditSettings, total: f64) -> Self {
        let clips = kept_clips(&edit.clips, total);
        let crossfade = effective_crossfade(&clips, edit.crossfade);
        let placements = layout(&clips, edit.crossfade);
        let duration = placements.last().map_or(0.0, Placement::output_end);
        let overlays = edit
            .overlays
            .iter()
            .filter(|o| o.kind == MediaKind::Video)
            .map(|o| (o.id, o.file.clone(), o.start, o.end, o.media_offset))
            .collect();
        Self { placements, crossfade, duration, overlays }
    }

    pub fn moment(&self, t: f64) -> Moment {
        let t = t.clamp(0.0, self.duration.max(0.0));
        // The clip that owns t (the later one wins in an overlap, like AVComposition).
        let index = self.placements.iter().rposition(|p| t >= p.output_start - 1e-6).unwrap_or(0);
        let mut dissolve = None;
        let mut main = index;
        if self.crossfade > 0.0 && index > 0 {
            let previous = &self.placements[index - 1];
            if t < previous.output_end() {
                // Overlap between previous (fading out) and this clip (fading in).
                let progress = (t - self.placements[index].output_start) / self.crossfade;
                main = index - 1;
                dissolve = Some((Layer { clip: index, source_time: self.placements[index].source_time(t) }, progress.clamp(0.0, 1.0)));
            }
        }
        let p = &self.placements[main];
        let layer = Layer { clip: main, source_time: p.source_time(t).min(p.clip.end) };
        let overlays = self.overlays.iter().filter(|o| t >= o.2 && t <= o.3).map(|o| (o.0, o.1.clone(), o.4 + (t - o.2))).collect();
        Moment { output_time: t, layer, dissolve, overlays }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::edit::Clip;

    #[test]
    fn maps_cuts_speed_and_dissolves() {
        let mut edit = EditSettings::default();
        edit.clips = vec![Clip::new(0.0, 4.0, 1.0), Clip::new(6.0, 10.0, 2.0)];
        let s = Schedule::new(&edit, 10.0);
        assert!((s.duration - 6.0).abs() < 1e-9);
        let m = s.moment(5.0);
        assert_eq!(m.layer.clip, 1);
        assert!((m.layer.source_time - 8.0).abs() < 1e-9);

        edit.crossfade = 1.0;
        let s = Schedule::new(&edit, 10.0);
        assert!((s.duration - 5.0).abs() < 1e-9);
        let m = s.moment(3.5);
        assert_eq!(m.layer.clip, 0);
        let (b, progress) = m.dissolve.unwrap();
        assert_eq!(b.clip, 1);
        assert!((progress - 0.5).abs() < 1e-9);
    }
}
