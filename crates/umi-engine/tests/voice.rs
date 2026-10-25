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
    let tone: Vec<i16> =
        (0..24_000).map(|i| ((i as f32 * 440.0 * std::f32::consts::TAU / 24_000.0).sin() * 0.5 * 32767.0) as i16).collect();
    let file = "voice-test.wav";
    let mut wav = Vec::new();
    let len = (tone.len() * 2) as u32;
    for part in [
        &b"RIFF"[..],
        &(36 + len).to_le_bytes(),
        b"WAVEfmt ",
        &16u32.to_le_bytes(),
        &1u16.to_le_bytes(),
        &1u16.to_le_bytes(),
        &24_000u32.to_le_bytes(),
        &48_000u32.to_le_bytes(),
        &2u16.to_le_bytes(),
        &16u16.to_le_bytes(),
        b"data",
        &len.to_le_bytes(),
    ] {
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
    edit.voiceovers =
        vec![Voiceover { id: uuid::Uuid::new_v4(), file: file.into(), start: 2.0, end: 3.0, text: "test".into(), volume: 1.0 }];
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

/// Real speech (macOS's own voice) with fan-like noise: the pauses get much quieter while
/// the words stay.
#[test]
fn denoise_keeps_speech_and_removes_noise() {
    if !cfg!(target_os = "macos") {
        return;
    }
    let aiff = std::env::temp_dir().join("umi-denoise.aiff");
    let ok = std::process::Command::new("say")
        .args(["-v", "Samantha", "-o"])
        .arg(&aiff)
        .arg("Hello there. [[slnc 1500]] This is a test of noise removal.")
        .status()
        .is_ok_and(|s| s.success());
    if !ok {
        return;
    }
    let mut reader = umi_media::AudioReader::open(&aiff, 0).unwrap();
    let mut clean = vec![0f32; 48_000 * 2 * 6];
    let n = reader.read(&mut clean).unwrap();
    clean.truncate(n);
    // Add low, rumbling noise (a fan): smoothed white noise.
    let mut seed = 7u32;
    let mut low = 0f32;
    let noisy: Vec<f32> = clean
        .chunks_exact(2)
        .flat_map(|s| {
            seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            let white = (seed >> 9) as f32 / (1 << 23) as f32 * 2.0 - 1.0;
            low = low * 0.9 + white * 0.1;
            let v = s[0] + low * 0.12;
            [v, v]
        })
        .collect();
    let mut out = noisy.clone();
    let mut filter = umi_engine::voice::VoiceFilter::new(true, false);
    for chunk in out.chunks_mut(2 * 1024) {
        filter.process(chunk);
    }
    // The pause: about 1.0–2.2 s in (the say command's silence).
    let frames = |a: f64, b: f64, x: &[f32]| x[(a * 96_000.0) as usize..(b * 96_000.0) as usize].to_vec();
    let speech_level = |x: &[f32]| rms(&frames(0.1, 0.8, x));
    let pause_noise = |x: &[f32]| rms(&frames(1.2, 2.0, x));
    let (before, after) = (pause_noise(&noisy), pause_noise(&out));
    eprintln!("pause noise {before:.4} → {after:.4}; speech {:.4} → {:.4}", speech_level(&noisy), speech_level(&out));
    assert!(after < before * 0.25, "noise {before} → {after}");
    assert!(speech_level(&out) > speech_level(&clean) * 0.5, "speech kept");
}

#[test]
fn click_sounds_land_on_clicks() {
    let bundle = std::path::Path::new(BUNDLE);
    if !bundle.exists() {
        return;
    }
    let b = Bundle::new(bundle);
    let project = b.read_project().unwrap();
    let Some(click) = b.read_cursor().clicks.first().map(|c| c.t) else { return };
    let mut edit = project.effective_edit(None);
    edit.clips.clear();
    let schedule = Schedule::new(&edit, project.duration);
    let mut plain = AudioMixer::new(bundle, schedule.clone(), &edit).unwrap();
    edit.sound.click_sounds = true;
    let mut clicky = AudioMixer::new(bundle, schedule, &edit).unwrap();
    let mut a = vec![0f32; 4800 * 2];
    let mut c = a.clone();
    plain.render(click - 0.01, &mut a).unwrap();
    clicky.render(click - 0.01, &mut c).unwrap();
    let diff: Vec<f32> = a.iter().zip(&c).map(|(x, y)| y - x).collect();
    // Silent before the click, then the click.
    assert!(rms(&diff[..2 * 400]) < 1e-4, "{}", rms(&diff[..800]));
    assert!(rms(&diff[2 * 480..2 * 1500]) > 0.02, "{}", rms(&diff[960..3000]));
}
