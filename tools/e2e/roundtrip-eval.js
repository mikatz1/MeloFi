// Round-trip test of the separation -> DAW pipeline (docs/roundtrip-eval.md).
// Songs written on the grid with MeloFi instruments are the reference. Each is rendered to MP3,
// then put through what a user does: AI separation and transcription, timbre matching, the
// project with the best match per part (분리한 트랙 모두 MIDI로 변환), and MIDI export.
// tools/roundtrip-score.mjs compares the result with the reference and prints percentages.
//
// Run headless (tools/roundtrip.sh does all of this):
//   MELOFI_SHOT=<out dir> MELOFI_USERDATA=<scratch, stems-engine junctioned> MELOFI_SCRIPT=<wrapper> npx electron .
// The wrapper is `window.__args = {...};` followed by this file. Args:
//   phase: 'render' | 'run' | 'all' (default all) | 'oracle' (perfect stems and notes, no GPU;
//          needs cacheDir, see below; writes <id>.oracle.json / .oracle.mid)
//   only: [song ids]  (default every song)
//   seed: a number, changes every random choice (notes, rhythms) of every song (default 1)
//   mus: MuScriptor model for the transcription, or 'off' (Basic Pitch; the app's default)
//   labels: (oracle) true: the true parts' instrument categories as the multi-instrument hint
//           (result.labels); (run) 'file': the labels saved beside the result (labels.json)
//   offline: true plays only instruments already on disk (no on-demand sample downloads)
//   piano, bass, vocal: (run) 'file': that stem's notes from its own model where it applies (*_notes.json)
//   stemInst: false leaves the instruments cut from the stems out (preset matching only)
//   timbre: false skips the render-against-stem comparison (out.timbre, the new criteria's sound score)
//   octaves: false leaves the transcription's octaves alone (timbre.fixOctaves off); hints: false
//            ignores instrument labels (MuScriptor or result.labels) when splitting stems
// Files in the out dir, per song: <id>.mp3, <id>.truth.mid, <id>.truth.json, <id>.out.mid,
// <id>.out.json. A song whose .out.json is already there is skipped (rerun after a stop).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const A = window.__melofi; for (let i = 0; i < 150 && !A?.engine?.inst; i++) await sleep(100);
const imp = (p) => import(new URL(p, location.href).href);
const M = await imp('studio/ui/midiconvert.js');
const { newProject, newPattern, PPQ, tickToSec } = await imp('studio/model.js');
const { eventsFor } = await imp('studio/transport.js');
const io = await imp('studio/io.js');
const { mp3 } = await imp('js/recorder.js');
const args = window.__args || {};
if (args.offline) window.__offline = true; // no on-demand sample downloads while matching
const log = (tag, o) => console.log(`${tag} ${JSON.stringify(o)}`);
A.settings.set({ studioTourSeen: true });
const S = A.studio; await S.open(); await sleep(400);

