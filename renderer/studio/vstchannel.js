// A channel played by a VST3 plugin in the MeloFi VST Host helper.
// Live (the studio's AudioContext): notes go to the helper, which plays them through its own audio
// output, timed to land when the browser's audio would have. The mixer's volume / mute become the
// helper's gain; insert effects apply when the channel is rendered.
// Offline (export, freeze): notes are collected, the helper renders them sample-exact, and the result
// plays through the channel's mixer strip like any other sound.
const api = () => window.melofi;
const live = new Map(); // slot -> plugin id loaded in the helper

export class VstChannel {
  constructor(ctx, out, slot) {
    this.ctx = ctx;
    this.out = out;
    this.slot = slot;
    this.offline = typeof OfflineAudioContext !== 'undefined' && ctx instanceof OfflineAudioContext;
    this.events = [];
    this.timers = new Set();
    this.held = new Map();
    this.latency = 0.03;
  }

  async setSource(ch) {
    const v = ch.vst;
    if (!v?.plugin) return;
    if (live.get(this.slot) === v.plugin) return;
    const r = await api().vstLoad({ slot: this.slot, plugin: v.plugin, file: v.file, state: v.state || null });
    if (r.ok) live.set(this.slot, v.plugin);
    else this.error = r.message || r.error;
    const st = await api().vstStatus();
    if (st.device?.latency) this.latency = st.device.latency;
  }

  setGain(g) { if (!this.offline && live.has(this.slot)) api().vstGain(this.slot, g); }

  noteOn(n, v, at, dur) {
    if (this.offline) {
      this.events.push([at, 0x90, n, Math.max(1, Math.min(127, Math.round(v)))], [at + Math.max(0.01, dur), 0x80, n, 0]);
      return;
    }
    // the browser's output is (outputLatency) late; the helper's is (this.latency) late
    const lag = (this.ctx.outputLatency || this.ctx.baseLatency || 0) - this.latency;
    const at0 = (at - this.ctx.currentTime + lag) * 1000;
    const on = setTimeout(() => { this.timers.delete(on); api().vstNote({ slot: this.slot, on: true, n, v }); }, Math.max(0, at0));
    const off = setTimeout(() => { this.timers.delete(off); api().vstNote({ slot: this.slot, on: false, n }); }, Math.max(0, at0 + dur * 1000));
    this.timers.add(on); this.timers.add(off);
  }

  liveOn(n, v) { this.held.set(n, true); api().vstNote({ slot: this.slot, on: true, n, v }); }
  liveOff(n) { this.held.delete(n); api().vstNote({ slot: this.slot, on: false, n }); }

  stop() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.held.clear();
    if (!this.offline && live.has(this.slot)) api().vstAllOff(this.slot);
  }

  // offline: render what was scheduled and play it through the strip
  async finalize() {
    if (!this.offline || !this.events.length) return;
    const sr = this.ctx.sampleRate;
    const r = await api().vstRender({ slot: this.slot, sr, seconds: this.ctx.length / sr, events: this.events });
    if (!r.ok) throw new Error(`VST 렌더 실패: ${r.message || r.error}`);
    const buf = await this.ctx.decodeAudioData(r.wav.buffer.slice(r.wav.byteOffset, r.wav.byteOffset + r.wav.byteLength));
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.connect(this.out);
    s.start(0);
  }

  dispose() {
    this.stop();
    if (!this.offline && live.has(this.slot)) { api().vstUnload(this.slot); live.delete(this.slot); }
  }
}

// the live helper slot was dropped (channel deleted or plugin changed)
export function forget(slot) { live.delete(slot); }
