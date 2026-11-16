// The whole app, every control: a sweep that presses everything a user can press and fails on what
// goes wrong on the way (window errors, unhandled rejections, console.error), on buttons that do
// nothing, and on text that is cut off or pushed off screen.
//   MELOFI_SHOT=<out> MELOFI_SCRIPT=<wrapper> MELOFI_USERDATA=<tmp dir> npx electron .
// The wrapper is this file with `window.__args = { lang: 'ko'|'en', theme: 'dark'|'white' };` in front
// (tools/e2e/sweep-run.mjs writes it and runs both languages and both themes).
// Covers: every piano menu item and submenu item, the piano's sheets; in the studio every toolbar
// menu item, every right-click menu (channel button, + add, playlist clip / track / time lane, mixer
// strip / slot / send / input, knobs and faders, tempo, window icons), every visible button of the
// main panes and of each sheet a menu opens. Native dialogs and shell calls never reach the screen in
// a headless run (main.js answers them "cancelled"); the ones asked for are listed per item.
// Prints SWEEP-BEGIN … SWEEP-END; screenshots of every sheet and dialog opened go to <out>.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ARGS = { lang: 'ko', theme: 'dark', ...(window.__args || {}) };
const TAG = `${ARGS.lang}-${ARGS.theme}`;
let errs = [];
// errors between two checks count against the next one, and the first few print with their stack
let stray = 0;
window.addEventListener('error', (e) => { if (stray++ < 5) console.log('ERRSTACK ' + e.message + ' | ' + String(e.error?.stack || '').split('\n').slice(0, 6).join(' | ')); });
window.addEventListener('error', (e) => errs.push(e.message + ' @' + (e.filename || '').split('/').pop() + ':' + e.lineno + ' ' + String(e.error?.stack || '').split('\n').slice(1, 3).map((l) => l.trim().replace(/^at /, '').replace(/melofi:\/\/app\//, '')).join(' < ')));
window.addEventListener('unhandledrejection', (e) => errs.push('rej ' + String(e.reason?.stack || e.reason).split('\n').slice(0, 2).join(' ')));
const origErr = console.error; console.error = (...a) => { errs.push('console.error ' + a.map((x) => (x instanceof Error || x instanceof DOMException ? `${x.name}: ${x.message}` : String(x))).join(' ').slice(0, 200)); origErr(...a); };
const A = window.__melofi;
const api = window.melofi;
for (let i = 0; i < 150 && !A?.engine?.inst; i++) await sleep(100);
const R = [];
const log = (line) => { R.push(line); console.log('SW ' + line); }; // printed as it goes, so a stopped run keeps what it had
const imp = (p) => import(new URL(p, location.href).href);
window.confirm = () => false; window.alert = () => {}; window.prompt = () => null;
const tt = (s) => window.__i18n?.t?.(s) ?? s;

// ---------- helpers ----------
const visible = (el) => { if (!el?.isConnected) return false; if (el.closest('[hidden]')) return false; const r = el.getClientRects(); if (!r.length) return false; const cs = getComputedStyle(el); return cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity !== 0; };
const label = (el) => (el.getAttribute('aria-label') || el.title || el.textContent || el.className || el.tagName).toString().trim().replace(/\s+/g, ' ').slice(0, 50);
let shotN = 0;
const shot = async (name) => { if (shotN++ < 400) await api.testShot?.('piano', `${TAG}-${String(shotN).padStart(3, '0')}-${name}`.slice(0, 90)); };
// text that is cut off without an ellipsis, and boxes outside the window
function layoutProblems(root = document.body) {
  const out = [];
  for (const el of root.querySelectorAll('button, label, span, b, h2, h3, p, small, a, .grp, td, th, li, option')) {
    if (!visible(el) || !el.childNodes.length || el.closest('canvas, .st-pop.tall, [data-i18n-skip]')) continue;
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.nodeValue.trim());
    if (!own) continue;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    // off screen only when no scrolling box holds it (a long list inside a scroller is fine)
    const scroller = (() => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const c = getComputedStyle(p); if (/(auto|scroll)/.test(c.overflowY + c.overflowX) && (p.scrollHeight > p.clientHeight + 1 || p.scrollWidth > p.clientWidth + 1)) return p; } return null; })();
    if (!scroller && (r.right > innerWidth + 1 || r.bottom > innerHeight + 1 || r.left < -1)) { out.push(`off-screen: "${label(el)}"`); continue; }
    if (cs.textOverflow === 'ellipsis') continue;
    if ((cs.overflow !== 'visible' || cs.overflowX !== 'visible') && el.scrollWidth > el.clientWidth + 2) out.push(`clipped: "${label(el)}"`);
  }
  return [...new Set(out)];
}
async function settle(ms = 120) { await sleep(ms); }
// close everything a click may have opened (never the studio itself)
async function closeAll() {
  for (const a of document.querySelectorAll('.st-ask')) { a.querySelector('.row button')?.click(); a.remove(); }
  document.querySelectorAll('.st-pop').forEach((x) => x.remove());
  for (let round = 0; round < 4; round++) {
    let n = 0;
    // every visible close button (sheets, the workshop, the account center, plugin windows)
    for (const x of [...document.querySelectorAll('button.x, .mfw-x, [data-close]')].reverse()) if (visible(x)) { x.click(); n++; }
    // dialogs that close on Esc (first-run setup, problem report)
    for (const d of [...document.querySelectorAll('.fr, [role=dialog], .sheet:not([hidden])')].reverse()) if (visible(d)) { d.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); n++; }
    for (const b of document.querySelectorAll('[role=dialog] button, .sheet:not([hidden]) button')) if (visible(b) && /^(닫기|Close|취소|Cancel|나중에|Later|나중에 마치기|Finish later)$/.test(b.textContent.trim())) { b.click(); n++; }
    await sleep(40);
    if (!n) break;
  }
  for (const s of document.querySelectorAll('.sheet:not([hidden])')) if (s.id && document.querySelector('#' + s.id) === s) s.hidden = true;
  A.ui.openMenu?.(null); A.ui.close?.();
  S.tour?.active && S.tour.stop();
  if (S.transport?.playing) S.transport.stop();
  if (A.recorder?.recording) await A.action?.('record');
  await settle(60);
}
function opened() { return [...document.querySelectorAll('.sheet:not([hidden]), .ch-float:not([hidden]), .st-ask, .st-float-win, #sheet:not([hidden]), .sheet-card, [role=dialog]')].filter(visible); }

