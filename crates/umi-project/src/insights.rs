//! A title, a short summary and chapters from what was said, made on the computer without
//! any model: sentences are scored by how much of the video's vocabulary they carry, and
//! chapters start where the words being used change (lexical cohesion, "TextTiling").

use crate::captions::filler_words;
use crate::edit::CaptionWord;
use crate::project::WindowSpan;
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
    /// The transcript is Turkish (no English joiners around its title).
    #[serde(skip)]
    pub turkish: bool,
}

/// Common words that say little about the topic (English and Turkish, plus a few
/// frequent European ones).
const STOP: &[&str] = &[
    "a",
    "an",
    "the",
    "and",
    "or",
    "but",
    "if",
    "so",
    "to",
    "of",
    "in",
    "on",
    "at",
    "for",
    "with",
    "by",
    "from",
    "as",
    "is",
    "are",
    "was",
    "were",
    "be",
    "been",
    "it",
    "its",
    "this",
    "that",
    "these",
    "those",
    "i",
    "you",
    "we",
    "they",
    "he",
    "she",
    "me",
    "my",
    "your",
    "our",
    "their",
    "them",
    "us",
    "do",
    "does",
    "did",
    "have",
    "has",
    "had",
    "can",
    "will",
    "would",
    "should",
    "could",
    "just",
    "really",
    "very",
    "like",
    "then",
    "there",
    "here",
    "what",
    "which",
    "who",
    "how",
    "when",
    "where",
    "why",
    "not",
    "no",
    "yes",
    "okay",
    "ok",
    "all",
    "some",
    "any",
    "more",
    "most",
    "about",
    "into",
    "out",
    "up",
    "down",
    "now",
    "also",
    "too",
    "going",
    "gonna",
    "want",
    "get",
    "got",
    "let",
    "lets",
    "let's",
    "see",
    "know",
    "think",
    "right",
    "well",
    "one",
    "two",
    "thing",
    "things",
    "way",
    "kind",
    "bir",
    "ve",
    "bu",
    "şu",
    "o",
    "da",
    "de",
    "ki",
    "mi",
    "mı",
    "mu",
    "mü",
    "için",
    "ile",
    "gibi",
    "çok",
    "daha",
    "en",
    "ne",
    "nasıl",
    "neden",
    "ben",
    "sen",
    "biz",
    "siz",
    "onlar",
    "var",
    "yok",
    "olarak",
    "olan",
    "ama",
    "fakat",
    "ya",
    "yani",
    "şey",
    "işte",
    "evet",
    "hayır",
    "şimdi",
    "sonra",
    "önce",
    "kadar",
    "her",
    "bunu",
    "şunu",
    "onu",
    "bunlar",
    "burada",
    "orada",
    "bence",
    "aslında",
    "zaten",
    "hani",
    "tamam",
    "böyle",
    "şöyle",
    "öyle",
    "bize",
    "size",
    "der",
    "die",
    "das",
    "und",
    "ist",
    "le",
    "la",
    "les",
    "et",
    "est",
    "el",
    "los",
    "las",
    "y",
    "es",
    "que",
    "di",
    "il",
    "che",
    "benim",
    "senin",
    "bizim",
    "onun",
    "sizin",
    "kendi",
    "devam",
    "ediyorum",
    "ediyoruz",
    "yapıyorum",
    "yapıyoruz",
    "olacak",
    "oluyor",
    "geliyor",
    "gidiyor",
    "diyorum",
    "bakalım",
    "görüyoruz",
    "burda",
    "şurada",
    "bütün",
    "tüm",
    "ilk",
    "şeyi",
    "şeyler",
    "arkadaşlar",
    "merhaba",
    "selam",
    "gerçekten",
    "biraz",
    "mesela",
    "örneğin",
    "falan",
    "filan",
    "değil",
    "olabilir",
    "lazım",
    "gerekiyor",
    "istiyorum",
    "sizlere",
    "bunun",
    "şunun",
    "onun",
    "geldi",
    "gelecek",
    "oldu",
    "olur",
    "diye",
];

