//! Audio decoding to 48 kHz stereo f32 (interleaved), with seeking, for preview playback,
//! export mixing and waveforms.

use crate::MediaError;
use ffmpeg_next as ff;
use std::path::Path;

pub const SAMPLE_RATE: u32 = 48_000;
pub const CHANNELS: usize = 2;

#[derive(Debug, Clone, Copy)]
pub struct AudioStream {
    /// Index among the file's audio streams (0 = first audio track).
    pub track: usize,
    pub channels: u16,
    pub sample_rate: u32,
}

/// Lists a file's audio tracks.
pub fn audio_streams(path: &Path) -> Result<Vec<AudioStream>, MediaError> {
    crate::init();
    let input = ff::format::input(path).map_err(|e| MediaError::open(path, e))?;
    let mut out = vec![];
    for (track, stream) in input.streams().filter(|s| s.parameters().medium() == ff::media::Type::Audio).enumerate() {
        let ctx = ff::codec::context::Context::from_parameters(stream.parameters())?;
        let audio = ctx.decoder().audio()?;
        out.push(AudioStream { track, channels: audio.channel_layout().channels() as u16, sample_rate: audio.rate() });
    }
    Ok(out)
}

/// Streams one audio track as 48 kHz stereo f32.
pub struct AudioReader {
    input: ff::format::context::Input,
    stream: usize,
    time_base: f64,
    decoder: ff::decoder::Audio,
    resampler: Option<ff::software::resampling::Context>,
    /// Decoded samples not handed out yet (interleaved stereo).
    buffer: Vec<f32>,
    /// Time of `buffer[0]`.
    buffer_time: f64,
    /// Discard samples before this time after a seek.
    skip_until: Option<f64>,
    eof: bool,
}

// SAFETY: moved between threads, never used concurrently (`&mut self`).
unsafe impl Send for AudioReader {}

impl AudioReader {
    pub fn open(path: &Path, track: usize) -> Result<Self, MediaError> {
        crate::init();
        let input = ff::format::input(path).map_err(|e| MediaError::open(path, e))?;
        let stream = input
            .streams()
            .filter(|s| s.parameters().medium() == ff::media::Type::Audio)
            .nth(track)
            .ok_or_else(|| MediaError::NoAudio(path.into(), track))?;
        let index = stream.index();
        let tb = stream.time_base();
        let ctx = ff::codec::context::Context::from_parameters(stream.parameters())?;
        let decoder = ctx.decoder().audio()?;
        Ok(Self {
            input,
            stream: index,
            time_base: tb.numerator() as f64 / tb.denominator().max(1) as f64,
            decoder,
            resampler: None,
            buffer: vec![],
            buffer_time: 0.0,
            skip_until: None,
            eof: false,
        })
    }

    pub fn seek(&mut self, t: f64) -> Result<(), MediaError> {
        let ts = (t.max(0.0) * ff::ffi::AV_TIME_BASE as f64) as i64;
        self.input.seek(ts, ..ts)?;
        self.decoder.flush();
        self.buffer.clear();
        self.buffer_time = t;
        self.skip_until = Some(t);
        self.eof = false;
        Ok(())
    }

    /// Fills `out` (interleaved stereo) and returns how many floats were written; fewer
    /// than `out.len()` only at the end of the track.
    pub fn read(&mut self, out: &mut [f32]) -> Result<usize, MediaError> {
        while self.buffer.len() < out.len() && !self.eof {
            self.decode_more()?;
        }
        let n = out.len().min(self.buffer.len());
        out[..n].copy_from_slice(&self.buffer[..n]);
        self.buffer.drain(..n);
        self.buffer_time += (n / CHANNELS) as f64 / SAMPLE_RATE as f64;
        Ok(n)
    }

    fn decode_more(&mut self) -> Result<(), MediaError> {
        let mut frame = ff::frame::Audio::empty();
        loop {
            match self.decoder.receive_frame(&mut frame) {
                Ok(()) => {
                    self.push(&frame)?;
                    return Ok(());
                }
                Err(ff::Error::Other { errno }) if errno == ff::util::error::EAGAIN => {}
                Err(ff::Error::Eof) => {
                    self.eof = true;
                    return Ok(());
                }
                Err(e) => return Err(e.into()),
            }
            let mut fed = false;
            for (stream, packet) in self.input.packets() {
                if stream.index() == self.stream {
                    self.decoder.send_packet(&packet)?;
                    fed = true;
                    break;
                }
            }
            if !fed {
                self.decoder.send_eof()?;
            }
        }
    }

    fn push(&mut self, frame: &ff::frame::Audio) -> Result<(), MediaError> {
        if self.resampler.is_none() {
            self.resampler = Some(ff::software::resampling::Context::get(
                frame.format(),
                frame.channel_layout(),
                frame.rate(),
                ff::format::Sample::F32(ff::format::sample::Type::Packed),
                ff::ChannelLayout::STEREO,
                SAMPLE_RATE,
            )?);
        }
        let mut out = ff::frame::Audio::empty();
        if let Some(resampler) = &mut self.resampler {
            resampler.run(frame, &mut out)?;
        }
        let samples = out.samples() * CHANNELS;
        let data: &[f32] = bytemuck_f32(out.data(0), samples);
        let frame_time = frame.pts().map(|p| p as f64 * self.time_base);
        let mut data = data;
        if let (Some(until), Some(start)) = (self.skip_until, frame_time) {
            // Drop what precedes the seek target.
            let skip = (((until - start) * SAMPLE_RATE as f64).max(0.0) as usize * CHANNELS).min(data.len());
            data = &data[skip..];
            if skip < samples {
                self.skip_until = None;
            }
        }
        self.buffer.extend_from_slice(data);
        Ok(())
    }
}

fn bytemuck_f32(bytes: &[u8], count: usize) -> &[f32] {
    let count = count.min(bytes.len() / 4);
    // SAFETY: FFmpeg frame buffers are at least 16-byte aligned and hold `count` f32 values.
    unsafe { std::slice::from_raw_parts(bytes.as_ptr().cast::<f32>(), count) }
}

/// Peak loudness per bucket (`per_second` buckets per second), 0…1, normalized so quiet
/// recordings still read (like the Swift app's waveform).
pub fn waveform(path: &Path, track: usize, per_second: u32) -> Result<Vec<f32>, MediaError> {
    let mut reader = AudioReader::open(path, track)?;
    let bucket = (SAMPLE_RATE / per_second.max(1)) as usize * CHANNELS;
    let mut buf = vec![0f32; bucket];
    let mut peaks = vec![];
    loop {
        let n = reader.read(&mut buf)?;
        if n == 0 {
            break;
        }
        peaks.push(buf[..n].iter().fold(0f32, |m, s| m.max(s.abs())).min(1.0));
        if n < bucket {
            break;
        }
    }
    let top = peaks.iter().cloned().fold(0.05f32, f32::max);
    Ok(peaks.into_iter().map(|p| (p / top).min(1.0)).collect())
}
