//! Runs a frame's operations: uploads video frames and rasters, writes every uniform in one
//! buffer write, then encodes passes, merging consecutive draws to the same target.

use super::pipelines::*;
use super::{Gpu, GpuError};
use crate::ops::*;
use crate::raster::RasterCache;
use std::collections::HashMap;
use std::sync::Arc;
use umi_project::edit::GradePreset;

/// Pixel layouts accepted for video frames.
#[derive(Debug, Clone, Copy)]
pub enum PixelData<'a> {
    Rgba8 {
        data: &'a [u8],
        stride: u32,
    },
    Bgra8 {
        data: &'a [u8],
        stride: u32,
    },
    /// Y plane + interleaved CbCr plane (the usual hardware decoder output).
    Nv12 {
        y: &'a [u8],
        y_stride: u32,
        uv: &'a [u8],
        uv_stride: u32,
        full_range: bool,
        bt709: bool,
    },
}

#[derive(Debug, Clone, Copy)]
pub struct VideoFrame<'a> {
    pub width: u32,
    pub height: u32,
    pub data: PixelData<'a>,
}

struct Tex {
    texture: wgpu::Texture,
    view: wgpu::TextureView,
    bind: wgpu::BindGroup,
    size: (u32, u32),
}

/// Video input slot: the sampled RGBA texture, plus NV12 planes when needed.
struct VideoSlot {
    rgba: Tex,
    format: wgpu::TextureFormat,
    planes: Option<(wgpu::Texture, wgpu::Texture, wgpu::BindGroup)>,
}

pub struct Executor {
    gpu: Arc<Gpu>,
    targets: HashMap<(Target, (u32, u32)), Tex>,
    videos: HashMap<TexRef, VideoSlot>,
    rasters: HashMap<String, Tex>,
    uniforms: wgpu::Buffer,
    uniform_capacity: u64,
    draw_bind: wgpu::BindGroup,
    blur_bind: wgpu::BindGroup,
    grade_bind: wgpu::BindGroup,
    yuv_bind: wgpu::BindGroup,
    white: Tex,
    /// Grade preset LUTs, loaded on first use.
    luts: HashMap<GradePreset, wgpu::TextureView>,
    readback: Option<(wgpu::Buffer, u64)>,
    /// Size of the canvas the current frame was planned for.
    canvas: (u32, u32),
}

fn align(n: u64) -> u64 {
    n.div_ceil(UNIFORM_ALIGN) * UNIFORM_ALIGN
}

