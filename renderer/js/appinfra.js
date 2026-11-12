// Update notice, 문제 신고 dialog and their menu entries; used by the piano and the studio window.
// Loaded once from index.html; ui.js and studio.js take the menu entries from here.
import { t, tdyn } from '../i18n/i18n.js';

const api = window.melofi;

const CSS = `
.mf-upd { position: fixed; right: 12px; bottom: 12px; z-index: 9000; display: flex; align-items: center; gap: 10px;
  min-width: 230px; max-width: 380px; padding: 7px 8px 7px 12px; background: var(--panel-2, #191a1f); color: var(--text, #d8d5ce);
  border: 1px solid var(--line-2, #30323a); border-radius: 3px; box-shadow: 0 6px 22px #0009; font: 12px/1.4 var(--ui, sans-serif); user-select: none; }
.mf-upd .t { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mf-upd .t small { color: var(--dim, #8b8983); margin-left: 6px; }
.mf-upd button { height: 22px; padding: 0 9px; border: 1px solid var(--line-2, #30323a); border-radius: 2px; background: var(--s-ctl-2, #0d0e12); color: inherit; font: inherit; }
.mf-upd button:hover { border-color: var(--accent, #e0a440); }
.mf-upd button.go { background: var(--accent, #e0a440); border-color: var(--accent, #e0a440); color: #0b0b0b; }
.mf-upd button.x { width: 22px; padding: 0; border-color: transparent; background: none; color: var(--dim, #8b8983); }
.mf-upd .bar { position: absolute; left: 0; right: 0; bottom: 0; height: 2px; background: #0005; }
.mf-upd .bar i { display: block; height: 100%; width: 0; background: var(--accent, #e0a440); transition: width .2s linear; }
.mf-rep { position: fixed; inset: 0; z-index: 9100; display: grid; place-items: center; background: #0008; font: 12.5px/1.45 var(--ui, sans-serif); color: var(--text, #d8d5ce); }
.mf-rep .box { width: min(620px, calc(100vw - 32px)); max-height: calc(100vh - 48px); display: flex; flex-direction: column; gap: 8px;
  padding: 14px 16px 12px; background: var(--panel, #131418); border: 1px solid var(--line-2, #30323a); border-radius: 3px; box-shadow: 0 12px 40px #000a; }
.mf-rep h3 { margin: 0; font-size: 14px; font-weight: 600; }
.mf-rep p { margin: 0; color: var(--dim, #8b8983); }
.mf-rep textarea { height: 84px; resize: vertical; padding: 6px 8px; background: var(--s-well, #0b0c0f); color: inherit; border: 1px solid var(--line-2, #30323a); border-radius: 2px; font: inherit; user-select: text; }
.mf-rep textarea:focus { outline: none; border-color: var(--accent, #e0a440); }
.mf-rep .lbl { margin-top: 2px; color: var(--dim, #8b8983); font-size: 11.5px; }
.mf-rep pre { margin: 0; padding: 6px 8px; overflow: auto; background: var(--s-well, #0b0c0f); border: 1px solid var(--line, #24252b); border-radius: 2px;
  font: 11px/1.45 var(--mono, monospace); color: var(--s-body-2, #bdbab3); white-space: pre-wrap; word-break: break-all; user-select: text; }
.mf-rep pre.sys { max-height: 120px; }
.mf-rep pre.err { max-height: 170px; min-height: 40px; }
.mf-rep .row { display: flex; align-items: center; gap: 6px; margin-top: 4px; }
.mf-rep .row .sp { flex: 1; }
.mf-rep .row button { height: 26px; padding: 0 12px; border: 1px solid var(--line-2, #30323a); border-radius: 2px; background: var(--s-ctl-2, #0d0e12); color: inherit; font: inherit; }
.mf-rep .row button:hover { border-color: var(--accent, #e0a440); }
.mf-rep .row button.go { background: var(--accent, #e0a440); border-color: var(--accent, #e0a440); color: #0b0b0b; }
.mf-rep .row button.link { border-color: transparent; background: none; color: var(--dim, #8b8983); padding: 0 4px; }
.mf-rep .done { min-height: 18px; color: var(--accent, #e0a440); word-break: break-all; }
`;

function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'class') e.className = v;
    else e.setAttribute(k, v);
  }
  for (const c of kids) if (c != null) e.append(c);
  return e;
}

let styled = false;
function style() {
  if (styled) return;
  styled = true;
  document.head.append(el('style', {}, CSS));
}


// ---------- update notice ----------
let bar = null, askedHere = false, hideT = 0, version = '';

function closeBar() { clearTimeout(hideT); bar?.remove(); bar = null; }

function showBar(text, buttons = [], { percent = null, autoHide = 0 } = {}) {
  style();
  closeBar();
  bar = el('div', { class: 'mf-upd', role: 'status' }, el('span', { class: 't' }, ...text));
  for (const b of buttons) bar.append(el('button', { class: b.cls || '', onclick: b.act, title: b.title || '' }, b.label));
  bar.append(el('button', { class: 'x', title: t('닫기'), onclick: () => { closeBar(); api.updateDismiss?.(); } }, '×'));
  if (percent != null) { const i = el('i'); i.style.width = `${percent}%`; bar.append(el('div', { class: 'bar' }, i)); }
  document.body.append(bar);
  if (autoHide) hideT = setTimeout(closeBar, autoHide);
}

