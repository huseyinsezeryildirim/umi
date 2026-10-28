//! Transcribes speech made with macOS's own voices (skipped elsewhere or without the model).

use umi_ai::models::Model;

fn speech(voice: &str, text: &str) -> Option<std::path::PathBuf> {
    if !cfg!(target_os = "macos") || !Model::Whisper.is_ready() {
        return None;
    }
    let dir = std::env::temp_dir();
    let aiff = dir.join(format!("umi-say-{voice}.aiff"));
    let ok = std::process::Command::new("say").args(["-v", voice, "-o"]).arg(&aiff).arg(text).status().ok()?.success();
    ok.then_some(aiff)
}

#[test]
fn english_words_with_timings_and_fillers() {
    let Some(audio) = speech("Samantha", "Hello everyone. Um, today I want to show you, uh, how the new recorder works.") else { return };
    let samples = umi_ai::transcribe::read_mono_16k(&audio, 0).unwrap();
    let (words, language) = umi_ai::transcribe::transcribe(&Model::Whisper.path(), &samples, None, None, |_| {}).unwrap();
    assert_eq!(language, "en");
    let text: Vec<String> = words.iter().map(|w| w.text.to_lowercase()).collect();
    assert!(text.iter().any(|w| w.starts_with("hello")) && text.iter().any(|w| w.starts_with("recorder")), "{text:?}");
    assert!(text.iter().any(|w| w.starts_with("um")), "fillers kept: {text:?}");
    assert!(words.windows(2).all(|w| w[0].start <= w[1].start), "in order");
    assert!(words.last().unwrap().end > 4.0 && words.last().unwrap().end < 8.0);
}

#[test]
fn turkish() {
    let Some(audio) = speech("Yelda", "Merhaba arkadaşlar. Bugün size yeni uygulamayı göstereceğim.") else { return };
    let samples = umi_ai::transcribe::read_mono_16k(&audio, 0).unwrap();
    let (words, language) = umi_ai::transcribe::transcribe(&Model::Whisper.path(), &samples, Some("tr"), None, |_| {}).unwrap();
    assert_eq!(language, "tr");
    let text = words.iter().map(|w| w.text.to_lowercase()).collect::<Vec<_>>().join(" ");
    assert!(text.contains("merhaba") && text.contains("göstereceğim"), "{text}");
}
