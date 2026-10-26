//! ONNX Runtime: one environment for the app; sessions use Core ML on Macs (Neural Engine /
//! GPU) and the CPU elsewhere.

use crate::AiError;
use ort::environment::Environment;
use ort::session::Session;
use std::path::Path;
use std::sync::OnceLock;

fn environment() -> Result<&'static Environment, AiError> {
    static ENV: OnceLock<Environment> = OnceLock::new();
    if let Some(env) = ENV.get() {
        return Ok(env);
    }
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    let init = ort::init_from(dylib()).map_err(|e| AiError::Model(e.to_string()))?;
    #[cfg(not(all(target_os = "macos", target_arch = "x86_64")))]
    let init = ort::init();
    let env = init.with_name("umi").with_telemetry(false).build().map_err(|e| AiError::Model(e.to_string()))?;
    Ok(ENV.get_or_init(|| env))
}

/// Intel Macs: ONNX Runtime from the app bundle, or Homebrew's when running a development build.
#[cfg(all(target_os = "macos", target_arch = "x86_64"))]
fn dylib() -> std::path::PathBuf {
    let bundled = std::env::current_exe().ok().and_then(|exe| Some(exe.parent()?.join("../Frameworks/libonnxruntime.dylib")));
    match bundled {
        Some(path) if path.exists() => path,
        _ => "/usr/local/opt/onnxruntime/lib/libonnxruntime.dylib".into(),
    }
}

/// Loads a model for inference.
pub fn session(model: &Path) -> Result<Session, AiError> {
    let err = |e: ort::Error| AiError::Model(e.to_string());
    let builder = Session::builder(environment()?).map_err(err)?;
    #[cfg(target_os = "macos")]
    let builder = builder.with_execution_providers([ort::ep::CoreML::default().build()]).map_err(|e| AiError::Model(e.to_string()))?;
    let mut builder = builder;
    builder.commit_from_file(model).map_err(err)
}
