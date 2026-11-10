// MeloFi Studio — project model. Plain data (saved as JSON), plus helpers and undo history.
//
// Time is in ticks: PPQ per quarter note. A 16th-note step is STEP ticks.

export const PPQ = 96;
export const STEP = PPQ / 4;
export const VERSION = 2;

let nextId = 1;
export const uid = (p) => `${p}${Date.now().toString(36)}${(nextId++).toString(36)}`;

export const CHANNEL_COLORS = ['#e8a15d', '#7fb0ff', '#9fd67a', '#e77fb3', '#c8a2ff', '#5fd8d0', '#f0d264', '#ff8a7a', '#8fc0a9', '#b8b3ff'];
export const PATTERN_COLORS = ['#5a7bd6', '#d68a5a', '#5ab98a', '#b95ab0', '#d6c35a', '#5ab3d6', '#d65a6e', '#8a5ad6'];

export function newChannel(inst, name, i, extra = {}) {
  return {
    id: uid('c'), name, inst, color: CHANNEL_COLORS[i % CHANNEL_COLORS.length],
    vol: 0.8, pan: 0, send: 0.15, mute: false, solo: false,
    stepNote: 60, // the key the step sequencer plays
    // kind: 'inst' (a MeloFi instrument) | 'sample' (one sound across the keys) | 'slicer' (a loop cut into keys)
    //       | 'synth' (editable synthesizer) | 'audio' (plays audio clips from the playlist)
    kind: 'inst',
    fx: [],          // insert effects: [{ id, type, on, params }]
    out: 'master',   // 'master' or a bus id
    swing: null,     // per-channel swing (null: the project's)
    groove: null,    // groove template name
    loopSteps: 0,    // the step sequencer loops after this many steps (0: the whole pattern)
    ...extra,
  };
}

export function newBus(i, name) {
  return { id: uid('b'), name: name || `버스 ${i + 1}`, color: CHANNEL_COLORS[(i + 5) % CHANNEL_COLORS.length], vol: 0.8, pan: 0, mute: false, fx: [] };
}

export const newTrack = (i) => ({ name: `트랙 ${i + 1}`, color: null, mute: false, solo: false });

export function newPattern(i, bars = 1) {
  return { id: uid('p'), name: `패턴 ${i + 1}`, color: PATTERN_COLORS[i % PATTERN_COLORS.length], bars, notes: {} };
}

// A new project: the classic starting point — four drum channels and one instrument.
export function newProject() {
  const chans = [
    newChannel('drums808', 'Kick', 0, { stepNote: 36 }),
    newChannel('drums808', 'Clap', 1, { stepNote: 39 }),
    newChannel('drums808', 'Hat', 2, { stepNote: 42, vol: 0.6 }),
    newChannel('drums808', 'Snare', 3, { stepNote: 38 }),
    newChannel('splendid', 'Piano', 4, { stepNote: 60, send: 0.25 }),
  ];
  const p = newPattern(0, 1);
  return {
    version: VERSION, name: '새 프로젝트', bpm: 120, sig: [4, 4], swing: 0,
    channels: chans, patterns: [p], current: p.id, selected: chans[4].id,
    playlist: { tracks: Array.from({ length: 8 }, (_, i) => newTrack(i)), clips: [] },
    mode: 'pattern', master: { vol: 0.85, reverb: 'hall', fx: [] },
    buses: [],
    tempos: [],      // tempo changes after bar 1: [{ bar, bpm }]
    markers: [],     // [{ bar, name }]
    loop: null,      // playlist loop region in bars { start, end }
    autos: [],       // automation clips: [{ id, name, color, target, len, points: [{ t (0..1 of len), v (0..1) }] }]
    media: {},       // audio files used by clips / sample channels: hash -> { name, rate, ch, dur, bpm }
    scale: null,     // piano-roll scale { root: 0..11, type }
    midiMap: [],     // MIDI learn: [{ cc, ch, target }]
  };
}

// ---------- tempo map (song position) ----------
// tempo changes live on bar lines; pattern mode always uses the project tempo
export function tempoList(proj) {
  const bt = barTicks(proj);
  const list = [{ tick: 0, bpm: proj.bpm }];
  for (const x of [...(proj.tempos || [])].sort((a, b) => a.bar - b.bar)) if (x.bar > 0) list.push({ tick: x.bar * bt, bpm: x.bpm });
  return list;
}
// seconds from tick 0 to `tick`
export function tickToSec(proj, tick, mode = 'song') {
  if (mode !== 'song' || !proj.tempos?.length) return (tick / PPQ) * (60 / proj.bpm);
  const L = tempoList(proj);
  let s = 0;
  for (let i = 0; i < L.length; i++) {
    const a = L[i].tick, b = i + 1 < L.length ? L[i + 1].tick : Infinity;
    if (tick <= a) break;
    s += ((Math.min(tick, b) - a) / PPQ) * (60 / L[i].bpm);
  }
  return s;
}
export function secToTick(proj, sec, mode = 'song') {
  if (mode !== 'song' || !proj.tempos?.length) return (sec * proj.bpm * PPQ) / 60;
  const L = tempoList(proj);
  let s = 0;
  for (let i = 0; i < L.length; i++) {
    const a = L[i].tick, b = i + 1 < L.length ? L[i + 1].tick : Infinity;
    const segSec = b === Infinity ? Infinity : ((b - a) / PPQ) * (60 / L[i].bpm);
    if (sec <= s + segSec) return a + ((sec - s) * L[i].bpm * PPQ) / 60;
    s += segSec;
  }
  return 0;
}
export const bpmAt = (proj, tick) => { let b = proj.bpm; for (const x of tempoList(proj)) if (x.tick <= tick) b = x.bpm; return b; };

