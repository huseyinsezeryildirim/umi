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

pub(crate) fn client() -> Result<Client, String> {
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

/// What a share link holds: 1080p at 30 fps, ~4 Mb/s. Screen text stays sharp and an hour is
/// ~1.8 GB (a full-quality 1080p60 export is ~5.6 GB): uploads finish sooner and cloud storage
/// costs a third. Exporting a file keeps the full quality.
fn share_settings(format: umi_engine::Format) -> umi_engine::ExportSettings {
    umi_engine::ExportSettings { format, resolution: 1080, fps: 30, hardware: true, bit_rate: 4_000_000 }
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
        let settings = share_settings(umi_engine::Format::Mp4);
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
    #[serde(default, deserialize_with = "double_option")]
    workspace_id: Option<Option<String>>,
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
            workspace_id: s.workspace_id,
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

// ───── Links made while recording (Loom-style) ─────
//
// When connected to Umi Cloud, every recording reserves a raw link as it starts, and the screen
// (and camera) files upload while they're written: nothing is rendered on this computer. At stop
// the edit (project.json) and cursor follow, so the link plays at once in the viewer's browser,
// which applies the edit; later changes in the editor are sent again (just the edit). A link
// nobody shares is deleted by Umi Cloud after a day.

struct Live {
    client: Client,
    link: umi_cloud::RawLink,
    bundle: PathBuf,
    /// Set at stop (the screen's size and length) or when the recording is thrown away.
    finished: std::sync::Arc<parking_lot::Mutex<Option<Result<umi_cloud::RawMeta, String>>>>,
    uploads: Vec<std::thread::JoinHandle<Result<(), String>>>,
}

static LIVE: parking_lot::Mutex<Option<Live>> = parking_lot::Mutex::new(None);

fn take_finished(slot: &parking_lot::Mutex<Option<Result<umi_cloud::RawMeta, String>>>) -> Option<Result<umi_cloud::RawMeta, String>> {
    match &*slot.lock() {
        None => None,
        Some(Ok(m)) => Some(Ok(umi_cloud::RawMeta { duration_ms: m.duration_ms, width: m.width, height: m.height })),
        Some(Err(e)) => Some(Err(e.clone())),
    }
}

/// The recording just began: reserve its link and start uploading its files as they grow.
/// `None` when not connected (or the plan has no links): the recording stays on this computer.
#[tauri::command]
pub async fn live_start(state: State<'_, AppState>, camera: bool) -> Result<Option<String>, String> {
    let Some(bundle) = state.recorder.current.lock().as_ref().map(|r| r.bundle.clone()) else { return Ok(None) };
    let Ok(client) = client() else { return Ok(None) };
    tauri::async_runtime::spawn_blocking(move || {
        let title = format!("Recording {}", chrono::Local::now().format("%b %-d, %Y %H:%M"));
        let Ok(link) = client.reserve_raw(&title, camera) else { return Ok(None) };
        let url = link.video.url.clone();
        let finished = std::sync::Arc::new(parking_lot::Mutex::new(None));
        let mut uploads = vec![];
        let files: &[(&str, &str)] = if camera {
            &[("screen", umi_project::project::SCREEN_FILE), ("camera", umi_project::project::CAMERA_FILE)]
        } else {
            &[("screen", umi_project::project::SCREEN_FILE)]
        };
        for &(kind, name) in files {
            let (client, link, finished, path) = (client.clone(), link.clone(), finished.clone(), bundle.join(name));
            uploads.push(std::thread::spawn(move || {
                // The camera file appears with its first frame (or never, if the camera fails).
                while !path.exists() && finished.lock().is_none() {
                    std::thread::sleep(std::time::Duration::from_millis(250));
                }
                client.upload_raw(&link, kind, &path, &|| take_finished(&finished), &|_| {}).map_err(|e| e.to_string())
            }));
        }
        remember(&bundle, &link.video);
        let previous = LIVE.lock().replace(Live { client, link, bundle, finished, uploads });
        if let Some(old) = previous {
            *old.finished.lock() = Some(Err("replaced".into()));
            let _ = old.client.delete(&old.link.video.id);
        }
        Ok(Some(url))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The recording stopped: the rest of the files, the edit and a poster go up in the background.
/// Returns the link right away (it plays as soon as the last bytes arrive).
#[tauri::command]
pub async fn live_finish(bundle: PathBuf) -> Option<Video> {
    tauri::async_runtime::spawn_blocking(move || finish_live(bundle)).await.ok().flatten()
}

fn finish_live(bundle: PathBuf) -> Option<Video> {
    let live = LIVE.lock().take()?;
    if live.bundle != bundle {
        *live.finished.lock() = Some(Err("another recording".into()));
        return None;
    }
    let screen = bundle.join(umi_project::project::SCREEN_FILE);
    let (meta, poster) = match umi_media::VideoDecoder::open(&screen, false) {
        Ok(mut decoder) => {
            let info = decoder.info();
            let poster = poster(&mut decoder, info.duration);
            (Ok(umi_cloud::RawMeta { duration_ms: (info.duration * 1000.0) as u64, width: info.width, height: info.height }), poster)
        }
        Err(e) => (Err(e.to_string()), None),
    };
    *live.finished.lock() = Some(meta);
    let video = live.link.video.clone();
    std::thread::spawn(move || {
        let read = |name: &str| std::fs::read(bundle.join(name)).ok().and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok());
        let mut ok = true;
        if let Some(project) = read(umi_project::project::PROJECT_FILE) {
            ok &= live.client.put_raw_edit(&live.link.video.id, &project, read(umi_project::project::CURSOR_FILE).as_ref()).is_ok();
        }
        if let Some(jpeg) = poster {
            let _ = live.client.put_raw_poster(&live.link, &jpeg);
        }
        for upload in live.uploads {
            ok &= matches!(upload.join(), Ok(Ok(())));
        }
        match live.client.video(&live.link.video.id) {
            Ok(v) if ok => remember(&bundle, &v),
            // Didn't make it: the recording is still here, and Share uploads it the usual way.
            _ => {
                let _ = live.client.delete(&live.link.video.id);
                let _ = std::fs::remove_file(share_file(&bundle));
            }
        }
    });
    Some(video)
}

/// The recording was thrown away: stop uploading and give the link back.
#[tauri::command]
pub fn live_cancel() {
    if let Some(live) = LIVE.lock().take() {
        *live.finished.lock() = Some(Err("cancelled".into()));
        std::thread::spawn(move || {
            for upload in live.uploads {
                let _ = upload.join();
            }
            let _ = live.client.delete(&live.link.video.id);
        });
    }
}

/// The owner shares the recording's link (copied it, or pressed Share): it's kept from now on.
#[tauri::command]
pub async fn live_share(state: State<'_, AppState>, id: Option<String>, bundle: Option<PathBuf>) -> Result<Option<Video>, String> {
    let bundle = match (id, bundle) {
        (Some(id), _) => state.editor(&id)?.bundle.clone(),
        (None, Some(bundle)) => bundle,
        _ => return Ok(None),
    };
    let Some(video) = saved(&bundle).filter(|v| v.kind.as_deref() == Some("raw")) else { return Ok(None) };
    let client = client()?;
    tauri::async_runtime::spawn_blocking(move || {
        let video = client.share_raw(&video.id).map_err(|e| e.to_string())?;
        remember(&bundle, &video);
        Ok(Some(video))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The edit changed: a raw link shows the new look (just project.json goes up).
pub(crate) fn sync_edit(bundle: &Path) {
    let Some(video) = saved(bundle).filter(|v| v.kind.as_deref() == Some("raw")) else { return };
    let Ok(client) = client() else { return };
    let bundle = bundle.to_path_buf();
    std::thread::spawn(move || {
        let read = |name: &str| std::fs::read(bundle.join(name)).ok().and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok());
        if let Some(project) = read(umi_project::project::PROJECT_FILE) {
            let _ = client.put_raw_edit(&video.id, &project, None);
        }
    });
}
