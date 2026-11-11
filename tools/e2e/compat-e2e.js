// Project compatibility E2E: every project in the fixture list (MeloFi Studio files saved by older
// versions, tools/e2e/fixtures) is opened the way the app opens a file (migrate() -> setProject),
// checked for errors and lost data, played briefly in the UI and rendered offline (renderMix):
// not silent, no NaN, no clipping. Then the version-3 upgrade is checked against the old sound:
// the old compressor / filter / limiter / master order rebuilt from Web Audio nodes, and the
// instrument level compensation measured per channel.
// Run it with tools/e2e/compat-run.mjs (it prepares a throw-away userData with the fixtures under
// user/compat/ and their audio in studio-media/, then starts:
//   MELOFI_SHOT=out MELOFI_SCRIPT=tools/e2e/compat-e2e.js MELOFI_USERDATA=<tmp> npx electron .)
// Prints E2E-BEGIN ... E2E-END plus COMPAT-JSON {per-fixture numbers}.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let errs = [];
window.addEventListener('error', (e) => errs.push(e.message + ' @' + (e.filename || '').split('/').pop() + ':' + e.lineno));
window.addEventListener('unhandledrejection', (e) => errs.push('rej ' + String(e.reason?.stack || e.reason).split('\n').slice(0, 2).join(' ')));
const origErr = console.error; console.error = (...a) => { errs.push('console.error ' + a.map(String).join(' ').slice(0, 200)); origErr(...a); };
const A = window.__melofi;
for (let i = 0; i < 150 && !A?.engine?.inst; i++) await sleep(100);
const R = [], J = {};
const imp = (p) => import(new URL(p, location.href).href);
async function check(name, fn) {
  errs = [];
  const t = performance.now();
  try {
    const note = await fn();
    await sleep(60);
    R.push(`${errs.length ? 'FAIL' : 'PASS'} ${name}${note ? ` (${note})` : ''}${errs.length ? ' :: ' + [...new Set(errs)].slice(0, 4).join(' | ') : ''} [${Math.round(performance.now() - t)}ms]`);
  } catch (e) {
    R.push(`FAIL ${name} :: THROW ${String(e?.stack || e).split('\n').slice(0, 3).join(' ')}${errs.length ? ' | ' + errs.slice(0, 3).join(' | ') : ''}`);
  }
}
window.confirm = () => true; window.alert = () => {}; window.prompt = () => null;

const model = await imp('studio/model.js');
const io = await imp('studio/io.js');
const transport = await imp('studio/transport.js');
const dsp = await imp('studio/master-dsp.js');
const { FX_TYPES, fxDefaults } = await imp('studio/fx.js');
const { autoMakeup } = await imp('studio/master-fx.js');
const { LEVEL_TRIMS_V3, legacyGainDb } = await imp('studio/compat.js');
const { SYNTH_PRESETS } = await imp('studio/synth.js');

// index.json: { files: [...], upgrade: true|false } (the runner starts the app once per batch:
// projects with long stems decode hundreds of MB each, more than one renderer holds at once)
const index = await (await fetch('melofi://app/user/compat/index.json')).json();
const list = Array.isArray(index) ? index : index.files;
const runUpgrade = Array.isArray(index) || index.upgrade !== false;
const runFixtures = Array.isArray(index) || index.fixtures !== false;
const load = async (f) => JSON.parse(await (await fetch(`melofi://app/user/compat/${encodeURIComponent(f)}`)).text());
const db = (x) => 20 * Math.log10(Math.max(1e-12, x));
const r1 = (x) => Math.round(x * 10) / 10;

