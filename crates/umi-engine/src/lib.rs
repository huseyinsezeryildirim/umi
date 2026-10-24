//! Umi's playback and export engine: turns a project and its edit into frames and sound,
//! using `umi-media` for decoding/encoding and `umi-render` for drawing.

pub mod audio_mix;
pub mod compose;
pub mod export;
pub mod schedule;
pub mod sources;
pub mod stretch;

pub use compose::Composer;
pub use export::{ExportSettings, Format, export};
pub use schedule::{Moment, Schedule};

#[derive(Debug, thiserror::Error)]
pub enum EngineError {
    #[error(transparent)]
    Project(#[from] umi_project::project::ProjectError),
    #[error(transparent)]
    Media(#[from] umi_media::MediaError),
    #[error(transparent)]
    Gpu(#[from] umi_render::GpuError),
    #[error("cancelled")]
    Cancelled,
}
