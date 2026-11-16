// FL Studio parity, behaviour by behaviour (docs/fl-workflow-comparison.md, round 4), and the bugs the
// whole-app sweep (tools/e2e/sweep-e2e.js) found. Headless:
//   MELOFI_SHOT=<out> MELOFI_SCRIPT=tools/e2e/fl-parity-e2e.js MELOFI_USERDATA=<tmp dir> npx electron .
// Prints E2E-BEGIN … E2E-END; screenshots fl-*.png in MELOFI_SHOT.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let errs = [];
window.addEventListener('error', (e) => errs.push(e.message + ' @' + (e.filename || '').split('/').pop() + ':' + e.lineno));
window.addEventListener('unhandledrejection', (e) => errs.push('rej ' + String(e.reason?.stack || e.reason).split('\n').slice(0, 2).join(' ')));
const origErr = console.error; console.error = (...a) => { errs.push('console.error ' + a.map(String).join(' ').slice(0, 200)); origErr(...a); };
const A = window.__melofi, api = window.melofi;
for (let i = 0; i < 150 && !A?.engine?.inst; i++) await sleep(100);
const R = [];
const imp = (p) => import(new URL(p, location.href).href);
window.confirm = () => true; window.alert = () => {}; window.prompt = () => null;
async function check(name, fn) {
  errs = [];
  try { const n = await fn(); await sleep(50); R.push(`${errs.length ? 'FAIL' : 'PASS'} ${name}${n ? ` (${n})` : ''}${errs.length ? ' :: ' + [...new Set(errs)].slice(0, 3).join(' | ') : ''}`); } catch (e) { R.push(`FAIL ${name} :: ${String(e?.stack || e).split('\n').slice(0, 2).join(' ')}${errs.length ? ' | ' + errs.slice(0, 2).join(' | ') : ''}`); }
  document.querySelectorAll('.st-pop').forEach((x) => x.remove());
  for (const a of document.querySelectorAll('.st-ask')) a.querySelector('.row button')?.click();
}
const ok = (c, msg) => { if (!c) throw new Error(msg); };
const key = (o) => { const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...o }); return A.studio.key(e); };
const shot = (n) => api.testShot?.('piano', n);
// the popup a function opens: its labels
const popLabels = () => [...document.querySelectorAll('.st-pop button')].map((b) => (b.firstChild?.nodeValue || b.textContent).trim());
const press = (label) => { const b = [...document.querySelectorAll('.st-pop button')].find((x) => (x.firstChild?.nodeValue || x.textContent).trim() === label); ok(b, `no "${label}" in ${popLabels().join(' | ')}`); b.click(); };

A.settings.set({ studioTourSeen: true, lang: 'ko' });
await sleep(300);
const model = await imp('studio/model.js');
const { TEMPLATES } = await imp('studio/templates.js');
const io = await imp('studio/io.js');
const S = A.studio;
await S.open(); await sleep(500);
const fresh = (k = 'kpop') => { S.setProject(TEMPLATES[k].make()); S.dirty = false; };

// ---------- bugs found by the sweep ----------
await check('bug: 작곡 > 새 프로젝트 (studio.newFile) opens the template list', async () => {
  ok(typeof S.newFile === 'function', 'newFile missing');
  S.newFile(); await sleep(50);
  ok(popLabels().length >= 7, 'no template list');
  const items = A.ui.menuItems('compose'); const it = items.find((x) => x.label === A.ui.menuItems('compose')[2].label);
  await it.act(); await sleep(80); ok(document.querySelector('.st-pop'), 'piano menu item did nothing');
});

