//! Umi's editor in the browser: the same editing session as the desktop app (`umi-editor`)
//! and the same GPU compositor (`umi-render`, here on WebGPU), so a recording edited on the
//! web looks exactly like it does on the Mac. The page decodes the videos (it has the
//! browser's decoders) and hands each frame over as a video element, `VideoFrame` or bitmap;
//! the frame is copied on the GPU and drawn into an `OffscreenCanvas`.
#![allow(unsafe_code)]

use serde::Deserialize;
use serde_json::{Value, json};
use std::sync::Arc;
use umi_editor::{Media, Op, Session};
use umi_project::edit::{CaptionWord, EditSettings};
use umi_project::presets::StylePreset;
use umi_project::schedule::Schedule;
use umi_project::timeline::render_size;
use umi_project::{CursorData, Document, RecordingProject, Rect, Selection};
use umi_render::ops::TexRef;
use umi_render::plan::FrameInputs;
use umi_render::{Gpu, Renderer};
use wasm_bindgen::JsCast;
use wasm_bindgen::prelude::*;

fn err(e: impl std::fmt::Display) -> JsError {
    JsError::new(&e.to_string())
}

/// Adds a font for text and captions (TTF/OTF bytes; the browser has no system fonts here).
#[wasm_bindgen(js_name = addFont)]
pub fn add_font(data: Vec<u8>) {
    umi_render::raster::add_font(data);
}

/// Silences measured by the page (it has the audio).
struct PageMedia(Vec<(f64, f64)>);
impl Media for PageMedia {
    fn duration(&self, _: &str) -> Option<f64> {
        None
    }
    fn silences(&self, min: f64) -> Vec<(f64, f64)> {
        self.0.iter().copied().filter(|(a, b)| b - a >= min).collect()
    }
}

#[derive(Deserialize)]
struct Word {
    start: f64,
    end: f64,
    text: String,
}

/// The GPU and the canvas frames are drawn into.
struct View {
    gpu: Arc<Gpu>,
    surface: wgpu::Surface<'static>,
    canvas: web_sys::OffscreenCanvas,
    configured: (u32, u32),
    renderer: Renderer,
}

/// One open recording.
#[wasm_bindgen]
pub struct Editor {
    session: Session,
    id: String,
    name: String,
    schedule: Schedule,
    view: Option<View>,
}

/// A WebGPU device and the canvas it draws into, for [`Editor::attach`].
#[wasm_bindgen]
pub struct WebGpu {
    gpu: Arc<Gpu>,
    surface: wgpu::Surface<'static>,
    canvas: web_sys::OffscreenCanvas,
}

/// Opens the GPU (WebGPU) for drawing into `canvas`.
#[wasm_bindgen(js_name = openGpu)]
pub async fn open_gpu(canvas: web_sys::OffscreenCanvas) -> Result<WebGpu, JsError> {
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
        backends: wgpu::Backends::BROWSER_WEBGPU,
        ..wgpu::InstanceDescriptor::new_without_display_handle()
    });
    let surface = instance.create_surface(wgpu::SurfaceTarget::OffscreenCanvas(canvas.clone())).map_err(err)?;
    let adapter = instance
        .request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            compatible_surface: Some(&surface),
            ..Default::default()
        })
        .await
        .map_err(err)?;
    let (device, queue) = adapter.request_device(&wgpu::DeviceDescriptor { label: Some("umi"), ..Default::default() }).await.map_err(err)?;
    let pipelines = umi_render::gpu::Pipelines::new(&device);
    let gpu = Arc::new(Gpu { adapter_info: adapter.get_info(), device, queue, pipelines });
    Ok(WebGpu { gpu, surface, canvas })
}

/// The bundle path the renderer resolves relative image names against: `/web/<id>` (there
/// are no files; the page registers images under these names with [`Editor::add_image`]).
fn bundle(id: &str) -> String {
    format!("/web/{id}")
}

#[wasm_bindgen]
impl Editor {
    /// Opens a recording from its project.json and cursor.json (may be empty) and the screen
    /// video's length. `preset`: the look a recording without an edit starts with.
    #[wasm_bindgen(constructor)]
    pub fn new(id: String, name: String, project: &str, cursor: &str, media_duration: f64, preset: Option<String>) -> Result<Editor, JsError> {
        let project: RecordingProject = serde_json::from_str(project).map_err(err)?;
        let cursor: CursorData = if cursor.trim().is_empty() { CursorData::default() } else { serde_json::from_str(cursor).map_err(err)? };
        let preset: Option<StylePreset> = match preset {
            Some(p) => Some(serde_json::from_str(&p).map_err(err)?),
            None => None,
        };
        let edit: EditSettings = project.effective_edit(preset.as_ref());
        let doc = Document::new(project, edit, cursor, media_duration);
        let schedule = Schedule::new(&doc.edit, doc.total());
        Ok(Editor { session: Session::new(doc), id, name, schedule, view: None })
    }

