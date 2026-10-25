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
    // Title from the share page's metadata (best effort).
    let title = ureq::get(&format!("https://www.loom.com/v1/oembed?url=https://www.loom.com/share/{id}"))
        .call()
        .ok()
        .and_then(|mut r| r.body_mut().read_json::<serde_json::Value>().ok())
        .and_then(|v| v.get("title").and_then(|t| t.as_str()).map(str::to_string))
        .unwrap_or_else(|| format!("Loom {}", &id[..8]));
    let folder = std::env::temp_dir().join(format!("umi-loom-{id}"));
    let _ = std::fs::remove_dir_all(&folder);
    std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let result = (|| {
        let video = match loom_api(&id, "transcoded-url")? {
            // Older videos: one MP4.
            Some(body) if body.get("part_credentials").is_none() => {
                let url = body.get("url").and_then(|u| u.as_str()).ok_or("Loom didn't return a video address.")?;
                let file = folder.join("video.mp4");
                download(url, &file, &|p| progress(p * 0.95))?;
                file
            }
            // Newer videos: an HLS stream (separate video and audio, signed segments).
            _ => {
                let body = loom_api(&id, "raw-url")?.ok_or("Loom didn't give the video. Is it shared with “anyone with the link”?")?;
                hls_download(&body, &folder, progress)?
            }
        };
        import_file(library, &video, Some(&title))
    })();
    let _ = std::fs::remove_dir_all(&folder);
    progress(1.0);
    result
}

