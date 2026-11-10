// Safety limiter with no lookahead. The browser's DynamicsCompressorNode always delays its output
// by 6 ms (its fixed lookahead), which every note played live would carry. This one reacts within
// the same sample: when a peak would pass the threshold the gain drops to exactly what keeps it
// at the threshold, then recovers smoothly. Levels are set so it rarely engages at all.
class SafetyLimiter extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: 'threshold', defaultValue: 0.8414, minValue: 0.01, maxValue: 1, automationRate: 'k-rate' }]; // -1.5 dBFS
  }

  constructor() {
    super();
    this.g = 1;
    this.rel = Math.exp(-1 / (0.12 * sampleRate)); // 120 ms recovery
  }

  process(inputs, outputs, params) {
    const inp = inputs[0], out = outputs[0];
    if (!inp || !inp.length) { for (const ch of out) ch.fill(0); return true; }
    const thr = params.threshold[0];
    const n = out[0].length;
    const L = inp[0], R = inp[1] || inp[0];
    const oL = out[0], oR = out[1] || out[0];
    let g = this.g;
    for (let i = 0; i < n; i++) {
      const pk = Math.max(Math.abs(L[i]), Math.abs(R[i]));
      const target = pk > thr ? thr / pk : 1;
      g = target < g ? target : 1 - (1 - g) * this.rel;
      oL[i] = L[i] * g;
      oR[i] = R[i] * g;
    }
    this.g = g;
    return true;
  }
}

registerProcessor('melofi-limiter', SafetyLimiter);
