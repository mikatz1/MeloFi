const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let errs = [];
window.addEventListener('error', (e) => errs.push(e.message + ' @' + (e.filename || '').split('/').pop() + ':' + e.lineno));
window.addEventListener('unhandledrejection', (e) => errs.push('rej ' + String(e.reason?.stack || e.reason).split('\n').slice(0, 2).join(' ')));
const origErr = console.error; console.error = (...a) => { errs.push('console.error ' + a.map(String).join(' ').slice(0, 200)); origErr(...a); };
const A = window.__melofi;
for (let i = 0; i < 150 && !A?.engine?.inst; i++) await sleep(100);
const R = [];
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
// dialogs never block the run
window.confirm = () => true; window.alert = () => {}; window.prompt = () => null;

const model = await imp('studio/model.js');
const { TEMPLATES } = await imp('studio/templates.js');
const io = await imp('studio/io.js');
const ai = await imp('studio/ui/ai.js');

// ---------------- piano ----------------
await check('piano: menus have actions', () => {
  let bad = 0;
  for (const n of ['file', 'score', 'compose', 'rec', 'sound', 'view', 'settings']) {
    const walk = (items) => items.reduce((c, it) => c + (it.sub ? walk(it.sub) : (it.sep || it.group || it.disabled || typeof it.act === 'function') ? 0 : 1), 0);
    bad += walk(A.ui.menuItems(n));
  }
  if (bad) throw new Error(`${bad} menu items without action`);
});
await check('piano: themes + notes', async () => {
  const th = ['midnight', 'ember', 'sakura', 'aurora', 'snow', 'ink', 'arcade', 'synthwave', 'deepsea', 'space', 'contrast', 'mono'];
  for (const [i, t] of th.entries()) { A.settings.set({ theme: t }); const ns = A.userDown?.(60 + i, 90); await sleep(60); A.userUp?.(ns || [60 + i]); }
  A.settings.set({ theme: 'midnight' });
  return `${th.length} themes`;
});
await check('piano: settings tabs', async () => { for (const tab of ['play', 'look', 'sound', 'rec']) { A.ui.tab = tab; A.ui.open('settings'); await sleep(40); } A.ui.close(); });

// ---------------- studio ----------------
A.settings.set({ studioTourSeen: true });
const S = A.studio;
await check('studio: open', async () => { await S.open(); await sleep(500); if (!S.isOpen) throw new Error('not open'); });

for (const k of Object.keys(TEMPLATES)) {
  await check(`template ${k}: build, tabs, play`, async () => {
    const p = TEMPLATES[k].make(); S.setProject(p); await sleep(150);
    for (const t of ['roll', 'playlist', 'mixer', 'live']) { S.setTab(t); await sleep(60); }
    S.setTab('playlist');
    S.transport.play(); await sleep(500); S.transport.stop();
    return `${p.channels.length} ch, ${p.patterns.length} pat, ${p.playlist.clips.length} clips`;
  });
}

await check('actions: every non-dialog action runs', async () => {
  S.setProject(TEMPLATES.basic.make()); await sleep(100);
  const skip = new Set(['save', 'open', 'exportWav', 'exportMp3', 'exportMidi', 'record', 'tour', 'picker', 'keys', 'renamepattern']);
  const ran = [];
  const { ACTIONS } = await imp('studio/ui/studio.js');
  for (const a of Object.keys(ACTIONS)) { if (skip.has(a)) continue; S.runAction(a); ran.push(a); await sleep(30); if (S.transport.playing) S.transport.stop(); }
  document.querySelectorAll('.popup, .menu-pop').forEach((x) => x.remove());
  return `${ran.length} actions`;
});

await check('roll: add notes with tools, undo/redo', async () => {
  S.setProject(TEMPLATES.empty.make()); S.setTab('roll'); await sleep(150);
  const before = S.roll.list.length;
  S.edit(() => { for (let i = 0; i < 8; i++) S.roll.list.push({ t: i * model.STEP * 2, d: model.STEP * 2, n: 60 + i, v: 100 }); });
  const mid = S.roll.list.length;
  S.runAction('undo'); await sleep(50);
  const afterUndo = S.roll.list.length;
  S.runAction('redo'); await sleep(50);
  const afterRedo = S.roll.list.length;
  if (mid !== before + 8 || afterUndo !== before || afterRedo !== mid) throw new Error(`notes ${before}->${mid} undo ${afterUndo} redo ${afterRedo}`);
  for (const style of ['melody', 'bass', 'chords', 'arp']) S.roll.riff({ style, density: 0.5, low: 55, range: 14 });
  S.roll.draw();
  return `riff -> ${S.roll.list.length} notes`;
});

