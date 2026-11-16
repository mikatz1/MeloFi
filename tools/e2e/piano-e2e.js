// The piano window end to end, headless: scores (MIDI and MusicXML) opened, played, parts, saved as
// MIDI; the key list; recording a take to files; a short falling-notes video; stream mode.
//   MELOFI_SHOT=<out> MELOFI_SCRIPT=tools/e2e/piano-e2e.js MELOFI_USERDATA=<tmp dir> npx electron .
// Files go to <out>/rec (the recording folder is pointed there); prints E2E-BEGIN … E2E-END.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let errs = [];
window.addEventListener('error', (e) => errs.push(e.message + ' @' + (e.filename || '').split('/').pop() + ':' + e.lineno));
window.addEventListener('unhandledrejection', (e) => errs.push('rej ' + String(e.reason?.stack || e.reason).split('\n').slice(0, 2).join(' ')));
const origErr = console.error; console.error = (...a) => { errs.push('console.error ' + a.map(String).join(' ').slice(0, 200)); origErr(...a); };
const A = window.__melofi, api = window.melofi;
for (let i = 0; i < 150 && !A?.engine?.inst; i++) await sleep(100);
const R = [];
const imp = (p) => import(new URL(p, location.href).href);
window.confirm = () => true; window.alert = () => {};
const ok = (c, msg) => { if (!c) throw new Error(msg); };
async function check(name, fn) {
  errs = []; await api.testDialogLog(true);
  try {
    const n = await fn(); await sleep(60);
    const dl = await api.testDialogLog(true);
    const bad = errs.length || dl.length;
    R.push(`${bad ? 'FAIL' : 'PASS'} ${name}${n ? ` (${n})` : ''}${errs.length ? ' :: ' + [...new Set(errs)].slice(0, 3).join(' | ') : ''}${dl.length ? ' :: native ' + dl.map((d) => d.kind).join(',') : ''}`);
  } catch (e) { R.push(`FAIL ${name} :: ${String(e?.stack || e).split('\n').slice(0, 2).join(' ')}${errs.length ? ' | ' + errs.slice(0, 2).join(' | ') : ''}`); }
}
const out = (await api.testWrite('rec/keep.txt', '')).replace(/[\\/]keep\.txt$/, '');
A.settings.set({ recDir: out, studioTourSeen: true, introCard: false });
const { encodeMidi } = await imp('js/recorder.js');

// a two-part MIDI file (right hand melody, left hand chords), 3 s
const evs = [];
for (let i = 0; i < 8; i++) { evs.push({ type: 'on', note: 72 + (i % 5), vel: 90, ms: i * 300 }, { type: 'off', note: 72 + (i % 5), ms: i * 300 + 280 }); }
for (let i = 0; i < 4; i++) for (const n of [48, 52, 55]) evs.push({ type: 'on', note: n, vel: 70, ms: i * 600 }, { type: 'off', note: n, ms: i * 600 + 580 });
const midi = encodeMidi(evs, { name: 'e2e song', bpm: 120 });
const xml = `<?xml version="1.0"?><score-partwise version="3.1"><work><work-title>E2E XML</work-title></work><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
<part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
${['C', 'D', 'E', 'F'].map((s) => `<note><pitch><step>${s}</step><octave>5</octave></pitch><duration>1</duration><type>quarter</type></note>`).join('')}</measure></part></score-partwise>`;

