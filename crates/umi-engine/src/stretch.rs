//! Pitch-preserving time stretch (WSOLA) for sped-up / slowed-down clips, so voices keep
//! their pitch like AVFoundation's time-domain algorithm. Speed 1 passes straight through.

use umi_media::{AudioReader, CHANNELS, MediaError};

/// Analysis/synthesis window in frames (~21 ms at 48 kHz).
const WINDOW: usize = 1024;
const HOP: usize = WINDOW / 2;
/// How far around the nominal position to look for the best-matching segment.
const SEARCH: usize = 256;

pub struct TimeStretch {
    /// Input frames read but not yet consumed (interleaved stereo); `input[0]` is frame `base`.
    input: Vec<f32>,
    base: usize,
    /// Nominal analysis position (input frames since reset).
    position: f64,
    /// Start of the previously chosen segment (for the continuity target).
    previous: Option<usize>,
    /// Windowed second half of the previous segment, to overlap-add.
    tail: Vec<f32>,
    /// Finished output frames.
    ready: Vec<f32>,
    window: Vec<f32>,
    eof: bool,
}

impl Default for TimeStretch {
    fn default() -> Self {
        Self::new()
    }
}

impl TimeStretch {
    pub fn new() -> Self {
        let window = (0..WINDOW).map(|i| 0.5 - 0.5 * (std::f32::consts::TAU * i as f32 / WINDOW as f32).cos()).collect();
        Self { input: vec![], base: 0, position: 0.0, previous: None, tail: vec![0.0; HOP * CHANNELS], ready: vec![], window, eof: false }
    }

    pub fn reset(&mut self) {
        *self = Self::new();
    }

    /// Fills `out` from `reader` at `speed`. Returns how many input frames were consumed.
    pub fn process(&mut self, reader: &mut AudioReader, speed: f64, out: &mut [f32]) -> Result<usize, MediaError> {
        let frames = out.len() / CHANNELS;
        if (speed - 1.0).abs() < 1e-3 && self.ready.is_empty() && self.input.is_empty() {
            let n = reader.read(out)?;
            out[n..].fill(0.0);
            return Ok(n / CHANNELS);
        }
        while self.ready.len() < out.len() {
            if !self.step(reader, speed)? {
                break;
            }
        }
        let n = out.len().min(self.ready.len());
        out[..n].copy_from_slice(&self.ready[..n]);
        out[n..].fill(0.0);
        self.ready.drain(..n);
        Ok((frames as f64 * speed).round() as usize)
    }

    /// Makes HOP more output frames. Returns false at the end of the input.
    fn step(&mut self, reader: &mut AudioReader, speed: f64) -> Result<bool, MediaError> {
        let nominal = self.position as usize;
        let lo = nominal.saturating_sub(SEARCH).max(self.base);
        let needed_end = nominal + SEARCH + WINDOW;
        while self.base + self.input.len() / CHANNELS < needed_end && !self.eof {
            let mut chunk = vec![0f32; 4096 * CHANNELS];
            let n = reader.read(&mut chunk)?;
            if n == 0 {
                self.eof = true;
            }
            self.input.extend_from_slice(&chunk[..n]);
        }
        let available = self.base + self.input.len() / CHANNELS;
        if available < nominal + WINDOW {
            return Ok(false);
        }
        // Best segment start: the one that best continues the previous segment.
        let best = match self.previous {
            Some(prev) if prev + HOP + HOP <= available => {
                let target = prev + HOP;
                let hi = (nominal + SEARCH).min(available - WINDOW);
                let mut best = (lo, f32::MIN);
                let mut s = lo;
                while s <= hi {
                    let mut corr = 0.0f32;
                    // Every 4th frame is plenty for a match score.
                    for k in (0..HOP).step_by(4) {
                        let a = (target - self.base + k) * CHANNELS;
                        let b = (s - self.base + k) * CHANNELS;
                        corr += self.input[a] * self.input[b] + self.input[a + 1] * self.input[b + 1];
                    }
                    if corr > best.1 {
                        best = (s, corr);
                    }
                    s += 2;
                }
                best.0
            }
            _ => nominal.max(self.base),
        };
        // Overlap-add: first half joins the previous tail, second half becomes the new tail.
        let offset = (best - self.base) * CHANNELS;
        for k in 0..HOP {
            let w = self.window[k];
            for c in 0..CHANNELS {
                let v = self.input[offset + k * CHANNELS + c] * w + self.tail[k * CHANNELS + c];
                self.ready.push(v);
            }
        }
        for k in 0..HOP {
            let w = self.window[HOP + k];
            for c in 0..CHANNELS {
                self.tail[k * CHANNELS + c] = self.input[offset + (HOP + k) * CHANNELS + c] * w;
            }
        }
        self.previous = Some(best);
        self.position += HOP as f64 * speed;
        // Drop input we can't need again.
        let keep_from = (self.position as usize).saturating_sub(SEARCH + WINDOW).min(best);
        if keep_from > self.base {
            let drop = keep_from - self.base;
            self.input.drain(..drop * CHANNELS);
            self.base = keep_from;
        }
        Ok(true)
    }
}
