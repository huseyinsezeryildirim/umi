//! Every non-destructive edit of a recording (`project.json` → `edit`). The source tracks
//! are never modified. Sizes are fractions (resolution independent); times are recording
//! (source) time unless noted.
//!
//! Decoding is tolerant: a missing or unreadable field falls back to its default.

use crate::geometry::{Point, Rect};
use crate::serde_util::{new_id, tolerant as t, tolerant_option as topt, uuid_upper};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditSettings {
    // Canvas
    #[serde(default, deserialize_with = "t")]
    pub background: Background,
    /// Gradient direction in degrees (0 = left→right, 90 = bottom→top).
    #[serde(default = "d::angle", deserialize_with = "t_angle")]
    pub background_angle: f64,
    /// Film grain over the background, 0…1.
    #[serde(default, deserialize_with = "t")]
    pub background_noise: f64,
    #[serde(default, deserialize_with = "t")]
    pub frame: DeviceFrame,
    #[serde(default, deserialize_with = "t")]
    pub aspect: AspectRatio,
    /// Part of the recording to keep, normalized, top-left origin; `None` = all.
    #[serde(default, deserialize_with = "topt", skip_serializing_if = "Option::is_none")]
    pub crop: Option<Rect>,
    /// Space around the screen, fraction of the canvas' shorter side.
    #[serde(default = "d::padding", deserialize_with = "t_padding")]
    pub padding: f64,
    /// Screen corner radius, fraction of the screen's shorter side.
    #[serde(default = "d::corner_radius", deserialize_with = "t_corner")]
    pub corner_radius: f64,
    #[serde(default, deserialize_with = "t")]
    pub corner_style: CornerStyle,
    /// 0…1
    #[serde(default = "d::shadow", deserialize_with = "t_shadow")]
    pub shadow: f64,
    /// Border width, fraction of the screen's shorter side (0 = none).
    #[serde(default, deserialize_with = "t")]
    pub border: f64,

    #[serde(default, deserialize_with = "t")]
    pub cursor: Cursor,
    #[serde(default, deserialize_with = "t")]
    pub camera: Camera,
    #[serde(default, deserialize_with = "t")]
    pub zoom: Zoom,
    #[serde(default, deserialize_with = "t")]
    pub masks: Vec<PrivacyMask>,
    #[serde(default, deserialize_with = "t")]
    pub scenes: Vec<SceneSegment>,
    #[serde(default, deserialize_with = "t")]
    pub grade: ColorGrade,
    #[serde(default, deserialize_with = "t")]
    pub texts: Vec<TextOverlay>,
    #[serde(default, deserialize_with = "t")]
    pub moves: Vec<CameraMove>,
    #[serde(default, deserialize_with = "t")]
    pub captions: Captions,

    /// Kept parts of the recording, source time, play order. Empty = everything.
    #[serde(default, deserialize_with = "t")]
    pub clips: Vec<Clip>,
    /// Cross-dissolve between consecutive clips in seconds (0 = hard cut).
    #[serde(default, deserialize_with = "t")]
    pub crossfade: f64,
    #[serde(default, deserialize_with = "topt", skip_serializing_if = "Option::is_none")]
    pub music: Option<Music>,
    /// Media track and Video 2 items (output time).
    #[serde(default, deserialize_with = "t")]
    pub overlays: Vec<MediaOverlay>,
    #[serde(default, deserialize_with = "topt", skip_serializing_if = "Option::is_none")]
    pub watermark: Option<Watermark>,
    /// Spoken audio on the Voice track (AI voiceover), output time. Other sound dips
    /// while it plays.
    #[serde(default, deserialize_with = "t", skip_serializing_if = "Vec::is_empty")]
    pub voiceovers: Vec<Voiceover>,
    /// Voice clean-up and levels.
    #[serde(default, deserialize_with = "t", skip_serializing_if = "Sound::is_default")]
    pub sound: Sound,
}

/// How the recording's own sound is treated.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Sound {
    /// Remove background noise (fans, hum, keyboard) from the microphone.
    pub denoise: bool,
    /// Even out the voice: quiet parts up, loud parts down.
    pub level_voice: bool,
    pub microphone_volume: f64,
    pub system_volume: f64,
}

