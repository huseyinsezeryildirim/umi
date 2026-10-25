//! Text overlays (title, lower third, kicker, big stat, quote, typewriter) and burned-in
//! caption lines, shaped with cosmic-text and drawn with tiny-skia.

use super::{RasterImage, from_pixmap};
use cosmic_text::{Attrs, Buffer, Color as TextColor, Family, FontSystem, Metrics, Shaping, Style, SwashCache, Weight};
use parking_lot::Mutex;
use std::sync::OnceLock;
use tiny_skia::{Color, FillRule, Paint, PathBuilder, Pixmap, PremultipliedColorU8, Rect as SkRect, Transform};
use umi_project::edit::{CaptionStyle, TextOverlay, TextStyle};

struct Fonts {
    system: FontSystem,
    cache: SwashCache,
}

fn fonts() -> &'static Mutex<Fonts> {
    static FONTS: OnceLock<Mutex<Fonts>> = OnceLock::new();
    FONTS.get_or_init(|| Mutex::new(Fonts { system: FontSystem::new(), cache: SwashCache::new() }))
}

#[derive(Clone, Copy)]
enum Face {
    Sans(u16),
    Mono(u16),
    SerifItalic,
}

#[derive(Clone)]
struct Line {
    text: String,
    face: Face,
    size: f32,
    color: [u8; 4],
}

/// A shaped line: its glyph coverage as an alpha mask plus metrics.
struct Shaped {
    width: f32,
    ascent: f32,
    descent: f32,
    /// (x, y, alpha) relative to the line's top-left, in px.
    coverage: Vec<(i32, i32, u8)>,
}

fn shape(fonts: &mut Fonts, line: &Line) -> Shaped {
    let metrics = Metrics::new(line.size, line.size * 1.25);
    let mut buffer = Buffer::new(&mut fonts.system, metrics);
    buffer.set_size(None, None);
    let attrs = match line.face {
        Face::Sans(w) => Attrs::new().family(Family::SansSerif).weight(Weight(w)),
        Face::Mono(w) => Attrs::new().family(Family::Monospace).weight(Weight(w)),
        Face::SerifItalic => Attrs::new().family(Family::Serif).style(Style::Italic),
    };
    buffer.set_text(&line.text, &attrs, Shaping::Advanced, None);
    buffer.shape_until_scroll(&mut fonts.system, false);
    let mut width = 0.0f32;
    for run in buffer.layout_runs() {
        width = width.max(run.line_w);
    }
    let mut coverage = Vec::new();
    let Fonts { system, cache } = fonts;
    buffer.draw(system, cache, TextColor::rgba(255, 255, 255, 255), |x, y, w, h, color| {
        let a = color.a();
        if a == 0 {
            return;
        }
        for dy in 0..h as i32 {
            for dx in 0..w as i32 {
                coverage.push((x + dx, y + dy, a));
            }
        }
    });
    // cosmic-text lays the first line out with its top at 0 and baseline at ~0.8·line height.
    let ascent = line.size * 0.95;
    let descent = line.size * 0.3;
    Shaped { width, ascent, descent, coverage }
}

fn blend_coverage(pm: &mut Pixmap, shaped: &Shaped, ox: f32, oy: f32, color: [u8; 4]) {
    let (w, h) = (pm.width() as i32, pm.height() as i32);
    let pixels = pm.pixels_mut();
    for &(x, y, a) in &shaped.coverage {
        let (px, py) = (x + ox.round() as i32, y + oy.round() as i32);
        if px < 0 || py < 0 || px >= w || py >= h {
            continue;
        }
        let i = (py * w + px) as usize;
        let alpha = a as u32 * color[3] as u32 / 255;
        let src = [color[0] as u32 * alpha / 255, color[1] as u32 * alpha / 255, color[2] as u32 * alpha / 255, alpha];
        let dst = pixels[i];
        let inv = 255 - alpha;
        let out = [
            src[0] + dst.red() as u32 * inv / 255,
            src[1] + dst.green() as u32 * inv / 255,
            src[2] + dst.blue() as u32 * inv / 255,
            src[3] + dst.alpha() as u32 * inv / 255,
        ];
        if let Some(c) = PremultipliedColorU8::from_rgba(
            out[0].min(out[3]) as u8,
            out[1].min(out[3]) as u8,
            out[2].min(out[3]) as u8,
            out[3].min(255) as u8,
        ) {
            pixels[i] = c;
        }
    }
}