/// Words a spoken opening starts with that don't belong in a title.
const OPENERS: &[&str] = &[
    "hi",
    "hello",
    "hey",
    "so",
    "okay",
    "ok",
    "alright",
    "well",
    "um",
    "uh",
    "and",
    "now",
    "yes",
    "yeah",
    "merhaba",
    "selam",
    "arkadaşlar",
    "evet",
    "şimdi",
    "tamam",
    "evet,",
    "peki",
    "şey",
    "ee",
    "eee",
    "hmm",
    "ve",
    "yani",
    "işte",
    "hani",
];

/// Whether a transcript is Turkish (its titles then don't use English joiners).
fn turkish(sentences: &[Sentence]) -> bool {
    let text: String = sentences.iter().map(|s| s.text.as_str()).collect::<Vec<_>>().join(" ").to_lowercase();
    let marked = text.chars().filter(|c| "çğıöşü".contains(*c)).count();
    let common = text.split_whitespace().filter(|w| ["bir", "ve", "bu", "için", "çok", "ile", "da", "de"].contains(w)).count();
    marked * 40 > text.chars().count().max(1) || common * 12 > text.split_whitespace().count().max(1)
}

/// A title from the sentence that introduces the topic (early, mid-length, on the main
/// vocabulary), without the greeting it starts with: "Umi'nin yeni özelliklerini anlatacağım".
fn topic_sentence(sentences: &[Sentence], ranked: &[(usize, f64)]) -> Option<String> {
    // Openings say what's coming: "… göstereceğim", "I'll show you …".
    const INTENT: &[&str] =
        &["göster", "anlat", "tanıt", "bahsed", "inceley", "show", "walk", "introduc", "demo", "talk about", "explain", "present"];
    let early = ((sentences.len() as f64 * 0.25).ceil() as usize).max(6);
    let mut picks: Vec<(usize, f64)> = ranked
        .iter()
        .filter(|(i, _)| *i < early)
        .map(|&(i, score)| {
            let text = sentences[i].text.to_lowercase();
            let intent = if INTENT.iter().any(|v| text.contains(v)) { 3.0 } else { 1.0 };
            (i, (score + 0.05) * intent * (1.5 - i as f64 / early as f64))
        })
        .collect();
    picks.sort_by(|a, b| b.1.total_cmp(&a.1));
    for (i, _) in picks {
        let mut words: Vec<&str> = sentences[i].text.split_whitespace().collect();
        while words.first().is_some_and(|w| OPENERS.contains(&w.trim_matches(|c: char| c.is_ascii_punctuation()).to_lowercase().as_str())) {
            words.remove(0);
        }
        // A short sentence will do when it says what's coming ("Uygulamayı göstereceğim").
        let intent = INTENT.iter().any(|v| sentences[i].text.to_lowercase().contains(v));
        if !((if intent { 2 } else { 4 })..=16).contains(&words.len()) {
            continue;
        }
        let mut title = String::new();
        for w in words {
            if title.chars().count() + w.chars().count() > 60 {
                title.push('…');
                break;
            }
            if !title.is_empty() {
                title.push(' ');
            }
            title.push_str(w);
        }
        let title = title.trim_end_matches([',', '.', ';', ':', '!']).to_string();
        return Some(capitalize(&title));
    }
    None
}

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

    // Title: the sentence that introduces the topic, else the top keywords as a short phrase.
    let and = if turkish(&sentences) { "ve" } else { "and" };
    let top = keywords(&sentences, &idf, 3);
    let title = topic_sentence(&sentences, &ranked).unwrap_or_else(|| match top.as_slice() {
        [] => "Untitled recording".to_string(),
        [a] => capitalize(a),
        [a, b] => format!("{} {and} {}", capitalize(a), b),
        [a, b, c, ..] => format!("{}, {} {and} {}", capitalize(a), b, c),
    });

    Some(Insights { title, summary, chapters: chapters(&sentences, &idf), turkish: turkish(&sentences) })
}

