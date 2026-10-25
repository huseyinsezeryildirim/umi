//! An open editor: the document (project + edit), undo history, and a render worker that
//! owns the GPU renderer and decoders. All editing logic lives in `umi-project`; the UI
//! sends operations and gets the new state back.

use crossbeam_channel::{Receiver, Sender, bounded, unbounded};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use umi_engine::Composer;
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
    TrimClip { index: usize, start: Option<f64>, end: Option<f64> },
    SetSpeed { index: usize, speed: f64 },
    MoveClip { from: usize, to: usize },
    ClipToVideo2 { index: usize, time: f64 },
    AddZoom { time: f64 },
    AddMask { time: f64 },
    AddScene { layout: SceneLayout, time: f64 },
    AddText { style: TextStyle, time: f64 },
    AddMove { kind: MoveKind, time: f64 },
    AddOverlay { file: String, kind: MediaKind, duration: Option<f64>, time: f64 },
    Retime { selection: Selection, start: f64, end: f64 },
    Delete { selection: Selection },
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
}

impl EditorSession {
    pub fn open(gpu: Arc<Gpu>, id: String, path: &Path) -> Result<Arc<Self>, String> {
        let bundle = Bundle::new(path);
        let project = bundle.read_project().map_err(|e| e.to_string())?;
        let cursor = bundle.read_cursor();
        let edit = project.effective_edit(None);
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
            Op::TrimClip { index, start, end } => doc.trim_clip(index, start, end),
            Op::SetSpeed { index, speed } => doc.set_speed(index, speed),
            Op::MoveClip { from, to } => {
                if doc.move_clip(from, to) {
                    selection = Some(Selection::Clip(to));
                }
            }
            Op::ClipToVideo2 { index, time } => selection = doc.move_clip_to_video2(index, time).map(Selection::Overlay),
            Op::AddZoom { time } => selection = doc.add_zoom(time),
            Op::AddMask { time } => selection = doc.add_mask(time),
            Op::AddScene { layout, time } => selection = doc.add_scene(layout, time),
            Op::AddText { style, time } => selection = doc.add_text(style, time),
            Op::AddMove { kind, time } => selection = doc.add_move(kind, time),
            Op::AddOverlay { file, kind, duration, time } => selection = Some(Selection::Overlay(doc.add_overlay(file, kind, duration, time))),
            Op::Retime { selection: s, start, end } => doc.retime(s, start, end),
            Op::Delete { selection: s } => {
                doc.delete(s);
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
        if !matches!(&before, b if *b == after) {
            history.record(&before, &after);
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
    pub fn track_mask(&self, mask: uuid::Uuid, progress: &dyn Fn(f64)) -> Result<EditorState, String> {
        let (rect, start, end) = {
            let doc = self.doc.lock();
            let m = doc.edit.masks.iter().find(|m| m.id == mask).ok_or("mask not found")?;
            (m.rect_at(m.start), m.start, m.end)
        };
        let keys = umi_engine::track::track_region(&Bundle::new(&self.bundle).screen(), rect, start, end, progress).map_err(|e| e.to_string())?;
        let mut edit = self.doc.lock().edit.clone();
        if let Some(m) = edit.masks.iter_mut().find(|m| m.id == mask) {
            m.rect = rect;
            m.keyframes = keys;
        }
        Ok(self.apply(Op::SetEdit { edit: Box::new(edit) }))
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
