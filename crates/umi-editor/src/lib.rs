//! The editor's document session: the operations the UI sends, the undo history and the state
//! the UI shows after each change. No files, no video: what needs the media (a video's length,
//! where it's quiet) comes from the host through [`Media`]. The desktop app and the web editor
//! (WebAssembly, `umi-wasm`) both run this, so editing works the same everywhere.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use umi_project::edit::{EditSettings, MediaKind, MoveKind, SceneLayout, TextStyle, ZoomSegment};
use umi_project::{Document, History, Placement, Selection};

/// What the session can't know by itself.
pub trait Media {
    /// Length in seconds of a video added to the bundle (`file` is relative to it).
    fn duration(&self, file: &str) -> Option<f64>;
    /// Where the voice is quiet for `min` seconds or more (recording time).
    fn silences(&self, min: f64) -> Vec<(f64, f64)>;
}

/// No media: durations unknown, no silences (tests, or a host that can't measure).
pub struct NoMedia;
impl Media for NoMedia {
    fn duration(&self, _: &str) -> Option<f64> {
        None
    }
    fn silences(&self, _: f64) -> Vec<(f64, f64)> {
        Vec::new()
    }
}

/// Editing operations the UI can ask for.
#[derive(Debug, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Op {
    /// Replace the whole edit (inspector changes).
    SetEdit {
        edit: Box<EditSettings>,
    },
    Split {
        time: f64,
    },
    Cut {
        start: f64,
        end: f64,
    },
    DeleteClip {
        index: usize,
    },
    JoinClips {
        index: usize,
    },
    TrimClip {
        index: usize,
        start: Option<f64>,
        end: Option<f64>,
    },
    SetSpeed {
        index: usize,
        speed: f64,
    },
    MoveClip {
        from: usize,
        to: usize,
    },
    ClipToVideo2 {
        index: usize,
        time: f64,
    },
    AddZoom {
        time: f64,
    },
    AddMask {
        time: f64,
        style: Option<umi_project::edit::MaskStyle>,
    },
    AddScene {
        layout: SceneLayout,
        time: f64,
    },
    AddText {
        style: TextStyle,
        time: f64,
    },
    AddMove {
        kind: MoveKind,
        time: f64,
    },
    AddOverlay {
        file: String,
        kind: MediaKind,
        duration: Option<f64>,
        time: f64,
    },
    Retime {
        selection: Selection,
        start: f64,
        end: f64,
    },
    Delete {
        selection: Selection,
    },
    DeleteMany {
        selections: Vec<Selection>,
    },
    /// Moves several timed items by the same amount (multi-selection drag).
    ShiftMany {
        selections: Vec<Selection>,
        delta: f64,
    },
    /// Puts a voiceover on the Voice track, or replaces `replace`'s audio and text in place.
    AddVoiceover {
        file: String,
        text: String,
        start: f64,
        duration: f64,
        replace: Option<uuid::Uuid>,
    },
    /// Replaces the words of one caption line.
    EditCaptionLine {
        ids: Vec<uuid::Uuid>,
        text: String,
    },
    /// Text-based editing: cuts these words out of the video.
    CutWords {
        ids: Vec<uuid::Uuid>,
    },
    /// Cuts every filler word ("um", "uh", "şey"…).
    RemoveFillers,
    /// Shortens silences longer than `min` seconds.
    RemovePauses {
        min: f64,
    },
    /// Plays long typing faster.
    SpeedUpTyping {
        speed: f64,
    },
    /// Hides the camera while nobody speaks for `min` seconds or more.
    HideCameraInSilence {
        min: f64,
    },
    /// Renames the recording (empty: back to the folder name).
    SetTitle {
        title: String,
    },
    BeginGesture,
    EndGesture,
    Undo,
    Redo,
}

/// What the UI shows, sent after every change.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorState {
    pub id: String,
    pub name: String,
    pub edit: EditSettings,
    pub placements: Vec<Placement>,
    pub output_duration: f64,
    /// Manual and generated zooms (generated ones aren't in the edit until touched).
    pub zoom_segments: Vec<ZoomSegment>,
    pub recording: RecordingInfo,
    pub can_undo: bool,
    pub can_redo: bool,
    /// Set by operations that create something, so the UI can select it.
    pub selection: Option<Selection>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingInfo {
    pub duration: f64,
    pub width: u32,
    pub height: u32,
    pub has_camera: bool,
    pub bundle: PathBuf,
    /// Key presses were recorded (for the keystroke overlay).
    pub has_keys: bool,
}

/// An open document with its undo history.
pub struct Session {
    pub doc: Document,
    pub history: History,
    /// The edit or the title changed since the last save.
    pub dirty: bool,
}

impl Session {
    pub fn new(doc: Document) -> Self {
        Self { doc, history: History::new(200), dirty: false }
    }

    /// What the UI shows. `name` is the folder name, used when there's no title.
    pub fn state(&self, id: &str, name: String, bundle: PathBuf, selection: Option<Selection>) -> EditorState {
        let doc = &self.doc;
        EditorState {
            id: id.to_string(),
            name: doc.project.display_name(name),
            edit: doc.edit.clone(),
            placements: doc.placements(),
            output_duration: doc.output_duration(),
            zoom_segments: doc.zoom_segments(),
            recording: RecordingInfo {
                duration: doc.project.duration,
                width: doc.project.screen.pixel_width,
                height: doc.project.screen.pixel_height,
                has_camera: doc.project.camera.is_some(),
                bundle,
                has_keys: !doc.cursor.keys.is_empty(),
            },
            can_undo: self.history.can_undo(),
            can_redo: self.history.can_redo(),
            selection,
        }
    }

