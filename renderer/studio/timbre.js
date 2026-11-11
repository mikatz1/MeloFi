// Timbre matching: how close a MeloFi instrument sounds to an instrument heard in a separated stem.
//
// Every note whose pitch and timing are known (the stem's transcription) is measured the same way:
//   harm   the first 10 partials of the note's pitch, dB relative to the strongest one (the
//          instrument's "colour": odd-only for a clarinet, a falling slope for a flute, rich for a saw)
//   cep    12 cepstral coefficients of the mel spectrum (the spectral envelope / formants)
//   env    the loudness curve from the onset, dB relative to the peak, at 10 · 20 · 40 · 80 · 160 ·
//          320 · 640 ms (attack and decay: plucked, struck, bowed, blown, synth envelope)
//   noise  spectral flatness between the partials (breath, bow, pick, noise layers)
//   sal    how much of the frame's energy sits on the partials (a check that the note is really there)
//
// The accuracy of a candidate is measured by analysis-by-synthesis: the candidate plays exactly the
// stem's notes (same times, lengths, velocities, chords), the render is measured note by note like
// the stem, and the per-note differences are turned into a percentage (compare(), below). A quick
// pre-screen against precomputed fingerprints (fingerprints.json, tools/e2e/fingerprints.js) decides
// which candidates are worth rendering. The definition and calibration are in docs/timbre-matching.md.

export const N_HARM = 10, N_CEP = 12, MEL = 40;
export const ENV_T = [0.01, 0.02, 0.04, 0.08, 0.16, 0.32, 0.64];

// ---------- small DSP ----------
function fftMag(frame) {
  const n = frame.length, re = Float64Array.from(frame), im = new Float64Array(n);
  for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { const t = re[i]; re[i] = re[j]; re[j] = t; } }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len, wr = Math.cos(a), wi = Math.sin(a), half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const j = i + k + half, vr = re[j] * cr - im[j] * ci, vi = re[j] * ci + im[j] * cr;
        re[j] = re[i + k] - vr; im[j] = im[i + k] - vi; re[i + k] += vr; im[i + k] += vi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
  const mag = new Float64Array(n / 2);
  for (let k = 0; k < n / 2; k++) mag[k] = Math.hypot(re[k], im[k]);
  return mag;
}
const hannCache = new Map();
function hann(n) { if (!hannCache.has(n)) hannCache.set(n, Float64Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)))); return hannCache.get(n); }
const db = (x) => 20 * Math.log10(Math.max(x, 1e-9));
export const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : 0.5 * (s[m - 1] + s[m]); };
const hz = (n) => 440 * Math.pow(2, (n - 69) / 12);
const melOf = (f) => 2595 * Math.log10(1 + f / 700);
const fOfMel = (m) => 700 * (Math.pow(10, m / 2595) - 1);

const melCache = new Map();
function melBank(size, rate) {
  const key = `${size}:${rate}`;
  if (melCache.has(key)) return melCache.get(key);
  const lo = melOf(60), hi = melOf(Math.min(12000, rate / 2 - 100));
  const edges = Array.from({ length: MEL + 2 }, (_, i) => fOfMel(lo + ((hi - lo) * i) / (MEL + 1)));
  const bank = [];
  for (let b = 0; b < MEL; b++) {
    const f0 = edges[b], f1 = edges[b + 1], f2 = edges[b + 2], w = [];
    for (let k = Math.floor((f0 / rate) * size); k <= Math.ceil((f2 / rate) * size) && k < size / 2; k++) {
      const f = (k * rate) / size, v = f < f1 ? (f - f0) / (f1 - f0) : (f2 - f) / (f2 - f1);
      if (v > 0) w.push([k, v]);
    }
    bank.push(w);
  }
  melCache.set(key, bank);
  return bank;
}

