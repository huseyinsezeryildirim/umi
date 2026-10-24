// NV12 (Y plane + interleaved UV plane) → linear premultiplied RGBA, on the GPU, so decoded
// video frames never go through a CPU color conversion.

struct Yuv {
    // Rows of the YCbCr → RGB matrix (BT.709 or BT.601), w = offset.
    r: vec4<f32>,
    g: vec4<f32>,
    b: vec4<f32>,
    // x: y offset (16/255 limited, 0 full), y: y scale, z: c scale
    range: vec4<f32>,
};

@group(0) @binding(0) var<uniform> m: Yuv;
@group(1) @binding(0) var y_tex: texture_2d<f32>;
@group(1) @binding(1) var samp: sampler;
@group(1) @binding(2) var uv_tex: texture_2d<f32>;

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
    let y = (textureSample(y_tex, samp, in.uv).r - m.range.x) * m.range.y;
    let c = (textureSample(uv_tex, samp, in.uv).rg - vec2(0.5)) * m.range.z;
    let yuv = vec3<f32>(y, c.x, c.y);
    let rgb = clamp(vec3<f32>(dot(m.r.xyz, yuv), dot(m.g.xyz, yuv), dot(m.b.xyz, yuv)), vec3(0.0), vec3(1.0));
    // sRGB-encoded video → linear light for compositing.
    return vec4<f32>(pow(rgb, vec3(2.2)), 1.0);
}