impl Executor {
    pub fn new(gpu: Arc<Gpu>) -> Self {
        let capacity = UNIFORM_ALIGN * 256;
        let uniforms = Self::uniform_buffer(&gpu.device, capacity);
        let binds = Self::uniform_binds(&gpu, &uniforms);
        let white = Self::make_tex(&gpu, (1, 1), wgpu::TextureFormat::Rgba8UnormSrgb, "white");
        gpu.queue.write_texture(
            white.texture.as_image_copy(),
            &[255, 255, 255, 255],
            wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(4), rows_per_image: None },
            wgpu::Extent3d { width: 1, height: 1, depth_or_array_layers: 1 },
        );
        Self {
            gpu,
            targets: HashMap::new(),
            videos: HashMap::new(),
            rasters: HashMap::new(),
            uniforms,
            uniform_capacity: capacity,
            draw_bind: binds.0,
            blur_bind: binds.1,
            grade_bind: binds.2,
            yuv_bind: binds.3,
            white,
            luts: HashMap::new(),
            readback: None,
            canvas: (0, 0),
        }
    }

    fn uniform_buffer(device: &wgpu::Device, size: u64) -> wgpu::Buffer {
        device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("frame uniforms"),
            size,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        })
    }

    fn uniform_binds(gpu: &Gpu, buffer: &wgpu::Buffer) -> (wgpu::BindGroup, wgpu::BindGroup, wgpu::BindGroup, wgpu::BindGroup) {
        let make = |layout: &wgpu::BindGroupLayout, size: usize| {
            gpu.device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("uniforms"),
                layout,
                entries: &[wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::Buffer(wgpu::BufferBinding {
                        buffer,
                        offset: 0,
                        size: std::num::NonZeroU64::new(size as u64),
                    }),
                }],
            })
        };
        let l = &gpu.pipelines.uniform_layouts;
        (
            make(&l.draw, size_of::<DrawUniform>()),
            make(&l.blur, size_of::<BlurUniform>()),
            make(&l.grade, size_of::<GradeUniform>()),
            make(&l.yuv, size_of::<YuvUniform>()),
        )
    }

    fn make_tex(gpu: &Gpu, size: (u32, u32), format: wgpu::TextureFormat, label: &str) -> Tex {
        let texture = gpu.device.create_texture(&wgpu::TextureDescriptor {
            label: Some(label),
            size: wgpu::Extent3d { width: size.0.max(1), height: size.1.max(1), depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format,
            usage: wgpu::TextureUsages::TEXTURE_BINDING
                | wgpu::TextureUsages::RENDER_ATTACHMENT
                | wgpu::TextureUsages::COPY_DST
                | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        let bind = gpu.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some(label),
            layout: &gpu.pipelines.texture_layout,
            entries: &[
                wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(&view) },
                wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::Sampler(&gpu.pipelines.sampler) },
            ],
        });
        Tex { texture, view, bind, size }
    }

    // MARK: Inputs

    /// Uploads a video frame into a slot (screen, camera or an overlay).
    pub fn upload_video(&mut self, slot: TexRef, frame: &VideoFrame) {
        let gpu = self.gpu.clone();
        let (w, h) = (frame.width, frame.height);
        let format = match frame.data {
            PixelData::Bgra8 { .. } => wgpu::TextureFormat::Bgra8UnormSrgb,
            PixelData::Rgba8 { .. } => wgpu::TextureFormat::Rgba8UnormSrgb,
            PixelData::Nv12 { .. } => LAYER_FORMAT,
        };
        let needs_new = self.videos.get(&slot).is_none_or(|v| v.rgba.size != (w, h) || v.format != format);
        if needs_new {
            let rgba = Self::make_tex(&gpu, (w, h), format, "video");
            let planes = matches!(frame.data, PixelData::Nv12 { .. }).then(|| {
                let plane = |fmt, size: (u32, u32)| {
                    gpu.device.create_texture(&wgpu::TextureDescriptor {
                        label: Some("nv12 plane"),
                        size: wgpu::Extent3d { width: size.0.max(1), height: size.1.max(1), depth_or_array_layers: 1 },
                        mip_level_count: 1,
                        sample_count: 1,
                        dimension: wgpu::TextureDimension::D2,
                        format: fmt,
                        usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
                        view_formats: &[],
                    })
                };
                let y = plane(wgpu::TextureFormat::R8Unorm, (w, h));
                let uv = plane(wgpu::TextureFormat::Rg8Unorm, (w.div_ceil(2), h.div_ceil(2)));
                let bind = gpu.device.create_bind_group(&wgpu::BindGroupDescriptor {
                    label: Some("nv12"),
                    layout: &gpu.pipelines.yuv_texture_layout,
                    entries: &[
                        wgpu::BindGroupEntry {
                            binding: 0,
                            resource: wgpu::BindingResource::TextureView(&y.create_view(&Default::default())),
                        },
                        wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::Sampler(&gpu.pipelines.sampler) },
                        wgpu::BindGroupEntry {
                            binding: 2,
                            resource: wgpu::BindingResource::TextureView(&uv.create_view(&Default::default())),
                        },
                    ],
                });
                (y, uv, bind)
            });
            self.videos.insert(slot.clone(), VideoSlot { rgba, format, planes });
        }
        let Some(video) = self.videos.get(&slot) else { return };
        let extent = |w: u32, h: u32| wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 };
        match frame.data {
            PixelData::Rgba8 { data, stride } | PixelData::Bgra8 { data, stride } => {
                gpu.queue.write_texture(
                    video.rgba.texture.as_image_copy(),
                    data,
                    wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(stride), rows_per_image: None },
                    extent(w, h),
                );
            }
            PixelData::Nv12 { y, y_stride, uv, uv_stride, full_range, bt709 } => {
                let Some((y_tex, uv_tex, bind)) = &video.planes else { return };
                gpu.queue.write_texture(
                    y_tex.as_image_copy(),
                    y,
                    wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(y_stride), rows_per_image: None },
                    extent(w, h),
                );
                gpu.queue.write_texture(
                    uv_tex.as_image_copy(),
                    uv,
                    wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(uv_stride), rows_per_image: None },
                    extent(w.div_ceil(2), h.div_ceil(2)),
                );
                // Convert on the GPU into the slot's RGBA texture.
                let uniform = yuv_uniform(full_range, bt709);
                gpu.queue.write_buffer(&self.uniforms, 0, bytemuck::bytes_of(&uniform));
                let mut encoder = gpu.device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: Some("nv12") });
                {
                    let mut pass = begin(&mut encoder, &video.rgba.view, None);
                    pass.set_pipeline(&gpu.pipelines.yuv);
                    pass.set_bind_group(0, &self.yuv_bind, &[0]);
                    pass.set_bind_group(1, bind, &[]);
                    pass.draw(0..3, 0..1);
                }
                gpu.queue.submit([encoder.finish()]);
            }
        }
    }

    /// Copies a browser image (a video element's current frame, a `VideoFrame`, a bitmap) into
    /// a slot, on the GPU: no pixels pass through the CPU.
    #[cfg(target_arch = "wasm32")]
    pub fn upload_external(&mut self, slot: TexRef, source: wgpu::CopyExternalImageSourceInfo, size: (u32, u32)) {
        let gpu = self.gpu.clone();
        let format = wgpu::TextureFormat::Rgba8UnormSrgb;
        if self.videos.get(&slot).is_none_or(|v| v.rgba.size != size || v.format != format) {
            let rgba = Self::make_tex(&gpu, size, format, "video");
            self.videos.insert(slot.clone(), VideoSlot { rgba, format, planes: None });
        }
        let Some(video) = self.videos.get(&slot) else { return };
        gpu.queue.copy_external_image_to_texture(
            &source,
            wgpu::CopyExternalImageDestInfo {
                texture: &video.rgba.texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
                color_space: wgpu::PredefinedColorSpace::Srgb,
                premultiplied_alpha: true,
            },
            wgpu::Extent3d { width: size.0, height: size.1, depth_or_array_layers: 1 },
        );
    }

    /// Forgets a video slot (e.g. an overlay no longer on screen).
    pub fn drop_video(&mut self, slot: &TexRef) {
        self.videos.remove(slot);
    }

    pub fn video_size(&self, slot: &TexRef) -> Option<(u32, u32)> {
        self.videos.get(slot).map(|v| v.rgba.size)
    }

    // MARK: Execution

    /// Runs `ops` for a canvas of `size`. Rasters referenced by the ops come from `cache`.
    pub fn run(&mut self, ops: &[Op], size: (u32, u32), cache: &RasterCache) {
        self.canvas = size;
        self.upload_rasters(ops, cache);

        // Pass 1: lay out uniforms (and make sure every target exists).
        let mut bytes: Vec<u8> = Vec::with_capacity(ops.len() * UNIFORM_ALIGN as usize);
        let mut offsets = Vec::with_capacity(ops.len());
        let push = |bytes: &mut Vec<u8>, data: &[u8]| -> u32 {
            let offset = bytes.len() as u32;
            bytes.extend_from_slice(data);
            bytes.resize(align(bytes.len() as u64) as usize, 0);
            offset
        };
        for op in ops {
            let offset = match op {
                Op::Clear { .. } => 0,
                Op::Draw { target, draw } => {
                    let size = self.target_size(*target);
                    push(&mut bytes, bytemuck::bytes_of(&draw_uniform(draw, size)))
                }
                Op::Blur { src, dst, sigma, scale } => {
                    let src_size = self.tex_size(src).unwrap_or(size);
                    let dst_size = scaled(src_size, *scale);
                    self.ensure_target(*dst, dst_size);
                    self.ensure_target(blur_tmp(*dst), dst_size);
                    let s = (*sigma * *scale) as f32;
                    let h = push(&mut bytes, bytemuck::bytes_of(&BlurUniform { params: [1.0 / dst_size.0 as f32, 0.0, s, 0.0] }));
                    let _v = push(&mut bytes, bytemuck::bytes_of(&BlurUniform { params: [0.0, 1.0 / dst_size.1 as f32, s, 0.0] }));
                    h
                }
                Op::Grade { params, .. } => {
                    if let Some(preset) = params.lut {
                        self.ensure_lut(preset);
                    }
                    push(&mut bytes, bytemuck::bytes_of(&grade_uniform(params, size)))
                }
            };
            offsets.push(offset);
            match op {
                Op::Draw { target, .. } | Op::Clear { target, .. } => {
                    let s = self.target_size(*target);
                    self.ensure_target(*target, s);
                }
                Op::Grade { dst, .. } => self.ensure_target(*dst, size),
                Op::Blur { .. } => {}
            }
        }
        if bytes.len() as u64 > self.uniform_capacity {
            self.uniform_capacity = align(bytes.len() as u64 * 2);
            self.uniforms = Self::uniform_buffer(&self.gpu.device, self.uniform_capacity);
            let binds = Self::uniform_binds(&self.gpu, &self.uniforms);
            (self.draw_bind, self.blur_bind, self.grade_bind, self.yuv_bind) = binds;
        }
        if !bytes.is_empty() {
            self.gpu.queue.write_buffer(&self.uniforms, 0, &bytes);
        }

        // Pass 2: encode.
        let gpu = self.gpu.clone();
        let mut encoder = gpu.device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: Some("frame") });
        let mut i = 0;
        while i < ops.len() {
            match &ops[i] {
                Op::Clear { target, color } => {
                    let view = &self.target(*target).view;
                    let _pass = begin(&mut encoder, view, Some(*color));
                    i += 1;
                }
                Op::Draw { target, .. } => {
                    // Merge the run of draws into this target.
                    let start = i;
                    while i < ops.len() && matches!(&ops[i], Op::Draw { target: t, .. } if t == target) {
                        i += 1;
                    }
                    let view = &self.target(*target).view;
                    let mut pass = begin(&mut encoder, view, None);
                    pass.set_pipeline(if *target == Target::Output { &gpu.pipelines.quad_output } else { &gpu.pipelines.quad_layer });
                    for (op, offset) in ops[start..i].iter().zip(&offsets[start..i]) {
                        let Op::Draw { draw, .. } = op else { continue };
                        let Some(bind) = self.bind_for(&draw.texture) else { continue };
                        pass.set_bind_group(0, &self.draw_bind, &[*offset]);
                        pass.set_bind_group(1, bind, &[]);
                        pass.draw(0..6, 0..1);
                    }
                }
                Op::Blur { src, dst, .. } => {
                    let offset = offsets[i];
                    if let Some(src_bind) = self.bind_for(src) {
                        let tmp = self.target(blur_tmp(*dst));
                        {
                            let mut pass = begin(&mut encoder, &tmp.view, Some([0.0; 4]));
                            pass.set_pipeline(&gpu.pipelines.blur);
                            pass.set_bind_group(0, &self.blur_bind, &[offset]);
                            pass.set_bind_group(1, src_bind, &[]);
                            pass.draw(0..3, 0..1);
                        }
                        let dst_tex = self.target(*dst);
                        let mut pass = begin(&mut encoder, &dst_tex.view, Some([0.0; 4]));
                        pass.set_pipeline(&gpu.pipelines.blur);
                        pass.set_bind_group(0, &self.blur_bind, &[offset + UNIFORM_ALIGN as u32]);
                        pass.set_bind_group(1, &tmp.bind, &[]);
                        pass.draw(0..3, 0..1);
                    }
                    i += 1;
                }
                Op::Grade { src, dst, bloom, params } => {
                    let offset = offsets[i];
                    let src_bind = &self.target(*src).bind;
                    let bloom_view = match bloom {
                        Some(b) => &self.target_any_size(*b).view,
                        None => &self.white.view,
                    };
                    let lut_view = params.lut.and_then(|p| self.luts.get(&p)).unwrap_or(&self.white.view);
                    let bloom_bind = gpu.device.create_bind_group(&wgpu::BindGroupDescriptor {
                        label: Some("bloom + lut"),
                        layout: &gpu.pipelines.bloom_layout,
                        entries: &[
                            wgpu::BindGroupEntry { binding: 0, resource: wgpu::BindingResource::TextureView(bloom_view) },
                            wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::TextureView(lut_view) },
                        ],
                    });
                    let view = &self.target(*dst).view;
                    let mut pass = begin(&mut encoder, view, Some([0.0; 4]));
                    pass.set_pipeline(&gpu.pipelines.grade);
                    pass.set_bind_group(0, &self.grade_bind, &[offset]);
                    pass.set_bind_group(1, src_bind, &[]);
                    pass.set_bind_group(2, &bloom_bind, &[]);
                    pass.draw(0..3, 0..1);
                    i += 1;
                }
            }
        }
        gpu.queue.submit([encoder.finish()]);
    }

    /// The finished frame as tightly packed RGBA8 (sRGB).
    pub fn read_output(&mut self) -> Result<Vec<u8>, GpuError> {
        let read = self.copy_output();
        let slice = read.buffer.slice(..read.size);
        let (tx, rx) = std::sync::mpsc::channel();
        slice.map_async(wgpu::MapMode::Read, move |r| {
            let _ = tx.send(r);
        });
        self.gpu.device.poll(wgpu::PollType::wait_indefinitely()).map_err(|e| GpuError::Readback(e.to_string()))?;
        rx.recv().map_err(|e| GpuError::Readback(e.to_string()))?.map_err(|e| GpuError::Readback(e.to_string()))?;
        read.collect()
    }

    /// Copies the output into the readback buffer; map it (the caller decides how to wait,
    /// the browser can't block) and then [`Readback::collect`].
    pub fn copy_output(&mut self) -> Readback {
        let (w, h) = self.canvas;
        let bytes_per_row = align((w * 4) as u64);
        let size = bytes_per_row * h as u64;
        if self.readback.as_ref().is_none_or(|(_, s)| *s < size) {
            let buffer = self.gpu.device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("readback"),
                size,
                usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
                mapped_at_creation: false,
            });
            self.readback = Some((buffer, size));
        }
        let buffer = self.readback.as_ref().map(|(b, _)| b.clone()).expect("made above");
        let output = &self.target(Target::Output).texture;
        let mut encoder = self.gpu.device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: Some("readback") });
        encoder.copy_texture_to_buffer(
            output.as_image_copy(),
            wgpu::TexelCopyBufferInfo {
                buffer: &buffer,
                layout: wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(bytes_per_row as u32), rows_per_image: None },
            },
            wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
        );
        self.gpu.queue.submit([encoder.finish()]);
        Readback { buffer, size, bytes_per_row, width: w, height: h }
    }

    /// The output texture (for zero-copy presentation or encoding).
    pub fn output_texture(&self) -> Option<&wgpu::Texture> {
        self.targets.get(&(Target::Output, self.canvas)).map(|t| &t.texture)
    }

    // MARK: Resources

    fn target_size(&self, target: Target) -> (u32, u32) {
        match target {
            Target::Screen { width, height } => (width, height),
            Target::Scratch(_) => self.targets.keys().find(|(t, _)| *t == target).map(|(_, s)| *s).unwrap_or(self.canvas),
            _ => self.canvas,
        }
    }

    fn ensure_target(&mut self, target: Target, size: (u32, u32)) {
        if self.targets.contains_key(&(target, size)) {
            return;
        }
        // Drop other sizes of the same target (canvas or content size changed).
        self.targets.retain(|(t, _), _| *t != target);
        let format = if target == Target::Output { OUTPUT_FORMAT } else { LAYER_FORMAT };
        let tex = Self::make_tex(&self.gpu, size, format, "target");
        self.targets.insert((target, size), tex);
    }

    fn target(&self, target: Target) -> &Tex {
        self.target_any_size(target)
    }

    fn target_any_size(&self, target: Target) -> &Tex {
        let size = self.target_size(target);
        self.targets
            .get(&(target, size))
            .or_else(|| self.targets.iter().find(|((t, _), _)| *t == target).map(|(_, v)| v))
            .unwrap_or(&self.white)
    }

    fn tex_size(&self, tex: &TexRef) -> Option<(u32, u32)> {
        match tex {
            TexRef::None => Some((1, 1)),
            TexRef::Target(t) => Some(self.target_size(*t)),
            TexRef::Raster(key) => self.rasters.get(key).map(|t| t.size),
            other => self.videos.get(other).map(|v| v.rgba.size),
        }
    }

    fn bind_for(&self, tex: &TexRef) -> Option<&wgpu::BindGroup> {
        Some(match tex {
            TexRef::None => &self.white.bind,
            TexRef::Target(t) => &self.target_any_size(*t).bind,
            TexRef::Raster(key) => &self.rasters.get(key)?.bind,
            other => &self.videos.get(other)?.rgba.bind,
        })
    }

    fn ensure_lut(&mut self, preset: GradePreset) {
        if self.luts.contains_key(&preset) {
            return;
        }
        let Some(png) = lut_png(preset) else { return };
        let Ok(img) = image::load_from_memory(png) else { return };
        let rgba = img.to_rgba32f();
        let (w, h) = rgba.dimensions();
        let halves: Vec<u16> = rgba.into_raw().iter().map(|v| f32_to_f16(*v)).collect();
        let texture = self.gpu.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("grade lut"),
            size: wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba16Float,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });
        self.gpu.queue.write_texture(
            texture.as_image_copy(),
            bytemuck::cast_slice(&halves),
            wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(w * 8), rows_per_image: None },
            wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
        );
        self.luts.insert(preset, texture.create_view(&Default::default()));
    }

    fn upload_rasters(&mut self, ops: &[Op], cache: &RasterCache) {
        let mut used = Vec::new();
        for op in ops {
            if let Op::Draw { draw: Draw { texture: TexRef::Raster(key), .. }, .. } = op {
                used.push(key.clone());
                if self.rasters.contains_key(key) {
                    continue;
                }
                let Some(image) = cache.get(key) else { continue };
                let tex = Self::make_tex(&self.gpu, (image.width, image.height), wgpu::TextureFormat::Rgba8UnormSrgb, "raster");
                self.gpu.queue.write_texture(
                    tex.texture.as_image_copy(),
                    &image.pixels,
                    wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(image.width * 4), rows_per_image: None },
                    wgpu::Extent3d { width: image.width, height: image.height, depth_or_array_layers: 1 },
                );
                self.rasters.insert(key.clone(), tex);
            }
        }
        // Keep GPU memory bounded: drop transient rasters (text cards per character) not used now.
        if self.rasters.len() > 256 {
            self.rasters.retain(|k, _| used.contains(k) || k.starts_with("img:") || k.starts_with("cursor") || k.starts_with("chrome"));
        }
    }
}

