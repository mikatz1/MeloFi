// MeloFi Synth expert mode (user waveforms / wavetables), headless:
//   MELOFI_SHOT=<dir> MELOFI_SCRIPT=tools/e2e/wavetable-e2e.js MELOFI_USERDATA=<tmp> npx electron .
// Draws in the editor and hears the change, harmonics <-> drawing, wavetable morph, Serum / Vital WAV
// round trips (frame data byte for byte), project save / load (same render), click-free table change
// while a note sounds, aliasing on high notes, the live engine on the worklet path, and screenshots of
// the editor in the dark and white themes (wave-dark.png, wave-white.png ... in MELOFI_SHOT).
// Prints WTE2E {json} and a PASS / FAIL line per check.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let errs = [];
window.addEventListener('error', (e) => errs.push(e.message + ' @' + (e.filename || '').split('/').pop() + ':' + e.lineno));
window.addEventListener('unhandledrejection', (e) => errs.push('rej ' + String(e.reason?.stack || e.reason).split('\n').slice(0, 2).join(' ')));
const A = window.__melofi;
for (let i = 0; i < 150 && !A?.engine?.inst; i++) await sleep(100);
const R = [], NUM = {};
const imp = (p) => import(new URL(p, location.href).href);
async function check(name, fn) {
  errs = [];
  const t0 = performance.now();
  try {
    const note = await fn();
    await sleep(40);
    R.push(`${errs.length ? 'FAIL' : 'PASS'} ${name}${note ? ` (${note})` : ''}${errs.length ? ' :: ' + [...new Set(errs)].slice(0, 4).join(' | ') : ''} [${Math.round(performance.now() - t0)}ms]`);
  } catch (e) {
    R.push(`FAIL ${name} :: THROW ${String(e?.stack || e).split('\n').slice(0, 3).join(' ')}${errs.length ? ' | ' + errs.slice(0, 3).join(' | ') : ''}`);
  }
}
window.confirm = () => true; window.alert = () => {};
const W = await imp('studio/wavetable.js');
const SY = await imp('studio/synth.js');
const io = await imp('studio/io.js');
const model = await imp('studio/model.js');
const { TEMPLATES } = await imp('studio/templates.js');
const SR = 48000;
const db = (x) => 10 * Math.log10(Math.max(1e-30, x));

// render one synth channel's params offline (through the worklet, as an export does)
async function renderNote(params, { note = 60, dur = 0.5, len = 0.7, at = 0.02, during = null } = {}) {
  const c = new OfflineAudioContext(1, Math.ceil(len * SR), SR);
  await SY.loadSynthWorklet(c);
  const ch = new SY.SynthChannel(c, c.destination); ch.setParams(params);
  ch.noteOn(note, 110, at, dur);
  if (during) for (const [time, fn] of during) c.suspend(time).then(() => { fn(ch); c.resume(); });
  return (await c.startRendering()).getChannelData(0);
}
function spec(x, a, n = 8192) {
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < n; i++) { const t = (2 * Math.PI * i) / (n - 1); re[i] = (x[a + i] || 0) * (0.35875 - 0.48829 * Math.cos(t) + 0.14128 * Math.cos(2 * t) - 0.01168 * Math.cos(3 * t)); }
  W.fft(re, im);
  const p = new Float64Array(n / 2); for (let k = 0; k < n / 2; k++) p[k] = Math.hypot(re[k], im[k]);
  return p;
}
// level of harmonic k of f0 (peak around its bin)
const harm = (p, f0, k, n = 8192) => { const b = Math.round((k * f0 * n) / SR); let m = 0; for (let j = b - 3; j <= b + 3; j++) m = Math.max(m, p[j] || 0); return m; };
const base = { ...SY.synthDefaults(), l2: 0, cut: 18000, kt: 0, fenv: 0, res: 0.1, aa: 0.002, as: 1, ar: 0.02, uni: 1, vol: 1, w1: SY.CUSTOM_WAVE };
const tableOf = (frames, interp = 'xfade') => W.encodeTable({ name: 'e2e', interp, frames });

// ---------- the studio, a synth channel, the editor ----------
A.settings.set({ studioTourSeen: true });
const S = A.studio;
let ch;
await check('studio: open, synth channel, expert mode opens', async () => {
  await S.open(); await sleep(400);
  S.setProject(TEMPLATES.empty.make()); await sleep(150);
  S.edit(() => { ch = S.rack.makeKind('synth', 'Wave'); ch.synth = { ...SY.synthDefaults() }; S.proj.selected = ch.id; });
  await S.syncAudio();
  S.channelSheet.show(ch.id, 'sound'); await sleep(200);
  const btn = [...document.querySelectorAll('#chsheet .sy-expert')];
  if (btn.length !== 2) throw new Error(`${btn.length} expert buttons`);
  btn[0].click(); await sleep(250);
  const win = document.getElementById('wavewin');
  if (!win || win.hidden) throw new Error('editor not shown');
  if (Math.round(ch.synth.w1) !== SY.CUSTOM_WAVE || !ch.synth.wt1) throw new Error('osc 1 not on the user waveform');
  return `frames ${S.waveEditor.wt.frames.length}`;
});

