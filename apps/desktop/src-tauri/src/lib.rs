//! Umi desktop app: Tauri shell around the Rust core. Windows are Solid UIs; heavy work
//! (decoding, rendering, encoding) stays in Rust.

mod editor;

use editor::{EditorSession, EditorState, Op};
use parking_lot::Mutex;
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, OnceLock};
use tauri::ipc::Response;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{Emitter, Manager, State};
use umi_render::Gpu;

#[derive(Default)]
struct AppState {
    editors: Mutex<HashMap<String, Arc<EditorSession>>>,
    gpu: OnceLock<Arc<Gpu>>,
    /// Library hover previews by recording path (JPEG data URLs).
    previews: Mutex<HashMap<PathBuf, Arc<Vec<String>>>>,
}

impl AppState {
    fn gpu(&self) -> Result<Arc<Gpu>, String> {
        if let Some(gpu) = self.gpu.get() {
            return Ok(gpu.clone());
        }
        let gpu = Gpu::new().map_err(|e| e.to_string())?;
        Ok(self.gpu.get_or_init(|| gpu).clone())
    }

    fn editor(&self, id: &str) -> Result<Arc<EditorSession>, String> {
        self.editors.lock().get(id).cloned().ok_or_else(|| format!("no editor {id}"))
    }
}

/// Where recordings live (same folder as the Swift app: ~/Movies/Umi).
fn library_folder() -> PathBuf {
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
            recording_waveform
        ])
        .run(tauri::generate_context!())
        .expect("error while running Umi");
}
