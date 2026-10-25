//! macOS: ScreenCaptureKit. Frames arrive as NV12 (no conversion on our side); system
//! sound as 48 kHz float.

// Reading pixel planes of a locked CVPixelBuffer needs raw pointers.
#![allow(unsafe_code)]

use super::{ScreenOptions, ScreenSession, fit};
use crate::{AudioSink, CaptureError, Clock, Display, Frame, Target, VideoSink, Window};
use parking_lot::Mutex;
use screencapturekit::cm::{CMSampleBufferSCExt, SCFrameStatus};
use screencapturekit::cv::CVPixelBufferLockFlags;
use screencapturekit::prelude::*;
use std::sync::Arc;
use std::time::Instant;

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGDisplayCopyDisplayMode(display: u32) -> *mut std::ffi::c_void;
    fn CGDisplayModeGetPixelWidth(mode: *mut std::ffi::c_void) -> usize;
    fn CGDisplayModeGetWidth(mode: *mut std::ffi::c_void) -> usize;
    fn CGDisplayModeRelease(mode: *mut std::ffi::c_void);
}

/// Pixels per point of a display (2 on Retina screens).
fn pixel_scale(display: u32) -> f64 {
    // SAFETY: CoreGraphics returns a retained mode (or null), released here.
    unsafe {
        let mode = CGDisplayCopyDisplayMode(display);
        if mode.is_null() {
            return 2.0;
        }
        let k = CGDisplayModeGetPixelWidth(mode) as f64 / CGDisplayModeGetWidth(mode).max(1) as f64;
        CGDisplayModeRelease(mode);
        if k.is_finite() && k >= 1.0 { k } else { 1.0 }
    }
}

fn content() -> Result<SCShareableContent, CaptureError> {
    SCShareableContent::get().map_err(|e| {
        let text = e.to_string();
        if text.to_lowercase().contains("declined") || text.contains("-3801") || text.to_lowercase().contains("permission") {
            CaptureError::ScreenPermission
        } else {
            CaptureError::Other(text)
        }
    })
}

pub fn displays() -> Result<Vec<Display>, CaptureError> {
    Ok(content()?
        .displays()
        .iter()
        .enumerate()
        .map(|(i, d)| {
            let f = d.frame();
            Display {
                id: d.display_id(),
                name: if i == 0 { "Main display".into() } else { format!("Display {}", i + 1) },
                width: f.size.width,
                height: f.size.height,
                scale: pixel_scale(d.display_id()),
                x: f.origin.x,
                y: f.origin.y,
            }
        })
        .collect())
}

pub fn windows() -> Result<Vec<Window>, CaptureError> {
    let own = std::process::id() as i32;
    Ok(content()?
        .windows()
        .iter()
        .filter(|w| w.is_on_screen() && w.window_layer() == 0)
        .filter_map(|w| {
            let app = w.owning_application()?;
            if app.process_id() == own {
                return None;
            }
            let f = w.frame();
            (f.size.width > 80.0 && f.size.height > 60.0).then(|| Window {
                id: w.window_id(),
                title: w.title().unwrap_or_default(),
                app: app.application_name(),
                x: f.origin.x,
                y: f.origin.y,
                width: f.size.width,
                height: f.size.height,
            })
        })
        .collect())
}

/// Maps the stream's timestamps (host time) onto the recording clock: the first sample
/// anchors host time to `Instant`, so frames keep their exact spacing.
struct Timeline {
    clock: Clock,
    anchor: Mutex<Option<(f64, Instant)>>,
}

impl Timeline {
    fn time(&self, pts: Option<f64>) -> Option<f64> {
        let now = Instant::now();
        let Some(pts) = pts else { return self.clock.at(now) };
        let mut anchor = self.anchor.lock();
        let (p0, i0) = *anchor.get_or_insert((pts, now));
        let at = if pts >= p0 { i0 + std::time::Duration::from_secs_f64(pts - p0) } else { i0 };
        self.clock.at(at)
    }
}

