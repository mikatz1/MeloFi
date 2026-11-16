// Reports the context time a click first arrives (vmic.js measure()).
class VmicProbe extends AudioWorkletProcessor {
  constructor() { super(); this.armed = true; this.quiet = 0; }
  process(inputs) {
    const ch = inputs[0]?.[0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      const v = Math.abs(ch[i]);
      if (this.armed && v > 0.2) { this.armed = false; this.quiet = 0; this.port.postMessage({ time: currentTime + i / sampleRate }); }
      else if (!this.armed) { this.quiet = v < 0.01 ? this.quiet + 1 : 0; if (this.quiet > sampleRate * 0.05) this.armed = true; }
    }
    return true;
  }
}
registerProcessor('melofi-vmic-probe', VmicProbe);