// mel band energies (log) -> DCT -> c1..c12 (c0, the loudness, is left out)
function cepstrum(mag, rate) {
  const bank = melBank(mag.length * 2, rate), bands = new Float64Array(MEL);
  for (let b = 0; b < MEL; b++) { let s = 0; for (const [k, w] of bank[b]) s += w * mag[k] * mag[k]; bands[b] = Math.log(s + 1e-12); }
  const cep = [];
  for (let c = 1; c <= N_CEP; c++) { let s = 0; for (let b = 0; b < MEL; b++) s += bands[b] * Math.cos((Math.PI * c * (b + 0.5)) / MEL); cep.push(s / MEL); }
  return cep;
}

// RMS envelope in 5 ms steps over [i0, i1)
function envelope(x, i0, i1, hop) {
  const env = [];
  for (let i = Math.max(0, i0); i + hop <= Math.min(x.length, i1); i += hop) { let s = 0; for (let k = i; k < i + hop; k++) s += x[k] * x[k]; env.push(Math.sqrt(s / hop)); }
  return env;
}

// one note: t, d (s), n (MIDI pitch), over a mono buffer. off: where t = 0 sits in the buffer (s).
// kit: drum hits (no partials; the spectrum and the decay only)
export function noteFeatures(x, rate, t, d, n, { off = 0, kit = false, span = null } = {}) {
  const T = t + off, i0 = Math.round(T * rate), hop = Math.round(rate * 0.005);
  if (i0 < 0 || i0 >= x.length) return null;
  // the onset of a transcribed note can be ~30 ms early or late: the peak is looked for around it
  const pre = Math.round(0.03 / 0.005);
  const env = envelope(x, i0 - pre * hop, i0 + Math.round((Math.max(d, 0.05) + 0.7) * rate), hop);
  if (env.length < pre + 8) return null;
  let pk = 0, pi = pre;
  const look = Math.min(env.length, pre + Math.round(Math.min(0.25, Math.max(0.06, d)) / 0.005));
  for (let i = 0; i < look; i++) if (env[i] > pk) { pk = env[i]; pi = i; }
  if (pk < 2e-4) return null;
  // the loudness curve from the onset: dB below the peak at fixed times (only within the note and a
  // short release; later points belong to the next note)
  // attack: from 10% of the peak to the peak; the curve starts there (the onset as heard)
  let a0 = pi; while (a0 > 0 && env[a0 - 1] > pk * 0.1) a0--;
  const attack = (pi - a0) * 0.005;
  // a new attack inside the note (a repeated or missed note the transcription merged into this
  // one) ends what is measured: the note is taken as lasting until then (span), and the candidate
  // is measured over the same span (noteFeatures(..., { span }))
  if (span == null) {
    span = d;
    for (let j = pi + 4, lo = Infinity; j < env.length && (j - pre) * 0.005 < d; j++) {
      lo = Math.min(lo, env[j]);
      if (env[j] > lo * 3.2 && env[j] > pk * 0.25) { span = Math.max(0.06, (j - 2 - pre) * 0.005); break; }
    }
  }
  d = span;
  // the curve runs while the note is held (its release depends on what the transcription says the
  // length is) and stops at a new attack inside it: a repeated note the transcription merged into
  // one long note is heard again here, and the render of the merged note would not have it
  // the curve also stops at a smaller rise (6 dB) inside the note: a re-attack, a swell or a
  // missed note, none of which the render of the transcription has
  let lim = d + 0.02 - (a0 - pre) * 0.005;
  for (let j = pi + 4, lo = Infinity; j < env.length && (j - a0) * 0.005 < lim; j++) {
    lo = Math.min(lo, env[j]);
    if (env[j] > lo * 2 && env[j] > pk * 0.1) { lim = (j - 2 - a0) * 0.005; break; }
  }
  const curve = ENV_T.map((s) => {
    if (s > lim) return null;
    const j = a0 + Math.round(s / 0.005);
    return j < env.length ? Math.max(-50, db(env[j] / pk)) : null;
  });
  // spectrum just after the attack; longer frames for low notes, never much longer than the note
  // the frame ends before the note does (a release inside it would measure the transcription's
  // idea of the length, not the instrument)
  const want = kit ? 2048 : hz(n) < 90 ? 8192 : hz(n) < 200 ? 4096 : 2048;
  const lead = (pi - pre) * 0.005 + (kit ? 0.005 : 0.03);
  let size = want; while (size > 1024 && size > (d - lead) * rate) size >>= 1;
  const s0 = i0 + Math.round(lead * rate);
  if (s0 < 0 || s0 + size > x.length) return null;
  const w = hann(size), fr = new Float64Array(size);
  for (let i = 0; i < size; i++) fr[i] = x[s0 + i] * w[i];
  const mag = fftMag(fr), bin = (f) => (f * size) / rate;
  const cep = cepstrum(mag, rate);
  if (kit) return { n, t, kit: true, cep, env: curve, attack, harm: null, noise: -60, sal: 1, lvl: db(pk), span };
  // partials: the strongest bin within ±3% of each harmonic of the transcribed pitch
  const f0 = hz(n), harm = [];
  let onPart = 0, total = 0;
  for (let h = 1; h <= N_HARM; h++) {
    const c = bin(f0 * h);
    if (c >= mag.length - 2 || f0 * h > 12000) { harm.push(null); continue; }
    let m = 0; for (let k = Math.floor(c * 0.97); k <= Math.ceil(c * 1.03); k++) m = Math.max(m, mag[k] || 0);
    harm.push(m);
  }
  const ref = Math.max(1e-9, ...harm.filter((v) => v != null));
  const harmDb = harm.map((v) => (v == null ? null : Math.max(-50, db(v / ref))));
  // salience: energy on the partials (±3%) / energy from half the fundamental up to 6 kHz
  // noise: geometric / arithmetic mean of the bins between the partials (up to 8 kHz)
  let lg = 0, ar = 0, cnt = 0;
  const kLo = Math.max(1, Math.round(bin(f0 * 0.5))), kHi = Math.min(mag.length, Math.round(bin(6000)));
  for (let k = kLo; k < Math.min(mag.length, Math.round(bin(8000))); k++) {
    const p = mag[k] * mag[k], r = (k / bin(f0)) % 1, near = r < 0.06 || r > 0.94;
    if (k < kHi) { total += p; if (near) onPart += p; }
    if (r < 0.2 || r > 0.8) continue;
    lg += Math.log(p + 1e-12); ar += p + 1e-12; cnt++;
  }
  // (in dB: -60 a pure tone between its partials, 0 white noise)
  const noise = cnt ? Math.max(-60, 10 * Math.log10(Math.exp(lg / cnt) / (ar / cnt) + 1e-9)) : -60;
  return { n, t, cep, env: curve, attack, harm: harmDb, noise, sal: total ? onPart / total : 0, lvl: db(pk), span };
}

