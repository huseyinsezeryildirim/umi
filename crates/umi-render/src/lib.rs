//! Umi's compositor: one GPU renderer behind the editor preview and the export, on every
//! platform, so what you see is exactly what you get.
//!
//! - [`plan`] decides *what* to draw each frame (pure, testable).
//! - [`gpu`] draws it with wgpu (Metal, Direct3D 12, Vulkan, WebGPU).
//! - [`raster`] draws chrome, text and the cursor on the CPU, cached.

pub mod gpu;
pub mod math;
pub mod motion;
pub mod ops;
pub mod plan;
pub mod raster;
pub mod scene;

pub use gpu::executor_types::{PixelData, VideoFrame};
pub use gpu::{Gpu, GpuError};

use ops::{Draw, Fill, Homography, Mask, Op, Target, TexRef};
use plan::{FrameInputs, FramePlanner};
use raster::{FrameAssets, RasterCache};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use umi_project::{CursorData, EditSettings, RecordingProject, Rect};
use uuid::Uuid;

/// One moment of the recording to draw.
#[derive(Default)]
pub struct FrameRequest<'a> {
    /// Recording (source) time.
    pub time: f64,
    /// Output (timeline) time, for Media-track items.
    pub output_time: Option<f64>,
    pub screen: Option<VideoFrame<'a>>,
    pub camera: Option<VideoFrame<'a>>,
    /// Media-track / Video 2 video frames by overlay id.
    pub overlays: Vec<(Uuid, VideoFrame<'a>)>,
}

pub struct Renderer {
    gpu: Arc<Gpu>,
    planner: FramePlanner,
    exec: gpu::Executor,
    rasters: Arc<RasterCache>,
    bundle: Option<PathBuf>,
    cursor: CursorData,
    ops: Vec<Op>,
    /// The face's path when it doesn't come from the bundle (the browser has no files).
    faces: Vec<umi_project::project::FaceKey>,
}

impl Renderer {
    pub fn new(gpu: Arc<Gpu>, project: RecordingProject, edit: EditSettings, cursor: CursorData, bundle: Option<PathBuf>) -> Self {
        let mut planner = FramePlanner::new(project, edit, &cursor, true);
        planner.faces = bundle.as_ref().map(|b| umi_project::Bundle::new(b).read_face_track()).unwrap_or_default();
        Self {
            planner,
            exec: gpu::Executor::new(gpu.clone()),
            gpu,
            rasters: Arc::new(RasterCache::default()),
            bundle,
            cursor,
            ops: Vec::new(),
            faces: Vec::new(),
        }
    }

    pub fn gpu(&self) -> &Arc<Gpu> {
        &self.gpu
    }

    /// Applies a new edit (cheap: the GPU resources and caches are kept).
    pub fn set_edit(&mut self, edit: EditSettings) {
        let project = self.planner.project.clone();
        let flag = self.planner.apply_zoom_and_moves;
        self.planner = FramePlanner::new(project, edit, &self.cursor, flag);
        // Re-read: the face path may have just been made.
        let read = self.bundle.as_ref().map(|b| umi_project::Bundle::new(b).read_face_track()).unwrap_or_default();
        self.planner.faces = if read.is_empty() { self.faces.clone() } else { read };
    }

    /// The face's path in the camera video (for keeping it framed), given directly.
    pub fn set_faces(&mut self, faces: Vec<umi_project::project::FaceKey>) {
        self.faces = faces.clone();
        self.planner.faces = faces;
    }

    /// Zoom and 3D moves on/off (the editor turns them off while placing masks or a focus).
    pub fn set_apply_zoom_and_moves(&mut self, on: bool) {
        self.planner.apply_zoom_and_moves = on;
    }

    pub fn edit(&self) -> &EditSettings {
        &self.planner.settings
    }

    pub fn planner(&self) -> &FramePlanner {
        &self.planner
    }

    /// Draws one frame at `size` into the output texture.
    pub fn render(&mut self, size: (u32, u32), frame: &FrameRequest) {
        let inputs = self.upload(frame);
        self.ops.clear();
        let mut ops = std::mem::take(&mut self.ops);
        {
            let mut assets = self.assets();
            self.planner.plan(&inputs, size, &mut assets, Target::Output, &mut ops);
        }
        self.exec.run(&ops, size, &self.rasters);
        self.ops = ops;
    }

    /// Two moments dissolved together (crossfade between clips): `progress` 0 → `a`, 1 → `b`.
    pub fn render_dissolve(&mut self, size: (u32, u32), a: &FrameRequest, b: &FrameRequest, progress: f64) {
        let mut ops = std::mem::take(&mut self.ops);
        ops.clear();
        let inputs_a = self.upload(a);
        {
            let mut assets = self.assets();
            self.planner.plan(&inputs_a, size, &mut assets, Target::Frame(0), &mut ops);
        }
        self.exec.run(&ops, size, &self.rasters);
        ops.clear();
        let inputs_b = self.upload(b);
        {
            let mut assets = self.assets();
            self.planner.plan(&inputs_b, size, &mut assets, Target::Frame(1), &mut ops);
        }
        let canvas = Rect::new(0.0, 0.0, size.0 as f64, size.1 as f64);
        let full = |tex: Target, alpha: f64| Draw {
            size: (canvas.width(), canvas.height()),
            transform: Homography::rect(canvas),
            fill: Fill::Texture { tint: [1.0; 4], mirror: false },
            texture: TexRef::Target(tex),
            uv: Rect::UNIT,
            mask: Mask::NONE,
            alpha,
        };
        ops.push(Op::Clear { target: Target::Output, color: [0.0, 0.0, 0.0, 1.0] });
        ops.push(Op::Draw { target: Target::Output, draw: full(Target::Frame(0), 1.0) });
        ops.push(Op::Draw { target: Target::Output, draw: full(Target::Frame(1), progress.clamp(0.0, 1.0)) });
        self.exec.run(&ops, size, &self.rasters);
        self.ops = ops;
    }

