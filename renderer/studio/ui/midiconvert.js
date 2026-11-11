// Separated stems -> MIDI with an instrument per stretch of the song. The engine's instrument
// recognition (tools/stems/instruments.py: AudioSet classes every 2 s on each stem) is read bar by
// bar, smoothed into sections of at least 8 bars, and each section gets MeloFi instruments as
// candidates (the best one recommended). The user picks; the stem's transcribed notes then go to a
// channel of the chosen instrument for exactly the bars of that section.
import { newProject, newChannel, newPattern, newTrack, secToTick, barTicks, STEP, uid } from '../model.js';
import { renderMix } from '../io.js';
import { cleanDownbeats, fromStems, meterMap } from './ai.js';
import { synthDefaults, SYNTH_PRESETS, SYNTH_CATEGORIES, SYNTH_PARAMS, SynthChannel } from '../synth.js';
import * as T from '../timbre.js';
import { loadSome } from '../channel.js';
import { PAD } from '../../js/audio.js';
import { t, tc, N_ } from '../../i18n/i18n.js';

// recognition categories: Korean name and the MeloFi instruments that fit, best first
export const CATS = {
  piano: [N_('피아노'), ['splendid', 'salamander']],
  epiano: [N_('일렉트릭 피아노'), ['rhodes', 'wurlitzer', 'fmep']],
  organ: [N_('오르간'), ['organ', 'drawbar']],
  harpsichord: [N_('하프시코드'), ['harpsichord', 'clavinet']],
  synth: [N_('신스'), ['synlead', 'synpad', 'supersaw', 'synpluck']],
  guitar_ac: [N_('어쿠스틱 기타'), ['acoustic', 'cleanguitar']],
  guitar_el: [N_('일렉 기타'), ['cleanguitar', 'electric']],
  plucked: [N_('발현악기'), ['banjo', 'dantranh', 'kalimba']],
  harp: [N_('하프'), ['harp']],
  bass: [N_('일렉 베이스'), ['fingerbass', 'ebass', 'synbass', 'sub808']],
  upright: [N_('콘트라베이스'), ['upright', 'contrabass']],
  strings: [N_('현악 합주'), ['strings', 'stringsstac', 'synpad']],
  violin: [N_('바이올린'), ['violin', 'erhu']],
  cello: [N_('첼로'), ['cello']],
  pizzicato: [N_('피치카토'), ['stringspizz']],
  brass: [N_('금관'), ['trumpet', 'trombone', 'horn', 'synbrass', 'brassstab']],
  sax: [N_('색소폰'), ['altosax', 'tenorsax']],
  flute: [N_('플루트'), ['flute', 'recorder']],
  clarinet: [N_('클라리넷 · 목관'), ['clarinet', 'oboe']],
  mallet: [N_('건반 타악기'), ['marimba', 'vibraphone', 'xylophone', 'glockenspiel', 'steeldrum']],
  bell: [N_('벨'), ['fmbell', 'handbells', 'glockenspiel']],
  harmonica: [N_('하모니카 · 아코디언'), ['harmonica']],
  choir: [N_('합창'), ['choir', 'oohs']],
  voice: [N_('노래 (멜로디)'), ['vocal', 'synlead', 'flute', 'oohs']],
  drums_ac: [N_('어쿠스틱 드럼'), ['acousticdrums']],
  drums_el: [N_('전자 드럼'), ['drums808', 'drums909', 'drumstrap']],
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
export const STEM_NAMES = { vocals: N_('리드 보컬'), backing: N_('코러스'), drums: N_('드럼'), bass: N_('베이스'), guitar: N_('기타'), piano: N_('피아노'), other: N_('그 밖의 악기') };

const MIN_BARS = 8;

// bar start times (seconds), the same grid the project's tempo map uses
export function barGrid(r) {
  const meter = r.meter >= 2 && r.meter <= 7 ? r.meter : 4;
  const mm = meterMap(r); // with time signature changes the bars follow them, as in the project
  const db = mm.changes.length ? mm.bars.map((b) => b.t) : cleanDownbeats(r.downbeats || [], r.beats || [], meter);
  const bars = db.length ? db.slice() : [r.first_downbeat || 0];
  const len = bars.length > 1 ? (bars.at(-1) - bars[0]) / (bars.length - 1) : (60 / (r.bpm || 120)) * meter;
  while (bars.at(-1) < r.duration) bars.push(bars.at(-1) + len);
  return bars;
}
const barOf = (bars, t) => { let lo = 0, hi = bars.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (bars[m] <= t) lo = m; else hi = m - 1; } return lo; };

// notes of a stem as [t, d, n, v] (drums: hits as short notes)
// (with octave errors corrected once the stem has been listened to: fixStemOctaves)
export const stemNotes = (r, k) => (k === 'drums' ? (r.drums || []).map(([t, n, v]) => [t, 0.1, n, v]) : r.fixed?.[k] || r.notes?.[k] || []);

