// Calibration of the timbre accuracy on ground truth (docs/timbre-matching.md, part A):
// every MeloFi instrument (and a spread of synth presets) plays a phrase; the render is "produced"
// (room reverb, EQ tilt, another instrument bleeding in at -20 dB) and "transcribed" (onsets ±15 ms,
// lengths ×0.8..1.2, velocities ±15, 5% of the notes lost), then matched exactly as a song's stem
// is (midiconvert.js matchGroup). The right instrument should come out on top at >= 90 % and other
// families clearly lower. Run headless:
//   MELOFI_SHOT=out MELOFI_SCRIPT=<wrapper> npx electron .   (wrapper: window.__args = {...}; + this)
// args: { only: [ids], presets: 40 (how many synth presets) }. Prints TCAL {json} per test.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const A = window.__melofi; for (let i = 0; i < 150 && !A?.engine?.inst; i++) await sleep(100);
const imp = (p) => import(new URL(p, location.href).href);
const M = await imp('studio/ui/midiconvert.js');
const { SYNTH_PRESETS } = await imp('studio/synth.js');
const S = { app: A, isKit: (id) => A.instruments.find((i) => i.id === id)?.family === 'drums', instName: (id) => A.instruments.find((i) => i.id === id)?.name || id };
const args = window.__args || {};
const FP = await M.fingerprints();

// seeded random
let seed = 12345;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const pick = (a) => a[Math.floor(rnd() * a.length)];

// a phrase in a register: single notes of mixed lengths, a few chords, some legato
function phrase(lo, hi, kitNotes = null) {
  const notes = [];
  let t = 0.3;
  const mid = Math.round((lo + hi) / 2), span = Math.max(5, Math.min(14, (hi - lo) / 2));
  const scale = [0, 2, 4, 5, 7, 9, 11];
  const deg = (i) => mid - 7 + Math.floor(i / 7) * 12 + scale[((i % 7) + 7) % 7];
  let i = 7;
  for (let k = 0; k < 26; k++) {
    if (kitNotes) { notes.push([t, 0.1, pick(kitNotes), 70 + Math.round(rnd() * 50)]); t += pick([0.125, 0.25, 0.25, 0.375]); continue; }
    const d = pick([0.18, 0.25, 0.35, 0.5, 0.7, 1.0, 1.3]);
    i += pick([-2, -1, -1, 1, 1, 2, 3, -3, 0]);
    const n = Math.max(lo, Math.min(hi, deg(i)));
    if (Math.abs(n - mid) > span) i = 7;
    const v = 65 + Math.round(rnd() * 55);
    if (k % 9 === 4) { for (const o of [0, 4, 7]) notes.push([t, d, Math.min(hi, n + o), v]); }
    else notes.push([t, d * (rnd() < 0.3 ? 1.15 : 0.9), n, v]);
    t += d + (rnd() < 0.3 ? 0.08 : 0);
  }
  return { notes, length: t + 0.5 };
}

// "production": reverb (a decaying noise tail), a random EQ tilt, a bleed track
async function produce(x, rate, bleed) {
  const len = x.length, ctx = new OfflineAudioContext(1, len, rate);
  const buf = ctx.createBuffer(1, len, rate); buf.copyToChannel(x, 0);
  const src = ctx.createBufferSource(); src.buffer = buf;
  const ir = ctx.createBuffer(1, Math.round(rate * 1.2), rate), d = ir.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (rnd() * 2 - 1) * Math.exp(-i / (rate * 0.25));
  const conv = ctx.createConvolver(); conv.buffer = ir; conv.normalize = true;
  const wet = ctx.createGain(); wet.gain.value = 0.22;
  const lo = ctx.createBiquadFilter(); lo.type = 'lowshelf'; lo.frequency.value = 200; lo.gain.value = (rnd() * 2 - 1) * 3;
  const hi = ctx.createBiquadFilter(); hi.type = 'highshelf'; hi.frequency.value = 3500; hi.gain.value = (rnd() * 2 - 1) * 3;
  src.connect(lo); lo.connect(hi); hi.connect(ctx.destination); hi.connect(conv); conv.connect(wet); wet.connect(ctx.destination);
  src.start();
  const out = (await ctx.startRendering()).getChannelData(0);
  let pk = 0; for (const v of out) pk = Math.max(pk, Math.abs(v));
  let pb = 0; for (const v of bleed) pb = Math.max(pb, Math.abs(v));
  const g = pb ? (pk / pb) * 0.1 : 0; // -20 dB
  const y = new Float32Array(len);
  for (let i = 0; i < len; i++) y[i] = out[i] + (i < bleed.length ? bleed[i] * g : 0);
  return y;
}
// (8% of the notes also come out an octave off, like a transcription's octave errors; the octave
// check should put them right without moving the others)
const transcribe = (notes) => notes.filter(() => rnd() > 0.05).map(([t, d, n, v]) => [t + (rnd() * 2 - 1) * 0.015, d * (0.8 + rnd() * 0.4), n, Math.max(20, Math.min(127, v + Math.round((rnd() * 2 - 1) * 15))), rnd() < 0.08 ? (rnd() < 0.5 ? 12 : -12) : 0]);

