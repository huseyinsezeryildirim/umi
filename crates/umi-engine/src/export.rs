//! Export: decodes, renders and encodes on three threads at once (bounded queues keep memory
//! flat), mixes the soundtrack, and writes MP4/MOV (hardware H.264 + AAC) or a GIF.

use crate::EngineError;
use crate::audio_mix::AudioMixer;
use crate::compose::{Prepared, draw, open_source};
use crossbeam_channel::bounded;
use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use umi_media::{CHANNELS, Container, Encoder, EncoderSettings, GifWriter, SAMPLE_RATE, VideoCodec};
use umi_project::EditSettings;
use umi_project::timeline::render_size;
use umi_render::{Gpu, Renderer};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Format {
    Mp4,
    Mov,
    Gif,
    /// MP4 that can be uploaded while it's written (see `Container::StreamingMp4`).
    StreamingMp4,
}

#[derive(Debug, Clone)]
pub struct ExportSettings {
    pub format: Format,
    /// Short side in pixels: 720, 1080, 1440 or 2160 (GIF caps at 540).
    pub resolution: u32,
    pub fps: u32,
    pub hardware: bool,
}

enum Sink {
    Video { encoder: Box<Encoder>, mixer: Box<AudioMixer> },
    Gif(GifWriter),
}

/// Renders `edit` of the recording at `bundle` to `destination`. `progress` gets 0…1;
/// setting `cancel` stops early (the partial file is removed).
pub fn export(
    gpu: Arc<Gpu>,
    bundle: &Path,
    edit: EditSettings,
    settings: &ExportSettings,
    destination: &Path,
    progress: &(dyn Fn(f64) + Sync),
    cancel: &AtomicBool,
) -> Result<(), EngineError> {
    let (mut source, project, cursor) = open_source(bundle, &edit, settings.hardware)?;
    let mut renderer = Renderer::new(gpu, project.clone(), edit.clone(), cursor, Some(bundle.to_path_buf()));
    let is_gif = settings.format == Format::Gif;
    let fps = if is_gif { 15 } else { settings.fps.max(1) };
    let short = if is_gif { settings.resolution.min(540) } else { settings.resolution };
    let size = render_size(&project, &edit, short);
    let duration = source.schedule.duration;
    let frames = ((duration * fps as f64).round() as usize).max(1);
    let _ = std::fs::remove_file(destination);

    let mut sink = if is_gif {
        Sink::Gif(GifWriter::create(destination, size.0, size.1, fps as f64)?)
    } else {
        let encoder_settings = EncoderSettings {
            width: size.0,
            height: size.1,
            fps,
            codec: VideoCodec::H264,
            container: match settings.format {
                Format::Mov => Container::Mov,
                Format::StreamingMp4 => Container::StreamingMp4,
                _ => Container::Mp4,
            },
            bit_rate: 0,
            audio: true,
            hardware: settings.hardware,
        };
        let encoder = Box::new(Encoder::create(destination, &encoder_settings)?);
        let mixer = Box::new(AudioMixer::new(bundle, source.schedule.clone(), &edit)?);
        Sink::Video { encoder, mixer }
    };

    // decode → render → encode, each on its own thread.
    let (prepared_tx, prepared_rx) = bounded::<Result<Prepared, EngineError>>(4);
    let (pixels_tx, pixels_rx) = bounded::<Vec<u8>>(3);
    let failed = AtomicBool::new(false);
    let result = std::thread::scope(|scope| -> Result<(), EngineError> {
        let failed = &failed;
        let source = &mut source;
        // Moved in, so the channel closes when decoding ends.
        let decode = scope.spawn(move || {
            for i in 0..frames {
                if cancel.load(Ordering::Relaxed) || failed.load(Ordering::Relaxed) {
                    break;
                }
                let prepared = source.prepare(i as f64 / fps as f64).map_err(EngineError::from);
                if prepared_tx.send(prepared).is_err() {
                    break;
                }
            }
        });
        let encode = scope.spawn(|| -> Result<(), EngineError> {
            let samples_per_frame = SAMPLE_RATE as f64 / fps as f64;
            let mut audio = vec![];
            let mut audio_done = 0usize;
            for (i, rgba) in pixels_rx.iter().enumerate() {
                match &mut sink {
                    Sink::Gif(gif) => gif.push_rgba(&rgba)?,
                    Sink::Video { encoder, mixer } => {
                        encoder.push_rgba(&rgba)?;
                        let target = ((i + 1) as f64 * samples_per_frame).round() as usize;
                        audio.resize((target - audio_done) * CHANNELS, 0.0);
                        mixer.render(audio_done as f64 / SAMPLE_RATE as f64, &mut audio)?;
                        encoder.push_audio(&audio)?;
                        audio_done = target;
                    }
                }
                progress((i + 1) as f64 / frames as f64);
            }
            if let Sink::Video { encoder, .. } = sink {
                encoder.finish()?;
            }
            Ok(())
        });

        let mut render_result = Ok(());
        for prepared in prepared_rx.iter() {
            if cancel.load(Ordering::Relaxed) {
                render_result = Err(EngineError::Cancelled);
                break;
            }
            let prepared = match prepared {
                Ok(p) => p,
                Err(e) => {
                    render_result = Err(e);
                    break;
                }
            };
            draw(&mut renderer, &prepared, size);
            match renderer.read_rgba() {
                Ok(rgba) => {
                    if pixels_tx.send(rgba).is_err() {
                        break;
                    }
                }
                Err(e) => {
                    render_result = Err(e.into());
                    break;
                }
            }
        }
        if render_result.is_err() {
            failed.store(true, Ordering::Relaxed);
        }
        drop(prepared_rx);
        drop(pixels_tx);
        let _ = decode.join();
        let encoded = encode.join().unwrap_or(Err(EngineError::Cancelled));
        render_result.and(encoded)
    });
    if result.is_err() {
        let _ = std::fs::remove_file(destination);
    }
    result
}
