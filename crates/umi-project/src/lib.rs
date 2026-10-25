//! The Umi project format (`.umi` bundles) and editing model.
//!
//! Pure Rust with no platform dependencies: the desktop app, the web editor (via wasm) and
//! tests all use the same code. JSON stays compatible with projects written by the Swift app.

pub mod captions;
pub mod edit;
pub mod geometry;
pub mod history;
pub mod insights;
pub mod presets;
pub mod project;
pub mod schedule;
pub mod serde_util;
pub mod timeline;
pub mod zoom;

pub use edit::EditSettings;
pub use geometry::{Point, Rect, Size};
pub use history::History;
pub use presets::{PresetLibrary, StylePreset};
pub use project::{Bundle, CursorData, RecordingProject};
pub use timeline::{Document, Placement, Selection};
