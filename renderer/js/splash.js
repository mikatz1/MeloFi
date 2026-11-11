// Start-up card: shows what the hidden windows are preparing (main.js forwards boot:progress), then
// asks where to go — the piano or MeloFi Studio — and holds the MeloFi account (sign in, sign up,
// nickname, password, data export, leaving).
import { T } from './strings.js';

const $ = (s) => document.querySelector(s);
const C = T.cloud;
const api = window.melofi;
const card = $('#card');

// ---------- loading ----------
let shown = 0;
const setProgress = ({ p, label, detail }) => {
  if (label) $('#label').textContent = label;
  if (detail != null) $('#detail').textContent = detail;
  if (typeof p === 'number') {
    shown = Math.max(shown, Math.min(1, p)); // never goes backwards
    $('#fill').style.width = `${(shown * 100).toFixed(1)}%`;
    $('#pct').textContent = `${Math.round(shown * 100)}%`;
  }
};
api.onBootProgress(setProgress);
api.envInfo().then((env) => { $('#ver').textContent = env?.version ? `v${env.version}` : ''; }).catch(() => {});

// ---------- where to go ----------
const LAST = 'melofi.startTarget';
const last = (() => { try { return localStorage.getItem(LAST) || 'piano'; } catch { return 'piano'; } })();
let choosing = false;

api.onBootDone(() => {
  choosing = true;
  card.dataset.state = 'choose';
  $('#status').hidden = true;
  $('#choose').hidden = false;
  for (const b of document.querySelectorAll('.opt')) { b.classList.toggle('was', b.dataset.go === last); b.classList.toggle('sel', b.dataset.go === last); }
  if ($('#acct').hidden) document.querySelector(`.opt[data-go="${last}"]`)?.focus();
});

async function go(target) {
  if (!choosing) return;
  choosing = false;
  try { localStorage.setItem(LAST, target); } catch { /* private storage */ }
  if (target === 'studio') {
    // the studio loads in its own window; the card shows its progress until it is ready
    card.dataset.state = 'loading';
    $('#choose').hidden = true;
    $('#status').hidden = false;
    shown = 0;
    setProgress({ p: 0.02, label: 'MeloFi Studio를 여는 중…', detail: '' });
  }
  await api.startChoose(target);
}

for (const b of document.querySelectorAll('.opt')) {
  b.addEventListener('click', () => go(b.dataset.go));
  // the highlighted choice follows the keyboard (Enter opens it)
  b.addEventListener('focus', () => { for (const o of document.querySelectorAll('.opt')) o.classList.toggle('sel', o === b); });
}
window.addEventListener('keydown', (e) => {
  if (!$('#acct').hidden) { if (e.key === 'Escape') closeAccount(); return; }
  if (!choosing) return;
  if (e.key === '1') go('piano');
  else if (e.key === '2') go('studio');
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    const opts = [...document.querySelectorAll('.opt')], i = opts.indexOf(document.activeElement);
    opts[(i + (e.key === 'ArrowRight' ? 1 : opts.length - 1)) % opts.length].focus();
  }
});
$('#quit').addEventListener('click', () => api.quitApp());

// ---------- account ----------
const A = (op, payload) => api.account(op, payload);
let st = null;          // { server, user, signedIn }
let mode = 'login';     // server | login | signup | me
let docs = null;        // consent documents for sign-up
let agree = {}, openDoc = {};
let msg = null;

const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'class') n.className = v;
    else if (k in n && typeof v !== 'string') n[k] = v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) n.append(c.nodeType ? c : String(c));
  return n;
};
const field = (label, attrs = {}) => { const input = el('input', { class: 'in', ...attrs }); return [el('label', { class: 'f' }, el('span', {}, label), input), input]; };
const say = (text, err = true) => { msg = { text, err }; render(); };
const initial = (u) => (u?.nickname || u?.email || '?').trim().charAt(0).toUpperCase();

async function refreshWho() {
  const r = await A('state');
  st = r.ok ? r.data : { server: '', user: null, signedIn: false };
  const who = $('#who');
  who.hidden = false;
  who.classList.toggle('in', !!st.signedIn);
  who.classList.toggle('out', !st.signedIn);
  who.replaceChildren(...(st.signedIn ? [el('i', {}, initial(st.user)), st.user?.nickname || st.user?.email || '내 계정'] : ['로그인']));
  who.title = st.signedIn ? `${st.user?.email || ''} · 계정 관리` : '로그인하면 프로젝트 저장과 공유가 가능해요.';
}

