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
    this.pendingOffs = []; // releases scheduled for later, kept in time order
    this.queue = [];       // voices that start more than a second from now, in start order
    this.qi = 0;
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
      case 'ping': // everything sent before this has been handled (offline renders wait for it)
        this.port.postMessage({ type: 'pong', n: m.n });
        break;
      case 'on': {
        const s = this.samples.get(m.id);
        if (!s) { this.port.postMessage({ type: 'end', vid: m.vid }); break; }
        // optional (studio): attack seconds, loop [start, end) frames, pan -1..1
        const pan = m.pan || 0;
        const v = {
          vid: m.vid, s, pos: PAD + (m.off || 0), step: m.step, exact: m.step === 1,
          amp: m.gain * SCALE, g: 0, atk: m.gain * SCALE / (m.attack ? Math.max(96, m.attack * sampleRate) : 96), rc: 1, releasing: false,
          ls: m.loop ? PAD + m.loop[0] : 0, le: m.loop ? PAD + m.loop[1] : 0,
          pl: pan ? Math.cos((pan + 1) * Math.PI / 4) * Math.SQRT2 : 1, pr: pan ? Math.sin((pan + 1) * Math.PI / 4) * Math.SQRT2 : 1,
          bendTo: 0, bendInc: 0,
          peak: 0, age: 0, quietFor: 0, quiet: false,
          // scheduled start (score playback / video rendering): sample frame to start on
          start: m.at ? Math.round(m.at * sampleRate) : currentFrame, wait: 0,
        };
        if (v.start - currentFrame > sampleRate) {
          // far ahead (a whole score handed over at once): park it so it costs nothing until due
          const q = this.queue;
          if (q.length > this.qi && q[q.length - 1].start > v.start) { q.push(v); this.sortQueue = true; } else q.push(v);
        } else {
          v.wait = Math.max(0, v.start - currentFrame);
          this.voices.push(v);
        }
        break;
      }
      case 'off': {
        if (m.at && m.at > currentTime) {
          const po = this.pendingOffs;
          if (po.length && po[po.length - 1].at > m.at) { po.push(m); po.sort((a, b) => a.at - b.at); } else po.push(m);
          break;
        }
        const rc = Math.exp(-1 / (Math.max(0.005, m.tau) * sampleRate));
        for (const v of this.voices) if (v.vid === m.vid) { v.releasing = true; v.rc = Math.min(v.rc === 1 ? rc : v.rc, rc); }
        break;
      }
      case 'bend': { // glide a voice to a new pitch over `time` seconds
        if (m.at && m.at > currentTime) {
          const po = this.pendingOffs;
          if (po.length && po[po.length - 1].at > m.at) { po.push(m); po.sort((a, b) => a.at - b.at); } else po.push(m);
          break;
        }
        for (const v of this.voices) if (v.vid === m.vid) {
          const n = Math.max(1, m.time * sampleRate);
          v.exact = false; v.bendTo = m.step; v.bendInc = (m.step - v.step) / n;
        }
        break;
      }
      case 'cancel': // drop everything scheduled but not yet sounding
        this.voices = this.voices.filter((v) => { if (v.wait > 0) { this.port.postMessage({ type: 'end', vid: v.vid }); return false; } return true; });
        for (let i = this.qi; i < this.queue.length; i++) this.port.postMessage({ type: 'end', vid: this.queue[i].vid });
        this.queue = []; this.qi = 0;
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
    // parked voices that start within the next few blocks
    if (this.sortQueue) { const rest = this.queue.slice(this.qi).sort((a, b) => a.start - b.start); this.queue = rest; this.qi = 0; this.sortQueue = false; }
    while (this.qi < this.queue.length && this.queue[this.qi].start - currentFrame < n * 4) {
      const v = this.queue[this.qi++];
      v.wait = Math.max(0, v.start - currentFrame);
      this.voices.push(v);
    }
    if (this.qi > 4096) { this.queue = this.queue.slice(this.qi); this.qi = 0; }
    if (this.pendingOffs.length) {
      const until = currentTime + n / sampleRate;
      let k = 0;
      while (k < this.pendingOffs.length && this.pendingOffs[k].at <= until) k++;
      if (k) {
        const due = this.pendingOffs.splice(0, k);
        for (const m of due) this.onMessage({ ...m, at: 0 });
      }
    }
    for (let vi = this.voices.length - 1; vi >= 0; vi--) {
      const v = this.voices[vi];
      const { L, R, len } = v.s;
      const last = len - PAD;
      let pos = v.pos, g = v.g;
      let step = v.step;
      const amp = v.amp, atk = v.atk, rc = v.rc, rel = v.releasing, le = v.le, pl = v.pl, pr = v.pr;
      let binc = v.bendInc;
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
          if (binc) { step += binc; if ((binc > 0 && step >= v.bendTo) || (binc < 0 && step <= v.bendTo)) { step = v.bendTo; v.bendInc = 0; binc = 0; } }
        }
        if (le && pos >= le && !rel) pos -= le - v.ls;
        const yl = l * g * pl, yr = r * g * pr;
        oL[i] += yl;
        oR[i] += yr;
        const a = (yl < 0 ? -yl : yl) + (yr < 0 ? -yr : yr);
        if (a > blockPeak) blockPeak = a;
      }
      v.pos = pos; v.g = g; v.step = step;
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
