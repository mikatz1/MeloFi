// MeloFi Studio — a VST3 effect in a mixer insert slot. The strip's sound goes through the plugin in
// the MeloFi VST Host and back (vststream.js), live and in exports.
// fx entry in the project: { id, type: 'vst', on, params: {}, vst: { plugin, file, name, vendor, state } }
// Live slot in the helper: "fx:<strip>:<insert id>". An export loads its own copy of the plugin
// ("off<n>:fx:...") with the live one's current settings, at the export's sample rate.
import { VstStreamNode, sendEvents } from './vststream.js';

const api = () => window.melofi;
let offSeq = 0;

export const vstFxSlot = (stripId, fxId) => `fx:${stripId}:${fxId}`;

export class VstFx {
  // chained: right after a VST instrument on its own channel; the helper runs it with the instrument
  // (one round trip live), so here it is a plain wire
  constructor(engine, stripId, f, { chained = false } = {}) {
    const c = engine.ctx;
    this.engine = engine;
    this.ctx = c;
    this.offline = typeof OfflineAudioContext !== 'undefined' && c instanceof OfflineAudioContext;
    this.liveSlot = vstFxSlot(stripId, f.id);
    this.slot = this.offline ? `off${++offSeq}:${this.liveSlot}` : this.liveSlot;
    this.plugin = f.vst?.plugin || '';
    this.chained = chained && !this.offline;
    this.input = c.createGain();
    this.output = c.createGain();
    if (this.chained) { this.stream = null; this.input.connect(this.output); } else {
      this.stream = new VstStreamNode(c, this.slot, 'fx');
      this.stream.onDelay = () => engine.updateComp?.(); // the compensation follows the stream's delay
      this.input.connect(this.stream.node).connect(this.output);
    }
    this.pluginLatency = 0; // samples, the plugin's own (a look-ahead limiter, say)
    this.error = null;
    this.ready = Promise.all([this.load(f), this.stream?.linked]);
    engine.loading?.add(this.ready);
    this.ready.finally(() => engine.loading?.delete(this.ready));
  }

  // seconds from this insert's input to its output
  get latency() { return ((this.stream?.delay || 0) + this.pluginLatency) / this.ctx.sampleRate; }

  async load(f) {
    const v = f.vst;
    if (!v?.plugin) { this.error = 'no_plugin'; return; }
    let state = v.state || null;
    if (this.offline) {
      // the settings as they are now (they may have changed since the project was saved)
      const r = await api().vstGetState(this.liveSlot);
      if (r.ok) state = r.state;
    }
    const r = await api().vstLoad({ slot: this.slot, plugin: v.plugin, file: v.file, state, rate: this.ctx.sampleRate, effect: true });
    if (!r.ok) { this.error = r.message || r.error; return; }
    this.pluginLatency = r.latency || 0;
    if (this.pluginLatency) this.engine.updateComp?.();
  }

  frame(at) { return Math.max(0, Math.round(at * this.ctx.sampleRate)); }

  // a parameter point (0..1) at `at` seconds; at < 0: now
  setParam(i, v, at, ramp = false) { sendEvents(this.slot, { k: 'p', i, v, f: at < 0 ? -1 : this.frame(at), r: ramp ? 1 : 0 }); }
  paramClear(i, at) { sendEvents(this.slot, { k: 'pc', i, f: this.frame(at) }); }
  tempo(bpm, playing, zero) { sendEvents(this.slot, { k: 'tp', bpm, play: playing ? 1 : 0, zero: this.frame(zero) }); }
  stop() { sendEvents(this.slot, { k: 'all' }); }

  // the strip's parameter interface (a VST insert has no MeloFi knobs of its own)
  set() {}
  param() { return null; }

  dispose() {
    this.stream?.dispose();
    try { this.input.disconnect(); this.output.disconnect(); } catch { /* gone */ }
    api().vstUnload(this.slot);
  }
}