fn rounded_rect(x: f32, y: f32, w: f32, h: f32, r: f32) -> Option<tiny_skia::Path> {
    let r = r.min(w / 2.0).min(h / 2.0);
    let k = 0.552_284_8 * r;
    let mut pb = PathBuilder::new();
    pb.move_to(x + r, y);
    pb.line_to(x + w - r, y);
    pb.cubic_to(x + w - r + k, y, x + w, y + r - k, x + w, y + r);
    pb.line_to(x + w, y + h - r);
    pb.cubic_to(x + w, y + h - r + k, x + w - r + k, y + h, x + w - r, y + h);
    pb.line_to(x + r, y + h);
    pb.cubic_to(x + r - k, y + h, x, y + h - r + k, x, y + h - r);
    pb.line_to(x, y + r);
    pb.cubic_to(x, y + r - k, x + r - k, y, x + r, y);
    pb.close();
    pb.finish()
}

/// Box-blurred copy of the text's alpha used as a soft drop shadow.
fn shadow_mask(pm: &Pixmap, radius: usize) -> Vec<u8> {
    let (w, h) = (pm.width() as usize, pm.height() as usize);
    let mut a: Vec<u8> = pm.pixels().iter().map(|p| p.alpha()).collect();
    let mut tmp = vec![0u8; a.len()];
    for _ in 0..3 {
        for y in 0..h {
            let mut sum = 0u32;
            for x in 0..w + radius {
                if x < w {
                    sum += a[y * w + x] as u32;
                }
                if x > 2 * radius && x - 2 * radius - 1 < w {
                    sum -= a[y * w + x - 2 * radius - 1] as u32;
                }
                if x >= radius && x - radius < w {
                    tmp[y * w + x - radius] = (sum / (2 * radius as u32 + 1)) as u8;
                }
            }
        }
        for x in 0..w {
            let mut sum = 0u32;
            for y in 0..h + radius {
                if y < h {
                    sum += tmp[y * w + x] as u32;
                }
                if y > 2 * radius && y - 2 * radius - 1 < h {
                    sum -= tmp[(y - 2 * radius - 1) * w + x] as u32;
                }
                if y >= radius && y - radius < h {
                    a[(y - radius) * w + x] = (sum / (2 * radius as u32 + 1)) as u8;
                }
            }
        }
    }
    a
}

struct CardStyle {
    padding: (f32, f32),
    background: Option<[u8; 4]>,
    shadow: bool,
    accent_bar: bool,
    align_left: bool,
    capsule: bool,
}

const ACCENT: [u8; 4] = [17, 111, 245, 255];

