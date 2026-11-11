// MeloFi Studio — sampler channels (MeloFi instruments, one-shot samples, sliced loops).
import { BASE, PAD, toInt16 } from '../js/audio.js';
import { expand, renderSample } from '../js/synth-gen.js';

// Decoded instruments are shared by every channel (and the offline renderer) that uses them.
const cache = new Map(); // id -> Promise<{ manifest, byKey, data: Map(s -> { L, R }) }>
const decoders = new Map();

function decoder(rate, ch) {
  const k = `${rate}/${ch}`;
  if (!decoders.has(k)) decoders.set(k, new OfflineAudioContext({ numberOfChannels: ch, length: 1, sampleRate: rate }));
  return decoders.get(k);
}

// all velocity layers that fit the budget, spread evenly
function pickRegions(m, budgetMB) {
  let regs = m.regions;
  const bands = [...new Set(regs.map((r) => r.lv))].sort((a, b) => a - b);
  const bytes = (list) => [...new Set(list.map((r) => r.s))].reduce((t, s) => { const x = m.samples[s]; return t + x.dur * x.rate * x.ch * 2; }, 0);
  for (let n = bands.length; n >= 1; n--) {
    const pick = new Set(n === 1 ? [bands[Math.floor(bands.length / 2)]] : Array.from({ length: n }, (_, i) => bands[Math.round((i * (bands.length - 1)) / (n - 1))]));
    const sel = m.regions.filter((r) => pick.has(r.lv));
    if (n === 1 || bytes(sel) <= budgetMB * 1e6) { regs = sel; break; }
  }
  return regs;
}

