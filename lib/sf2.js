'use strict';
// SoundFont 2 support, shared by the build tool (tools/sf2-preset.mjs) and the app (main.js):
//
//   readSf2(readRange, size)        parse the RIFF structure without touching the sample data
//   presetZones(sf, bank, program)  one flat zone per (preset zone × instrument zone), generators
//                                   resolved the way the SF2 2.04 spec says (instrument values
//                                   absolute, preset values added on top, ranges intersected)
//   planPreset(sf, bank, program)   -> { files, regions }: the sample files to produce and the
//                                   MeloFi regions that play them
//   renderFile(spec, frames)        -> WAV bytes for one planned file, from the raw sample frames
//
// Lossless: a sample that plays as stored is copied bit for bit into a 16-bit (or 24-bit with
// sm24) WAV. Only where the SF2 volume envelope decays a looped sample — which MeloFi's sampler
// doesn't model — is the decay rendered into the file ("baked"), written as 24-bit so the gain
// change adds no audible quantisation.

const GEN = {
  startAddrsOffset: 0, endAddrsOffset: 1, startloopAddrsOffset: 2, endloopAddrsOffset: 3, startAddrsCoarseOffset: 4,
  initialFilterFc: 8, endAddrsCoarseOffset: 12, pan: 17, delayVolEnv: 33, attackVolEnv: 34, holdVolEnv: 35, decayVolEnv: 36,
  sustainVolEnv: 37, releaseVolEnv: 38, keynumToVolEnvHold: 39, keynumToVolEnvDecay: 40, instrument: 41, keyRange: 43,
  velRange: 44, startloopAddrsCoarseOffset: 45, keynum: 46, velocity: 47, initialAttenuation: 48, endloopAddrsCoarseOffset: 50,
  coarseTune: 51, fineTune: 52, sampleID: 53, sampleModes: 54, scaleTuning: 56, exclusiveClass: 57, overridingRootKey: 58,
};
const DEFAULTS = { [GEN.delayVolEnv]: -12000, [GEN.attackVolEnv]: -12000, [GEN.holdVolEnv]: -12000, [GEN.decayVolEnv]: -12000,
  [GEN.releaseVolEnv]: -12000, [GEN.scaleTuning]: 100, [GEN.overridingRootKey]: -1, [GEN.keynum]: -1, [GEN.velocity]: -1, [GEN.initialFilterFc]: 13500 };
// generators that are not additive at preset level (sample addressing, ranges, ids, modes)
const INST_ONLY = new Set([0, 1, 2, 3, 4, 12, 45, 50, 46, 47, 53, 54, 57, 58]);

const tc2s = (tc) => Math.pow(2, tc / 1200);

// ---------------- RIFF / pdta ----------------

function chunkList(buf, start, end) {
  const out = [];
  for (let p = start; p + 8 <= end;) {
    const id = buf.toString('latin1', p, p + 4);
    const size = buf.readUInt32LE(p + 4);
    out.push({ id, off: p + 8, size });
    p += 8 + size + (size & 1);
  }
  return out;
}

