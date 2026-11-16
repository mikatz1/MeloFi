// A wavetable made from a clean single note of a separated stem, for the synth's own waveform
// oscillator (synth.js: wave "직접 그린 파형", ch.synth.wt1). The note is cut one cycle at a time,
// along its length; the cycles become the table's frames, and the synth plays through them as the
// note sounds. Unlike a cut sample (stemsampler.js) the result keeps its colour when it is played
// far from the note's own pitch, and the synth's filter and envelopes shape it further.
//
// The cycles are found from the note's pitch: the period is searched within a semitone of the
// transcribed note (normalised difference, as YIN), frame by frame. Each cycle is resampled to the
// table's length, its harmonics above the recording's band are left out, its phases are turned so
// the fundamental starts every frame at the same point (frames then morph without cancelling), and
// it is brought to full scale: how loud the note was along its length goes into the amp envelope.
// A note whose cycles do not repeat (noise, a chord, a strongly detuned unison) gives no table.
import { N, MAXH, spectrum, fromHarmonics, encodeTable } from './wavetable.js';
import { synthDefaults, CUSTOM_WAVE } from './synth.js';

const FRAMES = 16;         // frames taken along the note
const MAX_CMND = 0.2;      // how unlike two neighbouring cycles may be (0 = identical), median over the frames
const MIN_LEN = 0.15;      // seconds of note a table needs

// the period (samples) near `at`, searched around `hz`, and how well the cycle repeats there
function periodNear(x, rate, at, hz) {
  const lo = Math.max(2, Math.floor(rate / (hz * 1.06))), hi = Math.ceil(rate / (hz / 1.06));
  const W = Math.min(2 * hi, x.length - at - hi - 1);
  if (W < hi) return null;
  // cumulative mean normalised difference needs the differences from lag 1 on
  const d = new Float64Array(hi + 2);
  let run = 0, best = -1, bestV = Infinity;
  for (let tau = 1; tau <= hi + 1; tau++) {
    let s = 0;
    for (let i = 0; i < W; i++) { const e = x[at + i] - x[at + i + tau]; s += e * e; }
    run += s;
    d[tau] = run ? (s * tau) / run : 1;
    if (tau >= lo && tau <= hi && d[tau] < bestV) { bestV = d[tau]; best = tau; }
  }
  if (best < 0) return null;
  const a = d[best - 1] ?? d[best], b = d[best], c = d[best + 1] ?? d[best], den = a - 2 * b + c;
  return { period: best + (den ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den)) : 0), cmnd: bestV };
}

// one cycle from `at`, `period` samples long, as N samples (4-point interpolation)
function cycle(x, at, period) {
  const out = new Float32Array(N);
  const read = (p) => { const i = Math.floor(p), fr = p - i; const a = x[i - 1] ?? x[i] ?? 0, b = x[i] ?? 0, c = x[i + 1] ?? b, d = x[i + 2] ?? c; return b + 0.5 * fr * (c - a + fr * (2 * a - 5 * b + 4 * c - d + fr * (3 * (b - c) + d - a))); };
  for (let j = 0; j < N; j++) out[j] = read(at + (j / N) * period);
  return out;
}