const E = S.waveEditor;
const fire = (el, type, x, y, extra = {}) => { const r = el.getBoundingClientRect(); el.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, buttons: 1, pointerId: 7, clientX: r.left + x * r.width, clientY: r.top + y * r.height, ...extra })); };
// a stroke across the wave view: x, y as fractions of the canvas
async function stroke(el, pts) {
  fire(el, 'pointerdown', ...pts[0]);
  for (const p of pts.slice(1)) { fire(el, 'pointermove', ...p); await sleep(5); }
  fire(el, 'pointerup', ...pts[pts.length - 1]);
  await sleep(80);
}

await check('draw: freehand stroke changes the sound', async () => {
  const before = await renderNote({ ...base, wt1: ch.synth.wt1 });
  // a square-ish shape: high for the first half, low for the second
  const pts = []; for (let i = 0; i <= 40; i++) { const x = i / 40; pts.push([x, x < 0.5 ? 0.2 : 0.8]); }
  await stroke(E.wcv, pts);
  const after = await renderNote({ ...base, wt1: ch.synth.wt1 });
  const f0 = 261.63, pb = spec(before, 9600), pa = spec(after, 9600);
  // saw has a strong 2nd harmonic, a square almost none
  const r2b = harm(pb, f0, 2) / harm(pb, f0, 1), r2a = harm(pa, f0, 2) / harm(pa, f0, 1);
  NUM.draw = { h2_before: +r2b.toFixed(3), h2_after: +r2a.toFixed(3) };
  if (!(r2b > 0.3 && r2a < 0.08)) throw new Error(`h2/h1 ${r2b.toFixed(3)} -> ${r2a.toFixed(3)}`);
  // and the live engine plays it through the worklet (no fallback)
  const host = S.engine.channels.get(ch.id);
  const v = host.src.noteOn(60, 90, 0, 0.1);
  const onWorklet = v.wt[0].length > 0;
  if (!onWorklet) throw new Error('live voice not on the wavetable worklet');
  return `h2/h1 ${r2b.toFixed(2)} -> ${r2a.toFixed(3)}, live voice on the worklet`;
});

await check('draw: points and curves, snap, tools', async () => {
  E.mode = 'draw'; E.tool = 'points'; E.grid.snap = true; E.grid.x = 8; E.grid.y = 4; E.pts.clear(); E.render(); await sleep(60);
  // click on an empty spot adds a point (snapped to the grid)
  const n0 = E.pointsFor().length;
  await stroke(E.wcv, [[0.30, 0.22], [0.31, 0.22]]);
  const pts = E.pointsFor();
  if (pts.length !== n0 + 1) throw new Error(`points ${n0} -> ${pts.length}`);
  const added = pts[E.selPt];
  if (Math.abs(added.x * 8 - Math.round(added.x * 8)) > 1e-6) throw new Error(`not snapped x ${added.x}`);
  for (const c of ['linear', 'step', 'smooth']) { [...E.side.querySelectorAll('.wv-seg')][1].querySelector(`button:nth-child(${['smooth', 'linear', 'step'].indexOf(c) + 1})`).click(); await sleep(30); }
  // shaping tools
  // normalize, flip up/down, flip left/right, remove DC (the first four buttons)
  for (const i of [0, 1, 2, 3]) { [...E.side.querySelectorAll('.wv-ops button')][i].click(); await sleep(20); }
  let dc = 0; for (const x of E.frame) dc += x; dc /= W.N;
  if (Math.abs(dc) > 1e-6) throw new Error(`dc ${dc}`);
  E.tool = 'free'; E.grid.snap = false; E.render();
  return `${pts.length} points, dc ${dc.toExponential(1)}`;
});

