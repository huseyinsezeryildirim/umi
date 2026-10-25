//! Region tracking for privacy masks: a blur "sticks" to what's under it (a message, a
//! window, a face) as the screen scrolls and moves.
//!
//! Frames over the mask's span are decoded once into small luma images; the area at the
//! anchor time (where the user placed the mask) is then followed forward to the end and
//! backward to the start by template matching (zero-mean SSD, coarse-to-fine), with the
//! template adapting slowly so gradual changes don't lose the lock.

use std::path::Path;
use umi_media::{DecodedFrame, FrameFormat, MediaError, VideoDecoder};
use umi_project::Rect;
use umi_project::edit::MaskKeyframe;

/// Width of the analysis images in pixels.
const WORK_WIDTH: usize = 480;
/// Analysis rate (and keyframes per second written).
pub const TRACK_FPS: f64 = 30.0;

struct Gray {
    w: usize,
    h: usize,
    px: Vec<u8>,
}

impl Gray {
    /// The frame's luma, downscaled by sampling.
    fn from_frame(frame: &DecodedFrame) -> Gray {
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
        Gray { w, h, px }
    }
}

struct Patch {
    cols: usize,
    rows: usize,
    step: usize,
    values: Vec<f32>,
}

fn sample(img: &Gray, x: usize, y: usize, p: &Patch) -> Vec<f32> {
    let mut v = Vec::with_capacity(p.cols * p.rows);
    for r in 0..p.rows {
        for c in 0..p.cols {
            let (px, py) = ((x + c * p.step).min(img.w - 1), (y + r * p.step).min(img.h - 1));
            v.push(img.px[py * img.w + px] as f32);
        }
    }
    let mean = v.iter().sum::<f32>() / v.len().max(1) as f32;
    v.iter_mut().for_each(|q| *q -= mean);
    v
}

fn cost(img: &Gray, x: usize, y: usize, p: &Patch) -> f32 {
    sample(img, x, y, p).iter().zip(&p.values).map(|(a, b)| (a - b) * (a - b)).sum()
}

/// Follows a patch through `frames` (in order), starting at `(x, y)` in `frames[0]`.
/// Returns the top-left of the patch in every frame after the first.
fn follow(frames: &[&Gray], x: usize, y: usize, pw: usize, ph: usize) -> Vec<(usize, usize)> {
    let Some(first) = frames.first() else { return vec![] };
    let step = (pw.max(ph) / 32).max(1);
    let mut patch = Patch { cols: pw.div_ceil(step), rows: ph.div_ceil(step), step, values: vec![] };
    patch.values = sample(first, x, y, &patch);
    // Scrolling can move content a long way between frames: search a generous window.
    let radius = (pw.max(ph) as i64 * 3 / 4).max(first.h as i64 / 6) + 6;
    let (mut x, mut y) = (x as i64, y as i64);
    let mut out = Vec::with_capacity(frames.len());
    for img in &frames[1..] {
        let (max_x, max_y) = ((img.w - pw) as i64, (img.h - ph) as i64);
        let mut best = (x, y, f32::MAX);
        let scan = |cx: i64, cy: i64, r: i64, s: i64, best: &mut (i64, i64, f32)| {
            let mut dy = -r;
            while dy <= r {
                let mut dx = -r;
                while dx <= r {
                    let (nx, ny) = ((cx + dx).clamp(0, max_x), (cy + dy).clamp(0, max_y));
                    let c = cost(img, nx as usize, ny as usize, &patch);
                    if c < best.2 {
                        *best = (nx, ny, c);
                    }
                    dx += s;
                }
                dy += s;
            }
        };
        // Coarse (every 4 px), then refine around the best.
        scan(x, y, radius, 4, &mut best);
        let (bx, by) = (best.0, best.1);
        scan(bx, by, 4, 1, &mut best);
        x = best.0;
        y = best.1;
        let fresh = sample(img, x as usize, y as usize, &patch);
        for (v, f) in patch.values.iter_mut().zip(fresh) {
            *v = *v * 0.9 + f * 0.1;
        }
        out.push((x as usize, y as usize));
    }
    out
}

/// Follows `rect` (normalized to the recording, top-left origin), placed at recording time
/// `anchor`, across `start…end`. Returns keyframes at [`TRACK_FPS`]. `progress` gets 0…1.
pub fn track_region(screen: &Path, rect: Rect, anchor: f64, start: f64, end: f64, progress: &dyn Fn(f64)) -> Result<Vec<MaskKeyframe>, MediaError> {
    let mut decoder = VideoDecoder::open(screen, true)?;
    let count = ((end - start) * TRACK_FPS).ceil().max(1.0) as usize + 1;
    let mut frames: Vec<(f64, Gray)> = Vec::with_capacity(count);
    for k in 0..count {
        let t = (start + k as f64 / TRACK_FPS).min(end);
        let Some(frame) = decoder.frame_at(t)? else { break };
        frames.push((t, Gray::from_frame(&frame)));
        progress(0.7 * (k + 1) as f64 / count as f64);
    }
    let Some((_, first)) = frames.first() else { return Ok(vec![]) };
    let (iw, ih) = (first.w as f64, first.h as f64);
    let pw = ((rect.width() * iw).round() as usize).clamp(6, first.w);
    let ph = ((rect.height() * ih).round() as usize).clamp(6, first.h);
    let ax = ((rect.min_x() * iw).round() as usize).min(first.w - pw);
    let ay = ((rect.min_y() * ih).round() as usize).min(first.h - ph);
    let a = frames.iter().position(|(t, _)| *t >= anchor - 0.5 / TRACK_FPS).unwrap_or(0);

    let forward: Vec<&Gray> = frames[a..].iter().map(|(_, g)| g).collect();
    let backward: Vec<&Gray> = frames[..=a].iter().rev().map(|(_, g)| g).collect();
    let ahead = follow(&forward, ax, ay, pw, ph);
    progress(0.85);
    let behind = follow(&backward, ax, ay, pw, ph);
    progress(1.0);

    let key = |t: f64, x: usize, y: usize| MaskKeyframe { t, rect: Rect::new(x as f64 / iw, y as f64 / ih, rect.width(), rect.height()) };
    let mut keys: Vec<MaskKeyframe> = Vec::with_capacity(frames.len());
    for (i, (x, y)) in behind.iter().enumerate().rev() {
        keys.push(key(frames[a - 1 - i].0, *x, *y));
    }
    keys.push(MaskKeyframe { t: frames[a].0, rect });
    for (i, (x, y)) in ahead.iter().enumerate() {
        keys.push(key(frames[a + 1 + i].0, *x, *y));
    }
    Ok(keys)
}
