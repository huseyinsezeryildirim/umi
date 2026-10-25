//! An open editor: the document (project + edit), undo history, and a render worker that
//! owns the GPU renderer and decoders. All editing logic lives in `umi-project`; the UI
//! sends operations and gets the new state back.

use crossbeam_channel::{Receiver, Sender, bounded, unbounded};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::AtomicBool;
use umi_engine::audio_mix::AudioMixer;
use umi_engine::{Composer, ExportSettings, Schedule};
use umi_project::edit::{EditSettings, MediaKind, MoveKind, SceneLayout, TextStyle, ZoomSegment};
use umi_project::timeline::render_size;
use umi_project::{Bundle, Document, History, Placement, Selection};
use umi_render::Gpu;

/// Editing operations the UI can ask for.
#[derive(Debug, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Op {
    /// Replace the whole edit (inspector changes).
    SetEdit { edit: Box<EditSettings> },
    Split { time: f64 },
    Cut { start: f64, end: f64 },
    DeleteClip { index: usize },
    JoinClips { index: usize },
    TrimClip { index: usize, start: Option<f64>, end: Option<f64> },
    SetSpeed { index: usize, speed: f64 },
    MoveClip { from: usize, to: usize },
    ClipToVideo2 { index: usize, time: f64 },
    AddZoom { time: f64 },
    AddMask { time: f64, style: Option<umi_project::edit::MaskStyle> },
    AddScene { layout: SceneLayout, time: f64 },
    AddText { style: TextStyle, time: f64 },
    AddMove { kind: MoveKind, time: f64 },
    AddOverlay { file: String, kind: MediaKind, duration: Option<f64>, time: f64 },
    Retime { selection: Selection, start: f64, end: f64 },
    Delete { selection: Selection },
    DeleteMany { selections: Vec<Selection> },
    /// Moves several timed items by the same amount (multi-selection drag).
    ShiftMany { selections: Vec<Selection>, delta: f64 },
    /// Puts a voiceover on the Voice track, or replaces `replace`'s audio and text in place.
    AddVoiceover { file: String, text: String, start: f64, duration: f64, replace: Option<uuid::Uuid> },
    /// Replaces the words of one caption line.
    EditCaptionLine { ids: Vec<uuid::Uuid>, text: String },
    /// Text-based editing: cuts these words out of the video.
    CutWords { ids: Vec<uuid::Uuid> },
    /// Cuts every filler word ("um", "uh", "şey"…).
    RemoveFillers,
    /// Shortens silences longer than `min` seconds.
    RemovePauses { min: f64 },
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

enum Job {
    Frame { time: f64, width: u32, height: u32, flat: bool, edit: Option<Box<EditSettings>>, reply: Sender<Result<Vec<u8>, String>> },
    /// Where the screen content sits on the canvas at an output time (normalized, top-left).
    Layout { time: f64, edit: Option<Box<EditSettings>>, reply: Sender<[f64; 4]> },
}

pub struct EditorSession {
    pub id: String,
    pub bundle: PathBuf,
    doc: Mutex<Document>,
    history: Mutex<History>,
    /// Edit the render worker last saw (to send changes only).
    rendered_edit: Mutex<Option<EditSettings>>,
    jobs: Sender<Job>,
    save_pending: Mutex<bool>,
    /// Preview soundtrack: the mixer for the edit it was built for.
    audio: Mutex<Option<(EditSettings, AudioMixer)>>,
}

impl EditorSession {
    pub fn open(gpu: Arc<Gpu>, id: String, path: &Path) -> Result<Arc<Self>, String> {
        let bundle = Bundle::new(path);
        let project = bundle.read_project().map_err(|e| e.to_string())?;
        let cursor = bundle.read_cursor();
        // A recording never edited starts with the default look.
        let edit = project.effective_edit(crate::presets::load().default_preset());
        let media_duration = umi_media::duration(&bundle.screen()).unwrap_or(project.duration);
        let doc = Document::new(project, edit.clone(), cursor, media_duration);

        let (tx, rx) = unbounded::<Job>();
        let worker_path = path.to_path_buf();
        let (ready_tx, ready_rx) = bounded::<Result<(), String>>(1);
        std::thread::Builder::new()
            .name("umi-render".into())
            .spawn(move || render_worker(gpu, worker_path, edit, rx, ready_tx))
            .map_err(|e| e.to_string())?;
        ready_rx.recv().map_err(|e| e.to_string())??;

        Ok(Arc::new(Self {
            id,
            bundle: path.to_path_buf(),
            doc: Mutex::new(doc),
            history: Mutex::new(History::new(200)),
            rendered_edit: Mutex::new(None),
            jobs: tx,
            save_pending: Mutex::new(false),
            audio: Mutex::new(None),
        }))
    }

