//! Natural voiceover from text, on device: Kokoro-82M (Apache-2.0) with the `af_heart`
//! voice, run with ONNX Runtime (Core ML on Macs). English text is turned into phonemes by
//! misaki (Kokoro's own G2P, embedded).

use crate::AiError;
use crate::models::Model;
use ort::session::Session;
use ort::value::Tensor;
use std::path::Path;

/// Kokoro's output rate.
pub const VOICE_RATE: u32 = 24_000;
/// Longest phoneme sequence the model takes (plus the two padding tokens).
const MAX_TOKENS: usize = 500;
/// Floats per style vector.
const STYLE: usize = 256;

/// Kokoro's phoneme vocabulary (from the model's config).
const VOCAB: &[(char, i64)] = &[
    (';', 1),
    (':', 2),
    (',', 3),
    ('.', 4),
    ('!', 5),
    ('?', 6),
    ('—', 9),
    ('…', 10),
    ('"', 11),
    ('(', 12),
    (')', 13),
    ('“', 14),
    ('”', 15),
    (' ', 16),
    ('̃', 17),
    ('ʣ', 18),
    ('ʥ', 19),
    ('ʦ', 20),
    ('ʨ', 21),
    ('ᵝ', 22),
    ('ꭧ', 23),
    ('A', 24),
    ('I', 25),
    ('O', 31),
    ('Q', 33),
    ('S', 35),
    ('T', 36),
    ('W', 39),
    ('Y', 41),
    ('ᵊ', 42),
    ('a', 43),
    ('b', 44),
    ('c', 45),
    ('d', 46),
    ('e', 47),
    ('f', 48),
    ('h', 50),
    ('i', 51),
    ('j', 52),
    ('k', 53),
    ('l', 54),
    ('m', 55),
    ('n', 56),
    ('o', 57),
    ('p', 58),
    ('q', 59),
    ('r', 60),
    ('s', 61),
    ('t', 62),
    ('u', 63),
    ('v', 64),
    ('w', 65),
    ('x', 66),
    ('y', 67),
    ('z', 68),
    ('ɑ', 69),
    ('ɐ', 70),
    ('ɒ', 71),
    ('æ', 72),
    ('β', 75),
    ('ɔ', 76),
    ('ɕ', 77),
    ('ç', 78),
    ('ɖ', 80),
    ('ð', 81),
    ('ʤ', 82),
    ('ə', 83),
    ('ɚ', 85),
    ('ɛ', 86),
    ('ɜ', 87),
    ('ɟ', 90),
    ('ɡ', 92),
    ('ɥ', 99),
    ('ɨ', 101),
    ('ɪ', 102),
    ('ʝ', 103),
    ('ɯ', 110),
    ('ɰ', 111),
    ('ŋ', 112),
    ('ɳ', 113),
    ('ɲ', 114),
    ('ɴ', 115),
    ('ø', 116),
    ('ɸ', 118),
    ('θ', 119),
    ('œ', 120),
    ('ɹ', 123),
    ('ɾ', 125),
    ('ɻ', 126),
    ('ʁ', 128),
    ('ɽ', 129),
    ('ʂ', 130),
    ('ʃ', 131),
    ('ʈ', 132),
    ('ʧ', 133),
    ('ʊ', 135),
    ('ʋ', 136),
    ('ʌ', 138),
    ('ɣ', 139),
    ('ɤ', 140),
    ('χ', 142),
    ('ʎ', 143),
    ('ʒ', 147),
    ('ʔ', 148),
    ('ˈ', 156),
    ('ˌ', 157),
    ('ː', 158),
    ('ʰ', 162),
    ('ʲ', 164),
    ('↓', 169),
    ('→', 171),
    ('↗', 172),
    ('↘', 173),
    ('ᵻ', 177),
];

/// misaki-rs writes diphthongs and affricates as two symbols joined by U+200D; Kokoro reads
/// them as single symbols (as Python misaki writes them).
fn normalize(phonemes: &str) -> String {
    const PAIRS: &[(&str, &str)] = &[
        ("a\u{200d}ɪ", "I"),
        ("e\u{200d}ɪ", "A"),
        ("a\u{200d}ʊ", "W"),
        ("ɔ\u{200d}ɪ", "Y"),
        ("o\u{200d}ʊ", "O"),
        ("ə\u{200d}ʊ", "Q"),
        ("d\u{200d}ʒ", "ʤ"),
        ("t\u{200d}ʃ", "ʧ"),
    ];
    let mut out = phonemes.to_string();
    for (from, to) in PAIRS {
        out = out.replace(from, to);
    }
    // Other joined pairs (e.g. "ʊ‍ɹ") are read as their two symbols; collapse doubled spaces.
    out = out.replace('\u{200d}', "");
    let mut collapsed = String::with_capacity(out.len());
    for c in out.chars() {
        if !(c == ' ' && collapsed.ends_with(' ')) {
            collapsed.push(c);
        }
    }
    collapsed.replace(" .", ".").replace(" !", "!").replace(" ?", "?").replace(" ,", ",").trim().to_string()
}

