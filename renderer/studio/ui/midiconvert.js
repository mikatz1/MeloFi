// Separated stems -> MIDI with an instrument per stretch of the song. The engine's instrument
// recognition (tools/stems/instruments.py: AudioSet classes every 2 s on each stem) is read bar by
// bar, smoothed into sections of at least 8 bars, and each section gets MeloFi instruments as
// candidates (the best one recommended). The user picks; the stem's transcribed notes then go to a
// channel of the chosen instrument for exactly the bars of that section.
import { newProject, newChannel, newPattern, newTrack, secToTick, barTicks, STEP, uid } from '../model.js';
import { renderMix } from '../io.js';
import { cleanDownbeats, fromStems } from './ai.js';

// recognition categories: Korean name and the MeloFi instruments that fit, best first
export const CATS = {
  piano: ['피아노', ['splendid', 'salamander']],
  epiano: ['일렉트릭 피아노', ['rhodes', 'wurlitzer', 'fmep']],
  organ: ['오르간', ['organ', 'drawbar']],
  harpsichord: ['하프시코드', ['harpsichord', 'clavinet']],
  synth: ['신스', ['synlead', 'synpad', 'supersaw', 'synpluck']],
  guitar_ac: ['어쿠스틱 기타', ['acoustic', 'cleanguitar']],
  guitar_el: ['일렉 기타', ['cleanguitar', 'electric']],
  plucked: ['발현악기', ['banjo', 'dantranh', 'kalimba']],
  harp: ['하프', ['harp']],
  bass: ['일렉 베이스', ['fingerbass', 'ebass', 'synbass', 'sub808']],
  upright: ['콘트라베이스', ['upright', 'contrabass']],
  strings: ['현악 합주', ['strings', 'stringsstac', 'synpad']],
  violin: ['바이올린', ['violin', 'erhu']],
  cello: ['첼로', ['cello']],
  pizzicato: ['피치카토', ['stringspizz']],
  brass: ['금관', ['trumpet', 'trombone', 'horn', 'synbrass', 'brassstab']],
  sax: ['색소폰', ['altosax', 'tenorsax']],
  flute: ['플루트', ['flute', 'recorder']],
  clarinet: ['클라리넷 · 목관', ['clarinet', 'oboe']],
  mallet: ['건반 타악기', ['marimba', 'vibraphone', 'xylophone', 'glockenspiel', 'steeldrum']],
  bell: ['벨', ['fmbell', 'handbells', 'glockenspiel']],
  harmonica: ['하모니카 · 아코디언', ['harmonica']],
  choir: ['합창', ['choir', 'oohs']],
  voice: ['노래 (멜로디)', ['vocal', 'synlead', 'flute', 'oohs']],
  drums_ac: ['어쿠스틱 드럼', ['acousticdrums']],
  drums_el: ['전자 드럼', ['drums808', 'drums909', 'drumstrap']],
};

// what each stem can be, and what it most likely is when the recognition is unsure
const MELODIC = ['piano', 'epiano', 'organ', 'harpsichord', 'synth', 'guitar_ac', 'guitar_el', 'plucked', 'harp', 'strings', 'violin', 'cello', 'pizzicato', 'brass', 'sax', 'flute', 'clarinet', 'mallet', 'bell', 'harmonica', 'choir'];
const STEM = {
  vocals: [['voice', 'choir', 'synth', 'flute', 'violin', 'sax'], 'voice'],
  backing: [['choir', 'voice', 'strings', 'synth'], 'choir'],
  drums: [['drums_ac', 'drums_el'], 'drums_ac'],
  bass: [['bass', 'upright', 'synth'], 'bass'],
  guitar: [['guitar_el', 'guitar_ac', 'plucked', 'harp', 'synth'], 'guitar_el'],
  piano: [['piano', 'epiano', 'organ', 'harpsichord', 'mallet', 'synth', 'bell'], 'piano'],
  other: [MELODIC, 'synth'],
};
// a stem's own versions of a category (the bass stem's "synth" is a synth bass, not a lead)
const STEM_INST = {
  bass: { synth: ['synbass', 'reese', 'sub808'], bass: ['fingerbass', 'ebass', 'synbass'], upright: ['upright', 'contrabass'] },
};
export const STEM_NAMES = { vocals: '리드 보컬', backing: '코러스', drums: '드럼', bass: '베이스', guitar: '기타', piano: '피아노', other: '그 밖의 악기' };