// what a saved project holds, to compare before / after opening
function inventory(p) {
  const notes = {};
  for (const pt of p.patterns || []) for (const [ch, l] of Object.entries(pt.notes || {})) if (l?.length) notes[`${pt.id}/${ch}`] = l.length;
  const fxCount = (s) => (s?.fx || []).length;
  return {
    channels: (p.channels || []).map((c) => `${c.id}:${c.kind || 'inst'}:${c.inst}:${fxCount(c)}:${(c.sends || []).length}`),
    patterns: (p.patterns || []).map((x) => `${x.id}:${x.bars}`),
    notes,
    clips: (p.playlist?.clips || []).map((k) => `${k.id}:${k.kind || 'pattern'}:${k.start}:${k.len}`),
    autos: (p.autos || []).map((a) => `${a.id}:${a.target}:${(a.points || []).length}`),
    buses: (p.buses || []).map((b) => `${b.id}:${fxCount(b)}`),
    master: fxCount(p.master),
    media: Object.keys(p.media || {}).sort(),
    sigs: (p.sigs || []).length, tempos: (p.tempos || []).length, markers: (p.markers || []).length,
  };
}
function sameInventory(a, b) {
  const bad = [];
  for (const k of Object.keys(a)) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) bad.push(k);
  return bad;
}
// anything that should sound in what is rendered: the transport's own events (muted channels and
// tracks, notes past a pattern's end and the render range are already left out there)
function hasContent(p, opts) {
  let src = { ...p, mode: p.playlist.clips.length ? 'song' : 'pattern' };
  if (opts.range) src = { ...src, loop: opts.range, loopOn: true };
  const vst = new Set(p.channels.filter((c) => c.kind === 'vst').map((c) => c.id));
  return transport.eventsFor(src).events.some((e) => (e.type === 'n' || e.type === 'a') && !vst.has(e.ch));
}
function stats(mix) {
  let nan = 0, peak = 0;
  for (const ch of [mix.left, mix.right]) for (let i = 0; i < ch.length; i++) { const v = ch[i]; if (!Number.isFinite(v)) nan++; else if (Math.abs(v) > peak) peak = Math.abs(v); }
  const m = nan ? { I: -70, tp: 0 } : dsp.measure(mix.left, mix.right, mix.rate);
  return { nan, peak, peakDb: r1(db(peak)), lufs: r1(m.I), tp: r1(m.tp), sec: r1(mix.left.length / mix.rate) };
}
// render at most the first 12 bars of a song (long stems conversions would take minutes)
const renderOpts = (p) => (p.playlist.clips.length && model.songBars(p) > 12 ? { range: { start: 0, end: 12 }, tail: 1 } : { tail: 1 });

A.settings.set({ studioTourSeen: true });
const S = A.studio;
await check('studio: open', async () => { await S.open(); await sleep(500); if (!S.isOpen) throw new Error('not open'); });

const instIds = new Set();
for (const f of runFixtures ? list : []) {
  const name = f.replace(/\.mfproj$/, '');
  const J1 = (J[name] = {});
  await check(`${name}: opens like a saved file, nothing lost`, async () => {
    const raw = await load(f);
    const before = inventory(raw);
    J1.version = raw.version;
    S.setProject(raw); await sleep(150);
    const p = S.proj;
    const lost = sameInventory(before, inventory(p));
    if (lost.length) throw new Error(`changed: ${lost.join(', ')}`);
    if (p.version !== model.VERSION) throw new Error(`version ${p.version}`);
    if (!p.patterns.some((x) => x.id === p.current)) throw new Error('current pattern missing');
    // names saved in the project must still mean something
    const presets = p.channels.filter((c) => c.kind === 'synth' && c.synthPreset);
    const lostPresets = presets.filter((c) => !SYNTH_PRESETS[c.synthPreset]).map((c) => c.synthPreset);
    if (lostPresets.length) throw new Error(`unknown synth presets: ${lostPresets.join(', ')}`);
    const fxBad = [...p.channels, ...p.buses, p.master].flatMap((s) => s.fx).filter((x) => !FX_TYPES[x.type]).map((x) => x.type);
    if (fxBad.length) throw new Error(`unknown effects: ${fxBad.join(', ')}`);
    const insts = p.channels.filter((c) => (c.kind || 'inst') === 'inst').map((c) => c.inst);
    for (const id of insts) if (!instIds.has(id)) { const r = await fetch(`melofi://app/instruments/${id}/manifest.json`); if (!r.ok) throw new Error(`instrument ${id} missing`); instIds.add(id); }
    J1.legacyGain = p.channels.filter((c) => legacyGainDb(c)).length;
    return `v${raw.version}→v${p.version}, ${p.channels.length} ch, ${p.patterns.length} pat, ${p.playlist.clips.length} clips, ${p.autos.length} autos, ${presets.length} presets`;
  });
  await check(`${name}: UI tabs + play`, async () => {
    for (const t of ['roll', 'playlist', 'mixer', 'live']) { S.setTab(t); await sleep(50); }
    S.setTab('playlist');
    S.transport.play(); await sleep(400); S.transport.stop();
    // a round trip through save keeps it intact
    const txt = JSON.stringify(S.proj); const again = model.migrate(JSON.parse(txt));
    if (JSON.stringify(again) !== txt) throw new Error('save -> open changes the project');
  });
  await check(`${name}: offline render`, async () => {
    const p = S.proj;
    const o = renderOpts(p);
    const mix = await io.renderMix(p, o);
    const s = stats(mix);
    Object.assign(J1, s);
    const want = hasContent(p, o);
    if (s.nan) throw new Error(`${s.nan} NaN samples`);
    // (a quiet intro is fine; a broken chain renders exact zeros)
    if (want && s.peak < 1e-4) throw new Error(`silent (peak ${s.peakDb} dBFS)`);
    if (s.peak > 1) throw new Error(`clipping: peak ${s.peakDb} dBFS`);
    // a channel that cannot render (VST missing) may stay silent, but only a VST one
    J1.silentChannels = mix.warnings.map((w) => w.name);
    const bad = mix.warnings.filter((w) => p.channels.find((c) => c.id === w.ch)?.kind !== 'vst');
    if (bad.length) throw new Error(`channels failed to render: ${bad.map((w) => `${w.name}: ${w.message}`).join('; ')}`);
    return `${s.sec} s, ${s.lufs} LUFS, peak ${s.peakDb} dBFS, TP ${s.tp} dBTP${want ? '' : ', nothing to play (silence expected)'}${mix.warnings.length ? `, silent: ${J1.silentChannels.join(', ')}` : ''}`;
  });
}

