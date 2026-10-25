//! Cameras: listing and recording one (frames decoded to RGBA on a capture thread).

use crate::{CaptureError, Clock, Frame, VideoSink};
use nokhwa::Camera;
use nokhwa::pixel_format::RgbAFormat;
use nokhwa::utils::{ApiBackend, CameraIndex, FrameFormat, RequestedFormat, RequestedFormatType};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread::JoinHandle;

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CameraDevice {
    pub id: String,
    pub name: String,
}

/// On macOS the first use asks for permission; `done` gets whether it was granted.
pub fn request_access(done: impl Fn(bool) + Send + Sync + 'static) {
    #[cfg(target_os = "macos")]
    nokhwa::nokhwa_initialize(done);
    #[cfg(not(target_os = "macos"))]
    done(true);
}

pub fn has_access() -> bool {
    #[cfg(target_os = "macos")]
    return nokhwa::nokhwa_check();
    #[cfg(not(target_os = "macos"))]
    true
}

pub fn cameras() -> Vec<CameraDevice> {
    nokhwa::query(ApiBackend::Auto)
        .map(|list| list.into_iter().map(|c| CameraDevice { id: c.index().as_string(), name: c.human_name() }).collect())
        .unwrap_or_default()
}

/// A running camera; `stop` (or dropping) ends it.
pub struct CameraSession {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
    pub size: (u32, u32),
}

impl CameraSession {
    pub fn stop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

impl Drop for CameraSession {
    fn drop(&mut self) {
        self.stop();
    }
}

fn index_of(id: Option<&str>) -> CameraIndex {
    match id {
        Some(id) => id.parse::<u32>().map(CameraIndex::Index).unwrap_or_else(|_| CameraIndex::String(id.to_string())),
        None => CameraIndex::Index(0),
    }
}

/// Starts camera `id` (first if `None`) at its best frame rate; frames go to `sink`.
pub fn start(id: Option<&str>, clock: Clock, sink: Arc<dyn VideoSink>) -> Result<CameraSession, CaptureError> {
    let index = index_of(id);
    let (ready_tx, ready_rx) = crossbeam_channel::bounded::<Result<(u32, u32), CaptureError>>(1);
    let stop = Arc::new(AtomicBool::new(false));
    let flag = stop.clone();
    // The camera object lives on its own thread (some backends aren't Send).
    let thread = std::thread::Builder::new()
        .name("umi-camera".into())
        .spawn(move || {
            let format = RequestedFormat::new::<RgbAFormat>(RequestedFormatType::AbsoluteHighestFrameRate);
            let mut camera = match Camera::new(index, format) {
                Ok(c) => c,
                Err(e) => {
                    let text = e.to_string();
                    let _ = ready_tx.send(Err(if text.to_lowercase().contains("permission") || text.to_lowercase().contains("authoriz") {
                        CaptureError::CameraPermission
                    } else {
                        CaptureError::Other(text)
                    }));
                    return;
                }
            };
            if let Err(e) = camera.open_stream() {
                let _ = ready_tx.send(Err(CaptureError::Other(e.to_string())));
                return;
            }
            let res = {
                let r = camera.resolution();
                (r.width(), r.height())
            };
            let _ = ready_tx.send(Ok(res));
            while !flag.load(Ordering::Relaxed) {
                let Ok(buffer) = camera.frame() else { continue };
                let Some(t) = clock.now() else { continue };
                // MJPEG with the pure-Rust decoder; raw formats with nokhwa's converters.
                let image = if buffer.source_frame_format() == FrameFormat::MJPEG {
                    image::load_from_memory_with_format(buffer.buffer(), image::ImageFormat::Jpeg).ok().map(|i| i.to_rgba8())
                } else {
                    buffer.decode_image::<RgbAFormat>().ok().and_then(|i| image::RgbaImage::from_raw(i.width(), i.height(), i.into_raw()))
                };
                let Some(image) = image else { continue };
                let (w, h) = (image.width(), image.height());
                sink.frame(Frame::Rgba { width: w, height: h, data: image.as_raw(), stride: w as usize * 4 }, t);
            }
            let _ = camera.stop_stream();
        })
        .map_err(|e| CaptureError::Other(e.to_string()))?;
    let size = ready_rx.recv().map_err(|e| CaptureError::Other(e.to_string()))??;
    Ok(CameraSession { stop, thread: Some(thread), size })
}
