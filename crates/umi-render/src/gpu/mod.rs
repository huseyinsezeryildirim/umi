//! wgpu backend: executes planned operations on Metal, Direct3D 12, Vulkan or WebGPU.

mod executor;
mod pipelines;

pub use executor::Executor;

/// Video frame types, re-exported at the crate root.
pub mod executor_types {
    pub use super::executor::{PixelData, VideoFrame};
}
pub use pipelines::Pipelines;

use std::sync::Arc;

#[derive(Debug, thiserror::Error)]
pub enum GpuError {
    #[error("no compatible GPU adapter: {0}")]
    NoAdapter(String),
    #[error("couldn't open the GPU device: {0}")]
    Device(String),
    #[error("reading the frame back failed: {0}")]
    Readback(String),
}

/// The GPU device shared by every renderer in the process.
pub struct Gpu {
    pub device: wgpu::Device,
    pub queue: wgpu::Queue,
    pub pipelines: Pipelines,
    pub adapter_info: wgpu::AdapterInfo,
}

impl Gpu {
    /// Opens the default high-performance adapter without a window (preview and export
    /// render offscreen).
    pub fn new() -> Result<Arc<Gpu>, GpuError> {
        pollster::block_on(Self::new_async())
    }

    pub async fn new_async() -> Result<Arc<Gpu>, GpuError> {
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle_from_env());
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                ..Default::default()
            })
            .await
            .map_err(|e| GpuError::NoAdapter(e.to_string()))?;
        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor { label: Some("umi"), ..Default::default() })
            .await
            .map_err(|e| GpuError::Device(e.to_string()))?;
        let pipelines = Pipelines::new(&device);
        Ok(Arc::new(Gpu { adapter_info: adapter.get_info(), device, queue, pipelines }))
    }
}