/// Asks Loom's player endpoint (`transcoded-url` or `raw-url`) for the video's address.
fn loom_api(id: &str, endpoint: &str) -> Result<Option<serde_json::Value>, String> {
    let agent: ureq::Agent = ureq::Agent::config_builder().http_status_as_error(false).build().into();
    let mut response = agent
        .post(&format!("https://www.loom.com/api/campaigns/sessions/{id}/{endpoint}"))
        .header("Content-Type", "application/json")
        .send(r#"{"anonID":null,"deviceID":null,"force_original":false,"password":null}"#)
        .map_err(|e| format!("Couldn't reach Loom: {e}"))?;
    match response.status().as_u16() {
        200 => response.body_mut().read_json().map(Some).map_err(|e| format!("Unexpected answer from Loom: {e}")),
        204 | 404 => Ok(None),
        401 | 403 => Err("This Loom video is private or password-protected.".into()),
        s => Err(format!("Loom answered {s}.")),
    }
}

fn download(url: &str, file: &Path, progress: &dyn Fn(f64)) -> Result<(), String> {
    use std::io::{Read, Write};
    let mut response = ureq::get(url).call().map_err(|e| format!("Couldn't download: {e}"))?;
    let total: Option<u64> = response.headers().get("content-length").and_then(|v| v.to_str().ok()).and_then(|v| v.parse().ok());
    let mut reader = response.body_mut().with_config().limit(8 * 1024 * 1024 * 1024).reader();
    let mut out = std::fs::OpenOptions::new().create(true).append(true).open(file).map_err(|e| e.to_string())?;
    let mut buffer = vec![0u8; 1 << 16];
    let mut done = 0u64;
    loop {
        let n = reader.read(&mut buffer).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        out.write_all(&buffer[..n]).map_err(|e| e.to_string())?;
        done += n as u64;
        if let Some(total) = total {
            progress(done as f64 / total.max(1) as f64);
        }
    }
    Ok(())
}

/// Lines of an HLS playlist that name files (not tags), plus `URI="…"` in tags.
fn hls_entries(playlist: &str) -> Vec<String> {
    playlist.lines().map(str::trim).filter(|l| !l.is_empty() && !l.starts_with('#')).map(str::to_string).collect()
}

/// The best video rendition up to 1080p, and the audio rendition, from a master playlist.
fn hls_pick(master: &str) -> (Option<String>, Option<String>) {
    let mut best: Option<(u32, String)> = None;
    let mut fallback: Option<(u32, String)> = None;
    let lines: Vec<&str> = master.lines().map(str::trim).collect();
    for (i, line) in lines.iter().enumerate() {
        if let Some(info) = line.strip_prefix("#EXT-X-STREAM-INF:") {
            let height = info
                .split(',')
                .find_map(|kv| kv.strip_prefix("RESOLUTION="))
                .and_then(|r| r.split('x').nth(1))
                .and_then(|h| h.parse::<u32>().ok())
                .unwrap_or(0);
            let Some(uri) = lines[i + 1..].iter().find(|l| !l.is_empty() && !l.starts_with('#')) else { continue };
            if height <= 1080 && best.as_ref().is_none_or(|b| height > b.0) {
                best = Some((height, uri.to_string()));
            }
            if fallback.as_ref().is_none_or(|b| height < b.0) {
                fallback = Some((height, uri.to_string()));
            }
        }
    }
    let audio = lines
        .iter()
        .filter(|l| l.starts_with("#EXT-X-MEDIA:") && l.contains("TYPE=AUDIO"))
        .find_map(|l| l.split("URI=\"").nth(1).and_then(|r| r.split('"').next()).map(str::to_string));
    (best.or(fallback).map(|b| b.1), audio)
}

/// Downloads a signed Loom HLS stream and joins it into `folder/video.mp4`.
fn hls_download(body: &serde_json::Value, folder: &Path, progress: &dyn Fn(f64)) -> Result<PathBuf, String> {
    let url = body.get("url").and_then(|u| u.as_str()).ok_or("Loom didn't return a video address.")?;
    // Every file needs the same signature, sent as query parameters.
    let query: String = body
        .get("part_credentials")
        .and_then(|c| c.as_object())
        .map(|c| c.iter().filter_map(|(k, v)| v.as_str().map(|v| format!("{k}={v}"))).collect::<Vec<_>>().join("&"))
        .unwrap_or_default();
    let base = url.split('?').next().unwrap_or(url).rsplit_once('/').map(|(b, _)| b.to_string()).ok_or("bad stream address")?;
    let address = |name: &str| {
        let full = if name.starts_with("http") { name.to_string() } else { format!("{base}/{name}") };
        if query.is_empty() || full.contains("Signature=") { full } else { format!("{full}{}{query}", if full.contains('?') { "&" } else { "?" }) }
    };
    let fetch = |u: &str| -> Result<String, String> {
        ureq::get(u).call().map_err(|e| format!("Couldn't download: {e}"))?.body_mut().read_to_string().map_err(|e| e.to_string())
    };
    let master = fetch(url)?;
    let (video, audio) = if master.contains("#EXT-X-STREAM-INF") { hls_pick(&master) } else { (Some(url.to_string()), None) };
    let video = video.ok_or("The Loom stream has no video.")?;
    let mut tracks = vec![(address(&video), folder.join("video.ts"))];
    if let Some(a) = audio {
        tracks.push((address(&a), folder.join("audio.ts")));
    }
    let lists = tracks.iter().map(|(u, f)| fetch(u).map(|p| (hls_entries(&p), f.clone(), u.clone()))).collect::<Result<Vec<_>, _>>()?;
    let total: usize = lists.iter().map(|l| l.0.len()).sum::<usize>().max(1);
    let mut done = 0;
    for (segments, file, list_url) in &lists {
        let list_base = list_url.split('?').next().unwrap_or(list_url).rsplit_once('/').map(|(b, _)| b.to_string()).unwrap_or_default();
        for segment in segments {
            let full = if segment.starts_with("http") { segment.clone() } else { format!("{list_base}/{segment}") };
            let full = if query.is_empty() || full.contains("Signature=") { full } else { format!("{full}{}{query}", if full.contains('?') { "&" } else { "?" }) };
            download(&full, file, &|_| {})?;
            done += 1;
            progress(done as f64 / total as f64 * 0.9);
        }
    }
    let out = folder.join("video.mp4");
    let inputs: Vec<&Path> = lists.iter().map(|l| l.1.as_path()).collect();
    umi_media::remux(&inputs, &out).map_err(|e| format!("Couldn't join the Loom video: {e}"))?;
    Ok(out)
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
    fn picks_hls_renditions() {
        let master = "#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=\"audio\",NAME=\"audio\",URI=\"mediaplaylist-audio.m3u8\"\n#EXT-X-STREAM-INF:BANDWIDTH=1500000,RESOLUTION=1280x720,AUDIO=\"audio\"\nv720.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=3200000,RESOLUTION=1920x1080\nv1080.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=5500000,RESOLUTION=3840x2160\nv2160.m3u8\n";
        assert_eq!(hls_pick(master), (Some("v1080.m3u8".into()), Some("mediaplaylist-audio.m3u8".into())));
        assert_eq!(hls_entries("#EXTM3U\n#EXTINF:4,\na.ts\n#EXTINF:2,\nb.ts\n#EXT-X-ENDLIST"), vec!["a.ts", "b.ts"]);
    }

    /// Needs network: UMI_LOOM_TEST=<a public Loom link>.
    #[test]
    fn imports_a_loom_link() {
        let Ok(link) = std::env::var("UMI_LOOM_TEST") else { return };
        let library = std::env::temp_dir().join("umi-loom-test");
        let _ = std::fs::remove_dir_all(&library);
        let bundle = import_loom(&library, &link, &|_| {}).unwrap();
        let project = Bundle::new(&bundle).read_project().unwrap();
        assert!(project.duration > 1.0 && project.screen.pixel_height >= 720, "{project:?}");
        assert_eq!(project.audio.microphone_track, Some(0));
        let _ = std::fs::remove_dir_all(&library);
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
