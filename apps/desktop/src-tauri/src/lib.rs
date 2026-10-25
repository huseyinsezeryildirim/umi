//! Umi desktop app: Tauri shell around the Rust core. Windows are Solid UIs; heavy work
//! (decoding, rendering, encoding) stays in Rust.

mod assets;
mod editor;
mod import;
mod presets;
mod recording;
mod windows;
mod tray;
mod shortcuts;
mod share;
mod screenshot;

use editor::{EditorSession, EditorState, Op};
use parking_lot::Mutex;
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use tauri::ipc::Response;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{Emitter, Manager, State};
use umi_render::Gpu;

#[derive(Default)]
pub(crate) struct AppState {
    editors: Mutex<HashMap<String, Arc<EditorSession>>>,
    gpu: OnceLock<Arc<Gpu>>,
    /// Library hover previews by recording path (JPEG data URLs).
    previews: Mutex<HashMap<PathBuf, Arc<Vec<String>>>>,
    pub(crate) recorder: recording::Recorder,
    /// What the area picker is for: "record" or "screenshot".
    pub(crate) area_mode: Mutex<String>,
    /// The latest screenshot, waiting for the screenshot editor.
    pub(crate) last_shot: Mutex<Option<PathBuf>>,
    /// The AI voice, loaded on first use.
    voice: Mutex<Option<umi_ai::tts::Voice>>,
    /// Running exports by editor id (cancel flags).
    exports: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl AppState {
    pub(crate) fn gpu(&self) -> Result<Arc<Gpu>, String> {
        if let Some(gpu) = self.gpu.get() {
            return Ok(gpu.clone());
        }
        let gpu = Gpu::new().map_err(|e| e.to_string())?;
        Ok(self.gpu.get_or_init(|| gpu).clone())
    }

    pub(crate) fn editor(&self, id: &str) -> Result<Arc<EditorSession>, String> {
        self.editors.lock().get(id).cloned().ok_or_else(|| format!("no editor {id}"))
    }
}

/// Where recordings live (same folder as the Swift app: ~/Movies/Umi).
pub(crate) fn library_folder() -> PathBuf {
    dirs::video_dir().unwrap_or_else(|| dirs::home_dir().unwrap_or_default().join("Movies")).join("Umi")
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RecordingSummary {
    path: PathBuf,
    name: String,
    duration: f64,
    created_at: String,
}

#[tauri::command]
fn list_recordings() -> Vec<RecordingSummary> {
    let mut out: Vec<RecordingSummary> = std::fs::read_dir(library_folder())
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|e| e == "umi"))
        .filter_map(|p| {
            let bundle = umi_project::Bundle::new(&p);
            let project = bundle.read_project().ok()?;
            Some(RecordingSummary { name: bundle.name(), duration: project.duration, created_at: project.created_at.to_rfc3339(), path: p })
        })
        .collect();
    out.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    out
}

#[tauri::command]
async fn open_editor(state: State<'_, AppState>, path: PathBuf) -> Result<EditorState, String> {
    let id = path.to_string_lossy().into_owned();
    if let Ok(existing) = state.editor(&id) {
        return Ok(existing.state(None));
    }
    let gpu = state.gpu()?;
    let session = tauri::async_runtime::spawn_blocking(move || EditorSession::open(gpu, id.clone(), &path)).await.map_err(|e| e.to_string())??;
    let result = session.state(None);
    state.editors.lock().insert(session.id.clone(), session);
    Ok(result)
}

#[tauri::command]
fn editor_apply(state: State<'_, AppState>, id: String, op: Op) -> Result<EditorState, String> {
    Ok(state.editor(&id)?.apply(op))
}

#[tauri::command]
fn editor_save(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.editor(&id)?.save()
}

#[tauri::command]
async fn editor_frame(state: State<'_, AppState>, id: String, time: f64, width: u32, height: u32, flat: Option<bool>) -> Result<Response, String> {
    let editor = state.editor(&id)?;
    let bytes = tauri::async_runtime::spawn_blocking(move || editor.frame(time, width, height, flat.unwrap_or(false))).await.map_err(|e| e.to_string())??;
    Ok(Response::new(bytes))
}