// ---------- the songs ----------
// parts: [instrument id, generator, options]; a generator writes notes in 16th steps
const SONGS = [
  { id: 'pop', genre: 'pop', bpm: 104, key: 0, mode: 'major', prog: [0, 4, 5, 3], parts: [['acousticdrums', 'drums', { style: 'pop' }], ['fingerbass', 'bass', { style: 'root8' }], ['splendid', 'chords', { style: 'arp8', oct: 4 }], ['strings', 'chords', { style: 'pad', oct: 4, from: 8 }], ['synlead', 'lead', { from: 4 }]] },
  { id: 'rock', genre: 'rock', bpm: 138, key: 4, mode: 'minor', prog: [0, 5, 2, 6], parts: [['acousticdrums', 'drums', { style: 'rock' }], ['ebass', 'bass', { style: 'root8' }], ['egdist1', 'chords', { style: 'power8', oct: 3 }], ['cleanguitar', 'chords', { style: 'arp8', oct: 4, from: 8 }], ['rockorgan', 'chords', { style: 'pad', oct: 4 }]] },
  { id: 'edm', genre: 'edm', bpm: 128, key: 5, mode: 'minor', prog: [0, 5, 2, 6], parts: [['drums909', 'drums', { style: 'four' }], ['synbass1', 'bass', { style: 'offbeat8' }], ['supersaw', 'chords', { style: 'stab', oct: 4 }], ['synpluck', 'chords', { style: 'arp16', oct: 5, from: 4 }], ['warmpad', 'chords', { style: 'pad', oct: 3 }], ['synlead', 'lead', { from: 8 }]] },
  { id: 'bossa', genre: 'bossa nova', bpm: 86, key: 9, mode: 'minor', prog: [3, 6, 2, 5], parts: [['acousticdrums', 'drums', { style: 'bossa' }], ['upright', 'bass', { style: 'bossa' }], ['nylonguitar', 'chords', { style: 'comp', oct: 4 }], ['flute', 'lead', { from: 4, oct: 6 }]] },
  { id: 'lofi', genre: 'lo-fi hip hop', bpm: 76, key: 3, mode: 'major', prog: [1, 4, 0, 5], parts: [['acousticdrums', 'drums', { style: 'halftime' }], ['rhodes', 'chords', { style: 'block', oct: 4 }], ['fingerbassyr', 'bass', { style: 'root4' }], ['vibraphone', 'lead', { from: 4 }]] },
  { id: 'orchestral', genre: 'orchestral', bpm: 92, key: 2, mode: 'major', prog: [0, 5, 3, 4], parts: [['strings', 'chords', { style: 'pad', oct: 4 }], ['cello', 'lead', { oct: 3, slow: true }], ['contrabass', 'bass', { style: 'long' }], ['violin', 'lead', { from: 4 }], ['horn', 'chords', { style: 'block', oct: 3, from: 4 }], ['flute', 'lead', { from: 8, oct: 6, slow: true }], ['harp', 'chords', { style: 'arp8', oct: 4 }], ['timpani', 'bass', { style: 'timp' }], ['oboe', 'lead', { from: 8, oct: 5, slow: true }]] },
  { id: 'funk', genre: 'funk', bpm: 112, key: 4, mode: 'minor', prog: [0, 3, 0, 3], parts: [['acousticdrums', 'drums', { style: 'funk' }], ['guslapbass', 'bass', { style: 'synco' }], ['clavinet', 'chords', { style: 'funkstab', oct: 4 }], ['trumpets', 'chords', { style: 'hits', oct: 4, from: 4 }], ['egclean', 'chords', { style: 'chop16', oct: 4 }]] },
  { id: 'metal', genre: 'metal', bpm: 176, key: 2, mode: 'minor', prog: [0, 5, 6, 4], parts: [['acousticdrums', 'drums', { style: 'metal' }], ['egdist2', 'bass', { style: 'follow16', oct: 3 }], ['ebass', 'bass', { style: 'follow16' }], ['egdist1', 'lead', { from: 8, oct: 5 }]] },
  { id: 'waltz', genre: 'waltz / folk (3/4)', bpm: 132, meter: 3, key: 7, mode: 'major', prog: [0, 3, 4, 0], parts: [['tuba', 'bass', { style: 'oompa' }], ['accordion', 'chords', { style: 'waltz', oct: 4 }], ['violin', 'lead', { from: 4 }], ['acoustic', 'chords', { style: 'arp8', oct: 4, from: 8 }]] },
  { id: 'trap', genre: 'trap', bpm: 140, key: 1, mode: 'minor', prog: [0, 5, 6, 4], parts: [['drums808', 'drums', { style: 'trap' }], ['sub808', 'bass', { style: 'sub' }], ['glockenspiel', 'chords', { style: 'arp8', oct: 6 }], ['padchoir', 'chords', { style: 'pad', oct: 4, from: 4 }]] },
  { id: 'citypop', genre: 'city pop', bpm: 116, key: 10, mode: 'major', prog: [3, 4, 2, 5], parts: [['acousticdrums', 'drums', { style: 'city' }], ['latelybass', 'bass', { style: 'synco' }], ['wurlitzer', 'chords', { style: 'comp', oct: 4 }], ['altosax', 'lead', { from: 4 }], ['synstrings1', 'chords', { style: 'pad', oct: 4, from: 8 }], ['marimba', 'chords', { style: 'arp16', oct: 5, from: 8 }]] },
  { id: 'jazzballad', genre: 'jazz ballad', bpm: 64, key: 5, mode: 'major', prog: [1, 4, 0, 0], parts: [['kawai', 'chords', { style: 'block', oct: 4 }], ['upright', 'bass', { style: 'root4' }], ['tenorsax', 'lead', { from: 2, oct: 4 }], ['acousticdrums', 'drums', { style: 'ballad' }]] },
  { id: 'chiptune', genre: 'chiptune', bpm: 150, key: 9, mode: 'minor', prog: [0, 5, 2, 6], parts: [['sgx0xkit', 'drums', { style: 'chip' }], ['synbass2', 'bass', { style: 'root8' }], ['chip', 'lead', { from: 4, fast: true }], ['calliope', 'chords', { style: 'arp16', oct: 5 }]] },
];

const SCALE = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] };
const DRUMS = {
  // per bar of 16 steps: note -> pattern (x loud, o soft)
  pop: { 36: 'x.......x.x.....', 38: '....x.......x...', 42: 'x.x.x.x.x.x.x.x.' },
  rock: { 36: 'x.....x.x.......', 38: '....x.......x...', 42: 'x.x.x.x.x.x.x.x.' },
  four: { 36: 'x...x...x...x...', 39: '....x.......x...', 46: '..x...x...x...x.' },
  bossa: { 36: 'x.....x.x.....x.', 37: 'x..x..x...x..x..', 42: 'x.x.x.x.x.x.x.x.' },
  halftime: { 36: 'x......x..x.....', 38: '........x.......', 42: 'x.x.x.x.x.x.x.x.' },
  funk: { 36: 'x.....x...x.....', 38: '....x..o.o..x..o', 42: 'xoxoxoxoxoxoxoxo' },
  metal: { 36: 'xxxxxxxxxxxxxxxx', 38: '....x.......x...', 51: 'x...x...x...x...' },
  trap: { 36: 'x......x..x.....', 38: '........x.......', 42: 'x.x.x.x.xxx.x.xx' },
  city: { 36: 'x.....x.x.......', 38: '....x.......x...', 42: 'xoxoxoxoxoxoxoxo', 46: '..............x.' },
  ballad: { 36: 'x.......x.......', 37: '....x.......x...', 51: 'x...x...x...x...' },
  chip: { 36: 'x...x...x...x...', 38: '....x.......x...', 42: 'xxxxxxxxxxxxxxxx' },
};

