// The piano window's side of tools/e2e/firstrun-run.mjs: 처음 설정 as a sheet, the menu entry, the
// account center link, every step in dark and white, contrast, English, and the upload default.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let errs = [];
window.addEventListener('error', (e) => errs.push(e.message + ' @' + (e.filename || '').split('/').pop() + ':' + e.lineno));
window.addEventListener('unhandledrejection', (e) => errs.push('rej ' + String(e.reason?.stack || e.reason).split('\n')[0]));
const A = window.__melofi;
const api = window.melofi;
for (let i = 0; i < 150 && !A?.engine?.inst; i++) await sleep(100);
const imp = (p) => import(new URL(p, location.href).href);
const R = [];
async function check(name, fn) {
  errs = [];
  try { const n = await fn(); await sleep(40); R.push(`${errs.length ? 'FAIL' : 'PASS'} ${name}${n ? ` (${n})` : ''}${errs.length ? ' :: ' + [...new Set(errs)].slice(0, 3).join(' | ') : ''}`); } catch (e) { R.push(`FAIL ${name} :: ${String(e?.stack || e).split('\n').slice(0, 2).join(' ')}`); }
}
const until = async (fn, ms = 8000, what = 'condition') => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error(`timed out: ${what}`); await sleep(60); } };
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const byText = (sel, text, r = document) => $$(sel, r).find((e) => e.textContent.includes(text));
const shot = async (n) => { await sleep(250); await api.testShot('piano', n); };
window.confirm = () => true;
navigator.mediaDevices.getUserMedia = async () => { throw Object.assign(new Error('no device'), { name: 'NotFoundError' }); };

function contrast(root) {
  const rgba = (s) => { const m = /^rgba?\(([^)]+)\)$/.exec(s); if (!m) return null; const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p[3] ?? 1]; };
  const over = (a, b) => [0, 1, 2].map((i) => a[i] * a[3] + b[i] * (1 - a[3])).concat(1);
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const behind = (el) => { const L = []; for (let e = el; e && e.nodeType === 1; e = e.parentElement) { const cs = getComputedStyle(e); if (+cs.opacity < 1) return null; const bg = rgba(cs.backgroundColor) || [0, 0, 0, 0]; if (bg[3] > 0) L.push(bg); if (bg[3] >= 1) break; } let c = [0, 0, 0, 1]; for (let i = L.length - 1; i >= 0; i--) c = over(L[i], c); return c; };
  const bad = []; let n = 0;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let tn = w.nextNode(); tn; tn = w.nextNode()) {
    const s = tn.nodeValue.trim(), el = tn.parentElement;
    if (!s || !el?.getClientRects().length || el.closest('[hidden], :disabled')) continue;
    const fg = rgba(getComputedStyle(el).color), bg = behind(el);
    if (!fg || !bg) continue;
    n++;
    const r = ratio(over(fg, bg), bg);
    if (r < 4.5) bad.push(`${r.toFixed(2)} ${el.tagName.toLowerCase()}.${el.className} "${s.slice(0, 24)}"`);
  }
  return { n, bad };
}

const fr = await imp('js/firstrun.js');
const ws = await imp('js/workshop-ui.js');
const acc = await imp('js/accounts-ui.js');
const host = { where: 'piano', app: A };

