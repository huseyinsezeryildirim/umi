//! Writing a recording as it happens: video frames at the times they were captured
//! (screens only send frames when something changes), one AAC track per audio source, in a
//! fragmented MOV that stays playable even if the app quits mid-recording.

use crate::MediaError;
use crate::audio::{CHANNELS, SAMPLE_RATE};
use crate::encode::VideoCodec;
use ff::format::Pixel;
use ffmpeg_next as ff;
use std::path::Path;

#[derive(Debug, Clone)]
pub struct WriterSettings {
    pub width: u32,
    pub height: u32,
    /// Expected frame rate (for the encoder's rate control and keyframe spacing).
    pub fps: u32,
    pub codec: VideoCodec,
    /// Bits per second (0 = about 0.12 bits per pixel per frame).
    pub bit_rate: usize,
    /// Number of audio tracks (system sound, microphone…), each 48 kHz stereo.
    pub audio_tracks: usize,
    /// Fragmented MOV: playable up to the last second written, even after a crash.
    pub fragmented: bool,
    pub hardware: bool,
}

/// One captured frame's pixels.
pub enum Pixels<'a> {
    /// Planar Y + interleaved UV (what capture APIs hand out natively).
    Nv12 { y: &'a [u8], y_stride: usize, uv: &'a [u8], uv_stride: usize },
    /// 8-bit BGRA, as some cameras and Windows deliver.
    Bgra { data: &'a [u8], stride: usize },
    /// 8-bit RGBA.
    Rgba { data: &'a [u8], stride: usize },
}

/// Microseconds: fine enough for variable frame rates and exact audio placement.
const TIME_BASE: i32 = 1_000_000;

struct Track {
    encoder: ff::encoder::Audio,
    stream: usize,
    tb: ff::Rational,
    frame_size: usize,
    pending: Vec<f32>,
    /// Samples written so far (the track's own clock).
    written: i64,
}

pub struct StreamWriter {
    output: ff::format::context::Output,
    video: ff::encoder::Video,
    video_stream: usize,
    video_tb: ff::Rational,
    pix_fmt: Pixel,
    scaler: Option<(Pixel, ff::software::scaling::Context)>,
    last_pts: i64,
    tracks: Vec<Track>,
    pub encoder_name: String,
    frames: u64,
}

// SAFETY: used by one thread at a time (`&mut self`); FFmpeg contexts may move threads.
unsafe impl Send for StreamWriter {}

impl StreamWriter {
    pub fn create(path: &Path, s: &WriterSettings) -> Result<Self, MediaError> {
        crate::init();
        let mut output = ff::format::output_as(path, "mov").map_err(|e| MediaError::open(path, e))?;
        let global_header = output.format().flags().contains(ff::format::Flags::GLOBAL_HEADER);
        let bit_rate = if s.bit_rate > 0 { s.bit_rate } else { ((s.width as f64 * s.height as f64 * s.fps as f64 * 0.12) as usize).clamp(3_000_000, 120_000_000) };
        let tb = ff::Rational::new(1, TIME_BASE);
        let names: Vec<&str> = match (s.codec, s.hardware) {
            (VideoCodec::H264, true) => vec!["h264_videotoolbox", "h264_nvenc", "h264_qsv", "h264_amf", "h264_mf", "libx264", "libopenh264"],
            (VideoCodec::Hevc, true) => vec!["hevc_videotoolbox", "hevc_nvenc", "hevc_qsv", "hevc_amf", "hevc_mf", "libx265"],
            (VideoCodec::H264, false) => vec!["libx264", "libopenh264", "h264_videotoolbox"],
            (VideoCodec::Hevc, false) => vec!["libx265", "hevc_videotoolbox"],
            (VideoCodec::ProRes4444, _) => vec!["prores_ks"],
        };
        let mut chosen = None;
        let mut last_error = None;
        for name in names {
            let Some(codec) = ff::encoder::find_by_name(name) else { continue };
            let pix_fmt = if name == "prores_ks" {
                Pixel::YUVA444P10LE
            } else if name.starts_with("lib") {
                Pixel::YUV420P
            } else {
                Pixel::NV12
            };
            let mut enc = ff::codec::context::Context::new_with_codec(codec).encoder().video()?;
            enc.set_width(s.width);
            enc.set_height(s.height);
            enc.set_format(pix_fmt);
            enc.set_time_base(tb);
            enc.set_frame_rate(Some(ff::Rational::new(s.fps as i32, 1)));
            enc.set_bit_rate(bit_rate);
            enc.set_max_b_frames(0);
            enc.set_gop(s.fps * 2);
            enc.set_colorspace(ff::color::Space::BT709);
            enc.set_color_range(ff::color::Range::MPEG);
            if global_header {
                enc.set_flags(ff::codec::Flags::GLOBAL_HEADER);
            }
            let mut opts = ff::Dictionary::new();
            if name == "libx264" {
                opts.set("preset", "veryfast");
                opts.set("tune", "zerolatency");
            }
            if name == "prores_ks" {
                opts.set("profile", "4");
                opts.set("alpha_bits", "16");
            }
            if name.ends_with("_videotoolbox") {
                opts.set("realtime", "1");
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
            stream.set_time_base(tb);
            stream.index()
        };
        let mut tracks = Vec::new();
        for _ in 0..s.audio_tracks {
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
            tracks.push(Track { encoder, stream: stream.index(), tb: ff::Rational::new(1, SAMPLE_RATE as i32), frame_size, pending: vec![], written: 0 });
        }
        let mut opts = ff::Dictionary::new();
        if s.fragmented {
            // A fragment every second: at most a second is lost if the app dies.
            opts.set("movflags", "+frag_keyframe+empty_moov+default_base_moof");
            opts.set("frag_duration", "1000000");
            // Hand each fragment to the OS right away instead of keeping it in a buffer.
            opts.set("flush_packets", "1");
        }
        output.write_header_with(opts)?;
        let video_tb = output.stream(video_stream).map(|st| st.time_base()).unwrap_or(tb);
        for t in &mut tracks {
            t.tb = output.stream(t.stream).map(|st| st.time_base()).unwrap_or(t.tb);
        }
        Ok(Self { output, video, video_stream, video_tb, pix_fmt, scaler: None, last_pts: -1, tracks, encoder_name: name.to_owned(), frames: 0 })
    }

    pub fn frames_written(&self) -> u64 {
        self.frames
    }

    /// Adds a frame shown at recording time `t` seconds. Frames out of order are dropped.
    pub fn push_video(&mut self, pixels: Pixels, t: f64) -> Result<(), MediaError> {
        let pts = (t * TIME_BASE as f64).round() as i64;
        if pts <= self.last_pts {
            return Ok(());
        }
        let (w, h) = (self.video.width(), self.video.height());
        let mut frame = ff::frame::Video::new(self.pix_fmt, w, h);
        match (pixels, self.pix_fmt) {
            (Pixels::Nv12 { y, y_stride, uv, uv_stride }, Pixel::NV12) => {
                copy_plane(&mut frame, 0, y, y_stride, w as usize, h as usize);
                copy_plane(&mut frame, 1, uv, uv_stride, w as usize, h as usize / 2);
            }
            (pixels, target) => {
                // Convert (BGRA/RGBA → NV12, or anything → YUV420P for software encoders).
                let (format, planes): (Pixel, Vec<(&[u8], usize, usize)>) = match pixels {
                    Pixels::Nv12 { y, y_stride, uv, uv_stride } => (Pixel::NV12, vec![(y, y_stride, h as usize), (uv, uv_stride, h as usize / 2)]),
                    Pixels::Bgra { data, stride } => (Pixel::BGRA, vec![(data, stride, h as usize)]),
                    Pixels::Rgba { data, stride } => (Pixel::RGBA, vec![(data, stride, h as usize)]),
                };
                let mut src = ff::frame::Video::new(format, w, h);
                for (i, (data, stride, rows)) in planes.into_iter().enumerate() {
                    let row_bytes = if format == Pixel::NV12 { w as usize } else { w as usize * 4 };
                    copy_plane(&mut src, i, data, stride, row_bytes, rows);
                }
                if self.scaler.as_ref().is_none_or(|(f, _)| *f != format) {
                    let ctx = ff::software::scaling::Context::get(format, w, h, target, w, h, ff::software::scaling::Flags::BILINEAR)?;
                    self.scaler = Some((format, ctx));
                }
                if let Some((_, scaler)) = &mut self.scaler {
                    scaler.run(&src, &mut frame)?;
                }
            }
        }
        frame.set_pts(Some(pts));
        frame.set_color_space(ff::color::Space::BT709);
        frame.set_color_range(ff::color::Range::MPEG);
        self.video.send_frame(&frame)?;
        self.last_pts = pts;
        self.frames += 1;
        self.drain_video()
    }

    /// Adds interleaved 48 kHz stereo samples to `track`, the first one heard at recording
    /// time `t`. Gaps are filled with silence and overlaps trimmed, so each track stays in
    /// step with the video.
    pub fn push_audio(&mut self, track: usize, samples: &[f32], t: f64) -> Result<(), MediaError> {
        let Some(tr) = self.tracks.get_mut(track) else { return Ok(()) };
        let at = (t * SAMPLE_RATE as f64).round() as i64;
        let expected = tr.written + (tr.pending.len() / CHANNELS) as i64;
        let mut samples = samples;
        let silence;
        if at > expected + (SAMPLE_RATE as i64 / 50) {
            // More than 20 ms missing: insert silence.
            silence = vec![0f32; ((at - expected) as usize) * CHANNELS];
            tr.pending.extend_from_slice(&silence);
        } else if at < expected - (SAMPLE_RATE as i64 / 50) {
            let skip = (((expected - at) as usize) * CHANNELS).min(samples.len());
            samples = &samples[skip..];
        }
        tr.pending.extend_from_slice(samples);
        let chunk = tr.frame_size * CHANNELS;
        while tr.pending.len() >= chunk {
            let block: Vec<f32> = tr.pending.drain(..chunk).collect();
            send_audio(tr, &block, &mut self.output)?;
        }
        Ok(())
    }

    fn drain_video(&mut self) -> Result<(), MediaError> {
        let mut packet = ff::Packet::empty();
        while self.video.receive_packet(&mut packet).is_ok() {
            packet.set_stream(self.video_stream);
            packet.rescale_ts(ff::Rational::new(1, TIME_BASE), self.video_tb);
            packet.write_interleaved(&mut self.output)?;
        }
        Ok(())
    }

    /// Flushes everything and closes the file.
    pub fn finish(mut self) -> Result<(), MediaError> {
        self.video.send_eof()?;
        self.drain_video()?;
        for tr in &mut self.tracks {
            if !tr.pending.is_empty() {
                let mut rest = std::mem::take(&mut tr.pending);
                rest.resize(tr.frame_size * CHANNELS, 0.0);
                send_audio(tr, &rest, &mut self.output)?;
            }
            tr.encoder.send_eof()?;
            drain_audio(tr, &mut self.output)?;
        }
        self.output.write_trailer()?;
        Ok(())
    }
}

fn copy_plane(frame: &mut ff::frame::Video, plane: usize, src: &[u8], src_stride: usize, row_bytes: usize, rows: usize) {
    let stride = frame.stride(plane);
    let data = frame.data_mut(plane);
    for r in 0..rows {
        let (a, b) = (r * src_stride, r * stride);
        if a + row_bytes > src.len() || b + row_bytes > data.len() {
            break;
        }
        data[b..b + row_bytes].copy_from_slice(&src[a..a + row_bytes]);
    }
}

fn send_audio(tr: &mut Track, interleaved: &[f32], output: &mut ff::format::context::Output) -> Result<(), MediaError> {
    let n = interleaved.len() / CHANNELS;
    let mut frame = ff::frame::Audio::new(ff::format::Sample::F32(ff::format::sample::Type::Planar), n, ff::ChannelLayout::STEREO);
    frame.set_rate(SAMPLE_RATE);
    for c in 0..CHANNELS {
        let plane = frame.data_mut(c);
        for i in 0..n {
            plane[i * 4..i * 4 + 4].copy_from_slice(&interleaved[i * CHANNELS + c].to_ne_bytes());
        }
    }
    frame.set_pts(Some(tr.written));
    tr.written += n as i64;
    tr.encoder.send_frame(&frame)?;
    drain_audio(tr, output)
}

fn drain_audio(tr: &mut Track, output: &mut ff::format::context::Output) -> Result<(), MediaError> {
    let mut packet = ff::Packet::empty();
    while tr.encoder.receive_packet(&mut packet).is_ok() {
        packet.set_stream(tr.stream);
        packet.rescale_ts(ff::Rational::new(1, SAMPLE_RATE as i32), tr.tb);
        packet.write_interleaved(output)?;
    }
    Ok(())
}
