// AudioWorklet: takes an input (mic / line) as Float32 blocks while on. The first message is
// { t0 }: the context time of the first sample taken, exact to the frame, so a take can be lined
// up with what was playing.
class InputTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.on = false;
    this.size = 4096;
    this.l = new Float32Array(this.size);
    this.r = new Float32Array(this.size);
    this.n = 0;
    this.port.onmessage = (e) => {
      if (e.data === 'start') { this.on = true; this.n = 0; this.sent = false; }
      else if (e.data === 'stop') { this.flush(); this.on = false; this.port.postMessage('stopped'); }
    };
  }
  flush() {
    if (!this.n) return;
    this.port.postMessage([this.l.slice(0, this.n), this.r.slice(0, this.n)]);
    this.n = 0;
  }
  process(inputs) {
    if (!this.on) return true;
    const L = inputs[0] && inputs[0][0];
    if (!L) return true;
    if (!this.sent) { this.sent = true; this.port.postMessage({ t0: currentFrame / sampleRate }); }
    const R = inputs[0][1] || L;
    for (let i = 0; i < L.length; i++) {
      this.l[this.n] = L[i];
      this.r[this.n] = R[i];
      if (++this.n === this.size) this.flush();
    }
    return true;
  }
}
registerProcessor('input-tap', InputTap);
