//! Files the editor brings into a recording: images, videos and music copied into the
//! bundle, the system's wallpapers, and the built-in music library (CC0 tracks from the
//! FreePD archive, downloaded on first use and cached).

use base64::Engine;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Copies `file` into the recording bundle as `<base>-<id>.<ext>`; returns the name used in
/// the edit (relative to the bundle).
#[tauri::command]
pub fn bundle_import(bundle: PathBuf, file: PathBuf, base: String) -> Result<String, String> {
    let ext = file.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    let id = uuid::Uuid::new_v4().simple().to_string().to_uppercase();
    let name = format!("{base}-{}.{ext}", &id[..6]);
    std::fs::copy(&file, bundle.join(&name)).map_err(|e| format!("Couldn't add {}: {e}", file.display()))?;
    Ok(name)
}

#[derive(Serialize)]
pub struct Wallpaper {
    name: String,
    /// What goes in the edit (the renderer reads it directly).
    path: PathBuf,
    /// Small JPEG data URL.
    thumb: String,
}

fn wallpaper_files() -> Vec<PathBuf> {
    let roots: &[&str] = if cfg!(target_os = "macos") {
        &["/System/Library/Desktop Pictures"]
    } else if cfg!(windows) {
        &["C:\\Windows\\Web\\Wallpaper", "C:\\Windows\\Web\\4K\\Wallpaper\\Windows"]
    } else {
        &["/usr/share/backgrounds", "/usr/share/wallpapers"]
    };
    let mut out = vec![];
    let mut stack: Vec<PathBuf> = roots.iter().map(PathBuf::from).collect();
    while let Some(dir) = stack.pop() {
        for entry in std::fs::read_dir(&dir).into_iter().flatten().flatten() {
            let path = entry.path();
            let hidden = path.file_name().is_some_and(|n| n.to_string_lossy().starts_with('.'));
            if path.is_dir() && !hidden && out.len() < 200 {
                stack.push(path);
            } else if path.extension().is_some_and(|e| matches!(e.to_string_lossy().to_lowercase().as_str(), "heic" | "jpg" | "jpeg" | "png")) {
                out.push(path);
            }
        }
    }
    out.sort();
    out
}

fn thumbnail(path: &Path) -> Option<String> {
    // macOS keeps small versions of its wallpapers; they decode much faster.
    let small = path.parent().zip(path.file_name()).map(|(dir, name)| dir.join(".thumbnails").join(name)).filter(|p| p.exists());
    let image = umi_render::raster::decode_image(small.as_deref().unwrap_or(path), 240)?;
    let rgba = image::RgbaImage::from_raw(image.width, image.height, image.pixels)?;
    let mut jpeg = Vec::new();
    image::DynamicImage::ImageRgba8(rgba).to_rgb8().write_to(&mut std::io::Cursor::new(&mut jpeg), image::ImageFormat::Jpeg).ok()?;
    Some(format!("data:image/jpeg;base64,{}", base64::engine::general_purpose::STANDARD.encode(jpeg)))
}

/// The computer's own wallpapers, with thumbnails.
#[tauri::command]
pub async fn system_wallpapers() -> Result<Vec<Wallpaper>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        wallpaper_files()
            .into_iter()
            .filter_map(|path| {
                let thumb = thumbnail(&path)?;
                let name = path.file_stem()?.to_string_lossy().into_owned();
                Some(Wallpaper { name, path, thumb })
            })
            .collect()
    })
    .await
    .map_err(|e| e.to_string())
}

/// A small preview of any image file (for pickers).
#[tauri::command]
pub async fn image_thumbnail(path: PathBuf) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || thumbnail(&path).ok_or_else(|| "can't read image".to_string())).await.map_err(|e| e.to_string())?
}

// ───── Music library ─────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    title: String,
    category: String,
    seconds: u32,
    bytes: u64,
    url: String,
    #[serde(default)]
    downloaded: bool,
}

/// ~/Library/Application Support/Umi/Music (shared with the Swift app), or the platform's
/// equivalent.
fn music_folder() -> PathBuf {
    dirs::data_dir().unwrap_or_else(std::env::temp_dir).join("Umi").join("Music")
}

fn local_file(url: &str) -> PathBuf {
    let name = url.rsplit('/').next().unwrap_or("track.mp3");
    music_folder().join(percent_decode(name))
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[tauri::command]
pub fn music_tracks() -> Vec<Track> {
    let mut tracks: Vec<Track> = serde_json::from_str(include_str!("../resources/music.json")).unwrap_or_default();
    for t in &mut tracks {
        t.downloaded = local_file(&t.url).exists();
    }
    tracks
}

/// The track's cached file, downloading it first if needed.
#[tauri::command]
pub async fn music_fetch(url: String) -> Result<PathBuf, String> {
    if !url.starts_with("https://archive.org/download/freepd/") {
        return Err("not a library track".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let local = local_file(&url);
        if local.exists() {
            return Ok(local);
        }
        std::fs::create_dir_all(music_folder()).map_err(|e| e.to_string())?;
        let mut response = ureq::get(&url).call().map_err(|e| format!("Couldn't download: {e}"))?;
        let bytes = response.body_mut().with_config().limit(64 * 1024 * 1024).read_to_vec().map_err(|e| e.to_string())?;
        let partial = local.with_extension("part");
        std::fs::write(&partial, bytes).map_err(|e| e.to_string())?;
        std::fs::rename(&partial, &local).map_err(|e| e.to_string())?;
        Ok(local)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_track_names() {
        assert!(local_file("https://archive.org/download/freepd/upbeat/And%20Just%20Like%20That.mp3").ends_with("And Just Like That.mp3"));
        assert_eq!(music_tracks().len(), 50);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn lists_and_decodes_mac_wallpapers() {
        let files = wallpaper_files();
        assert!(files.len() > 5, "{files:?}");
        let heic = files.iter().find(|p| p.extension().is_some_and(|e| e == "heic")).unwrap();
        assert!(thumbnail(heic).unwrap().starts_with("data:image/jpeg"));
        // The full-size wallpaper decodes for rendering.
        let full = umi_render::raster::decode_image(heic, 3200).unwrap();
        assert!(full.width >= 1000, "{}", full.width);
    }

    #[test]
    #[ignore = "downloads a track"]
    fn downloads_a_track() {
        let t = &music_tracks()[0];
        let path = tauri::async_runtime::block_on(music_fetch(t.url.clone())).unwrap();
        assert!(std::fs::metadata(path).unwrap().len() as u64 > 100_000);
    }
}