// notes the transcription put an octave off, put right from the stem's spectrum (timbre.fixOctaves).
// The corrected copy is kept on the result (r.fixed) so previews and the project use it too.
export function fixStemOctaves(r, k, audio) {
  if (k === 'drums' || !r.notes?.[k]?.length) return null;
  if (r.fixed?.[k]) return r.octaveFix[k];
  const t0 = performance.now();
  const res = T.fixOctaves(audio.x, audio.rate, r.notes[k], { runs: k === 'bass', dedupe: k === 'bass' });
  (r.fixed ||= {})[k] = res.notes;
  const up = res.changed.filter(([, a, b]) => b > a).length;
  return ((r.octaveFix ||= {})[k] = { notes: r.notes[k].length, checked: res.checked, up, down: res.changed.length - up, duplicates: res.removed.length, removed: res.removed, ms: Math.round(performance.now() - t0) });
}

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
      // how often the part is heard: runs of played bars (two silent bars or more apart)
      let heard = 0, playedBars = 0, last = -9;
      for (const s of g.secs) for (let b = s.start; b < s.end; b++) if (played[b]) { if (b - last > 2) heard++; last = b; playedBars++; }
      const thin = density < 0.75 || nNotes < 24;
      // a stray part: heard only once or twice in the whole song, briefly, or only a handful of notes
      // (bleed from another instrument or a misrecognition, most of the time)
      const stray = thin || (heard <= 2 && playedBars <= 6);
      return { ...g, label, share, notes: nNotes, density, heard, playedBars, thin, stray };
    }).sort((a, b) => a.secs[0].start - b.secs[0].start);
  }
  return { bars, stems: out };
}

// candidates for a group: the instruments of its best categories, the first one recommended
// (installed instruments first within a category)
export function candidates(S, k, g) {
  // measured by ear (matchAll): the closest sounds first, with their accuracy
  if (g.match?.cands?.length) {
    const info = (id) => S.app.instruments.find((i) => i.id === id);
    const list = g.match.cands.slice(0, 8).map((c) => ({
      id: c.id, acc: c.acc, parts: c.parts, kind: candKind(S, c.id), name: candName(S, c.id), cat: g.label, share: 0,
      installed: isSynthId(c.id) || !!info(c.id)?.installed, downloadable: !!info(c.id)?.downloadable,
    }));
    list[0].recommended = true;
    return list;
  }
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

export const rangeText = (secs) => t('{r}마디', { r: secs.map((s) => (s.end - s.start <= 1 ? `${s.start + 1}` : `${s.start + 1}~${s.end}`)).join(', ') });

// a few seconds of a group's notes played by a candidate instrument (rendered offline)
export async function renderCandidate(S, r, k, g, instId, bars, seconds = 8) {
  const t0 = bars[g.secs[0].start], t1 = Math.min(bars[g.secs[0].end] ?? r.duration, t0 + seconds);
  const p = newProject();
  p.bpm = Math.round(r.bpm * 100) / 100;
  const ch = channelFor(S, instId, 'preview', 0, { vol: 0.8, send: 0.12 });
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
  p.name = t('{name} (MIDI 변환)', { name: fileName.replace(/\.[^.]+$/, '') });
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
        const ch = channelFor(S, id, `${tc('stem', STEM_NAMES[k])} · ${candName(S, id)}`, p.channels.length + chans.size, { vol: k === 'drums' ? 0.85 : 0.75, send: kit ? 0.05 : 0.15 });
        chans.set(key, ch);
      }
      // the dynamics the instrument matched best at (the transcription's velocities run low)
      const vk = g.match?.cands?.find((c) => c.id === id)?.vel || 1;
      for (const s of g.secs) for (let b = s.start; b < s.end; b++) owner.push([k, b, chans.get(key), vk]);
    }
  }
  const who = new Map(owner.map(([k, b, ch, vk]) => [`${k}:${b}`, [ch, vk]]));
  p.channels.push(...chans.values());
  const endBar = Math.max(1, Math.ceil(tickOf(r.duration) / bt));
  const tr = p.playlist.tracks.length;
  p.playlist.tracks.push({ ...newTrack(tr), name: t('MIDI (악기 지정)') });
  const pats = [];
  for (let b = 0; b < endBar; b += 8) { const len = Math.min(8, endBar - b), pat = newPattern(p.patterns.length + pats.length, len); pat.name = t('{a}~{b}마디', { a: b + 1, b: b + len }); pats.push([b, len, pat]); }
  for (const k of order) for (const [t, d, n, v] of stemNotes(r, k)) {
    const [ch, vk] = who.get(`${k}:${barOf(plan.bars, t)}`) || [];
    if (!ch) continue;
    const tk = tickOf(t), slot = pats[Math.min(pats.length - 1, Math.floor(tk / bt / 8))];
    if (!slot) continue;
    const [b0, , pat] = slot;
    (pat.notes[ch.id] ||= []).push({ t: tk - b0 * bt, d: Math.max(STEP / 4, tickOf(t + d) - tk), n, v: Math.min(127, Math.round(v * vk)) });
  }
  for (const [b0, len, pat] of pats) { if (!Object.keys(pat.notes).length) continue; p.patterns.push(pat); p.playlist.clips.push({ id: uid('k'), pattern: pat.id, track: tr, start: b0, len }); }
  if (!p.patterns.length) p.patterns = [newPattern(0)];
  p.current = p.patterns[0].id;
  p.selected = [...chans.values()][0]?.id || p.channels[0]?.id;
  while (p.playlist.tracks.length < 8) p.playlist.tracks.push(newTrack(p.playlist.tracks.length));
  return p;
}

// ---------------------------------------------------------------------------------------------
// Timbre matching: for every group, the MeloFi instruments and synth presets that sound most like
// the stem, each with an accuracy (timbre.js: analysis-by-synthesis, docs/timbre-matching.md)