// seg: one clean note (mono), root: its MIDI note. Returns
//   { table: { name, interp, frames }, params (the synth's settings), info: { root, hz, frames, cmnd, seconds } }
// or null when the note does not give a table.
export function noteWavetable(seg, rate, root, { name = '', frames = FRAMES } = {}) {
  const hz0 = 440 * Math.pow(2, (root - 69) / 12);
  const P0 = rate / hz0;
  if (seg.length < MIN_LEN * rate || seg.length < 8 * P0) return null;
  // where the note sounds: from its first loud sample to where it has fallen to a tenth of its peak
  let pk = 0;
  for (let i = 0; i < seg.length; i++) { const v = Math.abs(seg[i]); if (v > pk) pk = v; }
  if (pk < 1e-4) return null;
  let a = 0, b = seg.length - 1;
  while (a < seg.length && Math.abs(seg[a]) < 0.1 * pk) a++;
  while (b > a && Math.abs(seg[b]) < 0.1 * pk) b--;
  const last = Math.min(b, seg.length - Math.ceil(3.5 * P0) - 2);
  if (last - a < 4 * P0) return null;
  const count = Math.max(2, Math.min(frames, Math.floor((last - a) / P0 / 2)));
  const out = [], cm = [], lv = [], at = [];
  let hzSum = 0;
  for (let i = 0; i < count; i++) {
    const pos = Math.round(a + ((last - a) * i) / (count - 1));
    const pr = periodNear(seg, rate, pos, hz0);
    if (!pr) continue;
    cm.push(pr.cmnd);
    if (pr.cmnd > 0.5) continue; // this stretch does not repeat: no frame from it
    const cyc = cycle(seg, pos, pr.period);
    let e = 0;
    for (let j = 0; j < N; j++) e += cyc[j] * cyc[j];
    const s = spectrum(cyc), hz = rate / pr.period;
    // harmonics the recording can hold; the fundamental's phase to zero, the others turned with it
    const H = Math.min(MAXH - 1, Math.floor((0.45 * rate) / hz)), p1 = s.phase[1];
    const amp = new Float64Array(MAXH + 1), ph = new Float64Array(MAXH + 1);
    for (let k = 1; k <= H; k++) { amp[k] = s.amp[k]; ph[k] = s.phase[k] - k * p1; }
    const fr = fromHarmonics(amp, ph, N, H, 0);
    let m = 0;
    for (let j = 0; j < N; j++) m = Math.max(m, Math.abs(fr[j]));
    if (m < 1e-9) continue;
    for (let j = 0; j < N; j++) fr[j] /= m;
    out.push(fr); lv.push(Math.sqrt(e / N)); at.push((pos - a) / rate); hzSum += hz;
  }
  if (out.length < 2 || out.length < 0.6 * count) return null;
  const sorted = cm.slice().sort((p, q) => p - q), cmnd = sorted[Math.floor(sorted.length / 2)];
  if (cmnd > MAX_CMND) return null;
  // the amp envelope from how loud the cycles were: attack to the loudest, then down to where the note ends
  const top = Math.max(...lv), iTop = lv.indexOf(top), seconds = at[at.length - 1] || MIN_LEN;
  const sus = Math.max(0.05, Math.min(1, lv[lv.length - 1] / top));
  const params = {
    ...synthDefaults(),
    w1: CUSTOM_WAVE, o1: 0, l1: 1, wp1: 0, l2: 0, sub: 0, noise: 0, uni: 1, fm: 0,
    // the table is played through once along the note (the filter envelope moves the position;
    // the filter itself stays open)
    wpe: 1, fa: Math.max(0.02, Math.min(3, seconds)), fd: 0.5, fs: 1, fr: 0.2,
    ft: 0, cut: 18000, res: 0.7, fenv: 0, kt: 0,
    aa: Math.max(0.002, Math.min(0.5, at[iTop] + a / rate)), ad: Math.max(0.05, Math.min(4, seconds - at[iTop])), as: sus, ar: 0.12,
    lt: 0, drv: 0, glide: 0,
  };
  const table = { name, interp: 'spectral', frames: out };
  params.wt1 = encodeTable(table);
  return { table, params, info: { root, hz: hzSum / out.length, frames: out.length, cmnd: +cmnd.toFixed(3), seconds: +seconds.toFixed(3) } };
}

// si: what stemsampler.js stemInstrument returned (its cuts are clean single notes of the stem).
// The table comes from the cut that says most: clean, long, and near the middle of what the stem plays.
export function stemWavetable(si, { name = '' } = {}) {
  if (!si?.cuts?.length) return null;
  const rate = si.wav.rate, roots = si.cuts.map((c) => c.root).sort((p, q) => p - q), mid = roots[Math.floor(roots.length / 2)];
  const ranked = si.cuts.map((c) => ({ c, score: (c.sal ?? 0.5) + 0.3 * Math.min(1, (c.end - c.start) / 0.8) - 0.02 * Math.abs(c.root - mid) }))
    .sort((p, q) => q.score - p.score);
  for (const { c } of ranked.slice(0, 4)) {
    const seg = si.wav.left.subarray(Math.round(c.start * rate), Math.round(c.end * rate));
    const wt = noteWavetable(seg, rate, c.root, { name });
    if (wt) return wt;
  }
  return null;
}