    /// What the UI shows (`EditorState` as JSON).
    pub fn state(&self, selection: Option<String>) -> Result<String, JsError> {
        let selection: Option<Selection> = match selection {
            Some(s) => serde_json::from_str(&s).map_err(err)?,
            None => None,
        };
        let state = self.session.state(&self.id, self.name.clone(), bundle(&self.id).into(), selection);
        serde_json::to_string(&state).map_err(err)
    }

    /// Applies an editing operation (`Op` as JSON); `silences` are [start, end] pairs where
    /// the voice is quiet (for "hide the camera in silence"). Returns the new state.
    pub fn apply(&mut self, op: &str, silences: Option<String>) -> Result<String, JsError> {
        let op: Op = serde_json::from_str(op).map_err(err)?;
        let quiet: Vec<(f64, f64)> = match silences {
            Some(s) => serde_json::from_str(&s).map_err(err)?,
            None => Vec::new(),
        };
        let selection = self.session.apply(op, &PageMedia(quiet));
        self.edited();
        let state = self.session.state(&self.id, self.name.clone(), bundle(&self.id).into(), selection);
        serde_json::to_string(&state).map_err(err)
    }

    /// Puts transcribed words ([{start, end, text}]) in the captions, turns them on, and names
    /// the recording from them if it has no title yet.
    #[wasm_bindgen(js_name = setWords)]
    pub fn set_words(&mut self, words: &str, language: String) -> Result<String, JsError> {
        let words: Vec<Word> = serde_json::from_str(words).map_err(err)?;
        let mut edit = self.session.doc.edit.clone();
        edit.captions.words =
            words.iter().map(|w| CaptionWord { id: uuid::Uuid::new_v4(), start: w.start, end: w.end, text: w.text.clone() }).collect();
        edit.captions.language = language;
        edit.captions.enabled = true;
        if let Some(found) = umi_project::insights::insights(&edit.captions.words) {
            if self.session.doc.project.suggest_title(&found.title) {
                self.session.dirty = true;
            }
        }
        self.session.apply(Op::SetEdit { edit: Box::new(edit) }, &PageMedia(Vec::new()));
        self.edited();
        self.state(None)
    }

    /// The current look as a preset named `name` (JSON).
    #[wasm_bindgen(js_name = presetFromEdit)]
    pub fn preset_from_edit(&self, name: &str) -> Result<String, JsError> {
        serde_json::to_string(&StylePreset::from_edit(name.trim(), &self.session.doc.edit)).map_err(err)
    }

    /// Applies a preset's look (undoable); returns the new state.
    #[wasm_bindgen(js_name = applyPreset)]
    pub fn apply_preset(&mut self, preset: &str) -> Result<String, JsError> {
        let preset: StylePreset = serde_json::from_str(preset).map_err(err)?;
        let mut edit = self.session.doc.edit.clone();
        preset.apply(&mut edit);
        self.session.apply(Op::SetEdit { edit: Box::new(edit) }, &PageMedia(Vec::new()));
        self.edited();
        self.state(None)
    }

    /// Title, summary and chapters from the transcript (JSON, or "null").
    pub fn insights(&self) -> String {
        let doc = &self.session.doc;
        let value = match umi_project::insights::insights(&doc.edit.captions.words) {
            None => Value::Null,
            Some(mut found) => {
                found.chapters.retain(|c| doc.output_time(c.start).is_some() || c.start == 0.0);
                let text = umi_project::insights::chapter_text(&found.chapters, |t| doc.output_time(t));
                json!({ "title": found.title, "summary": found.summary, "chapters": found.chapters, "chapterText": text })
            }
        };
        value.to_string()
    }

    /// The captions as an SRT or WebVTT file.
    pub fn subtitles(&self, vtt: bool) -> String {
        let format = if vtt { umi_project::captions::SubtitleFormat::Vtt } else { umi_project::captions::SubtitleFormat::Srt };
        umi_project::captions::subtitles(&self.session.doc, format)
    }

    /// project.json as it should be saved (the edit inside); marks the session saved.
    pub fn project(&mut self) -> Result<String, JsError> {
        let mut project = self.session.doc.project.clone();
        project.edit = Some(self.session.doc.edit.clone());
        self.session.dirty = false;
        serde_json::to_string(&project).map_err(err)
    }

