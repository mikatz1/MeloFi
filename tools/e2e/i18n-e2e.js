// English / Korean UI check (docs/i18n.md). Switches the app to English, opens every window, menu,
// sheet and dialog it can reach and fails on visible text holding Hangul (proper names and user
// content allowed), then switches back to Korean and checks the Korean is back.
//   MELOFI_SHOT=<out> MELOFI_SCRIPT=tools/e2e/i18n-e2e.js MELOFI_USERDATA=<tmp dir> npx electron .
// Screenshots of the main screens in both languages go to <out> (en-*.png, ko-*.png).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let errs = [];
window.addEventListener('error', (e) => errs.push(e.message + ' @' + (e.filename || '').split('/').pop() + ':' + e.lineno));
window.addEventListener('unhandledrejection', (e) => errs.push('rej ' + String(e.reason?.stack || e.reason).split('\n').slice(0, 2).join(' ')));
const A = window.__melofi;
const api = window.melofi;
for (let i = 0; i < 150 && !A?.engine?.inst; i++) await sleep(100);
const I = window.__i18n;
const R = [];
const imp = (p) => import(new URL(p, location.href).href);

// dialogs never block the run, and what they would say is checked too
const said = [];
window.confirm = (m) => { said.push(String(m)); return false; };
window.alert = (m) => { said.push(String(m)); };
window.prompt = (m) => { said.push(String(m)); return null; };

// ---- the scan: visible text and the hover / placeholder texts ----
// allowed: language names, the user's own Korean (none in a fresh profile), voice/lyric data
const ALLOW = [/^한국어$/, /사랑해 너를 사랑해/];
// a real function (the page's CSP forbids eval); the other windows get its source
function scanFn(allowSrc) {
  const HANGUL = /[\uac00-\ud7a3\u3131-\u318e]/;
  const ALLOW = allowSrc.map((x) => new RegExp(x));
  const out = [];
  const shown = (el) => { if (!el || !el.isConnected) return false; if (el.closest('[hidden], [data-i18n-skip], template, script, style, textarea, input, select:not(:focus) option:not(:checked)')) return false; const r = el.getClientRects(); if (!r.length) return false; const cs = getComputedStyle(el); return cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const add = (s, where) => { s = String(s).trim().replace(/\s+/g, ' '); if (!s || !HANGUL.test(s) || ALLOW.some((re) => re.test(s))) return; out.push(where + ': ' + s.slice(0, 120)); };
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) if (HANGUL.test(n.nodeValue) && shown(n.parentElement)) add(n.nodeValue, (n.parentElement.id ? '#' + n.parentElement.id : n.parentElement.className || n.parentElement.tagName).toString().slice(0, 40));
  for (const el of document.body.querySelectorAll('[title], [placeholder], [aria-label]')) {
    if (!shown(el)) continue;
    for (const a of ['title', 'placeholder', 'aria-label']) { const v = el.getAttribute(a); if (v && HANGUL.test(v)) add(v, '[' + a + ']'); }
  }
  for (const o of document.querySelectorAll('select')) if (shown(o)) for (const op of o.options) add(op.textContent, 'option');
  if (HANGUL.test(document.title)) add(document.title, 'title');
  return [...new Set(out)];
}
const ALLOW_SRC = ALLOW.map((re) => re.source);
const SCAN = `(${scanFn.toString()})(${JSON.stringify(ALLOW_SRC)})`;
const scanHere = () => scanFn(ALLOW_SRC);
const found = new Map(); // text -> where it was seen first
function note(where, list) { for (const s of list) if (!found.has(s)) found.set(s, where); return list.length; }