// readRange(start, end) -> Buffer (sync or async). Reads only the headers and the pdta list.
async function readSf2(readRange, size) {
  const head = await readRange(0, 12);
  if (head.toString('latin1', 0, 4) !== 'RIFF' || head.toString('latin1', 8, 12) !== 'sfbk') throw new Error('sf2: not a SoundFont');
  const lists = {};
  for (let p = 12; p + 12 <= size;) {
    const h = await readRange(p, p + 12);
    const id = h.toString('latin1', 0, 4), len = h.readUInt32LE(4), type = h.toString('latin1', 8, 12);
    if (id === 'LIST') lists[type] = { off: p + 12, size: len - 4 };
    p += 8 + len + (len & 1);
  }
  if (!lists.sdta || !lists.pdta) throw new Error('sf2: missing sdta/pdta');
  // sdta sub-chunk headers
  let smpl = null, sm24 = null;
  for (let p = lists.sdta.off; p + 8 <= lists.sdta.off + lists.sdta.size;) {
    const h = await readRange(p, p + 8);
    const id = h.toString('latin1', 0, 4), len = h.readUInt32LE(4);
    if (id === 'smpl') smpl = { off: p + 8, size: len };
    if (id === 'sm24') sm24 = { off: p + 8, size: len };
    p += 8 + len + (len & 1);
  }
  if (!smpl) throw new Error('sf2: no sample data');
  const pd = await readRange(lists.pdta.off, lists.pdta.off + lists.pdta.size);
  const ch = Object.fromEntries(chunkList(pd, 0, pd.length).map((c) => [c.id, c]));
  const rec = (id, n) => { const c = ch[id]; if (!c) throw new Error(`sf2: missing ${id}`); return Array.from({ length: c.size / n }, (_, i) => c.off + i * n); };
  const name = (o) => pd.toString('latin1', o, o + 20).replace(/\0.*$/s, '').trim();
  const presets = rec('phdr', 38).map((o) => ({ name: name(o), program: pd.readUInt16LE(o + 20), bank: pd.readUInt16LE(o + 22), bag: pd.readUInt16LE(o + 24) }));
  const pbag = rec('pbag', 4).map((o) => pd.readUInt16LE(o));
  const gens = (id) => rec(id, 4).map((o) => ({ op: pd.readUInt16LE(o), s: pd.readInt16LE(o + 2), lo: pd[o + 2], hi: pd[o + 3] }));
  const pgen = gens('pgen');
  const insts = rec('inst', 22).map((o) => ({ name: name(o), bag: pd.readUInt16LE(o + 20) }));
  const ibag = rec('ibag', 4).map((o) => pd.readUInt16LE(o));
  const igen = gens('igen');
  const samples = rec('shdr', 46).map((o) => ({
    name: name(o), start: pd.readUInt32LE(o + 20), end: pd.readUInt32LE(o + 24), loopStart: pd.readUInt32LE(o + 28),
    loopEnd: pd.readUInt32LE(o + 32), rate: pd.readUInt32LE(o + 36), pitch: pd[o + 40], correction: pd.readInt8(o + 41),
    link: pd.readUInt16LE(o + 42), type: pd.readUInt16LE(o + 44),
  }));
  return { size, smpl, sm24, presets, pbag, pgen, insts, ibag, igen, samples };
}

// zones of a bag range: [{ gens: Map(op -> {s, lo, hi}) }]
function zones(bags, gens, from, to) {
  const out = [];
  for (let b = from; b < to; b++) {
    const g = new Map();
    for (let k = bags[b]; k < bags[b + 1]; k++) g.set(gens[k].op, gens[k]);
    out.push(g);
  }
  return out;
}

function presetZones(sf, bank, program) {
  const pi = sf.presets.findIndex((p) => p.bank === bank && p.program === program);
  if (pi < 0 || pi === sf.presets.length - 1) throw new Error(`sf2: no preset ${bank}:${program}`);
  const pz = zones(sf.pbag, sf.pgen, sf.presets[pi].bag, sf.presets[pi + 1].bag);
  const pglobal = pz.length && !pz[0].has(GEN.instrument) ? pz.shift() : new Map();
  const out = [];
  for (const p of pz) {
    if (!p.has(GEN.instrument)) continue;
    const ii = p.get(GEN.instrument).s;
    const iz = zones(sf.ibag, sf.igen, sf.insts[ii].bag, sf.insts[ii + 1].bag);
    const iglobal = iz.length && !iz[0].has(GEN.sampleID) ? iz.shift() : new Map();
    for (const z of iz) {
      if (!z.has(GEN.sampleID)) continue;
      const v = {};
      const range = (op) => {
        let lo = 0, hi = 127;
        for (const m of [pglobal, p, iglobal, z]) if (m.has(op)) { lo = Math.max(lo, m.get(op).lo); hi = Math.min(hi, m.get(op).hi); }
        return [lo, hi];
      };
      [v.klo, v.khi] = range(GEN.keyRange);
      [v.vlo, v.vhi] = range(GEN.velRange);
      if (v.klo > v.khi || v.vlo > v.vhi) continue;
      const g = (op) => {
        let x = DEFAULTS[op] ?? 0;
        if (iglobal.has(op)) x = iglobal.get(op).s;
        if (z.has(op)) x = z.get(op).s;
        if (!INST_ONLY.has(op)) {
          if (p.has(op)) x += p.get(op).s;
          else if (pglobal.has(op)) x += pglobal.get(op).s;
        }
        return x;
      };
      for (const [k, op] of Object.entries(GEN)) if (k !== 'keyRange' && k !== 'velRange' && k !== 'instrument') v[k] = g(op);
      v.sampleID = z.get(GEN.sampleID).s & 0xFFFF;
      v.instrumentName = sf.insts[ii].name;
      out.push(v);
    }
  }
  return { name: sf.presets[pi].name, zones: out };
}

