// Builds the project-compatibility fixtures (tools/e2e/fixtures/*.mfproj) from MeloFi's own history:
// each era's renderer/studio code is taken out of git (`git archive <commit> renderer`) and its
// templates / newProject() run in node, so a fixture is exactly what that version saved.
// A few are then edited the way that era's UI would have (sends, synth presets, effects,
// automation, sample / slicer / audio / vocal / VST channels, a stems conversion).
//   node tools/e2e/make-compat-fixtures.mjs [tmpdir]
// Media used by the fixtures is generated here too (tools/e2e/fixtures/media/<hash>.wav, named like
// the app's content-addressed store: sha1 of the bytes, 20 hex digits).
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'tools/e2e/fixtures');
const MEDIA = path.join(OUT, 'media');
const TMP = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'melofi-compat-eras'));
fs.mkdirSync(MEDIA, { recursive: true });

// ---------- era code ----------
const loaded = new Map();
async function era(commit) {
  if (loaded.has(commit)) return loaded.get(commit);
  const dir = path.join(TMP, commit.replace(/\W/g, '_'));
  if (!fs.existsSync(path.join(dir, 'renderer'))) {
    fs.mkdirSync(dir, { recursive: true });
    execSync(`git archive ${commit} renderer | tar --force-local -x -C "${dir.split(path.sep).join('/')}"`, { cwd: ROOT, shell: 'bash' });
    fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  }
  const imp = async (p) => (fs.existsSync(path.join(dir, p)) ? import(pathToFileURL(path.join(dir, p)).href) : {});
  const m = { model: await imp('renderer/studio/model.js'), tpl: await imp('renderer/studio/templates.js'), fx: await imp('renderer/studio/fx.js'), synth: await imp('renderer/studio/synth.js') };
  loaded.set(commit, m);
  return m;
}
const sha = (c) => execSync(`git rev-parse --short ${c}`, { cwd: ROOT }).toString().trim();

// ---------- media ----------
function wav(samples, rate = 48000) {
  const b = Buffer.alloc(44 + samples.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + samples.length * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((s, i) => b.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(s * 32767))), 44 + i * 2));
  return b;
}
function putMedia(name, samples, rate = 48000) {
  const buf = wav(samples, rate);
  const hash = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 20);
  fs.writeFileSync(path.join(MEDIA, `${hash}.wav`), buf);
  return { hash, meta: { name, rate, ch: 1, dur: +(samples.length / rate).toFixed(4), bpm: null } };
}
// deterministic noise
let seed = 1; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
// one bar at 120 BPM: kick on the beats, hats between, a snare on 2 and 4
const loopSamples = (() => {
  const sr = 48000, n = sr * 2, out = new Float32Array(n);
  for (let b = 0; b < 4; b++) {
    const k = b * sr * 0.5;
    for (let i = 0; i < sr * 0.25; i++) { const t = i / sr; out[k + i] += 0.7 * Math.sin(2 * Math.PI * (50 + 90 * Math.exp(-t * 30)) * t) * Math.exp(-t * 9); }
    if (b % 2) for (let i = 0; i < sr * 0.15; i++) out[k + i] += 0.35 * rnd() * Math.exp(-(i / sr) * 25);
    const h = k + sr * 0.25;
    for (let i = 0; i < sr * 0.05; i++) out[h + i] += 0.2 * rnd() * Math.exp(-(i / sr) * 80);
  }
  return out;
})();
const toneSamples = Float32Array.from({ length: 48000 }, (_, i) => { const t = i / 48000; let s = 0; for (let k = 1; k < 8; k++) s += Math.sin(2 * Math.PI * 220 * k * t) / k; return 0.35 * s * Math.min(1, t * 200) * Math.exp(-t * 2.5); });
const LOOP = putMedia('drum loop 120.wav', loopSamples);
LOOP.meta.bpm = 120;
const TONE = putMedia('saw tone A3.wav', toneSamples);
// a "stem": 8 s of a bass line
const STEM = putMedia('베이스.wav', Float32Array.from({ length: 24000 * 8 }, (_, i) => { const t = i / 24000, n = [45, 45, 48, 43][Math.floor(t / 2) % 4], f = 440 * 2 ** ((n - 69) / 12), ph = (t % 0.5); return 0.5 * Math.sin(2 * Math.PI * f * t) * Math.exp(-ph * 3); }), 24000);

