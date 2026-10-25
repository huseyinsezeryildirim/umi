//! Video decoding with hardware acceleration where available (VideoToolbox, D3D11VA,
//! VAAPI), falling back to software. Frames come out as NV12 (or RGBA for odd formats)
//! with their presentation time in seconds.

use crate::{MediaError, hw};
use ff::format::Pixel;
use ffmpeg_next as ff;
use std::path::Path;
use std::sync::Arc;

/// Pixel layout of a decoded frame.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FrameFormat {
    /// Y plane + interleaved CbCr plane.
    Nv12,
    Rgba,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ColorInfo {
    pub full_range: bool,
    pub bt709: bool,
}

/// A decoded picture. Planes are tightly owned buffers with their strides.
#[derive(Debug, Clone)]
pub struct DecodedFrame {
    pub pts: f64,
    pub width: u32,
    pub height: u32,
    pub format: FrameFormat,
    pub color: ColorInfo,
    pub planes: Vec<Vec<u8>>,
    pub strides: Vec<u32>,
}

#[derive(Debug, Clone, Copy)]
pub struct VideoInfo {
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub duration: f64,
    /// Time of the first frame (screen recordings can start a few ms after 0).
    pub start: f64,
}

pub struct VideoDecoder {
    input: ff::format::context::Input,
    stream: usize,
    time_base: f64,
    decoder: ff::decoder::Video,
    scaler: Option<(ff::software::scaling::Context, Pixel, u32, u32)>,
    info: VideoInfo,
    /// The last frame returned, kept so repeated requests for the same time are free.
    current: Option<Arc<DecodedFrame>>,
    /// A frame already decoded past the current one (look-ahead).
    pending: Option<Arc<DecodedFrame>>,
    eof: bool,
    pub hardware: bool,
}

// SAFETY: as for the encoder: moved between threads, never used concurrently (`&mut self`).
unsafe impl Send for VideoDecoder {}

impl VideoDecoder {
    pub fn open(path: &Path, hardware: bool) -> Result<Self, MediaError> {
        crate::init();
        let input = ff::format::input(path).map_err(|e| MediaError::open(path, e))?;
        Self::from_input(input, hardware).map_err(|e| match e {
            MediaError::NoVideo(_) => MediaError::NoVideo(path.into()),
            e => e,
        })
    }

    /// A decoder over an already opened input (a file or a live device).
    pub(crate) fn from_input(input: ff::format::context::Input, hardware: bool) -> Result<Self, MediaError> {
        let stream = input.streams().best(ff::media::Type::Video).ok_or_else(|| MediaError::NoVideo(Path::new("input").into()))?;
        let index = stream.index();
        let tb = stream.time_base();
        let time_base = tb.numerator() as f64 / tb.denominator().max(1) as f64;
        let mut context = ff::codec::context::Context::from_parameters(stream.parameters())?;
        context.set_threading(ff::threading::Config { kind: ff::threading::Type::Frame, count: 0 });
        let hw = hardware && hw::attach_device(&mut context);
        let decoder = context.decoder().video()?;
        let rate = stream.avg_frame_rate();
        let fps = if rate.denominator() > 0 && rate.numerator() > 0 { rate.numerator() as f64 / rate.denominator() as f64 } else { 30.0 };
        let duration = if stream.duration() > 0 {
            stream.duration() as f64 * time_base
        } else {
            input.duration().max(0) as f64 / ff::ffi::AV_TIME_BASE as f64
        };
        let start = if stream.start_time() != ff::ffi::AV_NOPTS_VALUE { stream.start_time() as f64 * time_base } else { 0.0 };
        let info = VideoInfo { width: decoder.width(), height: decoder.height(), fps, duration, start };
        Ok(Self { input, stream: index, time_base, decoder, scaler: None, info, current: None, pending: None, eof: false, hardware: hw })
    }

    pub fn info(&self) -> VideoInfo {
        self.info
    }

    /// Jumps to the keyframe at or before `t` (seconds). Following `next()` calls decode
    /// forward from there.
    pub fn seek(&mut self, t: f64) -> Result<(), MediaError> {
        let ts = (t.max(0.0) * ff::ffi::AV_TIME_BASE as f64) as i64;
        self.input.seek(ts, ..ts)?;
        self.decoder.flush();
        self.current = None;
        self.pending = None;
        self.eof = false;
        Ok(())
    }

