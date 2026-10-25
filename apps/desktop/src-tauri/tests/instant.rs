//! Instant mode against a local `wrangler dev` (UMI_CLOUD_TEST=http://localhost:8799) and
//! the real fixture recording: the export is uploaded while it's written, and what viewers
//! get is byte-for-byte the local file.

use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

#[test]
fn exports_and_uploads_at_the_same_time() {
    let Ok(base) = std::env::var("UMI_CLOUD_TEST") else { return };
    let bundle = Path::new("/tmp/umi-fixtures/Real.umi");
    if !bundle.exists() {
        return;
    }
    let client = umi_cloud::Client::new(&base, "umi_dev_token");
    let reservation = client.reserve("Instant test").unwrap();
    let out = std::env::temp_dir().join("umi-instant-test.mp4");
    let _ = std::fs::remove_file(&out);
    let edit = umi_project::Bundle::new(bundle).read_project().unwrap().effective_edit(None);
    let finished = parking_lot::Mutex::new(None::<Result<umi_cloud::Finished, String>>);
    let during = AtomicU64::new(0);
    let exporting = AtomicBool::new(true);
    let video = std::thread::scope(|scope| {
        scope.spawn(|| {
            let gpu = umi_render::Gpu::new().unwrap();
            let settings = umi_engine::ExportSettings { format: umi_engine::Format::StreamingMp4, resolution: 1080, fps: 60, hardware: true };
            let r = umi_engine::export(gpu, bundle, edit, &settings, &out, &|_| {}, &AtomicBool::new(false)).map_err(|e| e.to_string());
            exporting.store(false, Ordering::SeqCst);
            let info = umi_media::VideoDecoder::open(&out, false).unwrap().info();
            *finished.lock() = Some(r.map(|_| umi_cloud::Finished {
                duration_ms: (info.duration * 1000.0) as u64,
                width: info.width,
                height: info.height,
                poster: None,
                gif: None,
            }));
        });
        while !out.exists() {
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        client
            .upload_growing(&reservation, &out, &|| finished.lock().take(), &|n| {
                if exporting.load(Ordering::SeqCst) {
                    during.store(n, Ordering::SeqCst);
                }
            })
            .unwrap()
    });
    eprintln!("uploaded {} bytes while exporting", during.load(Ordering::SeqCst));
    assert_eq!(video.status, "ready");
    assert!(video.width.unwrap_or(0) > 1000 && video.height == Some(1080), "{:?}", (video.width, video.height));
    assert!(video.duration_ms.unwrap_or(0) > 1000);
    let local = std::fs::read(&out).unwrap();
    let mut served = ureq::get(&format!("{}/video.mp4", video.url)).call().unwrap();
    let bytes = served.body_mut().with_config().limit(512 * 1024 * 1024).read_to_vec().unwrap();
    assert!(bytes == local, "served {} bytes, local {}", bytes.len(), local.len());
    client.delete(&video.id).unwrap();
}