// ---------- helpers ----------
const notes = (list) => list.map(([t, d, n, v = 100]) => ({ t, d, n, v }));
function save(name, proj, about) {
  proj.name = proj.name || name;
  fs.writeFileSync(path.join(OUT, `${name}.mfproj`), JSON.stringify({ ...proj, _fixture: about }, null, 1));
  console.log(`${name}: ${proj.channels.length} ch, ${proj.patterns.length} pat, ${proj.playlist.clips.length} clips — ${about}`);
}
// the basic template comes empty: a two-bar groove on its drum channels and chords on the last one
function fill(p) {
  const pat = p.patterns[0]; pat.bars = Math.max(2, pat.bars);
  const ch = p.channels;
  for (const c of ch.slice(0, -1)) pat.notes[c.id] = notes(Array.from({ length: 8 }, (_, i) => [i * 96 + (c.stepNote === 42 ? 48 : 0), 24, c.stepNote]).filter((_, i) => c.stepNote === 36 ? i % 2 === 0 : c.stepNote === 42 ? true : i % 2 === 1));
  const last = ch[ch.length - 1];
  pat.notes[last.id] = notes([[0, 180, 60], [0, 180, 64], [0, 180, 67], [192, 180, 57], [192, 180, 60], [192, 180, 64], [384, 180, 65], [384, 180, 69], [576, 180, 67], [576, 180, 71]]);
  if (!p.playlist.clips.some((k) => !k.kind)) p.playlist.clips.push({ id: `k${pat.id}`, pattern: pat.id, track: 0, start: 0, len: pat.bars });
  return p;
}
const fxOf = (E, type, params = {}) => ({ id: E.model.uid('f'), type, on: true, params: { ...(E.fx.fxDefaults ? E.fx.fxDefaults(type) : {}), ...params } });

// ---------- fixtures ----------
const ERAS = {
  v1: 'ad191f6',            // first studio: version 1, playlist tracks as a number, no effects
  composer2: 'cadae31',     // version 2: inserts, buses, automation, audio clips, sample / slicer, synth
  sends: 'b0843c3',         // post-fader sends; vocal and VST channels exist
  sigs: '3ba8e6e',          // time signature markers
  presets28: '88257ae',     // MeloFi Synth: 28 named presets
  preMasterPre: 'bddf88d^', // last version with the master fader after the master inserts
  preSoundFix: '7ba56ef^',  // last version with hidden compressor make-up, Q-in-dB filter, old limiter
  preLevels: 'bb98162^',    // last version before the measured instrument / preset loudness trims
};

{ // version 1
  const E = await era(ERAS.v1), M = E.model;
  const p = M.newProject();
  const pat = p.patterns[0]; pat.bars = 2;
  const [kick, clap, hat, snare, piano] = p.channels;
  pat.notes[kick.id] = notes([[0, 24, 36], [96, 24, 36], [192, 24, 36], [288, 24, 36], [384, 24, 36], [480, 24, 36], [576, 24, 36], [672, 24, 36]]);
  pat.notes[hat.id] = notes(Array.from({ length: 16 }, (_, i) => [i * 48 + 24, 12, 42, 80]));
  pat.notes[snare.id] = notes([[96, 24, 38], [288, 24, 38], [480, 24, 38], [672, 24, 38]]);
  pat.notes[clap.id] = notes([[288, 24, 39], [672, 24, 39]]);
  pat.notes[piano.id] = notes([[0, 180, 60], [0, 180, 64], [0, 180, 67], [192, 180, 57], [192, 180, 60], [192, 180, 64], [384, 180, 65], [384, 180, 69], [384, 180, 72], [576, 180, 67], [576, 180, 71], [576, 180, 74]]);
  p.playlist.clips = [{ id: M.uid('k'), pattern: pat.id, track: 0, start: 0, len: 2 }, { id: M.uid('k'), pattern: pat.id, track: 1, start: 2, len: 2 }];
  p.name = 'v1 first studio';
  save('v1-first-studio', p, `${sha(ERAS.v1)}: version 1 (playlist.tracks is a number, no fx / buses / automation)`);
}

for (const k of ['kpop', 'lofi']) {
  const E = await era(ERAS.composer2);
  const p = E.tpl.TEMPLATES[k].make();
  save(`v2-composer2-${k}`, p, `${sha(ERAS.composer2)} template ${k}: before sends, time signature markers, synth presets and the master fader change`);
}

