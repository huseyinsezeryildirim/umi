//! Transcribes a recording's audio track and prints the words (debugging aid).
//! cargo run --release -p umi-ai --example transcribe -- <bundle.umi> [track] [lang]
use umi_ai::models::Model;

fn main() {
    let bundle = std::path::PathBuf::from(std::env::args().nth(1).expect("bundle path"));
    let track: usize = std::env::args().nth(2).and_then(|a| a.parse().ok()).unwrap_or(0);
    let lang = std::env::args().nth(3);
    let model = Model::Whisper.ensure(&|p| eprint!("\rmodel {:.0}%", p * 100.0)).unwrap();
    eprintln!();
    let t = std::time::Instant::now();
    let audio = if bundle.extension().is_some_and(|e| e == "umi") { bundle.join("screen.mov") } else { bundle.clone() };
    let samples = umi_ai::transcribe::read_mono_16k(&audio, track).unwrap();
    eprintln!("audio {:.1}s read in {:.2}s", samples.len() as f64 / 16000.0, t.elapsed().as_secs_f64());
    let t = std::time::Instant::now();
    let (words, language) = umi_ai::transcribe::transcribe(&model, &samples, lang.as_deref(), None, |p| eprint!("\r{p}%")).unwrap();
    eprintln!("\n{} words ({language}) in {:.2}s", words.len(), t.elapsed().as_secs_f64());
    for w in words.iter().take(60) {
        println!("{:6.2}-{:6.2} {}", w.start, w.end, w.text);
    }
}
