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
    export(gpu, Path::new(BUNDLE), edit, &ExportSettings { format, resolution, fps, hardware: true, bit_rate: 0 }, &out, &|_| {}, &cancel)
        .unwrap();
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

#[test]
fn joins_takes_end_to_end() {
    if !Path::new(BUNDLE).exists() {
        return;
    }
    let project = Bundle::new(BUNDLE).read_project().unwrap();
    let mut a = project.effective_edit(None);
    a.clips = vec![Clip::new(0.0, 2.0, 1.0)];
    let mut b = a.clone();
    b.clips = vec![Clip::new(4.0, 7.0, 1.0)];
    run("take-a.mp4", a, Format::Mp4, 720, 30);
    run("take-b.mp4", b, Format::Mp4, 720, 30);
    let dir = Path::new("/tmp/umi-golden");
    let out = dir.join("takes.mp4");
    let total = umi_engine::combine::concatenate(&[&dir.join("take-a.mp4"), &dir.join("take-b.mp4")], &out, 30, &|_| {}).unwrap();
    let d = umi_media::duration(&out).unwrap();
    assert!((total - 5.0).abs() < 0.15 && (d - 5.0).abs() < 0.2, "{total} {d}");
    // Sound runs the whole length.
    let mut reader = umi_media::AudioReader::open(&out, 0).unwrap();
    let mut buf = vec![0f32; 48_000 * 2 * 6];
    let n = reader.read(&mut buf).unwrap() / 2;
    assert!((n as f64 / 48_000.0 - 5.0).abs() < 0.15, "{}", n as f64 / 48_000.0);
}

/// Instant mode's upload-while-exporting MP4: index at the end, decodes like any MP4, and
/// only its first bytes differ from what was on disk mid-export.
#[test]
fn streaming_mp4_plays_and_only_patches_its_head() {
    if !Path::new(BUNDLE).exists() {
        return;
    }
    let project = Bundle::new(BUNDLE).read_project().unwrap();
    let mut edit = project.effective_edit(None);
    edit.clips = vec![Clip::new(0.0, 4.0, 1.0)];
    let out = Path::new("/tmp/umi-golden/streaming.mp4");
    let snapshot = std::sync::Mutex::new(Vec::<u8>::new());
    let gpu = Gpu::new().unwrap();
    let cancel = AtomicBool::new(false);
    let settings = ExportSettings { format: Format::StreamingMp4, resolution: 720, fps: 30, hardware: true, bit_rate: 0 };
    export(
        gpu,
        Path::new(BUNDLE),
        edit,
        &settings,
        out,
        &|p| {
            if p > 0.7 && snapshot.lock().unwrap().is_empty() {
                *snapshot.lock().unwrap() = std::fs::read(out).unwrap_or_default();
            }
        },
        &cancel,
    )
    .unwrap();
    let d = umi_media::duration(out).unwrap();
    assert!((d - 4.0).abs() < 0.15, "{d}");
    let fin = std::fs::read(out).unwrap();
    let mid = snapshot.into_inner().unwrap();
    assert!(mid.len() > 100_000, "nothing written mid-export ({} bytes)", mid.len());
    let differ = mid.iter().zip(&fin).enumerate().filter(|(_, (a, b))| a != b).map(|(i, _)| i).max();
    assert!(differ.is_none_or(|i| i < 64), "bytes changed at {differ:?}");
    // The index is at the end (no fast-start rewrite).
    let moov = fin.windows(4).rposition(|w| w == b"moov").unwrap();
    let mdat = fin.windows(4).position(|w| w == b"mdat").unwrap();
    assert!(moov > mdat);
}
