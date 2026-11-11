// Instrument picker window. Opened by the piano window (stays open: every click switches the
// instrument, so you can audition) or by MeloFi Studio for a channel (closes once you pick).
// Instruments that are not installed can be downloaded right here.
import { T } from './strings.js';
import { haystack, matches } from './search.js';
import { t, tdyn, N_, onLangChange } from '../i18n/i18n.js';

const $ = (s) => document.querySelector(s);
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : String(c));
  return el;
};
const mb = (b) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1e6))} MB`);
const FAMILY_ORDER = ['piano', 'keys', 'organ', 'synth', 'strings', 'brass', 'winds', 'vocal', 'guitar', 'bass', 'mallets', 'world', 'drums', 'fx', 'mfsynth'];
const FAMILY_NAMES = { mfsynth: N_('MeloFi 신스 프리셋') };
const api = window.melofi;

const state = { opts: {}, list: [], hay: new Map(), q: '', family: 'all', installedOnly: false, sel: null, dl: new Map() };

async function load() {
  state.list = await api.listInstruments();
  state.hay = new Map(state.list.map((i) => [i.id, haystack(i, T)]));
  for (const i of state.list) if (i.downloading && !state.dl.has(i.id)) state.dl.set(i.id, 0);
}

// MeloFi Synth presets (sent by the studio) appear as their own family, grouped by category
function withSynths() {
  state.list = state.list.filter((i) => i.family !== 'mfsynth');
  (state.opts.synths || []).forEach((p, k) => state.list.push({ id: p.id, name: p.name, model: t('신스 · {cat}', { cat: t(p.cat) }), use: t('편집 가능한 신시사이저'), family: 'mfsynth', installed: true, order: k, cat: p.cat }));
  for (const i of state.list) if (i.family === 'mfsynth') state.hay.set(i.id, haystack({ ...i, name: `${i.name} ${i.cat} ${t(i.cat)} 신스 synth` }, T)); // i18n-ignore (search words)
}

function setup(opts) {
  state.opts = opts || {};
  withSynths();
  $('#pkFor').textContent = state.opts.title ? `· ${tdyn(state.opts.title)}` : '';
  const head = tdyn(state.opts.heading) || t('악기 선택'); // the studio calls it the plugin picker, as FL Studio does
  document.querySelector('.pk-title').textContent = head;
  document.title = state.opts.title ? `${head} · ${tdyn(state.opts.title)}` : head;
  state.sel = state.opts.current || state.sel;
  $('#pkHint').textContent = state.opts.closeOnPick ? t('클릭하거나 Enter로 선택 · Esc 닫기') : t('클릭하면 바로 바뀝니다 · Esc 닫기');
  render(true);
}

function visible() {
  return state.list.filter((i) => (state.family === 'all' || (i.family || 'piano') === state.family)
    && (!state.installedOnly || i.installed)
    && (!state.q || matches(state.q, state.hay.get(i.id))));
}

function render(scrollToSel = false) {
  // families with counts (for the current search)
  const base = state.list.filter((i) => (!state.installedOnly || i.installed) && (!state.q || matches(state.q, state.hay.get(i.id))));
  const count = (f) => base.filter((i) => (i.family || 'piano') === f).length;
  const fams = FAMILY_ORDER.filter((f) => state.list.some((i) => (i.family || 'piano') === f));
  $('#pkFam').replaceChildren(
    h('button', { class: state.family === 'all' ? 'on' : '', onclick: () => { state.family = 'all'; render(); } }, t('전체'), h('small', {}, base.length)),
    ...fams.map((f) => h('button', { class: state.family === f ? 'on' : '', onclick: () => { state.family = f; render(); } }, (FAMILY_NAMES[f] && t(FAMILY_NAMES[f])) || T.families[f] || f, h('small', {}, count(f)))));

  const items = visible();
  const list = $('#pkList');
  if (!items.length) { list.replaceChildren(h('li', { class: 'pk-empty' }, t('찾는 악기가 없습니다. 다른 이름이나 초성으로 검색해 보세요.'))); return; }
  const rows = [];
  let lastFam = null;
  for (const i of [...items].sort((a, b) => FAMILY_ORDER.indexOf(a.family || 'piano') - FAMILY_ORDER.indexOf(b.family || 'piano') || a.order - b.order)) {
    const fam = i.family || 'piano';
    const grp = fam === 'mfsynth' ? `${t(FAMILY_NAMES.mfsynth)} · ${t(i.cat)}` : fam;
    if ((state.family === 'all' || fam === 'mfsynth') && grp !== lastFam) { rows.push(h('li', { class: 'pk-group' }, fam === 'mfsynth' ? grp : T.families[fam] || fam)); lastFam = grp; }
    const cur = i.id === state.opts.current;
    const dl = state.dl.get(i.id);
    const st = cur ? h('span', { class: 'st cur' }, t('사용 중'))
      : i.installed ? h('span', { class: 'st' }, '')
        : dl != null ? h('button', { class: 'pk-btn', onclick: (e) => { e.stopPropagation(); cancel(i.id); } }, t('{p}% · 취소', { p: Math.round(dl * 100) }))
          : h('button', { class: 'pk-btn', onclick: (e) => { e.stopPropagation(); download(i.id); } }, t('받기 · {size}', { size: mb(i.size) }));
    rows.push(h('li', {
      class: `pk-row${i.installed ? '' : ' off'}${cur ? ' cur' : ''}${state.sel === i.id ? ' sel' : ''}`, role: 'option', 'data-id': i.id,
      title: t(i.use || ''),
      onclick: () => { state.sel = i.id; if (i.installed) choose(i.id); else render(); },
    }, h('div', { class: 'nm' }, h('b', {}, i.name), h('span', {}, [i.model, i.use].filter(Boolean).map((x) => t(x)).join(' · '))), st));
  }
  list.replaceChildren(...rows);
  if (scrollToSel && state.sel) list.querySelector(`[data-id="${CSS.escape(state.sel)}"]`)?.scrollIntoView({ block: 'center' });
}

async function choose(id) {
  state.opts.current = id;
  render();
  await api.pickerChoose(id);
}

async function download(id) {
  state.dl.set(id, 0);
  render();
  const r = await api.downloadInstrument(id);
  state.dl.delete(id);
  await load();
  render();
  if (r && r.ok === false && !r.cancelled) $('#pkHint').textContent = t('다운로드하지 못했습니다. 인터넷 연결을 확인해 주세요.');
}
async function cancel(id) { await api.cancelDownload(id); state.dl.delete(id); render(); }

api.onInstrumentProgress((p) => {
  if (!p?.id) return;
  const x = p.total ? p.done / p.total : 0;
  state.dl.set(p.id, x);
  const row = $(`#pkList [data-id="${CSS.escape(p.id)}"] .pk-btn`);
  if (row) row.textContent = t('{p}% · 취소', { p: Math.round(x * 100) });
});

