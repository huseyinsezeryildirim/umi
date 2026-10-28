//! A recording in progress. Sources capture on their own threads; one writer thread per
//! file encodes, so a slow encode never stalls capture. The bundle is written as it goes
//! (fragmented MOV), so a crash loses at most a second, and [`recover`] finishes it later.
//!
//! ```text
//! Umi 2026-10-25 at 10.41.07.umi/
//!   screen.mov    video + system sound (track 0) + microphone (track 1, or 0 alone)
//!   camera.mov    camera, if on
//!   cursor.json   pointer, clicks, keys
//!   project.json  written at the end
//! ```

use crossbeam_channel::{Receiver, Sender, bounded};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::thread::JoinHandle;
use umi_capture::input::{Area, InputRecorder};
use umi_capture::screen::{self, ScreenOptions, ScreenSession};
use umi_capture::{AudioSink, CaptureError, Clock, Frame, Target, VideoSink};
use umi_media::{Pixels, StreamWriter, VideoCodec, WriterSettings};
use umi_project::edit::Camera as CameraStyle;
use umi_project::edit::SceneLayout;
use umi_project::project::{AudioInfo, CameraInfo, LayoutSpan, ScreenInfo, WindowSpan};
use umi_project::{Bundle, RecordingProject, Rect};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Options {
    pub target: Target,
    pub fps: u32,
    /// Longest side in pixels (0 = native).
    pub max_size: u32,
    pub system_audio: bool,
    /// Microphone id (`None` = off; empty string = the default microphone).
    pub microphone: Option<String>,
    /// Camera id (`None` = off; empty string = the first camera).
    pub camera: Option<String>,
    /// How the camera bubble looked when recording started (shape, size, position).
    pub camera_style: Option<CameraStyle>,
    /// Record only the camera (the screen is still captured for context but starts hidden).
    #[serde(default)]
    pub camera_only: bool,
    /// Leave desktop icons out of the recording (macOS).
    #[serde(default)]
    pub hide_desktop_icons: bool,
}

