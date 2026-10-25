//! H.264/HEVC + AAC into MP4/MOV, preferring the platform's hardware encoder.

use crate::MediaError;
use crate::audio::{CHANNELS, SAMPLE_RATE};
use ff::format::Pixel;
use ffmpeg_next as ff;
use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VideoCodec {
    H264,
    Hevc,
    /// ProRes 4444 with an alpha channel (cut-out camera).
    ProRes4444,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Container {
    Mp4,
    Mov,
    /// MP4 written front to back for uploading while it's made: the index goes at the end
    /// (no fast-start rewrite); only the first bytes (the media box size) change at the end.
    StreamingMp4,
}

#[derive(Debug, Clone)]
pub struct EncoderSettings {
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub codec: VideoCodec,
    pub container: Container,
    /// Video bit rate in bits per second (0 = a sensible default for the size).
    pub bit_rate: usize,
    pub audio: bool,
    /// Try hardware encoders first.
    pub hardware: bool,
}

impl EncoderSettings {
    /// ~0.1 bits per pixel per frame: crisp screen text at 1080p60 ≈ 12 Mb/s.
    fn default_bit_rate(&self) -> usize {
        ((self.width as f64 * self.height as f64 * self.fps as f64 * 0.1) as usize).clamp(2_000_000, 80_000_000)
    }
}

/// Encoder names to try, best first.
fn candidates(codec: VideoCodec, hardware: bool) -> Vec<&'static str> {
    let mut list = vec![];
    if hardware {
        match codec {
            VideoCodec::H264 => {
                list.extend(["h264_videotoolbox", "h264_nvenc", "h264_qsv", "h264_amf", "h264_mf"]);
            }
            VideoCodec::Hevc => {
                list.extend(["hevc_videotoolbox", "hevc_nvenc", "hevc_qsv", "hevc_amf", "hevc_mf"]);
            }
            VideoCodec::ProRes4444 => {}
        }
    }
    match codec {
        VideoCodec::H264 => list.extend(["libx264", "libopenh264", "h264"]),
        VideoCodec::Hevc => list.extend(["libx265", "hevc"]),
        VideoCodec::ProRes4444 => list.push("prores_ks"),
    }
    list
}

pub struct Encoder {
    output: ff::format::context::Output,
    video: ff::encoder::Video,
    video_stream: usize,
    video_tb: ff::Rational,
    scaler: ff::software::scaling::Context,
    pix_fmt: Pixel,
    frame_index: i64,
    audio: Option<AudioOut>,
    pub encoder_name: String,
}

struct AudioOut {
    encoder: ff::encoder::Audio,
    stream: usize,
    tb: ff::Rational,
    frame_size: usize,
    pending: Vec<f32>,
    samples_written: i64,
}

// SAFETY: FFmpeg contexts are not thread-safe for concurrent use, but may move between
// threads; an `Encoder` is owned and used by one thread at a time (`&mut self` everywhere).
unsafe impl Send for Encoder {}