function makeSong(song, seedBase) {
  let seed = (seedBase * 7919 + song.id.split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 7)) % 2147483647 || 1;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const meter = song.meter || 4, spb = meter * 4; // 16th steps per bar
  const barSec = (60 / song.bpm) * meter;
  const bars = Math.max(8, Math.min(24, Math.round(40 / barSec / 4) * 4)); // about 40 s
  const sc = SCALE[song.mode];
  const deg = (d, oct) => song.key + 12 * oct + sc[((d % 7) + 7) % 7] + 12 * Math.floor(d / 7);
  const triad = (d, oct) => [deg(d, oct), deg(d + 2, oct), deg(d + 4, oct)];
  const chordAt = (b) => song.prog[b % song.prog.length];
  const vel = (base) => Math.max(40, Math.min(120, Math.round(base + (rnd() - 0.5) * 16)));
  const gen = {
    drums: (o, out) => {
      const pat = DRUMS[o.style];
      for (let b = 0; b < bars; b++) for (const [n, p] of Object.entries(pat)) for (let s = 0; s < spb; s++) {
        const c = p[s % 16];
        if (c === 'x' || c === 'o') out.push({ s: b * spb + s, l: 1, n: +n, v: c === 'x' ? vel(n == 36 ? 112 : n == 38 ? 104 : 84) : vel(60) });
      }
      for (let b = 0; b < bars; b += 4) out.push({ s: b * spb, l: 2, n: 49, v: vel(100) });
    },
    bass: (o, out) => {
      const oct = o.oct ?? 2;
      for (let b = 0; b < bars; b++) {
        const r = deg(chordAt(b), oct), f = deg(chordAt(b) + 4, oct), at = b * spb;
        const put = (s, l, n) => out.push({ s: at + s, l, n, v: vel(96) });
        switch (o.style) {
          case 'root8': for (let s = 0; s < spb; s += 2) put(s, 2, s === 6 || s === 14 ? r + 12 : r); break;
          case 'root4': for (let s = 0; s < spb; s += 4) put(s, 3, s % 8 ? f : r); break;
          case 'synco': [[0, 2, r], [3, 1, r + 12], [6, 2, r], [8, 1, f], [10, 2, r], [13, 1, r + 12], [14, 2, f]].forEach(([s, l, n]) => put(s, l, n)); break;
          case 'offbeat8': for (let s = 2; s < spb; s += 4) put(s, 2, r); break;
          case 'sub': put(0, 7, r); put(10, 6, r); break;
          case 'bossa': put(0, 5, r); put(6, 2, f); put(8, 5, r); put(14, 2, f); break;
          case 'follow16': for (let s = 0; s < spb; s++) put(s, 1, s % 8 === 7 ? f : r); break;
          case 'oompa': put(0, 3, b % 2 ? f : r); break;
          case 'long': put(0, spb - 1, r); break;
          case 'timp': put(0, 3, deg(chordAt(b), 3) % 12 + 41 > 55 ? deg(chordAt(b), 3) % 12 + 29 : deg(chordAt(b), 3) % 12 + 41); if (b % 4 === 3) put(12, 2, r + 12); break;
        }
      }
    },
    chords: (o, out) => {
      const from = o.from || 0;
      for (let b = from; b < bars; b++) {
        const ch = triad(chordAt(b), o.oct), at = b * spb;
        const all = (s, l, notes = ch, v = 88) => notes.forEach((n) => out.push({ s: at + s, l, n, v: vel(v) }));
        switch (o.style) {
          case 'block': all(0, 8); all(8, spb - 8); break;
          case 'pad': all(0, spb - 1, ch, 76); break;
          case 'stab': for (let s = 2; s < spb; s += 4) all(s, 1, ch, 92); break;
          case 'arp8': { const tones = [...ch, ...ch.map((n) => n + 12)]; for (let s = 0, i = 0; s < spb; s += 2, i++) out.push({ s: at + s, l: 2, n: tones[i % tones.length], v: vel(84) }); break; }
          case 'arp16': { const tones = [ch[0], ch[1], ch[2], ch[0] + 12, ch[2], ch[1]]; for (let s = 0; s < spb; s++) out.push({ s: at + s, l: 1, n: tones[s % tones.length], v: vel(80) }); break; }
          case 'comp': [[0, 2], [3, 2], [6, 2], [10, 2], [12, 3]].forEach(([s, l]) => all(s, l, ch, 80)); break;
          case 'power8': { const r = deg(chordAt(b), o.oct); for (let s = 0; s < spb; s += 2) all(s, 2, [r, r + 7, r + 12], 96); break; }
          case 'funkstab': [2, 7, 10, 15].forEach((s) => all(s, 1, ch, 92)); break;
          case 'hits': if (b % 2 === 1) { all(0, 2, ch, 104); all(6, 2, ch, 104); } break;
          case 'chop16': for (let s = 0; s < spb; s++) if ('x.xx.x.xx.x.x.xx'[s] === 'x') all(s, 1, [ch[1] + 12, ch[2] + 12], 70); break;
          case 'waltz': all(4, 3, ch, 80); all(8, 3, ch, 80); break;
        }
      }
    },
    lead: (o, out) => {
      const oct = o.oct ?? 5, from = o.from || 0;
      const RH = o.fast ? [[2, 2, 2, 2, 2, 2, 2, 2], [1, 1, 2, 2, 2, 4, 4], [2, 2, 4, 2, 2, 4]]
        : o.slow ? [[8, 8], [12, 4], [4, 4, 8], [16]]
          : [[4, 4, 4, 4], [2, 2, 4, 4, 4], [6, 2, 4, 4], [4, 2, 2, 8], [3, 3, 2, 8], [8, 4, 4]];
      let d = 2; // scale degree around the chord
      for (let b = from; b < bars; b++) {
        let rh = pick(RH); const sum = rh.reduce((a, x) => a + x, 0);
        if (sum !== spb) rh = meter === 3 ? pick([[4, 4, 4], [6, 2, 4], [8, 4], [12]]) : rh;
        let s = 0;
        for (const l of rh) {
          // chord tones on strong steps, steps of the scale between
          const strong = s % 4 === 0, c = chordAt(b);
          d = strong ? c + pick([0, 2, 4]) + (d > c + 4 ? 7 : 0) * (rnd() < 0.3 ? 1 : 0) : d + pick([-1, 1, 1, 2, -2]);
          d = Math.max(c - 2, Math.min(c + 9, d));
          out.push({ s: b * spb + s, l: Math.max(1, l - (l > 2 ? 1 : 0)), n: deg(d, oct), v: vel(96) });
          s += l;
        }
      }
    },
  };
  const parts = song.parts.map(([inst, g, o], i) => { const out = []; gen[g](o, out); return { role: `${g}${i}`, gen: g, inst, notes: out }; });
  // every note also in seconds from the start, and its 16th step (what the scorer and oracle use)
  const step = PPQ / 4, s16 = (step / PPQ) * (60 / song.bpm);
  for (const part of parts) for (const q of part.notes) { q.t = q.s * s16; q.d = (q.l * step - 4) / PPQ * 60 / song.bpm; q.step = q.s; }
  const beats = [], downbeats = [];
  for (let b = 0; b <= bars * meter; b++) { beats.push(b * 60 / song.bpm); if (b % meter === 0) downbeats.push(beats.at(-1)); }
  return { ...song, meter, spb, bars, barSec, parts, beats, downbeats, tempoChanges: 0 };
}