await check('playlist: tools, select/duplicate/delete, scrollbars', async () => {
  const p = TEMPLATES.kpop.make(); S.setProject(p); S.setTab('playlist'); await sleep(150);
  const P = S.playlist;
  for (const t of ['draw', 'paint', 'delete', 'mute', 'slice', 'select']) { P.setTool(t); P.draw(); }
  P.setTool('select'); const n0 = p.playlist.clips.length;
  P.sel = new Set(p.playlist.clips.slice(0, 2)); P.key({ key: 'b', ctrlKey: true }); const n1 = p.playlist.clips.length;
  P.key({ key: 'Delete' }); const n2 = p.playlist.clips.length;
  P.setTool('draw');
  const [hx, hs] = P.hThumb(); if (!(hs > 0)) throw new Error('no thumb');
  P.wheel({ preventDefault() {}, shiftKey: true, deltaY: 400, deltaX: 0 }); const sb = P.scrollBar;
  P.wheel({ preventDefault() {}, deltaY: 0, deltaX: 300 }); const sb2 = P.scrollBar;
  if (!(sb > 0 && sb2 > sb)) throw new Error(`scroll ${sb} ${sb2}`);
  P.scrollBar = 0; P.draw();
  return `clips ${n0}->${n1}->${n2}`;
});

await check('mixer: render, fx add, arm', async () => {
  S.setTab('mixer'); await sleep(100);
  const ch = S.proj.channels[0];
  S.edit(() => { ch.fx = ch.fx || []; ch.fx.push({ id: 'e2efx', type: 'pitchfix', on: true, params: { root: 0, scale: 1, speed: 20 } }); ch.arm = true; });
  await S.syncAudio(); S.mixer.render(); await sleep(100);
  return `${document.querySelectorAll('.mx-strip, .mx-col, .strip').length} strips`;
});

await check('transport: song mode play with seek and loop', async () => {
  S.setProject(TEMPLATES.lofi.make()); await sleep(100);
  S.setMode('song'); S.transport.play(); await sleep(400);
  S.transport.seek(model.barTicks(S.proj) * 2); await sleep(300);
  S.proj.loop = { start: 0, end: 2 }; S.proj.loopOn = true; await sleep(300);
  S.transport.stop(); S.proj.loop = null; S.proj.loopOn = false;
});

await check('render: offline mix is not silent', async () => {
  const p = TEMPLATES.kpop.make();
  const mix = await io.renderMix(p, { tail: 0.5 });
  let peak = 0; for (let i = 0; i < mix.left.length; i += 7) peak = Math.max(peak, Math.abs(mix.left[i]));
  if (peak < 0.01) throw new Error(`peak ${peak}`);
  if (peak > 1.0) throw new Error(`clipping peak ${peak.toFixed(3)}`);
  return `${(mix.left.length / mix.rate).toFixed(1)} s, peak ${peak.toFixed(3)}`;
});

await check('project: JSON round trip', async () => {
  const p = TEMPLATES.citypop.make(); S.setProject(p); await sleep(80);
  const txt = JSON.stringify(S.proj); const q = JSON.parse(txt); S.setProject(q); await sleep(120);
  if (JSON.stringify(S.proj).length < txt.length * 0.9) throw new Error('lost data');
  return `${(txt.length / 1024).toFixed(0)} KB`;
});

await check('time signature + tempo markers', async () => {
  const p = TEMPLATES.basic.make(); S.setProject(p);
  S.edit(() => { p.sigs = [{ tick: model.barTicks(p) * 2, sig: [3, 4] }]; p.tempos = [{ bar: 1, bpm: 140 }]; });
  S.setTab('playlist'); S.playlist.draw(); S.transport.play(); await sleep(300); S.transport.stop();
  const t = model.tickToSec(p, 0); const back = model.secToTick(p, model.tickToSec(p, 5000));
  if (Math.abs(back - 5000) > 1) throw new Error(`sec/tick round trip ${back}`);
});

await check('floating windows: detach, arrange, dock', async () => {
  for (const k of ['roll', 'playlist', 'mixer']) S.detach(k);
  await sleep(100); S.arrange('fl'); await sleep(100);
  for (const k of ['roll', 'playlist', 'mixer']) S.dock(k);
  if (Object.keys(S.floating).length) throw new Error('still floating');
});

await check('channel sheet + riff wizard + newtone + quantize + randomize open/close', async () => {
  S.setProject(TEMPLATES.basic.make()); await sleep(80);
  S.channelSheet.show(S.proj.channels[0].id); await sleep(120); S.channelSheet.hide?.() ?? S.channelSheet.close?.();
  S.riffDialog?.(); await sleep(150); S.riffWizard.close?.(); S.riffWizard.hide?.();
  document.querySelectorAll('.st-float-win, .sheet, .popup').forEach((x) => { if (x.querySelector?.('.x')) x.querySelector('.x').click(); });
});

