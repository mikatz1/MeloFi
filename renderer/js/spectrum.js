// Audio spectrum for the background: log-spaced bands from 30 Hz to 16 kHz, with smoothing and
// falling peak caps. Fed either from the live AnalyserNode or (video rendering) from samples.

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class Spectrum {
  constructor() {
    this.vals = new Float32Array(256);
    this.peaks = new Float32Array(256);
    this.hold = new Float32Array(256);
  }

  // db: dBFS per FFT bin (fftSize / 2 of them). n bands; smooth 0..0.95 (how slowly bars fall).
  update(db, sampleRate, n, smooth, dt) {
    const fftN = db.length * 2, lo = 30, hi = Math.min(16000, sampleRate / 2);
    const k = Math.pow(clamp(smooth, 0, 0.97), dt * 60);
    for (let i = 0; i < n; i++) {
      const f0 = lo * Math.pow(hi / lo, i / n), f1 = lo * Math.pow(hi / lo, (i + 1) / n);
      const b0 = Math.floor((f0 / sampleRate) * fftN), b1 = Math.max(b0 + 1, Math.ceil((f1 / sampleRate) * fftN));
      let m = -200;
      for (let b = b0; b < b1 && b < db.length; b++) if (db[b] > m) m = db[b];
      // -90..-20 dBFS -> 0..1, with a gentle tilt so the highs don't vanish
      const v = clamp((m + 90) / 70 + (i / n) * 0.1, 0, 1);
      this.vals[i] = v > this.vals[i] ? v : this.vals[i] * k + v * (1 - k);
      if (this.vals[i] >= this.peaks[i]) { this.peaks[i] = this.vals[i]; this.hold[i] = 0.35; }
      else if ((this.hold[i] -= dt) < 0) this.peaks[i] = Math.max(this.vals[i], this.peaks[i] - dt * 0.7);
    }
  }
}

// Offline: dBFS spectrum of `N` samples (mono mix) starting at `start`, Hann-windowed.
export function dbFromSamples(L, R, start, N = 4096) {
  const re = new Float32Array(N), im = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const j = start + i;
    const s = j >= 0 && j < L.length ? (L[j] + (R ? R[j] : L[j])) * 0.5 : 0;
    re[i] = s * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
  }
  // radix-2 FFT
  for (let i = 1, j = 0; i < N; i++) {
    let bit = N >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= N; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < N; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const ar = re[i + j], ai = im[i + j];
        const br = re[i + j + len / 2] * cr - im[i + j + len / 2] * ci, bi = re[i + j + len / 2] * ci + im[i + j + len / 2] * cr;
        re[i + j] = ar + br; im[i + j] = ai + bi;
        re[i + j + len / 2] = ar - br; im[i + j + len / 2] = ai - bi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
  const out = new Float32Array(N / 2);
  for (let i = 0; i < N / 2; i++) out[i] = 20 * Math.log10(Math.hypot(re[i], im[i]) / (N / 4) + 1e-12);
  return out;
}