fn render(lines: &[Line], style: CardStyle) -> Option<RasterImage> {
    let visible: Vec<&Line> = lines.iter().filter(|l| !l.text.is_empty()).collect();
    if visible.is_empty() {
        return None;
    }
    let mut guard = fonts().lock();
    let shaped: Vec<Shaped> = visible.iter().map(|l| shape(&mut guard, l)).collect();
    drop(guard);

    let spacing = shaped[0].ascent * 0.22;
    let content_w = shaped.iter().map(|s| s.width).fold(0.0, f32::max);
    let content_h = shaped.iter().map(|s| s.ascent + s.descent).sum::<f32>() + spacing * (shaped.len() as f32 - 1.0).max(0.0);
    let bar = if style.accent_bar { (content_h * 0.06).max(4.0) } else { 0.0 };
    let margin = if style.shadow { content_h * 0.25 } else { 2.0 };
    let (pw, ph) = style.padding;
    let width = (content_w + pw * 2.0 + bar + if style.accent_bar { pw * 0.6 } else { 0.0 } + margin * 2.0).ceil();
    let height = (content_h + ph * 2.0 + margin * 2.0).ceil();
    let mut pm = Pixmap::new(width.max(1.0) as u32, height.max(1.0) as u32)?;
    let (bx, by, bw, bh) = (margin, margin, width - margin * 2.0, height - margin * 2.0);

    if let Some([r, g, b, a]) = style.background {
        let radius = if style.capsule { bh / 2.0 } else { (bh * 0.18).min(18.0) };
        let mut paint = Paint::default();
        paint.set_color_rgba8(r, g, b, a);
        paint.anti_alias = true;
        pm.fill_path(&rounded_rect(bx, by, bw, bh, radius)?, &paint, FillRule::Winding, Transform::identity(), None);
    }
    if style.accent_bar {
        let mut paint = Paint::default();
        paint.set_color_rgba8(ACCENT[0], ACCENT[1], ACCENT[2], ACCENT[3]);
        pm.fill_rect(SkRect::from_xywh(bx + pw * 0.6, by + ph, bar, bh - ph * 2.0)?, &paint, Transform::identity(), None);
    }

    // Text into its own layer first when it needs a shadow.
    let mut text_layer = Pixmap::new(pm.width(), pm.height())?;
    let mut y = by + ph;
    let text_left = bx + pw + if style.accent_bar { bar + pw * 0.6 } else { 0.0 };
    for (line, s) in visible.iter().zip(&shaped) {
        let x = if style.align_left { text_left } else { bx + (bw - s.width) / 2.0 };
        // cosmic-text glyph y is relative to the line box top.
        blend_coverage(&mut text_layer, s, x, y - line.size * 0.1, line.color);
        y += s.ascent + s.descent + spacing;
    }
    if style.shadow {
        let radius = ((content_h * 0.06) as usize).clamp(1, 24);
        let mask = shadow_mask(&text_layer, radius);
        let offset = (content_h * 0.02).round() as usize;
        let w = pm.width() as usize;
        let pixels = pm.pixels_mut();
        for (i, a) in mask.iter().enumerate() {
            let j = i + offset * w;
            if j < pixels.len() && *a > 0 {
                let sa = (*a as u32 * 115 / 255) as u8; // 0.45 opacity
                let dst = pixels[j];
                let inv = 255 - sa as u32;
                if let Some(c) = PremultipliedColorU8::from_rgba(
                    (dst.red() as u32 * inv / 255) as u8,
                    (dst.green() as u32 * inv / 255) as u8,
                    (dst.blue() as u32 * inv / 255) as u8,
                    (sa as u32 + dst.alpha() as u32 * inv / 255).min(255) as u8,
                ) {
                    pixels[j] = c;
                }
            }
        }
    }
    pm.draw_pixmap(0, 0, text_layer.as_ref(), &tiny_skia::PixmapPaint::default(), Transform::identity(), None);
    Some(from_pixmap(pm))
}

const WHITE: [u8; 4] = [255, 255, 255, 255];
const INK: [u8; 4] = [14, 17, 30, 255];

fn white(alpha: f32) -> [u8; 4] {
    [255, 255, 255, (alpha * 255.0) as u8]
}