    /// Something changed since the last [`Editor::project`].
    pub fn dirty(&self) -> bool {
        self.session.dirty
    }

    /// The edit's title (or the name it was opened with).
    pub fn title(&self) -> String {
        self.session.doc.project.display_name(self.name.clone())
    }

    /// What plays at output time `t`: `{outputTime, layer: {clip, sourceTime},
    /// dissolve: null | {clip, sourceTime, progress}, overlays: [{id, file, time}]}`.
    pub fn moment(&self, t: f64) -> String {
        let m = self.schedule.moment(t);
        json!({
            "outputTime": m.output_time,
            "layer": { "clip": m.layer.clip, "sourceTime": m.layer.source_time },
            "dissolve": m.dissolve.map(|(l, p)| json!({ "clip": l.clip, "sourceTime": l.source_time, "progress": p })),
            "overlays": m.overlays.iter().map(|(id, file, time)| json!({ "id": id, "file": file, "time": time })).collect::<Vec<_>>(),
        })
        .to_string()
    }

    /// How long consecutive clips overlap (their crossfade), as the player uses it.
    pub fn crossfade(&self) -> f64 {
        self.schedule.crossfade
    }

    /// Output times of mouse clicks (for click sounds).
    #[wasm_bindgen(js_name = clickTimes)]
    pub fn click_times(&self) -> Vec<f64> {
        let mut times: Vec<f64> = self
            .session
            .doc
            .cursor
            .clicks
            .iter()
            .filter_map(|c| {
                self.schedule
                    .placements
                    .iter()
                    .find(|p| c.t >= p.clip.start && c.t <= p.clip.end)
                    .map(|p| p.output_start + (c.t - p.clip.start) / p.clip.speed)
            })
            .collect();
        times.sort_by(f64::total_cmp);
        times
    }

    /// Length of the edited video.
    pub fn duration(&self) -> f64 {
        self.schedule.duration
    }

    /// The frame size for a preview at most `max_width` × `max_height` (or the export size
    /// for a `max_height` of 720, 1080, 2160 with `max_width` 0).
    #[wasm_bindgen(js_name = frameSize)]
    pub fn frame_size(&self, max_width: u32, max_height: u32) -> Vec<u32> {
        let doc = &self.session.doc;
        if max_width == 0 {
            let (w, h) = render_size(&doc.project, &doc.edit, max_height);
            return vec![w, h];
        }
        let full = render_size(&doc.project, &doc.edit, 2160);
        let k = (max_width as f64 / full.0 as f64).min(max_height as f64 / full.1 as f64).min(1.0);
        vec![((full.0 as f64 * k) as u32).max(2) & !1, ((full.1 as f64 * k) as u32).max(2) & !1]
    }

    // MARK: Drawing

    /// Starts the renderer on a GPU from [`open_gpu`] (the editor takes it over).
    pub fn attach(&mut self, gpu: WebGpu) {
        let doc = &self.session.doc;
        let renderer = Renderer::new(gpu.gpu.clone(), doc.project.clone(), doc.edit.clone(), doc.cursor.clone(), Some(bundle(&self.id).into()));
        self.view = Some(View { gpu: gpu.gpu, surface: gpu.surface, canvas: gpu.canvas, configured: (0, 0), renderer });
    }

    /// Copies a frame into a slot: "screen", "camera" or an overlay's id. `source` is a
    /// video element (its current frame), a `VideoFrame`, an `ImageBitmap` or a canvas.
    pub fn upload(&mut self, slot: &str, source: JsValue, width: u32, height: u32) -> Result<(), JsError> {
        let view = self.view.as_mut().ok_or_else(|| err("not attached"))?;
        let slot = match slot {
            "screen" => TexRef::Screen,
            "camera" => TexRef::Camera,
            id => TexRef::Overlay(id.parse().map_err(err)?),
        };
        let source = if let Some(v) = source.dyn_ref::<web_sys::VideoFrame>() {
            // Not `v.clone()`: that's VideoFrame.clone() in JavaScript, a new frame to close.
            wgpu::ExternalImageSource::VideoFrame(Clone::clone(v))
        } else if let Some(v) = source.dyn_ref::<web_sys::HtmlVideoElement>() {
            wgpu::ExternalImageSource::HTMLVideoElement(v.clone())
        } else if let Some(v) = source.dyn_ref::<web_sys::ImageBitmap>() {
            wgpu::ExternalImageSource::ImageBitmap(v.clone())
        } else if let Some(v) = source.dyn_ref::<web_sys::OffscreenCanvas>() {
            wgpu::ExternalImageSource::OffscreenCanvas(v.clone())
        } else if let Some(v) = source.dyn_ref::<web_sys::HtmlCanvasElement>() {
            wgpu::ExternalImageSource::HTMLCanvasElement(v.clone())
        } else if let Some(v) = source.dyn_ref::<web_sys::HtmlImageElement>() {
            wgpu::ExternalImageSource::HTMLImageElement(v.clone())
        } else {
            return Err(err("unsupported frame source"));
        };
        let info = wgpu::CopyExternalImageSourceInfo { source, origin: wgpu::Origin2d::ZERO, flip_y: false };
        view.renderer.upload_external(slot, info, (width.max(1), height.max(1)));
        Ok(())
    }

