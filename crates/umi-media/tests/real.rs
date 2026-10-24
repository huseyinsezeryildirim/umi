//! Decodes and encodes against a real recording (skipped when the fixture is absent).

use std::path::Path;
use std::time::Instant;
use umi_media::*;

const BUNDLE: &str = "/tmp/umi-fixtures/Real.umi";

#[test]
fn decodes_screen_with_hardware_and_seeks() {
    let path = Path::new(BUNDLE).join("screen.mov");
    if !path.exists() {
        return;
    }
    let mut decoder = VideoDecoder::open(&path, true).unwrap();
    let info = decoder.info();
    eprintln!(
        "screen {}x{} {:.1}fps {:.2}s start {:.3} hardware={}",
        info.width, info.height, info.fps, info.duration, info.start, decoder.hardware
    );
    assert!(info.width > 0 && info.duration > 1.0);

    // Sequential (playback/export) speed.
    let start = Instant::now();
    let mut n = 0;
    for i in 0..120 {
        let t = 1.0 + i as f64 / 60.0;
        let f = decoder.frame_at(t).unwrap().expect("frame");
        assert!((f.pts - t).abs() < 0.05, "t {t} got {}", f.pts);
        n += 1;
    }
    let per = start.elapsed().as_secs_f64() / n as f64 * 1000.0;
    eprintln!("sequential: {per:.2} ms/frame");

    // Random access (scrubbing).
    let start = Instant::now();
    for t in [7.3, 0.0, 4.2, 9.9, 2.5] {
        let f = decoder.frame_at(t).unwrap().expect("frame");
        assert!((f.pts - t.max(info.start)).abs() < 0.05, "seek {t} got {}", f.pts);
        assert_eq!(f.format, FrameFormat::Nv12);
    }
    eprintln!("seek: {:.1} ms each", start.elapsed().as_secs_f64() / 5.0 * 1000.0);
}

#[test]
fn reads_audio_and_waveform() {
    let path = Path::new(BUNDLE).join("screen.mov");
    if !path.exists() {
        return;
    }
    let streams = audio_streams(&path).unwrap();
    eprintln!("audio streams: {streams:?}");
    assert!(!streams.is_empty());
    let mut reader = AudioReader::open(&path, streams.len() - 1).unwrap();
    let mut buf = vec![0f32; SAMPLE_RATE as usize * CHANNELS];
    let n = reader.read(&mut buf).unwrap();
    assert_eq!(n, buf.len());
    reader.seek(5.0).unwrap();
    assert_eq!(reader.read(&mut buf).unwrap(), buf.len());
    let peaks = waveform(&path, streams.len() - 1, 20).unwrap();
    eprintln!("waveform: {} buckets, max {:.2}", peaks.len(), peaks.iter().cloned().fold(0.0, f32::max));
    assert!(peaks.len() >= 190);
}

#[test]
fn encodes_mp4_with_audio() {
    let out = std::env::temp_dir().join("umi-media-test.mp4");
    let settings = EncoderSettings {
        width: 640,
        height: 360,
        fps: 30,
        codec: VideoCodec::H264,
        container: Container::Mp4,
        bit_rate: 0,
        audio: true,
        hardware: true,
    };
    let mut enc = Encoder::create(&out, &settings).unwrap();
    eprintln!("encoder: {}", enc.encoder_name);
    let mut rgba = vec![0u8; 640 * 360 * 4];
    for i in 0..60 {
        for (p, px) in rgba.chunks_mut(4).enumerate() {
            px.copy_from_slice(&[(p % 640) as u8, (i * 4) as u8, 128, 255]);
        }
        enc.push_rgba(&rgba).unwrap();
        // 1/30 s of a 440 Hz tone.
        let samples: Vec<f32> = (0..1600)
            .flat_map(|k| {
                let s = ((i * 1600 + k) as f32 / SAMPLE_RATE as f32 * 440.0 * std::f32::consts::TAU).sin() * 0.2;
                [s, s]
            })
            .collect();
        enc.push_audio(&samples).unwrap();
    }
    enc.finish().unwrap();
    let d = duration(&out).unwrap();
    eprintln!("wrote {out:?}, {d:.2}s");
    assert!((d - 2.0).abs() < 0.15);
    let mut dec = VideoDecoder::open(&out, false).unwrap();
    assert_eq!(dec.info().width, 640);
    assert!(dec.frame_at(1.0).unwrap().is_some());
}