    /// The next frame in presentation order, or `None` at the end.
    pub fn next(&mut self) -> Result<Option<Arc<DecodedFrame>>, MediaError> {
        if let Some(frame) = self.pending.take() {
            return Ok(Some(frame));
        }
        let mut frame = ff::frame::Video::empty();
        loop {
            match self.decoder.receive_frame(&mut frame) {
                Ok(()) => return Ok(Some(Arc::new(self.convert(&frame)?))),
                Err(ff::Error::Other { errno }) if errno == ff::util::error::EAGAIN => {}
                Err(ff::Error::Eof) => return Ok(None),
                Err(e) => return Err(e.into()),
            }
            if self.eof {
                return Ok(None);
            }
            // Feed the next packet of our stream.
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
                self.eof = true;
            }
        }
    }

    /// The frame showing at `t`: decodes forward when `t` is shortly ahead of the current
    /// position (playback, export), seeks otherwise (scrubbing).
    pub fn frame_at(&mut self, t: f64) -> Result<Option<Arc<DecodedFrame>>, MediaError> {
        let frame_duration = 1.0 / self.info.fps.max(1.0);
        let t = t.max(self.info.start);
        let behind = self.current.as_ref().is_some_and(|f| t + frame_duration * 0.5 < f.pts);
        let far = self.current.as_ref().is_none_or(|f| t - f.pts > 2.0);
        if behind || far {
            self.seek(t)?;
        }
        loop {
            // Is the frame after the current one still in the future? Then current is it.
            if let Some(current) = &self.current
                && t < current.pts + frame_duration * 0.5
                && t >= current.pts - frame_duration * 0.5
            {
                break;
            }
            match self.next()? {
                Some(frame) => {
                    if frame.pts > t + frame_duration * 0.5 && self.current.is_some() {
                        // Overshot: keep it for later and show the current one.
                        self.pending = Some(frame);
                        break;
                    }
                    self.current = Some(frame);
                }
                None => break,
            }
        }
        Ok(self.current.clone())
    }

    /// Downloads a hardware frame if needed and normalizes it to NV12 (or RGBA).
    fn convert(&mut self, frame: &ff::frame::Video) -> Result<DecodedFrame, MediaError> {
        let pts = frame.pts().or(frame.timestamp()).unwrap_or(0) as f64 * self.time_base;
        let downloaded;
        let frame = if hw::is_hardware(frame) {
            downloaded = hw::download(frame)?;
            &downloaded
        } else {
            frame
        };
        let color = ColorInfo {
            full_range: frame.color_range() == ff::color::Range::JPEG,
            bt709: !matches!(frame.color_space(), ff::color::Space::BT470BG | ff::color::Space::SMPTE170M),
        };
        let (w, h) = (frame.width(), frame.height());
        if frame.format() == Pixel::NV12 {
            let (y_stride, uv_stride) = (frame.stride(0), frame.stride(1));
            let y = frame.data(0)[..y_stride * h as usize].to_vec();
            let uv = frame.data(1)[..uv_stride * h.div_ceil(2) as usize].to_vec();
            return Ok(DecodedFrame {
                pts,
                width: w,
                height: h,
                format: FrameFormat::Nv12,
                color,
                planes: vec![y, uv],
                strides: vec![y_stride as u32, uv_stride as u32],
            });
        }
        // With transparency (cut-out camera): premultiplied RGBA.
        if has_alpha(frame.format()) {
            let needs_new = self.scaler.as_ref().is_none_or(|(_, f, sw, sh)| *f != frame.format() || *sw != w || *sh != h);
            if needs_new {
                let ctx = ff::software::scaling::Context::get(frame.format(), w, h, Pixel::RGBA, w, h, ff::software::scaling::Flags::BILINEAR)?;
                self.scaler = Some((ctx, frame.format(), w, h));
            }
            let mut out = ff::frame::Video::empty();
            if let Some((scaler, ..)) = &mut self.scaler {
                scaler.run(frame, &mut out)?;
            }
            let stride = out.stride(0);
            let mut rgba = Vec::with_capacity(w as usize * h as usize * 4);
            for row in 0..h as usize {
                let line = &out.data(0)[row * stride..row * stride + w as usize * 4];
                for px in line.chunks_exact(4) {
                    let a = px[3] as u32;
                    rgba.extend([(px[0] as u32 * a / 255) as u8, (px[1] as u32 * a / 255) as u8, (px[2] as u32 * a / 255) as u8, px[3]]);
                }
            }
            return Ok(DecodedFrame { pts, width: w, height: h, format: FrameFormat::Rgba, color, planes: vec![rgba], strides: vec![w * 4] });
        }
        // Anything else (P010, YUV420P, 4:4:4…): convert on the CPU to NV12.
        let needs_new = self.scaler.as_ref().is_none_or(|(_, f, sw, sh)| *f != frame.format() || *sw != w || *sh != h);
        if needs_new {
            let ctx = ff::software::scaling::Context::get(frame.format(), w, h, Pixel::NV12, w, h, ff::software::scaling::Flags::BILINEAR)?;
            self.scaler = Some((ctx, frame.format(), w, h));
        }
        let mut out = ff::frame::Video::empty();
        if let Some((scaler, ..)) = &mut self.scaler {
            scaler.run(frame, &mut out)?;
        }
        let (y_stride, uv_stride) = (out.stride(0), out.stride(1));
        Ok(DecodedFrame {
            pts,
            width: w,
            height: h,
            format: FrameFormat::Nv12,
            color,
            planes: vec![out.data(0)[..y_stride * h as usize].to_vec(), out.data(1)[..uv_stride * h.div_ceil(2) as usize].to_vec()],
            strides: vec![y_stride as u32, uv_stride as u32],
        })
    }
}