// one representative per family: the "wrong family" scores are read from these
const REPS = ['splendid', 'rhodes', 'organ', 'acoustic', 'electric', 'fingerbass', 'violin', 'strings', 'trumpet', 'flute', 'altosax', 'marimba', 'choir', 'synth:슈퍼쏘 리드', 'synth:따뜻한 패드', 'synth:플럭', 'synth:신스 베이스'];
const famOf = (id) => (id.startsWith('synth:') ? M.candKind(S, id) : (A.instruments.find((i) => i.id === id)?.family || '?'));
// families that sound alike on purpose (synth instruments vs synth presets of the same role, ...)
const group = (id) => { const f = famOf(id); if (/신스/.test(f) || f === 'synth') return 'synth'; return f; };

const ids = [];
for (const m of A.instruments) if (m.family !== 'fx' && m.family !== 'drums' && FP[m.id]?.notes?.length && (!args.only || args.only.includes(m.id))) ids.push(m.id);
const presets = Object.keys(SYNTH_PRESETS).filter((n) => FP[`synth:${n}`]?.notes?.length);
const every = Math.max(1, Math.floor(presets.length / (args.presets ?? 40)));
for (let i = 0; i < presets.length; i += every) if (!args.only || args.only.includes(`synth:${presets[i]}`)) ids.push(`synth:${presets[i]}`);

window.addEventListener('error', (e) => console.log('TERR ' + e.message + ' ' + (e.error?.stack || '').slice(0, 300)));
const pool = M.pool(S, false);
for (const id of ids) {
  const t0 = performance.now();
  try {
  const fp = FP[id], ns = fp.notes.map((f) => f.n);
  const lo = Math.max(Math.min(...ns), 28), hi = Math.min(Math.max(...ns), 96);
  const { notes, length } = phrase(Math.max(lo, Math.round(lo + (hi - lo) * 0.2)), Math.min(hi, Math.round(lo + (hi - lo) * 0.75)));
  const truth = await M.renderNotes(S, id, notes, length);
  // a bleed from another family
  let other = pick(pool); for (let k = 0; k < 20 && group(other) === group(id); k++) other = pick(pool);
  const ph2 = phrase(48, 72);
  const bl = await M.renderNotes(S, other, ph2.notes, ph2.length);
  const x = await produce(truth.x, truth.rate, bl.x);
  // the "stem": t = 0 at the render's offset
  const tr = transcribe(notes);
  const tn = tr.map(([t, d, n, v, o]) => [t + truth.off, d, n + o, v]);
  const r = { notes: { other: tn } };
  // octave check: which wrong notes it put right, which right ones it moved
  M.fixStemOctaves(r, 'other', { x, rate: truth.rate });
  const oct = { wrong: 0, fixed: 0, falsely: 0 };
  const kept = tn.map((_, i) => i).filter((i) => !r.octaveFix.other.removed.includes(i));
  oct.dropped = r.octaveFix.other.removed.length;
  r.fixed.other.forEach((nt, j) => { const i = kept[j], want = tr[i][2], had = tn[i][2]; if (had !== want) { oct.wrong++; if (nt[2] === want) oct.fixed++; } else if (nt[2] !== want) oct.falsely++; });
  const g = { secs: [{ start: 0, end: 1 }] };
  const m = await M.matchGroup(S, r, 'other', g, [0, length + 2], { x, rate: truth.rate }, { plausible: [], also: [id, ...REPS] });
  const c = m.cands || [];
  const me = c.find((k) => k.id === id);
  const rank = c.findIndex((k) => k.id === id) + 1;
  const wrong = c.filter((k) => group(k.id) !== group(id));
  const same = c.filter((k) => k.id !== id && group(k.id) === group(id));
  console.log('TCAL ' + JSON.stringify({
    id, fam: famOf(id), acc: me?.acc ?? null, rank, top: c[0] ? `${c[0].id} ${c[0].acc}` : null, raw: me?.raw, parts: me?.parts,
    bestWrong: wrong[0] ? `${wrong[0].id} ${wrong[0].acc}` : null, bestWrongAcc: wrong[0]?.acc ?? 0, wrongRaw: wrong[0]?.raw,
    bestSame: same[0] ? `${same[0].id} ${same[0].acc}` : null, probes: m.probes, tried: c.length, bleed: other, sec: +((performance.now() - t0) / 1000).toFixed(1),
    all: c.map((k) => [k.id, k.acc, k.raw]), oct, octChecked: r.octaveFix.other.checked, stats: m.stats,
  }));
  } catch (err) { console.log('TCAL ' + JSON.stringify({ id, error: String(err.stack || err).slice(0, 300) })); }
}
console.log('TCALDONE');
return [10];