await check('파일 menu has 처음 설정… with the steps left', () => {
  const it = A.ui.menuItems('file').find((x) => x.label === '처음 설정…');
  if (!it) throw new Error('no entry');
  if (!/6단계 남음/.test(it.hint)) throw new Error(`hint "${it.hint}"`);
});
await check('account center links to 처음 설정', async () => {
  const sh = acc.openAccountCenter({ openSetup: () => ws.openSetupFor(host) });
  await until(() => byText('.mfa-foot button', '처음 설정 다시 열기', sh.wrap));
  byText('.mfa-foot button', '처음 설정 다시 열기', sh.wrap).click();
  await until(() => $('.fr-sheet .fr'));
  if (sh.wrap.isConnected) throw new Error('account center left open');
});
const scans = {};
const STEP_TITLES = ['언어·테마·키 배치', '마이크와 MIDI', '디스코드 로그인', 'GitHub 연결', '창작마당 프로필', '추가 설치', '마무리'];
for (const th of ['dark', 'white']) {
  await check(`every step as a sheet, ${th}`, async () => {
    A.settings.set({ studioLook: { ...(A.settings.get('studioLook') || {}), theme: th } });
    for (const [i, title] of STEP_TITLES.entries()) {
      byText('.fr-rail li button', title).click();
      await until(() => $('.fr-rail button.on')?.textContent.includes(title) && $('.fr').dataset.theme === th);
      if (title === '마이크와 MIDI') { byText('.fr-row .fr-b', '마이크 확인').click(); await until(() => $('.fr-row .res').textContent.includes('마이크가 없어요')); }
      if (title === '추가 설치') await until(() => !byText('.fr-row .fr-b', '확인하는 중'), 20000, 'extras status');
      await sleep(120);
      scans[`${th} ${title}`] = contrast($('.fr'));
      await shot(`fr-5-${i + 1}-${th}`);
    }
  });
}
await check('text contrast 4.5:1 in both themes', () => {
  const bad = Object.entries(scans).flatMap(([k, v]) => v.bad.map((b) => `${k}: ${b}`));
  if (bad.length) throw new Error(bad.slice(0, 12).join('\n'));
  return `${Object.values(scans).reduce((a, v) => a + v.n, 0)} texts`;
});
await check('a sheet keeps the piano keys quiet and Esc closes it (progress kept)', async () => {
  const before = A.held.size;
  $('.fr-main').dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA', key: 'a', bubbles: true }));
  await sleep(30);
  if (A.held.size !== before) throw new Error('note played');
  $('.fr').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await until(() => !$('.fr-sheet'));
  const saved = A.settings.get('firstRun');
  if (!saved || saved.at !== 'finish') throw new Error(JSON.stringify(saved));
});
await check('English: no Korean left in the setup', async () => {
  const i18n = await imp('i18n/i18n.js');
  await i18n.setLangPref('en'); await sleep(150);
  const h = await fr.openFirstRun(fr.appHost(A), { step: 'profile' });
  const all = [];
  for (const title of ['Language, theme, keys', 'Microphone and MIDI', 'Discord sign-in', 'Connect GitHub', 'Workshop profile', 'Extras', 'Finish']) {
    const b = byText('.fr-rail li button', title);
    if (!b) throw new Error(`rail: ${title} missing; got ${$$('.fr-rail li').map((x) => x.textContent).join('|')}`);
    b.click(); await sleep(250);
    const copy = $('.fr').cloneNode(true);
    copy.querySelectorAll('.fr-av, .fr-seg button[data-v=ko]').forEach((e) => e.remove()); // avatar initials; 한국어 is named in its own language
    all.push(copy.textContent.replace(/Alice Kim|alice|Carol|MeloFi \| Support KR|앨리스\S*|밤마다 피아노 칩니다/g, ''));
  }
  await shot('fr-5-profile-en');
  h.close();
  await i18n.setLangPref('ko'); await sleep(100);
  const ko = all.join(' ').match(/[가-힣]+/g);
  if (ko) throw new Error('Korean left: ' + [...new Set(ko)].join(' '));
});
await check('the upload form starts from the default chosen in setup', async () => {
  A.settings.set({ workshopVisibility: 'public' });
  ws.openWorkshop(host, 'upload');
  await until(() => $('input[name=mfw-vis]'), 8000);
  if (!$('input[name=mfw-vis][value=public]').checked) throw new Error('not public');
  ws.workshopPage().close();
  A.settings.set({ workshopVisibility: 'link' });
});

console.log('E2E-BEGIN\n' + R.join('\n') + '\nE2E-END');
return [];