// ---------- which notes to measure ----------
// notes: [t, d, n, v]. Prefers notes that start alone (nothing else starting within 40 ms), are long
// enough to show their colour, and are spread over the section; at most max of them.
export function probeNotes(notes, { t0 = -Infinity, t1 = Infinity, max = 40, kit = false } = {}) {
  const inside = notes.filter(([t, d]) => t >= t0 && t + Math.min(d, 0.3) <= t1 && (kit || d >= 0.09));
  if (!inside.length) return [];
  const sorted = [...inside].sort((a, b) => a[0] - b[0]);
  const scored = sorted.map((nt, i) => {
    const [t, d] = nt;
    const crowd = sorted.filter((o, j) => j !== i && Math.abs(o[0] - t) < 0.04).length;
    const next = sorted.slice(i + 1).find((o) => o[0] > t + 0.04)?.[0] ?? t + 2;
    return { nt, s: Math.min(d, 0.6) + Math.min(next - t, 0.6) - crowd * (kit ? 0.05 : 0.3) + (nt[3] || 80) / 400 };
  });
  // spread: best of each slice of the section
  const slices = Math.min(max, scored.length), span = (sorted.at(-1)[0] - sorted[0][0]) || 1, out = [];
  const buckets = Array.from({ length: slices }, () => []);
  for (const o of scored) buckets[Math.min(slices - 1, Math.floor(((o.nt[0] - sorted[0][0]) / span) * slices))].push(o);
  for (const b of buckets) if (b.length) out.push(b.sort((x, y) => y.s - x.s)[0].nt);
  // fill up with the best of the rest
  if (out.length < max) for (const o of [...scored].sort((x, y) => y.s - x.s)) { if (out.length >= max) break; if (!out.includes(o.nt)) out.push(o.nt); }
  return out.sort((a, b) => a[0] - b[0]);
}

