//! Draws the output timeline in two steps that can run on different threads:
//! [`FrameSource::prepare`] decodes the moment's source frames, [`draw`] renders them (with
//! a dissolve across crossfades).

use crate::schedule::{Moment, Schedule};
use crate::sources::{CAMERA, SCREEN, Sources, as_video_frame};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use umi_media::{DecodedFrame, MediaError};
use umi_project::edit::CameraBackground;
use umi_project::{Bundle, CursorData, Document, EditSettings, RecordingProject};
use umi_render::{FrameRequest, Gpu, Renderer};
use uuid::Uuid;

/// Decoded inputs for one output frame.
pub struct Prepared {
    pub moment: Moment,
    pub a: (Option<Arc<DecodedFrame>>, Option<Arc<DecodedFrame>>),
    pub b: Option<(Option<Arc<DecodedFrame>>, Option<Arc<DecodedFrame>>)>,
    pub overlays: Vec<(Uuid, Arc<DecodedFrame>)>,
}

/// The decoding side: sources and the schedule.
pub struct FrameSource {
    pub sources: Sources,
    pub schedule: Schedule,
    has_camera: bool,
    camera: CameraFeed,
    /// The next clip's decoders, being moved to its start on another thread.
    warming: Option<Warming>,
    /// The clip last got ready that way (once per clip).
    warmed: Option<usize>,
}

/// Decoders for one clip set, taken out to decode up to the next clip's first frame while the
/// current clip plays: a cut then shows at once instead of waiting for the decoder to find
/// its way (the last keyframe, then every frame after it).
struct Warming {
    set: usize,
    thread: std::thread::JoinHandle<Vec<(String, umi_media::VideoDecoder)>>,
}

/// How far ahead (seconds) the next clip starts getting ready.
const WARM_AHEAD: f64 = 1.5;

/// Which camera picture the edit asks for (falling back to the original while an effect
/// hasn't been made yet).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CameraFeed {
    Original,
    Blurred,
    /// Original plus the person's outline (`camera-matte.mov`) as transparency.
    Cutout,
}

const CAMERA_BLUR: &str = "camera-blur.mov";
const CAMERA_MATTE: &str = "camera-matte.mov";

fn camera_feed(sources: &mut Sources, edit: &EditSettings) -> CameraFeed {
    match edit.camera.background {
        CameraBackground::Blur if sources.has(CAMERA_BLUR) => CameraFeed::Blurred,
        CameraBackground::Remove if sources.has(CAMERA_MATTE) => CameraFeed::Cutout,
        _ => CameraFeed::Original,
    }
}

/// The camera frame with the matte's brightness as (premultiplied) transparency.
fn cut_out(camera: &DecodedFrame, matte: &DecodedFrame) -> Option<DecodedFrame> {
    let (w, h, mut rgba) = umi_media::to_rgba(camera, camera.width.max(camera.height)).ok()?;
    let (mw, mh) = (matte.width as usize, matte.height as usize);
    let (luma, stride) = (&matte.planes[0], matte.strides[0] as usize);
    let full = matte.color.full_range;
    for y in 0..h as usize {
        let my = (y * mh / h as usize).min(mh - 1);
        for x in 0..w as usize {
            let mx = (x * mw / w as usize).min(mw - 1);
            let v = luma[my * stride + mx] as u32;
            let a = if full { v } else { (v.saturating_sub(16) * 255 / 219).min(255) };
            let i = (y * w as usize + x) * 4;
            for c in 0..3 {
                rgba[i + c] = (rgba[i + c] as u32 * a / 255) as u8;
            }
            rgba[i + 3] = a as u8;
        }
    }
    Some(DecodedFrame {
        pts: camera.pts,
        width: w,
        height: h,
        format: umi_media::FrameFormat::Rgba,
        color: camera.color,
        planes: vec![rgba],
        strides: vec![w * 4],
    })
}

