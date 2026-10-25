//! Camera effects on a real recording (skipped without the fixture or models).

use umi_ai::camera::{Background, process_background, track_face};
use umi_ai::models::Model;

#[test]
fn makes_background_effects_and_face_path() {
    let source = std::path::Path::new("/tmp/umi-fixtures/Real.umi");
    if !source.join("camera.mov").exists() || !Model::Segmentation.is_ready() || !Model::FaceDetection.is_ready() {
        return;
    }
    let bundle = std::env::temp_dir().join("umi-camera-fx-test.umi");
    let _ = std::fs::remove_dir_all(&bundle);
    std::fs::create_dir_all(&bundle).unwrap();
    std::fs::copy(source.join("camera.mov"), bundle.join("camera.mov")).unwrap();
    let length = umi_media::duration(&bundle.join("camera.mov")).unwrap();

    for mode in [Background::Blur, Background::Remove] {
        process_background(&bundle, mode, &|_| {}).unwrap();
        let out = bundle.join(mode.file());
        let d = umi_media::duration(&out).unwrap();
        assert!((d - length).abs() < 0.2, "{mode:?}: {d} vs {length}");
        // Small: no huge intermediate formats.
        assert!(std::fs::metadata(&out).unwrap().len() < 20_000_000);
    }
    // The matte is white where the person is (center) and dark at the corners.
    let mut matte = umi_media::VideoDecoder::open(&bundle.join("camera-matte.mov"), false).unwrap();
    let frame = matte.frame_at(3.0).unwrap().unwrap();
    let (w, h) = (frame.width as usize, frame.height as usize);
    let luma = |x: usize, y: usize| frame.planes[0][y * frame.strides[0] as usize + x];
    assert!(luma(w / 2, h / 2) > 180, "person: {}", luma(w / 2, h / 2));
    assert!(luma(w / 20, h / 10) < 60, "background: {}", luma(w / 20, h / 10));

    let faces = track_face(&bundle, &|_| {}).unwrap();
    assert!(faces.len() > 20);
    assert!(faces.iter().all(|f| f.x > 0.2 && f.x < 0.8 && f.size > 0.2));
    let _ = std::fs::remove_dir_all(&bundle);
}
