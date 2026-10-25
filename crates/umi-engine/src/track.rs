//! Region tracking for privacy masks: a blur "sticks" to what's under it (a message, a
//! window, a face) as the screen scrolls and moves.
//!
//! Frames over the mask's span are decoded once into small luma images. From the anchor
//! (where the user placed the mask) the area is followed forward and backward:
//!
//! 1. **Motion**: a wide context around the mask (more texture, so fast scrolls still lock)
//!    is matched over a large window to find how the content moved.
//! 2. **Refine**: the mask's own patch is matched in a small window around that prediction.
//!
//! Positions may leave the image: content scrolled off screen takes the mask with it, and
//! partly visible patches are compared on their visible part only (no jumping to a
//! look-alike when the real content is gone).

use std::path::Path;
use umi_media::{DecodedFrame, FrameFormat, MediaError, VideoDecoder};
use umi_project::Rect;
use umi_project::edit::MaskKeyframe;

/// Width of the analysis images in pixels.
const WORK_WIDTH: usize = 480;
/// Analysis rate (and keyframes per second written).
pub const TRACK_FPS: f64 = 30.0;
/// Samples per side of a matched patch (patches are subsampled to about this size).
const SAMPLES: usize = 28;

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

    fn at(&self, x: i64, y: i64) -> Option<f32> {
        (x >= 0 && y >= 0 && (x as usize) < self.w && (y as usize) < self.h).then(|| self.px[y as usize * self.w + x as usize] as f32)
    }
}

/// A subsampled patch: `cols × rows` samples spread over its size, with a validity flag per
/// sample (off-image samples are skipped when comparing).
#[derive(Clone)]
struct Patch {
    cols: usize,
    rows: usize,
    sx: f64,
    sy: f64,
    values: Vec<f32>,
    valid: Vec<bool>,
}

impl Patch {
    fn new(w: i64, h: i64) -> Patch {
        let cols = SAMPLES.min(w.max(1) as usize);
        let rows = SAMPLES.min(h.max(1) as usize);
        Patch { cols, rows, sx: w as f64 / cols as f64, sy: h as f64 / rows as f64, values: vec![], valid: vec![] }
    }

    /// Samples the patch with its top-left at (x, y); returns values (mean removed over the
    /// valid ones) and validity.
    fn sample(&self, img: &Gray, x: i64, y: i64) -> (Vec<f32>, Vec<bool>) {
        let mut v = Vec::with_capacity(self.cols * self.rows);
        let mut ok = Vec::with_capacity(self.cols * self.rows);
        for r in 0..self.rows {
            for c in 0..self.cols {
                let px = x + (c as f64 * self.sx) as i64;
                let py = y + (r as f64 * self.sy) as i64;
                match img.at(px, py) {
                    Some(p) => {
                        v.push(p);
                        ok.push(true);
                    }
                    None => {
                        v.push(0.0);
                        ok.push(false);
                    }
                }
            }
        }
        let n = ok.iter().filter(|b| **b).count().max(1) as f32;
        let mean = v.iter().zip(&ok).filter(|(_, b)| **b).map(|(p, _)| *p).sum::<f32>() / n;
        for (p, b) in v.iter_mut().zip(&ok) {
            if *b {
                *p -= mean;
            }
        }
        (v, ok)
    }

    fn grab(&mut self, img: &Gray, x: i64, y: i64) {
        let (v, ok) = self.sample(img, x, y);
        self.values = v;
        self.valid = ok;
    }

    /// Mean squared difference over samples valid in both, raised when little overlaps
    /// (a sliver at the image edge matches anything); `None` under 30 % overlap.
    fn cost(&self, img: &Gray, x: i64, y: i64) -> Option<f32> {
        let (v, ok) = self.sample(img, x, y);
        let mut sum = 0.0;
        let mut n = 0usize;
        for i in 0..v.len() {
            if ok[i] && self.valid[i] {
                let d = v[i] - self.values[i];
                sum += d * d;
                n += 1;
            }
        }
        let cover = n as f32 / v.len() as f32;
        (cover >= 0.3).then(|| sum / n as f32 / cover)
    }

