// A finished MeloFi song as a round-trip reference (docs/roundtrip-eval.md): its exported MIDI and a
// small description become <id>.truth.json, the format tools/roundtrip-score.mjs reads.
//   node tools/roundtrip-truth.mjs <song.mid> <song.json> <out dir> <id>
// song.json: { bpm, sig: [n, d], audio_offset_s, genre, parts: [{ track, inst, family }] } with one
// entry per MIDI track name. One tempo only. Left out of the reference: sound effects (family fx).
// The sung voice (family vocal) is a part with the instrument "vocal".
// A synth preset part (inst "synth:<name>") is written as inst "synth", family "synth": that is
// all a converted channel says about itself.
import fs from 'node:fs';
import path from 'node:path';

const [mid, desc, outDir, id] = process.argv.slice(2);
if (!id) { console.log('usage: node tools/roundtrip-truth.mjs <song.mid> <song.json> <out dir> <id>'); process.exit(2); }
const b = fs.readFileSync(mid), d = JSON.parse(fs.readFileSync(desc, 'utf8'));
const division = b.readUInt16BE(12);
const tracks = [];
let p = 14;
while (p + 8 <= b.length) {
  const tag = b.toString('latin1', p, p + 4), len = b.readUInt32BE(p + 4), end = p + 8 + len;
  if (tag === 'MTrk') {
    let i = p + 8, t = 0, rs = 0, name = '';
    const vlq = () => { let v = 0, c; do { c = b[i++]; v = (v << 7) | (c & 127); } while (c & 128); return v; };
    const on = new Map(), notes = [];
    while (i < end) {
      t += vlq(); let s = b[i];
      if (s === 0xff) { i++; const ty = b[i++], l = vlq(); if (ty === 3) name = b.toString('utf8', i, i + l); i += l; continue; }
      if (s === 0xf0 || s === 0xf7) { i++; i += vlq(); continue; }
      if (s & 0x80) { rs = s; i++; } else s = rs;
      const hi = s & 0xf0, n = b[i], v = b[i + 1];
      if (hi === 0x90 && v > 0) on.set(n, [t, v]);
      else if (hi === 0x80 || hi === 0x90) { const o = on.get(n); if (o) { notes.push([o[0], t - o[0], n, o[1]]); on.delete(n); } }
      i += hi === 0xc0 || hi === 0xd0 ? 1 : 2;
    }
    if (notes.length) tracks.push({ name, notes });
  }
  p = end;
}
const sec = (tick) => (tick / division) * (60 / d.bpm), off = d.audio_offset_s || 0;
const parts = [], skipped = [];
for (const tr of tracks) {
  const m = d.parts.find((x) => x.track === tr.name);
  if (!m || m.family === 'fx') { skipped.push(tr.name); continue; }
  // the sung melody is a part too: the conversion writes the lead vocal's notes to a vocal channel
  if (m.family === 'vocal') { parts.push({ role: tr.name, gen: 'vocal', inst: 'vocal', family: 'vocal', kit: false, notes: tr.notes.map(([t, dt, n, v]) => [+(off + sec(t)).toFixed(4), +sec(dt).toFixed(4), n, v, Math.round(t / (division / 4))]) }); continue; }
  const synth = String(m.inst).startsWith('synth:'), kit = m.family === 'drums';
  parts.push({ role: tr.name, gen: kit ? 'drums' : 'part', inst: synth ? 'synth' : m.inst, family: synth || m.family === 'pad' ? 'synth' : m.family, kit,
    notes: tr.notes.map(([t, dt, n, v]) => [+(off + sec(t)).toFixed(4), +sec(dt).toFixed(4), n, v, Math.round(t / (division / 4))]) });
}
const truth = { id, genre: d.genre || '', bpm: d.bpm, meter: d.sig?.[0] || 4, offset: off, ppq: division, real: true, external: true, tempoChanges: 0, sigChanges: 0, parts };
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, `${id}.truth.json`), JSON.stringify(truth));
console.log(`${id}: ${parts.length} parts, ${parts.reduce((a, x) => a + x.notes.length, 0)} notes; left out: ${skipped.join(', ') || '-'}`);
