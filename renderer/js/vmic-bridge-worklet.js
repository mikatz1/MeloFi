// Low-latency hop between two AudioContexts for the virtual mic (vmic.js): the sending side posts
// each render quantum straight from its audio thread to the receiving one over a MessagePort; the
// receiver keeps a small FIFO (target frames) and plays from it. A MediaStream between the two
// contexts costs about 20 ms; this keeps a few milliseconds.
//
// The two contexts run on different devices, so their clocks drift a little: the receiver drops
// or repeats a frame now and then to keep its FIFO near the target.

class VmicSend extends AudioWorkletProcessor {
  constructor() {
    super();
    this.out = null;
    this.port.onmessage = (e) => { if (e.data?.port) this.out = e.data.port; };
  }
  process(inputs) {
    const inp = inputs[0];
    if (!this.out || !inp.length) return true;
    const l = inp[0], r = inp[1] || inp[0], n = l.length;
    const buf = new Float32Array(n * 2);
    buf.set(l, 0); buf.set(r, n);
    this.out.postMessage(buf, [buf.buffer]);
    return true;
  }
}

class VmicRecv extends AudioWorkletProcessor {
  constructor(opts) {
    super();
    const o = opts.processorOptions || {};
    // frames kept in hand. The sending context renders in bursts (a 10 ms device buffer = about
    // 480 frames at once), so the FIFO swings by a burst; the target has to ride over that.
    this.target = o.target || 384;
    this.avg = this.target;                   // slow average of the fill: drift is judged on this
    this.cap = 1 << 15;
    this.l = new Float32Array(this.cap);
    this.r = new Float32Array(this.cap);
    this.w = 0; this.rd = 0;                  // write / read positions (frames, not wrapped)
    this.primed = false;
    this.lastL = 0; this.lastR = 0;
    this.under = 0; this.drops = 0; this.repeats = 0;
    this.port.onmessage = (e) => {
      if (e.data?.port) { e.data.port.onmessage = (m) => this.push(m.data); return; }
      if (e.data?.target) this.target = e.data.target;
      if (e.data === 'stats') this.port.postMessage({ fill: this.w - this.rd, avg: Math.round(this.avg), under: this.under, drops: this.drops, repeats: this.repeats, jumps: this.jumps || 0, target: this.target });
    };
  }
  push(buf) {
    const n = buf.length >> 1, cap = this.cap;
    if (this.w - this.rd + n > cap) this.rd = this.w + n - cap; // far too much: forget the oldest
    for (let i = 0; i < n; i++) { const k = (this.w + i) & (cap - 1); this.l[k] = buf[i]; this.r[k] = buf[n + i]; }
    this.w += n;
  }
  process(_in, outputs) {
    const out = outputs[0], L = out[0], R = out[1] || out[0], n = L.length, cap = this.cap;
    let fill = this.w - this.rd;
    // nothing to play: fade the last frame out instead of jumping to zero (no click), then wait
    // for the FIFO to fill to the target again
    const fadeOut = () => {
      for (let i = 0; i < n; i++) { const g = 1 - (i + 1) / n; L[i] = this.lastL * g; R[i] = this.lastR * g; }
      this.lastL = this.lastR = 0;
    };
    if (!this.primed) { if (fill < this.target) { fadeOut(); return true; } this.primed = true; this.avg = fill; }
    if (fill < n) { this.under++; this.primed = false; fadeOut(); return true; }
    // drift between the two devices' clocks: judged on the average fill (bursts even out), fixed one
    // frame at a time, which is not audible; only a large backlog (a stall) is skipped at once.
    // The bursts keep the average about half a burst over the target, so the dead band is a burst
    // wide; real clock drift is tiny (measured under 0.05 %), so one frame per 32 quanta at most.
    this.avg += (fill - this.avg) * 0.002;
    this.since = (this.since || 0) + 1;
    let step = 0;
    // (what piled up while the cable's context was starting, or after a stall: well over a burst)
    if (fill > this.target + 1536 || (this.avg > this.target + 600 && fill > this.target)) {
      this.rd += fill - this.target; this.jumps = (this.jumps || 0) + 1; fill = this.target; this.avg = fill;
    }
    else if (this.since >= 32 && this.avg > this.target + 400) { step = 1; this.since = 0; }
    else if (this.since >= 32 && this.avg < this.target - 64) { step = -1; this.since = 0; }
    let rd = this.rd;
    for (let i = 0; i < n; i++) {
      const k = rd & (cap - 1);
      L[i] = this.l[k]; R[i] = this.r[k];
      rd++;
      if (step === 1 && i === n >> 1) rd++;                  // drop one frame
      else if (step === -1 && i === n >> 1) { rd--; this.repeats++; step = 0; } // repeat one frame
    }
    if (step === 1) this.drops++;
    this.rd = rd;
    this.lastL = L[n - 1]; this.lastR = R[n - 1];
    return true;
  }
}

registerProcessor('melofi-vmic-send', VmicSend);
registerProcessor('melofi-vmic-recv', VmicRecv);
