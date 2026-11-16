// MeloFi Synth — user waveforms and wavetables (the expert oscillator mode). No DOM here: the editor
// (ui/waveeditor.js), the synth (synth.js) and the e2e tests all use these functions.
//
// A wavetable is { name, frames: Float32Array[] (2048 samples each, one cycle), interp: 'xfade' | 'spectral' }.
// In a project it is stored as { name, interp, n: 2048, data: base64 of the float32 frames back to back },
// so a frame read from a Serum / Vital WAV goes back out with the same bytes.
//
// Playback is band-limited: every frame is turned into its spectrum once, and one table per octave keeps
// only the harmonics that can play without folding into the audible range (mipmaps). The worklet
// (wavetable-worklet.js) picks and crossfades two of them by pitch.

export const N = 2048;          // samples per frame (Serum / Vital)
export const MAXH = N / 2;      // harmonics a frame can hold
export const MAX_FRAMES = 256;

// ---------- FFT (radix 2, in place) ----------
const fftCache = new Map();
function tables(n) {
  let t = fftCache.get(n);
  if (!t) {
    const rev = new Uint32Array(n), bits = Math.log2(n);
    for (let i = 0; i < n; i++) { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); rev[i] = r; }
    const cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos(2 * Math.PI * i / n); sin[i] = Math.sin(2 * Math.PI * i / n); }
    t = { rev, cos, sin }; fftCache.set(n, t);
  }
  return t;
}
// forward when inv = false (e^-i), inverse (unscaled) when inv = true
export function fft(re, im, inv = false) {
  const n = re.length, { rev, cos, sin } = tables(n);
  for (let i = 0; i < n; i++) { const j = rev[i]; if (j > i) { let x = re[i]; re[i] = re[j]; re[j] = x; x = im[i]; im[i] = im[j]; im[j] = x; } }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1, step = n / size;
    for (let s = 0; s < n; s += size) {
      for (let k = 0; k < half; k++) {
        const wr = cos[k * step], wi = inv ? sin[k * step] : -sin[k * step];
        const a = s + k, b = a + half;
        const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
      }
    }
  }
}

// a frame's harmonics: amp[k], phase[k] for k = 1..MAXH (index 0 = DC), as sine-phase:
// frame(x) = dc + sum amp[k] * sin(k x + phase[k])
export function spectrum(frame) {
  const n = frame.length, re = Float64Array.from(frame), im = new Float64Array(n);
  fft(re, im);
  const H = n / 2, amp = new Float64Array(H + 1), phase = new Float64Array(H + 1);
  amp[0] = re[0] / n;
  for (let k = 1; k <= H; k++) {
    const s = k === H ? 1 : 2;
    const a = (s / n) * re[k], b = -(s / n) * im[k]; // frame = a cos + b sin
    amp[k] = Math.hypot(a, b);
    phase[k] = Math.atan2(a, b);
  }
  return { amp, phase, re, im };
}

// a frame of `n` samples from harmonics (amp/phase as above), keeping 1..maxH
export function fromHarmonics(amp, phase, n = N, maxH = Infinity, dc = 0) {
  const re = new Float64Array(n), im = new Float64Array(n), H = Math.min(n / 2 - 1, maxH, amp.length - 1);
  re[0] = dc * n;
  for (let k = 1; k <= H; k++) {
    const a = amp[k] * Math.sin(phase[k] || 0), b = amp[k] * Math.cos(phase[k] || 0);
    re[k] = a * n / 2; im[k] = -b * n / 2;
    re[n - k] = re[k]; im[n - k] = -im[k];
  }
  fft(re, im, true);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = re[i] / n;
  return out;
}

