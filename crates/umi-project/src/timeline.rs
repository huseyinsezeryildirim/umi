//! The editor's document: a project, its edit and cursor data, with time mapping between
//! the recording (source) and the output timeline, and every editing operation the
//! timeline and inspector perform. Pure logic, shared by desktop, web and tests.

use crate::edit::*;
use crate::geometry::{Point, Rect, Size};
use crate::project::{CursorData, RecordingProject, SCREEN_FILE};
use crate::serde_util::new_id;
use crate::zoom;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// What's selected in the editor.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(tag = "kind", content = "id", rename_all = "camelCase")]
pub enum Selection {
    Clip(usize),
    Zoom(Uuid),
    Mask(Uuid),
    Scene(Uuid),
    Text(Uuid),
    Move(Uuid),
    Music,
    Overlay(Uuid),
}

/// A kept clip laid out on the output timeline.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Placement {
    pub clip: Clip,
    pub output_start: f64,
}

impl Placement {
    pub fn output_duration(&self) -> f64 {
        self.clip.output_duration()
    }
    pub fn output_end(&self) -> f64 {
        self.output_start + self.output_duration()
    }
    /// Recording time shown at output time `t`.
    pub fn source_time(&self, t: f64) -> f64 {
        self.clip.start + (t - self.output_start) * self.clip.speed
    }
}

/// Clips clamped to the recording; empty means the whole recording.
pub fn kept_clips(clips: &[Clip], total: f64) -> Vec<Clip> {
    let valid: Vec<Clip> = clips
        .iter()
        .map(|c| Clip::new(c.start.max(0.0), c.end.min(total), c.speed.clamp(0.25, 8.0)))
        .filter(|c| c.duration() > 0.05)
        .collect();
    if valid.is_empty() { vec![Clip::new(0.0, total, 1.0)] } else { valid }
}

/// The dissolve can't be longer than half of either neighbouring clip.
pub fn effective_crossfade(clips: &[Clip], crossfade: f64) -> f64 {
    if clips.len() < 2 || crossfade <= 0.0 {
        return 0.0;
    }
    let shortest = clips.iter().map(Clip::output_duration).fold(f64::INFINITY, f64::min);
    crossfade.min(shortest / 2.0)
}

/// Where each clip starts on the output timeline (overlapping by the crossfade).
pub fn layout(clips: &[Clip], crossfade: f64) -> Vec<Placement> {
    let fade = effective_crossfade(clips, crossfade);
    let mut cursor = 0.0;
    clips
        .iter()
        .map(|&clip| {
            let p = Placement { clip, output_start: cursor };
            cursor += clip.output_duration() - fade;
            p
        })
        .collect()
}

/// Output size for a target resolution: the chosen aspect, or the (cropped) recording's
/// shape. `max_height` is the short side for vertical videos. Even dimensions (encoders).
pub fn render_size(project: &RecordingProject, edit: &EditSettings, max_height: u32) -> (u32, u32) {
    let crop = edit.crop.unwrap_or(Rect::UNIT);
    let w = project.screen.pixel_width as f64 * crop.width();
    let h = project.screen.pixel_height as f64 * crop.height();
    let ratio = edit.aspect.ratio().unwrap_or(w / h.max(1.0));
    let short = (max_height as f64).min(w.min(h).max(360.0));
    let size = if ratio >= 1.0 { Size::new(short * ratio, short) } else { Size::new(short, short / ratio) };
    ((size.width as u32) & !1, (size.height as u32) & !1)
}

#[derive(Debug, Clone, PartialEq)]
pub struct Document {
    pub project: RecordingProject,
    pub edit: EditSettings,
    pub cursor: CursorData,
    /// Length of the screen track (the project's duration can be a hair longer).
    pub media_duration: f64,
}

impl Document {
    pub fn new(project: RecordingProject, edit: EditSettings, cursor: CursorData, media_duration: f64) -> Self {
        Self { project, edit, cursor, media_duration }
    }

    /// Usable length of the recording.
    pub fn total(&self) -> f64 {
        let d = if self.project.duration > 0.0 { self.project.duration } else { self.media_duration };
        if self.media_duration > 0.0 { d.min(self.media_duration) } else { d }
    }

    pub fn placements(&self) -> Vec<Placement> {
        layout(&kept_clips(&self.edit.clips, self.total()), self.edit.crossfade)
    }

    pub fn output_duration(&self) -> f64 {
        self.placements().last().map_or(0.0, Placement::output_end)
    }

    pub fn zoom_segments(&self) -> Vec<ZoomSegment> {
        zoom::all_segments(&self.edit, &self.cursor.clicks, self.project.duration)
    }

