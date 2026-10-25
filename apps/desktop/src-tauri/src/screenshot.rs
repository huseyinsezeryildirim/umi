//! Screenshots: one frame of an area (from the same capture as recordings, without the
//! cursor), handed to the screenshot editor; copying and saving the finished image.

use crate::AppState;
use parking_lot::Mutex;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};
use umi_capture::screen::{self, ScreenOptions};
use umi_capture::{Clock, Frame, Target, VideoSink};

/// Keeps the first frame that arrives.
struct Grab(Mutex<Option<(u32, u32, Vec<u8>)>>);

impl VideoSink for Grab {
    fn frame(&self, frame: Frame, _t: f64) {
        let mut slot = self.0.lock();
        if slot.is_some() {
            return;
        }
        let rgba = match frame {
            Frame::Rgba { width, height, data, stride } => (width, height, rows(data, stride, width as usize * 4, height, |p| [p[0], p[1], p[2], p[3]])),
            Frame::Bgra { width, height, data, stride } => (width, height, rows(data, stride, width as usize * 4, height, |p| [p[2], p[1], p[0], p[3]])),
            Frame::Nv12 { width, height, y, y_stride, uv, uv_stride } => (width, height, nv12_to_rgba(width, height, y, y_stride, uv, uv_stride)),
        };
        *slot = Some(rgba);
    }
}

fn rows(data: &[u8], stride: usize, row: usize, height: u32, px: impl Fn(&[u8]) -> [u8; 4]) -> Vec<u8> {
    let mut out = Vec::with_capacity(row * height as usize);
    for r in 0..height as usize {
        for p in data[r * stride..r * stride + row].chunks_exact(4) {
            out.extend(px(p));
        }
    }
    out
}

/// BT.709 video-range NV12 → RGBA.
fn nv12_to_rgba(w: u32, h: u32, y: &[u8], ys: usize, uv: &[u8], uvs: usize) -> Vec<u8> {
    let mut out = Vec::with_capacity(w as usize * h as usize * 4);
    for r in 0..h as usize {
        for c in 0..w as usize {
            let yy = (y[r * ys + c] as f32 - 16.0) * 1.164;
            let i = (r / 2) * uvs + (c / 2) * 2;
            let (u, v) = (uv[i] as f32 - 128.0, uv[i + 1] as f32 - 128.0);
            let px = [yy + 1.793 * v, yy - 0.213 * u - 0.533 * v, yy + 2.112 * u];
            out.extend(px.map(|x| x.clamp(0.0, 255.0) as u8));
            out.push(255);
        }
    }
    out
}

/// Takes a screenshot of `target` and saves it as a PNG in the temp folder.
#[tauri::command]
pub async fn screenshot_take(app: AppHandle, target: Target) -> Result<PathBuf, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let grab = Arc::new(Grab(Mutex::new(None)));
        let options = ScreenOptions { fps: 30, max_size: 0, show_cursor: false, system_audio: false, exclude_own_windows: true };
        let mut session = screen::start(&target, &options, Clock::new(), grab.clone(), None).map_err(|e| e.to_string())?;
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
        while grab.0.lock().is_none() && std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        let _ = session.stop();
        let (w, h, rgba) = grab.0.lock().take().ok_or("No picture came in")?;
        let path = std::env::temp_dir().join(format!("umi-shot-{}.png", chrono::Local::now().format("%H%M%S%3f")));
        image::RgbaImage::from_raw(w, h, rgba).ok_or("bad picture")?.save(&path).map_err(|e| e.to_string())?;
        *app.state::<AppState>().last_shot.lock() = Some(path.clone());
        Ok(path)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The screenshot waiting for the editor window.
#[tauri::command]
pub fn screenshot_current(state: State<'_, AppState>) -> Option<String> {
    use base64::Engine;
    let path = state.last_shot.lock().clone()?;
    let bytes = std::fs::read(path).ok()?;
    Some(format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

/// The finished image (PNG bytes from the editor) on the clipboard.
#[tauri::command]
pub fn screenshot_copy(png: Vec<u8>) -> Result<(), String> {
    let img = image::load_from_memory(&png).map_err(|e| e.to_string())?.to_rgba8();
    let (w, h) = img.dimensions();
    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    clipboard.set_image(arboard::ImageData { width: w as usize, height: h as usize, bytes: img.into_raw().into() }).map_err(|e| e.to_string())
}

/// Saves the finished image in ~/Pictures/Umi (or the chosen path); returns where.
#[tauri::command]
pub fn screenshot_save(png: Vec<u8>, path: Option<PathBuf>) -> Result<PathBuf, String> {
    let path = match path {
        Some(p) => p,
        None => {
            let folder = dirs::picture_dir().unwrap_or_else(|| dirs::home_dir().unwrap_or_default()).join("Umi");
            std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
            folder.join(format!("Umi {}.png", chrono::Local::now().format("%Y-%m-%d at %H.%M.%S")))
        }
    };
    std::fs::write(&path, png).map_err(|e| e.to_string())?;
    Ok(path)
}

/// Opens the area picker for a recording area or a screenshot.
#[tauri::command]
pub fn area_pick(app: AppHandle, mode: String) -> Result<(), String> {
    *app.state::<AppState>().area_mode.lock() = mode;
    crate::windows::show_area_picker(&app).map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn area_mode(state: State<'_, AppState>) -> String {
    let mode = state.area_mode.lock().clone();
    if mode.is_empty() { "record".into() } else { mode }
}