{ // automation clips (composer 2 era): channel volume, pan, master volume, an effect parameter
  const E = await era(ERAS.composer2), M = E.model;
  const p = fill(E.tpl.TEMPLATES.basic.make());
  const lead = p.channels[p.channels.length - 1];
  const filt = fxOf(E, 'filter', { type: 0, freq: 800, res: 6 });
  lead.fx.push(filt);
  const a1 = { id: M.uid('a'), name: 'Lead vol', color: '#5fd8d0', target: `ch:${lead.id}:vol`, len: 2, points: [{ t: 0, v: 0.4 }, { t: 0.5, v: 0.9 }, { t: 1, v: 0.6 }] };
  const a2 = { id: M.uid('a'), name: 'Filter res', color: '#c8a2ff', target: `fx:${lead.id}:${filt.id}:res`, len: 2, points: [{ t: 0, v: 0.1 }, { t: 1, v: 0.6 }] };
  const a3 = { id: M.uid('a'), name: 'Master', color: '#e8a15d', target: 'master:vol', len: 2, points: [{ t: 0, v: 0.85 }, { t: 1, v: 0.7 }] };
  const a4 = { id: M.uid('a'), name: 'Pan', color: '#9fd67a', target: `ch:${p.channels[0].id}:pan`, len: 2, points: [{ t: 0, v: 0.2 }, { t: 1, v: 0.8 }] };
  p.autos = [a1, a2, a3, a4];
  const t0 = p.playlist.tracks.length - 4;
  p.autos.forEach((a, i) => p.playlist.clips.push({ id: M.uid('k'), kind: 'auto', auto: a.id, track: t0 + i, start: 0, len: 2 }));
  save('v2-automation', p, `${sha(ERAS.composer2)} basic + automation clips on channel vol / pan, master vol and a filter's resonance`);
}

{ // sample + slicer + audio clips (composer 2 era)
  const E = await era(ERAS.composer2), M = E.model;
  const p = M.newProject();
  p.media = { [LOOP.hash]: LOOP.meta, [TONE.hash]: TONE.meta };
  const pat = p.patterns[0]; pat.bars = 2;
  const smp = M.newChannel('splendid', 'Saw sample', 5, { kind: 'sample', sample: { media: TONE.hash, root: 57, tune: 0, start: 0, end: null, attack: 0, release: 0.12, reverse: false, loop: false } });
  const slc = M.newChannel('splendid', 'Loop slicer', 6, { kind: 'slicer', sample: { media: LOOP.hash, root: 60 }, slices: [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75] });
  const aud = M.newChannel('splendid', 'Loop audio', 7, { kind: 'audio' });
  p.channels.push(smp, slc, aud);
  pat.notes[smp.id] = notes([[0, 90, 57], [96, 90, 60], [192, 90, 64], [288, 90, 62], [384, 180, 57]]);
  pat.notes[slc.id] = notes(Array.from({ length: 16 }, (_, i) => [i * 48, 48, 60 + (i % 8)]));
  p.playlist.clips = [
    { id: M.uid('k'), pattern: pat.id, track: 0, start: 0, len: 2 },
    { id: M.uid('k'), kind: 'audio', media: LOOP.hash, ch: aud.id, track: 1, start: 0, len: 1, offset: 0, gain: 0.8, sync: true },
    { id: M.uid('k'), kind: 'audio', media: LOOP.hash, ch: aud.id, track: 1, start: 1, len: 1, offset: 0, gain: 0.8, sync: false },
  ];
  p.selected = smp.id;
  save('v2-sample-slicer-audio', p, `${sha(ERAS.composer2)} sample, slicer and audio channels with audio clips (media in fixtures/media)`);
}

{ // sends + a bus (post-fader sends era)
  const E = await era(ERAS.sends), M = E.model;
  const p = E.tpl.TEMPLATES.trap.make();
  const bus = M.newBus(p.buses.length, 'Verb bus');
  bus.fx = [fxOf(E, 'reverb', { mix: 1 }), fxOf(E, 'eq', { cut: 200 })];
  p.buses.push(bus);
  p.channels.slice(0, 3).forEach((c, i) => { c.sends = [{ to: bus.id, level: 0.3 + i * 0.1 }]; });
  save('v2-sends-trap', p, `${sha(ERAS.sends)} trap + a bus fed by post-fader sends`);
}