// memory of the app's processes: logged every 50 checks; a long sweep must not keep growing (a real long
// session would grow the same way). Limits: GPU process 2 GB, a renderer 4 GB (the instrument cache alone may
// hold 1.5 GB), and neither may end more than 1.5x what it was at the first reading.
const MEM = { n: 0, peak: {}, first: null, last: null };
async function memCheck(force = false) {
  if (!force && ++MEM.n % 50) return;
  const m = (await api.testMetrics?.()) || [];
  const by = {}; for (const x of m) by[x.type] = Math.max(by[x.type] || 0, x.mb);
  for (const [k, v] of Object.entries(by)) MEM.peak[k] = Math.max(MEM.peak[k] || 0, v);
  MEM.first ||= by; MEM.last = by;
  console.log(`SW MEM after ${MEM.n} checks: ${Object.entries(by).map(([k, v]) => `${k} ${v} MB`).join(', ')}`);
}
async function check(name, fn) {
  // (errs is not cleared here: what happened since the last check belongs to this one)
  await api.testDialogLog?.(true);
  const t0 = performance.now();
  let note = '', fail = '';
  try { note = (await fn()) || ''; } catch (e) { fail = 'THROW ' + String(e?.stack || e).split('\n').slice(0, 2).join(' '); }
  await sleep(60);
  const dl = (await api.testDialogLog?.(true)) || [];
  if (errs.length) fail += (fail ? ' | ' : '') + [...new Set(errs)].slice(0, 3).join(' | ');
  // a button may have switched the language (settings, first-run setup): back to the run's language
  if (window.__i18n?.lang?.() !== ARGS.lang) { A.settings.set({ lang: ARGS.lang }); for (let i = 0; i < 40 && window.__i18n.lang() !== ARGS.lang; i++) await sleep(50); }
  errs = [];
  await memCheck();
  log(`${fail ? 'FAIL' : 'PASS'} ${name}${note ? ` (${note})` : ''}${dl.length ? ` {native: ${dl.map((d) => d.kind).join(',')}}` : ''}${fail ? ' :: ' + fail : ''} [${Math.round(performance.now() - t0)}ms]`);
}
const DEAD = [], LAYOUT = new Map();
function noteLayout(where) { for (const p of layoutProblems()) if (!LAYOUT.has(p)) { LAYOUT.set(p, where); console.log(`SW LAYOUT ${p}  @ ${where}`); } }