/// The intermediate surface of a two-pass blur into `dst`.
fn blur_tmp(dst: Target) -> Target {
    match dst {
        Target::Scratch(n) => Target::Scratch(n.saturating_add(100)),
        _ => Target::Scratch(250),
    }
}

fn scaled(size: (u32, u32), scale: f64) -> (u32, u32) {
    (((size.0 as f64 * scale).round() as u32).max(1), ((size.1 as f64 * scale).round() as u32).max(1))
}

fn begin<'e>(encoder: &'e mut wgpu::CommandEncoder, view: &'e wgpu::TextureView, clear: Option<[f32; 4]>) -> wgpu::RenderPass<'e> {
    let load = match clear {
        Some([r, g, b, a]) => wgpu::LoadOp::Clear(wgpu::Color { r: r as f64, g: g as f64, b: b as f64, a: a as f64 }),
        None => wgpu::LoadOp::Load,
    };
    encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
        label: None,
        color_attachments: &[Some(wgpu::RenderPassColorAttachment {
            view,
            resolve_target: None,
            ops: wgpu::Operations { load, store: wgpu::StoreOp::Store },
            depth_slice: None,
        })],
        ..Default::default()
    })
}

fn draw_uniform(draw: &Draw, canvas: (u32, u32)) -> DrawUniform {
    let h = &draw.transform.0;
    let f = |v: f64| v as f32;
    let (mode, color, color2, gradient, mirror, pixel, sigma, stroke) = match draw.fill {
        Fill::Solid(c) => (0.0, c, [0.0; 4], [0.0; 4], false, 0.0, 0.0, 0.0),
        Fill::Texture { tint, mirror } => (1.0, tint, [0.0; 4], [0.0; 4], mirror, 0.0, 0.0, 0.0),
        Fill::Gradient { from, to, a, b } => (2.0, a, b, [f(from.x), f(from.y), f(to.x), f(to.y)], false, 0.0, 0.0, 0.0),
        Fill::Shadow { color, sigma } => (3.0, color, [0.0; 4], [0.0; 4], false, 0.0, f(sigma), 0.0),
        Fill::Ring { color, width } => (4.0, color, [0.0; 4], [0.0; 4], false, 0.0, 0.0, f(width)),
        Fill::Pixelate { size } => (5.0, [1.0; 4], [0.0; 4], [0.0; 4], false, f(size), 0.0, 0.0),
    };
    // Texture tint multiplies the sample (the shader returns the raw sample for mode 1).
    let _ = color;
    let kind = match draw.mask.kind {
        MaskKind::None => 0.0,
        MaskKind::Rounded => 1.0,
        MaskKind::Squircle => 2.0,
        MaskKind::Inverted => 3.0,
    };
    let m = draw.mask.rect;
    let uv = draw.uv;
    DrawUniform {
        h0: [f(h[0][0]), f(h[0][1]), f(h[0][2]), 0.0],
        h1: [f(h[1][0]), f(h[1][1]), f(h[1][2]), 0.0],
        h2: [f(h[2][0]), f(h[2][1]), f(h[2][2]), 0.0],
        sizes: [canvas.0 as f32, canvas.1 as f32, f(draw.size.0), f(draw.size.1)],
        mask_rect: [f(m.min_x()), f(m.min_y()), f(m.width()), f(m.height())],
        mask: [f(draw.mask.radius), kind, sigma, stroke],
        color,
        color2,
        gradient,
        uv_rect: [f(uv.min_x()), f(uv.min_y()), f(uv.width()), f(uv.height())],
        params: [mode, f(draw.alpha), if mirror { 1.0 } else { 0.0 }, pixel],
    }
}