fn token(c: char) -> Option<i64> {
    VOCAB.iter().find(|(k, _)| *k == c).map(|(_, v)| *v)
}

/// A loaded voice, ready to speak.
pub struct Voice {
    session: Session,
    /// 510 style vectors; the one used depends on the phoneme count.
    styles: Vec<f32>,
    g2p: misaki_rs::G2P,
}

impl Voice {
    /// Loads Kokoro and the af_heart voice, downloading them on first use.
    pub fn load(progress: &dyn Fn(f64)) -> Result<Voice, AiError> {
        let model = Model::Kokoro.ensure(&|p| progress(p * 0.95))?;
        let voice = Model::KokoroVoices.ensure(&|p| progress(0.95 + p * 0.05))?;
        Self::from_files(&model, &voice)
    }

    pub fn from_files(model: &Path, voice: &Path) -> Result<Voice, AiError> {
        let bytes = std::fs::read(voice)?;
        let styles: Vec<f32> = bytes.chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect();
        if styles.len() < STYLE * 2 {
            return Err(AiError::Model("voice file is too small".into()));
        }
        let session = crate::onnx::session(model)?;
        let g2p = misaki_rs::G2P::with_fallback(misaki_rs::Language::EnglishUS, Some(Box::new(Phonics::new())));
        Ok(Voice { session, styles, g2p })
    }

    /// Phonemes for English text (what Kokoro reads).
    pub fn phonemes(&self, text: &str) -> String {
        normalize(&self.g2p.g2p(text).map(|(p, _)| p).unwrap_or_default())
    }

    /// Speaks `text` at `speed` (1 = normal): mono f32 at [`VOICE_RATE`].
    pub fn speak(&mut self, text: &str, speed: f32) -> Result<Vec<f32>, AiError> {
        let mut out = Vec::new();
        for sentence in sentences(text) {
            let phonemes = self.phonemes(&sentence);
            let ids: Vec<i64> = phonemes.chars().filter_map(token).collect();
            for chunk in split_tokens(&ids) {
                if !out.is_empty() {
                    // A short breath between sentences.
                    out.extend(std::iter::repeat_n(0.0, VOICE_RATE as usize / 7));
                }
                out.extend(self.infer(chunk, speed)?);
            }
        }
        Ok(out)
    }

    fn infer(&mut self, ids: &[i64], speed: f32) -> Result<Vec<f32>, AiError> {
        let mut input = Vec::with_capacity(ids.len() + 2);
        input.push(0);
        input.extend_from_slice(ids);
        input.push(0);
        // The voice's style for an utterance of this length.
        let rows = self.styles.len() / STYLE;
        let row = ids.len().min(rows - 1);
        let style = self.styles[row * STYLE..(row + 1) * STYLE].to_vec();
        let n = input.len();
        let err = |e: ort::Error| AiError::Model(e.to_string());
        let outputs = self
            .session
            .run(ort::inputs![
                "input_ids" => Tensor::from_array(([1usize, n], input)).map_err(err)?,
                "style" => Tensor::from_array(([1usize, STYLE], style)).map_err(err)?,
                "speed" => Tensor::from_array(([1usize], vec![speed])).map_err(err)?,
            ])
            .map_err(err)?;
        let (_, data) = outputs[0].try_extract_tensor::<f32>().map_err(err)?;
        Ok(data.to_vec())
    }
}

/// Words the dictionary doesn't know (names, brands, new words): read like an English
/// speaker would sound them out, using known pieces of the word where possible ("Woomy" →
/// "woo" + "my") and phonics for the rest. Short all-caps words are spelled (API, MCP).
pub struct Phonics {
    lexicon: misaki_rs::Lexicon,
}

/// Names that matter to us, as they're said.
const OWN_WORDS: &[(&str, &str)] = &[("umi", "ˈumi"), ("umadaos", "ˈumədˌɑOs"), ("loom", "lˈum"), ("kokoro", "kəkˈɔɹO")];