    // MARK: Time mapping

    pub fn clip_index(&self, output_time: f64) -> Option<usize> {
        self.placements().iter().rposition(|p| output_time >= p.output_start - 0.0001)
    }

    pub fn source_time(&self, output_time: f64) -> Option<f64> {
        let placements = self.placements();
        let p = placements.iter().rev().find(|p| output_time >= p.output_start - 0.0001)?;
        Some(p.source_time(output_time).min(p.clip.end))
    }

    pub fn output_time(&self, source_time: f64) -> Option<f64> {
        self.placements()
            .iter()
            .find(|p| source_time >= p.clip.start && source_time <= p.clip.end)
            .map(|p| p.output_start + (source_time - p.clip.start) / p.clip.speed)
    }

    /// Playback speed of the clip containing a source time (1 if it's cut out).
    pub fn speed_at_source(&self, source_time: f64) -> f64 {
        self.placements().iter().find(|p| source_time >= p.clip.start && source_time <= p.clip.end).map_or(1.0, |p| p.clip.speed)
    }

    /// An item's span on the output timeline, following speed changes and clamped to the
    /// clip it starts in (`None` if it starts in a cut-out part).
    pub fn output_range(&self, start: f64, end: f64) -> Option<(f64, f64)> {
        let placements = self.placements();
        let p = placements.iter().find(|p| start >= p.clip.start && start <= p.clip.end)?;
        let a = p.output_start + (start - p.clip.start) / p.clip.speed;
        let b = self.output_time(end).unwrap_or(p.output_start + (end.min(p.clip.end) - p.clip.start) / p.clip.speed);
        Some((a, a.max(b.min(self.output_duration()))))
    }

    /// Clip boundaries on the output timeline (for jumping between cuts).
    pub fn edges(&self) -> Vec<f64> {
        std::iter::once(0.0).chain(self.placements().iter().map(Placement::output_end)).collect()
    }

    fn clamped(&self, start: f64, end: f64) -> (f64, f64) {
        let s = start.min(end - 0.3).max(0.0);
        (s, self.project.duration.min(end.max(s + 0.3)))
    }

    fn kept(&self) -> Vec<Clip> {
        self.placements().iter().map(|p| p.clip).collect()
    }

    // MARK: Clips

    /// Splits the clip under an output time. Returns false when too close to an edge.
    pub fn split(&mut self, output_time: f64) -> bool {
        let (Some(index), Some(cut)) = (self.clip_index(output_time), self.source_time(output_time)) else {
            return false;
        };
        let mut kept = self.kept();
        let clip = kept[index];
        if cut - clip.start <= 0.1 || clip.end - cut <= 0.1 {
            return false;
        }
        kept.splice(index..=index, [Clip::new(clip.start, cut, clip.speed), Clip::new(cut, clip.end, clip.speed)]);
        self.edit.clips = kept;
        true
    }

    /// Joins a clip with the next one, bringing back anything cut out between them (undoes a
    /// split or a cut). Only clips in recording order can be joined.
    pub fn join_clips(&mut self, index: usize) -> bool {
        let mut kept = self.kept();
        if index + 1 >= kept.len() {
            return false;
        }
        let (a, b) = (kept[index], kept[index + 1]);
        if b.start < a.start {
            return false;
        }
        kept.splice(index..=index + 1, [Clip::new(a.start, a.end.max(b.end), a.speed)]);
        self.edit.clips = kept;
        true
    }

    pub fn delete_clip(&mut self, index: usize) -> bool {
        let mut kept = self.kept();
        if kept.len() <= 1 || index >= kept.len() {
            return false;
        }
        kept.remove(index);
        self.edit.clips = kept;
        true
    }

    /// Moves one edge of a clip, in source time.
    pub fn trim_clip(&mut self, index: usize, start: Option<f64>, end: Option<f64>) {
        let mut kept = self.kept();
        let Some(clip) = kept.get_mut(index) else {
            return;
        };
        if let Some(start) = start {
            clip.start = start.max(0.0).min(clip.end - 0.2);
        }
        if let Some(end) = end {
            clip.end = end.min(self.project.duration).max(clip.start + 0.2);
        }
        self.edit.clips = kept;
    }

    pub fn set_speed(&mut self, index: usize, speed: f64) {
        let mut kept = self.kept();
        if let Some(clip) = kept.get_mut(index) {
            clip.speed = speed;
            self.edit.clips = kept;
        }
    }

