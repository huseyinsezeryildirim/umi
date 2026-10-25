//! Voiceovers mix in at their time and the rest of the sound dips under them.

use umi_engine::Schedule;
use umi_engine::audio_mix::AudioMixer;
use umi_project::Bundle;
use umi_project::edit::Voiceover;

const BUNDLE: &str = "/tmp/umi-fixtures/Real.umi";

fn rms(x: &[f32]) -> f32 {
    (x.iter().map(|s| s * s).sum::<f32>() / x.len().max(1) as f32).sqrt()
}

#[test]
fn voiceover_plays_and_ducks_the_rest() {
    let bundle = std::path::Path::new(BUNDLE);
    if !bundle.exists() {
        return;
    }
    // A 1 s, 440 Hz tone at 24 kHz mono, like Kokoro writes.
    let tone: Vec<i16> = (0..24_000).map(|i| ((i as f32 * 440.0 * std::f32::consts::TAU / 24_000.0).sin() * 0.5 * 32767.0) as i16).collect();
    let file = "voice-test.wav";
    let mut wav = Vec::new();
    let len = (tone.len() * 2) as u32;
    for part in [&b"RIFF"[..], &(36 + len).to_le_bytes(), b"WAVEfmt ", &16u32.to_le_bytes(), &1u16.to_le_bytes(), &1u16.to_le_bytes(), &24_000u32.to_le_bytes(), &48_000u32.to_le_bytes(), &2u16.to_le_bytes(), &16u16.to_le_bytes(), b"data", &len.to_le_bytes()] {
        wav.extend_from_slice(part);
    }
    for s in &tone {
        wav.extend_from_slice(&s.to_le_bytes());
    }
    std::fs::write(bundle.join(file), wav).unwrap();

    let project = Bundle::new(bundle).read_project().unwrap();
    let mut edit = project.effective_edit(None);
    let schedule = Schedule::new(&edit, project.duration);
    let mut plain = AudioMixer::new(bundle, schedule.clone(), &edit).unwrap();
    edit.voiceovers = vec![Voiceover { id: uuid::Uuid::new_v4(), file: file.into(), start: 2.0, end: 3.0, text: "test".into(), volume: 1.0 }];
    let mut voiced = AudioMixer::new(bundle, schedule, &edit).unwrap();

    let mut a = vec![0f32; 48_000 / 2 * 2];
    let mut b = a.clone();
    // Before the voice: identical.
    plain.render(1.0, &mut a).unwrap();
    voiced.render(1.0, &mut b).unwrap();
    assert!(a.iter().zip(&b).all(|(x, y)| (x - y).abs() < 1e-6));
    // During it: the tone is there (≈0.35 RMS).
    plain.render(2.25, &mut a).unwrap();
    voiced.render(2.25, &mut b).unwrap();
    let diff: Vec<f32> = a.iter().zip(&b).map(|(x, y)| y - x * 0.3).collect();
    assert!((rms(&diff) - 0.354).abs() < 0.05, "voice level {}", rms(&diff));
    std::fs::remove_file(bundle.join(file)).ok();
}
