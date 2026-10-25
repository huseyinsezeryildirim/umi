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
    let keys = track_region(screen, Rect::new(0.3, 0.3, 0.15, 0.1), 2.0, 5.0, &|_| {}).unwrap();
    eprintln!("{} keyframes in {:.2}s, last {:?}", keys.len(), start.elapsed().as_secs_f64(), keys.last().map(|k| k.rect));
    assert!(keys.len() >= 40);
    for k in &keys {
        assert!(k.rect.min_x() >= 0.0 && k.rect.max_x() <= 1.0001 && k.rect.min_y() >= 0.0 && k.rect.max_y() <= 1.0001);
    }
}
