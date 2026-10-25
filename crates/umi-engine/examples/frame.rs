//! Renders one frame of a recording to a PNG (debugging aid).
//! cargo run --release -p umi-engine --example frame -- <bundle.umi> <time> <out.png> [edit.json]
//! `edit.json` (optional) replaces the recording's edit.
use std::path::Path;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let bundle = Path::new(&args[1]);
    let time: f64 = args[2].parse().unwrap();
    let out = &args[3];
    let project = umi_project::Bundle::new(bundle).read_project().unwrap();
    let edit = match args.get(4) {
        Some(file) => serde_json::from_str(&std::fs::read_to_string(file).unwrap()).unwrap(),
        None => project.effective_edit(None),
    };
    let gpu = umi_render::Gpu::new().unwrap();
    let size = umi_project::timeline::render_size(&project, &edit, 720);
    let mut composer = umi_engine::Composer::open(gpu, bundle, edit, true).unwrap();
    composer.render(time, size).unwrap();
    let rgba = composer.renderer.read_rgba().unwrap();
    image::RgbaImage::from_raw(size.0, size.1, rgba).unwrap().save(out).unwrap();
}