#[derive(Debug, thiserror::Error)]
pub enum RecordError {
    #[error(transparent)]
    Capture(#[from] CaptureError),
    #[error("couldn't write the recording: {0}")]
    Write(String),
}

impl From<umi_media::MediaError> for RecordError {
    fn from(e: umi_media::MediaError) -> Self {
        RecordError::Write(e.to_string())
    }
}

impl From<std::io::Error> for RecordError {
    fn from(e: std::io::Error) -> Self {
        RecordError::Write(e.to_string())
    }
}

/// Owned copy of a frame, sent to a writer thread.
enum Job {
    Video { data: Vec<u8>, planes: FramePlanes, t: f64 },
    Audio { track: usize, samples: Vec<f32>, t: f64 },
}

#[derive(Clone, Copy)]
enum FramePlanes {
    Nv12 { y_len: usize, y_stride: usize, uv_stride: usize },
    Bgra { stride: usize },
    Rgba { stride: usize },
}

fn to_job(frame: Frame, t: f64) -> Job {
    match frame {
        Frame::Nv12 { y, y_stride, uv, uv_stride, .. } => {
            let mut data = Vec::with_capacity(y.len() + uv.len());
            data.extend_from_slice(y);
            data.extend_from_slice(uv);
            Job::Video { planes: FramePlanes::Nv12 { y_len: y.len(), y_stride, uv_stride }, data, t }
        }
        Frame::Bgra { data, stride, .. } => Job::Video { data: data.to_vec(), planes: FramePlanes::Bgra { stride }, t },
        Frame::Rgba { data, stride, .. } => Job::Video { data: data.to_vec(), planes: FramePlanes::Rgba { stride }, t },
    }
}

/// Feeds one file's writer from capture threads. Frames are dropped (not queued without
/// bound) if encoding falls behind; audio is never dropped.
struct Feed {
    tx: Sender<Job>,
    dropped: std::sync::atomic::AtomicU64,
    /// Frames seen (warming up counts too) and whether they're kept yet.
    seen: std::sync::atomic::AtomicU64,
    open: std::sync::atomic::AtomicBool,
}

impl Feed {
    fn new(tx: Sender<Job>) -> Self {
        Self { tx, dropped: Default::default(), seen: Default::default(), open: Default::default() }
    }
}

impl VideoSink for Feed {
    fn frame(&self, frame: Frame, t: f64) {
        use std::sync::atomic::Ordering::Relaxed;
        self.seen.fetch_add(1, Relaxed);
        if !self.open.load(Relaxed) {
            return;
        }
        if self.tx.len() >= 6 {
            self.dropped.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            return;
        }
        let _ = self.tx.send(to_job(frame, t));
    }
}

/// One source, two consumers (the file and the on-screen preview).
struct Tee(Arc<Feed>, Arc<dyn VideoSink>);

impl VideoSink for Tee {
    fn frame(&self, frame: Frame, t: f64) {
        let copy = match &frame {
            Frame::Rgba { width, height, data, stride } => Frame::Rgba { width: *width, height: *height, data, stride: *stride },
            Frame::Bgra { width, height, data, stride } => Frame::Bgra { width: *width, height: *height, data, stride: *stride },
            Frame::Nv12 { width, height, y, y_stride, uv, uv_stride } => {
                Frame::Nv12 { width: *width, height: *height, y, y_stride: *y_stride, uv, uv_stride: *uv_stride }
            }
        };
        self.1.frame(copy, t);
        self.0.frame(frame, t);
    }
}

/// A source switched to while recording, fitted into the video's size (black bars around it)
/// where the capture can't do that itself.
struct Fit {
    inner: Arc<dyn VideoSink>,
    size: (u32, u32),
    canvas: parking_lot::Mutex<Vec<u8>>,
}

impl VideoSink for Fit {
    fn frame(&self, frame: Frame, t: f64) {
        let (w, h) = frame.size();
        let (cw, ch) = self.size;
        if (w, h) == (cw, ch) || w == 0 || h == 0 {
            return self.inner.frame(frame, t);
        }
        let k = (cw as f64 / w as f64).min(ch as f64 / h as f64);
        let (dw, dh) = (((w as f64 * k) as u32).min(cw), ((h as f64 * k) as u32).min(ch));
        let (ox, oy) = ((cw - dw) / 2, (ch - dh) / 2);
        // Where a canvas pixel (inside the picture) comes from.
        let col = |x: u32| (((x - ox) as f64 / k) as usize).min(w as usize - 1);
        let row = |y: u32| (((y - oy) as f64 / k) as usize).min(h as usize - 1);
        let mut canvas = self.canvas.lock();
        match frame {
            Frame::Bgra { data, stride, .. } | Frame::Rgba { data, stride, .. } => {
                let rgba = matches!(frame, Frame::Rgba { .. });
                let out_stride = cw as usize * 4;
                // Opaque black bars.
                canvas.clear();
                canvas.extend(std::iter::repeat_n([0, 0, 0, 255], cw as usize * ch as usize).flatten());
                for y in oy..oy + dh {
                    let line = &data[row(y) * stride..];
                    let out = &mut canvas[y as usize * out_stride..];
                    for x in ox..ox + dw {
                        let s = col(x) * 4;
                        let d = x as usize * 4;
                        out[d..d + 4].copy_from_slice(&line[s..s + 4]);
                    }
                }
                let data = &canvas[..];
                let f = if rgba {
                    Frame::Rgba { width: cw, height: ch, data, stride: out_stride }
                } else {
                    Frame::Bgra { width: cw, height: ch, data, stride: out_stride }
                };
                self.inner.frame(f, t);
            }
            Frame::Nv12 { y: luma, y_stride, uv, uv_stride, .. } => {
                let (ys, uvs) = (cw as usize, cw as usize);
                let y_len = ys * ch as usize;
                canvas.clear();
                // Black: luma 16, chroma 128.
                canvas.resize(y_len, 16);
                canvas.resize(y_len + uvs * (ch as usize / 2), 128);
                let (out_y, out_uv) = canvas.split_at_mut(y_len);
                for y in oy..oy + dh {
                    let line = &luma[row(y) * y_stride..];
                    let out = &mut out_y[y as usize * ys..];
                    for x in ox..ox + dw {
                        out[x as usize] = line[col(x)];
                    }
                }
                for y in (oy / 2)..((oy + dh) / 2) {
                    let line = &uv[(row(y * 2) / 2) * uv_stride..];
                    let out = &mut out_uv[y as usize * uvs..];
                    for x in (ox / 2)..((ox + dw) / 2) {
                        let s = (col(x * 2) / 2) * 2;
                        let d = x as usize * 2;
                        out[d] = line[s];
                        out[d + 1] = line[s + 1];
                    }
                }
                let (out_y, out_uv) = canvas.split_at(y_len);
                self.inner.frame(Frame::Nv12 { width: cw, height: ch, y: out_y, y_stride: ys, uv: out_uv, uv_stride: uvs }, t);
            }
        }
    }
}

/// An audio source's track in a feed.
struct Track(Arc<Feed>, usize);

impl AudioSink for Track {
    fn audio(&self, samples: &[f32], t: f64) {
        if !self.0.open.load(std::sync::atomic::Ordering::Relaxed) {
            return;
        }
        let _ = self.0.tx.send(Job::Audio { track: self.1, samples: samples.to_vec(), t });
    }
}

/// Writes jobs to a file; the writer is made on the first frame when the size isn't known
/// up front (cameras).
fn writer_thread(path: PathBuf, settings: Option<WriterSettings>, fps: u32, rx: Receiver<Job>) -> JoinHandle<Result<u64, String>> {
    std::thread::Builder::new()
        .name("umi-writer".into())
        .spawn(move || {
            let mut writer: Option<StreamWriter> = match settings {
                Some(s) => Some(StreamWriter::create(&path, &s).map_err(|e| e.to_string())?),
                None => None,
            };
            for job in rx {
                match job {
                    Job::Video { data, planes, t } => {
                        if writer.is_none() {
                            // Camera: the size comes with the first frame.
                            let (w, h) = match planes {
                                FramePlanes::Rgba { stride } | FramePlanes::Bgra { stride } => {
                                    (stride as u32 / 4, (data.len() / stride) as u32)
                                }
                                FramePlanes::Nv12 { y_len, y_stride, .. } => (y_stride as u32, (y_len / y_stride) as u32),
                            };
                            let settings = WriterSettings {
                                width: w & !1,
                                height: h & !1,
                                fps,
                                codec: VideoCodec::H264,
                                bit_rate: 0,
                                audio_tracks: 0,
                                fragmented: true,
                                hardware: true,
                            };
                            writer = Some(StreamWriter::create(&path, &settings).map_err(|e| e.to_string())?);
                        }
                        let Some(w) = writer.as_mut() else { continue };
                        let pixels = match planes {
                            FramePlanes::Nv12 { y_len, y_stride, uv_stride } => {
                                Pixels::Nv12 { y: &data[..y_len], y_stride, uv: &data[y_len..], uv_stride }
                            }
                            FramePlanes::Bgra { stride } => Pixels::Bgra { data: &data, stride },
                            FramePlanes::Rgba { stride } => Pixels::Rgba { data: &data, stride },
                        };
                        w.push_video(pixels, t).map_err(|e| e.to_string())?;
                    }
                    Job::Audio { track, samples, t } => {
                        if let Some(w) = writer.as_mut() {
                            w.push_audio(track, &samples, t).map_err(|e| e.to_string())?;
                        }
                    }
                }
            }
            let frames = writer.as_ref().map_or(0, |w| w.frames_written());
            if let Some(w) = writer {
                w.finish().map_err(|e| e.to_string())?;
            }
            Ok(frames)
        })
        .expect("spawn writer")
}

/// A recording in progress.
/// Layouts while recording: the stretches so far and the current one (since when).
struct Layouts {
    past: Vec<LayoutSpan>,
    since: f64,
    current: SceneLayout,
}

pub struct Recording {
    pub bundle: PathBuf,
    clock: Clock,
    options: Options,
    started: chrono::DateTime<chrono::Utc>,
    screen: parking_lot::Mutex<Option<Box<dyn ScreenSession>>>,
    /// To start the screen again on another source (where it can't switch in place).
    screen_options: ScreenOptions,
    system: parking_lot::Mutex<Option<Arc<dyn AudioSink>>>,
    mic: Option<umi_capture::audio::MicSession>,
    camera: Option<umi_capture::camera::CameraSession>,
    input: parking_lot::Mutex<Option<InputRecorder>>,
    /// A phone's screen being read (instead of `screen`).
    device: Option<(Arc<std::sync::atomic::AtomicBool>, JoinHandle<()>)>,
    screen_feed: Option<Arc<Feed>>,
    camera_feed: Option<Arc<Feed>>,
    writers: Vec<JoinHandle<Result<u64, String>>>,
    size: (u32, u32),
    capture_rect: (f64, f64, f64, f64),
    audio: AudioInfo,
    /// The layout picked while recording (from the panel, or the camera button), with the
    /// stretches before it; the camera keeps recording whatever the layout.
    layouts: parking_lot::Mutex<Layouts>,
    /// The window in front, read once a second (names the recording).
    windows: parking_lot::Mutex<Option<WindowWatch>>,
}

struct WindowWatch {
    stop: Arc<std::sync::atomic::AtomicBool>,
    thread: JoinHandle<Vec<WindowSpan>>,
}

impl WindowWatch {
    fn start(clock: Clock) -> Self {
        let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let flag = stop.clone();
        let thread = std::thread::spawn(move || {
            let mut spans: Vec<WindowSpan> = Vec::new();
            while !flag.load(std::sync::atomic::Ordering::Relaxed) {
                // Paused time isn't in the video.
                if let (Some(t), Some(w)) = (clock.now(), umi_capture::focus::front_window()) {
                    if spans.last().is_none_or(|l| l.app != w.app || l.title != w.title) {
                        spans.push(WindowSpan { start: t, app: w.app, title: w.title });
                    }
                }
                std::thread::sleep(std::time::Duration::from_secs(1));
            }
            spans
        });
        WindowWatch { stop, thread }
    }