// ---------------- plan: zones -> files + regions ----------------

const round = (x, d = 4) => +x.toFixed(d);

// Envelope parameters that change the rendered audio (only when they matter).
function envOf(z, sample, rootKey) {
  const sus = Math.max(0, Math.min(1440, z.sustainVolEnv)) / 10; // dB below peak
  if (sus <= 0.5) return null;
  let decay = tc2s(z.decayVolEnv + z.keynumToVolEnvDecay * (60 - rootKey));
  if (decay > 100) return null;
  const hold = z.delayVolEnv > -12000 || z.holdVolEnv > -12000 ? tc2s(z.holdVolEnv + z.keynumToVolEnvHold * (60 - rootKey)) : 0;
  const attack = z.attackVolEnv > -12000 ? tc2s(z.attackVolEnv) : 0;
  return { t0: round(attack + hold), decay: round(decay), sus: round(sus, 2) };
}

function planPreset(sf, bank, program) {
  const { name, zones: zs } = presetZones(sf, bank, program);
  const files = new Map(); // key -> spec
  const regions = [];
  const used = new Set();
  for (const z of zs) {
    const s = sf.samples[z.sampleID];
    if (!s || s.type & 0x8000) continue; // ROM samples
    // stereo: a right sample (type 2) is played with its linked left one from a twin zone
    let pair = null;
    if (s.type === 2 || s.type === 4) {
      const twin = zs.find((o) => o !== z && o.sampleID === s.link && o.klo === z.klo && o.khi === z.khi && o.vlo === z.vlo && o.vhi === z.vhi);
      if (twin) {
        if (used.has(twin)) continue; // already emitted as part of the twin's stereo file
        pair = twin;
      }
    }
    used.add(z);
    const chans = [];
    const addr = (zz, smp) => {
      const st = smp.start + zz.startAddrsOffset + 32768 * zz.startAddrsCoarseOffset;
      const en = smp.end + zz.endAddrsOffset + 32768 * zz.endAddrsCoarseOffset;
      const ls = smp.loopStart + zz.startloopAddrsOffset + 32768 * zz.startloopAddrsCoarseOffset;
      const le = smp.loopEnd + zz.endloopAddrsOffset + 32768 * zz.endloopAddrsCoarseOffset;
      return { st, en, ls, le };
    };
    const a = addr(z, s);
    if (pair) {
      const b = addr(pair, sf.samples[pair.sampleID]);
      const left = s.type === 4 ? a : b, right = s.type === 4 ? b : a;
      const len = Math.min(left.en - left.st, right.en - right.st);
      chans.push([left.st, left.st + len], [right.st, right.st + len]);
      a.en = a.st + len;
    } else chans.push([a.st, a.en]);
    if (a.en - a.st < 8) continue;
    const looped = (z.sampleModes & 1) === 1 && a.le > a.ls + 4 && a.ls >= a.st && a.le <= a.en;
    const rootKey = z.overridingRootKey >= 0 ? z.overridingRootKey : (s.pitch <= 127 ? s.pitch : 60);
    const env = envOf(z, s, rootKey);
    const loop = looped ? [a.ls - a.st, a.le - a.st] : null;
    const key = JSON.stringify([chans, loop, env, s.rate]);
    if (!files.has(key)) files.set(key, { key, name: s.name, rate: s.rate, chans, loop, env, bits: sf.sm24 ? 24 : 16 });
    const tune = z.coarseTune * 100 + z.fineTune + s.correction;
    const gain = Math.pow(10, (-0.4 * Math.max(0, z.initialAttenuation)) / 200); // FluidSynth's EMU-compatible scale
    const release = Math.max(0.05, Math.min(4, 0.4 * tc2s(z.releaseVolEnv)));
    const attack = z.attackVolEnv > -12000 ? tc2s(z.attackVolEnv) : 0;
    const base = { file: key, lv: Math.max(1, z.vlo), hv: z.vhi, tune, gain, release, attack, loop: env ? 'baked' : loop };
    if (z.scaleTuning !== 100) {
      // fixed or partial key tracking (drums, effects): one region per key, pitch moving
      // scaleTuning cents per key away from the root
      for (let k = z.klo; k <= z.khi; k++) regions.push({ ...base, lo: k, hi: k, center: k, tune: tune + (k - rootKey) * z.scaleTuning });
    } else regions.push({ ...base, lo: z.klo, hi: z.khi, center: rootKey });
  }
  // the same sample on the same keys twice (e.g. one mono sample panned hard left and right): once is enough
  const seen = new Set();
  const out = regions.filter((r) => { const k = [r.file, r.lo, r.hi, r.lv, r.hv, r.center, r.tune].join('|'); if (seen.has(k)) return false; seen.add(k); return true; });
  // MeloFi plays one region per note: report presets that sound several zones at once
  let layers = 1;
  for (let k = 0; k < 128; k++) for (let v = 1; v < 128; v += 7) layers = Math.max(layers, out.filter((r) => k >= r.lo && k <= r.hi && v >= r.lv && v <= r.hv).length);
  return { name, files: [...files.values()].filter((f) => out.some((r) => r.file === f.key)), regions: out, layers };
}

