// i18n: source table — every Korean string here is UI text and a translation key; the screen that shows it calls t() (docs/i18n.md)
// Riff Machine (FL Studio's piano roll tool): a riff is built in stages, each working on the notes
// the previous one made — Chord progression → Arpeggiate → Groove → Mirror → Levels. Every stage
// is a pure function of (notes, options, seed), so going back and changing an earlier stage simply
// rebuilds the later ones.
import { STEP, SCALES } from './model.js';

export const STAGES = [
  { id: 'progression', name: 'Chord progression', ko: '코드 진행' },
  { id: 'arpeggiate', name: 'Arpeggiate', ko: '아르페지오' },
  { id: 'groove', name: 'Groove', ko: '리듬' },
  { id: 'mirror', name: 'Mirror', ko: '변형' },
  { id: 'levels', name: 'Levels', ko: '벨로시티·길이' },
];

export const PROGRESSIONS = {
  pop: { name: 'I–V–vi–IV (팝)', major: [0, 4, 5, 3], minor: [0, 6, 5, 4] },
  axis: { name: 'vi–IV–I–V', major: [5, 3, 0, 4], minor: [0, 5, 2, 6] },
  fifties: { name: 'I–vi–IV–V (50년대)', major: [0, 5, 3, 4], minor: [0, 5, 3, 4] },
  sad: { name: 'i–VI–III–VII (단조 팝)', major: [5, 3, 0, 4], minor: [0, 5, 2, 6] },
  canon: { name: '캐논', major: [0, 4, 5, 2, 3, 0, 3, 4], minor: [0, 4, 5, 2, 3, 0, 3, 4] },
  jazz: { name: 'ii–V–I', major: [1, 4, 0, 0], minor: [1, 4, 0, 0] },
  random: { name: '무작위', major: null, minor: null },
};

export const GROOVES = {
  straight: { name: '고르게 (1/8)', mask: 'x.x.x.x.x.x.x.x.' },
  sixteen: { name: '1/16 연속', mask: 'xxxxxxxxxxxxxxxx' },
  offbeat: { name: '오프비트', mask: '..x...x...x...x.' },
  dotted: { name: '점8분 (3-3-2)', mask: 'x..x..x.x..x..x.' },
  syncop: { name: '싱코페이션', mask: 'x..x..x...x.x...' },
  reggaeton: { name: '뎀보 (3-3-2 변형)', mask: 'x..x...xx..x...x' },
  sparse: { name: '드문드문', mask: 'x.......x...x...' },
  random: { name: '무작위', mask: null },
};

