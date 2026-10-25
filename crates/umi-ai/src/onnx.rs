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
    let env = ort::init().with_name("umi").with_telemetry(false).build().map_err(|e| AiError::Model(e.to_string()))?;
    Ok(ENV.get_or_init(|| env))
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