await check('harmonics <-> drawing round trip', async () => {
  E.mode = 'harm'; E.render(); await sleep(50);
  [...E.side.querySelectorAll('.wv-ops button')][0].click(); await sleep(50); // saw preset
  let s = W.spectrum(E.frame);
  const h3 = s.amp[3] / s.amp[1];
  if (Math.abs(h3 - 1 / 3) > 0.01) throw new Error(`saw h3 ${h3}`);
  // drag harmonic 3 to the floor: the drawing loses it
  const r = E.hcv.getBoundingClientRect(), x = (2.5 / 64);
  await stroke(E.hcv, [[x, 0.672], [x, 0.676]]);
  s = W.spectrum(E.frame);
  const h3b = s.amp[3] / s.amp[1];
  // and the stored table (what the synth plays) is the same frame
  const stored = W.decodeTable(ch.synth.wt1).frames[E.cur];
  let diff = 0; for (let i = 0; i < W.N; i++) diff = Math.max(diff, Math.abs(stored[i] - E.frame[i]));
  // draw a pure sine: the bars show only harmonic 1
  E.frame.set(W.formulaFrame('sin(x)')); E.commit(); E.draw();
  s = E.spec;
  let rest = 0; for (let k = 2; k <= 64; k++) rest = Math.max(rest, s.amp[k]);
  NUM.harm = { h3_saw: +h3.toFixed(4), h3_after_drag: +h3b.toExponential(2), stored_diff: diff, sine_rest: rest };
  if (h3b > 1e-6) throw new Error(`h3 after drag ${h3b}`);
  if (diff > 0) throw new Error(`stored differs ${diff}`);
  if (rest > 1e-6 || Math.abs(s.amp[1] - 1) > 1e-6) throw new Error(`sine bars ${s.amp[1]} rest ${rest}`);
  return `saw h3 ${h3.toFixed(3)} -> ${h3b.toExponential(1)}; sine shows h1 only`;
});

await check('tools: tension, dB bars, all frames, undo/redo, copy/paste/move', async () => {
  const out = {};
  // tension: a straight segment from -1 to 1 bent upward passes high at its middle
  E.mode = 'draw'; E.tool = 'points'; E.grid.snap = false; E.curve = 'linear';
  E.pts.set(E.cur, [{ x: 0, y: -1, c: 'linear' }, { x: 0.5, y: 1, c: 'linear' }]); E.applyPoints(); E.render(); await sleep(40);
  const midBefore = E.frame[512];
  const hd = E.handles()[0], r = E.wcv.getBoundingClientRect();
  const yFrac = (yy) => (r.height / 2 - yy * (r.height / 2 - 8)) / r.height;
  await stroke(E.wcv, [[hd.x, yFrac(hd.y)], [hd.x, yFrac(0.6)], [hd.x, yFrac(0.7)]]);
  const midAfter = E.frame[512];
  out.tension = { mid_before: +midBefore.toFixed(3), mid_after: +midAfter.toFixed(3), b: +E.pointsFor()[0].b.toFixed(3) };
  if (!(Math.abs(midBefore) < 0.02 && Math.abs(midAfter - 0.7) < 0.05)) throw new Error(`tension ${JSON.stringify(out.tension)}`);
  E.wcv.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: r.left + E.handles()[0].x * r.width, clientY: r.top + yFrac(E.handles()[0].y) * r.height }));
  await sleep(40);
  if (Math.abs(E.frame[512]) > 0.02) throw new Error(`double-click did not straighten (${E.frame[512]})`);
  // dB bars: dragging harmonic 2 to the middle of the bar in dB view sets it to -30 dB of the scale
  E.mode = 'harm'; E.tool = 'free'; E.frame.set(W.sineFrame()); E.commit(); E.dbView = true; E.hn = 128; E.render(); await sleep(40);
  const hr = E.hcv.getBoundingClientRect(), split = hr.height * 0.68, yMid = (split - 0.5 * (split - 6)) / hr.height;
  await stroke(E.hcv, [[1.5 / 128, yMid], [1.5 / 128, yMid]]);
  const a2 = W.spectrum(E.frame).amp[2];
  out.db = { h2_db: +(20 * Math.log10(a2)).toFixed(1), bars: E.hn };
  if (Math.abs(20 * Math.log10(a2) + 30) > 1.5) throw new Error(`dB edit ${out.db.h2_db}`);
  E.dbView = false; E.hn = 64;
  // processing every frame: smooth and seam reach all of them
  E.wt.frames = [W.presetFrame('saw'), W.presetFrame('square'), W.formulaFrame('x/pi - 1')]; E.cur = 0; E.commit(); E.render();
  E.allFrames = true;
  const hi = (f) => W.spectrum(f).amp[41];
  const jump = (f) => Math.abs(f[0] - (2 * f[W.N - 1] - f[W.N - 2]));
  E.mode = 'draw'; E.render(); await sleep(20);
  const j0 = jump(E.wt.frames[2]);
  [...E.side.querySelectorAll('.wv-ops button')][4].click(); await sleep(30); // seam
  const j1 = jump(E.wt.frames[2]);
  const before = E.wt.frames.map(hi);
  [...E.side.querySelectorAll('.wv-ops button')][5].click(); await sleep(30); // smooth
  const after = E.wt.frames.map(hi);
  E.allFrames = false;
  out.process = { h40_before: before.map((x) => +x.toExponential(1)), h40_after: after.map((x) => +x.toExponential(1)), seam_jump: [+j0.toFixed(3), +j1.toFixed(4)] };
  if (!after.every((x, i) => x < before[i] * 0.2)) throw new Error(`smooth ${JSON.stringify(out.process)}`);
  if (!(j1 < j0 * 0.05)) throw new Error(`seam ${j0} -> ${j1}`);
  // undo / redo
  const snap = Float32Array.from(E.wt.frames[2]);
  E.undoStep(); const undone = E.wt.frames[2][0] !== snap[0] || E.wt.frames[2][W.N - 1] !== snap[W.N - 1];
  E.redoStep(); const redone = E.wt.frames[2].every((x, i) => x === snap[i]);
  out.undo = { undone, redone };
  if (!undone || !redone) throw new Error(`undo/redo ${undone} ${redone}`);
  // copy, paste after, move
  E.select(0); E.copyFrame(); E.select(2); E.pasteFrame();
  const n = E.wt.frames.length, same = E.wt.frames[3].every((x, i) => x === E.wt.frames[0][i]);
  E.moveFrame(-1);
  const moved = E.cur === 2 && E.wt.frames[2].every((x, i) => x === E.wt.frames[0][i]);
  out.frames = { count: n, pasted: same, moved };
  if (n !== 4 || !same || !moved) throw new Error(JSON.stringify(out.frames));
  NUM.tools = out;
  return JSON.stringify(out);
});