// synth presets are candidates too: id `synth:<preset name>`, named by their family
export const SYNTH_FAM_KO = { '리드': '신스 리드', '패드': '신스 패드', '베이스': '신스 베이스', '플럭': '신스 플럭', '건반': '신스 건반', '아르프·시퀀스': '신스 아르페지오', '브라스·스트링': '신스 브라스·스트링', '벨·말렛': '신스 벨', '보컬': '신스 보이스', 'FX': '신스 효과음' }; // i18n-ignore: category ids / values shown via candKind
const SYNTH_FAM = {};
for (const [c, names] of Object.entries(SYNTH_CATEGORIES)) for (const n of names) SYNTH_FAM[n] = c;
export const isSynthId = (id) => String(id).startsWith('synth:');
const presetOf = (id) => String(id).slice(6).replace(/~\d+$/, '');
// synth settings fitted to a stem (synthSearch): `synth:<preset>~<n>` -> the full parameter set
const TUNED = new Map();
let tunedSeq = 0;
const synthParams = (id) => TUNED.get(id) || { ...synthDefaults(), ...(SYNTH_PRESETS[presetOf(id)] || {}) };

// what an instrument family is called in the table
const FAM_KO = { piano: N_('피아노'), keys: N_('건반'), organ: N_('오르간'), synth: N_('신스'), guitar: N_('기타'), bass: N_('베이스'), strings: N_('현악기'), brass: N_('금관'), winds: N_('목관'), mallets: N_('건반 타악기'), vocal: N_('보컬 · 합창'), world: N_('민속 악기'), drums: N_('드럼'), fx: N_('효과음') };

export function candName(S, id) {
  if (isSynthId(id)) return TUNED.has(id) ? t('{name} · 이 곡에 맞춤', { name: presetOf(id) }) : presetOf(id);
  return S.app.instruments.find((i) => i.id === id)?.name || id;
}
// the kind of sound, concrete: "신스 리드", "현악기", ...
export function candKind(S, id) {
  if (isSynthId(id)) return t(SYNTH_FAM_KO[SYNTH_FAM[presetOf(id)]] || N_('신스'));
  const m = S.app.instruments.find((i) => i.id === id);
  if (m?.family === 'synth') {
    // MeloFi's rendered synth instruments: the role from the id
    return /bass|808|reese/.test(id) ? t('신스 베이스') : /pad|choir|brightness/.test(id) ? t('신스 패드') : /pluck/.test(id) ? t('신스 플럭') : /brass/.test(id) ? t('신스 브라스') : /saw|lead|chip|calliope/.test(id) ? t('신스 리드') : t('신스 건반');
  }
  return t(FAM_KO[m?.family] || m?.model || N_('악기'));
}

export function channelFor(S, id, name, i, extra = {}) {
  if (isSynthId(id)) {
    const pr = presetOf(id);
    return newChannel('synth', name, i, { kind: 'synth', synth: synthParams(id), synthPreset: TUNED.has(id) ? null : pr, ...extra });
  }
  return newChannel(id, name, i, { ...(S.isKit(id) ? { stepNote: 36 } : {}), ...extra });
}

let FP = null;
export async function fingerprints() {
  if (!FP) { try { FP = await (await fetch(new URL('../fingerprints.json', import.meta.url))).json(); } catch { FP = {}; } }
  return FP;
}

// a stem file as mono samples
export async function stemAudio(file, rate = 44100) {
  const bytes = await window.melofi.stemsRead(file);
  if (!bytes) throw new Error('분리한 트랙을 읽지 못했어요');
  const ctx = new OfflineAudioContext(2, 1, rate);
  const b = await ctx.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const L = b.getChannelData(0), R = b.numberOfChannels > 1 ? b.getChannelData(1) : L, x = new Float32Array(L.length);
  for (let i = 0; i < x.length; i++) x[i] = 0.5 * (L[i] + R[i]);
  return { x, rate: b.sampleRate };
}

// the probe notes with the notes around them, laid out back to back so one render covers them:
// clips [{ a, b, at }] = the original span [a, b) played from `at` in the render
export function clipsFor(probes, all) {
  const spans = probes.map(([t, d]) => [t - 0.5, t + Math.min(d, 0.7) + 0.5]).sort((x, y) => x[0] - y[0]);
  const merged = [];
  for (const s of spans) { const m = merged.at(-1); if (m && s[0] <= m[1] + 0.3) m[1] = Math.max(m[1], s[1]); else merged.push([...s]); }
  let at = 0.2;
  const clips = merged.map(([a, b]) => { const c = { a, b, at }; at += b - a + 1.0; return c; });
  // a transcription tends to end notes early: for the comparison render a note lasts until the
  // next one when only a short gap is left between them (the project's notes are not changed)
  const sorted = [...all].sort((x, y) => x[0] - y[0]);
  const held = new Map(sorted.map((nt, i) => {
    const next = sorted.slice(i + 1).find((o) => o[0] > nt[0] + 0.03);
    const gap = next ? next[0] - (nt[0] + nt[1]) : Infinity;
    return [nt, gap > 0 && gap < 0.12 ? Math.min(nt[1] * 1.6 + 0.05, next[0] - nt[0] - 0.01) : nt[1]];
  }));
  const notes = [];
  for (const c of clips) for (const nt of all) if (nt[0] >= c.a && nt[0] < c.b - 0.05) notes.push([nt[0] - c.a + c.at, Math.min(held.get(nt) ?? nt[1], c.b - nt[0]), nt[2], nt[3]]);
  return { clips, notes, length: at };
}
const toClip = (clips, t) => { const c = clips.find((k) => t >= k.a && t < k.b); return c ? t - c.a + c.at : null; };

