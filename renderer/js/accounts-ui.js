// The account center: one layout wherever it shows (the start card, the piano window, MeloFi Studio).
//   profile             who is signed in, and 이 PC에서 로그아웃
//   연결된 계정         GitHub and Discord, one row each in the same grid: mark, name, state, one action
//   저장과 공유         online projects (secret gists) and 창작마당 (my works, my activity there)
// Every row is the same four columns (mark 20 | label 96 | state 1fr | action 120), so the buttons line
// up down the whole panel. MeloFi has no account of its own; account.js (main process) holds the tokens.
import { t, tdyn } from '../i18n/i18n.js';

const A = (op, payload) => window.melofi.account(op, payload);
const W = (op, payload) => window.melofi.workshop?.(op, payload) ?? Promise.resolve({ ok: false });

export const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'class') n.className = v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) n.append(c.nodeType ? c : String(c));
  return n;
};

// the two services' own marks, and two plain line marks for the storage rows (single colour, text colour)
const ICONS = {
  discord: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.865-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.74 19.74 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.058a.082.082 0 0 0 .031.056 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .078-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.009c.12.099.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>',
  github: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>',
  cloud: '<svg viewBox="0 0 16 16" aria-hidden="true" class="ln"><path d="M2.5 4.5h4l1.2 1.5h5.8v6.5h-11z"/></svg>',
  works: '<svg viewBox="0 0 16 16" aria-hidden="true" class="ln"><rect x="2.5" y="2.5" width="4.5" height="4.5"/><rect x="9" y="2.5" width="4.5" height="4.5"/><rect x="2.5" y="9" width="4.5" height="4.5"/><path d="M9 11.25h4.5M11.25 9v4.5"/></svg>',
  trace: '<svg viewBox="0 0 16 16" aria-hidden="true" class="ln"><path d="M3 4.5h10M6 4.5V3h4v1.5M4.5 4.5l.7 8.5h5.6l.7-8.5"/></svg>',
  person: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="5.2" r="3"/><path d="M2.4 14.5c.5-3 2.8-4.8 5.6-4.8s5.1 1.8 5.6 4.8z"/></svg>',
};
export const icon = (kind) => { const s = el('span', { class: 'mfa-ic' }); s.innerHTML = ICONS[kind]; return s; };