await check('formula: parser, table with f, errors', async () => {
  E.mode = 'formula'; E.render(); await sleep(40);
  if (E.side.querySelector('textarea').value !== E.formula) throw new Error('formula box empty');
  E.formula = 'saw(x)*(1 - f) + square(x)*f'; E.formulaFrames = 16;
  E.applyFormula(true, { textContent: '' });
  if (E.wt.frames.length !== 16) throw new Error(`frames ${E.wt.frames.length}`);
  const bad = ['process.exit()', 'constructor', 'sin(x', 'x)', '__proto__', 'a=1', 'sin(x);alert(1)'];
  const caught = bad.filter((b) => { try { W.compileFormula(b); return false; } catch { return true; } });
  if (caught.length !== bad.length) throw new Error(`accepted: ${bad.filter((b) => !caught.includes(b)).join(', ')}`);
  const err = E.checkFormula.call({ formula: 'sin(y)', formulaError: E.formulaError });
  return `16 frames; ${caught.length} unsafe inputs refused; "${err}"`;
});

await check('wavetable morph: crossfade and spectral, position by envelope and LFO', async () => {
  const saw = W.presetFrame('saw'), sq = W.presetFrame('square'), f0 = 261.63;
  const rx = await renderNote({ ...base, wt1: tableOf([saw, sq], 'xfade'), wp1: 0.5 });
  const rs = await renderNote({ ...base, wt1: tableOf([saw, sq], 'spectral'), wp1: 0.5 });
  const r0 = await renderNote({ ...base, wt1: tableOf([saw, sq], 'xfade'), wp1: 0 });
  const r1 = await renderNote({ ...base, wt1: tableOf([saw, sq], 'xfade'), wp1: 1 });
  const h = (x, k) => { const p = spec(x, 9600); return harm(p, f0, k) / harm(p, f0, 1); };
  const m = { h2_pos0: h(r0, 2), h2_pos1: h(r1, 2), h2_xfade_mid: h(rx, 2), h2_spectral_mid: h(rs, 2) };
  for (const k of Object.keys(m)) m[k] = +m[k].toFixed(3);
  NUM.morph = m;
  // halfway: the 2nd harmonic (saw only) at about half its strength in both modes
  if (!(m.h2_pos0 > 0.4 && m.h2_pos1 < 0.03)) throw new Error(JSON.stringify(m));
  if (!(m.h2_xfade_mid > 0.12 && m.h2_xfade_mid < 0.45 && m.h2_spectral_mid > 0.12 && m.h2_spectral_mid < 0.45)) throw new Error(JSON.stringify(m));
  // position envelope: the 2nd harmonic changes over the note
  // the filter envelope's shape moves the position from 0 (saw) to 1 (square) over half a second
  const env = await renderNote({ ...base, wt1: tableOf([saw, sq]), wp1: 0, wpe: 1, fa: 0.5, fd: 0.2, fs: 1 }, { dur: 0.9, len: 1.1 });
  const early = h(env.subarray(0), 2), late = (() => { const p = spec(env, Math.floor(0.7 * SR)); return harm(p, f0, 2) / harm(p, f0, 1); })();
  const lfo = await renderNote({ ...base, wt1: tableOf([saw, sq]), wp1: 0.5, lt: 4, lr: 3, ld: 1 }, { dur: 0.9, len: 1.1 });
  let moved = false; { let prev = null; for (let t = 0.05; t < 0.8; t += 0.08) { const p = spec(lfo, Math.floor(t * SR), 2048); const v = p[Math.round(2 * f0 * 2048 / SR)] / (p[Math.round(f0 * 2048 / SR)] || 1); if (prev != null && Math.abs(v - prev) > 0.08) moved = true; prev = v; } }
  NUM.morph.env_h2_early = +early.toFixed(3); NUM.morph.env_h2_late = +late.toFixed(3); NUM.morph.lfo_moves = moved;
  if (!(late < early * 0.5)) throw new Error(`envelope ${early} -> ${late}`);
  if (!moved) throw new Error('LFO did not move the position');
  return JSON.stringify(m);
});

