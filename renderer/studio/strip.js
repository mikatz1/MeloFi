// A mixer strip: input -> insert effects -> fader -> pan -> out (+ reverb send, meter).
// Every channel, bus and the master use one.
import { FX_TYPES, fxDefaults } from './fx.js';

export class Strip {
  constructor(engine, id, { send = true } = {}) {
    const c = engine.ctx;
    this.engine = engine;
    this.id = id;
    this.input = c.createGain();
    this.fader = c.createGain();
    this.panner = c.createStereoPanner();
    this.meter = c.createAnalyser();
    this.meter.fftSize = 512;
    this.meterBuf = new Float32Array(512);
    this.send = send ? c.createGain() : null;
    this.units = []; // [{ id, type, on, unit }]
    this.sig = '';
    this.fader.connect(this.panner);
    this.panner.connect(this.meter);
    if (this.send) { this.send.gain.value = 0; this.panner.connect(this.send).connect(engine.revIn); }
    this.input.connect(this.fader);
    this.dest = null;
  }

  routeTo(node) {
    if (this.dest === node) return;
    if (this.dest) try { this.panner.disconnect(this.dest); } catch { /* not connected */ }
    this.dest = node;
    if (node) this.panner.connect(node);
  }

  // fx: [{ id, type, on, params }] — rebuilt when the chain's shape changes, else parameters only
  setFx(list = [], at = this.engine.ctx.currentTime) {
    const live = list.filter((f) => f.on !== false && FX_TYPES[f.type]);
    const sig = live.map((f) => `${f.id}:${f.type}`).join('|');
    if (sig !== this.sig) {
      this.sig = sig;
      try { this.input.disconnect(); } catch { /* fresh */ }
      for (const u of this.units) u.unit.dispose();
      this.units = live.map((f) => ({ id: f.id, type: f.type, unit: FX_TYPES[f.type].build(this.engine.ctx, this.engine.info) }));
      let node = this.input;
      for (const u of this.units) { node.connect(u.unit.input); node = u.unit.output; }
      node.connect(this.fader);
      for (const u of this.units) u.unit.set({ ...fxDefaults(u.type), ...(live.find((f) => f.id === u.id).params || {}) }, at);
    } else {
      for (const u of this.units) u.unit.set(live.find((f) => f.id === u.id).params || {}, at);
    }
  }

  unit(fxId) { return this.units.find((u) => u.id === fxId)?.unit || null; }

  // vol 0..1 (fader curve: squared), pan -1..1, send 0..1
  set({ vol = 0.8, pan = 0, send = 0, mute = false }, at = this.engine.ctx.currentTime) {
    this.fader.gain.setTargetAtTime(mute ? 0 : vol * vol, at, 0.02);
    this.panner.pan.setTargetAtTime(pan, at, 0.02);
    if (this.send) this.send.gain.setTargetAtTime(send, at, 0.02);
  }

  level() {
    this.meter.getFloatTimeDomainData(this.meterBuf);
    let pk = 0;
    for (const v of this.meterBuf) { const a = Math.abs(v); if (a > pk) pk = a; }
    return pk;
  }

  dispose() {
    for (const u of this.units) u.unit.dispose();
    for (const n of [this.input, this.fader, this.panner, this.meter, this.send]) try { n?.disconnect(); } catch { /* gone */ }
  }
}