{ // vocal + VST channels (missing plugin), same era
  const E = await era(ERAS.sends), M = E.model, Sy = E.synth;
  const p = fill(E.tpl.TEMPLATES.basic.make());
  const voc = M.newChannel('synth', '보컬', p.channels.length, { kind: 'synth', synth: { ...Sy.synthDefaults(), ...Sy.SYNTH_PRESETS['레트로 리드'] }, synthPreset: '레트로 리드', vocal: { lyrics: 'らららら', voice: 'r9y9/yoko_latest' } });
  const vst = M.newChannel('vst', 'Missing VST', p.channels.length + 1, { kind: 'vst', vst: { plugin: 'vst3:missing-plugin-0001', file: 'C:\\Program Files\\Common Files\\VST3\\NoSuchPlugin.vst3', name: 'NoSuchPlugin', vendor: 'Nobody' } });
  p.channels.push(voc, vst);
  const pat = p.patterns[0];
  pat.notes[voc.id] = notes([[0, 48, 67], [48, 48, 69], [96, 48, 71], [144, 48, 72]]);
  pat.notes[vst.id] = notes([[0, 96, 48], [96, 96, 52]]);
  save('v2-vocal-vst', p, `${sha(ERAS.sends)} basic + a vocal channel (lyrics) and a VST channel whose plugin is not installed`);
}

{ // time signature markers + tempo changes
  const E = await era(ERAS.sigs), M = E.model;
  const p = E.tpl.TEMPLATES.citypop.make();
  p.sigs = [{ tick: M.barTicks(p) * 2, sig: [3, 4] }, { tick: M.barTicks(p) * 2 + 3 * 96 * 2, sig: [4, 4] }];
  p.tempos = [{ bar: 3, bpm: 100 }];
  p.markers = [{ bar: 0, name: 'Intro' }, { bar: 2, name: 'Waltz' }];
  save('v2-sigs-citypop', p, `${sha(ERAS.sigs)} citypop + time signature markers (3/4 for two bars), a tempo change and markers`);
}

{ // the 28 original MeloFi Synth presets, one channel each
  const E = await era(ERAS.presets28), M = E.model, Sy = E.synth;
  const p = M.newProject();
  const names = Object.keys(Sy.SYNTH_PRESETS);
  p.channels = names.map((n, i) => M.newChannel('synth', n, i, { kind: 'synth', synth: { ...Sy.synthDefaults(), ...Sy.SYNTH_PRESETS[n] }, synthPreset: n, stepNote: 60 }));
  const pat = p.patterns[0]; pat.bars = 8; pat.notes = {};
  p.channels.forEach((c, i) => { const low = /베이스|808/.test(c.name) ? 36 : 60; pat.notes[c.id] = notes([[i * 24, 20, low], [i * 24 + 6, 14, low + 7]]); });
  p.selected = p.channels[0].id;
  p.name = '28 presets';
  save('v2-synth-28-presets', p, `${sha(ERAS.presets28)} one synth channel per original preset (${names.length}): names must still resolve`);
}

{ // master chain before the master fader moved in front of the inserts
  const E = await era(ERAS.preMasterPre);
  const p = E.tpl.TEMPLATES.ballad.make();
  const preset = E.fx.FX_PRESETS.find((x) => x[0] === '마스터 기본');
  p.master.fx = preset[2].map(([t, prm]) => fxOf(E, t, prm));
  p.master.vol = 0.7;
  save('v2-master-chain-ballad', p, `${sha(ERAS.preMasterPre)} ballad + the 마스터 기본 chain (EQ, compressor, limiter) on the master, master fader 0.7`);
}

{ // effects saved with their old meanings
  const E = await era(ERAS.preSoundFix), M = E.model;
  const p = fill(E.tpl.TEMPLATES.basic.make());
  const [c0, c1, c2, c3, c4] = p.channels;
  c0.fx = [fxOf(E, 'comp', { threshold: -30, ratio: 6, knee: 6, makeup: 0 }), fxOf(E, 'eq', { cut: 120, low: 3 })];
  c1.fx = [fxOf(E, 'filter', { type: 1, freq: 600, res: 9 })];
  c2.fx = [fxOf(E, 'filter', { type: 2, freq: 3000, res: 4 }), fxOf(E, 'delay', { tone: 3000, mix: 0.3 })];
  c3.fx = [fxOf(E, 'dist', { drive: 0.4, tone: 4000 }), fxOf(E, 'limiter', { gain: 6, ceiling: -3 })];
  const filt = fxOf(E, 'filter', { type: 0, freq: 1500, res: 12 });
  c4.fx = [fxOf(E, 'comp', { threshold: -24, ratio: 3, knee: 10, makeup: 2 }), filt, fxOf(E, 'comp', {})];
  // a filter without a saved resonance (old default 0.7)
  const bare = { id: M.uid('f'), type: 'filter', on: true, params: { type: 0, freq: 4000 } };
  c4.fx.push(bare);
  p.master.fx = [fxOf(E, 'deesser'), fxOf(E, 'mbcomp'), fxOf(E, 'maximizer', { gain: 2, ceiling: -1 })].filter((f) => E.fx.FX_TYPES[f.type]);
  const a = { id: M.uid('a'), name: 'res', color: '#c8a2ff', target: `fx:${c4.id}:${filt.id}:res`, len: 1, points: [{ t: 0, v: 0 }, { t: 0.5, v: 1 }, { t: 1, v: 0.3 }] };
  p.autos = [a];
  p.playlist.clips.push({ id: M.uid('k'), kind: 'auto', auto: a.id, track: p.playlist.tracks.length - 1, start: 0, len: 2 });
  save('v2-old-fx-meanings', p, `${sha(ERAS.preSoundFix)} compressor (hidden make-up), filters (low / high-pass Q in dB, band-pass ratio), limiter, master de-esser / multiband / maximizer, automated resonance`);
}