    fn finish(self) -> Vec<WindowSpan> {
        self.stop.store(true, std::sync::atomic::Ordering::Relaxed);
        self.thread.join().unwrap_or_default()
    }
}

/// The area (global points) the whole video shows once `source` is fitted into a video first
/// made of `first`: the pointer is stored relative to it, so it lands on the picture.
fn area_in_video(first: (f64, f64, f64, f64), source: (f64, f64, f64, f64)) -> Area {
    let (w0, h0) = (first.2.max(1.0), first.3.max(1.0));
    let k = (w0 / source.2.max(1.0)).min(h0 / source.3.max(1.0));
    let (w, h) = (w0 / k, h0 / k);
    Area { x: source.0 + (source.2 - w) / 2.0, y: source.1 + (source.3 - h) / 2.0, width: w, height: h }
}

/// "Umi 2026-10-25 at 10.41.07.umi" in `library` (made unique).
fn new_bundle(library: &Path) -> std::io::Result<PathBuf> {
    std::fs::create_dir_all(library)?;
    let stamp = chrono::Local::now().format("Umi %Y-%m-%d at %H.%M.%S").to_string();
    let mut path = library.join(format!("{stamp}.umi"));
    let mut n = 2;
    while path.exists() {
        path = library.join(format!("{stamp} {n}.umi"));
        n += 1;
    }
    std::fs::create_dir_all(&path)?;
    Ok(path)
}

impl Recording {
    /// Starts recording into a new bundle in `library` right away.
    pub fn start(library: &Path, options: Options) -> Result<Recording, RecordError> {
        let recording = Self::prepare(library, options, None)?;
        recording.begin();
        Ok(recording)
    }