await check('click-free: a new table while the note sounds', async () => {
  const saw = W.presetFrame('saw'), sq = W.presetFrame('square');
  const p1 = { ...base, wt1: tableOf([saw]) }, p2 = { ...base, wt1: tableOf([sq]) };
  const x = await renderNote(p1, { dur: 0.8, len: 1, during: [[0.4, (c) => c.setParams(p2)]] });
  // largest sample-to-sample step around the change vs. in steady playing of each table
  const step = (a, b) => { let m = 0; for (let i = a + 1; i < b; i++) m = Math.max(m, Math.abs(x[i] - x[i - 1])); return m; };
  const steady = Math.max(step(Math.floor(0.2 * SR), Math.floor(0.38 * SR)), step(Math.floor(0.5 * SR), Math.floor(0.7 * SR)));
  const around = step(Math.floor(0.395 * SR), Math.floor(0.45 * SR));
  // and the change really happened
  const p = spec(x, Math.floor(0.6 * SR)), h2 = harm(p, 261.63, 2) / harm(p, 261.63, 1);
  NUM.clickFree = { steadyMaxStep: +steady.toFixed(4), changeMaxStep: +around.toFixed(4), h2_after: +h2.toFixed(3) };
  if (around > steady * 1.05) throw new Error(JSON.stringify(NUM.clickFree));
  if (h2 > 0.05) throw new Error(`table did not change (h2 ${h2})`);
  // the table position knob glides too
  const y = await renderNote({ ...base, wt1: tableOf([saw, sq]), wp1: 0 }, { dur: 0.8, len: 1, during: [[0.4, (c) => c.setParams({ ...base, wt1: c.p.wt1, wp1: 1 })]] });
  let m2 = 0, st2 = 0; for (let i = Math.floor(0.395 * SR); i < Math.floor(0.45 * SR); i++) m2 = Math.max(m2, Math.abs(y[i] - y[i - 1])); for (let i = Math.floor(0.2 * SR); i < Math.floor(0.38 * SR); i++) st2 = Math.max(st2, Math.abs(y[i] - y[i - 1]));
  NUM.clickFree.posSteady = +st2.toFixed(4); NUM.clickFree.posChange = +m2.toFixed(4);
  if (m2 > Math.max(st2, steady) * 1.05) throw new Error(`position jump ${m2} vs ${st2}`);
  return JSON.stringify(NUM.clickFree);
});

await check('aliasing on high notes (below 18 kHz)', async () => {
  const saw = W.presetFrame('saw'), p = { ...base, wt1: tableOf([saw]), ar: 0.01 };
  const notes = [96, 100, 103, 106, 108, 110, 112, 115, 118, 121, 124];
  let worst = -999; const per = {};
  for (const m of notes) {
    const x = await renderNote(p, { note: m, dur: 0.3, len: 0.35 });
    const f0 = 440 * 2 ** ((m - 69) / 12), n = 8192, P = spec(x, Math.floor(0.05 * SR), n), bin = SR / n;
    let hE = 0, aE = 0;
    for (let k = 1; k < n / 2; k++) { const f = k * bin; if (f < 40 || f > 18000) continue; const hh = f / f0; const near = Math.round(hh) >= 1 && Math.abs(hh - Math.round(hh)) * f0 < 4 * bin; if (near) hE += P[k] ** 2; else aE += P[k] ** 2; }
    per[m] = +db(aE / hE).toFixed(1); worst = Math.max(worst, per[m]);
  }
  NUM.alias = { worstDb: worst, perNote: per, threshold: -60 };
  if (worst > -60) throw new Error(`worst ${worst} dB`);
  return `worst ${worst} dB (threshold -60)`;
});