const MIN_BARS = 8;

// bar start times (seconds), the same grid the project's tempo map uses
export function barGrid(r) {
  const meter = Math.max(2, Math.min(7, r.meter || 4));
  const db = cleanDownbeats(r.downbeats || [], r.beats || [], meter);
  const bars = db.length ? db.slice() : [r.first_downbeat || 0];
  const len = bars.length > 1 ? (bars.at(-1) - bars[0]) / (bars.length - 1) : (60 / (r.bpm || 120)) * meter;
  while (bars.at(-1) < r.duration) bars.push(bars.at(-1) + len);
  return bars;
}
const barOf = (bars, t) => { let lo = 0, hi = bars.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (bars[m] <= t) lo = m; else hi = m - 1; } return lo; };

// notes of a stem as [t, d, n, v] (drums: hits as short notes)
export const stemNotes = (r, k) => (k === 'drums' ? (r.drums || []).map(([t, n, v]) => [t, 0.1, n, v]) : r.notes?.[k] || []);

// bar-by-bar categories -> sections of at least MIN_BARS bars -> groups of sections per category
export function sections(r, inst) {
  const bars = barGrid(r), nb = bars.length - 1, out = {};
  for (const [k, rows] of Object.entries(inst.stems || {})) {
    const [allowed, dflt] = STEM[k] || [MELODIC, 'synth'];
    const notes = stemNotes(r, k);
    if (!notes.length) continue;
    // per bar: summed probabilities of the windows over it, and whether anything is played
    const sum = Array.from({ length: nb }, () => ({})), played = new Uint16Array(nb);
    for (const [t] of notes) { const b = barOf(bars, t); if (b < nb) played[b]++; }
    for (const w of rows) {
      if (!w.p || !Object.keys(w.p).length) continue;
      const b0 = barOf(bars, w.t), b1 = barOf(bars, w.t + inst.win);
      for (let b = b0; b <= Math.min(b1, nb - 1); b++) for (const c of allowed) sum[b][c] = (sum[b][c] || 0) + (w.p[c] || 0);
    }
    // the stem's usual sound gets a small head start when the model is unsure
    const top = (s) => { let best = dflt, bv = (s[dflt] || 0) * 1.15 + 1e-6; for (const c of allowed) if ((s[c] || 0) > bv) { best = c; bv = s[c]; } return best; };
    let lab = sum.map((s, b) => (played[b] ? top(s) : null));
    // smooth: each played bar takes the most common label of the 5 bars around it
    lab = lab.map((c, b) => {
      if (!c) return null;
      const n = {};
      for (let j = Math.max(0, b - 2); j <= Math.min(nb - 1, b + 2); j++) if (lab[j]) n[lab[j]] = (n[lab[j]] || 0) + (j === b ? 1.5 : 1);
      return Object.entries(n).sort((a, z) => z[1] - a[1])[0][0];
    });
    // runs of the same label (silent bars join the run around them)
    let secs = [];
    for (let b = 0; b < nb; b++) {
      if (!lab[b]) { if (secs.length) secs.at(-1).end = b + 1; continue; }
      if (secs.length && secs.at(-1).cat === lab[b]) secs.at(-1).end = b + 1;
      else secs.push({ cat: lab[b], start: b, end: b + 1 });
    }
    // too short: fold into the neighbour (the earlier one when there is one)
    for (let changed = true; changed && secs.length > 1;) {
      changed = false;
      const i = secs.findIndex((s) => s.end - s.start < MIN_BARS);
      if (i < 0) break;
      const j = i > 0 ? i - 1 : i + 1;
      secs[j] = { cat: secs[j].cat, start: Math.min(secs[i].start, secs[j].start), end: Math.max(secs[i].end, secs[j].end) };
      secs.splice(i, 1);
      // neighbours that now share a label become one
      secs = secs.reduce((a, s) => { if (a.length && a.at(-1).cat === s.cat) a.at(-1).end = s.end; else a.push({ ...s }); return a; }, []);
      changed = true;
    }
    // the first section starts at the first played bar
    const first = played.findIndex((x) => x > 0);
    if (secs.length && first > secs[0].start) secs[0].start = first;
    // groups: one choice per detected category, with the sections it covers and its average probabilities
    const groups = {};
    for (const s of secs) {
      const g = (groups[s.cat] ||= { cat: s.cat, secs: [], p: {}, bars: 0 });
      g.secs.push({ start: s.start, end: s.end });
      for (let b = s.start; b < s.end; b++) for (const c of allowed) g.p[c] = (g.p[c] || 0) + (sum[b][c] || 0);
      g.bars += s.end - s.start;
    }
    out[k] = Object.values(groups).map((g) => {
      const tot = Object.values(g.p).reduce((a, x) => a + x, 0) || 1;
      const share = Object.fromEntries(Object.entries(g.p).map(([c, v]) => [c, v / tot]));
      // the name shown is the category the windows voted for most (the section split only
      // decides where the boundaries are)
      const best = Object.entries(share).sort((a, b) => b[1] - a[1])[0];
      const label = best && best[1] > 0 ? best[0] : g.cat;
      // notes per bar in its sections: a stem that is only bleed from other instruments has a few
      const nNotes = notes.filter(([t]) => g.secs.some((s) => t >= bars[s.start] && t < bars[s.end])).length;
      const density = nNotes / Math.max(1, g.bars);
      return { ...g, label, share, notes: nNotes, density, thin: density < 0.75 || nNotes < 24 };
    }).sort((a, b) => a.secs[0].start - b.secs[0].start);
  }
  return { bars, stems: out };
}