// change a cycle's length without aliasing (zero-padding / truncating its spectrum)
export function resampleCycle(src, n = N) {
  if (src.length === n) return Float32Array.from(src);
  if ((src.length & (src.length - 1)) === 0) {
    const s = spectrum(src);
    return fromHarmonics(s.amp, s.phase, n, Math.min(n, src.length) / 2 - 1, s.amp[0]);
  }
  // any length: windowed-sinc interpolation around the loop (periodic)
  const m = src.length, out = new Float32Array(n), r = m / n, cut = Math.min(1, 1 / r), W = 16;
  for (let i = 0; i < n; i++) {
    const x = i * r, x0 = Math.floor(x);
    let acc = 0;
    for (let j = x0 - W + 1; j <= x0 + W; j++) {
      const d = x - j, w = 0.5 + 0.5 * Math.cos(Math.PI * d / W);
      const s = d === 0 ? 1 : Math.sin(Math.PI * d * cut) / (Math.PI * d * cut);
      acc += src[((j % m) + m) % m] * s * w * cut;
    }
    out[i] = acc;
  }
  return out;
}

// ---------- shaping tools ----------
export const peak = (f) => { let m = 0; for (const x of f) m = Math.max(m, Math.abs(x)); return m; };
export function normalize(f) { const m = peak(f); if (m > 1e-9) for (let i = 0; i < f.length; i++) f[i] /= m; return f; }
export function invert(f) { for (let i = 0; i < f.length; i++) f[i] = -f[i]; return f; }
// mirror: the cycle played backwards
export function mirror(f) { const n = f.length; const c = Float32Array.from(f); for (let i = 0; i < n; i++) f[i] = c[(n - i) % n]; return f; }
// the loop seam: the last 1/32 of the cycle leads into its first sample (Serum's "X-Fade Edges")
export function seam(f, frac = 1 / 32) {
  const n = f.length, m = Math.max(4, Math.round(n * frac));
  const d = f[0] - (2 * f[n - 1] - f[n - 2]);
  for (let j = 0; j < m; j++) f[n - m + j] += d * (1 - Math.cos((Math.PI * (j + 1)) / m)) / 2;
  return f;
}
// softer: the upper harmonics rolled off (each press a little more)
export function smooth(f, k0 = 24) {
  const s = spectrum(f);
  for (let k = 1; k < s.amp.length; k++) s.amp[k] *= Math.exp(-((k / k0) ** 2));
  f.set(fromHarmonics(s.amp, s.phase, f.length, f.length / 2 - 1, s.amp[0]));
  return f;
}
export function removeDC(f) { let s = 0; for (const x of f) s += x; s /= f.length; for (let i = 0; i < f.length; i++) f[i] -= s; return f; }

// a straight segment bent by its tension b (-1..1; 0 = straight), the way FL's WaveShaper and Serum bend lines
export const bend = (t, b = 0) => (b ? Math.pow(t, Math.pow(2, -3 * b)) : t);
// the tension that makes a segment from a to b pass through y at its middle
export function bendFor(a, b, y) {
  const d = b - a;
  if (Math.abs(d) < 1e-6) return 0;
  const r = Math.max(0.005, Math.min(0.995, (y - a) / d)); // 0.5^e = r
  return Math.max(-1, Math.min(1, -Math.log2(Math.log(r) / Math.log(0.5)) / 3));
}
// a cycle through points [{ x 0..1, y -1..1, c: 'smooth'|'linear'|'step', b: tension of a linear segment }] (the curve after each point)
export function fromPoints(points, n = N) {
  const pts = [...points].sort((a, b) => a.x - b.x);
  const out = new Float32Array(n);
  const m = pts.length;
  if (!m) return out;
  // the points around the loop: one copy before and two after, so every segment has neighbours
  const ext = [...pts.slice(-2).map((p) => ({ ...p, x: p.x - 1 })), ...pts, ...pts.slice(0, 2).map((p) => ({ ...p, x: p.x + 1 }))];
  while (ext.length < m + 4) ext.splice(ext.length - 0, 0, { ...pts[0], x: pts[0].x + 1 });
  const e0 = Math.min(2, m); // index of pts[0] in ext
  let j = e0 - 1; // segment ext[j] .. ext[j+1]
  for (let i = 0; i < n; i++) {
    const x = i / n;
    while (j + 2 < ext.length && ext[j + 1].x <= x) j++;
    const A = ext[j], B = ext[j + 1], span = B.x - A.x;
    const t = span > 1e-9 ? (x - A.x) / span : 0;
    const kind = A.c || 'smooth';
    if (kind === 'step') out[i] = A.y;
    else if (kind === 'linear') out[i] = A.y + (B.y - A.y) * bend(t, A.b);
    else {
      // Catmull-Rom through the neighbours (passes through every point)
      const p0 = (ext[j - 1] || A).y, p1 = A.y, p2 = B.y, p3 = (ext[j + 2] || B).y;
      const t2 = t * t, t3 = t2 * t;
      out[i] = 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
    }
  }
  for (let i = 0; i < n; i++) out[i] = Math.max(-1.5, Math.min(1.5, out[i]));
  return out;
}