export function measure(x, rate, notes, opts = {}) {
  return notes.map(([t, d, n]) => noteFeatures(x, rate, t, d, n, opts));
}

// ---------- the accuracy ----------
// Per note, four differences between the stem and the candidate:
//   dH  mean |dB| over the partials both have (lower partials count more), clipped at -40 dB
//   dC  distance of the cepstral envelopes
//   dE  mean |dB| of the loudness curves at the points both have
//   dN  |dB| of the noise floors between the partials
// each divided by its scale and combined as a weighted RMS z (SCALE and WEIGHT fitted on the
// calibration, docs/timbre-matching.md: the partials tell instruments apart best, the noise floor
// hardly at all). Over the notes the median z counts (a few wrongly transcribed notes do not decide
// it), and the accuracy is 100 · 0.9^((z / Z90)²): Z90 is the z the right instrument stays within in
// 9 calibration cases out of 10 (production, bleed and transcription errors included), so 90 % means
// "as close as the right instrument usually measures", 100 % identical, and a different family
// (z 1.8..3) lands around 60..85 %.
export const SCALE = { h: 2, c: 0.4, e: 1.5, n: 4 };
export const WEIGHT = { h: 2, c: 1, e: 0.5, n: 0.1 };
export const Z90 = 1.74;
const K = -Math.log(0.9) / (Z90 * Z90);

export function noteDiff(a, b) {
  if (!a || !b) return null;
  const part = {};
  if (a.harm && b.harm) {
    let s = 0, w = 0;
    for (let i = 1; i < N_HARM; i++) {
      if (a.harm[i] == null || b.harm[i] == null) continue;
      const wi = i < 4 ? 1 : i < 7 ? 0.7 : 0.45;
      s += wi * Math.abs(Math.max(-40, a.harm[i]) - Math.max(-40, b.harm[i])); w += wi;
    }
    if (w) part.h = s / w;
  }
  let dc = 0;
  for (let i = 0; i < N_CEP; i++) dc += (a.cep[i] - b.cep[i]) ** 2 * (i < 4 ? 1.4 : 1);
  part.c = Math.sqrt(dc / N_CEP);
  let se = 0, ne = 0;
  for (let i = 0; i < ENV_T.length; i++) if (a.env[i] != null && b.env[i] != null) { se += Math.abs(Math.max(-40, a.env[i]) - Math.max(-40, b.env[i])); ne++; }
  if (ne) part.e = se / ne;
  if (!a.kit) part.n = Math.abs(Math.max(-45, a.noise) - Math.max(-45, b.noise));
  // a note inside a chord shares its partials with the others (and one the transcription missed
  // changes them): the partials count less there
  // A separated bass stem keeps the kick drum's thump on the same beats and loses some of its upper
  // partials to the other stems: there the partials and the attack count less (calibration through
  // the separation, docs/timbre-matching.md)
  const poly = a.poly || b.poly, low = a.bassStem || b.bassStem;
  const adj = { h: (poly ? 0.3 : 1) * (low ? 0.4 : 1), c: 1, e: low ? 0.6 : 1, n: 1 };
  let z2 = 0, w = 0;
  for (const [k, v] of Object.entries(part)) { const wk = WEIGHT[k] * adj[k]; z2 += wk * (v / SCALE[k]) ** 2; w += wk; }
  return { z: Math.sqrt(z2 / w), part };
}

