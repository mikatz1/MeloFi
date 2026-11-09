// WebGL2 renderer for the stage. Same picture as the Canvas2D path, but every
// particle kind, all note bars and all wisp segments go out as single instanced
// draw calls, and bloom is a downsample + separable Gaussian blur on the GPU.
// The simulation (particle motion, bars, key state) stays in stage.js.

const SPARK = 0, DUST = 1, HAZE = 2, PETAL = 3, EMBER = 4, SNOW = 5, INK = 6;
const SH_GLOW = 0, SH_PETAL = 1, SH_FLAKE = 2, SH_BLOT = 3, SH_PIXEL = 4, SH_RING = 5, SH_BEAM = 6;

const VS_QUAD = `#version 300 es
layout(location=0) in vec2 aQuad;
uniform vec2 uRes;
uniform vec4 uRect;
uniform float uFlip;
out vec2 vUv;
void main() {
  vec2 p = uRect.xy + aQuad * uRect.zw;
  vUv = vec2(aQuad.x, uFlip > 0.5 ? 1.0 - aQuad.y : aQuad.y);
  gl_Position = vec4(p / uRes * 2.0 - 1.0, 0.0, 1.0) * vec4(1.0, -1.0, 1.0, 1.0);
}`;

const FS_TEX = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform float uAlpha;
out vec4 o;
void main() { o = texture(uTex, vUv) * uAlpha; }`;

const FS_BLUR = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uStep;
out vec4 o;
void main() {
  // 9-tap Gaussian (sigma ~2 texels) folded into 5 bilinear taps
  vec4 c = texture(uTex, vUv) * 0.2270;
  c += (texture(uTex, vUv + uStep * 1.3846) + texture(uTex, vUv - uStep * 1.3846)) * 0.3162;
  c += (texture(uTex, vUv + uStep * 3.2308) + texture(uTex, vUv - uStep * 3.2308)) * 0.0703;
  o = c;
}`;

// glossy keys: the light just above the key line, mirrored onto the key fronts and fading down
const FS_REFL = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform float uAlpha;
uniform vec2 uRes;
uniform vec2 uTop;    // key line y (top-down px), reflection depth (px)
out vec4 o;
void main() {
  float y = uRes.y - gl_FragCoord.y;
  float d = (y - uTop.x) / uTop.y;
  if (d < 0.0 || d > 1.0) discard;
  float ys = uTop.x - (y - uTop.x) * 1.15 - 4.0;
  vec4 c = texture(uTex, vec2(gl_FragCoord.x / uRes.x, 1.0 - ys / uRes.y));
  float f = 1.0 - d;
  o = c * uAlpha * f * f;
}`;

// keys mirrored upward in the lacquered board above them: shallow, fading fast
const FS_KREF = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform float uAlpha;
uniform vec2 uRes;
uniform vec2 uTop;    // key line y (top-down px), reflection height (px)
out vec4 o;
void main() {
  float y = uRes.y - gl_FragCoord.y;
  float d = (uTop.x - y) / uTop.y;
  if (d < 0.0 || d > 1.0) discard;
  float f = 1.0 - d;
  o = texture(uTex, vUv) * uAlpha * f * f;
}`;