await check('live and offline: same tables, same worklet', async () => {
  // the live engine and the export's offline engine both load the worklet; a note rendered twice
  // offline at different block offsets is the same sound (deterministic, no per-context randomness)
  const p = { ...base, wt1: tableOf([W.presetFrame('saw'), W.presetFrame('square')], 'spectral'), wp1: 0.3, uni: 3, det: 20 };
  // (start times exact in binary: 0.0625 s = 3000 samples, 0.125 s = 6000)
  const a = await renderNote(p, { at: 0.0625, len: 0.8 }), b = await renderNote(p, { at: 0.125, len: 0.8 + 0.0625 });
  let d = 0; for (let i = 0; i < a.length - 200; i++) d = Math.max(d, Math.abs(a[i] - b[i + 3000]));
  const live = S.engine.ctx;
  const ok = live && S.engine.channels.get(ch.id).src.noteOn(72, 80, 0, 0.05).wt[0].length > 0;
  NUM.liveOffline = { maxDiff: d, liveOnWorklet: ok };
  // (what differs is float rounding of the envelope times, below -80 dB)
  if (d > 1e-4 || !ok) throw new Error(JSON.stringify(NUM.liveOffline));
  return `max diff ${d.toExponential(1)}`;
});

// ---------- WAV ----------
function vitalWav(frames) { // the way Vital exports: 16-bit PCM, 44.1 kHz, clm "<!>2048 20000000 wavetable (vital.audio)"
  const clm = '<!>2048 20000000 wavetable (vital.audio)', n = frames.length * 2048;
  const size = 12 + 24 + 8 + clm.length + 8 + n * 2, b = new ArrayBuffer(size), v = new DataView(b); let o = 0;
  const s = (x) => { for (const c of x) v.setUint8(o++, c.charCodeAt(0)); }, u32 = (x) => { v.setUint32(o, x, true); o += 4; }, u16 = (x) => { v.setUint16(o, x, true); o += 2; };
  s('RIFF'); u32(size - 8); s('WAVE'); s('fmt '); u32(16); u16(1); u16(1); u32(44100); u32(88200); u16(2); u16(16);
  s('clm '); u32(clm.length); s(clm); s('data'); u32(n * 2);
  for (const f of frames) for (let i = 0; i < 2048; i++) { v.setInt16(o, Math.max(-32768, Math.min(32767, Math.round(f[i] * 32767))), true); o += 2; }
  return new Uint8Array(b);
}
function plainWav(samples, bits = 16, rate = 44100, clm = '') {
  const bps = bits / 8, cl = clm ? 8 + clm.length + (clm.length & 1) : 0, size = 44 + cl + samples.length * bps, b = new ArrayBuffer(size), v = new DataView(b); let o = 0;
  const s = (x) => { for (const c of x) v.setUint8(o++, c.charCodeAt(0)); }, u32 = (x) => { v.setUint32(o, x, true); o += 4; }, u16 = (x) => { v.setUint16(o, x, true); o += 2; };
  s('RIFF'); u32(size - 8); s('WAVE'); s('fmt '); u32(16); u16(bits === 32 ? 3 : 1); u16(1); u32(rate); u32(rate * bps); u16(bps); u16(bits);
  if (clm) { s('clm '); u32(clm.length); s(clm); if (clm.length & 1) o++; }
  s('data'); u32(samples.length * bps);
  for (const x of samples) { if (bits === 32) v.setFloat32(o, x, true); else if (bits === 24) { const q = Math.round(x * 8388607); v.setUint8(o, q & 255); v.setUint8(o + 1, (q >> 8) & 255); v.setUint8(o + 2, (q >> 16) & 255); } else v.setInt16(o, Math.round(x * 32767), true); o += bps; }
  return new Uint8Array(b);
}
const dataBytes = (u8) => { const p = W.parseWav(u8); const v = new DataView(u8.buffer, u8.byteOffset); let o = 12; while (o < u8.length) { const id = String.fromCharCode(...u8.subarray(o, o + 4)), len = v.getUint32(o + 4, true); if (id === 'data') return u8.subarray(o + 8, o + 8 + len); o += 8 + len + (len & 1); } return p && null; };

await check('WAV: MeloFi -> Serum format -> MeloFi, frame data byte for byte', async () => {
  const fr = Array.from({ length: 8 }, (_, i) => W.formulaFrame('sin(x + 3*f*sin(2*x))', i / 7));
  const out1 = W.encodeWavetableWav({ name: 'rt', interp: 'spectral', frames: fr });
  const back = W.wavToTable(out1);
  const out2 = W.encodeWavetableWav(back.table);
  const a = dataBytes(out1), b = dataBytes(out2);
  const same = a.length === b.length && a.every((x, i) => x === b[i]);
  const hdr = W.parseWav(out1);
  NUM.wav = { serumRoundTrip: same, clm: hdr.clm, fade: hdr.fade, frames: back.table.frames.length, interp: back.table.interp, bytes: a.length };
  if (!same) throw new Error('frame bytes differ');
  if (hdr.clm !== 2048 || back.table.interp !== 'spectral') throw new Error(JSON.stringify(NUM.wav));
  await window.melofi.testWrite?.('wavetable-e2e/melofi-export.wav', out1);
  return `${a.length} bytes of frame data identical; clm 2048, spectral flag kept`;
});