async function check(name, fn) {
  errs = [];
  const t0 = performance.now();
  try {
    const n = await fn();
    await sleep(40);
    const bad = typeof n === 'number' ? n : 0;
    R.push(`${errs.length || bad ? 'FAIL' : 'PASS'} ${name}${bad ? ` (${bad} Korean text${bad > 1 ? 's' : ''})` : ''}${errs.length ? ' :: ' + [...new Set(errs)].slice(0, 3).join(' | ') : ''} [${Math.round(performance.now() - t0)}ms]`);
  } catch (e) {
    R.push(`FAIL ${name} :: THROW ${String(e?.stack || e).split('\n').slice(0, 3).join(' ')}${errs.length ? ' | ' + errs.slice(0, 3).join(' | ') : ''}`);
  }
}
const scan = (where) => note(where, scanHere());
// menu items as data: every label and hint, submenus too
const HANGUL = /[가-힣ㄱ-ㆎ]/;
function menuText(items, where, out = []) {
  for (const it of items || []) {
    for (const k of ['label', 'hint', 'group']) if (typeof it[k] === 'string' && HANGUL.test(it[k]) && !ALLOW.some((re) => re.test(it[k]))) out.push(`${where}: ${it[k]}`);
    if (Array.isArray(it.sub)) menuText(it.sub, where, out);
  }
  return out;
}
const closePops = () => { document.querySelectorAll('.st-pop, .popup, .st-ask').forEach((x) => x.remove()); A.ui.openMenu?.(null); };
const shot = (name, which = 'piano') => api.testShot?.(which, name);
async function setLang(l) {
  A.settings.set({ lang: l });
  for (let i = 0; i < 50 && I.lang() !== l; i++) await sleep(50);
  await sleep(250);
}

const { TEMPLATES } = await imp('studio/templates.js');
const S = A.studio;
A.settings.set({ studioTourSeen: true });

// what the Korean screens show before any switch (English that belongs there: FL tool names, drum names)
const visibleTexts = () => { const out = new Set(); const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); for (let nd = w.nextNode(); nd; nd = w.nextNode()) { const s = nd.nodeValue.trim(); if (s && nd.parentElement?.getClientRects().length && !nd.parentElement.closest('[hidden]')) out.add(s); } return out; };
await S.open(); await sleep(400); S.setProject(TEMPLATES.basic.make()); await sleep(200);
const baseline = visibleTexts();
await S.close(); await sleep(200);

// ======================= English =======================
await check('switch to English', async () => { await setLang('en'); if (I.lang() !== 'en') throw new Error(`lang ${I.lang()}`); if (document.documentElement.lang !== 'en') throw new Error('html lang'); });

// ---------- piano ----------
await check('piano: main screen', async () => { A.ui.close(); await sleep(100); await shot('en-piano'); return scan('piano'); });
await check('piano: menus (every item and submenu)', async () => {
  let bad = 0;
  for (const n of ['file', 'score', 'compose', 'rec', 'sound', 'view', 'settings']) {
    bad += note(`menu ${n}`, menuText(A.ui.menuItems(n), `menu ${n}`));
    if (document.querySelector(`.menubar [data-menu="${n}"]`)) { A.ui.openMenu(n); await sleep(60); bad += scan(`menu ${n}`); }
  }
  A.ui.openMenu(null);
  return bad;
});
await check('piano: help, key mapping, mixer', async () => {
  let bad = 0;
  for (const k of ['help', 'keymap', 'mixer']) { A.ui.open(k); await sleep(120); bad += scan(k); if (k === 'help') await shot('en-help'); }
  A.ui.close();
  return bad;
});
await check('piano: settings, every tab', async () => {
  let bad = 0;
  const tabs = [...document.querySelectorAll('#settings [data-tab], #settings .tabs button')].map((b) => b.dataset.tab).filter(Boolean);
  for (const tab of tabs.length ? tabs : ['play', 'sound', 'look', 'rec', 'about']) {
    A.ui.tab = tab; A.ui.close(); A.ui.open('settings'); await sleep(150); bad += scan(`settings ${tab}`);
    if (tab === 'look') await shot('en-settings');
  }
  A.ui.close();
  return bad;
});
await check('piano: instrument downloads', async () => { A.store?.show(); await sleep(250); const n = scan('store'); await shot('en-store'); A.store?.close(); return n; });
await check('piano: problem report and update notice', async () => {
  const infra = await imp('js/appinfra.js');
  await infra.openReport(); await sleep(200);
  let n = scan('report');
  document.querySelector('.mf-rep')?.remove();
  for (const s of [{ phase: 'available', version: '9.9.9' }, { phase: 'downloading', percent: 40 }, { phase: 'ready', version: '9.9.9' }, { phase: 'error', version: '9.9.9', message: '받지 못했어요' }]) {
    infra.showUpdateState(s); await sleep(30); n += scan(`update ${s.phase}`);
  }
  document.querySelector('.mf-upd')?.remove();
  return n;
});