function openAccount() {
  msg = null;
  mode = !st?.server ? 'server' : st.signedIn ? 'me' : 'login';
  $('#acct').hidden = false;
  render();
}
function closeAccount() {
  $('#acct').hidden = true;
  refreshWho();
  if (choosing) document.querySelector(`.opt[data-go="${last}"]`)?.focus();
}
$('#who').addEventListener('click', openAccount);
$('#back').addEventListener('click', closeAccount);

function render() {
  const body = $('#acctBody');
  const parts = [];
  if (mode === 'server') parts.push(serverView());
  else if (!st?.signedIn) {
    parts.push(el('div', { class: 'tabs' },
      el('button', { class: mode === 'login' ? 'on' : '', onclick: () => { mode = 'login'; msg = null; render(); } }, C.login),
      el('button', { class: mode === 'signup' ? 'on' : '', onclick: () => { mode = 'signup'; msg = null; render(); } }, C.signup)));
    parts.push(mode === 'signup' ? signupView() : loginView());
  } else parts.push(meView());
  if (msg) parts.push(el('p', { class: `msg${msg.err ? ' err' : ''}` }, msg.text));
  body.replaceChildren(...parts);
  body.querySelector('input:not([type=checkbox])')?.focus();
}

function serverView() {
  const [f, input] = field(C.serverAddr, { value: st?.server || '', placeholder: 'https://' });
  const save = async () => {
    const r = await A('setServer', { url: input.value });
    if (!r.ok) return say(r.message);
    st = r.data; mode = 'login'; msg = null; render();
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
  return el('div', {}, el('p', { class: 'note' }, C.serverText), f, el('div', { class: 'btns' }, el('button', { class: 'btn primary', onclick: save }, C.saveServer)));
}

function loginView() {
  const [f1, email] = field(C.email, { type: 'email', autocomplete: 'username' });
  const [f2, pw] = field(C.password, { type: 'password', autocomplete: 'current-password' });
  const submit = async () => {
    const r = await A('login', { email: email.value, password: pw.value });
    if (!r.ok) return say(r.message);
    st = { ...st, user: r.data, signedIn: true };
    mode = 'me'; msg = { text: `${r.data?.nickname || ''} 님, 환영해요.`, err: false };
    render(); refreshWho();
  };
  pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  return el('div', {}, el('p', { class: 'note' }, C.why), f1, f2,
    el('div', { class: 'btns' }, el('button', { class: 'btn primary', onclick: submit }, C.login), el('span', { class: 'sp' }),
      el('button', { class: 'lnk', onclick: () => { mode = 'server'; msg = null; render(); } }, C.serverAddr)));
}

function signupView() {
  if (docs === false) { // the server did not answer: say so and offer to try again
    return el('div', {}, el('p', { class: 'note' }, '약관을 불러오지 못했어요. 서버 주소와 네트워크 연결 상태를 확인해 주세요.'),
      el('div', { class: 'btns' }, el('button', { class: 'btn', onclick: () => { docs = null; msg = null; render(); } }, '다시 시도'), el('span', { class: 'sp' }),
        el('button', { class: 'lnk', onclick: () => { mode = 'server'; msg = null; render(); } }, C.serverAddr)));
  }
  if (!docs) {
    A('consents').then((r) => { docs = r.ok ? r.data : false; if (!r.ok) msg = { text: r.message, err: true }; render(); });
    return el('p', { class: 'note' }, C.loading);
  }
  const [f1, email] = field(C.email, { type: 'email', autocomplete: 'username' });
  const [f2, pw] = field(C.passwordNew, { type: 'password', autocomplete: 'new-password' });
  const [f3, pw2] = field(C.passwordAgain, { type: 'password', autocomplete: 'new-password' });
  const [f4, nick] = field(C.nickname, { maxlength: 24 });
  const order = ['age', 'terms', 'privacy', 'marketing'].filter((k) => docs[k]);
  const required = order.filter((k) => docs[k].required);
  const submit = el('button', { class: 'btn primary', disabled: !required.every((k) => agree[k]) }, C.signupGo);
  // ticking a box re-renders: keep what was typed
  const keep = () => [email.value, pw.value, pw2.value, nick.value];
  const rerender = (fn) => { const v = keep(); fn(); render(); const ins = [...$('#acctBody').querySelectorAll('input.in')]; [ins[0].value, ins[1].value, ins[2].value, ins[3].value] = v; };
  const item = (k) => {
    const d = docs[k];
    return [
      el('div', { class: 'item' },
        el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: !!agree[k], onchange: (e) => rerender(() => { agree[k] = e.target.checked; }) }),
          el('span', { class: d.required ? 'req' : 'opt-t' }, d.required ? C.req : C.opt), d.title),
        d.body?.length || d.table ? el('button', { class: 'lnk', onclick: () => rerender(() => { openDoc[k] = !openDoc[k]; }) }, openDoc[k] ? C.hide : C.view) : null),
      openDoc[k] ? el('div', { class: 'doc' },
        d.table ? el('table', {}, ...d.table.map(([a, b]) => el('tr', {}, el('th', {}, a), el('td', {}, b)))) : null,
        ...(d.body || []).map((t) => el('p', {}, t))) : null,
    ];
  };
  submit.addEventListener('click', async () => {
    if (pw.value !== pw2.value) return rerender(() => { msg = { text: C.pwMismatch, err: true }; });
    const consents = {};
    for (const k of order) if (agree[k]) consents[k] = docs[k].version;
    const r = await A('signup', { email: email.value, password: pw.value, nickname: nick.value, consents });
    if (!r.ok) { rerender(() => { msg = { text: r.message, err: true }; }); return; } // keep what was typed
    agree = {}; openDoc = {};
    st = { ...st, user: r.data, signedIn: true };
    mode = 'me'; msg = { text: C.welcome(r.data.nickname), err: false };
    render(); refreshWho();
  });
  return el('div', {}, f1, f2, f3, f4,
    el('div', { class: 'consent' },
      el('label', { class: 'chk all' }, el('input', { type: 'checkbox', checked: order.every((k) => agree[k]), onchange: (e) => rerender(() => { for (const k of order) agree[k] = e.target.checked; }) }), C.agreeAll),
      ...order.flatMap(item)),
    el('div', { class: 'btns' }, submit, el('span', { class: 'sp' }), el('button', { class: 'lnk', onclick: () => A('openPolicy') }, C.policy)));
}

