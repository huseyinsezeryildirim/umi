//! Speech to words with timings (Whisper, on device).

use crate::AiError;
use serde::Serialize;
use std::path::Path;
use umi_media::{AudioReader, CHANNELS, SAMPLE_RATE};
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Word {
    /// Seconds in the recording.
    pub start: f64,
    pub end: f64,
    pub text: String,
}

/// Whisper's input: mono 16 kHz.
const WHISPER_RATE: usize = 16_000;

/// Reads an audio track as mono 16 kHz.
pub fn read_mono_16k(path: &Path, track: usize) -> Result<Vec<f32>, AiError> {
    let mut reader = AudioReader::open(path, track)?;
    let mut out = Vec::new();
    let mut chunk = vec![0f32; SAMPLE_RATE as usize * CHANNELS];
    let step = SAMPLE_RATE as usize / WHISPER_RATE; // 3
    let mut acc = 0f32;
    let mut count = 0usize;
    loop {
        let n = reader.read(&mut chunk)?;
        if n == 0 {
            break;
        }
        for frame in chunk[..n].chunks_exact(CHANNELS) {
            acc += frame.iter().sum::<f32>() / CHANNELS as f32;
            count += 1;
            if count == step {
                out.push(acc / step as f32);
                acc = 0.0;
                count = 0;
            }
        }
    }
    Ok(out)
}

/// Words people say in English whatever language they speak, written as such (not "ea",
/// "fiçırs"): given to Whisper as earlier text, with the names on screen (see [`vocabulary`]).
const COMMON_TERMS: &str = "Umi, AI, app, features, screen recorder, recording, editor, export, share, link, video, camera, demo, dashboard, browser, Chrome, Safari, Mac, Windows, Linux";

/// What to tell Whisper the recording is about: the common terms and the apps and windows
/// that were on screen.
pub fn vocabulary(names: &[String]) -> String {
    let mut out = COMMON_TERMS.to_string();
    for name in names {
        let name = name.trim();
        if name.is_empty() || out.len() + name.len() > 600 || out.to_lowercase().contains(&name.to_lowercase()) {
            continue;
        }
        out.push_str(", ");
        out.push_str(name);
    }
    out.push('.');
    out
}

/// Transcribes `samples` (mono 16 kHz) into words. `language` is a code like "en" or "tr";
/// `None` detects it. `prompt`: words likely to come up (see [`vocabulary`]). `progress` gets 0…1.
pub fn transcribe(
    model: &Path,
    samples: &[f32],
    language: Option<&str>,
    prompt: Option<&str>,
    progress: impl FnMut(i32) + 'static,
) -> Result<(Vec<Word>, String), AiError> {
    whisper_rs::install_logging_hooks();
    let ctx = WhisperContext::new_with_params(model, WhisperContextParameters::default()).map_err(|e| AiError::Model(e.to_string()))?;
    let mut state = ctx.create_state().map_err(|e| AiError::Model(e.to_string()))?;
    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_language(Some(language.unwrap_or("auto")));
    params.set_token_timestamps(true);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_special(false);
    params.set_print_timestamps(false);
    params.set_suppress_blank(true);
    if let Some(prompt) = prompt {
        params.set_initial_prompt(prompt);
    }
    params.set_n_threads(std::thread::available_parallelism().map(|n| n.get().min(8) as i32).unwrap_or(4));
    params.set_progress_callback_safe(progress);
    state.full(params, samples).map_err(|e| AiError::Model(e.to_string()))?;

    let language = whisper_rs::get_lang_str(state.full_lang_id_from_state()).unwrap_or("en").to_string();
    // Words are built from tokens: a token starting with a space starts a new word. Bytes
    // are joined before decoding (a letter like "ı" can span two tokens).
    let mut words: Vec<Word> = Vec::new();
    let mut current: Option<(Vec<u8>, f64, f64)> = None;
    let flush = |current: &mut Option<(Vec<u8>, f64, f64)>, words: &mut Vec<Word>| {
        let Some((bytes, start, end)) = current.take() else { return };
        let text = String::from_utf8_lossy(&bytes).trim().to_string();
        if text.is_empty() {
            return;
        }
        // Sound labels Whisper writes when nobody speaks: "[Music]", "(Müzik)", "♪".
        if text.starts_with(['[', '(', '♪', '*']) || text.ends_with([']', ')']) {
            return;
        }
        // Punctuation on its own joins the word before it.
        if text.chars().all(|c| c.is_ascii_punctuation()) {
            if let Some(last) = words.last_mut() {
                last.text.push_str(&text);
            }
            return;
        }
        words.push(Word { start, end: end.max(start + 0.05), text });
    };
    for segment in state.as_iter() {
        for i in 0..segment.n_tokens() {
            let Some(token) = segment.get_token(i) else { continue };
            let Ok(bytes) = token.to_bytes() else { continue };
            if bytes.starts_with(b"[_") || bytes.starts_with(b"<|") {
                continue;
            }
            let data = token.token_data();
            let (t0, t1) = (data.t0 as f64 / 100.0, data.t1 as f64 / 100.0);
            if bytes.first() == Some(&b' ') || current.is_none() {
                flush(&mut current, &mut words);
                current = Some((bytes.to_vec(), t0, t1));
            } else if let Some((text, _, end)) = current.as_mut() {
                text.extend_from_slice(bytes);
                *end = t1;
            }
        }
        // Segments end on word boundaries.
        flush(&mut current, &mut words);
    }
    Ok((words, language))
}
