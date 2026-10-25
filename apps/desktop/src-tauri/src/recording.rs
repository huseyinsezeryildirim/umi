//! Recording from the app: settings (remembered), sources and devices, the microphone meter
//! and camera preview for the launcher and bubble, and the recording itself (prepare during
//! the countdown, begin, pause, stop, discard).

use crate::AppState;
use crate::presets::config_folder;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::ipc::{Channel, Response};
use tauri::{AppHandle, Emitter, Manager, State};
use umi_capture::{Clock, Frame, Target, VideoSink};
use umi_project::edit::Camera as CameraStyle;

/// What the launcher remembers between recordings.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RecordSettings {
    pub target: Option<Target>,
    pub fps: u32,
    /// "native", "1080p" or "720p".
    pub resolution: String,
    pub system_audio: bool,
    /// `None` = no microphone; "" = the default one.
    pub microphone: Option<String>,
    pub camera: Option<String>,
    pub camera_on: bool,
    pub camera_style: CameraStyle,
    pub countdown: bool,
    /// "studio" (open the editor) or "instant" (export and copy right away).
    pub flow: String,
    pub camera_only: bool,
    /// Speaker notes shown in the prompter while recording.
    pub notes: String,
    pub notes_on: bool,
    /// Prompter scrolling, lines per minute (0 = still).
    pub notes_speed: f64,
    pub notes_size: f64,
}

impl Default for RecordSettings {
    fn default() -> Self {
        Self {
            target: None,
            fps: 60,
            resolution: "native".into(),
            system_audio: true,
            microphone: Some(String::new()),
            camera: None,
            camera_on: false,
            camera_style: CameraStyle::default(),
            countdown: true,
            flow: "studio".into(),
            camera_only: false,
            notes: String::new(),
            notes_on: false,
            notes_speed: 18.0,
            notes_size: 22.0,
        }
    }
}

fn settings_file() -> PathBuf {
    config_folder().join("recording.json")
}

pub fn load_settings() -> RecordSettings {
    std::fs::read(settings_file()).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

#[derive(Default)]
pub struct Recorder {
    pub current: Mutex<Option<umi_recorder::Recording>>,
    meter: Mutex<Option<umi_capture::audio::MicSession>>,
    preview: Mutex<Option<umi_capture::camera::CameraSession>>,
    /// Where camera frames go for the bubble (kept across preview and recording).
    preview_channel: Arc<Mutex<Option<Channel<Response>>>>,
}

#[tauri::command]
pub fn record_settings() -> RecordSettings {
    load_settings()
}

#[tauri::command]
pub fn record_settings_save(settings: RecordSettings) -> Result<(), String> {
    let json = serde_json::to_vec_pretty(&settings).map_err(|e| e.to_string())?;
    std::fs::write(settings_file(), json).map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Sources {
    displays: Vec<umi_capture::Display>,
    windows: Vec<umi_capture::Window>,
    microphones: Vec<umi_capture::audio::Microphone>,
    cameras: Vec<umi_capture::camera::CameraDevice>,
    /// iPhones/iPads connected by cable (macOS).
    phones: Vec<umi_media::device::ScreenDevice>,
    /// Empty when everything's allowed; otherwise what's missing ("screen").
    missing_permission: Option<String>,
}

#[tauri::command]
pub async fn record_sources() -> Result<Sources, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let (displays, windows, missing) = match (umi_capture::screen::displays(), umi_capture::screen::windows()) {
            (Ok(d), Ok(w)) => (d, w, None),
            (Err(umi_capture::CaptureError::ScreenPermission), _) | (_, Err(umi_capture::CaptureError::ScreenPermission)) => (vec![], vec![], Some("screen".to_string())),
            (d, w) => (d.unwrap_or_default(), w.unwrap_or_default(), None),
        };
        Sources { displays, windows, microphones: umi_capture::audio::microphones(), cameras: umi_capture::camera::cameras(), phones: umi_media::device::screen_devices(), missing_permission: missing }
    })
    .await
    .map_err(|e| e.to_string())
}

/// Runs the launcher's microphone meter (or stops it with `None`).
#[tauri::command]
pub fn record_meter(state: State<'_, AppState>, microphone: Option<String>) -> Result<(), String> {
    let mut meter = state.recorder.meter.lock();
    *meter = None;
    if let Some(id) = microphone {
        *meter = Some(umi_capture::audio::start(Some(id.as_str()).filter(|s| !s.is_empty()), Clock::new(), None).map_err(|e| e.to_string())?);
    }
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    recording: bool,
    paused: bool,
    elapsed: f64,
    level: f32,
}

#[tauri::command]
pub fn record_status(state: State<'_, AppState>) -> Status {
    let current = state.recorder.current.lock();
    let level = match current.as_ref() {
        Some(r) => r.mic_level(),
        None => state.recorder.meter.lock().as_ref().map_or(0.0, |m| m.level()),
    };
    Status { recording: current.is_some(), paused: current.as_ref().is_some_and(|r| r.is_paused()), elapsed: current.as_ref().map_or(0.0, |r| r.elapsed()), level }
}

/// Camera frames for the bubble: small JPEGs, at most ~30 a second.
struct Preview {
    channel: Arc<Mutex<Option<Channel<Response>>>>,
    last: Mutex<std::time::Instant>,
}