let styled = false;
function style() {
  if (styled) return;
  styled = true;
  // colours come from the host's tokens (piano and studio share them, the white theme swaps them);
  // the fallbacks are the start card's dark values
  document.head.append(el('style', {}, `
.mfa { --mfa-line: var(--line, #24252b); --mfa-line-2: var(--line-2, #30323a); --mfa-dim: var(--dim, #8b8983); --mfa-faint: var(--dim, #8b8983);
  display: grid; gap: 0; max-width: 600px; color: var(--text, #d8d5ce); font-size: 12.5px; }
.mfa-prof { display: grid; grid-template-columns: 36px 1fr auto; align-items: center; gap: 12px; padding: 4px 0 14px; }
.mfa-av { width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center; background: var(--s-raised, #22232a); color: var(--mfa-dim); font-weight: 700; font-size: 14px; }
.mfa-av.in { background: var(--accent, #e0a440); color: #1b1308; }
.mfa-av svg { width: 18px; height: 18px; fill: currentColor; }
.mfa-prof b { display: block; font-size: 14px; font-weight: 600; color: var(--s-head, #ece9e2); }
.mfa-prof small { display: block; color: var(--mfa-dim); font-size: 11.5px; margin-top: 1px; }
.mfa-sec { border-top: 1px solid var(--mfa-line); padding: 10px 0 4px; }
.mfa-sec > h4 { margin: 0 0 4px; font-size: 11px; font-weight: 600; color: var(--mfa-dim); letter-spacing: .02em; }
.mfa-row { display: grid; grid-template-columns: 20px 96px 1fr 120px; align-items: center; column-gap: 10px; min-height: 46px; padding: 6px 0; }
.mfa-row + .mfa-row { border-top: 1px solid var(--s-row-line, rgba(255,255,255,.05)); }
.mfa-row > .nm { font-weight: 600; }
.mfa-st { min-width: 0; line-height: 1.45; }
.mfa-st .on, .mfa-st .off { display: flex; align-items: center; gap: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mfa-st .on::before, .mfa-st .off::before { content: ""; flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--ok, #8fcf7d); }
.mfa-st .off { color: var(--mfa-dim); }
.mfa-st .off::before { background: var(--mfa-line-2); }
.mfa-st .on em { font-style: normal; color: var(--mfa-dim); }
.mfa-st small { display: block; color: var(--mfa-faint); font-size: 11.5px; }
.mfa-ic { display: inline-flex; width: 16px; height: 16px; flex: none; color: var(--mfa-dim); }
.mfa-ic svg { width: 100%; height: 100%; fill: currentColor; }
.mfa-ic svg.ln { fill: none; stroke: currentColor; stroke-width: 1.2; }
.mfa-act { display: flex; justify-content: flex-end; }
.mfa-b { height: 26px; min-width: 120px; padding: 0 12px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; white-space: nowrap;
  background: var(--s-ctl, #0f1013); color: var(--text, #d8d5ce); border: 1px solid var(--mfa-line-2); border-radius: 2px; font: inherit; font-size: 12px; }
.mfa-b:hover:not(:disabled) { border-color: var(--s-ctl-hover-line, #43454e); }
.mfa-b:focus-visible { outline: 1px solid var(--accent, #e0a440); outline-offset: -1px; }
.mfa-b.pri { background: var(--accent, #e0a440); border-color: var(--accent, #e0a440); color: #111; font-weight: 600; }
.mfa-b:disabled { opacity: .5; }
.mfa-b.auto { min-width: 0; }
.mfa-code { grid-column: 2 / 5; display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 12px; margin: 6px 0 2px; padding: 10px 12px;
  background: var(--s-well, rgba(0,0,0,.25)); border: 1px solid var(--mfa-line); border-radius: 2px; }
.mfa-code kbd { font: 600 18px var(--mono, Consolas, monospace); letter-spacing: 2px; user-select: all; color: var(--s-head, #ece9e2); }
.mfa-code span { color: var(--mfa-dim); font-size: 11.5px; line-height: 1.5; }
.mfa-msg { margin: 8px 0 0; min-height: 17px; font-size: 12px; color: var(--mfa-dim); }
.mfa-msg.err { color: var(--err, #e5786c); }
.mfa-foot { margin: 6px 0 0; padding-top: 10px; border-top: 1px solid var(--mfa-line); color: var(--mfa-faint); font-size: 11.5px; line-height: 1.55; }
.mfa-foot button { padding: 0; background: none; border: 0; color: var(--mfa-dim); font: inherit; text-decoration: underline; text-underline-offset: 2px; }
.mfa-link { padding: 0; background: none; border: 0; color: var(--mfa-dim); font: inherit; text-decoration: underline; text-underline-offset: 2px; }
.mfa-link:hover { color: var(--text, #d8d5ce); }
.mfa-foot button:hover { color: var(--text, #d8d5ce); }
/* the account center as a sheet in the piano window and the studio */
.mfa-sheet { z-index: 41; } /* above the workshop page (.mfw, 36) when opened from there */
.mfa-sheet .sheet-card { width: min(640px, calc(100vw - 40px)); }
.mfa-sheet .mfa-wrap { padding: 4px 20px 6px; }
`));
}

