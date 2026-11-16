// 창작마당 and the account center in the piano window and the studio (dark and white). Run through
// tools/e2e/workshop-run.mjs, which starts the stand-ins and the Helper index and seeds two works.
// Screenshots: <shots>/ws-*.png and acct-*.png
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let errs = [];
window.addEventListener('error', (e) => errs.push(e.message + ' @' + (e.filename || '').split('/').pop() + ':' + e.lineno));
window.addEventListener('unhandledrejection', (e) => errs.push('rej ' + String(e.reason?.stack || e.reason).split('\n').slice(0, 2).join(' ')));
const origErr = console.error; console.error = (...a) => { errs.push('console.error ' + a.map(String).join(' ').slice(0, 200)); origErr(...a); };
const A = window.__melofi;
const api = window.melofi;
for (let i = 0; i < 150 && !A?.engine?.inst; i++) await sleep(100);
const imp = (p) => import(new URL(p, location.href).href);
const R = [];
async function check(name, fn) {
  errs = [];
  const t0 = performance.now();
  try {
    const note = await fn();
    await sleep(40);
    R.push(`${errs.length ? 'FAIL' : 'PASS'} ${name}${note ? ` (${note})` : ''}${errs.length ? ' :: ' + [...new Set(errs)].slice(0, 3).join(' | ') : ''} [${Math.round(performance.now() - t0)}ms]`);
  } catch (e) {
    R.push(`FAIL ${name} :: ${String(e?.stack || e).split('\n').slice(0, 3).join(' ')}${errs.length ? ' | ' + errs.slice(0, 3).join(' | ') : ''}`);
  }
}
const until = async (fn, ms = 8000, what = 'condition') => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await sleep(60); } };
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const byText = (sel, text, root = document) => $$(sel, root).find((e) => e.textContent.trim() === text || e.textContent.includes(text));
const click = (sel, text, root) => { const e = text ? byText(sel, text, root) : $(sel, root); if (!e) throw new Error(`no ${sel} "${text || ''}"`); e.click(); return e; };
const shot = async (name) => { await sleep(250); return api.testShot('piano', name); }; // (a frame to paint first)
const typeInto = (inp, v) => { inp.value = v; inp.dispatchEvent(new Event('input', { bubbles: true })); };
window.confirm = () => true; window.alert = () => {}; window.prompt = () => null;

const seed = JSON.parse(new TextDecoder().decode(await api.testRead('seed.json')));
A.settings.set({ recDir: seed.rec });
const ws = await imp('js/workshop-ui.js');
const acc = await imp('js/accounts-ui.js');
const theme = await imp('studio/ui/theme.js');
const S = A.studio;
const piano = { where: 'piano', app: A };
const page = () => ws.workshopPage();
const W = (op, p) => api.workshop(op, p);
// the page cannot reach the stand-in directly (CSP); the app's own calls read the same gists
const manifestOf = async (id) => { const r = await W('manifest', { login: 'alice', id }); return r.ok ? r.data : null; };
const visibilityOf = async (id) => (await W('mine')).data?.find((x) => x.id === id)?.visibility || null;

// ---- contrast of visible text inside a root (the theme-e2e rule: 4.5:1, large text 3:1) ----
function contrast(root, min = 4.5) {
  const rgba = (s) => { const m = /^rgba?\(([^)]+)\)$/.exec(s); if (m) { const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p[3] ?? 1]; } const c = /^color\(srgb ([^)]+)\)$/.exec(s); if (c) { const p = c[1].split(/[\s/]+/).filter(Boolean).map(Number); return [p[0] * 255, p[1] * 255, p[2] * 255, p[3] ?? 1]; } return null; };
  const over = (a, b) => [0, 1, 2].map((i) => a[i] * a[3] + b[i] * (1 - a[3])).concat(1);
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const behind = (el) => { const layers = []; for (let e = el; e && e.nodeType === 1; e = e.parentElement) { const cs = getComputedStyle(e); if (+cs.opacity < 1) return null; const bg = rgba(cs.backgroundColor) || [0, 0, 0, 0]; if (bg[3] > 0) layers.push(bg); if (bg[3] >= 1) break; } let c = [0, 0, 0, 1]; for (let i = layers.length - 1; i >= 0; i--) c = over(layers[i], c); return c; };
  const bad = []; let n = 0;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let tn = w.nextNode(); tn; tn = w.nextNode()) {
    const s = tn.nodeValue.trim(), el = tn.parentElement;
    if (!s || !el || !el.getClientRects().length || el.closest('[hidden], :disabled, [aria-disabled=true], .mfw-art')) continue;
    const cs = getComputedStyle(el), fg = rgba(cs.color), bg = behind(el);
    if (!fg || !bg) continue;
    n++;
    const r = ratio(over(fg, bg), bg), large = parseFloat(cs.fontSize) >= 18.6;
    if (r < (large ? 3 : min)) bad.push(`${r.toFixed(2)} ${el.tagName.toLowerCase()}.${String(el.className).trim()} "${s.slice(0, 30)}"`);
  }
  return { n, bad: [...new Set(bad)] };
}

