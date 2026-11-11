// Small DOM helpers and controls shared by the studio panels.
import { t } from '../../i18n/i18n.js';

export const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style') el.setAttribute('style', v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
};

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// Rotary knob: drag up/down (Shift for fine), wheel, double-click resets.
// onInput fires while dragging, onChange once at the end (for undo).
export function knob({ value, min = 0, max = 1, def = value, title = '', fmt = (v) => v.toFixed(2), onInput, onChange, size = 22, bipolar = false, target = null }) {
  const el = h('div', { class: 'k', title, style: `width:${size}px;height:${size}px` }, h('i'));
  automatable(el, target, title);
  let v = value;
  const draw = () => {
    const f = (v - min) / (max - min);
    el.style.setProperty('--a', `${-135 + f * 270}deg`);
    el.style.setProperty('--f', String(f));
    el.classList.toggle('bi', bipolar);
    el.title = `${title} ${fmt(v)}`.trim();
  };
  draw();
  const set = (nv, end) => { v = clamp(nv, min, max); draw(); onInput?.(v); if (end) onChange?.(v); };
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    const y0 = e.clientY, v0 = v;
    const move = (ev) => set(v0 + ((y0 - ev.clientY) / (ev.shiftKey ? 600 : 150)) * (max - min));
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); onChange?.(v); };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  });
  el.addEventListener('wheel', (e) => { e.preventDefault(); set(v - Math.sign(e.deltaY) * (max - min) * 0.02, true); }, { passive: false });
  el.addEventListener('dblclick', () => set(def, true));
  el.setValue = (nv) => { v = nv; draw(); };
  return el;
}

// Vertical fader
export function fader({ value, min = 0, max = 1, def = value, onInput, onChange, title = '', target = null }) {
  const cap = h('i', { class: 'cap' });
  const el = h('div', { class: 'fd', title }, h('i', { class: 'track' }), cap);
  automatable(el, target, title);
  let v = value;
  const draw = () => { el.style.setProperty('--f', String((v - min) / (max - min))); };
  draw();
  const fromY = (y) => { const r = el.getBoundingClientRect(); return min + (1 - clamp((y - r.top - 6) / (r.height - 12), 0, 1)) * (max - min); };
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    const set = (y) => { v = fromY(y); draw(); onInput?.(v); };
    set(e.clientY);
    const move = (ev) => set(ev.clientY);
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); onChange?.(v); };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  });
  el.addEventListener('dblclick', () => { v = def; draw(); onInput?.(v); onChange?.(v); });
  el.setValue = (nv) => { v = nv; draw(); };
  return el;
}

// a popup menu at a point; items: [{ label, act, check, sep, group, disabled }]
export function popup(x, y, items) {
  document.querySelector('.st-pop')?.remove();
  const el = h('div', { class: 'st-pop' }, ...items.map((it) => {
    if (it.sep) return h('div', { class: 'sep' });
    if (it.group) return h('div', { class: 'grp' }, it.group);
    return h('button', { disabled: !!it.disabled, class: it.check ? 'on' : '', onclick: () => { el.remove(); it.act(); } }, it.label, it.hint ? h('small', {}, it.hint) : null);
  }));
  document.body.append(el);
  const r = el.getBoundingClientRect();
  el.style.left = `${Math.min(x, innerWidth - r.width - 6)}px`;
  el.style.top = `${Math.min(y, innerHeight - r.height - 6)}px`;
  setTimeout(() => {
    const off = (e) => { if (!el.contains(e.target)) { el.remove(); window.removeEventListener('pointerdown', off, true); } };
    window.addEventListener('pointerdown', off, true);
  });
  return el;
}

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const noteLabel = (n) => `${NOTE_NAMES[n % 12]}${Math.floor(n / 12) - 1}`;
export const isBlackKey = (n) => [1, 3, 6, 8, 10].includes(n % 12);

// A small text dialog (Electron has no window.prompt). Resolves with the text, or null if cancelled.
export function ask(label, value = '', { type = 'text', ok = t('확인'), cancel = t('취소') } = {}) {
  return new Promise((resolve) => {
    document.querySelector('.st-ask')?.remove();
    const input = h('input', { type, value, class: 'cl-in' });
    const done = (v) => { wrap.remove(); resolve(v); };
    const wrap = h('div', { class: 'st-ask' },
      h('div', { class: 'box' },
        h('label', {}, label), input,
        h('div', { class: 'row' },
          h('button', { class: 'btn sm ghost', onclick: () => done(null) }, cancel),
          h('button', { class: 'btn sm primary', onclick: () => done(input.value) }, ok))));
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); done(input.value); } if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); } });
    wrap.addEventListener('pointerdown', (e) => { if (e.target === wrap) done(null); });
    document.body.append(wrap);
    setTimeout(() => { input.focus(); input.select(); });
  });
}

// A small form dialog: fields [{ key, label, type: 'number'|'select'|'range'|'check', min, max, step, value, options: [[v, label]] }]
// Resolves with { key: value } or null if cancelled.
export function form(title, fields, { ok = t('적용'), cancel = t('취소'), note = '' } = {}) {
  return new Promise((resolve) => {
    document.querySelector('.st-ask')?.remove();
    const inputs = {};
    const rows = fields.map((f) => {
      let el;
      if (f.type === 'select') el = h('select', {}, ...f.options.map(([v, l]) => h('option', { value: v, selected: String(v) === String(f.value) }, l)));
      else if (f.type === 'check') el = h('input', { type: 'checkbox', checked: !!f.value });
      else el = h('input', { type: f.type || 'number', min: f.min, max: f.max, step: f.step ?? 1, value: f.value, class: f.type === 'range' ? '' : 'cl-in' });
      inputs[f.key] = el;
      return h('label', { class: 'frm-row' }, h('span', {}, f.label), el);
    });
    const read = () => Object.fromEntries(fields.map((f) => { const el = inputs[f.key]; return [f.key, f.type === 'check' ? el.checked : f.type === 'text' || f.type === 'color' ? el.value : f.type === 'select' ? (isNaN(+el.value) || el.value === '' ? el.value : +el.value) : +el.value]; }));
    const done = (v) => { wrap.remove(); resolve(v); };
    const wrap = h('div', { class: 'st-ask' },
      h('div', { class: 'box frm' },
        h('b', { class: 'frm-title' }, title), note ? h('p', { class: 'frm-note' }, note) : null, ...rows,
        h('div', { class: 'row' }, h('button', { class: 'btn sm ghost', onclick: () => done(null) }, cancel), h('button', { class: 'btn sm primary', onclick: () => done(read()) }, ok))));
    wrap.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); done(read()); } if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); } });
    wrap.addEventListener('pointerdown', (e) => { if (e.target === wrap) done(null); });
    document.body.append(wrap);
    setTimeout(() => wrap.querySelector('input, select')?.focus());
  });
}

// right-click on any automatable control: the studio installs the menu (automation, MIDI learn)
let controlMenu = null;
export const setControlMenu = (fn) => { controlMenu = fn; };
export function automatable(el, target, label) {
  if (!target) return el;
  el.dataset.target = target;
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); controlMenu?.(e, target, label); });
  return el;
}