await check('WAV: Vital (16-bit, 256 frames) and other frame sizes import', async () => {
  const fr = Array.from({ length: 256 }, (_, i) => W.formulaFrame('tanh((1 + 8*f)*sin(x))', i / 255));
  const vw = vitalWav(fr), r = W.wavToTable(vw, 'vital');
  let err = 0; r.table.frames.forEach((f, i) => { for (let j = 0; j < 2048; j++) err = Math.max(err, Math.abs(f[j] - Math.round(fr[i][j] * 32767) / 32768)); });
  // through the editor's import path, then out again: same samples as Vital wrote them (as float)
  const out = W.encodeWavetableWav(r.table), back = W.wavToTable(out);
  const same = back.table.frames.every((f, i) => f.every((x, j) => x === r.table.frames[i][j]));
  // frame size from the clm chunk (Serum: 256 .. 4096), else from the length; one 600-sample cycle
  const sizes = {};
  const cyc = (n, count) => { const a = []; for (let i = 0; i < n * count; i++) a.push(Math.sin((2 * Math.PI * i) / n)); return a; };
  sizes.s256clm = W.wavToTable(plainWav(cyc(256, 8), 16, 44100, '<!>256 10000000 wavetable (test)')).frameSize;
  sizes.s1024clm = W.wavToTable(plainWav(cyc(1024, 4), 24, 44100, '<!>1024 10000000 wavetable (test)')).frameSize;
  sizes.s4096clm = W.wavToTable(plainWav(cyc(4096, 2), 32, 44100, '<!>4096 10000000 wavetable (test)')).frameSize;
  sizes.s1024len = W.wavToTable(plainWav(cyc(1024, 3), 16)).frameSize; // 3072 samples: not a multiple of 2048
  const r4096 = W.wavToTable(plainWav(cyc(4096, 2), 32, 44100, '<!>4096 10000000 wavetable (test)'));
  const s4 = W.spectrum(r4096.table.frames[1]);
  sizes.s4096_h1 = +s4.amp[1].toFixed(4);
  const one = []; for (let i = 0; i < 600; i++) one.push(Math.sin((2 * Math.PI * i) / 600));
  const r600 = W.wavToTable(plainWav(one, 16));
  sizes.s600 = r600.frameSize;
  const s600 = W.spectrum(r600.table.frames[0]);
  NUM.vital = { frames: r.table.frames.length, interp: r.table.interp, maxErr16: err, floatRoundTrip: same, sizes, cycle600_h1: +s600.amp[1].toFixed(3), cycle600_h2: +s600.amp[2].toExponential(1) };
  if (r.table.frames.length !== 256 || r.table.interp !== 'spectral' || err > 1e-7 || !same) throw new Error(JSON.stringify(NUM.vital));
  if (sizes.s256clm !== 256 || sizes.s1024clm !== 1024 || sizes.s4096clm !== 4096 || sizes.s1024len !== 1024 || sizes.s600 !== 600 || Math.abs(sizes.s4096_h1 - 1) > 1e-3 || s600.amp[1] < 0.98 || s600.amp[2] > 1e-3) throw new Error(JSON.stringify(NUM.vital));
  await window.melofi.testWrite?.('wavetable-e2e/vital-style.wav', vw);
  return `256 frames, ${r.table.interp}; frame sizes ${JSON.stringify(sizes)}`;
});

// ---------- project ----------
await check('project: save / load keeps the waveform and the sound', async () => {
  const fr = [W.presetFrame('saw'), W.formulaFrame('tanh(6*sin(x))'), W.presetFrame('bell')];
  S.edit(() => { ch.synth = { ...ch.synth, ...base, wt1: tableOf(fr, 'spectral'), wp1: 0.4 }; });
  const pat = model.pattern(S.proj);
  S.edit(() => { model.notesOf(pat, ch.id).push({ t: 0, d: model.STEP * 4, n: 64, v: 100 }, { t: model.STEP * 4, d: model.STEP * 4, n: 67, v: 100 }); });
  await S.syncAudio();
  // just this channel (the template's sampled instruments are not installed on a test profile)
  // (dry: the reverb's impulse is made with random noise per render)
  const proj = { ...S.proj, channels: S.proj.channels.filter((c) => c.id === ch.id).map((c) => ({ ...c, send: 0 })) };
  const before = await io.renderMix(proj, { tail: 0.3 });
  const json = JSON.stringify(proj);
  await window.melofi.testWrite?.('wavetable-e2e/project.mfproj', json);
  const back = model.migrate(JSON.parse(json));
  const after = await io.renderMix(back, { tail: 0.3 });
  let d = 0, pk = 0; for (let i = 0; i < before.left.length; i++) { d = Math.max(d, Math.abs(before.left[i] - after.left[i])); pk = Math.max(pk, Math.abs(before.left[i])); }
  const t2 = W.decodeTable(back.channels.find((c) => c.id === ch.id).synth.wt1);
  const same = t2.frames.every((f, i) => f.every((x, j) => x === fr[i][j]));
  NUM.project = { renderDiff: d, peak: +pk.toFixed(3), framesSame: same, jsonKB: Math.round(json.length / 1024) };
  if (!same || d > 1e-6 || pk < 0.01) throw new Error(JSON.stringify(NUM.project));
  return `render identical (peak ${pk.toFixed(2)}), ${Math.round(json.length / 1024)} KB`;
});

