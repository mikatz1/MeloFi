// Noise gate for the microphone sent to the virtual mic (vmic.js). Opens fast, holds, then closes
// slowly, so breaths and room noise between phrases are not sent.
class VmicGate extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: 'threshold', defaultValue: -50, minValue: -100, maxValue: 0, automationRate: 'k-rate' }];
  }
  constructor() {
    super();
    this.env = 0;
    this.gain = 0;
    this.hold = 0;
    this.att = 1 - Math.exp(-1 / (0.002 * sampleRate));   // 2 ms open
    this.rel = 1 - Math.exp(-1 / (0.12 * sampleRate));    // 120 ms close
    this.envK = 1 - Math.exp(-1 / (0.005 * sampleRate));  // level follower
    this.holdLen = Math.round(0.15 * sampleRate);
  }
  process(inputs, outputs, params) {
    const inp = inputs[0], out = outputs[0];
    if (!inp.length) return true;
    const th = params.threshold[0];
    const open = th <= -99 ? 0 : 10 ** (th / 20); // -100 = gate off
    const n = inp[0].length;
    for (let i = 0; i < n; i++) {
      let peak = 0;
      for (let c = 0; c < inp.length; c++) { const v = Math.abs(inp[c][i]); if (v > peak) peak = v; }
      this.env += (peak - this.env) * this.envK;
      if (this.env >= open) this.hold = this.holdLen;
      else if (this.hold > 0) this.hold--;
      const want = this.hold > 0 || open === 0 ? 1 : 0;
      this.gain += (want - this.gain) * (want > this.gain ? this.att : this.rel);
      for (let c = 0; c < out.length; c++) out[c][i] = (inp[c] || inp[0])[i] * this.gain;
    }
    return true;
  }
}
registerProcessor('melofi-vmic-gate', VmicGate);
