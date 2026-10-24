//! Where export time goes, per stage (run with --nocapture).

use std::path::Path;
use std::time::{Duration, Instant};
use umi_engine::sources::{SCREEN, Sources, as_video_frame};
use umi_media::{Container, Encoder, EncoderSettings, VideoCodec};
use umi_project::Bundle;
use umi_project::timeline::render_size;
use umi_render::{FrameRequest, Gpu, Renderer};

#[test]
fn profile_stages() {
    let bundle = Path::new("/tmp/umi-fixtures/Real.umi");
    if !bundle.exists() {
        return;
    }
    let project = Bundle::new(bundle).read_project().unwrap();
    let edit = project.effective_edit(None);
    let size = render_size(&project, &edit, 1080);
    let gpu = Gpu::new().unwrap();
    let mut renderer = Renderer::new(gpu, project.clone(), edit, Bundle::new(bundle).read_cursor(), Some(bundle.into()));
    let mut sources = Sources::new(bundle, true);
    let mut enc = Encoder::create(
        Path::new("/tmp/umi-golden/profile.mp4"),
        &EncoderSettings {
            width: size.0,
            height: size.1,
            fps: 30,
            codec: VideoCodec::H264,
            container: Container::Mp4,
            bit_rate: 0,
            audio: false,
            hardware: true,
        },
    )
    .unwrap();
    let (mut dec, mut ren, mut read, mut encd) = (Duration::ZERO, Duration::ZERO, Duration::ZERO, Duration::ZERO);
    let n = 90;
    for i in 0..n {
        let t = 1.0 + i as f64 / 30.0;
        let s = Instant::now();
        let frame = sources.frame(SCREEN, t).unwrap().unwrap();
        dec += s.elapsed();
        let s = Instant::now();
        renderer.render(
            size,
            &FrameRequest { time: t, output_time: Some(t), screen: Some(as_video_frame(&frame)), camera: None, overlays: vec![] },
        );
        ren += s.elapsed();
        let s = Instant::now();
        let rgba = renderer.read_rgba().unwrap();
        read += s.elapsed();
        let s = Instant::now();
        enc.push_rgba(&rgba).unwrap();
        encd += s.elapsed();
    }
    enc.finish().unwrap();
    let per = |d: Duration| d.as_secs_f64() * 1000.0 / n as f64;
    eprintln!(
        "{}x{} per frame: decode {:.1} ms, render(upload+gpu) {:.1} ms, readback {:.1} ms, encode {:.1} ms",
        size.0,
        size.1,
        per(dec),
        per(ren),
        per(read),
        per(encd)
    );
}