// ================= account center (piano window) =================
await check('piano 파일 menu has 창작마당 and 계정', () => {
  const labels = A.ui.menuItems('file').map((x) => x.label || x.group);
  for (const want of ['창작마당', '창작마당 둘러보기…', '연주 올리기…', '계정…']) if (!labels.includes(want)) throw new Error(`missing ${want}: ${labels.join(' | ')}`);
});
let sheet;
await check('account center: profile, two accounts, storage, activity', async () => {
  sheet = acc.openAccountCenter({ openWorkshop: (w) => ws.openWorkshop(piano, w) });
  await until(() => byText('.mfa-st', '프로젝트 0개', sheet.wrap) && byText('.mfa-st', '공개 0개', sheet.wrap), 8000, 'storage numbers');
  const prof = $('.mfa-prof', sheet.wrap).textContent;
  if (!prof.includes('Alice Kim') || !prof.includes('GitHub @alice')) throw new Error(prof);
  const rows = $$('.mfa-row', sheet.wrap);
  if (rows.length !== 5) throw new Error(`${rows.length} rows`);
  if (!rows[0].textContent.includes('Alice Kim') || !rows[0].textContent.includes('연결 해제')) throw new Error(rows[0].textContent);
  if (!rows[1].textContent.includes('연결 안 됨')) throw new Error(rows[1].textContent);
  return rows.map((r) => r.querySelector('.nm').textContent).join(' / ');
});
await check('account center: every action button the same size, one right edge', async () => {
  const bs = $$('.mfa-row .mfa-act .mfa-b', sheet.wrap).map((b) => b.getBoundingClientRect());
  if (bs.length !== 5) throw new Error(`${bs.length} buttons`);
  const w = new Set(bs.map((r) => Math.round(r.width))), right = new Set(bs.map((r) => Math.round(r.right))), h = new Set(bs.map((r) => Math.round(r.height)));
  const labels = $$('.mfa-row > .nm', sheet.wrap).map((e) => Math.round(e.getBoundingClientRect().left));
  if (w.size !== 1 || right.size !== 1 || h.size !== 1 || new Set(labels).size !== 1) throw new Error(`widths ${[...w]} rights ${[...right]} heights ${[...h]} label lefts ${[...new Set(labels)]}`);
  await until(() => byText('.mfa-st', '프로젝트 0개', sheet.wrap), 5000, 'numbers still shown');
  await shot('acct-piano-dark');
  return `${[...w][0]} x ${[...h][0]} px`;
});
await check('keys typed while a sheet is open do not play the piano', async () => {
  const before = A.held.size;
  document.body.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA', key: 'a', bubbles: true }));
  await sleep(30);
  document.body.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyA', key: 'a', bubbles: true }));
  if (A.held.size !== before) throw new Error('a note was played');
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true }));
  await sleep(30);
  if (sheet.wrap.isConnected) throw new Error('Esc did not close the sheet');
});

