// Real-time pitch correction (what FL Studio's Pitcher does live; Newtone is its offline cousin).
// Pitch is found with YIN on a 2x-decimated mono sum; each channel then goes through a two-tap
// delay-line pitch shifter whose taps cross-fade with sin² windows (they always sum to 1). The
// shifter adds a varying delay of up to one grain (30 ms), so there is no dry/wet mix: blending
// would comb-filter.
//
// AudioParams: root 0..11, mask (12-bit set of allowed pitch classes, bit 0 = root), speed (s to
// reach the target note; 0 = instant).
class PitchFix extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'root', defaultValue: 0, minValue: 0, maxValue: 11, automationRate: 'k-rate' },
      { name: 'mask', defaultValue: 4095, minValue: 0, maxValue: 4095, automationRate: 'k-rate' },
      { name: 'speed', defaultValue: 0.02, minValue: 0, maxValue: 0.5, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.sr2 = sampleRate / 2;
    this.W = Math.round(this.sr2 * 0.032);              // analysis window (decimated samples)
    this.tauMin = Math.floor(this.sr2 / 1100);
    this.tauMax = Math.ceil(this.sr2 / 65);
    this.hist = new Float32Array(this.W + this.tauMax + 8);
    this.hop = 256; this.since = 0; this.odd = 0; this.acc = 0;
    this.d = new Float32Array(this.tauMax + 2);
    this.ratio = 1; this.target = 1;
    this.L = Math.round(sampleRate * 0.03);             // grain length
    this.N = 8192;
    this.lines = [new Float32Array(this.N), new Float32Array(this.N)];
    this.w = 0; this.pos = 0;
  }

  detect() {
    const h = this.hist, W = this.W, d = this.d;
    let e = 0;
    for (let i = h.length - W; i < h.length; i++) e += h[i] * h[i];
    if (e / W < 1e-6) return 0; // silence
    const off = h.length - W - this.tauMax;
    let run = 0, best = -1;
    d[0] = 1;
    for (let tau = 1; tau <= this.tauMax; tau++) {
      let s = 0;
      for (let i = 0; i < W; i++) { const x = h[off + this.tauMax + i] - h[off + this.tauMax + i - tau]; s += x * x; }
      run += s;
      d[tau] = run > 0 ? (s * tau) / run : 1;
      if (tau > this.tauMin && best < 0 && d[tau] < 0.15) {
        // walk to the bottom of this dip
        while (tau + 1 <= this.tauMax) {
          let s2 = 0;
          for (let i = 0; i < W; i++) { const x = h[off + this.tauMax + i] - h[off + this.tauMax + i - tau - 1]; s2 += x * x; }
          const run2 = run + s2, v = (s2 * (tau + 1)) / run2;
          if (v >= d[tau]) { d[tau + 1] = v; break; } // keep the right neighbour for interpolation
          tau++; run = run2; d[tau] = v;
        }
        best = tau;
        break;
      }
    }
    if (best < 0) return 0; // unvoiced
    const a = d[best - 1], b = d[best], c = best + 1 <= this.tauMax ? d[best + 1] : b;
    const den = a - 2 * b + c, t = den ? best + (a - c) / (2 * den) : best;
    return this.sr2 / t;
  }

  process(inputs, outputs, P) {
    const inp = inputs[0], out = outputs[0];
    if (!inp || !inp.length) return true;
    const n = inp[0].length, chs = Math.min(out.length, 2);
    const root = Math.round(P.root[0]), mask = Math.round(P.mask[0]), speed = P.speed[0];
    const L = this.L, N = this.N, h = this.hist;
    for (let i = 0; i < n; i++) {
      // analysis: 2x decimation (simple average) into the history
      const m = (inp[0][i] + (inp[1] ? inp[1][i] : inp[0][i])) * 0.5;
      this.acc += m;
      if (this.odd ^= 1) { /* first half of the pair */ } else {
        h.copyWithin(0, 1); h[h.length - 1] = this.acc * 0.5; this.acc = 0;
        if (++this.since >= this.hop / 2) {
          this.since = 0;
          const f = this.detect();
          if (f > 0) {
            const midi = 69 + 12 * Math.log2(f / 440);
            let tgt = Math.round(midi), bestD = 99;
            for (let k = Math.floor(midi) - 6; k <= Math.ceil(midi) + 6; k++) {
              const pc = ((k - root) % 12 + 12) % 12;
              if (mask & (1 << pc) && Math.abs(k - midi) < bestD) { bestD = Math.abs(k - midi); tgt = k; }
            }
            this.target = Math.pow(2, (tgt - midi) / 12);
          } else this.target = 1;
        }
      }
      // glide toward the target ratio
      const k = speed <= 0.001 ? 1 : 1 - Math.exp(-1 / (speed * sampleRate));
      this.ratio += (this.target - this.ratio) * k;
      // shifter: the read point drifts by (1 - ratio) per sample inside a grain of L samples
      this.pos += 1 - this.ratio;
      if (this.pos >= L) this.pos -= L; else if (this.pos < 0) this.pos += L;
      const d1 = this.pos, d2 = (this.pos + L / 2) % L;
      const g1 = Math.sin(Math.PI * d1 / L) ** 2, g2 = 1 - g1;
      for (let c = 0; c < chs; c++) {
        const x = (inp[c] || inp[0])[i], line = this.lines[c];
        line[this.w] = x;
        const r1 = this.w - d1 - 2, r2 = this.w - d2 - 2;
        const y = g1 * tap(line, r1, N) + g2 * tap(line, r2, N);
        out[c][i] = y;
      }
      this.w = (this.w + 1) % N;
    }
    return true;
  }
}

function tap(line, r, N) {
  r = ((r % N) + N) % N;
  const i = Math.floor(r), f = r - i, a = line[i], b = line[(i + 1) % N];
  return a + (b - a) * f;
}

registerProcessor('pitch-fix', PitchFix);