// ---------- real MIDI files (args.real: [{ id, genre }], the file copied in as <id>.src.mid) ----------
// Parts get the instruments the piano window would give them (General MIDI program or part name);
// the reference grid is the file's own tempo map: a note's 16th step is its tick / (division / 4).
const GM = await imp('js/gm.js');
const { parseMidi } = await imp('js/score/midi.js');
function midiMaps(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), division = dv.getUint16(12);
  const tempos = [], sigs = [];
  let p = 14, maxTick = 0;
  while (p + 8 <= bytes.length) {
    const id = String.fromCharCode(...bytes.subarray(p, p + 4)), len = dv.getUint32(p + 4), end = p + 8 + len;
    if (id === 'MTrk') {
      let i = p + 8, t = 0, rs = 0;
      const vlq = () => { let v = 0, c; do { c = bytes[i++]; v = (v << 7) | (c & 127); } while (c & 128); return v; };
      while (i < end) {
        t += vlq(); let s = bytes[i];
        if (s === 0xff) { i++; const ty = bytes[i++], l = vlq(); if (ty === 0x51) tempos.push({ tick: t, usq: (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2] }); if (ty === 0x58) sigs.push({ tick: t, num: bytes[i], den: 1 << bytes[i + 1] }); i += l; continue; }
        if (s === 0xf0 || s === 0xf7) { i++; i += vlq(); continue; }
        if (s & 0x80) { rs = s; i++; } else s = rs;
        const hi = s & 0xf0; if (hi === 0x90 && bytes[i + 1] > 0) maxTick = Math.max(maxTick, t);
        i += hi === 0xc0 || hi === 0xd0 ? 1 : 2;
      }
    }
    p = end;
  }
  tempos.sort((a, b) => a.tick - b.tick); if (!tempos.length || tempos[0].tick > 0) tempos.unshift({ tick: 0, usq: 500000 });
  sigs.sort((a, b) => a.tick - b.tick); if (!sigs.length || sigs[0].tick > 0) sigs.unshift({ tick: 0, num: 4, den: 4 });
  const segs = []; let sec = 0;
  tempos.forEach((x, i) => { segs.push({ ...x, sec }); if (i + 1 < tempos.length) sec += ((tempos[i + 1].tick - x.tick) / division) * (x.usq / 1e6); });
  const toTick = (s) => { let g = segs[0]; for (const x of segs) { if (x.sec <= s) g = x; else break; } return g.tick + ((s - g.sec) / (g.usq / 1e6)) * division; };
  const toSec = (tk) => { let g = segs[0]; for (const x of segs) { if (x.tick <= tk) g = x; else break; } return g.sec + ((tk - g.tick) / division) * (g.usq / 1e6); };
  // the tempo and meter that cover the most of the song
  const span = (list, key) => { const w = new Map(); list.forEach((x, i) => { const a = x.tick, b = Math.min(maxTick, list[i + 1]?.tick ?? maxTick); if (b > a) w.set(key(x), (w.get(key(x)) || 0) + toSec(b) - toSec(a)); }); return [...w.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]; };
  const bpm = +span(tempos, (x) => +(6e7 / x.usq).toFixed(2));
  const meter = span(sigs, (x) => x.num);
  const beats = [], downbeats = [];
  let sigI = 0, barStart = 0;
  for (let tk = 0; tk <= maxTick + division * 4; tk += division) {
    while (sigI + 1 < sigs.length && sigs[sigI + 1].tick <= tk) { sigI++; barStart = sigs[sigI].tick; }
    beats.push(toSec(tk));
    if (((tk - barStart) / division) % sigs[sigI].num === 0) downbeats.push(toSec(tk));
  }
  return { division, toTick, toSec, bpm, meter, beats, downbeats, tempoChanges: new Set(tempos.map((x) => x.usq)).size - 1, sigChanges: new Set(sigs.map((x) => x.num)).size - 1 };
}
async function realSong(spec) {
  const bytes = new Uint8Array(await window.melofi.testRead(`${spec.id}.src.mid`) || []);
  if (!bytes.length) throw new Error(`${spec.id}.src.mid missing`);
  const song = parseMidi(bytes, spec.id), mm = midiMaps(bytes);
  const kit = GM.kitFor(A.instruments), parts = [];
  for (const line of song.lines) {
    if (!line.notes.length) continue;
    const a = GM.instrumentFor(line, A.instruments, kit);
    if (a.inst === null) continue; // sound effects with nothing to play them
    const inst = a.inst === 'piano' ? 'splendid' : a.inst;
    parts.push({ role: line.name, gen: a.kit ? 'drums' : 'part', inst, notes: line.notes.map((x) => ({ t: x.t, d: x.d, n: a.kit ? GM.drumNote(a.kind, line, x.n) : x.n, v: x.v || 90, step: Math.round(mm.toTick(x.t) / (mm.division / 4)) })) });
  }
  const end = Math.max(...parts.flatMap((x) => x.notes.map((q) => q.t + q.d)));
  return { ...spec, real: true, bpm: mm.bpm, meter: mm.meter, parts, beats: mm.beats.filter((b) => b <= end + 2), downbeats: mm.downbeats.filter((b) => b <= end + 2), tempoChanges: mm.tempoChanges, sigChanges: mm.sigChanges, seconds: end };
}
function projectReal(song) {
  const p = newProject(); p.bpm = song.bpm; p.sig = [song.meter, 4]; p.master.fx = [];
  p.name = `roundtrip ${song.id}`;
  const tk = (s) => Math.round((s * song.bpm * PPQ) / 60);
  let endT = 0;
  p.channels = [];
  const pat = newPattern(0, 1); pat.notes = {};
  for (const part of song.parts) {
    const kit = S.isKit(part.inst);
    const ch = M.channelFor(S, part.inst, part.role, p.channels.length, { vol: kit ? 0.8 : 0.6, send: 0.1 });
    p.channels.push(ch);
    pat.notes[ch.id] = part.notes.map((x) => { const t = tk(x.t), d = Math.max(6, tk(x.d)); endT = Math.max(endT, t + d); return { t, d, n: x.n, v: x.v }; });
  }
  pat.bars = Math.max(1, Math.ceil(endT / (PPQ * 4 * song.meter / 4)));
  p.patterns = [pat]; p.current = pat.id; p.playlist.clips = []; p.selected = p.channels[0].id;
  return p;
}
async function prepare(s) {
  if (s.real) { const song = await realSong(s); return { song, p: projectReal(song) }; }
  const song = makeSong(s, seedBase); return { song, p: project(song) };
}

