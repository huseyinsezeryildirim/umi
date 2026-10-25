//! The models Umi can use, where they come from and where they're kept.

use crate::AiError;
use serde::Serialize;
use std::io::{Read, Write};
use std::path::PathBuf;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Model {
    /// Whisper base, multilingual (MIT): captions, text-based editing, filler words.
    WhisperBase,
    /// Kokoro-82M (Apache-2.0), 8-bit ONNX: natural voiceover from text.
    Kokoro,
    /// Kokoro's voices (style vectors).
    KokoroVoices,
    /// MediaPipe selfie segmentation (Apache-2.0): camera background blur/removal.
    Segmentation,
    /// UltraFace RFB-320 face detector (MIT): face tracking for the camera.
    FaceDetection,
}

impl Model {
    pub const ALL: [Model; 5] = [Model::WhisperBase, Model::Kokoro, Model::KokoroVoices, Model::Segmentation, Model::FaceDetection];

    pub fn url(self) -> &'static str {
        match self {
            Model::WhisperBase => "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin",
            Model::Kokoro => "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/onnx/model_quantized.onnx",
            Model::KokoroVoices => "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/voices/af_heart.bin",
            Model::Segmentation => "https://huggingface.co/onnx-community/mediapipe_selfie_segmentation/resolve/main/onnx/model.onnx",
            Model::FaceDetection => "https://github.com/onnx/models/raw/main/validated/vision/body_analysis/ultraface/models/version-RFB-320.onnx",
        }
    }

    pub fn file_name(self) -> &'static str {
        match self {
            Model::WhisperBase => "ggml-base.bin",
            Model::Kokoro => "kokoro-82m-q8.onnx",
            Model::KokoroVoices => "kokoro-af_heart.bin",
            Model::Segmentation => "selfie-segmentation.onnx",
            Model::FaceDetection => "ultraface-rfb-320.onnx",
        }
    }

    /// What it's for, shown before downloading.
    pub fn purpose(self) -> &'static str {
        match self {
            Model::WhisperBase => "Captions and editing by text",
            Model::Kokoro | Model::KokoroVoices => "AI voiceover",
            Model::Segmentation => "Camera background blur and removal",
            Model::FaceDetection => "Face tracking for the camera",
        }
    }

    /// The models' folder: ~/Library/Application Support/Umi/Models (or the platform's equivalent).
    pub fn folder() -> PathBuf {
        dirs::data_dir().unwrap_or_else(std::env::temp_dir).join("Umi").join("Models")
    }

    pub fn path(self) -> PathBuf {
        Self::folder().join(self.file_name())
    }

    pub fn is_ready(self) -> bool {
        self.path().exists()
    }

    /// The model's file, downloading it first if needed. `progress` gets 0…1.
    pub fn ensure(self, progress: &dyn Fn(f64)) -> Result<PathBuf, AiError> {
        let path = self.path();
        if path.exists() {
            return Ok(path);
        }
        std::fs::create_dir_all(Self::folder())?;
        let mut response = ureq::get(self.url()).call().map_err(|e| AiError::Download(e.to_string()))?;
        let total: Option<u64> = response.headers().get("content-length").and_then(|v| v.to_str().ok()).and_then(|v| v.parse().ok());
        let partial = path.with_extension("part");
        let mut file = std::fs::File::create(&partial)?;
        let mut reader = response.body_mut().with_config().limit(2 * 1024 * 1024 * 1024).reader();
        let mut buffer = vec![0u8; 1 << 16];
        let mut done = 0u64;
        loop {
            let n = reader.read(&mut buffer).map_err(|e| AiError::Download(e.to_string()))?;
            if n == 0 {
                break;
            }
            file.write_all(&buffer[..n])?;
            done += n as u64;
            if let Some(total) = total {
                progress(done as f64 / total.max(1) as f64);
            }
        }
        file.sync_all()?;
        drop(file);
        if total.is_some_and(|t| t != done) {
            let _ = std::fs::remove_file(&partial);
            return Err(AiError::Download("incomplete download".into()));
        }
        std::fs::rename(&partial, &path)?;
        progress(1.0);
        Ok(path)
    }
}
