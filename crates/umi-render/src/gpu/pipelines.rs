//! Render pipelines and bind group layouts, created once per device.

use std::num::NonZeroU64;

/// Intermediate layers: linear light, half float, premultiplied alpha.
pub const LAYER_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba16Float;
/// The finished frame: 8-bit sRGB.
pub const OUTPUT_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba8UnormSrgb;
/// Uniform slots are aligned to this (the WebGPU minimum for dynamic offsets).
pub const UNIFORM_ALIGN: u64 = 256;

#[repr(C)]
#[derive(Debug, Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
pub struct DrawUniform {
    pub h0: [f32; 4],
    pub h1: [f32; 4],
    pub h2: [f32; 4],
    pub sizes: [f32; 4],
    pub mask_rect: [f32; 4],
    pub mask: [f32; 4],
    pub color: [f32; 4],
    pub color2: [f32; 4],
    pub gradient: [f32; 4],
    pub uv_rect: [f32; 4],
    pub params: [f32; 4],
}

#[repr(C)]
#[derive(Debug, Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
pub struct BlurUniform {
    pub params: [f32; 4],
}

#[repr(C)]
#[derive(Debug, Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
pub struct GradeUniform {
    pub flags: [f32; 4],
    pub manual: [f32; 4],
    pub canvas: [f32; 4],
}

#[repr(C)]
#[derive(Debug, Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
pub struct YuvUniform {
    pub r: [f32; 4],
    pub g: [f32; 4],
    pub b: [f32; 4],
    pub range: [f32; 4],
}

pub struct Pipelines {
    pub uniform_layouts: UniformLayouts,
    pub texture_layout: wgpu::BindGroupLayout,
    pub yuv_texture_layout: wgpu::BindGroupLayout,
    pub bloom_layout: wgpu::BindGroupLayout,
    pub quad_layer: wgpu::RenderPipeline,
    pub quad_output: wgpu::RenderPipeline,
    pub blur: wgpu::RenderPipeline,
    pub grade: wgpu::RenderPipeline,
    pub yuv: wgpu::RenderPipeline,
    pub sampler: wgpu::Sampler,
}

pub struct UniformLayouts {
    pub draw: wgpu::BindGroupLayout,
    pub blur: wgpu::BindGroupLayout,
    pub grade: wgpu::BindGroupLayout,
    pub yuv: wgpu::BindGroupLayout,
}

fn uniform_layout(device: &wgpu::Device, label: &str, size: usize) -> wgpu::BindGroupLayout {
    device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
        label: Some(label),
        entries: &[wgpu::BindGroupLayoutEntry {
            binding: 0,
            visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
            ty: wgpu::BindingType::Buffer {
                ty: wgpu::BufferBindingType::Uniform,
                has_dynamic_offset: true,
                min_binding_size: NonZeroU64::new(size as u64),
            },
            count: None,
        }],
    })
}

fn texture_entry(binding: u32) -> wgpu::BindGroupLayoutEntry {
    wgpu::BindGroupLayoutEntry {
        binding,
        visibility: wgpu::ShaderStages::FRAGMENT,
        ty: wgpu::BindingType::Texture {
            sample_type: wgpu::TextureSampleType::Float { filterable: true },
            view_dimension: wgpu::TextureViewDimension::D2,
            multisampled: false,
        },
        count: None,
    }
}

fn sampler_entry(binding: u32) -> wgpu::BindGroupLayoutEntry {
    wgpu::BindGroupLayoutEntry {
        binding,
        visibility: wgpu::ShaderStages::FRAGMENT,
        ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
        count: None,
    }
}

fn pipeline(
    device: &wgpu::Device,
    label: &str,
    source: &str,
    layouts: &[Option<&wgpu::BindGroupLayout>],
    format: wgpu::TextureFormat,
    blend: Option<wgpu::BlendState>,
) -> wgpu::RenderPipeline {
    let module =
        device.create_shader_module(wgpu::ShaderModuleDescriptor { label: Some(label), source: wgpu::ShaderSource::Wgsl(source.into()) });
    let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
        label: Some(label),
        bind_group_layouts: layouts,
        ..Default::default()
    });
    device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some(label),
        layout: Some(&layout),
        vertex: wgpu::VertexState { module: &module, entry_point: Some("vs"), compilation_options: Default::default(), buffers: &[] },
        primitive: wgpu::PrimitiveState::default(),
        depth_stencil: None,
        multisample: wgpu::MultisampleState::default(),
        fragment: Some(wgpu::FragmentState {
            module: &module,
            entry_point: Some("fs"),
            compilation_options: Default::default(),
            targets: &[Some(wgpu::ColorTargetState { format, blend, write_mask: wgpu::ColorWrites::ALL })],
        }),
        multiview_mask: None,
        cache: None,
    })
}

impl Pipelines {
    pub fn new(device: &wgpu::Device) -> Self {
        let uniform_layouts = UniformLayouts {
            draw: uniform_layout(device, "draw uniforms", size_of::<DrawUniform>()),
            blur: uniform_layout(device, "blur uniforms", size_of::<BlurUniform>()),
            grade: uniform_layout(device, "grade uniforms", size_of::<GradeUniform>()),
            yuv: uniform_layout(device, "yuv uniforms", size_of::<YuvUniform>()),
        };
        let texture_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("texture"),
            entries: &[texture_entry(0), sampler_entry(1)],
        });
        let yuv_texture_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("yuv textures"),
            entries: &[texture_entry(0), sampler_entry(1), texture_entry(2)],
        });
        let bloom_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("bloom + lut"),
            entries: &[texture_entry(0), texture_entry(1)],
        });

        let premultiplied = Some(wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING);
        let quad_src = include_str!("../shaders/quad.wgsl");
        Self {
            quad_layer: pipeline(
                device,
                "quad layer",
                quad_src,
                &[Some(&uniform_layouts.draw), Some(&texture_layout)],
                LAYER_FORMAT,
                premultiplied,
            ),
            quad_output: pipeline(
                device,
                "quad output",
                quad_src,
                &[Some(&uniform_layouts.draw), Some(&texture_layout)],
                OUTPUT_FORMAT,
                premultiplied,
            ),
            blur: pipeline(
                device,
                "blur",
                include_str!("../shaders/blur.wgsl"),
                &[Some(&uniform_layouts.blur), Some(&texture_layout)],
                LAYER_FORMAT,
                None,
            ),
            grade: pipeline(
                device,
                "grade",
                include_str!("../shaders/grade.wgsl"),
                &[Some(&uniform_layouts.grade), Some(&texture_layout), Some(&bloom_layout)],
                LAYER_FORMAT,
                None,
            ),
            yuv: pipeline(
                device,
                "yuv",
                include_str!("../shaders/yuv.wgsl"),
                &[Some(&uniform_layouts.yuv), Some(&yuv_texture_layout)],
                LAYER_FORMAT,
                None,
            ),
            sampler: device.create_sampler(&wgpu::SamplerDescriptor {
                label: Some("linear clamp"),
                mag_filter: wgpu::FilterMode::Linear,
                min_filter: wgpu::FilterMode::Linear,
                ..Default::default()
            }),
            uniform_layouts,
            texture_layout,
            yuv_texture_layout,
            bloom_layout,
        }
    }
}