// light-layer composite: soft highlight roll-off + fade where it runs onto the keys
const FS_FX = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform float uAlpha;
uniform vec2 uRes;
uniform vec2 uMask;   // y (top-down px) where the fade starts / ends
uniform float uKnee;  // 1 = roll highlights off instead of clipping
out vec4 o;
vec3 knee(vec3 x) {
  vec3 k = vec3(0.68);
  return mix(x, k + (1.0 - k) * (1.0 - exp(-(x - k) / (1.0 - k))), step(k, x));
}
void main() {
  vec4 c = texture(uTex, vUv) * uAlpha;
  if (uKnee > 0.5) { c.rgb = knee(c.rgb); c.a = min(c.a, 1.0); }
  float y = uRes.y - gl_FragCoord.y;
  float t = clamp((y - uMask.x) / max(1.0, uMask.y - uMask.x), 0.0, 1.0);
  float m = (1.0 - t) * (1.0 - t); // quick at first, then a long soft tail
  o = c * m;
}`;

// sprites: pos(2) half(2) rot color(4) hot shape seed  = 12 floats
const VS_SPRITE = `#version 300 es
layout(location=0) in vec2 aQuad;
layout(location=1) in vec4 iPosHalf;
layout(location=2) in float iRot;
layout(location=3) in vec4 iColor;
layout(location=4) in vec3 iHotShapeSeed;
uniform vec2 uRes;
uniform float uScale;
out vec2 vUv;
out vec4 vColor;
flat out float vHot;
flat out float vShape;
flat out float vSeed;
void main() {
  vec2 q = aQuad * 2.0 - 1.0;
  vUv = q;
  vec2 o = q * iPosHalf.zw;
  float c = cos(iRot), s = sin(iRot);
  vec2 p = (iPosHalf.xy + vec2(c * o.x - s * o.y, s * o.x + c * o.y)) * uScale;
  vColor = iColor; vHot = iHotShapeSeed.x; vShape = iHotShapeSeed.y; vSeed = iHotShapeSeed.z;
  gl_Position = vec4(p / uRes * 2.0 - 1.0, 0.0, 1.0) * vec4(1.0, -1.0, 1.0, 1.0);
}`;

const FS_SPRITE = `#version 300 es
precision highp float;
in vec2 vUv;
in vec4 vColor;
flat in float vHot;
flat in float vShape;
flat in float vSeed;
out vec4 o;
void main() {
  float r = length(vUv);
  vec3 col = vColor.rgb;
  float a;
  if (vShape < 0.5) {
    // radial glow: 0 -> 1, .18 -> .85, .45 -> .28, 1 -> 0 ; white-hot centre
    a = r < 0.18 ? mix(1.0, 0.85, r / 0.18) : r < 0.45 ? mix(0.85, 0.28, (r - 0.18) / 0.27) : mix(0.28, 0.0, clamp((r - 0.45) / 0.55, 0.0, 1.0));
    col = mix(col, vec3(1.0), vHot * (1.0 - smoothstep(0.0, 0.2, r)));
  } else if (vShape < 1.5) {
    // petal: rounded body with a small notch at the tip, white at the tip
    vec2 p = vUv;
    float body = (p.x * p.x) / (0.36 * (1.0 - 0.35 * p.y)) + (p.y * p.y) / 0.62;
    float notch = smoothstep(0.08, 0.0, abs(p.x)) * smoothstep(-0.55, -0.75, p.y);
    a = (1.0 - smoothstep(0.85, 1.0, body)) * (1.0 - notch);
    col = mix(vec3(1.0, 0.95, 0.97), col, clamp(p.y * 0.5 + 0.5, 0.0, 1.0));
  } else if (vShape < 2.5) {
    a = r < 0.35 ? mix(1.0, 0.7, r / 0.35) : mix(0.7, 0.0, clamp((r - 0.35) / 0.65, 0.0, 1.0));
    col = vec3(1.0);
  } else if (vShape < 3.5) {
    float ang = atan(vUv.y, vUv.x);
    float rr = r * (1.0 + 0.16 * sin(ang * 5.0 + vSeed) + 0.08 * sin(ang * 9.0 - vSeed * 1.7));
    a = (1.0 - smoothstep(0.35, 1.0, rr)) * 0.6;
  } else if (vShape < 4.5) {
    a = 1.0; // flat square pixel (arcade theme)
  } else if (vShape < 5.5) {
    a = smoothstep(0.78, 0.92, r) * (1.0 - smoothstep(0.94, 1.0, r)); // thin ring
  } else {
    // light shaft: soft across, strongest at the bottom
    float hx = 1.0 - abs(vUv.x);
    a = hx * hx * pow(clamp((vUv.y + 1.0) * 0.5, 0.0, 1.0), 1.6);
  }
  if (r > 1.42) discard;
  a *= vColor.a;
  o = vec4(col * a, a);
}`;

// rounded rects with vertical gradient + optional outer glow
// rect(4) radius colTop(4) colBot(4) glow(4) spread  = 18 floats
const VS_RECT = `#version 300 es
layout(location=0) in vec2 aQuad;
layout(location=1) in vec4 iRect;
layout(location=2) in float iRadius;
layout(location=3) in vec4 iTop;
layout(location=4) in vec4 iBot;
layout(location=5) in vec4 iGlow;
layout(location=6) in float iSpread;
uniform vec2 uRes;
out vec2 vP;
flat out vec4 vRect;
flat out float vRadius;
flat out vec4 vTop;
flat out vec4 vBot;
flat out vec4 vGlow;
flat out float vSpread;
void main() {
  vec2 lo = iRect.xy - iSpread, size = iRect.zw + 2.0 * iSpread;
  vec2 p = lo + aQuad * size;
  vP = p;
  vRect = iRect; vRadius = iRadius; vTop = iTop; vBot = iBot; vGlow = iGlow; vSpread = iSpread;
  gl_Position = vec4(p / uRes * 2.0 - 1.0, 0.0, 1.0) * vec4(1.0, -1.0, 1.0, 1.0);
}`;

const FS_RECT = `#version 300 es
precision highp float;
in vec2 vP;
flat in vec4 vRect;
flat in float vRadius;
flat in vec4 vTop;
flat in vec4 vBot;
flat in vec4 vGlow;
flat in float vSpread;
out vec4 o;
void main() {
  vec2 c = vRect.xy + vRect.zw * 0.5;
  vec2 h = vRect.zw * 0.5;
  float rad = min(vRadius, min(h.x, h.y));
  vec2 q = abs(vP - c) - h + rad;
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - rad;
  float t = clamp((vP.y - vRect.y) / max(1.0, vRect.w), 0.0, 1.0);
  vec4 core = mix(vTop, vBot, t);
  float ca = core.a * clamp(0.5 - d, 0.0, 1.0);
  float g = 0.0;
  if (vSpread > 0.0) { float k = 1.0 - clamp(d / vSpread, 0.0, 1.0); g = vGlow.a * k * k; }
  vec3 rgb = core.rgb * ca + vGlow.rgb * g * (1.0 - ca);
  o = vec4(rgb, ca + g * (1.0 - ca));
}`;

// capsule segments for wisps: a(2) b(2) width color(4) = 9 floats
const VS_SEG = `#version 300 es
layout(location=0) in vec2 aQuad;
layout(location=1) in vec4 iAB;
layout(location=2) in float iW;
layout(location=3) in vec4 iColor;
uniform vec2 uRes;
out vec2 vP;
flat out vec4 vAB;
flat out float vW;
flat out vec4 vColor;
void main() {
  vec2 a = iAB.xy, b = iAB.zw;
  vec2 d = b - a; float L = max(length(d), 0.001); vec2 u = d / L; vec2 n = vec2(-u.y, u.x);
  float r = iW * 0.5 + 1.0;
  vec2 p = a - u * r + u * (L + 2.0 * r) * aQuad.x + n * r * (aQuad.y * 2.0 - 1.0);
  vP = p; vAB = iAB; vW = iW; vColor = iColor;
  gl_Position = vec4(p / uRes * 2.0 - 1.0, 0.0, 1.0) * vec4(1.0, -1.0, 1.0, 1.0);
}`;

const FS_SEG = `#version 300 es
precision highp float;
in vec2 vP;
flat in vec4 vAB;
flat in float vW;
flat in vec4 vColor;
out vec4 o;
void main() {
  vec2 a = vAB.xy, b = vAB.zw, pa = vP - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0.0, 1.0);
  float d = length(pa - ba * h) - vW * 0.5;
  float al = vColor.a * clamp(0.5 - d, 0.0, 1.0);
  o = vec4(vColor.rgb * al, al);
}`;


// ---------- ink on paper ----------
// field texture: r = pigment, g = water. Water spreads along the paper fibres and
// dries; pigment only moves while it is wet, so it stops (and darkens) at the drying edge.
const FS_INK_SIM = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform sampler2D uFiber;
uniform vec2 uTexel;
uniform vec2 uFiberScale;
uniform float uDecay;
uniform float uEvap;
out vec4 o;
void main() {
  vec4 c = texture(uTex, vUv);
  vec4 n = texture(uTex, vUv + vec2(0.0, uTexel.y)), s = texture(uTex, vUv - vec2(0.0, uTexel.y));
  vec4 e = texture(uTex, vUv + vec2(uTexel.x, 0.0)), w = texture(uTex, vUv - vec2(uTexel.x, 0.0));
  vec4 ne = texture(uTex, vUv + uTexel), sw = texture(uTex, vUv - uTexel);
  vec4 nw = texture(uTex, vUv + vec2(-uTexel.x, uTexel.y)), se = texture(uTex, vUv + vec2(uTexel.x, -uTexel.y));
  vec4 lap = (n + s + e + w) * 0.2 + (ne + nw + se + sw) * 0.05 - c;
  float fib = texture(uFiber, vUv * uFiberScale).r;
  float flow = mix(0.25, 1.0, fib);
  float water = max(0.0, c.g + 0.92 * flow * lap.g - uEvap);
  float wet = smoothstep(0.015, 0.18, c.g);
  float pig = c.r + 0.8 * flow * wet * lap.r;
  // as the wet front stalls, a little pigment piles up there (tide line)
  pig += 0.06 * wet * (1.0 - wet) * c.r;
  o = vec4(max(0.0, pig * uDecay), water, 0.0, 1.0);
}`;