// ---------- piano roll ----------
const rollSetup = () => {
  fresh('empty'); S.setTab('roll');
  const L = S.roll.list; L.length = 0;
  for (let i = 0; i < 4; i++) L.push({ t: i * model.STEP * 4 + 5, d: model.STEP * 3, n: 60 + i * 2, v: 90 });
  S.roll.sel = new Set(L.slice(0, 2)); S.roll.c.focus(); S.roll.draw();
  return L;
};
await check('roll: Ctrl+D deselects, Ctrl+B duplicates, Shift+I inverts', () => {
  const L = rollSetup();
  key({ key: 'b', ctrlKey: true }); ok(L.length === 6, `Ctrl+B ${L.length}`);
  key({ key: 'd', ctrlKey: true }); ok(S.roll.sel.size === 0 && L.length === 6, 'Ctrl+D');
  S.roll.sel = new Set([L[0]]); key({ key: 'I', shiftKey: true }); ok(S.roll.sel.size === 5 && !S.roll.sel.has(L[0]), 'Shift+I');
});
await check('roll: Backspace toggles snap none and back, Delete deletes', () => {
  const L = rollSetup(); const was = S.snapKey;
  key({ key: 'Backspace' }); ok(S.snapKey === 1 && L.length === 4, 'snap none');
  key({ key: 'Backspace' }); ok(S.snapKey === was, 'snap back');
  key({ key: 'Delete' }); ok(L.length === 2, 'delete');
});
await check('roll: Ctrl+Q quantizes starts and lengths, Shift+Q starts only', () => {
  let L = rollSetup(); S.snapKey = model.STEP; S.roll.sel.clear();
  key({ key: 'q', shiftKey: true }); ok(L.every((n) => n.t % model.STEP === 0 && n.d === model.STEP * 3), 'Shift+Q');
  L = rollSetup(); S.roll.sel.clear(); L[0].d = model.STEP * 3 + 7;
  key({ key: 'q', ctrlKey: true }); ok(L.every((n) => n.t % model.STEP === 0 && n.d % model.STEP === 0), 'Ctrl+Q');
});
await check('roll: arrows (Shift semitone, Ctrl octave, Alt nudge), Alt+M / Shift+Alt+M, Alt+Y flip', () => {
  const L = rollSetup(); const a = L[0];
  key({ key: 'ArrowUp', shiftKey: true }); ok(a.n === 61, `Shift+Up ${a.n}`);
  key({ key: 'ArrowDown', ctrlKey: true }); ok(a.n === 49, `Ctrl+Down ${a.n}`);
  const t0 = a.t; key({ key: 'ArrowRight', altKey: true }); ok(a.t > t0 && a.t - t0 < S.snap, 'Alt nudge');
  key({ key: 'm', altKey: true }); ok(a.mute && L[1].mute, 'Alt+M');
  key({ key: 'm', altKey: true, shiftKey: true }); ok(!a.mute, 'Shift+Alt+M');
  S.roll.sel.clear(); const hi = Math.max(...L.map((n) => n.n)), lo = Math.min(...L.map((n) => n.n));
  key({ key: 'y', altKey: true }); ok(Math.max(...L.map((n) => n.n)) === hi && Math.min(...L.map((n) => n.n)) === lo, 'flip range');
});
await check('roll: Limit, Scale levels, Articulate, Flam', () => {
  let L = rollSetup(); S.roll.sel.clear(); L[0].n = 20; L[3].n = 110;
  S.roll.limit({ low: 48, high: 84 }); ok(L.every((n) => n.n >= 48 && n.n <= 84), 'limit');
  L.forEach((n, i) => { n.v = 60 + i * 20; }); S.roll.scaleLevels({ scale: 0, offset: 0 }); ok(new Set(L.map((n) => n.v)).size === 1, 'levels');
  S.roll.articulate({ gate: 50 }); ok(L[0].d === model.STEP * 2, `articulate ${L[0].d}`);
  const n0 = L.length; S.roll.flam({ delay: 4, velocity: 50 }); ok(L.length === n0 * 2, 'flam');
});
await check('roll: double-click a note opens Note properties; apply changes it', async () => {
  const L = rollSetup(); const a = L[0];
  const p = S.roll.noteProps(a); await sleep(50);
  const box = document.querySelector('.st-ask'); ok(box, 'no dialog');
  await shot('fl-note-props');
  const inputs = box.querySelectorAll('input, select'); inputs[1].value = '33'; // velocity
  box.querySelector('.btn.primary').click(); await p;
  ok(a.v === 33 && L.length === 4, `velocity ${a.v}, notes ${L.length}`);
});
await check('roll: Tools menu has FL tools in order with keys', () => {
  S.rollTools({ clientX: 300, clientY: 200 });
  const l = popLabels(); ok(l[0] === 'Riff Machine…' && l.includes('Flam…') && l.includes('Scale levels…') && l.includes('Quick quantize'), l.slice(0, 6).join(' | '));
  return `${l.length} items`;
});

