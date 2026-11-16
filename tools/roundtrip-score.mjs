// Scores a round-trip run (tools/e2e/roundtrip-eval.js) against its reference songs.
//   node tools/roundtrip-score.mjs <run dir> [--baseline <summary.json>] [--save <summary.json>]
// Per song, in percent:
//   notes   pitched notes of all parts pooled: onset within 50 ms and the same pitch, F1
//   drums   drum hits by kind (kick, snare, hi-hat, cymbal, other), onset within 50 ms, F1
//   inst    each reference part: the output channel that holds most of its notes, and whether its
//           instrument is the same (100), the same family (60) or neither (0); a part whose notes
//           are mostly lost scores 0. Weighted by the part's notes
//   grid    DAW use: matched notes on the right 16th step relative to each other (80) and bar 1
//           where the song's bar 1 is (20)
//   tempo   100 within 0.5 %, down to 0 at 5 % off, after folding double or half tempo (any power
//           of two) onto the reference: the same music written another way
//   meter   the right time signature without stray changes
//   strict  as overall, with the notes share split three ways: onset+pitch, with the end (offset within
//           50 ms or 20%), and per part (only matches in the channel the part went to)
//   errors  wrong notes by kind (octave, step, other pitch at an onset, extra) and missed
//   new     the new criteria (section 8): 45 notes + 10 drums + 15 sound-vs-stem (out.timbre) + 20 grid
//           + 7 tempo + 3 meter; printed beside the old overall, which stays for comparison
//   overall 35 notes + 10 drums + 20 inst + 20 grid + 10 tempo + 5 meter (songs without drums: 45 notes)
// With --baseline, a drop of more than 2 points overall or 5 in any metric average is a regression:
// it prints ROLLBACK and exits with 1.
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const dir = argv[0];
const opt = (k) => { const i = argv.indexOf(k); return i > 0 ? argv[i + 1] : null; };
if (!dir) { console.log('usage: node tools/roundtrip-score.mjs <run dir> [--baseline f] [--save f]'); process.exit(2); }

const TOL = 0.05;
const W = { notes: 35, drums: 10, inst: 20, grid: 20, tempo: 10, meter: 5 };
const W2 = { notes: 45, drums: 10, timbre: 15, grid: 20, tempo: 7, meter: 3 }; // the new criteria
const drumKind = (n) => ([35, 36].includes(n) ? 'kick' : [37, 38, 39, 40].includes(n) ? 'snare' : [42, 44, 46].includes(n) ? 'hat' : [49, 51, 52, 53, 55, 57, 59].includes(n) ? 'cym' : 'other');

// one-to-one matches by time: a and b are [{t, key, ...}], same key, |dt| <= TOL, nearest first
function match(a, b) {
  const byKey = new Map();
  b.forEach((x, j) => { if (!byKey.has(x.key)) byKey.set(x.key, []); byKey.get(x.key).push(j); });
  const used = new Set(), pairs = [];
  const cand = [];
  a.forEach((x, i) => { for (const j of byKey.get(x.key) || []) { const d = Math.abs(b[j].t - x.t); if (d <= TOL) cand.push([d, i, j]); } });
  cand.sort((p, q) => p[0] - q[0]);
  const usedA = new Set();
  for (const [, i, j] of cand) if (!usedA.has(i) && !used.has(j)) { usedA.add(i); used.add(j); pairs.push([i, j]); }
  return pairs;
}
const f1 = (m, nRef, nOut) => (nRef + nOut ? (200 * m) / (nRef + nOut) : 100);