struct Output {
    timeline: Arc<Timeline>,
    video: Arc<dyn VideoSink>,
    audio: Option<Arc<dyn AudioSink>>,
    scratch: Mutex<Vec<f32>>,
}

impl SCStreamOutputTrait for Output {
    fn did_output_sample_buffer(&self, sample: CMSampleBuffer, kind: SCStreamOutputType) {
        let pts = sample.presentation_timestamp().as_seconds();
        match kind {
            SCStreamOutputType::Screen => {
                // Idle/blank status buffers carry no new image.
                if !matches!(sample.frame_status(), Some(SCFrameStatus::Complete) | None) {
                    return;
                }
                let Some(buffer) = sample.pixel_buffer() else { return };
                let Ok(guard) = buffer.lock(CVPixelBufferLockFlags::READ_ONLY) else { return };
                let Some(t) = self.timeline.time(pts) else { return };
                let (w, h) = (guard.width() as u32, guard.height() as u32);
                if buffer.is_planar() && buffer.plane_count() >= 2 {
                    let (Some(y), Some(uv)) = (guard.base_address_of_plane(0), guard.base_address_of_plane(1)) else { return };
                    let (ys, uvs) = (guard.bytes_per_row_of_plane(0), guard.bytes_per_row_of_plane(1));
                    // SAFETY: the buffer stays locked while these slices live; sizes come
                    // from the buffer's own plane geometry.
                    let (y, uv) = unsafe { (std::slice::from_raw_parts(y, ys * guard.height_of_plane(0)), std::slice::from_raw_parts(uv, uvs * guard.height_of_plane(1))) };
                    self.video.frame(Frame::Nv12 { width: w, height: h, y, y_stride: ys, uv, uv_stride: uvs }, t);
                } else if let Some(data) = unsafe { guard.as_slice() } {
                    self.video.frame(Frame::Bgra { width: w, height: h, data, stride: guard.bytes_per_row() }, t);
                }
            }
            SCStreamOutputType::Audio => {
                let Some(sink) = &self.audio else { return };
                let Ok(list) = sample.audio_buffer_list() else { return };
                let Some(t) = self.timeline.time(pts) else { return };
                let buffers: Vec<&[u8]> = list.iter().map(|b| b.data()).collect();
                let mut out = self.scratch.lock();
                out.clear();
                interleave(&buffers, list.iter().next().map_or(1, |b| b.number_channels as usize), &mut out);
                sink.audio(&out, t);
            }
            _ => {}
        }
    }
}

/// Float32 audio, planar (one buffer per channel) or interleaved, → interleaved stereo.
fn interleave(buffers: &[&[u8]], channels_in_first: usize, out: &mut Vec<f32>) {
    let as_f32 = |b: &[u8]| -> Vec<f32> { b.chunks_exact(4).map(|c| f32::from_ne_bytes([c[0], c[1], c[2], c[3]])).collect() };
    match buffers {
        [one] if channels_in_first >= 2 => {
            let s = as_f32(one);
            for f in s.chunks_exact(channels_in_first) {
                out.extend([f[0], f[1]]);
            }
        }
        [one] => {
            for v in as_f32(one) {
                out.extend([v, v]);
            }
        }
        [l, r, ..] => {
            let (l, r) = (as_f32(l), as_f32(r));
            for (a, b) in l.iter().zip(&r) {
                out.extend([*a, *b]);
            }
        }
        [] => {}
    }
}

struct Session {
    stream: SCStream,
    size: (u32, u32),
    running: bool,
}

// SAFETY: SCStream is a reference to an Objective-C object whose methods are thread-safe;
// the session is used by one owner at a time.
unsafe impl Send for Session {}

impl ScreenSession for Session {
    fn stop(&mut self) -> Result<(), CaptureError> {
        if self.running {
            self.running = false;
            self.stream.stop_capture().map_err(|e| CaptureError::Other(e.to_string()))?;
        }
        Ok(())
    }