// ---------- studio ----------
await check('studio: open, every pane', async () => {
  await S.open(); await sleep(500);
  S.setProject(TEMPLATES.basic.make()); await sleep(200);
  let n = 0;
  for (const t of ['roll', 'playlist', 'mixer', 'live']) { S.setTab(t); await sleep(150); n += scan(`studio ${t}`); await shot(`en-studio-${t}`); }
  S.setTab('roll');
  S.setLeft('browser'); await sleep(200); n += scan('studio browser'); S.setLeft('browser'); await sleep(50);
  S.toggleKeys(); await sleep(100); n += scan('studio keys'); S.toggleKeys();
  return n;
});
await check('studio: toolbar menus (every item)', async () => {
  let n = 0;
  for (const b of document.querySelectorAll('.st-tool .tb-menubar .mb')) {
    const k = b.dataset.menu;
    const r = b.getBoundingClientRect();
    n += note(`studio menu ${k}`, menuText(S.menuItems(k, { clientX: r.left, clientY: r.bottom }), `studio menu ${k}`));
    S.openMenu(k, b); await sleep(60); n += scan(`studio menu ${k}`);
    if (k === 'options') await shot('en-studio-options');
    closePops(); await sleep(20);
  }
  return n;
});
await check('studio: every template (names, panes)', async () => {
  let n = 0;
  for (const k of Object.keys(TEMPLATES)) { S.setProject(TEMPLATES[k].make()); await sleep(80); n += scan(`template ${k}`); }
  S.setProject(TEMPLATES.basic.make()); await sleep(100);
  return n;
});
await check('studio: channel settings, every channel and tab', async () => {
  let n = 0;
  for (const p of [TEMPLATES.basic.make(), ...Object.values(TEMPLATES).slice(1, 4).map((x) => x.make())]) {
    S.setProject(p); await sleep(80);
    for (const ch of p.channels) {
      S.channelSheet.show(ch.id); await sleep(120); n += scan(`channel ${ch.kind}`);
      for (const tb of [...(S.channelSheet.el?.querySelectorAll('[data-tab], .tabs button') || [])]) { tb.click(); await sleep(60); n += scan(`channel ${ch.kind} tab`); }
      S.channelSheet.hide?.() ?? S.channelSheet.close?.();
    }
  }
  S.setProject(TEMPLATES.basic.make()); await sleep(80);
  return n;
});
await check('studio: sheets (AI, DAW, cloud, mastering, riff, templates, loops, history)', async () => {
  let n = 0;
  const step = async (name, open, close) => { try { await open(); } catch (e) { errs.push(`${name}: ${e.message}`); } await sleep(250); n += scan(name); if (name === 'ai') await shot('en-studio-ai'); if (name === 'mastering') await shot('en-studio-mastering'); try { await close?.(); } catch { /* */ } closePops(); await sleep(60); };
  await step('ai', () => S.aiSheet.show(), () => (S.aiSheet.hide?.() ?? S.aiSheet.close?.()));
  await step('daw', () => S.dawSheet.show(), () => (S.dawSheet.hide?.() ?? S.dawSheet.close?.()));
  for (const w of ['projects', 'shared', 'account']) await step(`cloud ${w}`, () => S.cloudSheet.show(w), () => (S.cloudSheet.hide?.() ?? S.cloudSheet.close?.()));
  await step('mastering', () => S.mastering.show(), () => (S.mastering.hide?.() ?? S.mastering.close?.()));
  await step('riff wizard', () => S.riffWizard.open(), () => (S.riffWizard.close?.() ?? S.riffWizard.hide?.()));
  await step('templates', () => S.newFromTemplate());
  await step('loop starter', () => S.loopStarter());
  await step('history', () => S.historySheet({ clientX: 200, clientY: 200 }));
  await step('tempo menu', () => S.tempoMenu({ clientX: 300, clientY: 60 }));
  await step('window menu', () => S.windowMenu({ clientX: 300, clientY: 60 }));
  await step('rack add menu', () => S.rack.addMenu(200, 200));
  await step('playlist track menu', () => S.playlist.trackMenu({ clientX: 300, clientY: 300 }, 0));
  await step('playlist lane menu', () => S.playlist.laneMenu({ clientX: 300, clientY: 300 }, 1));
  const clip = S.proj.playlist.clips[0];
  if (clip) await step('playlist clip menu', () => S.playlist.clipMenu({ clientX: 300, clientY: 300 }, clip));
  await step('roll tools', () => S.rollTools({ clientX: 300, clientY: 100 }));
  await step('automation targets', () => S.autoTargetMenu({ clientX: 300, clientY: 100 }));
  document.querySelectorAll('.st-float-win .x, .sheet:not([hidden]) .x').forEach((x) => x.click());
  return n;
});
await check('studio: tutorial, every lesson and step text', async () => {
  const { CHAPTERS } = await imp('studio/ui/lessons.js');
  let n = 0;
  for (const ch of CHAPTERS) {
    for (const s of [ch.name, ch.goal, ...ch.steps.flatMap((st) => [st.title, st.body, st.hint, st.tip])].filter(Boolean)) {
      const v = I.t(s);
      if (HANGUL.test(v)) n += note(`lesson ${ch.id}`, [`lesson ${ch.id}: ${v.slice(0, 80)}`]);
    }
  }
  S.tour.start(CHAPTERS[0].id); await sleep(400); n += scan('tour'); await shot('en-studio-tour');
  S.tour.stop?.() ?? S.tour.close?.() ?? S.tour.end?.();
  document.querySelectorAll('.tour, .st-tour, .tour-card').forEach((x) => x.remove());
  return n;
});
await check('studio: synth presets, effects and their parameters (as shown)', async () => {
  const { SYNTH_CATEGORIES } = await imp('studio/synth-presets.js').catch(() => ({}));
  const fx = await imp('studio/fx.js').catch(() => ({}));
  const out = [];
  const tr = (s, where) => { const v = I.t(s); if (HANGUL.test(v)) out.push(`${where}: ${v}`); };
  for (const [cat, list] of Object.entries(SYNTH_CATEGORIES || {})) { tr(cat, 'synth category'); for (const p of list) tr(typeof p === 'string' ? p : p.name, 'synth preset'); }
  for (const [k, f] of Object.entries(fx.FX_TYPES || {})) { tr(f.name, `fx ${k}`); if (f.hint) tr(f.hint, `fx ${k} hint`); for (const p of f.params || []) { tr(p.label, `fx ${k} param`); for (const c of p.choices || []) if (typeof c === 'string') tr(c, `fx ${k} choice`); } }
  return note('presets/effects', out);
});
await check('studio: confirm / alert texts seen so far', () => note('dialog', said.filter((s) => HANGUL.test(s)).map((s) => `dialog: ${s.slice(0, 100)}`)));