impl FrameSource {
    /// The files (and decoder keys) a clip set reads.
    fn set_files(&self, set: usize) -> Vec<(&'static str, String)> {
        let key = |file: &'static str| if set == 0 { (file, file.to_string()) } else { (file, format!("{file}#1")) };
        let mut files = vec![if set == 0 { (SCREEN, SCREEN.to_string()) } else { (SCREEN, "screen#1".to_string()) }];
        if self.has_camera {
            match self.camera {
                CameraFeed::Original => files.push(key(CAMERA)),
                CameraFeed::Blurred => files.push(key(CAMERA_BLUR)),
                CameraFeed::Cutout => files.extend([key(CAMERA), key(CAMERA_MATTE)]),
            }
        }
        files
    }

    /// Takes back decoders that were getting ready, when `set` is about to be read.
    fn settle(&mut self, set: usize) {
        if self.warming.as_ref().is_some_and(|w| w.set == set)
            && let Some(w) = self.warming.take()
            && let Ok(decoders) = w.thread.join()
        {
            for (key, decoder) in decoders {
                self.sources.put(&key, decoder);
            }
        }
    }

    /// Starts getting the next clip ready when it's close (not during a dissolve, which reads
    /// both sets).
    fn warm_next(&mut self, moment: &Moment) {
        let next = moment.layer.clip + 1;
        if self.warming.is_some() || moment.dissolve.is_some() || self.warmed == Some(next) {
            return;
        }
        let Some(p) = self.schedule.placements.get(next) else { return };
        let ahead = p.output_start - moment.output_time;
        if !(0.0..=WARM_AHEAD).contains(&ahead) {
            return;
        }
        let (set, start) = (next % 2, p.clip.start);
        let mut decoders = vec![];
        for (file, key) in self.set_files(set) {
            if let Some(d) = self.sources.take(file, &key) {
                decoders.push((key, d));
            }
        }
        let thread = std::thread::spawn(move || {
            for (_, d) in decoders.iter_mut() {
                let _ = d.frame_at(start);
            }
            decoders
        });
        self.warming = Some(Warming { set, thread });
        self.warmed = Some(next);
    }

    pub fn prepare(&mut self, t: f64) -> Result<Prepared, MediaError> {
        let moment = self.schedule.moment(t);
        self.settle(moment.layer.clip % 2);
        if let Some((layer, _)) = moment.dissolve {
            self.settle(layer.clip % 2);
        }
        let a = self.layer(moment.layer.clip % 2, moment.layer.source_time)?;
        let b = match moment.dissolve {
            Some((layer, _)) => Some(self.layer(layer.clip % 2, layer.source_time)?),
            None => None,
        };
        let mut overlays = vec![];
        for (id, file, media_time) in &moment.overlays {
            // Video 2 plays another part of the screen file: give it its own decoder.
            let frame = if file == SCREEN {
                self.sources.frame_aliased(file, &id.to_string(), *media_time)?
            } else {
                self.sources.frame(file, *media_time)?
            };
            if let Some(frame) = frame {
                overlays.push((*id, frame));
            }
        }
        self.warm_next(&moment);
        Ok(Prepared { moment, a, b, overlays })
    }

    /// Frames for one clip set: consecutive clips alternate between two decoder sets, so a
    /// dissolve reads two times of the same files without seeking back and forth.
    fn layer(&mut self, set: usize, t: f64) -> Result<(Option<Arc<DecodedFrame>>, Option<Arc<DecodedFrame>>), MediaError> {
        let screen = if set == 0 { self.sources.frame(SCREEN, t)? } else { self.sources.frame_aliased(SCREEN, "screen#1", t)? };
        if !self.has_camera {
            return Ok((screen, None));
        }
        let mut read =
            |file: &str| if set == 0 { self.sources.frame(file, t) } else { self.sources.frame_aliased(file, &format!("{file}#1"), t) };
        let camera = match self.camera {
            CameraFeed::Original => read(CAMERA)?,
            CameraFeed::Blurred => read(CAMERA_BLUR)?,
            CameraFeed::Cutout => {
                let (camera, matte) = (read(CAMERA)?, read(CAMERA_MATTE)?);
                match (camera, matte) {
                    (Some(c), Some(m)) => cut_out(&c, &m).map(Arc::new).or(Some(c)),
                    (c, _) => c,
                }
            }
        };
        Ok((screen, camera))
    }
}