// notes [t, d, n, v] (seconds) played by an instrument, mono, rendered offline, dry: just the
// sampler or the synth into the context (no mixer strip, reverb or limiter: the sound itself, and
// several times faster than a project render). Returns the samples and where t = 0 is in them.
export async function renderNotes(S, id, notes, length, rate = 44100) {
  const off = 0.05, vel = (v) => Math.max(1, Math.min(127, Math.round(v || 90)));
  let ctx = null;
  if (isSynthId(id)) {
    ctx = new OfflineAudioContext(2, Math.ceil((off + length + 1) * rate), rate);
    const ch = new SynthChannel(ctx, ctx.destination);
    ch.setParams(synthParams(id));
    for (const [t, d, n, v] of notes) ch.noteOn(n, vel(v), off + t, d);
  } else {
    // sampled instruments: the sampler's own voice maths, in this thread (sampledVoices)
    const inst = await loadSome(id, notes.map(([, , n, v]) => [n, vel(v)]));
    return { x: sampledVoices(inst, notes.map(([t, d, n, v]) => [t, d, n, vel(v)]), off, length + 1, rate), rate, off };
  }
  const buf = await ctx.startRendering();
  const L = buf.getChannelData(0), R = buf.getChannelData(1), x = new Float32Array(L.length);
  for (let i = 0; i < x.length; i++) x[i] = 0.5 * (L[i] + R[i]);
  return { x, rate, off };
}

// The MeloFi sampler (renderer/js/sampler-worklet.js) played offline in plain JS, mono: the same
// regions, gain curve, 32-tap Kaiser-windowed sinc interpolation (bit-exact when a sample is played
// at its own pitch and rate), attack ramp, loop and release. An offline AudioContext per candidate
// with its own worklet holds on to its copy of the samples long after the render, and the matching
// plays hundreds of candidates per song.
const TAPS = 32, HALF = 16, PHASES = 2048;
let KERNEL = null;
function kernel() {
  if (KERNEL) return KERNEL;
  const bessel0 = (x) => { let s = 1, t = 1; for (let k = 1; k < 30; k++) { t *= (x / (2 * k)) * (x / (2 * k)); s += t; } return s; };
  const k = new Float32Array((PHASES + 1) * TAPS), i0b = bessel0(9);
  for (let p = 0; p <= PHASES; p++) {
    let sum = 0;
    for (let j = 0; j < TAPS; j++) {
      const x = j - (HALF - 1) - p / PHASES, sinc = x === 0 ? 1 : Math.sin(Math.PI * 0.94 * x) / (Math.PI * 0.94 * x), r = x / HALF;
      const w = sinc * (Math.abs(r) >= 1 ? 0 : bessel0(9 * Math.sqrt(1 - r * r)) / i0b);
      k[p * TAPS + j] = w; sum += w;
    }
    for (let j = 0; j < TAPS; j++) k[p * TAPS + j] /= sum;
  }
  return (KERNEL = k);
}
export function sampledVoices(inst, notes, off, seconds, rate) {
  const K = kernel(), out = new Float32Array(Math.ceil((off + seconds) * rate)), m = inst.manifest;
  const region = (note, v) => { const list = inst.byKey[note]; if (!list?.length) return null; return list.find((r) => v >= r.lv && v <= r.hv) || list.reduce((b, r) => (Math.abs((r.lv + r.hv) / 2 - v) < Math.abs((b.lv + b.hv) / 2 - v) ? r : b)); };
  // a key struck again cuts its previous voice (30 ms)
  const sorted = notes.map((nt, i) => ({ nt, i })).sort((a, b) => a.nt[0] - b.nt[0]);
  const cut = new Map(), lastOn = new Map();
  for (const { nt, i } of sorted) { if (lastOn.has(nt[2])) cut.set(lastOn.get(nt[2]), nt[0]); lastOn.set(nt[2], i); }
  notes.forEach(([t, d, note, vel], idx) => {
    const r = region(note, vel); if (!r) return;
    const d0 = inst.data.get(r.s); if (!d0) return;
    const meta = m.samples[r.s], L = d0.L, R = d0.R || d0.L, last = L.length - PAD;
    const x = vel / 127, amp = ((m.gain ?? 1) * r.g * (0.45 + 0.55 * x * x)) / 32768;
    const step = Math.pow(2, (note - r.c) / 12 + (r.t || 0) / 1200) * (meta.rate / rate), exact = step === 1;
    const atk = amp / (r.attack ? Math.max(96, r.attack * rate) : 96);
    const ls = r.loop ? PAD + r.loop[0] : 0, le = r.loop ? PAD + r.loop[1] : 0;
    const start = Math.round((off + t) * rate);
    const relAt = Math.round((off + t + d) * rate), cutAt = cut.has(idx) ? Math.round((off + cut.get(idx)) * rate) : Infinity;
    const rcRel = Math.exp(-1 / (Math.max(0.005, r.r / 4.5) * rate)), rcCut = Math.exp(-1 / (0.03 * rate));
    let pos = PAD + (r.off || 0), g = 0, rc = 1, rel = false;
    for (let i = start; i < out.length; i++) {
      if (i === relAt || i === cutAt) { rel = true; rc = rc === 1 ? (i === cutAt ? rcCut : rcRel) : Math.min(rc, i === cutAt ? rcCut : rcRel); }
      if (rel) g *= rc; else if (g < amp) { g += atk; if (g > amp) g = amp; }
      if (pos >= last || (rel && g < amp * 1e-4)) break;
      let l, rr;
      if (exact) { l = L[pos]; rr = R[pos]; pos += 1; }
      else {
        const b = pos | 0, ko = (((pos - b) * PHASES) | 0) * TAPS, o = b - (HALF - 1);
        l = 0; rr = 0;
        for (let j = 0; j < TAPS; j++) { const w = K[ko + j]; l += L[o + j] * w; rr += R[o + j] * w; }
        pos += step;
      }
      if (le && pos >= le && !rel) pos -= le - ls;
      out[i] += 0.5 * (l + rr) * g;
    }
  });
  return out;
}