/// Windows that say nothing about the recording: the system's own, and Umi's.
const NOT_CONTENT: &[&str] = &[
    "umi",
    "dock",
    "window server",
    "windowserver",
    "loginwindow",
    "control center",
    "notification center",
    "spotlight",
    "systemuiserver",
    "program manager",
    "explorer",
    "shellexperiencehost",
    "searchhost",
    "startmenuexperiencehost",
    "gnome-shell",
    "plasmashell",
];

/// Browsers and editors put their own name at the end of a window's title, and unread counts
/// or "edited" marks at the start: what's left is the page or document.
fn clean_window_title(title: &str, app: &str) -> String {
    let mut t = title.trim().trim_start_matches(['●', '•', '*']).trim().to_string();
    if t.starts_with('(') {
        if let Some(end) = t.find(')') {
            if t[1..end].chars().all(|c| c.is_ascii_digit() || c == '+') {
                t = t[end + 1..].trim().to_string();
            }
        }
    }
    for sep in [" — ", " - ", " – ", " | ", " · "] {
        if let Some(i) = t.rfind(sep) {
            let tail = t[i + sep.len()..].trim().to_lowercase();
            let app = app.to_lowercase();
            let known = [
                "google chrome",
                "chrome",
                "firefox",
                "mozilla firefox",
                "safari",
                "microsoft edge",
                "edge",
                "brave",
                "arc",
                "opera",
                "visual studio code",
                "cursor",
            ];
            if !app.is_empty() && (tail == app || app.contains(&tail) || tail.contains(&app)) || known.contains(&tail.as_str()) {
                t = t[..i].trim().to_string();
            }
        }
    }
    t
}

/// A title from what was on screen: the window (or app) that was in front the longest
/// ("Onboarding flow in Figma"), or the two apps that shared the time ("Figma and Safari").
pub fn screen_title(spans: &[WindowSpan], duration: f64) -> Option<String> {
    let mut by_window: Vec<((String, String), f64)> = Vec::new();
    let mut by_app: Vec<(String, f64)> = Vec::new();
    for (i, span) in spans.iter().enumerate() {
        let end = spans.get(i + 1).map_or(duration, |n| n.start).max(span.start);
        let seconds = end - span.start;
        let app = span.app.trim().to_string();
        if NOT_CONTENT.contains(&app.to_lowercase().as_str()) || seconds <= 0.0 {
            continue;
        }
        let title = clean_window_title(&span.title, &app);
        if app.is_empty() && title.is_empty() {
            continue;
        }
        match by_window.iter_mut().find(|(k, _)| k.0 == app && k.1 == title) {
            Some((_, s)) => *s += seconds,
            None => by_window.push(((app.clone(), title), seconds)),
        }
        if !app.is_empty() {
            match by_app.iter_mut().find(|(a, _)| *a == app) {
                Some((_, s)) => *s += seconds,
                None => by_app.push((app, seconds)),
            }
        }
    }
    let total: f64 = by_window.iter().map(|w| w.1).sum();
    if total <= 0.0 {
        return None;
    }
    by_window.sort_by(|a, b| b.1.total_cmp(&a.1));
    by_app.sort_by(|a, b| b.1.total_cmp(&a.1));
    let ((app, title), seconds) = &by_window[0];
    let named = |app: &str, title: &str| -> String {
        let same = title.is_empty() || title.eq_ignore_ascii_case(app);
        let text = if same {
            app.to_string()
        } else if app.is_empty() || title.chars().count() + app.chars().count() > 56 {
            title.to_string()
        } else {
            format!("{title} in {app}")
        };
        text.chars().take(80).collect()
    };
    if *seconds >= 0.5 * total {
        return Some(named(app, title));
    }
    match by_app.as_slice() {
        [(a, s), ..] if *s >= 0.6 * total => Some(a.clone()),
        [(a, _), (b, _), ..] => Some(format!("{a} and {b}")),
        [(a, _)] => Some(a.clone()),
        [] => Some(named(app, title)),
    }
}

