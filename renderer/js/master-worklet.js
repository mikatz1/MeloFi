// Mastering processors for the live engine (the offline export runs the same DSP from
// studio/master-dsp.js on whole buffers):
//   melofi-maximizer  lookahead true-peak limiter (8x oversampled detection, 3 ms lookahead)
//   melofi-meter      BS.1770 K-weighted 100 ms blocks, true / sample peak, correlation, scope points
//   melofi-dyneq      four dynamic bell bands: each cuts (or lifts) only while its band is loud
import { kWeighting, LIM_FIR, LIM_P, LIM_T } from '../studio/master-dsp.js';

const LOOK_MS = 3;

class Maximizer extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'gain', defaultValue: 1, minValue: 0, maxValue: 64, automationRate: 'k-rate' },
      { name: 'ceiling', defaultValue: 0.891, minValue: 0.01, maxValue: 1, automationRate: 'k-rate' },
      { name: 'release', defaultValue: 0.12, minValue: 0.005, maxValue: 2, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    const L = this.L = Math.max(1, Math.round((LOOK_MS / 1000) * sampleRate)), T = LIM_T;
    this.W = L + T + 1;                  // window of the minimum hold
    this.R = 1 << Math.ceil(Math.log2(L + 2 * T + 8)); // ring size (power of two)
    this.xl = new Float32Array(this.R); this.xr = new Float32Array(this.R);
    this.need = new Float32Array(this.R).fill(1);
    this.dqI = new Int32Array(this.W + 2); this.dqV = new Float32Array(this.W + 2); this.dh = 0; this.dt = 0; this.dn = 0;
    this.box = new Float32Array(L).fill(1); this.acc = L;
    this.i = 0; this.g = 1; this.minG = 1; this.sent = 0;
  }

  process(inputs, outputs, params) {
    const inp = inputs[0], out = outputs[0];
    const n = out[0].length;
    const inL = inp && inp[0] ? inp[0] : null, inR = inp && (inp[1] || inp[0]) ? (inp[1] || inp[0]) : null;
    const oL = out[0], oR = out[1] || out[0];
    const pre = params.gain[0], ceil = params.ceiling[0], rel = Math.exp(-1 / (params.release[0] * sampleRate));
    const { L, R, W, xl, xr, need, box } = this, M = R - 1, T = LIM_T;
    const dqI = this.dqI, dqV = this.dqV, DQ = dqI.length;
    let { i, g, acc } = this;
    for (let s = 0; s < n; s++, i++) {
      const a = inL ? inL[s] : 0, b = inR ? inR[s] : 0;
      xl[i & M] = a; xr[i & M] = b;
      // needed gain: this sample, and the points between the last T samples (filed at i - T)
      let pk = Math.max(Math.abs(a), Math.abs(b)) * pre;
      need[i & M] = pk > ceil ? ceil / pk : 1;
      if (i >= T) {
        let ip = 0;
        for (let ph = 0; ph < LIM_P; ph++) {
          const f = LIM_FIR[ph];
          let sl = 0, sr = 0;
          for (let k = 0; k < T; k++) { const j = (i - k) & M; sl += f[k] * xl[j]; sr += f[k] * xr[j]; }
          const v = Math.max(Math.abs(sl), Math.abs(sr)); if (v > ip) ip = v;
        }
        ip *= pre;
        if (ip > ceil) { const j = (i - T) & M; need[j] = Math.min(need[j], ceil / ip); }
      }
      // index k = i - T is final now: minimum over the last W, then the moving average over L
      const k = i - T;
      let held = 1;
      if (k >= 0) {
        const v = need[k & M];
        while (this.dn > 0 && dqV[(this.dt - 1 + DQ) % DQ] >= v) { this.dt = (this.dt - 1 + DQ) % DQ; this.dn--; }
        dqI[this.dt] = k; dqV[this.dt] = v; this.dt = (this.dt + 1) % DQ; this.dn++;
        while (this.dn > 0 && dqI[this.dh] <= k - W) { this.dh = (this.dh + 1) % DQ; this.dn--; }
        held = dqV[this.dh];
      }
      const bi = (k + L * 4) % L;
      acc += held - box[bi]; box[bi] = held;
      const sm = acc / L;
      g = sm < g ? sm : sm - (sm - g) * rel;
      if (g < this.minG) this.minG = g;
      // out: the sample from L + T ago
      const j = (i - T - L) & M;
      let yl = xl[j] * pre * g, yr = xr[j] * pre * g;
      yl = yl > ceil ? ceil : yl < -ceil ? -ceil : yl;
      yr = yr > ceil ? ceil : yr < -ceil ? -ceil : yr;
      oL[s] = yl; if (oR !== oL) oR[s] = yr;
    }
    this.i = i; this.g = g; this.acc = acc;
    // gain reduction for the meter, about 20 times a second
    this.sent += n;
    if (this.sent >= sampleRate / 20) { this.sent = 0; this.port.postMessage(this.minG); this.minG = 1; }
    return true;
  }
}