/// Filmstrip: `count` JPEG thumbnails (data URLs) evenly over the recording.
#[tauri::command]
async fn recording_thumbnails(path: PathBuf, count: usize, height: u32) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        use base64::Engine;
        let screen = umi_project::Bundle::new(&path).screen();
        let duration = umi_media::duration(&screen).map_err(|e| e.to_string())?;
        let count = count.clamp(1, 200);
        let times: Vec<f64> = (0..count).map(|i| (i as f64 + 0.5) / count as f64 * duration).collect();
        let thumbs = umi_media::keyframe_thumbnails(&screen, &times, height * 2).map_err(|e| e.to_string())?;
        thumbs
            .into_iter()
            .map(|(w, h, rgba)| {
                let img = image::RgbaImage::from_raw(w, h, rgba).ok_or("bad thumbnail")?;
                let mut jpeg = Vec::new();
                image::DynamicImage::ImageRgba8(img).to_rgb8().write_to(&mut std::io::Cursor::new(&mut jpeg), image::ImageFormat::Jpeg).map_err(|e| e.to_string())?;
                Ok(format!("data:image/jpeg;base64,{}", base64::engine::general_purpose::STANDARD.encode(jpeg)))
            })
            .collect()
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Frames for a library card: a poster first, then short snippets from four places in the
/// recording (6 frames each at 8 fps), played on hover. Cached for the session.
#[tauri::command]
async fn recording_preview(state: State<'_, AppState>, path: PathBuf) -> Result<Arc<Vec<String>>, String> {
    if let Some(cached) = state.previews.lock().get(&path) {
        return Ok(cached.clone());
    }
    let p = path.clone();
    let frames = tauri::async_runtime::spawn_blocking(move || -> Result<Vec<String>, String> {
        use base64::Engine;
        let screen = umi_project::Bundle::new(&p).screen();
        let mut decoder = umi_media::VideoDecoder::open(&screen, true).map_err(|e| e.to_string())?;
        let duration = decoder.info().duration.max(0.5);
        let mut out = vec![];
        for segment in 0..4 {
            let start = duration * (0.08 + 0.24 * segment as f64);
            for k in 0..6 {
                let t = (start + k as f64 / 8.0).min(duration - 0.05);
                let Some(frame) = decoder.frame_at(t).map_err(|e| e.to_string())? else { continue };
                let (w, h, rgba) = umi_media::to_rgba(&frame, 480).map_err(|e| e.to_string())?;
                let img = image::RgbaImage::from_raw(w, h, rgba).ok_or("bad frame")?;
                let mut jpeg = Vec::new();
                image::DynamicImage::ImageRgba8(img).to_rgb8().write_to(&mut std::io::Cursor::new(&mut jpeg), image::ImageFormat::Jpeg).map_err(|e| e.to_string())?;
                out.push(format!("data:image/jpeg;base64,{}", base64::engine::general_purpose::STANDARD.encode(jpeg)));
            }
        }
        Ok(out)
    })
    .await
    .map_err(|e| e.to_string())??;
    let frames = Arc::new(frames);
    state.previews.lock().insert(path, frames.clone());
    Ok(frames)
}

/// Moves a recording to the system Trash (recoverable), closing its editor first.
#[tauri::command]
fn recording_trash(state: State<'_, AppState>, path: PathBuf) -> Result<(), String> {
    if path.extension().is_none_or(|e| e != "umi") {
        return Err("not a recording".into());
    }
    state.editors.lock().remove(&path.to_string_lossy().into_owned());
    state.previews.lock().remove(&path);
    trash::delete(&path).map_err(|e| e.to_string())
}

/// Shows a recording in Finder / Explorer / the file manager.
#[tauri::command]
fn recording_reveal(app: tauri::AppHandle, path: PathBuf) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener().reveal_item_in_dir(path).map_err(|e| e.to_string())
}