    pub fn state(&self, selection: Option<Selection>) -> EditorState {
        let doc = self.doc.lock();
        let history = self.history.lock();
        EditorState {
            id: self.id.clone(),
            name: Bundle::new(&self.bundle).name(),
            edit: doc.edit.clone(),
            placements: doc.placements(),
            output_duration: doc.output_duration(),
            zoom_segments: doc.zoom_segments(),
            recording: RecordingInfo {
                duration: doc.project.duration,
                width: doc.project.screen.pixel_width,
                height: doc.project.screen.pixel_height,
                has_camera: doc.project.camera.is_some(),
                bundle: self.bundle.clone(),
                has_keys: !doc.cursor.keys.is_empty(),
            },
            can_undo: history.can_undo(),
            can_redo: history.can_redo(),
            selection,
        }
    }

    /// Applies an operation and returns the new state.
    pub fn apply(&self, op: Op) -> EditorState {
        let mut doc = self.doc.lock();
        let mut history = self.history.lock();
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
                let duration = duration.or_else(|| (kind == MediaKind::Video).then(|| umi_media::duration(&self.bundle.join(&file)).ok()).flatten());
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
                        let v = umi_project::edit::Voiceover { id: uuid::Uuid::new_v4(), file, start: start.max(0.0), end: start.max(0.0) + duration, text, volume: 1.0 };
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
            *self.save_pending.lock() = true;
        }
        drop(history);
        drop(doc);
        self.state(selection)
    }

    /// Writes the edit to project.json if it changed since the last save.
    pub fn save(&self) -> Result<(), String> {
        let mut pending = self.save_pending.lock();
        if !*pending {
            return Ok(());
        }
        let doc = self.doc.lock();
        let mut project = doc.project.clone();
        project.edit = Some(doc.edit.clone());
        Bundle::new(&self.bundle).write_project(&project).map_err(|e| e.to_string())?;
        *pending = false;
        Ok(())
    }

    /// Renders output time `t`, fitting `max_width`×`max_height` at the edit's aspect.
    /// Returns `[width u32 LE][height u32 LE][RGBA…]`.
    pub fn frame(&self, time: f64, max_width: u32, max_height: u32, flat: bool) -> Result<Vec<u8>, String> {
        let (edit, size) = {
            let doc = self.doc.lock();
            let full = render_size(&doc.project, &doc.edit, 2160);
            let k = (max_width as f64 / full.0 as f64).min(max_height as f64 / full.1 as f64).min(1.0);
            let size = (((full.0 as f64 * k) as u32).max(2) & !1, ((full.1 as f64 * k) as u32).max(2) & !1);
            (doc.edit.clone(), size)
        };
        let changed = {
            let mut seen = self.rendered_edit.lock();
            if seen.as_ref() != Some(&edit) {
                *seen = Some(edit.clone());
                true
            } else {
                false
            }
        };
        let (reply, rx) = bounded(1);
        self.jobs
            .send(Job::Frame { time, width: size.0, height: size.1, flat, edit: changed.then(|| Box::new(edit)), reply })
            .map_err(|e| e.to_string())?;
        rx.recv().map_err(|e| e.to_string())?
    }
}

impl EditorSession {
    /// The soundtrack from output time `time` for `seconds`: 48 kHz stereo interleaved f32
    /// (little-endian bytes), exactly what export mixes.
    pub fn audio(&self, time: f64, seconds: f64) -> Result<Vec<u8>, String> {
        let (edit, total) = {
            let doc = self.doc.lock();
            (doc.edit.clone(), doc.total())
        };
        let mut slot = self.audio.lock();
        if slot.as_ref().is_none_or(|(e, _)| *e != edit) {
            let mixer = AudioMixer::new(&self.bundle, Schedule::new(&edit, total), &edit).map_err(|e| e.to_string())?;
            *slot = Some((edit, mixer));
        }
        let Some((_, mixer)) = slot.as_mut() else { unreachable!() };
        let frames = (seconds.clamp(0.0, 10.0) * umi_media::SAMPLE_RATE as f64) as usize;
        let mut out = vec![0f32; frames * umi_media::CHANNELS];
        mixer.render(time, &mut out).map_err(|e| e.to_string())?;
        Ok(out.iter().flat_map(|s| s.to_le_bytes()).collect())
    }