function meView() {
  const u = st.user || {};
  const [f1, nick] = field(C.nickname, { value: u.nickname || '', maxlength: 24 });
  const [f2, cur] = field(C.passwordNow, { type: 'password', autocomplete: 'current-password' });
  const [f3, nw] = field(C.passwordNew, { type: 'password', autocomplete: 'new-password' });
  const upd = async (patch, ok) => {
    const r = await A('update', patch);
    if (!r.ok) return say(r.message);
    st.user = r.data; msg = { text: ok, err: false }; render(); refreshWho();
  };
  const today = new Date().toLocaleDateString('ko-KR');
  let leaving = false;
  const leave = el('div', { class: 'grp', hidden: true });
  const [f4, pwLeave] = field(C.passwordNow, { type: 'password', autocomplete: 'current-password' });
  leave.append(el('p', { class: 'note' }, C.deleteAccountAsk), f4,
    el('div', { class: 'btns' }, el('button', { class: 'btn danger', onclick: async () => {
      const r = await A('deleteAccount', { password: pwLeave.value });
      if (!r.ok) return say(r.message);
      st = { ...st, user: null, signedIn: false }; mode = 'login'; msg = { text: C.deleted, err: false }; render(); refreshWho();
    } }, C.deleteAccount)));
  return el('div', {},
    el('div', { class: 'me' }, el('i', {}, initial(u)), el('div', {}, el('b', {}, u.nickname || ''), el('span', {}, u.email || ''))),
    el('div', { class: 'grp' }, f1, el('div', { class: 'btns' }, el('button', { class: 'btn', onclick: () => upd({ nickname: nick.value }, C.nickSaved) }, C.change))),
    el('div', { class: 'grp' },
      el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: !!u.marketing, onchange: (e) => upd({ marketing: e.target.checked }, e.target.checked ? C.mkOn(today) : C.mkOff(today)) }), C.marketing),
      el('p', { class: 'note', style: 'margin:6px 0 0' }, C.marketingText)),
    el('div', { class: 'grp' }, f2, f3, el('div', { class: 'btns' }, el('button', { class: 'btn', onclick: () => upd({ password: cur.value, newPassword: nw.value }, C.pwChanged) }, C.changePw))),
    el('div', { class: 'grp' }, el('div', { class: 'btns' },
      el('button', { class: 'btn', onclick: async () => { const r = await A('exportData'); if (!r.ok) return say(r.message); msg = { text: C.exported, err: false }; render(); api.showItem?.(r.data); } }, C.exportData),
      el('button', { class: 'btn', onclick: async () => { await A('logout'); st = { ...st, user: null, signedIn: false }; mode = 'login'; msg = { text: '로그아웃되었어요.', err: false }; render(); refreshWho(); } }, C.logout),
      el('span', { class: 'sp' }),
      el('button', { class: 'lnk', onclick: () => { leaving = !leaving; leave.hidden = !leaving; } }, C.deleteAccount))),
    leave);
}

refreshWho();