// candidates for a group: the instruments of its best categories, the first one recommended
// (installed instruments first within a category)
export function candidates(S, k, g) {
  const ranked = Object.entries(g.share).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const cats = [...new Set([...ranked.map(([c]) => c), g.cat])].slice(0, 3);
  const info = (id) => S.app.instruments.find((i) => i.id === id);
  const list = [];
  for (const c of cats) {
    const ids = (STEM_INST[k]?.[c] || CATS[c]?.[1] || []).filter((id) => info(id));
    ids.sort((a, b) => (info(b)?.installed ? 1 : 0) - (info(a)?.installed ? 1 : 0));
    for (const id of ids) if (!list.some((x) => x.id === id)) list.push({ id, cat: c, share: g.share[c] || 0, installed: !!info(id)?.installed, downloadable: !!info(id)?.downloadable, name: info(id)?.name || id });
  }
  const shown = list.slice(0, 7);
  if (shown.length) shown[0].recommended = true;
  return shown;
}

export const rangeText = (secs) => secs.map((s) => (s.end - s.start <= 1 ? `${s.start + 1}` : `${s.start + 1}~${s.end}`)).join(', ') + '마디';

// a few seconds of a group's notes played by a candidate instrument (rendered offline)
export async function renderCandidate(S, r, k, g, instId, bars, seconds = 8) {
  const t0 = bars[g.secs[0].start], t1 = Math.min(bars[g.secs[0].end] ?? r.duration, t0 + seconds);
  const p = newProject();
  p.bpm = Math.round(r.bpm * 100) / 100;
  const ch = newChannel(instId, 'preview', 0, { vol: 0.8, send: 0.12, ...(S.isKit(instId) ? { stepNote: 36 } : {}) });
  p.channels = [ch]; p.selected = ch.id;
  const pat = newPattern(0, 1); pat.notes = { [ch.id]: [] };
  const tick = (s) => Math.round(secToTick(p, Math.max(0, s), 'pattern'));
  for (const [t, d, n, v] of stemNotes(r, k)) if (t >= t0 && t < t1) pat.notes[ch.id].push({ t: tick(t - t0), d: Math.max(STEP / 4, tick(d)), n, v });
  pat.bars = Math.max(1, Math.ceil(tick(t1 - t0) / barTicks(p)));
  p.patterns = [pat]; p.current = pat.id; p.playlist.clips = [];
  const mix = await renderMix(p, { tail: 1 });
  return mix;
}