// the sounds a stem may be compared with: installed or downloadable instruments (no effects) and
// the synth presets (no FX)
export function pool(S, kit) {
  const fp = FP || {}, ids = [];
  for (const m of S.app.instruments) {
    if (m.family === 'fx' || kit !== (m.family === 'drums')) continue;
    if (!m.installed && !m.downloadable) continue;
    ids.push(m.id);
  }
  if (!kit) for (const name of Object.keys(SYNTH_PRESETS)) if (SYNTH_FAM[name] !== 'FX') ids.push(`synth:${name}`);
  return ids.filter((id) => kit || fp[id]?.notes?.length);
}

// the notes of a group: the stem's notes inside its sections
export function groupNotes(r, k, g, bars) {
  return stemNotes(r, k).filter(([t]) => g.secs.some((s) => t >= bars[s.start] && t < (bars[s.end] ?? Infinity)));
}

// the plausible MeloFi sounds for a group, from the stem and the recognised categories
export function plausibleFor(S, k, g) {
  const [allowed] = STEM[k] || [MELODIC];
  const cats = [...new Set([...Object.entries(g.share || {}).filter(([, v]) => v > 0.05).map(([c]) => c), g.base || g.cat, ...allowed])];
  const ids = [];
  for (const c of cats) ids.push(...(STEM_INST[k]?.[c] || CATS[c]?.[1] || []));
  if (cats.includes('synth') || k === 'other') {
    const fams = k === 'bass' ? ['베이스'] : k === 'piano' ? ['건반', '패드', '플럭', '벨·말렛'] : ['리드', '패드', '플럭', '건반', '아르프·시퀀스', '브라스·스트링', '벨·말렛', '보컬']; // i18n-ignore: category ids / values shown via candKind
    for (const [name, fam] of Object.entries(SYNTH_FAM)) if (fams.includes(fam)) ids.push(`synth:${name}`);
  }
  return [...new Set(ids)];
}

const PARALLEL = 4;

// rooms tried per group: wet level (of the dry) and decay time to -60 dB
const ROOMS = [{ wet: 0.12, decay: 0.5 }, { wet: 0.12, decay: 1.4 }, { wet: 0.25, decay: 0.5 }, { wet: 0.25, decay: 1.4 }, { wet: 0.4, decay: 2.2 }];
const irCache = new Map();
// a plain room: a decaying noise tail (always the same noise, so every candidate gets the same room)
export async function addRoom(x, rate, { wet, decay }) {
  const key = `${rate}:${decay}`;
  if (!irCache.has(key)) {
    const n = Math.round(rate * decay * 1.1), ir = new Float32Array(n);
    let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    for (let i = 0; i < n; i++) ir[i] = (rnd() * 2 - 1) * Math.exp((-6.9 * i) / (rate * decay));
    irCache.set(key, ir);
  }
  const ctx = new OfflineAudioContext(1, x.length, rate);
  const src = ctx.createBufferSource(), buf = ctx.createBuffer(1, x.length, rate); buf.copyToChannel(x, 0); src.buffer = buf;
  const conv = ctx.createConvolver(), irb = ctx.createBuffer(1, irCache.get(key).length, rate); irb.copyToChannel(irCache.get(key), 0); conv.buffer = irb; conv.normalize = true;
  const g = ctx.createGain(); g.gain.value = wet;
  src.connect(ctx.destination); src.connect(conv).connect(g).connect(ctx.destination);
  src.start();
  return (await ctx.startRendering()).getChannelData(0);
}

// Fitting MeloFi Synth to a synth part: coordinate search from a preset over the settings that make
// a synth sound what it is (waveforms, filter cutoff / resonance / envelope, amp envelope, unison
// detune, drive, sub), each step trying a few values of one setting and keeping it when the accuracy
// rises; stops at the budget or the target.
const SEARCH_BUDGET = 14;
const MOVES = [
  ['w1', (v) => [0, 1, 2, 3, 4, 6, 7].filter((x) => x !== v)],
  ['cut', (v) => [v * 0.5, v * 1.8]],
  ['fenv', (v) => [v - 1.2, v + 1.2]],
  ['aa', (v) => [Math.max(0.001, v / 4), Math.min(4, v * 4 + 0.01)]],
  ['ad', (v) => [v * 0.5, v * 2]],
  ['as', (v) => [Math.max(0, v - 0.3), Math.min(1, v + 0.3)]],
  ['det', (v) => [v * 0.4, Math.min(60, v * 2 + 5)]],
  ['uni', (v) => (v > 1 ? [1] : [5])],
  ['res', (v) => [Math.max(0.1, v / 3), Math.min(15, v * 3)]],
  ['w2', (v) => [0, 1, 3].filter((x) => x !== v)],
  ['drv', (v) => (v > 0.05 ? [0] : [0.4])],
  ['sub', (v) => (v > 0.05 ? [0] : [0.5])],
];
const LIMIT = Object.fromEntries(SYNTH_PARAMS.filter((p) => p.key).map((p) => [p.key, [p.min, p.max]]));
async function tuneSynth(base, { evalParams, budget, target }) {
  let cur = { ...synthParams(base.id) }, curAcc = base.acc, evals = 0;
  for (let pass = 0; pass < 2 && evals < budget && curAcc < target; pass++) {
    for (const [key, vals] of MOVES) {
      if (evals >= budget || curAcc >= target) break;
      let bestV = null, bestAcc = curAcc;
      // the values of one setting are tried at once (each render on its own thread)
      const [lo, hi] = LIMIT[key] || [-Infinity, Infinity];
      const tryV = [...new Set(vals(cur[key]).map((v0) => Math.max(lo, Math.min(hi, v0))))].filter((v) => v !== cur[key]).slice(0, Math.max(0, budget - evals));
      const res = await Promise.all(tryV.map((v) => evalParams({ ...cur, [key]: v })));
      evals += tryV.length;
      res.forEach((r, i) => { if (r && !r.error && r.acc > bestAcc + 0.3) { bestAcc = r.acc; bestV = tryV[i]; } });
      if (bestV != null) { cur = { ...cur, [key]: bestV }; curAcc = bestAcc; }
    }
  }
  return { params: cur, acc: curAcc, evals };
}