    /// Opens every source and lets it warm up (cameras take a moment) without keeping
    /// anything yet; [`begin`](Self::begin) starts the recording at time 0. Call it when a
    /// countdown starts.
    /// `camera_preview` also gets every camera frame (the on-screen bubble), so the camera
    /// is opened once.
    pub fn prepare(library: &Path, options: Options, camera_preview: Option<Arc<dyn VideoSink>>) -> Result<Recording, RecordError> {
        let screen_options = ScreenOptions {
            fps: options.fps,
            max_size: options.max_size,
            show_cursor: false,
            system_audio: options.system_audio,
            exclude_own_windows: true,
            hide_desktop_icons: options.hide_desktop_icons,
        };
        // A phone: its picture comes through FFmpeg; size from the device itself.
        let device = match &options.target {
            Target::Device { name } => Some(umi_media::VideoDecoder::open_device(name, options.fps)?),
            _ => None,
        };
        let (rect, scale) = match &device {
            Some(d) => ((0.0, 0.0, d.info().width as f64, d.info().height as f64), 1.0),
            None => screen::geometry(&options.target)?,
        };
        let size = screen::fit(rect.2 * scale, rect.3 * scale, options.max_size);
        let bundle_path = new_bundle(library)?;
        let bundle = Bundle::new(&bundle_path);
        let clock = Clock::new();

        // Tracks: system sound first, then the microphone.
        let mut tracks = 0;
        let mut audio = AudioInfo::default();
        if options.system_audio {
            audio.system_track = Some(tracks as u32);
            tracks += 1;
        }
        if options.microphone.is_some() {
            audio.microphone_track = Some(tracks as u32);
            tracks += 1;
        }

        let (tx, rx) = bounded::<Job>(256);
        let screen_feed = Arc::new(Feed::new(tx));
        let settings = WriterSettings {
            width: size.0,
            height: size.1,
            fps: options.fps,
            codec: VideoCodec::H264,
            bit_rate: 0,
            audio_tracks: tracks,
            fragmented: true,
            hardware: true,
        };
        let mut writers = vec![writer_thread(bundle.screen(), Some(settings), options.fps, rx)];

        let mut recording = Recording {
            bundle: bundle_path.clone(),
            clock: clock.clone(),
            options: options.clone(),
            started: chrono::Utc::now(),
            screen: parking_lot::Mutex::new(None),
            screen_options: screen_options.clone(),
            system: parking_lot::Mutex::new(None),
            mic: None,
            camera: None,
            input: parking_lot::Mutex::new(None),
            device: None,
            screen_feed: Some(screen_feed.clone()),
            camera_feed: None,
            writers: vec![],
            size,
            capture_rect: rect,
            audio,
            layouts: parking_lot::Mutex::new(Layouts { past: vec![], since: 0.0, current: SceneLayout::Default }),
            windows: parking_lot::Mutex::new(None),
        };

        let result = (|| -> Result<(), RecordError> {
            let system: Option<Arc<dyn AudioSink>> =
                audio.system_track.map(|t| Arc::new(Track(screen_feed.clone(), t as usize)) as Arc<dyn AudioSink>);
            match device {
                Some(decoder) => recording.device = Some(device_thread(decoder, clock.clone(), screen_feed.clone())),
                None => {
                    *recording.screen.get_mut() =
                        Some(screen::start(&options.target, &screen_options, clock.clone(), screen_feed.clone(), system.clone())?);
                    *recording.system.get_mut() = system;
                }
            }
            if let (Some(id), Some(track)) = (&options.microphone, audio.microphone_track) {
                let sink: Arc<dyn AudioSink> = Arc::new(Track(screen_feed.clone(), track as usize));
                recording.mic = Some(umi_capture::audio::start(Some(id.as_str()).filter(|s| !s.is_empty()), clock.clone(), Some(sink))?);
            }
            if let Some(id) = &options.camera {
                let (tx, rx) = bounded::<Job>(64);
                let feed = Arc::new(Feed::new(tx));
                writers.push(writer_thread(bundle.camera(), None, 30, rx));
                let sink: Arc<dyn VideoSink> = match camera_preview {
                    Some(preview) => Arc::new(Tee(feed.clone(), preview)),
                    None => feed.clone(),
                };
                recording.camera = Some(umi_capture::camera::start(Some(id.as_str()).filter(|s| !s.is_empty()), clock.clone(), sink)?);
                recording.camera_feed = Some(feed);
            }
            Ok(())
        })();
        recording.writers = writers;
        if let Err(e) = result {
            recording.cancel();
            return Err(e);
        }
        Ok(recording)
    }