// ---------- the other windows ----------
const evalIn = async (which, code) => { for (let i = 0; i < 40; i++) { try { const r = await api.testEval(which, code); if (r != null) return r; } catch { /* not up yet */ } await sleep(150); } return null; };
const scanWin = async (which, label) => { const r = await evalIn(which, `(async () => { for (let i = 0; i < 40 && !window.__i18n; i++) await new Promise((r) => setTimeout(r, 100)); await new Promise((r) => setTimeout(r, 300)); return ${SCAN}; })()`); if (r == null) throw new Error(`${which} window did not answer`); return note(label, r); };
await check('instrument picker window', async () => { A.ui.pickInstrument(); await sleep(1200); const n = await scanWin('picker', 'picker'); await shot('en-picker', 'picker'); return n; });
await check('on-screen keys window', async () => { await api.openKeysWindow(); await sleep(1200); const n = await scanWin('keys', 'keys'); await shot('en-keys', 'keys'); return n; });
await check('start card: choice and account center', async () => {
  await api.startShow(); await sleep(2000);
  if (await api.testEval('splash', `document.querySelector('#choose')?.hidden`) !== false) throw new Error('start card did not reach the choice');
  let n = await scanWin('splash', 'start card');
  await shot('en-start', 'splash');
  await api.testEval('splash', `document.querySelector('#who')?.click()`); await sleep(500);
  n += await scanWin('splash', 'account center');
  await shot('en-start-account', 'splash');
  await api.testEval('splash', `document.querySelector('#back')?.click()`);
  return n;
});
await check('start card follows a switch made there', async () => {
  // the start card's own language select drives every window
  await api.testEval('splash', `(() => { const s = document.querySelector('#lang'); s.value = 'ko'; s.dispatchEvent(new Event('change')); })()`);
  for (let i = 0; i < 40 && I.lang() !== 'ko'; i++) await sleep(100);
  if (I.lang() !== 'ko') throw new Error('piano window did not follow the start card');
  await api.testEval('splash', `(() => { const s = document.querySelector('#lang'); s.value = 'en'; s.dispatchEvent(new Event('change')); })()`);
  for (let i = 0; i < 40 && I.lang() !== 'en'; i++) await sleep(100);
  if (I.lang() !== 'en') throw new Error('did not come back to English');
  await sleep(300);
});
await check('main process follows (window titles)', async () => {
  const title = await api.testEval('picker', 'document.title');
  if (HANGUL.test(title || '')) throw new Error(`picker title ${title}`);
});
await check('English entries asked for but missing (t() calls)', () => {
  const miss = [...(I.missing || [])].filter((s) => HANGUL.test(s));
  return note('missing entry', miss.map((s) => `missing entry: ${s.slice(0, 100)}`));
});