// one group. audio: the stem's samples. Returns { cands: [{ id, acc, parts, pre }] best first,
// probes (notes measured), desc (the sound described, timbre.describe) }
export async function matchGroup(S, r, k, g, bars, audio, { onStep = () => {}, plausible = [], max = 8, widen = 6, target = 90, also = [], normalize = true, synthSearch = true, reverb = true } = {}) {
  await fingerprints();
  const kit = k === 'drums';
  const all = groupNotes(r, k, g, bars);
  const probes = T.probeNotes(all, { max: kit ? 20 : 12, kit });
  const stemF = T.usable(T.measure(audio.x, audio.rate, probes, { kit }), kit);
  const keep = stemF.map((f, i) => (f ? i : -1)).filter((i) => i >= 0);
  const desc = T.describe(stemF);
  if (keep.length < 4) return { cands: [], probes: keep.length, desc, unmeasured: true };
  const P = keep.map((i) => probes[i]), SF = keep.map((i) => stemF[i]);
  // notes with others sounding in their frame (chords)
  const poly = P.map(([t, d, n]) => all.some((o) => o[2] !== n && o[0] < t + Math.min(d, 0.2) && o[0] + o[1] > t + 0.03));
  SF.forEach((f, i) => { f.poly = poly[i]; f.bassStem = k === 'bass'; });
  // pre-screen every candidate against its fingerprint
  const ids = pool(S, kit);
  const pre = new Map(ids.map((id) => [id, kit ? { z: 0, acc: 0 } : T.prescreen(SF, FP[id])]));
  const byPre = [...ids].sort((a, b) => pre.get(a).z - pre.get(b).z);
  const plaus = plausible.filter((id) => pre.has(id)).sort((a, b) => pre.get(a).z - pre.get(b).z);
  // first: the best plausible ones and the best of all by fingerprint; then, while nothing reaches
  // the target, further afield (other families and genres) in fingerprint order
  const first = kit ? ids : [...new Set([...plaus.slice(0, Math.ceil(max / 2)), ...byPre])].slice(0, max);
  const { clips, notes, length } = clipsFor(P, all);
  const at = P.map(([t]) => toClip(clips, t));
  const tried = new Map();
  const stats = { renders: 0, renderMs: 0, wall: performance.now() };
  // the room: songs put reverb on most parts, the candidates are rendered dry. One room (a wet level
  // and a decay time, fitRoom below) is fitted per group on its best few candidates and then put on
  // every candidate alike, so all of them are heard in the same room and none gets its own.
  let room = null;
  const raws = new Map(); // id -> { x, off, rate, vk }: the dry render that counted
  const measureRen = (x, rate, off) => P.map(([, d, n], i) => { const f = T.noteFeatures(x, rate, at[i], d, n, { off, kit, span: SF[i].span }); if (f) { f.poly = poly[i]; f.bassStem = k === 'bass'; } return f; });
  const score = async (id, raw, vk, rm) => {
    const x = rm ? await addRoom(raw.x, raw.rate, rm) : raw.x;
    const c = T.compare(SF, measureRen(x, raw.rate, raw.off), { normalize });
    return { id, acc: c.acc, z: c.z, parts: c.parts, raw: c.raw, n: c.n, vel: vk, tilt: c.tilt, room: rm, pre: pre.get(id)?.acc ?? null, ...(TUNED.has(id) ? { tuned: true } : {}) };
  };
  const one = async (id) => {
    onStep(id);
    try {
      // a transcription's velocities run low (often half what was played), and a sampled
      // instrument's soft layer can sound quite unlike its loud one: sampled candidates also play
      // half as hard again, and the closer of the two counts
      let best = null;
      for (const vk of isSynthId(id) || kit ? [1] : [1, 1.5]) {
        const r0 = performance.now();
        const ren = await renderNotes(S, id, vk === 1 ? notes : notes.map(([a, b, c, v]) => [a, b, c, Math.min(127, Math.round((v || 90) * vk))]), length);
        stats.renders++; stats.renderMs += performance.now() - r0;
        const c = await score(id, ren, vk, room);
        if (!best || c.acc > best.acc) { best = c; raws.set(id, { ...ren, vk }); }
      }
      tried.set(id, best);
    } catch (err) { tried.set(id, { id, acc: 0, error: String(err.message || err), pre: pre.get(id)?.acc || 0 }); }
  };
  const fitRoom = async () => {
    const top = [...tried.values()].filter((c) => !c.error && raws.has(c.id)).sort((a, b) => b.acc - a.acc).slice(0, 3);
    if (top.length < 2) return;
    const mean = (cs) => cs.reduce((a, c) => a + c.acc, 0) / cs.length;
    let bestRoom = null, bestMean = mean(top) + 1; // a room has to be worth a point to be used
    for (const rm of ROOMS) {
      const cs = await Promise.all(top.map((c) => score(c.id, raws.get(c.id), c.vel, rm)));
      if (mean(cs) > bestMean) { bestMean = mean(cs); bestRoom = rm; }
    }
    if (!bestRoom) return;
    room = bestRoom;
    for (const c of [...tried.values()]) if (!c.error && raws.has(c.id)) tried.set(c.id, await score(c.id, raws.get(c.id), c.vel, room));
  };
  // offline renders run on their own threads: a few at once
  const run = async (list) => {
    const todo = [...new Set(list)].filter((id) => !tried.has(id));
    for (let i = 0; i < todo.length; i += PARALLEL) {
      await Promise.all(todo.slice(i, i + PARALLEL).map(one));
      await new Promise((res) => setTimeout(res, 0));
    }
  };
  await run([...first, ...also.filter((id) => pre.has(id))]);
  if (reverb) await fitRoom();
  stats.room = room;
  for (let round = 0; round < 2 && !kit; round++) {
    if (Math.max(0, ...[...tried.values()].map((c) => c.acc)) >= target) break;
    await run(byPre.filter((id) => !tried.has(id)).slice(0, widen));
  }
  // a synth part: MeloFi's own synth is set to match it, starting from the closest presets
  // (synthSearch below). That is the synthesizer's settings fitted to a synthesizer part, not a new
  // instrument made up.
  if (synthSearch && !kit && Math.max(0, ...[...tried.values()].map((c) => c.acc)) < target) {
    const bases = [...tried.values()].filter((c) => !c.error && isSynthId(c.id)).sort((a, b) => b.acc - a.acc).slice(0, 1);
    const best = Math.max(0, ...[...tried.values()].map((c) => c.acc));
    for (const b of bases) {
      if (b.acc < best - 8) continue; // too far from the best of all: not a synth part
      const tuned = await tuneSynth(b, { evalParams: async (params) => {
        const id = `synth:${presetOf(b.id)}~${++tunedSeq}`;
        TUNED.set(id, params);
        await one(id);
        return tried.get(id);
      }, budget: SEARCH_BUDGET, target });
      stats.tuned = (stats.tuned || 0) + tuned.evals;
    }
    // keep only the best tuned version of each base preset
    const keep = new Map();
    for (const c of tried.values()) if (TUNED.has(c.id)) { const k = presetOf(c.id); if (!keep.has(k) || keep.get(k).acc < c.acc) keep.set(k, c); }
    for (const c of [...tried.values()]) if (TUNED.has(c.id) && keep.get(presetOf(c.id)) !== c) { tried.delete(c.id); TUNED.delete(c.id); }
  }
  const cands = [...tried.values()].filter((c) => !c.error).sort((a, b) => b.acc - a.acc);
  stats.wall = Math.round(performance.now() - stats.wall); stats.renderMs = Math.round(stats.renderMs); stats.seconds = +length.toFixed(1);
  raws.clear();
  return { cands, probes: P.length, desc, room, errors: [...tried.values()].filter((c) => c.error).length, stats };
}

