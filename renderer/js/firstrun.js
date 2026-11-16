// 처음 설정: the first-run setup. Shown once on the start card for a new install, re-openable later
// (파일 › 처음 설정…, the account center), and offered to existing users as 설정 마무리하기.
// Every step can be skipped; where the person is and what is done is saved in settings.firstRun after
// each step, so closing the app midway resumes there. docs/firstrun.md has the patterns and why.
//   rail     the steps on the left with their state, any of them clickable (VS Code's Get Started)
//   footer   이전 · 건너뛰기 (quiet) · 단계 n / 7 · 다음 (the one amber button)
import { t, tdyn, langChoices, langPref, setLangPref } from '../i18n/i18n.js';

const api = window.melofi;
const A = (op, p) => api.account(op, p);
const W = async (op, p) => { try { return await api.workshop(op, p); } catch (e) { return { ok: false, message: String(e?.message || e) }; } };

export const STEPS = ['basics', 'devices', 'discord', 'github', 'profile', 'extras', 'finish'];
const STEP_NAMES = () => ({
  basics: t('언어·테마·키 배치'), devices: t('마이크와 MIDI'), discord: t('디스코드 로그인'), github: t('GitHub 연결'),
  profile: t('창작마당 프로필'), extras: t('추가 설치'), finish: t('마무리'),
});
const blank = () => ({ v: 1, at: 'basics', marks: {}, finished: false });

// how far a person got: { left, total, finished } (the start card's 설정 마무리하기)
export function setupProgress(settings) {
  const fr = settings?.firstRun || blank();
  const real = STEPS.filter((s) => s !== 'finish');
  return { left: real.filter((s) => fr.marks?.[s] !== 'done').length, total: real.length, finished: !!fr.finished, fr };
}
// a new install: no settings yet besides the ones the start card itself writes
export function isNewInstall(settings) {
  if (!settings) return true;
  return Object.keys(settings).every((k) => ['lang', 'firstRun', 'updateCheck'].includes(k));
}

const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'class') n.className = v;
    else if (k === 'value') n.value = v;
    else if (k === 'checked') n.checked = !!v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) n.append(c.nodeType ? c : String(c));
  return n;
};
const SVG = {
  done: '<svg viewBox="0 0 16 16"><path d="M3.5 8.4l3 3 6-6.6" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  skip: '<svg viewBox="0 0 16 16"><path d="M4 8h8" stroke="currentColor" stroke-width="1.6"/></svg>',
  todo: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="4.5" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>',
  person: '<svg viewBox="0 0 16 16"><circle cx="8" cy="5.2" r="3" fill="currentColor"/><path d="M2.4 14.5c.5-3 2.8-4.8 5.6-4.8s5.1 1.8 5.6 4.8z" fill="currentColor"/></svg>',
};
const ic = (k) => { const s = el('span', { class: 'fr-mk' }); s.innerHTML = SVG[k]; return s; };