// ---------- scales (piano roll) ----------
export const SCALES = {
  major: { name: '메이저 (장조)', steps: [0, 2, 4, 5, 7, 9, 11] },
  minor: { name: '마이너 (단조)', steps: [0, 2, 3, 5, 7, 8, 10] },
  harmonic: { name: '화성 단음계', steps: [0, 2, 3, 5, 7, 8, 11] },
  dorian: { name: '도리안', steps: [0, 2, 3, 5, 7, 9, 10] },
  mixolydian: { name: '믹솔리디안', steps: [0, 2, 4, 5, 7, 9, 10] },
  pentaMajor: { name: '메이저 펜타토닉', steps: [0, 2, 4, 7, 9] },
  pentaMinor: { name: '마이너 펜타토닉', steps: [0, 3, 5, 7, 10] },
  blues: { name: '블루스', steps: [0, 3, 5, 6, 7, 10] },
  japanese: { name: '요나누키 (일본풍 장음계)', steps: [0, 2, 4, 7, 9] },
};
export const ROOTS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export function inScale(scale, n) {
  if (!scale) return true;
  const s = SCALES[scale.type]?.steps || SCALES.major.steps;
  return s.includes(((n - scale.root) % 12 + 12) % 12);
}
// nearest note of the scale (ties go up)
export function snapToScale(scale, n) {
  if (!scale || inScale(scale, n)) return n;
  for (let d = 1; d < 12; d++) { if (inScale(scale, n + d)) return n + d; if (inScale(scale, n - d)) return n - d; }
  return n;
}

// ---------- time ----------
export const barTicks = (proj) => (PPQ * 4 * proj.sig[0]) / proj.sig[1];
export const patternTicks = (proj, pat) => barTicks(proj) * pat.bars;
export const ticksToSec = (proj, t) => (t / PPQ) * (60 / proj.bpm);
export const secToTicks = (proj, s) => (s * proj.bpm * PPQ) / 60;

// length of the song in bars (end of the last clip)
export function songBars(proj) {
  let end = 0;
  for (const c of proj.playlist.clips) end = Math.max(end, c.start + c.len);
  return Math.max(1, end);
}

export const pattern = (proj, id = proj.current) => proj.patterns.find((p) => p.id === id);
export const channel = (proj, id = proj.selected) => proj.channels.find((c) => c.id === id);
export const notesOf = (pat, chId) => (pat.notes[chId] ||= []);

// channels that should sound (solo wins over mute)
export function audible(proj) {
  const solo = proj.channels.some((c) => c.solo);
  return new Set(proj.channels.filter((c) => (solo ? c.solo : !c.mute)).map((c) => c.id));
}

// ---------- editing helpers ----------
export function stepOn(pat, ch, step) {
  return notesOf(pat, ch.id).some((n) => n.t === step * STEP && n.n === ch.stepNote);
}

export function toggleStep(pat, ch, step) {
  const list = notesOf(pat, ch.id);
  const i = list.findIndex((n) => n.t === step * STEP && n.n === ch.stepNote);
  if (i >= 0) list.splice(i, 1);
  else list.push({ t: step * STEP, d: STEP, n: ch.stepNote, v: 100 });
}

export function quantize(list, grid, lengths = false) {
  for (const n of list) {
    n.t = Math.max(0, Math.round(n.t / grid) * grid);
    if (lengths) n.d = Math.max(grid, Math.round(n.d / grid) * grid);
  }
}

// ---------- undo / redo: whole-project snapshots (projects are small) ----------
export class History {
  constructor(get, set, limit = 120) { this.get = get; this.set = set; this.limit = limit; this.undoStack = []; this.redoStack = []; }
  // call before a change
  push() {
    this.undoStack.push(JSON.stringify(this.get()));
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
  }
  undo() {
    if (!this.undoStack.length) return false;
    this.redoStack.push(JSON.stringify(this.get()));
    this.set(JSON.parse(this.undoStack.pop()));
    return true;
  }
  redo() {
    if (!this.redoStack.length) return false;
    this.undoStack.push(JSON.stringify(this.get()));
    this.set(JSON.parse(this.redoStack.pop()));
    return true;
  }
}

// make sure a loaded file has everything a current project needs
export function migrate(p) {
  const base = newProject();
  const out = { ...base, ...p };
  out.playlist = { ...base.playlist, ...(p.playlist || {}) };
  out.master = { ...base.master, ...(p.master || {}) };
  out.channels = (p.channels || base.channels).map((c, i) => ({ ...newChannel(c.inst || 'splendid', c.name || `Ch ${i + 1}`, i), ...c, fx: c.fx || [] }));
  out.master.fx = out.master.fx || [];
  for (const k of ['buses', 'tempos', 'markers', 'autos', 'midiMap']) out[k] = Array.isArray(p[k]) ? p[k] : [];
  out.media = p.media || {};
  // version 1 stored the playlist track count as a number
  const tr = out.playlist.tracks;
  out.playlist.tracks = typeof tr === 'number' ? Array.from({ length: tr }, (_, i) => newTrack(i)) : tr;
  out.version = VERSION;
  out.patterns = (p.patterns?.length ? p.patterns : base.patterns).map((pt, i) => ({ ...newPattern(i), ...pt, notes: pt.notes || {} }));
  if (!out.patterns.some((x) => x.id === out.current)) out.current = out.patterns[0].id;
  if (!out.channels.some((x) => x.id === out.selected)) out.selected = out.channels[0]?.id;
  return out;
}