await check('older projects: built-in waves sound the same', async () => {
  // a project from before the expert mode has no wt1/wt2/wp/wpe keys: the voices are the same nodes as before
  const p = { ...SY.synthDefaults(), ...SY.SYNTH_PRESETS['슈퍼쏘 리드'] };
  delete p.wp1; delete p.wp2; delete p.wpe;
  const c = new OfflineAudioContext(1, SR, SR); await SY.loadSynthWorklet(c);
  const s = new SY.SynthChannel(c, c.destination); s.setParams(p);
  const v = s.noteOn(60, 100, 0.01, 0.5);
  if (v.wt[0].length || v.wt[1].length) throw new Error('built-in preset went to the worklet');
  const x = await c.startRendering().then((b) => b.getChannelData(0));
  let pk = 0; for (const y of x) pk = Math.max(pk, Math.abs(y));
  return `no wavetable voices; peak ${pk.toFixed(3)}`;
});

await check('my waveforms: user preset and library', async () => {
  const su = await imp('studio/synth-user.js');
  await su.loadSynthUser();
  await su.saveUserPreset('E2E 내 파형', ch.synth);
  await su.saveUserWave('E2E 테이블', ch.synth.wt1);
  const txt = await window.melofi.synthUserLoad();
  const o = JSON.parse(txt);
  if (!o.presets['E2E 내 파형']?.wt1 || !o.waves['E2E 테이블']) throw new Error('not stored');
  if (!su.presetParams('E2E 내 파형')) throw new Error('presetParams');
  // the channel sheet lists it under "내 파형"
  S.channelSheet.show(ch.id, 'sound'); await sleep(120);
  const og = [...document.querySelectorAll('#chsheet optgroup')].map((g) => g.label);
  if (!og.some((l) => l === '내 파형' || l === 'My waveforms')) throw new Error(`optgroups ${og}`);
  return `stored ${Math.round(txt.length / 1024)} KB`;
});

// ---------- screenshots ----------
await check('screenshots: editor in dark and white themes', async () => {
  S.setProject(TEMPLATES.empty.make()); await sleep(120);
  S.edit(() => { ch = S.rack.makeKind('synth', 'Wavetable Lead'); ch.synth = { ...SY.synthDefaults(), w1: SY.CUSTOM_WAVE, wt1: tableOf(Array.from({ length: 24 }, (_, i) => W.formulaFrame('saw(x)*(1 - f) + tanh((1 + 6*f)*sin(x + 2*f*sin(2*x)))*f', i / 23)), 'spectral'), wp1: 0.35 }; });
  await S.syncAudio();
  S.channelSheet.show(ch.id, 'sound'); await sleep(150);
  S.channelSheet.el.style.left = '20px'; S.channelSheet.el.style.top = '60px';
  E.open(ch.id, 0); E.mode = 'harm'; E.select(8); E.dbView = true; E.hn = 128; E.render();
  E.el.style.left = `${Math.max(10, innerWidth - 1010)}px`; E.el.style.top = '40px';
  const shots = [];
  for (const th of ['dark', 'white']) {
    S.setTheme(th); await sleep(250); E.render(); await sleep(150);
    for (const mode of ['harm', 'draw', 'formula']) {
      E.mode = mode;
      if (mode === 'draw') { E.tool = 'points'; E.grid.snap = true; E.pts.delete(E.cur); const pts = E.pointsFor(); pts.forEach((q, i) => { if (i % 2) { q.c = 'linear'; q.b = i % 4 === 1 ? 0.5 : -0.4; } }); E.applyPoints(); E.commit(); }
      E.render(); await sleep(150);
      const name = `wave-${th}-${mode}`;
      await window.melofi.testShot?.('piano', name); shots.push(name);
    }
    E.tool = 'free';
  }
  S.setTheme('dark');
  return shots.join(', ');
});

console.log('WTE2E ' + JSON.stringify(NUM));
console.log(R.join('\n'));
console.log(`WTE2E ${R.filter((x) => x.startsWith('PASS')).length}/${R.length} passed`);
return [10];
