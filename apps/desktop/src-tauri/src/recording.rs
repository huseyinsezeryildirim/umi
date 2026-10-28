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
    /// Leave desktop icons out of the recording (macOS).
    pub hide_desktop_icons: bool,
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
            hide_desktop_icons: false,
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
        // Without permission, asking ScreenCaptureKit for the screens shows macOS's prompt, and
        // the launcher asks on every focus: Deny, focus back, prompt again. Only Start asks.
        let listed = if screen_allowed() {
            (umi_capture::screen::displays(), umi_capture::screen::windows())
        } else {
            (Err(umi_capture::CaptureError::ScreenPermission), Ok(vec![]))
        };
        let (displays, windows, missing) = match listed {
            (Ok(d), Ok(w)) => (d, w, None),
            (Err(umi_capture::CaptureError::ScreenPermission), _) | (_, Err(umi_capture::CaptureError::ScreenPermission)) => {
                (vec![], vec![], Some("screen".to_string()))
            }
            (d, w) => (d.unwrap_or_default(), w.unwrap_or_default(), None),
        };
        Sources {
            displays,
            windows,
            microphones: umi_capture::audio::microphones(),
            cameras: umi_capture::camera::cameras(),
            phones: umi_media::device::screen_devices(),
            missing_permission: missing,
        }
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
        *meter =
            Some(umi_capture::audio::start(Some(id.as_str()).filter(|s| !s.is_empty()), Clock::new(), None).map_err(|e| e.to_string())?);
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
    /// The camera is shown in the video now (it can be turned off and on while recording).
    camera_visible: bool,
    /// The video's layout now (picked from the layout column while recording).
    layout: umi_project::edit::SceneLayout,
}

