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
    /// Frame delay in hundredths of a second.
    delay: u16,
}

impl GifWriter {
    pub fn create(path: &Path, width: u32, height: u32, fps: f64) -> Result<Self, MediaError> {
        let file = File::create(path).map_err(|e| MediaError::Io(path.into(), e))?;
        let mut encoder =
            gif::Encoder::new(BufWriter::new(file), width as u16, height as u16, &[]).map_err(|e| MediaError::Gif(e.to_string()))?;
        encoder.set_repeat(gif::Repeat::Infinite).map_err(|e| MediaError::Gif(e.to_string()))?;
        Ok(Self { encoder, width: width as u16, height: height as u16, delay: (100.0 / fps.max(1.0)).round() as u16 })
    }

    /// Adds a frame (tightly packed RGBA8).
    pub fn push_rgba(&mut self, rgba: &[u8]) -> Result<(), MediaError> {
        let mut pixels = rgba.to_vec();
        // speed 10: good palettes at a fraction of the best-quality cost.
        let mut frame = gif::Frame::from_rgba_speed(self.width, self.height, &mut pixels, 10);
        frame.delay = self.delay;
        self.encoder.write_frame(&frame).map_err(|e| MediaError::Gif(e.to_string()))
    }
}
