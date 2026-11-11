// i18n: source table — every Korean string here is UI text and a translation key; the screen that shows it calls t() (docs/i18n.md)
// MeloFi loop library (what FL Studio gets from FL Cloud sounds and its Loop Starter): drum, bass,
// chord and melody loops for a few genres, made in the project's key and tempo and rendered to
// audio with the built-in instruments only (procedural drum kits and synths, Splendid, MeloFi
// Synth), so it works offline with nothing to download. A seed picks the variation: the same
// seed always gives the same loop, a new seed "shuffles" it.
import { newProject, newChannel, newPattern, uid, STEP, SCALES } from './model.js';
import { synthDefaults, SYNTH_PRESETS } from './synth.js';
import { renderMix } from './io.js';

export const ROLES = { drums: '드럼', bass: '베이스', chords: '코드', lead: '멜로디' };
const BARS = 4;

// a role's sound: { inst } for a MeloFi instrument, { synth: preset } for MeloFi Synth
export const LOOP_GENRES = {
  kpop: {
    name: '케이팝 댄스', bpm: [122, 130], scale: 'minor', kit: 'drumstrap',
    drums: { k: 'x...x...x...x...', c: '....x.......x...', h: 'x.x.x.x.x.x.x.x.', o: '..x...x...x...x.' },
    bass: { synth: '신스 베이스', rhythm: [[0, 3, 0], [3, 1, 0], [6, 2, 0], [8, 3, 0], [11, 1, 12], [14, 2, 0]] },
    chords: { synth: '퓨처 베이스 코드', rhythm: [[0, 6], [6, 4], [10, 6]] },
    lead: { synth: '슈퍼쏘 리드', density: 0.5, low: 67 },
  },
  trap: {
    name: '트랩', bpm: [136, 148], scale: 'minor', kit: 'drumstrap',
    drums: { k: 'x.........x.....', c: '........x.......', h: 'x.x.x.x.x.xxx.x.', o: '' },
    bass: { inst: 'sub808', rhythm: [[0, 10, 0], [10, 6, 0]] },
    chords: { inst: 'splendid', rhythm: [[0, 16]], arp: true },
    lead: { inst: 'fmbell', density: 0.35, low: 72 },
  },
  house: {
    name: '하우스', bpm: [120, 126], scale: 'dorian', kit: 'drums909',
    drums: { k: 'x...x...x...x...', c: '....x.......x...', h: '..x...x...x...x.', o: '..x...x...x...x.' },
    bass: { synth: '딥 하우스 베이스', rhythm: [[2, 2, 0], [6, 2, 0], [10, 2, 0], [14, 2, 7]] },
    chords: { synth: '하우스 스탭', rhythm: [[2, 2], [6, 2], [10, 2], [14, 2]] },
    lead: { synth: '플럭', density: 0.45, low: 67 },
  },
  lofi: {
    name: '로파이', bpm: [72, 86], scale: 'dorian', kit: 'drums808', soft: true,
    drums: { k: 'x......x..x.....', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.', o: '' },
    bass: { inst: 'synbass', rhythm: [[0, 6, 0], [8, 4, 7], [12, 4, 0]] },
    chords: { inst: 'fmep', rhythm: [[0, 16]], seventh: true },
    lead: { inst: 'fmbell', density: 0.3, low: 72 },
  },
  ballad: {
    name: '팝 발라드', bpm: [68, 80], scale: 'major', kit: 'drums808', soft: true,
    drums: { k: 'x.......x.x.....', s: '....x.......x...', h: 'x...x...x...x...', o: '' },
    bass: { inst: 'synbass', rhythm: [[0, 12, 0], [12, 4, 7]] },
    chords: { inst: 'splendid', rhythm: [[0, 16]], arp: true },
    lead: { synth: '사인 리드', density: 0.35, low: 69 },
  },
  synthwave: {
    name: '신스웨이브', bpm: [96, 112], scale: 'minor', kit: 'drums909',
    drums: { k: 'x.......x.......', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.', o: '' },
    bass: { synth: '신스 베이스', rhythm: [[0, 2, 0], [2, 2, 0], [4, 2, 0], [6, 2, 12], [8, 2, 0], [10, 2, 0], [12, 2, 0], [14, 2, 12]] },
    chords: { inst: 'synpad', rhythm: [[0, 16]] },
    lead: { synth: '레트로 리드', density: 0.45, low: 67 },
  },
};

const PROGRESSIONS = {
  major: [[0, 4, 5, 3], [0, 5, 3, 4], [3, 4, 0, 5], [0, 3, 0, 4]],
  minor: [[0, 5, 2, 6], [0, 3, 6, 5], [5, 6, 0, 0], [0, 6, 5, 6]],
};

// small seeded random generator (mulberry32): a seed always gives the same loop
function rng(seed) {
  let a = seed >>> 0 || 1;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// the midi note of scale degree d (0-based, may run past one octave) above `base`
function degree(scale, root, d, base) {
  const st = SCALES[scale]?.steps || SCALES.minor.steps, n = st.length;
  const o = Math.floor(d / n), k = ((d % n) + n) % n;
  return base + root + st[k] + 12 * o;
}

function makeChannel(spec, name, i, extra = {}) {
  if (spec.synth) return newChannel('synth', name, i, { kind: 'synth', synth: { ...synthDefaults(), ...(SYNTH_PRESETS[spec.synth] || {}) }, synthPreset: spec.synth, ...extra });
  return newChannel(spec.inst, name, i, extra);
}

// notes for one role over BARS bars
function notesFor(g, role, { root, seed, prog }) {
  const r = rng(seed * 7919 + role.length * 31);
  const out = [];
  const bar = 16 * STEP;
  if (role === 'drums') {
    const d = g.drums, keys = { k: 36, s: 38, c: 39, h: 42, o: 46 };
    const vel = g.soft ? 0.75 : 1;
    const hats16 = r() < 0.35; // some variations run hats in 16ths
    for (let b = 0; b < BARS; b++) {
      for (const [part, pat] of Object.entries(d)) {
        let p = pat;
        if (part === 'h' && hats16 && !g.soft) p = 'xxxxxxxxxxxxxxxx';
        for (let i = 0; i < 16; i++) {
          let hit = p[i] === 'x';
          if (part === 'k' && !hit && i % 2 === 0 && r() < 0.08) hit = true;              // ghost kick
          if (part === 'h' && hit && r() < 0.12) continue;                                   // drop a hat now and then
          if (hit) out.push({ t: b * bar + i * STEP, d: STEP, n: keys[part], v: Math.round((part === 'h' ? (i % 4 === 0 ? 90 : 68) + r() * 18 : 100 + r() * 12) * vel) });
        }
        // a fill at the end of the loop
        if (b === BARS - 1 && (part === 's' || part === 'c') && r() < 0.7) for (const i of [13, 14, 15]) out.push({ t: b * bar + i * STEP, d: STEP, n: keys[part], v: Math.round((70 + i * 2) * vel) });
      }
    }
    return out;
  }
  if (role === 'bass') {
    for (let b = 0; b < BARS; b++) {
      const rootNote = degree(g.scale, root, prog[b % prog.length], 36);
      for (const [s, len, add] of g.bass.rhythm) out.push({ t: b * bar + s * STEP, d: len * STEP - 2, n: rootNote + add + (r() < 0.1 && add === 0 ? 12 : 0), v: 100 + Math.round(r() * 14) });
    }
    return out;
  }
  if (role === 'chords') {
    for (let b = 0; b < BARS; b++) {
      const dg = prog[b % prog.length];
      const tones = [0, 2, 4, ...(g.chords.seventh ? [6] : [])].map((x) => degree(g.scale, root, dg + x, 48));
      // keep voicings around middle C
      const ch = tones.map((n) => (n < 53 ? n + 12 : n > 72 ? n - 12 : n)).sort((a, b2) => a - b2);
      if (g.chords.arp) {
        const order = r() < 0.5 ? [0, 1, 2, 1] : [0, 2, 1, 2];
        for (let i = 0; i < 8; i++) out.push({ t: b * bar + i * 2 * STEP, d: 2 * STEP + STEP, n: ch[order[i % 4] % ch.length] + (i >= 4 && r() < 0.3 ? 12 : 0), v: 70 + Math.round(r() * 16) });
        out.push({ t: b * bar, d: bar - 2, n: ch[0] - 12, v: 72 });
      } else for (const [s, len] of g.chords.rhythm) for (const n of ch) out.push({ t: b * bar + s * STEP, d: len * STEP - 2, n, v: 78 + Math.round(r() * 10) });
    }
    return out;
  }
  // lead: chord tones on strong beats, stepwise motion in between, a phrase per two bars
  const low = g.lead.low + ((root % 12) > 6 ? -12 + (root % 12) : root % 12);
  const pool = []; for (let n = low; n <= low + 14; n++) if ((SCALES[g.scale]?.steps || []).includes(((n - root) % 12 + 12) % 12)) pool.push(n);
  let i = Math.floor(pool.length / 2);
  const motif = [];
  for (let s = 0; s < 32; s++) { const strong = s % 4 === 0; if (r() < (strong ? g.lead.density + 0.3 : g.lead.density * 0.5)) motif.push(s); }
  for (let half = 0; half < BARS / 2; half++) {
    motif.forEach((s, k) => {
      const t = half * 2 * bar + s * STEP;
      const b = Math.floor(t / bar), chord = [0, 2, 4].map((x) => degree(g.scale, root, prog[b % prog.length] + x, 0) % 12);
      if (s % 4 === 0) { const cands = pool.map((n, j) => [n, j]).filter(([n]) => chord.includes(((n % 12) + 12) % 12)); if (cands.length) { const [, j] = cands.reduce((a, c) => (Math.abs(c[1] - i) < Math.abs(a[1] - i) ? c : a)); i = j; } }
      else i = Math.max(0, Math.min(pool.length - 1, i + [-2, -1, -1, 1, 1, 2][Math.floor(r() * 6)]));
      const next = motif[k + 1] ?? 32;
      out.push({ t, d: Math.max(1, Math.min(4, next - s)) * STEP - 2, n: pool[i], v: (s % 4 === 0 ? 96 : 84) + Math.round(r() * 10) });
    });
  }
  return out;
}

// a project that plays just this loop once
export function loopProject(genreId, role, { root = 0, bpm = 120, seed = 1 } = {}) {
  const g = LOOP_GENRES[genreId];
  const p = newProject();
  p.name = `${g.name} ${ROLES[role]}`; p.bpm = bpm;
  const progs = PROGRESSIONS[g.scale === 'major' ? 'major' : 'minor'];
  const prog = progs[Math.floor(rng(seed * 104729)() * progs.length)];
  const spec = role === 'drums' ? { inst: g.kit } : g[role];
  const ch = makeChannel(spec, ROLES[role], 0, { send: role === 'drums' ? 0.05 : 0.18, stepNote: 36 });
  p.channels = [ch]; p.selected = ch.id;
  const pat = newPattern(0, BARS);
  pat.notes = { [ch.id]: notesFor(g, role, { root, seed, prog }) };
  p.patterns = [pat]; p.current = pat.id;
  p.playlist.clips = [{ id: uid('k'), pattern: pat.id, track: 0, start: 0, len: BARS }];
  p.mode = 'song';
  return p;
}

// render a loop to audio: { left, right, rate, bars, bpm, name }
export async function renderLoop(genreId, role, opts = {}) {
  const p = loopProject(genreId, role, opts);
  const out = await renderMix(p, { offset: 0, tail: 0 });
  const g = LOOP_GENRES[genreId];
  const keyName = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][((opts.root || 0) % 12 + 12) % 12];
  return { ...out, bars: BARS, bpm: p.bpm, name: `${g.name} ${ROLES[role]} ${keyName} ${p.bpm}BPM #${opts.seed || 1}` };
}
