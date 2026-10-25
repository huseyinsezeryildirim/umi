//! Exports a recording with its edit (or the default look) to MP4.
//! cargo run --release -p umi-engine --example export -- <bundle.umi> <out.mp4> [short side, default 1080] [plain|look] [fps] [bits/s]
//! `plain`: the recording as captured (no zoom, background or cursor smoothing), for before/after.
use std::path::Path;
use std::sync::atomic::AtomicBool;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let bundle = Path::new(&args[1]);
    let resolution: u32 = args.get(3).and_then(|s| s.parse().ok()).unwrap_or(1080);
    let mut edit = umi_project::Bundle::new(bundle).read_project().unwrap().effective_edit(None);
    if args.get(4).map(String::as_str) == Some("plain") {
        edit.zoom.auto = false;
        edit.zoom.segments.clear();
        edit.padding = 0.0;
        edit.corner_radius = 0.0;
        edit.shadow = 0.0;
        edit.cursor.smoothing = umi_project::edit::Smoothing::Off;
        edit.cursor.click_rings = false;
    }
    let gpu = umi_render::Gpu::new().unwrap();
    let fps: u32 = args.get(5).and_then(|s| s.parse().ok()).unwrap_or(60);
    let bit_rate: usize = args.get(6).and_then(|s| s.parse().ok()).unwrap_or(0);
    let settings = umi_engine::ExportSettings { format: umi_engine::Format::Mp4, resolution, fps, hardware: true, bit_rate };
    umi_engine::export(gpu, bundle, edit, &settings, Path::new(&args[2]), &|_| {}, &AtomicBool::new(false)).unwrap();
}
