//! Region tracking for privacy masks: follow a patch of the screen from frame to frame so
//! a blur stays on a moving window, a scrolling message or a face.
//!
//! Template matching on a downscaled luma image: each frame searches around the last
//! position for the best zero-mean match, refining coarse-to-fine, and the template slowly
//! adapts so gradual changes don't lose the lock.

use std::path::Path;
use umi_media::{DecodedFrame, FrameFormat, MediaError, VideoDecoder};
use umi_project::Rect;
use umi_project::edit::MaskKeyframe;

/// Width of the analysis image in pixels.
const WORK_WIDTH: usize = 640;
/// Keyframes per second written for the tracked path.
pub const TRACK_FPS: f64 = 15.0;

struct Gray {
    w: usize,
    h: usize,
    px: Vec<f32>,
}

impl Gray {
    /// The frame's luma, downscaled to `WORK_WIDTH` by sampling.
    fn from_frame(frame: &DecodedFrame) -> Gray {
        let (fw, fh) = (frame.width as usize, frame.height as usize);
        let w = WORK_WIDTH.min(fw);
        let h = (fh * w / fw).max(1);
        let mut px = vec![0f32; w * h];
        match frame.format {
            FrameFormat::Nv12 => {
                let (y, stride) = (&frame.planes[0], frame.strides[0] as usize);
                for r in 0..h {
                    let sy = r * fh / h;
                    for c in 0..w {
                        px[r * w + c] = y[sy * stride + c * fw / w] as f32;
                    }
                }
            }
            FrameFormat::Rgba => {
                let (d, stride) = (&frame.planes[0], frame.strides[0] as usize);
                for r in 0..h {
                    let sy = r * fh / h;
                    for c in 0..w {
                        let i = sy * stride + (c * fw / w) * 4;
                        px[r * w + c] = 0.299 * d[i] as f32 + 0.587 * d[i + 1] as f32 + 0.114 * d[i + 2] as f32;
                    }
                }
            }
        }
        Gray { w, h, px }
    }
}

/// A sampled patch (every `step` pixels) with its mean removed.
struct Template {
    cols: usize,
    rows: usize,
    step: usize,
    values: Vec<f32>,
}

impl Template {
    fn sample(img: &Gray, x: usize, y: usize, cols: usize, rows: usize, step: usize) -> Vec<f32> {
        let mut v = Vec::with_capacity(cols * rows);
        for r in 0..rows {
            for c in 0..cols {
                let (px, py) = ((x + c * step).min(img.w - 1), (y + r * step).min(img.h - 1));
                v.push(img.px[py * img.w + px]);
            }
        }
        let mean = v.iter().sum::<f32>() / v.len().max(1) as f32;
        v.iter_mut().for_each(|p| *p -= mean);
        v
    }

    /// Sum of squared differences against the patch at (x, y): lower is better.
    fn cost(&self, img: &Gray, x: usize, y: usize) -> f32 {
        let candidate = Template::sample(img, x, y, self.cols, self.rows, self.step);
        candidate.iter().zip(&self.values).map(|(a, b)| (a - b) * (a - b)).sum()
    }
}

/// Follows `rect` (normalized to the screen recording, top-left origin) from `start` to
/// `end` (recording seconds). Returns keyframes at [`TRACK_FPS`]. `progress` gets 0…1.
pub fn track_region(screen: &Path, rect: Rect, start: f64, end: f64, progress: &dyn Fn(f64)) -> Result<Vec<MaskKeyframe>, MediaError> {
    let mut decoder = VideoDecoder::open(screen, true)?;
    let Some(first) = decoder.frame_at(start)? else { return Ok(vec![]) };
    let img = Gray::from_frame(&first);
    let (iw, ih) = (img.w as f64, img.h as f64);
    // Patch in analysis pixels.
    let pw = ((rect.width() * iw).round() as usize).clamp(8, img.w);
    let ph = ((rect.height() * ih).round() as usize).clamp(8, img.h);
    let step = (pw.max(ph) / 40).max(1);
    let (cols, rows) = (pw.div_ceil(step), ph.div_ceil(step));
    let mut x = ((rect.min_x() * iw).round() as usize).min(img.w - pw);
    let mut y = ((rect.min_y() * ih).round() as usize).min(img.h - ph);
    let mut template = Template { cols, rows, step, values: Template::sample(&img, x, y, cols, rows, step) };
    let radius = (pw.max(ph) * 3 / 4 + 8) as i64;

    let mut keys = vec![MaskKeyframe { t: start, rect }];
    let count = ((end - start) * TRACK_FPS).ceil().max(1.0) as usize;
    for k in 1..=count {
        let t = (start + k as f64 / TRACK_FPS).min(end);
        let Some(frame) = decoder.frame_at(t)? else { break };
        let img = Gray::from_frame(&frame);
        let max_x = (img.w - pw) as i64;
        let max_y = (img.h - ph) as i64;
        // Coarse search on a 3 px grid, then refine around the best within ±3.
        let mut best = (x as i64, y as i64, f32::MAX);
        let scan = |cx: i64, cy: i64, r: i64, s: i64, best: &mut (i64, i64, f32)| {
            let mut dy = -r;
            while dy <= r {
                let mut dx = -r;
                while dx <= r {
                    let (nx, ny) = ((cx + dx).clamp(0, max_x), (cy + dy).clamp(0, max_y));
                    let c = template.cost(&img, nx as usize, ny as usize);
                    if c < best.2 {
                        *best = (nx, ny, c);
                    }
                    dx += s;
                }
                dy += s;
            }
        };
        scan(x as i64, y as i64, radius, 3, &mut best);
        let (bx, by) = (best.0, best.1);
        scan(bx, by, 3, 1, &mut best);
        x = best.0 as usize;
        y = best.1 as usize;
        // Adapt slowly to gradual changes (scrolling content, lighting).
        let fresh = Template::sample(&img, x, y, cols, rows, step);
        for (v, f) in template.values.iter_mut().zip(fresh) {
            *v = *v * 0.9 + f * 0.1;
        }
        keys.push(MaskKeyframe { t, rect: Rect::new(x as f64 / iw, y as f64 / ih, rect.width(), rect.height()) });
        progress(k as f64 / count as f64);
        if t >= end {
            break;
        }
    }
    Ok(keys)
}