// Presets that sound several zones on the same note (e.g. an orchestra hit stacking two one-shots):
// MeloFi plays one region per note, so render what an SF2 synth sounds — every layer with its own
// attenuation, pan, root key, tuning and volume envelope, resampled to a common pitch with a windowed
// sinc and summed — into one file per key range with the same set of layers. The layer with the highest
// sample rate is the reference: it is copied at its own pitch (step 1), the others are resampled to it.
// One-shot (unlooped) layers only. Written 24-bit; if the sum would clip, the whole mix is scaled down
// (never the balance between layers) and the region gain gives that back.
function premixPreset(sf, bank, program) {
  const { name, zones } = presetZones(sf, bank, program);
  const layer = (z) => {
    const s = sf.samples[z.sampleID];
    const st = s.start + z.startAddrsOffset + 32768 * z.startAddrsCoarseOffset;
    const en = s.end + z.endAddrsOffset + 32768 * z.endAddrsCoarseOffset;
    if ((z.sampleModes & 1) === 1) throw new Error(`sf2: ${name}: premix needs one-shot layers, ${s.name} loops`);
    if (z.scaleTuning !== 100) throw new Error(`sf2: ${name}: premix needs normal key tracking`);
    const root = z.overridingRootKey >= 0 ? z.overridingRootKey : (s.pitch <= 127 ? s.pitch : 60);
    return { z, s, st, en, root, cents: z.coarseTune * 100 + z.fineTune + s.correction,
      gain: Math.pow(10, (-0.4 * Math.max(0, z.initialAttenuation)) / 200), pan: Math.max(-500, Math.min(500, z.pan)), env: envOf(z, s, root) };
  };
  const all = zones.filter((z) => sf.samples[z.sampleID] && !(sf.samples[z.sampleID].type & 0x8000)).map(layer);
  const cuts = (lo, hi) => [...new Set(all.flatMap((l) => [l.z[lo], l.z[hi] + 1]))].sort((a, b) => a - b);
  const kc = cuts('klo', 'khi'), vc = cuts('vlo', 'vhi');
  const files = new Map(), regions = [];
  for (let vi = 0; vi + 1 < vc.length; vi++) {
    let run = null;
    const flush = () => { if (run) regions.push(run); run = null; };
    for (let ki = 0; ki + 1 < kc.length; ki++) {
      const [klo, khi, vlo, vhi] = [kc[ki], kc[ki + 1] - 1, vc[vi], vc[vi + 1] - 1];
      const set = all.filter((l) => l.z.klo <= klo && l.z.khi >= khi && l.z.vlo <= vlo && l.z.vhi >= vhi);
      if (!set.length) { flush(); continue; }
      const ref = set.reduce((b, l) => (l.s.rate > b.s.rate || (l.s.rate === b.s.rate && l.gain > b.gain) ? l : b));
      const stereo = new Set(set.map((l) => l.pan)).size > 1;
      const mix = set.map((l) => {
        // centre = 1 on both sides (FluidSynth's constant-power law, scaled so a centred layer keeps its level)
        const th = ((l.pan + 500) / 1000) * (Math.PI / 2);
        return { chans: [[l.st, l.en]], step: Math.pow(2, (ref.root - l.root + (l.cents - ref.cents) / 100) / 12) * (l.s.rate / ref.s.rate),
          gL: stereo ? l.gain * Math.cos(th) * Math.SQRT2 : l.gain, gR: stereo ? l.gain * Math.sin(th) * Math.SQRT2 : l.gain, env: l.env };
      });
      const key = JSON.stringify(['mix', ref.s.rate, stereo, mix]);
      if (!files.has(key)) files.set(key, { key, name: set.map((l) => l.s.name).join(' + '), rate: ref.s.rate, mix, stereo, bits: 24, loop: null, env: null });
      const release = Math.max(0.05, Math.min(4, 0.4 * Math.max(...set.map((l) => tc2s(l.z.releaseVolEnv)))));
      const same = run && run.file === key && run.hi === klo - 1;
      if (same) run.hi = khi;
      else { flush(); run = { file: key, lo: klo, hi: khi, center: ref.root, tune: ref.cents, lv: Math.max(1, vlo), hv: vhi, gain: 1, release, attack: 0, loop: null }; }
    }
    flush();
  }
  return { name, files: [...files.values()], regions, layers: 1 };
}