// ---------- the version-3 upgrade against the old sound ----------
if (runUpgrade) {
// a test signal: decaying notes plus noise bursts, 3 s
async function offline(build, sec = 3) {
  const SR = 48000, c = new OfflineAudioContext(2, SR * sec, SR);
  await c.audioWorklet.addModule('melofi://app/renderer/js/master-worklet.js');
  const src = c.createBufferSource(), b = c.createBuffer(2, SR * sec, SR);
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < d.length; i++) { const t = i / SR, ph = t % 0.5; d[i] = 0.5 * Math.sin(2 * Math.PI * (110 * (1 + Math.floor(t * 2) % 3)) * t) * Math.exp(-ph * 4) + 0.15 * rnd() * Math.exp(-ph * 20); } }
  src.buffer = b;
  const out = build(c);
  src.connect(out.input); out.output.connect(c.destination); src.start();
  const r = await c.startRendering();
  return { left: r.getChannelData(0), right: r.getChannelData(1), rate: SR };
}
const rms = (m) => { let s = 0; for (let i = 0; i < m.left.length; i++) s += m.left[i] * m.left[i]; return db(Math.sqrt(s / m.left.length)); };
const newFx = (type, params) => (c) => { const u = FX_TYPES[type].build(c, { bpm: 120 }); u.set({ ...fxDefaults(type), ...params }, 0); return u; };
const up = (fx) => model.migrate({ version: 2, channels: [{ id: 'c1', inst: 'splendid', fx: [{ id: 'f1', type: fx.type, on: true, params: { ...fx.params } }] }], patterns: [] }).channels[0].fx[0].params;

await check('upgrade: compressor keeps its old level (hidden make-up given back)', async () => {
  const out = [];
  for (const prm of [{ threshold: -18, ratio: 4, knee: 6, makeup: 4 }, { threshold: -30, ratio: 6, knee: 6, makeup: 0 }, { threshold: -24, ratio: 3, knee: 10, makeup: 2 }, { threshold: -10, ratio: 2, knee: 0, makeup: 1 }]) {
    // the old unit: the browser's compressor, then the make-up knob
    const old = await offline((c) => { const k = c.createDynamicsCompressor(), g = c.createGain(); for (const key of ['threshold', 'ratio', 'knee']) k[key].value = prm[key]; k.attack.value = 0.01; k.release.value = 0.15; g.gain.value = 10 ** (prm.makeup / 20); k.connect(g); return { input: k, output: g }; });
    const now = await offline(newFx('comp', { ...up({ type: 'comp', params: prm }), attack: 0.01, release: 0.15 }));
    const raw = await offline(newFx('comp', { ...prm, attack: 0.01, release: 0.15 }));
    const d = rms(now) - rms(old);
    out.push(`t${prm.threshold}/r${prm.ratio}: +${r1(autoMakeup(prm.threshold, prm.ratio, prm.knee))} dB, upgraded ${d >= 0 ? '+' : ''}${r1(d)} dB vs old (un-upgraded ${r1(rms(raw) - rms(old))} dB)`);
    if (Math.abs(d) > 0.5) throw new Error(out.join('; '));
  }
  J.upgradeComp = out;
  return out.join('; ');
});

await check('upgrade: filter resonance keeps its old meaning', async () => {
  const out = [];
  for (const prm of [{ type: 0, freq: 800, res: 6 }, { type: 1, freq: 600, res: 9 }, { type: 0, freq: 1500, res: 0.7 }, { type: 2, freq: 3000, res: 4 }]) {
    const old = await offline((c) => { const f = c.createBiquadFilter(); f.type = ['lowpass', 'highpass', 'bandpass'][prm.type]; f.frequency.value = prm.freq; f.Q.value = prm.res; return { input: f, output: f }; });
    const u = up({ type: 'filter', params: prm });
    const now = await offline(newFx('filter', u));
    let diff = 0; for (let i = 9600; i < old.left.length; i++) // (after the parameter glides settle: 0.2 s)
      diff = Math.max(diff, Math.abs(old.left[i] - now.left[i]));
    out.push(`${['LP', 'HP', 'BP'][prm.type]} res ${prm.res} -> ${u.res}: max diff ${diff.toExponential(1)}`);
    if (diff > 0.05) throw new Error(out.join('; '));
  }
  J.upgradeFilter = out;
  return out.join('; ');
});