pub fn card(text: &TextOverlay, characters: usize, canvas_height: f64) -> Option<RasterImage> {
    let h = canvas_height as f32;
    let shown: String = text.text.chars().take(characters).collect();
    let line = |text: String, face: Face, size: f32, color: [u8; 4]| Line { text, face, size, color };
    let plain = CardStyle { padding: (0.0, 0.0), background: None, shadow: true, accent_bar: false, align_left: false, capsule: false };
    match text.style {
        TextStyle::Title => render(&[line(shown, Face::Sans(700), h * 0.075, WHITE)], plain),
        TextStyle::LowerThird => render(
            &[line(shown, Face::Sans(600), h * 0.036, WHITE), line(text.detail.clone(), Face::Sans(400), h * 0.024, white(0.75))],
            CardStyle {
                padding: (h * 0.03, h * 0.02),
                background: Some([14, 17, 30, 209]),
                shadow: false,
                accent_bar: true,
                align_left: true,
                capsule: false,
            },
        ),
        TextStyle::Kicker => render(
            &[line(shown.to_uppercase(), Face::Sans(700), h * 0.024, INK)],
            CardStyle {
                padding: (h * 0.022, h * 0.012),
                background: Some([255, 255, 255, 242]),
                shadow: false,
                accent_bar: false,
                align_left: false,
                capsule: true,
            },
        ),
        TextStyle::BigStat => render(
            &[line(shown, Face::Sans(800), h * 0.14, WHITE), line(text.detail.clone(), Face::Sans(500), h * 0.028, white(0.85))],
            plain,
        ),
        TextStyle::Quote => {
            let author = if text.detail.is_empty() { String::new() } else { format!("— {}", text.detail) };
            render(
                &[line(format!("“{shown}”"), Face::SerifItalic, h * 0.05, WHITE), line(author, Face::Sans(500), h * 0.026, white(0.8))],
                plain,
            )
        }
        TextStyle::Typewriter => {
            let caret = if characters < text.text.chars().count() { "▍" } else { "" };
            render(
                &[line(format!("{shown}{caret}"), Face::Mono(500), h * 0.034, WHITE)],
                CardStyle {
                    padding: (h * 0.026, h * 0.018),
                    background: Some([14, 17, 30, 224]),
                    shadow: false,
                    accent_bar: false,
                    align_left: false,
                    capsule: false,
                },
            )
        }
    }
}

/// A caption line on a dark pill, with the active word on an accent pill.
pub fn caption(
    words: &[String],
    active: Option<usize>,
    height: f64,
    accent: [f32; 4],
    style: CaptionStyle,
    shown: usize,
) -> Option<RasterImage> {
    let height = height as f32;
    let weight = if style == CaptionStyle::Bold { 850 } else { 700 };
    let mut guard = fonts().lock();
    let shaped: Vec<Shaped> = words
        .iter()
        .map(|w| {
            let text = if style == CaptionStyle::Bold { w.to_uppercase() } else { w.clone() };
            shape(&mut guard, &Line { text, face: Face::Sans(weight), size: height, color: WHITE })
        })
        .collect();
    drop(guard);
    let space = height * 0.28;
    let (pad_w, pad_h) = match style {
        CaptionStyle::Pill => (height * 0.6, height * 0.35),
        _ => (height * 0.3, height * 0.25),
    };
    let ascent = height * 0.95;
    let descent = height * 0.3;
    let text_w: f32 = shaped.iter().map(|s| s.width).sum::<f32>() + space * (words.len() as f32 - 1.0).max(0.0);
    let (w, h) = ((text_w + pad_w * 2.0).ceil(), (ascent + descent + pad_h * 2.0).ceil());
    let mut pm = Pixmap::new(w.max(1.0) as u32, h.max(1.0) as u32)?;
    if style == CaptionStyle::Pill {
        let mut paint = Paint::default();
        paint.set_color_rgba8(14, 17, 30, 199);
        paint.anti_alias = true;
        pm.fill_path(&rounded_rect(0.0, 0.0, w, h, h * 0.28)?, &paint, FillRule::Winding, Transform::identity(), None);
    }
    let to8 = |c: f32| (c.clamp(0.0, 1.0) * 255.0) as u8;
    let accent8 = [to8(accent[0]), to8(accent[1]), to8(accent[2]), 255];
    let mut x = pad_w;
    for (i, s) in shaped.iter().enumerate() {
        if i >= shown {
            break;
        }
        let y = pad_h - height * 0.1;
        let is_active = Some(i) == active;
        match style {
            CaptionStyle::Pill => {
                if is_active {
                    let mut p = Paint::default();
                    p.set_color(Color::from_rgba8(accent8[0], accent8[1], accent8[2], 255));
                    p.anti_alias = true;
                    if let Some(r) = rounded_rect(
                        x - height * 0.14,
                        pad_h - height * 0.06,
                        s.width + height * 0.28,
                        ascent + descent + height * 0.12,
                        height * 0.16,
                    ) {
                        pm.fill_path(&r, &p, FillRule::Winding, Transform::identity(), None);
                    }
                }
                blend_coverage(&mut pm, s, x, y, WHITE);
            }
            CaptionStyle::Bold => {
                // A thick dark outline, then the word (the spoken one in yellow).
                let r = (height * 0.08).max(1.5);
                for k in 0..16 {
                    let a = k as f32 / 16.0 * std::f32::consts::TAU;
                    blend_coverage(&mut pm, s, x + a.cos() * r, y + a.sin() * r, [10, 12, 20, 255]);
                }
                blend_coverage(&mut pm, s, x, y, if is_active { [255, 214, 10, 255] } else { WHITE });
            }
            CaptionStyle::Minimal => {
                let r = (height * 0.05).max(1.0);
                for (dx, dy) in [(0.0, r), (r * 0.7, r * 0.7), (-r * 0.7, r * 0.7)] {
                    blend_coverage(&mut pm, s, x + dx, y + dy, [0, 0, 0, 110]);
                }
                blend_coverage(&mut pm, s, x, y, if is_active { accent8 } else { WHITE });
            }
        }
        x += s.width + space;
    }
    Some(from_pixmap(pm))
}