// stem / cand: feature lists for the same notes (index by index)
// The mix's EQ is not part of the instrument: a song's mixing tilts the whole spectrum of a part
// (brighter or darker) the same way on every note. compare() takes the tilt that is common to all
// the notes (the median over notes of the slope of stem − candidate partials against log2 of the
// partial number, and the median difference of the first cepstral coefficient, the spectrum's
// overall slope) off the stem before comparing, as far as an EQ plausibly goes (MAX_TILT dB per
// octave of partials, MAX_C1). What differs from note to note, the instrument's own colour,
// stays. normalize: false compares as measured.
export const MAX_TILT = 3, MAX_C1 = 0.25;
function untilt(stem, cand) {
  const slopes = [], c1 = [];
  for (let i = 0; i < stem.length; i++) {
    const a = stem[i], b = cand[i];
    if (!a || !b) continue;
    c1.push(a.cep[0] - b.cep[0]);
    if (!a.harm || !b.harm) continue;
    const pts = [];
    for (let h = 0; h < N_HARM; h++) if (a.harm[h] != null && b.harm[h] != null && a.harm[h] > -40 && b.harm[h] > -40) pts.push([Math.log2(h + 1), a.harm[h] - b.harm[h]]);
    if (pts.length < 3) continue;
    const mx = pts.reduce((s, p) => s + p[0], 0) / pts.length, my = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    let sxy = 0, sxx = 0; for (const [x, y] of pts) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; }
    if (sxx > 0) slopes.push(sxy / sxx);
  }
  const tilt = slopes.length >= 3 ? Math.max(-MAX_TILT, Math.min(MAX_TILT, median(slopes))) : 0;
  const dc1 = c1.length >= 3 ? Math.max(-MAX_C1, Math.min(MAX_C1, median(c1))) : 0;
  const fixed = stem.map((a) => {
    if (!a) return a;
    let harm = a.harm;
    if (harm && tilt) {
      harm = harm.map((v, h) => (v == null ? null : v - tilt * Math.log2(h + 1)));
      const top = Math.max(...harm.filter((v) => v != null));
      harm = harm.map((v) => (v == null ? null : Math.max(-50, v - top)));
    }
    return { ...a, harm, cep: a.cep.map((v, k) => (k === 0 ? v - dc1 : v)) };
  });
  return { fixed, tilt: +tilt.toFixed(2), dc1: +dc1.toFixed(3) };
}

export function compare(stem, cand, { normalize = true } = {}) {
  const eq = normalize ? untilt(stem, cand) : { fixed: stem, tilt: 0, dc1: 0 };
  stem = eq.fixed;
  const zs = [], parts = { h: [], c: [], e: [], n: [] };
  for (let i = 0; i < stem.length; i++) {
    const d = noteDiff(stem[i], cand[i]);
    if (!d) continue;
    zs.push(d.z);
    for (const [k, v] of Object.entries(d.part)) parts[k].push(v);
  }
  if (!zs.length) return { acc: 0, z: Infinity, n: 0 };
  const z = median(zs);
  const acc = (zz) => Math.round(1000 * Math.exp(-K * zz * zz)) / 10;
  // the parts as accuracies of their own (for the explanation shown with the score)
  const by = {}, raw = {};
  for (const [k, v] of Object.entries(parts)) if (v.length) { by[k] = acc(median(v) / SCALE[k]); raw[k] = +median(v).toFixed(3); }
  return { acc: acc(z), z: +z.toFixed(3), n: zs.length, parts: by, raw, tilt: eq.tilt, dc1: eq.dc1 };
}