    pub fn move_clip(&mut self, from: usize, to: usize) -> bool {
        let mut kept = self.kept();
        if from >= kept.len() || to >= kept.len() || from == to {
            return false;
        }
        let clip = kept.remove(from);
        kept.insert(to, clip);
        self.edit.clips = kept;
        true
    }

    /// Takes a clip off the main video and lays it over the video at `output_start` on the
    /// Video 2 track. Returns the new overlay's id.
    pub fn move_clip_to_video2(&mut self, index: usize, output_start: f64) -> Option<Uuid> {
        let mut kept = self.kept();
        if index >= kept.len() || kept.len() <= 1 {
            return None;
        }
        let clip = kept.remove(index);
        let remaining: f64 = kept.iter().map(Clip::output_duration).sum();
        let start = output_start.max(0.0).min((remaining - 0.5).max(0.0));
        let mut overlay = MediaOverlay::new(SCREEN_FILE, MediaKind::Video, start, start + clip.duration());
        overlay.media_offset = clip.start;
        overlay.lane = Some(2);
        let id = overlay.id;
        self.edit.clips = kept;
        self.edit.overlays.push(overlay);
        Some(id)
    }

    /// Removes a span of the output timeline (ripple delete). Media items after it move
    /// left with the video; items overlapping it keep the parts outside, joined.
    pub fn cut(&mut self, range: (f64, f64)) -> bool {
        let a = range.0.max(0.0);
        let b = range.1.min(self.output_duration());
        if b - a <= 0.05 {
            return false;
        }
        let mut kept = Vec::new();
        for p in self.placements() {
            if p.output_end() <= a || p.output_start >= b {
                kept.push(p.clip);
                continue;
            }
            if p.output_start < a - 0.05 {
                kept.push(Clip::new(p.clip.start, p.source_time(a), p.clip.speed));
            }
            if p.output_end() > b + 0.05 {
                kept.push(Clip::new(p.source_time(b), p.clip.end, p.clip.speed));
            }
        }
        if kept.is_empty() {
            return false;
        }
        let length = b - a;
        self.edit.clips = kept;
        self.edit.overlays.retain_mut(|o| {
            if o.start >= b {
                o.start -= length;
                o.end -= length;
            } else if o.end > a {
                let removed = o.end.min(b) - o.start.max(a);
                o.end -= removed;
                if o.start > a {
                    o.media_offset += o.start - a;
                    o.start = a;
                }
            }
            o.end - o.start > 0.1
        });
        true
    }

    // MARK: Zoom

    /// Editing a generated zoom turns all generated zooms into manual ones.
    fn materialize_auto_zoom(&mut self) {
        if self.edit.zoom.auto {
            self.edit.zoom.segments = self.zoom_segments();
            self.edit.zoom.auto = false;
        }
    }

    /// Adds a zoom at the playhead (up to 3 s, stopping before the next one), or selects
    /// the zoom already there.
    pub fn add_zoom(&mut self, output_time: f64) -> Option<Selection> {
        let source = self.source_time(output_time)?;
        let segments = self.zoom_segments();
        if let Some(existing) = segments.iter().find(|z| source >= z.start && source <= z.end) {
            return Some(Selection::Zoom(existing.id));
        }
        let next = segments.iter().map(|z| z.start).filter(|&s| s > source).fold(self.project.duration, f64::min);
        let segment = ZoomSegment {
            id: new_id(),
            start: source,
            end: (source + 3.0).min(next - 0.05).min(self.project.duration),
            scale: self.edit.zoom.scale,
            focus: None,
        };
        let id = segment.id;
        self.materialize_auto_zoom();
        self.edit.zoom.segments.push(segment);
        Some(Selection::Zoom(id))
    }

    pub fn update_zoom(&mut self, id: Uuid, change: impl FnOnce(&mut ZoomSegment)) {
        self.materialize_auto_zoom();
        let duration = self.project.duration;
        if let Some(z) = self.edit.zoom.segments.iter_mut().find(|z| z.id == id) {
            change(z);
            let s = z.start.min(z.end - 0.3).max(0.0);
            z.end = duration.min(z.end.max(s + 0.3));
            z.start = s;
        }
    }

    pub fn delete_zoom(&mut self, id: Uuid) {
        self.materialize_auto_zoom();
        self.edit.zoom.segments.retain(|z| z.id != id);
    }

    // MARK: Masks, scenes, text, 3D

    pub fn add_mask(&mut self, output_time: f64) -> Option<Selection> {
        let source = self.source_time(output_time)?;
        let mask = PrivacyMask {
            id: new_id(),
            start: source,
            end: (source + 3.0).min(self.project.duration),
            rect: Rect::new(0.35, 0.35, 0.3, 0.2),
            style: MaskStyle::Blur,
            amount: 0.6,
            keyframes: vec![],
        };
        let id = mask.id;
        self.edit.masks.push(mask);
        Some(Selection::Mask(id))
    }

