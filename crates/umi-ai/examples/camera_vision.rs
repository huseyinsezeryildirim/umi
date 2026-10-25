//! Face box and person mask for one camera frame; writes the mask next to `out.png`.
//! cargo run --release -p umi-ai --example camera_vision -- <camera.mov> <time> <out.png>
fn main() {
    let args: Vec<String> = std::env::args().collect();
    let mut decoder = umi_media::VideoDecoder::open(std::path::Path::new(&args[1]), true).unwrap();
    let frame = decoder.frame_at(args[2].parse().unwrap()).unwrap().unwrap();
    let (w, h, rgba) = umi_media::to_rgba(&frame, 1280).unwrap();
    let t = std::time::Instant::now();
    let mut faces = umi_ai::vision::FaceDetector::load(&|_| {}).unwrap();
    let found = faces.detect(&rgba, w, h).unwrap();
    println!("faces {:?} in {:.1} ms", found.first(), t.elapsed().as_secs_f64() * 1000.0);
    let t = std::time::Instant::now();
    let mut seg = umi_ai::vision::Segmenter::load(&|_| {}).unwrap();
    let mask = seg.mask(&rgba, w, h).unwrap();
    let t1 = std::time::Instant::now();
    let mask2 = seg.mask(&rgba, w, h).unwrap();
    println!(
        "mask {} values, mean {:.2}; first {:.1} ms, warm {:.1} ms",
        mask.len(),
        mask.iter().sum::<f32>() / mask.len() as f32,
        (t1 - t).as_secs_f64() * 1000.0,
        t1.elapsed().as_secs_f64() * 1000.0
    );
    let _ = mask2;
    // Frame with the background darkened by the mask, and the face box.
    let mut out = image::RgbaImage::from_raw(w, h, rgba).unwrap();
    for (x, y, p) in out.enumerate_pixels_mut() {
        let m = mask[(y as usize * 256 / h as usize) * 256 + x as usize * 256 / w as usize];
        for c in 0..3 {
            p[c] = (p[c] as f32 * (0.25 + 0.75 * m)) as u8;
        }
    }
    if let Some(f) = found.first() {
        let (x0, y0, x1, y1) =
            ((f.x * w as f64) as u32, (f.y * h as f64) as u32, ((f.x + f.width) * w as f64) as u32, ((f.y + f.height) * h as f64) as u32);
        for x in x0..x1.min(w - 1) {
            for y in [y0.min(h - 1), y1.min(h - 1)] {
                out.put_pixel(x, y, image::Rgba([0, 255, 0, 255]));
            }
        }
        for y in y0..y1.min(h - 1) {
            for x in [x0.min(w - 1), x1.min(w - 1)] {
                out.put_pixel(x, y, image::Rgba([0, 255, 0, 255]));
            }
        }
    }
    out.save(&args[3]).unwrap();
}