    /// Time 0: waits (up to 2 s) for the screen's and camera's first frames, then keeps
    /// everything from now on.
    pub fn begin(&self) {
        use std::sync::atomic::Ordering::Relaxed;
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
        let feeds: Vec<&Arc<Feed>> = self.screen_feed.iter().chain(self.camera_feed.iter()).collect();
        while std::time::Instant::now() < deadline && feeds.iter().any(|f| f.seen.load(Relaxed) == 0) {
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        self.clock.restart();
        for f in &feeds {
            f.open.store(true, Relaxed);
        }
        // A phone has no pointer to follow.
        if self.device.is_none() {
            let r = self.capture_rect;
            *self.input.lock() = Some(InputRecorder::start(self.clock.clone(), Area { x: r.0, y: r.1, width: r.2, height: r.3 }));
            // Which window is in front (not for the camera alone).
            if !self.options.camera_only {
                self.windows.lock().get_or_insert_with(|| WindowWatch::start(self.clock.clone()));
            }
        }
    }

    pub fn elapsed(&self) -> f64 {
        self.clock.elapsed()
    }

    pub fn is_paused(&self) -> bool {
        self.clock.is_paused()
    }

    pub fn pause(&self) {
        self.clock.pause();
    }

    pub fn resume(&self) {
        self.clock.resume();
    }

    /// Leaves out our windows that appeared after the recording started (the control bar,
    /// the camera bubble coming back).
    pub fn refresh_exclusions(&self) {
        if let Some(s) = self.screen.lock().as_ref() {
            s.refresh_exclusions();
        }
    }

    /// Records `target` from now on, without stopping: the video keeps its size and the new
    /// source is fitted in; the pointer follows it.
    pub fn switch_target(&self, target: &Target) -> Result<(), RecordError> {
        if self.device.is_some() || matches!(target, Target::Device { .. }) {
            return Err(CaptureError::Unsupported.into());
        }
        let (rect, _) = screen::geometry(target)?;
        let mut session = self.screen.lock();
        let switched = session.as_mut().map(|s| s.switch(target));
        if !matches!(switched, Some(Ok(()))) {
            // Start again on the new source, into the same file.
            let feed = self.screen_feed.clone().ok_or(CaptureError::Unsupported)?;
            if let Some(mut old) = session.take() {
                let _ = old.stop();
            }
            let sink: Arc<dyn VideoSink> = Arc::new(Fit { inner: feed, size: self.size, canvas: Default::default() });
            *session = Some(screen::start(target, &self.screen_options, self.clock.clone(), sink, self.system.lock().clone())?);
        }
        if let Some(input) = self.input.lock().as_ref() {
            input.set_area(area_in_video(self.capture_rect, rect));
        }
        Ok(())
    }

    /// The video's layout from now: screen and bubble, side by side, camera only or screen only.
    pub fn set_layout(&self, layout: SceneLayout) {
        let now = self.clock.elapsed();
        let mut l = self.layouts.lock();
        if l.current == layout {
            return;
        }
        let span = LayoutSpan { start: l.since, end: now, layout: l.current };
        if span.layout != SceneLayout::Default && span.end > span.start {
            l.past.push(span);
        }
        l.since = now;
        l.current = layout;
    }

    pub fn layout(&self) -> SceneLayout {
        self.layouts.lock().current
    }

    /// Turns the camera off (screen only) or back on in the video from now.
    pub fn set_camera_visible(&self, visible: bool) {
        match (visible, self.layout()) {
            (false, _) => self.set_layout(SceneLayout::HideCamera),
            (true, SceneLayout::HideCamera) => self.set_layout(SceneLayout::Default),
            _ => {}
        }
    }

    pub fn camera_visible(&self) -> bool {
        self.layout() != SceneLayout::HideCamera
    }

    /// Microphone peak level, 0…1 (for the control bar's meter).
    pub fn mic_level(&self) -> f32 {
        self.mic.as_ref().map_or(0.0, |m| m.level())
    }

    /// Frames dropped because encoding fell behind.
    pub fn dropped_frames(&self) -> u64 {
        self.screen_feed.as_ref().map_or(0, |f| f.dropped.load(std::sync::atomic::Ordering::Relaxed))
    }

    fn stop_sources(&mut self) -> umi_project::CursorData {
        if let Some(mut s) = self.screen.lock().take() {
            let _ = s.stop();
        }
        self.system.lock().take();
        if let Some((stop, thread)) = self.device.take() {
            stop.store(true, std::sync::atomic::Ordering::Relaxed);
            let _ = thread.join();
        }
        self.mic = None;
        if let Some(mut c) = self.camera.take() {
            c.stop();
        }
        // Closing the feeds ends the writer threads.
        self.screen_feed = None;
        self.camera_feed = None;
        self.input.lock().take().map(InputRecorder::stop).unwrap_or_default()
    }

    /// Stops and finishes the bundle; returns its path.
    pub fn stop(mut self) -> Result<PathBuf, RecordError> {
        let duration = self.clock.elapsed();
        let windows = self.windows.lock().take().map(WindowWatch::finish).filter(|w| !w.is_empty());
        let cursor = self.stop_sources();
        for w in std::mem::take(&mut self.writers) {
            w.join().map_err(|_| RecordError::Write("writer crashed".into()))?.map_err(RecordError::Write)?;
        }
        let bundle = Bundle::new(&self.bundle);
        bundle.write_cursor(&cursor).map_err(|e| RecordError::Write(e.to_string()))?;
        let has_camera = bundle.camera().exists();
        let project = RecordingProject {
            version: 1,
            created_at: self.started,
            // The file is the truth (the last frames may end slightly before the clock).
            duration: umi_media::duration(&bundle.screen()).ok().filter(|d| *d > 0.1).unwrap_or(duration),
            screen: ScreenInfo {
                pixel_width: self.size.0,
                pixel_height: self.size.1,
                capture_rect: Rect::new(self.capture_rect.0, self.capture_rect.1, self.capture_rect.2, self.capture_rect.3),
                fps: self.options.fps,
            },
            camera: has_camera.then(|| CameraInfo {
                bubble_center: self.options.camera_style.as_ref().map(|c| c.position),
                bubble: self.options.camera_style.clone(),
            }),
            audio: self.audio,
            edit: None,
            camera_only: self.options.camera_only.then_some(true),
            title: None,
            camera_off: None,
            layouts: {
                self.set_layout(SceneLayout::Default);
                let mut spans = std::mem::take(&mut self.layouts.lock().past);
                for span in &mut spans {
                    span.end = span.end.min(duration);
                }
                (has_camera && !spans.is_empty()).then_some(spans)
            },
            title_auto: None,
            windows,
        };
        let mut project = project;
        // Named after what was on screen right away; what was said may name it better later.
        if let Some(title) = project.windows.as_deref().and_then(|w| umi_project::insights::screen_title(w, project.duration)) {
            project.suggest_title(&title);
        }
        if self.device.is_some() || matches!(self.options.target, Target::Device { .. }) {
            // A phone recording starts in a phone frame, upright.
            let mut edit = project.default_edit(None);
            edit.frame = umi_project::edit::DeviceFrame::Phone;
            edit.aspect =
                if self.size.1 >= self.size.0 { umi_project::edit::AspectRatio::Vertical } else { umi_project::edit::AspectRatio::Wide };
            project.edit = Some(edit);
        }
        bundle.write_project(&project).map_err(|e| RecordError::Write(e.to_string()))?;
        Ok(self.bundle.clone())
    }

    /// Stops and throws the recording away (to the Trash is the app's choice; this removes
    /// the unfinished folder it made).
    pub fn cancel(mut self) {
        self.stop_sources();
        for w in std::mem::take(&mut self.writers) {
            let _ = w.join();
        }
        let _ = std::fs::remove_dir_all(&self.bundle);
    }
}

/// Reads a live device (a phone's screen) into a feed until stopped.
fn device_thread(
    mut decoder: umi_media::VideoDecoder,
    clock: Clock,
    feed: Arc<Feed>,
) -> (Arc<std::sync::atomic::AtomicBool>, JoinHandle<()>) {
    let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let flag = stop.clone();
    let thread = std::thread::Builder::new()
        .name("umi-device".into())
        .spawn(move || {
            while !flag.load(std::sync::atomic::Ordering::Relaxed) {
                let Ok(Some(frame)) = decoder.next() else { break };
                let Some(t) = clock.now() else { continue };
                let (w, h) = (frame.width, frame.height);
                match frame.format {
                    umi_media::FrameFormat::Nv12 => feed.frame(
                        Frame::Nv12 {
                            width: w,
                            height: h,
                            y: &frame.planes[0],
                            y_stride: frame.strides[0] as usize,
                            uv: &frame.planes[1],
                            uv_stride: frame.strides[1] as usize,
                        },
                        t,
                    ),
                    umi_media::FrameFormat::Rgba => {
                        feed.frame(Frame::Rgba { width: w, height: h, data: &frame.planes[0], stride: frame.strides[0] as usize }, t)
                    }
                }
            }
        })
        .expect("spawn device reader");
    (stop, thread)
}

/// Bundles left without a project.json (the app quit while recording): finished from what
/// was written. Returns the recovered bundles.
pub fn recover(library: &Path) -> Vec<PathBuf> {
    let mut out = vec![];
    for entry in std::fs::read_dir(library).into_iter().flatten().flatten() {
        let path = entry.path();
        let bundle = Bundle::new(&path);
        if path.extension().is_none_or(|e| e != "umi")
            || bundle.file(umi_project::project::PROJECT_FILE).exists()
            || !bundle.screen().exists()
        {
            continue;
        }
        let Ok(mut decoder) = umi_media::VideoDecoder::open(&bundle.screen(), false) else { continue };
        let info = decoder.info().clone();
        let _ = &mut decoder;
        if info.duration < 0.3 {
            continue;
        }
        let tracks = umi_media::audio_streams(&bundle.screen()).map(|a| a.len()).unwrap_or(0);
        let project = RecordingProject {
            version: 1,
            created_at: entry
                .metadata()
                .and_then(|m| m.created())
                .map(chrono::DateTime::<chrono::Utc>::from)
                .unwrap_or_else(|_| chrono::Utc::now()),
            duration: info.duration,
            screen: ScreenInfo {
                pixel_width: info.width,
                pixel_height: info.height,
                capture_rect: Rect::new(0.0, 0.0, info.width as f64 / 2.0, info.height as f64 / 2.0),
                fps: info.fps.round().max(1.0) as u32,
            },
            camera: bundle.camera().exists().then(CameraInfo::default),
            // Without the original settings: the last track is taken as the microphone.
            audio: AudioInfo { system_track: (tracks >= 2).then_some(0), microphone_track: (tracks >= 1).then_some(tracks as u32 - 1) },
            edit: None,
            camera_only: None,
            title: None,
            camera_off: None,
            layouts: None,
            title_auto: None,
            windows: None,
        };
        if bundle.write_project(&project).is_ok() {
            if !bundle.file(umi_project::project::CURSOR_FILE).exists() {
                let _ = bundle.write_cursor(&umi_project::CursorData::default());
            }
            out.push(path);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_pointer_follows_a_switched_source() {
        // The same size: the source itself.
        let a = area_in_video((0.0, 0.0, 1600.0, 900.0), (100.0, 50.0, 1600.0, 900.0));
        assert_eq!((a.x, a.y, a.width, a.height), (100.0, 50.0, 1600.0, 900.0));
        // A narrower window, fitted by height: bars left and right.
        let a = area_in_video((0.0, 0.0, 1600.0, 900.0), (200.0, 100.0, 800.0, 900.0));
        assert_eq!((a.x, a.y, a.width, a.height), (-200.0, 100.0, 1600.0, 900.0));
    }

    struct Last(parking_lot::Mutex<Option<(u32, u32, Vec<u8>)>>);
    impl VideoSink for Last {
        fn frame(&self, frame: Frame, _t: f64) {
            if let Frame::Bgra { width, height, data, .. } = frame {
                *self.0.lock() = Some((width, height, data.to_vec()));
            }
        }
    }

    #[test]
    fn fits_a_smaller_source_with_black_bars() {
        let last = Arc::new(Last(Default::default()));
        let fit = Fit { inner: last.clone(), size: (4, 2), canvas: Default::default() };
        // A white 2×2 picture into 4×2: columns 1 and 2 white, the sides black.
        fit.frame(Frame::Bgra { width: 2, height: 2, data: &[255; 16], stride: 8 }, 0.0);
        let (w, h, data) = last.0.lock().take().unwrap();
        assert_eq!((w, h), (4, 2));
        assert_eq!(&data[0..4], &[0, 0, 0, 255]);
        assert_eq!(&data[4..8], &[255; 4]);
        assert_eq!(&data[12..16], &[0, 0, 0, 255]);
    }
}