// watch whether a click did anything: DOM changes, a project change, settings, transport, a native dialog
function watcher() {
  let n = 0;
  const mo = new MutationObserver((l) => { n += l.length; });
  mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
  const p0 = JSON.stringify(S.isOpen ? S.proj : null)?.length, s0 = JSON.stringify(A.settings.v || A.settings.get?.() || {}).length;
  return async () => {
    await sleep(150);
    mo.disconnect();
    const dl = (await api.testDialogLog?.(false)) || [];
    return n > 0 || dl.length > 0 || JSON.stringify(S.isOpen ? S.proj : null)?.length !== p0 || JSON.stringify(A.settings.v || A.settings.get?.() || {}).length !== s0;
  };
}

// crawl a popup menu: `open` makes a .st-pop; every enabled item is pressed once, on a fresh open,
// and a popup an item opens is crawled too (depth 2)
const SKIP_LABEL = /^(끝내기|Quit|종료)$|Alt\+F4|전체 화면|Full ?screen|녹화 시작|Start recording|영상 만들기|Render video|·\s*\d+fps/;
async function crawl(name, open, reset, depth = 0, skip = SKIP_LABEL) {
  await reset?.();
  try { await open(); } catch (e) { log(`FAIL ${name}: opening the menu threw ${String(e).slice(0, 120)}`); return 0; }
  await settle(80);
  const pop = document.querySelector('.st-pop');
  if (!pop) { log(`FAIL ${name}: menu did not open`); return 0; }
  noteLayout(name);
  const labels = [...pop.querySelectorAll('button')].map((b) => ({ text: (b.firstChild?.nodeValue || b.textContent).trim(), disabled: b.disabled }));
  pop.remove();
  let n = 0;
  for (const [i, it] of labels.entries()) {
    if (it.disabled || skip.test(it.text)) continue;
    n++;
    await check(`${name} > ${it.text}`, async () => {
      await reset?.();
      await open(); await settle(60);
      const b = document.querySelectorAll('.st-pop button')[i];
      if (!b) throw new Error('item gone on reopen');
      const was = opened().length;
      b.click(); await settle(250);
      const pop2 = document.querySelector('.st-pop');
      if (pop2 && depth < 1) { pop2.remove(); await crawl(`${name} > ${it.text}`, async () => { await open(); await settle(40); document.querySelectorAll('.st-pop button')[i]?.click(); await settle(80); }, reset, depth + 1); }
      if (opened().length > was || document.querySelector('.st-ask')) { noteLayout(`${name} > ${it.text}`); await shot(`${name}-${it.text}`.replace(/[^\w가-힣]+/g, '_')); }
      await closeAll();
    });
  }
  return n;
}

// press every visible button inside `root` once; report the ones that change nothing
async function pressAll(name, root, reset, skip = () => false) {
  const list = [...root.querySelectorAll('button, [role=button], .tb-ico, .mb')].filter((b) => visible(b) && !b.disabled && !b.closest('.st-pop'));
  const keys = list.map((b) => ({ path: pathOf(b), text: label(b) }));
  let n = 0;
  for (const k of keys) {
    if (skip(k.text)) continue;
    await reset?.();
    await settle(80); // the reset re-renders: press the new element, not the one it replaced
    const b = find(k.path);
    if (!b || !visible(b) || b.disabled) continue;
    n++;
    await check(`${name} button "${k.text}"`, async () => {
      const done = watcher();
      b.click();
      if (!(await done())) { DEAD.push(`${name}: "${k.text}"`); console.log(`SW DEAD ${name}: "${k.text}"`); }
      if (document.querySelector('.st-pop, .st-ask') || opened().length) noteLayout(`${name} "${k.text}"`);
      await closeAll();
      if (!S.isOpen && name.startsWith('studio')) { await S.open(); await settle(300); }
    });
  }
  return n;
}
function pathOf(el) { const p = []; for (let e = el; e && e !== document.body; e = e.parentElement) p.unshift([...e.parentElement.children].indexOf(e)); return p; }
function find(path) { let e = document.body; for (const i of path) { e = e?.children[i]; if (!e) return null; } return e; }
function ctx(el, x, y) {
  const r = el.getBoundingClientRect();
  const o = { bubbles: true, cancelable: true, button: 2, buttons: 2, clientX: x ?? r.left + r.width / 2, clientY: y ?? r.top + r.height / 2, pointerId: 1, pointerType: 'mouse' };
  el.dispatchEvent(new PointerEvent('pointerdown', o));
  el.dispatchEvent(new MouseEvent('mousedown', o));
  el.dispatchEvent(new PointerEvent('pointerup', o));
  el.dispatchEvent(new MouseEvent('contextmenu', o));
}