fn grade_uniform(p: &GradeParams, canvas: (u32, u32)) -> GradeUniform {
    GradeUniform {
        flags: [if p.lut.is_some() { 1.0 } else { 0.0 }, p.bloom, p.vignette, p.grain],
        manual: [p.manual_exposure, p.manual_saturation, p.manual_contrast, p.manual_brightness],
        canvas: [canvas.0 as f32, canvas.1 as f32, p.grain_seed, 0.0],
    }
}

/// The baked LUT image for a preset (16-bit PNG, 1089×33).
fn lut_png(preset: GradePreset) -> Option<&'static [u8]> {
    Some(match preset {
        GradePreset::None => return None,
        GradePreset::Cinematic => include_bytes!("../../assets/luts/cinematic.png"),
        GradePreset::Noir => include_bytes!("../../assets/luts/noir.png"),
        GradePreset::Vintage => include_bytes!("../../assets/luts/vintage.png"),
        GradePreset::Frost => include_bytes!("../../assets/luts/frost.png"),
        GradePreset::Golden => include_bytes!("../../assets/luts/golden.png"),
        GradePreset::Midnight => include_bytes!("../../assets/luts/midnight.png"),
        GradePreset::Vivid => include_bytes!("../../assets/luts/vivid.png"),
        GradePreset::Dreamy => include_bytes!("../../assets/luts/dreamy.png"),
    })
}