    /// Forgets a slot's frame (the camera or an overlay no longer shown).
    pub fn forget(&mut self, slot: &str) {
        let Some(view) = self.view.as_mut() else { return };
        let slot = match slot {
            "screen" => TexRef::Screen,
            "camera" => TexRef::Camera,
            id => match id.parse() {
                Ok(id) => TexRef::Overlay(id),
                Err(_) => return,
            },
        };
        view.renderer.drop_video(&slot);
    }

    /// Draws recording time `time` (output time `output_time`) from the uploaded slots into
    /// the output (`side` undefined) or one side of a dissolve (0 or 1). `flat`: no zooms or
    /// 3D moves (placing masks and zoom focus).
    #[allow(clippy::too_many_arguments)]
    pub fn draw(
        &mut self,
        width: u32,
        height: u32,
        time: f64,
        output_time: f64,
        has_screen: bool,
        has_camera: bool,
        overlays: Vec<String>,
        side: Option<u8>,
        flat: bool,
    ) -> Result<(), JsError> {
        let view = self.view.as_mut().ok_or_else(|| err("not attached"))?;
        let overlays = overlays.iter().filter_map(|id| id.parse().ok()).collect();
        view.renderer.set_apply_zoom_and_moves(!flat);
        let inputs = FrameInputs { time, output_time: Some(output_time), has_screen, has_camera, overlays };
        view.renderer.render_uploaded((width, height), inputs, side);
        Ok(())
    }

    /// Blends the two dissolve sides into the output.
    pub fn dissolve(&mut self, width: u32, height: u32, progress: f64) -> Result<(), JsError> {
        let view = self.view.as_mut().ok_or_else(|| err("not attached"))?;
        view.renderer.dissolve((width, height), progress);
        Ok(())
    }

    /// Puts the output on the canvas and returns it as a bitmap (for the preview, or a
    /// `VideoFrame` for export).
    pub fn present(&mut self) -> Result<web_sys::ImageBitmap, JsError> {
        let view = self.view.as_mut().ok_or_else(|| err("not attached"))?;
        let output = view.renderer.output_texture().ok_or_else(|| err("nothing drawn"))?;
        let size = (output.width(), output.height());
        if view.configured != size {
            view.canvas.set_width(size.0);
            view.canvas.set_height(size.1);
            view.surface.configure(
                &view.gpu.device,
                &wgpu::SurfaceConfiguration {
                    usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_DST,
                    format: wgpu::TextureFormat::Rgba8Unorm,
                    width: size.0,
                    height: size.1,
                    present_mode: wgpu::PresentMode::Fifo,
                    desired_maximum_frame_latency: 1,
                    alpha_mode: wgpu::CompositeAlphaMode::Opaque,
                    color_space: Default::default(),
                    view_formats: vec![],
                },
            );
            view.configured = size;
        }
        let frame = match view.surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(t) | wgpu::CurrentSurfaceTexture::Suboptimal(t) => t,
            other => return Err(err(format!("canvas unavailable: {other:?}"))),
        };
        let mut encoder = view.gpu.device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: Some("present") });
        // The output is sRGB-encoded bytes; the canvas shows bytes as they are.
        encoder.copy_texture_to_texture(
            output.as_image_copy(),
            frame.texture.as_image_copy(),
            wgpu::Extent3d { width: size.0, height: size.1, depth_or_array_layers: 1 },
        );
        view.gpu.queue.submit([encoder.finish()]);
        view.gpu.queue.present(frame);
        view.canvas.transfer_to_image_bitmap().map_err(|e| err(format!("{e:?}")))
    }

    /// Where the screen's content sits at output time `time`: [x, y, w, h], 0…1 from the
    /// top left (for the preview's handles).
    pub fn layout(&self, time: f64) -> Vec<f64> {
        let Some(view) = &self.view else { return vec![0.0, 0.0, 1.0, 1.0] };
        let moment = self.schedule.moment(time);
        let doc = &self.session.doc;
        let size = render_size(&doc.project, &doc.edit, 1080);
        let canvas = Rect::new(0.0, 0.0, size.0 as f64, size.1 as f64);
        let r = view.renderer.planner().screen_content_rect(moment.layer.source_time, canvas);
        vec![r.min_x() / canvas.width(), 1.0 - r.max_y() / canvas.height(), r.width() / canvas.width(), r.height() / canvas.height()]
    }

    /// The face's path in the camera video (`camera-face.json`: [{t, x, y, size}], 0…1).
    #[wasm_bindgen(js_name = setFaces)]
    pub fn set_faces(&mut self, faces: &str) -> Result<(), JsError> {
        let faces: Vec<umi_project::project::FaceKey> = serde_json::from_str(faces).map_err(err)?;
        if let Some(view) = self.view.as_mut() {
            view.renderer.set_faces(faces);
        }
        Ok(())
    }

    /// An image the edit refers to (background, overlay, logo) under its name in the edit.
    #[wasm_bindgen(js_name = addImage)]
    pub fn add_image(&self, path: &str, width: u32, height: u32, rgba: Vec<u8>) {
        if let Some(view) = &self.view {
            view.renderer.add_image(path, width, height, rgba);
        }
    }

    fn edited(&mut self) {
        let doc = &self.session.doc;
        self.schedule = Schedule::new(&doc.edit, doc.total());
        if let Some(view) = self.view.as_mut() {
            if view.renderer.edit() != &doc.edit {
                view.renderer.set_edit(doc.edit.clone());
            }
        }
    }
}