// harmonic presets (amplitudes for k = 1..64, sine phase)
export const HARM_PRESETS = {
  saw: (k) => 1 / k,
  square: (k) => (k % 2 ? 1 / k : 0),
  organ: (k) => ({ 1: 1, 2: 0.8, 3: 0.6, 4: 0.5, 6: 0.35, 8: 0.3, 10: 0.12, 12: 0.15, 16: 0.1 })[k] || 0,
  bell: (k) => ({ 1: 1, 2: 0.6, 3: 0.25, 5: 0.45, 7: 0.3, 9: 0.2, 11: 0.28, 13: 0.12, 17: 0.1, 23: 0.06 })[k] || 0,
  triangle: (k) => (k % 2 ? ((k - 1) / 2 % 2 ? -1 : 1) / (k * k) : 0),
  sine: (k) => (k === 1 ? 1 : 0),
};
export function presetFrame(name, H = MAXH - 1) {
  const f = HARM_PRESETS[name] || HARM_PRESETS.sine;
  const amp = new Float64Array(H + 1), ph = new Float64Array(H + 1);
  for (let k = 1; k <= H; k++) { const a = f(k); amp[k] = Math.abs(a); ph[k] = a < 0 ? Math.PI : 0; }
  return normalize(fromHarmonics(amp, ph));
}
export const sineFrame = () => presetFrame('sine');

// ---------- formula (a small safe parser; no eval) ----------
// x: phase 0..2π · t: 0..1 through the cycle · f: 0..1 through the frames · pi, e
// + - * / ^ % unary -, functions below. Example: sin(x) + 0.5*sin(3*x)
const FN = Object.assign(Object.create(null), {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, abs: Math.abs, sqrt: (v) => Math.sqrt(Math.max(0, v)), exp: Math.exp,
  log: (v) => Math.log(Math.max(1e-12, v)), pow: Math.pow, min: Math.min, max: Math.max, floor: Math.floor, ceil: Math.ceil,
  round: Math.round, sign: Math.sign, frac: (v) => v - Math.floor(v), clamp: (v, a = -1, b = 1) => Math.min(b, Math.max(a, v)),
  saw: (v) => { const p = v / (2 * Math.PI); return 2 * (p - Math.floor(p + 0.5)); },
  square: (v, w = 0.5) => { const p = v / (2 * Math.PI); return p - Math.floor(p) < w ? 1 : -1; },
  tri: (v) => { const p = v / (2 * Math.PI); return 1 - 4 * Math.abs(p - Math.floor(p + 0.5)); },
  mix: (a, b, k) => a + (b - a) * k,
});
// (null prototypes: "constructor", "__proto__" and the like are not names here)
const CONST = Object.assign(Object.create(null), { pi: Math.PI, e: Math.E, tau: 2 * Math.PI });
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const VARS = ['x', 't', 'f'];