    pub fn add_scene(&mut self, layout: SceneLayout, output_time: f64) -> Option<Selection> {
        let source = self.source_time(output_time)?;
        let scene = SceneSegment { id: new_id(), start: source, end: (source + 4.0).min(self.project.duration), layout, transition: 0.4 };
        let id = scene.id;
        self.edit.scenes.push(scene);
        Some(Selection::Scene(id))
    }

    pub fn add_text(&mut self, style: TextStyle, output_time: f64) -> Option<Selection> {
        let source = self.source_time(output_time)?;
        let (text, detail, position) = style.template();
        let overlay = TextOverlay {
            id: new_id(),
            start: source,
            end: (source + 4.0).min(self.project.duration),
            style,
            text: text.into(),
            detail: detail.into(),
            position,
            animation: if style == TextStyle::Typewriter { TextAnimation::Typewriter } else { TextAnimation::Slide },
        };
        let id = overlay.id;
        self.edit.texts.push(overlay);
        Some(Selection::Text(id))
    }

    pub fn add_move(&mut self, kind: MoveKind, output_time: f64) -> Option<Selection> {
        let source = self.source_time(output_time)?;
        let mv = CameraMove { id: new_id(), start: source, end: (source + 4.0).min(self.project.duration), kind };
        let id = mv.id;
        self.edit.moves.push(mv);
        Some(Selection::Move(id))
    }

    /// Moves or resizes any timed item (source time; output time for media).
    pub fn retime(&mut self, selection: Selection, start: f64, end: f64) {
        let (s, e) = self.clamped(start, end);
        fn set<T: TimedItem>(items: &mut [T], id: Uuid, s: f64, e: f64) {
            if let Some(item) = items.iter_mut().find(|i| i.id() == id) {
                item.set_range(s, e);
            }
        }
        match selection {
            Selection::Zoom(id) => self.update_zoom(id, |z| {
                z.start = start;
                z.end = end;
            }),
            Selection::Mask(id) => set(&mut self.edit.masks, id, s, e),
            Selection::Scene(id) => set(&mut self.edit.scenes, id, s, e),
            Selection::Text(id) => set(&mut self.edit.texts, id, s, e),
            Selection::Move(id) => set(&mut self.edit.moves, id, s, e),
            Selection::Overlay(id) => self.retime_overlay(id, start, end),
            Selection::Clip(_) | Selection::Music => {}
        }
    }

    /// Moves/trims a media item on the output timeline. Trimming its start also skips into
    /// the video, so the content under the playhead doesn't jump.
    fn retime_overlay(&mut self, id: Uuid, start: f64, end: f64) {
        if let Some(o) = self.edit.overlays.iter_mut().find(|o| o.id == id) {
            let s = start.min(end - 0.2).max(0.0);
            if ((end - start) - (o.end - o.start)).abs() > 0.001 && o.kind == MediaKind::Video {
                o.media_offset = (o.media_offset + (s - o.start)).max(0.0);
            }
            o.start = s;
            o.end = end.max(s + 0.2);
        }
    }

    /// Deletes the selected item. Returns whether the selection should clear.
    pub fn delete(&mut self, selection: Selection) -> bool {
        match selection {
            Selection::Clip(i) => return self.delete_clip(i),
            Selection::Zoom(id) => self.delete_zoom(id),
            Selection::Mask(id) => self.edit.masks.retain(|m| m.id != id),
            Selection::Scene(id) => self.edit.scenes.retain(|m| m.id != id),
            Selection::Text(id) => self.edit.texts.retain(|m| m.id != id),
            Selection::Move(id) => self.edit.moves.retain(|m| m.id != id),
            Selection::Music => self.edit.music = None,
            Selection::Overlay(id) => self.edit.overlays.retain(|m| m.id != id),
        }
        true
    }

    /// Adds a media item at an output time; images last 4 s, videos keep their length (up to
    /// the end of the edit).
    pub fn add_overlay(&mut self, file: String, kind: MediaKind, media_duration: Option<f64>, output_time: f64) -> Uuid {
        let total = self.output_duration();
        let start = output_time.max(0.0).min((total - 0.5).max(0.0));
        let length = if kind == MediaKind::Video { media_duration.filter(|d| *d > 0.0).unwrap_or(4.0) } else { 4.0 };
        let overlay = MediaOverlay::new(file, kind, start, (start + length).min(total.max(start + 0.5)));
        let id = overlay.id;
        self.edit.overlays.push(overlay);
        id
    }

