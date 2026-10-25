//! Camera effects made once and saved next to the recording: the camera with its
//! background blurred (`camera-blur.mov`), the person's outline as a small grey video
//! (`camera-matte.mov`, white = person) for removing the background while playing, and the
//! face's path (`camera-face.json`) for keeping it framed.

use crate::AiError;
use crate::vision::{FaceDetector, MASK_SIZE, Segmenter};
use std::path::Path;
use umi_media::{Pixels, StreamWriter, VideoCodec, VideoDecoder, WriterSettings};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Background {
    Blur,
    Remove,
}

impl Background {
    pub fn file(self) -> &'static str {
        match self {
            Background::Blur => "camera-blur.mov",
            Background::Remove => "camera-matte.mov",
        }
    }
}

/// Bilinear sample of the 256×256 mask at normalized (u, v).
fn sample(mask: &[f32], u: f32, v: f32) -> f32 {
    let x = (u * MASK_SIZE as f32 - 0.5).clamp(0.0, MASK_SIZE as f32 - 1.001);
    let y = (v * MASK_SIZE as f32 - 0.5).clamp(0.0, MASK_SIZE as f32 - 1.001);
    let (x0, y0) = (x as usize, y as usize);
    let (fx, fy) = (x - x0 as f32, y - y0 as f32);
    let at = |x: usize, y: usize| mask[y * MASK_SIZE + x];
    let top = at(x0, y0) * (1.0 - fx) + at(x0 + 1, y0) * fx;
    let bottom = at(x0, y0 + 1) * (1.0 - fx) + at(x0 + 1, y0 + 1) * fx;
    top * (1.0 - fy) + bottom * fy
}