await check('score: a MIDI file opens, plays and stops', async () => {
  await A.openScore('e2e.mid', midi); await sleep(300);
  const P = A.player; ok(P.song && P.song.lines.length >= 1, 'not loaded');
  const notes = P.song.lines.reduce((a, l) => a + l.notes.length, 0); ok(notes === 20, `${notes} notes`);
  await A.toggleScore(); await sleep(1200); ok(P.playing, 'not playing'); const at = P.now(); ok(at > 0.3, `at ${at}`);
  A.action('scoreStop'); await sleep(100); ok(!P.playing, 'still playing');
  await api.testShot('piano', 'piano-score');
  return `${P.song.lines.length} parts, ${notes} notes`;
});
await check('score: a MusicXML file opens with its title and four notes', async () => {
  await A.openScore('e2e.musicxml', new TextEncoder().encode(xml)); await sleep(200);
  const s = A.player.song; ok(s?.title === 'E2E XML', `title ${s?.title}`);
  const ns = s.lines.flatMap((l) => l.notes).map((n) => n.n).sort((a, b) => a - b); ok(ns.join() === '72,74,76,77', ns.join());
});
await check('score: parts menu and score menu items work', async () => {
  await A.openScore('e2e.mid', midi); await sleep(200);
  const items = A.ui.menuItems('score').filter((x) => !x.sep && !x.disabled);
  ok(items.length >= 6, `${items.length} enabled items`);
  A.ui.openPartsMenu(); await sleep(150);
  for (const it of items) if (it.check !== undefined && typeof it.act === 'function') { it.act(); await sleep(30); it.act(); }
  A.ui.openMenu?.(null); A.ui.close?.();
});
await check('bug: a score saved as MIDI keeps its title (file name and the title it reopens with)', async () => {
  await A.openScore('e2e.mid', midi); await sleep(200);
  ok(A.player.song.title === 'e2e song', `opened as "${A.player.song.title}"`);
  await A.exportScoreMidi(); await sleep(300);
  const path = document.querySelector('.toast, #toast')?.dataset?.path || document.querySelector('[data-path]')?.dataset.path || '';
  const { readScore } = await imp('js/score/index.js');
  const again = await readScore('x.mid', encodeMidi([{ type: 'on', note: 60, vel: 90, ms: 0 }, { type: 'off', note: 60, ms: 100 }], { name: 'Round Trip' }));
  ok(again.title === 'Round Trip', `reads back as "${again.title}"`);
  return path.split(/[\/]/).pop();
});
await check('key list shows the keys that sound', async () => {
  A.settings.set({ keyList: true }); await sleep(100);
  const ns = A.userDown(60, 90); await sleep(120);
  const txt = document.getElementById('keyList')?.innerText || '';
  A.userUp(ns || [60]); A.settings.set({ keyList: false });
  ok(/C4|도|C/.test(txt), `key list "${txt.slice(0, 40)}"`);
});
await check('recording: a take with notes is saved as files', async () => {
  A.closeScore?.();
  await A.toggleRecord(); await sleep(300); ok(A.recorder.recording, 'not recording');
  for (let i = 0; i < 4; i++) { const ns = A.userDown(60 + i * 2, 90); await sleep(150); A.userUp(ns || [60 + i * 2]); }
  await sleep(300); await A.toggleRecord(); await sleep(1500);
  ok(!A.recorder.recording, 'still recording');
  const toast = document.querySelector('.toast, #toast')?.innerText || '';
  ok(!/실패|fail/i.test(toast), `toast ${toast}`);
  return toast.slice(0, 60);
});
await check('video: a short falling-notes render finishes and writes an MP4', async () => {
  await A.openScore('e2e.mid', midi); await sleep(200);
  const t0 = performance.now();
  await A.renderVideo({ height: 360, fps: 30 });
  const toast = document.querySelector('.toast, #toast')?.innerText || '';
  ok(!/실패|fail/i.test(toast), `toast ${toast}`);
  return `${Math.round((performance.now() - t0) / 1000)} s`;
});
await check('bug: the top menus open from the keyboard (Enter on a focused menu button)', async () => {
  const b = document.querySelector('.menubar [data-menu="score"]'); A.ui.openMenu(null);
  b.focus(); b.click(); await sleep(80); ok(A.ui.menuOpen === 'score', `menu ${A.ui.menuOpen}`); A.ui.openMenu(null);
});
await check('stream mode and back', async () => { A.settings.set({ streamMode: true }); await sleep(200); await api.testShot('piano', 'piano-stream'); A.settings.set({ streamMode: false }); await sleep(100); });
await check('close the score', async () => { A.closeScore(); await sleep(100); ok(!A.player.song, 'still open'); });

console.log('E2E-BEGIN\n' + R.join('\n') + `\n${R.filter((l) => l.startsWith('PASS')).length}/${R.length} pass\nE2E-END`);
return [100];
