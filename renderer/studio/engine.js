// MeloFi Studio — audio engine. Every channel and bus has a mixer strip (insert effects, fader,
// pan, reverb send); channels route to the master or a bus; the master has its own inserts and
// a safety limiter. Works on the live AudioContext and on an OfflineAudioContext for export.
import { makeImpulse, safetyLimiter } from '../js/audio.js';
import { SamplerChannel } from './channel.js';
import { SynthChannel } from './synth.js';
import { VstChannel } from './vstchannel.js';
import { Strip } from './strip.js';
import { FX_TYPES, fromNorm, PEAK_FX } from './fx.js';

// what a project channel is played by, inside the engine
class Host {
  constructor(engine, ch) {
    this.engine = engine;
    this.kind = ch.kind || 'inst';
    this.strip = new Strip(engine, ch.id);
    const out = this.strip.input;
    this.src = this.kind === 'synth' ? new SynthChannel(engine.ctx, out) : this.kind === 'vst' ? new VstChannel(engine.ctx, out, ch.id)
      : this.kind === 'audio' ? null : new SamplerChannel(engine.ctx, out);
    this.sources = new Set(); // playing audio clips
  }
  get held() { return this.src?.held || new Map(); }
  noteOn(n, v, at, dur, opts) { return this.src?.noteOn(n, v, at, dur, opts); }
  slideTo(n, at, time) { this.src?.slideTo?.(n, at, time); }
  liveOn(n, v) { this.src?.liveOn(n, v); }
  liveOff(n) { this.src?.liveOff(n); }
  set(ch) { this.strip.set(ch); this.src?.setGain?.(ch.mute ? 0 : (ch.vol ?? 1) ** 2); }
  level() { return this.strip.level(); }
  stop() {
    this.src?.stop();
    const t = this.engine.ctx.currentTime;
    for (const s of this.sources) { try { s.g.gain.cancelScheduledValues(t); s.g.gain.setTargetAtTime(0, t, 0.01); s.node.stop(t + 0.06); } catch { /* ended */ } }
    this.sources.clear();
  }
  dispose() { this.stop(); this.src?.dispose(); this.strip.dispose(); }
}

