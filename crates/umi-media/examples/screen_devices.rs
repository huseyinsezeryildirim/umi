//! Lists iPhones/iPads connected by cable (macOS).
fn main() {
    let first = umi_media::device::screen_devices();
    std::thread::sleep(std::time::Duration::from_millis(1500));
    let later = umi_media::device::screen_devices();
    println!("now: {first:?}\nafter discovery: {later:?}");
}