// ---------- language and theme ----------
A.settings.set({ lang: ARGS.lang, studioTourSeen: true });
for (let i = 0; i < 50 && window.__i18n?.lang?.() !== ARGS.lang; i++) await sleep(50);
await sleep(300);
const model = await imp('studio/model.js');
const { TEMPLATES } = await imp('studio/templates.js');
const S = A.studio;

// ---------- piano ---------- (skipped with __args.only = 'studio')
if (ARGS.only !== 'studio') {
const PIANO_MENUS = ['file', 'score', 'compose', 'rec', 'sound', 'view', 'settings'];
async function pianoReset() { if (S.isOpen) S.close(); await closeAll(); }
for (const m of PIANO_MENUS) {
  const walk = async (path, getItems) => {
    const items = getItems();
    for (const [i, it] of items.entries()) {
      if (it.sep || it.group || it.disabled) continue;
      const nm = `piano ${path} > ${it.label}`;
      if (it.sub) { await walk(`${path} > ${it.label}`, () => getItems()[i]?.sub || []); continue; }
      if (SKIP_LABEL.test(it.label) || SKIP_LABEL.test(it.key || '')) continue;
      await check(nm, async () => {
        await pianoReset();
        const fresh = getItems()[i];
        if (!fresh || typeof fresh.act !== 'function') throw new Error('item without action');
        const was = opened().length;
        await fresh.act(); await settle(400);
        if (opened().length > was ) { noteLayout(nm); await shot(nm.replace(/[^\w가-힣]+/g, '_')); }
        await closeAll();
      });
    }
  };
  await walk(m, () => A.ui.menuItems(m));
}
// piano settings sheet: every tab, every button
for (const tab of ['play', 'look', 'sound', 'rec']) {
  await check(`piano settings tab ${tab}`, async () => { A.ui.tab = tab; A.ui.open('settings'); await settle(200); noteLayout(`settings ${tab}`); await shot(`piano-settings-${tab}`); });
  const sheet = document.querySelector('#settings') || document.body;
  await pressAll(`piano settings ${tab}`, sheet, async () => { if (!visible(document.querySelector('#settings'))) { A.ui.tab = tab; A.ui.open('settings'); await settle(120); } },
    (t) => /녹화|record|업데이트|update|문제 신고|report|로그|logs|삭제|delete|초기화|reset|폴더|folder|끝내기|^English$|^한국어$|언어|language/i.test(t));
  await closeAll();
}
// the piano's own top bar and side buttons
await pressAll('piano top', document.querySelector('#bar') || document.body, pianoReset, (t) => /녹화|record|전체 화면|fullscreen|끝내기|quit|최소화|minimi|닫기|close|파일 열기|open/i.test(t));
}

// ---------- studio ----------
await S.open(); await settle(600);
if (ARGS.theme === 'white') { const o = S.menuItems('options', { clientX: 0, clientY: 0 }).find((it) => it.label === tt('화이트')); o?.act(); await settle(100); }
const fresh = async () => { await closeAll(); if (!S.isOpen) { await S.open(); await settle(300); } S.setProject(TEMPLATES.kpop.make()); S.dirty = false; S.setTab('playlist'); await settle(120); };
await fresh();
await shot('studio-start'); noteLayout('studio start');

