//! Linux: xcap (X11 directly; Wayland through the desktop's screen-cast portal and
//! PipeWire). Frames arrive as RGBA. The computer's sound is the PulseAudio/PipeWire
//! "Monitor of …" source when present.

use super::{ScreenOptions, ScreenSession, fit};
use crate::{AudioSink, CaptureError, Clock, Display, Frame, Target, VideoSink, Window};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread::JoinHandle;

fn err(e: impl std::fmt::Display) -> CaptureError {
    CaptureError::Other(e.to_string())
}

pub fn displays() -> Result<Vec<Display>, CaptureError> {
    xcap::Monitor::all()
        .map_err(err)?
        .into_iter()
        .enumerate()
        .map(|(i, m)| {
            Ok(Display {
                id: m.id().map_err(err)?,
                name: if m.is_primary().unwrap_or(i == 0) {
                    "Main display".into()
                } else {
                    m.friendly_name().unwrap_or_else(|_| format!("Display {}", i + 1))
                },
                width: m.width().map_err(err)? as f64,
                height: m.height().map_err(err)? as f64,
                scale: 1.0,
                x: m.x().map_err(err)? as f64,
                y: m.y().map_err(err)? as f64,
            })
        })
        .collect()
}

pub fn windows() -> Result<Vec<Window>, CaptureError> {
    let own = std::process::id();
    Ok(xcap::Window::all()
        .map_err(err)?
        .into_iter()
        .filter(|w| w.pid().is_ok_and(|p| p != own) && !w.is_minimized().unwrap_or(false))
        .filter_map(|w| {
            let (width, height) = (w.width().ok()? as f64, w.height().ok()? as f64);
            (width > 80.0 && height > 60.0).then(|| Window {
                id: w.id().ok()?,
                title: w.title().unwrap_or_default(),
                app: w.app_name().unwrap_or_default(),
                x: w.x().unwrap_or(0) as f64,
                y: w.y().unwrap_or(0) as f64,
                width,
                height,
            })
        })
        .collect())
}

struct Session {
    recorder: Option<xcap::VideoRecorder>,
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
    _loopback: Option<crate::audio::MicSession>,
    size: (u32, u32),
}

impl ScreenSession for Session {
    fn stop(&mut self) -> Result<(), CaptureError> {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(r) = self.recorder.take() {
            r.stop().map_err(err)?;
        }
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
        self._loopback = None;
        Ok(())
    }

    fn size(&self) -> (u32, u32) {
        self.size
    }
}

pub fn start(
    target: &Target,
    options: &ScreenOptions,
    clock: Clock,
    video: Arc<dyn VideoSink>,
    audio: Option<Arc<dyn AudioSink>>,
) -> Result<Box<dyn ScreenSession>, CaptureError> {
    let display_id = match target {
        Target::Display { id } | Target::Area { display: id, .. } => *id,
        // Windows: the display they're on, cropped to the window.
        Target::Device { .. } => return Err(CaptureError::Unsupported),
        Target::Window { id } => xcap::Window::all()
            .map_err(err)?
            .into_iter()
            .find(|w| w.id().is_ok_and(|x| x == *id))
            .and_then(|w| w.current_monitor().ok())
            .and_then(|m| m.id().ok())
            .unwrap_or(0),
    };
    let monitor = xcap::Monitor::all()
        .map_err(err)?
        .into_iter()
        .find(|m| m.id().is_ok_and(|x| x == display_id))
        .ok_or_else(|| CaptureError::NotFound("That display".into()))?;
    let (mx, my) = (monitor.x().unwrap_or(0) as f64, monitor.y().unwrap_or(0) as f64);
    let crop: Option<(u32, u32, u32, u32)> = match target {
        Target::Area { x, y, width, height, .. } => Some((*x as u32, *y as u32, *width as u32, *height as u32)),
        Target::Window { .. } => {
            let ((x, y, w, h), _) = super::geometry(target)?;
            Some(((x - mx).max(0.0) as u32, (y - my).max(0.0) as u32, w as u32, h as u32))
        }
        Target::Display { .. } | Target::Device { .. } => None,
    };
    let size = match crop {
        Some((_, _, w, h)) => fit(w as f64, h as f64, options.max_size),
        None => fit(monitor.width().unwrap_or(1920) as f64, monitor.height().unwrap_or(1080) as f64, options.max_size),
    };
    let (recorder, frames) = monitor.video_recorder().map_err(err)?;
    recorder.start().map_err(err)?;
    let stop = Arc::new(AtomicBool::new(false));
    let flag = stop.clone();
    let thread = std::thread::Builder::new()
        .name("umi-screen".into())
        .spawn(move || {
            let mut cropped = Vec::new();
            while !flag.load(Ordering::Relaxed) {
                let Ok(frame) = frames.recv_timeout(std::time::Duration::from_millis(200)) else { continue };
                let Some(t) = clock.now() else { continue };
                let (w, h) = (frame.width, frame.height);
                match crop {
                    Some((x, y, cw, ch)) => {
                        let (cw, ch) = (cw.min(w.saturating_sub(x)) & !1, ch.min(h.saturating_sub(y)) & !1);
                        cropped.clear();
                        for row in y..y + ch {
                            let start = ((row * w + x) * 4) as usize;
                            cropped.extend_from_slice(&frame.raw[start..start + cw as usize * 4]);
                        }
                        video.frame(Frame::Rgba { width: cw, height: ch, data: &cropped, stride: cw as usize * 4 }, t);
                    }
                    None => video.frame(Frame::Rgba { width: w, height: h, data: &frame.raw, stride: w as usize * 4 }, t),
                }
            }
        })
        .map_err(err)?;
    let loopback = match (options.system_audio, audio) {
        (true, Some(sink)) => crate::audio::start_monitor_source(clock, sink).ok(),
        _ => None,
    };
    Ok(Box::new(Session { recorder: Some(recorder), stop, thread: Some(thread), _loopback: loopback, size }))
}