// ================= 창작마당: browse =================
await check('browse: seeded works, newest first, counts and rail', async () => {
  ws.openWorkshop(piano, 'browse');
  await until(() => $$('.mfw-row').length === 2, 8000, 'two rows');
  const titles = $$('.mfw-row .t b').map((e) => e.textContent);
  if (titles[0] !== 'Late Night Lofi Loop') throw new Error(titles.join(' | '));
  if (!$('.mfw-bar .count').textContent.includes('2')) throw new Error($('.mfw-bar .count').textContent);
  if (!byText('.mfw-rail button', '#piano')) throw new Error('no tag in rail');
  await until(() => $('.mfw-row .mfw-art img'), 5000, 'cover image');
  await shot('ws-browse-piano-dark');
});
await check('browse: tag, genre, search, kind and sort filters', async () => {
  click('.mfw-rail button', '#rain'); await until(() => $$('.mfw-row').length === 1 && $('.mfw-chip'));
  click('.mfw-chip .rm'); await until(() => $$('.mfw-row').length === 2);
  click('.mfw-seg button', 'Studio 프로젝트'); await until(() => $$('.mfw-row').length === 1 && $('.mfw-row .t b').textContent.includes('Lofi'));
  click('.mfw-seg button', '전체'); await until(() => $$('.mfw-row').length === 2);
  const s = page().search; s.value = '에튀드'; s.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
  await until(() => $$('.mfw-row').length === 1);
  page().search.value = ''; click('.mfw-chip .rm'); await until(() => $$('.mfw-row').length === 2);
  const sel = $('.mfw-bar select'); sel.value = 'popular:week'; sel.dispatchEvent(new Event('change'));
  await until(() => $('.mfw-row .t b')?.textContent === '비 오는 날의 에튀드', 5000, 'liked work first');
  sel.value = 'new'; sel.dispatchEvent(new Event('change')); await until(() => $('.mfw-row .t b')?.textContent === 'Late Night Lofi Loop');
});
await check('play from the list: bottom player shows and plays', async () => {
  const row = $$('.mfw-row').find((r) => r.textContent.includes('에튀드'));
  row.querySelector('.pl').click();
  await until(() => !page().player.el.hidden && !page().player.audio.paused, 8000, 'playing');
  // the audio device can take a moment to start under load: wait for the clock, up to 4 s
  await until(() => page().player.audio.currentTime > 0, 4000, 'time did not move');
  page().player.audio.pause();
  return `${page().player.audio.currentTime.toFixed(2)} s`;
});

// ================= 창작마당: one work =================
let item;
await check('item: hero, waveform, rail, info table, comments', async () => {
  $$('.mfw-row').find((r) => r.textContent.includes('에튀드')).click();
  await until(() => $('.mfw-hero h1')?.textContent === '비 오는 날의 에튀드');
  item = page().cur;
  await until(() => $$('.mfw-c').length === 1, 5000, 'comment');
  const info = $('.mfw-info').textContent;
  for (const w of ['bob', '피아노 솔로', '0:03']) if (!info.includes(w)) throw new Error(info);
  if ($$('.mfw-files > div').length !== 2) throw new Error('files');
  const side = $('.mfw-side').getBoundingClientRect().width;
  if (Math.abs(side - 260) > 1) throw new Error(`rail ${side}`);
  await sleep(300);
  // the waveform has bars of different heights once decoded
  const c = $('.mfw-wave canvas'), g = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let lit = 0; for (let i = 3; i < g.length; i += 4) if (g[i]) lit++;
  if (lit < 200) throw new Error('waveform empty');
  await shot('ws-item-piano-dark');
});
await check('like, comment, delete my comment', async () => {
  click('.mfw-like .mfw-b'); await until(() => item.liked && item.likes === 2, 5000, 'liked');
  const ta = $('.mfw-cform textarea'); ta.value = '페달 소리가 좋아요'; click('.mfw-cform .mfw-b');
  await until(() => $$('.mfw-c').length === 2);
  if (!$$('.mfw-c')[0].textContent.includes('alice') || !byText('.mfw-c .mfw-link', '지우기')) throw new Error($$('.mfw-c')[0].textContent);
  click('.mfw-c .mfw-link', '지우기'); await until(() => $$('.mfw-c').length === 1);
  click('.mfw-like .mfw-b'); await until(() => !item.liked && item.likes === 1);
});
await check('report: reasons dialog, sent once', async () => {
  click('.mfw-quiet .mfw-link', '신고');
  await until(() => $('.mfw-dlg'));
  await shot('ws-report-piano-dark');
  $$('.mfw-dlg input[type=radio]')[1].checked = true;
  click('.mfw-dlg .mfw-b.pri');
  await until(() => !$('.mfw-dlg') && byText('.mfw-quiet .mfw-link', '신고함'));
  const r = await W('item', { id: seed.w1 });
  if (!r.data.reported) throw new Error('not recorded');
});
await check('open a work in the studio (piano window hands it over)', async () => {
  // in the piano window the studio is a separate window; here the in-page studio runs the same command
  await S.open(); await sleep(300);
  S.command({ workshop: { login: 'bob', id: seed.w2, name: 'project.melofi.json', role: 'project', title: 'Late Night Lofi Loop', owner: 'bob' } });
  await until(() => S.proj.name === 'Late Night Lofi Loop' && S.proj.channels.length > 3, 8000, 'project opened');
  S.command({ workshop: { login: 'bob', id: seed.w1, name: 'song.mid.b64', role: 'midi', title: 'Etude MIDI', owner: 'bob' } });
  await until(() => S.proj.name === 'Etude MIDI', 8000, 'midi opened');
  S.close(); await sleep(150);
  return `${S.proj.channels.length} channel(s) from the MIDI`;
});