    /// The last rendered frame as RGBA8 (sRGB), row after row.
    pub fn read_rgba(&mut self) -> Result<Vec<u8>, GpuError> {
        self.exec.read_output()
    }

    /// Starts reading the last rendered frame back without waiting (the browser's way).
    pub fn copy_output(&mut self) -> gpu::Readback {
        self.exec.copy_output()
    }

    /// The last rendered frame's texture (Rgba8UnormSrgb), for zero-copy use.
    pub fn output_texture(&self) -> Option<&wgpu::Texture> {
        self.exec.output_texture()
    }

    /// The browser's path: frames are copied straight into the slots with
    /// [`Renderer::upload_external`], then drawn with this into `target`
    /// (`None` = the output; 0 or 1 = the two sides of a dissolve, see [`Renderer::dissolve`]).
    pub fn render_uploaded(&mut self, size: (u32, u32), inputs: FrameInputs, target: Option<u8>) {
        let mut ops = std::mem::take(&mut self.ops);
        ops.clear();
        {
            let mut assets = self.assets();
            let target = match target {
                None => Target::Output,
                Some(i) => Target::Frame(i),
            };
            self.planner.plan(&inputs, size, &mut assets, target, &mut ops);
        }
        self.exec.run(&ops, size, &self.rasters);
        self.ops = ops;
    }

    /// Blends the two dissolve sides drawn with [`Renderer::render_uploaded`] into the output.
    pub fn dissolve(&mut self, size: (u32, u32), progress: f64) {
        let mut ops = std::mem::take(&mut self.ops);
        ops.clear();
        let canvas = Rect::new(0.0, 0.0, size.0 as f64, size.1 as f64);
        let full = |tex: Target, alpha: f64| Draw {
            size: (canvas.width(), canvas.height()),
            transform: Homography::rect(canvas),
            fill: Fill::Texture { tint: [1.0; 4], mirror: false },
            texture: TexRef::Target(tex),
            uv: Rect::UNIT,
            mask: Mask::NONE,
            alpha,
        };
        ops.push(Op::Clear { target: Target::Output, color: [0.0, 0.0, 0.0, 1.0] });
        ops.push(Op::Draw { target: Target::Output, draw: full(Target::Frame(0), 1.0) });
        ops.push(Op::Draw { target: Target::Output, draw: full(Target::Frame(1), progress.clamp(0.0, 1.0)) });
        self.exec.run(&ops, size, &self.rasters);
        self.ops = ops;
    }

    #[cfg(target_arch = "wasm32")]
    pub fn upload_external(&mut self, slot: TexRef, source: wgpu::CopyExternalImageSourceInfo, size: (u32, u32)) {
        self.exec.upload_external(slot, source, size);
    }

    /// Forgets a video slot (the camera or an overlay that isn't shown any more).
    pub fn drop_video(&mut self, slot: &TexRef) {
        self.exec.drop_video(slot);
    }

    /// An image the planner can't read from disk (the browser has no files): `path` is the
    /// edit's name for it, `rgba` straight (not premultiplied) pixels.
    pub fn add_image(&self, path: &str, width: u32, height: u32, mut rgba: Vec<u8>) {
        for px in rgba.chunks_exact_mut(4) {
            let a = px[3] as u16;
            if a < 255 {
                for c in &mut px[..3] {
                    *c = ((*c as u16 * a + 127) / 255) as u8;
                }
            }
        }
        let full = match &self.bundle {
            Some(b) if !std::path::Path::new(path).is_absolute() => b.join(path),
            _ => PathBuf::from(path),
        };
        self.rasters.insert(format!("img:{}", full.display()), raster::RasterImage { width, height, pixels: rgba });
    }

    fn upload(&mut self, frame: &FrameRequest) -> FrameInputs {
        if let Some(screen) = &frame.screen {
            self.exec.upload_video(TexRef::Screen, screen);
        }
        if let Some(camera) = &frame.camera {
            self.exec.upload_video(TexRef::Camera, camera);
        }
        for (id, video) in &frame.overlays {
            self.exec.upload_video(TexRef::Overlay(*id), video);
        }
        FrameInputs {
            time: frame.time,
            output_time: frame.output_time,
            has_screen: frame.screen.is_some(),
            has_camera: frame.camera.is_some(),
            overlays: frame.overlays.iter().map(|(id, _)| *id).collect(),
        }
    }

    fn assets(&self) -> FrameAssets<'_> {
        let mut video_sizes = HashMap::new();
        for slot in [TexRef::Screen, TexRef::Camera] {
            if let Some(size) = self.exec.video_size(&slot) {
                video_sizes.insert(slot, size);
            }
        }
        for overlay in &self.planner.settings.overlays {
            let slot = TexRef::Overlay(overlay.id);
            if let Some(size) = self.exec.video_size(&slot) {
                video_sizes.insert(slot, size);
            }
        }
        FrameAssets { cache: &self.rasters, bundle: self.bundle.as_deref(), video_sizes }
    }
}