export function showUpdateState(s) { onState(s); } // (tests, screenshots)
function onState(s) {
  if (!s) return;
  version = s.current || version;
  const mine = askedHere; // results of a check started from this window
  if (s.phase !== 'checking') askedHere = false;
  switch (s.phase) {
    case 'available':
      // 0.3.0이 / 0.3.2가: t() picks the particle after the last digit as it is read
      return showBar([t('새 버전 {v}이(가) 있어요', { v: s.version })], [{ label: t('받기'), cls: 'go', act: () => api.updateDownload() }]);
    case 'downloading':
      return showBar([t('새 버전 받는 중'), el('small', {}, `${s.percent || 0}%`)], [], { percent: s.percent || 0 });
    case 'ready':
      return showBar([t('다시 시작하면 적용돼요'), el('small', {}, s.version)], [{ label: t('지금 다시 시작'), cls: 'go', act: () => api.updateRestart() }]);
    case 'error':
      if (s.version) return showBar([tdyn(s.message) || t('받지 못했어요')], [{ label: t('다시 받기'), act: () => api.updateDownload() }]);
      if (mine) return showBar([tdyn(s.message) || t('업데이트를 확인하지 못했어요')], [], { autoHide: 6000 });
      return;
    case 'checking':
      if (mine) showBar([t('업데이트 확인 중…')]);
      return;
    case 'latest':
      if (mine) showBar([t('최신 버전이에요'), el('small', {}, s.current)], [], { autoHide: 4000 });
      return;
    case 'dev':
      if (mine) showBar([t('개발 실행에서는 업데이트를 확인하지 않아요')], [], { autoHide: 4000 });
      return;
    default:
      if (bar && !bar.querySelector('button.go')) closeBar();
  }
}

export function checkForUpdates() {
  askedHere = true;
  return api.updateCheck?.();
}

// ---------- 문제 신고 ----------
// While the dialog is open the keys are for typing, not for the piano: this listener is added when
// the module loads (before app.js binds its own), so it runs first and keeps them from the piano.
let dialogKeys = null;
for (const type of ['keydown', 'keyup']) {
  addEventListener(type, (e) => { if (!dialogKeys) return; e.stopImmediatePropagation(); dialogKeys(e); }, true);
}
export async function openReport() {
  style();
  document.querySelector('.mf-rep')?.remove();
  const info = await api.reportInfo().catch(() => ({ system: {}, errors: [] }));
  const desc = el('textarea', { placeholder: t('무엇을 하다가 어떤 일이 있었는지 적어 주세요'), spellcheck: 'false' });
  const done = el('div', { class: 'done' });
  const sys = Object.entries(info.system || {}).map(([k, v]) => `${k}: ${v}`).join('\n');
  const errs = info.errors || [];
  const busy = (on) => wrap.querySelectorAll('.row button').forEach((b) => { b.disabled = on; });
  const close = () => { wrap.remove(); dialogKeys = null; };
  dialogKeys = (e) => { if (e.type === 'keydown' && e.key === 'Escape') { e.preventDefault(); close(); } };
  const run = async (fn) => {
    busy(true);
    try { done.textContent = await fn(); } catch (err) { done.textContent = t('실패했어요: {err}', { err: tdyn(err?.message || err) }); }
    busy(false);
  };
  const wrap = el('div', { class: 'mf-rep', role: 'dialog', 'aria-label': t('문제 신고'), onpointerdown: (e) => { if (e.target === wrap) close(); } },
    el('div', { class: 'box' },
      el('h3', {}, t('문제 신고')),
      el('p', {}, t('아래에 보이는 내용만 담겨요. 버튼을 누르기 전에는 어디로도 보내지 않아요. 사용자 이름과 폴더 경로는 가려져요.')),
      desc,
      el('div', { class: 'lbl' }, t('시스템')),
      el('pre', { class: 'sys' }, sys || '-'),
      el('div', { class: 'lbl' }, errs.length ? t('최근 오류 {n}개', { n: errs.length }) : t('최근 오류')),
      el('pre', { class: 'err' }, errs.length ? errs.join('\n') : t('기록된 오류가 없어요')),
      done,
      el('div', { class: 'row' },
        el('button', { class: 'link', title: t('이 PC에 남은 기록 (userData/logs)'), onclick: () => api.openLogs() }, t('로그 폴더')),
        el('span', { class: 'sp' }),
        el('button', { onclick: close }, t('닫기')),
        el('button', { title: t('브라우저에서 내용이 채워진 GitHub 이슈 작성 페이지를 열어요. 올리기는 거기서 직접 눌러요.'), onclick: () => run(async () => { await api.reportGithub(desc.value); return t('브라우저에 이슈 작성 페이지를 열었어요. 확인하고 올려 주세요.'); }) }, t('GitHub 이슈로')),
        el('button', { class: 'go', title: t('문서\\MeloFi 폴더에 .txt로 저장'), onclick: () => run(async () => t('저장했어요 · {file}', { file: await api.reportSave(desc.value) })) }, t('파일로 저장')),
      )));
  document.body.append(wrap);
  desc.focus();
}

// ---------- menu entries (same item shape in the piano menus and the studio popup) ----------
let autoCheck = true;
api?.loadSettings?.().then((s) => { if (s && s.updateCheck === false) autoCheck = false; }).catch(() => {});
api?.onSettingsChanged?.((p) => { if (p && 'updateCheck' in p) autoCheck = p.updateCheck !== false; });

export function infraMenuItems() {
  return [
    { label: t('업데이트 확인'), hint: version ? `v${version}` : '', act: () => checkForUpdates() },
    { label: t('시작할 때 업데이트 확인'), check: autoCheck ? 'tick' : '', act: () => { autoCheck = !autoCheck; api.saveSettings({ updateCheck: autoCheck }); } },
    { label: t('문제 신고…'), act: () => openReport() },
  ];
}

if (api?.onUpdateState) {
  api.onUpdateState(onState);
  // a window opened after the update was found shows it too
  api.updateState().then((s) => { version = s?.current || version; if (s && ['available', 'downloading', 'ready'].includes(s.phase)) onState(s); }).catch(() => {});
}
