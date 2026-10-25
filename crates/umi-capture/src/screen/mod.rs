//! Screen (and system sound) capture.

use crate::{AudioSink, CaptureError, Clock, Display, Target, VideoSink, Window};
use std::sync::Arc;

#[cfg(target_os = "macos")]
mod mac;
#[cfg(windows)]
mod windows;

#[derive(Debug, Clone)]
pub struct ScreenOptions {
    pub fps: u32,
    /// Longest side in pixels (0 = native).
    pub max_size: u32,
    /// Draw the system cursor into the video. Umi records it separately and draws its own.
    pub show_cursor: bool,
    /// Also capture the computer's sound (into `system_audio`).
    pub system_audio: bool,
    /// Our own windows (control bar, camera bubble) left out of the recording.
    pub exclude_own_windows: bool,
}

impl Default for ScreenOptions {
    fn default() -> Self {
        Self { fps: 60, max_size: 0, show_cursor: false, system_audio: true, exclude_own_windows: true }
    }
}

/// A running screen capture; dropping it stops capturing.
pub trait ScreenSession: Send {
    fn stop(&mut self) -> Result<(), CaptureError>;
    /// Pixel size of the frames being delivered.
    fn size(&self) -> (u32, u32);
}

pub fn displays() -> Result<Vec<Display>, CaptureError> {
    #[cfg(target_os = "macos")]
    return mac::displays();
    #[cfg(windows)]
    return windows::displays();
    #[allow(unreachable_code)]
    Err(CaptureError::Unsupported)
}

pub fn windows() -> Result<Vec<Window>, CaptureError> {
    #[cfg(target_os = "macos")]
    return mac::windows();
    #[cfg(windows)]
    return windows::windows();
    #[allow(unreachable_code)]
    Err(CaptureError::Unsupported)
}

/// Starts capturing `target`; frames go to `video`, system sound (if asked) to `audio`.
pub fn start(target: &Target, options: &ScreenOptions, clock: Clock, video: Arc<dyn VideoSink>, audio: Option<Arc<dyn AudioSink>>) -> Result<Box<dyn ScreenSession>, CaptureError> {
    #[cfg(target_os = "macos")]
    return mac::start(target, options, clock, video, audio);
    #[cfg(windows)]
    return windows::start(target, options, clock, video, audio);
    #[allow(unreachable_code)]
    {
        let _ = (target, options, clock, video, audio);
        Err(CaptureError::Unsupported)
    }
}

/// Output size for a source of `w`×`h` pixels capped at `max` on the long side (even
/// numbers, as encoders want).
pub fn fit(w: f64, h: f64, max: u32) -> (u32, u32) {
    let k = if max > 0 { (max as f64 / w.max(h)).min(1.0) } else { 1.0 };
    (((w * k).round() as u32).max(2) & !1, ((h * k).round() as u32).max(2) & !1)
}