    fn size(&self) -> (u32, u32) {
        self.size
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}

pub fn start(target: &Target, options: &ScreenOptions, clock: Clock, video: Arc<dyn VideoSink>, audio: Option<Arc<dyn AudioSink>>) -> Result<Box<dyn ScreenSession>, CaptureError> {
    let content = content()?;
    let own = std::process::id() as i32;
    let own_windows: Vec<SCWindow> = if options.exclude_own_windows {
        content.windows().into_iter().filter(|w| w.owning_application().is_some_and(|a| a.process_id() == own)).collect()
    } else {
        vec![]
    };
    let own_refs: Vec<&SCWindow> = own_windows.iter().collect();
    let err = |e: SCError| CaptureError::Other(e.to_string());

    let (filter, points, scale, source) = match target {
        Target::Display { id } | Target::Area { display: id, .. } => {
            let display = content.displays().into_iter().find(|d| d.display_id() == *id).ok_or_else(|| CaptureError::NotFound("That display".into()))?;
            let f = display.frame();
            let scale = pixel_scale(*id);
            let filter = SCContentFilter::create().with_display(&display).with_excluding_windows(&own_refs).build().map_err(err)?;
            match target {
                Target::Area { x, y, width, height, .. } => (filter, (*width, *height), scale, Some(CGRect::new(*x, *y, *width, *height))),
                _ => (filter, (f.size.width, f.size.height), scale, None),
            }
        }
        Target::Device { .. } => return Err(CaptureError::Unsupported),
        Target::Window { id } => {
            let window = content.windows().into_iter().find(|w| w.window_id() == *id).ok_or_else(|| CaptureError::NotFound("That window".into()))?;
            let f = window.frame();
            let scale = content.displays().first().map_or(2.0, |d| pixel_scale(d.display_id()));
            let filter = SCContentFilter::create().with_window(&window).build().map_err(err)?;
            (filter, (f.size.width, f.size.height), scale, None)
        }
    };
    let size = fit(points.0 * scale, points.1 * scale, options.max_size);
    let mut config = SCStreamConfiguration::new()
        .with_width(size.0)
        .with_height(size.1)
        .with_pixel_format(PixelFormat::YCbCr_420v)
        .with_shows_cursor(options.show_cursor)
        .with_minimum_frame_interval(&CMTime::new(1, options.fps.max(1) as i32))
        .with_queue_depth(8)
        .with_captures_audio(options.system_audio)
        .with_sample_rate(48_000)
        .with_channel_count(2)
        .with_excludes_current_process_audio(true);
    if let Some(rect) = source {
        config = config.with_source_rect(rect);
    }

    let timeline = Arc::new(Timeline { clock, anchor: Mutex::new(None) });
    let mut stream = SCStream::new(&filter, &config).map_err(err)?;
    let output = |a| Output { timeline: timeline.clone(), video: video.clone(), audio: a, scratch: Mutex::new(Vec::new()) };
    stream.add_output_handler(output(None), SCStreamOutputType::Screen).map_err(err)?;
    if options.system_audio && audio.is_some() {
        stream.add_output_handler(output(audio.clone()), SCStreamOutputType::Audio).map_err(err)?;
    }
    stream.start_capture().map_err(err)?;
    Ok(Box::new(Session { stream, size, running: true }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn interleaves_planar_and_mono() {
        let l: Vec<u8> = [0.1f32, 0.2].iter().flat_map(|v| v.to_ne_bytes()).collect();
        let r: Vec<u8> = [0.3f32, 0.4].iter().flat_map(|v| v.to_ne_bytes()).collect();
        let mut out = vec![];
        interleave(&[&l, &r], 1, &mut out);
        assert_eq!(out, vec![0.1, 0.3, 0.2, 0.4]);
        out.clear();
        interleave(&[&l], 1, &mut out);
        assert_eq!(out, vec![0.1, 0.1, 0.2, 0.2]);
    }
}
