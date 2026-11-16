// A channel played by a VST3 plugin in the MeloFi VST Host helper.
// Live (the studio's AudioContext): the plugin's sound streams back into this channel's mixer strip
// (vststream.js), so faders, inserts, sends, sidechain and the master all apply. Notes and
// parameter changes go to the helper stamped with the frame they belong to.
// Offline (export, freeze): notes are collected, the helper renders them sample-exact, and the result
// plays through the channel's mixer strip like any other sound.
import { VstStreamNode, sendEvents } from './vststream.js';

const api = () => window.melofi;
const live = new Map(); // slot -> plugin id loaded in the helper

export class VstChannel {
  constructor(ctx, out, slot) {
    this.ctx = ctx;
    this.out = out;
    this.slot = slot;
    this.offline = typeof OfflineAudioContext !== 'undefined' && ctx instanceof OfflineAudioContext;
    this.events = [];
    this.params = []; // offline: [seconds, index, value, ramp]
    this.held = new Map();
    this.latency = 0; // the plugin's own (samples -> seconds)
    if (!this.offline) {
      this.stream = new VstStreamNode(ctx, slot, 'gen');
      this.stream.node.connect(out);
    }
  }

  async setSource(ch) {
    const v = ch.vst;
    if (!v?.plugin) return;
    if (live.get(this.slot) === v.plugin) return;
    const r = await api().vstLoad({ slot: this.slot, plugin: v.plugin, file: v.file, state: v.state || null, rate: this.ctx.sampleRate });
    if (r.ok) { live.set(this.slot, v.plugin); this.error = null; this.latency = (r.latency || 0) / this.ctx.sampleRate; } else this.error = r.message || r.error;
  }

  frame(at) { return Math.max(0, Math.round(at * this.ctx.sampleRate)); }

  // the VST effects the helper runs right after this instrument (live)
  setChain(slots) {
    const key = slots.join('|');
    if (this.offline || key === this.chainKey) return;
    this.chainKey = key;
    api().vstChain(this.slot, slots);
  }

  noteOn(n, v, at, dur) {
    const vel = Math.max(1, Math.min(127, Math.round(v)));
    if (this.offline) {
      this.events.push([at, 0x90, n, vel], [at + Math.max(0.01, dur), 0x80, n, 0]);
      return;
    }
    // the plugin's own latency: start that much earlier
    const t = at - this.latency;
    sendEvents(this.slot, { k: 'on', n, v: vel, f: this.frame(t) }, { k: 'off', n, f: this.frame(t + Math.max(0.01, dur)) });
  }

  liveOn(n, v) { this.held.set(n, true); sendEvents(this.slot, { k: 'on', n, v: Math.max(1, Math.min(127, Math.round(v))) }); }
  liveOff(n) { this.held.delete(n); sendEvents(this.slot, { k: 'off', n }); }

  // a parameter point (0..1) at `at` (ramp: glide to it from the previous point); live: at < 0 = now
  param(i, v, at, ramp = false) {
    if (this.offline) { this.params.push([Math.max(0, at), i, v, ramp ? 1 : 0]); return; }
    sendEvents(this.slot, { k: 'p', i, v, f: at < 0 ? -1 : this.frame(at - this.latency), r: ramp ? 1 : 0 });
  }
  paramClear(i, at) { if (!this.offline) sendEvents(this.slot, { k: 'pc', i, f: this.frame(at - this.latency) }); }

  tempo(bpm, playing, zero) { if (!this.offline) sendEvents(this.slot, { k: 'tp', bpm, play: playing ? 1 : 0, zero: this.frame(zero) }); }

  stop() {
    this.held.clear();
    if (!this.offline && live.has(this.slot)) sendEvents(this.slot, { k: 'all' });
  }

  // offline: render what was scheduled and play it through the strip
  async finalize(info = {}) {
    if (!this.offline || (!this.events.length && !this.params.length)) return;
    const sr = this.ctx.sampleRate;
    const r = await api().vstRender({ slot: this.slot, sr, seconds: this.ctx.length / sr, events: this.events, params: this.params, bpm: info.bpm, zero: info.zero || 0 });
    if (!r.ok) throw new Error(`VST 렌더 실패: ${r.message || r.error}`);
    const buf = await this.ctx.decodeAudioData(r.wav.buffer.slice(r.wav.byteOffset, r.wav.byteOffset + r.wav.byteLength));
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.connect(this.out);
    s.start(0);
  }

  dispose() {
    this.stop();
    this.stream?.dispose();
    if (!this.offline && live.has(this.slot)) { api().vstUnload(this.slot); live.delete(this.slot); }
  }
}

// the live helper slot was dropped (channel deleted or plugin changed)
export function forget(slot) { live.delete(slot); }
// the helper restarted: it reloaded every plugin itself (vsthost.js), nothing to do here; kept so
// callers can drop what they know about a slot after a failed restart
export function forgetAll() { live.clear(); }
