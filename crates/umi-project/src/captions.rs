//! Words spoken in a recording: caption lines, subtitle files, and editing the video by its
//! transcript (cut words, filler words, long pauses).

use crate::edit::CaptionWord;
use crate::timeline::Document;
use uuid::Uuid;

/// Groups caption words into short lines: up to 7 words or 2.6 s, breaking at sentence ends
/// and pauses.
pub fn caption_lines(words: &[CaptionWord]) -> Vec<Vec<CaptionWord>> {
    let mut sorted = words.to_vec();
    sorted.sort_by(|a, b| a.start.total_cmp(&b.start));
    let (mut lines, mut current): (Vec<Vec<CaptionWord>>, Vec<CaptionWord>) = (vec![], vec![]);
    for word in sorted {
        if let Some(first) = current.first() {
            let gap = current.last().is_some_and(|l| word.start - l.end > 0.8);
            if current.len() >= 7 || word.end - first.start > 2.6 || gap {
                lines.push(std::mem::take(&mut current));
            }
        }
        let ends = word.text.ends_with(['.', '?', '!']);
        current.push(word);
        if ends {
            lines.push(std::mem::take(&mut current));
        }
    }
    if !current.is_empty() {
        lines.push(current);
    }
    lines
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SubtitleFormat {
    Srt,
    Vtt,
}

/// Captions as SRT or WebVTT, timed on the edited (output) timeline; lines in cut-out parts
/// are left out.
pub fn subtitles(doc: &Document, format: SubtitleFormat) -> String {
    let stamp = |t: f64| {
        let ms = (t * 1000.0).round() as u64;
        let (h, m, s, f) = (ms / 3_600_000, ms / 60_000 % 60, ms / 1000 % 60, ms % 1000);
        match format {
            SubtitleFormat::Srt => format!("{h:02}:{m:02}:{s:02},{f:03}"),
            SubtitleFormat::Vtt => format!("{h:02}:{m:02}:{s:02}.{f:03}"),
        }
    };
    let mut out = if format == SubtitleFormat::Vtt { "WEBVTT\n\n".to_string() } else { String::new() };
    let mut n = 0;
    for line in caption_lines(&doc.edit.captions.words) {
        let (Some(first), Some(last)) = (line.first(), line.last()) else { continue };
        let (Some(start), Some(end)) = (doc.output_time(first.start), doc.output_time(last.end).or_else(|| doc.output_time(first.start))) else { continue };
        n += 1;
        if format == SubtitleFormat::Srt {
            out += &format!("{n}\n");
        }
        let text: Vec<&str> = line.iter().map(|w| w.text.as_str()).collect();
        out += &format!("{} --> {}\n{}\n\n", stamp(start), stamp(end.max(start + 0.5)), text.join(" "));
    }
    out
}

/// Sounds people make while thinking, in the languages Whisper hears most. Lowercase, no
/// punctuation.
const FILLERS: &[&str] = &[
    // English
    "um", "umm", "uh", "uhh", "uhm", "er", "erm", "ah", "hmm", "mm", "mhm",
    // Turkish
    "ıı", "ııı", "ee", "eee", "eh", "hı", "şey",
    // Spanish, French, German, Portuguese, Italian
    "eh", "ehm", "euh", "äh", "ähm", "hum", "ehh",
];

fn bare(word: &str) -> String {
    word.trim_matches(|c: char| !c.is_alphanumeric()).to_lowercase()
}

/// Filler words ("um", "uh", "şey"…).
pub fn filler_words(words: &[CaptionWord]) -> Vec<Uuid> {
    words.iter().filter(|w| FILLERS.contains(&bare(&w.text).as_str())).map(|w| w.id).collect()
}

/// Silences between words longer than `min` seconds, shortened to `keep` seconds (source
/// time ranges to remove).
pub fn long_pauses(words: &[CaptionWord], min: f64, keep: f64) -> Vec<(f64, f64)> {
    let mut sorted: Vec<&CaptionWord> = words.iter().collect();
    sorted.sort_by(|a, b| a.start.total_cmp(&b.start));
    sorted
        .windows(2)
        .filter_map(|w| {
            let gap = w[1].start - w[0].end;
            (gap > min).then(|| (w[0].end + keep / 2.0, w[1].start - keep / 2.0))
        })
        .collect()
}

impl Document {
    /// Removes recording-time ranges from the video (wherever they are in the edit). Returns
    /// how many seconds of output were removed.
    pub fn cut_source_ranges(&mut self, ranges: &[(f64, f64)]) -> f64 {
        // Map to output time first, then cut from the end so earlier ranges don't move.
        let mut output: Vec<(f64, f64)> = ranges
            .iter()
            .filter_map(|&(a, b)| {
                let start = self.output_time(a)?;
                let end = self.output_time(b).unwrap_or(start);
                (end > start).then_some((start, end))
            })
            .collect();
        output.sort_by(|a, b| b.0.total_cmp(&a.0));
        let before = self.output_duration();
        for range in output {
            self.cut(range);
        }
        before - self.output_duration()
    }

    /// Cuts the given words out of the video (text-based editing). Neighbouring words are
    /// cut together, with the gaps between them.
    pub fn cut_words(&mut self, ids: &[Uuid]) -> f64 {
        let mut words: Vec<&CaptionWord> = self.edit.captions.words.iter().collect();
        words.sort_by(|a, b| a.start.total_cmp(&b.start));
        let mut ranges: Vec<(f64, f64)> = Vec::new();
        let mut previous_cut = false;
        for (i, w) in words.iter().enumerate() {
            let cut = ids.contains(&w.id);
            if cut {
                // Start where the previous word ended (or just before this one).
                let start = if i > 0 { words[i - 1].end.max(w.start - 0.15) } else { (w.start - 0.1).max(0.0) };
                let end = words.get(i + 1).map_or(w.end + 0.1, |n| n.start.min(w.end + 0.15).max(w.end));
                match ranges.last_mut() {
                    Some(last) if previous_cut => last.1 = end,
                    _ => ranges.push((start, end)),
                }
            }
            previous_cut = cut;
        }
        self.cut_source_ranges(&ranges)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::edit::EditSettings;
    use crate::project::{AudioInfo, CursorData, RecordingProject, ScreenInfo};

    fn word(start: f64, end: f64, text: &str) -> CaptionWord {
        CaptionWord { id: Uuid::new_v4(), start, end, text: text.into() }
    }

    fn doc(words: Vec<CaptionWord>) -> Document {
        let project = RecordingProject {
            version: 1,
            created_at: chrono::Utc::now(),
            duration: 10.0,
            screen: ScreenInfo { pixel_width: 1920, pixel_height: 1080, capture_rect: crate::Rect::new(0.0, 0.0, 1920.0, 1080.0), fps: 60 },
            camera: None,
            audio: AudioInfo::default(),
            edit: None,
            camera_only: None,
        };
        let mut edit = EditSettings::default();
        edit.captions.words = words;
        Document::new(project, edit, CursorData::default(), 10.0)
    }

    #[test]
    fn finds_fillers_and_pauses() {
        let words = vec![word(0.0, 0.5, "Hello,"), word(0.6, 0.8, "um,"), word(0.9, 1.2, "Şey"), word(3.5, 4.0, "world.")];
        assert_eq!(filler_words(&words), vec![words[1].id, words[2].id]);
        let pauses = long_pauses(&words, 1.0, 0.4);
        assert_eq!(pauses.len(), 1);
        assert!((pauses[0].0 - 1.4).abs() < 1e-9 && (pauses[0].1 - 3.3).abs() < 1e-9);
    }

    #[test]
    fn cutting_words_shortens_the_video() {
        let words = vec![word(1.0, 1.5, "Hello"), word(1.6, 1.9, "um"), word(2.0, 2.4, "uh"), word(2.5, 3.0, "world")];
        let ids = vec![words[1].id, words[2].id];
        let mut d = doc(words);
        let removed = d.cut_words(&ids);
        // From the end of "Hello" to the start of "world", in one cut.
        assert!((removed - 1.0).abs() < 0.05, "{removed}");
        assert!((d.output_duration() - 9.0).abs() < 0.05);
        assert_eq!(d.edit.clips.len(), 2);
    }

    #[test]
    fn writes_subtitles_on_the_output_timeline() {
        let mut d = doc(vec![word(1.0, 1.5, "Hi."), word(5.0, 5.5, "Bye.")]);
        d.cut((2.0, 4.0));
        let srt = subtitles(&d, SubtitleFormat::Srt);
        assert!(srt.contains("1\n00:00:01,000 --> 00:00:01,500\nHi.") && srt.contains("2\n00:00:03,000 --> 00:00:03,500\nBye."), "{srt}");
        assert!(subtitles(&d, SubtitleFormat::Vtt).starts_with("WEBVTT\n\n00:00:01.000"));
    }
}
