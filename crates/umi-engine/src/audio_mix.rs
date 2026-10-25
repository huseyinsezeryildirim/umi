//! The output soundtrack: every kept clip's audio tracks (system + microphone), crossfaded
//! like the video, sped up/slowed down with the clip, and the music bed (looped, faded out
//! at the end). 48 kHz stereo interleaved f32.

use crate::schedule::Schedule;
use crate::stretch::TimeStretch;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use umi_media::{AudioReader, CHANNELS, MediaError, SAMPLE_RATE, audio_streams, duration};
use umi_project::EditSettings;
use umi_project::edit::{Music, Voiceover};

const RATE: f64 = SAMPLE_RATE as f64;

/// A reader that knows where it is, so sequential reads don't seek.
struct Cursor {
    reader: AudioReader,
    position: f64,
    stretch: TimeStretch,
}

pub struct AudioMixer {
    screen: PathBuf,
    tracks: usize,
    /// Readers per (clip set, track): consecutive clips alternate sets so a crossfade can read
    /// two places of the same track at once.
    readers: HashMap<(usize, usize), Cursor>,
    music: Option<(Cursor, f64, Music)>,
    /// Voice track items and a reader for each (opened when first heard).
    voices: Vec<(Voiceover, Option<Cursor>)>,
    schedule: Schedule,
    scratch: Vec<f32>,
}

impl AudioMixer {
    pub fn new(bundle: &Path, schedule: Schedule, edit: &EditSettings) -> Result<Self, MediaError> {
        let music = edit.music.as_ref();
        let screen = bundle.join("screen.mov");
        let tracks = audio_streams(&screen).map(|s| s.len()).unwrap_or(0);
        let music = match music {
            Some(m) => {
                let path = bundle.join(&m.file);
                match (AudioReader::open(&path, 0), duration(&path)) {
                    (Ok(reader), Ok(length)) if length > 0.1 => {
                        Some((Cursor { reader, position: 0.0, stretch: TimeStretch::new() }, length, m.clone()))
                    }
                    _ => None,
                }
            }
            None => None,
        };
        let voices = edit.voiceovers.iter().map(|v| (Voiceover { file: bundle.join(&v.file).to_string_lossy().into_owned(), ..v.clone() }, None)).collect();
        Ok(Self { screen, tracks, readers: HashMap::new(), music, voices, schedule, scratch: vec![] })
    }

    /// Mixes the soundtrack for output time `t0` into `out` (interleaved stereo).
    pub fn render(&mut self, t0: f64, out: &mut [f32]) -> Result<(), MediaError> {
        out.fill(0.0);
        let frames = out.len() / CHANNELS;
        let t1 = t0 + frames as f64 / RATE;
        let fade = self.schedule.crossfade;
        let placements = self.schedule.placements.clone();
        for (i, p) in placements.iter().enumerate() {
            let (a, b) = (t0.max(p.output_start), t1.min(p.output_end()));
            if b <= a {
                continue;
            }
            let offset = ((a - t0) * RATE).round() as usize;
            let count = (((b - a) * RATE).round() as usize).min(frames - offset.min(frames));
            if count == 0 {
                continue;
            }
            let source = p.source_time(a);
            for track in 0..self.tracks {
                self.read_clip(i % 2, track, source, p.clip.speed, count)?;
                for k in 0..count {
                    let t = a + k as f64 / RATE;
                    // Crossfade ramps: in over the start, out over the overlap with the next clip.
                    let mut gain = 1.0;
                    if fade > 0.0 {
                        if i > 0 && t < p.output_start + fade {
                            gain *= ((t - p.output_start) / fade).clamp(0.0, 1.0);
                        }
                        if let Some(next) = placements.get(i + 1)
                            && t > next.output_start
                        {
                            gain *= (1.0 - (t - next.output_start) / fade).clamp(0.0, 1.0);
                        }
                    }
                    for c in 0..CHANNELS {
                        out[(offset + k) * CHANNELS + c] += self.scratch[k * CHANNELS + c] * gain as f32;
                    }
                }
            }
        }
        self.mix_music(t0, out)?;
        self.mix_voices(t0, out)?;
        for s in out.iter_mut() {
            *s = s.clamp(-1.0, 1.0);
        }
        Ok(())
    }