    /// Applies an operation; returns what it created, for the UI to select.
    pub fn apply(&mut self, op: Op, media: &dyn Media) -> Option<Selection> {
        let doc = &mut self.doc;
        let history = &mut self.history;
        let before = doc.edit.clone();
        let mut selection = None;
        let is_history_op = matches!(op, Op::Undo | Op::Redo);
        match op {
            Op::SetEdit { edit } => doc.edit = *edit,
            Op::Split { time } => {
                doc.split(time);
            }
            Op::Cut { start, end } => {
                doc.cut((start, end));
            }
            Op::DeleteClip { index } => {
                doc.delete_clip(index);
            }
            Op::JoinClips { index } => {
                if doc.join_clips(index) {
                    selection = Some(Selection::Clip(index));
                }
            }
            Op::TrimClip { index, start, end } => doc.trim_clip(index, start, end),
            Op::SetSpeed { index, speed } => doc.set_speed(index, speed),
            Op::MoveClip { from, to } => {
                if doc.move_clip(from, to) {
                    selection = Some(Selection::Clip(to));
                }
            }
            Op::ClipToVideo2 { index, time } => selection = doc.move_clip_to_video2(index, time).map(Selection::Overlay),
            Op::AddZoom { time } => selection = doc.add_zoom(time),
            Op::AddMask { time, style } => selection = doc.add_mask_with(time, style.unwrap_or_default()),
            Op::AddScene { layout, time } => selection = doc.add_scene(layout, time),
            Op::AddText { style, time } => selection = doc.add_text(style, time),
            Op::AddMove { kind, time } => selection = doc.add_move(kind, time),
            Op::AddOverlay { file, kind, duration, time } => {
                // A video plays for its own length unless told otherwise.
                let duration = duration.or_else(|| (kind == MediaKind::Video).then(|| media.duration(&file)).flatten());
                selection = Some(Selection::Overlay(doc.add_overlay(file, kind, duration, time)));
            }
            Op::Retime { selection: s, start, end } => doc.retime(s, start, end),
            Op::Delete { selection: s } => {
                doc.delete(s);
            }
            Op::DeleteMany { selections } => doc.delete_many(&selections),
            Op::ShiftMany { selections, delta } => {
                for s in selections {
                    if let Some((start, end)) = item_span(&doc, s) {
                        doc.retime(s, start + delta, end + delta);
                    }
                }
            }
            Op::AddVoiceover { file, text, start, duration, replace } => {
                let existing = replace.and_then(|id| doc.edit.voiceovers.iter_mut().find(|v| v.id == id));
                let id = match existing {
                    Some(v) => {
                        v.file = file;
                        v.text = text;
                        v.end = v.start + duration;
                        v.id
                    }
                    None => {
                        let v = umi_project::edit::Voiceover {
                            id: uuid::Uuid::new_v4(),
                            file,
                            start: start.max(0.0),
                            end: start.max(0.0) + duration,
                            text,
                            volume: 1.0,
                        };
                        let id = v.id;
                        doc.edit.voiceovers.push(v);
                        id
                    }
                };
                selection = Some(Selection::Voiceover(id));
            }
            Op::EditCaptionLine { ids, text } => doc.edit_caption_line(&ids, &text),
            Op::CutWords { ids } => {
                doc.cut_words(&ids);
            }
            Op::RemoveFillers => {
                let ids = umi_project::captions::filler_words(&doc.edit.captions.words);
                doc.cut_words(&ids);
            }
            Op::RemovePauses { min } => {
                let ranges = umi_project::captions::long_pauses(&doc.edit.captions.words, min.max(0.3), 0.3);
                doc.cut_source_ranges(&ranges);
            }
            Op::HideCameraInSilence { min } => {
                let quiet = media.silences(min.max(1.5));
                doc.hide_camera_in_silences(&quiet);
            }
            Op::SpeedUpTyping { speed } => {
                doc.speed_up_typing(speed.clamp(1.5, 8.0));
            }
            Op::SetTitle { title } => {
                doc.project.set_title(&title);
                // Not part of the edit, so the check below wouldn't see it.
                self.dirty = true;
            }
            Op::BeginGesture => history.begin_gesture(&doc.edit),
            Op::EndGesture => history.end_gesture(&doc.edit),
            Op::Undo => {
                if let Some(previous) = history.undo(&doc.edit) {
                    doc.edit = previous;
                }
            }
            Op::Redo => {
                if let Some(next) = history.redo(&doc.edit) {
                    doc.edit = next;
                }
            }
        }
        let after = doc.edit.clone();
        if before != after {
            // Undo/redo move through the history; recording them would loop back.
            if !is_history_op {
                history.record(&before, &after);
            }
            self.dirty = true;
        }
        selection
    }
}

/// Start and end of a timed item (source time; output time for media).
pub fn item_span(doc: &Document, s: Selection) -> Option<(f64, f64)> {
    let e = &doc.edit;
    match s {
        Selection::Zoom(id) => doc.zoom_segments().into_iter().find(|z| z.id == id).map(|z| (z.start, z.end)),
        Selection::Mask(id) => e.masks.iter().find(|m| m.id == id).map(|m| (m.start, m.end)),
        Selection::Scene(id) => e.scenes.iter().find(|m| m.id == id).map(|m| (m.start, m.end)),
        Selection::Text(id) => e.texts.iter().find(|m| m.id == id).map(|m| (m.start, m.end)),
        Selection::Move(id) => e.moves.iter().find(|m| m.id == id).map(|m| (m.start, m.end)),
        Selection::Overlay(id) => e.overlays.iter().find(|m| m.id == id).map(|m| (m.start, m.end)),
        Selection::Voiceover(id) => e.voiceovers.iter().find(|m| m.id == id).map(|m| (m.start, m.end)),
        Selection::Clip(_) | Selection::Music => None,
    }
}
