//! Makes the blurred / cut-out camera and the face path for a copy of a bundle.
//! cargo run --release -p umi-ai --example camera_fx -- <bundle.umi> blur|remove|face
fn main() {
    let args: Vec<String> = std::env::args().collect();
    let bundle = std::path::Path::new(&args[1]);
    let t = std::time::Instant::now();
    match args[2].as_str() {
        "face" => {
            let keys = umi_ai::camera::track_face(bundle, &|_| {}).unwrap();
            println!("{} face keys in {:.1}s; first {:?}", keys.len(), t.elapsed().as_secs_f64(), keys.first());
        }
        mode => {
            let m = if mode == "remove" { umi_ai::camera::Background::Remove } else { umi_ai::camera::Background::Blur };
            umi_ai::camera::process_background(bundle, m, &|_| {}).unwrap();
            let out = bundle.join(m.file());
            println!("{} ({:.1} MB, {:.2}s) in {:.1}s", out.display(), std::fs::metadata(&out).unwrap().len() as f64 / 1e6, umi_media::duration(&out).unwrap(), t.elapsed().as_secs_f64());
        }
    }
}