function project(song) {
  const p = newProject(); p.bpm = song.bpm; p.sig = [song.meter, 4]; p.master.fx = [];
  p.name = `roundtrip ${song.id}`;
  const step = PPQ / 4;
  const pat = newPattern(0, song.bars); pat.notes = {};
  p.channels = [];
  for (const part of song.parts) {
    const kit = S.isKit(part.inst);
    const ch = M.channelFor(S, part.inst, part.role, p.channels.length, { vol: kit ? 0.8 : part.gen === 'chords' ? 0.6 : 0.7, send: 0.1 });
    p.channels.push(ch);
    pat.notes[ch.id] = part.notes.map((x) => ({ t: x.s * step, d: Math.max(step / 2, x.l * step - 4), n: x.n, v: x.v }));
  }
  p.patterns = [pat]; p.current = pat.id; p.playlist.clips = []; p.selected = p.channels[0].id;
  return p;
}

const famOf = (id) => (S.isKit(id) ? 'drums' : A.instruments.find((i) => i.id === id)?.family || (String(id).startsWith('synth') ? 'synth' : 'other'));
const seedBase = args.seed ?? 1;
const songs = [...(args.real ? [] : SONGS), ...(args.real || []).map((r) => ({ ...r, real: true }))].filter((s) => !args.only || args.only.includes(s.id));
const phase = args.phase || 'all';

// ---------- render: reference MIDI + MP3 ----------
if (phase === 'render' || phase === 'all') {
  for (const s of songs) {
    if (await window.melofi.testRead(`${s.id}.mp3`)) { log('RENDERED', { id: s.id, skipped: true }); continue; }
    let song, p;
    try { ({ song, p } = await prepare(s)); } catch (err) { log('RENDERFAIL', { id: s.id, why: err.message }); continue; }
    const missing = song.parts.filter((x) => !A.instruments.find((i) => i.id === x.inst)?.installed).map((x) => x.inst);
    if (missing.length) { log('RENDERFAIL', { id: s.id, missing }); continue; }
    const mixed = await io.renderMix(p, { tail: 2, rate: 44100 });
    const OFFSET = 0.05; // renderMix starts the song 50 ms in
    const bytes = await mp3(mixed, 192);
    await window.melofi.testWrite(`${s.id}.mp3`, bytes);
    await window.melofi.testWrite(`${s.id}.truth.mid`, io.projectToMidi(p, (id) => S.isKit(id)));
    const truth = {
      id: s.id, genre: s.genre, bpm: song.bpm, meter: song.meter, bars: song.bars, seed: s.real ? null : seedBase, offset: OFFSET, ppq: PPQ, real: !!s.real,
      tempoChanges: song.tempoChanges || 0, sigChanges: song.sigChanges || 0,
      parts: song.parts.map((x) => ({ role: x.role, gen: x.gen, inst: x.inst, family: famOf(x.inst), kit: S.isKit(x.inst),
        notes: x.notes.map((q) => [+(OFFSET + q.t).toFixed(4), +q.d.toFixed(4), q.n, q.v, q.step]) })),
    };
    await window.melofi.testWrite(`${s.id}.truth.json`, JSON.stringify(truth));
    log('RENDERED', { id: s.id, sec: +(mixed.left.length / 44100).toFixed(1), parts: song.parts.length, notes: song.parts.reduce((a, x) => a + x.notes.length, 0) });
  }
}


