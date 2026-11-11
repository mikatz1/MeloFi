// Newtone-style pitch editing (FL Studio's Newtone): analyse a monophonic recording into notes,
// let the user move / stretch them, and render a corrected copy offline.
//
// Analysis: YIN pitch every 5.3 ms on a 2x-decimated mono sum. Notes: runs of voiced frames that
// stay near one pitch. Rendering: TD-PSOLA — grains two periods long are cut at pitch marks
// (aligned to the waveform's peaks) and laid back down at the new period, which changes pitch
// while keeping the voice's formants; time stretch comes from how fast the read point moves.
// With no edits the output is the input (grains of a Hann window overlap-add to one).

const HOP = 256;

function yin(x, at, W, tauMin, tauMax, d) {
  let run = 0, best = -1;
  d[0] = 1;
  for (let tau = 1; tau <= tauMax; tau++) {
    let s = 0;
    for (let i = 0; i < W; i++) { const v = x[at + i] - x[at + i + tau]; s += v * v; }
    run += s;
    d[tau] = run > 0 ? (s * tau) / run : 1;
    if (tau > tauMin + 1 && d[tau - 1] < 0.15 && d[tau - 1] <= d[tau]) { best = tau - 1; break; }
  }
  if (best < 0) return 0;
  const a = d[best - 1], b = d[best], c = d[best + 1];
  const den = a - 2 * b + c;
  return den ? best + (a - c) / (2 * den) : best;
}

// buf: AudioBuffer-like { sampleRate, length, getChannelData(i), numberOfChannels }
// returns { sr, frames: [{ t (s), f0 (Hz, 0 = unvoiced), midi, rms }], notes: [...] }
export async function analyse(buf, { onProgress = () => {} } = {}) {
  const sr = buf.sampleRate, n = buf.length;
  const L = buf.getChannelData(0), R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
  // decimate by 2 (average) for the pitch search
  const sr2 = sr / 2, m = Math.floor(n / 2), x = new Float32Array(m);
  for (let i = 0; i < m; i++) x[i] = (L[2 * i] + R[2 * i] + L[2 * i + 1] + R[2 * i + 1]) * 0.25;
  const W = Math.round(sr2 * 0.03), tauMin = Math.floor(sr2 / 1100), tauMax = Math.ceil(sr2 / 60);
  const d = new Float32Array(tauMax + 2);
  const frames = [];
  const hop2 = HOP / 2;
  let peakRms = 0;
  for (let f = 0, at = 0; at + W + tauMax < m; f++, at += hop2) {
    let e = 0; for (let i = 0; i < W; i++) e += x[at + i] * x[at + i];
    const rms = Math.sqrt(e / W);
    peakRms = Math.max(peakRms, rms);
    const tau = rms > 1e-3 ? yin(x, at, W, tauMin, tauMax, d) : 0;
    const f0 = tau ? sr2 / tau : 0;
    frames.push({ t: (at * 2 + W) / sr, f0, midi: f0 ? 69 + 12 * Math.log2(f0 / 440) : 0, rms });
    if (f % 400 === 0) { onProgress(at / m); await new Promise((r) => setTimeout(r, 0)); }
  }
  // quiet frames are unvoiced; a lone voiced frame between unvoiced ones is noise
  for (const fr of frames) if (fr.rms < peakRms * 0.04) { fr.f0 = 0; fr.midi = 0; }
  for (let i = 1; i < frames.length - 1; i++) if (frames[i].f0 && !frames[i - 1].f0 && !frames[i + 1].f0) { frames[i].f0 = 0; frames[i].midi = 0; }
  // octave jumps: fold a frame that is ~12 semitones off its neighbours back
  for (let i = 1; i < frames.length; i++) { const a = frames[i - 1].midi, b = frames[i].midi; if (a && b && Math.abs(b - a) > 9) { const k = Math.round((a - b) / 12); if (k) { frames[i].midi += 12 * k; frames[i].f0 = 440 * 2 ** ((frames[i].midi - 69) / 12); } } }
  return { sr, hop: HOP, frames, notes: segment(frames) };
}

