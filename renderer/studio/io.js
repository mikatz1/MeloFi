// MeloFi Studio — files: save / open .mfproj, autosave, MIDI export & import, WAV export.
import { PPQ, barTicks, ticksToSec, tickToSec, migrate, newChannel, newPattern, uid } from './model.js';
import { eventsFor, scheduleAll } from './transport.js';
import { StudioEngine } from './engine.js';
import { encodeWav } from '../js/recorder.js';
import { parseMidi } from '../js/score/midi.js';

export async function saveProject(proj, path = null) {
  return window.melofi.studioSave(JSON.stringify(proj), proj.name, path);
}

export async function openProject() {
  const f = await window.melofi.studioOpen();
  if (!f) return null;
  return { path: f.path, project: migrate(JSON.parse(f.text)) };
}

export const autosave = (proj) => window.melofi.studioAutosave(JSON.stringify(proj));
export async function autoload() {
  const t = await window.melofi.studioAutoload();
  try { return t ? migrate(JSON.parse(t)) : null; } catch { return null; }
}

// what to export: the playlist if it has clips, else the current pattern
const exportMode = (proj) => (proj.playlist.clips.length ? 'song' : 'pattern');

// ---------- MIDI (type 1: tempo track + one track per channel; drum kits on channel 10) ----------
function vlq(n) { const out = [n & 0x7f]; while ((n >>= 7)) out.unshift((n & 0x7f) | 0x80); return out; }
function chunk(type, bytes) { const l = bytes.length; return [...type].map((c) => c.charCodeAt(0)).concat([(l >>> 24) & 255, (l >>> 16) & 255, (l >>> 8) & 255, l & 255], bytes); }
const text = (t, s) => { const b = [...new TextEncoder().encode(s)]; return [0xff, t, ...vlq(b.length), ...b]; };

// isKit(instId) -> true for drum kits (they go on MIDI channel 10)
export function projectToMidi(proj, isKit = (id) => id.startsWith('drums')) {
  const { events } = eventsFor(proj, exportMode(proj));
  const us = Math.round(60000000 / proj.bpm);
  const t0 = [0, ...text(0x03, proj.name), 0, 0xff, 0x51, 0x03, (us >> 16) & 255, (us >> 8) & 255, us & 255,
    0, 0xff, 0x58, 0x04, proj.sig[0], Math.log2(proj.sig[1]), 24, 8, 0, 0xff, 0x2f, 0x00];
  const tracks = [chunk('MTrk', t0)];
  let next = 0;
  for (const c of proj.channels) {
    const drum = isKit(c.inst);
    let mc = 9;
    if (!drum) { if (next === 9) next++; mc = next % 16; next++; }
    const evs = [];
    for (const e of events) if (e.type === 'n' && e.ch === c.id) { evs.push({ t: Math.round(e.tick), on: true, n: e.n, v: e.v }); evs.push({ t: Math.round(e.tick + e.d), on: false, n: e.n }); }
    evs.sort((a, b) => a.t - b.t || (a.on ? 1 : -1));
    const tr = [0, ...text(0x03, c.name)];
    let last = 0;
    for (const e of evs) {
      tr.push(...vlq(e.t - last)); last = e.t;
      tr.push(e.on ? 0x90 | mc : 0x80 | mc, e.n & 127, e.on ? Math.max(1, e.v & 127) : 64);
    }
    tr.push(0, 0xff, 0x2f, 0x00);
    tracks.push(chunk('MTrk', tr));
  }
  const header = chunk('MThd', [0, 1, 0, tracks.length, (PPQ >> 8) & 255, PPQ & 255]);
  return new Uint8Array([...header, ...tracks.flat()]);
}

// a MIDI file becomes a new project: one channel per part, one pattern holding everything
export function midiToProject(bytes, name) {
  const song = parseMidi(bytes, name);
  const proj = migrate({ name, bpm: 120, channels: [], patterns: [] });
  const pat = newPattern(0, 1);
  pat.notes = {};
  proj.channels = song.lines.map((l, i) => newChannel(/drum/i.test(l.name || '') ? 'drums808' : 'splendid', l.name || `Part ${i + 1}`, i));
  let end = 0;
  song.lines.forEach((l, i) => {
    const ch = proj.channels[i];
    pat.notes[ch.id] = l.notes.map((n) => {
      const t = Math.round((n.t * 120 * PPQ) / 60), d = Math.max(6, Math.round((n.d * 120 * PPQ) / 60));
      end = Math.max(end, t + d);
      return { t, d, n: n.n, v: n.v };
    });
  });
  pat.bars = Math.max(1, Math.ceil(end / barTicks(proj)));
  proj.patterns = [pat];
  proj.current = pat.id;
  proj.selected = proj.channels[0]?.id;
  proj.playlist.clips = [{ id: uid('k'), pattern: pat.id, track: 0, start: 0, len: pat.bars }];
  return proj;
}

