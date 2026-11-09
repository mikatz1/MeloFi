// Audio graph + instrument loading. Voices run in sampler-worklet.js.
//
//  sampler ─ input ─ bass ─ treble ─┬─ dry ───────────────────────────┐
//                                   ├─ hp ─ hall ─ wet ───────────────┤
//                                   └─ resonance ─ pedal gate ─ level ┴─ master ─ limiter ─ out
import { buildResonance } from './resonance.js';

const BASE = 'melofi://app/instruments/';
const PAD = 17; // must match PAD in sampler-worklet.js (TAPS / 2 + 1)
const MAX_VOICES = 80;

// Reverb spaces: tail length, how fast highs die, pre-delay, early reflection spread.
export const ROOMS = {
  room: { seconds: 1.3, decay: 3.4, dark: 0.55, pre: 0.006, taps: [0.009, 0.014, 0.021, 0.029] },
  hall: { seconds: 2.8, decay: 1.5, dark: 0.8, pre: 0.015, taps: [0.015, 0.027, 0.043, 0.073] },
  church: { seconds: 5.0, decay: 0.75, dark: 0.88, pre: 0.028, taps: [0.031, 0.047, 0.071, 0.097] },
};

function makeImpulse(ctx, kind = 'hall') {
  // Synthetic space: sparse early reflections, then a darkening exponential tail.
  const R = ROOMS[kind] || ROOMS.hall;
  const rate = ctx.sampleRate;
  const len = Math.floor(R.seconds * rate);
  const buf = ctx.createBuffer(2, len, rate);
  const pre = Math.floor(R.pre * rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / rate;
      const env = Math.pow(1 - i / len, 2) * Math.exp(-t * R.decay);
      // one-pole low-pass that closes as the tail decays; k must stay below 1 or the filter blows up
      const k = Math.min(0.96, 0.15 + R.dark * Math.min(1, t / R.seconds));
      lp += (Math.random() * 2 - 1 - lp) * (1 - k);
      d[i] = lp * env * (t < 0.015 ? t / 0.015 : 1);
    }
    const taps = ch ? R.taps.map((x) => x * 1.17) : R.taps;
    taps.forEach((tt, j) => { d[Math.floor(tt * rate)] += (0.35 - j * 0.06) * (j % 2 ? -1 : 1); });
  }
  return buf;
}

// Resonance IR at unit gain sits ~25 dB over the dry signal; this puts the
// default (resonance = 0.5) about 20 dB under it.
const RES_UNITY = Math.pow(10, -45 / 20) * 2;

function toInt16(src, out) {
  // TPDF dither; noise floor sits ~96 dB down.
  for (let i = 0; i < src.length; i++) {
    let v = src[i] * 32767 + (Math.random() - Math.random());
    v = v > 32767 ? 32767 : v < -32768 ? -32768 : v;
    out[i + PAD] = Math.round(v);
  }
  return out;
}

export class Engine {
  constructor(ctx = null) {
    this.ctx = ctx || new AudioContext({ latencyHint: 'interactive' });
    this.offline = typeof OfflineAudioContext !== 'undefined' && this.ctx instanceof OfflineAudioContext;
    const c = this.ctx;

    this.input = c.createGain();
    this.bass = c.createBiquadFilter();
    this.bass.type = 'lowshelf';
    this.bass.frequency.value = 180;
    this.bass.gain.value = 0;
    this.tone = c.createBiquadFilter();
    this.tone.type = 'highshelf';
    this.tone.frequency.value = 3500;
    this.tone.gain.value = 0;

    this.dry = c.createGain();
    this.verbHp = c.createBiquadFilter();
    this.verbHp.type = 'highpass';
    this.verbHp.frequency.value = 180;
    this.conv = c.createConvolver();
    this.room = 'hall';
    this.conv.buffer = makeImpulse(c, this.room);
    this.wet = c.createGain();

    this.res = c.createConvolver();
    this.res.normalize = false;
    const [rl, rr] = buildResonance(c.sampleRate, 3);
    const rb = c.createBuffer(2, rl.length, c.sampleRate);
    rb.copyToChannel(rl, 0);
    rb.copyToChannel(rr, 1);
    this.res.buffer = rb;
    this.resGate = c.createGain();
    this.resGate.gain.value = 0;
    this.resLevel = c.createGain();
    this.resAmount = 0.5;
    this.resEnabled = true;

    this.master = c.createGain();
    // Safety limiter only: levels are set so it rarely engages.
    this.limiter = c.createDynamicsCompressor();
    this.limiter.threshold.value = -1.5;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.001;
    this.limiter.release.value = 0.12;
    this.out = c.createGain();

    this.input.connect(this.bass).connect(this.tone);
    this.tone.connect(this.dry).connect(this.master);
    this.tone.connect(this.verbHp).connect(this.conv).connect(this.wet).connect(this.master);
    this.tone.connect(this.res).connect(this.resGate).connect(this.resLevel).connect(this.master);
    this.master.connect(this.limiter).connect(this.out).connect(c.destination);

    // live only: the stream MediaRecorder records from
    if (!this.offline) {
      this.stream = c.createMediaStreamDestination();
      this.out.connect(this.stream);
    }

    // output meters
    const split = c.createChannelSplitter(2);
    this.out.connect(split);
    this.meters = [0, 1].map((i) => {
      const a = c.createAnalyser();
      a.fftSize = 1024;
      split.connect(a, i);
      return a;
    });
    this.meterBuf = new Float32Array(1024);
    this.setResonance(0.5);

    this.inst = null;
    this.loaded = new Set();
    this.voices = new Map();
    this.onSoundEnd = () => {}; // (note) when a note stops ringing: released without pedal, pedal up, or sample end
    this.nextVid = 1;
    this.sustain = false;
    this.loadToken = 0;
    this.decoders = new Map();
    this.tap = null;
  }

