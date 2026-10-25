//! A recording cut off mid-way (the app crashed) is still usable and gets finished.

use umi_media::{Pixels, StreamWriter, VideoCodec, WriterSettings};

#[test]
fn finishes_a_recording_left_behind() {
    let library = std::env::temp_dir().join("umi-recover-test");
    let _ = std::fs::remove_dir_all(&library);
    let bundle = library.join("Umi crash.umi");
    std::fs::create_dir_all(&bundle).unwrap();
    let (w, h) = (320u32, 200u32);
    let mut writer = StreamWriter::create(&bundle.join("screen.mov"), &WriterSettings { width: w, height: h, fps: 30, codec: VideoCodec::H264, bit_rate: 0, audio_tracks: 1, fragmented: true, hardware: true }).unwrap();
    let y = vec![90u8; (w * h) as usize];
    let uv = vec![128u8; (w * h / 2) as usize];
    for i in 0..90 {
        writer.push_video(Pixels::Nv12 { y: &y, y_stride: w as usize, uv: &uv, uv_stride: w as usize }, i as f64 / 30.0).unwrap();
        writer.push_audio(0, &vec![0.1f32; 1600 * 2], i as f64 / 30.0).unwrap();
    }
    // The app dies: no finish(), nothing flushed beyond the fragments already written.
    std::mem::forget(writer);

    let recovered = umi_recorder::recover(&library);
    assert_eq!(recovered, vec![bundle.clone()]);
    let project = umi_project::Bundle::new(&bundle).read_project().unwrap();
    // Fragments are cut every second: at least 2 of the 3 seconds survive.
    assert!(project.duration >= 1.9, "{}", project.duration);
    assert_eq!(project.audio.microphone_track, Some(0));
    // Running it again changes nothing.
    assert!(umi_recorder::recover(&library).is_empty());
    let _ = std::fs::remove_dir_all(&library);
}