export class StudioEngine {
  constructor(ctx) {
    this.ctx = ctx;
    const c = ctx;
    this.info = { bpm: 120 };
    this.revIn = c.createGain();
    this.rev = c.createConvolver();
    this.rev.buffer = makeImpulse(c, 'hall');
    this.revOut = c.createGain(); this.revOut.gain.value = 0.9;
    this.masterStrip = new Strip(this, 'master', { send: false, preFader: true });
    this.master = this.masterStrip.fader; // (kept for older callers)
    this.limiter = safetyLimiter(c); // no lookahead: live notes are not delayed
    this.revIn.connect(this.rev).connect(this.revOut).connect(this.masterStrip.input);
    this.masterStrip.routeTo(this.limiter);
    // out: what you hear (the mastering window's A/B and reference switch turn it down)
    this.out = c.createGain();
    this.limiter.connect(this.out).connect(c.destination);
    // mono check: both sides summed to the middle (the meters keep reading the stereo mix)
    this.monoSum = c.createGain(); this.monoSum.channelCount = 1; this.monoSum.channelCountMode = 'explicit'; this.monoSum.channelInterpretation = 'speakers';
    this.mono = false;
    // analysis taps after the limiter: spectrum + K-weighted loudness
    this.spec = c.createAnalyser(); this.spec.fftSize = 8192; this.spec.smoothingTimeConstant = 0.75;
    this.limiter.connect(this.spec);
    const k1 = c.createBiquadFilter(); k1.type = 'highshelf'; k1.frequency.value = 1681; k1.gain.value = 4;
    const k2 = c.createBiquadFilter(); k2.type = 'highpass'; k2.frequency.value = 38; k2.Q.value = 0.5;
    const split = c.createChannelSplitter(2);
    this.kL = c.createAnalyser(); this.kR = c.createAnalyser();
    this.kL.fftSize = this.kR.fftSize = 16384;
    this.limiter.connect(k1).connect(k2).connect(split);
    split.connect(this.kL, 0); split.connect(this.kR, 1);
    this.meterBuf = new Float32Array(512);
    // BS.1770 meter (live only): K-weighted 100 ms blocks, true peak, correlation, scope points
    if (!(c instanceof OfflineAudioContext)) {
      this.meterNode = new AudioWorkletNode(c, 'melofi-meter', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 2, channelCountMode: 'explicit' });
      this.out.connect(this.meterNode);
      this.blockListeners = new Set();
      this.meterNode.port.onmessage = (e) => { for (const f of this.blockListeners) f(e.data); };
    }
    this.channels = new Map(); // channel id -> Host
    this.buses = new Map();    // bus id -> Strip
    this.click = c.createGain(); this.click.gain.value = 0.5; this.click.connect(c.destination);
  }

  static async create(ctx) {
    await ctx.audioWorklet.addModule('melofi://app/renderer/js/sampler-worklet.js');
    await ctx.audioWorklet.addModule('melofi://app/renderer/js/limiter-worklet.js');
    await ctx.audioWorklet.addModule('melofi://app/renderer/js/pitchfix-worklet.js');
    await ctx.audioWorklet.addModule('melofi://app/renderer/js/master-worklet.js');
    return new StudioEngine(ctx);
  }

  strip(id) { return id === 'master' ? this.masterStrip : this.channels.get(id)?.strip || this.buses.get(id) || null; }

  // bring the audio graph in line with the project
  async sync(proj, onProgress = () => {}) {
    this.info.bpm = proj.bpm;
    const at = this.ctx.currentTime;
    // buses first (channels route into them)
    const busIds = new Set(proj.buses.map((b) => b.id));
    for (const [id, s] of this.buses) if (!busIds.has(id)) { s.dispose(); this.buses.delete(id); }
    const pendingSends = []; // sends wired once every bus exists
    for (const b of proj.buses) {
      let s = this.buses.get(b.id);
      if (!s) { s = new Strip(this, b.id); this.buses.set(b.id, s); }
      s.routeTo(this.masterStrip.input);
      s.set({ vol: b.vol, pan: b.pan, send: b.send || 0, mute: b.mute }, at);
      pendingSends.push([s, b.sends]);
      s.setFx(b.fx, at);
    }
    const keep = new Set(proj.channels.map((c) => c.id));
    for (const [id, h] of this.channels) if (!keep.has(id)) { h.dispose(); this.channels.delete(id); }
    const loads = [];
    for (const c of proj.channels) {
      let h = this.channels.get(c.id);
      if (h && h.kind !== (c.kind || 'inst')) { h.dispose(); this.channels.delete(c.id); h = null; }
      if (!h) { h = new Host(this, c); this.channels.set(c.id, h); }
      h.strip.routeTo((c.out && c.out !== 'master' && this.buses.get(c.out)?.input) || this.masterStrip.input);
      h.set(c);
      pendingSends.push([h.strip, c.sends]);
      h.strip.setFx(c.fx, at);
      if (h.kind === 'synth') h.src.setParams(c.synth);
      else if (h.src) loads.push(h.src.setSource(c, (p) => onProgress(c.inst, p)));
    }
    for (const [strip, sends] of pendingSends) strip.setSends(sends, this.buses, at);
    // audio sidechains: feed each one the source strip's sound
    for (const s of [this.masterStrip, ...this.buses.values(), ...[...this.channels.values()].map((h) => h.strip)]) {
      for (const u of s.units) if (u.type === 'sidechain') u.unit.link?.(u.unit.duck.mode === 1 && u.unit.duck.source !== s.id ? this.strip(u.unit.duck.source) : null);
    }
    this.masterStrip.set({ vol: proj.master.vol, pan: 0 }, at);
    this.masterStrip.setFx(proj.master.fx, at);
    // a limiter, maximizer or clipper on the master sets the ceiling itself: the safety limiter
    // (-1.5 dBFS, no lookahead) would otherwise flatten its output again. It then only stops overs.
    const capped = (proj.master.fx || []).some((f) => f.on !== false && PEAK_FX.has(f.type));
    this.limiter.parameters.get('threshold').setValueAtTime(capped ? 1 : 0.8414, at);
    await Promise.all(loads);
  }

  // offline only: sources that render outside the graph (VST plugins) put their audio in now
  async finalize() { await Promise.all([...this.channels.values()].map((h) => h.src?.finalize?.())); }

  // offline only: every sampler has its samples and notes before rendering runs past them
  async settle() { await Promise.all([...this.channels.values()].map((h) => h.src?.ready?.())); }

  // a note on a channel (plus sidechain triggers for anything that follows that channel)
  note(chId, n, v, at, dur, opts) {
    const h = this.channels.get(chId);
    if (!h) return;
    if (opts?.slide) h.slideTo(n, at, dur);
    else if (opts?.porta) {
      // FL portamento: a new note that starts at the previous note's pitch and glides to its own
      const prev = h.src?.lastVoice?.note;
      h.noteOn(prev ?? n, v, at, dur, opts);
      if (prev != null && prev !== n) h.slideTo(n, at, Math.min(dur * 0.5, 0.12));
    } else h.noteOn(n, v, at, dur, opts);
    this.duck(chId, at);
  }

  duck(chId, at) {
    const all = [this.masterStrip, ...this.buses.values(), ...[...this.channels.values()].map((h) => h.strip)];
    for (const s of all) for (const u of s.units) if (u.type === 'sidechain' && u.unit.duck.source === chId) u.unit.trigger(Math.max(at, this.ctx.currentTime));
  }

  // play part of an audio buffer on a channel: offset / dur in seconds of the buffer
  playAudio(chId, buf, at, offset, dur, { gain = 1, fadeIn = 0.003, fadeOut = 0.01 } = {}) {
    const h = this.channels.get(chId);
    if (!h || !buf) return;
    const c = this.ctx;
    const node = c.createBufferSource(); node.buffer = buf;
    const g = c.createGain();
    const t0 = Math.max(at, c.currentTime);
    const skip = t0 - at; // started late: skip into the clip
    const off = offset + skip, len = dur - skip;
    if (len <= 0.002 || off >= buf.duration) return;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + Math.min(Math.max(0.002, fadeIn - skip), len / 2));
    g.gain.setValueAtTime(gain, Math.max(t0 + 0.002, t0 + len - Math.max(0.003, fadeOut)));
    g.gain.linearRampToValueAtTime(0, t0 + len);
    node.connect(g).connect(h.strip.input);
    node.start(t0, off, len + 0.01);
    const rec = { node, g };
    h.sources.add(rec);
    node.onended = () => { h.sources.delete(rec); try { g.disconnect(); } catch { /* gone */ } };
    this.duck(chId, t0);
  }

  // ---------- automation targets ----------
  // target strings: ch:<id>:vol|pan|send  bus:<id>:vol|pan  master:vol  fx:<strip>:<fx>:<param>
  // set(v 0..1, at, ramp): ramp = glide from the previous value to this one, ending at `at`
  target(proj, target) {
    const [kind, id, a, b] = target.split(':');
    if (kind === 'master') return this.paramTarget(this.masterStrip.fader.gain, (v) => v * v);
    if (kind === 'ch' || kind === 'bus') {
      const s = kind === 'ch' ? this.channels.get(id)?.strip : this.buses.get(id);
      if (!s) return null;
      if (a === 'vol') return this.paramTarget(s.fader.gain, (v) => v * v);
      if (a === 'pan') return this.paramTarget(s.panner.pan, (v) => v * 2 - 1);
      if (a === 'send' && s.send) return this.paramTarget(s.send.gain, (v) => v);
      return null;
    }
    if (kind === 'fx') {
      const s = this.strip(id);
      const fxDef = findFx(proj, id, a);
      const u = s?.unit(a);
      if (!u || !fxDef) return null;
      const spec = FX_TYPES[fxDef.type].params.find((p) => p.key === b);
      if (!spec) return null;
      const ap = u.param(b);
      if (ap) return this.paramTarget(ap, (v) => fromNorm(spec, v));
      // non-AudioParam settings (choices): switch at the time (live) / right away (offline)
      return {
        set: (v, at) => {
          const val = fromNorm(spec, v), wait = (at - this.ctx.currentTime) * 1000;
          if (this.ctx instanceof OfflineAudioContext || wait <= 5) u.set({ [b]: val }, at); else setTimeout(() => u.set({ [b]: val }, this.ctx.currentTime), wait);
        },
      };
    }
    return null;
  }

  paramTarget(param, map) {
    return {
      set: (v, at, ramp) => {
        const x = map(v);
        if (ramp) param.linearRampToValueAtTime(x, at); else { param.cancelScheduledValues(at); param.setValueAtTime(x, at); }
      },
      release: (at) => param.cancelScheduledValues(at),
    };
  }

  stopAll() { for (const h of this.channels.values()) h.stop(); }

  // metronome tick at `at` (accent on the first beat of a bar)
  tick(at, accent) {
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.frequency.value = accent ? 1760 : 1175;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(accent ? 0.5 : 0.3, at + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
    o.connect(g).connect(this.click);
    o.start(at); o.stop(at + 0.06);
  }

  setMono(on) {
    if (on === this.mono) return;
    this.mono = on;
    try { this.out.disconnect(this.ctx.destination); } catch { /* not connected */ }
    try { this.monoSum.disconnect(); this.out.disconnect(this.monoSum); } catch { /* not connected */ }
    if (on) this.out.connect(this.monoSum).connect(this.ctx.destination); else this.out.connect(this.ctx.destination);
  }

  level() { return this.masterStrip.level(); }

  // momentary loudness (LUFS, 400 ms window) from the K-weighted taps
  loudness() {
    const n = Math.round(this.ctx.sampleRate * 0.4);
    const buf = this.kbuf && this.kbuf.length === this.kL.fftSize ? this.kbuf : (this.kbuf = new Float32Array(this.kL.fftSize));
    let sum = 0;
    for (const a of [this.kL, this.kR]) {
      a.getFloatTimeDomainData(buf);
      let s = 0;
      const from = Math.max(0, buf.length - n);
      for (let i = from; i < buf.length; i++) s += buf[i] * buf[i];
      sum += s / (buf.length - from);
    }
    return sum > 1e-12 ? -0.691 + 10 * Math.log10(sum) : -70;
  }
}

function findFx(proj, stripId, fxId) {
  const list = stripId === 'master' ? proj.master.fx : (proj.channels.find((c) => c.id === stripId) || proj.buses.find((b) => b.id === stripId))?.fx;
  return list?.find((f) => f.id === fxId) || null;
}
