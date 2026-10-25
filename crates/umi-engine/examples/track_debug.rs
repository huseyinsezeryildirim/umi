//! Runs mask tracking on a project's first mask and prints the path (debugging aid).
use umi_project::Bundle;

fn main() {
    let path = std::env::args().nth(1).expect("bundle path");
    let anchor: f64 = std::env::args().nth(2).and_then(|a| a.parse().ok()).unwrap_or(0.0);
    let bundle = Bundle::new(&path);
    let nums: Vec<f64> = std::env::args().skip(3).filter_map(|a| a.parse().ok()).collect();
    let (rect, from, to) = if nums.len() == 6 {
        (umi_project::Rect::new(nums[0], nums[1], nums[2], nums[3]), nums[4], nums[5])
    } else {
        let m = bundle.read_project().unwrap().edit.unwrap().masks[0].clone();
        (m.rect_at(anchor), m.start, m.end)
    };
    let start = std::time::Instant::now();
    let keys = umi_engine::track::track_region(&bundle.screen(), rect, anchor, from, to, &|_| {}).unwrap();
    println!("{} keys in {:.2}s", keys.len(), start.elapsed().as_secs_f64());
    for k in keys.iter().step_by(15) {
        println!("t={:.2} x={:.3} y={:.3}", k.t, k.rect.min_x(), k.rect.min_y());
    }
}
