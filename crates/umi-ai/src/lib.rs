//! On-device AI for Umi. Everything runs on the user's computer; models are open (MIT /
//! Apache-2.0) and download once on first use into the app's data folder.

pub mod models;
pub mod transcribe;

#[derive(Debug, thiserror::Error)]
pub enum AiError {
    #[error("download failed: {0}")]
    Download(String),
    #[error("model: {0}")]
    Model(String),
    #[error(transparent)]
    Media(#[from] umi_media::MediaError),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}
