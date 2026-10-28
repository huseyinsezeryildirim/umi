//! An open editor: the document (project + edit), undo history, and a render worker that
//! owns the GPU renderer and decoders. All editing logic lives in `umi-project`; the UI
//! sends operations and gets the new state back.

use crossbeam_channel::{Receiver, Sender, bounded, unbounded};
use parking_lot::Mutex;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::AtomicBool;
use umi_engine::audio_mix::AudioMixer;
use umi_engine::{Composer, ExportSettings, Schedule};
use umi_project::edit::EditSettings;
use umi_project::timeline::render_size;
use umi_project::{Bundle, Document, Selection};
use umi_render::Gpu;

pub use umi_editor::{EditorState, Op};

/// What only the files can tell the editing session: a video's length, where it's quiet.
struct BundleMedia<'a>(&'a Path, Option<u32>);
impl umi_editor::Media for BundleMedia<'_> {
    fn duration(&self, file: &str) -> Option<f64> {
        umi_media::duration(&self.0.join(file)).ok()
    }
    fn silences(&self, min: f64) -> Vec<(f64, f64)> {
        let screen = Bundle::new(self.0).screen();
        let tracks = umi_media::audio_streams(&screen).map(|t| t.len()).unwrap_or(0);
        let track = self.1.map(|t| t as usize).filter(|t| *t < tracks).unwrap_or(0);
        umi_media::waveform(&screen, track, 50).map(|levels| umi_project::captions::silences(&levels, 50.0, min)).unwrap_or_default()
    }
}

enum Job {
    Frame {
        time: f64,
        width: u32,
        height: u32,
        flat: bool,
        edit: Option<Box<EditSettings>>,
        reply: Sender<Result<Vec<u8>, String>>,
    },
    /// Where the screen content sits on the canvas at an output time (normalized, top-left).
    Layout {
        time: f64,
        edit: Option<Box<EditSettings>>,
        reply: Sender<[f64; 4]>,
    },
    /// Reopen the composer (new files in the bundle).
    Refresh,
}

