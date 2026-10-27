//! A link made while recording, against a local `wrangler dev` (UMI_CLOUD_TEST=http://localhost:8799)
//! and the real fixture recording: the screen file is uploaded while it grows, then the edit and
//! cursor; what the player gets is byte-for-byte the local files.

use std::io::Write;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

#[test]
fn uploads_a_recording_while_it_is_written() {
    let Ok(base) = std::env::var("UMI_CLOUD_TEST") else { return };
    let bundle = Path::new("/tmp/umi-fixtures/Real.umi");
    if !bundle.exists() {
        return;
    }
    let client = umi_cloud::Client::new(&base, "umi_dev_token");
    let link = client.reserve_raw("Live link test", false).unwrap();
    let screen = std::fs::read(bundle.join(umi_project::project::SCREEN_FILE)).unwrap();
    let growing = std::env::temp_dir().join("umi-live-link-test.mov");
    std::fs::write(&growing, b"").unwrap();
    let recording = AtomicBool::new(true);
    let during = AtomicU64::new(0);
    std::thread::scope(|scope| {
        // The recorder: the file grows a megabyte at a time.
        scope.spawn(|| {
            let mut f = std::fs::OpenOptions::new().append(true).open(&growing).unwrap();
            for chunk in screen.chunks(1024 * 1024) {
                f.write_all(chunk).unwrap();
                f.flush().unwrap();
                std::thread::sleep(std::time::Duration::from_millis(30));
            }
            recording.store(false, Ordering::SeqCst);
        });
        let finished =
            || (!recording.load(Ordering::SeqCst)).then(|| Ok(umi_cloud::RawMeta { duration_ms: 5000, width: 1920, height: 1080 }));
        client
            .upload_raw(&link, "screen", &growing, &finished, &|n| {
                if recording.load(Ordering::SeqCst) {
                    during.store(n, Ordering::SeqCst);
                }
            })
            .unwrap();
    });
    eprintln!("uploaded {} bytes while recording", during.load(Ordering::SeqCst));
    let project: serde_json::Value =
        serde_json::from_slice(&std::fs::read(bundle.join(umi_project::project::PROJECT_FILE)).unwrap()).unwrap();
    let cursor: Option<serde_json::Value> =
        std::fs::read(bundle.join(umi_project::project::CURSOR_FILE)).ok().and_then(|b| serde_json::from_slice(&b).ok());
    client.put_raw_edit(&link.video.id, &project, cursor.as_ref()).unwrap();
    let video = client.video(&link.video.id).unwrap();
    assert_eq!(video.status, "ready");
    let mut served = ureq::get(&format!("{}/raw/screen.mp4", video.url)).call().unwrap();
    let bytes = served.body_mut().with_config().limit(512 * 1024 * 1024).read_to_vec().unwrap();
    assert!(bytes == screen, "served {} bytes, local {}", bytes.len(), screen.len());
    let mut edit = ureq::get(&format!("{}/raw/edit.json", video.url)).call().unwrap();
    assert_eq!(serde_json::from_slice::<serde_json::Value>(&edit.body_mut().read_to_vec().unwrap()).unwrap(), project);
    client.delete(&video.id).unwrap();
    let _ = std::fs::remove_file(&growing);
}
