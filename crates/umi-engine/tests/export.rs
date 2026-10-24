//! End-to-end export of a real recording (skipped when the fixture is absent).

use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::time::Instant;
use umi_engine::{ExportSettings, Format, export};
use umi_project::Bundle;
use umi_project::edit::Clip;
use umi_render::Gpu;

const BUNDLE: &str = "/tmp/umi-fixtures/Real.umi";

fn run(name: &str, edit: umi_project::EditSettings, format: Format, resolution: u32, fps: u32) -> f64 {
    let gpu = Gpu::new().unwrap();
    let out = Path::new("/tmp/umi-golden").join(name);
    let cancel = AtomicBool::new(false);
    let start = Instant::now();
    export(gpu, Path::new(BUNDLE), edit, &ExportSettings { format, resolution, fps, hardware: true }, &out, &|_| {}, &cancel).unwrap();
    let secs = start.elapsed().as_secs_f64();
    let duration = umi_media::duration(&out).unwrap_or(0.0);
    eprintln!("{name}: {duration:.2}s of video in {secs:.2}s ({:.1}× real time)", duration / secs);
    duration
}

#[test]
fn exports_real_recording() {
    if !Path::new(BUNDLE).exists() {
        return;
    }
    let bundle = Bundle::new(BUNDLE);
    let project = bundle.read_project().unwrap();
    let edit = project.effective_edit(None);
    let d = run("export-v2.mp4", edit.clone(), Format::Mp4, 1080, 30);
    assert!((d - project.duration).abs() < 0.2, "{d} vs {}", project.duration);

    // Cuts, a 2× clip and a crossfade: 0–3 s, 4–8 s at 2×, 0.5 s dissolve → 3 + 2 − 0.5.
    let mut cut = edit.clone();
    cut.clips = vec![Clip::new(0.0, 3.0, 1.0), Clip::new(4.0, 8.0, 2.0)];
    cut.crossfade = 0.5;
    let d = run("export-v2-cut.mp4", cut, Format::Mp4, 720, 30);
    assert!((d - 4.5).abs() < 0.15, "{d}");

    let d = run("export-v2.gif", edit, Format::Gif, 1080, 15);
    let _ = d;
    assert!(Path::new("/tmp/umi-golden/export-v2.gif").metadata().unwrap().len() > 10_000);
}