// stem notes worth measuring: real notes in the audio (salient enough), not bleed
// (chords and short notes share their frame with other partials: when too few notes pass, the most
// salient ones that are clearly above the floor are taken)
export function usable(feats, kit = false) {
  if (kit) return feats;
  const pass = feats.map((f) => (f && f.sal >= 0.25 ? f : null));
  if (pass.filter(Boolean).length >= 6) return pass;
  const ok = feats.filter((f) => f && f.sal >= 0.08).sort((a, b) => b.sal - a.sal).slice(0, 8);
  return feats.map((f) => (ok.includes(f) ? f : null));
}

// ---------- fingerprints (the quick pre-screen) ----------
// A fingerprint is the features of single notes of an instrument every 5 semitones over its range
// (1.2 s each, velocity 100). A stem is compared note by note with the fingerprint note nearest in
// pitch, on what does not depend on note length: partials, envelope (first 160 ms), noise.
export function prescreen(stemFeats, fp) {
  if (!fp?.notes?.length) return { z: Infinity, acc: 0 };
  const zs = [];
  for (const f of stemFeats) {
    if (!f) continue;
    const g = fp.notes.reduce((b, r) => (Math.abs(r.n - f.n) < Math.abs(b.n - f.n) ? r : b));
    const far = Math.abs(g.n - f.n);
    const d = noteDiff({ ...f, env: f.env.map((v, i) => (ENV_T[i] <= 0.16 ? v : null)) }, g);
    if (d) zs.push(d.z + (far > 6 ? (far - 6) * 0.08 : 0));
  }
  if (!zs.length) return { z: Infinity, acc: 0 };
  const z = median(zs);
  return { z, acc: Math.round(1000 * Math.exp(-K * z * z)) / 10 };
}

// compact copy of a feature (for fingerprints.json)
export function pack(f) {
  if (!f) return null;
  const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10), r3 = (v) => Math.round(v * 1000) / 1000;
  return { n: f.n, harm: f.harm && f.harm.map(r1), cep: f.cep.map(r3), env: f.env.map(r1), attack: r3(f.attack), noise: r1(f.noise), sal: r3(f.sal), ...(f.kit ? { kit: true } : {}) };
}

// ---------- describing a sound (for the missing-instrument report) ----------
export function describe(feats) {
  const fs = feats.filter(Boolean);
  if (!fs.length) return null;
  const att = median(fs.map((f) => f.attack));
  const e32 = median(fs.map((f) => f.env[5]).filter((v) => v != null));
  const e16 = median(fs.map((f) => f.env[4]).filter((v) => v != null));
  const noise = median(fs.map((f) => f.noise));
  const hs = fs.filter((f) => f.harm);
  const odd = hs.length ? median(hs.map((f) => ((f.harm[2] ?? -50) + (f.harm[4] ?? -50)) / 2 - ((f.harm[1] ?? -50) + (f.harm[3] ?? -50)) / 2)) : 0;
  const bright = hs.length ? median(hs.map((f) => { const v = f.harm.slice(3, 9).filter((x) => x != null); return v.length ? v.reduce((a, x) => a + x, 0) / v.length : -50; })) : -50;
  const pitch = median(fs.map((f) => f.n));
  const sustained = (e32 ?? e16 ?? -30) > -9;
  return {
    pitch: Math.round(pitch), attack: +att.toFixed(3), decay160: e16 == null ? null : +e16.toFixed(1), decay320: e32 == null ? null : +e32.toFixed(1),
    noise: +noise.toFixed(1), bright: +bright.toFixed(1), odd: +odd.toFixed(1),
    shape: att > 0.06 ? 'slow attack (bowed / blown / pad)' : sustained ? 'sustained' : 'plucked / struck (decaying)',
    colour: bright > -14 ? 'bright, many partials' : bright > -26 ? 'medium' : 'dark, few partials',
    breath: noise > -12 ? 'noisy (breath / bow / distortion)' : 'clean',
    hollow: odd > 6 ? 'odd partials dominate (hollow, clarinet / square-like)' : null,
  };
}

