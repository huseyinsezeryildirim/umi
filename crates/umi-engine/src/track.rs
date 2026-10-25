//! Region tracking for privacy masks: decodes the mask's span into small luma images and
//! follows the area with [`umi_project::track`] (the same code the web app runs).

use std::path::Path;
use umi_media::{DecodedFrame, FrameFormat, MediaError, VideoDecoder};
use umi_project::Rect;
use umi_project::edit::MaskKeyframe;
use umi_project::track::{Gray, WORK_WIDTH, track_frames};

pub use umi_project::track::TRACK_FPS;

/// The frame's luma, downscaled by sampling.
fn gray(frame: &DecodedFrame) -> Gray {
    let (fw, fh) = (frame.width as usize, frame.height as usize);
    let w = WORK_WIDTH.min(fw);
    let h = (fh * w / fw).max(1);
    let mut px = vec![0u8; w * h];
    match frame.format {
        FrameFormat::Nv12 => {
            let (y, stride) = (&frame.planes[0], frame.strides[0] as usize);
            for r in 0..h {
                let sy = r * fh / h;
                for c in 0..w {
                    px[r * w + c] = y[sy * stride + c * fw / w];
                }
            }
        }
        FrameFormat::Rgba => {
            let (d, stride) = (&frame.planes[0], frame.strides[0] as usize);
            for r in 0..h {
                let sy = r * fh / h;
                for c in 0..w {
                    let i = sy * stride + (c * fw / w) * 4;
                    px[r * w + c] = ((77 * d[i] as u32 + 150 * d[i + 1] as u32 + 29 * d[i + 2] as u32) >> 8) as u8;
                }
            }
        }
    }
    Gray::new(w, h, px)
}

/// Follows `rect` (normalized to the recording, top-left origin), placed at recording time
/// `anchor`, across `start…end`. Returns keyframes at [`TRACK_FPS`]; rects may leave 0…1
/// when the content scrolls off screen. `progress` gets 0…1.
pub fn track_region(
    screen: &Path,
    rect: Rect,
    anchor: f64,
    start: f64,
    end: f64,
    progress: &dyn Fn(f64),
) -> Result<Vec<MaskKeyframe>, MediaError> {
    let mut decoder = VideoDecoder::open(screen, true)?;
    let count = ((end - start) * TRACK_FPS).ceil().max(1.0) as usize + 1;
    let mut frames: Vec<(f64, Gray)> = Vec::with_capacity(count);
    for k in 0..count {
        let t = (start + k as f64 / TRACK_FPS).min(end);
        let Some(frame) = decoder.frame_at(t)? else { break };
        frames.push((t, gray(&frame)));
        progress(0.6 * (k + 1) as f64 / count as f64);
    }
    let keys = track_frames(&frames, rect, anchor);
    progress(1.0);
    Ok(keys)
}