export function rng(seed) {
  let a = seed >>> 0 || 1;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const stepsOf = (scale) => SCALES[scale?.type]?.steps || SCALES.minor.steps;
function degreeNote(scale, d, base) {
  const st = stepsOf(scale), n = st.length, o = Math.floor(d / n), k = ((d % n) + n) % n;
  return base + (scale?.root ?? 0) + st[k] + 12 * o;
}

export const DEFAULTS = {
  progression: { prog: 'pop', bars: 4, perBar: 1, size: 3, octave: 4, invert: true },
  arpeggiate: { mode: 'off', rate: 2, range: 1, gate: 0.9 },
  groove: { groove: 'straight', density: 1, swing: 0 },
  mirror: { flipH: false, flipV: false, octave: 0, mutate: 0 },
  levels: { vel: 92, spread: 18, accent: true, legato: false },
};

// stage 1: chords, one (or two) per bar, voiced close around the chosen octave
function progression(scale, o, r) {
  const fam = scale?.type === 'major' || scale?.type === 'mixolydian' || scale?.type === 'pentaMajor' ? 'major' : 'minor';
  const n = o.bars * o.perBar;
  let degs = PROGRESSIONS[o.prog]?.[fam];
  if (!degs) degs = Array.from({ length: 4 }, (_, i) => (i === 0 ? 0 : Math.floor(r() * 7)));
  const len = (16 / o.perBar) * STEP, base = 12 * (o.octave + 1) - 12;
  const out = [];
  let prev = null;
  for (let i = 0; i < n; i++) {
    const d = degs[i % degs.length];
    let ch = Array.from({ length: o.size }, (_, k) => degreeNote(scale, d + k * 2, base + 12));
    // smooth voice leading: move each chord as close as possible to the previous one
    if (o.invert && prev) {
      const centre = prev.reduce((a, b) => a + b, 0) / prev.length;
      ch = ch.map((x) => { let y = x; while (y - centre > 6) y -= 12; while (centre - y > 6) y += 12; return y; }).sort((a, b) => a - b);
    }
    prev = ch;
    for (const nn of ch) out.push({ t: i * len, d: len - 2, n: nn, v: 90 });
  }
  return out;
}

// stage 2: spread each chord out in time
function arpeggiate(notes, o, r) {
  if (o.mode === 'off') return notes.map((x) => ({ ...x }));
  const byT = new Map();
  for (const x of notes) (byT.get(x.t) || byT.set(x.t, []).get(x.t)).push(x);
  const out = [], rate = o.rate * STEP;
  for (const [t, ch] of [...byT].sort((a, b) => a[0] - b[0])) {
    const span = ch[0].d + 2;
    let seq = ch.map((x) => x.n).sort((a, b) => a - b);
    const ext = []; for (let k = 0; k < o.range; k++) ext.push(...seq.map((x) => x + 12 * k));
    seq = ext;
    if (o.mode === 'down') seq.reverse();
    if (o.mode === 'updown') seq = [...seq, ...seq.slice(1, -1).reverse()];
    for (let i = 0; i * rate < span; i++) {
      const n = o.mode === 'random' ? seq[Math.floor(r() * seq.length)] : seq[i % seq.length];
      out.push({ t: t + i * rate, d: Math.max(2, Math.round(rate * o.gate) - 2), n, v: 90 });
    }
  }
  return out;
}

// stage 3: keep only the hits of a rhythm; a note lasts until the next hit
function groove(notes, o, r) {
  const g = GROOVES[o.groove];
  const mask = g?.mask || Array.from({ length: 16 }, (_, i) => (i === 0 || r() < 0.45 ? 'x' : '.')).join('');
  const end = Math.max(...notes.map((x) => x.t + x.d + 2), 16 * STEP);
  const hits = [];
  for (let s = 0; s * STEP < end; s++) if (mask[s % 16] === 'x' && (s % 16 === 0 || r() < o.density)) hits.push(s * STEP);
  const out = [];
  hits.forEach((t, i) => {
    const next = hits[i + 1] ?? end;
    // the notes sounding at this moment (an arpeggio gives one, a chord several)
    const live = notes.filter((x) => x.t <= t && x.t + x.d + 2 > t);
    const pick = live.length ? live : [notes.reduce((a, b) => (Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a))];
    const sw = o.swing && (t / STEP) % 2 === 1 ? Math.round(o.swing * STEP * 0.5) : 0;
    for (const x of pick) out.push({ t: t + sw, d: Math.max(2, next - t - 2), n: x.n, v: x.v });
  });
  return out;
}

// stage 4: flip in time / pitch, move octaves, nudge some notes to neighbouring scale notes
function mirror(notes, o, r, scale) {
  let out = notes.map((x) => ({ ...x }));
  if (!out.length) return out;
  const t0 = Math.min(...out.map((x) => x.t)), t1 = Math.max(...out.map((x) => x.t + x.d));
  if (o.flipH) for (const x of out) x.t = t0 + (t1 - (x.t + x.d));
  if (o.flipV) { const lo = Math.min(...out.map((x) => x.n)), hi = Math.max(...out.map((x) => x.n)); for (const x of out) x.n = hi - (x.n - lo); }
  for (const x of out) x.n += 12 * o.octave;
  if (o.mutate > 0) {
    const st = stepsOf(scale), root = scale?.root ?? 0;
    const inSc = (n) => st.includes(((n - root) % 12 + 12) % 12);
    for (const x of out) if (r() < o.mutate) { let n = x.n + (r() < 0.5 ? 1 : -1) * (1 + Math.floor(r() * 2)); let k = 0; while (!inSc(n) && k++ < 12) n += 1; x.n = n; }
  }
  if (o.flipV || o.mutate) { const st = stepsOf(scale), root = scale?.root ?? 0; for (const x of out) { let k = 0; while (!st.includes(((x.n - root) % 12 + 12) % 12) && k++ < 12) x.n += 1; } }
  out.sort((a, b) => a.t - b.t || a.n - b.n);
  return out;
}

// stage 5: velocities (accented downbeats, a little spread) and optional legato
function levels(notes, o, r) {
  const out = notes.map((x) => ({ ...x, v: Math.max(1, Math.min(127, Math.round(o.vel + (o.accent && (x.t / STEP) % 4 === 0 ? 12 : 0) + (r() - 0.5) * 2 * o.spread))) }));
  if (o.legato) {
    const ts = [...new Set(out.map((x) => x.t))].sort((a, b) => a - b);
    for (const x of out) { const nx = ts.find((t) => t > x.t); if (nx != null) x.d = nx - x.t - 1; }
  }
  return out;
}

// run the stages up to `upto` (index into STAGES); opts: { progression: {...}, arpeggiate: {...}, ... }
export function build(scale, opts, seed = 1, upto = STAGES.length - 1) {
  const o = Object.fromEntries(STAGES.map((s) => [s.id, { ...DEFAULTS[s.id], ...(opts[s.id] || {}) }]));
  const r = (k) => rng(seed * 2654435761 + k * 97);
  let notes = progression(scale, o.progression, r(1));
  if (upto >= 1) notes = arpeggiate(notes, o.arpeggiate, r(2));
  if (upto >= 2) notes = groove(notes, o.groove, r(3));
  if (upto >= 3) notes = mirror(notes, o.mirror, r(4), scale);
  if (upto >= 4) notes = levels(notes, o.levels, r(5));
  return notes.map((x) => ({ t: Math.max(0, Math.round(x.t)), d: Math.max(1, Math.round(x.d)), n: Math.max(0, Math.min(127, x.n)), v: x.v }));
}
