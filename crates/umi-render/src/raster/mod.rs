//! CPU-rasterized images the planner places: device chrome, text cards, caption lines, the
//! cursor and decoded image files. Each is drawn once per size and cached; the GPU backend
//! uploads new ones by key.

mod chrome;
mod cursor;
mod text;
pub use text::add_font;

use crate::ops::{SizeSource, TexRef};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use umi_project::edit::{CaptionStyle, DeviceFrame, TextOverlay};
use umi_project::{Point, Size};

/// Premultiplied sRGB RGBA8 pixels.
#[derive(Debug, Clone)]
pub struct RasterImage {
    pub width: u32,
    pub height: u32,
    pub pixels: Vec<u8>,
}

pub struct ChromeRaster {
    pub key: String,
    /// Corner radius for the screen inside the chrome.
    pub content_radius: f64,
}

pub struct CursorRaster {
    pub key: String,
    /// Size and hot spot in points, top-left origin.
    pub size: Size,
    pub hot_spot: Point,
}

/// What the planner asks of the raster layer (and the frame's video textures).
pub trait Assets: SizeSource {
    fn chrome(&mut self, frame: DeviceFrame, width: u32, height: u32) -> Option<ChromeRaster>;
    /// An image file (absolute, or relative to the project bundle): key and pixel size.
    fn image(&mut self, path: &str) -> Option<(String, (u32, u32))>;
    fn text_card(&mut self, text: &TextOverlay, characters: usize, canvas_height: f64) -> Option<(String, (u32, u32))>;
    fn caption(
        &mut self,
        words: &[String],
        active: Option<usize>,
        height: f64,
        accent: [f32; 4],
        style: CaptionStyle,
        shown: usize,
    ) -> Option<(String, (u32, u32))>;
    fn cursor_arrow(&mut self) -> CursorRaster;
    /// Keycaps for the keystroke overlay.
    fn keycaps(&mut self, keys: &[String], height: f64) -> Option<(String, (u32, u32))>;
}

/// Shared cache of rasters (kept across frames and renderers).
#[derive(Default)]
pub struct RasterCache {
    images: Mutex<HashMap<String, Arc<RasterImage>>>,
}

impl RasterCache {
    pub fn get(&self, key: &str) -> Option<Arc<RasterImage>> {
        self.images.lock().get(key).cloned()
    }

    /// Puts an image in the cache under `key` (kept like loaded image files).
    pub fn insert(&self, key: String, image: RasterImage) {
        self.images.lock().insert(key, Arc::new(image));
    }

    fn get_or_insert(&self, key: &str, make: impl FnOnce() -> Option<RasterImage>) -> Option<Arc<RasterImage>> {
        if let Some(image) = self.get(key) {
            return Some(image);
        }
        let image = Arc::new(make()?);
        let mut images = self.images.lock();
        // Keep memory bounded: text cards are re-rendered per typewriter character.
        if images.len() > 512 {
            images.retain(|k, _| k.starts_with("img:") || k.starts_with("cursor"));
        }
        images.insert(key.to_owned(), image.clone());
        Some(image)
    }
}

/// The planner's view of assets for one frame: the shared raster cache, the bundle for
/// relative paths, and the sizes of this frame's video textures.
pub struct FrameAssets<'a> {
    pub cache: &'a RasterCache,
    pub bundle: Option<&'a Path>,
    pub video_sizes: HashMap<TexRef, (u32, u32)>,
}

impl SizeSource for FrameAssets<'_> {
    fn size(&self, texture: &TexRef) -> Option<(u32, u32)> {
        match texture {
            TexRef::Raster(key) => self.cache.get(key).map(|i| (i.width, i.height)),
            other => self.video_sizes.get(other).copied(),
        }
    }
}

fn size_of(image: &RasterImage) -> (u32, u32) {
    (image.width, image.height)
}