const CSS = `
.fr { --fr-bg: #131418; --fr-rail: #17181d; --fr-line: #25262c; --fr-line2: #34353c; --fr-text: #d8d5ce; --fr-dim: #9a988f; --fr-head: #f2efe8;
  --fr-ctl: #1b1c21; --fr-input: #0f1014; --fr-accent: #e0a440; --fr-ink: #e0a440; --fr-ok: #8fcf7d; --fr-err: #e5786c; --fr-sel: #1f2026;
  display: grid; grid-template-columns: 216px 1fr; grid-template-rows: 1fr 52px; height: 100%; min-height: 0; background: var(--fr-bg); color: var(--fr-text);
  font: 12.5px/1.5 "Segoe UI Variable Text", "Segoe UI", "Malgun Gothic", sans-serif; user-select: none; -webkit-app-region: no-drag; color-scheme: dark; }
.fr[data-theme="white"] { --fr-bg: #ebecee; --fr-rail: #e1e2e5; --fr-line: #c4c6ca; --fr-line2: #a7a9ae; --fr-text: #1b1c1f; --fr-dim: #4a4c51; --fr-head: #111214;
  --fr-ctl: #f6f6f7; --fr-input: #ffffff; --fr-ink: #7a5310; --fr-ok: #2f6e29; --fr-err: #a8281f; --fr-sel: #d6d7db; color-scheme: light; }
.fr button, .fr input, .fr select, .fr textarea { font: inherit; color: inherit; }
.fr-rail { grid-row: 1 / 3; display: flex; flex-direction: column; padding: 18px 0 14px; background: var(--fr-rail); border-right: 1px solid var(--fr-line); }
.fr-rail h1 { margin: 0 18px 2px; font-size: 14px; font-weight: 600; color: var(--fr-head); -webkit-app-region: drag; }
.fr-rail > p { margin: 0 18px 14px; color: var(--fr-dim); font-size: 11.5px; }
.fr-rail ol { list-style: none; margin: 0; padding: 0; }
.fr-rail li button { display: grid; grid-template-columns: 16px 1fr; align-items: center; gap: 10px; width: 100%; padding: 7px 18px; background: none; border: 0; border-left: 2px solid transparent; text-align: left; color: var(--fr-dim); }
.fr-rail li button:hover { color: var(--fr-text); }
.fr-rail li button.on { color: var(--fr-head); background: var(--fr-sel); border-left-color: var(--fr-accent); font-weight: 600; }
.fr-rail li button.done .fr-mk { color: var(--fr-ok); }
.fr-mk { display: inline-flex; width: 16px; height: 16px; }
.fr-mk svg { width: 100%; height: 100%; }
.fr-rail .sp { flex: 1; }
.fr-rail .later { margin: 0 18px; padding: 0; background: none; border: 0; color: var(--fr-dim); text-align: left; text-decoration: underline; text-underline-offset: 2px; font-size: 11.5px; }
.fr-main { min-height: 0; overflow: auto; padding: 26px 30px 18px; }
.fr-main h2 { margin: 0 0 4px; font-size: 18px; font-weight: 600; color: var(--fr-head); }
.fr-main > p.lead { margin: 0 0 20px; color: var(--fr-dim); max-width: 560px; }
.fr-f { display: grid; grid-template-columns: 104px minmax(0, 1fr); align-items: start; gap: 6px 16px; padding: 10px 0; border-top: 1px solid var(--fr-line); }
.fr-f:first-of-type { border-top: 0; }
.fr-f > label, .fr-f > .lb { padding-top: 4px; color: var(--fr-dim); }
.fr-seg { display: inline-flex; flex-wrap: wrap; }
.fr-seg button { height: 28px; padding: 0 12px; margin-left: -1px; background: var(--fr-ctl); border: 1px solid var(--fr-line2); color: var(--fr-dim); }
.fr-seg button:first-child { margin-left: 0; border-radius: 2px 0 0 2px; } .fr-seg button:last-child { border-radius: 0 2px 2px 0; }
.fr-seg button.on { position: relative; z-index: 1; background: var(--fr-text); border-color: var(--fr-text); color: var(--fr-bg); }
.fr-keys { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.fr-key { display: grid; gap: 6px; padding: 10px 12px; text-align: left; background: var(--fr-ctl); border: 1px solid var(--fr-line2); border-radius: 2px; }
.fr-key.on { border-color: var(--fr-accent); box-shadow: inset 0 0 0 1px var(--fr-accent); }
.fr-key b { font-weight: 600; }
.fr-key kbd { padding: 0; background: none; border: 0; font: 11px Consolas, "Cascadia Mono", monospace; letter-spacing: 1px; color: var(--fr-dim); } /* (not the window's own kbd look) */
.fr-row { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 4px 16px; padding: 12px 0; border-top: 1px solid var(--fr-line); }
.fr-row:first-of-type { border-top: 0; }
.fr-row b { display: block; font-weight: 600; }
.fr-row small { display: block; color: var(--fr-dim); font-size: 11.5px; }
.fr-row .res { grid-column: 1 / -1; min-height: 18px; font-size: 12px; color: var(--fr-dim); }
.fr-row .res.ok { color: var(--fr-ok); } .fr-row .res.err { color: var(--fr-err); }
.fr-row .acts { display: flex; gap: 6px; }
.fr-b { height: 28px; padding: 0 14px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; white-space: nowrap;
  background: var(--fr-ctl); border: 1px solid var(--fr-line2); border-radius: 2px; }
.fr-b:hover:not(:disabled) { border-color: var(--fr-dim); }
.fr-b:disabled { opacity: .5; }
.fr-b.pri { background: var(--fr-accent); border-color: var(--fr-accent); color: #111; font-weight: 600; }
.fr-b:focus-visible, .fr-seg button:focus-visible, .fr-key:focus-visible, .fr-rail button:focus-visible { outline: 1px solid var(--fr-accent); outline-offset: 1px; }
.fr-link { padding: 0; background: none; border: 0; color: var(--fr-dim); text-decoration: underline; text-underline-offset: 2px; }
.fr-link:hover { color: var(--fr-text); }
.fr-in { height: 28px; padding: 0 9px; width: 100%; background: var(--fr-input); border: 1px solid var(--fr-line2); border-radius: 2px; outline: none; user-select: text; }
.fr-in:focus { border-color: var(--fr-accent); }
.fr-note { min-height: 18px; margin: 4px 0 0; font-size: 12px; color: var(--fr-dim); }
.fr-note.ok { color: var(--fr-ok); } .fr-note.err { color: var(--fr-err); }
.fr-code { display: grid; grid-template-columns: auto 1fr; align-items: center; gap: 6px 16px; margin-top: 14px; padding: 14px 16px; background: var(--fr-input); border: 1px solid var(--fr-line); border-radius: 2px; }
.fr-code kbd { grid-row: 1 / 3; font: 600 24px Consolas, "Cascadia Mono", monospace; letter-spacing: 3px; color: var(--fr-head); user-select: all; }
.fr-code small { color: var(--fr-dim); }
.fr-acct { display: grid; grid-template-columns: 40px 1fr auto; align-items: center; gap: 4px 14px; padding: 14px 16px; background: var(--fr-input); border: 1px solid var(--fr-line); border-radius: 2px; max-width: 560px; }
.fr-av { width: 40px; height: 40px; border-radius: 50%; overflow: hidden; display: grid; place-items: center; background: var(--fr-ctl); color: var(--fr-dim); font-weight: 700; }
.fr-av img { width: 100%; height: 100%; object-fit: cover; }
.fr-av .fr-mk { width: 20px; height: 20px; }
.fr-acct b { font-weight: 600; } .fr-acct small { display: block; color: var(--fr-dim); }
.fr-prof { display: grid; grid-template-columns: minmax(0, 1fr) 220px; gap: 24px; }
.fr-card { align-self: start; padding: 16px; background: var(--fr-input); border: 1px solid var(--fr-line); border-radius: 2px; }
.fr-card .fr-cap { margin-bottom: 12px; font-size: 11px; color: var(--fr-dim); }
.fr-card .fr-who { display: grid; grid-template-columns: 48px 1fr; gap: 12px; align-items: center; }
.fr-card .fr-av { width: 48px; height: 48px; }
.fr-card b { display: block; font-size: 14px; font-weight: 600; color: var(--fr-head); overflow-wrap: anywhere; }
.fr-card p { margin: 10px 0 0; color: var(--fr-text); overflow-wrap: anywhere; min-height: 19px; }
.fr-pics { display: flex; flex-wrap: wrap; gap: 6px; }
.fr-pic { display: inline-flex; align-items: center; gap: 8px; height: 36px; padding: 0 12px 0 4px; background: var(--fr-ctl); border: 1px solid var(--fr-line2); border-radius: 2px; }
.fr-pic .fr-av { width: 28px; height: 28px; font-size: 11px; }
.fr-pic.on { border-color: var(--fr-accent); box-shadow: inset 0 0 0 1px var(--fr-accent); }
.fr-radio { display: grid; gap: 8px; }
.fr-radio label { display: grid; grid-template-columns: 16px 1fr; gap: 2px 8px; }
.fr-radio small { grid-column: 2; color: var(--fr-dim); font-size: 11.5px; }
.fr-sum { max-width: 600px; border: 1px solid var(--fr-line); border-radius: 2px; }
.fr-sum div { display: grid; grid-template-columns: 16px 1fr auto auto; align-items: center; gap: 12px; padding: 10px 14px; }
.fr-sum div + div { border-top: 1px solid var(--fr-line); }
.fr-sum div.done .fr-mk { color: var(--fr-ok); }
.fr-sum small { color: var(--fr-dim); }
.fr-foot { display: flex; align-items: center; gap: 12px; padding: 0 30px; border-top: 1px solid var(--fr-line); }
.fr-foot .sp { flex: 1; }
.fr-foot .n { color: var(--fr-dim); font-variant-numeric: tabular-nums; }
.fr-chk { display: flex; gap: 8px; align-items: flex-start; }
.fr-foot-note { margin-top: 18px; color: var(--fr-dim); font-size: 11.5px; }
/* as a sheet in the piano window or the studio */
.fr-sheet { position: fixed; inset: 0; z-index: 42; display: grid; place-items: center; background: var(--s-scrim, rgba(4,4,6,.62)); }
.fr-sheet > .fr { width: min(960px, calc(100vw - 32px)); height: min(640px, calc(100vh - 32px)); border: 1px solid var(--fr-line2); border-radius: 3px; box-shadow: 0 18px 50px rgba(0,0,0,.5); }
`;
let styled = false;
const style = () => { if (styled) return; styled = true; document.head.append(el('style', {}, CSS)); };