export function loadInstrument(id, onProgress = () => {}, budgetMB = 260) {
  if (cache.has(id)) return cache.get(id);
  const p = (async () => {
    const res = await fetch(`${BASE}${id}/manifest.json`);
    if (!res.ok) throw new Error(`manifest ${id}: ${res.status}`);
    let m = await res.json();
    if (m.procedural) m = expand(m);
    const regs = pickRegions(m, budgetMB);
    const want = [...new Set(regs.map((r) => r.s))];
    const data = new Map();
    let i = 0, done = 0;
    const worker = async () => {
      while (i < want.length) {
        const s = want[i++], meta = m.samples[s];
        const buf = m.procedural ? await renderSample(m, s) : await decoder(meta.rate, meta.ch).decodeAudioData(await (await fetch(`${BASE}${id}/${s}`)).arrayBuffer());
        const n = buf.length + PAD * 2;
        data.set(s, { L: toInt16(buf.getChannelData(0), new Int16Array(n)), R: buf.numberOfChannels > 1 ? toInt16(buf.getChannelData(1), new Int16Array(n)) : null });
        onProgress(++done / want.length);
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    const byKey = Array.from({ length: 128 }, () => []);
    for (const r of regs) for (let k = Math.max(0, r.lo); k <= Math.min(127, r.hi); k++) byKey[k].push(r);
    for (const list of byKey) list.sort((a, b) => a.lv - b.lv);
    return { id, manifest: m, byKey, data };
  })();
  cache.set(id, p);
  p.catch(() => cache.delete(id));
  return p;
}

let vidSeq = 1;

// Plays a MeloFi instrument, a one-shot sample or a sliced loop through the sinc sampler.
// Its sound goes into `out` (the channel's mixer strip).
export class SamplerChannel {
  constructor(ctx, out) {
    this.ctx = ctx;
    this.node = new AudioWorkletNode(ctx, 'melofi-sampler', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
    this.node.connect(out);
    this.inst = null;
    this.instId = null;
    this.srcKey = null;
    this.last = new Map(); // note -> vid (a key struck again cuts its last voice)
    this.held = new Map(); // live note -> vid
    this.lastVoice = null; // { vid, c, t, rate } for glides
    this.pongs = new Map();
    this.node.port.onmessage = (e) => { if (e.data?.type === 'pong') { this.pongs.get(e.data.n)?.(); this.pongs.delete(e.data.n); } };
  }

  // resolves once the worklet has taken in every message sent so far (samples, scheduled notes)
  ready(timeout = 8000) {
    const n = vidSeq++;
    return new Promise((res) => { const t = setTimeout(res, timeout); this.pongs.set(n, () => { clearTimeout(t); res(); }); this.node.port.postMessage({ type: 'ping', n }); });
  }

  // ch: the project channel. Loads what it plays if that changed.
  async setSource(ch, onProgress) {
    const key = ch.kind === 'sample' || ch.kind === 'slicer' ? JSON.stringify({ k: ch.kind, s: ch.sample, sl: ch.slices }) : `inst:${ch.inst}`;
    if (this.srcKey === key && this.inst) return;
    this.srcKey = key;
    let inst;
    if (ch.kind === 'sample' || ch.kind === 'slicer') {
      if (!ch.sample?.media) return;
      const { sampleInstrument } = await import('./media.js');
      inst = await sampleInstrument({ ...ch.sample, slices: ch.kind === 'slicer' ? ch.slices : null }, this.ctx.sampleRate);
    } else {
      inst = await loadInstrument(ch.inst, onProgress);
    }
    if (this.srcKey !== key) return;
    if (this.inst) this.node.port.postMessage({ type: 'drop', ids: [...this.inst.data.keys()].map((s) => `${this.inst.id}:${s}`) });
    for (const [s, d] of inst.data) this.node.port.postMessage({ type: 'sample', id: `${inst.id}:${s}`, L: d.L, R: d.R });
    this.inst = inst;
    this.instId = ch.inst;
  }

  region(note, vel) {
    const list = this.inst?.byKey[note];
    if (!list || !list.length) return null;
    return list.find((r) => vel >= r.lv && vel <= r.hv)
      || list.reduce((b, r) => (Math.abs((r.lv + r.hv) / 2 - vel) < Math.abs((b.lv + b.hv) / 2 - vel) ? r : b));
  }

  // play a note at `at` (context time); `dur` seconds later it is released. Returns the voice id.
  // opts: { fine (cents), pan (-1..1) }
  noteOn(note, vel, at = 0, dur = null, opts = {}) {
    const r = this.region(note, vel);
    if (!r) return null;
    const m = this.inst.manifest, meta = m.samples[r.s];
    const x = vel / 127;
    const gain = (m.gain ?? 1) * r.g * (0.45 + 0.55 * x * x);
    const rate = meta.rate / this.ctx.sampleRate;
    const step = Math.pow(2, (note - r.c) / 12 + (r.t + (opts.fine || 0)) / 1200) * rate;
    const prev = this.last.get(note);
    if (prev != null) this.node.port.postMessage({ type: 'off', vid: prev, tau: 0.03, at });
    const vid = vidSeq++;
    this.last.set(note, vid);
    this.node.port.postMessage({ type: 'on', vid, id: `${this.inst.id}:${r.s}`, step, gain, off: r.off, at, pan: opts.pan || 0, attack: r.attack || 0, loop: r.loop || null });
    if (dur != null) this.node.port.postMessage({ type: 'off', vid, tau: r.r / 4.5, at: (at || this.ctx.currentTime) + dur });
    this.lastRel = r.r;
    this.lastVoice = { vid, c: r.c, t: r.t, rate, note };
    return vid;
  }

  // slide the last voice to another pitch (FL-style slide notes / 808 glides)
  slideTo(note, at, time) {
    const v = this.lastVoice;
    if (!v) return;
    const step = Math.pow(2, (note - v.c) / 12 + v.t / 1200) * v.rate;
    this.node.port.postMessage({ type: 'bend', vid: v.vid, step, time: Math.max(0.005, time), at });
  }

  noteOff(vid, at = 0) {
    this.node.port.postMessage({ type: 'off', vid, tau: (this.lastRel ?? 0.3) / 4.5, at });
  }

  // live playing (keyboard / MIDI) through this channel
  liveOn(note, vel) { this.liveOff(note); const v = this.noteOn(note, vel); if (v != null) this.held.set(note, v); }
  liveOff(note) { const v = this.held.get(note); if (v != null) { this.noteOff(v); this.held.delete(note); } }

  stop() {
    this.node.port.postMessage({ type: 'cancel' });
    this.node.port.postMessage({ type: 'allOff', tau: 0.04 });
    this.last.clear();
    this.held.clear();
  }

  dispose() {
    this.stop();
    this.node.disconnect();
  }
}
