//! Capture for Umi recordings. Each source runs on its own and hands raw data to a
//! [`Sink`] stamped with recording time from one shared [`Clock`]: video frames (NV12 or
//! BGRA), audio (48 kHz stereo f32), and pointer/keyboard events. Writing files is the
//! recorder's job (`umi-media`).
//!
//! Platforms: screen via ScreenCaptureKit (macOS) and Windows Graphics Capture (Windows);
//! microphone via cpal; camera via nokhwa; input via rdev.

pub mod audio;
pub mod camera;
pub mod clock;
pub mod input;
pub mod screen;

pub use clock::Clock;

/// One video frame. Planes borrow the capture API's buffer for the duration of the call.
pub enum Frame<'a> {
    Nv12 { width: u32, height: u32, y: &'a [u8], y_stride: usize, uv: &'a [u8], uv_stride: usize },
    Bgra { width: u32, height: u32, data: &'a [u8], stride: usize },
    Rgba { width: u32, height: u32, data: &'a [u8], stride: usize },
}

impl Frame<'_> {
    pub fn size(&self) -> (u32, u32) {
        match self {
            Frame::Nv12 { width, height, .. } | Frame::Bgra { width, height, .. } | Frame::Rgba { width, height, .. } => (*width, *height),
        }
    }
}

/// Where captured data goes. Called from capture threads; implementations must be quick.
pub trait VideoSink: Send + Sync {
    /// A frame shown at recording time `t` (seconds).
    fn frame(&self, frame: Frame, t: f64);
}

pub trait AudioSink: Send + Sync {
    /// Interleaved 48 kHz stereo samples, the first heard at recording time `t`.
    fn audio(&self, samples: &[f32], t: f64);
}

#[derive(Debug, thiserror::Error)]
pub enum CaptureError {
    #[error(
        "Umi needs permission to record the screen. Allow it in System Settings → Privacy & Security → Screen Recording, then try again."
    )]
    ScreenPermission,
    #[error("Umi needs permission to use the camera.")]
    CameraPermission,
    #[error("Umi needs permission to use the microphone.")]
    MicrophonePermission,
    #[error("{0} isn't available")]
    NotFound(String),
    #[error("screen recording isn't supported on this system yet")]
    Unsupported,
    #[error("{0}")]
    Other(String),
}

/// A display, window or app that can be recorded.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Display {
    pub id: u32,
    pub name: String,
    /// Points (logical pixels) and the pixel scale.
    pub width: f64,
    pub height: f64,
    pub scale: f64,
    /// Top-left in global points.
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Window {
    pub id: u32,
    pub title: String,
    pub app: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// What to record.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum Target {
    Display {
        id: u32,
    },
    Window {
        id: u32,
    },
    /// Part of a display, in that display's points (top-left origin).
    Area {
        display: u32,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
    },
    /// A phone or tablet connected by cable (macOS), by name.
    Device {
        name: String,
    },
}
