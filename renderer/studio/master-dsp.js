// MeloFi Studio — mastering DSP that runs on whole buffers (export, analysis) and is mirrored in
// the live worklet (js/master-worklet.js): ITU-R BS.1770-4 loudness, EBU R128 loudness range,
// true peak by 4x oversampling, a lookahead true-peak limiter, gain, and dither.

// ---------- K-weighting (BS.1770-4) for any sample rate ----------
// the two stages from the standard, re-derived for the rate by the bilinear transform
export function kWeighting(rate) {
  const shelf = (() => {
    const f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
    const K = Math.tan(Math.PI * f0 / rate), Vh = 10 ** (G / 20), Vb = Vh ** 0.4996667741545416;
    const a0 = 1 + K / Q + K * K;
    return { b: [(Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0], a: [1, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0] };
  })();
  const hp = (() => {
    const f0 = 38.13547087602444, Q = 0.5003270373238773;
    const K = Math.tan(Math.PI * f0 / rate), a0 = 1 + K / Q + K * K;
    return { b: [1, -2, 1], a: [1, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0] };
  })();
  return [shelf, hp];
}

function biquadRun(x, { b, a }) {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}

// ---------- true peak: oversampled peak between the samples ----------
// 8x with a Kaiser-windowed sinc, for the meter and the limiter alike (BS.1770 asks for at least 4x;
// 4x readings can sit ~0.2 dB under the real peak between its points, 8x keeps that under 0.05 dB)
const I0 = (x) => { let s = 1, t = 1; for (let k = 1; k < 30; k++) { t *= (x / (2 * k)) ** 2; s += t; } return s; };
export const LIM_P = 8, LIM_T = 16;
export const LIM_FIR = (() => {
  const P = LIM_P, T = LIM_T, N = T * P, beta = 6, out = [];
  for (let ph = 0; ph < P; ph++) {
    const row = new Float32Array(T);
    for (let k = 0; k < T; k++) {
      const n = k * P + ph, t = (n - (N - 1) / 2) / P, r = (2 * n) / (N - 1) - 1;
      row[k] = (t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t)) * I0(beta * Math.sqrt(Math.max(0, 1 - r * r))) / I0(beta);
    }
    const s = row.reduce((a, v) => a + v, 0);
    for (let k = 0; k < T; k++) row[k] /= s;
    out.push(row);
  }
  return out;
})();

export function truePeak(ch) {
  let pk = 0;
  const T = LIM_T;
  for (let i = 0; i < ch.length; i++) {
    const a = Math.abs(ch[i]); if (a > pk) pk = a;
    if (i < T) continue;
    for (let ph = 0; ph < LIM_P; ph++) {
      const f = LIM_FIR[ph];
      let s = 0;
      for (let k = 0; k < T; k++) s += f[k] * ch[i - k];
      const v = Math.abs(s); if (v > pk) pk = v;
    }
  }
  return pk;
}

export const dB = (x) => (x > 1e-10 ? 20 * Math.log10(x) : -200);
export const fromDB = (d) => 10 ** (d / 20);

// ---------- loudness ----------
// integrated (gated), loudness range, max momentary / short-term, true and sample peak
export function measure(left, right, rate) {
  const [st1, st2] = kWeighting(rate);
  const kl = biquadRun(biquadRun(left, st1), st2), kr = biquadRun(biquadRun(right, st1), st2);
  const blk = Math.round(rate * 0.1), nb = Math.floor(left.length / blk);
  const ms = new Float64Array(nb); // mean square (L+R) of each 100 ms block
  for (let b = 0; b < nb; b++) {
    let s = 0;
    for (let i = b * blk, e = i + blk; i < e; i++) s += kl[i] * kl[i] + kr[i] * kr[i];
    ms[b] = s / blk;
  }
  const L = (m) => (m > 1e-20 ? -0.691 + 10 * Math.log10(m) : -200);
  const win = (n) => { const out = []; for (let b = n - 1; b < nb; b++) { let s = 0; for (let k = b - n + 1; k <= b; k++) s += ms[k]; out.push(s / n); } return out; };
  const mom = win(4), short = win(30);
  // integrated: 400 ms blocks every 100 ms, absolute gate -70, relative gate -10 LU
  const g1 = mom.filter((m) => L(m) > -70);
  const rel = g1.length ? L(g1.reduce((a, b) => a + b, 0) / g1.length) - 10 : -200;
  const g2 = g1.filter((m) => L(m) > rel);
  const I = g2.length ? L(g2.reduce((a, b) => a + b, 0) / g2.length) : -70;
  // loudness range (EBU Tech 3342): short-term values, -70 absolute and -20 LU relative gates, 10th..95th percentile
  const s1 = short.filter((m) => L(m) > -70);
  const relS = s1.length ? L(s1.reduce((a, b) => a + b, 0) / s1.length) - 20 : -200;
  const s2 = s1.filter((m) => L(m) > relS).map(L).sort((a, b) => a - b);
  const pct = (p) => s2[Math.min(s2.length - 1, Math.max(0, Math.round((p / 100) * (s2.length - 1))))];
  const LRA = s2.length > 1 ? pct(95) - pct(10) : 0;
  let sp = 0;
  for (const ch of [left, right]) for (let i = 0; i < ch.length; i++) { const a = Math.abs(ch[i]); if (a > sp) sp = a; }
  const tp = Math.max(truePeak(left), truePeak(right));
  return {
    I, LRA,
    Mmax: mom.length ? Math.max(...mom.map(L)) : -70,
    Smax: short.length ? Math.max(...short.map(L)) : -70,
    tp: dB(tp), sp: dB(sp),
    short: short.map(L), // for a loudness graph
  };
}