// windowed-sinc resampling of one layer to the reference rate (step = source samples per output sample)
const SINC_HALF = 32;
function resample(x, step, frames) {
  const cut = Math.min(1, 1 / step); // low-pass when the layer is read faster than its rate
  const half = Math.ceil(SINC_HALF / cut);
  const out = new Float64Array(frames);
  for (let n = 0; n < frames; n++) {
    const pos = n * step, c = Math.floor(pos);
    if (pos - 1 > x.length + half) break;
    let acc = 0;
    for (let j = c - half + 1; j <= c + half; j++) {
      if (j < 0 || j >= x.length) continue;
      const d = pos - j;
      const w = 0.42 + 0.5 * Math.cos((Math.PI * d) / (half + 1)) + 0.08 * Math.cos((2 * Math.PI * d) / (half + 1)); // Blackman
      const a = Math.PI * d * cut;
      acc += x[j] * (d === 0 ? cut : (cut * Math.sin(a)) / a) * w;
    }
    out[n] = acc;
  }
  return out;
}

function renderMix(spec, smpl, sm24, bytes) {
  const rate = spec.rate;
  const layers = spec.mix.map((l) => ({ l, x: channelData({ chans: l.chans, bits: sm24 != null ? 24 : 16 }, smpl, sm24, bytes)[0] }));
  const unit = sm24 != null ? 1 : 256; // to 24-bit units
  const frames = Math.max(...layers.map(({ l, x }) => Math.ceil(x.length / l.step)));
  const L = new Float64Array(frames), R = spec.stereo ? new Float64Array(frames) : null;
  for (const { l, x } of layers) {
    const y = l.step === 1 ? Float64Array.from(x) : resample(x, l.step, frames);
    for (let n = 0; n < Math.min(frames, y.length); n++) {
      let g = 1;
      if (l.env) { const t = n / rate; if (t > l.env.t0) g = Math.pow(10, -Math.min(l.env.sus, ((t - l.env.t0) * 100) / l.env.decay) / 20); }
      L[n] += y[n] * unit * l.gL * g;
      if (R) R[n] += y[n] * unit * l.gR * g;
    }
  }
  let peak = 0;
  for (const ch of R ? [L, R] : [L]) for (let n = 0; n < frames; n++) peak = Math.max(peak, Math.abs(ch[n]));
  const scale = peak > 8388607 ? 8388607 / peak : 1;
  const toInt = (ch) => Int32Array.from(ch, (v) => Math.max(-8388608, Math.min(8388607, Math.round(v * scale))));
  return { chs: R ? [toInt(L), toInt(R)] : [toInt(L)], scale };
}

// Byte ranges of the SF2 file a list of planned files needs (merged when close together).
function rangesFor(sf, files, gap = 256 * 1024) {
  const want = [];
  for (const f of files) for (const [a, b] of f.mix ? f.mix.flatMap((l) => l.chans) : f.chans) {
    want.push([sf.smpl.off + 2 * a, sf.smpl.off + 2 * b]);
    if (sf.sm24) want.push([sf.sm24.off + a, sf.sm24.off + b]);
  }
  want.sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const r of want) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1] + gap) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

// ---------------- render ----------------

// frames(fileOffset, byteLength) -> Buffer with those bytes of the SF2 file
function channelData(spec, smpl, sm24, bytes) {
  return spec.chans.map(([a, b]) => {
    const n = b - a;
    const s16 = bytes(smpl + 2 * a, 2 * n);
    const out = new Int32Array(n);
    if (spec.bits === 24 && sm24 != null) {
      const lsb = bytes(sm24 + a, n);
      for (let i = 0; i < n; i++) out[i] = (s16.readInt16LE(2 * i) << 8) | lsb[i];
    } else for (let i = 0; i < n; i++) out[i] = s16.readInt16LE(2 * i);
    return out;
  });
}

