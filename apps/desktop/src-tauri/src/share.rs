//! Sharing to Umi Cloud from the editor: connect (server + token, the token kept in the
//! system keychain), make the link (copied right away), upload, and change or delete the
//! link later. The link is remembered in the recording (`share.json`).

use crate::AppState;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::State;
use tauri::ipc::Channel;
use umi_cloud::{Client, Media, Settings, Video};

const KEYCHAIN_SERVICE: &str = "cam.umi.cloud";
const DEFAULT_SERVER: &str = "https://umi.cam";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CloudConfig {
    server: Option<String>,
}

fn config_file() -> PathBuf {
    crate::presets::config_folder().join("cloud.json")
}

fn server() -> String {
    std::fs::read(config_file())
        .ok()
        .and_then(|b| serde_json::from_slice::<CloudConfig>(&b).ok())
        .and_then(|c| c.server)
        .unwrap_or_else(|| DEFAULT_SERVER.into())
}

fn token() -> Option<String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, "token").ok()?.get_password().ok()
}

fn client() -> Result<Client, String> {
    let token = token().ok_or("Connect to Umi Cloud first.")?;
    Ok(Client::new(&server(), &token))
}

fn share_file(bundle: &Path) -> PathBuf {
    bundle.join(umi_project::project::SHARE_FILE)
}

fn saved(bundle: &Path) -> Option<Video> {
    std::fs::read(share_file(bundle)).ok().and_then(|b| serde_json::from_slice(&b).ok())
}

fn remember(bundle: &Path, video: &Video) {
    if let Ok(json) = serde_json::to_vec_pretty(video) {
        let _ = std::fs::write(share_file(bundle), json);
    }
}