// toolbar menus
for (const b of [...document.querySelectorAll('.st-tool .mb')]) {
  const k = b.dataset.menu;
  await crawl(`studio menu ${b.textContent}`, async () => { document.querySelector(`.st-tool .mb[data-menu=${k}]`).click(); }, fresh);
}
// right-click menus
const P = () => S.playlist;
await crawl('studio rack channel menu', async () => { S.setTab('playlist'); const c = S.proj.channels[0]; S.rack.menu(c, 200, 200); }, fresh);
await crawl('studio rack + menu', async () => { S.rack.addMenu(200, 200); }, fresh);
await crawl('studio playlist pattern clip menu', async () => { const c = S.proj.playlist.clips.find((q) => !q.kind); P().clipMenu({ clientX: 300, clientY: 300 }, c); }, fresh);
await crawl('studio playlist track menu', async () => { P().trackMenu({ clientX: 120, clientY: 300 }, 0); }, fresh);
await crawl('studio playlist time lane menu', async () => { P().laneMenu({ clientX: 300, clientY: 120 }, 2); }, fresh);
await crawl('studio tempo menu', async () => { S.tempoMenu({ clientX: 300, clientY: 40, preventDefault() {} }); }, fresh);
await crawl('studio window menu', async () => { S.windowMenu({ clientX: 600, clientY: 40, preventDefault() {} }); }, fresh);
await crawl('studio knob menu (master volume)', async () => { S.controlMenu({ clientX: 600, clientY: 40, preventDefault() {}, stopPropagation() {} }, 'master:vol', tt('마스터 볼륨')); }, fresh);
// mixer: strip, slot and send menus through real right-clicks
const mixerReset = async () => { await fresh(); S.setTab('mixer'); await settle(150); };
await mixerReset();
const mxTargets = [...document.querySelectorAll('.st-right [oncontextmenu], .st-right .mx-strip, .st-right .mx-slot, .st-right .mx-fx, .st-right label, .st-right .knob, .st-right .fader')].filter(visible);
let mxMenus = 0;
for (const sel of ['.mx-strip .mx-name, .mx-strip h4, .mx-strip b', '.mx-slot .nm, .mx-ins-slot .nm', '.mx-send, .mx-sends label', '.mx-arm, .arm']) {
  const el = [...document.querySelectorAll(sel)].find(visible);
  if (!el) continue;
  const path = pathOf(el);
  await crawl(`studio mixer right-click ${sel.split(',')[0]}`, async () => { const e = find(path); if (e) ctx(e); }, mixerReset);
  mxMenus++;
}
// a channel with effects, so the effect slots have entries
// every button of the main panes, in each tab
for (const tab of ['playlist', 'roll', 'mixer', 'live']) {
  const reset = async () => { await fresh(); S.setTab(tab); await settle(120); };
  await reset();
  noteLayout(`studio ${tab}`); await shot(`studio-tab-${tab}`);
  await pressAll(`studio ${tab}`, document.querySelector('.st-main') || document.body, reset, (t) => /녹음|record|^●$|닫기|close|Studio 닫기|피아노로|파일|열기|open/i.test(t));
}
await pressAll('studio toolbar', document.querySelector('.st-tool'), fresh, (t) => /녹음|record|^●$|닫기|close/i.test(t));

// sheets opened from menus: press every button inside each one
const SHEETS = [
  ['channel settings', () => S.channelSheet.show(S.proj.channels[0].id)],
  ['synth channel settings', () => { const ch = S.rack.addKind('synth'); S.channelSheet.show(ch.id); }],
  ['wave editor', async () => { const ch = S.rack.addKind('synth'); S.channelSheet.show(ch.id); await settle(150); S.waveEditor.open(ch.id); }],
  ['mastering', () => S.mastering.show()],
  ['riff machine', () => S.riffDialog?.()],
  ['ai', () => S.aiSheet.show()],
  ['daw', () => S.dawSheet.show()],
  ['cloud projects', () => S.cloudSheet.show('projects')],
];
for (const [nm, openIt] of SHEETS) {
  const reset = async () => { await fresh(); await openIt(); await settle(300); };
  await check(`studio sheet ${nm} opens`, async () => { await reset(); noteLayout(`sheet ${nm}`); await shot(`sheet-${nm}`.replace(/\W+/g, '_')); if (!opened().length) throw new Error('nothing opened'); });
  const root = opened()[0];
  if (root) await pressAll(`studio sheet ${nm}`, root, async () => { if (!opened().length) await reset(); }, (t) => /녹음|record|설치|install|다운로드|download|분석 시작|start|로그인|sign in|업로드|upload|내보내기|export|보내기|send/i.test(t));
  await closeAll();
}

await check('studio close', async () => { await closeAll(); S.setProject(TEMPLATES.empty.make()); S.dirty = false; S.close(); await settle(200); });

await memCheck(true);
const grew = ['GPU', 'Tab'].filter((k) => MEM.first?.[k] && MEM.last?.[k] > MEM.first[k] * 1.5);
if ((MEM.peak.GPU || 0) > 2048 || (MEM.peak.Tab || 0) > 4096 || grew.length) log(`FAIL memory: peaks ${JSON.stringify(MEM.peak)} MB, grew ${grew.join(', ') || '-'} (first ${JSON.stringify(MEM.first)}, last ${JSON.stringify(MEM.last)})`);
else log(`PASS memory stays bounded (peaks ${JSON.stringify(MEM.peak)} MB)`);
const pass = R.filter((l) => l.startsWith('PASS')).length;
console.log(`SWEEP-BEGIN ${TAG}\n` + R.length + ' checks' +
  `\n--- dead buttons (${DEAD.length})\n` + DEAD.join('\n') +
  `\n--- layout (${LAYOUT.size})\n` + [...LAYOUT].map(([p, w]) => `${p}  @ ${w}`).join('\n') +
  `\nSWEEP-SUMMARY ${TAG}: ${pass}/${R.length} pass, ${DEAD.length} dead, ${LAYOUT.size} layout\nSWEEP-END`);
return [100];