fn has_alpha(format: Pixel) -> bool {
    matches!(
        format,
        Pixel::YUVA420P | Pixel::YUVA422P | Pixel::YUVA444P | Pixel::YUVA444P10LE | Pixel::YUVA444P12LE | Pixel::YUVA422P10LE | Pixel::RGBA | Pixel::BGRA | Pixel::ARGB | Pixel::ABGR
    )
}

/// Filmstrip pictures: for each time, the keyframe at or before it (one frame decode each,
/// so a whole strip takes a fraction of a second). RGBA, long side at most `max`.
pub fn keyframe_thumbnails(path: &Path, times: &[f64], max: u32) -> Result<Vec<(u32, u32, Vec<u8>)>, MediaError> {
    let mut decoder = VideoDecoder::open(path, true)?;
    let mut out = Vec::with_capacity(times.len());
    let mut last: Option<(f64, (u32, u32, Vec<u8>))> = None;
    for &t in times {
        decoder.seek(t)?;
        let Some(frame) = decoder.next()? else { break };
        // Several times can share a keyframe: reuse the picture.
        if let Some((pts, image)) = &last
            && (pts - frame.pts).abs() < 1e-6
        {
            out.push(image.clone());
            continue;
        }
        let image = to_rgba(&frame, max)?;
        last = Some((frame.pts, image.clone()));
        out.push(image);
    }
    Ok(out)
}

/// A small RGBA picture of the frame at `t` (filmstrips, posters). `max` bounds the long side.
pub fn thumbnail(path: &Path, t: f64, max: u32) -> Result<(u32, u32, Vec<u8>), MediaError> {
    let mut decoder = VideoDecoder::open(path, false)?;
    let frame = decoder.frame_at(t)?.ok_or(MediaError::NoFrame(t))?;
    to_rgba(&frame, max)
}

/// Converts a decoded frame to RGBA, scaled so its long side is at most `max`.
pub fn to_rgba(frame: &DecodedFrame, max: u32) -> Result<(u32, u32, Vec<u8>), MediaError> {
    let (w, h) = (frame.width, frame.height);
    let k = (max as f64 / w.max(h) as f64).min(1.0);
    let (tw, th) = (((w as f64 * k) as u32).max(2) & !1, ((h as f64 * k) as u32).max(2) & !1);
    let mut src = ff::frame::Video::new(Pixel::NV12, w, h);
    for (i, plane) in frame.planes.iter().enumerate() {
        let stride = src.stride(i);
        let rows = if i == 0 { h as usize } else { h.div_ceil(2) as usize };
        let from = frame.strides[i] as usize;
        let data = src.data_mut(i);
        for r in 0..rows {
            let n = from.min(stride);
            data[r * stride..r * stride + n].copy_from_slice(&plane[r * from..r * from + n]);
        }
    }
    let mut scaler = ff::software::scaling::Context::get(Pixel::NV12, w, h, Pixel::RGBA, tw, th, ff::software::scaling::Flags::AREA)?;
    let mut out = ff::frame::Video::empty();
    scaler.run(&src, &mut out)?;
    let stride = out.stride(0);
    let mut rgba = Vec::with_capacity((tw * th * 4) as usize);
    for r in 0..th as usize {
        rgba.extend_from_slice(&out.data(0)[r * stride..r * stride + (tw * 4) as usize]);
    }
    Ok((tw, th, rgba))
}
