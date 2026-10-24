// One shader for every layer: a quad mapped onto the canvas by a 3×3 homography (so 3D
// moves stay perspective correct), filled with a color, gradient or texture, optionally
// masked by an anti-aliased rounded/squircle rect, or drawn as a soft shadow or a ring.
//
// Canvas space: pixels, bottom-left origin. Quad-local space: pixels, top-left origin.

struct Draw {
    // Homography rows: canvas = H · (u·w, v·h, 1), with (u, v) ∈ [0, 1]².
    h0: vec4<f32>,
    h1: vec4<f32>,
    h2: vec4<f32>,
    // xy: canvas size, zw: quad size (local px)
    sizes: vec4<f32>,
    // Mask rect in local px (x, y, w, h).
    mask_rect: vec4<f32>,
    // x: radius, y: kind (0 none, 1 rounded, 2 squircle, 3 inverted rounded), z: sigma (shadow), w: stroke width
    mask: vec4<f32>,
    color: vec4<f32>,
    color2: vec4<f32>,
    // Gradient endpoints in local px (x0, y0, x1, y1).
    gradient: vec4<f32>,
    // Texture sub-rect in normalized uv (x, y, w, h).
    uv_rect: vec4<f32>,
    // x: mode, y: alpha, z: mirror (1 = flip u), w: pixel size (pixelate) in local px
    params: vec4<f32>,
};

@group(0) @binding(0) var<uniform> d: Draw;
@group(1) @binding(0) var tex: texture_2d<f32>;
@group(1) @binding(1) var samp: sampler;

struct VsOut {
    @builtin(position) clip: vec4<f32>,
    @location(0) local: vec2<f32>,
};

@vertex
fn vs(@builtin(vertex_index) i: u32) -> VsOut {
    var corners = array<vec2<f32>, 6>(
        vec2(0.0, 0.0), vec2(1.0, 0.0), vec2(0.0, 1.0),
        vec2(0.0, 1.0), vec2(1.0, 0.0), vec2(1.0, 1.0),
    );
    let uv = corners[i];
    let p = vec3<f32>(uv * d.sizes.zw, 1.0);
    let x = dot(d.h0.xyz, p);
    let y = dot(d.h1.xyz, p);
    let w = dot(d.h2.xyz, p);
    var out: VsOut;
    // Canvas px (bottom-left) → clip space with w kept for perspective-correct varyings.
    out.clip = vec4<f32>(x * 2.0 / d.sizes.x - w, y * 2.0 / d.sizes.y - w, 0.0, w);
    out.local = uv * d.sizes.zw;
    return out;
}