class Meter extends AudioWorkletProcessor {
  constructor() {
    super();
    const [a, b] = kWeighting(sampleRate);
    this.f = [a, b];
    this.z = new Float64Array(16); // filter states: 2 channels x 2 stages x 4
    this.blk = Math.round(sampleRate * 0.1);
    this.hx = [new Float32Array(LIM_T), new Float32Array(LIM_T)]; this.hp = 0;
    this.reset();
    this.scope = new Float32Array(512); this.sc = 0;
  }

  reset() { this.n = 0; this.ss = 0; this.tp = 0; this.sp = 0; this.lr = 0; this.ll = 0; this.rr = 0; }

  stage(x, f, z, o) {
    const y = f.b[0] * x + f.b[1] * z[o] + f.b[2] * z[o + 1] - f.a[1] * z[o + 2] - f.a[2] * z[o + 3];
    z[o + 1] = z[o]; z[o] = x; z[o + 3] = z[o + 2]; z[o + 2] = y;
    return y;
  }

  process(inputs) {
    const inp = inputs[0];
    if (!inp || !inp[0]) return true;
    const L = inp[0], R = inp[1] || inp[0], N = L.length, [f1, f2] = this.f, z = this.z, T = LIM_T;
    for (let s = 0; s < N; s++) {
      const l = L[s], r = R[s];
      const kl = this.stage(this.stage(l, f1, z, 0), f2, z, 4), kr = this.stage(this.stage(r, f1, z, 8), f2, z, 12);
      this.ss += kl * kl + kr * kr;
      const al = Math.abs(l), ar = Math.abs(r);
      if (al > this.sp) this.sp = al; if (ar > this.sp) this.sp = ar;
      // true peak (8x) on both channels
      const p = this.hp = (this.hp + 1) % T;
      this.hx[0][p] = l; this.hx[1][p] = r;
      for (let c = 0; c < 2; c++) {
        const hx = this.hx[c];
        for (let ph = 0; ph < LIM_P; ph++) { // 8x, the same points as the limiter and the export
          const fi = LIM_FIR[ph]; let acc = 0;
          for (let k = 0; k < T; k++) acc += fi[k] * hx[(p - k + T) % T];
          const v = Math.abs(acc); if (v > this.tp) this.tp = v;
        }
      }
      this.lr += l * r; this.ll += l * l; this.rr += r * r;
      if ((this.n & 3) === 0 && this.sc < 512) { this.scope[this.sc++] = l; this.scope[this.sc++] = r; }
      if (++this.n >= this.blk) {
        this.port.postMessage({ ms: this.ss / this.n, tp: Math.max(this.tp, this.sp), sp: this.sp, lr: this.lr, ll: this.ll, rr: this.rr, scope: this.scope.slice(0, this.sc) });
        this.reset(); this.sc = 0;
      }
    }
    return true;
  }
}

// RBJ cookbook biquads
function peakCoefs(f, q, gDb, sr) {
  const A = 10 ** (gDb / 40), w = (2 * Math.PI * f) / sr, al = Math.sin(w) / (2 * q), cw = Math.cos(w), a0 = 1 + al / A;
  return [(1 + al * A) / a0, (-2 * cw) / a0, (1 - al * A) / a0, (-2 * cw) / a0, (1 - al / A) / a0];
}
function bandCoefs(f, q, sr) {
  const w = (2 * Math.PI * f) / sr, al = Math.sin(w) / (2 * q), a0 = 1 + al;
  return [al / a0, 0, -al / a0, (-2 * Math.cos(w)) / a0, (1 - al) / a0];
}

