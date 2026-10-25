//! Tracking a region of a real recording (skipped without the fixture).

use std::path::Path;
use umi_engine::track::track_region;
use umi_project::Rect;

#[test]
fn tracks_a_region() {
    let screen = Path::new("/tmp/umi-fixtures/Real.umi/screen.mov");
    if !screen.exists() {
        return;
    }
    let start = std::time::Instant::now();
    let keys = track_region(screen, Rect::new(0.3, 0.3, 0.15, 0.1), 3.0, 2.0, 5.0, &|_| {}).unwrap();
    eprintln!("{} keyframes in {:.2}s, last {:?}", keys.len(), start.elapsed().as_secs_f64(), keys.last().map(|k| k.rect));
    assert!(keys.len() >= 85, "{}", keys.len());
    // The anchor keeps the placed rect; times ascend.
    assert!(keys.iter().any(|k| (k.t - 3.0).abs() < 0.04 && (k.rect.min_x() - 0.3).abs() < 1e-9));
    assert!(keys.windows(2).all(|w| w[0].t < w[1].t));
    // Size is kept; the rect may leave the frame with content scrolled off screen, but
    // never by more than its own size.
    for k in &keys {
        assert!((k.rect.width() - 0.15).abs() < 1e-9 && (k.rect.height() - 0.1).abs() < 1e-9);
        assert!(k.rect.max_x() > 0.0 && k.rect.min_x() < 1.0 && k.rect.max_y() > -1.0 && k.rect.min_y() < 2.0);
    }
}

/// A synthetic scrolling page (content moves up 4 px per frame): the mask must move with it.
#[test]
fn follows_scrolling_content() {
    use umi_media::{Container, Encoder, EncoderSettings, VideoCodec};
    let (w, h, fps) = (640u32, 400u32, 30u32);
    let path = std::env::temp_dir().join("umi-scroll-test.mp4");
    let mut enc = Encoder::create(
        &path,
        &EncoderSettings {
            width: w,
            height: h,
            fps,
            codec: VideoCodec::H264,
            container: Container::Mp4,
            bit_rate: 8_000_000,
            audio: false,
            hardware: true,
        },
    )
    .unwrap();
    // A tall "page" of distinct blocks, scrolled 4 px per frame.
    let page_h = h as usize + 4 * 90;
    let mut page = vec![0u8; w as usize * page_h * 4];
    for y in 0..page_h {
        for x in 0..w as usize {
            let i = (y * w as usize + x) * 4;
            let block = ((x / 40) * 7 + (y / 30) * 13) % 17;
            let v = (block * 15) as u8;
            page[i..i + 4].copy_from_slice(&[v, 255 - v, (v / 2).wrapping_add((x % 7) as u8 * 20), 255]);
        }
    }
    for f in 0..90usize {
        let off = f * 4 * w as usize * 4;
        enc.push_rgba(&page[off..off + (w * h * 4) as usize]).unwrap();
    }
    enc.finish().unwrap();

    // Place a mask at 1.0 s over a block and follow it to 2.5 s.
    let rect = Rect::new(0.4, 0.5, 0.12, 0.12);
    let keys = track_region(&path, rect, 1.0, 1.0, 2.5, &|_| {}).unwrap();
    let last = keys.last().unwrap();
    let moved_px = (rect.min_y() - last.rect.min_y()) * h as f64;
    let expected_px = (last.t - 1.0) * fps as f64 * 4.0;
    eprintln!("moved {moved_px:.0} px, expected {expected_px:.0} px over {:.2}s", last.t - 1.0);
    // Within a few pixels of the true scroll (or it stopped at the top edge).
    let top_px = rect.min_y() * h as f64;
    assert!((moved_px - expected_px.min(top_px)).abs() < 8.0, "moved {moved_px} expected {expected_px}");
}