// accountCenter(container, { onChange(state), openWorkshop(where) }) → { refresh() }
// openWorkshop: the host opens 창작마당 (left out on the start card, where there is no room for it)
export function accountCenter(box, { onChange, openWorkshop, openSetup } = {}) {
  style();
  let st = null;
  let code = null; // GitHub device code on screen: { code, url }
  let msg = null;
  let projects = null; // number of online projects, once read
  let works = null; // { public, link } once read
  let gen = 0;

  const say = (text, err = true) => { msg = text ? { text: tdyn(text), err } : null; render(); };
  const changed = () => onChange?.(st);

  async function refresh() {
    const my = ++gen;
    const r = await A('state');
    st = r.ok ? r.data : { discord: null, github: null, signedIn: false, ready: {}, pending: null };
    projects = null; works = null;
    render();
    if (st.github) {
      const [p, w] = await Promise.all([A('projects'), W('mine')]);
      if (my !== gen) return st;
      projects = p.ok ? p.data.length : -1;
      works = w.ok ? { public: w.data.filter((x) => x.visibility === 'public').length, link: w.data.filter((x) => x.visibility === 'link').length } : -1;
      render();
    }
    return st;
  }

  async function discordLogin() {
    msg = { text: t('브라우저에서 디스코드 승인을 마쳐 주세요. MeloFi 디스코드 서버에 들어가면서 로그인돼요.'), err: false };
    st = { ...st, pending: 'discord' }; render();
    const r = await A('loginDiscord');
    if (r.ok) { st = r.data; say(t('디스코드로 로그인했어요. MeloFi 디스코드 서버에도 참여했어요.'), false); changed(); return; }
    st = { ...st, pending: null };
    if (r.error === 'cancelled') say(null); else say(r.message);
  }

  async function githubLogin() {
    const r = await A('githubStart');
    if (!r.ok) return say(r.message);
    code = r.data; msg = null;
    st = { ...st, pending: 'github' }; render();
    const w = await A('githubWait');
    code = null;
    if (w.ok) { st = w.data; say(t('GitHub로 로그인했어요.'), false); changed(); refresh(); return; }
    st = { ...st, pending: null };
    if (w.error === 'cancelled') say(null); else say(w.message);
  }

  async function logout(provider) {
    const r = await A('logout', provider ? { provider } : {});
    if (r.ok) { st = r.data; code = null; say(t('이 PC에서 로그아웃했어요.'), false); changed(); refresh(); }
  }

  async function openServer() {
    const r = await A('openServer');
    if (!r.ok) return say(r.message);
    if (r.data.joined) say(t('{g} 서버에 다시 들어갔어요.', { g: r.data.guild }), false);
  }

  async function forget() {
    if (!confirm(t('창작마당에 남긴 좋아요, 댓글, 신고 기록과 공개 목록에 올린 작품 등록을 모두 지울까요? 내 GitHub의 작품 파일은 그대로 남아요.'))) return;
    const r = await W('forget');
    if (!r.ok) return say(r.message);
    say(t('창작마당 기록 {n}건을 지웠어요.', { n: r.data.removed }), false);
    refresh();
  }

  const b = (label, onclick, { pri = false, disabled = false, title = null, ic = null } = {}) =>
    el('button', { class: `mfa-b${pri ? ' pri' : ''}`, type: 'button', disabled, title, onclick }, ic ? icon(ic) : null, label);
  const row = (ic, name, state, action, extra = null) => [el('div', { class: 'mfa-row' }, icon(ic), el('span', { class: 'nm' }, name), el('div', { class: 'mfa-st' }, state), el('div', { class: 'mfa-act' }, action), extra)];
  const on = (text, sub) => [el('span', { class: 'on' }, ...[].concat(text)), sub ? el('small', {}, sub) : null];
  const off = (text, sub) => [el('span', { class: 'off' }, text), sub ? el('small', {}, sub) : null];

  function accountRow(kind) {
    const u = st[kind];
    const isDiscord = kind === 'discord';
    const ready = st.ready?.[kind];
    const busy = st.pending === kind;
    const what = isDiscord ? t('MeloFi 디스코드 서버, 문제 신고, 창작마당 댓글') : t('프로젝트 온라인 저장, 창작마당 올리기');
    const who = u ? [u.name, u.handle && u.handle !== u.name ? el('em', {}, `@${u.handle}`) : null] : null;
    let action;
    if (u) action = b(t('연결 해제'), () => logout(kind));
    else if (busy) action = b(t('취소'), () => { A('cancel'); code = null; st = { ...st, pending: null }; render(); });
    else action = b(t('연결'), isDiscord ? discordLogin : githubLogin, { pri: true, disabled: !ready || !!st.pending, title: ready ? null : t('아직 준비 중이에요') });
    const extra = !isDiscord && code ? el('div', { class: 'mfa-code' },
      el('kbd', {}, code.code),
      el('span', {}, t('GitHub 페이지에 이 코드를 넣으면 연결이 끝나요. 이 창은 그대로 두세요.')),
      el('button', { class: 'mfa-b auto', type: 'button', onclick: () => { navigator.clipboard?.writeText(code.code).catch(() => {}); A('openUrl', { url: code.url }); } }, t('코드 복사하고 GitHub 열기'))) : null;
    const state = u ? on(who, what) : off(busy ? t('연결하는 중…') : t('연결 안 됨'), what);
    const r = row(kind, isDiscord ? 'Discord' : 'GitHub', state, action);
    if (extra) r[0].append(extra);
    if (u && isDiscord) r[0].querySelector('.mfa-st small').append(' · ', el('button', { type: 'button', class: 'mfa-link', onclick: openServer }, t('서버 열기')));
    return r;
  }

  function render() {
    if (!st) { box.replaceChildren(el('div', { class: 'mfa' }, el('p', { class: 'mfa-msg' }, t('불러오는 중…')))); return; }
    const u = st.github || st.discord;
    const name = u?.name || u?.handle || '';
    const sub = st.signedIn
      ? [st.github ? `GitHub @${st.github.handle}` : null, st.discord ? `Discord ${st.discord.name}` : null].filter(Boolean).join(' · ')
      : t('로그인하지 않아도 모든 연주·작곡 기능을 쓸 수 있어요.');
    const av = el('div', { class: `mfa-av${st.signedIn ? ' in' : ''}` });
    if (st.signedIn) av.textContent = name.trim().charAt(0).toUpperCase(); else av.innerHTML = ICONS.person;
    const gh = st.github;
    const nums = (n, fmt) => (n == null ? t('확인하는 중…') : n === -1 ? t('불러오지 못했어요') : fmt(n));
    box.replaceChildren(el('div', { class: 'mfa' },
      el('div', { class: 'mfa-prof' }, av,
        el('div', {}, el('b', {}, st.signedIn ? name : t('로그인하지 않음')), el('small', {}, sub)),
        st.signedIn ? b(t('모두 로그아웃'), () => logout(null)) : el('span')),
      el('section', { class: 'mfa-sec' }, el('h4', {}, t('연결된 계정')), ...accountRow('github'), ...accountRow('discord')),
      el('section', { class: 'mfa-sec' }, el('h4', {}, t('저장과 공유')),
        ...row('cloud', t('온라인 저장'),
          gh ? on(t('GitHub 비공개 Gist'), nums(projects, (n) => t('프로젝트 {n}개', { n }))) : off(t('GitHub 연결 필요'), t('작곡 프로젝트를 내 GitHub에 비공개로 저장해요')),
          b(t('Gist 열기'), () => A('openUrl', { url: `https://gist.github.com/${gh.handle}` }), { disabled: !gh })),
        ...row('works', t('창작마당'),
          gh ? on(t('내 작품'), nums(works, (w) => t('공개 {a}개 · 링크 공유 {b}개', { a: w.public, b: w.link })))
            : st.discord ? on(t('둘러보기·댓글'), t('작품을 올리려면 GitHub 연결이 필요해요')) : off(t('로그인 필요'), t('둘러보기는 로그인 없이도 돼요')),
          b(t('창작마당 열기'), () => openWorkshop?.(gh ? 'mine' : 'browse'), { disabled: !openWorkshop, title: openWorkshop ? null : t('피아노나 Studio 창의 파일 메뉴에서 열 수 있어요') })),
        ...row('trace', t('활동 기록'),
          off(t('좋아요·댓글·신고'), t('창작마당에 남긴 기록만 지워요')),
          b(t('기록 지우기'), forget, { disabled: !st.signedIn }))),
      el('p', { class: `mfa-msg${msg?.err ? ' err' : ''}`, role: 'status' }, msg?.text || ''),
      el('p', { class: 'mfa-foot' },
        t('로그아웃하면 이 PC에서만 연결이 끊겨요. 권한까지 거두려면 디스코드는 사용자 설정의 승인된 앱에서, GitHub는 '),
        el('button', { type: 'button', onclick: () => A('openGithubApps') }, t('Applications 설정')),
        t('에서 MeloFi 연결을 해제해 주세요.')),
      openSetup ? el('p', { class: 'mfa-foot' }, el('button', { type: 'button', onclick: openSetup }, t('처음 설정 다시 열기')), ' ', t('언어, 장치, 로그인, 프로필을 단계별로 다시 정해요.')) : null));
  }

  render();
  refresh();
  return { refresh, get state() { return st; } };
}