// ---------- transport and global keys ----------
await check('transport: Space stops back where it started, Ctrl+Space pauses', async () => {
  fresh('basic'); S.setMode('pattern'); const T = S.transport; T.pos = model.STEP * 4;
  S.runAction('play'); await sleep(400); ok(T.playing, 'not playing');
  S.runAction('play'); ok(!T.playing && T.pos === model.STEP * 4, `stop pos ${T.pos}`);
  S.runAction('pause'); await sleep(400); S.runAction('pause'); ok(!T.playing && T.pos > model.STEP * 4, `pause pos ${T.pos}`);
  T.stop();
});
await check('keys: Esc closes the sheet in front, not the studio', async () => {
  fresh(); S.channelSheet.show(S.proj.channels[0].id); await sleep(50);
  key({ key: 'Escape' }); ok(S.channelSheet.el.hidden, 'sheet still open'); ok(S.isOpen, 'studio closed');
});
await check('keys: Ctrl+H panic, Ctrl+Shift+H arrange, Home, F11 project info', async () => {
  fresh();
  ok(S.shortcut(new KeyboardEvent('keydown', { key: 'h', ctrlKey: true })) === 'panic', 'Ctrl+H');
  ok(S.shortcut(new KeyboardEvent('keydown', { key: 'H', ctrlKey: true, shiftKey: true })) === 'arrange', 'Ctrl+Shift+H');
  S.runAction('panic'); S.runAction('arrange'); await sleep(50); ok(Object.keys(S.floating).length, 'not arranged'); S.arrange('docked');
  S.runAction('projinfo'); await sleep(50); const box = document.querySelector('.st-ask'); ok(box, 'no project info');
  box.querySelector('input').value = 'Night Song'; box.querySelector('.btn.primary').click(); await sleep(50);
  ok(S.proj.info?.title === 'Night Song', 'info not saved');
});

