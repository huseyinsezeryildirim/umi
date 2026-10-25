//! Bringing videos made elsewhere into the library as recordings, so they're edited like
//! any other: files from disk, and Loom videos by their share link (free).

use std::path::{Path, PathBuf};
use umi_project::project::{AudioInfo, ScreenInfo};
use umi_project::{Bundle, CursorData, RecordingProject};

/// Makes `<library>/<name>.umi` from a video file (the file is copied as the screen track).
pub fn import_file(library: &Path, file: &Path, name: Option<&str>) -> Result<PathBuf, String> {
    let mut decoder = umi_media::VideoDecoder::open(file, false).map_err(|e| format!("Can't read {}: {e}", file.display()))?;
    let info = decoder.info().clone();
    let _ = &mut decoder;
    let audio = umi_media::audio_streams(file).map(|a| a.len()).unwrap_or(0);
    let stem = name
        .map(str::to_string)
        .unwrap_or_else(|| file.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "Imported video".into()));
    let clean: String = stem.chars().map(|c| if "/\\:*?\"<>|".contains(c) { '-' } else { c }).collect();
    std::fs::create_dir_all(library).map_err(|e| e.to_string())?;
    let mut folder = library.join(format!("{clean}.umi"));
    let mut n = 2;
    while folder.exists() {
        folder = library.join(format!("{clean} {n}.umi"));
        n += 1;
    }
    std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let bundle = Bundle::new(&folder);
    let result = (|| {
        std::fs::copy(file, bundle.screen()).map_err(|e| e.to_string())?;
        let project = RecordingProject {
            version: 1,
            created_at: chrono::Utc::now(),
            duration: info.duration,
            screen: ScreenInfo {
                pixel_width: info.width,
                pixel_height: info.height,
                capture_rect: umi_project::Rect::new(0.0, 0.0, info.width as f64, info.height as f64),
                fps: info.fps.round().max(1.0) as u32,
            },
            camera: None,
            // The video's own sound is treated as the voice (captions, clean-up).
            audio: AudioInfo { system_track: None, microphone_track: (audio > 0).then_some(0) },
            edit: None,
            camera_only: None,
        };
        bundle.write_project(&project).map_err(|e| e.to_string())?;
        bundle.write_cursor(&CursorData::default()).map_err(|e| e.to_string())
    })();
    if let Err(e) = result {
        let _ = std::fs::remove_dir_all(&folder);
        return Err(e);
    }
    Ok(folder)
}

/// The video id in a Loom share or embed link.
pub fn loom_id(link: &str) -> Option<String> {
    let link = link.trim();
    let rest = link.split("loom.com/").nth(1)?;
    let mut parts = rest.split(['/', '?', '#']);
    let kind = parts.next()?;
    if !matches!(kind, "share" | "embed" | "v") {
        return None;
    }
    let id = parts.next()?;
    (id.len() >= 16 && id.chars().all(|c| c.is_ascii_alphanumeric())).then(|| id.to_string())
}

/// Downloads a Loom video (one the link's owner made viewable) and imports it.
pub fn import_loom(library: &Path, link: &str, progress: &dyn Fn(f64)) -> Result<PathBuf, String> {
    let id = loom_id(link).ok_or("That doesn't look like a Loom link (loom.com/share/…).")?;
    // Loom's player asks this endpoint for the video file's address.
    let mut response = ureq::post(&format!("https://www.loom.com/api/campaigns/sessions/{id}/transcoded-url"))
        .header("Content-Type", "application/json")
        .send("{}")
        .map_err(|e| format!("Loom didn't give the video ({e}). Is it public or shared with “anyone with the link”?"))?;
    let body: serde_json::Value = response.body_mut().read_json().map_err(|e| e.to_string())?;
    let url = body.get("url").and_then(|u| u.as_str()).ok_or("Loom didn't return a video address.")?.to_string();
    // Title from the share page's metadata (best effort).
    let title = ureq::get(&format!("https://www.loom.com/v1/oembed?url=https://www.loom.com/share/{id}"))
        .call()
        .ok()
        .and_then(|mut r| r.body_mut().read_json::<serde_json::Value>().ok())
        .and_then(|v| v.get("title").and_then(|t| t.as_str()).map(str::to_string))
        .unwrap_or_else(|| format!("Loom {}", &id[..8]));

    let temp = std::env::temp_dir().join(format!("umi-loom-{id}.mp4"));
    let mut response = ureq::get(&url).call().map_err(|e| format!("Couldn't download: {e}"))?;
    let total: Option<u64> = response.headers().get("content-length").and_then(|v| v.to_str().ok()).and_then(|v| v.parse().ok());
    let mut reader = response.body_mut().with_config().limit(8 * 1024 * 1024 * 1024).reader();
    let mut file = std::fs::File::create(&temp).map_err(|e| e.to_string())?;
    let mut buffer = vec![0u8; 1 << 16];
    let mut done = 0u64;
    loop {
        use std::io::{Read, Write};
        let n = reader.read(&mut buffer).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        file.write_all(&buffer[..n]).map_err(|e| e.to_string())?;
        done += n as u64;
        if let Some(total) = total {
            progress(done as f64 / total.max(1) as f64 * 0.95);
        }
    }
    drop(file);
    let result = import_file(library, &temp, Some(&title));
    let _ = std::fs::remove_file(&temp);
    progress(1.0);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_loom_links() {
        assert_eq!(
            loom_id("https://www.loom.com/share/0281766fa2d04bb788eaf19e65135184?sid=abc").as_deref(),
            Some("0281766fa2d04bb788eaf19e65135184")
        );
        assert_eq!(loom_id("loom.com/embed/0281766fa2d04bb788eaf19e65135184").as_deref(), Some("0281766fa2d04bb788eaf19e65135184"));
        assert_eq!(loom_id("https://www.loom.com/looms/videos"), None);
        assert_eq!(loom_id("https://example.com/share/0281766fa2d04bb788eaf19e65135184"), None);
    }

    #[test]
    fn imports_a_video_file() {
        let source = Path::new("/tmp/umi-fixtures/Real.umi/screen.mov");
        if !source.exists() {
            return;
        }
        let library = std::env::temp_dir().join("umi-import-test");
        let _ = std::fs::remove_dir_all(&library);
        let bundle = import_file(&library, source, Some("Demo: one/two")).unwrap();
        assert!(bundle.ends_with("Demo- one-two.umi"));
        let project = Bundle::new(&bundle).read_project().unwrap();
        assert!(project.duration > 1.0 && project.screen.pixel_width > 0);
        assert_eq!(project.audio.microphone_track, Some(0));
        // A second import doesn't overwrite.
        assert!(import_file(&library, source, Some("Demo: one/two")).unwrap().ends_with("Demo- one-two 2.umi"));
        let _ = std::fs::remove_dir_all(&library);
    }
}
