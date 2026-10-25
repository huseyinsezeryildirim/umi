//! Records one of Umi's own windows for a few seconds (no other app's content).
//! cargo run -p umi-capture --example record_window -- <out.mov> [seconds]
use parking_lot::Mutex;
use std::sync::Arc;
use umi_capture::screen::{self, ScreenOptions};
use umi_capture::{Clock, Frame, Target, VideoSink};
use umi_media::{Pixels, StreamWriter, VideoCodec, WriterSettings};

struct Sink(Mutex<Option<StreamWriter>>, std::path::PathBuf, Mutex<u32>);

impl VideoSink for Sink {
    fn frame(&self, frame: Frame, t: f64) {
        let mut w = self.0.lock();
        let (fw, fh) = frame.size();
        let writer = w.get_or_insert_with(|| {
            StreamWriter::create(&self.1, &WriterSettings { width: fw, height: fh, fps: 60, codec: VideoCodec::H264, bit_rate: 0, audio_tracks: 0, fragmented: true, hardware: true }).unwrap()
        });
        *self.2.lock() += 1;
        let pixels = match frame {
            Frame::Nv12 { y, y_stride, uv, uv_stride, .. } => Pixels::Nv12 { y, y_stride, uv, uv_stride },
            Frame::Bgra { data, stride, .. } => Pixels::Bgra { data, stride },
            Frame::Rgba { data, stride, .. } => Pixels::Rgba { data, stride },
        };
        writer.push_video(pixels, t).unwrap();
    }
}

fn main() {
    let out = std::path::PathBuf::from(std::env::args().nth(1).expect("out.mov"));
    let seconds: f64 = std::env::args().nth(2).and_then(|s| s.parse().ok()).unwrap_or(2.0);
    // Only windows of our own app (Umi's dev build).
    let windows = screen::windows().unwrap();
    let ours = windows.iter().find(|w| w.app.to_lowercase().contains("umi")).expect("an Umi window must be open");
    println!("recording window {} “{}” of {} ({}×{} pt)", ours.id, ours.title, ours.app, ours.width, ours.height);
    let sink = Arc::new(Sink(Mutex::new(None), out.clone(), Mutex::new(0)));
    let clock = Clock::new();
    let options = ScreenOptions { fps: 60, system_audio: false, exclude_own_windows: false, ..Default::default() };
    let mut session = screen::start(&Target::Window { id: ours.id }, &options, clock, sink.clone(), None).unwrap();
    std::thread::sleep(std::time::Duration::from_secs_f64(seconds));
    session.stop().unwrap();
    std::thread::sleep(std::time::Duration::from_millis(200));
    let frames = *sink.2.lock();
    if let Some(writer) = sink.0.lock().take() {
        writer.finish().unwrap();
    }
    println!("{frames} frames, size {:?}, file {:.2}s", session.size(), umi_media::duration(&out).unwrap_or(0.0));
}