#[tauri::command]
pub fn record_status(state: State<'_, AppState>) -> Status {
    let current = state.recorder.current.lock();
    let level = match current.as_ref() {
        Some(r) => r.mic_level(),
        None => state.recorder.meter.lock().as_ref().map_or(0.0, |m| m.level()),
    };
    Status {
        recording: current.is_some(),
        paused: current.as_ref().is_some_and(|r| r.is_paused()),
        elapsed: current.as_ref().map_or(0.0, |r| r.elapsed()),
        level,
        camera_visible: current.as_ref().is_none_or(|r| r.camera_visible()),
        layout: current.as_ref().map_or(umi_project::edit::SceneLayout::Default, |r| r.layout()),
    }
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
        if image::DynamicImage::ImageRgba8(small).to_rgb8().write_to(&mut std::io::Cursor::new(&mut jpeg), image::ImageFormat::Jpeg).is_ok()
        {
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
            *preview = Some(
                umi_capture::camera::start(Some(id.as_str()).filter(|s| !s.is_empty()), Clock::new(), rec.preview_sink())
                    .map_err(|e| e.to_string())?,
            );
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Turns the bubble's camera off (the bubble was hidden); a recording's camera keeps going.
pub fn stop_preview(app: &AppHandle) {
    *app.state::<AppState>().recorder.preview.lock() = None;
}

fn options(settings: &RecordSettings) -> Result<umi_recorder::Options, String> {
    let target = match &settings.target {
        Some(t) => t.clone(),
        None => umi_capture::screen::displays()
            .map_err(|e| e.to_string())?
            .first()
            .map(|d| Target::Display { id: d.id })
            .ok_or("No display found")?,
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
        hide_desktop_icons: settings.hide_desktop_icons,
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
        // Without the permission, capture waits on macOS's prompt and nothing seems to happen:
        // ask once (macOS shows its prompt) and say so instead.
        if !screen_permission() {
            return Err(SCREEN_PERMISSION.to_string());
        }
        let options = options(&settings)?;
        // The meter and preview step aside; the recording opens the devices itself.
        *rec.meter.lock() = None;
        *rec.preview.lock() = None;
        let preview = options.camera.is_some().then(|| rec.preview_sink());
        let recording = umi_recorder::Recording::prepare(&crate::library_folder(), options, preview).map_err(|e| e.to_string())?;
        *rec.current.lock() = Some(recording);
        float_over_full_screen_apps(&app, true);
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// While recording, the app runs as an accessory (no Dock icon) so its floating windows (the
/// bar, the camera bubble) show over other apps' full-screen Spaces too; then back to normal.
fn float_over_full_screen_apps(app: &AppHandle, on: bool) {
    #[cfg(target_os = "macos")]
    {
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            let policy = if on { tauri::ActivationPolicy::Accessory } else { tauri::ActivationPolicy::Regular };
            let _ = handle.set_activation_policy(policy);
            // macOS only lets the windows that were already up into another app's full-screen
            // Space once they're put in front again under the new policy.
            if on {
                crate::windows::refloat(&handle);
            }
        });
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, on);
}

/// What `record_prepare` answers when macOS hasn't allowed screen recording (the UI shows the
/// launcher's permission row then).
const SCREEN_PERMISSION: &str = "SCREEN_PERMISSION";

#[cfg(target_os = "macos")]
#[allow(unsafe_code)]
#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGPreflightScreenCaptureAccess() -> bool;
    fn CGRequestScreenCaptureAccess() -> bool;
}

/// Screen recording is allowed, without asking (macOS only sees a new answer after a relaunch).
#[allow(unsafe_code)]
fn screen_allowed() -> bool {
    // SAFETY: a plain CoreGraphics call without arguments.
    #[cfg(target_os = "macos")]
    return unsafe { CGPreflightScreenCaptureAccess() };
    #[cfg(not(target_os = "macos"))]
    true
}

/// Screen recording is allowed; if not, macOS's prompt is shown (once per app version).
#[allow(unsafe_code)]
fn screen_permission() -> bool {
    // SAFETY: a plain CoreGraphics call without arguments.
    #[cfg(target_os = "macos")]
    return screen_allowed() || unsafe { CGRequestScreenCaptureAccess() };
    #[cfg(not(target_os = "macos"))]
    true
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

/// Turns the camera off or on while recording: the bubble goes away or comes back, and the
/// video hides the camera for that stretch (the camera keeps recording, so it can be undone).
#[tauri::command]
pub fn record_camera(app: AppHandle, state: State<'_, AppState>, visible: bool) -> Result<(), String> {
    if let Some(r) = state.recorder.current.lock().as_ref() {
        r.set_camera_visible(visible);
        // The layout column follows.
        let _ = app.emit("record:layout", r.layout());
    }
    if visible {
        crate::windows::show(&app, &crate::windows::BUBBLE, None).map_err(|e| e.to_string())?;
    } else {
        crate::windows::hide(&app, "bubble");
    }
    Ok(())
}

/// The video's layout from now (the layout column): the bubble steps aside for screen only.
#[tauri::command]
pub fn record_layout(app: AppHandle, state: State<'_, AppState>, layout: umi_project::edit::SceneLayout) -> Result<(), String> {
    if let Some(r) = state.recorder.current.lock().as_ref() {
        r.set_layout(layout);
    }
    if layout == umi_project::edit::SceneLayout::HideCamera {
        crate::windows::hide(&app, "bubble");
    } else {
        crate::windows::show(&app, &crate::windows::BUBBLE, None).map_err(|e| e.to_string())?;
    }
    let _ = app.emit("record:layout", layout);
    Ok(())
}

/// Records another display or window from now on, without stopping; a frame shows it briefly.
#[tauri::command]
pub async fn record_switch(app: AppHandle, target: Target) -> Result<(), String> {
    let rect = umi_capture::screen::geometry(&target).ok().map(|g| g.0);
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = handle.state::<AppState>();
        let current = state.recorder.current.lock();
        let r = current.as_ref().ok_or("Not recording")?;
        r.switch_target(&target).map_err(|e| e.to_string())?;
        r.refresh_exclusions();
        Ok::<_, String>(())
    })
    .await
    .map_err(|e| e.to_string())??;
    flash_frame(&app, rect);
    Ok(())
}