// notes: voiced runs, split where the (smoothed) pitch moves more than ~0.7 semitone for a while
export function segment(frames) {
  const notes = [];
  let cur = null;
  const close = (i) => {
    if (!cur) return;
    if (i - cur.a >= 6) { // at least ~30 ms
      const ms = frames.slice(cur.a, i).map((f) => f.midi).sort((p, q) => p - q);
      const med = ms[Math.floor(ms.length / 2)];
      notes.push({ a: cur.a, b: i, start: frames[cur.a].t, end: frames[i - 1].t + 0.0053, median: med, target: med, stretch: 1, center: 0, variation: 1 });
    }
    cur = null;
  };
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    if (!f.f0) { close(i); continue; }
    if (!cur) { cur = { a: i, ref: f.midi, hold: 0 }; continue; }
    // running reference; a sustained move away starts a new note
    if (Math.abs(f.midi - cur.ref) > 0.7) { if (++cur.hold > 4) { close(i - 4); cur = { a: i - 4, ref: f.midi, hold: 0 }; } }
    else { cur.hold = 0; cur.ref += (f.midi - cur.ref) * 0.15; }
  }
  close(frames.length);
  return notes;
}

// the pitch change (semitones) and stretch at every frame, from the notes' edits.
// center (0..1, as in Newtone): how far the slow drift is pulled to the note's centre (0 = left as
// sung); variation (0..1): how much vibrato is kept (1 = as sung).
function frameCurves(an) {
  const { frames, notes } = an;
  const shift = new Float32Array(frames.length), stretch = new Float32Array(frames.length).fill(1);
  const slow = new Float32Array(frames.length);
  // slow pitch movement (≈ 3 Hz low-pass of the voiced pitch)
  let s = 0;
  for (let i = 0; i < frames.length; i++) { const v = frames[i].midi; if (v) { s = s ? s + (v - s) * 0.1 : v; slow[i] = s; } else { s = 0; slow[i] = 0; } }
  for (const nt of notes) {
    for (let i = nt.a; i < nt.b; i++) {
      const p = frames[i].midi;
      if (!p) continue;
      const drift = slow[i] - nt.median, vib = p - slow[i];
      const want = nt.target + drift * (1 - nt.center) + vib * nt.variation;
      // short ramps at the note edges so a move does not click
      const edge = Math.min(1, (i - nt.a + 1) / 3, (nt.b - i) / 3);
      shift[i] = (want - p) * edge;
      stretch[i] = nt.stretch;
    }
  }
  return { shift, stretch };
}

