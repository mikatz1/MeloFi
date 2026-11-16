// Start-up card: shows what the hidden windows are preparing (main.js forwards boot:progress), then
// asks where to go — the piano or MeloFi Studio — and holds the account panel (Discord / GitHub
// sign-in, js/accounts-ui.js).
import { accountPanel } from './accounts-ui.js';
import { openFirstRun, splashHost, setupProgress, isNewInstall } from './firstrun.js';
import { t, tc, tdyn, locale, langChoices, langPref, setLangPref, onLangChange } from '../i18n/i18n.js';

const $ = (s) => document.querySelector(s);
const api = window.melofi;
const card = $('#card');

// ---------- loading ----------
let shown = 0;
const setProgress = ({ p, label, detail }) => {
  if (label) $('#label').textContent = tdyn(label);
  if (detail != null) $('#detail').textContent = tdyn(detail);
  if (typeof p === 'number') {
    shown = Math.max(shown, Math.min(1, p)); // never goes backwards
    $('#fill').style.width = `${(shown * 100).toFixed(1)}%`;
    $('#pct').textContent = `${Math.round(shown * 100)}%`;
  }
};
api.onBootProgress(setProgress);
api.envInfo().then((env) => { const v = env?.version ? `v${env.version}` : ''; $('#ver').textContent = v; document.querySelector('.mini-ver').textContent = v; }).catch(() => {});

// ---------- where to go ----------
const LAST = 'melofi.startTarget';
const last = (() => { try { return localStorage.getItem(LAST) || 'piano'; } catch { return 'piano'; } })();
let choosing = false;

// what was opened last on each side, under its card
async function fillRecent() {
  const when = (t) => (t ? new Date(t).toLocaleDateString(locale(), { month: 'long', day: 'numeric' }) : '');
  const put = (k, label, item, none) => {
    const el2 = document.querySelector(`[data-recent="${k}"]`);
    el2.replaceChildren(...(item ? [`${label} `, Object.assign(document.createElement('b'), { textContent: item.name }), item.at ? ` · ${when(item.at)}` : ''] : [none]));
  };
  try { const s = await api.recentScores(); put('piano', tc('start', '최근 악보'), s?.[0], t('최근 열어본 악보가 없어요')); } catch { /* none */ }
  try { const p = await api.studioRecent(); put('studio', tc('start', '최근 프로젝트'), p?.[0], t('저장된 프로젝트가 없어요')); } catch { /* none */ }
}

api.onBootDone(async () => {
  // a new install goes through 처음 설정 first (js/firstrun.js); it can be left at any step
  const settings = await api.loadSettings().catch(() => null);
  const prog = setupProgress(settings);
  // a new install, or one closed in the middle of 처음 설정 (resumes at its step); not once the
  // person chose 나중에 마저 하기, and never for someone who used MeloFi before it existed
  const started = !!settings?.firstRun;
  if (!prog.finished && !prog.fr.left && (isNewInstall(settings) || started)) { await openSetup(); return; }
  showChoose();
});

async function openSetup(step = null) {
  choosing = false;
  await api.splashResize?.(960, 640);
  card.dataset.state = 'setup';
  for (const id of ['#status', '#choose', '#acct', '#who', '#setupBtn']) $(id).hidden = true;
  $('#setup').hidden = false;
  await openFirstRun(splashHost(), { into: $('#setup'), step, onClose: async (finished) => {
    $('#setup').hidden = true;
    if (!finished) await api.saveSettings({ firstRun: { ...((await api.loadSettings())?.firstRun || {}), left: true } }); // left midway: not forced again
    showChoose();
  } });
}

async function paintSetupBtn() {
  const prog = setupProgress(await api.loadSettings().catch(() => null));
  const b = $('#setupBtn');
  b.hidden = !choosing || prog.finished || !prog.left;
  b.textContent = t('설정 마무리하기 · {n}단계 남음', { n: prog.left });
  b.title = t('처음 설정에서 남은 단계를 이어서 해요');
}
$('#setupBtn').addEventListener('click', () => openSetup());