// A group can hold more than one instrument (the recognition's classes are broad: "synth" for a
// lead in the verse and a pad in the chorus). Its played bars are measured in blocks of 4 and blocks
// are compared note against note, only between notes within 4 semitones of each other (an
// instrument's colour changes with the register; comparing a low block with a high one would split
// one piano into four). Two blocks differ when their notes are further apart than the notes inside
// each block are from each other (SPLIT_RATIO) and clearly so in absolute terms (SPLIT_Z, the
// accuracy's own z). Blocks are clustered by average linkage while they do not differ; a cluster of
// fewer than MIN_BARS played bars joins its nearest one.
const SPLIT_Z = 1.8, SPLIT_RATIO = 1.6, BLOCK = 4;
const pairZ = (A, B, same) => {
  const zs = [];
  for (let i = 0; i < A.length; i++) for (let j = same ? i + 1 : 0; j < B.length; j++) {
    if (Math.abs(A[i].n - B[j].n) > 4) continue;
    const d = T.noteDiff(A[i], B[j]); if (d) zs.push(d.z);
  }
  return zs.length >= 2 ? T.median(zs) : null;
};
export function splitByTimbre(r, k, groups, bars, audio) {
  const kit = k === 'drums', all = stemNotes(r, k), out = [];
  for (const g of groups) {
    const blocks = [];
    if (!g.stray && !kit) for (const sc of g.secs) for (let b = sc.start; b < sc.end; b += BLOCK) {
      const e = Math.min(sc.end, b + BLOCK), t0 = bars[b], t1 = bars[e] ?? Infinity;
      const ns = all.filter(([t]) => t >= t0 && t < t1);
      if (ns.length < 3) continue;
      const fs = T.usable(T.measure(audio.x, audio.rate, T.probeNotes(ns, { max: 8 }), {}), false).filter(Boolean);
      if (fs.length >= 3) blocks.push({ start: b, end: e, fs, within: pairZ(fs, fs, true) });
    }
    if (blocks.length < 4) { out.push(g); continue; }
    const within = T.median(blocks.map((b) => b.within).filter((v) => v != null)) || 1;
    // distance of two clusters: the median of their blocks' note-pair distances (null: no notes in
    // a shared register, which is no evidence of a change)
    blocks.forEach((b, i) => { b.i = i; });
    const D = blocks.map((x) => blocks.map((y) => (x === y ? null : pairZ(x.fs, y.fs, false))));
    const dz = (A, B) => { const v = []; for (const x of A) for (const y of B) { const d = D[x.i][y.i]; if (d != null) v.push(d); } return v.length ? T.median(v) : null; };
    const differ = (d) => d != null && d > SPLIT_Z && d > within * SPLIT_RATIO;
    let cl = blocks.map((b) => [b]);
    for (;;) {
      let best = null;
      for (let i = 0; i < cl.length; i++) for (let j = i + 1; j < cl.length; j++) {
        const d = dz(cl[i], cl[j]);
        if (differ(d)) continue;
        // nothing to compare (no shared register) is no evidence of a change: they merge, after
        // the ones that were measured close
        const key = d ?? SPLIT_Z / 2;
        if (!best || key < best[0]) best = [key, i, j];
      }
      if (!best) break;
      cl[best[1]] = cl[best[1]].concat(cl[best[2]]); cl.splice(best[2], 1);
    }
    // small clusters join the nearest
    for (;;) {
      if (cl.length < 2) break;
      const i = cl.findIndex((c) => c.reduce((a, b) => a + b.end - b.start, 0) < MIN_BARS);
      if (i < 0) break;
      let j = -1, bd = Infinity; cl.forEach((c, x) => { if (x !== i) { const d = dz(cl[i], c) ?? 99; if (d < bd) { bd = d; j = x; } } });
      if (j < 0) j = i ? 0 : 1;
      cl[j] = cl[j].concat(cl[i]); cl.splice(i, 1);
    }
    if (cl.length < 2) { out.push(g); continue; }
    // each cluster: its blocks back into sections (adjacent blocks join), unmeasured bars go to the
    // cluster of the block before them
    const owner = new Map();
    cl.forEach((c, ci) => c.forEach((b) => { for (let x = b.start; x < b.end; x++) owner.set(x, ci); }));
    let lastC = owner.get(blocks[0].start);
    const secsOf = cl.map(() => []);
    for (const sc of g.secs) for (let b = sc.start; b < sc.end; b++) {
      const c = owner.has(b) ? owner.get(b) : lastC; lastC = c;
      const list = secsOf[c], prev = list.at(-1);
      if (prev && prev.end === b) prev.end = b + 1; else list.push({ start: b, end: b + 1 });
    }
    secsOf.forEach((secs, ci) => {
      const t = (x) => bars[x] ?? Infinity, ns = all.filter(([tt]) => secs.some((sc) => tt >= t(sc.start) && tt < t(sc.end)));
      const nb = secs.reduce((a, sc) => a + sc.end - sc.start, 0);
      let heard = 0, playedBars = 0, last = -9;
      for (const sc of secs) for (let b = sc.start; b < sc.end; b++) if (ns.some(([tt]) => tt >= t(b) && tt < t(b + 1))) { if (b - last > 2) heard++; last = b; playedBars++; }
      const density = ns.length / Math.max(1, nb), thin = density < 0.75 || ns.length < 24;
      out.push({ ...g, cat: ci ? `${g.cat}~${ci + 1}` : g.cat, base: g.base || g.cat, secs, bars: nb, notes: ns.length, density, heard, playedBars, thin, stray: thin || (heard <= 2 && playedBars <= 6), split: cl.length });
    });
  }
  return out.sort((a, b) => a.secs[0].start - b.secs[0].start);
}