await check('loop starter', async () => {
  const p = S.makeLoopStart('kpop'); S.setProject(p); await sleep(200);
  S.transport.play(); await sleep(500); S.transport.stop();
  return `${p.channels.length} ch`;
});

await check('look settings', async () => {
  A.settings.set({ studioLook: { zoom: 110, accent: '#5aa0e8', trackH: 60, rowH: 16 } }); S.applyLook(); await sleep(100);
  A.settings.set({ studioLook: null }); S.applyLook();
});

// ---------------- AI analysis ----------------
await check('ai: cleanDownbeats edge cases', () => {
  const f = ai.cleanDownbeats;
  const same = (a, b) => a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) < 1e-6);
  if (!same(f([]), [])) throw new Error('empty');
  if (!same(f([0, 1]), [0, 1])) throw new Error('short');
  const bt = Array.from({ length: 25 }, (_, i) => i * 0.8);
  const half = f([0, 3.2, 6.4, 8, 9.6, 11.2, 12.8, 16], bt, 4);
  if (!same(half, [0, 3.2, 6.4, 9.6, 12.8, 16])) throw new Error('half ' + half);
  const gap = f([0, 3.2, 6.4, 12.8, 16, 19.2], bt, 4);
  if (!same(gap, [0, 3.2, 6.4, 9.6, 12.8, 16, 19.2])) throw new Error('gap ' + gap);
});
await check('ai: fromFeatures (simple analysis)', () => {
  const bars = []; for (let i = 0; i < 24; i++) bars.push({ time: i * 2, kick: '1000100010001000', snare: '0000100000001000', hat: '1010101010101010', bass: [40 + (i % 3), 0, 0, 0], chords: ['C', 'G'], chord_beats: [0, 2] });
  const f = { bpm: 120, key_root: 0, key_mode: 'major', first_downbeat: 0, sections: [{ start_bar: 1, end_bar: 12 }, { start_bar: 13, end_bar: 24 }], bars, melody: [{ s: 4, d: 2, n: 72 }] };
  const p = ai.fromFeatures(f, 'x.wav', S); S.setProject(p);
  const end = Math.max(...p.playlist.clips.map((c) => c.start + c.len));
  if (end !== 24) throw new Error('end ' + end);
  return `${p.patterns.length} patterns`;
});
await check('ai: fromStems (MIDI only, synthetic)', async () => {
  const db = []; for (let i = 0; i < 30; i++) db.push(1 + i * 2);
  const r = { bpm: 120, meter: 4, key: { root: 9, mode: 'minor' }, downbeats: db, first_downbeat: 1, duration: 61, stems: { vocals: 'x', bass: 'y' }, notes: { vocals: [[1.5, 0.5, 72, 90], [59, 0.5, 70, 90]], bass: [[2, 1, 40, 100]] }, drums: [] };
  const p = await ai.fromStems(r, null, 'y.wav', S, { audio: false, midi: true }); S.setProject(p);
  const end = Math.max(...p.playlist.clips.map((c) => c.start + c.len));
  if (end !== 30) throw new Error('end bar ' + end);
});
await check('ai: window renders each option', async () => {
  const sh = S.aiSheet; await sh.show(); await sleep(200);
  sh.engine = { ready: true, gpu: true, muscriptor: true, hfToken: true };
  for (const m of ['engine', 'quick']) for (const sp of ['full', 'fast']) for (const mu of ['off', 'small', 'medium', 'large']) { sh.method = m; sh.sepMode = sp; sh.mus = mu; sh.render(); }
  sh.close();
});

// ---------------- tour ----------------
await check('tour: every lesson and step', async () => {
  const { CHAPTERS: LESSONS } = await imp('studio/ui/lessons.js');
  const T = S.tour;
  let steps = 0, nulls = 0;
  const list = LESSONS || [];
  for (const L of list) {
    T.start(L.id); await sleep(80);
    for (let i = 0; i < L.steps.length; i++) { T.go(i); await sleep(40); if (!T.tip || T.tip.hidden) throw new Error(`${L.id} step ${i}: card hidden`); steps++; if (/\bnull\b|undefined/.test(T.tip?.innerText || '')) nulls++; }
    T.stop();
  }
  if (nulls) throw new Error(`${nulls} cards show null/undefined`);
  return `${list.length} lessons, ${steps} steps`;
});

await check('studio: close', async () => { S.setProject(TEMPLATES.empty.make()); S.close(); await sleep(200); });

console.log('E2E-BEGIN\n' + R.join('\n') + '\nE2E-END');
return [100];