// ---------- hosts: where the settings live ----------
// the start card (no App): reads and writes settings.json through main
export function splashHost() {
  let cache = {};
  return {
    kind: 'splash',
    async load() { cache = (await api.loadSettings()) || {}; return cache; },
    get: () => cache,
    async set(patch) { Object.assign(cache, patch); await api.saveSettings(patch); },
    async setLang(p) { await this.set({ lang: p }); await setLangPref(p); },
  };
}
// the piano window or the studio: the App's own settings (they save and tell the other windows)
export function appHost(app) {
  return {
    kind: 'app', app,
    async load() { return app.settings.v; },
    get: () => app.settings.v,
    async set(patch) { app.settings.set(patch); },
    async setLang(p) { app.settings.set({ lang: p }); },
  };
}

// ---------- the wizard ----------
// openFirstRun(host, { into, step, onClose(finished) }): into = a container (the start card), or a sheet
export async function openFirstRun(host, { into = null, step = null, onClose = () => {} } = {}) {
  style();
  await host.load();
  const S = host.get();
  let fr = { ...blank(), ...(S.firstRun || {}), marks: { ...(S.firstRun?.marks || {}) } };
  if (step) fr.at = step;
  if (!STEPS.includes(fr.at)) fr.at = 'basics';
  let acct = null; // account.js state
  let cleanup = [];
  const root = el('div', { class: 'fr', role: 'dialog', 'aria-label': t('처음 설정') });
  const theme = () => ((host.get().studioLook?.theme || 'dark') === 'white' ? 'white' : 'dark');
  const paintTheme = () => { root.dataset.theme = theme(); };
  paintTheme();
  let sheet = null;
  if (into) into.replaceChildren(root);
  else {
    sheet = el('div', { class: 'fr-sheet', 'data-own-keys': '' }, root);
    document.body.append(sheet);
  }
  const keyEsc = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  root.addEventListener('keydown', keyEsc);

  const save = async () => { await host.set({ firstRun: { v: 1, at: fr.at, marks: fr.marks, finished: fr.finished, ...(fr.left ? { left: true } : {}) } }); };
  const mark = (s, m) => { if (fr.marks[s] !== 'done' || m === 'done') fr.marks[s] = m; };
  function close() {
    for (const f of cleanup) try { f(); } catch { /* */ }
    cleanup = [];
    save();
    if (sheet) sheet.remove(); else root.remove();
    onClose(fr.finished);
  }
  const goto = async (s) => { for (const f of cleanup) try { f(); } catch { /* */ } cleanup = []; fr.at = s; await save(); render(); };
  const next = async (m = 'done') => {
    if (fr.at !== 'finish') mark(fr.at, m);
    const i = STEPS.indexOf(fr.at);
    await goto(STEPS[Math.min(STEPS.length - 1, i + 1)]);
  };
  const back = () => goto(STEPS[Math.max(0, STEPS.indexOf(fr.at) - 1)]);

  async function refreshAcct() { const r = await A('state'); acct = r.ok ? r.data : { discord: null, github: null, ready: {} }; return acct; }
  await refreshAcct();
  // a step whose real event already happened counts as done (VS Code's completion events)
  if (acct.discord) mark('discord', 'done');
  if (acct.github) mark('github', 'done');

  function rail() {
    const names = STEP_NAMES();
    return el('nav', { class: 'fr-rail', 'aria-label': t('설정 단계') },
      el('h1', {}, t('MeloFi 처음 설정')),
      el('p', {}, t('필요한 것만 하고 나머지는 건너뛰어도 돼요.')),
      el('ol', {}, ...STEPS.map((s) => {
        const m = fr.marks[s];
        return el('li', {}, el('button', { type: 'button', class: `${fr.at === s ? 'on' : ''} ${m || ''}`, 'aria-current': fr.at === s ? 'step' : null, onclick: () => goto(s) },
          ic(m === 'done' ? 'done' : m === 'skipped' ? 'skip' : 'todo'), names[s]));
      })),
      el('span', { class: 'sp' }),
      fr.at !== 'finish' ? el('button', { class: 'later', type: 'button', onclick: close }, t('나중에 마저 하기')) : null);
  }

  function foot({ nextLabel = t('다음'), onNext = () => next('done'), canSkip = true, nextDisabled = false } = {}) {
    const i = STEPS.indexOf(fr.at);
    return el('div', { class: 'fr-foot' },
      i > 0 ? el('button', { class: 'fr-b', type: 'button', onclick: back }, t('이전')) : null,
      canSkip && fr.at !== 'finish' ? el('button', { class: 'fr-link', type: 'button', onclick: () => next('skipped') }, t('건너뛰기')) : null,
      el('span', { class: 'sp' }),
      el('span', { class: 'n' }, t('단계 {i} / {n}', { i: i + 1, n: STEPS.length })),
      el('button', { class: 'fr-b pri', type: 'button', disabled: nextDisabled, onclick: onNext }, nextLabel));
  }

  function render() {
    paintTheme();
    const body = el('section', { class: 'fr-main', 'aria-live': 'polite' });
    const view = VIEWS[fr.at](body);
    root.replaceChildren(rail(), body, view.foot);
    (body.querySelector('[data-focus]') || root.querySelector('.fr-foot .pri'))?.focus();
  }

  const head = (body, title, lead) => body.append(el('h2', {}, title), el('p', { class: 'lead' }, lead));
  const say = (n, text, kind = '') => { n.textContent = text ? tdyn(text) : ''; n.className = `${n.className.split(' ')[0]}${kind ? ' ' + kind : ''}`; };

  const VIEWS = {
    // 1. language, theme, key layout: prefilled from the system and what is already set
    basics(body) {
      head(body, t('언어·테마·키 배치'), t('지금 정해도 나중에 설정에서 언제든 바꿀 수 있어요.'));
      const s = host.get();
      const seg = (list, cur, pick) => {
        const box = el('div', { class: 'fr-seg', role: 'radiogroup' });
        const paint = (v) => { for (const b of box.children) { b.classList.toggle('on', b.dataset.v === v); b.setAttribute('aria-checked', String(b.dataset.v === v)); } };
        for (const [v, label] of list) box.append(el('button', { type: 'button', role: 'radio', 'data-v': v, onclick: async () => { paint(v); await pick(v); } }, label));
        paint(cur);
        return box;
      };
      const langBox = seg(langChoices(), s.lang || langPref() || 'system', async (v) => { await host.setLang(v); render(); });
      const themeBox = seg([['dark', t('어둡게')], ['white', t('밝게')]], theme(), async (v) => {
        await host.set({ studioLook: { ...(host.get().studioLook || {}), theme: v } });
        if (host.app?.studio?.isOpen) host.app.studio.setTheme?.(v);
        paintTheme();
      });
      const keys = el('div', { class: 'fr-keys', role: 'radiogroup' });
      const LAYOUTS = [['piano', t('기본'), 'A S D F G H J K L', t('흰 건반이 한 줄, 검은 건반이 윗줄')], ['zigzag', t('지그재그'), 'A W S E D F T G', t('흰 건반과 검은 건반을 번갈아')], ['fl', t('두 줄'), 'Z X C V · Q W E R', t('아래 두 줄과 위 두 줄로 두 옥타브')]];
      const curKey = s.keyPreset || 'piano';
      for (const [v, name, row, sub] of LAYOUTS) {
        keys.append(el('button', { type: 'button', role: 'radio', class: `fr-key${curKey === v ? ' on' : ''}`, 'aria-checked': String(curKey === v), 'data-v': v, onclick: async (e) => {
          for (const b of keys.children) { const on = b === e.currentTarget; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); }
          await host.set({ keyPreset: v });
        } }, el('b', {}, name), el('kbd', {}, row), el('small', {}, sub)));
      }
      body.append(
        el('div', { class: 'fr-f' }, el('span', { class: 'lb' }, t('언어')), langBox),
        el('div', { class: 'fr-f' }, el('span', { class: 'lb' }, t('테마')), el('div', {}, themeBox, el('div', { class: 'fr-note' }, t('MeloFi Studio와 이 창에 적용돼요. 피아노 화면의 배경 테마는 화면 메뉴에서 골라요.')))),
        el('div', { class: 'fr-f' }, el('span', { class: 'lb' }, t('키 배치')), keys));
      return { foot: foot() };
    },

    // 2. microphone and MIDI: tested only when this step is reached, one line on why
    devices(body) {
      head(body, t('마이크와 MIDI'), t('쓰는 기능이 있을 때만 확인하면 돼요. 확인을 눌러야 장치에 접근해요.'));
      const micRes = el('div', { class: 'res' }), midiRes = el('div', { class: 'res' });
      let micOk = false, midiOk = false;
      const settingsBtn = el('button', { class: 'fr-b', type: 'button', hidden: true, onclick: () => api.openOsSettings?.('microphone') }, t('Windows 마이크 설정 열기'));
      const micBtn = el('button', { class: 'fr-b', type: 'button', 'data-focus': true, onclick: async () => {
        say(micRes, t('확인하는 중…'));
        try {
          const st = await navigator.mediaDevices.getUserMedia({ audio: true });
          const n = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput').length;
          st.getTracks().forEach((x) => x.stop());
          micOk = true; settingsBtn.hidden = true;
          say(micRes, t('마이크를 쓸 수 있어요 (입력 장치 {n}개).', { n }), 'ok');
        } catch (e) {
          micOk = false; settingsBtn.hidden = false;
          say(micRes, e?.name === 'NotFoundError' ? t('연결된 마이크가 없어요. 나중에 연결해도 돼요.') : t('Windows가 마이크를 막고 있어요. 설정 > 개인 정보 및 보안 > 마이크에서 "데스크톱 앱이 마이크에 액세스하도록 허용"을 켜 주세요.'), 'err');
        }
      } }, t('마이크 확인'));
      const midiBtn = el('button', { class: 'fr-b', type: 'button', onclick: async () => {
        say(midiRes, t('찾는 중…'));
        try {
          const acc = await navigator.requestMIDIAccess({ sysex: false });
          const names = [...acc.inputs.values()].map((i) => i.name);
          midiOk = names.length > 0;
          say(midiRes, names.length ? t('찾았어요: {list}', { list: names.join(', ') }) : t('연결된 MIDI 장치가 없어요. 연결하면 바로 쓸 수 있어요.'), names.length ? 'ok' : '');
          acc.onstatechange = () => midiBtn.click();
          cleanup.push(() => { acc.onstatechange = null; });
        } catch { say(midiRes, t('MIDI 장치에 접근하지 못했어요.'), 'err'); }
      } }, t('MIDI 장치 찾기'));
      body.append(
        el('div', { class: 'fr-row' }, el('div', {}, el('b', {}, t('마이크')), el('small', {}, t('Studio에서 노래나 악기를 녹음할 때, 입력 지연을 잴 때 써요.'))), el('div', { class: 'acts' }, settingsBtn, micBtn), micRes),
        el('div', { class: 'fr-row' }, el('div', {}, el('b', {}, t('MIDI 장치')), el('small', {}, t('MIDI 키보드로 연주하고 Studio에서 녹음할 때 써요.'))), el('div', { class: 'acts' }, midiBtn), midiRes),
        el('p', { class: 'fr-foot-note' }, t('Windows는 마이크 권한을 앱마다 묻지 않고 설정 한 곳에서 정해요. 그래서 여기서는 쓸 수 있는지만 확인해요. MeloFi는 알림을 보내지 않아서 알림 권한은 필요 없어요.')));
      return { foot: foot({ onNext: () => next(micOk || midiOk ? 'done' : 'skipped') }) };
    },

    // 3. Discord: signing in joins the MeloFi server (account.js refuses the sign-in if that fails)
    discord(body) {
      head(body, t('디스코드 로그인'), t('로그인하면 MeloFi 디스코드 서버에 들어가요. 질문하고, 문제를 신고하고, 창작마당에 댓글을 달 수 있어요.'));
      const res = el('p', { class: 'fr-note' });
      const box = el('div', {});
      const paint = () => {
        const u = acct.discord;
        box.replaceChildren(el('div', { class: 'fr-acct' },
          avatarEl(u?.avatar, u?.name),
          el('div', {}, el('b', {}, u ? u.name : t('연결 안 됨')), el('small', {}, u ? (u.guild ? t('서버 참여: {g}', { g: u.guild }) : t('MeloFi 디스코드 서버에 참여했어요')) : t('브라우저에서 디스코드 승인 화면이 열려요'))),
          u ? el('button', { class: 'fr-b', type: 'button', onclick: async () => { await A('logout', { provider: 'discord' }); await refreshAcct(); fr.marks.discord = undefined; render(); } }, t('연결 해제'))
            : acct.pending === 'discord' ? el('button', { class: 'fr-b', type: 'button', onclick: () => A('cancel') }, t('취소'))
              : el('button', { class: 'fr-b pri', type: 'button', 'data-focus': true, disabled: !acct.ready?.discord, onclick: login }, t('디스코드로 로그인'))));
      };
      const login = async () => {
        acct = { ...acct, pending: 'discord' }; paint();
        say(res, t('브라우저에서 승인을 마쳐 주세요. 서버 참여까지 끝나면 여기로 돌아와요.'));
        const r = await A('loginDiscord');
        await refreshAcct();
        if (r.ok) { mark('discord', 'done'); await save(); say(res, t('로그인했어요. MeloFi 디스코드 서버에도 들어갔어요.'), 'ok'); render(); return; }
        paint();
        say(res, r.error === 'cancelled' ? '' : r.message, 'err');
      };
      paint();
      body.append(box, res);
      return { foot: foot({ nextLabel: acct.discord ? t('다음') : t('다음에 할게요'), onNext: () => next(acct.discord ? 'done' : 'skipped') }) };
    },

    // 4. GitHub: device code, a countdown, and a new code when it runs out
    github(body) {
      head(body, t('GitHub 연결'), t('작곡 프로젝트를 내 GitHub에 비공개로 저장하고, 창작마당에 작품을 올릴 때 써요. 비밀번호는 MeloFi에 넣지 않아요.'));
      const res = el('p', { class: 'fr-note' });
      const box = el('div', {});
      let code = null, timer = 0;
      cleanup.push(() => { clearInterval(timer); if (code) A('cancel'); });
      const paint = () => {
        const u = acct.github;
        box.replaceChildren(el('div', { class: 'fr-acct' },
          avatarEl(u?.avatar, u?.name),
          el('div', {}, el('b', {}, u ? `${u.name}` : t('연결 안 됨')), el('small', {}, u ? `@${u.handle}` : t('github.com에 코드를 넣어 연결해요'))),
          u ? el('button', { class: 'fr-b', type: 'button', onclick: async () => { await A('logout', { provider: 'github' }); await refreshAcct(); fr.marks.github = undefined; render(); } }, t('연결 해제'))
            : code ? el('button', { class: 'fr-b', type: 'button', onclick: () => { A('cancel'); } }, t('취소'))
              : el('button', { class: 'fr-b pri', type: 'button', 'data-focus': true, disabled: !acct.ready?.github, onclick: start }, t('코드 받기'))),
        code ? el('div', { class: 'fr-code' },
          el('kbd', {}, code.code),
          el('span', {}, el('button', { class: 'fr-b pri', type: 'button', onclick: () => { navigator.clipboard?.writeText(code.code).catch(() => {}); A('openUrl', { url: code.url }); } }, t('코드 복사하고 GitHub 열기'))),
          el('small', { class: 'left' }, '')) : null);
        tick();
      };
      const tick = () => {
        const n = box.querySelector('.fr-code small');
        if (!n || !code) return;
        const s = Math.max(0, Math.round((code.expires - Date.now()) / 1000));
        n.textContent = s ? t('{m}:{s} 안에 넣어 주세요. 이 창은 그대로 두세요.', { m: Math.floor(s / 60), s: String(s % 60).padStart(2, '0') }) : t('시간이 지났어요.');
      };
      const start = async () => {
        say(res, '');
        const r = await A('githubStart');
        if (!r.ok) return say(res, r.message, 'err');
        code = r.data; paint();
        clearInterval(timer); timer = setInterval(tick, 1000);
        const w = await A('githubWait');
        clearInterval(timer); code = null;
        await refreshAcct();
        if (w.ok) { mark('github', 'done'); await save(); say(res, t('GitHub를 연결했어요.'), 'ok'); render(); return; }
        paint();
        if (w.error === 'timeout') { say(res, t('코드 시간이 지났어요.'), 'err'); res.append(' ', el('button', { class: 'fr-link', type: 'button', onclick: start }, t('새 코드 받기'))); }
        else say(res, w.error === 'cancelled' ? '' : w.message, 'err');
      };
      paint();
      body.append(box, res);
      return { foot: foot({ nextLabel: acct.github ? t('다음') : t('다음에 할게요'), onNext: () => next(acct.github ? 'done' : 'skipped') }) };
    },

    // 5. the 창작마당 profile: nickname (checked as you type), picture, one line, default visibility
    profile(body) {
      head(body, t('창작마당 프로필'), t('작품과 댓글 옆에 보이는 이름과 사진이에요. 계정 이름 대신 쓰여요.'));
      const signed = acct.github || acct.discord;
      if (!signed) {
        body.append(el('p', { class: 'fr-note' }, t('프로필은 디스코드나 GitHub로 로그인한 뒤에 만들 수 있어요.')),
          el('div', { class: 'acts' }, el('button', { class: 'fr-b', type: 'button', onclick: () => goto('discord') }, t('디스코드 로그인으로 이동')), ' ', el('button', { class: 'fr-b', type: 'button', onclick: () => goto('github') }, t('GitHub 연결로 이동'))));
        return { foot: foot({ nextLabel: t('다음에 할게요'), onNext: () => next('skipped') }) };
      }
      const who = acct.github ? 'github' : 'discord'; // the identity that likes and comments (workshop.js actor)
      const own = who === 'github' ? acct.github : acct.discord;
      const prof = { nick: '', bio: '', avatar: own.avatar ? who : '', image: null, imageUrl: null };
      const nick = el('input', { class: 'fr-in', maxlength: '20', 'data-focus': true, 'aria-describedby': 'fr-nick-note', spellcheck: 'false' });
      const nickNote = el('div', { class: 'fr-note', id: 'fr-nick-note' });
      const bio = el('input', { class: 'fr-in', maxlength: '80' });
      const pics = el('div', { class: 'fr-pics', role: 'radiogroup' });
      const res = el('p', { class: 'fr-note' });
      const card = el('div', { class: 'fr-card', 'aria-label': t('미리 보기') });
      let nickOk = false, gen = 0, deb = 0;
      const vis = el('div', { class: 'fr-radio' },
        el('label', {}, el('input', { type: 'radio', name: 'fr-vis', value: 'link', checked: (host.get().workshopVisibility || 'link') === 'link' }), t('링크가 있는 사람만 (기본)'), el('small', {}, t('올린 작품은 목록에 나오지 않고, 링크를 받은 사람만 볼 수 있어요.'))),
        el('label', {}, el('input', { type: 'radio', name: 'fr-vis', value: 'public', checked: host.get().workshopVisibility === 'public' }), t('창작마당에 공개'), el('small', {}, t('올릴 때마다 누구나 찾아 들을 수 있게 올라가요.'))));
      const picUrl = () => (prof.avatar === 'upload' ? prof.imageUrl : prof.avatar ? own.avatar : null);
      const paintCard = () => card.replaceChildren(el('div', { class: 'fr-cap' }, t('창작마당에서 이렇게 보여요')),
        el('div', { class: 'fr-who' }, avatarEl(picUrl(), nick.value || '?'), el('div', {}, el('b', {}, nick.value || t('닉네임')), el('small', {}, who === 'github' ? `GitHub @${own.handle}` : `Discord ${own.name}`))),
        el('p', {}, bio.value));
      const paintPics = () => {
        const opt = (v, label, url) => el('button', { type: 'button', role: 'radio', class: `fr-pic${prof.avatar === v ? ' on' : ''}`, 'aria-checked': String(prof.avatar === v), onclick: () => { if (v === 'upload' && !prof.imageUrl) return pick.click(); prof.avatar = v; paintPics(); paintCard(); } }, avatarEl(url, v === '' ? '?' : nick.value || '?'), label); // (사진 없음 shows the plain mark)
        pics.replaceChildren(...[
          own.avatar ? opt(who, who === 'github' ? t('GitHub 사진') : t('디스코드 사진'), own.avatar) : null,
          opt('upload', prof.imageUrl ? t('올린 사진') : t('사진 올리기…'), prof.imageUrl),
          opt('', t('사진 없음'), null),
          prof.imageUrl ? el('button', { class: 'fr-link', type: 'button', onclick: () => pick.click() }, t('다른 사진 고르기')) : null].filter(Boolean));
      };
      const pick = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true, onchange: async () => {
        const f = pick.files[0]; pick.value = '';
        if (!f) return;
        try { const r = await squareJpeg(f, 96); prof.image = r.data; prof.imageUrl = r.url; prof.avatar = 'upload'; paintPics(); paintCard(); } catch { say(res, t('이미지를 읽지 못했어요.'), 'err'); }
      } });
      const check = async () => {
        const v = nick.value.trim();
        const my = ++gen;
        nickOk = false;
        if (!v) { say(nickNote, ''); return; }
        say(nickNote, t('확인하는 중…'));
        const r = await W('checkNick', { name: v });
        if (my !== gen) return;
        if (!r.ok) return say(nickNote, r.message, 'err');
        const d = r.data;
        if (d.ok) { nickOk = true; say(nickNote, d.unchecked ? t('형식은 괜찮아요. 겹치는지는 저장할 때 확인해요.') : t('쓸 수 있어요.'), 'ok'); return; }
        const text = { bad: t('2~20자 한글, 영문, 숫자와 _ - . 만 쓸 수 있어요.'), reserved: t('운영진용으로 남겨 둔 이름이에요.'), taken: t('이미 누가 쓰고 있어요.') }[d.reason] || t('쓸 수 없는 닉네임이에요.');
        say(nickNote, text, 'err');
        if (d.reason === 'taken') {
          const ideas = [`${v}${Math.floor(Math.random() * 90 + 10)}`, `${v}_piano`, `${v}.${new Date().getFullYear() % 100}`].filter((x) => x.length <= 20);
          nickNote.append(' ', t('이건 어때요:'), ' ', ...ideas.flatMap((x, i) => [i ? ', ' : '', el('button', { class: 'fr-link', type: 'button', onclick: () => { nick.value = x; paintCard(); check(); } }, x)]));
        }
      };
      nick.addEventListener('input', () => { paintCard(); paintPics(); clearTimeout(deb); deb = setTimeout(check, 400); });
      bio.addEventListener('input', paintCard);
      cleanup.push(() => clearTimeout(deb));
      W('profile').then((r) => {
        if (!r.ok || !r.data) return;
        const d = r.data;
        if (d.nick) { nick.value = d.nick; check(); }
        if (d.bio) bio.value = d.bio;
        if (d.avatar === 'upload' && d.avatarUrl) { prof.imageUrl = d.avatarUrl.startsWith('/') ? null : d.avatarUrl; prof.avatar = prof.imageUrl ? 'upload' : prof.avatar; }
        else if (d.avatar !== undefined && d.nick) prof.avatar = d.avatar === who || d.avatar === '' ? d.avatar : prof.avatar;
        if (d.pending) say(res, t('서버에 아직 올리지 못한 프로필이에요. 창작마당을 열 때 다시 올려요.'));
        paintPics(); paintCard();
      });
      paintPics(); paintCard();
      body.append(el('div', { class: 'fr-prof' },
        el('div', {},
          el('div', { class: 'fr-f' }, el('label', {}, t('닉네임')), el('div', {}, nick, nickNote)),
          el('div', { class: 'fr-f' }, el('span', { class: 'lb' }, t('사진')), el('div', {}, pics, pick)),
          el('div', { class: 'fr-f' }, el('label', {}, t('한 줄 소개')), bio),
          el('div', { class: 'fr-f' }, el('span', { class: 'lb' }, t('올릴 때 기본')), vis)),
        card), res);
      const saveIt = async () => {
        const visV = vis.querySelector('input:checked')?.value || 'link';
        await host.set({ workshopVisibility: visV });
        if (!nick.value.trim()) return next('skipped');
        if (!nickOk) { await check(); if (!nickOk) { nick.focus(); return; } }
        say(res, t('저장하는 중…'));
        const r = await W('saveProfile', { nick: nick.value.trim(), bio: bio.value, avatar: prof.avatar, image: prof.avatar === 'upload' ? prof.image : null });
        if (!r.ok) {
          say(res, r.message, 'err');
          if (r.error === 'nick_taken') check();
          return;
        }
        if (r.data?.pending) say(res, t('지금은 서버에 올리지 못해 이 PC에 저장해 뒀어요. 창작마당을 열 때 올려요.'));
        await next('done');
      };
      return { foot: foot({ nextLabel: t('저장하고 다음'), onNext: saveIt }) };
    },

    // 6. optional downloads and the update check, each with its size and time
    extras(body) {
      head(body, t('추가 설치'), t('지금 하지 않아도 괜찮아요. 설치를 시작한 뒤에도 다음 단계로 넘어갈 수 있어요.'));
      const s = host.get();
      const aiRes = el('div', { class: 'res' }), vbRes = el('div', { class: 'res' });
      const aiBtn = el('button', { class: 'fr-b', type: 'button', disabled: true }, t('확인하는 중…'));
      const vbBtn = el('button', { class: 'fr-b', type: 'button', disabled: true }, t('확인하는 중…'));
      const upd = el('input', { type: 'checkbox', checked: s.updateCheck !== false, onchange: () => host.set({ updateCheck: upd.checked }) });
      api.stemsStatus?.().then((st) => {
        if (st?.ready) { aiBtn.textContent = t('설치됨'); say(aiRes, t('설치되어 있어요{gpu}.', { gpu: st.gpu ? t(' (그래픽카드 가속)') : '' }), 'ok'); return; }
        if (st?.busy) { aiBtn.textContent = t('설치하는 중'); return; }
        aiBtn.disabled = false; aiBtn.textContent = t('설치 시작');
        aiBtn.onclick = async () => {
          aiBtn.disabled = true; aiBtn.textContent = t('설치하는 중');
          const off = api.onStemsProgress?.((m) => say(aiRes, `${tdyn(m.label || '')} ${m.p != null ? Math.round(m.p * 100) + '%' : ''} ${m.detail || ''}`.trim()));
          cleanup.push(() => off?.());
          const r = await api.stemsSetup({ mode: 'install' });
          off?.();
          if (r?.ok === false) { aiBtn.disabled = false; aiBtn.textContent = t('다시 시도'); say(aiRes, r.message, 'err'); } else { aiBtn.textContent = t('설치됨'); say(aiRes, t('설치를 마쳤어요.'), 'ok'); }
        };
      }).catch(() => { aiBtn.textContent = t('확인 못 함'); });
      api.vbcable?.('status').then((r) => {
        const st = r?.data;
        if (!r?.ok || !st?.supported) { vbBtn.textContent = t('쓸 수 없음'); say(vbRes, t('이 PC에서는 쓸 수 없어요.')); return; }
        if (st.installed) { vbBtn.textContent = t('설치됨'); say(vbRes, t('VB-CABLE이 설치되어 있어요. 피아노 화면에서 Discord로 연주 보내기를 켜면 돼요.'), 'ok'); return; }
        vbBtn.disabled = false; vbBtn.textContent = t('받아서 설치');
        vbBtn.onclick = async () => {
          vbBtn.disabled = true;
          const off = api.onVbcableState?.((m) => say(vbRes, typeof m === 'string' ? m : m?.text || ''));
          const x = await api.vbcable('install', {});
          off?.();
          vbBtn.disabled = false;
          say(vbRes, x.ok ? t('설치 창을 열었어요. 설치를 마친 뒤 PC를 다시 시작하라고 하면 따라 주세요.') : x.message, x.ok ? 'ok' : 'err');
        };
      }).catch(() => { vbBtn.textContent = t('확인 못 함'); });
      body.append(
        el('div', { class: 'fr-row' }, el('div', {}, el('b', {}, t('AI 분석 엔진')), el('small', {}, t('음원 분리, 박자 측정, 채보에 써요. 약 5 GB, 인터넷 속도에 따라 10~30분 걸려요. 디스크 공간이 6 GB 이상 필요해요.'))), el('div', { class: 'acts' }, aiBtn), aiRes),
        el('div', { class: 'fr-row' }, el('div', {}, el('b', {}, t('Discord로 연주 보내기 (VB-CABLE)')), el('small', {}, t('피아노 소리를 디스코드 통화에 마이크처럼 보내요. VB-Audio 사이트에서 1.3 MB를 받아 설치 창을 열고, Windows가 관리자 권한을 물어요.')), el('small', {}, 'www.vb-cable.com · VB-CABLE is a donationware, all participations are welcome.')), el('div', { class: 'acts' }, vbBtn), vbRes),
        el('div', { class: 'fr-row' }, el('label', { class: 'fr-chk' }, upd, el('span', {}, el('b', {}, t('시작할 때 업데이트 확인')), el('small', {}, t('새 버전이 있으면 알려 줘요. 받기와 설치는 직접 눌러야 해요.'))))));
      return { foot: foot() };
    },

    // 7. what is done and what was left, with a way back to each
    finish(body) {
      head(body, t('마무리'), t('건너뛴 단계는 파일 메뉴의 처음 설정이나 계정 화면에서 언제든 다시 할 수 있어요.'));
      const names = STEP_NAMES();
      body.append(el('div', { class: 'fr-sum' }, ...STEPS.filter((s) => s !== 'finish').map((s) => {
        const m = fr.marks[s];
        return el('div', { class: m === 'done' ? 'done' : '' }, ic(m === 'done' ? 'done' : m === 'skipped' ? 'skip' : 'todo'), names[s],
          el('small', {}, m === 'done' ? t('완료') : m === 'skipped' ? t('건너뜀') : t('아직 안 함')),
          m === 'done' ? el('span') : el('button', { class: 'fr-link', type: 'button', onclick: () => goto(s) }, t('지금 하기')));
      })));
      return { foot: foot({ nextLabel: host.kind === 'splash' ? t('MeloFi 시작하기') : t('닫기'), canSkip: false, onNext: async () => { fr.finished = true; await save(); close(); } }) };
    },
  };

  render();
  return { close, root, get state() { return fr; } };
}

function avatarEl(url, name) {
  const a = el('span', { class: 'fr-av' });
  if (url) a.append(el('img', { src: url, alt: '' }));
  else if (name && name !== '?') a.textContent = String(name).trim().charAt(0).toUpperCase();
  else { const s = el('span', { class: 'fr-mk' }); s.innerHTML = SVG.person; a.append(s); }
  return a;
}

async function squareJpeg(file, N) {
  const bmp = await createImageBitmap(file);
  const s = Math.min(bmp.width, bmp.height);
  const c = new OffscreenCanvas(N, N);
  c.getContext('2d').drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, N, N);
  let q = 0.88, blob;
  do { blob = await c.convertToBlob({ type: 'image/jpeg', quality: q }); q -= 0.12; } while (blob.size > 22 * 1024 && q > 0.3);
  // a data: URL, not blob: (the start card's content policy allows data: images only)
  const url = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
  return { data: new Uint8Array(await blob.arrayBuffer()), url };
}