/// YCbCr → RGB for BT.709 / BT.601, limited or full range.
fn yuv_uniform(full_range: bool, bt709: bool) -> YuvUniform {
    let (kr, kb) = if bt709 { (0.2126f32, 0.0722f32) } else { (0.299, 0.114) };
    let kg = 1.0 - kr - kb;
    let r = [1.0, 0.0, 2.0 * (1.0 - kr), 0.0];
    let g = [1.0, -2.0 * kb * (1.0 - kb) / kg, -2.0 * kr * (1.0 - kr) / kg, 0.0];
    let b = [1.0, 2.0 * (1.0 - kb), 0.0, 0.0];
    let range = if full_range { [0.0, 1.0, 1.0, 0.0] } else { [16.0 / 255.0, 255.0 / 219.0, 255.0 / 224.0, 0.0] };
    YuvUniform { r, g, b, range }
}

/// IEEE 754 half from f32 (values here are 0…1, so no NaN/inf handling needed beyond clamping).
fn f32_to_f16(v: f32) -> u16 {
    let bits = v.clamp(0.0, 65504.0).to_bits();
    let sign = ((bits >> 16) & 0x8000) as u16;
    let exp = ((bits >> 23) & 0xff) as i32 - 127 + 15;
    let mant = bits & 0x7f_ffff;
    if exp <= 0 {
        if exp < -10 {
            return sign;
        }
        let m = (mant | 0x80_0000) >> (1 - exp);
        return sign | ((m + 0x1000) >> 13) as u16;
    }
    sign | ((exp as u32) << 10 | (mant + 0x1000) >> 13) as u16
}

/// A frame copied out of the GPU, waiting to be mapped.
pub struct Readback {
    pub buffer: wgpu::Buffer,
    pub size: u64,
    pub bytes_per_row: u64,
    pub width: u32,
    pub height: u32,
}

impl Readback {
    /// The mapped frame as tight RGBA rows; unmaps the buffer.
    pub fn collect(&self) -> Result<Vec<u8>, GpuError> {
        let (w, h) = (self.width, self.height);
        let mut out = Vec::with_capacity((w * h * 4) as usize);
        {
            let data = self.buffer.slice(..self.size).get_mapped_range().map_err(|e| GpuError::Readback(e.to_string()))?;
            for row in 0..h as usize {
                let start = row * self.bytes_per_row as usize;
                out.extend_from_slice(&data[start..start + (w * 4) as usize]);
            }
        }
        self.buffer.unmap();
        Ok(out)
    }
}