// TD-PSOLA render. chans: Float32Array[] (the recording), returns Float32Array[]
export function render(an, chans) {
  const { sr, frames, hop } = an;
  const n = chans[0].length;
  const mono = chans.length > 1 ? Float32Array.from(chans[0], (v, i) => (v + chans[1][i]) * 0.5) : chans[0];
  const { shift, stretch } = frameCurves(an);
  const fAt = (pos) => Math.max(0, Math.min(frames.length - 1, Math.floor(pos / hop)));
  // analysis pitch marks: one per period in voiced parts (on the waveform's peaks), every 5 ms elsewhere
  const marks = [];
  let p = 0;
  while (p < n) {
    const fr = frames[fAt(p)], T = fr?.f0 ? sr / fr.f0 : 240;
    let q = Math.round(p), best = q;
    if (fr?.f0) { const r = Math.round(T * 0.25); let bv = -1; for (let k = Math.max(0, q - r); k < Math.min(n, q + r); k++) { const v = mono[k]; if (v > bv) { bv = v; best = k; } } }
    marks.push({ pos: best, T: Math.max(32, T), voiced: !!fr?.f0 });
    p = Math.max(best + 1, best + T);
  }
  // a grain spans from the previous mark to the next: its period is the real distance between
  // marks, so unchanged stretches overlap-add back to exactly the input
  for (let k = 0; k < marks.length - 1; k++) marks[k].T = Math.max(16, marks[k + 1].pos - marks[k].pos);
  // output length follows the stretches
  let outLen = 0; for (let i = 0; i < frames.length; i++) outLen += hop * stretch[i];
  outLen = Math.ceil(outLen + (n - frames.length * hop) + 1);
  const outs = chans.map(() => new Float32Array(outLen)), wsum = new Float32Array(outLen);
  // map output time -> input time through the per-frame stretch
  const inAt = []; { let o = 0; for (let i = 0; i < frames.length; i++) { inAt.push(o); o += hop * stretch[i]; } inAt.push(o); }
  const outToIn = (o) => { let lo = 0, hi = frames.length; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (inAt[mid] <= o) lo = mid; else hi = mid - 1; } if (lo >= frames.length) return frames.length * hop + (o - inAt[frames.length]); return lo * hop + (o - inAt[lo]) / (stretch[lo] || 1); };
  const inToOut = (ip) => { const f = Math.min(frames.length, Math.floor(ip / hop)); return f >= frames.length ? inAt[frames.length] + (ip - frames.length * hop) : inAt[f] + (ip - f * hop) * stretch[f]; };
  let mi = 0;
  for (let o = inToOut(marks[0]?.pos || 0); o < outLen;) {
    const ip = outToIn(o);
    while (mi + 1 < marks.length && Math.abs(marks[mi + 1].pos - ip) <= Math.abs(marks[mi].pos - ip)) mi++;
    const mk = marks[mi], fi = fAt(ip);
    const ratio = mk.voiced ? 2 ** (shift[fi] / 12) : 1;
    const T = mk.T, half = Math.round(T);
    const oc = Math.round(o);
    for (let k = -half; k < half; k++) {
      const si = mk.pos + k, di = oc + k;
      if (si < 0 || si >= n || di < 0 || di >= outLen) continue;
      const w = 0.5 - 0.5 * Math.cos(Math.PI * (k + half) / half);
      for (let c = 0; c < chans.length; c++) outs[c][di] += chans[c][si] * w;
      wsum[di] += w;
    }
    o += T / ratio;
  }
  // grains overlap more when raised: divide by the window sum (not below 0.6, so gaps between
  // lowered grains are not blown up)
  for (let i = 0; i < outLen; i++) { const g = 1 / Math.max(0.6, wsum[i]); for (const out of outs) out[i] *= g; }
  // grains of a moved note do not line up perfectly, which costs a little level: match the
  // loudness of every edited frame to the original (unedited frames are left exactly as they are)
  const gains = new Float32Array(frames.length).fill(1);
  const mo = outs.length > 1 ? (i) => (outs[0][i] + outs[1][i]) * 0.5 : (i) => outs[0][i];
  for (let f = 0; f < frames.length; f++) {
    if (Math.abs(shift[f]) < 0.05) continue;
    const a0 = Math.max(0, (f - 1) * hop), a1 = Math.min(n, (f + 2) * hop);
    let ei = 0; for (let i = a0; i < a1; i++) ei += mono[i] * mono[i];
    const b0 = Math.max(0, Math.floor(inToOut(a0))), b1 = Math.min(outLen, Math.ceil(inToOut(a1)));
    let eo = 0; for (let i = b0; i < b1; i++) eo += mo(i) ** 2;
    if (eo > 1e-9) gains[f] = Math.max(0.7, Math.min(1.4, Math.sqrt((ei / (a1 - a0)) / (eo / Math.max(1, b1 - b0)))));
  }
  const sm = Float32Array.from(gains, (g, f) => (gains[Math.max(0, f - 1)] + 2 * g + gains[Math.min(frames.length - 1, f + 1)]) / 4);
  for (let f = 0; f < frames.length; f++) if (Math.abs(sm[f] - 1) > 1e-4) {
    const b0 = Math.max(0, Math.floor(inToOut(f * hop))), b1 = Math.min(outLen, Math.ceil(inToOut((f + 1) * hop)));
    const g0 = sm[f], g1 = sm[Math.min(frames.length - 1, f + 1)];
    for (let i = b0; i < b1; i++) { const g = g0 + (g1 - g0) * ((i - b0) / Math.max(1, b1 - b0)); for (const out of outs) out[i] *= g; }
  }
  // audio quality first: where nothing was changed and the timing is untouched, the original
  // samples go out unchanged; edited notes are cross-faded in over one frame (5 ms)
  if (stretch.every((v) => v === 1)) {
    const ed = new Float32Array(frames.length);
    for (let f = 0; f < frames.length; f++) if (Math.abs(shift[f]) > 0.01) for (let k = -2; k <= 2; k++) if (f + k >= 0 && f + k < frames.length) ed[f + k] = 1;
    for (let i = 0; i < Math.min(n, outLen); i++) {
      const fpos = i / hop, f = Math.min(frames.length - 1, Math.floor(fpos));
      const w = f >= frames.length - 1 ? ed[f] : ed[f] + (ed[f + 1] - ed[f]) * (fpos - f);
      if (w < 1) for (let c = 0; c < outs.length; c++) outs[c][i] = w * outs[c][i] + (1 - w) * chans[c][i];
    }
  }
  return outs;
}

// snap every note's target to the nearest note of a scale ({ root, type } / null = chromatic)
export function snapAll(an, scaleSteps = null, root = 0) {
  for (const nt of an.notes) {
    let best = Math.round(nt.median), bd = 99;
    for (let k = Math.floor(nt.median) - 6; k <= Math.ceil(nt.median) + 6; k++) {
      if (scaleSteps && !scaleSteps.includes(((k - root) % 12 + 12) % 12)) continue;
      if (Math.abs(k - nt.median) < bd) { bd = Math.abs(k - nt.median); best = k; }
    }
    nt.target = best;
  }
}
