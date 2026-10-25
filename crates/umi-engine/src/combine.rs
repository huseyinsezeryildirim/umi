//! Joining finished videos end to end into one file (several takes → one video): frames
//! and sound are copied across with each file's start shifted by the ones before it.

use crate::EngineError;
use std::path::Path;
use umi_media::{AudioReader, CHANNELS, FrameFormat, Pixels, StreamWriter, VideoCodec, VideoDecoder, WriterSettings, audio_streams};

/// Writes `files` one after another into `out` (all must have the same frame size).
/// `progress` gets 0…1.
pub fn concatenate(files: &[&Path], out: &Path, fps: u32, progress: &dyn Fn(f64)) -> Result<f64, EngineError> {
    let first = VideoDecoder::open(files.first().ok_or_else(|| EngineError::Media(umi_media::MediaError::NoEncoder))?, false)?;
    let (w, h) = (first.info().width, first.info().height);
    drop(first);
    let mut writer = StreamWriter::create(out, &WriterSettings { width: w, height: h, fps, codec: VideoCodec::H264, bit_rate: 0, audio_tracks: 1, fragmented: false, hardware: true })?;
    let total: f64 = files.iter().map(|f| umi_media::duration(f).unwrap_or(0.0)).sum::<f64>().max(0.1);
    let mut offset = 0.0;
    for file in files {
        let mut decoder = VideoDecoder::open(file, false)?;
        let info = decoder.info();
        while let Some(frame) = decoder.next()? {
            let t = offset + (frame.pts - info.start).max(0.0);
            match frame.format {
                FrameFormat::Nv12 => writer.push_video(Pixels::Nv12 { y: &frame.planes[0], y_stride: frame.strides[0] as usize, uv: &frame.planes[1], uv_stride: frame.strides[1] as usize }, t)?,
                FrameFormat::Rgba => writer.push_video(Pixels::Rgba { data: &frame.planes[0], stride: frame.strides[0] as usize }, t)?,
            }
            progress(t / total);
        }
        if audio_streams(file).map(|a| !a.is_empty()).unwrap_or(false) {
            let mut reader = AudioReader::open(file, 0)?;
            let mut buf = vec![0f32; 4800 * CHANNELS];
            let mut at = offset;
            loop {
                let n = reader.read(&mut buf)?;
                if n == 0 {
                    break;
                }
                writer.push_audio(0, &buf[..n], at)?;
                at += (n / CHANNELS) as f64 / umi_media::SAMPLE_RATE as f64;
            }
        }
        offset += info.duration;
    }
    writer.finish()?;
    progress(1.0);
    Ok(offset)
}