/// The frame around what's recorded, for a moment. Linux can't leave it out of the video.
fn flash_frame(app: &AppHandle, rect: Option<(f64, f64, f64, f64)>) {
    if cfg!(target_os = "linux") {
        return;
    }
    crate::windows::frame(app, rect);
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(1400));
        crate::windows::frame(&app, None);
    });
}

/// The frame around what the coming recording records (during the countdown), or none.
#[tauri::command]
pub fn record_frame(app: AppHandle, on: bool) -> Result<(), String> {
    if !on || cfg!(target_os = "linux") {
        crate::windows::frame(&app, None);
        return Ok(());
    }
    let target = options(&load_settings())?.target;
    crate::windows::frame(&app, umi_capture::screen::geometry(&target).ok().map(|g| g.0));
    Ok(())
}

/// Stops and returns the new recording's bundle.
#[tauri::command]
pub async fn record_stop(app: AppHandle) -> Result<PathBuf, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let recording = state.recorder.current.lock().take().ok_or("Not recording")?;
        float_over_full_screen_apps(&app, false);
        let bundle = recording.stop().map_err(|e| e.to_string())?;
        let _ = app.emit("recording", "stopped");
        auto_title(app.clone(), bundle.clone());
        Ok(bundle)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Throws the recording away.
#[tauri::command]
/// `trash`: a recording the person discarded goes to the Trash (not gone for good); one that
/// never started is just removed.
pub async fn record_cancel(app: AppHandle, trash: Option<bool>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let current = state.recorder.current.lock().take();
        if let Some(r) = current {
            if trash == Some(true) {
                let bundle = r.discard();
                if trash::delete(&bundle).is_err() {
                    let _ = std::fs::remove_dir_all(&bundle);
                }
            } else {
                r.cancel();
            }
        }
        float_over_full_screen_apps(&app, false);
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
        std::process::Command::new("sh")
            .args(["-c", &format!("printf 'file://%s' \"{path}\" | xclip -selection clipboard -t text/uri-list")])
            .status()
    };
    status.map_err(|e| e.to_string()).and_then(|s| if s.success() { Ok(()) } else { Err("Couldn't copy".into()) })
}

/// Names a new recording from what was said, in the background, when the speech model is
/// already on this computer (it isn't downloaded just for this). The library refreshes when done.
fn auto_title(app: AppHandle, bundle: PathBuf) {
    let model = umi_ai::models::Model::WhisperBase;
    if !model.is_ready() {
        return;
    }
    std::thread::spawn(move || {
        let files = umi_project::Bundle::new(&bundle);
        let Ok(mut project) = files.read_project() else { return };
        let screen = files.screen();
        let tracks = umi_media::audio_streams(&screen).map(|t| t.len()).unwrap_or(0);
        if tracks == 0 {
            return;
        }
        let track = project.audio.microphone_track.map(|t| t as usize).filter(|t| *t < tracks).unwrap_or(0);
        let Ok(samples) = umi_ai::transcribe::read_mono_16k(&screen, track) else { return };
        let Ok((words, _)) = umi_ai::transcribe::transcribe(&model.path(), &samples, None, |_| {}) else { return };
        let words: Vec<umi_project::edit::CaptionWord> = words
            .into_iter()
            .map(|w| umi_project::edit::CaptionWord { id: uuid::Uuid::new_v4(), start: w.start, end: w.end, text: w.text })
            .collect();
        if umi_project::insights::insights(&words).is_none() {
            return;
        }
        // Re-read: the editor may have saved meanwhile.
        if let Ok(latest) = files.read_project() {
            project = latest;
        }
        // What was said, and the app it was shown in.
        let windows = project.windows.clone().unwrap_or_default();
        let Some(title) = umi_project::insights::title(&words, &windows, project.duration) else { return };
        if project.suggest_title(&title) && files.write_project(&project).is_ok() {
            let _ = app.emit("library:changed", ());
        }
    });
}