// ================= 올리기 from the piano =================
let mineId;
await check('upload from the piano: recording + MIDI, tags, cover, public', async () => {
  ws.openWorkshop(piano, 'upload');
  await until(() => $$('.mfw-src label').length === 2, 8000, 'recordings listed');
  $$('.mfw-src label input')[0].click(); await sleep(50);
  $$('.mfw-src label input')[1].click();
  await until(() => $$('.mfw-picked .mfw-chip').length === 2, 5000, 'both picked');
  $$('.mfw-f input.mfw-in')[0].value = '첫 업로드 테스트';
  $('.mfw-f textarea').value = '헤드리스 테스트에서 올렸어요.';
  const tag = $('.mfw-tagin input');
  for (const x of ['Piano', '#test', 'piano']) { tag.value = x; tag.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); }
  if ($$('.mfw-tagin .mfw-chip').length !== 2) throw new Error('tags: ' + $('.mfw-tagin').textContent);
  $('input[name=mfw-vis][value=public]').checked = true;
  await shot('ws-upload-piano-dark');
  click('.mfw-go .mfw-b.pri');
  await until(() => $('.mfw-go .mfw-note.err'), 2000, 'needs the agreement');
  $('.mfw-chk input').checked = true;
  click('.mfw-go .mfw-b.pri');
  await until(() => $('.mfw-hero h1')?.textContent === '첫 업로드 테스트', 15000, 'item page after upload');
  mineId = page().cur.id;
  const man = await manifestOf(mineId);
  if ((await visibilityOf(mineId)) !== 'public' || man.tags.join() !== 'piano,test' || man.files.map((f) => f.role).join() !== 'audio,midi' || man.files[0].type !== 'audio/mpeg') throw new Error(JSON.stringify(man));
  if (!(man.length > 3.5)) throw new Error('length ' + man.length);
  return `${man.files[0].size} byte MP3 from the WAV`;
});
await check('my works: table, edit title and cover, listing follows', async () => {
  page().go('mine');
  await until(() => $$('.mfw-tbl tbody tr').length === 1);
  if (!$('.mfw-tbl tbody tr').textContent.includes('창작마당 공개')) throw new Error($('.mfw-tbl tbody tr').textContent);
  await shot('ws-mine-piano-dark');
  click('.mfw-tbl .mfw-b', '고치기');
  await until(() => $('.mfw-up h3')?.textContent === '작품 고치기');
  await until(() => $$('.mfw-f input.mfw-in')[0]?.value === '첫 업로드 테스트');
  $$('.mfw-f input.mfw-in')[0].value = '첫 업로드 (고침)';
  click('.mfw-go .mfw-b.pri');
  await until(() => $('.mfw-hero h1')?.textContent === '첫 업로드 (고침)', 10000);
  const l = await W('list', { q: '고침' });
  if (l.data.total !== 1) throw new Error('index not updated');
  const man = await manifestOf(mineId);
  if (man.files.map((f) => f.name).join() !== 'audio.mp3.b64,song.mid.b64' || man.title !== '첫 업로드 (고침)') throw new Error('files lost on edit: ' + JSON.stringify(man.files));
  if (!(await W('file', { login: 'alice', id: mineId, name: 'song.mid.b64' })).ok) throw new Error('MIDI not readable after the edit');
});
let linkId;
await check('link-only upload stays out of the list and opens by link', async () => {
  page().go('upload');
  await until(() => $$('.mfw-src label').length === 2);
  $$('.mfw-src label input')[1].click();
  await until(() => $$('.mfw-picked .mfw-chip').length === 1);
  $$('.mfw-f input.mfw-in')[0].value = '링크로만 공유';
  $('.mfw-chk input').checked = true;
  click('.mfw-go .mfw-b.pri');
  await until(() => $('.mfw-hero h1')?.textContent === '링크로만 공유', 15000);
  linkId = page().cur.id;
  if (!byText('.mfw-badge', '링크 공유')) throw new Error('no badge');
  if ((await visibilityOf(linkId)) !== 'link') throw new Error('gist is public');
  if ((await W('list', { q: '링크로만' })).data.total !== 0) throw new Error('listed');
  page().openByLink();
  const inp = $('.mfw-dlg input'); inp.value = `https://gist.github.com/alice/${linkId}`;
  click('.mfw-dlg .mfw-b.pri');
  await until(() => !$('.mfw-dlg') && $('.mfw-hero h1')?.textContent === '링크로만 공유');
  if ($('.mfw-like .mfw-b').disabled !== true) throw new Error('likes on a link-only work');
});