// ---------- lookahead true-peak limiter (the same algorithm as the live Maximizer) ----------
// gain needed per sample -> minimum over the lookahead -> moving average over the lookahead
// (never above the needed gain when the sample comes out) -> slower release
export function limit(left, right, rate, { ceilingDb = -1, lookaheadMs = 3, releaseMs = 120, gainDb = 0 } = {}) {
  const n = left.length, L = Math.max(1, Math.round((lookaheadMs / 1000) * rate));
  const ceil = fromDB(ceilingDb), pre = fromDB(gainDb), rel = Math.exp(-1 / ((releaseMs / 1000) * rate));
  const need = new Float32Array(n + L).fill(1);
  const T = LIM_T; // an interpolated point at i comes from the samples i-T..i
  const at = (i, pk) => { pk *= pre; if (pk > ceil && i >= 0) need[i] = Math.min(need[i], ceil / pk); };
  for (let i = 0; i < n; i++) {
    at(i, Math.max(Math.abs(left[i]), Math.abs(right[i])));
    if (i < T) continue;
    let ip = 0;
    for (const ch of [left, right]) for (let ph = 0; ph < LIM_P; ph++) {
      const f = LIM_FIR[ph]; let s = 0;
      for (let k = 0; k < T; k++) s += f[k] * ch[i - k];
      const v = Math.abs(s); if (v > ip) ip = v;
    }
    at(i - T, ip);
  }
  // each output sample's gain is under the need of every detection that involved it
  const hold = minHold(need, L + T + 1), out = [new Float32Array(n), new Float32Array(n)];
  let acc = L; const box = new Float32Array(L).fill(1);
  let g = 1, minG = 1;
  for (let i = 0; i < n + L; i++) {
    acc += hold[i] - box[i % L]; box[i % L] = hold[i];
    const s = acc / L;
    g = s < g ? s : s - (s - g) * rel;
    const j = i - L;
    if (j >= 0) {
      out[0][j] = Math.max(-ceil, Math.min(ceil, left[j] * pre * g));
      out[1][j] = Math.max(-ceil, Math.min(ceil, right[j] * pre * g));
      if (g < minG) minG = g;
    }
  }
  return { left: out[0], right: out[1], rate, maxGrDb: -dB(minG) };
}

// running minimum over the last `w` values (monotonic deque)
function minHold(x, w) {
  const out = new Float32Array(x.length), q = new Int32Array(x.length);
  let h = 0, t = 0;
  for (let i = 0; i < x.length; i++) {
    while (t > h && x[q[t - 1]] >= x[i]) t--;
    q[t++] = i;
    if (q[h] <= i - w) h++;
    out[i] = x[q[h]];
  }
  return out;
}

export function gain(mix, db) {
  const k = fromDB(db);
  return { ...mix, left: mix.left.map((v) => v * k), right: mix.right.map((v) => v * k) };
}

// ---------- dither to `bits` (TPDF, optionally noise-shaped) -> integer samples ----------
// shape: 'none' | 'tpdf' | 'shaped' (2nd-order error feedback that pushes the noise above ~10 kHz)
export function quantize(ch, bits, shape = 'tpdf') {
  const q = 2 ** (bits - 1), lo = -q, hi = q - 1, out = new Int32Array(ch.length);
  let e1 = 0, e2 = 0;
  for (let i = 0; i < ch.length; i++) {
    let x = ch[i] * q;
    if (shape === 'shaped') x -= 1.623 * e1 - 0.982 * e2;
    const d = shape === 'none' ? 0 : Math.random() - Math.random();
    let y = Math.round(x + d);
    y = y < lo ? lo : y > hi ? hi : y;
    if (shape === 'shaped') { e2 = e1; e1 = y - x; }
    out[i] = y;
  }
  return out;
}
