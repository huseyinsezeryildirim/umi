//! Against a local `wrangler dev` (web/README.md): set UMI_CLOUD_TEST=http://localhost:8811
//! to run. Uploads a real MP4, checks the viewer serves it, changes settings, deletes it.

use umi_cloud::{Client, Media, Settings};

#[test]
fn shares_a_video_end_to_end() {
    let Ok(base) = std::env::var("UMI_CLOUD_TEST") else { return };
    let video = std::path::Path::new("/tmp/umi-golden/export-v2.mp4");
    if !video.exists() {
        return;
    }
    let client = Client::new(&base, "umi_dev_token");
    client.check().unwrap();
    // A free account can't share.
    let free = Client::new(&base, "umi_free_token");
    let media = Media { video, title: "Rust upload test".into(), duration_ms: 10_000, width: 1920, height: 1080, poster: None, gif: None };
    assert!(free.share(&media, &|_| {}, &|_| {}).unwrap_err().needs_plan());
    assert!(Client::new(&base, "nope").check().unwrap_err().unauthorized());

    let link = std::sync::Mutex::new(String::new());
    let last = std::sync::Mutex::new(0.0);
    let done = client.share(&media, &|v| *link.lock().unwrap() = v.url.clone(), &|p| *last.lock().unwrap() = p).unwrap();
    assert_eq!(done.status, "ready");
    assert_eq!(*link.lock().unwrap(), done.url);
    assert_eq!(*last.lock().unwrap(), 1.0);

    // The viewer page and the video file are served.
    let page = ureq::get(&done.url).call().unwrap().body_mut().read_to_string().unwrap();
    assert!(page.contains("Rust upload test"));
    let size = std::fs::metadata(video).unwrap().len();
    let head = ureq::head(&format!("{}/video.mp4", done.url)).call().unwrap();
    assert_eq!(head.headers().get("content-length").unwrap().to_str().unwrap(), size.to_string());

    // A viewer watches the first half; the owner sees it.
    let beacon = serde_json::json!({ "session": "rusttestsession00001", "buckets": "11111111110000000000", "watchedMs": 5000 });
    ureq::post(&format!("{}/view", done.url)).send_json(beacon).unwrap();
    let insights = client.insights(&done.id).unwrap();
    assert_eq!(insights.views, 1);
    assert_eq!(insights.watched_seconds, 5);
    assert_eq!(insights.retention.len(), 20);
    assert_eq!((insights.retention[9], insights.retention[10]), (1.0, 0.0));

    let updated =
        client.update(&done.id, &Settings { password: Some("secret".into()), allow_comments: Some(false), ..Default::default() }).unwrap();
    assert!(updated.has_password && updated.allow_comments == Some(false));
    client.delete(&done.id).unwrap();
    assert!(client.video(&done.id).is_err() || client.video(&done.id).unwrap().status == "deleted");
}

