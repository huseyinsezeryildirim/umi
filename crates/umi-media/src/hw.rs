//! Hardware decoding: attach the platform's device to a decoder and download frames.
//! ffmpeg-next has no safe wrapper for this, so these are thin, documented FFI calls.

use crate::MediaError;
use ff::ffi;
use ffmpeg_next as ff;

/// The platform's preferred hardware device type.
fn device_type() -> Option<ffi::AVHWDeviceType> {
    if cfg!(target_os = "macos") {
        Some(ffi::AVHWDeviceType::AV_HWDEVICE_TYPE_VIDEOTOOLBOX)
    } else if cfg!(target_os = "windows") {
        Some(ffi::AVHWDeviceType::AV_HWDEVICE_TYPE_D3D11VA)
    } else if cfg!(target_os = "linux") {
        Some(ffi::AVHWDeviceType::AV_HWDEVICE_TYPE_VAAPI)
    } else {
        None
    }
}

/// Gives the decoder a hardware device. Returns false (software decoding) if unavailable.
pub fn attach_device(context: &mut ff::codec::context::Context) -> bool {
    let Some(kind) = device_type() else { return false };
    // SAFETY: `device` is an out-parameter owned by us until handed to the codec context,
    // which takes its own reference (`av_buffer_ref`); we then release ours.
    unsafe {
        let mut device: *mut ffi::AVBufferRef = std::ptr::null_mut();
        if ffi::av_hwdevice_ctx_create(&mut device, kind, std::ptr::null(), std::ptr::null_mut(), 0) < 0 || device.is_null() {
            return false;
        }
        let ctx = context.as_mut_ptr();
        (*ctx).hw_device_ctx = ffi::av_buffer_ref(device);
        ffi::av_buffer_unref(&mut device);
        !(*ctx).hw_device_ctx.is_null()
    }
}

pub fn is_hardware(frame: &ff::frame::Video) -> bool {
    // SAFETY: reading a field of a valid frame.
    unsafe { !(*frame.as_ptr()).hw_frames_ctx.is_null() }
}

/// Copies a hardware frame into system memory (NV12 for 8-bit, P010 for 10-bit).
pub fn download(frame: &ff::frame::Video) -> Result<ff::frame::Video, MediaError> {
    let mut out = ff::frame::Video::empty();
    // SAFETY: both frames are valid; av_hwframe_transfer_data allocates `out`'s buffers.
    unsafe {
        let r = ffi::av_hwframe_transfer_data(out.as_mut_ptr(), frame.as_ptr(), 0);
        if r < 0 {
            return Err(MediaError::Ffmpeg(ff::Error::from(r)));
        }
        (*out.as_mut_ptr()).pts = (*frame.as_ptr()).pts;
        (*out.as_mut_ptr()).color_range = (*frame.as_ptr()).color_range;
        (*out.as_mut_ptr()).colorspace = (*frame.as_ptr()).colorspace;
    }
    Ok(out)
}