/// Soft edge: the model's 0…1 confidence pulled toward a clean cut.
fn feather(m: f32) -> f32 {
    let t = ((m - 0.3) / 0.4).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// A strong, cheap blur: shrink 8×, three box passes, sampled back up bilinearly.
fn blurred(rgba: &[u8], w: u32, h: u32) -> (Vec<f32>, usize, usize) {
    let (sw, sh) = ((w as usize / 8).max(1), (h as usize / 8).max(1));
    let mut small = vec![0f32; sw * sh * 3];
    for y in 0..sh {
        for x in 0..sw {
            let mut acc = [0f32; 3];
            for dy in 0..8 {
                for dx in 0..8 {
                    let i = (((y * 8 + dy).min(h as usize - 1)) * w as usize + (x * 8 + dx).min(w as usize - 1)) * 4;
                    for c in 0..3 {
                        acc[c] += rgba[i + c] as f32;
                    }
                }
            }
            for c in 0..3 {
                small[(y * sw + x) * 3 + c] = acc[c] / 64.0;
            }
        }
    }
    for _ in 0..3 {
        let src = small.clone();
        for y in 0..sh {
            for x in 0..sw {
                let mut acc = [0f32; 3];
                let mut n = 0.0;
                for dy in -2i32..=2 {
                    for dx in -2i32..=2 {
                        let (xx, yy) = ((x as i32 + dx).clamp(0, sw as i32 - 1) as usize, (y as i32 + dy).clamp(0, sh as i32 - 1) as usize);
                        for c in 0..3 {
                            acc[c] += src[(yy * sw + xx) * 3 + c];
                        }
                        n += 1.0;
                    }
                }
                for c in 0..3 {
                    small[(y * sw + x) * 3 + c] = acc[c] / n;
                }
            }
        }
    }
    (small, sw, sh)
}

fn sample_rgb(small: &[f32], sw: usize, sh: usize, u: f32, v: f32) -> [f32; 3] {
    let x = (u * sw as f32 - 0.5).clamp(0.0, sw as f32 - 1.001);
    let y = (v * sh as f32 - 0.5).clamp(0.0, sh as f32 - 1.001);
    let (x0, y0) = (x as usize, y as usize);
    let (fx, fy) = (x - x0 as f32, y - y0 as f32);
    let (x1, y1) = ((x0 + 1).min(sw - 1), (y0 + 1).min(sh - 1));
    let mut out = [0f32; 3];
    for c in 0..3 {
        let p = |x: usize, y: usize| small[(y * sw + x) * 3 + c];
        out[c] = (p(x0, y0) * (1.0 - fx) + p(x1, y0) * fx) * (1.0 - fy) + (p(x0, y1) * (1.0 - fx) + p(x1, y1) * fx) * fy;
    }
    out
}

/// Makes the processed camera video in `bundle`. `progress` gets 0…1.
pub fn process_background(bundle: &Path, mode: Background, progress: &dyn Fn(f64)) -> Result<(), AiError> {
    let source = bundle.join("camera.mov");
    let mut decoder = VideoDecoder::open(&source, true)?;
    let info = decoder.info();
    let mut seg = Segmenter::load(&|_| {})?;
    let temp = bundle.join(format!(".{}", mode.file()));
    let mut writer: Option<StreamWriter> = None;
    let mut smoothed: Option<Vec<f32>> = None;
    let mut out = Vec::new();
    while let Some(frame) = decoder.next()? {
        let (w, h, rgba) = umi_media::to_rgba(&frame, 1280)?;
        let mask = seg.mask(&rgba, w, h)?;
        // Steady edges: blend with the previous mask.
        let mask = match smoothed.take() {
            Some(prev) => prev.iter().zip(&mask).map(|(a, b)| a * 0.35 + b * 0.65).collect(),
            None => mask,
        };
        // Row length of the decoded image; the output drops an odd last column/row.
        let src_w = w;
        let (w, h) = (w & !1, h & !1);
        out.clear();
        out.reserve(w as usize * h as usize * 4);
        let blur = (mode == Background::Blur).then(|| blurred(&rgba, src_w, h));
        for y in 0..h {
            for x in 0..w {
                let i = ((y * src_w + x) * 4) as usize;
                let a = feather(sample(&mask, (x as f32 + 0.5) / w as f32, (y as f32 + 0.5) / h as f32));
                match &blur {
                    Some((small, sw, sh)) => {
                        let b = sample_rgb(small, *sw, *sh, (x as f32 + 0.5) / w as f32, (y as f32 + 0.5) / h as f32);
                        for c in 0..3 {
                            out.push((rgba[i + c] as f32 * a + b[c] * (1.0 - a)).round() as u8);
                        }
                        out.push(255);
                    }
                    None => {
                        let v = (a * 255.0).round() as u8;
                        out.extend([v, v, v, 255]);
                    }
                }
            }
        }
        smoothed = Some(mask);
        if writer.is_none() {
            writer = Some(StreamWriter::create(
                &temp,
                &WriterSettings {
                    width: w,
                    height: h,
                    fps: info.fps.round().max(1.0) as u32,
                    codec: VideoCodec::H264,
                    bit_rate: 0,
                    audio_tracks: 0,
                    fragmented: false,
                    hardware: true,
                },
            )?);
        }
        if let Some(wr) = writer.as_mut() {
            wr.push_video(Pixels::Rgba { data: &out, stride: w as usize * 4 }, frame.pts - info.start)?;
        }
        progress((frame.pts / info.duration.max(0.1)).min(0.99));
    }
    let writer = writer.ok_or_else(|| AiError::Model("the camera recording is empty".into()))?;
    writer.finish()?;
    std::fs::rename(&temp, bundle.join(mode.file()))?;
    progress(1.0);
    Ok(())
}

pub use umi_project::project::{FACE_FILE, FaceKey};

/// Finds the face 5 times a second and saves its smoothed path to `camera-face.json`.
pub fn track_face(bundle: &Path, progress: &dyn Fn(f64)) -> Result<Vec<FaceKey>, AiError> {
    let mut decoder = VideoDecoder::open(&bundle.join("camera.mov"), true)?;
    let info = decoder.info();
    let mut detector = FaceDetector::load(&|_| {})?;
    let mut keys: Vec<FaceKey> = Vec::new();
    let mut t = info.start;
    while t < info.start + info.duration {
        if let Some(frame) = decoder.frame_at(t)? {
            let (w, h, rgba) = umi_media::to_rgba(&frame, 640)?;
            if let Some(face) = detector.detect(&rgba, w, h)?.first() {
                let (cx, cy) = face.center();
                let raw = FaceKey { t: t - info.start, x: cx, y: cy, size: face.height };
                // Ease toward each detection so the framing glides instead of twitching.
                let key = match keys.last() {
                    Some(p) => FaceKey {
                        t: raw.t,
                        x: p.x + (raw.x - p.x) * 0.5,
                        y: p.y + (raw.y - p.y) * 0.5,
                        size: p.size + (raw.size - p.size) * 0.3,
                    },
                    None => raw,
                };
                keys.push(key);
            }
        }
        progress(((t - info.start) / info.duration.max(0.1)).min(0.99));
        t += 0.2;
    }
    std::fs::write(bundle.join(FACE_FILE), serde_json::to_vec(&keys).map_err(|e| AiError::Model(e.to_string()))?)?;
    progress(1.0);
    Ok(keys)
}
