//! End-to-end check on Umi's own window only: record 1 s, pause 1 s, record 1 s, stop.
//! No microphone, camera or system sound. Prints what was written, then deletes it.
use umi_capture::Target;
use umi_recorder::{Options, Recording};

fn main() {
    let window = umi_capture::screen::windows().unwrap().into_iter().find(|w| w.app.to_lowercase().contains("umi")).expect("an Umi window");
    let library = std::env::temp_dir().join("umi-record-e2e");
    let _ = std::fs::remove_dir_all(&library);
    let options = Options { target: Target::Window { id: window.id }, fps: 30, max_size: 1920, system_audio: false, microphone: None, camera: None, camera_style: None, camera_only: false };
    let rec = Recording::start(&library, options).unwrap();
    std::thread::sleep(std::time::Duration::from_secs(1));
    rec.pause();
    std::thread::sleep(std::time::Duration::from_secs(1));
    rec.resume();
    std::thread::sleep(std::time::Duration::from_secs(1));
    println!("elapsed {:.2}s, dropped {}", rec.elapsed(), rec.dropped_frames());
    let bundle = rec.stop().unwrap();
    let b = umi_project::Bundle::new(&bundle);
    let project = b.read_project().unwrap();
    println!("bundle {}", bundle.display());
    println!("duration {:.2}s, {}×{} @ {} fps, audio {:?}", project.duration, project.screen.pixel_width, project.screen.pixel_height, project.screen.fps, project.audio);
    println!("cursor: {} moves, {} clicks", b.read_cursor().moves.len(), b.read_cursor().clicks.len());
    // The pause left no gap: ~2 s of video.
    assert!((project.duration - 2.0).abs() < 0.25, "{}", project.duration);
    let _ = std::fs::remove_dir_all(&library);
    println!("ok");
}