/// Voice loudness (0…1) at 50 values per second, from the mic track (or the first audio).
#[tauri::command]
async fn recording_waveform(path: PathBuf) -> Result<Vec<f32>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let bundle = umi_project::Bundle::new(&path);
        let project = bundle.read_project().map_err(|e| e.to_string())?;
        let screen = bundle.screen();
        let tracks = umi_media::audio_streams(&screen).map_err(|e| e.to_string())?.len();
        if tracks == 0 {
            return Ok(vec![]);
        }
        let track = project.audio.microphone_track.map(|t| t as usize).filter(|t| *t < tracks).unwrap_or(0);
        umi_media::waveform(&screen, track, 50).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn editor_layout(state: State<'_, AppState>, id: String, time: f64) -> Result<[f64; 4], String> {
    let editor = state.editor(&id)?;
    tauri::async_runtime::spawn_blocking(move || editor.layout(time)).await.map_err(|e| e.to_string())?
}

/// Tracks a mask's area; progress is streamed on `progress` (0…1).
#[tauri::command]
async fn editor_track_mask(state: State<'_, AppState>, id: String, mask: uuid::Uuid, anchor: Option<f64>, progress: tauri::ipc::Channel<f64>) -> Result<EditorState, String> {
    let editor = state.editor(&id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let last = std::sync::atomic::AtomicU32::new(0);
        editor.track_mask(mask, anchor, &|p| {
            // About 50 updates over the whole run.
            let step = (p * 50.0) as u32;
            if step != last.swap(step, std::sync::atomic::Ordering::Relaxed) {
                let _ = progress.send(p);
            }
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Preview soundtrack chunk: f32 stereo interleaved at 48 kHz.
#[tauri::command]
async fn editor_audio(state: State<'_, AppState>, id: String, time: f64, seconds: f64) -> Result<Response, String> {
    let editor = state.editor(&id)?;
    let bytes = tauri::async_runtime::spawn_blocking(move || editor.audio(time, seconds)).await.map_err(|e| e.to_string())??;
    Ok(Response::new(bytes))
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportRequest {
    /// "mp4", "mov" or "gif".
    format: String,
    resolution: u32,
    fps: u32,
    destination: PathBuf,
}

/// Exports the editor's video; progress (0…1) is streamed on `progress`.
#[tauri::command]
async fn editor_export(state: State<'_, AppState>, id: String, request: ExportRequest, progress: tauri::ipc::Channel<f64>) -> Result<PathBuf, String> {
    let editor = state.editor(&id)?;
    let gpu = state.gpu()?;
    let cancel = Arc::new(AtomicBool::new(false));
    state.exports.lock().insert(id.clone(), cancel.clone());
    let format = match request.format.as_str() {
        "mov" => umi_engine::Format::Mov,
        "gif" => umi_engine::Format::Gif,
        _ => umi_engine::Format::Mp4,
    };
    let settings = umi_engine::ExportSettings { format, resolution: request.resolution, fps: request.fps, hardware: true };
    let destination = request.destination.clone();
    let flag = cancel.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let last = std::sync::atomic::AtomicU32::new(0);
        editor.export(gpu, &settings, &destination, &|p| {
            let step = (p * 200.0) as u32;
            if step != last.swap(step, Ordering::Relaxed) {
                let _ = progress.send(p);
            }
        }, &flag)
    })
    .await
    .map_err(|e| e.to_string())?;
    state.exports.lock().remove(&id);
    if cancel.load(Ordering::Relaxed) {
        return Err("cancelled".into());
    }
    result.map(|_| request.destination)
}

#[tauri::command]
fn editor_export_cancel(state: State<'_, AppState>, id: String) {
    if let Some(flag) = state.exports.lock().get(&id) {
        flag.store(true, Ordering::Relaxed);
    }
}

/// Where exports go by default: ~/Movies/Umi/Exports/<name>.<ext> (not overwriting).
#[tauri::command]
fn export_default_path(name: String, extension: String) -> PathBuf {
    let folder = library_folder().join("Exports");
    let _ = std::fs::create_dir_all(&folder);
    let clean: String = name.chars().map(|c| if "/\\:*?\"<>|".contains(c) { '-' } else { c }).collect();
    let mut path = folder.join(format!("{clean}.{extension}"));
    let mut n = 2;
    while path.exists() {
        path = folder.join(format!("{clean} {n}.{extension}"));
        n += 1;
    }
    path
}

#[derive(Clone, Serialize)]
struct Stage {
    stage: String,
    value: f64,
}

/// Captions from the voice, on device (Whisper). Progress: model download, then transcription.
#[tauri::command]
async fn editor_transcribe(state: State<'_, AppState>, id: String, language: Option<String>, progress: tauri::ipc::Channel<Stage>) -> Result<EditorState, String> {
    let editor = state.editor(&id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let last = Mutex::new((String::new(), -1i32));
        editor.transcribe(language, &|stage, value| {
            let step = (value * 100.0) as i32;
            let mut seen = last.lock();
            if seen.0 != stage || seen.1 != step {
                *seen = (stage.to_string(), step);
                let _ = progress.send(Stage { stage: stage.into(), value });
            }
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct InsightsOut {
    title: String,
    summary: String,
    chapters: Vec<umi_project::insights::Chapter>,
    chapter_text: String,
}

/// Title, summary and chapters from what was said (needs captions).
#[tauri::command]
fn editor_insights(state: State<'_, AppState>, id: String) -> Result<Option<InsightsOut>, String> {
    Ok(state.editor(&id)?.insights().map(|(i, text)| InsightsOut { title: i.title, summary: i.summary, chapters: i.chapters, chapter_text: text }))
}

/// Writes the captions as an .srt or .vtt file.
#[tauri::command]
fn editor_save_subtitles(state: State<'_, AppState>, id: String, destination: PathBuf) -> Result<(), String> {
    let vtt = destination.extension().is_some_and(|e| e.eq_ignore_ascii_case("vtt"));
    std::fs::write(destination, state.editor(&id)?.subtitles(vtt)).map_err(|e| e.to_string())
}

/// Speaks `text` with the AI voice and puts it on the Voice track at output time `time`
/// (or replaces voiceover `replace`). Progress: voice download on first use, then speaking.
#[tauri::command]
async fn editor_voiceover(
    app: tauri::AppHandle,
    id: String,
    text: String,
    speed: Option<f32>,
    time: f64,
    replace: Option<uuid::Uuid>,
    progress: tauri::ipc::Channel<Stage>,
) -> Result<EditorState, String> {
    let text = text.trim().to_string();
    if text.is_empty() {
        return Err("Write what the voice should say.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let editor = state.editor(&id)?;
        let mut slot = state.voice.lock();
        if slot.is_none() {
            let send = |p: f64| {
                let _ = progress.send(Stage { stage: "download".into(), value: p });
            };
            *slot = Some(umi_ai::tts::Voice::load(&send).map_err(|e| e.to_string())?);
        }
        let _ = progress.send(Stage { stage: "speak".into(), value: 0.0 });
        let voice = slot.as_mut().ok_or("voice unavailable")?;
        let samples = voice.speak(&text, speed.unwrap_or(1.0).clamp(0.5, 2.0)).map_err(|e| e.to_string())?;
        drop(slot);
        let name = format!("voice-{}.wav", &uuid::Uuid::new_v4().simple().to_string().to_uppercase()[..6]);
        umi_ai::tts::write_wav(&editor.bundle.join(&name), &samples, umi_ai::tts::VOICE_RATE).map_err(|e| e.to_string())?;
        let duration = samples.len() as f64 / umi_ai::tts::VOICE_RATE as f64;
        Ok(editor.apply(Op::AddVoiceover { file: name, text, start: time, duration, replace }))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Makes a camera effect for the editor's recording: "blur" or "remove" (background), or
/// "face" (the face's path, for keeping it framed). Progress 0…1 per stage.
#[tauri::command]
async fn editor_camera_effect(state: State<'_, AppState>, id: String, effect: String, progress: tauri::ipc::Channel<Stage>) -> Result<(), String> {
    let editor = state.editor(&id)?;
    let bundle = editor.bundle.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let send = |stage: &str, value: f64| {
            let _ = progress.send(Stage { stage: stage.into(), value });
        };
        let model = if effect == "face" { umi_ai::models::Model::FaceDetection } else { umi_ai::models::Model::Segmentation };
        model.ensure(&|p| send("download", p)).map_err(|e| e.to_string())?;
        let last = std::sync::atomic::AtomicU32::new(0);
        let report = |p: f64| {
            let step = (p * 100.0) as u32;
            if step != last.swap(step, Ordering::Relaxed) {
                send("process", p);
            }
        };
        match effect.as_str() {
            "face" => umi_ai::camera::track_face(&bundle, &report).map(|_| ()),
            "remove" => umi_ai::camera::process_background(&bundle, umi_ai::camera::Background::Remove, &report),
            _ => umi_ai::camera::process_background(&bundle, umi_ai::camera::Background::Blur, &report),
        }
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())??;
    // The renderer picks the new files up with the next edit change.
    editor.refresh_sources();
    Ok(())
}

/// Which camera effects are already made for a recording.
#[tauri::command]
fn editor_camera_effects(state: State<'_, AppState>, id: String) -> Result<Vec<String>, String> {
    let bundle = state.editor(&id)?.bundle.clone();
    Ok([("blur", "camera-blur.mov"), ("remove", "camera-matte.mov"), ("face", "camera-face.json")].iter().filter(|(_, f)| bundle.join(f).exists()).map(|(k, _)| k.to_string()).collect())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ModelInfo {
    model: umi_ai::models::Model,
    purpose: &'static str,
    ready: bool,
}

/// On-device AI models and whether they're downloaded.
#[tauri::command]
fn ai_models() -> Vec<ModelInfo> {
    umi_ai::models::Model::ALL.iter().map(|m| ModelInfo { model: *m, purpose: m.purpose(), ready: m.is_ready() }).collect()
}

/// Video files → new recordings in the library.
#[tauri::command]
async fn import_videos(paths: Vec<PathBuf>) -> Result<Vec<PathBuf>, String> {
    tauri::async_runtime::spawn_blocking(move || paths.iter().map(|p| import::import_file(&library_folder(), p, None)).collect())
        .await
        .map_err(|e| e.to_string())?
}

/// A Loom share link → a new recording (downloaded); progress 0…1.
#[tauri::command]
async fn import_loom(link: String, progress: tauri::ipc::Channel<f64>) -> Result<PathBuf, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let last = std::sync::atomic::AtomicU32::new(0);
        import::import_loom(&library_folder(), &link, &|p| {
            let step = (p * 100.0) as u32;
            if step != last.swap(step, Ordering::Relaxed) {
                let _ = progress.send(p);
            }
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn app_quit(app: tauri::AppHandle) {
    app.exit(0);
}

/// Opens the system's privacy settings page for a permission ("screen", "camera",
/// "microphone", "input").
#[tauri::command]
fn open_privacy_settings(kind: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let pane = match kind.as_str() {
            "camera" => "Privacy_Camera",
            "microphone" => "Privacy_Microphone",
            "input" => "Privacy_ListenEvent",
            _ => "Privacy_ScreenCapture",
        };
        std::process::Command::new("open").arg(format!("x-apple.systempreferences:com.apple.preference.security?{pane}")).status().map_err(|e| e.to_string())?;
    }
    #[cfg(windows)]
    {
        let page = match kind.as_str() {
            "camera" => "ms-settings:privacy-webcam",
            "microphone" => "ms-settings:privacy-microphone",
            _ => "ms-settings:privacy",
        };
        std::process::Command::new("cmd").args(["/C", "start", page]).status().map_err(|e| e.to_string())?;
    }
    let _ = kind;
    Ok(())
}

#[tauri::command]
fn editor_close(state: State<'_, AppState>, id: String) -> Result<(), String> {
    if let Some(editor) = state.editors.lock().remove(&id) {
        editor.save()?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::default())
        .setup(|app| {
            // Our own menu: Undo/Redo go to the editor (the default Edit menu would swallow
            // ⌘Z before the page sees it); cut/copy/paste stay native for text fields.
            let handle = app.handle();
            let app_menu = Submenu::with_items(
                handle,
                "Umi",
                true,
                &[
                    &PredefinedMenuItem::about(handle, Some("About Umi"), None)?,
                    &PredefinedMenuItem::separator(handle)?,
                    &PredefinedMenuItem::hide(handle, None)?,
                    &PredefinedMenuItem::hide_others(handle, None)?,
                    &PredefinedMenuItem::separator(handle)?,
                    &PredefinedMenuItem::quit(handle, None)?,
                ],
            )?;
            let edit_menu = Submenu::with_items(
                handle,
                "Edit",
                true,
                &[
                    &MenuItem::with_id(handle, "undo", "Undo", true, Some("CmdOrCtrl+Z"))?,
                    &MenuItem::with_id(handle, "redo", "Redo", true, Some("Shift+CmdOrCtrl+Z"))?,
                    &PredefinedMenuItem::separator(handle)?,
                    &PredefinedMenuItem::cut(handle, None)?,
                    &PredefinedMenuItem::copy(handle, None)?,
                    &PredefinedMenuItem::paste(handle, None)?,
                    &PredefinedMenuItem::select_all(handle, None)?,
                ],
            )?;
            let window_menu = Submenu::with_items(
                handle,
                "Window",
                true,
                &[&PredefinedMenuItem::minimize(handle, None)?, &PredefinedMenuItem::maximize(handle, None)?, &PredefinedMenuItem::close_window(handle, None)?],
            )?;
            app.set_menu(Menu::with_items(handle, &[&app_menu, &edit_menu, &window_menu])?)?;
            app.on_menu_event(|app, event| {
                let id = event.id().as_ref();
                if id == "undo" || id == "redo" {
                    let _ = app.emit("menu", id);
                }
            });

            tray::install(app.handle())?;
            shortcuts::install(app.handle());
            // Recordings the app couldn't finish last time (it quit while recording).
            let recovered = umi_recorder::recover(&library_folder());
            if !recovered.is_empty() {
                let _ = app.emit("recovered", recovered.len());
            }

            // Warm the GPU up off the main thread so the first editor opens fast.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let _ = handle.state::<AppState>().gpu();
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_recordings,
            open_editor,
            editor_apply,
            editor_save,
            editor_frame,
            editor_close,
            recording_thumbnails,
            recording_preview,
            recording_trash,
            recording_reveal,
            editor_layout,
            editor_track_mask,
            editor_audio,
            editor_export,
            editor_export_cancel,
            export_default_path,
            screenshot::screenshot_take,
            screenshot::area_pick,
            screenshot::area_mode,
            screenshot::screenshot_current,
            screenshot::screenshot_copy,
            screenshot::screenshot_save,
            share::cloud_status,
            share::cloud_connect,
            share::cloud_disconnect,
            share::share_state,
            share::share_start,
            share::share_update,
            share::share_delete,
            share::copy_text_to_clipboard,
            app_quit,
            open_privacy_settings,
            windows::window_show,
            windows::window_hide,
            windows::window_resize,
            windows::resize_app_window,
            recording::record_settings,
            recording::record_settings_save,
            recording::record_sources,
            recording::record_meter,
            recording::record_status,
            recording::record_camera_preview,
            recording::record_prepare,
            recording::record_begin,
            recording::record_pause,
            recording::record_stop,
            recording::record_cancel,
            recording::copy_file_to_clipboard,
            import_videos,
            import_loom,
            editor_transcribe,
            editor_camera_effect,
            editor_camera_effects,
            editor_voiceover,
            editor_save_subtitles,
            editor_insights,
            ai_models,
            assets::bundle_import,
            presets::presets_list,
            presets::preset_save,
            presets::preset_apply,
            presets::preset_delete,
            presets::preset_set_default,
            assets::system_wallpapers,
            assets::image_thumbnail,
            assets::recording_still,
            assets::music_tracks,
            assets::music_fetch,
            recording_waveform
        ])
        .run(tauri::generate_context!())
        .expect("error while running Umi");
}