export function compileFormula(src) {
  const s = String(src || '');
  if (s.length > 400) throw new FormulaError('too_long', 0);
  const toks = [];
  const re = /\s*(?:(\d+\.?\d*(?:e[+-]?\d+)?|\.\d+(?:e[+-]?\d+)?)|([a-z_][a-z0-9_]*)|(\*\*|[-+*/^%(),]))/iy;
  let i = 0;
  while (i < s.length) {
    if (/\s/.test(s[i])) { i++; continue; }
    re.lastIndex = i;
    const m = re.exec(s);
    if (!m) throw new FormulaError('bad_char', i);
    toks.push(m[1] != null ? { k: 'num', v: parseFloat(m[1]), at: i } : m[2] != null ? { k: 'id', v: m[2].toLowerCase(), at: i } : { k: 'op', v: m[3] === '**' ? '^' : m[3], at: i });
    i = re.lastIndex;
  }
  let p = 0;
  const peek = () => toks[p], eat = (v) => { const tk = toks[p]; if (!tk || tk.v !== v) throw new FormulaError(tk ? 'expected' : 'end', tk ? tk.at : s.length, v); p++; };
  // grammar: sum := prod (('+'|'-') prod)* ; prod := unary (('*'|'/'|'%') unary)* ; unary := '-' unary | pow ; pow := atom ('^' unary)?
  let depth = 0;
  const sum = () => { let a = prod(); while (peek()?.v === '+' || peek()?.v === '-') { const o = toks[p++].v, b = prod(), A = a; a = o === '+' ? (v) => A(v) + b(v) : (v) => A(v) - b(v); } return a; };
  const prod = () => { let a = unary(); while (['*', '/', '%'].includes(peek()?.v)) { const o = toks[p++].v, b = unary(), A = a; a = o === '*' ? (v) => A(v) * b(v) : o === '/' ? (v) => { const d = b(v); return d === 0 ? 0 : A(v) / d; } : (v) => { const d = b(v); return d === 0 ? 0 : A(v) % d; }; } return a; };
  const unary = () => { if (peek()?.v === '-') { p++; const a = unary(); return (v) => -a(v); } if (peek()?.v === '+') { p++; return unary(); } return pow(); };
  const pow = () => { const a = atom(); if (peek()?.v === '^') { p++; const b = unary(); return (v) => Math.pow(a(v), b(v)); } return a; };
  const atom = () => {
    const tk = toks[p++];
    if (!tk) throw new FormulaError('end', s.length);
    if (++depth > 60) throw new FormulaError('too_deep', tk.at);
    try {
      if (tk.k === 'num') { const n = tk.v; return () => n; }
      if (tk.v === '(') { const a = sum(); eat(')'); return a; }
      if (tk.k === 'id') {
        if (peek()?.v === '(') {
          const fn = has(FN, tk.v) ? FN[tk.v] : null;
          if (!fn) throw new FormulaError('unknown', tk.at, tk.v);
          p++;
          const args = [];
          if (peek()?.v !== ')') { args.push(sum()); while (peek()?.v === ',') { p++; args.push(sum()); } }
          eat(')');
          return (v) => fn(...args.map((g) => g(v)));
        }
        if (has(CONST, tk.v)) { const c = CONST[tk.v]; return () => c; }
        const vi = VARS.indexOf(tk.v);
        if (vi >= 0) return (v) => v[vi];
        throw new FormulaError('unknown', tk.at, tk.v);
      }
      throw new FormulaError('unexpected', tk.at, tk.v);
    } finally { depth--; }
  };
  const fnc = sum();
  if (p < toks.length) throw new FormulaError('unexpected', toks[p].at, toks[p].v);
  return fnc;
}
export class FormulaError extends Error {
  constructor(code, at, what = '') { super(`${code}@${at}${what ? ` ${what}` : ''}`); this.code = code; this.at = at; this.what = what; }
}
// a frame from a formula; f: where in the table (0..1)
export function formulaFrame(src, f = 0, n = N) {
  const g = compileFormula(src), out = new Float32Array(n), v = [0, 0, f];
  for (let i = 0; i < n; i++) { v[0] = (2 * Math.PI * i) / n; v[1] = i / n; const y = g(v); out[i] = Number.isFinite(y) ? Math.max(-4, Math.min(4, y)) : 0; }
  return out;
}