// ---------- from a separated folder to the MIDI result (shared by run and oracle) ----------
const readJson = async (f) => { const b = await window.melofi.stemsRead(f); return b ? JSON.parse(new TextDecoder().decode(b)) : null; };
async function convertDir(id, dir, suffix, T, lap) {
  const ins = await window.melofi.stemsInstruments(dir);
  if (!ins.ok) throw new Error('instruments: ' + ins.message);
  lap('recognise');
  const r = await readJson(`${dir}\\result.json`), inst = await readJson(`${dir}\\instruments.json`);
  // the MuScriptor run asked for (args.mus) is the instrument-label hint, as the app passes it;
  // without it the saved result's last MuScriptor run must not leak into the default path
  r.muscriptor = args.mus && args.mus !== 'off' ? r.muscriptor_runs?.[args.mus] || r.muscriptor || null : null;
  // labels: 'file' takes the instrument labels saved beside the result (labels.json: tools/stems/labels_ymt3.py)
  if (args.labels === 'file') { const lb = await readJson(`${dir}\\labels.json`); if (lb?.parts) r.labels = lb; }
  // piano / bass / vocal: 'file' takes that stem's notes from its own model where it applies (piano_notes.json,
  // bass_notes.json, vocal_notes.json beside the result: tools/stems/*_notes.py)
  for (const [arg, k, file] of [['piano', 'piano', 'piano_notes'], ['bass', 'bass', 'bass_notes'], ['vocal', 'vocals', 'vocal_notes']]) {
    if (args[arg] === 'file') { const pn = await readJson(`${dir}\\${file}.json`); if (pn) M.useModelNotes(r, k, pn); }
  }
  const plan = M.sections(r, inst);
  await M.matchAll(S, r, plan, { octaves: args.octaves !== false, hints: args.hints !== false, stemInst: args.stemInst !== false });
  lap('match');
  // the app's batch conversion: every stem, the best match of each part, stray parts left out
  const choice = {};
  for (const [k, groups] of Object.entries(plan.stems)) for (const g of groups) choice[`${k}:${g.cat}`] = g.stray ? null : M.candidates(S, k, g)[0]?.id || null;
  const p = await M.buildAssigned(r, plan, choice, `${id}.mp3`, S, { audio: false });
  await window.melofi.testWrite(`${id}.${suffix}.mid`, io.projectToMidi(p, (x) => S.isKit(x)));
  const t0 = p.stemsRef?.t0 ?? r.first_downbeat ?? 0;
  // (a channel cut from the stem itself plays the song's own sound: inst "stem", family "stem")
  const chans = p.channels.map((c) => (c.stemInst ? { id: c.id, name: c.name, inst: 'stem', family: 'stem', kit: c.stemInst === 'drums', stemInst: c.stemInst, cuts: c.sample?.cuts?.length || 0 }
    : { id: c.id, name: c.name, inst: c.inst, family: famOf(c.inst), kit: S.isKit(c.inst), ...(c.layerOf ? { layerOf: c.layerOf } : {}) }));
  const evs = eventsFor({ ...p, mode: 'song' }, 'song').events.filter((e) => e.type === 'n');
  const notes = evs.map((e) => [Math.round(e.tick), Math.round(e.d), e.n, e.v, chans.findIndex((c) => c.id === e.ch), +(tickToSec(p, e.tick, 'song') + t0).toFixed(4)]);
  lap('build');
  // per part: the pick by listening (rendered notes) and by fingerprint alone (pre-screen), so
  // the scorer can say how often the cheap stage would have chosen the same
  const groups = [];
  for (const [k, gs] of Object.entries(plan.stems)) for (const g of gs) {
    const c = g.match?.cands || [];
    const byPre = c.filter((x) => x.pre != null).sort((a, b) => b.pre - a.pre)[0];
    groups.push({ stem: k, cat: g.cat, stray: !!g.stray, pick: c[0]?.id || null, acc: c[0]?.acc ?? null, prePick: byPre?.id || null, top: c.slice(0, 5).map((x) => [x.id, x.acc, x.pre]) });
  }
  // how close the converted sound is to the original stem: every stem's converted channels are
  // rendered (up to 45 s from the stem's first note) and compared with the stem over the same
  // stretch, log-mel band by band (timbreSim below). This is the instrument score of the new
  // criteria: not "was the right preset picked" but "does it sound like the recording".
  const timbre = {};
  if (args.timbre !== false) {
    for (const k of Object.keys(plan.stems)) {
      const mine = p.channels.filter((c) => c.conv === k && !c.mute);
      if (!mine.length || !r.stems[k]) continue;
      try {
        const st = await M.stemAudio(r.stems[k]);
        const first = M.stemNotes(r, k)[0]?.[0] ?? t0, a = Math.max(t0, first - 0.5), len = Math.min(45, r.duration - a);
        let y = null, rate = 44100;
        for (const c of mine) {
          const m = await io.renderMix(p, { only: c.id, tail: 0.5, rate, noMaster: true });
          if (!y) y = new Float32Array(m.left.length);
          for (let i = 0; i < Math.min(y.length, m.left.length); i++) y[i] += 0.5 * (m.left[i] + m.right[i]);
        }
        // the render starts 50 ms in; project time 0 is t0 in the recording
        const o0 = Math.round((0.05 + (a - t0)) * rate), n = Math.round(len * rate);
        timbre[k] = { ...timbreSim(st.x.subarray(Math.round(a * st.rate), Math.round(a * st.rate) + n), y.subarray(o0, o0 + n), rate), channels: mine.length, stemInst: mine.some((c) => c.stemInst) };
      } catch (err) { timbre[k] = { sim: null, error: String(err.message || err) }; }
    }
    lap('timbre');
  }
  const out = { id, kind: suffix, bpm: p.bpm, sig: p.sig, sigs: p.sigs || [], tempos: p.tempos || [], ppq: PPQ, t0, detected: { bpm: r.bpm, meter: r.meter }, timbre, channels: chans, notes, choice, groups, times: T, dir };
  await window.melofi.testWrite(`${id}.${suffix}.json`, JSON.stringify(out));
  log('DONE', { id, kind: suffix, channels: chans.length, notes: notes.length, times: T });
}
// log-mel similarity of two mono signals of the same stretch (x: the stem, y: the render), 0..100.
// 40 mel bands, 46 ms frames; each signal's level is taken out (its mean over the frames where the
// stem sounds), then the mean absolute difference in dB over those frames and bands: 0 dB -> 100,
// 24 dB -> 0. Also the same for the time-averaged spectrum alone (the colour, without the timing).
const WT = await imp('studio/wavetable.js');
function timbreSim(x, y, rate) {
  const N = 2048, H = 1024, B = 40, n = Math.min(x.length, y.length);
  if (n < N * 4) return { sim: null };
  const hz2mel = (f) => 2595 * Math.log10(1 + f / 700), mel2hz = (m) => 700 * (10 ** (m / 2595) - 1);
  const edges = Array.from({ length: B + 2 }, (_, i) => mel2hz((hz2mel(Math.min(8000, rate / 2)) - hz2mel(40)) * i / (B + 1) + hz2mel(40)) * N / rate);
  const win = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
  const mel = (s) => {
    const frames = [];
    for (let a = 0; a + N <= n; a += H) {
      const re = new Float64Array(N), im = new Float64Array(N);
      for (let i = 0; i < N; i++) re[i] = s[a + i] * win[i];
      WT.fft(re, im, false);
      const band = new Float64Array(B);
      for (let b = 0; b < B; b++) {
        let e = 0;
        for (let k = Math.max(1, Math.floor(edges[b])); k <= Math.min(N / 2 - 1, Math.ceil(edges[b + 2])); k++) {
          const w = k < edges[b + 1] ? (k - edges[b]) / (edges[b + 1] - edges[b] || 1) : (edges[b + 2] - k) / (edges[b + 2] - edges[b + 1] || 1);
          if (w > 0) e += w * (re[k] * re[k] + im[k] * im[k]);
        }
        band[b] = 10 * Math.log10(e + 1e-12);
      }
      frames.push(band);
    }
    return frames;
  };
  const X = mel(x), Y = mel(y);
  const lvl = (f) => { let m = -Infinity; for (const v of f) if (v > m) m = v; return m; };
  const top = Math.max(...X.map(lvl)), act = X.map((f, i) => i).filter((i) => lvl(X[i]) > top - 45);
  if (act.length < 8) return { sim: null };
  const mean = (F) => { let s2 = 0, c = 0; for (const i of act) for (const v of F[i]) { s2 += Math.max(v, top - 80); c++; } return s2 / c; };
  const mx = mean(X), my = mean(Y);
  let d = 0, c = 0;
  const ax = new Float64Array(B), ay = new Float64Array(B);
  for (const i of act) for (let b = 0; b < B; b++) {
    const u = Math.max(X[i][b], top - 80) - mx, v = Math.max(Y[i][b], top - 80 - mx + my) - my;
    d += Math.abs(u - v); c++; ax[b] += u / act.length; ay[b] += v / act.length;
  }
  let dc = 0; for (let b = 0; b < B; b++) dc += Math.abs(ax[b] - ay[b]) / B;
  const to = (db) => Math.round(1000 * Math.max(0, 1 - db / 24)) / 10;
  return { sim: to(d / c), colour: to(dc), db: +(d / c).toFixed(2), seconds: +(n / rate).toFixed(1) };
}
const timer = () => { const T = { t0: performance.now() }; return [T, (k) => { T[k] = Math.round((performance.now() - T.t0) / 1000); }]; };