#[cfg(target_arch = "wasm32")]
mod random {
    #[wasm_bindgen::prelude::wasm_bindgen]
    extern "C" {
        #[wasm_bindgen(js_namespace = crypto, js_name = getRandomValues)]
        fn get_random_values(buf: &mut [u8]);
    }

    /// getrandom's custom backend (new ids): the page's crypto.getRandomValues.
    #[unsafe(no_mangle)]
    unsafe extern "Rust" fn __getrandom_v03_custom(dest: *mut u8, len: usize) -> Result<(), getrandom::Error> {
        get_random_values(unsafe { std::slice::from_raw_parts_mut(dest, len) });
        Ok(())
    }
}

/// Follows a mask's area (`rect`: [[x, y], [w, h]], 0…1) placed at recording time `anchor`
/// through frames at `times`: `luma` holds them one after another, `width × height` each.
/// Returns the keyframes as JSON (the same tracker as the Mac app).
#[wasm_bindgen(js_name = trackRegion)]
pub fn track_region(rect: &str, anchor: f64, times: Vec<f64>, width: usize, height: usize, luma: Vec<u8>) -> Result<String, JsError> {
    use umi_project::track::{Gray, track_frames};
    let rect: Rect = serde_json::from_str(rect).map_err(err)?;
    let size = width * height;
    let frames: Vec<(f64, Gray)> =
        times.iter().enumerate().filter_map(|(i, t)| luma.get(i * size..(i + 1) * size).map(|px| (*t, Gray::new(width, height, px.to_vec())))).collect();
    serde_json::to_string(&track_frames(&frames, rect, anchor)).map_err(err)
}

/// GIF export, encoded like the Mac app's (palette per frame, looping forever).
#[wasm_bindgen]
pub struct GifEncoder {
    encoder: gif::Encoder<Vec<u8>>,
    width: u16,
    height: u16,
    delay: u16,
}

#[wasm_bindgen]
impl GifEncoder {
    #[wasm_bindgen(constructor)]
    pub fn new(width: u16, height: u16, fps: f64) -> Result<GifEncoder, JsError> {
        let mut encoder = gif::Encoder::new(Vec::new(), width, height, &[]).map_err(err)?;
        encoder.set_repeat(gif::Repeat::Infinite).map_err(err)?;
        Ok(GifEncoder { encoder, width, height, delay: (100.0 / fps.max(1.0)).round() as u16 })
    }

    /// Adds a frame (tightly packed RGBA8).
    pub fn push(&mut self, mut rgba: Vec<u8>) -> Result<(), JsError> {
        let mut frame = gif::Frame::from_rgba_speed(self.width, self.height, &mut rgba, 10);
        frame.delay = self.delay;
        self.encoder.write_frame(&frame).map_err(err)
    }

    /// The finished file.
    pub fn finish(self) -> Result<Vec<u8>, JsError> {
        self.encoder.into_inner().map_err(err)
    }
}