    /// Exports the current edit to `destination`.
    pub fn export(&self, gpu: Arc<Gpu>, settings: &ExportSettings, destination: &Path, progress: &(dyn Fn(f64) + Sync), cancel: &AtomicBool) -> Result<(), String> {
        let edit = self.doc.lock().edit.clone();
        umi_engine::export(gpu, &self.bundle, edit, settings, destination, progress, cancel).map_err(|e| e.to_string())
    }

    /// Transcribes the voice on device and stores the words as captions (turned on).
    /// `progress` gets (stage, 0…1): "download" for the model's first use, then "transcribe".
    pub fn transcribe(&self, language: Option<String>, progress: &(dyn Fn(&str, f64) + Sync)) -> Result<EditorState, String> {
        let model = umi_ai::models::Model::WhisperBase.ensure(&|p| progress("download", p)).map_err(|e| e.to_string())?;
        let (screen, track) = {
            let doc = self.doc.lock();
            let tracks = umi_media::audio_streams(&Bundle::new(&self.bundle).screen()).map(|t| t.len()).unwrap_or(0);
            if tracks == 0 {
                return Err("This recording has no sound.".into());
            }
            let mic = doc.project.audio.microphone_track.map(|t| t as usize).filter(|t| *t < tracks);
            (Bundle::new(&self.bundle).screen(), mic.unwrap_or(0))
        };
        progress("transcribe", 0.0);
        let samples = umi_ai::transcribe::read_mono_16k(&screen, track).map_err(|e| e.to_string())?;
        let language = language.filter(|l| l != "auto");
        let report = std::sync::Arc::new(parking_lot::Mutex::new(Vec::<i32>::new()));
        let (words, detected) = std::thread::scope(|scope| {
            let sink = report.clone();
            let job = scope.spawn(move || umi_ai::transcribe::transcribe(&model, &samples, language.as_deref(), move |p| sink.lock().push(p)));
            // Whisper reports progress on its own thread; relay it from here.
            while !job.is_finished() {
                if let Some(p) = report.lock().last().copied() {
                    progress("transcribe", p as f64 / 100.0);
                }
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
            job.join().map_err(|_| "transcription crashed".to_string())
        })?
        .map_err(|e| e.to_string())?;
        if words.is_empty() {
            return Err("No speech found.".into());
        }
        let mut edit = self.doc.lock().edit.clone();
        edit.captions.words = words
            .into_iter()
            .map(|w| umi_project::edit::CaptionWord { id: uuid::Uuid::new_v4(), start: w.start, end: w.end, text: w.text })
            .collect();
        edit.captions.language = detected;
        edit.captions.enabled = true;
        Ok(self.apply(Op::SetEdit { edit: Box::new(edit) }))
    }

    /// Captions as SRT or WebVTT on the edited timeline.
    pub fn subtitles(&self, vtt: bool) -> String {
        let doc = self.doc.lock();
        umi_project::captions::subtitles(&doc, if vtt { umi_project::captions::SubtitleFormat::Vtt } else { umi_project::captions::SubtitleFormat::Srt })
    }

    fn edit_change(&self) -> Option<Box<EditSettings>> {
        let edit = self.doc.lock().edit.clone();
        let mut seen = self.rendered_edit.lock();
        if seen.as_ref() == Some(&edit) {
            return None;
        }
        *seen = Some(edit.clone());
        Some(Box::new(edit))
    }

    /// The screen content's rect on the canvas at output time `t` (normalized, top-left),
    /// without zoom or 3D moves (what the mask and focus handles line up with).
    pub fn layout(&self, time: f64) -> Result<[f64; 4], String> {
        let (reply, rx) = bounded(1);
        self.jobs.send(Job::Layout { time, edit: self.edit_change(), reply }).map_err(|e| e.to_string())?;
        rx.recv().map_err(|e| e.to_string())
    }

    /// Tracks a mask's area across its time span and stores the path as keyframes.
    /// Sticks a mask to the content under it at recording time `anchor` (where the user
    /// placed it), following it forward and backward across the mask's span.
    pub fn track_mask(&self, mask: uuid::Uuid, anchor: Option<f64>, progress: &dyn Fn(f64)) -> Result<EditorState, String> {
        let (rect, anchor, start, end) = {
            let doc = self.doc.lock();
            let m = doc.edit.masks.iter().find(|m| m.id == mask).ok_or("mask not found")?;
            let anchor = anchor.unwrap_or(m.start).clamp(m.start, m.end);
            (m.rect_at(anchor), anchor, m.start, m.end)
        };
        let keys = umi_engine::track::track_region(&Bundle::new(&self.bundle).screen(), rect, anchor, start, end, progress).map_err(|e| e.to_string())?;
        let mut edit = self.doc.lock().edit.clone();
        if let Some(m) = edit.masks.iter_mut().find(|m| m.id == mask) {
            m.rect = rect;
            m.keyframes = keys;
            m.follow = true;
        }
        Ok(self.apply(Op::SetEdit { edit: Box::new(edit) }))
    }
}

/// Start and end of a timed item (source time; output time for media).
fn item_span(doc: &Document, s: Selection) -> Option<(f64, f64)> {
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

fn render_worker(gpu: Arc<Gpu>, bundle: PathBuf, edit: EditSettings, jobs: Receiver<Job>, ready: Sender<Result<(), String>>) {
    let mut composer = match Composer::open(gpu, &bundle, edit, true) {
        Ok(c) => {
            let _ = ready.send(Ok(()));
            c
        }
        Err(e) => {
            let _ = ready.send(Err(e.to_string()));
            return;
        }
    };
    while let Ok(job) = jobs.recv() {
        // Only the newest frame request matters (scrubbing sends many).
        let mut job = job;
        // Only the newest frame request matters; layout requests are answered in order.
        while let Job::Frame { .. } = job {
            match jobs.try_recv() {
                Ok(newer @ Job::Frame { .. }) => {
                    if let Job::Frame { reply, .. } = &job {
                        let _ = reply.send(Err("superseded".into()));
                    }
                    job = merge(job, newer);
                }
                Ok(other) => {
                    // Keep the edit the dropped frame carried, then handle the other job first.
                    if let Job::Frame { edit: Some(edit), .. } = &job {
                        composer.set_edit(*edit.clone());
                    }
                    handle_layout(&mut composer, other);
                }
                Err(_) => break,
            }
        }
        let Job::Frame { time, width, height, flat, edit, reply } = job else {
            handle_layout(&mut composer, job);
            continue;
        };
        if let Some(edit) = edit {
            composer.set_edit(*edit);
        }
        composer.renderer.set_apply_zoom_and_moves(!flat);
        let result = composer
            .render(time, (width, height))
            .map_err(|e| e.to_string())
            .and_then(|_| composer.renderer.read_rgba().map_err(|e| e.to_string()))
            .map(|rgba| {
                let mut out = Vec::with_capacity(8 + rgba.len());
                out.extend_from_slice(&width.to_le_bytes());
                out.extend_from_slice(&height.to_le_bytes());
                out.extend_from_slice(&rgba);
                out
            });
        let _ = reply.send(result);
    }
}

/// Keeps the newest request but carries an edit change from the dropped one.
fn merge(old: Job, new: Job) -> Job {
    match (old, new) {
        (Job::Frame { edit: old_edit, .. }, Job::Frame { time, width, height, flat, edit, reply }) => {
            Job::Frame { time, width, height, flat, edit: edit.or(old_edit), reply }
        }
        (_, new) => new,
    }
}

fn handle_layout(composer: &mut Composer, job: Job) {
    if let Job::Layout { time, edit, reply } = job {
        if let Some(edit) = edit {
            composer.set_edit(*edit);
        }
        let moment = composer.source.schedule.moment(time);
        let size = render_size(&composer.project, composer.renderer.edit(), 1080);
        let canvas = umi_project::Rect::new(0.0, 0.0, size.0 as f64, size.1 as f64);
        let r = composer.renderer.planner().screen_content_rect(moment.layer.source_time, canvas);
        // Bottom-left canvas px → normalized top-left.
        let _ = reply.send([r.min_x() / canvas.width(), 1.0 - r.max_y() / canvas.height(), r.width() / canvas.width(), r.height() / canvas.height()]);
    }
}
