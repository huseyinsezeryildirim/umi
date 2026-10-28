//! Video sources for a project: the screen, the camera and every Media/Video 2 file, each
//! with its own decoder, opened on first use.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use umi_media::{DecodedFrame, FrameFormat, MediaError, VideoDecoder};
use umi_render::{PixelData, VideoFrame};

pub struct Sources {
    bundle: PathBuf,
    hardware: bool,
    decoders: HashMap<String, Option<VideoDecoder>>,
}

pub const SCREEN: &str = "screen.mov";
pub const CAMERA: &str = "camera.mov";

impl Sources {
    pub fn new(bundle: &Path, hardware: bool) -> Self {
        Self { bundle: bundle.to_path_buf(), hardware, decoders: HashMap::new() }
    }

    /// The decoder for a file in the bundle (`None` if it doesn't exist or can't open).
    fn decoder(&mut self, file: &str) -> Option<&mut VideoDecoder> {
        let bundle = &self.bundle;
        let hardware = self.hardware;
        self.decoders
            .entry(file.to_owned())
            .or_insert_with(|| {
                let path = bundle.join(file);
                path.exists().then(|| VideoDecoder::open(&path, hardware)).and_then(Result::ok)
            })
            .as_mut()
    }

    /// A second, independent decoder for the same file (Video 2 plays another part of the
    /// screen recording at the same time as the main video).
    fn alias(&mut self, file: &str, key: &str) -> Option<&mut VideoDecoder> {
        let path = self.bundle.join(file);
        let hardware = self.hardware;
        self.decoders.entry(key.to_owned()).or_insert_with(|| VideoDecoder::open(&path, hardware).ok()).as_mut()
    }

    pub fn frame(&mut self, file: &str, time: f64) -> Result<Option<Arc<DecodedFrame>>, MediaError> {
        match self.decoder(file) {
            Some(d) => d.frame_at(time),
            None => Ok(None),
        }
    }

    /// Like [`frame`](Self::frame) on a private decoder `key` (for overlays of the screen file).
    pub fn frame_aliased(&mut self, file: &str, key: &str, time: f64) -> Result<Option<Arc<DecodedFrame>>, MediaError> {
        match self.alias(file, key) {
            Some(d) => d.frame_at(time),
            None => Ok(None),
        }
    }

    /// Takes the decoder `key` (for `file`, opened first) out, to get it ready on another
    /// thread; [`put`](Self::put) gives it back. Meanwhile `key` would open a new one.
    pub fn take(&mut self, file: &str, key: &str) -> Option<VideoDecoder> {
        if key == file {
            self.decoder(file);
        } else {
            self.alias(file, key);
        }
        self.decoders.remove(key).flatten()
    }

    pub fn put(&mut self, key: &str, decoder: VideoDecoder) {
        self.decoders.insert(key.to_owned(), Some(decoder));
    }

    pub fn has(&mut self, file: &str) -> bool {
        self.decoder(file).is_some()
    }

    pub fn video_duration(&mut self, file: &str) -> Option<f64> {
        self.decoder(file).map(|d| d.info().duration)
    }
}

/// A decoded frame as the renderer's input.
pub fn as_video_frame(frame: &DecodedFrame) -> VideoFrame<'_> {
    let data = match frame.format {
        FrameFormat::Nv12 => PixelData::Nv12 {
            y: &frame.planes[0],
            y_stride: frame.strides[0],
            uv: &frame.planes[1],
            uv_stride: frame.strides[1],
            full_range: frame.color.full_range,
            bt709: frame.color.bt709,
        },
        FrameFormat::Rgba => PixelData::Rgba8 { data: &frame.planes[0], stride: frame.strides[0] },
    };
    VideoFrame { width: frame.width, height: frame.height, data }
}