await check('upgrade: instrument level compensation (per channel)', async () => {
  const name = list.find((f) => /instrument-levels/.test(f));
  if (!name) return 'fixture not in the list';
  const raw = await load(name);
  // master fader down so the engine's safety limiter (after the master) stays out of the measurement;
  // reverb sends off: the reverb's impulse response is new noise on every render, so the two renders
  // would differ by up to ±0.4 dB for a reason that has nothing to do with the level compensation
  const quiet = (x) => ({ ...x, master: { ...x.master, vol: 0.3 }, channels: x.channels.map((c) => ({ ...c, send: 0 })) });
  const p = quiet(model.migrate(raw)), bare = quiet(model.migrate({ ...raw, version: model.VERSION }));
  const out = [];
  for (const c of p.channels) {
    const t = LEVEL_TRIMS_V3[c.inst];
    if (!t) continue;
    // energy ratio of the two stems (the chain is linear here; a gated loudness reading is not)
    const energy = (m) => { let s = 0; for (const ch of [m.left, m.right]) for (let i = 0; i < ch.length; i++) s += ch[i] * ch[i]; return s; };
    const a = energy(await io.renderMix(p, { only: c.id, tail: 0.5 })), b = energy(await io.renderMix(bare, { only: c.id, tail: 0.5 }));
    const d = 10 * Math.log10(a / b);
    out.push(`${c.inst} ${t > 0 ? '+' : ''}${t}: ${d >= 0 ? '+' : ''}${r1(d)} dB`);
    if (Math.abs(d + t) > 0.3) throw new Error(`${c.inst}: compensation ${r1(d)} dB, wanted ${-t}; ${out.join(', ')}`);
  }
  J.upgradeLevels = out;
  return out.join(', ');
});

await check('report: limiter, old (compressor 20:1, threshold ceiling-1) vs now (true-peak)', async () => {
  const out = [];
  for (const prm of [{ gain: 3, ceiling: -0.3 }, { gain: 6, ceiling: -3 }]) {
    const old = await offline((c) => { const pre = c.createGain(), k = c.createDynamicsCompressor(), post = c.createGain(); k.knee.value = 0; k.ratio.value = 20; k.attack.value = 0.002; k.release.value = 0.08; k.threshold.value = prm.ceiling - 1; pre.gain.value = 10 ** (prm.gain / 20); pre.connect(k).connect(post); return { input: pre, output: post }; });
    const now = await offline(newFx('limiter', prm));
    const so = stats(old), sn = stats(now);
    out.push(`gain ${prm.gain} ceiling ${prm.ceiling}: old ${so.lufs} LUFS / TP ${so.tp}, now ${sn.lufs} LUFS / TP ${sn.tp}`);
  }
  J.limiter = out;
  return out.join('; ');
});

await check('report: master fader before the inserts (old order rebuilt)', async () => {
  const out = [];
  J.masterOrder = {};
  for (const f of list) {
    const p = model.migrate(await load(f));
    if (!p.master.fx.length || p.master.vol === 1) continue;
    const o = renderOpts(p);
    const now = stats(await io.renderMix(p, o));
    // old order: inserts, then the fader = render at fader 1, scale afterwards
    const v = p.master.vol, g = v * v;
    const m = await io.renderMix({ ...p, master: { ...p.master, vol: 1 } }, o);
    for (const ch of [m.left, m.right]) for (let i = 0; i < ch.length; i++) ch[i] *= g;
    const old = stats(m);
    J.masterOrder[f] = { vol: v, chain: p.master.fx.map((x) => x.type).join('+'), old, now };
    out.push(`${f.replace(/\.mfproj$/, '')} (fader ${v}, ${J.masterOrder[f].chain}): old ${old.lufs} LUFS / peak ${old.peakDb}, now ${now.lufs} LUFS / peak ${now.peakDb}`);
  }
  return out.join('; ');
});

}

await check('studio: close', async () => { S.setProject(model.newProject()); S.close(); await sleep(200); });

console.log('COMPAT-JSON ' + JSON.stringify(J));
console.log('E2E-BEGIN\n' + R.join('\n') + '\nE2E-END');
return [100];
