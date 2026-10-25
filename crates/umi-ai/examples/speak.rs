//! Speaks text with Kokoro (af_heart) into a WAV file (debugging aid).
//! cargo run --release -p umi-ai --example speak -- out.wav "Text to say."
fn main() {
    let out = std::env::args().nth(1).expect("output .wav");
    let text = std::env::args().nth(2).unwrap_or_else(|| "Hello! This is Umi, recording made simple.".into());
    let t = std::time::Instant::now();
    let mut voice = umi_ai::tts::Voice::load(&|p| eprint!("\rmodel {:.0}%", p * 100.0)).unwrap();
    eprintln!("\nloaded in {:.2}s; phonemes: {}", t.elapsed().as_secs_f64(), voice.phonemes(&text));
    let t = std::time::Instant::now();
    let samples = voice.speak(&text, 1.0).unwrap();
    let seconds = samples.len() as f64 / umi_ai::tts::VOICE_RATE as f64;
    eprintln!("{seconds:.2}s of speech in {:.2}s", t.elapsed().as_secs_f64());
    umi_ai::tts::write_wav(std::path::Path::new(&out), &samples, umi_ai::tts::VOICE_RATE).unwrap();
}
