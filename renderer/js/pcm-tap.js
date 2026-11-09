// AudioWorklet: forwards the master bus as Float32 blocks (~85 ms each) while active.
class PcmTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.on = false;
    this.size = 4096;
    this.l = new Float32Array(this.size);
    this.r = new Float32Array(this.size);
    this.n = 0;
    this.port.onmessage = (e) => {
      if (e.data === 'start') { this.on = true; this.n = 0; }
      else if (e.data === 'stop') { this.flush(); this.on = false; }
    };
  }
  flush() {
    if (!this.n) return;
    this.port.postMessage([this.l.slice(0, this.n), this.r.slice(0, this.n)]);
    this.n = 0;
  }
  process(inputs) {
    if (!this.on) return true;
    const inp = inputs[0];
    const L = inp[0];
    if (!L) return true;
    const R = inp[1] || L;
    for (let i = 0; i < L.length; i++) {
      this.l[this.n] = L[i];
      this.r[this.n] = R[i];
      if (++this.n === this.size) this.flush();
    }
    return true;
  }
}
registerProcessor('pcm-tap', PcmTap);
