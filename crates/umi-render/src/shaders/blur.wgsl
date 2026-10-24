// Separable Gaussian blur (one direction per pass), sampling between texels so each tap
// reads two weights through bilinear filtering.

struct Blur {
    // xy: direction in uv per texel, z: sigma in texels, w: unused
    params: vec4<f32>,
};

@group(0) @binding(0) var<uniform> b: Blur;
@group(1) @binding(0) var tex: texture_2d<f32>;
@group(1) @binding(1) var samp: sampler;

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

@fragment
fn fs(in: VsOut) -> @location(0) vec4<f32> {
    let sigma = max(b.params.z, 0.01);
    let dir = b.params.xy;
    let radius = i32(ceil(sigma * 3.0));
    var sum = textureSample(tex, samp, in.uv) * 1.0;
    var weight = 1.0;
    var i = 1;
    loop {
        if (i > radius) { break; }
        // Two neighbouring taps merged into one bilinear fetch.
        let w0 = exp(-f32(i * i) / (2.0 * sigma * sigma));
        let w1 = exp(-f32((i + 1) * (i + 1)) / (2.0 * sigma * sigma));
        let w = w0 + w1;
        let offset = (f32(i) * w0 + f32(i + 1) * w1) / max(w, 1e-6);
        sum = sum + (textureSample(tex, samp, in.uv + dir * offset) + textureSample(tex, samp, in.uv - dir * offset)) * w;
        weight = weight + 2.0 * w;
        i = i + 2;
    }
    return sum / weight;
}
