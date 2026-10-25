//! A title, a short summary and chapters from what was said, made on the computer without
//! any model: sentences are scored by how much of the video's vocabulary they carry, and
//! chapters start where the words being used change (lexical cohesion, "TextTiling").

use crate::captions::filler_words;
use crate::edit::CaptionWord;
use serde::Serialize;
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Chapter {
    /// Recording time.
    pub start: f64,
    pub title: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Insights {
    pub title: String,
    pub summary: String,
    pub chapters: Vec<Chapter>,
}

/// Common words that say little about the topic (English and Turkish, plus a few
/// frequent European ones).
const STOP: &[&str] = &[
    "a", "an", "the", "and", "or", "but", "if", "so", "to", "of", "in", "on", "at", "for", "with", "by", "from", "as", "is", "are", "was",
    "were", "be", "been", "it", "its", "this", "that", "these", "those", "i", "you", "we", "they", "he", "she", "me", "my", "your", "our",
    "their", "them", "us", "do", "does", "did", "have", "has", "had", "can", "will", "would", "should", "could", "just", "really", "very",
    "like", "then", "there", "here", "what", "which", "who", "how", "when", "where", "why", "not", "no", "yes", "okay", "ok", "all",
    "some", "any", "more", "most", "about", "into", "out", "up", "down", "now", "also", "too", "going", "gonna", "want", "get", "got",
    "let", "lets", "let's", "see", "know", "think", "right", "well", "one", "two", "thing", "things", "way", "kind", "bir", "ve", "bu",
    "şu", "o", "da", "de", "ki", "mi", "mı", "mu", "mü", "için", "ile", "gibi", "çok", "daha", "en", "ne", "nasıl", "neden", "ben", "sen",
    "biz", "siz", "onlar", "var", "yok", "olarak", "olan", "ama", "fakat", "ya", "yani", "şey", "işte", "evet", "hayır", "şimdi", "sonra",
    "önce", "kadar", "her", "bunu", "şunu", "onu", "bunlar", "burada", "orada", "bence", "aslında", "zaten", "hani", "tamam", "böyle",
    "şöyle", "öyle", "bize", "size", "der", "die", "das", "und", "ist", "le", "la", "les", "et", "est", "el", "los", "las", "y", "es",
    "que", "di", "il", "che",
];

fn tokens(text: &str) -> Vec<String> {
    text.split(|c: char| !c.is_alphanumeric() && c != '\'')
        .map(|w| w.trim_matches('\'').to_lowercase())
        .filter(|w| w.chars().count() > 2 && !STOP.contains(&w.as_str()) && !w.chars().all(|c| c.is_numeric()))
        .collect()
}

struct Sentence {
    start: f64,
    text: String,
    tokens: Vec<String>,
}

/// Words joined into sentences (at sentence ends, long pauses and every ~20 words).
fn sentences(words: &[CaptionWord]) -> Vec<Sentence> {
    let fillers: HashSet<_> = filler_words(words).into_iter().collect();
    let mut sorted: Vec<&CaptionWord> = words.iter().filter(|w| !fillers.contains(&w.id)).collect();
    sorted.sort_by(|a, b| a.start.total_cmp(&b.start));
    let mut out = Vec::new();
    let mut current: Vec<&CaptionWord> = Vec::new();
    for (i, w) in sorted.iter().enumerate() {
        current.push(w);
        let gap = sorted.get(i + 1).map_or(10.0, |n| n.start - w.end);
        if w.text.ends_with(['.', '?', '!']) || gap > 1.0 || current.len() >= 22 {
            let text = current.iter().map(|w| w.text.as_str()).collect::<Vec<_>>().join(" ");
            out.push(Sentence { start: current[0].start, tokens: tokens(&text), text });
            current.clear();
        }
    }
    out
}

fn idf(sentences: &[Sentence]) -> HashMap<String, f64> {
    let mut df: HashMap<String, usize> = HashMap::new();
    for s in sentences {
        for t in s.tokens.iter().collect::<HashSet<_>>() {
            *df.entry(t.clone()).or_default() += 1;
        }
    }
    let n = sentences.len().max(1) as f64;
    df.into_iter().map(|(t, d)| (t, (1.0 + n / d as f64).ln())).collect()
}

fn term_counts<'a>(tokens: impl Iterator<Item = &'a String>) -> HashMap<&'a str, f64> {
    let mut tf = HashMap::new();
    for t in tokens {
        *tf.entry(t.as_str()).or_default() += 1.0;
    }
    tf
}

