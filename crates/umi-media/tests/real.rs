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

/// A live-style recording: irregular frame times, two audio tracks with a gap, fragmented.
#[test]
fn writes_a_recording_as_it_happens() {
    use umi_media::{Pixels, StreamWriter, VideoCodec, WriterSettings};
    let path = std::env::temp_dir().join("umi-record-test.mov");
    let (w, h) = (640u32, 360u32);
    let mut writer = StreamWriter::create(
        &path,
        &WriterSettings {
            width: w,
            height: h,
            fps: 60,
            codec: VideoCodec::H264,
            bit_rate: 0,
            audio_tracks: 2,
            fragmented: true,
            hardware: true,
        },
    )
    .unwrap();
    let y = vec![128u8; (w * h) as usize];
    let uv = vec![128u8; (w * h / 2) as usize];
    let bgra = vec![200u8; (w * h * 4) as usize];
    // 2 s: frames at uneven times (static screens send fewer), alternating NV12 and BGRA.
    let mut t = 0.0;
    let mut k = 0;
    while t < 2.0 {
        if k % 2 == 0 {
            writer.push_video(Pixels::Nv12 { y: &y, y_stride: w as usize, uv: &uv, uv_stride: w as usize }, t).unwrap();
        } else {
            writer.push_video(Pixels::Bgra { data: &bgra, stride: (w * 4) as usize }, t).unwrap();
        }
        t += if k % 5 == 0 { 0.1 } else { 1.0 / 60.0 };
        k += 1;
    }
    // Track 0 continuous; track 1 starts late (0.5 s) — silence is filled in.
    let tone: Vec<f32> = (0..48_000 * 2)
        .flat_map(|i| {
            let v = (i as f32 * 0.05).sin() * 0.3;
            [v, v]
        })
        .collect();
    for (i, chunk) in tone.chunks(960 * 2).enumerate() {
        writer.push_audio(0, chunk, i as f64 * 0.02).unwrap();
        if i as f64 * 0.02 >= 0.5 {
            writer.push_audio(1, chunk, i as f64 * 0.02).unwrap();
        }
    }
    let frames = writer.frames_written();
    writer.finish().unwrap();
    assert!(frames > 50);
    let streams = umi_media::audio_streams(&path).unwrap();
    assert_eq!(streams.len(), 2);
    let duration = umi_media::duration(&path).unwrap();
    assert!((duration - 2.0).abs() < 0.2, "{duration}");
    // Both audio tracks are ~2 s long (the late one padded at the start).
    for track in 0..2 {
        let mut reader = umi_media::AudioReader::open(&path, track).unwrap();
        let mut buf = vec![0f32; 48_000 * 2 * 3];
        let n = reader.read(&mut buf).unwrap() / 2;
        assert!((n as f64 / 48_000.0 - 2.0).abs() < 0.1, "track {track}: {n}");
        if track == 1 {
            let early: f32 = buf[..2 * 20_000].iter().map(|s| s.abs()).sum();
            assert!(early < 1.0, "silence before the late start");
        }
    }
}
