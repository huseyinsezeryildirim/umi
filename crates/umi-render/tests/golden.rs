//! Render parity with the Swift app: the same scenarios rendered by both renderers must
//! look the same. Swift references come from `UmiTests/GoldenExportTests` (written to
//! /tmp/umi-golden); this test writes `rust-*.png` and `compare-*.png` (Swift | Rust | diff)
//! next to them and fails when a scenario drifts past its tolerance.

use std::path::Path;
use umi_project::{Bundle, EditSettings};
use umi_render::{FrameRequest, Gpu, PixelData, Renderer, VideoFrame};

fn load_rgba(path: &Path) -> Option<(u32, u32, Vec<u8>)> {
    let img = image::open(path).ok()?.to_rgba8();
    Some((img.width(), img.height(), img.into_raw()))
}

/// Mean absolute difference (0–255) over RGB.
fn mean_diff(a: &[u8], b: &[u8]) -> f64 {
    let total: u64 =
        a.chunks(4).zip(b.chunks(4)).map(|(p, q)| (0..3).map(|c| (p[c] as i32 - q[c] as i32).unsigned_abs() as u64).sum::<u64>()).sum();
    total as f64 / (a.len() / 4 * 3) as f64
}

#[test]
fn matches_swift_renderer() {
    let golden = Path::new("/tmp/umi-golden");
    let bundle_path = Path::new("/tmp/umi-fixtures/Real.umi");
    let Some((sw, sh, screen)) = load_rgba(&golden.join("screen.png")) else {
        eprintln!("skipped: run the Swift GoldenExportTests first");
        return;
    };
    if !bundle_path.exists() {
        return;
    }
    let camera = load_rgba(&golden.join("camera.png"));
    let bundle = Bundle::new(bundle_path);
    let project = bundle.read_project().unwrap();
    let cursor = bundle.read_cursor();
    let gpu = Gpu::new().expect("gpu");
    eprintln!("GPU: {} ({:?})", gpu.adapter_info.name, gpu.adapter_info.backend);

    let scenarios: Vec<serde_json::Value> = serde_json::from_str(include_str!("golden/scenarios.json")).unwrap();
    let mut failures = vec![];
    for scenario in scenarios {
        let name = scenario["name"].as_str().unwrap();
        let time = scenario["time"].as_f64().unwrap();
        let size = (scenario["size"][0].as_u64().unwrap() as u32, scenario["size"][1].as_u64().unwrap() as u32);
        let edit: EditSettings = serde_json::from_value(scenario["edit"].clone()).unwrap();
        let mut renderer = Renderer::new(gpu.clone(), project.clone(), edit, cursor.clone(), Some(bundle_path.to_path_buf()));
        let request = FrameRequest {
            time,
            output_time: Some(time),
            screen: Some(VideoFrame { width: sw, height: sh, data: PixelData::Rgba8 { data: &screen, stride: sw * 4 } }),
            camera: camera.as_ref().map(|(w, h, d)| VideoFrame {
                width: *w,
                height: *h,
                data: PixelData::Rgba8 { data: d, stride: w * 4 },
            }),
            overlays: vec![],
        };
        let start = std::time::Instant::now();
        renderer.render(size, &request);
        let rgba = renderer.read_rgba().unwrap();
        let elapsed = start.elapsed();
        image::save_buffer(golden.join(format!("rust-{name}.png")), &rgba, size.0, size.1, image::ColorType::Rgba8).unwrap();

        let Some((w, h, swift)) = load_rgba(&golden.join(format!("swift-{name}.png"))) else { continue };
        assert_eq!((w, h), size, "{name}: size");
        let diff = mean_diff(&swift, &rgba);
        // Side by side: Swift | Rust | amplified difference.
        let mut cmp = image::RgbaImage::new(w * 3, h);
        for y in 0..h {
            for x in 0..w {
                let i = ((y * w + x) * 4) as usize;
                cmp.put_pixel(x, y, image::Rgba([swift[i], swift[i + 1], swift[i + 2], 255]));
                cmp.put_pixel(x + w, y, image::Rgba([rgba[i], rgba[i + 1], rgba[i + 2], 255]));
                let d = (0..3).map(|c| (swift[i + c] as i32 - rgba[i + c] as i32).unsigned_abs()).max().unwrap_or(0);
                let v = (d * 4).min(255) as u8;
                cmp.put_pixel(x + 2 * w, y, image::Rgba([v, v, v, 255]));
            }
        }
        cmp.save(golden.join(format!("compare-{name}.png"))).unwrap();
        // Text uses different fonts on purpose (portable fonts vs. San Francisco).
        let tolerance = if name == "texts" { 12.0 } else { 8.0 };
        eprintln!("{name:<22} mean diff {diff:5.2}  ({elapsed:.1?})");
        if diff > tolerance {
            failures.push(format!("{name}: {diff:.2} > {tolerance}"));
        }
    }
    assert!(failures.is_empty(), "render drift: {failures:?}");
}