fn cosine(a: &HashMap<&str, f64>, b: &HashMap<&str, f64>) -> f64 {
    let dot: f64 = a.iter().filter_map(|(k, v)| b.get(k).map(|w| v * w)).sum();
    let na: f64 = a.values().map(|v| v * v).sum::<f64>().sqrt();
    let nb: f64 = b.values().map(|v| v * v).sum::<f64>().sqrt();
    if na == 0.0 || nb == 0.0 { 0.0 } else { dot / (na * nb) }
}

/// The most telling words of a stretch, by frequency × rarity overall.
fn keywords(sentences: &[Sentence], idf: &HashMap<String, f64>, n: usize) -> Vec<String> {
    let tf = term_counts(sentences.iter().flat_map(|s| s.tokens.iter()));
    let mut scored: Vec<(&str, f64)> = tf.into_iter().map(|(t, c)| (t, c * idf.get(t).copied().unwrap_or(1.0))).collect();
    scored.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(b.0)));
    scored.into_iter().take(n).map(|(t, _)| t.to_string()).collect()
}

fn capitalize(word: &str) -> String {
    let mut c = word.chars();
    match c.next() {
        Some(f) => f.to_uppercase().chain(c).collect(),
        None => String::new(),
    }
}

fn clean_sentence(text: &str) -> String {
    let t = text.trim().trim_start_matches(|c: char| c == ',' || c == '.').trim();
    let mut s = capitalize(t);
    if !s.ends_with(['.', '?', '!']) {
        s.push('.');
    }
    s
}

/// Title, summary and chapters for a transcript (`None` if there's too little speech).
pub fn insights(words: &[CaptionWord]) -> Option<Insights> {
    let sentences = sentences(words);
    if sentences.len() < 2 || sentences.iter().map(|s| s.tokens.len()).sum::<usize>() < 6 {
        return None;
    }
    let idf = idf(&sentences);
    let doc_tf = term_counts(sentences.iter().flat_map(|s| s.tokens.iter()));
    let doc: HashMap<&str, f64> = doc_tf.iter().map(|(t, c)| (*t, c * idf.get(*t).copied().unwrap_or(1.0))).collect();

    // Sentences that carry the video's main vocabulary.
    let mut ranked: Vec<(usize, f64)> = sentences
        .iter()
        .enumerate()
        .map(|(i, s)| {
            let tf = term_counts(s.tokens.iter());
            let weighted: HashMap<&str, f64> = tf.iter().map(|(t, c)| (*t, c * idf.get(*t).copied().unwrap_or(1.0))).collect();
            let length = s.text.split_whitespace().count() as f64;
            // Mid-length sentences read best; earlier ones usually introduce the topic.
            let shape = if (6.0..=28.0).contains(&length) { 1.0 } else { 0.6 };
            let early = 1.0 + 0.3 * (1.0 - i as f64 / sentences.len() as f64);
            (i, cosine(&weighted, &doc) * shape * early)
        })
        .collect();
    ranked.sort_by(|a, b| b.1.total_cmp(&a.1));

    let summary_count = if sentences.len() > 12 { 3 } else { 2 };
    let mut chosen: Vec<usize> = ranked.iter().take(summary_count).map(|(i, _)| *i).collect();
    chosen.sort();
    let summary = chosen.iter().map(|i| clean_sentence(&sentences[*i].text)).collect::<Vec<_>>().join(" ");

    // Title: the top keywords as a short phrase.
    let top = keywords(&sentences, &idf, 3);
    let title = match top.as_slice() {
        [] => "Untitled recording".to_string(),
        [a] => capitalize(a),
        [a, b] => format!("{} and {}", capitalize(a), b),
        [a, b, c, ..] => format!("{}, {} and {}", capitalize(a), b, c),
    };

    Some(Insights { title, summary, chapters: chapters(&sentences, &idf) })
}