{ // instruments whose loudness was trimmed afterwards
  const E = await era(ERAS.preLevels), M = E.model;
  const p = M.newProject();
  const pick = [['recorder', 72], ['flute', 74], ['supersaw', 60], ['marimba', 67], ['ebass', 36], ['clarinet', 62], ['harp', 55], ['banjo', 64]];
  p.channels = [p.channels[0], p.channels[4], ...pick.map(([id, n], i) => M.newChannel(id, id, i + 2, { stepNote: n }))];
  const pat = p.patterns[0]; pat.bars = 4; pat.notes = {};
  pat.notes[p.channels[0].id] = notes(Array.from({ length: 16 }, (_, i) => [i * 96, 24, 36]));
  pat.notes[p.channels[1].id] = notes([[0, 384, 48], [0, 384, 55], [384, 384, 53], [768, 384, 52], [1152, 384, 50]]);
  p.channels.slice(2).forEach((c, i) => { pat.notes[c.id] = notes([[i * 192, 180, c.stepNote], [i * 192 + 96, 90, c.stepNote + 2]]); });
  p.playlist.clips = [{ id: M.uid('k'), pattern: pat.id, track: 0, start: 0, len: 4 }];
  p.selected = p.channels[1].id;
  p.name = 'levels';
  save('v2-instrument-levels', p, `${sha(ERAS.preLevels)} piano + drums + eight instruments whose loudness was trimmed later (recorder -17.8 dB ... supersaw +10.2 dB)`);
}

{ // a stems conversion (AI window): audio channels muted, MIDI channels playing
  const E = await era(ERAS.preLevels), M = E.model;
  const p = M.newProject();
  p.name = 'stems song';
  p.bpm = 120;
  p.media = { [STEM.hash]: { ...STEM.meta, name: '베이스.flac' } };
  const a = M.newChannel('splendid', '베이스', 0, { kind: 'audio', mute: true, send: 0 });
  const b = M.newChannel('synbass', '베이스 · Synth Bass', 1, { vol: 0.75 });
  const d = M.newChannel('drums808', '드럼 · Drum Kit 808', 2, { stepNote: 36, vol: 0.85, send: 0.05 });
  p.channels = [a, b, d];
  p.playlist.tracks = [M.newTrack(0), M.newTrack(1), M.newTrack(2)];
  p.playlist.tracks[0].name = '베이스';
  const pats = [0, 1].map((i) => { const pt = M.newPattern(i, 2); pt.name = `구간 ${i + 1}`; return pt; });
  pats.forEach((pt, i) => {
    pt.notes[b.id] = notes([[0, 180, 45], [192, 180, 45], [384, 180, 48], [576, 180, 43]].map(([t, dd, n]) => [t, dd, n + (i ? 2 : 0)]));
    pt.notes[d.id] = notes(Array.from({ length: 8 }, (_, k) => [k * 96, 24, k % 2 ? 38 : 36]));
  });
  p.patterns = pats; p.current = pats[0].id;
  p.playlist.clips = [
    { id: M.uid('k'), kind: 'audio', media: STEM.hash, ch: a.id, track: 0, start: 0, len: 4, offset: 0, gain: 1, sync: false },
    { id: M.uid('k'), pattern: pats[0].id, track: 1, start: 0, len: 2 },
    { id: M.uid('k'), pattern: pats[1].id, track: 1, start: 2, len: 2 },
  ];
  p.mode = 'song';
  p.selected = b.id;
  save('v2-stems-conversion', p, `${sha(ERAS.preLevels)} shaped like the AI window's stems -> MIDI result: a muted audio stem channel next to MIDI channels, one pattern per section`);
}

console.log(`media: ${fs.readdirSync(MEDIA).join(', ')}`);