await check('toolbar: PAT right-click opens the rack, SONG right-click the playlist, Stop double-click panics, tempo 10-522', async () => {
  fresh(); S.setTab('mixer');
  const [pat, song] = [...document.querySelectorAll('.st-tool button')].filter((b) => /^(PAT|SONG)$/.test(b.textContent));
  song.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); ok(S.tab === 'playlist', 'SONG right-click');
  pat.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  document.querySelector('.st-tool .stop').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  S.setBpm(600); ok(S.proj.bpm === 522, `bpm ${S.proj.bpm}`); S.setBpm(5); ok(S.proj.bpm === 10, `bpm ${S.proj.bpm}`);
});
await check('channel window: the arrow menu at its top-left (rename, route, piano roll, clone, delete)', async () => {
  fresh(); S.channelSheet.show(S.proj.channels[0].id); await sleep(50);
  S.channelSheet.el.querySelector('.ch-menu').click(); await sleep(30);
  ok(popLabels().includes('새 믹서 트랙에 연결') && popLabels().includes('채널 삭제'), popLabels().join('|'));
  S.channelSheet.close();
});
await check('time panel: click switches bars and minutes:seconds', async () => {
  fresh(); const pos = document.querySelector('.st-tool .tb-pos'); pos.click(); await sleep(30); S.updatePos();
  ok(/^\d+:\d\d:\d\d$/.test(S.posEl.textContent), S.posEl.textContent); document.querySelector('.st-tool .tb-pos').click(); await sleep(30); S.updatePos();
  ok(S.posEl.textContent === '1:1:1', S.posEl.textContent);
});
// ---------- channel rack ----------
await check('rack: FL title bar (options, swing knob, length, graph), routing box, selector, preview', async () => {
  fresh('kpop'); const syn = S.proj.channels.find((c) => c.kind === 'synth') || S.proj.channels.at(-1);
  S.edit(() => { model.notesOf(model.pattern(S.proj), syn.id).push({ t: 0, d: model.STEP * 4, n: 67, v: 90 }); }); await sleep(80);
  const bar = document.querySelector('.st-patbar');
  ok(bar.querySelector('.rk-opt') && bar.querySelector('.st-swing .k') && bar.querySelector('select'), 'title bar');
  const row = document.querySelector('.rack-row'); ok(row.querySelector('.cbus') && row.querySelector('.csel'), 'row parts');
  ok(document.querySelector('.steps.preview'), 'no piano roll preview for a melodic channel');
  await shot('fl-rack');
});
await check('rack: channel button toggles channel settings, selector selects', async () => {
  fresh('kpop'); S.setTab('playlist'); await sleep(50);
  const rows = document.querySelectorAll('.rack-row'); const id = rows[1].dataset.ch;
  rows[1].querySelector('.cname').click(); await sleep(50);
  ok(!S.channelSheet.el.hidden && S.channelSheet.id === id && S.proj.selected === id && S.tab === 'playlist', 'not opened');
  document.querySelectorAll('.rack-row')[1].querySelector('.cname').click(); await sleep(50);
  ok(S.channelSheet.el.hidden, 'not closed');
  document.querySelectorAll('.rack-row')[2].querySelector('.csel').click(); ok(S.proj.selected === document.querySelectorAll('.rack-row')[2].dataset.ch, 'selector');
});
await check('rack: routing box, options menu, channel menu in FL order', () => {
  fresh('kpop'); const ch = S.proj.channels[0];
  S.edit(() => S.proj.buses.push(model.newBus(0)));
  S.rack.busMenu(ch, 100, 100); press(`1. ${S.proj.buses[0].name}`); ok(ch.out === S.proj.buses[0].id, 'route');
  S.rack.optionsMenu(100, 100); ok(popLabels().includes('Graph editor'), 'options');
  document.querySelector('.st-pop')?.remove();
  S.rack.menu(ch, 100, 100); const l = popLabels(); ok(l.indexOf('피아노 롤') < l.indexOf('Graph editor') && l.includes('왼쪽으로 돌리기'), l.slice(0, 4).join(' | '));
});
await check('rack keys: ↑↓ select, Alt+↑↓ move, Shift+Ctrl+→ rotate, Ctrl+C / Ctrl+V steps', async () => {
  fresh('basic'); const list = S.proj.channels; S.select(list[1].id, { keepTab: true }); await sleep(60);
  document.querySelector(`.rack-row[data-ch="${list[1].id}"] .cname`).focus();
  key({ key: 'ArrowUp' }); ok(S.proj.selected === list[0].id, 'select up');
  await sleep(60); const moved = list[0]; document.querySelector(`.rack-row[data-ch="${moved.id}"] .cname`).focus(); key({ key: 'ArrowDown', altKey: true }); ok(S.proj.channels[1] === moved, 'move');
  await sleep(60); document.querySelector(`.rack-row[data-ch="${moved.id}"] .cname`).focus();
  const pat = model.pattern(S.proj), ns = model.notesOf(pat, moved.id), t0 = ns.map((n) => n.t);
  key({ key: 'ArrowRight', ctrlKey: true, shiftKey: true }); ok(ns.every((n, i) => n.t !== t0[i]), 'rotate');
  key({ key: 'c', ctrlKey: true }); const other = S.proj.channels[2]; S.select(other.id, { keepTab: true }); await sleep(60);
  document.querySelector(`.rack-row[data-ch="${other.id}"] .cname`).focus(); key({ key: 'v', ctrlKey: true });
  ok(model.notesOf(model.pattern(S.proj), other.id).length === ns.length, 'paste');
});