pub struct EditorSession {
    pub id: String,
    pub bundle: PathBuf,
    ed: Mutex<umi_editor::Session>,
    /// Edit the render worker last saw (to send changes only).
    rendered_edit: Mutex<Option<EditSettings>>,
    jobs: Sender<Job>,
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
            ed: Mutex::new(umi_editor::Session::new(doc)),
            rendered_edit: Mutex::new(None),
            jobs: tx,
            audio: Mutex::new(None),
        }))
    }

    /// The document, locked.
    pub(crate) fn doc(&self) -> parking_lot::MappedMutexGuard<'_, Document> {
        parking_lot::MutexGuard::map(self.ed.lock(), |e| &mut e.doc)
    }

    pub fn state(&self, selection: Option<Selection>) -> EditorState {
        self.ed.lock().state(&self.id, Bundle::new(&self.bundle).name(), self.bundle.clone(), selection)
    }

    /// Applies an operation and returns the new state.
    pub fn apply(&self, op: Op) -> EditorState {
        let selection = {
            let mut ed = self.ed.lock();
            let mic = ed.doc.project.audio.microphone_track;
            ed.apply(op, &BundleMedia(&self.bundle, mic))
        };
        self.state(selection)
    }

    /// The edit the recording first opened with (cuts, zooms, looks all gone), keeping its
    /// transcript. Applied as one change, so Undo brings the edits back.
    pub fn revert(&self) -> EditorState {
        let mut original = {
            let doc = self.doc();
            let mut project = doc.project.clone();
            project.edit = None;
            project.effective_edit(crate::presets::load().default_preset())
        };
        original.captions = self.doc().edit.captions.clone();
        self.apply(Op::SetEdit { edit: Box::new(original) })
    }

    /// Writes the edit to project.json if it changed since the last save.
    pub fn save(&self) -> Result<(), String> {
        let mut ed = self.ed.lock();
        if !ed.dirty {
            return Ok(());
        }
        let mut project = ed.doc.project.clone();
        project.edit = Some(ed.doc.edit.clone());
        Bundle::new(&self.bundle).write_project(&project).map_err(|e| e.to_string())?;
        ed.dirty = false;
        crate::share::sync_edit(&self.bundle);
        Ok(())
    }

    /// Renders output time `t`, fitting `max_width`×`max_height` at the edit's aspect.
    /// Returns `[width u32 LE][height u32 LE][RGBA…]`.
    pub fn frame(&self, time: f64, max_width: u32, max_height: u32, flat: bool) -> Result<Vec<u8>, String> {
        let (edit, size) = {
            let doc = self.doc();
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
            let doc = self.doc();
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
    pub fn export(
        &self,
        gpu: Arc<Gpu>,
        settings: &ExportSettings,
        destination: &Path,
        progress: &(dyn Fn(f64) + Sync),
        cancel: &AtomicBool,
    ) -> Result<(), String> {
        let edit = self.doc().edit.clone();
        umi_engine::export(gpu, &self.bundle, edit, settings, destination, progress, cancel).map_err(|e| e.to_string())
    }

    /// Transcribes the voice on device and stores the words as captions (turned on).
    /// `progress` gets (stage, 0…1): "download" for the model's first use, then "transcribe".
    pub fn transcribe(&self, language: Option<String>, progress: &(dyn Fn(&str, f64) + Sync)) -> Result<EditorState, String> {
        let model = umi_ai::models::Model::Whisper.ensure(&|p| progress("download", p)).map_err(|e| e.to_string())?;
        let (screen, track, prompt) = {
            let doc = self.doc();
            let tracks = umi_media::audio_streams(&Bundle::new(&self.bundle).screen()).map(|t| t.len()).unwrap_or(0);
            if tracks == 0 {
                return Err("This recording has no sound.".into());
            }
            let mic = doc.project.audio.microphone_track.map(|t| t as usize).filter(|t| *t < tracks);
            (Bundle::new(&self.bundle).screen(), mic.unwrap_or(0), umi_ai::transcribe::vocabulary(&doc.project.on_screen_names()))
        };
        progress("transcribe", 0.0);
        let samples = umi_ai::transcribe::read_mono_16k(&screen, track).map_err(|e| e.to_string())?;
        let language = language.filter(|l| l != "auto");
        let report = std::sync::Arc::new(parking_lot::Mutex::new(Vec::<i32>::new()));
        let (words, detected) = std::thread::scope(|scope| {
            let sink = report.clone();
            let job = scope.spawn(move || {
                umi_ai::transcribe::transcribe(&model, &samples, language.as_deref(), Some(&prompt), move |p| sink.lock().push(p))
            });
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
        let mut edit = self.doc().edit.clone();
        edit.captions.words = words
            .into_iter()
            .map(|w| umi_project::edit::CaptionWord { id: uuid::Uuid::new_v4(), start: w.start, end: w.end, text: w.text })
            .collect();
        edit.captions.language = detected;
        edit.captions.enabled = true;
        // What was said names the recording, unless someone already typed a title.
        if let Some(found) = umi_project::insights::insights(&edit.captions.words) {
            let mut ed = self.ed.lock();
            if ed.doc.project.suggest_title(&found.title) {
                ed.dirty = true;
            }
        }
        Ok(self.apply(Op::SetEdit { edit: Box::new(edit) }))
    }

    /// Title, summary and chapters from the transcript (chapters in output time, plus a
    /// ready-to-paste "0:00 Intro" list).
    pub fn insights(&self) -> Option<(umi_project::insights::Insights, String)> {
        let doc = self.doc();
        let mut found = umi_project::insights::insights(&doc.edit.captions.words)?;
        // Chapters inside cut-out parts move to the next kept moment.
        found.chapters.retain(|c| doc.output_time(c.start).is_some() || c.start == 0.0);
        let text = umi_project::insights::chapter_text(&found.chapters, |t| doc.output_time(t));
        Some((found, text))
    }

    /// Captions as SRT or WebVTT on the edited timeline.
    pub fn subtitles(&self, vtt: bool) -> String {
        let doc = self.doc();
        umi_project::captions::subtitles(
            &doc,
            if vtt { umi_project::captions::SubtitleFormat::Vtt } else { umi_project::captions::SubtitleFormat::Srt },
        )
    }

    /// New files appeared in the bundle (camera effects): reopen sources on the next frame.
    pub fn refresh_sources(&self) {
        let _ = self.jobs.send(Job::Refresh);
        *self.rendered_edit.lock() = None;
    }

    fn edit_change(&self) -> Option<Box<EditSettings>> {
        let edit = self.doc().edit.clone();
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
            let doc = self.doc();
            let m = doc.edit.masks.iter().find(|m| m.id == mask).ok_or("mask not found")?;
            let anchor = anchor.unwrap_or(m.start).clamp(m.start, m.end);
            (m.rect_at(anchor), anchor, m.start, m.end)
        };
        let keys = umi_engine::track::track_region(&Bundle::new(&self.bundle).screen(), rect, anchor, start, end, progress)
            .map_err(|e| e.to_string())?;
        let mut edit = self.doc().edit.clone();
        if let Some(m) = edit.masks.iter_mut().find(|m| m.id == mask) {
            m.rect = rect;
            m.keyframes = keys;
            m.follow = true;
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
    if let Job::Refresh = job {
        if let Ok(fresh) = Composer::open(composer.renderer.gpu().clone(), &composer.bundle.clone(), composer.renderer.edit().clone(), true)
        {
            *composer = fresh;
        }
        return;
    }
    if let Job::Layout { time, edit, reply } = job {
        if let Some(edit) = edit {
            composer.set_edit(*edit);
        }
        let moment = composer.source.schedule.moment(time);
        let size = render_size(&composer.project, composer.renderer.edit(), 1080);
        let canvas = umi_project::Rect::new(0.0, 0.0, size.0 as f64, size.1 as f64);
        let r = composer.renderer.planner().screen_content_rect(moment.layer.source_time, canvas);
        // Bottom-left canvas px → normalized top-left.
        let _ = reply.send([
            r.min_x() / canvas.width(),
            1.0 - r.max_y() / canvas.height(),
            r.width() / canvas.width(),
            r.height() / canvas.height(),
        ]);
    }
}