impl Default for Sound {
    fn default() -> Self {
        Self { denoise: false, level_voice: false, microphone_volume: 1.0, system_volume: 1.0 }
    }
}

impl Sound {
    pub fn is_default(&self) -> bool {
        *self == Self::default()
    }
}

// Fields whose default isn't the type's zero value need their own tolerant decoder.
fn t_angle<'de, D: Deserializer<'de>>(d: D) -> Result<f64, D::Error> {
    Ok(topt::<D, f64>(d)?.unwrap_or_else(d::angle))
}
fn t_padding<'de, D: Deserializer<'de>>(d: D) -> Result<f64, D::Error> {
    Ok(topt::<D, f64>(d)?.unwrap_or_else(d::padding))
}
fn t_corner<'de, D: Deserializer<'de>>(d: D) -> Result<f64, D::Error> {
    Ok(topt::<D, f64>(d)?.unwrap_or_else(d::corner_radius))
}
fn t_shadow<'de, D: Deserializer<'de>>(d: D) -> Result<f64, D::Error> {
    Ok(topt::<D, f64>(d)?.unwrap_or_else(d::shadow))
}

/// Default values, shared by `Default` impls and serde.
mod d {
    pub fn angle() -> f64 {
        135.0
    }
    pub fn padding() -> f64 {
        0.08
    }
    pub fn corner_radius() -> f64 {
        0.025
    }
    pub fn shadow() -> f64 {
        0.6
    }
    pub fn yes() -> bool {
        true
    }
    pub fn one() -> f64 {
        1.0
    }
}

impl Default for EditSettings {
    fn default() -> Self {
        Self {
            background: Background::default(),
            background_angle: d::angle(),
            background_noise: 0.0,
            frame: DeviceFrame::None,
            aspect: AspectRatio::Auto,
            crop: None,
            padding: d::padding(),
            corner_radius: d::corner_radius(),
            corner_style: CornerStyle::Rounded,
            shadow: d::shadow(),
            border: 0.0,
            cursor: Cursor::default(),
            camera: Camera::default(),
            zoom: Zoom::default(),
            masks: vec![],
            scenes: vec![],
            grade: ColorGrade::default(),
            texts: vec![],
            moves: vec![],
            captions: Captions::default(),
            clips: vec![],
            crossfade: 0.0,
            music: None,
            overlays: vec![],
            watermark: None,
            voiceovers: vec![],
            sound: Sound::default(),
        }
    }
}

// MARK: Canvas

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CornerStyle {
    #[default]
    Rounded,
    Squircle,
}

#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
pub struct Rgba {
    pub r: f64,
    pub g: f64,
    pub b: f64,
    pub a: f64,
}