// ================= the studio: dark and white =================
await check('studio: upload the open project (project + MIDI)', async () => {
  await S.open(); await sleep(300);
  S.setTheme('dark');
  const { TEMPLATES } = await imp('studio/templates.js');
  const model = await imp('studio/model.js');
  const tpl = Object.values(TEMPLATES)[0];
  S.setProject(model.migrate(typeof tpl === 'function' ? tpl() : (tpl.make ? tpl.make() : JSON.parse(JSON.stringify(tpl)))));
  S.proj.name = 'Studio 테스트 곡';
  ws.openWorkshop({ where: 'studio', app: A }, 'upload');
  await until(() => $$('.mfw-src label').length === 3);
  const boxes = $$('.mfw-src label input');
  if (!boxes[0].checked || !boxes[1].checked || boxes[2].checked) throw new Error('defaults');
  boxes[1].click(); boxes[2].click(); // no audio render in the test; MIDI on
  if ($$('.mfw-f input.mfw-in')[0].value !== 'Studio 테스트 곡') throw new Error('title from the project');
  $('input[name=mfw-vis][value=public]').checked = true;
  $('.mfw-chk input').checked = true;
  await shot('ws-upload-studio-dark');
  click('.mfw-go .mfw-b.pri');
  await until(() => $('.mfw-hero h1')?.textContent === 'Studio 테스트 곡', 15000);
  const man = await manifestOf(page().cur.id);
  if (man.app !== 'studio' || man.files.map((f) => f.role).join() !== 'project,midi') throw new Error(JSON.stringify(man.files));
});
const scans = {};
for (const th of ['dark', 'white']) {
  await check(`studio ${th}: browse, item, mine, upload, account screenshots`, async () => {
    S.setTheme(th); await sleep(120);
    page().go('browse'); await until(() => $$('.mfw-row').length === 4); await sleep(250);
    await shot(`ws-browse-studio-${th}`); scans[`${th} browse`] = contrast(page().el);
    $$('.mfw-row').find((r) => r.textContent.includes('에튀드')).click();
    await until(() => $$('.mfw-c').length === 1); await sleep(300);
    await shot(`ws-item-studio-${th}`); scans[`${th} item`] = contrast(page().el);
    page().go('mine'); await until(() => $$('.mfw-tbl tbody tr').length === 3);
    await shot(`ws-mine-studio-${th}`); scans[`${th} mine`] = contrast(page().el);
    page().go('upload'); await until(() => $$('.mfw-src label').length === 3);
    await shot(`ws-upload-studio-${th}`); scans[`${th} upload`] = contrast(page().el);
    const sh = acc.openAccountCenter({});
    await until(() => byText('.mfa-st', '공개 2개', sh.wrap), 8000, 'works count');
    const card = $('.sheet-card', sh.wrap).getBoundingClientRect();
    if (!sh.wrap.contains(document.elementFromPoint(card.x + card.width / 2, card.y + 30))) throw new Error('account center is under 창작마당');
    await shot(`acct-studio-${th}`); scans[`${th} account`] = contrast(sh.wrap);
    sh.close();
  });
}
await check('white theme: text contrast in 창작마당 and the account center', () => {
  const bad = Object.entries(scans).filter(([k]) => k.startsWith('white')).flatMap(([k, v]) => v.bad.map((b) => `${k}: ${b}`));
  const n = Object.values(scans).reduce((a, v) => a + v.n, 0);
  if (bad.length) throw new Error(`${bad.length} low:\n` + bad.slice(0, 30).join('\n'));
  const dark = Object.entries(scans).filter(([k]) => k.startsWith('dark')).flatMap(([, v]) => v.bad);
  return `${n} texts; dark below 4.5: ${dark.length}${dark.length ? ' · ' + dark.slice(0, 4).join(' | ') : ''}`;
});
await check('delete a work: gist and listing gone', async () => {
  S.setTheme('dark');
  const r = await W('remove', { id: mineId });
  if (!r.ok) throw new Error(r.message);
  if (await manifestOf(mineId)) throw new Error('gist still there');
  if ((await W('list', { q: '고침' })).data.total !== 0) throw new Error('still listed');
});
await check('forget my 창작마당 activity', async () => {
  await W('like', { id: seed.w1, on: true });
  const r = await W('forget');
  if (!r.ok || r.data.removed < 2) throw new Error(JSON.stringify(r));
  const it = await W('item', { id: seed.w1 });
  if (it.data.liked || it.data.reported) throw new Error('still there');
});
await check('Esc goes back from a work, then closes 창작마당', async () => {
  page().go('item', (await W('item', { id: seed.w1 })).data);
  await until(() => $('.mfw-hero'));
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true }));
  await until(() => page().view !== 'item');
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true }));
  await until(() => page().el.hidden);
  S.close();
});
await check('signed out: account center and 내 작품 explain what to do', async () => {
  await api.account('logout', {});
  const sh = acc.openAccountCenter({});
  try { await until(() => byText('.mfa-prof b', '로그인하지 않음', sh.wrap)); } catch { throw new Error('account center: ' + sh.wrap.textContent.slice(0, 300) + ' state ' + JSON.stringify(await api.account('state'))); }
  if ($$('.mfa-row .mfa-b.pri', sh.wrap).length !== 2) throw new Error('two 연결 buttons');
  await shot('acct-piano-signed-out');
  sh.close();
  ws.openWorkshop(piano, 'mine');
  await until(() => byText('.mfw-msg b', 'GitHub를 연결해'));
  await until(() => !$('.mfw-msg') || true);
  page().go('browse'); await until(() => $$('.mfw-row').length === 2); // (forget-me took alice's listings off)
  page().close();
});

await check('English: workshop and account center have no Korean UI text', async () => {
  const i18n = await imp('i18n/i18n.js');
  await i18n.setLangPref('en'); await sleep(200);
  ws.openWorkshop(piano, 'browse');
  await until(() => $$('.mfw-row').length === 2 && byText('.mfw-tabs button', 'Browse'), 8000, 'English browse');
  const ui = [...$$('.mfw-head, .mfw-bar, .mfw-lh, .mfw-rail h4, .mfw-rail button:first-of-type')].map((e) => e.textContent).join(' ');
  const sh = acc.openAccountCenter({});
  await until(() => byText('.mfa-sec h4', 'Connected accounts', sh.wrap) && byText('.mfa-prof b', 'Not signed in', sh.wrap), 8000, 'English account'); // (signed out by now)
  await shot('acct-piano-en');
  const all = ui + ' ' + sh.wrap.textContent.replace(/Alice Kim|alice/g, '');
  sh.close(); page().close();
  await i18n.setLangPref('ko'); await sleep(100);
  const ko = all.match(/[가-힣]+/g);
  if (ko) throw new Error('Korean left: ' + [...new Set(ko)].join(' '));
});

console.log('E2E-BEGIN\n' + R.join('\n') + '\nE2E-END');
return [];