// ---------- octave check ----------
// A transcription now and then puts single notes an octave off: a low note whose fundamental is weak
// comes out an octave up, a high one whose 2nd partial is strong an octave down. A note is moved
// only when two things agree:
//   the spectrum (notes that play alone: no other note of the stem sounds in the measured frame)
//     too high (true pitch n-12): the odd partials of half the frequency (f/2, 3f/2, 5f/2) are
//              there; a real note at f has nothing at those bins
//     too low (true pitch n+12):  the odd partials of f (f, 3f, 5f) are missing while the even ones
//              (2f, 4f, 6f) are strong: the note is really at 2f
//   the melody: the moved note is closer to the notes before and after it (a note that jumps an
//     octave and comes straight back). A melody that really leaps an octave stays as it is. A note
//     with no neighbours within 1.5 s moves only on much stronger spectral evidence.
// Two more things the transcription does: it writes a note twice, an octave apart, at the same
// onset (the lower one or the upper one is not there), and it can put every note of a run in the
// wrong octave (a low bass line whose fundamentals are weak). So the duplicates are settled first
// (the one whose own partials the spectrum supports stays), and the melody check takes each
// neighbour at the pitch its own spectrum asks for, so a run that is wrong together moves together
// (bass stem only, see below).
// Returns { notes (a corrected copy, duplicates left out), changed: [[index, from, to]], removed:
// [indexes], checked }.
export function fixOctaves(x, rate, notes, { off = 0, runs = false, dedupe = false } = {}) {
  const changed = [], removed = new Set();
  const order = notes.map((nt, i) => i).sort((a, b) => notes[a][0] - notes[b][0]);
  // 1. octave duplicates at the same onset (a line that plays one note at a time only: in chords an
  // octave doubling is usually played)
  if (dedupe) for (let si = 0; si < order.length; si++) {
    const i = order[si];
    for (let sj = si + 1; sj < order.length && notes[order[sj]][0] - notes[i][0] < 0.04; sj++) {
      const j = order[sj], dn = notes[j][2] - notes[i][2];
      if (removed.has(i) || removed.has(j) || (Math.abs(dn) !== 12 && Math.abs(dn) !== 24)) continue;
      const lo = dn > 0 ? i : j, hi = dn > 0 ? j : i;
      const keepLow = fundamentalThere(x, rate, notes[lo][0] + off, notes[lo][1], notes[lo][2]);
      if (keepLow == null) continue;
      removed.add(keepLow ? hi : lo);
    }
  }
  const live = order.filter((i) => !removed.has(i));
  // 2. votes for the notes that play alone
  const vote = new Map(), strong = new Map();
  let checked = 0;
  for (let si = 0; si < live.length; si++) {
    const i = live[si], [t, d, n] = notes[i];
    if (d < 0.1) continue;
    // alone: no other note sounds through much of the measured frame (a legato neighbour's last
    // few tens of ms are fine)
    const fA = t + 0.03, fB = t + Math.min(d, 0.25);
    let alone = true;
    for (let j = Math.max(0, si - 30); j < Math.min(live.length, si + 30); j++) {
      const o = notes[live[j]];
      if (j !== si && Math.min(fB, o[0] + o[1]) - Math.max(fA, o[0]) > 0.06) { alone = false; break; }
    }
    if (!alone) continue;
    const v = octaveVote(x, rate, t + off, d, n);
    if (!v) continue;
    checked++;
    if (v.vote && n + v.vote >= 12 && n + v.vote <= 115) { vote.set(i, v.vote); strong.set(i, v.strong); }
  }
  // 3. the melody: a voted note moves when that brings it closer to its neighbours, each neighbour
  // taken where its own vote puts it
  const out = notes.map((nt) => nt.slice());
  // runs (the bass stem only): neighbours count where their own vote puts them, so a run that is an
  // octave off together moves together. Elsewhere an instrument whose fundamental is always weak
  // would look the same, so a note moves only toward neighbours as written.
  const at = (i) => notes[i][2] + (runs ? vote.get(i) || 0 : 0);
  for (let si = 0; si < live.length; si++) {
    const i = live[si];
    if (!vote.has(i)) continue;
    const t = notes[i][0], n = notes[i][2], to = n + vote.get(i);
    const nb = [];
    if (si > 0 && t - notes[live[si - 1]][0] < 1.5) nb.push(at(live[si - 1]));
    if (si + 1 < live.length && notes[live[si + 1]][0] - t < 1.5) nb.push(at(live[si + 1]));
    const cost = (p) => nb.reduce((a, q) => a + Math.abs(p - q), 0);
    if (nb.length ? cost(to) < cost(n) || (cost(to) === cost(n) && strong.get(i)) : strong.get(i)) { out[i][2] = to; changed.push([i, n, to]); }
  }
  return { notes: out.filter((_, i) => !removed.has(i)), changed, removed: [...removed], checked };
}