/// Letter groups and their usual sounds, longest first.
const GRAPHEMES: &[(&str, &str)] = &[
    ("tion", "ʃən"),
    ("igh", "I"),
    ("sch", "sk"),
    ("tch", "ʧ"),
    ("sh", "ʃ"),
    ("ch", "ʧ"),
    ("th", "θ"),
    ("ph", "f"),
    ("ng", "ŋ"),
    ("ck", "k"),
    ("qu", "kw"),
    ("wh", "w"),
    ("oo", "u"),
    ("ee", "i"),
    ("ea", "i"),
    ("ai", "A"),
    ("ay", "A"),
    ("oa", "O"),
    ("ou", "W"),
    ("ow", "O"),
    ("oi", "Y"),
    ("oy", "Y"),
    ("au", "ɔ"),
    ("aw", "ɔ"),
    ("ie", "i"),
    ("ue", "u"),
    ("a", "æ"),
    ("e", "ɛ"),
    ("i", "ɪ"),
    ("o", "ɑ"),
    ("u", "u"),
    ("y", "i"),
    ("b", "b"),
    ("c", "k"),
    ("d", "d"),
    ("f", "f"),
    ("g", "ɡ"),
    ("h", "h"),
    ("j", "ʤ"),
    ("k", "k"),
    ("l", "l"),
    ("m", "m"),
    ("n", "n"),
    ("p", "p"),
    ("q", "k"),
    ("r", "ɹ"),
    ("s", "s"),
    ("t", "t"),
    ("v", "v"),
    ("w", "w"),
    ("x", "ks"),
    ("z", "z"),
];

const VOWELS: &str = "aeiouæɛɪɑʌəɔʊiuAIOWYQɜɚ";

fn letter_name(c: char) -> Option<&'static str> {
    const NAMES: [&str; 26] = [
        "ˈA",
        "bˈi",
        "sˈi",
        "dˈi",
        "ˈi",
        "ˈɛf",
        "ʤˈi",
        "ˈAʧ",
        "ˈI",
        "ʤˈA",
        "kˈA",
        "ˈɛl",
        "ˈɛm",
        "ˈɛn",
        "ˈO",
        "pˈi",
        "kjˈu",
        "ˈɑɹ",
        "ˈɛs",
        "tˈi",
        "jˈu",
        "vˈi",
        "dˈʌbəlju",
        "ˈɛks",
        "wˈI",
        "zˈi",
    ];
    let i = (c.to_ascii_lowercase() as u32).checked_sub('a' as u32)? as usize;
    NAMES.get(i).copied()
}

impl Phonics {
    pub fn new() -> Self {
        Self { lexicon: misaki_rs::Lexicon::new(misaki_rs::Language::EnglishUS) }
    }

    fn known(&self, piece: &str) -> Option<String> {
        self.lexicon.lookup(piece, "NN", None, None).map(|(p, _)| p)
    }

    /// Phonemes for an unknown word.
    pub fn sound_out(&self, word: &str) -> String {
        let lower = word.to_lowercase();
        if let Some((_, p)) = OWN_WORDS.iter().find(|(w, _)| *w == lower) {
            return (*p).to_string();
        }
        let letters: Vec<char> = lower.chars().filter(|c| c.is_alphabetic()).collect();
        if letters.is_empty() {
            return String::new();
        }
        if word.chars().all(|c| !c.is_alphabetic() || c.is_uppercase()) && letters.len() <= 5 {
            // An acronym: letter names.
            return letters.iter().filter_map(|c| letter_name(*c)).collect::<Vec<_>>().join(" ");
        }
        // Cheapest cover of the word: dictionary pieces (3+ letters) cost 1, letter sounds 3.
        let n = letters.len();
        let mut best: Vec<Option<(u32, usize, String)>> = vec![None; n + 1];
        best[0] = Some((0, 0, String::new()));
        for i in 0..n {
            let Some((cost, _, _)) = best[i].clone() else { continue };
            let consider = |j: usize, c: u32, ps: String, best: &mut Vec<Option<(u32, usize, String)>>| {
                if best[j].as_ref().is_none_or(|b| cost + c < b.0) {
                    best[j] = Some((cost + c, i, ps));
                }
            };
            for j in (i + 3)..=n {
                let piece: String = letters[i..j].iter().collect();
                if let Some(ps) = self.known(&piece) {
                    consider(j, 1, ps, &mut best);
                }
            }
            for (g, ps) in GRAPHEMES {
                let g: Vec<char> = g.chars().collect();
                if letters[i..].starts_with(&g) {
                    // A final "e" after a consonant is silent.
                    let silent = g == ['e'] && i + 1 == n && i > 0 && !"aeiou".contains(letters[i - 1]);
                    consider(i + g.len(), 3, if silent { String::new() } else { (*ps).to_string() }, &mut best);
                }
            }
        }
        let mut pieces = Vec::new();
        let mut at = n;
        while at > 0 {
            let Some((_, from, ps)) = best[at].clone() else { break };
            pieces.push(ps);
            at = from;
        }
        pieces.reverse();
        // One stress, on the first vowel.
        let plain: String = pieces.concat().chars().filter(|c| *c != 'ˈ' && *c != 'ˌ').collect();
        match plain.char_indices().find(|(_, c)| VOWELS.contains(*c)) {
            Some((k, _)) => format!("{}ˈ{}", &plain[..k], &plain[k..]),
            None => plain,
        }
    }
}