// (the start card's older name for the same panel)
export const accountPanel = (box, opts) => accountCenter(box, opts);

// While a MeloFi sheet is open, keys belong to it, not to the piano: keys typed inside it are left
// alone by app.js (data-own-keys); keys anywhere else are held back here. This listener is added when
// the module loads, before app.js binds its own, so it runs first. The newest sheet gets Escape.
const keyOwners = [];
for (const type of ['keydown', 'keyup']) {
  addEventListener(type, (e) => {
    if (!keyOwners.length) return;
    const top = keyOwners[keyOwners.length - 1];
    if (type === 'keydown' && e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); top.esc(); return; }
    if (!top.root.contains(e.target)) e.stopImmediatePropagation();
  }, true);
}
export const holdKeys = (root, onEscape = () => {}) => {
  const o = { root, esc: onEscape };
  root.setAttribute('data-own-keys', '');
  keyOwners.push(o);
  return () => { const i = keyOwners.indexOf(o); if (i >= 0) keyOwners.splice(i, 1); };
};

// The account center as a sheet over the piano window or the studio
let sheet = null;
export function openAccountCenter({ openWorkshop, openSetup } = {}) {
  style();
  sheet?.close();
  const body = el('div', { class: 'mfa-wrap' });
  const wrap = el('section', { class: 'sheet mfa-sheet', role: 'dialog', 'aria-label': t('계정') },
    el('div', { class: 'sheet-card' },
      el('div', { class: 'sheet-head' }, el('h2', {}, t('계정')), el('button', { class: 'x', 'aria-label': t('닫기'), onclick: () => close() })),
      body));
  const close = () => { wrap.remove(); release(); if (sheet?.wrap === wrap) sheet = null; };
  const release = holdKeys(wrap, () => close());
  wrap.addEventListener('pointerdown', (e) => { if (e.target === wrap) close(); });
  document.body.append(wrap);
  const panel = accountCenter(body, { openWorkshop: openWorkshop && ((w) => { close(); openWorkshop(w); }), openSetup: openSetup && (() => { close(); openSetup(); }) });
  sheet = { wrap, close, panel };
  return sheet;
}
