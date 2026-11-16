// i18n: source table — every Korean string here is UI text and a translation key (docs/i18n.md)
// A VST3 plugin's panel in the channel sheet (instruments) and the mixer's effect editor (inserts):
// open the plugin's window, see how it is streaming, and reach its parameters. Every parameter knob
// can be right-clicked like MeloFi's own: automation clip or MIDI controller.
import { h, knob } from './dom.js';
import { t, tdyn } from '../../i18n/i18n.js';
import { streamStats } from '../vststream.js';

// parameters MeloFi does not offer (JUCE's VST3 wrapper adds 2048 "MIDI CC" ones to every plugin)
export const hiddenParam = (p) => !p || p.meta || p.auto === false || /^MIDI CC \d+\|\d+$/.test(p.name) || /^(Bypass|Program)$/i.test(p.name);

// slot: the helper slot; target(i): the automation target string for parameter i
export function vstPanel(S, { slot, target, buttons = [], note = null }) {
  const msg = h('p', { class: 'dim vst-msg' });
  const stat = h('p', { class: 'dim vst-stat' });
  const list = h('div', { class: 'vst-params' });
  const filter = h('input', { type: 'search', class: 'vst-filter', placeholder: t('파라미터 찾기'), oninput: () => draw() });
  let params = null;
  const draw = () => {
    if (!params) { list.replaceChildren(h('span', { class: 'dim' }, t('파라미터를 읽는 중…'))); return; }
    const q = filter.value.trim().toLowerCase();
    const shown = params.filter((p) => !hiddenParam(p) && (!q || p.name.toLowerCase().includes(q)));
    const knobs = shown.slice(0, 32).map((p) => {
      const out = h('b', {}, p.text ?? '');
      const k = knob({ value: p.value, min: 0, max: 1, def: p.def, size: 26, title: p.name, fmt: (v) => `${Math.round(v * 100)}%`, target: target(p.i),
        onInput: (v) => { S.setValue(target(p.i), v); out.textContent = `${Math.round(v * 100)}%`; },
        onChange: () => { S.changed(); } });
      return h('label', { class: 'fx-p vst-p' }, k, h('span', { title: p.name }, p.name), out);
    });
    list.replaceChildren(...[...knobs, shown.length > 32 ? h('span', { class: 'dim' }, t('{n}개 더 있음. 이름으로 검색해 보세요.', { n: shown.length - 32 })) : null,
      !shown.length ? h('span', { class: 'dim' }, q ? t('맞는 파라미터가 없습니다.') : t('조절할 수 있는 파라미터가 없습니다.')) : null].filter(Boolean));
  };
  const load = async (fresh = false) => {
    params = await S.vstParamList(slot, fresh);
    if (!params) { list.replaceChildren(h('span', { class: 'dim' }, t('플러그인이 아직 준비되지 않았습니다.'))); return; }
    draw();
  };
  // stream numbers, every second while the panel is on screen
  const seen = [];
  const tick = () => {
    if (!stat.isConnected) return;
    const s = streamStats.get(slot);
    const sr = S.engine?.ctx?.sampleRate || 48000;
    const chained = !s && S.engine?.vstUnits?.().some((u) => u.slot === slot && u.chained);
    // drop-outs in the last 30 seconds (the count since loading would keep the start-up ones forever)
    if (s) { seen.push([Date.now(), s.under]); while (seen.length > 1 && Date.now() - seen[0][0] > 30000) seen.shift(); }
    const recent = s && seen.length ? s.under - seen[0][1] : 0;
    stat.textContent = chained ? t('VST 악기와 같이 처리해서 지연이 더 늘지 않습니다.')
      : s ? (recent > 0 ? t('지연 {ms} ms · 30초간 {n}회 끊김', { ms: (s.delay / sr * 1000).toFixed(1), n: recent }) : t('지연 {ms} ms', { ms: (s.delay / sr * 1000).toFixed(1) })) : '';
    setTimeout(tick, 1000);
  };
  setTimeout(tick, 300);
  const open = h('button', { class: 'btn', onclick: async () => {
    const r = await window.melofi.vstEditor(slot);
    msg.textContent = r.ok ? '' : r.error === 'no_editor' ? t('이 플러그인은 편집 창이 없습니다.') : t('창을 열지 못했습니다: {err}', { err: tdyn(r.message || r.error) });
  } }, t('플러그인 창 열기'));
  const reread = h('button', { class: 'btn ghost sm', title: t('플러그인 창에서 바꾼 값을 다시 불러옵니다'), onclick: () => load(true) }, t('값 새로 읽기'));
  load();
  return h('div', { class: 'vst-panel' },
    h('div', { class: 'row' }, open, ...buttons, reread),
    msg, stat,
    h('div', { class: 'vst-find' }, filter),
    list,
    note ? h('p', { class: 'dim' }, note) : null);
}