/// The app that was in front most of the time, if one was.
fn main_app(spans: &[WindowSpan], duration: f64) -> Option<String> {
    let mut by_app: Vec<(String, f64)> = Vec::new();
    for (i, span) in spans.iter().enumerate() {
        let end = spans.get(i + 1).map_or(duration, |n| n.start).max(span.start);
        let app = span.app.trim();
        if app.is_empty() || NOT_CONTENT.contains(&app.to_lowercase().as_str()) {
            continue;
        }
        match by_app.iter_mut().find(|(a, _)| a == app) {
            Some((_, s)) => *s += end - span.start,
            None => by_app.push((app.to_string(), end - span.start)),
        }
    }
    let total: f64 = by_app.iter().map(|a| a.1).sum();
    by_app.sort_by(|a, b| b.1.total_cmp(&a.1));
    by_app.into_iter().next().filter(|a| total > 0.0 && a.1 >= 0.6 * total).map(|a| a.0)
}

/// The recording's title from what was said and what was on screen: the spoken topic and the
/// app it was shown in ("Revenue, dashboard and report in Safari"), or the screen alone when
/// little was said.
pub fn title(words: &[CaptionWord], spans: &[WindowSpan], duration: f64) -> Option<String> {
    match insights(words) {
        Some(found) => Some(match main_app(spans, duration) {
            // "… in Safari" reads oddly after a Turkish sentence.
            Some(app)
                if !found.turkish
                    && !found.title.to_lowercase().contains(&app.to_lowercase())
                    && found.title.chars().count() + app.chars().count() <= 60 =>
            {
                format!("{} in {app}", found.title)
            }
            _ => found.title,
        }),
        None => screen_title(spans, duration),
    }
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
            [a, b] => format!("{} {} {}", capitalize(a), if turkish(sentences) { "ve" } else { "and" }, b),
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

    fn span(start: f64, app: &str, title: &str) -> WindowSpan {
        WindowSpan { start, app: app.into(), title: title.into() }
    }

    #[test]
    fn names_a_recording_after_the_window_in_front() {
        let spans = [span(0.0, "Umi", ""), span(1.0, "Figma", "Onboarding flow – Figma"), span(50.0, "Slack", "(3) general")];
        assert_eq!(screen_title(&spans, 60.0).as_deref(), Some("Onboarding flow in Figma"));
        let spans = [span(0.0, "Google Chrome", "Pull request #42 · acme/web - Google Chrome")];
        assert_eq!(screen_title(&spans, 10.0).as_deref(), Some("Pull request #42 · acme/web in Google Chrome"));
        let spans = [span(0.0, "Safari", "A"), span(10.0, "Xcode", "B"), span(20.0, "Safari", "C"), span(30.0, "Xcode", "D")];
        assert_eq!(screen_title(&spans, 40.0).as_deref(), Some("Safari and Xcode"));
        assert_eq!(screen_title(&[span(0.0, "", "Quarterly review")], 5.0).as_deref(), Some("Quarterly review"));
        assert_eq!(screen_title(&[span(0.0, "Umi", "Umi")], 5.0), None);
    }

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

    #[test]
    fn titles_come_from_the_opening_that_says_whats_coming() {
        let said = "Selamlar. Merhabalar. Bu ekran kaydını yeni aldım. Uygulamayı göstereceğim. Uygulamayı açtığımızda bütün bilgiler cihazında kalıyor. \
                    Aktivasyon kodu e-postayla geliyor. Aktivasyon kodunu girince uygulama açılıyor. Ayarlardan dili seçebiliyorsun. \
                    Kayıtlar cihazında saklanıyor. Paylaşmak için link alıyorsun. Bu kadar, teşekkürler.";
        let words: Vec<CaptionWord> = said
            .split_whitespace()
            .enumerate()
            .map(|(i, w)| CaptionWord { id: uuid::Uuid::new_v4(), start: i as f64 * 0.5, end: i as f64 * 0.5 + 0.4, text: w.into() })
            .collect();
        let found = insights(&words).unwrap();
        assert_eq!(found.title, "Uygulamayı göstereceğim");
        assert!(found.turkish);
    }
}
