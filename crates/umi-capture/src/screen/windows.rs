//! Windows: Windows Graphics Capture (Windows 10 1903+). Frames arrive as BGRA. System
//! sound comes from WASAPI loopback (see `audio::start_loopback`). Positions are in pixels
//! here (scale 1), matching the pointer positions recorded on Windows.

// Window and monitor handles are raw pointers.
#![allow(unsafe_code)]

use super::{ScreenOptions, ScreenSession, fit};
use crate::{AudioSink, CaptureError, Clock, Display, Frame, Target, VideoSink, Window};
use std::sync::Arc;
use std::time::Duration;
use windows_capture::capture::{CaptureControl, Context, GraphicsCaptureApiHandler};
use windows_capture::frame::Frame as WinFrame;
use windows_capture::graphics_capture_api::InternalCaptureControl;
use windows_capture::monitor::Monitor;
use windows_capture::settings::{ColorFormat, CursorCaptureSettings, DirtyRegionSettings, DrawBorderSettings, MinimumUpdateIntervalSettings, SecondaryWindowSettings, Settings};
use windows_capture::window::Window as WinWindow;

fn err(e: impl std::fmt::Display) -> CaptureError {
    CaptureError::Other(e.to_string())
}

pub fn displays() -> Result<Vec<Display>, CaptureError> {
    let mut x = 0.0;
    Monitor::enumerate()
        .map_err(err)?
        .into_iter()
        .enumerate()
        .map(|(i, m)| {
            let (w, h) = (m.width().map_err(err)? as f64, m.height().map_err(err)? as f64);
            let d = Display { id: i as u32, name: if i == 0 { "Main display".into() } else { format!("Display {}", i + 1) }, width: w, height: h, scale: 1.0, x, y: 0.0 };
            x += w;
            Ok(d)
        })
        .collect()
}

pub fn windows() -> Result<Vec<Window>, CaptureError> {
    let own = std::process::id();
    Ok(WinWindow::enumerate()
        .map_err(err)?
        .into_iter()
        .filter(|w| w.is_valid() && w.process_id().is_ok_and(|p| p != own))
        .filter_map(|w| {
            let r = w.rect().ok()?;
            let (width, height) = ((r.right - r.left) as f64, (r.bottom - r.top) as f64);
            (width > 80.0 && height > 60.0).then(|| Window {
                id: w.as_raw_hwnd() as usize as u32,
                title: w.title().unwrap_or_default(),
                app: w.process_name().unwrap_or_default().trim_end_matches(".exe").to_string(),
                x: r.left as f64,
                y: r.top as f64,
                width,
                height,
            })
        })
        .collect())
}

struct Flags {
    clock: Clock,
    video: Arc<dyn VideoSink>,
    /// Part of the frame to keep (area recordings), in pixels.
    crop: Option<(u32, u32, u32, u32)>,
}

struct Handler {
    flags: Flags,
    scratch: Vec<u8>,
}

impl GraphicsCaptureApiHandler for Handler {
    type Flags = Flags;
    type Error = String;

    fn new(ctx: Context<Self::Flags>) -> Result<Self, Self::Error> {
        Ok(Self { flags: ctx.flags, scratch: Vec::new() })
    }

    fn on_frame_arrived(&mut self, frame: &mut WinFrame, _control: InternalCaptureControl) -> Result<(), Self::Error> {
        let Some(t) = self.flags.clock.now() else { return Ok(()) };
        let buffer = match self.flags.crop {
            Some((x, y, w, h)) => frame.buffer_crop(x, y, x + w, y + h),
            None => frame.buffer(),
        }
        .map_err(|e| e.to_string())?;
        let (width, height) = (buffer.width(), buffer.height());
        let data = buffer.as_nopadding_buffer(&mut self.scratch);
        self.flags.video.frame(Frame::Bgra { width, height, data, stride: width as usize * 4 }, t);
        Ok(())
    }
}

struct Session {
    control: Option<CaptureControl<Handler, String>>,
    _loopback: Option<crate::audio::MicSession>,
    size: (u32, u32),
}

impl ScreenSession for Session {
    fn stop(&mut self) -> Result<(), CaptureError> {
        if let Some(c) = self.control.take() {
            c.stop().map_err(err)?;
        }
        self._loopback = None;
        Ok(())
    }

    fn size(&self) -> (u32, u32) {
        self.size
    }
}

pub fn start(target: &Target, options: &ScreenOptions, clock: Clock, video: Arc<dyn VideoSink>, audio: Option<Arc<dyn AudioSink>>) -> Result<Box<dyn ScreenSession>, CaptureError> {
    let interval = MinimumUpdateIntervalSettings::Custom(Duration::from_secs_f64(1.0 / options.fps.max(1) as f64));
    let cursor = if options.show_cursor { CursorCaptureSettings::WithCursor } else { CursorCaptureSettings::WithoutCursor };
    let make = |crop| Flags { clock: clock.clone(), video: video.clone(), crop };
    let (control, size) = match target {
        Target::Display { id } | Target::Area { display: id, .. } => {
            let monitor = Monitor::from_index(*id as usize + 1).map_err(err)?;
            let crop = match target {
                Target::Area { x, y, width, height, .. } => Some((*x as u32, *y as u32, (*width as u32).max(2) & !1, (*height as u32).max(2) & !1)),
                _ => None,
            };
            let size = match crop {
                Some((_, _, w, h)) => (w, h),
                None => fit(monitor.width().map_err(err)? as f64, monitor.height().map_err(err)? as f64, 0),
            };
            let settings = Settings::new(monitor, cursor, DrawBorderSettings::WithoutBorder, SecondaryWindowSettings::Default, interval, DirtyRegionSettings::Default, ColorFormat::Bgra8, make(crop));
            (Handler::start_free_threaded(settings).map_err(err)?, size)
        }
        Target::Device { .. } => return Err(CaptureError::Unsupported),
        Target::Window { id } => {
            let window = WinWindow::from_raw_hwnd(*id as usize as *mut std::ffi::c_void);
            let size = fit(window.width().map_err(err)? as f64, window.height().map_err(err)? as f64, 0);
            let settings = Settings::new(window, cursor, DrawBorderSettings::WithoutBorder, SecondaryWindowSettings::Default, interval, DirtyRegionSettings::Default, ColorFormat::Bgra8, make(None));
            (Handler::start_free_threaded(settings).map_err(err)?, size)
        }
    };
    // The computer's sound: loopback of the default output.
    let loopback = match (options.system_audio, audio) {
        (true, Some(sink)) => crate::audio::start_loopback(clock, sink).ok(),
        _ => None,
    };
    Ok(Box::new(Session { control: Some(control), _loopback: loopback, size }))
}