// ======================= back to Korean =======================
await check('switch back to Korean', async () => {
  await setLang('ko');
  await sleep(800); // the other windows hear it through main
  if (I.lang() !== 'ko' || document.documentElement.lang !== 'ko') throw new Error(`lang ${I.lang()}`);
  const fileBtn = document.querySelector('.menubar [data-menu="file"]')?.textContent;
  if (fileBtn !== '파일') throw new Error(`piano menu reads ${fileBtn}`);
  if (!S.el.querySelector('[data-tab="roll"]')?.textContent.includes('피아노 롤')) throw new Error('studio tab not Korean');
  const pk = await api.testEval('picker', `document.querySelector('.pk-title')?.textContent`);
  if (pk && pk !== '악기 선택') throw new Error(`picker title ${pk}`);
  const keys = await api.testEval('keys', `document.body.innerText`);
  if (keys && !HANGUL.test(keys)) throw new Error('keys window not Korean');
  const start = await api.testEval('splash', `document.querySelector('.q b')?.textContent`);
  if (start && start !== '어디로 갈까요?') throw new Error(`start card reads ${start}`);
  S.setProject(TEMPLATES.basic.make()); await sleep(200); // names made in English are the user's now
  // English left behind on screen: visible texts that are an English entry of the table
  const back = new Map([...I.table].filter(([k]) => !k.includes('::') && !k.includes('{')).map(([k, v]) => [v, k]));
  const left = [...visibleTexts()].filter((s) => s.length > 3 && back.has(s) && /[a-z]{3}/.test(s) && !baseline.has(s));
  if (left.length) throw new Error(`English left: ${[...new Set(left)].slice(0, 8).join(' | ')}`);
});
await check('Korean screens', async () => {
  S.setTab('playlist'); await sleep(150); await shot('ko-studio-playlist');
  S.setTab('roll'); await sleep(150); await shot('ko-studio-roll');
  S.openMenu('options', document.querySelector('.st-tool .mb[data-menu="options"]')); await sleep(80); await shot('ko-studio-options'); closePops();
  await S.close?.(); await sleep(300);
  A.ui.close(); await sleep(100); await shot('ko-piano');
  A.ui.tab = 'look'; A.ui.open('settings'); await sleep(150); await shot('ko-settings'); A.ui.close();
  await shot('ko-picker', 'picker'); await shot('ko-start', 'splash');
});
await check('particles: Korean picks the right form', async () => {
  const cases = [[I.t('{n}을(를) 불러오지 못했습니다.', { n: '피아노' }), '피아노를 불러오지 못했습니다.'], [I.t('{n}을(를) 불러오지 못했습니다.', { n: '드럼' }), '드럼을 불러오지 못했습니다.']];
  for (const [a, b] of cases) if (a !== b) throw new Error(`${a} != ${b}`);
});

const bad = [...found.entries()];
console.log('E2E-BEGIN\n' + R.join('\n') + `\n\nKorean text in the English UI: ${bad.length}\n` + bad.map(([s, w]) => `  ${s}`).join('\n') + '\nE2E-END');
return [];
