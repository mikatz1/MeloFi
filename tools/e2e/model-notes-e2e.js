// End-to-end check of the optional transcription models (piano, bass, vocals: stems.js stems:piano*,
// stems:bass*, stems:vocalNotes*; renderer/studio/ui/stemconvert.js modelNotes): the components'
// status, on request their installation, then a separated song opened as a project and its stems
// converted, looking at whose notes were used and how the channels are named. Run headless with a
// scratch userData whose stems-engine and instruments are junctions to the real ones and whose
// stems-cache already holds the song's separation (as tools/roundtrip.sh makes it):
//   MELOFI_USERDATA=<scratch> MELOFI_SHOT=<out> MELOFI_SCRIPT=<wrapper.js> npx electron .
// wrapper: `window.__args = { song: '<path>', setup: ['bass', 'vocals'], stems: ['bass', 'piano', 'vocals'] };`
// followed by this file. `setup` installs those components into the engine folder (downloads).
// Prints MODEL lines; screenshots model-*.png in MELOFI_SHOT.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errs = [];
window.addEventListener('error', (e) => errs.push(e.message));
window.addEventListener('unhandledrejection', (e) => errs.push(String(e.reason?.stack || e.reason).split('\n')[0]));
const A = window.__melofi; for (let i = 0; i < 150 && !A?.engine?.inst; i++) await sleep(100);
const args = window.__args || {};
const shot = async (name) => { await sleep(350); await window.melofi.testShot?.('piano', `model-${name}`); };
const say = (what, o = {}) => console.log(`MODEL ${what} ` + JSON.stringify(o));
const S = A.studio; await S.open(); await sleep(500);
const notesOf = (p, id) => p.patterns.reduce((a, pt) => a + (pt.notes[id]?.length || 0), 0);
const API = { piano: ['stemsPianoStatus', 'stemsPianoSetup'], bass: ['stemsBassStatus', 'stemsBassSetup'], vocals: ['stemsVocalNotesStatus', 'stemsVocalNotesSetup'] };
const status = async () => Object.fromEntries(await Promise.all(Object.entries(API).map(async ([k, [st]]) => [k, (await window.melofi[st]()).installed])));

say('status', await status());
for (const k of args.setup || []) {
  const t0 = performance.now(), labels = new Set();
  const off = window.melofi.onStemsProgress?.((m) => { if (m.label) labels.add(m.label); });
  const r = await window.melofi[API[k][1]]();
  off?.();
  say('setup', { k, ok: r.ok, message: r.message, sec: Math.round((performance.now() - t0) / 1000), labels: [...labels] });
}
if (args.setup?.length) say('status after setup', await status());

// the separation (from the cache) -> project
let t0 = performance.now();
const run = await window.melofi.stemsRun({ path: args.song, name: args.song, quick: false, muscriptor: 'off' });
if (!run.ok) { say('SEPFAIL', { msg: run.message }); return [10]; }
say('separated', { sec: Math.round((performance.now() - t0) / 1000), stems: Object.keys(run.result.stems) });
const ai = S.aiSheet; await ai.show();
ai.stems = run.result; ai.file = { name: args.song.split(/[\\/]/).pop() }; ai.audio = true; ai.step = 'result'; ai.render();
await ai.openStems();
let p = S.proj;
const conv = S.stemConvert;
// opening the project starts the conversion of every track by itself (ai.js): that is what a user
// gets, so it is waited for and looked at first
t0 = performance.now();
for (let i = 0; i < 20 && !conv.busy; i++) await sleep(250);
for (let i = 0; i < 4800 && conv.busy; i++) await sleep(500);
p = S.proj;
{
  const r = await conv.result();
  say('auto conversion', { sec: Math.round((performance.now() - t0) / 1000), model: r.modelNotes || null, missing: conv.modelMissing || null,
    notes: Object.fromEntries(['piano', 'bass', 'vocals'].map((k) => [k, `${r.notesGeneral?.[k]?.length ?? '-'} -> ${r.notes?.[k]?.length ?? '-'}`])),
    channels: p.channels.filter((c) => c.conv).map((c) => `${c.conv}: ${c.name} [${c.kind || 'inst'}] notes ${notesOf(p, c.id)}`), rows: conv.view?.rows, error: conv.error, errs: errs.splice(0) });
  await shot('auto');
  conv.close?.();
}

for (const k of args.stems || ['bass']) {
  const ch = S.proj.channels.find((c) => c.stem === k);
  if (!ch) { say('no stem', { k }); continue; }
  t0 = performance.now();
  try {
    if (k === 'vocals') {
      // the lead vocal: its notes as the singing channel takes them
      const r = await conv.result(), notes = await conv.vocalNotes(r);
      say('vocal notes', { sec: Math.round((performance.now() - t0) / 1000), model: r.modelNotes?.vocals ?? null, missing: !!conv.modelMissing?.vocals, general: r.notesGeneral?.vocals?.length ?? r.notes?.vocals?.length, used: r.notes?.vocals?.length, melody: notes.length, errs: errs.splice(0) });
      continue;
    }
    await conv.open(ch);
    for (let i = 0; i < 2400 && conv.busy; i++) await sleep(500);
    const r = await conv.result();
    say('matched', { k, sec: Math.round((performance.now() - t0) / 1000), view: conv.view?.kind, sameResult: conv.view?.hit?.r === r, fixed: r.fixed?.[k]?.length ?? null, groups: (conv.view?.hit?.plan?.stems?.[k] || []).map((g) => `${g.cat}${g.stray ? ' (stray)' : ''}`), model: r.modelNotes?.[k] ?? null, missing: !!conv.modelMissing?.[k], general: r.notesGeneral?.[k]?.length ?? r.notes?.[k]?.length, used: r.notes?.[k]?.length,
      notice: conv.el.querySelector('.ai-nc')?.parentElement?.innerText.replace(/\s+/g, ' ') || null, installRow: [...conv.el.querySelectorAll('.row .btn')].map((b) => b.textContent).filter((x) => /받기/.test(x)), error: conv.error, errs: errs.splice(0) });
    await shot(`${k}-candidates`);
    if (conv.view?.kind && !conv.error) {
      await conv.make(conv.view);
      p = S.proj;
      say('made', { k, channels: p.channels.filter((c) => c.conv === k).map((c) => `${c.name} [${c.kind || 'inst'}] notes ${notesOf(p, c.id)}`), errs: errs.splice(0) });
      await shot(`${k}-made`);
    }
    conv.close?.();
  } catch (err) { say('FAIL', { k, msg: String(err?.message || err), errs: errs.splice(0) }); }
}
say('end');
return [10];
