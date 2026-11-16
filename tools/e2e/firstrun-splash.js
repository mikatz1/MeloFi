// The start card's side of tools/e2e/firstrun-run.mjs (one script, the run is in mode.json).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = window.melofi;
const R = [];
let errs = [];
window.addEventListener('error', (e) => errs.push(e.message));
window.addEventListener('unhandledrejection', (e) => errs.push('rej ' + String(e.reason?.message || e.reason)));
async function check(name, fn) {
  errs = [];
  try { const n = await fn(); await sleep(30); R.push(`${errs.length ? 'FAIL' : 'PASS'} ${name}${n ? ` (${n})` : ''}${errs.length ? ' :: ' + errs.slice(0, 3).join(' | ') : ''}`); } catch (e) { R.push(`FAIL ${name} :: ${String(e?.message || e).slice(0, 400)}`); }
}
const until = async (fn, ms = 10000, what = 'condition') => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error(`timed out: ${what}`); await sleep(60); } };
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const byText = (sel, text) => $$(sel).find((e) => e.textContent.includes(text));
const click = (sel, text) => { const e = text ? byText(sel, text) : $(sel); if (!e) throw new Error(`no ${sel} ${text || ''}`); e.click(); return e; };
const shot = async (n) => { await sleep(250); await api.testShot('splash', n); };
const step = () => $('.fr-rail button.on')?.textContent.trim();
const settings = () => api.loadSettings();
const { run } = JSON.parse(new TextDecoder().decode(await api.testRead('mode.json')));
// the mic is blocked in this run, the way Windows answers when desktop apps may not use it
navigator.mediaDevices.getUserMedia = async () => { throw Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' }); };

if (run === '1 new install') {
  await check('a new install opens 처음 설정 on the start card', async () => {
    await until(() => !$('#setup').hidden && $('.fr'), 30000, 'setup shown');
    if (!$('#choose').hidden) throw new Error('choice screen also shown');
    const rail = $$('.fr-rail li').map((l) => l.textContent.trim());
    if (rail.length !== 7) throw new Error(rail.join(' | '));
    if (innerWidth < 940) throw new Error(`card ${innerWidth}`);
    await shot('fr-1-basics-dark');
    return rail.join(' / ');
  });
  await check('basics: theme white is applied at once and saved; key layout saved', async () => {
    click('.fr-seg button', '밝게');
    await until(() => $('.fr').dataset.theme === 'white');
    $$('.fr-key')[1].click();
    await until(async () => (await settings())?.studioLook?.theme === 'white' && (await settings())?.keyPreset === 'zigzag');
    await shot('fr-1-basics-white');
    click('.fr-foot .pri');
    await until(() => step() === '마이크와 MIDI');
    const fr = (await settings()).firstRun;
    if (fr.marks.basics !== 'done' || fr.at !== 'devices') throw new Error(JSON.stringify(fr));
  });
  await check('devices: a blocked mic says where to turn it on and offers the Windows page', async () => {
    click('.fr-row .fr-b', '마이크 확인');
    await until(() => $('.fr-row .res.err'));
    if (!$('.fr-row .res.err').textContent.includes('데스크톱 앱')) throw new Error($('.fr-row .res.err').textContent);
    if (!byText('.fr-b', 'Windows 마이크 설정 열기') || byText('.fr-b', 'Windows 마이크 설정 열기').hidden) throw new Error('no settings button');
    click('.fr-row .fr-b', 'MIDI 장치 찾기');
    await until(() => $$('.fr-row .res')[1].textContent.length > 4);
    await shot('fr-1-devices-white');
    click('.fr-foot .fr-link', '건너뛰기');
    await until(() => step() === '디스코드 로그인');
    if ((await settings()).firstRun.marks.devices !== 'skipped') throw new Error('not marked skipped');
  });
  await check('discord: the signed-in account shows the server it joined', async () => {
    await until(() => byText('.fr-acct small', 'MeloFi | Support KR'));
    if ((await settings()).firstRun.marks.discord !== 'done') throw new Error('not marked done from the account');
    await shot('fr-1-discord-white');
    click('.fr-foot .pri');
    await until(() => step() === 'GitHub 연결');
  });
  await check('github: connected account, then the profile', async () => {
    await until(() => byText('.fr-acct small', '@alice'));
    await shot('fr-1-github-white');
    click('.fr-foot .pri');
    await until(() => step() === '창작마당 프로필');
  });
  await check('profile: nickname checked as you type, taken one gets ideas, upload picture, saved to the Helper', async () => {
    const nick = $('.fr-prof input.fr-in');
    nick.value = 'keys'; nick.dispatchEvent(new Event('input'));
    await until(() => $('#fr-nick-note').classList.contains('err') && $('#fr-nick-note').textContent.includes('이미'), 5000, 'taken');
    if ($$('#fr-nick-note .fr-link').length < 2) throw new Error('no suggestions');
    nick.value = '운영자'; nick.dispatchEvent(new Event('input'));
    await until(() => $('#fr-nick-note').textContent.includes('운영진'), 5000, 'reserved');
    nick.value = '앨리스_keys'; nick.dispatchEvent(new Event('input'));
    await until(() => $('#fr-nick-note').classList.contains('ok'), 5000, 'free');
    const bio = $$('.fr-prof input.fr-in')[1]; bio.value = '밤마다 피아노 칩니다'; bio.dispatchEvent(new Event('input'));
    // a picture, as if chosen in the file dialog
    const c = new OffscreenCanvas(200, 140); const g = c.getContext('2d'); g.fillStyle = '#3d6f80'; g.fillRect(0, 0, 200, 140); g.fillStyle = '#e0a440'; g.fillRect(70, 30, 60, 80);
    const blob = await c.convertToBlob({ type: 'image/png' });
    const dt = new DataTransfer(); dt.items.add(new File([blob], 'me.png', { type: 'image/png' }));
    const pick = $('.fr-prof input[type=file]'); pick.files = dt.files; pick.dispatchEvent(new Event('change'));
    await until(() => $('.fr-card .fr-av img') && byText('.fr-pic.on', '올린 사진'), 5000, 'picture shown');
    await until(() => $('.fr-card .fr-av img').naturalWidth > 0, 5000, 'picture actually loads');
    if ($('.fr-pics').textContent.includes('null')) throw new Error('stray null');
    $('input[name=fr-vis][value=public]').checked = true;
    if (!$('.fr-card').textContent.includes('앨리스_keys') || !$('.fr-card').textContent.includes('밤마다')) throw new Error('preview');
    await shot('fr-1-profile-white');
    click('.fr-foot .pri');
    await until(() => step() === '추가 설치', 8000, 'saved and moved on');
    const p = await api.workshop('profile');
    if (p.data.nick !== '앨리스_keys' || p.data.avatar !== 'upload' || p.data.pending) throw new Error(JSON.stringify(p.data));
    if ((await settings()).workshopVisibility !== 'public') throw new Error('visibility not saved');
  });
  await check('extras: sizes and times shown, update check is a real setting', async () => {
    const txt = $('.fr-main').textContent;
    for (const w of ['5 GB', '10~30분', '1.3 MB', 'donationware']) if (!txt.includes(w)) throw new Error(`missing ${w}`);
    const upd = $('.fr-chk input');
    upd.click();
    await until(async () => (await settings()).updateCheck === false);
    upd.click();
    await until(async () => (await settings()).updateCheck === true);
    await shot('fr-1-extras-white');
    return 'app closed here, at 추가 설치';
  });
}

if (run === '2 resume') {
  await check('relaunch resumes at the step it was closed on', async () => {
    await until(() => !$('#setup').hidden && step(), 30000, 'setup shown');
    if (step() !== '추가 설치') throw new Error(step());
    if ($('.fr').dataset.theme !== 'white') throw new Error('theme not kept');
    const marks = $$('.fr-rail li button').map((b) => b.className.replace('on', '').trim() || '-');
    return marks.join(' ');
  });
  await check('나중에 마저 하기 → the choice screen offers 설정 마무리하기 with what is left', async () => {
    click('.fr-rail .later');
    await until(() => $('#setup').hidden && !$('#choose').hidden && !$('#setupBtn').hidden, 8000, 'choice with the button');
    if (!$('#setupBtn').textContent.includes('2단계')) throw new Error($('#setupBtn').textContent); // devices (skipped) and extras
    await shot('fr-2-choose-finish-later');
  });
  await check('설정 마무리하기 reopens at the same step; 마무리 lists done and skipped', async () => {
    click('#setupBtn');
    await until(() => step() === '추가 설치');
    click('.fr-foot .pri');
    await until(() => step() === '마무리');
    const rows = $$('.fr-sum > div').map((d) => d.textContent);
    if (rows.length !== 6 || !rows[1].includes('건너뜀') || !rows[0].includes('완료')) throw new Error(rows.join(' | '));
    if (!byText('.fr-sum .fr-link', '지금 하기')) throw new Error('no way back to a skipped step');
    await shot('fr-2-finish-white');
  });
  await check('마무리 in the dark theme, then MeloFi 시작하기', async () => {
    click('.fr-rail li button', '언어·테마·키 배치');
    await until(() => step() === '언어·테마·키 배치');
    click('.fr-seg button', '어둡게');
    click('.fr-rail li button', '마무리');
    await until(() => $('.fr').dataset.theme === 'dark' && step() === '마무리');
    await shot('fr-2-finish-dark');
    click('.fr-foot .pri', 'MeloFi 시작하기');
    await until(() => !$('#choose').hidden && $('#setupBtn').hidden, 8000, 'choice, no button');
    if (!(await settings()).firstRun.finished) throw new Error('not finished');
  });
}

if (run === '3 finished') {
  await check('after finishing: straight to the choice screen, no setup button', async () => {
    await until(() => !$('#choose').hidden, 30000, 'choice');
    await sleep(500);
    if (!$('#setup').hidden || !$('#setupBtn').hidden) throw new Error('setup still offered');
  });
}

if (run === '4 existing user') {
  await check('someone who used MeloFi before: not forced, 설정 마무리하기 offered', async () => {
    await until(() => !$('#choose').hidden, 30000, 'choice');
    await until(() => !$('#setupBtn').hidden, 5000, 'button');
    if (!$('#setup').hidden) throw new Error('forced');
    if (!$('#setupBtn').textContent.includes('6단계')) throw new Error($('#setupBtn').textContent); // nothing recorded yet
    await shot('fr-4-existing-user');
    click('#setupBtn');
    await until(() => step() === '언어·테마·키 배치');
    if ($$('.fr-key')[1].getAttribute('aria-checked') !== 'true') throw new Error('their key layout not prefilled');
    await shot('fr-4-basics-dark');
  });
}

await api.testWrite(`fr-result-${run.split(' ')[0]}.txt`, R.join('\n'));
console.log('E2E-BEGIN\n' + R.join('\n') + '\nE2E-END');
return [];