impl Encoder {
    pub fn create(path: &Path, settings: &EncoderSettings) -> Result<Self, MediaError> {
        crate::init();
        let format = match settings.container {
            Container::Mp4 | Container::StreamingMp4 => "mp4",
            Container::Mov => "mov",
        };
        let mut output = ff::format::output_as(path, format).map_err(|e| MediaError::open(path, e))?;
        let global_header = output.format().flags().contains(ff::format::Flags::GLOBAL_HEADER);
        let bit_rate = if settings.bit_rate > 0 { settings.bit_rate } else { settings.default_bit_rate() };
        let time_base = ff::Rational::new(1, settings.fps as i32);

        let mut last_error = None;
        let mut chosen = None;
        for name in candidates(settings.codec, settings.hardware) {
            let Some(codec) = ff::encoder::find_by_name(name) else { continue };
            let pix_fmt = if name == "prores_ks" {
                Pixel::YUVA444P10LE
            } else if name.starts_with("lib") || name == "h264" || name == "hevc" {
                Pixel::YUV420P
            } else {
                Pixel::NV12
            };
            let mut enc = ff::codec::context::Context::new_with_codec(codec).encoder().video()?;
            enc.set_width(settings.width);
            enc.set_height(settings.height);
            enc.set_format(pix_fmt);
            enc.set_time_base(time_base);
            enc.set_frame_rate(Some(ff::Rational::new(settings.fps as i32, 1)));
            enc.set_bit_rate(bit_rate);
            enc.set_max_b_frames(0);
            enc.set_gop(settings.fps * 2);
            enc.set_colorspace(ff::color::Space::BT709);
            enc.set_color_range(ff::color::Range::MPEG);
            if global_header {
                enc.set_flags(ff::codec::Flags::GLOBAL_HEADER);
            }
            let mut opts = ff::Dictionary::new();
            if name == "libx264" || name == "libx265" {
                opts.set("preset", "veryfast");
            }
            if name.ends_with("_videotoolbox") {
                opts.set("realtime", "0");
                opts.set("allow_sw", "1");
            }
            match enc.open_as_with(codec, opts) {
                Ok(opened) => {
                    chosen = Some((opened, pix_fmt, name));
                    break;
                }
                Err(e) => last_error = Some(e),
            }
        }
        let Some((video, pix_fmt, name)) = chosen else {
            return Err(last_error.map(MediaError::Ffmpeg).unwrap_or(MediaError::NoEncoder));
        };
        let video_stream = {
            let mut stream = output.add_stream(ff::encoder::find_by_name(name))?;
            stream.set_parameters(&video);
            stream.set_time_base(time_base);
            stream.index()
        };

        let audio = if settings.audio {
            let codec = ff::encoder::find(ff::codec::Id::AAC).ok_or(MediaError::NoEncoder)?;
            let mut enc = ff::codec::context::Context::new_with_codec(codec).encoder().audio()?;
            enc.set_rate(SAMPLE_RATE as i32);
            enc.set_channel_layout(ff::ChannelLayout::STEREO);
            enc.set_format(ff::format::Sample::F32(ff::format::sample::Type::Planar));
            enc.set_bit_rate(160_000);
            enc.set_time_base(ff::Rational::new(1, SAMPLE_RATE as i32));
            if global_header {
                enc.set_flags(ff::codec::Flags::GLOBAL_HEADER);
            }
            let encoder = enc.open_as(codec)?;
            let frame_size = encoder.frame_size().max(1024) as usize;
            let mut stream = output.add_stream(Some(codec))?;
            stream.set_parameters(&encoder);
            stream.set_time_base(ff::Rational::new(1, SAMPLE_RATE as i32));
            Some(AudioOut {
                encoder,
                stream: stream.index(),
                tb: ff::Rational::new(1, SAMPLE_RATE as i32),
                frame_size,
                pending: vec![],
                samples_written: 0,
            })
        } else {
            None
        };

        let mut opts = ff::Dictionary::new();
        if settings.container != Container::StreamingMp4 {
            opts.set("movflags", "+faststart");
        }
        output.write_header_with(opts)?;
        let video_tb = output.stream(video_stream).map(|s| s.time_base()).unwrap_or(time_base);
        let audio = audio.map(|mut a| {
            a.tb = output.stream(a.stream).map(|s| s.time_base()).unwrap_or(a.tb);
            a
        });
        let scaler = ff::software::scaling::Context::get(
            Pixel::RGBA,
            settings.width,
            settings.height,
            pix_fmt,
            settings.width,
            settings.height,
            ff::software::scaling::Flags::BILINEAR,
        )?;
        Ok(Self { output, video, video_stream, video_tb, scaler, pix_fmt, frame_index: 0, audio, encoder_name: name.to_owned() })
    }