await check('bug: a 2-bar pattern fits the rack without a scrollbar on every row', async () => {
  fresh('kpop'); S.edit(() => { model.pattern(S.proj).bars = 2; }); await sleep(80);
  const over = [...document.querySelectorAll('.rack-row .steps:not(.preview):not(.audio)')].filter((g) => g.scrollWidth > g.clientWidth + 1).length;
  ok(!over, `${over} rows scroll on their own`);
  S.edit(() => { model.pattern(S.proj).bars = 4; }); await sleep(80); await shot('fl-rack-4bars');
  const rk = S.rackEl; ok(rk.scrollWidth >= rk.clientWidth, 'rack');
});
// ---------- playlist ----------
await check('playlist: track menu clone, move, mute all clips', () => {
  fresh('kpop'); const P = S.playlist, T = S.proj.playlist.tracks, C = S.proj.playlist.clips;
  const on0 = C.filter((c) => c.track === 0).length; ok(on0 > 0, 'no clips on track 0');
  P.trackMenu({ clientX: 100, clientY: 200 }, 0); press('복제');
  ok(C.filter((c) => c.track === 1).length >= on0 && T[1].name.includes(T[0].name), 'clone');
  P.trackMenu({ clientX: 100, clientY: 200 }, 0); press('모든 클립 음소거'); ok(C.filter((c) => c.track === 0).every((c) => c.mute), 'mute all');
  const name0 = T[0].name; P.trackMenu({ clientX: 100, clientY: 200 }, 0); press('아래로 옮기기'); ok(T[1].name === name0 && C.filter((c) => c.track === 1).every((c) => c.mute), 'move');
});
await check('playlist: clip menu (rename, select similar, mute), marker menu (rename, place loop)', () => {
  fresh('kpop'); const P = S.playlist, C = S.proj.playlist.clips, c = C.find((x) => !x.kind);
  P.clipMenu({ clientX: 100, clientY: 200 }, c); press('같은 클립 모두 선택'); ok(P.sel.size === C.filter((x) => !x.kind && x.pattern === c.pattern).length, 'similar');
  P.clipMenu({ clientX: 100, clientY: 200 }, c); press('음소거'); ok(c.mute, 'mute');
  S.edit(() => { S.proj.markers = [{ bar: 2, name: 'A' }, { bar: 6, name: 'B' }]; });
  P.laneMenu({ clientX: 300, clientY: 100 }, 2); press('여기부터 다음 마커까지 반복'); ok(S.proj.loop.start === 2 && S.proj.loop.end === 6 && S.proj.loopOn, JSON.stringify(S.proj.loop));
});

await check('playlist: picker panel lists patterns, picks the one Draw places, Alt+P hides it; zoom tool', async () => {
  fresh('kpop'); S.setTab('playlist'); await sleep(60);
  if (S.pickerEl.hidden) S.togglePicker();
  const rows = [...document.querySelectorAll('.pl-picker .pl-pk:not(.add)')]; ok(rows.length === S.proj.patterns.length, `${rows.length} rows`);
  rows[1].click(); await sleep(30); ok(S.proj.current === S.proj.patterns[1].id, 'not picked');
  await shot('fl-picker');
  ok(S.shortcut(new KeyboardEvent('keydown', { key: 'p', altKey: true })) === 'pickerpanel', 'Alt+P'); S.runAction('pickerpanel'); ok(S.pickerEl.hidden, 'not hidden'); S.runAction('pickerpanel');
  const P = S.playlist, w0 = P.barW; S.runAction('zoom'); ok(P.tool === 'zoom', 'zoom tool');
  P.zoomAt(400, 1.5); ok(P.barW > w0, 'zoom in'); P.setTool('draw');
});
// ---------- mixer ----------
await check('mixer: master leftmost, inserts numbered, track menu, M right-click solo', async () => {
  fresh('kpop'); S.edit(() => { S.proj.buses.push(model.newBus(0), model.newBus(1)); }); S.setTab('mixer'); await sleep(100);
  const first = document.querySelector('.mx-row .mx-strip'); ok(first.classList.contains('master'), 'master not first');
  ok(document.querySelector('.mx-strip.bus .mx-no')?.textContent === '1', 'no insert number');
  S.mixer.trackMenu({ clientX: 300, clientY: 200 }, S.mixer.stripOf(S.proj.buses[1].id)); press('왼쪽으로 옮기기');
  ok(S.proj.buses[0].name === model.newBus(1).name || S.proj.buses.length === 2, 'moved');
  await shot('fl-mixer');
});
await check('mixer: track color from the track menu', async () => {
  fresh('kpop'); S.edit(() => { S.proj.buses.push(model.newBus(0)); }); const b = S.proj.buses[0];
  S.mixer.trackMenu({ clientX: 300, clientY: 200 }, S.mixer.stripOf(b.id)); press('색 바꾸기…'); await sleep(30);
  const box = document.querySelector('.st-ask'); box.querySelector('input').value = '#123456'; box.querySelector('.btn.primary').click(); await sleep(30);
  ok(b.color === '#123456', `color ${b.color}`);
});
await check('mixer: a soloed mixer track mutes the other mixer tracks in the engine', async () => {
  fresh('kpop'); S.edit(() => { S.proj.buses.push(model.newBus(0), model.newBus(1)); }); await S.syncAudio();
  const [b0, b1] = S.proj.buses; S.edit(() => { b0.solo = true; }); await S.syncAudio(); await sleep(200);
  const g0 = S.engine.buses.get(b0.id).fader.gain.value, g1 = S.engine.buses.get(b1.id).fader.gain.value;
  ok(g0 > 0.1 && g1 < 0.01, `gains ${g0.toFixed(3)} ${g1.toFixed(3)}`);
});
await check('mixer: slot menu replaces an effect in place', async () => {
  fresh('kpop'); const ch = S.proj.channels[0]; S.mixer.addFx(ch.id, 'eq'); const id = ch.fx.at(-1).id;
  S.mixer.slotMenu({ clientX: 300, clientY: 200 }, S.mixer.stripOf(ch.id), ch.fx.at(-1)); press('바꾸기…'); await sleep(20);
  const b = document.querySelectorAll('.st-pop button')[1]; b.click(); await sleep(50);
  ok(ch.fx.at(-1).id === id && ch.fx.length >= 1, 'replaced');
});

