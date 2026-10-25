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

    let updated = client.update(&done.id, &Settings { password: Some("secret".into()), allow_comments: Some(false), ..Default::default() }).unwrap();
    assert!(updated.has_password && updated.allow_comments == Some(false));
    client.delete(&done.id).unwrap();
    assert!(client.video(&done.id).is_err() || client.video(&done.id).unwrap().status == "deleted");
}