impl Assets for FrameAssets<'_> {
    fn chrome(&mut self, frame: DeviceFrame, width: u32, height: u32) -> Option<ChromeRaster> {
        let radius = chrome::content_radius(frame, width as f64, height as f64)?;
        let key = format!("chrome:{frame:?}:{width}x{height}");
        self.cache.get_or_insert(&key, || chrome::draw(frame, width, height))?;
        Some(ChromeRaster { key, content_radius: radius })
    }

    fn image(&mut self, path: &str) -> Option<(String, (u32, u32))> {
        let full: PathBuf = if Path::new(path).is_absolute() { PathBuf::from(path) } else { self.bundle?.join(path) };
        let key = format!("img:{}", full.display());
        let image = self.cache.get_or_insert(&key, || decode_image(&full, 3200))?;
        Some((key, size_of(&image)))
    }

    fn text_card(&mut self, text: &TextOverlay, characters: usize, canvas_height: f64) -> Option<(String, (u32, u32))> {
        let key = format!("text:{}:{:?}:{}:{}:{characters}:{}", text.id, text.style, text.text, text.detail, canvas_height as u32);
        let image = self.cache.get_or_insert(&key, || text::card(text, characters, canvas_height))?;
        Some((key, size_of(&image)))
    }

    fn caption(
        &mut self,
        words: &[String],
        active: Option<usize>,
        height: f64,
        accent: [f32; 4],
        style: CaptionStyle,
        shown: usize,
    ) -> Option<(String, (u32, u32))> {
        let key = format!("caption:{}:{active:?}:{}:{style:?}:{shown}", words.join(" "), height as u32);
        let image = self.cache.get_or_insert(&key, || text::caption(words, active, height, accent, style, shown))?;
        Some((key, size_of(&image)))
    }

    fn keycaps(&mut self, keys: &[String], height: f64) -> Option<(String, (u32, u32))> {
        let key = format!("keys:{}:{}", keys.join("\u{1f}"), height as u32);
        let image = self.cache.get_or_insert(&key, || text::keycaps(keys, height))?;
        Some((key, size_of(&image)))
    }

    fn cursor_arrow(&mut self) -> CursorRaster {
        let key = "cursor:arrow".to_owned();
        self.cache.get_or_insert(&key, || Some(cursor::arrow()));
        CursorRaster { key, size: cursor::SIZE, hot_spot: cursor::HOT_SPOT }
    }
}

/// Decodes an image file, downsampled so its long side is at most `max_side`.
pub fn decode_image(path: &Path, max_side: u32) -> Option<RasterImage> {
    let img = image::open(path).ok().or_else(|| image::open(convert_with_system(path, max_side)?).ok())?;
    let img =
        if img.width().max(img.height()) > max_side { img.resize(max_side, max_side, image::imageops::FilterType::Triangle) } else { img };
    let mut rgba = img.to_rgba8();
    // Premultiply for blending.
    for px in rgba.pixels_mut() {
        let a = px[3] as u16;
        if a < 255 {
            for c in 0..3 {
                px[c] = ((px[c] as u16 * a + 127) / 255) as u8;
            }
        }
    }
    Some(RasterImage { width: rgba.width(), height: rgba.height(), pixels: rgba.into_raw() })
}

/// Formats the image crate can't read (HEIC wallpapers on macOS) converted to JPEG with the
/// system's own tool, cached next to other temporary files. `None` elsewhere.
pub fn convert_with_system(path: &Path, max_side: u32) -> Option<PathBuf> {
    if !cfg!(target_os = "macos") {
        return None;
    }
    let modified = std::fs::metadata(path).and_then(|m| m.modified()).ok()?;
    let stamp = modified.duration_since(std::time::UNIX_EPOCH).ok()?.as_secs();
    let folder = std::env::temp_dir().join("umi-images");
    std::fs::create_dir_all(&folder).ok()?;
    let name = path.file_stem()?.to_string_lossy();
    let out = folder.join(format!("{name}-{stamp}-{max_side}.jpg"));
    if out.exists() {
        return Some(out);
    }
    let ok = std::process::Command::new("/usr/bin/sips")
        .args(["-s", "format", "jpeg", "-s", "formatOptions", "92", "-Z", &max_side.to_string()])
        .arg(path)
        .arg("--out")
        .arg(&out)
        .output()
        .is_ok_and(|o| o.status.success());
    ok.then_some(out)
}

/// tiny-skia pixmap → raster image (already premultiplied RGBA).
pub(crate) fn from_pixmap(pixmap: tiny_skia::Pixmap) -> RasterImage {
    RasterImage { width: pixmap.width(), height: pixmap.height(), pixels: pixmap.take() }
}