// ---------- tables: interpolation between frames ----------
// spectral morph: magnitudes and phases move from one frame to the next (no comb-filter dip halfway, as a
// crossfade between out-of-phase frames has). The table is played through `steps` in-between frames.
export function morphFrames(a, b, steps) {
  const A = spectrum(a), B = spectrum(b), out = [];
  for (let s = 1; s <= steps; s++) {
    const u = s / (steps + 1), amp = new Float64Array(MAXH + 1), ph = new Float64Array(MAXH + 1);
    for (let k = 1; k <= MAXH; k++) {
      amp[k] = A.amp[k] + (B.amp[k] - A.amp[k]) * u;
      let d = B.phase[k] - A.phase[k];
      d -= 2 * Math.PI * Math.round(d / (2 * Math.PI));
      ph[k] = A.amp[k] < 1e-6 ? B.phase[k] : B.amp[k] < 1e-6 ? A.phase[k] : A.phase[k] + d * u;
    }
    out.push(fromHarmonics(amp, ph, a.length, MAXH - 1, A.amp[0] + (B.amp[0] - A.amp[0]) * u));
  }
  return out;
}
// the frames the oscillator actually plays through
export function playFrames(wt) {
  const fr = wt.frames;
  if (wt.interp !== 'spectral' || fr.length < 2) return fr;
  const steps = Math.max(0, Math.min(15, Math.floor(256 / fr.length) - 1));
  if (!steps) return fr;
  const out = [];
  for (let i = 0; i < fr.length - 1; i++) { out.push(fr[i]); out.push(...morphFrames(fr[i], fr[i + 1], steps)); }
  out.push(fr[fr.length - 1]);
  return out;
}

// ---------- mipmaps ----------
// level L keeps harmonics 1..levelH(L), half an octave apart (1024, 724, 512 ... 1; L = 0 .. 20). A note
// at frequency f may use maxH harmonics while maxH * f <= FOLD = SR - 18 kHz: whatever lies above Nyquist
// then folds back above 18 kHz, out of hearing, and the content below Nyquist reaches at least FOLD / 1.41
// (21 kHz at 48 kHz, 18.5 kHz at 44.1 kHz). Tables are 16x oversampled (up to 2048 samples) for the 4-point interpolation.
export const LEVELS = 21;
export const levelH = (L) => Math.max(1, Math.floor(1024 / 2 ** (L / 2)));
export const levelSize = (L) => { const h = levelH(L); let n = 256; while (n < h * 16 && n < 2048) n *= 2; return n; };
export const foldHz = (rate) => Math.max(rate * 0.45, rate - 18000);
export const GUARD = 3; // samples added around each table for cubic interpolation: [last, ...table, first, second]

// one packed Float32Array for every (frame, level), plus offsets: off[frame * LEVELS + L]
export function buildMips(frames) {
  const sizes = Array.from({ length: LEVELS }, (_, L) => levelSize(L));
  const per = sizes.reduce((a, s) => a + s + GUARD, 0);
  const data = new Float32Array(per * frames.length), off = new Uint32Array(frames.length * LEVELS);
  let o = 0;
  frames.forEach((fr, fi) => {
    const s = spectrum(fr.length === N ? fr : resampleCycle(fr));
    for (let L = 0; L < LEVELS; L++) {
      const n = sizes[L], tb = fromHarmonics(s.amp, s.phase, n, Math.min(levelH(L), n / 2 - 1), s.amp[0]);
      off[fi * LEVELS + L] = o + 1;
      data[o] = tb[n - 1];
      data.set(tb, o + 1);
      data[o + 1 + n] = tb[0]; data[o + 2 + n] = tb[1];
      o += n + GUARD;
    }
  });
  return { data, off, sizes: Uint32Array.from(sizes), frames: frames.length };
}

