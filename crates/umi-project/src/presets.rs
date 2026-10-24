//! Saved looks: everything about how a recording is dressed, not what's in it (no cuts,
//! zooms, masks or text). One preset can be the default for new recordings.

use crate::edit::{AspectRatio, Background, CameraShape, ColorGrade, CornerStyle, Cursor, DeviceFrame, EditSettings};
use crate::serde_util::{new_id, uuid_upper};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StylePreset {
    #[serde(with = "uuid_upper", default = "new_id")]
    pub id: Uuid,
    pub name: String,
    pub background: Background,
    pub background_angle: f64,
    pub background_noise: f64,
    pub frame: DeviceFrame,
    pub aspect: AspectRatio,
    pub padding: f64,
    pub corner_radius: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub corner_style: Option<CornerStyle>,
    pub shadow: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub border: Option<f64>,
    pub cursor: Cursor,
    pub camera_shape: CameraShape,
    pub camera_size: f64,
    pub camera_mirrored: bool,
    pub grade: ColorGrade,
}

impl StylePreset {
    pub fn from_edit(name: impl Into<String>, edit: &EditSettings) -> Self {
        Self {
            id: new_id(),
            name: name.into(),
            background: edit.background.clone(),
            background_angle: edit.background_angle,
            background_noise: edit.background_noise,
            frame: edit.frame,
            aspect: edit.aspect,
            padding: edit.padding,
            corner_radius: edit.corner_radius,
            corner_style: Some(edit.corner_style),
            shadow: edit.shadow,
            border: Some(edit.border),
            cursor: edit.cursor.clone(),
            camera_shape: edit.camera.shape,
            camera_size: edit.camera.size,
            camera_mirrored: edit.camera.mirrored,
            grade: edit.grade.clone(),
        }
    }

    pub fn apply(&self, edit: &mut EditSettings) {
        edit.background = self.background.clone();
        edit.background_angle = self.background_angle;
        edit.background_noise = self.background_noise;
        edit.frame = self.frame;
        edit.aspect = self.aspect;
        edit.padding = self.padding;
        edit.corner_radius = self.corner_radius;
        edit.corner_style = self.corner_style.unwrap_or_default();
        edit.shadow = self.shadow;
        edit.border = self.border.unwrap_or(0.0);
        edit.cursor = self.cursor.clone();
        edit.camera.shape = self.camera_shape;
        edit.camera.size = self.camera_size;
        edit.camera.mirrored = self.camera_mirrored;
        edit.grade = self.grade.clone();
    }
}

/// All saved presets plus which one is the default (stored in the app's config file).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresetLibrary {
    #[serde(default)]
    pub presets: Vec<StylePreset>,
    #[serde(default, with = "opt_uuid", skip_serializing_if = "Option::is_none")]
    pub default_id: Option<Uuid>,
}

impl PresetLibrary {
    pub fn default_preset(&self) -> Option<&StylePreset> {
        let id = self.default_id?;
        self.presets.iter().find(|p| p.id == id)
    }
}

mod opt_uuid {
    use serde::{Deserialize, Deserializer, Serializer};
    use uuid::Uuid;

    pub fn serialize<S: Serializer>(id: &Option<Uuid>, s: S) -> Result<S::Ok, S::Error> {
        match id {
            Some(id) => super::uuid_upper::serialize(id, s),
            None => s.serialize_none(),
        }
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Option<Uuid>, D::Error> {
        Ok(Option::<String>::deserialize(d)?.and_then(|s| Uuid::parse_str(&s).ok()))
    }
}
