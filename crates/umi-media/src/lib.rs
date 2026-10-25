//! Media I/O for Umi on FFmpeg: decode (hardware accelerated), audio, encode, GIF,
//! thumbnails and waveforms. One implementation for macOS, Windows and Linux.

pub mod audio;
pub mod decode;
pub mod encode;
pub mod gif;
mod hw;

pub use audio::{AudioReader, AudioStream, CHANNELS, SAMPLE_RATE, audio_streams, waveform};
pub use decode::{ColorInfo, DecodedFrame, FrameFormat, VideoDecoder, VideoInfo, keyframe_thumbnails, thumbnail, to_rgba};
pub use encode::{Container, Encoder, EncoderSettings, VideoCodec};
pub use gif::GifWriter;

use ffmpeg_next as ff;
use std::path::{Path, PathBuf};
use std::sync::Once;

#[derive(Debug, thiserror::Error)]
pub enum MediaError {
    #[error("couldn't open {0}: {1}")]
    Open(PathBuf, ff::Error),
    #[error("{0} has no video")]
    NoVideo(PathBuf),
    #[error("{0} has no audio track {1}")]
    NoAudio(PathBuf, usize),
    #[error("no frame at {0:.2}s")]
    NoFrame(f64),
    #[error("no suitable encoder is available")]
    NoEncoder,
    #[error("media error: {0}")]
    Ffmpeg(#[from] ff::Error),
    #[error("couldn't write {0}: {1}")]
    Io(PathBuf, std::io::Error),
    #[error("GIF error: {0}")]
    Gif(String),
}

impl MediaError {
    fn open(path: &Path, e: ff::Error) -> Self {
        MediaError::Open(path.into(), e)
    }
}

/// Initializes FFmpeg once (quiet logs).
pub fn init() {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        let _ = ff::init();
        ff::util::log::set_level(ff::util::log::Level::Error);
    });
}

/// Length of a media file in seconds.
pub fn duration(path: &Path) -> Result<f64, MediaError> {
    init();
    let input = ff::format::input(path).map_err(|e| MediaError::open(path, e))?;
    Ok(input.duration().max(0) as f64 / ff::ffi::AV_TIME_BASE as f64)
}