const FS_INK_DRAW = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform sampler2D uFiber;
uniform vec2 uTexel;
uniform vec2 uFiberScale;
uniform vec2 uRes;
uniform vec2 uMask;
out vec4 o;
void main() {
  float p = texture(uTex, vUv).r;
  float avg = 0.0;
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.785398;
    avg += texture(uTex, vUv + vec2(cos(a), sin(a)) * uTexel * 3.0).r;
  }
  avg *= 0.125;
  float edge = max(0.0, p - avg);
  float dens = 1.0 - exp(-(p * 1.5 + edge * 4.0));
  float grain = texture(uFiber, vUv * uFiberScale * 2.3).r;
  dens *= mix(0.8, 1.08, grain);
  vec3 wash = vec3(0.36, 0.34, 0.31), sumi = vec3(0.045, 0.04, 0.035);
  vec3 ink = mix(wash, sumi, smoothstep(0.08, 0.85, dens));
  float y = uRes.y - gl_FragCoord.y;
  float t = clamp((y - uMask.x) / max(1.0, uMask.y - uMask.x), 0.0, 1.0);
  float m = (1.0 - t) * (1.0 - t);
  float a = clamp(dens, 0.0, 0.97) * m;
  o = vec4(ink * a, a);
}`;

// note bars as one confident brush stroke, drawn from where the note started (top)
// to where it is now (bottom): a pressed, ink-heavy entry; a body with fine bristle
// streaks and only a gentle hand wobble; ink running dry along long strokes (flying white);
// a tapered tip once the key is released.
const FS_BRUSH = `#version 300 es
precision highp float;
in vec2 vP;
flat in vec4 vRect;
flat in float vRadius;
flat in vec4 vTop;
flat in vec4 vBot;
flat in vec4 vGlow;
flat in float vSpread;
out vec4 o;
float hash(float x) { return fract(sin(x * 127.1) * 43758.5453); }
float vnoise(float x) { float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(hash(i), hash(i + 1.0), f); }
void main() {
  float seed = vGlow.x;
  float released = vGlow.y;         // 1 when the key is up: the tip lifts off
  float W = vRect.z, L = vRect.w;
  float y = vP.y - vRect.y;          // 0 at the start of the stroke
  float u = clamp(y / max(L, 1.0), 0.0, 1.0);
  // gentle wobble of the centre line, like a steady hand
  float cx = vRect.x + W * 0.5 + (sin(vP.y * 0.011 + seed) * 0.07 + sin(vP.y * 0.029 + seed * 1.7) * 0.03) * W;
  // width: pressed entry bulb, then an even body all the way (the brush lifts off squarely, no point)
  float entry = exp(-pow(y / (W * 1.1), 2.0));
  float hw = W * 0.5 * (1.0 + 0.38 * entry);
  float dx = abs(vP.x - cx) - hw;
  // round the start of the stroke
  float capTop = length(vec2(vP.x - cx, min(y - hw, 0.0))) - hw;
  float d = y < hw ? max(dx, capTop) : dx;
  if (y < 0.0) d = max(d, 1.0);
  float a = clamp(0.5 - d, 0.0, 1.0);
  // bristle streaks run along the stroke
  float xn = (vP.x - cx) / max(hw, 1.0) * 0.5 + 0.5;
  float br = vnoise(xn * 23.0 + seed) * 0.55 + vnoise(xn * 61.0 + seed * 3.0) * 0.45;
  float streak = mix(0.78, 1.0, br);
  if (released > 0.5) {
    // lift-off: each bristle leaves the paper at a slightly different point, so the end is ragged
    float reach = min(1.0, L / (W * 2.5));
    float ragged = W * reach * (0.12 + 1.0 * vnoise(xn * 15.0 + seed * 2.3) + 0.45 * vnoise(xn * 43.0 + seed));
    float cut = L - ragged;
    a *= 1.0 - smoothstep(cut - 0.8, cut + 0.8, y);
    // and the last stretch drags dry: gaps open up between the bristles
    float endDry = smoothstep(cut - W * 2.4, cut, y) * reach;
    float g2 = smoothstep(endDry * 0.8 - 0.06, endDry * 0.8 + 0.06, br + 0.18 * vnoise(vP.y * 0.23 + seed));
    a *= mix(1.0, g2, endDry);
  } else if (y > L + 1.0) a = 0.0;
  // flying white: ink runs dry with length, first at the edges
  float dry = smoothstep(W * 5.0, W * 26.0, y) * 0.85;
  float edge = abs(xn - 0.5) * 2.0;
  float gap = smoothstep(dry * (0.35 + 0.65 * edge) - 0.08, dry * (0.35 + 0.65 * edge) + 0.04, br + 0.12 * vnoise(vP.y * 0.05 + seed));
  a *= streak * mix(1.0, gap, dry > 0.01 ? 1.0 : 0.0);
  // ink density: darkest at the entry, a touch lighter as the brush empties
  vec4 col = mix(vTop, vBot, u);
  float dens = mix(1.0, 0.82 - dry * 0.25, smoothstep(0.0, W * 3.0, y)) + entry * 0.15;
  a *= clamp(dens, 0.0, 1.0) * col.a;
  o = vec4(col.rgb * a, a);
}`;

function fiberCanvas(size = 256) {
  // tileable paper-fibre map: soft value noise plus long thin fibres that wrap around
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d');
  x.fillStyle = '#808080';
  x.fillRect(0, 0, size, size);
  let seed = 11;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 140; i++) {
    const px = r() * size, py = r() * size, rr = 8 + r() * 40;
    for (const [ox, oy] of [[0, 0], [size, 0], [-size, 0], [0, size], [0, -size]]) {
      const g = x.createRadialGradient(px + ox, py + oy, 0, px + ox, py + oy, rr);
      const v = r() < 0.5 ? 0 : 255;
      g.addColorStop(0, `rgba(${v},${v},${v},0.12)`);
      g.addColorStop(1, `rgba(${v},${v},${v},0)`);
      x.fillStyle = g;
      x.fillRect(px + ox - rr, py + oy - rr, rr * 2, rr * 2);
    }
  }
  x.lineCap = 'round';
  for (let i = 0; i < 260; i++) {
    const px = r() * size, py = r() * size, len = 10 + r() * 60, a = r() * Math.PI * 2;
    x.strokeStyle = `rgba(255,255,255,${0.15 + r() * 0.35})`;
    x.lineWidth = 0.6 + r() * 1.6;
    for (const [ox, oy] of [[0, 0], [size, 0], [-size, 0], [0, size], [0, -size]]) {
      x.beginPath();
      x.moveTo(px + ox, py + oy);
      x.quadraticCurveTo(px + ox + Math.cos(a + 0.5) * len * 0.5, py + oy + Math.sin(a + 0.5) * len * 0.5, px + ox + Math.cos(a) * len, py + oy + Math.sin(a) * len);
      x.stroke();
    }
  }
  return c;
}

function hexRgb(h) {
  const n = parseInt(h.slice(1, 7), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

class InstBuf {
  constructor(gl, stride, cap) { this.gl = gl; this.stride = stride; this.cap = cap; this.data = new Float32Array(stride * cap); this.n = 0; this.buf = gl.createBuffer(); }
  reset() { this.n = 0; }
  grow() {
    const d = new Float32Array(this.data.length * 2);
    d.set(this.data);
    this.data = d;
    this.cap *= 2;
  }
  upload() {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.subarray(0, this.n * this.stride), gl.STREAM_DRAW);
  }
}

export class GLRenderer {
  static create(canvas) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, premultipliedAlpha: true, preserveDrawingBuffer: true, powerPreference: 'high-performance', desynchronized: false });
    if (!gl) return null;
    try { return new GLRenderer(gl); } catch (e) { console.error('WebGL2 init failed', e); return null; }
  }

  constructor(gl) {
    this.gl = gl;
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    this.gpuName = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'WebGL2';
    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);

    this.pTex = this.program(VS_QUAD, FS_TEX);
    this.pFx = this.program(VS_QUAD, FS_FX);
    this.hdr = !!gl.getExtension('EXT_color_buffer_float'); // float light layer: highlights can exceed 1 and roll off
    this.pBlur = this.program(VS_QUAD, FS_BLUR);
    this.pSprite = this.program(VS_SPRITE, FS_SPRITE);
    this.pRefl = this.program(VS_QUAD, FS_REFL);
    this.pKref = this.program(VS_QUAD, FS_KREF);
    this.pRect = this.program(VS_RECT, FS_RECT);
    this.pSeg = this.program(VS_SEG, FS_SEG);
    this.pInkSim = this.program(VS_QUAD, FS_INK_SIM);
    this.pInkDraw = this.program(VS_QUAD, FS_INK_DRAW);
    this.pBrush = this.program(VS_RECT, FS_BRUSH);
    this.deps = new InstBuf(gl, 12, 512);
    this.scale = 1;
    this.inkFlip = 0;
    this.inkTheme = null;

    this.sprites = new InstBuf(gl, 12, 8192);
    this.rects = new InstBuf(gl, 18, 512);
    this.segs = new InstBuf(gl, 9, 2048);
    this.vao = gl.createVertexArray();

    this.tex = {};
    this.fb = {};
    this.colorCache = new Map();
  }

  program(vs, fs) {
    const gl = this.gl;
    const mk = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, mk(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const name = gl.getActiveUniform(p, i).name; u[name] = gl.getUniformLocation(p, name); }
    return { p, u };
  }

  rgb(hex) {
    let c = this.colorCache.get(hex);
    if (!c) { c = hexRgb(hex); this.colorCache.set(hex, c); }
    return c;
  }

  // ---------- resources ----------

  texture(name, w, h, float = false) {
    const gl = this.gl;
    let t = this.tex[name];
    if (!t) { t = this.tex[name] = { t: gl.createTexture(), w: 0, h: 0 }; }
    gl.bindTexture(gl.TEXTURE_2D, t.t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (w && (t.w !== w || t.h !== h)) {
      if (float) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      t.w = w; t.h = h;
    }
    return t;
  }

  upload(name, canvas, repeat = false) {
    const gl = this.gl;
    const t = this.texture(name);
    if (repeat) {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    }
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    t.w = canvas.width; t.h = canvas.height;
  }

  target(name, w, h, float = false) {
    const gl = this.gl;
    const t = this.texture(name, w, h, float && this.hdr);
    let f = this.fb[name];
    if (!f) {
      f = this.fb[name] = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.t, 0);
    }
    return { f, t, w, h };
  }

  bind(target) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.f : null);
    const w = target ? target.w : this.W, h = target ? target.h : this.H;
    gl.viewport(0, 0, w, h);
    this.res = [w, h];
  }

  blend(mode) {
    const gl = this.gl;
    gl.enable(gl.BLEND);
    if (mode === 'add') gl.blendFunc(gl.ONE, gl.ONE);
    else if (mode === 'copy') gl.disable(gl.BLEND);
    else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  // draw a texture into a rect (pixel coords of the current target)
  blit(tex, x, y, w, h, alpha = 1, flip = false, prog = this.pTex, step = null) {
    const gl = this.gl;
    gl.useProgram(prog.p);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    for (let i = 1; i < 8; i++) gl.disableVertexAttribArray(i);
    gl.uniform2f(prog.u.uRes, this.res[0], this.res[1]);
    gl.uniform4f(prog.u.uRect, x, y, w, h);
    gl.uniform1f(prog.u.uFlip, flip ? 1 : 0);
    if (prog.u.uAlpha) gl.uniform1f(prog.u.uAlpha, alpha);
    if (step && prog.u.uStep) gl.uniform2f(prog.u.uStep, step[0], step[1]);
    if (prog.u.uMask) gl.uniform2f(prog.u.uMask, this.mask[0], this.mask[1]);
    if (prog.u.uKnee) gl.uniform1f(prog.u.uKnee, this.hdr ? 1 : 0);
    if (prog.u.uTop) gl.uniform2f(prog.u.uTop, this.refl[0], this.refl[1]);
    if (prog.u.uFiber) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.tex.fiber.t);
      gl.uniform1i(prog.u.uFiber, 1);
      gl.uniform2f(prog.u.uFiberScale, this.ink.w / 256, this.ink.h / 256);
      gl.uniform2f(prog.u.uTexel, 1 / this.ink.w, 1 / this.ink.h);
      if (prog.u.uDecay) { gl.uniform1f(prog.u.uDecay, this.ink.decay); gl.uniform1f(prog.u.uEvap, this.ink.evap); }
      gl.activeTexture(gl.TEXTURE0);
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex.t);
    gl.uniform1i(prog.u.uTex, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  instanced(prog, ib, layout, start, count) {
    if (count <= 0) return;
    const gl = this.gl;
    gl.useProgram(prog.p);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, ib.buf);
    const stride = ib.stride * 4;
    let off = 0;
    layout.forEach((size, i) => {
      gl.enableVertexAttribArray(i + 1);
      gl.vertexAttribPointer(i + 1, size, gl.FLOAT, false, stride, start * stride + off * 4);
      gl.vertexAttribDivisor(i + 1, 1);
      off += size;
    });
    for (let i = layout.length + 1; i < 8; i++) gl.disableVertexAttribArray(i);
    gl.uniform2f(prog.u.uRes, this.res[0], this.res[1]);
    if (prog.u.uScale) gl.uniform1f(prog.u.uScale, this.scale);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
    for (let i = 1; i <= layout.length; i++) gl.vertexAttribDivisor(i, 0);
  }

  // ---------- instance writers ----------

  sprite(x, y, hw, hh, rot, rgb, a, hot, shape, seed = 0) {
    const b = this.sprites;
    if (b.n >= b.cap) b.grow();
    const d = b.data, o = b.n++ * 12;
    d[o] = x; d[o + 1] = y; d[o + 2] = hw; d[o + 3] = hh; d[o + 4] = rot;
    d[o + 5] = rgb[0]; d[o + 6] = rgb[1]; d[o + 7] = rgb[2]; d[o + 8] = a;
    d[o + 9] = hot; d[o + 10] = shape; d[o + 11] = seed;
  }

  rect(x, y, w, h, r, top, bot, glow = null, spread = 0) {
    const b = this.rects;
    if (b.n >= b.cap) b.grow();
    const d = b.data, o = b.n++ * 18;
    d[o] = x; d[o + 1] = y; d[o + 2] = w; d[o + 3] = h; d[o + 4] = r;
    d.set(top, o + 5); d.set(bot, o + 9);
    if (glow) d.set(glow, o + 13); else { d[o + 13] = d[o + 14] = d[o + 15] = d[o + 16] = 0; }
    d[o + 17] = spread;
  }

  seg(ax, ay, bx, by, w, rgb, a) {
    const b = this.segs;
    if (b.n >= b.cap) b.grow();
    const d = b.data, o = b.n++ * 9;
    d[o] = ax; d[o + 1] = ay; d[o + 2] = bx; d[o + 3] = by; d[o + 4] = w;
    d[o + 5] = rgb[0]; d[o + 6] = rgb[1]; d[o + 7] = rgb[2]; d[o + 8] = a;
  }


  drawInk(st, fxRects, rects) {
    const gl = this.gl;
    const { W, H, top, dpr } = st;
    const w = Math.max(2, W >> 1), h = Math.max(2, H >> 1);
    if (!this.tex.fiber) this.upload('fiber', fiberCanvas(), true);
    const A = this.target('inkA', w, h, true), B = this.target('inkB', w, h, true);
    const fresh = this.inkTheme !== st.theme || this.inkSize !== `${w}x${h}`;
    if (fresh) {
      for (const tg of [A, B]) { this.bind(tg); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); }
      this.inkTheme = st.theme; this.inkSize = `${w}x${h}`; this.inkFlip = 0; this.inkAcc = 0;
    }
    const now = st.time;
    const dt = Math.min(0.05, Math.max(0, now - (this.inkT ?? now)));
    this.inkT = now;
    // ~120 simulation steps per second regardless of refresh rate
    this.inkAcc = (this.inkAcc || 0) + dt * 120;
    const steps = Math.min(6, Math.floor(this.inkAcc));
    this.inkAcc -= steps;
    this.ink = { w, h, decay: Math.pow(0.5, 1 / (120 * 4.5)), evap: 0.005 }; // pigment half-life ~4.5 s, water dries in ~2 s

    const cur = () => (this.inkFlip ? B : A), other = () => (this.inkFlip ? A : B);

    // deposits: queued drops + wet trails behind rising strokes + ink motes
    const D = this.deps;
    D.reset();
    const dep = (x, y, r, p, wtr, seed) => {
      if (D.n >= D.cap) D.grow();
      const d = D.data, o = D.n++ * 12;
      d[o] = x; d[o + 1] = y; d[o + 2] = r; d[o + 3] = r; d[o + 4] = seed;
      d[o + 5] = p; d[o + 6] = wtr; d[o + 7] = 0; d[o + 8] = 1;
      d[o + 9] = 0; d[o + 10] = 3; d[o + 11] = seed;
    };
    for (const q of st.inkQueue) dep(q.x, q.y, q.r, q.p, q.w, q.seed);
    st.inkQueue.length = 0;
    const speed = H * 0.21 * st.opts.speed;
    for (const b of st.bars) {
      if (b.t1 == null) continue;
      const k = st.keys[b.note];
      if (!k) continue;
      const y2 = top - (now - b.t1) * speed;
      if (y2 < 0) continue;
      const bw = (k.black ? k.w * 0.7 : st.ww * 0.46) * st.barScale;
      dep(k.cx, y2 - bw * 0.3, bw * 0.9, 0.018 * dt * 60, 0.16 * dt * 60, b.t0); // faint, wide, wet: bleeds into a wash instead of a line
    }
    for (let i = 0; i < st.n; i++) {
      if (st.kind[i] !== INK) continue;
      const lf = st.life[i] / st.max[i];
      dep(st.px[i], st.py[i], st.size[i] * 0.5, 0.025 * lf * dt * 60, 0.05 * dt * 60, st.seed[i]);
    }
    if (D.n) {
      D.upload();
      this.bind(cur());
      this.blend('add');
      this.scale = 0.5;
      this.instanced(this.pSprite, D, [4, 1, 4, 3], 0, D.n);
      this.scale = 1;
    }

    // bleed
    this.blend('copy');
    for (let i = 0; i < steps; i++) {
      this.bind(other());
      this.blit(cur().t, 0, 0, w, h, 1, true, this.pInkSim);
      this.inkFlip ^= 1;
    }

    // print the ink on the paper (fading out where it reaches the keys)
    this.bind(null);
    this.blend('over');
    this.mask = [top - 2 * dpr, top + st.fadeLen() * 0.6];
    this.blit(cur().t, 0, 0, W, H, 1, true, this.pInkDraw);

    // plain note bars on top of the ink
    rects(0, fxRects);
  }

  // ---------- frame ----------

  resize(W, H) { this.W = W; this.H = H; }

  draw(st, lit) {
    const gl = this.gl;
    const { W, H, top, dpr, theme: t } = st;
    this.W = W; this.H = H;
    if (st.staticDirty) {
      this.upload('bg', st.bgC);
      this.upload('white', st.whiteC);
      this.upload('black', st.blackC);
      st.staticDirty = false;
    }
    const additive = t.blend === 'lighter';

    // ----- build instance data -----
    this.sprites.reset(); this.rects.reset(); this.segs.reset();
    const groups = {};
    const mark = (name, fn) => { const s = this.sprites.n; fn(); groups[name] = [s, this.sprites.n - s]; };
    const sparkCols = [...t.spark, ...st.extraSparks].map((c) => this.rgb(c));
    const vis = st.opts.visualizer;

    if (vis) {
      const T = st.time, n = st.n;
      const K = st.kind, X = st.px, Y = st.py, L = st.life, M = st.max, S = st.size, C = st.col, R = st.rot, E = st.seed;
      const hazeA = (additive ? 0.16 : 0.07) * st.hazeK;
      const cHaze = this.rgb(t.haze), cDust = this.rgb(t.dust);
      const px = !!t.pixel;
      // per-note colours (score hands, note-colour setting): slot n of st.tints is C[i] = n + 1
      const tHaze = st.tints.map((x) => this.rgb(x.haze)), tDust = st.tints.map((x) => this.rgb(x.dust));
      // extra effects: background pulse and pedal light shafts (behind everything)
      const FX = st.fxNow;
      mark('beams', () => {
        if (!FX || !additive) return;
        if (FX.pulse > 0.005) this.sprite(W / 2, top, W * 0.75, H * 0.5, 0, this.rgb(t.barGlow), FX.pulse, 0, SH_GLOW);
        for (const b of FX.beams) this.sprite(b.x, b.y, b.hw, b.hh, 0, this.rgb(b.color), b.a, 0, SH_BEAM);
      });
      mark('haze', () => { for (let i = 0; i < n; i++) if (K[i] === HAZE) { const lf = L[i] / M[i]; this.sprite(X[i], Y[i], S[i], S[i], 0, (C[i] && tHaze[C[i] - 1]) || cHaze, Math.sin(lf * Math.PI) * hazeA, 0, SH_GLOW); } });
      mark('dust', () => {
        for (let i = 0; i < n; i++) {
          const k = K[i];
          if (k === DUST && px) {
            const lf = L[i] / M[i]; const [cx, cy, hs] = st.pixel(X[i], Y[i], 0);
            this.sprite(cx, cy, hs, hs, 0, (C[i] && tDust[C[i] - 1]) || cDust, Math.round(Math.sin(lf * Math.PI) * 0.35 * 4) / 4, 0, SH_PIXEL);
          } else if (k === DUST) { const lf = L[i] / M[i]; const s = S[i] * 3; this.sprite(X[i], Y[i], s, s, 0, (C[i] && tDust[C[i] - 1]) || cDust, Math.sin(lf * Math.PI) * 0.55, 0.2, SH_GLOW); }
          else if (k === INK) { const lf = L[i] / M[i]; const s = S[i] * 2; const ci = [0, 1, 3][C[i]] ?? 0; this.sprite(X[i], Y[i], s, s, 0, sparkCols[ci] || sparkCols[0], Math.sin(lf * Math.PI) * 0.55, 0, SH_BLOT, E[i]); }
        }
      });
      // bars (rects)
      for (const b of st.barShapes()) {
        const { k, y1, y2 } = b;
        const w = (k.black ? k.w * 0.7 : st.ww * 0.46) * st.barScale;
        const nc = b.color || st.colorOf(b.note);
        const core = this.rgb(nc || t.bar), glow = this.rgb(nc || t.barGlow);
        const h = Math.max(w, y2 - y1);
        const fresh = b.fresh;
        const ga = additive ? 0.42 : 0.16;
        if (px) {
          const [bx, by, bw2, bh] = st.pixelBar(k.cx, w, y2 - h, y2);
          const a = b.live ? 1 : 0.85;
          this.rect(bx, by, bw2, bh, 0, [...core, a], [...core, a], [...glow, ga * 0.7], st.P * 3);
          continue;
        }
        this.rect(k.cx - w / 2, y2 - h, w, h, w / 2, [...core, 0.55 * fresh], [...core, 0.95 * fresh], [...glow, ga], w * 1.6);
      }
      // big-chord flash: a wash of light rising from the key line
      if (FX?.flash && additive && !t.inkSim) {
        const c = this.rgb(FX.flash.color);
        this.rect(0, FX.flash.y, W, FX.flash.h, 0, [...c, 0], [...c, FX.flash.a]);
      }
      // wisps (segments)
      const cW = this.rgb(t.wisp), tW = st.tints.map((x) => this.rgb(x.wisp));
      for (const ws of st.wisps) {
        const wc = (ws.tint && tW[ws.tint - 1]) || cW;
        const life = Math.max(0, ws.life / ws.max);
        const fadeIn = Math.min(1, (ws.max - ws.life) * 6);
        for (let s = 1; s < ws.N; s++) {
          const i0 = (ws.head + s) % ws.N, i1 = (ws.head + s + 1) % ws.N;
          const p = s / ws.N;
          const a = Math.min(1, p * p * life * fadeIn * 1.25);
          if (a < 0.01) continue;
          this.seg(ws.pts[i0 * 2], ws.pts[i0 * 2 + 1], ws.pts[i1 * 2], ws.pts[i1 * 2 + 1], ws.w * Math.sin(p * Math.PI * 0.95 + 0.05), wc, a);
        }
      }
      mark('sparks', () => {
        for (let i = 0; i < n; i++) {
          const k = K[i];
          if (px && (k === SPARK || k === EMBER)) {
            const lf = L[i] / M[i]; const [cx, cy, hs] = st.pixel(X[i], Y[i], S[i]);
            this.sprite(cx, cy, hs, hs, 0, sparkCols[C[i]] || sparkCols[0], Math.round(Math.min(1, lf * 1.6) * 4) / 4, 0, SH_PIXEL);
          } else if (k === SPARK) {
            const lf = L[i] / M[i];
            const tw = 0.65 + 0.35 * Math.sin(T * 26 + E[i]);
            const s = S[i] * 3.2;
            this.sprite(X[i], Y[i], s, s, 0, sparkCols[C[i]] || sparkCols[0], Math.min(1, lf * 1.6) * tw, C[i] === 0 ? 0 : 0.45, SH_GLOW);
          } else if (k === EMBER) {
            const lf = L[i] / M[i];
            const fl = 0.55 + 0.45 * Math.sin(T * 17 + E[i] * 3);
            const s = S[i] * 2.6;
            this.sprite(X[i], Y[i], s, s, 0, sparkCols[C[i]] || sparkCols[0], lf * fl, 0.45, SH_GLOW);
          } else if (k === SNOW) {
            const lf = L[i] / M[i];
            this.sprite(X[i], Y[i], S[i], S[i], 0, [1, 1, 1], Math.min(1, lf * 4) * 0.8, 0, SH_FLAKE);
          }
        }
      });
      mark('petals', () => {
        for (let i = 0; i < n; i++) {
          if (K[i] !== PETAL) continue;
          const lf = L[i] / M[i];
          const flip = Math.abs(Math.sin(R[i] * 1.3 + E[i]));
          this.sprite(X[i], Y[i], S[i] * (0.35 + 0.65 * flip), S[i], R[i], sparkCols[3] || sparkCols[0], Math.min(1, lf * 3) * 0.85, 0, SH_PETAL);
        }
      });
      mark('hits', () => {
        const gu = Math.min(st.ww, 26 * dpr);
        for (const [note, v] of lit) {
          const k = st.keys[note];
          const c = this.rgb(st.noteColor(note) || t.hit);
          const r = gu * (1.9 + 0.9 * v) * st.hitK;
          this.sprite(k.cx, top, r, r * 0.7, 0, c, (additive ? 0.26 * v : 0.12 * v) * st.crowd, 0.6, SH_GLOW);
          const cc = gu * (0.55 + 0.35 * v);
          this.sprite(k.cx, top, cc, cc * 0.8, 0, c, (additive ? 0.45 * v : 0.2 * v) * st.crowd, 0.6, SH_GLOW);
        }
      });
      mark('rings', () => { if (FX) for (const r of FX.rings) this.sprite(r.x, r.y, r.rx, r.ry, 0, this.rgb(r.color), r.a, 0, SH_RING); });
    }
    const fxRects = this.rects.n;

    // keyboard overlays: tints (rects) and light (sprites)
    const kb = { whiteTints: [0, 0], blackTints: [0, 0] };
    const tint = (note, v, black) => {
      const k = st.keys[note];
      const lc = this.rgb(st.noteColor(note) || t.keyLit);
      const h = black ? st.bh : st.kbH;
      const gap = black ? 0 : Math.max(1, dpr) / 2;
      this.rect(k.x + gap, top - 2, k.w - gap * 2, h + 2 - (black ? 0 : dpr), 3 * dpr, [...lc, (black ? 0.9 : 0.75) * v], [...lc, (black ? 0.35 : 0.18) * v]);
      this.rect(k.x + gap, top, k.w - gap * 2, 4 * dpr, 0, [0, 0, 0, 0.25 * v], [0, 0, 0, 0.25 * v]);
    };
    let s0 = this.rects.n;
    for (const [note, v] of lit) if (!st.keys[note].black) tint(note, v, false);
    kb.whiteTints = [s0, this.rects.n - s0];
    s0 = this.rects.n;
    for (const [note, v] of lit) if (st.keys[note].black) tint(note, v, true);
    kb.blackTints = [s0, this.rects.n - s0];
    s0 = this.rects.n;
    const felt = this.rgb(t.felt), hl = this.rgb(t.hitLine);
    this.rect(0, top - 3 * dpr, W, 3 * dpr, 0, [...felt, 1], [...felt, 1]);
    this.rect(0, top - 3 * dpr, W, Math.max(1, dpr), 0, [...hl, 0.85], [...hl, 0.85]);
    kb.felt = [s0, this.rects.n - s0];

    mark('spill', () => {
      if (!additive) return;
      const gu = Math.min(st.ww, 26 * dpr);
      for (const [note, v] of lit) {
        const k = st.keys[note];
        const r = gu * 2.6;
        this.sprite(k.cx, top + 0.2 * r, r, r * 0.8, 0, this.rgb(st.noteColor(note) || t.keyLit), 0.28 * v, 0.3, SH_GLOW);
      }
    });
    mark('lineGlow', () => {
      const gu = Math.min(st.ww, 26 * dpr);
      for (const [note, v] of lit) {
        const k = st.keys[note];
        const r = gu * 1.4;
        this.sprite(k.cx, top - 3 * dpr, r, r * 0.25, 0, this.rgb(st.noteColor(note) || t.hit), 0.8 * v, 0.6, SH_GLOW);
      }
    });

    this.sprites.upload(); this.rects.upload(); this.segs.upload();
    const SL = [4, 1, 4, 3], RL = [4, 1, 4, 4, 4, 1], GL = [4, 1, 4];
    const sprites = (g) => this.instanced(this.pSprite, this.sprites, SL, groups[g][0], groups[g][1]);
    const rects = (a, n) => this.instanced(this.pRect, this.rects, RL, a, n);

    // ----- passes -----
    // 1) background and keyboard
    this.bind(null);
    this.blend('copy');
    this.blit(this.tex.bg, 0, 0, W, H);
    this.blend('over');
    this.blit(this.tex.white, 0, top, W, st.kbH);
    rects(...kb.whiteTints);
    this.blit(this.tex.black, 0, top, W, st.kbH);
    rects(...kb.blackTints);
    if (additive) {
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(0, 0, W, H - top);
      this.blend('add');
      sprites('spill');
      gl.disable(gl.SCISSOR_TEST);
    }
    this.blend('over');
    // keys reflected in the board above them
    if (st.fxOn) {
      this.refl = [top - 3 * dpr, Math.max(8 * dpr, st.kbH * 0.16)];
      this.blit(this.tex.white, 0, top - 3 * dpr - st.kbH, W, st.kbH, additive ? 0.17 : 0.1, true, this.pKref);
      this.blit(this.tex.black, 0, top - 3 * dpr - st.kbH, W, st.kbH, additive ? 0.17 : 0.1, true, this.pKref);
    }
    rects(kb.felt[0], 1); // felt strip; the hit line goes on last

    // 2a) ink theme: deposit drops, run the bleed, print it on the paper, brush strokes on top
    if (vis && t.inkSim) {
      this.drawInk(st, fxRects, rects);
    }

    // 2) light layer, which runs a little way onto the keys and fades out there
    if (vis && !t.inkSim) {
      const fade = st.fadeLen();
      const fx = this.target('fx', W, H, true);
      this.bind(fx);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      this.blend(additive ? 'add' : 'over');
      sprites('beams');
      sprites('haze');
      sprites('dust');
      this.blend('over');
      rects(0, fxRects);
      this.blend(additive ? 'add' : 'over');
      this.instanced(this.pSeg, this.segs, GL, 0, this.segs.n);
      sprites('sparks');
      this.blend('over');
      sprites('petals');
      this.blend(additive ? 'add' : 'over');
      sprites('hits');
      sprites('rings');

      this.bind(null);
      this.blend(additive ? 'add' : 'over');
      this.mask = [top - 2 * dpr, top + fade];
      this.blit(fx.t, 0, 0, W, H, 1, true, this.pFx);

      if (st.opts.bloom && st.bloomK > 0 && st.load > 0.45) {
        const w1 = Math.max(2, W >> 2), h1 = Math.max(2, H >> 2), w2 = Math.max(2, W >> 3), h2 = Math.max(2, H >> 3);
        const a1 = this.target('b1', w1, h1, true), a1t = this.target('b1t', w1, h1, true);
        const a2 = this.target('b2', w2, h2, true), a2t = this.target('b2t', w2, h2, true);
        this.blend('copy');
        this.bind(a1); this.blit(fx.t, 0, 0, w1, h1, 1, true);
        this.bind(a1t); this.blit(a1.t, 0, 0, w1, h1, 1, true, this.pBlur, [1 / w1, 0]);
        this.bind(a1); this.blit(a1t.t, 0, 0, w1, h1, 1, true, this.pBlur, [0, 1 / h1]);
        this.bind(a2); this.blit(a1.t, 0, 0, w2, h2, 1, true);
        this.bind(a2t); this.blit(a2.t, 0, 0, w2, h2, 1, true, this.pBlur, [1 / w2, 0]);
        this.bind(a2); this.blit(a2t.t, 0, 0, w2, h2, 1, true, this.pBlur, [0, 1 / h2]);
        this.bind(null);
        this.blend('add');
        this.mask = [top, top + fade * 2];
        this.blit(a1.t, 0, 0, W, H, 0.55 * st.bloomK, true, this.pFx);
        this.blit(a2.t, 0, 0, W, H, 0.75 * st.bloomK, true, this.pFx);
      }
      // glossy keys
      if (st.fxOn && additive) {
        this.bind(null);
        this.blend('add');
        this.refl = [top, st.kbH * 0.55];
        this.blit(fx.t, 0, top, W, st.kbH * 0.55, 0.26, true, this.pRefl);
      }
    }

    // 3) hit line on top
    this.bind(null);
    this.blend('over');
    rects(kb.felt[0] + 1, 1);
    this.blend(additive ? 'add' : 'over');
    sprites('lineGlow');
  }
}