  async init() {
    await this.ctx.audioWorklet.addModule('melofi://app/renderer/js/sampler-worklet.js');
    this.node = new AudioWorkletNode(this.ctx, 'melofi-sampler', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
    this.node.connect(this.input);
    this.node.port.onmessage = (e) => {
      if (e.data.type === 'quiet') {
        const v = this.voices.get(e.data.vid);
        if (v && !v.ending && !v.quiet) { v.quiet = true; this.soundCheck(v.note); }
        return;
      }
      if (e.data.type !== 'end') return;
      const v = this.voices.get(e.data.vid);
      this.voices.delete(e.data.vid);
      if (v && !v.ending && !v.quiet) this.soundCheck(v.note); // sample ran out while still sounding
    };
  }

  setVolume(v) { this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02); }
  setReverb(v) {
    this.reverbLevel = v * 0.8;
    this.wet.gain.setTargetAtTime(this.reverbLevel, this.ctx.currentTime, 0.05);
    this.dry.gain.setTargetAtTime(1 - v * 0.3, this.ctx.currentTime, 0.05);
  }
  setBrightness(db) { this.tone.gain.setTargetAtTime(db, this.ctx.currentTime, 0.05); }
  setBass(db) { this.bass.gain.setTargetAtTime(db, this.ctx.currentTime, 0.05); }
  setRoom(kind) {
    if (kind === this.room) return;
    if (this.offline) { this.room = kind; this.conv.buffer = makeImpulse(this.ctx, kind); return; }
    this.room = kind;
    // a ConvolverNode can't swap its buffer without a click: fade the wet path out, swap, fade back
    const t = this.ctx.currentTime;
    const g = this.wet.gain;
    const target = g.value;
    g.cancelScheduledValues(t);
    g.setValueAtTime(target, t);
    g.linearRampToValueAtTime(0, t + 0.04);
    const buf = makeImpulse(this.ctx, kind);
    setTimeout(() => {
      this.conv.buffer = buf;
      const t2 = this.ctx.currentTime;
      g.cancelScheduledValues(t2);
      g.setValueAtTime(0, t2);
      g.linearRampToValueAtTime(this.reverbLevel ?? target, t2 + 0.15);
    }, 60);
  }
  setResonance(amount) {
    this.resAmount = amount;
    const v = this.resEnabled ? amount * amount * RES_UNITY * 2 : 0; // squared: finer control at the quiet end
    this.resLevel.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  // Peak and RMS per channel in dBFS, for the mixer meters.
  levels() {
    return this.meters.map((a) => {
      a.getFloatTimeDomainData(this.meterBuf);
      let pk = 0, e = 0;
      for (const x of this.meterBuf) { const ax = Math.abs(x); if (ax > pk) pk = ax; e += x * x; }
      const db = (v) => (v > 1e-6 ? 20 * Math.log10(v) : -120);
      return { peak: db(pk), rms: db(Math.sqrt(e / this.meterBuf.length)) };
    });
  }

  decoder(rate, ch) {
    const k = `${rate}/${ch}`;
    if (!this.decoders.has(k)) this.decoders.set(k, new OfflineAudioContext({ numberOfChannels: ch, length: 1, sampleRate: rate }));
    return this.decoders.get(k);
  }

  // Loads instrument `id` with the velocity layers that cover [vlo, vhi].
  // Only those layers sit in memory; everything else stays on disk.
  async load(id, vlo, vhi, onProgress = () => {}, { budgetMB = 0 } = {}) {
    const token = ++this.loadToken;
    let m = this.inst?.id === id ? this.inst.manifest : null;
    if (!m) {
      const res = await fetch(`${BASE}${id}/manifest.json`);
      if (!res.ok) throw new Error(`manifest ${id}: ${res.status}`);
      m = await res.json();
    }
    const switching = this.inst?.id !== id;
    let regs = m.regions.filter((r) => r.hv >= vlo && r.lv <= vhi);
    if (budgetMB) {
      // keep as many velocity layers as fit the memory budget, spread evenly
      const bands = [...new Set(regs.map((r) => r.lv))].sort((a, b) => a - b);
      const bytes = (list) => [...new Set(list.map((r) => r.s))].reduce((t, s) => { const x = m.samples[s]; return t + x.dur * x.rate * x.ch * 2; }, 0);
      for (let n = bands.length; n >= 1; n--) {
        const pick = new Set(n === 1 ? [bands[Math.floor(bands.length / 2)]] : Array.from({ length: n }, (_, i) => bands[Math.round((i * (bands.length - 1)) / (n - 1))]));
        const sel = regs.filter((r) => pick.has(r.lv));
        if (n === 1 || bytes(sel) <= budgetMB * 1e6) { regs = sel; break; }
      }
    }
    const want = new Set(regs.map((r) => r.s));
    const have = switching ? new Set() : this.loaded;
    const todo = [...want].filter((s) => !have.has(s));

    let done = 0, i = 0;
    const fresh = new Set();
    const worker = async () => {
      while (i < todo.length) {
        const s = todo[i++];
        const meta = m.samples[s];
        const ab = await (await fetch(`${BASE}${id}/${s}`)).arrayBuffer();
        if (token !== this.loadToken) return;
        const buf = await this.decoder(meta.rate, meta.ch).decodeAudioData(ab);
        if (token !== this.loadToken) return;
        const n = buf.length + PAD * 2;
        const L = toInt16(buf.getChannelData(0), new Int16Array(n));
        const R = buf.numberOfChannels > 1 ? toInt16(buf.getChannelData(1), new Int16Array(n)) : null;
        const key = `${id}:${s}`;
        this.node.port.postMessage({ type: 'sample', id: key, L, R }, R ? [L.buffer, R.buffer] : [L.buffer]);
        fresh.add(s);
        onProgress(++done / todo.length);
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    if (token !== this.loadToken) return false;

    if (switching) {
      this.allOff(0.05);
      if (this.inst) this.node.port.postMessage({ type: 'drop', ids: [...this.loaded].map((s) => `${this.inst.id}:${s}`) });
      this.loaded = fresh;
      const byKey = Array.from({ length: 128 }, () => []);
      for (const r of m.regions) for (let k = Math.max(0, r.lo); k <= Math.min(127, r.hi); k++) byKey[k].push(r);
      for (const list of byKey) list.sort((a, b) => a.lv - b.lv);
      this.inst = { id, manifest: m, byKey };
      this.resEnabled = m.strings !== false; // e-pianos have no strings to resonate
      this.setResonance(this.resAmount);
    } else {
      for (const s of fresh) this.loaded.add(s);
      const drop = [...this.loaded].filter((s) => !want.has(s));
      // let ringing notes finish before their samples go away
      if (drop.length) setTimeout(() => {
        if (this.inst?.id !== id) return;
        const still = drop.filter((s) => !this.wantNow?.has(s));
        this.node.port.postMessage({ type: 'drop', ids: still.map((s) => `${id}:${s}`) });
        for (const s of still) this.loaded.delete(s);
      }, 20000);
    }
    this.wantNow = want;
    return true;
  }

  region(note, vel) {
    const list = this.inst?.byKey[note];
    if (!list || !list.length) return null;
    const usable = list.filter((r) => this.loaded.has(r.s));
    if (!usable.length) return null;
    return usable.find((r) => vel >= r.lv && vel <= r.hv)
      || usable.reduce((best, r) => (Math.abs((r.lv + r.hv) / 2 - vel) < Math.abs((best.lv + best.hv) / 2 - vel) ? r : best));
  }

  // `at` (AudioContext time) schedules the note sample-accurately; omit to play now.
  // Returns the voice id, or null when nothing could be played.
  noteOn(note, vel, at = 0) {
    const r = this.region(note, vel);
    if (!r) return null;
    const meta = this.inst.manifest.samples[r.s];

    for (const [vid, v] of this.voices) if (v.note === note && !v.ending) this.release(vid, v, 0.05, at);

    const x = vel / 127;
    const gain = this.inst.manifest.gain * r.g * (0.45 + 0.55 * x * x);
    const step = Math.pow(2, (note - r.c) / 12 + r.t / 1200) * (meta.rate / this.ctx.sampleRate);
    const vid = this.nextVid++;
    this.voices.set(vid, { note, held: true, ending: false, rel: r.r });
    this.node.port.postMessage({ type: 'on', vid, id: `${this.inst.id}:${r.s}`, step, gain, off: r.off, at });

    if (this.voices.size > MAX_VOICES && !this.offline) { // (a rendered score hands over every note at once)
      let victim = null;
      for (const [id, v] of this.voices) { if (v.ending) { victim = id; break; } }
      if (victim == null) for (const [id, v] of this.voices) { if (!v.held) { victim = id; break; } }
      if (victim == null) victim = this.voices.keys().next().value;
      this.release(victim, this.voices.get(victim), 0.02);
    }
    return vid;
  }

  // Key-up for one particular voice (score playback releases exactly what it started).
  releaseVoice(vid, at = 0) {
    const v = this.voices.get(vid);
    if (!v || !v.held) return;
    v.held = false;
    if (!this.sustain && !v.sost) this.release(vid, v, v.rel / 4.5, at);
  }

  // Forget everything that was scheduled but hasn't started yet.
  cancelScheduled() {
    this.node.port.postMessage({ type: 'cancel' });
  }

  // Is this note still ringing (held, or carried by the pedal)?
  isSounding(note) {
    for (const v of this.voices.values()) if (v.note === note && !v.ending && !v.quiet) return true;
    return false;
  }

  soundCheck(note) {
    if (!this.isSounding(note)) this.onSoundEnd(note);
  }

  release(vid, v, tau, at = 0) {
    if (!v) return;
    const was = v.ending;
    v.ending = true;
    v.held = false;
    this.node.port.postMessage({ type: 'off', vid, tau, at });
    if (was) return;
    const wait = at ? (at - this.ctx.currentTime) * 1000 : 0;
    if (wait > 1) setTimeout(() => this.soundCheck(v.note), wait); else this.soundCheck(v.note);
  }

  noteOff(note) {
    for (const [vid, v] of this.voices) {
      if (v.note !== note || !v.held) continue;
      v.held = false;
      if (!this.sustain && !v.sost) this.release(vid, v, v.rel / 4.5);
    }
  }

  // Sostenuto (middle pedal): only the notes held at the moment it goes down keep ringing.
  setSostenuto(on) {
    if (on) { for (const v of this.voices.values()) if (v.held && !v.ending) v.sost = true; return; }
    for (const [vid, v] of this.voices) {
      if (!v.sost) continue;
      v.sost = false;
      if (!v.held && !v.ending && !this.sustain) this.release(vid, v, v.rel / 4.5);
    }
  }

  setSustain(on) {
    this.sustain = on;
    // dampers lift fast and fall back a little slower
    this.resGate.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, on ? 0.03 : 0.09);
    if (on) return;
    for (const [vid, v] of this.voices) if (!v.held && !v.ending && !v.sost) this.release(vid, v, v.rel / 4.5);
  }

  allOff(tau = 0.08) {
    this.sustain = false;
    this.resGate.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    const notes = new Set();
    for (const v of this.voices.values()) { if (!v.ending) notes.add(v.note); v.ending = true; v.held = false; }
    this.node?.port.postMessage({ type: 'allOff', tau });
    for (const n of notes) this.onSoundEnd(n);
  }

  // Raw PCM capture for WAV/MP3.
  async startCapture() {
    if (!this.tap) {
      await this.ctx.audioWorklet.addModule('melofi://app/renderer/js/pcm-tap.js');
      this.tap = new AudioWorkletNode(this.ctx, 'pcm-tap', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 2, channelCountMode: 'explicit' });
      this.out.connect(this.tap);
    }
    const chunks = [[], []];
    this.tap.port.onmessage = (e) => { chunks[0].push(e.data[0]); chunks[1].push(e.data[1]); };
    this.tap.port.postMessage('start');
    return () => {
      this.tap.port.postMessage('stop');
      return new Promise((res) => setTimeout(() => {
        this.tap.port.onmessage = null;
        const join = (arr) => { const n = arr.reduce((s, a) => s + a.length, 0); const o = new Float32Array(n); let p = 0; for (const a of arr) { o.set(a, p); p += a.length; } return o; };
        res({ left: join(chunks[0]), right: join(chunks[1]), rate: this.ctx.sampleRate });
      }, 80));
    };
  }
}