/// Chapter starts where neighbouring stretches stop sharing words.
fn chapters(sentences: &[Sentence], idf: &HashMap<String, f64>) -> Vec<Chapter> {
    let total = sentences.last().map_or(0.0, |s| s.start);
    let mut out = vec![Chapter { start: 0.0, title: "Intro".into() }];
    if sentences.len() < 6 || total < 60.0 {
        return out;
    }
    const W: usize = 3;
    let block = |range: std::ops::Range<usize>| term_counts(sentences[range].iter().flat_map(|s| s.tokens.iter()));
    let gaps: Vec<(usize, f64)> = (W..sentences.len() - W + 1).map(|i| (i, cosine(&block(i - W..i), &block(i..i + W)))).collect();
    let mean = gaps.iter().map(|g| g.1).sum::<f64>() / gaps.len().max(1) as f64;
    let sd = (gaps.iter().map(|g| (g.1 - mean).powi(2)).sum::<f64>() / gaps.len().max(1) as f64).sqrt();
    let mut cuts: Vec<usize> = Vec::new();
    for (k, &(i, score)) in gaps.iter().enumerate() {
        let left = gaps.get(k.wrapping_sub(1)).map_or(1.0, |g| g.1);
        let right = gaps.get(k + 1).map_or(1.0, |g| g.1);
        let start = sentences[i].start;
        let far_enough = cuts.last().map_or(start >= 30.0, |&c| start - sentences[c].start >= 30.0) && total - start >= 20.0;
        if score <= left && score <= right && score < mean - 0.5 * sd && far_enough {
            cuts.push(i);
        }
    }
    let mut bounds = vec![0];
    bounds.extend(cuts.iter().copied());
    bounds.push(sentences.len());
    out.clear();
    for pair in bounds.windows(2) {
        let words = keywords(&sentences[pair[0]..pair[1]], idf, 2);
        let title = match words.as_slice() {
            [a, b] => format!("{} and {}", capitalize(a), b),
            [a] => capitalize(a),
            _ => "Part".into(),
        };
        out.push(Chapter { start: if pair[0] == 0 { 0.0 } else { sentences[pair[0]].start }, title });
    }
    out
}

/// "0:00 Intro" lines, ready for a video description (YouTube reads them as chapters).
pub fn chapter_text(chapters: &[Chapter], output_time: impl Fn(f64) -> Option<f64>) -> String {
    chapters
        .iter()
        .filter_map(|c| {
            let t = output_time(c.start).unwrap_or(c.start);
            Some(format!("{}:{:02} {}", (t / 60.0) as u64, (t % 60.0) as u64, c.title))
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn words(script: &[(f64, &str)]) -> Vec<CaptionWord> {
        let mut out = vec![];
        for (start, sentence) in script {
            for (k, w) in sentence.split_whitespace().enumerate() {
                let t = start + k as f64 * 0.35;
                out.push(CaptionWord { id: uuid::Uuid::new_v4(), start: t, end: t + 0.3, text: w.into() });
            }
        }
        out
    }

    #[test]
    fn finds_title_summary_and_chapters() {
        let mut script = vec![];
        let mut t = 0.0;
        for _ in 0..6 {
            for s in [
                "Today we set up the billing dashboard for your team.",
                "The billing dashboard shows invoices and payments.",
                "You can export invoices from the dashboard.",
            ] {
                script.push((t, s));
                t += 6.0;
            }
        }
        for _ in 0..6 {
            for s in [
                "Next the deployment pipeline builds every commit.",
                "The pipeline runs tests before deployment.",
                "A failed deployment rolls back the release.",
            ] {
                script.push((t, s));
                t += 6.0;
            }
        }
        let i = insights(&words(&script)).unwrap();
        let title = i.title.to_lowercase();
        assert!(title.contains("dashboard") || title.contains("billing") || title.contains("deployment"), "{}", i.title);
        assert!(!i.summary.is_empty());
        assert!(i.chapters.len() >= 2, "{:?}", i.chapters);
        let second = &i.chapters[1];
        assert!((second.start - 108.0).abs() < 25.0, "split near the topic change: {second:?}");
        assert!(second.title.to_lowercase().contains("deployment") || second.title.to_lowercase().contains("pipeline"), "{second:?}");
        let text = chapter_text(&i.chapters, |t| Some(t));
        assert!(text.starts_with("0:00 "));
    }

    #[test]
    fn turkish_too() {
        let script = [
            (0.0, "Bugün yeni kayıt uygulamasını göstereceğim."),
            (5.0, "Kayıt uygulaması ekranı ve kamerayı birlikte kaydediyor."),
            (10.0, "Sonra kaydı düzenleyip paylaşabilirsiniz."),
        ];
        let i = insights(&words(&script)).unwrap();
        assert!(i.title.to_lowercase().contains("kayıt") || i.title.to_lowercase().contains("uygulama"), "{}", i.title);
    }
}