// Signed distance to a rounded rect centered at the origin (negative inside).
fn sd_rounded(p: vec2<f32>, half: vec2<f32>, r: f32) -> f32 {
    let q = abs(p) - half + vec2(r);
    return length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

// Apple-style continuous corner: a superellipse corner (exponent 5) over a longer run.
fn sd_squircle(p: vec2<f32>, half: vec2<f32>, r: f32) -> f32 {
    let rr = min(r * 1.28, min(half.x, half.y));
    let q = abs(p) - half + vec2(rr);
    if (q.x <= 0.0 || q.y <= 0.0) {
        return max(abs(p).x - half.x, abs(p).y - half.y);
    }
    let n = 5.0;
    let k = pow(pow(q.x / rr, n) + pow(q.y / rr, n), 1.0 / n);
    return (k - 1.0) * rr;
}

fn mask_distance(local: vec2<f32>) -> f32 {
    let center = d.mask_rect.xy + d.mask_rect.zw * 0.5;
    let half = d.mask_rect.zw * 0.5;
    let p = local - center;
    let r = min(d.mask.x, min(half.x, half.y));
    if (d.mask.y > 1.5 && d.mask.y < 2.5) {
        return sd_squircle(p, half, r);
    }
    return sd_rounded(p, half, r);
}

// Gaussian-blurred rounded box (Evan Wallace's closed form).
fn gaussian(x: f32, sigma: f32) -> f32 {
    return exp(-(x * x) / (2.0 * sigma * sigma)) / (2.5066283 * sigma);
}
fn erf2(x: vec2<f32>) -> vec2<f32> {
    let s = sign(x);
    let a = abs(x);
    var r = 1.0 + (0.278393 + (0.230389 + 0.078108 * (a * a)) * a) * a;
    r = r * r;
    return s - s / (r * r);
}
fn rounded_box_shadow_x(x: f32, y: f32, sigma: f32, corner: f32, half: vec2<f32>) -> f32 {
    let delta = min(half.y - corner - abs(y), 0.0);
    let curved = half.x - corner + sqrt(max(0.0, corner * corner - delta * delta));
    let integral = 0.5 + 0.5 * erf2((vec2(x) + vec2(-curved, curved)) * (sqrt(0.5) / sigma));
    return integral.y - integral.x;
}
fn rounded_box_shadow(p: vec2<f32>, half: vec2<f32>, sigma: f32, corner: f32) -> f32 {
    let low = p.y - half.y;
    let high = p.y + half.y;
    let start = clamp(-3.0 * sigma, low, high);
    let end = clamp(3.0 * sigma, low, high);
    let step = (end - start) / 4.0;
    var y = start + step * 0.5;
    var value = 0.0;
    for (var i = 0; i < 4; i = i + 1) {
        value = value + rounded_box_shadow_x(p.x, p.y - y, sigma, corner, half) * gaussian(y, sigma) * step;
        y = y + step;
    }
    return value;
}

fn sample_texture(local: vec2<f32>) -> vec4<f32> {
    var uv = local / d.sizes.zw;
    if (d.params.z > 0.5) {
        uv.x = 1.0 - uv.x;
    }
    return textureSample(tex, samp, d.uv_rect.xy + uv * d.uv_rect.zw);
}

@fragment
fn fs(in: VsOut) -> @location(0) vec4<f32> {
    let mode = u32(d.params.x + 0.5);
    let alpha = d.params.y;
    var color: vec4<f32>;

    switch mode {
        // Solid color (premultiplied).
        case 0u: {
            color = d.color;
        }
        // Texture.
        case 1u: {
            color = sample_texture(in.local) * d.color;
        }
        // Linear gradient between two points.
        case 2u: {
            let a = d.gradient.xy;
            let b = d.gradient.zw;
            let ab = b - a;
            let t = clamp(dot(in.local - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
            color = mix(d.color, d.color2, t);
        }
        // Soft shadow of the mask rect.
        case 3u: {
            let center = d.mask_rect.xy + d.mask_rect.zw * 0.5;
            let half = d.mask_rect.zw * 0.5;
            let sigma = max(d.mask.z, 0.5);
            let v = rounded_box_shadow(in.local - center, half, sigma, min(d.mask.x, min(half.x, half.y)));
            return d.color * clamp(v, 0.0, 1.0) * alpha;
        }
        // Ring (stroke of the mask rect).
        case 4u: {
            let dist = mask_distance(in.local);
            let aa = max(fwidth(dist), 0.5);
            let w = d.mask.w * 0.5;
            let cov = 1.0 - smoothstep(w - aa, w + aa, abs(dist + w));
            return d.color * cov * alpha;
        }
        // Pixelated texture: blocks anchored at the mask rect's origin.
        case 5u: {
            let size = max(d.params.w, 1.0);
            // Grid anchored at the rect's bottom-left corner, like CIPixellate's center.
            let origin = vec2(d.mask_rect.x, d.mask_rect.y + d.mask_rect.w);
            let cell = floor((in.local - origin) / size) * size + origin + size * 0.5;
            color = sample_texture(cell) * d.color;
        }
        default: {
            color = d.color;
        }
    }

    let kind = d.mask.y;
    if (kind > 0.5) {
        let dist = mask_distance(in.local);
        let aa = max(fwidth(dist) * 0.75, 0.35);
        var cov = 1.0 - smoothstep(-aa, aa, dist);
        if (kind > 2.5) {
            cov = 1.0 - cov;
        }
        color = color * cov;
    }
    return color * alpha;
}