impl VideoSink for Preview {
    fn frame(&self, frame: Frame, _t: f64) {
        {
            let mut last = self.last.lock();
            if last.elapsed() < std::time::Duration::from_millis(30) {
                return;
            }
            *last = std::time::Instant::now();
        }
        let Some(channel) = self.channel.lock().clone() else { return };
        let Frame::Rgba { width, height, data, stride } = frame else { return };
        let Some(img) = image::RgbaImage::from_raw(width, height, data[..stride * height as usize].to_vec()) else { return };
        let small = image::imageops::thumbnail(&img, 480, (480 * height / width.max(1)).max(1));
        let mut jpeg = Vec::new();
        if image::DynamicImage::ImageRgba8(small).to_rgb8().write_to(&mut std::io::Cursor::new(&mut jpeg), image::ImageFormat::Jpeg).is_ok() {
            let _ = channel.send(Response::new(jpeg));
        }
    }
}

impl Recorder {
    fn preview_sink(&self) -> Arc<dyn VideoSink> {
        Arc::new(Preview { channel: self.preview_channel.clone(), last: Mutex::new(std::time::Instant::now()) })
    }
}

/// Starts the bubble's camera preview (frames on `frames`), or stops it with `camera: None`.
/// While recording, the recording's own camera feeds the bubble.
#[tauri::command]
pub async fn record_camera_preview(app: AppHandle, camera: Option<String>, frames: Channel<Response>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let rec = &state.recorder;
        *rec.preview_channel.lock() = Some(frames);
        let mut preview = rec.preview.lock();
        *preview = None;
        if rec.current.lock().is_some() {
            return Ok(());
        }
        if let Some(id) = camera {
            *preview = Some(umi_capture::camera::start(Some(id.as_str()).filter(|s| !s.is_empty()), Clock::new(), rec.preview_sink()).map_err(|e| e.to_string())?);
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn options(settings: &RecordSettings) -> Result<umi_recorder::Options, String> {
    let target = match &settings.target {
        Some(t) => t.clone(),
        None => umi_capture::screen::displays().map_err(|e| e.to_string())?.first().map(|d| Target::Display { id: d.id }).ok_or("No display found")?,
    };
    let max_size = match settings.resolution.as_str() {
        "1080p" => 1920,
        "720p" => 1280,
        _ => 0,
    };
    Ok(umi_recorder::Options {
        target,
        fps: settings.fps.clamp(15, 60),
        max_size,
        system_audio: settings.system_audio,
        microphone: settings.microphone.clone(),
        camera: (settings.camera_on || settings.camera_only).then(|| settings.camera.clone().unwrap_or_default()),
        camera_style: settings.camera_on.then(|| settings.camera_style.clone()),
        camera_only: settings.camera_only,
    })
}

/// Opens every source for the coming recording (call when the countdown starts).
#[tauri::command]
pub async fn record_prepare(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let rec = &state.recorder;
        if rec.current.lock().is_some() {
            return Err("Already recording".to_string());
        }
        let settings = load_settings();
        let options = options(&settings)?;
        // The meter and preview step aside; the recording opens the devices itself.
        *rec.meter.lock() = None;
        *rec.preview.lock() = None;
        let preview = options.camera.is_some().then(|| rec.preview_sink());
        let recording = umi_recorder::Recording::prepare(&crate::library_folder(), options, preview).map_err(|e| e.to_string())?;
        *rec.current.lock() = Some(recording);
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Time 0 (after the countdown).
#[tauri::command]
pub async fn record_begin(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        if let Some(r) = state.recorder.current.lock().as_ref() {
            r.begin();
        }
        let _ = app.emit("recording", "started");
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn record_pause(app: AppHandle, state: State<'_, AppState>, paused: bool) {
    if let Some(r) = state.recorder.current.lock().as_ref() {
        if paused { r.pause() } else { r.resume() }
    }
    let _ = app.emit("recording", if paused { "paused" } else { "resumed" });
}

/// Stops and returns the new recording's bundle.
#[tauri::command]
pub async fn record_stop(app: AppHandle) -> Result<PathBuf, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let recording = state.recorder.current.lock().take().ok_or("Not recording")?;
        let bundle = recording.stop().map_err(|e| e.to_string())?;
        let _ = app.emit("recording", "stopped");
        Ok(bundle)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Throws the recording away.
#[tauri::command]
pub async fn record_cancel(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        if let Some(r) = state.recorder.current.lock().take() {
            r.cancel();
        }
        let _ = app.emit("recording", "cancelled");
    })
    .await
    .map_err(|e| e.to_string())
}

/// Puts a file on the clipboard (Instant mode: paste the video anywhere).
#[tauri::command]
pub fn copy_file_to_clipboard(path: PathBuf) -> Result<(), String> {
    let path = path.to_string_lossy().replace('"', "\\\"");
    let status = if cfg!(target_os = "macos") {
        std::process::Command::new("osascript").args(["-e", &format!("set the clipboard to (POSIX file \"{path}\")")]).status()
    } else if cfg!(windows) {
        std::process::Command::new("powershell").args(["-NoProfile", "-Command", &format!("Set-Clipboard -Path \"{path}\"")]).status()
    } else {
        std::process::Command::new("sh").args(["-c", &format!("printf 'file://%s' \"{path}\" | xclip -selection clipboard -t text/uri-list")]).status()
    };
    status.map_err(|e| e.to_string()).and_then(|s| if s.success() { Ok(()) } else { Err("Couldn't copy".into()) })
}
