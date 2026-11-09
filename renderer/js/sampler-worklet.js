// Sample-playback voices on the audio thread.
//
// Why not AudioBufferSourceNode: Chromium resamples it with linear interpolation,
// which dulls and aliases the top end whenever a sample is pitch-shifted. Here a
// note that matches its sample's pitch and rate is played back bit-for-bit, and
// anything else goes through a 32-tap Kaiser-windowed sinc interpolator.

const TAPS = 32;
const HALF = TAPS / 2;
const PHASES = 2048;
const PAD = HALF + 1;
const CUTOFF = 0.94; // of Nyquist; our pitch steps are within ~±10%, so this keeps aliasing far down
const BETA = 9;

function bessel0(x) {
  let s = 1, t = 1;
  for (let k = 1; k < 30; k++) { t *= (x / (2 * k)) * (x / (2 * k)); s += t; }
  return s;
}

const KERNEL = (() => {
  const k = new Float32Array((PHASES + 1) * TAPS);
  const i0b = bessel0(BETA);
  for (let p = 0; p <= PHASES; p++) {
    const frac = p / PHASES;
    let sum = 0;
    for (let j = 0; j < TAPS; j++) {
      const x = j - (HALF - 1) - frac; // distance from the interpolation point
      const sinc = x === 0 ? 1 : Math.sin(Math.PI * CUTOFF * x) / (Math.PI * CUTOFF * x);
      const r = x / HALF;
      const win = Math.abs(r) >= 1 ? 0 : bessel0(BETA * Math.sqrt(1 - r * r)) / i0b;
      const w = sinc * win;
      k[p * TAPS + j] = w;
      sum += w;
    }
    for (let j = 0; j < TAPS; j++) k[p * TAPS + j] /= sum;
  }
  return k;
})();

const SCALE = 1 / 32768;
const QUIET = Math.pow(10, -30 / 20);

class Sampler extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = new Map();
    this.voices = [];
    this.pendingOffs = [];
    this.port.onmessage = (e) => this.onMessage(e.data);
  }

  onMessage(m) {
    switch (m.type) {
      case 'sample':
        this.samples.set(m.id, { L: m.L, R: m.R || m.L, len: m.L.length });
        break;
      case 'drop':
        for (const id of m.ids) this.samples.delete(id);
        break;
      case 'on': {
        const s = this.samples.get(m.id);
        if (!s) { this.port.postMessage({ type: 'end', vid: m.vid }); break; }
        this.voices.push({
          vid: m.vid, s, pos: PAD + (m.off || 0), step: m.step, exact: m.step === 1,
          amp: m.gain * SCALE, g: 0, atk: m.gain * SCALE / 96, rc: 1, releasing: false,
          peak: 0, age: 0, quietFor: 0, quiet: false,
          // scheduled start (score playback): wait this many samples before sounding
          wait: m.at ? Math.max(0, Math.round((m.at - currentTime) * sampleRate)) : 0,
        });
        break;
      }
      case 'off': {
        if (m.at && m.at > currentTime) { this.pendingOffs.push(m); break; }
        const rc = Math.exp(-1 / (Math.max(0.005, m.tau) * sampleRate));
        for (const v of this.voices) if (v.vid === m.vid) { v.releasing = true; v.rc = Math.min(v.rc === 1 ? rc : v.rc, rc); }
        break;
      }
      case 'cancel': // drop everything scheduled but not yet sounding
        this.voices = this.voices.filter((v) => { if (v.wait > 0) { this.port.postMessage({ type: 'end', vid: v.vid }); return false; } return true; });
        this.pendingOffs = [];
        break;
      case 'allOff': {
        const rc = Math.exp(-1 / (Math.max(0.005, m.tau) * sampleRate));
        for (const v of this.voices) { v.releasing = true; v.rc = Math.min(v.rc === 1 ? rc : v.rc, rc); }
        break;
      }
    }
  }

  process(_in, outputs) {
    const out = outputs[0];
    const oL = out[0], oR = out[1] || out[0];
    const n = oL.length;
    const K = KERNEL;
    if (this.pendingOffs.length) {
      const until = currentTime + n / sampleRate;
      const due = this.pendingOffs.filter((m) => m.at <= until);
      if (due.length) {
        this.pendingOffs = this.pendingOffs.filter((m) => m.at > until);
        for (const m of due) this.onMessage({ ...m, at: 0 });
      }
    }
    for (let vi = this.voices.length - 1; vi >= 0; vi--) {
      const v = this.voices[vi];
      const { L, R, len } = v.s;
      const last = len - PAD;
      let pos = v.pos, g = v.g;
      const step = v.step, amp = v.amp, atk = v.atk, rc = v.rc, rel = v.releasing;
      let done = false;
      let blockPeak = 0;
      let i0 = 0;
      if (v.wait > 0) {
        if (v.wait >= n) { v.wait -= n; continue; }
        i0 = v.wait;
        v.wait = 0;
      }
      for (let i = i0; i < n; i++) {
        if (rel) g *= rc;
        else if (g < amp) { g += atk; if (g > amp) g = amp; }
        if (pos >= last || (rel && g < amp * 1e-4)) { done = true; break; }
        let l, r;
        if (v.exact) {
          l = L[pos]; r = R[pos];
          pos += 1;
        } else {
          const b = pos | 0;
          const ko = (((pos - b) * PHASES) | 0) * TAPS;
          const o = b - (HALF - 1);
          l = 0; r = 0;
          for (let j = 0; j < TAPS; j++) { const w = K[ko + j]; l += L[o + j] * w; r += R[o + j] * w; }
          pos += step;
        }
        const yl = l * g, yr = r * g;
        oL[i] += yl;
        oR[i] += yr;
        const a = (yl < 0 ? -yl : yl) + (yr < 0 ? -yr : yr);
        if (a > blockPeak) blockPeak = a;
      }
      v.pos = pos; v.g = g;
      // Audibility: once the voice has fallen ~30 dB under its attack peak it
      // reads as finished, even if the sample keeps a faint tail.
      if (!v.quiet && !done) {
        v.age += n;
        if (v.age < sampleRate * 0.15) { if (blockPeak > v.peak) v.peak = blockPeak; }
        else if (blockPeak < v.peak * QUIET) { v.quietFor += n; if (v.quietFor > sampleRate * 0.12) { v.quiet = true; this.port.postMessage({ type: 'quiet', vid: v.vid }); } }
        else v.quietFor = 0;
      }
      if (done) {
        this.voices.splice(vi, 1);
        this.port.postMessage({ type: 'end', vid: v.vid });
      }
    }
    return true;
  }
}

registerProcessor('melofi-sampler', Sampler);