    /// Reads `count` output frames of one track starting at recording time `source` at
    /// `speed` into `self.scratch`.
    fn read_clip(&mut self, set: usize, track: usize, source: f64, speed: f64, count: usize) -> Result<(), MediaError> {
        let cursor = match self.readers.entry((set, track)) {
            std::collections::hash_map::Entry::Occupied(e) => e.into_mut(),
            std::collections::hash_map::Entry::Vacant(e) => {
                let reader = AudioReader::open(&self.screen, track)?;
                e.insert(Cursor { reader, position: f64::NAN, stretch: TimeStretch::new() })
            }
        };
        if !((cursor.position - source).abs() < 0.02) {
            cursor.reader.seek(source)?;
            cursor.stretch.reset();
            cursor.position = source;
        }
        self.scratch.resize(count * CHANNELS, 0.0);
        let consumed = cursor.stretch.process(&mut cursor.reader, speed, &mut self.scratch[..count * CHANNELS])?;
        cursor.position += consumed as f64 / RATE;
        Ok(())
    }

    fn mix_music(&mut self, t0: f64, out: &mut [f32]) -> Result<(), MediaError> {
        let total = self.schedule.duration;
        let Some((cursor, length, music)) = &mut self.music else { return Ok(()) };
        let frames = out.len() / CHANNELS;
        let mut buf = vec![0f32; out.len()];
        // Loop: map output time into the track, seeking when the loop wraps or we jumped.
        let mut written = 0;
        while written < frames {
            let t = t0 + written as f64 / RATE;
            if t >= total {
                break;
            }
            let into = t % *length;
            if !((cursor.position - into).abs() < 0.02) {
                cursor.reader.seek(into)?;
                cursor.position = into;
            }
            let until_wrap = (((*length - into) * RATE) as usize).max(1);
            let n = (frames - written).min(until_wrap);
            let got = cursor.reader.read(&mut buf[written * CHANNELS..(written + n) * CHANNELS])? / CHANNELS;
            cursor.position += got as f64 / RATE;
            if got < n {
                // Reached the end of the file early: start over on the next pass.
                cursor.position = *length;
            }
            written += n;
        }
        let fade = music.fade_out.min(total);
        for k in 0..frames {
            let t = t0 + k as f64 / RATE;
            if t >= total {
                break;
            }
            let mut gain = music.volume;
            if fade > 0.0 && t > total - fade {
                gain *= ((total - t) / fade).clamp(0.0, 1.0);
            }
            for c in 0..CHANNELS {
                out[k * CHANNELS + c] += buf[k * CHANNELS + c] * gain as f32;
            }
        }
        Ok(())
    }

    /// Voiceovers on top; everything else dips to [`DUCK`] while one speaks (eased over
    /// [`DUCK_RAMP`] so it doesn't pump).
    fn mix_voices(&mut self, t0: f64, out: &mut [f32]) -> Result<(), MediaError> {
        if self.voices.is_empty() {
            return Ok(());
        }
        let frames = out.len() / CHANNELS;
        let t1 = t0 + frames as f64 / RATE;
        for k in 0..frames {
            let t = t0 + k as f64 / RATE;
            let near = self
                .voices
                .iter()
                .map(|(v, _)| ((t - (v.start - DUCK_RAMP)) / DUCK_RAMP).min((v.end + DUCK_RAMP - t) / DUCK_RAMP).clamp(0.0, 1.0))
                .fold(0.0, f64::max);
            let gain = 1.0 - (1.0 - DUCK) * near;
            if gain < 1.0 {
                for c in 0..CHANNELS {
                    out[k * CHANNELS + c] *= gain as f32;
                }
            }
        }
        let mut buf = vec![0f32; out.len()];
        for (voice, cursor) in &mut self.voices {
            let (a, b) = (t0.max(voice.start), t1.min(voice.end));
            if b <= a {
                continue;
            }
            if cursor.is_none() {
                *cursor = Some(Cursor { reader: AudioReader::open(Path::new(&voice.file), 0)?, position: f64::NAN, stretch: TimeStretch::new() });
            }
            let Some(cursor) = cursor else { continue };
            let into = a - voice.start;
            if !((cursor.position - into).abs() < 0.02) {
                cursor.reader.seek(into)?;
                cursor.position = into;
            }
            let offset = ((a - t0) * RATE).round() as usize;
            let count = (((b - a) * RATE).round() as usize).min(frames.saturating_sub(offset));
            let got = cursor.reader.read(&mut buf[..count * CHANNELS])? / CHANNELS;
            cursor.position += got as f64 / RATE;
            for k in 0..got {
                for c in 0..CHANNELS {
                    out[(offset + k) * CHANNELS + c] += buf[k * CHANNELS + c] * voice.volume as f32;
                }
            }
        }
        Ok(())
    }
}

/// How loud the rest is under a voiceover, and how long the dip takes.
const DUCK: f64 = 0.3;
const DUCK_RAMP: f64 = 0.25;