// every group of every stem gets g.match. onProgress(fraction, label)
export async function matchAll(S, r, plan, { onProgress = () => {}, target = 90, also = [], octaves = true, split = true, normalize = true, synthSearch = true, reverb = true } = {}) {
  await fingerprints();
  // each stem is listened to once: octave errors, then the groups split where the timbre changes
  const audio = new Map();
  for (const k of Object.keys(plan.stems)) {
    onProgress(0, t('{name} 듣는 중', { name: tc('stem', STEM_NAMES[k] || k) }));
    try {
      audio.set(k, await stemAudio(r.stems[k]));
      if (octaves) fixStemOctaves(r, k, audio.get(k));
      if (split) plan.stems[k] = splitByTimbre(r, k, plan.stems[k], plan.bars, audio.get(k));
    } catch (err) { audio.set(k, null); }
    await new Promise((res) => setTimeout(res, 0));
  }
  const jobs = [];
  for (const [k, groups] of Object.entries(plan.stems)) for (const g of groups) jobs.push([k, g]);
  for (const [i, [k, g]] of jobs.entries()) {
    onProgress(i / jobs.length, `${tc('stem', STEM_NAMES[k] || k)} · ${rangeText(g.secs)}`);
    try {
      if (!audio.get(k)) throw new Error('분리한 트랙을 읽지 못했어요');
      // a sung lead is not an instrument: it goes to the vocal synth (lyrics, a voice), not to a
      // matching instrument
      if (k === 'vocals') { g.match = { cands: [], vocal: true }; continue; }
      g.match = await matchGroup(S, r, k, g, plan.bars, audio.get(k), { plausible: plausibleFor(S, k, g), target, also: k === 'drums' ? [] : also, normalize, synthSearch, reverb });
    } catch (err) { g.match = { cands: [], error: String(err.message || err) }; }
  }
  onProgress(1, '');
  return plan;
}
