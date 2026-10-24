// Final color pass. Presets are 33³ 3D LUTs baked from the Swift app's Core Image chains;
// then manual exposure (in linear light), saturation and contrast (CIColorControls), the
// CIVignette falloff (measured table) and soft-light grain. Premultiplied linear in and out.

struct Grade {
    // x: has LUT, y: bloom intensity, z: vignette intensity, w: grain amount
    flags: vec4<f32>,
    // x: manual exposure (stops), y: saturation, z: contrast, w: brightness
    manual: vec4<f32>,
    // xy: canvas size, z: grain seed
    canvas: vec4<f32>,
};

@group(0) @binding(0) var<uniform> g: Grade;
@group(1) @binding(0) var tex: texture_2d<f32>;
@group(1) @binding(1) var samp: sampler;
@group(2) @binding(0) var bloom_tex: texture_2d<f32>;
@group(2) @binding(1) var lut_tex: texture_2d<f32>;

struct VsOut {
    @builtin(position) clip: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

@vertex
fn vs(@builtin(vertex_index) i: u32) -> VsOut {
    var pos = array<vec2<f32>, 3>(vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
    let p = pos[i];
    var out: VsOut;
    out.clip = vec4<f32>(p, 0.0, 1.0);
    out.uv = vec2<f32>((p.x + 1.0) * 0.5, (1.0 - p.y) * 0.5);
    return out;
}

fn luma(c: vec3<f32>) -> f32 {
    return dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
}

fn to_srgb(c: vec3<f32>) -> vec3<f32> {
    let x = clamp(c, vec3(0.0), vec3(1.0));
    return select(1.055 * pow(x, vec3(1.0 / 2.4)) - 0.055, x * 12.92, x <= vec3(0.0031308));
}

fn to_linear(c: vec3<f32>) -> vec3<f32> {
    let x = clamp(c, vec3(0.0), vec3(1.0));
    return select(pow((x + 0.055) / 1.055, vec3(2.4)), x / 12.92, x <= vec3(0.04045));
}

const N: f32 = 33.0;

// 3D LUT stored as 33 blue slices side by side (1089×33), trilinear.
fn apply_lut(c: vec3<f32>) -> vec3<f32> {
    let b = clamp(c.b, 0.0, 1.0) * (N - 1.0);
    let b0 = floor(b);
    let b1 = min(b0 + 1.0, N - 1.0);
    let f = b - b0;
    let x = clamp(c.r, 0.0, 1.0) * (N - 1.0) + 0.5;
    let y = (clamp(c.g, 0.0, 1.0) * (N - 1.0) + 0.5) / N;
    let s0 = textureSampleLevel(lut_tex, samp, vec2((b0 * N + x) / (N * N), y), 0.0).rgb;
    let s1 = textureSampleLevel(lut_tex, samp, vec2((b1 * N + x) / (N * N), y), 0.0).rgb;
    return mix(s0, s1, f);
}

// CIVignette at radius 1.6 and intensity 1, sampled every 0.025 of the shorter side.
const VIGNETTE = array<f32, 49>(
    1.0000, 0.9991, 0.9965, 0.9921, 0.9860, 0.9782, 0.9688, 0.9577, 0.9449, 0.9306, 0.9147, 0.8974, 0.8785,
    0.8583, 0.8367, 0.8138, 0.7896, 0.7643, 0.7380, 0.7106, 0.6823, 0.6532, 0.6234, 0.5929, 0.5619, 0.5304,
    0.4986, 0.4667, 0.4346, 0.4026, 0.3707, 0.3391, 0.3080, 0.2775, 0.2477, 0.2188, 0.1909, 0.1642, 0.1388,
    0.1150, 0.0929, 0.0727, 0.0546, 0.0387, 0.0253, 0.0145, 0.0065, 0.0016, 0.0000,
);

fn vignette(px: vec2<f32>) -> f32 {
    let u = length(px - g.canvas.xy * 0.5) / min(g.canvas.x, g.canvas.y);
    let i = u / 0.025;
    let i0 = u32(min(floor(i), 48.0));
    let i1 = min(i0 + 1u, 48u);
    return mix(VIGNETTE[i0], VIGNETTE[i1], clamp(i - f32(i0), 0.0, 1.0));
}

fn controls(c: vec3<f32>, saturation: f32, contrast: f32, brightness: f32) -> vec3<f32> {
    var x = mix(vec3(luma(c)), c, saturation);
    return (x - 0.5) * contrast + 0.5 + brightness;
}

fn hash(p: vec2<f32>) -> f32 {
    let q = fract(p * vec2<f32>(123.34, 456.21));
    let r = q + dot(q, q + 45.32);
    return fract(r.x * r.y);
}

@fragment
fn fs(in: VsOut) -> @location(0) vec4<f32> {
    let src = textureSample(tex, samp, in.uv);
    let a = max(src.a, 1e-5);
    var c = src.rgb / a;

    // Bloom (dreamy): blurred highlights added before the color chain.
    if (g.flags.y > 0.0) {
        let bl = textureSample(bloom_tex, samp, in.uv);
        c = c + max(bl.rgb / max(bl.a, 1e-5) - 0.55, vec3(0.0)) * g.flags.y * 1.6;
    }
    if (g.flags.x > 0.5) {
        c = to_linear(apply_lut(to_srgb(c)));
    }
    if (g.manual.x != 0.0) {
        c = c * exp2(g.manual.x);
    }
    if (g.manual.y != 1.0 || g.manual.z != 1.0 || g.manual.w != 0.0) {
        // CIColorControls works in Core Image's linear working space.
        c = max(controls(c, g.manual.y, g.manual.z, g.manual.w), vec3(0.0));
    }
    if (g.flags.z > 0.0) {
        c = c * pow(vignette(in.uv * g.canvas.xy), g.flags.z);
    }
    if (g.flags.w > 0.0) {
        // Soft-light monochrome grain (in gamma space, like CISoftLightBlendMode).
        var gc = to_srgb(c);
        let n = hash(floor(in.uv * g.canvas.xy) + vec2(g.canvas.z, g.canvas.z * 0.6));
        let overlay = 0.5 + (n - 0.5) * 0.36 * g.flags.w;
        gc = select(gc - (1.0 - 2.0 * overlay) * gc * (1.0 - gc),
                    gc + (2.0 * overlay - 1.0) * (sqrt(gc) - gc),
                    vec3(overlay) > vec3(0.5));
        c = to_linear(gc);
    }
    return vec4<f32>(c * src.a, src.a);
}
