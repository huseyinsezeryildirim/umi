//! Phones and tablets as video sources (macOS): an iPhone or iPad connected by cable shows
//! its screen as a capture device once the system is told to allow screen-capture devices;
//! FFmpeg's AVFoundation input then reads it like a file.

use crate::MediaError;
use crate::decode::VideoDecoder;
use ffmpeg_next as ff;

/// A connected device whose screen can be recorded.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct ScreenDevice {
    pub name: String,
}

#[cfg(target_os = "macos")]
#[allow(unexpected_cfgs)] // objc's msg_send! checks a cfg this crate doesn't declare.
mod mac {
    use super::ScreenDevice;
    use objc::runtime::{Class, Object};
    use objc::{msg_send, sel, sel_impl};
    use std::ffi::{CStr, c_char, c_void};

    #[repr(C)]
    struct PropertyAddress {
        selector: u32,
        scope: u32,
        element: u32,
    }

    #[link(name = "CoreMediaIO", kind = "framework")]
    unsafe extern "C" {
        fn CMIOObjectSetPropertyData(object: u32, address: *const PropertyAddress, qualifier_size: u32, qualifier: *const c_void, size: u32, data: *const c_void) -> i32;
    }

    #[link(name = "AVFoundation", kind = "framework")]
    unsafe extern "C" {
        static AVMediaTypeMuxed: *mut Object;
    }

    /// Lets iPhones/iPads connected by cable appear as capture devices (system-wide flag,
    /// the same one QuickTime Player sets).
    pub fn allow_screen_capture_devices() {
        const SYSTEM_OBJECT: u32 = 1;
        let address = PropertyAddress { selector: u32::from_be_bytes(*b"yes "), scope: u32::from_be_bytes(*b"glob"), element: 0 };
        let allow: u32 = 1;
        // SAFETY: plain C call with a valid address struct and a 4-byte value.
        unsafe {
            CMIOObjectSetPropertyData(SYSTEM_OBJECT, &address, 0, std::ptr::null(), 4, (&allow as *const u32).cast());
        }
    }

    /// Muxed (screen + sound) devices: connected iPhones and iPads.
    pub fn screen_devices() -> Vec<ScreenDevice> {
        let Some(cls) = Class::get("AVCaptureDevice") else { return vec![] };
        let mut out = vec![];
        // SAFETY: standard AVFoundation class methods; returned objects are autoreleased
        // and only read here.
        unsafe {
            let devices: *mut Object = msg_send![cls, devicesWithMediaType: AVMediaTypeMuxed];
            if devices.is_null() {
                return out;
            }
            let count: usize = msg_send![devices, count];
            for i in 0..count {
                let device: *mut Object = msg_send![devices, objectAtIndex: i];
                let name: *mut Object = msg_send![device, localizedName];
                let utf8: *const c_char = msg_send![name, UTF8String];
                if !utf8.is_null() {
                    out.push(ScreenDevice { name: CStr::from_ptr(utf8).to_string_lossy().into_owned() });
                }
            }
        }
        out
    }
}

/// Connected iPhones/iPads (macOS); empty elsewhere. The first call turns discovery on, so
/// a device plugged in a moment ago may take a second to show up.
pub fn screen_devices() -> Vec<ScreenDevice> {
    #[cfg(target_os = "macos")]
    {
        mac::allow_screen_capture_devices();
        mac::screen_devices()
    }
    #[cfg(not(target_os = "macos"))]
    vec![]
}

impl VideoDecoder {
    /// Opens a live device by name (macOS: AVFoundation, e.g. "Ali's iPhone").
    pub fn open_device(name: &str, fps: u32) -> Result<Self, MediaError> {
        crate::init();
        ff::device::register_all();
        let format = ff::device::input::video().find(|f| f.name() == "avfoundation").ok_or(MediaError::NoEncoder)?;
        let mut options = ff::Dictionary::new();
        options.set("framerate", &fps.to_string());
        options.set("capture_raw_data", "0");
        let input = ff::format::open_with(&format!("{name}:none"), &format, options).map_err(|e| MediaError::open(std::path::Path::new(name), e))?;
        Self::from_input(input.input(), false)
    }
}
