// MeloFi Synth — the wavetable oscillator (one voice of one oscillator). Band-limited: the tables come
// as mipmaps (one per octave of harmonics, built by wavetable.js buildMips) and the voice crossfades the
// two that fit its pitch, so nothing folds back into the audible range. Table position morphs between
// neighbouring frames per sample. A new table (the user editing while notes sound) fades in over ~20 ms.
//
// Parameters: frequency (Hz), detune (cents), position (0..1), run (1 from the start time, 0 at the stop
// time: the node then ends). Tables are shared by every voice in the audio context: the first node that
// uses a table brings it (processorOptions.table), the rest name it by id.

// see wavetable.js (mipmaps): level L holds floor(1024 / 2^(L/2)) harmonics; harmonics may reach FOLD Hz, so
// anything above Nyquist folds back above 18 kHz
const LEVELS = 21, FOLD = Math.max(sampleRate * 0.45, sampleRate - 18000);
const TABLES = globalThis.__melofiWT || (globalThis.__melofiWT = new Map());
const XFADE = 1024;

class WavetableVoice extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'frequency', defaultValue: 440, minValue: -24000, maxValue: 24000, automationRate: 'a-rate' },
      { name: 'detune', defaultValue: 0, minValue: -153600, maxValue: 153600, automationRate: 'a-rate' },
      { name: 'position', defaultValue: 0, minValue: -4, maxValue: 4, automationRate: 'a-rate' },
      { name: 'run', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'a-rate' },
    ];
  }

  constructor(opts) {
    super();
    const o = opts.processorOptions || {};
    if (o.table) TABLES.set(o.id, o.table);
    this.id = o.id;
    this.phase = o.phase || 0;
    this.started = false;
    this.done = false;
    this.prev = null; this.fade = 0;   // table being faded out
    this.pending = null;
    this.port.onmessage = (e) => {
      const m = e.data || {};
      if (m.table) TABLES.set(m.id, m.table);
      if (m.swap && m.swap !== this.id) this.pending = m.swap;
      if (m.drop) TABLES.delete(m.drop);
    };
  }

  // one sample of table T at phase p (0..1), position pos (0..1), mip levels L0 (weight w0) and L0+1
  static read(T, p, pos, L0, w0) {
    const nf = T.frames, fpos = Math.min(nf - 1, Math.max(0, pos * (nf - 1)));
    const f0 = Math.floor(fpos), f1 = Math.min(nf - 1, f0 + 1), fw = fpos - f0;
    let out = 0;
    for (let lv = 0; lv < 2; lv++) {
      const L = Math.min(LEVELS - 1, L0 + lv), w = lv ? 1 - w0 : w0;
      if (w <= 0) continue;
      const n = T.sizes[L], x = p * n, i = Math.floor(x), t = x - i;
      let s = 0;
      for (let fi = 0; fi < 2; fi++) {
        const fwt = fi ? fw : 1 - fw;
        if (fwt <= 0) continue;
        const d = T.data, b = T.off[(fi ? f1 : f0) * LEVELS + L] + i;
        const y0 = d[b - 1], y1 = d[b], y2 = d[b + 1], y3 = d[b + 2];
        // 4-point Hermite
        const c1 = 0.5 * (y2 - y0), c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3, c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
        s += fwt * (((c3 * t + c2) * t + c1) * t + y1);
      }
      out += w * s;
    }
    return out;
  }

  process(_in, outputs, P) {
    const out = outputs[0][0];
    if (!out) return !this.done;
    if (this.pending && TABLES.has(this.pending)) { this.prev = this.id; this.id = this.pending; this.pending = null; this.fade = XFADE; }
    const T = TABLES.get(this.id), Tp = this.prev ? TABLES.get(this.prev) : null;
    if (!T) { out.fill(0); return true; }
    const fr = P.frequency, dt = P.detune, ps = P.position, run = P.run;
    const nyq = sampleRate / 2;
    // mip levels for this block's pitch: maxH = FOLD / f; level L fits when 1024 / 2^(L/2) <= maxH
    const f0 = Math.abs(fr[0] * Math.pow(2, dt[0] / 1200)) || 1;
    const hMax = Math.max(1, Math.min(1024, FOLD / f0));
    const Lf = 2 * (10 - Math.log2(hMax)); // fractional level (0 = all harmonics)
    // level Lc = ceil(Lf) is the richest that stays under FOLD; it fades into Lc + 1 as the pitch rises to
    // the next limit, so crossing an octave never switches tables abruptly
    const Lc = Math.max(0, Math.min(LEVELS - 1, Math.ceil(Lf)));
    const L0 = Lc, w0 = Math.min(1, Math.max(0, Lc - Lf));
    const silent = f0 >= nyq;
    for (let i = 0; i < out.length; i++) {
      const r = run.length > 1 ? run[i] : run[0];
      if (!this.started) { if (r < 0.5) { out[i] = 0; continue; } this.started = true; }
      else if (r < 0.5) { out.fill(0, i); this.done = true; this.port.postMessage('ended'); return false; }
      const f = (fr.length > 1 ? fr[i] : fr[0]) * Math.pow(2, (dt.length > 1 ? dt[i] : dt[0]) / 1200);
      const pos = ps.length > 1 ? ps[i] : ps[0];
      let y = silent ? 0 : WavetableVoice.read(T, this.phase, pos, L0, w0);
      if (this.fade > 0 && Tp) { const k = this.fade / XFADE; y = y * (1 - k) + k * WavetableVoice.read(Tp, this.phase, pos, L0, w0); this.fade--; if (!this.fade) this.prev = null; }
      out[i] = y;
      let ph = this.phase + f / sampleRate;
      ph -= Math.floor(ph);
      this.phase = ph;
    }
    for (let c = 1; c < outputs[0].length; c++) outputs[0][c].set(out);
    return true;
  }
}

registerProcessor('melofi-wavetable', WavetableVoice);