// keyboard: type to search, arrows to move, Enter to pick, Esc to close
document.addEventListener('keydown', (e) => {
  const search = $('#pkSearch');
  if (e.key === 'Escape') { if (search.value) { search.value = ''; state.q = ''; render(); } else window.close(); return; }
  const items = visible().filter((i) => i.installed);
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const order = [...$('#pkList').querySelectorAll('.pk-row')].map((r) => r.dataset.id).filter((id) => items.some((i) => i.id === id));
    const k = order.indexOf(state.sel);
    state.sel = order[Math.max(0, Math.min(order.length - 1, k + (e.key === 'ArrowDown' ? 1 : -1)))] || order[0];
    render(true);
    return;
  }
  if (e.key === 'Enter' && state.sel && items.some((i) => i.id === state.sel)) { e.preventDefault(); choose(state.sel); return; }
  if (e.key.length === 1 && !e.ctrlKey && !e.altKey && document.activeElement !== search) search.focus();
});
$('#pkSearch').addEventListener('input', (e) => { state.q = e.target.value; render(); });
$('#pkInstalled').addEventListener('change', (e) => { state.installedOnly = e.target.checked; render(); });
$('#pkStore').addEventListener('click', () => api.pickerOpenStore());
window.addEventListener('focus', async () => { await load(); withSynths(); render(); });
api.onPickerSetup((opts) => setup(opts));

await load();
setup(await api.pickerOptions());
$('#pkSearch').focus();
// another language chosen in a window: the list and its labels again (the static text: translateDom)
onLangChange(() => { withSynths(); setup(state.opts); });
