//! Voice clean-up for the microphone track: noise removal (RNNoise, a small neural network
//! that runs in real time on any CPU) and leveling (a gentle automatic gain).

use nnnoiseless::DenoiseState;

const FRAME: usize = DenoiseState::FRAME_SIZE;
const RATE: f32 = 48_000.0;

/// Processes a continuous mono stream in place; `reset` after a jump.
pub struct VoiceFilter {
    denoise: Option<Box<DenoiseState<'static>>>,
    /// Samples waiting for a full RNNoise frame, and processed ones not yet handed out.
    pending: Vec<f32>,
    ready: std::collections::VecDeque<f32>,
    level: Option<Leveler>,
}

impl VoiceFilter {
    pub fn new(denoise: bool, level: bool) -> Self {
        let mut f = Self { denoise: denoise.then(DenoiseState::new), pending: vec![], ready: Default::default(), level: level.then(Leveler::new) };
        f.prime();
        f
    }

    pub fn is_active(&self) -> bool {
        self.denoise.is_some() || self.level.is_some()
    }

    /// RNNoise works on 10 ms frames, so its output trails by one frame; starting with one
    /// frame of silence keeps the stream's length (and sync) exact.
    fn prime(&mut self) {
        if self.denoise.is_some() {
            self.ready.extend(std::iter::repeat_n(0.0, FRAME));
        }
    }

    pub fn reset(&mut self) {
        if self.denoise.is_some() {
            self.denoise = Some(DenoiseState::new());
        }
        self.pending.clear();
        self.ready.clear();
        if let Some(l) = &mut self.level {
            *l = Leveler::new();
        }
        self.prime();
    }

    /// Filters interleaved stereo `samples` (both sides get the cleaned mono voice).
    pub fn process(&mut self, samples: &mut [f32]) {
        let frames = samples.len() / 2;
        let mut mono: Vec<f32> = samples.chunks_exact(2).map(|s| (s[0] + s[1]) * 0.5).collect();
        if let Some(state) = &mut self.denoise {
            // RNNoise expects 16-bit sample values.
            self.pending.extend(mono.iter().map(|s| s * 32767.0));
            let mut out = [0f32; FRAME];
            let mut at = 0;
            while self.pending.len() - at >= FRAME {
                state.process_frame(&mut out, &self.pending[at..at + FRAME]);
                self.ready.extend(out.iter().map(|s| s / 32767.0));
                at += FRAME;
            }
            self.pending.drain(..at);
            for s in mono.iter_mut() {
                *s = self.ready.pop_front().unwrap_or(0.0);
            }
        }
        if let Some(level) = &mut self.level {
            level.process(&mut mono);
        }
        for (k, s) in mono.iter().enumerate().take(frames) {
            samples[2 * k] = *s;
            samples[2 * k + 1] = *s;
        }
    }
}

/// Brings speech toward a steady loudness: slow to raise, quick to lower, never boosting
/// silence (so room noise doesn't swell between sentences).
struct Leveler {
    envelope: f32,
    gain: f32,
}

impl Leveler {
    const TARGET: f32 = 0.12; // ≈ −18 dBFS RMS
    const MAX_GAIN: f32 = 4.0;
    const GATE: f32 = 0.01;

    fn new() -> Self {
        Self { envelope: 0.0, gain: 1.0 }
    }

    fn process(&mut self, x: &mut [f32]) {
        let env_attack = (-1.0 / (0.010 * RATE)).exp();
        let env_release = (-1.0 / (0.250 * RATE)).exp();
        let gain_up = (-1.0 / (0.800 * RATE)).exp();
        let gain_down = (-1.0 / (0.050 * RATE)).exp();
        for s in x.iter_mut() {
            let a = s.abs();
            let k = if a > self.envelope { env_attack } else { env_release };
            self.envelope = k * self.envelope + (1.0 - k) * a;
            // Peak-ish envelope → RMS-ish level (sine: peak·0.707).
            let level = self.envelope * 0.707;
            // In pauses the gain holds, so the next word starts at the right level.
            let want = if level > Self::GATE { (Self::TARGET / level).clamp(0.25, Self::MAX_GAIN) } else { self.gain };
            let k = if want < self.gain { gain_down } else { gain_up };
            self.gain = k * self.gain + (1.0 - k) * want;
            *s = (*s * self.gain).clamp(-1.0, 1.0);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rms(x: &[f32]) -> f32 {
        (x.iter().map(|s| s * s).sum::<f32>() / x.len().max(1) as f32).sqrt()
    }

    /// Stereo: a quiet "voice" (tone bursts) over steady noise.
    fn signal(seconds: f32, voice: f32, noise: f32) -> Vec<f32> {
        let n = (seconds * RATE) as usize;
        let mut seed = 1u32;
        let mut out = Vec::with_capacity(n * 2);
        for i in 0..n {
            seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            let white = (seed >> 9) as f32 / (1 << 23) as f32 * 2.0 - 1.0;
            let t = i as f32 / RATE;
            let on = (t % 1.0) < 0.6;
            let v = if on { (t * 220.0 * std::f32::consts::TAU).sin() * voice } else { 0.0 };
            let s = v + white * noise;
            out.extend([s, s]);
        }
        out
    }

    #[test]
    fn keeps_length_and_lowers_noise() {
        let mut x = signal(3.0, 0.0, 0.05);
        let before = rms(&x);
        let mut f = VoiceFilter::new(true, false);
        // Odd chunk sizes, like the mixer's.
        for chunk in x.chunks_mut(2 * 777) {
            f.process(chunk);
        }
        assert_eq!(x.len(), 2 * 3 * 48_000);
        // Plain white noise is the hardest case for RNNoise (it's trained on real rooms); it
        // still comes down steadily. Real speech in noise is checked in tests/voice.rs.
        let last = rms(&x[2 * 2 * 48_000..]);
        assert!(last < before * 0.7, "noise {before} → {last}");
    }

    #[test]
    fn leveling_raises_a_quiet_voice() {
        let mut x = signal(4.0, 0.03, 0.0);
        let mut f = VoiceFilter::new(false, true);
        for chunk in x.chunks_mut(2 * 1000) {
            f.process(chunk);
        }
        // Last burst, steady state.
        let burst = &x[2 * (3.1 * RATE) as usize..2 * (3.5 * RATE) as usize];
        assert!(rms(burst) > 0.08, "leveled {}", rms(burst));
    }
}
