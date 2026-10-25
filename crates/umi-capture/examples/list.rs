//! Lists displays, windows (app names only), microphones and cameras.
fn main() {
    for d in umi_capture::screen::displays().unwrap() {
        println!("display {} {}×{} @{}x", d.id, d.width, d.height, d.scale);
    }
    let mut apps: Vec<String> = umi_capture::screen::windows().unwrap().into_iter().map(|w| w.app).collect();
    apps.sort();
    apps.dedup();
    println!("apps with windows: {}", apps.join(", "));
    for m in umi_capture::audio::microphones() {
        println!("mic: {}{}", m.name, if m.is_default { " (default)" } else { "" });
    }
}