function mainTempo(out, notes) {
  if (!out.tempos?.length) return out.bpm;
  const bt = out.ppq * 4 * (out.sig?.[0] || 4) / (out.sig?.[1] || 4), end = Math.max(0, ...notes.map((x) => x.tick));
  const list = [{ tick: 0, bpm: out.bpm }, ...out.tempos.map((x) => ({ tick: x.bar * bt, bpm: x.bpm }))].sort((a, b) => a.tick - b.tick);
  const w = new Map();
  list.forEach((x, i) => { const b = Math.min(end, list[i + 1]?.tick ?? end); if (b > x.tick) w.set(x.bpm, (w.get(x.bpm) || 0) + ((b - x.tick) / out.ppq) * (60 / x.bpm)); });
  return [...w.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? out.bpm;
}

// seconds from tick 0 under the project's tempo map (as studio/model.js tickToSec)
function tickSec(out, tick) {
  if (!out.tempos?.length) return (tick / out.ppq) * (60 / out.bpm);
  const bt = out.ppq * 4 * (out.sig?.[0] || 4) / (out.sig?.[1] || 4);
  const L = [{ tick: 0, bpm: out.bpm }, ...out.tempos.filter((x) => x.bar > 0).map((x) => ({ tick: x.bar * bt, bpm: x.bpm }))].sort((a, b) => a.tick - b.tick);
  let s = 0;
  for (let i = 0; i < L.length; i++) { const a = L[i].tick, b = L[i + 1]?.tick ?? Infinity; if (tick <= a) break; s += ((Math.min(tick, b) - a) / out.ppq) * (60 / L[i].bpm); }
  return s;
}

function scoreSong(truth, out) {
  const tParts = truth.parts;
  const pitchedT = [], drumT = [];
  tParts.forEach((p, pi) => p.notes.forEach(([t, d, n, , step]) => (p.kit ? drumT : pitchedT).push({ t, d, n, key: p.kit ? drumKind(n) : n, pi, step })));
  // a layered sound is two channels playing the same notes: the second is not counted again
  const layer = new Set(out.channels.map((c, i) => (c.layerOf ? i : -1)).filter((i) => i >= 0));
  const outN = out.notes.filter((x) => !layer.has(x[4])).map(([tick, dt, n, , ci, sec]) => ({ tick, n, ci, t: sec, d: tickSec(out, tick + dt) - tickSec(out, tick), kit: !!out.channels[ci]?.kit }));
  // the output's time against the reference (the project start is where the separation put bar 1)
  let best = [0, -1];
  const pitchedO0 = outN.filter((x) => !x.kit);
  for (let d = -0.4; d <= 0.4001; d += 0.005) {
    const m = match(pitchedT.map((x) => ({ t: x.t, key: x.n })), pitchedO0.map((x) => ({ t: x.t + d, key: x.n }))).length;
    if (m > best[1]) best = [d, m];
  }
  const shift = best[0];
  // For the grid score the pairs come from a shift centred on the matched notes: the search above
  // only counts matches, and on fast repeated notes (16ths 85 ms apart, a 50 ms window) a shift at
  // the window's edge pairs many notes with their neighbours, which would read as notes one step
  // off the grid although they sit on it.
  let shiftC = shift;
  for (let pass = 0; pass < 2; pass++) {
    const prs = match(pitchedT.map((x) => ({ t: x.t, key: x.n })), pitchedO0.map((x) => ({ t: x.t + shiftC, key: x.n })));
    if (prs.length < 8) break;
    const dts = prs.map(([i, j]) => pitchedO0[j].t + shiftC - pitchedT[i].t).sort((a, b) => a - b);
    shiftC -= dts[dts.length >> 1];
  }
  const gridPairs = match(pitchedT.map((x) => ({ t: x.t, key: x.n })), pitchedO0.map((x) => ({ t: x.t + shiftC, key: x.n })));
  const pitchedO = pitchedO0.map((x) => ({ ...x, t: x.t + shift, key: x.n }));
  const drumO = outN.filter((x) => x.kit).map((x) => ({ ...x, t: x.t + shift, key: drumKind(x.n) }));
  // notes
  const pm = match(pitchedT, pitchedO);
  const notes = f1(pm.length, pitchedT.length, pitchedO.length);
  const pcm = match(pitchedT.map((x) => ({ ...x, key: x.n % 12 })), pitchedO.map((x) => ({ ...x, key: x.n % 12 }))).length;
  const notesOct = f1(pcm, pitchedT.length, pitchedO.length);
  // stricter: (a) the note's end too, within 50 ms or 20% of its length (mir_eval's offset rule);
  // (b) per part, only the matches in the channel the part went to (a right note in the wrong
  // channel is a wrong note for whoever edits it); (c) what the wrong notes are
  const offOk = pm.filter(([i, j]) => Math.abs(pitchedT[i].t + pitchedT[i].d - (pitchedO[j].t + pitchedO[j].d)) <= Math.max(0.05, 0.2 * pitchedT[i].d)).length;
  const notesOffset = f1(offOk, pitchedT.length, pitchedO.length);
  const usedO = new Set(pm.map(([, j]) => j)), usedT = new Set(pm.map(([i]) => i));
  const errs = { octave: 0, step: 0, otherPitch: 0, extra: 0, missed: pitchedT.length - usedT.size };
  pitchedO.forEach((x, j) => {
    if (usedO.has(j)) return;
    const at = pitchedT.filter((y) => Math.abs(y.t - x.t) <= TOL);
    if (!at.length) errs.extra++;
    else if (at.some((y) => Math.abs(y.n - x.n) % 12 === 0)) errs.octave++;
    else if (at.some((y) => Math.abs(y.n - x.n) <= 2)) errs.step++;
    else errs.otherPitch++;
  });
  // drums
  const hasDrums = drumT.length > 0;
  const dm = hasDrums ? match(drumT, drumO).length : 0;
  const drums = hasDrums ? f1(dm, drumT.length, drumO.length) : null;
  // instruments per part
  let partM = 0;
  const parts = tParts.map((p, pi) => {
    const mine = pitchedT.filter((x) => x.pi === pi);
    if (p.kit) {
      const kitCh = out.channels.find((c) => c.kit);
      return { role: p.role, inst: p.inst, gen: p.gen, notes: p.notes.length, got: kitCh?.inst || null, recall: hasDrums ? Math.round((100 * dm) / drumT.length) : 0, score: kitCh && drums > 30 ? 100 : 0 };
    }
    let bestC = null;
    out.channels.forEach((c, ci) => {
      if (c.kit) return;
      const m = match(mine, pitchedO.filter((x) => x.ci === ci)).length;
      if (!bestC || m > bestC.m) bestC = { ci, m };
    });
    const recall = mine.length ? (100 * (bestC?.m || 0)) / mine.length : 0;
    partM += bestC?.m || 0;
    const ch = bestC && bestC.m ? out.channels[bestC.ci] : null;
    const sc = !ch || recall < 15 ? 0 : ch.inst === p.inst ? 100 : ch.family === p.family ? 60 : 0;
    return { role: p.role, inst: p.inst, family: p.family, gen: p.gen, notes: p.notes.length, got: ch ? ch.inst : null, gotFamily: ch?.family || null, recall: Math.round(recall), allRecall: Math.round((100 * pm.filter(([i]) => pitchedT[i].pi === pi).length) / Math.max(1, mine.length)), score: sc };
  });
  const partNotes = f1(partM, pitchedT.length, pitchedO.length);
  const wsum = parts.reduce((a, p) => a + p.notes, 0);
  const inst = parts.reduce((a, p) => a + p.score * p.notes, 0) / Math.max(1, wsum);
  // double or half tempo is the same music written another way (a 200 BPM song as 100, a file at
  // 505 as 126): the output's tempo is folded onto the reference's by a power of two, and its grid
  // is read in the reference's 16ths at that factor
  // with a tempo map, the tempo that covers most of the song (as the reference's is taken)
  const outBpm = mainTempo(out, outN);
  const ratio = outBpm / truth.bpm, fold = 2 ** Math.round(Math.log2(ratio)), err = Math.abs(ratio / fold - 1);
  // grid: matched notes on the right 16th step
  const stepTicks = out.ppq / 4, spbT = truth.meter * 4;
  const ks = gridPairs.map(([i, j]) => Math.round(pitchedO0[j].tick / stepTicks / fold) - pitchedT[i].step);
  const cnt = new Map(); ks.forEach((k) => cnt.set(k, (cnt.get(k) || 0) + 1));
  const [mode, modeN] = [...cnt.entries()].sort((a, b) => b[1] - a[1])[0] || [0, 0];
  const onGrid = ks.length ? (100 * modeN) / ks.length : 0;
  const barAligned = ((mode % spbT) + spbT) % spbT === 0;
  const grid = 0.8 * onGrid + (barAligned ? 20 : 0);
  // tempo, meter
  const tempo = err <= 0.005 ? 100 : Math.max(0, 100 * (1 - (err - 0.005) / 0.045));
  // the right meter: the same count, or bars of the same length once the tempo is folded
  const sameBar = out.sig?.[0] === truth.meter || Math.abs((out.sig?.[0] * 4) / fold - spbT) < 0.01;
  // (signature changes cost half when the song has none; a song that changes meter expects them)
  const meter = sameBar ? ((out.sigs || []).length && !truth.sigChanges ? 50 : 100) : 0;
  const w = hasDrums ? W : { ...W, notes: W.notes + W.drums, drums: 0 };
  const overall = (w.notes * notes + w.drums * (drums ?? 0) + w.inst * inst + w.grid * grid + w.tempo * tempo + w.meter * meter) / 100;
  // strict: the notes' share split into onset+pitch, onset+pitch+end and per-part (a third each)
  const strict = (w.notes * (notes + notesOffset + partNotes) / 3 + w.drums * (drums ?? 0) + w.inst * inst + w.grid * grid + w.tempo * tempo + w.meter * meter) / 100;
  const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
  // New criteria (docs/roundtrip-eval.md section 8): the sound comes from the song's own stems, so
  // what counts is the notes and how close the converted sound is to the stem. timbre: the mean of
  // out.timbre's per-stem similarity (each stem's converted channels rendered and compared with the
  // stem, log-mel). overall2 = 45 notes + 10 drums + 15 timbre + 20 grid + 7 tempo + 3 meter
  // (songs without drums: 55 notes). null when the run did not measure the timbre.
  const sims = Object.values(out.timbre || {}).map((v) => v?.sim).filter((v) => v != null);
  const timbre = sims.length ? sims.reduce((a, b) => a + b, 0) / sims.length : null;
  const w2 = hasDrums ? W2 : { ...W2, notes: W2.notes + W2.drums, drums: 0 };
  const overall2 = timbre == null ? null : (w2.notes * notes + w2.drums * (drums ?? 0) + w2.timbre * timbre + w2.grid * grid + w2.tempo * tempo + w2.meter * meter) / 100;
  // listening vs fingerprint alone: of the parts kept, how often each pick is one of the song's
  // real instruments, and how often the two agree
  const real = new Set(tParts.map((p) => p.inst));
  const gs = (out.groups || []).filter((g) => !g.stray && g.pick);
  const pickReal = gs.length ? (100 * gs.filter((g) => real.has(g.pick)).length) / gs.length : null;
  const preReal = gs.length ? (100 * gs.filter((g) => real.has(g.prePick)).length) / gs.length : null;
  const agree = gs.length ? (100 * gs.filter((g) => g.pick === g.prePick).length) / gs.length : null;
  return {
    id: truth.id, genre: truth.genre, bpm: truth.bpm, outBpm: +outBpm.toFixed(2), tempoFold: fold, meter: truth.meter, outSig: out.sig, sigChanges: (out.sigs || []).length, shift: r1(shift * 1000),
    notes: r1(notes), notesOctave: r1(notesOct), precision: r1((100 * pm.length) / Math.max(1, pitchedO.length)), recall: r1((100 * pm.length) / Math.max(1, pitchedT.length)),
    notesOffset: r1(notesOffset), partNotes: r1(partNotes), strict: r1(strict), timbre: r1(timbre), overall2: r1(overall2),
    errors: Object.fromEntries(Object.entries(errs).map(([k, v]) => [k, r1((100 * v) / Math.max(1, k === 'missed' ? pitchedT.length : pitchedO.length))])),
    drums: r1(drums), inst: r1(inst), pickReal: r1(pickReal), fingerprintReal: r1(preReal), pickAgree: r1(agree), grid: r1(grid), onGrid: r1(onGrid), barAligned, tempo: r1(tempo), meterScore: meter, overall: r1(overall),
    weights: w, parts, times: out.times,
  };
}

// ---------- run ----------
// --kind oracle scores the perfect-stems run (<id>.oracle.json) instead of the real one
const kind = opt('--kind') || 'out';
const ids = fs.readdirSync(dir).filter((f) => f.endsWith('.truth.json')).map((f) => f.replace('.truth.json', ''));
const res = [];
for (const id of ids) {
  const of = path.join(dir, `${id}.${kind}.json`);
  if (!fs.existsSync(of)) { res.push({ id, missing: true }); continue; }
  res.push(scoreSong(JSON.parse(fs.readFileSync(path.join(dir, `${id}.truth.json`), 'utf8')), JSON.parse(fs.readFileSync(of, 'utf8'))));
}
const ok = res.filter((r) => !r.missing);
const avg = (k) => { const v = ok.map((r) => r[k]).filter((x) => x != null); return v.length ? Math.round((10 * v.reduce((a, b) => a + b, 0)) / v.length) / 10 : null; };
const pad = (s, n) => String(s ?? '-').padEnd(n);
console.log(`\n${pad('song', 11)}${pad('bpm', 12)}${pad('meter', 7)}${pad('notes', 7)}${pad('drums', 7)}${pad('inst', 7)}${pad('grid', 7)}${pad('tempo', 7)}${pad('overall', 8)}`);
for (const r of res) {
  if (r.missing) { console.log(`${pad(r.id, 11)}(no result)`); continue; }
  console.log(`${pad(r.id, 11)}${pad(`${r.bpm}->${r.outBpm}`, 12)}${pad(`${r.meter}->${r.outSig?.[0]}${r.sigChanges ? '*' : ''}`, 7)}${pad(r.notes, 7)}${pad(r.drums, 7)}${pad(r.inst, 7)}${pad(r.grid, 7)}${pad(r.tempo, 7)}${pad(r.overall, 8)}`);
}
const summary = { at: new Date().toISOString(), songs: ok.length, missing: res.length - ok.length, avg: { overall2: avg('overall2'), timbre: avg('timbre'), overall: avg('overall'), strict: avg('strict'), notes: avg('notes'), notesOffset: avg('notesOffset'), partNotes: avg('partNotes'), notesOctave: avg('notesOctave'), precision: avg('precision'), recall: avg('recall'), drums: avg('drums'), inst: avg('inst'), pickReal: avg('pickReal'), fingerprintReal: avg('fingerprintReal'), pickAgree: avg('pickAgree'), grid: avg('grid'), onGrid: avg('onGrid'), tempo: avg('tempo'), meter: avg('meterScore') }, perSong: Object.fromEntries(ok.map((r) => [r.id, r.overall])) };
// the wrong notes by kind: output notes an octave off, a step off, another pitch at a reference
// onset, or with no reference onset at all (percent of the output); missed (of the reference)
const errAvg = {};
for (const r of ok) for (const [k, v] of Object.entries(r.errors || {})) errAvg[k] = (errAvg[k] || 0) + v / ok.length;
summary.errors = Object.fromEntries(Object.entries(errAvg).map(([k, v]) => [k, Math.round(v * 10) / 10]));
console.log(`\nstrict    ${summary.avg.strict}  (notes with their ends ${summary.avg.notesOffset}, notes in their own part's channel ${summary.avg.partNotes})  wrong notes: ${Object.entries(summary.errors).map(([k, v]) => `${k} ${v}%`).join(', ')}`);
if (summary.avg.overall2 != null) console.log(`new       overall ${summary.avg.overall2}  (notes ${summary.avg.notes} x45, drums ${summary.avg.drums} x10, sound vs stem ${summary.avg.timbre} x15, grid ${summary.avg.grid} x20, tempo ${summary.avg.tempo} x7, meter ${summary.avg.meter} x3)`);
console.log(`average   overall ${summary.avg.overall}  notes ${summary.avg.notes} (octave-free ${summary.avg.notesOctave}, precision ${summary.avg.precision}, recall ${summary.avg.recall})  drums ${summary.avg.drums}  inst ${summary.avg.inst}  grid ${summary.avg.grid}  tempo ${summary.avg.tempo}  meter ${summary.avg.meter}`);
// where the points go: each metric's weighted shortfall from 100, averaged over the songs
const loss = {};
for (const r of ok) for (const k of ['notes', 'drums', 'inst', 'grid', 'tempo', 'meterScore']) {
  const wk = k === 'meterScore' ? r.weights.meter : r.weights[k];
  if (!wk) continue;
  loss[k] = (loss[k] || 0) + (wk * (100 - (r[k] ?? 0))) / 100 / ok.length;
}
summary.loss = Object.fromEntries(Object.entries(loss).map(([k, v]) => [k, Math.round(v * 10) / 10]).sort((a, b) => b[1] - a[1]));
if (summary.avg.pickReal != null) console.log(`instrument picks that are one of the song's real instruments: by listening ${summary.avg.pickReal}%, by fingerprint alone ${summary.avg.fingerprintReal}% (the two agree ${summary.avg.pickAgree}%)`);
console.log('points lost per song, by metric:', Object.entries(summary.loss).map(([k, v]) => `${k} ${v}`).join(', '));
// by part kind: how much of each kind of part comes back, and with the right instrument
const byGen = {};
for (const r of ok) for (const p of r.parts) { const g = (byGen[p.gen] ||= { parts: 0, recall: 0, inst: 0, lost: 0 }); g.parts++; g.recall += p.allRecall ?? p.recall; g.inst += p.score; if (!p.got) g.lost++; }
summary.byPart = Object.fromEntries(Object.entries(byGen).map(([k, g]) => [k, { parts: g.parts, noteRecall: Math.round(g.recall / g.parts), instrument: Math.round(g.inst / g.parts), lost: g.lost }]));
console.log('by part:', Object.entries(summary.byPart).map(([k, g]) => `${k}: recall ${g.noteRecall}% inst ${g.instrument}% lost ${g.lost}/${g.parts}`).join(' | '));
fs.writeFileSync(path.join(dir, `score-${kind}.json`), JSON.stringify({ summary, songs: res }, null, 1));
if (opt('--save')) fs.writeFileSync(opt('--save'), JSON.stringify(summary, null, 1));
let code = 0;
if (opt('--baseline') && fs.existsSync(opt('--baseline'))) {
  const base = JSON.parse(fs.readFileSync(opt('--baseline'), 'utf8'));
  const rows = [];
  for (const [k, v] of Object.entries(summary.avg)) {
    const b = base.avg?.[k]; if (b == null || v == null) continue;
    const diag = ['pickReal', 'fingerprintReal', 'pickAgree'].includes(k); // diagnostics: reported, never a reason to roll back
    const d = Math.round((v - b) * 10) / 10; rows.push(`${k} ${b}->${v} (${d >= 0 ? '+' : ''}${d})`);
    if (!diag && (((k === 'overall' || k === 'overall2' || k === 'strict') && d < -2) || d < -5)) code = 1;
  }
  console.log('vs baseline:', rows.join(', '));
  for (const [id, v] of Object.entries(summary.perSong)) { const b = base.perSong?.[id]; if (b != null && v < b - 5) { console.log(`  ${id}: ${b} -> ${v}`); code = 1; } }
  console.log(code ? 'ROLLBACK: worse than the baseline' : 'OK: not worse than the baseline');
}
process.exit(code);
