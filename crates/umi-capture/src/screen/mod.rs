//! Screen (and system sound) capture.

use crate::{AudioSink, CaptureError, Clock, Display, Target, VideoSink, Window};
use std::sync::Arc;

#[cfg(target_os = "linux")]
mod linux;
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
    #[cfg(target_os = "linux")]
    return linux::displays();
    #[allow(unreachable_code)]
    Err(CaptureError::Unsupported)
}

pub fn windows() -> Result<Vec<Window>, CaptureError> {
    #[cfg(target_os = "macos")]
    return mac::windows();
    #[cfg(windows)]
    return windows::windows();
    #[cfg(target_os = "linux")]
    return linux::windows();
    #[allow(unreachable_code)]
    Err(CaptureError::Unsupported)
}

/// Starts capturing `target`; frames go to `video`, system sound (if asked) to `audio`.
pub fn start(
    target: &Target,
    options: &ScreenOptions,
    clock: Clock,
    video: Arc<dyn VideoSink>,
    audio: Option<Arc<dyn AudioSink>>,
) -> Result<Box<dyn ScreenSession>, CaptureError> {
    #[cfg(target_os = "macos")]
    return mac::start(target, options, clock, video, audio);
    #[cfg(windows)]
    return windows::start(target, options, clock, video, audio);
    #[cfg(target_os = "linux")]
    return linux::start(target, options, clock, video, audio);
    #[allow(unreachable_code)]
    {
        let _ = (target, options, clock, video, audio);
        Err(CaptureError::Unsupported)
    }
}

/// Where a target is on screen (global points, top-left origin) and its pixels per point.
pub fn geometry(target: &Target) -> Result<((f64, f64, f64, f64), f64), CaptureError> {
    match target {
        Target::Display { id } => {
            let d = displays()?.into_iter().find(|d| d.id == *id).ok_or_else(|| CaptureError::NotFound("That display".into()))?;
            Ok(((d.x, d.y, d.width, d.height), d.scale))
        }
        Target::Area { display, x, y, width, height } => {
            let d = displays()?.into_iter().find(|d| d.id == *display).ok_or_else(|| CaptureError::NotFound("That display".into()))?;
            Ok(((d.x + x, d.y + y, *width, *height), d.scale))
        }
        Target::Window { id } => {
            let w = windows()?.into_iter().find(|w| w.id == *id).ok_or_else(|| CaptureError::NotFound("That window".into()))?;
            let scale = displays()?
                .into_iter()
                .find(|d| w.x >= d.x && w.x < d.x + d.width && w.y >= d.y && w.y < d.y + d.height)
                .map_or(2.0, |d| d.scale);
            Ok(((w.x, w.y, w.width, w.height), scale))
        }
        // Read by the recorder through FFmpeg; its size comes from the device.
        Target::Device { .. } => Err(CaptureError::Unsupported),
    }
}

/// Pixel size frames will have for `target`.
pub fn output_size(target: &Target, options: &ScreenOptions) -> Result<(u32, u32), CaptureError> {
    let ((_, _, w, h), scale) = geometry(target)?;
    Ok(fit(w * scale, h * scale, options.max_size))
}

/// Output size for a source of `w`×`h` pixels capped at `max` on the long side (even
/// numbers, as encoders want).
pub fn fit(w: f64, h: f64, max: u32) -> (u32, u32) {
    let k = if max > 0 { (max as f64 / w.max(h)).min(1.0) } else { 1.0 };
    (((w * k).round() as u32).max(2) & !1, ((h * k).round() as u32).max(2) & !1)
}