    // MARK: Captions

    /// Replaces the words of one caption line, spreading its timing over the new words.
    pub fn edit_caption_line(&mut self, ids: &[Uuid], text: &str) {
        let line: Vec<&CaptionWord> = self.edit.captions.words.iter().filter(|w| ids.contains(&w.id)).collect();
        let (Some(first), Some(last)) = (line.first(), line.last()) else {
            return;
        };
        let (from, to) = (first.start, last.end);
        let parts: Vec<&str> = text.split_whitespace().collect();
        let step = (to - from) / parts.len().max(1) as f64;
        let replacement: Vec<CaptionWord> = parts
            .iter()
            .enumerate()
            .map(|(i, word)| CaptionWord {
                id: new_id(),
                start: from + i as f64 * step,
                end: from + (i + 1) as f64 * step,
                text: (*word).into(),
            })
            .collect();
        self.edit.captions.words.retain(|w| !ids.contains(&w.id));
        self.edit.captions.words.extend(replacement);
        self.edit.captions.words.sort_by(|a, b| a.start.total_cmp(&b.start));
    }

    /// Default camera position etc. are already in the edit; this helper places a new item
    /// anchor in canvas coordinates for drag handles.
    pub fn clamp_point(p: Point) -> Point {
        Point::new(p.x.clamp(0.0, 1.0), p.y.clamp(0.0, 1.0))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::project::{AudioInfo, ScreenInfo};
    use chrono::Utc;

    fn doc(duration: f64) -> Document {
        let project = RecordingProject {
            version: 1,
            created_at: Utc::now(),
            duration,
            screen: ScreenInfo { pixel_width: 1920, pixel_height: 1080, capture_rect: Rect::new(0.0, 0.0, 1920.0, 1080.0), fps: 60 },
            camera: None,
            audio: AudioInfo::default(),
            edit: None,
            camera_only: None,
        };
        Document::new(project, EditSettings::default(), CursorData::default(), duration)
    }

    #[test]
    fn split_speed_reorder_delete() {
        let mut d = doc(6.0);
        assert!((d.output_duration() - 6.0).abs() < 1e-9);
        assert!(d.split(2.0));
        assert_eq!(d.placements().len(), 2);
        d.set_speed(0, 2.0);
        assert!((d.output_duration() - 5.0).abs() < 1e-9);
        assert!(d.move_clip(1, 0));
        assert!((d.placements()[0].clip.start - 2.0).abs() < 1e-9);
        assert!(d.delete_clip(0));
        assert!((d.output_duration() - 1.0).abs() < 1e-9);
    }

    #[test]
    fn join_undoes_split_and_cut() {
        let mut d = doc(10.0);
        d.split(4.0);
        assert!(d.join_clips(0));
        assert_eq!(d.placements().len(), 1);
        assert!((d.output_duration() - 10.0).abs() < 1e-9);
        d.cut((3.0, 5.0));
        assert_eq!(d.placements().len(), 2);
        assert!(d.join_clips(0));
        assert!((d.output_duration() - 10.0).abs() < 1e-9);
    }

    #[test]
    fn cut_ripples_media() {
        let mut d = doc(10.0);
        let id = d.add_overlay("b.mp4".into(), MediaKind::Video, Some(2.0), 6.0);
        assert!(d.cut((2.0, 4.0)));
        assert!((d.output_duration() - 8.0).abs() < 1e-9);
        let o = d.edit.overlays.iter().find(|o| o.id == id).unwrap();
        assert!((o.start - 4.0).abs() < 1e-9);
    }

    #[test]
    fn clip_to_video2() {
        let mut d = doc(6.0);
        d.split(2.0);
        d.split(4.0);
        let id = d.move_clip_to_video2(1, 1.0).unwrap();
        assert_eq!(d.placements().len(), 2);
        let o = d.edit.overlays.iter().find(|o| o.id == id).unwrap();
        assert!(o.is_video2());
        assert_eq!(o.file, SCREEN_FILE);
        assert!((o.media_offset - 2.0).abs() < 1e-9);
        assert!((o.end - o.start - 2.0).abs() < 1e-9);
    }

    #[test]
    fn render_sizes() {
        let d = doc(1.0);
        assert_eq!(render_size(&d.project, &d.edit, 1080), (1920, 1080));
        let mut e = d.edit.clone();
        e.aspect = AspectRatio::Vertical;
        assert_eq!(render_size(&d.project, &e, 1080), (1080, 1920));
    }
}