/// Renders prepared inputs at `size` into the renderer's output texture.
pub fn draw(renderer: &mut Renderer, prepared: &Prepared, size: (u32, u32)) {
    let t = prepared.moment.output_time;
    let overlays: Vec<(Uuid, _)> = prepared.overlays.iter().map(|(id, f)| (*id, as_video_frame(f))).collect();
    fn request<'a>(
        time: f64,
        output_time: f64,
        frames: &'a (Option<Arc<DecodedFrame>>, Option<Arc<DecodedFrame>>),
        overlays: &[(Uuid, umi_render::VideoFrame<'a>)],
    ) -> FrameRequest<'a> {
        FrameRequest {
            time,
            output_time: Some(output_time),
            screen: frames.0.as_deref().map(as_video_frame),
            camera: frames.1.as_deref().map(as_video_frame),
            overlays: overlays.to_vec(),
        }
    }
    let a = request(prepared.moment.layer.source_time, t, &prepared.a, &overlays);
    match (&prepared.moment.dissolve, &prepared.b) {
        (Some((layer, progress)), Some(b)) => {
            let b = request(layer.source_time, t, b, &overlays);
            renderer.render_dissolve(size, &a, &b, *progress);
        }
        _ => renderer.render(size, &a),
    }
}

/// Decoding and rendering together (the player's and tests' convenience).
pub struct Composer {
    pub renderer: Renderer,
    pub source: FrameSource,
    pub project: RecordingProject,
    pub bundle: PathBuf,
    cursor: CursorData,
}

impl Composer {
    pub fn open(gpu: Arc<Gpu>, bundle_path: &Path, edit: EditSettings, hardware: bool) -> Result<Self, crate::EngineError> {
        let (source, project, cursor) = open_source(bundle_path, &edit, hardware)?;
        let renderer = Renderer::new(gpu, project.clone(), edit, cursor.clone(), Some(bundle_path.to_path_buf()));
        Ok(Self { renderer, source, project, bundle: bundle_path.to_path_buf(), cursor })
    }

    /// Applies a new edit (decoders and GPU resources are kept).
    pub fn set_edit(&mut self, edit: EditSettings) {
        let media_duration = self.source.sources.video_duration(SCREEN).unwrap_or(self.project.duration);
        let document = Document::new(self.project.clone(), edit.clone(), self.cursor.clone(), media_duration);
        // Decoders getting ready for the old clips come back first.
        for set in 0..2 {
            self.source.settle(set);
        }
        self.source.warmed = None;
        self.source.schedule = Schedule::new(&edit, document.total());
        self.source.camera = camera_feed(&mut self.source.sources, &edit);
        self.renderer.set_edit(edit);
    }

    pub fn duration(&self) -> f64 {
        self.source.schedule.duration
    }

    pub fn render(&mut self, t: f64, size: (u32, u32)) -> Result<Moment, MediaError> {
        let prepared = self.source.prepare(t)?;
        draw(&mut self.renderer, &prepared, size);
        Ok(prepared.moment)
    }
}

/// Opens a recording's sources and schedule for an edit.
pub fn open_source(
    bundle_path: &Path,
    edit: &EditSettings,
    hardware: bool,
) -> Result<(FrameSource, RecordingProject, CursorData), crate::EngineError> {
    let bundle = Bundle::new(bundle_path);
    let project = bundle.read_project()?;
    let cursor = bundle.read_cursor();
    let mut sources = Sources::new(bundle_path, hardware);
    let media_duration = sources.video_duration(SCREEN).unwrap_or(project.duration);
    let has_camera = project.camera.is_some() && sources.has(CAMERA);
    let document = Document::new(project.clone(), edit.clone(), cursor.clone(), media_duration);
    let schedule = Schedule::new(edit, document.total());
    let camera = camera_feed(&mut sources, edit);
    Ok((FrameSource { sources, schedule, has_camera, camera, warming: None, warmed: None }, project, cursor))
}