// ---------- WAV: render the arrangement offline through the same engine ----------
// only: render just this channel (a stem); offset: seconds of silence before bar 1
// (0 for DAW stems so every file lines up at the start of the timeline)
export async function renderMix(proj, { only = null, offset = 0.05, tail = 3, onProgress = () => {}, range = null } = {}) {
  const SR = 48000;
  let src = only ? { ...proj, channels: proj.channels.map((c) => ({ ...c, mute: false, solo: c.id === only })) } : proj;
  src = { ...src, mode: exportMode(proj) };
  if (range) src = { ...src, loop: range, loopOn: true };
  const probe = eventsFor(src);
  const seconds = tickToSec(src, probe.base + probe.length, src.mode) - tickToSec(src, probe.base, src.mode);
  const ctx = new OfflineAudioContext(2, Math.ceil((offset + seconds + tail) * SR), SR);
  const eng = await StudioEngine.create(ctx);
  await eng.sync(src, (id, p) => onProgress('load', p));
  await scheduleAll(eng, src, { offset });
  await eng.finalize();
  onProgress('render', 0);
  const buf = await ctx.startRendering();
  onProgress('render', 1);
  return { left: buf.getChannelData(0), right: buf.getChannelData(1), rate: SR };
}

export async function renderWav(proj, onProgress = () => {}) {
  return encodeWav(await renderMix(proj, { onProgress }));
}

// ---------- DAW hand-off ----------
const fileSafe = (s) => String(s || '').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'Track';

// REAPER project: tempo and time signature, one audio track per stem, and the notes of every
// channel as MIDI items on muted tracks (ready for the DAW's own instruments)
export function projectToRpp(proj, stems, isKit = () => false) {
  const { events, length } = eventsFor(proj, exportMode(proj));
  const lenSec = ticksToSec(proj, length);
  const q = (s) => `"${String(s).replace(/"/g, "'")}"`;
  const lines = [`<REAPER_PROJECT 0.1 "6.0" 0`, `  TEMPO ${proj.bpm} ${proj.sig[0]} ${proj.sig[1]}`, `  MASTER_VOLUME ${proj.master?.vol ?? 1} 0 -1 -1 1`];
  for (const st of stems) {
    lines.push('  <TRACK', `    NAME ${q(st.name)}`, `    VOLPAN 1 ${st.pan ?? 0} -1 -1 1`,
      '    <ITEM', '      POSITION 0', `      LENGTH ${(st.seconds ?? lenSec).toFixed(6)}`, `      NAME ${q(st.name)}`,
      '      <SOURCE WAVE', `        FILE ${q(st.file)}`, '      >', '    >', '  >');
  }
  const RES = 960, scale = RES / PPQ;
  let next = 0; // same channel numbering as the MIDI file and the live MIDI out
  proj.channels.forEach((c) => {
    let ch = 9;
    if (!isKit(c.inst)) { if (next === 9) next++; ch = next % 16; next++; }
    const evs = [];
    for (const e of events) if (e.type === 'n' && e.ch === c.id) { evs.push([Math.round(e.tick * scale), 0x90, e.n, Math.max(1, e.v)]); evs.push([Math.round((e.tick + e.d) * scale), 0x80, e.n, 0]); }
    if (!evs.length) return;
    evs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const hx = (n) => n.toString(16).padStart(2, '0');
    lines.push('  <TRACK', `    NAME ${q(`${c.name} (MIDI)`)}`, '    MUTESOLO 1 0 0',
      '    <ITEM', '      POSITION 0', `      LENGTH ${lenSec.toFixed(6)}`, `      NAME ${q(`${c.name} MIDI`)}`,
      '      <SOURCE MIDI', `        HASDATA 1 ${RES} QN`);
    let last = 0;
    for (const [t, st, n, v] of evs) { lines.push(`        E ${t - last} ${hx(st | ch)} ${hx(n)} ${hx(v)}`); last = t; }
    lines.push(`        E ${Math.max(0, Math.round(length * scale) - last)} ${hx(0xb0 | ch)} 7b 00`, '      >', '    >', '  >');
  });
  lines.push('>');
  return lines.join('\n') + '\n';
}

// everything a DAW needs: one WAV per channel, the mix, a MIDI file and a REAPER project
export async function exportForDaw(proj, { isKit, onProgress = () => {} } = {}) {
  const files = [];
  const used = proj.channels.filter((c) => proj.patterns.some((p) => (p.notes[c.id] || []).length) || proj.playlist.clips.some((k) => k.kind === 'audio' && k.ch === c.id));
  const total = used.length + 1;
  const stems = [];
  let k = 0;
  for (const c of used) {
    onProgress(k / total, c.name);
    const mix = await renderMix(proj, { only: c.id, offset: 0, tail: 3 });
    const file = `stems/${String(k + 1).padStart(2, '0')} ${fileSafe(c.name)}.wav`;
    files.push({ name: file, data: encodeWav(mix) });
    stems.push({ name: c.name, file, seconds: mix.left.length / mix.rate });
    k++;
  }
  onProgress(k / total, 'mix');
  const mix = await renderMix(proj, { offset: 0, tail: 3 });
  const base = fileSafe(proj.name);
  files.push({ name: `${base} - mix.wav`, data: encodeWav(mix) });
  files.push({ name: `${base}.mid`, data: projectToMidi(proj, isKit) });
  files.push({ name: `${base}.rpp`, data: projectToRpp(proj, stems, isKit) });
  onProgress(1, '');
  return { files, base };
}