// is the fundamental of this note there (its own partial clearly above the floor)? null: no frame
function fundamentalThere(x, rate, T, d, n) {
  const f = hz(n), size = f < 200 ? 8192 : 4096, s0 = Math.round((T + 0.03) * rate);
  if (s0 < 0 || s0 + size > x.length) return null;
  const w = hann(size), fr = new Float64Array(size);
  for (let i = 0; i < size; i++) fr[i] = x[s0 + i] * w[i];
  const mag = fftMag(fr), bin = (v) => (v * size) / rate;
  const P = (v) => { const c = bin(v); let m = 0; for (let k = Math.floor(c * 0.97); k <= Math.ceil(c * 1.03); k++) m = Math.max(m, mag[k] || 0); return m * m; };
  const fl = (P(0.75 * f) + P(1.25 * f) + P(1.5 * f) + P(1.75 * f)) / 4;
  return P(f) > 20 * fl && P(f) > 0.05 * P(2 * f);
}

// { vote: +12 / -12 / 0, strong } for one note, or null when it cannot be measured
export function octaveVote(x, rate, T, d, n) {
  const f = hz(n), size = f < 200 ? 8192 : 4096;
  const s0 = Math.round((T + 0.03) * rate);
  if (s0 < 0 || s0 + size > x.length) return null;
  const w = hann(size), fr = new Float64Array(size);
  let e = 0;
  for (let i = 0; i < size; i++) { fr[i] = x[s0 + i] * w[i]; e += fr[i] * fr[i]; }
  if (e < 1e-6) return null;
  const mag = fftMag(fr), bin = (hzv) => (hzv * size) / rate;
  const P = (hzv) => { if (hzv > rate / 2 - 200 || hzv < 20) return 0; const c = bin(hzv); let m = 0; for (let k = Math.floor(c * 0.97); k <= Math.ceil(c * 1.03); k++) m = Math.max(m, mag[k] || 0); return m * m; };
  const main = P(f) + P(2 * f) + P(3 * f);
  if (main <= 0) return null;
  const halfOdd = P(f / 2) + P(1.5 * f) + P(2.5 * f);
  const odd = P(f) + P(3 * f) + P(5 * f), even = P(2 * f) + P(4 * f) + P(6 * f);
  // the floor between the partials (what "nothing there" measures as)
  let fl = 0;
  for (const m of [0.75, 1.25, 1.75, 2.25]) fl += P(m * f);
  fl /= 4;
  if (halfOdd > 0.3 * main && halfOdd > 18 * fl) return { vote: -12, strong: halfOdd > 0.6 * main && halfOdd > 60 * fl };
  if (even > 0 && odd < 0.06 * even && even > 30 * fl) return { vote: 12, strong: odd < 0.02 * even && even > 100 * fl };
  return { vote: 0, strong: false };
}