// ---------- storage ----------
const B64 = typeof Buffer !== 'undefined' && !globalThis.btoa;
function toB64(u8) {
  if (B64) return Buffer.from(u8).toString('base64');
  let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromB64(str) {
  if (B64) return new Uint8Array(Buffer.from(str, 'base64'));
  const s = atob(str), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u;
}
export function encodeTable(wt) {
  const fr = wt.frames, u = new Uint8Array(fr.length * N * 4), dv = new DataView(u.buffer);
  fr.forEach((f, i) => { for (let j = 0; j < N; j++) dv.setFloat32((i * N + j) * 4, f[j], true); });
  return { name: wt.name || '', interp: wt.interp || 'xfade', n: N, data: toB64(u) };
}
export function decodeTable(o) {
  if (!o) return null;
  if (o.frames && Array.isArray(o.frames) && o.frames[0] instanceof Float32Array) return o;
  const u = fromB64(o.data || ''), dv = new DataView(u.buffer, u.byteOffset, u.byteLength), n = o.n || N;
  const count = Math.max(1, Math.floor(u.length / (n * 4))), frames = [];
  for (let i = 0; i < count; i++) {
    const f = new Float32Array(n);
    if (u.length >= (i + 1) * n * 4) for (let j = 0; j < n; j++) f[j] = dv.getFloat32((i * n + j) * 4, true);
    frames.push(n === N ? f : resampleCycle(f));
  }
  return { name: o.name || '', interp: o.interp === 'spectral' ? 'spectral' : 'xfade', frames };
}
// a short stable id for a table's content (FNV-1a over the float bits; caches mipmaps per content)
export function tableId(wt) {
  let h1 = 0x811c9dc5, h2 = 0x9e3779b1;
  for (const f of wt.frames) {
    const u = new Uint32Array(f.buffer, f.byteOffset, f.length);
    for (let i = 0; i < u.length; i++) { h1 = Math.imul(h1 ^ u[i], 16777619); h2 = Math.imul(h2 ^ (u[i] >>> 7), 2246822519); }
  }
  return `${wt.interp === 'spectral' ? 's' : 'x'}${wt.frames.length}-${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}`;
}

// ---------- WAV (Serum / Vital wavetables) ----------
// Serum writes a "clm " chunk: "<!>2048 ..." where 2048 is the samples per frame. Vital writes
// "<!>2048 20000000 wavetable (vital.audio)" and reads the first digit of the second word as the way
// it moves between frames: 0 none, 1 crossfade, 2 spectral (src/interface/editor_sections/
// wavetable_edit_section.cpp); it always cuts frames of 2048. We write 1 or 2 to match ours.
export function encodeWavetableWav(wt, rate = 44100) {
  const fr = wt.frames, samples = fr.length * N;
  const clm = `<!>2048 ${wt.interp === 'spectral' ? 2 : 1}0000000 wavetable (MeloFi)`;
  const clmLen = clm.length;
  const size = 12 + 8 + 16 + 8 + clmLen + (clmLen & 1) + 8 + samples * 4;
  const buf = new ArrayBuffer(size), v = new DataView(buf);
  let o = 0;
  const str = (s) => { for (let i = 0; i < s.length; i++) v.setUint8(o++, s.charCodeAt(i)); };
  const u32 = (x) => { v.setUint32(o, x, true); o += 4; };
  const u16 = (x) => { v.setUint16(o, x, true); o += 2; };
  str('RIFF'); u32(size - 8); str('WAVE');
  str('fmt '); u32(16); u16(3); u16(1); u32(rate); u32(rate * 4); u16(4); u16(32);
  str('clm '); u32(clmLen); str(clm); if (clmLen & 1) v.setUint8(o++, 0);
  str('data'); u32(samples * 4);
  for (const f of fr) for (let j = 0; j < N; j++) { v.setFloat32(o, f[j], true); o += 4; }
  return new Uint8Array(buf);
}

// reads PCM 8/16/24/32, float 32/64, extensible; returns { rate, channels: Float32Array[], clm (samples per frame | null) }
export function parseWav(bytes) {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const v = new DataView(u.buffer, u.byteOffset, u.byteLength);
  const tag = (o) => String.fromCharCode(u[o], u[o + 1], u[o + 2], u[o + 3]);
  if (u.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not_wav');
  let o = 12, fmt = null, data = null, clm = null, fade = null;
  while (o + 8 <= u.length) {
    const id = tag(o), len = v.getUint32(o + 4, true), body = o + 8;
    if (id === 'fmt ') {
      let code = v.getUint16(body, true);
      const ch = v.getUint16(body + 2, true), rate = v.getUint32(body + 4, true), bits = v.getUint16(body + 14, true);
      if (code === 0xfffe && len >= 26) code = v.getUint16(body + 24, true);
      fmt = { code, ch, rate, bits };
    } else if (id === 'data') data = [body, Math.min(len, u.length - body)];
    else if (id === 'clm ') {
      const s = String.fromCharCode(...u.subarray(body, body + Math.min(len, 64)));
      const m = /<!>\s*(\d+)(?:\s+(\S))?/.exec(s);
      if (m) { clm = +m[1]; fade = m[2] ?? null; }
    }
    o = body + len + (len & 1);
  }
  if (!fmt || !data) throw new Error('bad_wav');
  const { code, ch, bits } = fmt, bps = bits / 8, frames = Math.floor(data[1] / (bps * ch));
  const chans = Array.from({ length: ch }, () => new Float32Array(frames));
  let p = data[0];
  for (let i = 0; i < frames; i++) for (let c = 0; c < ch; c++, p += bps) {
    let x;
    if (code === 3) x = bits === 64 ? v.getFloat64(p, true) : v.getFloat32(p, true);
    else if (bits === 8) x = (u[p] - 128) / 128;
    else if (bits === 16) x = v.getInt16(p, true) / 32768;
    else if (bits === 24) x = (((u[p] | (u[p + 1] << 8) | (u[p + 2] << 16)) << 8) >> 8) / 8388608;
    else x = v.getInt32(p, true) / 2147483648;
    chans[c][i] = x;
  }
  return { rate: fmt.rate, channels: chans, clm, fade, code, bits };
}

// a wavetable from a WAV: frame size from the clm chunk, else 2048 when the length allows, else a
// power of two between 256 and 4096 that divides the length; a short file is one cycle.
export function wavToTable(bytes, name = '') {
  const w = parseWav(bytes);
  const mono = w.channels.length === 1 ? w.channels[0] : w.channels[0].map((x, i) => w.channels.reduce((a, c) => a + c[i], 0) / w.channels.length);
  const len = mono.length;
  let size = w.clm && w.clm >= 16 && w.clm <= 8192 ? w.clm : 0;
  if (!size) {
    if (len % 2048 === 0) size = 2048;
    else for (const s of [4096, 1024, 512, 256]) if (len % s === 0 && len / s <= MAX_FRAMES) { size = s; break; }
  }
  if (!size) size = len <= 4096 ? len : 2048;
  const count = Math.max(1, Math.min(MAX_FRAMES, Math.floor(len / size)));
  const frames = [];
  for (let i = 0; i < count; i++) {
    const f = mono.subarray(i * size, i * size + size);
    frames.push(size === N ? Float32Array.from(f) : resampleCycle(f.length === size ? f : Float32Array.from({ length: size }, (_, j) => f[j] || 0)));
  }
  // Vital's flag: 2 (and anything past 1) = spectral, 0 / 1 = crossfade
  const interp = w.fade != null && w.fade !== '0' && w.fade !== '1' ? 'spectral' : 'xfade';
  return { table: { name, interp, frames }, frameSize: size, rate: w.rate, clm: w.clm, fade: w.fade, bits: w.bits, sourceFrames: Math.floor(len / size) };
}

// ---------- from audio ----------
// fundamental period (in samples) near `at`, by normalised autocorrelation (YIN's difference function)
export function detectPeriod(x, rate, at = 0, minHz = 30, maxHz = 2000) {
  const maxT = Math.min(Math.floor(rate / minHz), Math.floor((x.length - at) / 2)), minT = Math.max(2, Math.floor(rate / maxHz));
  if (maxT <= minT + 2) return null;
  const W = Math.min(maxT, 4096);
  const d = new Float64Array(maxT + 1);
  for (let tau = 1; tau <= maxT; tau++) { let s = 0; for (let i = 0; i < W; i++) { const e = x[at + i] - x[at + i + tau]; s += e * e; } d[tau] = s; }
  // cumulative mean normalised difference
  let run = 0, best = -1;
  const cm = new Float64Array(maxT + 1); cm[0] = 1;
  for (let tau = 1; tau <= maxT; tau++) { run += d[tau]; cm[tau] = run ? d[tau] * tau / run : 1; }
  for (let tau = minT; tau <= maxT; tau++) if (cm[tau] < 0.15) { while (tau + 1 <= maxT && cm[tau + 1] < cm[tau]) tau++; best = tau; break; }
  if (best < 0) { let m = Infinity; for (let tau = minT; tau <= maxT; tau++) if (cm[tau] < m) { m = cm[tau]; best = tau; } if (m > 0.5) return null; }
  // parabolic refinement
  const a = cm[best - 1] ?? cm[best], b = cm[best], c = cm[best + 1] ?? cm[best];
  const den = a - 2 * b + c;
  return best + (den ? 0.5 * (a - c) / den : 0);
}
// one cycle starting at a rising zero crossing near `at`, resampled to N samples
export function cycleAt(x, rate, at, period) {
  let s = Math.max(0, Math.floor(at));
  for (let i = s; i < Math.min(x.length - 1, s + period); i++) if (x[i] <= 0 && x[i + 1] > 0) { s = i + (-x[i]) / (x[i + 1] - x[i]); break; }
  const out = new Float32Array(N);
  const read = (p) => { const i = Math.floor(p), fr = p - i; const a = x[i - 1] ?? x[i] ?? 0, b = x[i] ?? 0, c = x[i + 1] ?? b, d = x[i + 2] ?? c; return b + 0.5 * fr * (c - a + fr * (2 * a - 5 * b + 4 * c - d + fr * (3 * (b - c) + d - a))); };
  for (let j = 0; j < N; j++) out[j] = read(s + (j / N) * period);
  // spread the leftover jump over the cycle so it loops cleanly
  const jump = read(s + period) - out[0];
  for (let j = 0; j < N; j++) out[j] -= jump * (j / N);
  return out;
}
// frames: 1 (a single cycle at the steadiest spot) or a run of `count` cycles across the sound
export function audioToTable(x, rate, { frames = 1, from = 0, to = 1, name = '' } = {}) {
  const a = Math.floor(from * x.length), b = Math.max(a + 1, Math.floor(to * x.length));
  const seg = x.subarray(a, b);
  // skip the quiet start
  let start = 0, pk = 0;
  for (const v of seg) pk = Math.max(pk, Math.abs(v));
  while (start < seg.length && Math.abs(seg[start]) < pk * 0.2) start++;
  const out = [];
  let lastP = null;
  for (let i = 0; i < frames; i++) {
    const pos = frames === 1 ? start + Math.floor((seg.length - start) * 0.25) : start + Math.floor(((seg.length - start) * 0.9) * i / Math.max(1, frames - 1));
    const p = detectPeriod(seg, rate, Math.min(pos, Math.max(0, seg.length - Math.floor(rate / 15))), 30, 2000) || lastP;
    if (!p) continue;
    lastP = p;
    out.push(normalize(removeDC(cycleAt(seg, rate, pos, p))));
  }
  if (!out.length) throw new Error('no_pitch');
  return { name, interp: frames > 1 ? 'spectral' : 'xfade', frames: out, period: lastP, hz: rate / lastP };
}