fn copy_text(text: &str) {
    if let Ok(mut clipboard) = arboard::Clipboard::new() {
        let _ = clipboard.set_text(text.to_string());
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudStatus {
    connected: bool,
    server: String,
}

#[tauri::command]
pub fn cloud_status() -> CloudStatus {
    CloudStatus { connected: token().is_some(), server: server() }
}

/// Checks the token with the server, then keeps it in the keychain.
#[tauri::command]
pub async fn cloud_connect(server: String, token: String) -> Result<CloudStatus, String> {
    let server = server.trim().trim_end_matches('/').to_string();
    let token = token.trim().to_string();
    tauri::async_runtime::spawn_blocking(move || {
        Client::new(&server, &token)
            .check()
            .map_err(|e| if e.unauthorized() { "That token wasn't accepted.".to_string() } else { e.to_string() })?;
        keyring::Entry::new(KEYCHAIN_SERVICE, "token").and_then(|e| e.set_password(&token)).map_err(|e| e.to_string())?;
        let json = serde_json::to_vec(&CloudConfig { server: Some(server.clone()) }).map_err(|e| e.to_string())?;
        std::fs::write(config_file(), json).map_err(|e| e.to_string())?;
        Ok(CloudStatus { connected: true, server })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn cloud_disconnect() -> CloudStatus {
    if let Ok(entry) = keyring::Entry::new(KEYCHAIN_SERVICE, "token") {
        let _ = entry.delete_credential();
    }
    cloud_status()
}

/// The recording's link, if it was shared.
#[tauri::command]
pub fn share_state(state: State<'_, AppState>, id: String) -> Result<Option<Video>, String> {
    Ok(saved(&state.editor(&id)?.bundle))
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareProgress {
    stage: String,
    value: f64,
    video: Option<Video>,
}

/// Exports (1080p MP4), creates the link (copied at once), uploads poster, GIF preview and
/// the video, then completes it.
#[tauri::command]
pub async fn share_start(state: State<'_, AppState>, id: String, progress: Channel<ShareProgress>) -> Result<Video, String> {
    let editor = state.editor(&id)?;
    let gpu = state.gpu()?;
    let bundle = editor.bundle.clone();
    let client = client()?;
    tauri::async_runtime::spawn_blocking(move || {
        let send = |stage: &str, value: f64, video: Option<Video>| {
            let _ = progress.send(ShareProgress { stage: stage.into(), value, video });
        };
        let folder = std::env::temp_dir().join(format!("umi-share-{}", std::process::id()));
        std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
        let mp4 = folder.join("video.mp4");
        let cancel = std::sync::atomic::AtomicBool::new(false);
        let settings = umi_engine::ExportSettings { format: umi_engine::Format::Mp4, resolution: 1080, fps: 60, hardware: true };
        editor.export(gpu, &settings, &mp4, &|p| send("export", p, None), &cancel)?;

        let mut decoder = umi_media::VideoDecoder::open(&mp4, false).map_err(|e| e.to_string())?;
        let info = decoder.info();
        let poster = poster(&mut decoder, info.duration);
        let gif = gif_preview(&mut decoder, info.duration, &folder);
        let media = Media {
            video: &mp4,
            title: umi_project::Bundle::new(&bundle).name(),
            duration_ms: (info.duration * 1000.0) as u64,
            width: info.width,
            height: info.height,
            poster,
            gif,
        };
        let result = client.share(
            &media,
            &|video| {
                copy_text(&video.url);
                remember(&bundle, video);
                send("link", 0.0, Some(video.clone()));
            },
            &|p| send("upload", p, None),
        );
        let _ = std::fs::remove_dir_all(&folder);
        let video =
            result.map_err(|e| if e.needs_plan() { "Sharing links needs an Umi Cloud plan.".to_string() } else { e.to_string() })?;
        remember(&bundle, &video);
        send("done", 1.0, Some(video.clone()));
        Ok(video)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// A JPEG of the video at 1 s (or its middle if shorter).
fn poster(decoder: &mut umi_media::VideoDecoder, duration: f64) -> Option<Vec<u8>> {
    let frame = decoder.frame_at(duration.min(2.0) / 2.0).ok()??;
    let (w, h, rgba) = umi_media::to_rgba(&frame, 1280).ok()?;
    let img = image::RgbaImage::from_raw(w, h, rgba)?;
    let mut jpeg = Vec::new();
    image::DynamicImage::ImageRgba8(img).to_rgb8().write_to(&mut std::io::Cursor::new(&mut jpeg), image::ImageFormat::Jpeg).ok()?;
    Some(jpeg)
}

/// A short looping GIF (3 s at 10 fps, 480 px) for previews in email and chat.
fn gif_preview(decoder: &mut umi_media::VideoDecoder, duration: f64, folder: &Path) -> Option<Vec<u8>> {
    let path = folder.join("preview.gif");
    let start = (duration * 0.15).min(duration - 3.0).max(0.0);
    let first = decoder.frame_at(start).ok()??;
    let (w, h, _) = umi_media::to_rgba(&first, 480).ok()?;
    let mut writer = umi_media::GifWriter::create(&path, w, h, 10.0).ok()?;
    for k in 0..30 {
        let t = start + k as f64 / 10.0;
        if t > duration {
            break;
        }
        let frame = decoder.frame_at(t).ok()??;
        let (_, _, rgba) = umi_media::to_rgba(&frame, 480).ok()?;
        writer.push_rgba(&rgba).ok()?;
    }
    // The GIF is closed (trailer written) when the writer goes away.
    drop(writer);
    std::fs::read(&path).ok()
}

#[tauri::command]
pub async fn share_update(state: State<'_, AppState>, id: String, settings: SettingsInput) -> Result<Video, String> {
    let bundle = state.editor(&id)?.bundle.clone();
    let client = client()?;
    tauri::async_runtime::spawn_blocking(move || {
        let video = saved(&bundle).ok_or("Not shared yet")?;
        let updated = client.update(&video.id, &settings.into()).map_err(|e| e.to_string())?;
        remember(&bundle, &updated);
        Ok(updated)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// What the share sheet changes (`expiresAt: null` removes the expiry).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsInput {
    allow_download: Option<bool>,
    allow_comments: Option<bool>,
    password: Option<String>,
    #[serde(default, deserialize_with = "double_option")]
    expires_at: Option<Option<String>>,
}

fn double_option<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<Option<String>>, D::Error> {
    Ok(Some(Option::<String>::deserialize(d)?))
}

impl From<SettingsInput> for Settings {
    fn from(s: SettingsInput) -> Self {
        Settings {
            title: None,
            allow_download: s.allow_download,
            allow_comments: s.allow_comments,
            password: s.password,
            expires_at: s.expires_at,
        }
    }
}

#[tauri::command]
pub async fn share_delete(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let bundle = state.editor(&id)?.bundle.clone();
    let client = client()?;
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(video) = saved(&bundle) {
            client.delete(&video.id).map_err(|e| e.to_string())?;
        }
        let _ = std::fs::remove_file(share_file(&bundle));
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Views, watch time and drop-off for the recording's link.
#[tauri::command]
pub async fn share_insights(state: State<'_, AppState>, id: String) -> Result<Option<umi_cloud::Insights>, String> {
    let bundle = state.editor(&id)?.bundle.clone();
    let client = client()?;
    tauri::async_runtime::spawn_blocking(move || match saved(&bundle) {
        Some(video) => client.insights(&video.id).map(Some).map_err(|e| e.to_string()),
        None => Ok(None),
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn copy_text_to_clipboard(text: String) {
    copy_text(&text);
}

// ───── Instant mode: the link before the video ─────

/// The link reserved when an Instant recording starts (one recording at a time).
static RESERVED: parking_lot::Mutex<Option<(Client, umi_cloud::Reservation)>> = parking_lot::Mutex::new(None);

/// Reserves a link for the recording that's starting, when connected to Umi Cloud
/// (`None` otherwise: Instant then copies the file instead).
#[tauri::command]
pub async fn instant_reserve() -> Result<Option<String>, String> {
    let Ok(client) = client() else { return Ok(None) };
    tauri::async_runtime::spawn_blocking(move || {
        let title = format!("Recording {}", chrono::Local::now().format("%b %-d, %Y %H:%M"));
        match client.reserve(&title) {
            Ok(r) => {
                let url = r.video.url.clone();
                if let Some((old_client, old)) = RESERVED.lock().replace((client, r)) {
                    let _ = old_client.delete(&old.video.id);
                }
                Ok(Some(url))
            }
            // No plan or offline: Instant still works locally.
            Err(_) => Ok(None),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The recording was discarded: give the reserved link back.
#[tauri::command]
pub async fn instant_release() {
    let taken = RESERVED.lock().take();
    if let Some((client, r)) = taken {
        let _ = tauri::async_runtime::spawn_blocking(move || client.delete(&r.video.id)).await;
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstantProgress {
    exported: f64,
    uploaded_bytes: u64,
}

/// Exports the polished video to `destination` and uploads it to the reserved link at the
/// same time (parts go up while the export is still writing). The link was copied at stop.
#[tauri::command]
pub async fn instant_share(
    state: State<'_, AppState>,
    id: String,
    destination: PathBuf,
    progress: Channel<InstantProgress>,
) -> Result<Video, String> {
    let taken = RESERVED.lock().take();
    let (client, reservation) = taken.ok_or("No link was reserved for this recording.")?;
    let editor = state.editor(&id)?;
    let gpu = state.gpu()?;
    let bundle = editor.bundle.clone();
    tauri::async_runtime::spawn_blocking(move || {
        remember(&bundle, &reservation.video);
        let exported = parking_lot::Mutex::new(0.0f64);
        let uploaded = std::sync::atomic::AtomicU64::new(0);
        let send = || {
            let _ = progress.send(InstantProgress { exported: *exported.lock(), uploaded_bytes: uploaded.load(std::sync::atomic::Ordering::Relaxed) });
        };
        let finished = parking_lot::Mutex::new(None::<Result<umi_cloud::Finished, String>>);
        let folder = std::env::temp_dir().join(format!("umi-instant-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&folder);
        let _ = std::fs::remove_file(&destination);
        let result = std::thread::scope(|scope| {
            scope.spawn(|| {
                let cancel = std::sync::atomic::AtomicBool::new(false);
                let settings = umi_engine::ExportSettings { format: umi_engine::Format::StreamingMp4, resolution: 1080, fps: 60, hardware: true };
                let outcome = editor
                    .export(
                        gpu,
                        &settings,
                        &destination,
                        &|p| {
                            *exported.lock() = p;
                            send();
                        },
                        &cancel,
                    )
                    .and_then(|_| {
                        let mut decoder = umi_media::VideoDecoder::open(&destination, false).map_err(|e| e.to_string())?;
                        let info = decoder.info();
                        Ok(umi_cloud::Finished {
                            duration_ms: (info.duration * 1000.0) as u64,
                            width: info.width,
                            height: info.height,
                            poster: poster(&mut decoder, info.duration),
                            gif: gif_preview(&mut decoder, info.duration, &folder),
                        })
                    });
                *finished.lock() = Some(outcome);
            });
            // Waits for the export to create the file, then follows it.
            while !destination.exists() && finished.lock().is_none() {
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
            client
                .upload_growing(&reservation, &destination, &|| finished.lock().take(), &|bytes| {
                    uploaded.store(bytes, std::sync::atomic::Ordering::Relaxed);
                    send();
                })
                .map_err(|e| e.to_string())
        });
        let _ = std::fs::remove_dir_all(&folder);
        match result {
            Ok(video) => {
                remember(&bundle, &video);
                Ok(video)
            }
            Err(e) => {
                let _ = client.delete(&reservation.video.id);
                let _ = std::fs::remove_file(share_file(&bundle));
                Err(e)
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?
}