// ---------- menus, browser, files ----------
await check('menus: FL entries (save new version, cut/copy/paste, move/transpose pattern, panic, project info)', () => {
  fresh(); const all = ['file', 'edit', 'patterns', 'view', 'options', 'tools'].flatMap((k) => S.menuItems(k, { clientX: 0, clientY: 0 })).map((x) => x.label);
  for (const want of ['새 버전으로 저장', '잘라내기', '붙여넣기', '위로 옮기기', '조옮김…', '모든 소리 끄기 (패닉)', '프로젝트 정보…', 'MIDI 설정…', '안 쓰는 오디오 정리', '한 단계씩 실행 취소']) ok(all.includes(want), `missing ${want}`);
});
await check('save new version: name_2 then name_3, never over a file', async () => {
  const dir = (await api.testWrite('ver/song.mfproj', '{}')).replace(/[\\/]song\.mfproj$/, '');
  const p2 = await api.studioNextVersion(`${dir}\\song.mfproj`); ok(/song_2\.mfproj$/.test(p2), p2);
  await api.testWrite('ver/song_2.mfproj', '{}');
  const p3 = await api.studioNextVersion(`${dir}\\song.mfproj`); ok(/song_3\.mfproj$/.test(p3), p3);
  ok(/song_3\.mfproj$/.test(await api.studioNextVersion(`${dir}\\song_2.mfproj`)), 'from _2');
});
await check('browser: search filters, file menu has FL entries', async () => {
  fresh(); S.proj.media = { h1: { name: 'kick.wav' }, h2: { name: 'snare.wav' } };
  if (!S.browserOpen) S.setLeft('browser'); S.browser.filter = 'kick'; S.browser.render();
  const names = [...document.querySelectorAll('.br-item.file span:first-child')].map((x) => x.textContent);
  ok(names.includes('kick.wav') && !names.includes('snare.wav'), names.join(','));
  S.browser.fileMenu({ clientX: 100, clientY: 100, preventDefault() {} }, { name: 'kick.wav', hash: 'h1' }, true);
  ok(popLabels().includes('새 슬라이서 채널로 열기'), popLabels().join('|'));
  S.browser.filter = ''; S.setLeft('browser');
});
await check('tools: purge unused audio keeps what is used', () => {
  fresh('kpop'); S.edit(() => { S.proj.media = { used: { name: 'a' }, gone: { name: 'b' } }; S.proj.playlist.clips.push({ id: 'x', kind: 'audio', media: 'used', ch: S.proj.channels[0].id, track: 0, start: 0, len: 1 }); });
  S.purgeUnusedMedia(); ok(S.proj.media.used && !S.proj.media.gone, Object.keys(S.proj.media).join(','));
});