impl Default for Phonics {
    fn default() -> Self {
        Self::new()
    }
}

impl misaki_rs::Fallback for Phonics {
    fn phonemize(&self, word: &str) -> Result<String, misaki_rs::fallback::FallbackError> {
        Ok(self.sound_out(word))
    }
}

/// Splits text at sentence ends (keeping the punctuation) so each piece fits the model.
fn sentences(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut current = String::new();
    for c in text.chars() {
        current.push(c);
        if matches!(c, '.' | '!' | '?' | '\n') && current.trim().len() > 1 {
            out.push(current.trim().to_string());
            current.clear();
        }
    }
    if !current.trim().is_empty() {
        out.push(current.trim().to_string());
    }
    out
}

/// Very long sentences: split at spaces (token 16) under the model's limit.
fn split_tokens(ids: &[i64]) -> Vec<&[i64]> {
    let mut out = Vec::new();
    let mut rest = ids;
    while rest.len() > MAX_TOKENS {
        let cut = rest[..MAX_TOKENS].iter().rposition(|t| *t == 16).filter(|p| *p > 0).unwrap_or(MAX_TOKENS);
        out.push(&rest[..cut]);
        rest = &rest[cut..];
    }
    if !rest.is_empty() {
        out.push(rest);
    }
    out
}

/// Writes mono f32 samples as a 16-bit WAV file.
pub fn write_wav(path: &Path, samples: &[f32], rate: u32) -> Result<(), AiError> {
    let data_len = (samples.len() * 2) as u32;
    let mut bytes = Vec::with_capacity(44 + data_len as usize);
    bytes.extend_from_slice(b"RIFF");
    bytes.extend_from_slice(&(36 + data_len).to_le_bytes());
    bytes.extend_from_slice(b"WAVEfmt ");
    bytes.extend_from_slice(&16u32.to_le_bytes());
    bytes.extend_from_slice(&1u16.to_le_bytes()); // PCM
    bytes.extend_from_slice(&1u16.to_le_bytes()); // mono
    bytes.extend_from_slice(&rate.to_le_bytes());
    bytes.extend_from_slice(&(rate * 2).to_le_bytes());
    bytes.extend_from_slice(&2u16.to_le_bytes());
    bytes.extend_from_slice(&16u16.to_le_bytes());
    bytes.extend_from_slice(b"data");
    bytes.extend_from_slice(&data_len.to_le_bytes());
    for s in samples {
        bytes.extend_from_slice(&((s.clamp(-1.0, 1.0) * 32767.0) as i16).to_le_bytes());
    }
    std::fs::write(path, bytes)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_sentences_and_long_token_runs() {
        assert_eq!(sentences("Hi there. How are you? Fine"), vec!["Hi there.", "How are you?", "Fine"]);
        let ids: Vec<i64> = (0..1200).map(|i| if i % 10 == 0 { 16 } else { 43 }).collect();
        let parts = split_tokens(&ids);
        assert!(parts.iter().all(|p| p.len() <= MAX_TOKENS) && parts.iter().map(|p| p.len()).sum::<usize>() == 1200);
    }

    #[test]
    fn sounds_out_unknown_words() {
        let p = Phonics::new();
        assert_eq!(p.sound_out("Umi"), "ˈumi");
        assert_eq!(p.sound_out("API"), "ˈA pˈi ˈI");
        let woomy = p.sound_out("Woomy");
        assert!(!woomy.contains(' ') && woomy.contains('m'), "{woomy}");
        let g2p = misaki_rs::G2P::with_fallback(misaki_rs::Language::EnglishUS, Some(Box::new(Phonics::new())));
        let said = normalize(&g2p.g2p("Welcome to Umi, the Zorblax recorder.").unwrap().0);
        assert!(said.contains("ˈumi") && !said.contains("zˈi"), "{said}");
    }

    #[test]
    fn phonemes_are_in_the_vocabulary() {
        let g2p = misaki_rs::G2P::new(misaki_rs::Language::EnglishUS);
        let (p, _) = g2p.g2p("Welcome to Umi. Record your screen in seconds!").unwrap();
        let p = normalize(&p);
        assert!(p.contains('I'), "{p}");
        let unknown: Vec<char> = p.chars().filter(|c| token(*c).is_none()).collect();
        assert!(unknown.is_empty(), "{p} → {unknown:?}");
    }
}