function wavHeader(ch, rate, bits, frames, loop) {
  const block = ch * (bits / 8);
  const data = frames * block;
  const smpl = loop ? 68 : 0;
  const h = Buffer.alloc(44 + (loop ? 8 + 60 : 0));
  h.write('RIFF', 0, 'latin1'); h.writeUInt32LE(36 + data + (loop ? 8 + 60 : 0), 4); h.write('WAVE', 8, 'latin1');
  h.write('fmt ', 12, 'latin1'); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(ch, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * block, 28); h.writeUInt16LE(block, 32); h.writeUInt16LE(bits, 34);
  let p = 36;
  if (loop) { // 'smpl' chunk so the loop survives outside MeloFi too
    h.write('smpl', p, 'latin1'); h.writeUInt32LE(60, p + 4);
    h.writeUInt32LE(Math.round(1e9 / rate), p + 8 + 8); h.writeUInt32LE(1, p + 8 + 28);
    h.writeUInt32LE(loop[0], p + 8 + 36 + 8); h.writeUInt32LE(loop[1] - 1, p + 8 + 36 + 12);
    p += 8 + 60;
    void smpl;
  }
  h.write('data', p, 'latin1'); h.writeUInt32LE(data, p + 4);
  return h;
}

function interleave(chs, frames, bits) {
  const ch = chs.length, bps = bits / 8;
  const out = Buffer.alloc(frames * ch * bps);
  let o = 0;
  for (let i = 0; i < frames; i++) for (let c = 0; c < ch; c++) {
    const v = chs[c][i];
    if (bps === 2) out.writeInt16LE(v, o); else out.writeIntLE(v, o, 3);
    o += bps;
  }
  return out;
}

const MAX_BAKE_S = 30;

// Play the sample through its decay (loop unrolled) until it reaches sustain level, then end on one
// copy of the loop at that level so it can keep looping seamlessly; or until it falls under -90 dB.
function bake(chs, spec) {
  const { rate, env } = spec;
  const loop = spec.loop;
  const scale = spec.bits === 24 ? 1 : 256; // render in 24-bit
  const n = chs[0].length;
  const gainAt = (i) => {
    const t = i / rate;
    if (t <= env.t0) return 1;
    return Math.pow(10, -Math.min(env.sus, ((t - env.t0) * 100) / env.decay) / 20);
  };
  const tSus = env.t0 + (env.sus * env.decay) / 100; // when sustain level is reached
  const silent = env.sus >= 90;
  const maxFrames = Math.ceil(MAX_BAKE_S * rate);
  const out = chs.map(() => []);
  let pos = 0, i = 0, newLoop = null;
  for (;;) {
    if (!loop && pos >= n) break;
    const g = gainAt(i);
    if (silent && g < 3.2e-5) break; // -90 dB
    if (loop && pos === loop[0] && i > 0 && (i / rate >= tSus || i >= maxFrames) && !silent) {
      // one more pass of the loop at a constant level, then loop it
      const gs = g;
      const start = i;
      for (let k = loop[0]; k < loop[1]; k++, i++) for (let c = 0; c < chs.length; c++) out[c].push(Math.round(chs[c][k] * scale * gs));
      newLoop = [start, i];
      break;
    }
    if (i >= maxFrames + (loop ? loop[1] - loop[0] + 1 : 0) * 2) break;
    for (let c = 0; c < chs.length; c++) out[c].push(Math.round(chs[c][pos] * scale * g));
    i++; pos++;
    if (loop && pos >= loop[1]) pos = loop[0];
  }
  const clip = (v) => Math.max(-8388608, Math.min(8388607, v));
  return { chs: out.map((a) => Int32Array.from(a, clip)), loop: newLoop, bits: 24 };
}

// -> { wav: Buffer, loop: [start, end) | null, frames, scale (premixed files: gain taken off to avoid clipping) }
function renderFile(spec, smplOff, sm24Off, bytes) {
  let chs, bits = spec.bits, loop = spec.loop, scale = 1;
  if (spec.mix) ({ chs, scale } = renderMix(spec, smplOff, sm24Off, bytes));
  else {
    chs = channelData(spec, smplOff, sm24Off, bytes);
    if (spec.env) ({ chs, loop, bits } = bake(chs, spec));
  }
  const frames = chs[0].length;
  const wav = Buffer.concat([wavHeader(chs.length, spec.rate, bits, frames, loop), interleave(chs, frames, bits)]);
  return { wav, loop, frames, scale };
}

module.exports = { readSf2, presetZones, planPreset, premixPreset, rangesFor, renderFile, GEN };