// the project: the separated audio (muted, for reference) if wanted, and for every stem one MIDI
// channel per chosen instrument holding that stem's notes in the bars of its sections
export async function buildAssigned(r, plan, choice, fileName, S, { audio = true } = {}) {
  const p = await fromStems(r, null, fileName, S, { audio, midi: false });
  p.name = `${fileName.replace(/\.[^.]+$/, '')} (MIDI 변환)`;
  if (!audio) p.channels = []; // (fromStems leaves a stand-in piano when it has nothing)
  for (const c of p.channels) c.mute = true; // the recording stays for comparison, silent
  const t0 = r.first_downbeat || 0, bt = barTicks(p);
  const tickOf = (sec) => Math.max(0, Math.round(secToTick(p, Math.max(0, sec - t0), 'song')));
  const chans = new Map(); // `${stem}:${inst}` -> channel
  const order = ['vocals', 'backing', 'drums', 'bass', 'guitar', 'piano', 'other'];
  const owner = []; // [stem, bar] -> channel
  for (const k of order) {
    for (const g of plan.stems[k] || []) {
      const id = choice[`${k}:${g.cat}`];
      if (!id) continue; // "leave out"
      const key = `${k}:${id}`;
      if (!chans.has(key)) {
        const kit = S.isKit(id);
        const ch = newChannel(id, `${STEM_NAMES[k]} · ${S.instName(id)}`, p.channels.length + chans.size, { vol: k === 'drums' ? 0.85 : 0.75, send: kit ? 0.05 : 0.15, ...(kit ? { stepNote: 36 } : {}) });
        chans.set(key, ch);
      }
      for (const s of g.secs) for (let b = s.start; b < s.end; b++) owner.push([k, b, chans.get(key)]);
    }
  }
  const who = new Map(owner.map(([k, b, ch]) => [`${k}:${b}`, ch]));
  p.channels.push(...chans.values());
  const endBar = Math.max(1, Math.ceil(tickOf(r.duration) / bt));
  const tr = p.playlist.tracks.length;
  p.playlist.tracks.push({ ...newTrack(tr), name: 'MIDI (악기 지정)' });
  const pats = [];
  for (let b = 0; b < endBar; b += 8) { const len = Math.min(8, endBar - b), pat = newPattern(p.patterns.length + pats.length, len); pat.name = `${b + 1}~${b + len}마디`; pats.push([b, len, pat]); }
  for (const k of order) for (const [t, d, n, v] of stemNotes(r, k)) {
    const ch = who.get(`${k}:${barOf(plan.bars, t)}`);
    if (!ch) continue;
    const tk = tickOf(t), slot = pats[Math.min(pats.length - 1, Math.floor(tk / bt / 8))];
    if (!slot) continue;
    const [b0, , pat] = slot;
    (pat.notes[ch.id] ||= []).push({ t: tk - b0 * bt, d: Math.max(STEP / 4, tickOf(t + d) - tk), n, v });
  }
  for (const [b0, len, pat] of pats) { if (!Object.keys(pat.notes).length) continue; p.patterns.push(pat); p.playlist.clips.push({ id: uid('k'), pattern: pat.id, track: tr, start: b0, len }); }
  if (!p.patterns.length) p.patterns = [newPattern(0)];
  p.current = p.patterns[0].id;
  p.selected = [...chans.values()][0]?.id || p.channels[0]?.id;
  while (p.playlist.tracks.length < 8) p.playlist.tracks.push(newTrack(p.playlist.tracks.length));
  return p;
}
