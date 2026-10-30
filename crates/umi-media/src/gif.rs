//! Animated GIF output (exports and share previews): a palette per frame (NeuQuant),
//! infinite loop.

use crate::MediaError;
use std::fs::File;
use std::io::BufWriter;
use std::path::Path;

pub struct GifWriter {
    encoder: gif::Encoder<BufWriter<File>>,
    width: u16,
    height: u16,
    /// One frame's length in hundredths of a second (15 fps: 6.67).
    step: f64,
    /// Frames written and the hundredths given to them so far: delays are whole hundredths, so
    /// they alternate (6, 7, 7, …) to keep the GIF as long as the video.
    frames: u64,
    elapsed: u64,
}

impl GifWriter {
    pub fn create(path: &Path, width: u32, height: u32, fps: f64) -> Result<Self, MediaError> {
        let file = File::create(path).map_err(|e| MediaError::Io(path.into(), e))?;
        let mut encoder =
            gif::Encoder::new(BufWriter::new(file), width as u16, height as u16, &[]).map_err(|e| MediaError::Gif(e.to_string()))?;
        encoder.set_repeat(gif::Repeat::Infinite).map_err(|e| MediaError::Gif(e.to_string()))?;
        Ok(Self { encoder, width: width as u16, height: height as u16, step: 100.0 / fps.max(1.0), frames: 0, elapsed: 0 })
    }

    /// Adds a frame (tightly packed RGBA8).
    pub fn push_rgba(&mut self, rgba: &[u8]) -> Result<(), MediaError> {
        let mut pixels = rgba.to_vec();
        // speed 10: good palettes at a fraction of the best-quality cost.
        let mut frame = gif::Frame::from_rgba_speed(self.width, self.height, &mut pixels, 10);
        self.frames += 1;
        let end = (self.frames as f64 * self.step).round() as u64;
        frame.delay = end.saturating_sub(self.elapsed).max(1) as u16;
        self.elapsed += frame.delay as u64;
        self.encoder.write_frame(&frame).map_err(|e| MediaError::Gif(e.to_string()))
    }
}
