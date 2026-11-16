// End-to-end check of converting separated tracks from the project (renderer/studio/ui/stemconvert.js):
// a song is separated, opened as a project (audio tracks only), one track is converted to MIDI from
// its menu, the project goes through save / load, the lead vocal is converted to a singing channel
// and every track is converted at once. Run headless with a scratch userData whose stems-engine,
// vocal-engine and instruments are junctions to the real ones:
//   MELOFI_USERDATA=<scratch> MELOFI_SHOT=<out> MELOFI_SCRIPT=<wrapper.js> npx electron .
// wrapper: `window.__args = { song: '<path>', one: 'bass' };` followed by this file.
// Prints CONV lines; screenshots conv-*.png in MELOFI_SHOT.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errs = [];
window.addEventListener('error', (e) => errs.push(e.message));
window.addEventListener('unhandledrejection', (e) => errs.push(String(e.reason?.stack || e.reason).split('\n')[0]));
const A = window.__melofi; for (let i = 0; i < 150 && !A?.engine?.inst; i++) await sleep(100);
const imp = (p) => import(new URL(p, location.href).href);
const { migrate } = await imp('studio/model.js');
const args = window.__args || {};
const shot = async (name) => { await sleep(350); await window.melofi.testShot?.('piano', `conv-${name}`); };
const say = (what, o = {}) => console.log(`CONV ${what} ` + JSON.stringify(o));
const S = A.studio; await S.open(); await sleep(500);
const notesOf = (p, id) => p.patterns.reduce((a, pt) => a + (pt.notes[id]?.length || 0), 0);

// 1) separation -> result page -> project (audio tracks only)
let t0 = performance.now();
const run = await window.melofi.stemsRun({ path: args.song, name: args.song, quick: false, muscriptor: 'off' });
if (!run.ok) { say('SEPFAIL', { msg: run.message }); return [10]; }
say('separated', { sec: Math.round((performance.now() - t0) / 1000), stems: Object.keys(run.result.stems) });
const ai = S.aiSheet; await ai.show();
ai.stems = run.result; ai.file = { name: args.song.split(/[\\/]/).pop() }; ai.audio = true; ai.step = 'result'; ai.render();
await shot('1-result');
say('ai steps', { steps: [...ai.el.querySelectorAll('.ai-steps li')].map((li) => li.textContent), buttons: [...ai.el.querySelectorAll('.ai-step .btn')].map((b) => b.textContent) });
await ai.openStems();
// opening the separation as a project starts converting every track by itself (ai.js: convertAll auto): let it
// finish, then the single-track steps below work on a project that is not busy
{
  const c0 = S.stemConvert, ta = performance.now();
  for (let i = 0; i < 20 && !c0.busy; i++) await sleep(250);
  const auto = !!c0.busy;
  window.__autoConverted = auto;
  for (let i = 0; i < 2400 && c0.busy; i++) await sleep(500);
  say('auto conversion', { started: auto, sec: Math.round((performance.now() - ta) / 1000), channels: S.proj.channels.filter((c) => c.conv).map((c) => `${c.conv}: ${c.name} (${notesOf(S.proj, c.id)})`), errs: errs.splice(0) });
  c0.close?.();
}
let p = S.proj;
say('project', { channels: p.channels.map((c) => `${c.name}:${c.kind}${c.stem ? ':' + c.stem : ''}`), patterns: p.patterns.length, ref: !!p.stemsRef?.dir, errs: errs.splice(0) });
await shot('2-project');

