//! Microphones: listing them and recording one as 48 kHz stereo, whatever the device's own
//! rate and channel count. Also a live level for the meter.

use crate::{AudioSink, CaptureError, Clock};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use parking_lot::Mutex;
use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Microphone {
    pub id: String,
    pub name: String,
    pub is_default: bool,
}

pub fn microphones() -> Vec<Microphone> {
    let host = cpal::default_host();
    let default = host.default_input_device().and_then(|d| d.id().ok()).map(|id| id.to_string());
    host.input_devices()
        .map(|devices| {
            devices
                .filter_map(|d| {
                    let id = d.id().ok()?.to_string();
                    let name = d.description().ok().map(|n| n.name().to_string()).unwrap_or_else(|| id.clone());
                    Some(Microphone { is_default: Some(&id) == default.as_ref(), id, name })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// A running microphone; dropping it stops.
pub struct MicSession {
    _stream: cpal::Stream,
    level: Arc<AtomicU32>,
}

impl MicSession {
    /// Peak level of the last ~50 ms, 0…1.
    pub fn level(&self) -> f32 {
        f32::from_bits(self.level.load(Ordering::Relaxed))
    }
}

/// Starts recording microphone `id` (default if `None`). With no sink it only meters.
pub fn start(id: Option<&str>, clock: Clock, sink: Option<Arc<dyn AudioSink>>) -> Result<MicSession, CaptureError> {
    let host = cpal::default_host();
    let device = match id {
        Some(id) => host.input_devices().map_err(|e| CaptureError::Other(e.to_string()))?.find(|d| d.id().is_ok_and(|n| n.to_string() == id)),
        None => host.default_input_device(),
    }
    .ok_or_else(|| CaptureError::NotFound("The microphone".into()))?;
    let config = device.default_input_config().map_err(|e| CaptureError::Other(e.to_string()))?;
    let rate = config.sample_rate() as f64;
    let channels = config.channels() as usize;
    let level = Arc::new(AtomicU32::new(0));
    let resampler = Arc::new(Mutex::new(Resampler::new(rate, 48_000.0)));
    let meter = level.clone();
    let on_error = |e| eprintln!("microphone: {e}");
    let callback = move |data: &[f32]| {
        let peak = data.iter().fold(0f32, |m, s| m.max(s.abs()));
        meter.store(peak.min(1.0).to_bits(), Ordering::Relaxed);
        let Some(sink) = &sink else { return };
        // Mono mix of the device's channels, resampled to 48 kHz, as stereo.
        let mono: Vec<f32> = data.chunks_exact(channels.max(1)).map(|f| f.iter().sum::<f32>() / f.len() as f32).collect();
        let duration = Duration::from_secs_f64(mono.len() as f64 / rate);
        // The buffer ended about now.
        let Some(t) = clock.at(Instant::now().checked_sub(duration).unwrap_or_else(Instant::now)) else { return };
        let out = resampler.lock().process(&mono);
        let stereo: Vec<f32> = out.iter().flat_map(|s| [*s, *s]).collect();
        sink.audio(&stereo, t);
    };
    let stream = match config.sample_format() {
        cpal::SampleFormat::F32 => device.build_input_stream(config.clone().into(), move |d: &[f32], _: &_| callback(d), on_error, None),
        cpal::SampleFormat::I16 => {
            device.build_input_stream(config.clone().into(), move |d: &[i16], _: &_| callback(&d.iter().map(|s| *s as f32 / 32768.0).collect::<Vec<_>>()), on_error, None)
        }
        cpal::SampleFormat::I32 => {
            device.build_input_stream(config.clone().into(), move |d: &[i32], _: &_| callback(&d.iter().map(|s| *s as f32 / 2_147_483_648.0).collect::<Vec<_>>()), on_error, None)
        }
        other => return Err(CaptureError::Other(format!("unsupported microphone format {other:?}"))),
    }
    .map_err(|e| {
        let text = e.to_string();
        if text.to_lowercase().contains("permission") { CaptureError::MicrophonePermission } else { CaptureError::Other(text) }
    })?;
    stream.play().map_err(|e| CaptureError::Other(e.to_string()))?;
    Ok(MicSession { _stream: stream, level })
}

/// Linear-interpolation resampler that keeps its phase across calls (fine for speech).
pub struct Resampler {
    step: f64,
    position: f64,
    last: f32,
}

impl Resampler {
    pub fn new(from: f64, to: f64) -> Self {
        Self { step: from / to, position: 0.0, last: 0.0 }
    }

    pub fn process(&mut self, input: &[f32]) -> Vec<f32> {
        if (self.step - 1.0).abs() < 1e-9 {
            return input.to_vec();
        }
        let mut out = Vec::with_capacity((input.len() as f64 / self.step) as usize + 2);
        // Positions are relative to `input`, with -1 meaning the last sample of the previous call.
        while self.position < input.len() as f64 - 1.0 + 1e-9 {
            let i = self.position.floor();
            let f = (self.position - i) as f32;
            let a = if i < 0.0 { self.last } else { input[i as usize] };
            let b = input[((i + 1.0) as usize).min(input.len() - 1)];
            out.push(a + (b - a) * f);
            self.position += self.step;
        }
        self.position -= input.len() as f64;
        if let Some(l) = input.last() {
            self.last = *l;
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resamples_44k_to_48k_continuously() {
        let mut r = Resampler::new(44_100.0, 48_000.0);
        let input: Vec<f32> = (0..44_100).map(|i| (i as f32 * 0.01).sin()).collect();
        let mut out = vec![];
        for chunk in input.chunks(441) {
            out.extend(r.process(chunk));
        }
        assert!((out.len() as i64 - 48_000).abs() <= 2, "{}", out.len());
        // Smooth: no jumps at chunk joins.
        let max_step = out.windows(2).map(|w| (w[1] - w[0]).abs()).fold(0f32, f32::max);
        assert!(max_step < 0.011, "{max_step}");
    }
}
