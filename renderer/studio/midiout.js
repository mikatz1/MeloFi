// MIDI out to a DAW: studio playback and live playing go to a MIDI output port (for example a
// loopMIDI virtual port that the DAW listens to), each channel on its own MIDI channel, drum kits
// on channel 10. Optional MIDI clock + start / stop so the DAW can follow MeloFi's tempo.
// Notes are timestamped from the audio clock, so they land where the audio would.

export class MidiOut {
  constructor(ctx) {
    this.ctx = ctx;
    this.access = null;
    this.port = null;
    this.portName = '';
    this.clock = false;
    this.chanOf = () => 0;
    this.held = new Map(); // "ch:n" -> count, for live notes
  }

  async init() {
    if (this.access || !navigator.requestMIDIAccess) return;
    try { this.access = await navigator.requestMIDIAccess({ sysex: false }); } catch { return; }
    this.access.onstatechange = () => this.select(this.portName);
  }

  ports() {
    return this.access ? [...this.access.outputs.values()].filter((o) => o.state === 'connected').map((o) => o.name || o.id) : [];
  }

  select(name) {
    this.portName = name || '';
    this.port = null;
    if (!this.access || !name) return;
    for (const o of this.access.outputs.values()) if ((o.name || o.id) === name && o.state === 'connected') this.port = o;
  }

  get active() { return !!this.port; }

  // audio-clock seconds -> performance.now() milliseconds
  stamp(at) {
    const ts = this.ctx.getOutputTimestamp?.();
    if (ts && ts.performanceTime) return ts.performanceTime + (at - ts.contextTime) * 1000;
    return performance.now() + (at - this.ctx.currentTime) * 1000;
  }

  send(bytes, at) {
    if (!this.port) return;
    try { this.port.send(bytes, at == null ? undefined : Math.max(performance.now(), this.stamp(at))); } catch { /* port went away */ }
  }

  note(chId, n, v, at, dur) {
    if (!this.port) return;
    const c = this.chanOf(chId);
    this.send([0x90 | c, n & 127, Math.max(1, Math.min(127, v))], at);
    this.send([0x80 | c, n & 127, 64], at + Math.max(0.01, dur));
  }

  liveOn(chId, n, v) {
    if (!this.port) return;
    const c = this.chanOf(chId);
    this.send([0x90 | c, n & 127, Math.max(1, Math.min(127, v))]);
    const k = `${c}:${n}`;
    this.held.set(k, (this.held.get(k) || 0) + 1);
  }

  liveOff(chId, n) {
    if (!this.port) return;
    const c = this.chanOf(chId), k = `${c}:${n}`;
    if (!this.held.has(k)) return;
    this.held.delete(k);
    this.send([0x80 | c, n & 127, 64]);
  }

  // transport
  start(at, fromTick, ppq) {
    if (!this.port || !this.clock) return;
    const beats16 = Math.round((fromTick / ppq) * 4); // song position in 16th notes
    if (beats16 > 0) { this.send([0xf2, beats16 & 127, (beats16 >> 7) & 127], at); this.send([0xfb], at); } else this.send([0xfa], at);
  }
  tick(at) { if (this.port && this.clock) this.send([0xf8], at); }
  stop() {
    if (!this.port) return;
    if (this.clock) this.send([0xfc]);
    for (let c = 0; c < 16; c++) this.send([0xb0 | c, 123, 0]); // all notes off
    this.held.clear();
  }
}