// 2) one track from its menu
const conv = S.stemConvert;
const ch = p.channels.find((c) => c.stem === (args.one || 'bass'));
say('menu', { rack: conv.menuItems(ch).map((i) => i.label).filter(Boolean), track: conv.menuItems(conv.channelOfTrack(p.playlist.clips.find((c) => c.ch === ch.id).track)).map((i) => i.label).filter(Boolean), vocal: conv.menuItems(p.channels.find((c) => c.stem === 'vocals')).map((i) => i.label).filter(Boolean) });
S.setTab?.('playlist'); S.rack.menu(ch, 220, 200); await shot('3-menu'); document.querySelectorAll('.st-pop, .popup, .menu').forEach((x) => x.remove());
t0 = performance.now();
const opening = conv.open(ch);
await sleep(4000); await shot('4-matching');
await opening;
say('one matched', { sec: Math.round((performance.now() - t0) / 1000), rows: [...conv.el.querySelectorAll('.mc-row')].map((el) => el.innerText.replace(/\s+/g, ' ').slice(0, 110)), options: conv.el.querySelector('.mc-sel')?.options.length, error: conv.error, errs: errs.splice(0) });
await shot('5-candidates');
await conv.make(conv.view);
p = S.proj;
const made = p.channels.filter((c) => c.conv === ch.stem);
say('one made', { made: made.map((c) => `${c.name} [${c.kind || 'inst'}] notes ${notesOf(p, c.id)} fx ${c.fx?.length || 0} send ${c.send}`), after: p.channels[p.channels.indexOf(ch) + 1]?.conv === ch.stem, audioMuted: ch.mute, track: p.playlist.tracks.find((x) => x.conv)?.name, patterns: p.patterns.filter((x) => x.conv).length, errs: errs.splice(0) });
await shot('6-made');

// 3) save / load: the project still knows its separation
S.setProject(migrate(JSON.parse(JSON.stringify(S.proj)))); await sleep(300);
S._conv = null; // (as after a restart: nothing matched yet)
const conv2 = S.stemConvert;
p = S.proj;
say('reloaded', { ref: p.stemsRef?.dir === run.result.stems.bass.replace(/[\\/]stems[\\/][^\\/]+$/, ''), stems: conv2.stemChannels().map((c) => c.stem), conv: p.channels.filter((c) => c.conv).length });

// 4) the lead vocal -> a singing channel
const lead = p.channels.find((c) => c.stem === 'vocals');
if (lead && !args.noVocal) {
  t0 = performance.now();
  await conv2.openVocal(lead);
  for (let i = 0; i < 1200 && conv2.busy; i++) await sleep(500);
  const v = conv2.view;
  say('lyrics', { sec: Math.round((performance.now() - t0) / 1000), notes: v.notes.length, text: (v.text || '').slice(0, 120), lang: v.heardLang, voice: v.voice, ready: v.st?.voices.filter((x) => x.ready).map((x) => x.id), line: v.line, error: conv2.error });
  await shot('7-vocal');
  if (v.st?.voices.find((x) => x.id === v.voice)?.ready && v.notes.length) {
    t0 = performance.now();
    await conv2.makeVocal(v);
    p = S.proj;
    const vc = p.channels.find((c) => c.conv === 'vocals');
    say('vocal made', { sec: Math.round((performance.now() - t0) / 1000), channel: vc?.name, voice: vc?.vocal?.voice, syl: vc?.vocal?.syl?.length, notes: vc ? notesOf(p, vc.id) : 0, sung: p.channels.filter((c) => c.kind === 'audio' && !c.stem).map((c) => c.name), error: conv2.error, errs: errs.splice(0) });
    await shot('8-sung');
    conv2.close();
  } else conv2.close();
}

// 5) every track at once, in the background (already done by the automatic conversion on open: run again only
// when that did not start, or when asked with __args.batch; it holds the lyrics and timbre models at once)
if (window.__autoConverted && !args.batch) { say('batch skipped', { why: 'the automatic conversion on open already converted every track' }); say('end'); return [10]; }
t0 = performance.now();
const all = conv2.convertAll();
await sleep(15000); await shot('9-batch-card');
say('batch running', { busy: conv2.busy, card: document.querySelector('.ai-mini')?.innerText.replace(/\s+/g, ' ').slice(0, 120), cardHidden: document.querySelector('.ai-mini')?.hidden });
await all;
p = S.proj;
say('batch done', { sec: Math.round((performance.now() - t0) / 1000), rows: conv2.view.rows, channels: p.channels.filter((c) => c.conv).map((c) => `${c.conv}: ${c.name} (${notesOf(p, c.id)})`), patterns: p.patterns.length, tracks: p.playlist.tracks.filter((x) => x.conv).length, error: conv2.error, errs: errs.splice(0) });
await sleep(600); await shot('10-batch-done');
conv2.show(); await shot('11-batch-summary'); conv2.close();
S.setTab?.('playlist'); await shot('12-playlist');
say('end');
return [10];