    /// Adds the next video frame (tightly packed RGBA8, sRGB).
    pub fn push_rgba(&mut self, rgba: &[u8]) -> Result<(), MediaError> {
        let (w, h) = (self.video.width(), self.video.height());
        let mut src = ff::frame::Video::new(Pixel::RGBA, w, h);
        let stride = src.stride(0);
        let row = (w * 4) as usize;
        {
            let data = src.data_mut(0);
            for r in 0..h as usize {
                data[r * stride..r * stride + row].copy_from_slice(&rgba[r * row..(r + 1) * row]);
            }
        }
        let mut frame = ff::frame::Video::new(self.pix_fmt, w, h);
        self.scaler.run(&src, &mut frame)?;
        frame.set_pts(Some(self.frame_index));
        frame.set_color_space(ff::color::Space::BT709);
        frame.set_color_range(ff::color::Range::MPEG);
        self.frame_index += 1;
        self.video.send_frame(&frame)?;
        self.drain_video()
    }

    /// Adds interleaved 48 kHz stereo samples.
    pub fn push_audio(&mut self, samples: &[f32]) -> Result<(), MediaError> {
        let Some(audio) = &mut self.audio else { return Ok(()) };
        audio.pending.extend_from_slice(samples);
        let chunk = audio.frame_size * CHANNELS;
        while audio.pending.len() >= chunk {
            let block: Vec<f32> = audio.pending.drain(..chunk).collect();
            Self::send_audio(audio, &block, &mut self.output)?;
        }
        Ok(())
    }

    fn send_audio(audio: &mut AudioOut, interleaved: &[f32], output: &mut ff::format::context::Output) -> Result<(), MediaError> {
        let n = interleaved.len() / CHANNELS;
        let mut frame = ff::frame::Audio::new(ff::format::Sample::F32(ff::format::sample::Type::Planar), n, ff::ChannelLayout::STEREO);
        frame.set_rate(SAMPLE_RATE);
        for c in 0..CHANNELS {
            let plane = frame.data_mut(c);
            for i in 0..n {
                plane[i * 4..i * 4 + 4].copy_from_slice(&interleaved[i * CHANNELS + c].to_ne_bytes());
            }
        }
        frame.set_pts(Some(audio.samples_written));
        audio.samples_written += n as i64;
        audio.encoder.send_frame(&frame)?;
        Self::drain_audio(audio, output)
    }

    fn drain_video(&mut self) -> Result<(), MediaError> {
        let mut packet = ff::Packet::empty();
        while self.video.receive_packet(&mut packet).is_ok() {
            packet.set_stream(self.video_stream);
            packet.rescale_ts(ff::Rational::new(1, self.video.time_base().denominator()), self.video_tb);
            packet.write_interleaved(&mut self.output)?;
        }
        Ok(())
    }

    fn drain_audio(audio: &mut AudioOut, output: &mut ff::format::context::Output) -> Result<(), MediaError> {
        let mut packet = ff::Packet::empty();
        while audio.encoder.receive_packet(&mut packet).is_ok() {
            packet.set_stream(audio.stream);
            packet.rescale_ts(ff::Rational::new(1, SAMPLE_RATE as i32), audio.tb);
            packet.write_interleaved(output)?;
        }
        Ok(())
    }

    /// Flushes the encoders and writes the file's index.
    pub fn finish(mut self) -> Result<(), MediaError> {
        self.video.send_eof()?;
        self.drain_video()?;
        if let Some(audio) = &mut self.audio {
            if !audio.pending.is_empty() {
                let mut rest = std::mem::take(&mut audio.pending);
                rest.resize(audio.frame_size * CHANNELS, 0.0);
                Self::send_audio(audio, &rest, &mut self.output)?;
            }
            audio.encoder.send_eof()?;
            Self::drain_audio(audio, &mut self.output)?;
        }
        self.output.write_trailer()?;
        Ok(())
    }
}