/// Instant mode: the link exists before the video; the file is uploaded while it's
/// written, and its first bytes change at the very end (like an MP4 writer patching mdat).
#[test]
fn uploads_a_file_while_it_grows() {
    let Ok(base) = std::env::var("UMI_CLOUD_TEST") else { return };
    let client = Client::new(&base, "umi_dev_token");
    let reservation = client.reserve("Growing upload test").unwrap();
    assert_eq!(reservation.video.status, "uploading");

    // 25 MiB of pseudo-random bytes: three parts at the server's 10 MiB part size.
    let mut data = vec![0u8; 25 * 1024 * 1024 + 123];
    let mut x = 0x2545F491u32;
    for b in data.iter_mut() {
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        *b = x as u8;
    }
    let path = std::env::temp_dir().join("umi-growing-upload.bin");
    std::fs::write(&path, b"").unwrap();
    let done = std::sync::atomic::AtomicBool::new(false);
    let sent = std::sync::atomic::AtomicU64::new(0);
    let video = std::thread::scope(|scope| {
        scope.spawn(|| {
            use std::io::{Seek, SeekFrom, Write};
            let mut f = std::fs::OpenOptions::new().write(true).open(&path).unwrap();
            // The header is a placeholder until the end.
            f.write_all(&[0u8; 64]).unwrap();
            for chunk in data[64..].chunks(1024 * 1024) {
                f.write_all(chunk).unwrap();
                f.flush().unwrap();
                std::thread::sleep(std::time::Duration::from_millis(40));
            }
            f.seek(SeekFrom::Start(0)).unwrap();
            f.write_all(&data[..64]).unwrap();
            f.flush().unwrap();
            done.store(true, std::sync::atomic::Ordering::SeqCst);
        });
        client
            .upload_growing(
                &reservation,
                &path,
                &|| {
                    done.load(std::sync::atomic::Ordering::SeqCst).then(|| {
                        Ok(umi_cloud::Finished { duration_ms: 42_000, width: 1920, height: 1080, poster: None, gif: None })
                    })
                },
                &|n| {
                    // Parts go up before the file is finished.
                    if !done.load(std::sync::atomic::Ordering::SeqCst) {
                        sent.store(n, std::sync::atomic::Ordering::SeqCst);
                    }
                },
            )
            .unwrap()
    });
    assert!(sent.load(std::sync::atomic::Ordering::SeqCst) >= 10 * 1024 * 1024, "nothing uploaded while writing");
    assert_eq!(video.status, "ready");
    assert_eq!((video.duration_ms, video.width, video.height), (Some(42_000), Some(1920), Some(1080)));
    assert_eq!(video.size_bytes, Some(data.len() as u64));
    let mut served = ureq::get(&format!("{}/video.mp4", video.url)).call().unwrap();
    let bytes = served.body_mut().with_config().limit(64 * 1024 * 1024).read_to_vec().unwrap();
    assert!(bytes == data, "served file differs");
    client.delete(&video.id).unwrap();
    let _ = std::fs::remove_file(&path);
}

#[test]
fn stops_when_the_file_fails() {
    let Ok(base) = std::env::var("UMI_CLOUD_TEST") else { return };
    let client = Client::new(&base, "umi_dev_token");
    let reservation = client.reserve("Failing upload test").unwrap();
    let path = std::env::temp_dir().join("umi-failing-upload.bin");
    std::fs::write(&path, vec![1u8; 1000]).unwrap();
    let err = client.upload_growing(&reservation, &path, &|| Some(Err("export failed".into())), &|_| {}).unwrap_err();
    assert_eq!(err.to_string(), "export failed");
    client.delete(&reservation.video.id).unwrap();
}

#[test]
fn team_workspace_round_trip() {
    let Ok(base) = std::env::var("UMI_CLOUD_TEST") else { return };
    let owner = Client::new(&base, "umi_dev_token");
    let member = Client::new(&base, "umi_team_token");
    let ws = owner.create_workspace("Rust team").unwrap();
    let code = ws.invite_code.clone().unwrap();
    let joined = member.join_workspace(&code).unwrap();
    assert_eq!((joined.id.as_str(), joined.role.as_str(), joined.invite_code.as_deref()), (ws.id.as_str(), "member", None));
    let (_, members) = member.workspace(&ws.id).unwrap();
    assert_eq!(members.len(), 2);
    let me = members.iter().find(|m| m.you).unwrap().id.clone();

    // A video shared into the team shows up for the member.
    let reservation = owner.reserve("Team video").unwrap();
    let path = std::env::temp_dir().join("umi-team-video.bin");
    std::fs::write(&path, vec![7u8; 2000]).unwrap();
    let video = owner
        .upload_growing(&reservation, &path, &|| Some(Ok(umi_cloud::Finished { duration_ms: 1000, width: 640, height: 360, poster: None, gif: None })), &|_| {})
        .unwrap();
    let moved = owner.update(&video.id, &Settings { workspace_id: Some(Some(ws.id.clone())), ..Default::default() }).unwrap();
    assert_eq!(moved.workspace_id.as_deref(), Some(ws.id.as_str()));
    let videos = member.team_videos(&ws.id).unwrap();
    assert!(videos.iter().any(|v| v.video.id == video.id && !v.yours));

    let style = serde_json::json!({ "name": "Look", "padding": 0.12 });
    member.share_preset(&ws.id, "ABC", "Look", &style).unwrap();
    let presets = owner.team_presets(&ws.id).unwrap();
    assert_eq!(presets[0].edit["padding"], 0.12);

    member.remove_member(&ws.id, &me).unwrap();
    assert!(member.team_videos(&ws.id).is_err());
    owner.delete_workspace(&ws.id).unwrap();
    owner.delete(&video.id).unwrap();
}