impl Rgba {
    pub const fn new(r: f64, g: f64, b: f64) -> Self {
        Self { r, g, b, a: 1.0 }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Background {
    Color(Rgba),
    Gradient(GradientPreset),
    /// An image file: a system wallpaper path or a file copied into the project.
    Image(String),
    /// The recording itself, blurred and dimmed, behind the screen card.
    BlurredScreen,
}

impl Default for Background {
    fn default() -> Self {
        Background::Gradient(GradientPreset::Sky)
    }
}

/// Swift encodes enums with associated values as `{"case": {"_0": value}}`.
impl Serialize for Background {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        use serde_json::json;
        let value = match self {
            Background::Color(c) => json!({ "color": { "_0": c } }),
            Background::Gradient(g) => json!({ "gradient": { "_0": g } }),
            Background::Image(p) => json!({ "image": { "_0": p } }),
            Background::BlurredScreen => json!({ "blurredScreen": {} }),
        };
        value.serialize(s)
    }
}

impl<'de> Deserialize<'de> for Background {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        use serde::de::Error;
        let value = serde_json::Value::deserialize(d)?;
        let obj = value.as_object().ok_or_else(|| D::Error::custom("background must be an object"))?;
        let (key, inner) = obj.iter().next().ok_or_else(|| D::Error::custom("empty background"))?;
        let payload = inner.get("_0").cloned().unwrap_or(serde_json::Value::Null);
        match key.as_str() {
            "color" => Ok(Background::Color(serde_json::from_value(payload).map_err(D::Error::custom)?)),
            "gradient" => Ok(Background::Gradient(serde_json::from_value(payload).map_err(D::Error::custom)?)),
            "image" => Ok(Background::Image(serde_json::from_value(payload).map_err(D::Error::custom)?)),
            "blurredScreen" => Ok(Background::BlurredScreen),
            other => Err(D::Error::custom(format!("unknown background {other}"))),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GradientPreset {
    #[default]
    Sky,
    Ice,
    Navy,
    Graphite,
    Mist,
    Mint,
    Sand,
    Dusk,
    // Earlier presets, still decodable for existing projects.
    Ocean,
    Peach,
    Grape,
    Night,
    Umay,
}

impl GradientPreset {
    /// Presets offered in the editor.
    pub const PICKABLE: [GradientPreset; 8] =
        [Self::Sky, Self::Ice, Self::Navy, Self::Graphite, Self::Mist, Self::Mint, Self::Sand, Self::Dusk];

    pub fn colors(self) -> (Rgba, Rgba) {
        match self {
            Self::Sky => (Rgba::new(0.62, 0.80, 0.98), Rgba::new(0.18, 0.37, 0.72)),
            Self::Ice => (Rgba::new(0.95, 0.97, 0.99), Rgba::new(0.80, 0.88, 0.97)),
            Self::Navy => (Rgba::new(0.18, 0.33, 0.53), Rgba::new(0.06, 0.09, 0.17)),
            Self::Graphite => (Rgba::new(0.25, 0.27, 0.32), Rgba::new(0.06, 0.07, 0.10)),
            Self::Mist => (Rgba::new(0.93, 0.94, 0.96), Rgba::new(0.72, 0.75, 0.81)),
            Self::Dusk => (Rgba::new(0.98, 0.45, 0.42), Rgba::new(0.42, 0.29, 0.86)),
            Self::Ocean => (Rgba::new(0.13, 0.60, 0.95), Rgba::new(0.08, 0.20, 0.55)),
            Self::Mint => (Rgba::new(0.55, 0.93, 0.76), Rgba::new(0.11, 0.55, 0.55)),
            Self::Peach => (Rgba::new(1.00, 0.80, 0.62), Rgba::new(0.96, 0.47, 0.52)),
            Self::Grape => (Rgba::new(0.80, 0.45, 0.95), Rgba::new(0.30, 0.15, 0.60)),
            Self::Night => (Rgba::new(0.20, 0.22, 0.30), Rgba::new(0.05, 0.05, 0.09)),
            Self::Sand => (Rgba::new(0.96, 0.91, 0.82), Rgba::new(0.82, 0.71, 0.58)),
            Self::Umay => (Rgba::new(1.00, 0.62, 0.78), Rgba::new(0.55, 0.78, 1.00)),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AspectRatio {
    #[default]
    Auto,
    Wide,
    Vertical,
    Square,
    Classic,
    Portrait,
}

impl AspectRatio {
    pub const ALL: [AspectRatio; 6] = [Self::Auto, Self::Wide, Self::Vertical, Self::Square, Self::Classic, Self::Portrait];

    pub fn label(self) -> &'static str {
        match self {
            Self::Auto => "Auto",
            Self::Wide => "16:9 Wide",
            Self::Vertical => "9:16 Vertical",
            Self::Square => "1:1 Square",
            Self::Classic => "4:3 Classic",
            Self::Portrait => "4:5 Portrait",
        }
    }

    /// Width / height; `None` = follow the recording.
    pub fn ratio(self) -> Option<f64> {
        match self {
            Self::Auto => None,
            Self::Wide => Some(16.0 / 9.0),
            Self::Vertical => Some(9.0 / 16.0),
            Self::Square => Some(1.0),
            Self::Classic => Some(4.0 / 3.0),
            Self::Portrait => Some(4.0 / 5.0),
        }
    }
}

/// Chrome drawn around the screen.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
pub enum DeviceFrame {
    #[default]
    #[serde(rename = "none")]
    None,
    #[serde(rename = "macOS")]
    MacOs,
    #[serde(rename = "windows")]
    Windows,
    #[serde(rename = "browser")]
    Browser,
    #[serde(rename = "macBook")]
    MacBook,
}

// MARK: Cursor, camera, zoom

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CursorStyle {
    #[default]
    Arrow,
    Dot,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Smoothing {
    Off,
    Slow,
    #[default]
    Smooth,
    Fast,
}

impl Smoothing {
    /// Spring (tension, friction); `None` = raw cursor.
    pub fn spring(self) -> Option<(f64, f64)> {
        match self {
            Self::Off => None,
            Self::Slow => Some((90.0, 20.0)),
            Self::Smooth => Some((170.0, 26.0)),
            Self::Fast => Some((400.0, 40.0)),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Cursor {
    #[serde(default = "d::yes", deserialize_with = "t_true")]
    pub visible: bool,
    /// Multiplier on the system cursor size.
    #[serde(default = "cursor_size", deserialize_with = "t_cursor_size")]
    pub size: f64,
    #[serde(default, deserialize_with = "t")]
    pub smoothing: Smoothing,
    #[serde(default = "d::yes", deserialize_with = "t_true")]
    pub click_rings: bool,
    #[serde(default, deserialize_with = "t")]
    pub style: CursorStyle,
    /// Ghost trail when the cursor moves fast.
    #[serde(default = "d::yes", deserialize_with = "t_true")]
    pub motion_blur: bool,
    /// Fade the cursor out after it rests for a moment.
    #[serde(default, deserialize_with = "t")]
    pub hide_when_idle: bool,
}

fn cursor_size() -> f64 {
    1.5
}
fn t_true<'de, D: Deserializer<'de>>(d: D) -> Result<bool, D::Error> {
    Ok(topt::<D, bool>(d)?.unwrap_or(true))
}
fn t_cursor_size<'de, D: Deserializer<'de>>(d: D) -> Result<f64, D::Error> {
    Ok(topt::<D, f64>(d)?.unwrap_or_else(cursor_size))
}

impl Default for Cursor {
    fn default() -> Self {
        Self {
            visible: true,
            size: 1.5,
            smoothing: Smoothing::Smooth,
            click_rings: true,
            style: CursorStyle::Arrow,
            motion_blur: true,
            hide_when_idle: false,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CameraShape {
    #[default]
    Circle,
    Squircle,
    Square,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Camera {
    pub visible: bool,
    pub shape: CameraShape,
    /// Diameter, fraction of the canvas' shorter side.
    pub size: f64,
    /// Center, normalized to the canvas (top-left origin).
    pub position: Point,
    pub mirrored: bool,
}

impl Default for Camera {
    fn default() -> Self {
        Self { visible: true, shape: CameraShape::Circle, size: 0.24, position: Point::new(0.14, 0.80), mirrored: true }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Zoom {
    /// Generate zoom segments from clicks.
    pub auto: bool,
    pub scale: f64,
    /// Manual segments; with `auto` on they're added to the generated ones.
    pub segments: Vec<ZoomSegment>,
    /// What generated zooms come from (missing in older files: clicks).
    #[serde(default, skip_serializing_if = "is_default")]
    pub trigger: ZoomTrigger,
    /// How fast zooms ease in and out and the view pans.
    #[serde(default, skip_serializing_if = "is_default")]
    pub speed: ZoomSpeed,
    /// What a cursor-following zoom looks at.
    #[serde(default, skip_serializing_if = "is_default")]
    pub follow: ZoomFollow,
    /// Stay zoomed and glide between zooms that are close together instead of zooming
    /// out and back in (missing in older files: off).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub glide: bool,
}

fn is_default<T: Default + PartialEq>(v: &T) -> bool {
    *v == T::default()
}

/// Where generated zooms come from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ZoomTrigger {
    /// Every group of clicks, at the chosen scale.
    #[default]
    Clicks,
    /// Clicks and typing, each zoomed just enough to fit the area the cursor works in.
    Smart,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ZoomSpeed {
    Slow,
    #[default]
    Normal,
    Fast,
}

impl ZoomSpeed {
    /// Seconds to ease in (and out).
    pub fn ramp(self) -> f64 {
        match self {
            Self::Slow => 0.85,
            Self::Normal => 0.5,
            Self::Fast => 0.3,
        }
    }
    /// Spring (tension, friction) of the point the view follows.
    pub fn spring(self) -> (f64, f64) {
        match self {
            Self::Slow => (14.0, 7.5),
            Self::Normal => (30.0, 11.0),
            Self::Fast => (70.0, 17.0),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ZoomFollow {
    /// Glide after the cursor.
    #[default]
    Cursor,
    /// Hold still and pan smoothly to each click.
    Clicks,
}

impl Default for Zoom {
    fn default() -> Self {
        Self { auto: true, scale: 1.8, segments: vec![], trigger: ZoomTrigger::Clicks, speed: ZoomSpeed::Normal, follow: ZoomFollow::Cursor, glide: false }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ZoomSegment {
    #[serde(with = "uuid_upper", default = "new_id")]
    pub id: Uuid,
    pub start: f64,
    pub end: f64,
    pub scale: f64,
    /// Fixed focus (normalized screen, top-left origin); `None` = follow the cursor.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub focus: Option<Point>,
}

impl ZoomSegment {
    pub const SCALE_RANGE: (f64, f64) = (1.0, 4.5);
}

// MARK: Privacy

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MaskStyle {
    #[default]
    Blur,
    Pixelate,
    Highlight,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrivacyMask {
    #[serde(with = "uuid_upper", default = "new_id")]
    pub id: Uuid,
    pub start: f64,
    pub end: f64,
    /// Area on the screen, normalized, top-left origin.
    pub rect: Rect,
    #[serde(default)]
    pub style: MaskStyle,
    /// Blur radius / pixel size / dimming, 0…1.
    #[serde(default = "mask_amount")]
    pub amount: f64,
    /// Where the mask is over time (moved by hand or by tracking). Empty = always `rect`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub keyframes: Vec<MaskKeyframe>,
    /// Stuck to the content under it: the keyframes come from tracking and are redone when
    /// the mask is moved.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub follow: bool,
}

/// The mask's rect at a recording time.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct MaskKeyframe {
    pub t: f64,
    pub rect: Rect,
}

impl PrivacyMask {
    /// The rect at recording time `t`: interpolated between keyframes (smoothly eased),
    /// held before the first and after the last.
    pub fn rect_at(&self, t: f64) -> Rect {
        let k = &self.keyframes;
        let (Some(first), Some(last)) = (k.first(), k.last()) else { return self.rect };
        if t <= first.t {
            return first.rect;
        }
        if t >= last.t {
            return last.rect;
        }
        let i = k.partition_point(|f| f.t <= t).saturating_sub(1);
        let (a, b) = (k[i], k[(i + 1).min(k.len() - 1)]);
        let span = (b.t - a.t).max(1e-6);
        let x = ((t - a.t) / span).clamp(0.0, 1.0);
        // Dense keyframes (tracking) interpolate linearly; sparse ones (hand-placed) ease.
        let f = if span < 0.2 { x } else { x * x * (3.0 - 2.0 * x) };
        let l = |p: f64, q: f64| p + (q - p) * f;
        Rect::new(
            l(a.rect.min_x(), b.rect.min_x()),
            l(a.rect.min_y(), b.rect.min_y()),
            l(a.rect.width(), b.rect.width()),
            l(a.rect.height(), b.rect.height()),
        )
    }

    /// Sets the rect at `t`: a keyframe if the mask moves, else the fixed rect.
    pub fn set_rect_at(&mut self, t: f64, rect: Rect) {
        if self.keyframes.is_empty() {
            self.rect = rect;
            return;
        }
        match self.keyframes.iter_mut().find(|f| (f.t - t).abs() < 1.0 / 60.0) {
            Some(f) => f.rect = rect,
            None => {
                self.keyframes.push(MaskKeyframe { t, rect });
                self.keyframes.sort_by(|a, b| a.t.total_cmp(&b.t));
            }
        }
    }
}

fn mask_amount() -> f64 {
    0.6
}

// MARK: Scenes

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SceneLayout {
    #[default]
    Default,
    CameraOnly,
    HideCamera,
    SplitScreen,
    Floating,
}

impl SceneLayout {
    pub fn label(self) -> &'static str {
        match self {
            Self::Default => "Default",
            Self::CameraOnly => "Camera Only",
            Self::HideCamera => "Hide Camera",
            Self::SplitScreen => "Split Screen",
            Self::Floating => "Floating",
        }
    }
}

/// A stretch with its own screen/camera layout. Outside every segment the layout is
/// `Default`. Changes animate over `transition` seconds.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneSegment {
    #[serde(with = "uuid_upper", default = "new_id")]
    pub id: Uuid,
    pub start: f64,
    pub end: f64,
    pub layout: SceneLayout,
    #[serde(default = "scene_transition")]
    pub transition: f64,
}

fn scene_transition() -> f64 {
    0.4
}

// MARK: Color

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GradePreset {
    #[default]
    None,
    Cinematic,
    Noir,
    Vintage,
    Frost,
    Golden,
    Midnight,
    Vivid,
    Dreamy,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ColorGrade {
    pub preset: GradePreset,
    /// −1…1
    pub exposure: f64,
    pub contrast: f64,
    pub saturation: f64,
    /// 0…1
    pub vignette: f64,
    pub grain: f64,
}

// MARK: Text

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TextStyle {
    Title,
    LowerThird,
    Kicker,
    BigStat,
    Quote,
    Typewriter,
}

impl TextStyle {
    pub const ALL: [TextStyle; 6] = [Self::Title, Self::LowerThird, Self::Kicker, Self::BigStat, Self::Quote, Self::Typewriter];

    pub fn label(self) -> &'static str {
        match self {
            Self::Title => "Title",
            Self::LowerThird => "Lower Third",
            Self::Kicker => "Kicker",
            Self::BigStat => "Big Stat",
            Self::Quote => "Quote",
            Self::Typewriter => "Typewriter",
        }
    }

    /// Placeholder text, detail line and anchor for a new item of this style.
    pub fn template(self) -> (&'static str, &'static str, Point) {
        match self {
            Self::Title => ("Your title", "", Point::new(0.5, 0.45)),
            Self::LowerThird => ("Your Name", "Your role", Point::new(0.24, 0.82)),
            Self::Kicker => ("New", "", Point::new(0.5, 0.14)),
            Self::BigStat => ("42%", "faster onboarding", Point::new(0.5, 0.45)),
            Self::Quote => ("Simple things should be simple", "Alan Kay", Point::new(0.5, 0.45)),
            Self::Typewriter => ("Type something…", "", Point::new(0.5, 0.2)),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TextAnimation {
    Fade,
    #[default]
    Slide,
    Pop,
    Typewriter,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextOverlay {
    #[serde(with = "uuid_upper", default = "new_id")]
    pub id: Uuid,
    pub start: f64,
    pub end: f64,
    pub style: TextStyle,
    pub text: String,
    /// Secondary line (lower third role, stat caption, quote author).
    #[serde(default)]
    pub detail: String,
    /// Anchor, normalized to the canvas (top-left origin).
    pub position: Point,
    #[serde(default)]
    pub animation: TextAnimation,
}

// MARK: 3D

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MoveKind {
    Glide,
    Unfold,
    PullBack,
}

impl MoveKind {
    pub fn label(self) -> &'static str {
        match self {
            Self::Glide => "Glide across",
            Self::Unfold => "Unfold",
            Self::PullBack => "Pull back",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CameraMove {
    #[serde(with = "uuid_upper", default = "new_id")]
    pub id: Uuid,
    pub start: f64,
    pub end: f64,
    pub kind: MoveKind,
}

// MARK: Captions

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Captions {
    pub enabled: bool,
    pub words: Vec<CaptionWord>,
    pub language: String,
    /// Text height, fraction of the canvas height.
    pub size: f64,
    /// Vertical center of the caption line, normalized (top-left origin).
    pub position: f64,
    pub highlight_active_word: bool,
}

impl Default for Captions {
    fn default() -> Self {
        Self { enabled: false, words: vec![], language: "en-US".into(), size: 0.045, position: 0.86, highlight_active_word: true }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptionWord {
    #[serde(with = "uuid_upper", default = "new_id")]
    pub id: Uuid,
    pub start: f64,
    pub end: f64,
    pub text: String,
}

// MARK: Clips and audio

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Clip {
    pub start: f64,
    pub end: f64,
    /// Playback speed, 0.25…8.
    #[serde(default = "d::one", deserialize_with = "t_speed")]
    pub speed: f64,
}

fn t_speed<'de, D: Deserializer<'de>>(d: D) -> Result<f64, D::Error> {
    Ok(topt::<D, f64>(d)?.unwrap_or(1.0))
}

impl Clip {
    pub const fn new(start: f64, end: f64, speed: f64) -> Self {
        Self { start, end, speed }
    }
    pub fn duration(&self) -> f64 {
        self.end - self.start
    }
    /// Length on the output timeline.
    pub fn output_duration(&self) -> f64 {
        self.duration() / self.speed
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MediaKind {
    Video,
    Image,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OverlayMode {
    /// Covers the screen (B-roll); background and camera stay visible.
    #[default]
    Fill,
    /// A card on top of the screen.
    PictureInPicture,
}

/// A spoken audio file on the Voice track, timed on the output timeline.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Voiceover {
    #[serde(with = "uuid_upper", default = "new_id")]
    pub id: Uuid,
    /// Audio file inside the project bundle.
    pub file: String,
    pub start: f64,
    pub end: f64,
    /// What it says (AI voiceover script).
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub text: String,
    #[serde(default = "d::one")]
    pub volume: f64,
}

/// A video or image on the Media track (or Video 2). Timed on the output timeline, so it
/// stays put when the recording underneath is cut.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaOverlay {
    #[serde(with = "uuid_upper", default = "new_id")]
    pub id: Uuid,
    /// File name inside the project bundle.
    pub file: String,
    pub kind: MediaKind,
    /// Output time.
    pub start: f64,
    pub end: f64,
    /// Where in the overlay video playback starts.
    #[serde(default)]
    pub media_offset: f64,
    #[serde(default)]
    pub mode: OverlayMode,
    /// Picture-in-picture card: center (normalized canvas, top-left origin) and width.
    #[serde(default = "pip_center")]
    pub center: Point,
    #[serde(default = "pip_width")]
    pub width: f64,
    /// 2 = Video 2 track (parts of this recording laid over the main video); `None` = Media.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lane: Option<i64>,
}

fn pip_center() -> Point {
    Point::new(0.72, 0.3)
}
fn pip_width() -> f64 {
    0.4
}

impl MediaOverlay {
    pub fn new(file: impl Into<String>, kind: MediaKind, start: f64, end: f64) -> Self {
        Self {
            id: new_id(),
            file: file.into(),
            kind,
            start,
            end,
            media_offset: 0.0,
            mode: OverlayMode::Fill,
            center: pip_center(),
            width: pip_width(),
            lane: None,
        }
    }

    pub fn is_video2(&self) -> bool {
        self.lane == Some(2)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Corner {
    TopLeft,
    TopRight,
    BottomLeft,
    #[default]
    BottomRight,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Watermark {
    /// Image file inside the project bundle.
    pub file: String,
    #[serde(default)]
    pub corner: Corner,
    /// Width, fraction of the canvas width.
    #[serde(default = "watermark_size")]
    pub size: f64,
    #[serde(default = "watermark_opacity")]
    pub opacity: f64,
}

fn watermark_size() -> f64 {
    0.12
}
fn watermark_opacity() -> f64 {
    0.85
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Music {
    /// File name inside the project bundle.
    pub file: String,
    /// Display name (library tracks); the file name otherwise.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default = "music_volume")]
    pub volume: f64,
    /// Fade the music out over the last seconds.
    #[serde(default = "music_fade")]
    pub fade_out: f64,
}

fn music_volume() -> f64 {
    0.35
}
fn music_fade() -> f64 {
    2.0
}

/// Anything with a start and end on the source timeline.
pub trait TimedItem {
    fn id(&self) -> Uuid;
    fn start(&self) -> f64;
    fn end(&self) -> f64;
    fn set_range(&mut self, start: f64, end: f64);
}

macro_rules! timed {
    ($($t:ty),*) => {$(
        impl TimedItem for $t {
            fn id(&self) -> Uuid { self.id }
            fn start(&self) -> f64 { self.start }
            fn end(&self) -> f64 { self.end }
            fn set_range(&mut self, start: f64, end: f64) { self.start = start; self.end = end; }
        }
    )*};
}
timed!(ZoomSegment, PrivacyMask, SceneSegment, TextOverlay, CameraMove);
