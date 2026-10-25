//! Seeing the camera: where the person is (segmentation, for background blur/removal) and
//! where their face is (for keeping it framed). Both run on small images, quickly.

use crate::AiError;
use crate::models::Model;
use ort::session::Session;
use ort::value::Tensor;

/// Resamples RGBA to `w`×`h` planar RGB floats (nearest-ish box sampling; fine for models).
fn planar_rgb(rgba: &[u8], sw: u32, sh: u32, w: usize, h: usize, map: impl Fn(u8) -> f32) -> Vec<f32> {
    let mut out = vec![0f32; 3 * w * h];
    for y in 0..h {
        let sy = (y * sh as usize / h).min(sh as usize - 1);
        for x in 0..w {
            let sx = (x * sw as usize / w).min(sw as usize - 1);
            let i = (sy * sw as usize + sx) * 4;
            for c in 0..3 {
                out[c * w * h + y * w + x] = map(rgba[i + c]);
            }
        }
    }
    out
}

/// Person segmentation (MediaPipe selfie): a 256×256 mask, 1 = person.
pub struct Segmenter {
    session: Session,
}

pub const MASK_SIZE: usize = 256;

impl Segmenter {
    pub fn load(progress: &dyn Fn(f64)) -> Result<Self, AiError> {
        Ok(Self { session: crate::onnx::session(&Model::Segmentation.ensure(progress)?)? })
    }

    pub fn mask(&mut self, rgba: &[u8], width: u32, height: u32) -> Result<Vec<f32>, AiError> {
        let input = planar_rgb(rgba, width, height, MASK_SIZE, MASK_SIZE, |v| v as f32 / 255.0);
        let err = |e: ort::Error| AiError::Model(e.to_string());
        let outputs = self.session.run(ort::inputs!["pixel_values" => Tensor::from_array(([1usize, 3, MASK_SIZE, MASK_SIZE], input)).map_err(err)?]).map_err(err)?;
        let (_, data) = outputs[0].try_extract_tensor::<f32>().map_err(err)?;
        Ok(data.to_vec())
    }
}

/// A face, normalized to the frame (top-left origin).
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Face {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub score: f32,
}

impl Face {
    pub fn center(&self) -> (f64, f64) {
        (self.x + self.width / 2.0, self.y + self.height / 2.0)
    }
}

/// Face detector (UltraFace RFB-320).
pub struct FaceDetector {
    session: Session,
}

impl FaceDetector {
    pub fn load(progress: &dyn Fn(f64)) -> Result<Self, AiError> {
        Ok(Self { session: crate::onnx::session(&Model::FaceDetection.ensure(progress)?)? })
    }

    /// Faces above 70 % confidence, biggest first.
    pub fn detect(&mut self, rgba: &[u8], width: u32, height: u32) -> Result<Vec<Face>, AiError> {
        let input = planar_rgb(rgba, width, height, 320, 240, |v| (v as f32 - 127.0) / 128.0);
        let err = |e: ort::Error| AiError::Model(e.to_string());
        let outputs = self.session.run(ort::inputs!["input" => Tensor::from_array(([1usize, 3, 240, 320], input)).map_err(err)?]).map_err(err)?;
        let (_, scores) = outputs[0].try_extract_tensor::<f32>().map_err(err)?;
        let (_, boxes) = outputs[1].try_extract_tensor::<f32>().map_err(err)?;
        let mut faces: Vec<Face> = scores
            .chunks_exact(2)
            .zip(boxes.chunks_exact(4))
            .filter(|(s, _)| s[1] > 0.7)
            .map(|(s, b)| Face { x: b[0] as f64, y: b[1] as f64, width: (b[2] - b[0]) as f64, height: (b[3] - b[1]) as f64, score: s[1] })
            .collect();
        faces.sort_by(|a, b| b.score.total_cmp(&a.score));
        // Non-maximum suppression.
        let mut kept: Vec<Face> = Vec::new();
        for f in faces {
            if kept.iter().all(|k| iou(k, &f) < 0.3) {
                kept.push(f);
            }
        }
        kept.sort_by(|a, b| (b.width * b.height).total_cmp(&(a.width * a.height)));
        Ok(kept)
    }
}

fn iou(a: &Face, b: &Face) -> f64 {
    let x0 = a.x.max(b.x);
    let y0 = a.y.max(b.y);
    let x1 = (a.x + a.width).min(b.x + b.width);
    let y1 = (a.y + a.height).min(b.y + b.height);
    let inter = (x1 - x0).max(0.0) * (y1 - y0).max(0.0);
    inter / (a.width * a.height + b.width * b.height - inter).max(1e-9)
}