async function showChoose() {
  choosing = true;
  await api.splashResize?.(900, 580); // the choice gets a screen of its own
  paintSetupBtn();
  card.dataset.state = 'choose';
  $('#status').hidden = true;
  $('#choose').hidden = false;
  refreshWho();
  fillRecent();
  for (const b of document.querySelectorAll('.opt')) { b.classList.toggle('was', b.dataset.go === last); b.classList.toggle('sel', b.dataset.go === last); }
  if ($('#acct').hidden) document.querySelector(`.opt[data-go="${last}"]`)?.focus();
}

async function go(target) {
  if (!choosing) return;
  choosing = false;
  try { localStorage.setItem(LAST, target); } catch { /* private storage */ }
  if (target === 'studio') {
    // the studio loads in its own window; the card shows its progress until it is ready
    card.dataset.state = 'loading';
    $('#who').hidden = true;
    $('#acct').hidden = true;
    $('#choose').hidden = true;
    $('#status').hidden = false;
    shown = 0;
    setProgress({ p: 0.02, label: t('MeloFi Studio를 여는 중…'), detail: '' });
  }
  await api.startChoose(target);
}

for (const b of document.querySelectorAll('.opt')) {
  b.addEventListener('click', () => go(b.dataset.go));
  // the highlighted choice follows the keyboard (Enter opens it)
  b.addEventListener('focus', () => { for (const o of document.querySelectorAll('.opt')) o.classList.toggle('sel', o === b); });
}
window.addEventListener('keydown', (e) => {
  if (!$('#setup').hidden) return; // 처음 설정 handles its own keys
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

// ---------- account (Discord / GitHub sign-in; js/accounts-ui.js) ----------
let st = null; // account state from account.js
let panel = null;

// a plain head-and-shoulders mark for the signed-out profile
function personIcon() {
  const i = document.createElement('i');
  i.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="5.2" r="3"/><path d="M2.4 14.5c.5-3 2.8-4.8 5.6-4.8s5.1 1.8 5.6 4.8z"/></svg>';
  return i;
}
const primary = (s) => s?.discord || s?.github || null;

async function refreshWho(fresh) {
  if (fresh) st = fresh;
  else { const r = await api.account('state'); st = r.ok ? r.data : null; }
  const who = $('#who');
  // the profile shows on the choice screen only, never while loading
  who.hidden = !choosing;
  who.classList.toggle('in', !!st?.signedIn);
  who.classList.remove('out');
  const u = primary(st);
  const name = u?.name || u?.handle || '';
  const i = document.createElement('i');
  i.textContent = (name || '?').trim().charAt(0).toUpperCase();
  const chev = document.createElement('span');
  chev.className = 'chev'; chev.textContent = '▾';
  who.replaceChildren(...(st?.signedIn ? [i, name || t('내 계정'), chev] : [personIcon(), t('로그인 · 계정'), chev]));
  who.title = st?.signedIn ? t('계정 연결 열기') : t('디스코드나 GitHub로 로그인할 수 있어요');
}

function openAccount() {
  $('#acct').hidden = false;
  if (!panel) panel = accountPanel($('#acctBody'), { onChange: (s) => refreshWho(s) });
  else panel.refresh();
}
function closeAccount() {
  $('#acct').hidden = true;
  refreshWho();
  if (choosing) document.querySelector(`.opt[data-go="${last}"]`)?.focus();
}
$('#who').addEventListener('click', openAccount);
$('#back').addEventListener('click', closeAccount);

refreshWho();

// ---------- language (한국어 / English / the system's) ----------
const langSel = $('#lang');
function fillLang() {
  langSel.replaceChildren(...langChoices().map(([k, label]) => Object.assign(document.createElement('option'), { value: k, textContent: label })));
  langSel.value = langPref();
  langSel.title = t('언어');
  langSel.setAttribute('aria-label', t('언어'));
}
fillLang();
langSel.addEventListener('change', () => {
  api.saveSettings({ lang: langSel.value }); // the other windows and main follow (settings:changed)
  setLangPref(langSel.value);
});
onLangChange(() => {
  fillLang();
  refreshWho();
  if (choosing) fillRecent();
  if (!$('#acct').hidden) panel?.refresh();
});