    /// Best position around (cx, cy) within ±(rx, ry), testing every `s` px. Far moves
    /// cost more (`reach` px doubles the cost), so a look-alike elsewhere on the page (a
    /// grid of thumbnails, repeated rows) loses to the nearby true match.
    fn search(&self, img: &Gray, cx: i64, cy: i64, rx: i64, ry: i64, s: i64, reach: f32) -> Option<(i64, i64, f32)> {
        let mut best: Option<(i64, i64, f32)> = None;
        let mut dy = -ry;
        while dy <= ry {
            let mut dx = -rx;
            while dx <= rx {
                if let Some(c) = self.cost(img, cx + dx, cy + dy) {
                    let d2 = (dx * dx + dy * dy) as f32 / (reach * reach);
                    let c = (c + 1.0) * (1.0 + d2);
                    if best.is_none_or(|b| c < b.2) {
                        best = Some((cx + dx, cy + dy, c));
                    }
                }
                dx += s;
            }
            dy += s;
        }
        best
    }
}

/// Follows the patch at (x, y) (size pw×ph) through `frames`; returns its top-left in every
/// frame after the first.
fn follow(frames: &[&Gray], x: i64, y: i64, pw: i64, ph: i64) -> Vec<(i64, i64)> {
    let Some(first) = frames.first() else { return vec![] };
    let (iw, ih) = (first.w as i64, first.h as i64);
    // Context: the mask plus a generous margin, for motion (more texture than the mask).
    let margin_x = pw.max(iw / 8);
    let margin_y = ph.max(ih / 8);
    let mut context = Patch::new(pw + 2 * margin_x, ph + 2 * margin_y);
    context.grab(first, x - margin_x, y - margin_y);
    let mut patch = Patch::new(pw, ph);
    patch.grab(first, x, y);

    let (mut x, mut y) = (x, y);
    let (mut vx, mut vy) = (0i64, 0i64);
    let mut out = Vec::with_capacity(frames.len());
    for img in &frames[1..] {
        // 1. Motion of the surroundings, searched widely (fast scrolls), starting from the
        //    previous velocity.
        let (px, py) = (x + vx, y + vy);
        let coarse = context.search(img, px - margin_x, py - margin_y, iw / 4, ih / 2, 4, ih as f32 / 3.0);
        let (mx, my) = match coarse {
            Some((cx, cy, _)) => match context.search(img, cx, cy, 4, 4, 1, f32::INFINITY) {
                Some((fx, fy, _)) => (fx + margin_x, fy + margin_y),
                None => (cx + margin_x, cy + margin_y),
            },
            None => (px, py),
        };
        // 2. Refine on the mask's own content near the prediction (when enough is visible).
        let (nx, ny) = match patch.search(img, mx, my, 6, 6, 1, f32::INFINITY) {
            Some((fx, fy, _)) => (fx, fy),
            None => (mx, my),
        };
        vx = nx - x;
        vy = ny - y;
        x = nx;
        y = ny;
        // Adapt slowly to gradual changes (hover effects, video thumbnails playing).
        let mut fresh = context.clone();
        fresh.grab(img, x - margin_x, y - margin_y);
        blend(&mut context, &fresh);
        let mut fresh = patch.clone();
        fresh.grab(img, x, y);
        blend(&mut patch, &fresh);
        out.push((x, y));
    }
    out
}

fn blend(into: &mut Patch, fresh: &Patch) {
    for i in 0..into.values.len() {
        if fresh.valid[i] {
            into.values[i] = if into.valid[i] { into.values[i] * 0.85 + fresh.values[i] * 0.15 } else { fresh.values[i] };
            into.valid[i] = true;
        }
    }
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
        frames.push((t, Gray::from_frame(&frame)));
        progress(0.6 * (k + 1) as f64 / count as f64);
    }
    let Some((_, first)) = frames.first() else { return Ok(vec![]) };
    let (iw, ih) = (first.w as f64, first.h as f64);
    let pw = ((rect.width() * iw).round() as i64).max(4);
    let ph = ((rect.height() * ih).round() as i64).max(4);
    let ax = (rect.min_x() * iw).round() as i64;
    let ay = (rect.min_y() * ih).round() as i64;
    let a = frames.iter().position(|(t, _)| *t >= anchor - 0.5 / TRACK_FPS).unwrap_or(0);

    let forward: Vec<&Gray> = frames[a..].iter().map(|(_, g)| g).collect();
    let backward: Vec<&Gray> = frames[..=a].iter().rev().map(|(_, g)| g).collect();
    let ahead = follow(&forward, ax, ay, pw, ph);
    progress(0.8);
    let behind = follow(&backward, ax, ay, pw, ph);
    progress(1.0);

    let key = |t: f64, x: i64, y: i64| MaskKeyframe { t, rect: Rect::new(x as f64 / iw, y as f64 / ih, rect.width(), rect.height()) };
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