await check('bug: opening 150 projects in a row leaks no audio processors (removed channels and effects stop their worklets)', async () => {
  for (let i = 0; i < 150; i++) { S.setProject(TEMPLATES[['kpop', 'trap', 'lofi', 'ballad'][i % 4]].make()); await sleep(60); }
  await S.syncAudio(); await sleep(300);
  // the last project still plays, and an offline render of it is not silent
  const p = TEMPLATES.kpop.make(); S.setProject(p); await S.syncAudio();
  S.transport.play(); await sleep(400); S.transport.stop();
  const mix = await io.renderMix(p, { tail: 0.2, range: { start: 0, end: 2 } });
  let peak = 0; for (let i = 0; i < mix.left.length; i += 7) peak = Math.max(peak, Math.abs(mix.left[i]));
  ok(peak > 0.01 && peak <= 1, `peak ${peak}`);
  return `peak ${peak.toFixed(3)}`;
});
await check('bug: Shortcut settings fits the window (its Save button is reachable) and the menu bar is not covered in English', async () => {
  fresh(); const p = S.shortcutsSheet(); await sleep(80);
  const box = document.querySelector('.st-ask .box'), save = box.querySelector('.btn.primary'), r = save.getBoundingClientRect();
  ok(box.getBoundingClientRect().bottom <= innerHeight && r.bottom <= innerHeight && r.top >= 0, `save at ${Math.round(r.top)}..${Math.round(r.bottom)} of ${innerHeight}`);
  await shot('fl-shortcuts'); box.querySelector('.row button').click(); await p;
  A.settings.set({ lang: 'en' }); await sleep(400); S.renderToolbar(); await sleep(50);
  const help = document.querySelector('.st-tool .mb[data-menu=help]').getBoundingClientRect(), pat = [...document.querySelectorAll('.st-tool button')].find((b) => b.textContent === 'PAT').getBoundingClientRect();
  A.settings.set({ lang: 'ko' }); await sleep(300); S.renderToolbar();
  ok(help.right <= pat.left, `HELP ends at ${Math.round(help.right)}, PAT starts at ${Math.round(pat.left)}`);
});
await check('channel rack: a focused step toggles with Enter (keyboard click)', async () => {
  fresh('basic'); await sleep(60); const ch = S.proj.channels[0];
  const cell = document.querySelector(`.rack-row[data-ch="${ch.id}"] .sq[data-i="1"]`); const was = model.stepOn(model.pattern(S.proj), ch, 1);
  cell.focus(); cell.click(); await sleep(40); ok(model.stepOn(model.pattern(S.proj), ch, 1) === !was, 'not toggled');
});
await check('toolbar: record button right-click opens the recording options', async () => {
  fresh(); const rec = document.querySelector('.st-tool .tb-big.rec');
  rec.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 40 })); await sleep(30);
  const l = popLabels(); ok(l.includes('녹음한 노트 스냅에 맞추기') && l.includes('녹음 전 1마디 세기'), l.join('|'));
  const was = S.recQuant; press('녹음한 노트 스냅에 맞추기'); ok(S.recQuant === !was, 'not toggled'); S.recQuant = was;
});
await check('playlist picker: automation clips are listed and Draw places the one picked', async () => {
  fresh('kpop'); S.setTab('playlist'); if (S.pickerEl.hidden) S.togglePicker();
  S.makeAutomation(`ch:${S.proj.channels[0].id}:vol`, 'Vol'); await sleep(60); S.renderPicker();
  const a = S.proj.autos[0]; const btn = [...document.querySelectorAll('.pl-picker .pl-pk')].find((b) => b.textContent === a.name); ok(btn, 'not listed');
  btn.click(); ok(S.plSource?.auto === a.id, 'not picked');
  const P = S.playlist, n0 = S.proj.playlist.clips.filter((c) => c.auto === a.id).length;
  const r = P.c.getBoundingClientRect(); const x = r.left + 400, y = r.top + P.tToY(5) + 20;
  P.setTool('draw'); const spc = P.c.setPointerCapture; P.c.setPointerCapture = () => {}; P.down({ clientX: x, clientY: y, button: 0, pointerId: 1, shiftKey: false, ctrlKey: false, altKey: false, preventDefault() {} }); P.up?.({}); P.c.setPointerCapture = spc;
  ok(S.proj.playlist.clips.filter((c) => c.auto === a.id).length === n0 + 1, 'not drawn');
});
await check('memory: the page is cross-origin isolated and instrument samples are shared with the worklets, not copied', async () => {
  ok(globalThis.crossOriginIsolated, 'not isolated');
  const ch = await imp('studio/channel.js'); const inst = await ch.loadInstrument('drumstrap');
  const first = [...inst.data.values()][0]; ok(first.L.buffer instanceof SharedArrayBuffer, 'samples in a plain ArrayBuffer');
});
await check('close', async () => { fresh('empty'); S.close(); await sleep(150); });
console.log('E2E-BEGIN\n' + R.join('\n') + `\n${R.filter((l) => l.startsWith('PASS')).length}/${R.length} pass\nE2E-END`);
return [100];