class DynEq extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    const p = (name, def, min, max) => ({ name, defaultValue: def, minValue: min, maxValue: max, automationRate: 'k-rate' });
    const out = [];
    [[120, 1.5], [400, 1.5], [2500, 2], [7000, 2]].forEach(([f, q], i) => out.push(p(`f${i + 1}`, f, 20, 20000), p(`q${i + 1}`, q, 0.2, 10), p(`t${i + 1}`, -24, -60, 0), p(`r${i + 1}`, 0, -18, 18)));
    return [...out, p('attack', 0.005, 0.0005, 0.2), p('release', 0.12, 0.01, 2)];
  }

  constructor() {
    super();
    this.st = new Float64Array(32); // EQ filter state [band][channel]
    this.dt = new Float64Array(32); // detector state
    this.env = [0, 0, 0, 0]; this.gain = [0, 0, 0, 0];
    this.sent = 0;
  }

  process(inputs, outputs, P) {
    const inp = inputs[0], out = outputs[0];
    if (!inp || !inp[0]) { for (const ch of out) ch.fill(0); return true; }
    const n = out[0].length, chans = Math.min(2, inp.length, out.length);
    const atk = Math.exp(-1 / (P.attack[0] * sampleRate)), rel = Math.exp(-1 / (P.release[0] * sampleRate));
    for (let c = 0; c < out.length; c++) out[c].set(inp[Math.min(c, inp.length - 1)]);
    const names = [1, 2, 3, 4].map((i) => [`f${i}`, `q${i}`, `t${i}`, `r${i}`]);
    for (let b = 0; b < 4; b++) {
      if (P[names[b][3]][0] === 0) { this.gain[b] = 0; continue; } // a band with no range is off
      const [fn, qn, tn, rn] = names[b];
      const f = Math.min(P[fn][0], sampleRate * 0.45), q = P[qn][0], thr = P[tn][0], range = P[rn][0];
      const det = bandCoefs(f, q, sampleRate), z = this.dt;
      // the band's level: peak envelope of the band-passed signal over both channels
      let e = this.env[b];
      for (let i = 0; i < n; i++) {
        let lv = 0;
        for (let c = 0; c < chans; c++) {
          const o = (b * 2 + c) * 4, x = out[c][i];
          const y = det[0] * x + det[1] * z[o] + det[2] * z[o + 1] - det[3] * z[o + 2] - det[4] * z[o + 3];
          z[o + 1] = z[o]; z[o] = x; z[o + 3] = z[o + 2]; z[o + 2] = y;
          const a = Math.abs(y); if (a > lv) lv = a;
        }
        e = lv > e ? lv + (e - lv) * atk : lv + (e - lv) * rel;
      }
      this.env[b] = e;
      // nothing below the threshold, the full range 12 dB over it, smooth in between
      const over = 20 * Math.log10(e + 1e-9) - thr;
      const g = over <= 0 ? 0 : range * Math.min(1, over / 12);
      this.gain[b] = g;
      const k = peakCoefs(f, q, g, sampleRate), s = this.st;
      for (let c = 0; c < chans; c++) {
        const o = (b * 2 + c) * 4, x = out[c];
        for (let i = 0; i < n; i++) {
          const v = x[i], y = k[0] * v + k[1] * s[o] + k[2] * s[o + 1] - k[3] * s[o + 2] - k[4] * s[o + 3];
          s[o + 1] = s[o]; s[o] = v; s[o + 3] = s[o + 2]; s[o + 2] = y;
          x[i] = y;
        }
      }
    }
    this.sent += n;
    if (this.sent >= sampleRate / 20) { this.sent = 0; this.port.postMessage(this.gain.slice()); }
    return true;
  }
}

registerProcessor('melofi-dyneq', DynEq);
registerProcessor('melofi-maximizer', Maximizer);
registerProcessor('melofi-meter', Meter);