/// Keys as keycaps on a dark pill: ["⌘", "⇧", "K"]. A long entry (typed text) gets a wide cap.
pub fn keycaps(keys: &[String], height: f64) -> Option<RasterImage> {
    let height = height as f32;
    let size = height * 0.52;
    let mut guard = fonts().lock();
    let shaped: Vec<Shaped> =
        keys.iter().map(|k| shape(&mut guard, &Line { text: k.clone(), face: Face::Sans(600), size, color: WHITE })).collect();
    drop(guard);
    let gap = height * 0.14;
    let pad = height * 0.18;
    let cap_h = height;
    let caps: Vec<f32> = shaped.iter().map(|s| (s.width + height * 0.5).max(cap_h)).collect();
    let w = caps.iter().sum::<f32>() + gap * (caps.len() as f32 - 1.0).max(0.0) + pad * 2.0;
    let h = cap_h + pad * 2.0;
    let mut pm = Pixmap::new(w.ceil().max(1.0) as u32, h.ceil().max(1.0) as u32)?;
    let mut back = Paint::default();
    back.set_color_rgba8(14, 17, 30, 238);
    back.anti_alias = true;
    pm.fill_path(&rounded_rect(0.0, 0.0, w, h, h * 0.3)?, &back, FillRule::Winding, Transform::identity(), None);
    let mut cap = Paint::default();
    cap.set_color_rgba8(58, 63, 78, 255);
    cap.anti_alias = true;
    let mut edge = Paint::default();
    edge.set_color_rgba8(30, 34, 46, 255);
    edge.anti_alias = true;
    let mut x = pad;
    for (s, cw) in shaped.iter().zip(&caps) {
        // A key: lighter face over a slightly darker base (a hint of depth).
        if let Some(r) = rounded_rect(x, pad + cap_h * 0.06, *cw, cap_h * 0.94, cap_h * 0.22) {
            pm.fill_path(&r, &edge, FillRule::Winding, Transform::identity(), None);
        }
        if let Some(r) = rounded_rect(x, pad, *cw, cap_h * 0.9, cap_h * 0.22) {
            pm.fill_path(&r, &cap, FillRule::Winding, Transform::identity(), None);
        }
        let ty = pad + (cap_h * 0.9 - (s.ascent + s.descent)) / 2.0;
        blend_coverage(&mut pm, s, x + (cw - s.width) / 2.0, ty, WHITE);
        x += cw + gap;
    }
    Some(from_pixmap(pm))
}
