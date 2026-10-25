//! A recording on disk: a `.umi` folder holding each track separately plus metadata.
//!
//! ```text
//! Umi 2026-10-23 at 20.41.07.umi/
//!   project.json   RecordingProject
//!   screen.mov     screen video (no cursor, no camera) + system audio + mic tracks
//!   camera.mov     camera video, if the camera was on
//!   cursor.json    CursorData
//! ```

use crate::edit::{Camera as CameraStyle, EditSettings, SceneLayout, SceneSegment};
use crate::geometry::{Point, Rect};
use crate::presets::StylePreset;
use crate::serde_util::{iso8601, new_id};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

pub const PROJECT_FILE: &str = "project.json";
pub const SCREEN_FILE: &str = "screen.mov";
pub const CAMERA_FILE: &str = "camera.mov";
pub const CURSOR_FILE: &str = "cursor.json";
pub const SHARE_FILE: &str = "share.json";
pub const BUNDLE_EXTENSION: &str = "umi";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingProject {
    #[serde(default = "version_one")]
    pub version: i64,
    #[serde(with = "iso8601")]
    pub created_at: DateTime<Utc>,
    pub duration: f64,
    pub screen: ScreenInfo,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub camera: Option<CameraInfo>,
    #[serde(default)]
    pub audio: AudioInfo,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub edit: Option<EditSettings>,
    /// Recorded in camera-only mode: the video starts as a full-length Camera Only scene.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub camera_only: Option<bool>,
}

fn version_one() -> i64 {
    1
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenInfo {
    pub pixel_width: u32,
    pub pixel_height: u32,
    /// Captured area in global screen points (top-left origin).
    pub capture_rect: Rect,
    pub fps: u32,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CameraInfo {
    /// Bubble center during recording, normalized to the captured area.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bubble_center: Option<Point>,
    /// Bubble shape, size, mirror and position when recording stopped.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bubble: Option<CameraStyle>,
}

#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioInfo {
    /// Index of each audio track inside screen.mov.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub system_track: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub microphone_track: Option<u32>,
}

impl RecordingProject {
    /// The edit a recording starts with: the default look, with the camera where and how
    /// the bubble was while recording.
    pub fn default_edit(&self, preset: Option<&StylePreset>) -> EditSettings {
        let mut edit = EditSettings::default();
        // New in this app (older files keep zooming out between zooms).
        edit.zoom.glide = true;
        if let Some(preset) = preset {
            preset.apply(&mut edit);
        }
        if let Some(bubble) = self.camera.as_ref().and_then(|c| c.bubble.clone()) {
            edit.camera = bubble;
        } else if let Some(center) = self.camera.as_ref().and_then(|c| c.bubble_center) {
            edit.camera.position = Point::new(center.x.clamp(0.08, 0.92), center.y.clamp(0.1, 0.9));
        }
        if self.camera_only == Some(true) {
            edit.scenes = vec![SceneSegment {
                id: new_id(),
                start: 0.0,
                end: self.duration.max(0.1),
                layout: SceneLayout::CameraOnly,
                transition: 0.0,
            }];
        }
        edit
    }

    /// The saved edit, or the default one for a recording never opened in the editor.
    pub fn effective_edit(&self, preset: Option<&StylePreset>) -> EditSettings {
        self.edit.clone().unwrap_or_else(|| self.default_edit(preset))
    }
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct CursorData {
    #[serde(default)]
    pub moves: Vec<CursorMove>,
    #[serde(default)]
    pub clicks: Vec<CursorClick>,
    /// Key presses (for the keystroke overlay and smart zoom); not in older files.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub keys: Vec<KeyPress>,
}

/// A key press in recording time. `key` is what's shown ("A", "Return", "⌘"); `modifiers`
/// are held keys in display order (e.g. ["⌃", "⌥", "⇧", "⌘"]).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct KeyPress {
    pub t: f64,
    pub key: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub modifiers: Vec<String>,
}

/// Cursor position in recording time, normalized to the captured area (top-left origin).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct CursorMove {
    pub t: f64,
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MouseButton {
    Left,
    Right,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct CursorClick {
    pub t: f64,
    pub x: f64,
    pub y: f64,
    pub button: MouseButton,
}

#[derive(Debug, thiserror::Error)]
pub enum ProjectError {
    #[error("couldn't read {path}: {source}")]
    Io { path: PathBuf, source: io::Error },
    #[error("{path} is not a valid project file: {source}")]
    Json { path: PathBuf, source: serde_json::Error },
}

/// A `.umi` folder on disk.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Bundle {
    pub path: PathBuf,
}

impl Bundle {
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self { path: path.into() }
    }

    pub fn file(&self, name: &str) -> PathBuf {
        self.path.join(name)
    }

    pub fn screen(&self) -> PathBuf {
        self.file(SCREEN_FILE)
    }

    pub fn camera(&self) -> PathBuf {
        self.file(CAMERA_FILE)
    }

    /// Display name: the folder name without `.umi`.
    pub fn name(&self) -> String {
        self.path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default()
    }

    pub fn read_project(&self) -> Result<RecordingProject, ProjectError> {
        read_json(&self.file(PROJECT_FILE))
    }

    pub fn write_project(&self, project: &RecordingProject) -> Result<(), ProjectError> {
        write_json(&self.file(PROJECT_FILE), project)
    }

    /// Cursor data, or empty when the file is missing (e.g. camera-only recordings).
    pub fn read_cursor(&self) -> CursorData {
        read_json(&self.file(CURSOR_FILE)).unwrap_or_default()
    }

    pub fn write_cursor(&self, data: &CursorData) -> Result<(), ProjectError> {
        write_json(&self.file(CURSOR_FILE), data)
    }
}

pub fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> Result<T, ProjectError> {
    let bytes = fs::read(path).map_err(|source| ProjectError::Io { path: path.into(), source })?;
    serde_json::from_slice(&bytes).map_err(|source| ProjectError::Json { path: path.into(), source })
}

/// Pretty JSON written atomically (temp file + rename), like the Swift app's `.atomic`.
pub fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), ProjectError> {
    let json = serde_json::to_vec_pretty(value).map_err(|source| ProjectError::Json { path: path.into(), source })?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, json).and_then(|_| fs::rename(&tmp, path)).map_err(|source| ProjectError::Io { path: path.into(), source })
}