// ---------- run: separation -> matching -> project -> MIDI ----------
if (phase === 'run' || phase === 'all') {
  // on the CPU a 40 s song takes over 20 minutes to separate: stop unless asked ({cpu: true})
  const eng = await window.melofi.stemsStatus();
  const list = !eng.gpu && !args.cpu ? [] : songs;
  if (!list.length && songs.length) log('RUNFAIL', { id: '*', why: 'no NVIDIA GPU for the analysis engine (pass cpu: true to run anyway)' });
  for (const s of list) {
    if (await window.melofi.testRead(`${s.id}.out.json`)) { log('DONE', { id: s.id, skipped: true }); continue; }
    const data = await window.melofi.testRead(`${s.id}.mp3`);
    if (!data) { log('RUNFAIL', { id: s.id, why: 'no mp3' }); continue; }
    const [T, lap] = timer();
    try {
      const r0 = await window.melofi.stemsRun({ data: new Uint8Array(data), name: `${s.id}.mp3`, quick: false, muscriptor: args.mus || 'off', fresh: !!args.fresh });
      if (!r0.ok) throw new Error('separation: ' + r0.message);
      lap('separate');
      await convertDir(s.id, Object.values(r0.result.stems)[0].replace(/[\\/]stems[\\/][^\\/]+$/, ''), 'out', T, lap);
    } catch (err) {
      log('RUNFAIL', { id: s.id, why: String(err?.message || err).split('\n')[0] });
    }
  }
}

// ---------- oracle: perfect stems and notes, then the same matching and build ----------
// Each part is rendered alone and summed into the stem a 6-stem separator would put it in, with
// its true notes as the transcription and the true beat grid. What this run loses is lost after
// the separation (matching, building the project); the gap to the real run is the separation
// and transcription's share. Needs no GPU. args.cacheDir: the Windows path of
// <userData>\stems-cache\oracle, a junction to the run folder (tools/roundtrip.sh makes it).
// MuScriptor's categories (ai.js MUS) for the instruments of the songs, and per family otherwise
const LABEL = {
  strings: 'string_ensemble', cello: 'cello', contrabass: 'contrabass', violin: 'violin', horn: 'french_horn', flute: 'flutes', harp: 'orchestral_harp',
  timpani: 'timpani', oboe: 'oboe', tuba: 'tuba', accordion: 'organ', acoustic: 'acoustic_guitar', nylonguitar: 'acoustic_guitar', glockenspiel: 'chromatic_percussion',
  marimba: 'chromatic_percussion', vibraphone: 'chromatic_percussion', padchoir: 'voice', wurlitzer: 'electric_piano', rhodes: 'electric_piano', clavinet: 'electric_piano',
  altosax: 'soprano_and_alto_sax', tenorsax: 'tenor_sax', synstrings1: 'synth_strings', trumpets: 'brass_section', egclean: 'clean_electric_guitar',
  cleanguitar: 'clean_electric_guitar', egdist1: 'distorted_electric_guitar', egdist2: 'distorted_electric_guitar', rockorgan: 'organ', upright: 'acoustic_bass',
  fingerbass: 'electric_bass', ebass: 'electric_bass', guslapbass: 'electric_bass', latelybass: 'electric_bass', fingerbassyr: 'electric_bass',
  synbass1: 'electric_bass', synbass2: 'electric_bass', sub808: 'electric_bass', supersaw: 'synth_lead', synlead: 'synth_lead', chip: 'synth_lead',
  synpluck: 'synth_lead', calliope: 'synth_lead', warmpad: 'synth_pad', splendid: 'acoustic_piano', kawai: 'acoustic_piano',
};
const LABEL_FAM = { piano: 'acoustic_piano', keys: 'electric_piano', guitar: 'clean_electric_guitar', bass: 'electric_bass', strings: 'string_ensemble', brass: 'brass_section', synth: 'synth_lead' };
// each part's notes under the category a multi-instrument transcription would give it
function oracleLabels(song, OFFSET) {
  const parts = {};
  for (const part of song.parts) {
    if (S.isKit(part.inst)) continue;
    const c = LABEL[part.inst] || LABEL_FAM[famOf(part.inst)] || 'synth_lead';
    (parts[c] ||= []).push(...part.notes.map((q) => [+(OFFSET + q.t).toFixed(4), +q.d.toFixed(4), q.n, q.v]));
  }
  return { source: 'oracle', parts };
}
if (phase === 'oracle') {
  const { encodeWav } = await imp('js/recorder.js');
  const stemOf = (part) => {
    const f = famOf(part.inst);
    return f === 'drums' ? 'drums' : f === 'bass' ? 'bass' : f === 'guitar' ? 'guitar' : f === 'piano' || f === 'keys' ? 'piano' : 'other';
  };
  for (const s of songs) {
    if (await window.melofi.testRead(`${s.id}.oracle.json`)) { log('DONE', { id: s.id, kind: 'oracle', skipped: true }); continue; }
    const [T, lap] = timer();
    try {
      if (!args.cacheDir) throw new Error('cacheDir missing');
      const { song, p } = await prepare(s);
      const folder = `oracle-${s.id}`, dir = `${args.cacheDir}\\${folder}`;
      const OFFSET = 0.05;
      // rendered before (the folder copied in from an earlier oracle run): only matching and build
      // again (a long song's parts take half an hour to render one by one)
      const prev = await readJson(`${dir}\\result.json`);
      if (prev) {
        for (const k of Object.keys(prev.stems)) prev.stems[k] = `${dir}\\${k}.wav`;
        delete prev.labels;
        if (args.labels) prev.labels = oracleLabels(song, OFFSET);
        await window.melofi.testWrite(`${folder}/result.json`, JSON.stringify(prev));
        lap('render');
        await convertDir(s.id, dir, 'oracle', T, lap);
        continue;
      }
      const groups = {};
      song.parts.forEach((part, i) => { (groups[stemOf(part)] ||= []).push(i); });
      const stems = {}, notes = {};
      let duration = 0;
      for (const [k, idx] of Object.entries(groups)) {
        let L = null, R = null;
        for (const i of idx) {
          const m = await io.renderMix(p, { only: p.channels[i].id, tail: 2, rate: 44100 });
          if (!L) { L = new Float32Array(m.left.length); R = new Float32Array(m.right.length); }
          for (let j = 0; j < Math.min(L.length, m.left.length); j++) { L[j] += m.left[j]; R[j] += m.right[j]; }
        }
        duration = Math.max(duration, L.length / 44100);
        await window.melofi.testWrite(`${folder}/${k}.wav`, encodeWav({ left: L, right: R, rate: 44100 }));
        stems[k] = `${dir}\\${k}.wav`;
        if (k !== 'drums') notes[k] = idx.flatMap((i) => song.parts[i].notes.map((q) => [+(OFFSET + q.t).toFixed(4), +q.d.toFixed(4), q.n, q.v])).sort((a, b) => a[0] - b[0]);
      }
      const drums = (groups.drums || []).flatMap((i) => song.parts[i].notes.map((q) => [+(OFFSET + q.t).toFixed(4), q.n, q.v])).sort((a, b) => a[0] - b[0]);
      const beats = song.beats.map((b) => +(OFFSET + b).toFixed(4)).filter((b) => b < duration);
      const downbeats = song.downbeats.map((b) => +(OFFSET + b).toFixed(4)).filter((b) => b < duration);
      const result = { version: 1, engine: 'oracle', device: 'oracle', duration: +duration.toFixed(3), bpm: song.bpm, meter: song.meter, beats, downbeats, first_downbeat: OFFSET,
        key: { root: s.key ?? 0, mode: s.mode || 'major', confidence: 1 }, stems, notes, drums, models: { oracle: 'perfect stems and notes' } };
      if (args.labels) result.labels = oracleLabels(song, OFFSET);
      await window.melofi.testWrite(`${folder}/result.json`, JSON.stringify(result));
      lap('render');
      await convertDir(s.id, dir, 'oracle', T, lap);
    } catch (err) {
      log('RUNFAIL', { id: s.id, kind: 'oracle', why: String(err?.message || err).split('\n')[0] });
    }
  }
}
console.log('ROUNDTRIP-END');
return [10];
