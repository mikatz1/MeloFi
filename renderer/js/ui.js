// DOM side: title bar readouts, settings drawer, help, key mapping, menus, toasts.
import { T } from './strings.js';
import { THEMES } from './themes.js';

const FAMILY_ORDER = ['piano', 'keys', 'synth', 'strings', 'guitar', 'bass'];
const byFamily = (list) => {
  const groups = new Map();
  for (const i of list) { const f = i.family || 'piano'; if (!groups.has(f)) groups.set(f, []); groups.get(f).push(i); }
  return [...groups.entries()].sort((a, b) => FAMILY_ORDER.indexOf(a[0]) - FAMILY_ORDER.indexOf(b[0]));
};
const mb = (bytes) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`);
import { LAYOUT, PRESETS, keyLabel, noteName, isBlack } from './keymap.js';
import { HAND_COLORS } from './app-colors.js';

const $ = (s, el = document) => el.querySelector(s);
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style') el.style.cssText = v;
    else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(c));
  return el;
};
const fmtTime = (t) => { t = Math.max(0, t || 0); const m = Math.floor(t / 60); return `${m}:${String(Math.floor(t % 60)).padStart(2, '0')}`; };
const path = (obj, p) => p.split('.').reduce((o, k) => o?.[k], obj);

export class UI {
  constructor(app) {
    this.app = app;
    this.s = app.settings;
    this.tab = 'play';
    this.kmSel = null;
    this.quiet = false;

    for (const el of document.querySelectorAll('[data-t]')) el.textContent = path(T, el.dataset.t);
    for (const el of document.querySelectorAll('[data-t-title]')) el.title = path(T, el.dataset.tTitle);
    for (const b of document.querySelectorAll('[data-close]')) b.addEventListener('click', () => this.close());
    $('#fsBtn').title = T.menu.fsTip;
    $('#fsBtn').addEventListener('click', () => app.action('fullscreen'));
    $('#susFlag').title = T.menu.latchTip;
    $('#susFlag').addEventListener('click', () => app.action('latch'));
    this.menuOpen = null;
    for (const b of document.querySelectorAll('.menubar [data-menu]')) {
      b.addEventListener('pointerdown', (e) => { e.stopPropagation(); this.openMenu(this.menuOpen === b.dataset.menu ? null : b.dataset.menu); });
      b.addEventListener('pointerenter', () => { if (this.menuOpen && this.menuOpen !== b.dataset.menu) this.openMenu(b.dataset.menu); });
    }
    document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.menu')) this.openMenu(null); });
    for (const sh of document.querySelectorAll('.sheet')) sh.addEventListener('pointerdown', (e) => { if (e.target === sh) this.close(); });

    this.buildHelp();
    this.bindTransport();
    this.buildKeymapTools();
    this.s.on(() => { if (!this.quiet) this.refresh(); });
    this.refresh();
  }

  get modal() {
    for (const id of ['keymap', 'mixer', 'help', 'settings']) if (!$(`#${id}`).hidden) return id;
    return null;
  }

  open(which) {
    const cur = this.modal;
    this.close();
    if (cur === which) return;
    $(`#${which}`).hidden = false;
    if (which === 'settings') this.renderDrawer();
    if (which === 'keymap') this.renderKeymap();
    if (which === 'mixer') { this.renderMixer(); this.meterLoop(); }
    this.syncFkeys();
  }

  close() {
    for (const id of ['help', 'keymap', 'settings', 'mixer']) $(`#${id}`).hidden = true;
    this.openMenu(null);
    this.kmSel = null;
  }

  syncFkeys() {}

  // ---------- menu bar ----------

  menuItems(name) {
    const v = this.s.v, M = T.menu, app = this.app;
    const radio = (on, label, act, extra = {}) => ({ label, check: on ? 'dot' : '', act, ...extra });
    const opts = (key, list) => list.map(([val, label]) => radio(v[key] === val, label, () => this.s.set({ [key]: val })));
    if (name === 'file') {
      return [
        { label: M.openScore, act: () => app.pickScore() },
        { label: M.recent, sub: app.recent?.length
          ? [...app.recent.map((r) => ({ label: r.name, hint: r.path.split(/[\\/]/).slice(-2, -1)[0] || '', act: () => app.openRecent(r.path) })),
            { sep: true }, { label: M.recentClear, act: async () => { app.recent = await window.melofi.clearRecentScores(); } }]
          : [{ label: M.recentNone, disabled: true }] },
        { label: M.renderVideo, disabled: !app.player?.song || app.rendering, sub: [
          ...[[2160, 60], [2160, 30], [1440, 60], [1080, 60]].map(([hh, fps]) => ({ label: `${hh === 2160 ? '4K' : `${hh}p`} · ${fps}fps`, hint: `${Math.round((hh * 16) / 9)}×${hh}`, act: () => app.renderVideo({ height: hh, fps }) })),
          { sep: true }, { label: M.renderHint, disabled: true }] },
        { label: M.scorePlay, key: 'F8', act: () => app.action('scorePlay'), disabled: !app.player?.song },
        { label: M.scoreStop, key: 'F9', act: () => app.action('scoreStop'), disabled: !app.player?.song },
        { sep: true },
        { label: app.recorder?.recording ? M.recStop : M.recStart, key: 'F2', act: () => app.action('record'), danger: app.recorder?.recording },
        { sep: true },
        { label: M.recFormat, sub: opts('recFormat', Object.entries(T.settings.recFormats)) },
        { label: M.recRes, sub: opts('recRes', Object.entries(M.recResKinds)) },
        { sep: true },
        { label: M.openRecDir, act: () => app.openRecDir() },
        { label: M.changeRecDir, act: async () => { const p = await window.melofi.pickFolder(v.recDir || app.env.recordDir); if (p) this.s.set({ recDir: p }); } },
        { sep: true },
        { label: M.quit, key: 'Alt+F4', act: () => window.close() },
      ];
    }
    if (name === 'sound') {
      const devs = app.midiDevices || [];
      return [
        { label: M.instrument, sub: byFamily(app.instruments).flatMap(([fam, list], gi) => [
          ...(gi ? [{ sep: true }] : []), { group: T.families[fam] || fam }, ...list.map((i) => (i.installed
          ? radio(v.instrument === i.id, i.name, () => this.s.set({ instrument: i.id }), { hint: i.model })
          : { label: i.name, hint: app.dl.has(i.id) ? `${Math.round(app.dl.get(i.id) * 100)}% · ${M.dlCancel}` : `${M.dlGet} · ${mb(i.size)}`,
            act: () => (app.dl.has(i.id) ? app.cancelDownload(i.id) : app.downloadInstrument(i.id)) }))]) },
        { label: M.touch, sub: [...M.touchKinds.map(([val, label]) => radio(v.velocity === val, label, () => this.s.set({ velocity: val }))),
          { sep: true }, { label: M.touchCustom, act: () => { this.tab = 'play'; this.open('settings'); } }] },
        { label: M.latch, check: app.pedalLatch ? 'tick' : '', key: 'F7', act: () => app.action('latch') },
        { label: M.pedal, sub: opts('pedalMode', Object.entries(M.pedalKinds)) },
        { sep: true },
        { label: M.metro, check: v.metro ? 'tick' : '', key: 'F6', act: () => app.action('metro') },
        { label: M.tempo, sub: [...[60, 72, 80, 90, 100, 110, 120, 140, 160].map((b) => radio(v.bpm === b, `${b} BPM`, () => this.s.set({ bpm: b }))),
          { sep: true }, { label: M.tempoCustom, act: () => this.open('mixer') }] },
        { label: M.meter, sub: opts('beats', [[2, '2/4'], [3, '3/4'], [4, '4/4'], [6, '6/8']]) },
        { sep: true },
        { label: M.midiIn, sub: [
          { label: M.midiUse, check: v.midiIn ? 'tick' : '', act: () => this.s.set({ midiIn: !v.midiIn }) },
          { sep: true },
          ...(devs.length ? devs.map((d) => ({ label: d, disabled: true })) : [{ label: M.midiNone, disabled: true }]),
        ] },
        { sep: true },
        { label: M.mixer, key: 'F4', act: () => this.open('mixer') },
      ];
    }
    return [
      { label: M.prefs, key: 'F10', act: () => this.open('settings') },
      { label: M.fullscreen, key: 'F5', check: app.fullscreen ? 'tick' : '', act: () => app.action('fullscreen') },
      { label: M.keymap, key: 'F3', act: () => this.open('keymap') },
      { label: M.layout, sub: Object.entries(T.presets).filter(([k]) => k !== 'custom' || v.customMap).map(([k, label]) => radio(v.keyPreset === k, label, () => this.s.set({ keyPreset: k }))) },
      { sep: true },
      { label: M.zoom, sub: [...opts('kbZoom', [[1, '100%'], [1.25, '125%'], [1.5, '150%'], [2, '200%'], [3, '300%']]), { sep: true }, { label: M.zoomHint, disabled: true }] },
      { label: M.theme, sub: [
        ...Object.entries(THEMES).map(([id, th]) => radio(v.theme === id, th.name, () => this.s.set({ theme: id }))),
        ...(v.customTheme ? [radio(v.theme === 'custom', M.customTheme, () => this.s.set({ theme: 'custom' }))] : []),
        { sep: true },
        { label: M.bgTheme, act: () => app.themeFromBackground(), disabled: !v.bgImage },
      ] },
      { label: M.noteColor, sub: opts('noteColor', Object.entries(M.noteColorKinds)) },
      { label: M.barWidth, sub: opts('barWidth', [[0.7, M.thin], [1, M.normal], [1.4, M.thick]]) },
      { label: M.particles, sub: opts('particles', Object.entries(T.settings.particleLevels)) },
      { label: M.background, sub: [
        { label: M.bgPick, act: () => app.pickBackground() },
        { sep: true },
        ...[[0.3, M.bgDim30], [0.55, M.bgDim55], [0.75, M.bgDim75]].map(([val, label]) => radio(v.bgDim === val, label, () => this.s.set({ bgDim: val }), { disabled: !v.bgImage })),
        { sep: true },
        { label: M.bgTheme, act: () => app.themeFromBackground(), disabled: !v.bgImage },
        { label: M.bgClear, act: () => this.s.set({ bgImage: '' }), disabled: !v.bgImage },
      ] },
      { label: M.labels, sub: opts('labels', Object.entries(T.settings.labelKinds)) },
      { label: M.visualizer, check: v.visualizer ? 'tick' : '', act: () => this.s.set({ visualizer: !v.visualizer }) },
      { label: M.gpu, check: v.gpu ? 'tick' : '', hint: app.stage.glr ? 'WebGL2' : 'Canvas2D', act: () => app.setGpu(!v.gpu) },
      { sep: true },
      { label: M.help, key: 'F1', act: () => this.open('help') },
    ];
  }

  renderMenu(el, items) {
    el.replaceChildren(...items.map((it) => {
      if (it.sep) return h('div', { class: 'sep' });
      if (it.group) return h('div', { class: 'grp' }, it.group);
      const b = h('button', {
        role: 'menuitem', class: `${it.danger ? 'danger' : ''}${it.sub ? ' has-sub' : ''}`, disabled: !!it.disabled,
        onclick: () => { if (it.sub || it.disabled) return; this.openMenu(null); it.act(); },
      }, h('span', { class: `chk ${it.check || ''}` }), h('span', { class: 'lbl' }, it.chip ? h('i', { class: 'chip', style: `background:${it.chip}` }) : null, it.label, it.hint ? h('small', {}, it.hint) : null),
      h('span', { class: 'key' }, it.sub ? h('i', { class: 'arrow' }) : it.key || ''));
      b.addEventListener('pointerenter', () => {
        if (el === this.subEl) return;
        if (it.sub) this.openSub(b, it.sub); else this.closeSub();
      });
      return b;
    }));
  }

  openSub(anchor, items) {
    if (this.subAnchor === anchor) return;
    this.closeSub();
    const sub = h('div', { class: 'menu sub', role: 'menu' });
    this.renderMenu(sub, items);
    document.body.append(sub);
    const r = anchor.getBoundingClientRect();
    const w = sub.offsetWidth, hh = sub.offsetHeight;
    const left = r.right + w > window.innerWidth ? r.left - w : r.right;
    sub.style.left = `${left}px`;
    sub.style.top = `${Math.max(4, Math.min(r.top - 4, window.innerHeight - hh - 4))}px`;
    this.subEl = sub;
    anchor.classList.add('open');
    this.subAnchor = anchor;
  }

  closeSub() {
    this.subEl?.remove();
    this.subEl = null;
    this.subAnchor?.classList.remove('open');
    this.subAnchor = null;
  }

  openMenu(name) {
    const menu = $('#menu');
    this.closeSub();
    for (const b of document.querySelectorAll('.menubar [data-menu]')) b.classList.toggle('on', b.dataset.menu === name);
    this.menuOpen = name;
    if (!name) { menu.hidden = true; return; }
    this.renderMenu(menu, this.menuItems(name));
    const r = document.querySelector(`.menubar [data-menu="${name}"]`).getBoundingClientRect();
    menu.style.left = `${r.left}px`;
    menu.style.top = `${r.bottom}px`;
    menu.hidden = false;
  }

  // set from a control without re-rendering the control we're dragging
  set(patch) {
    this.quiet = true;
    this.s.set(patch);
    this.quiet = false;
    this.refreshBar();
  }

  dlText(id) { return `${Math.round((this.app.dl.get(id) || 0) * 100)}% · ${T.settings.dlCancel}`; }

  // live download percentage on the instrument rows
  dlProgress(id) {
    const b = document.querySelector(`[data-dl="${id}"]`);
    if (b) b.textContent = this.dlText(id);
  }

  refresh() {
    this.refreshBar();
    if (!$('#settings').hidden) this.renderDrawer();
    if (!$('#keymap').hidden) this.renderKeymap();
    if (!$('#mixer').hidden) this.renderMixer();
  }

  // ---------- mixer ----------

  renderMixer() {
    const v = this.s.v, M = T.mixer;
    const dB = (x) => (x <= 0.001 ? '−∞' : `${(20 * Math.log10(x)).toFixed(1)}`);
    const pct = (x, max) => `${Math.round((x / max) * 100)}`;
    const sgn = (x) => `${x > 0 ? '+' : ''}${x.toFixed(1)}`;

    const strip = (label, key, min, max, step, fmt, unit, extra) => {
      const val = h('div', { class: 'ms-val' }, fmt(v[key]), h('small', {}, unit));
      const frac = (x) => (x - min) / (max - min);
      const fill = h('i', { class: 'vf-fill' });
      const cap = h('i', { class: 'vf-cap' });
      const ticks = h('div', { class: 'ms-ticks' }, ...Array.from({ length: 11 }, (_, i) => h('i', { class: i % 5 === 0 ? 'big' : '' })));
      const fader = h('div', { class: 'vf', title: M.hint }, ticks, h('i', { class: 'vf-track' }, fill), cap);
      let cur = v[key];
      const draw = () => { const f = frac(cur); fill.style.height = `${f * 100}%`; cap.style.bottom = `calc(${f * 100}% - 7px)`; val.firstChild.textContent = fmt(cur); };
      const apply = (x) => {
        x = Math.min(max, Math.max(min, Math.round(x / step) * step));
        if (x === cur) return;
        cur = x; draw(); this.set({ [key]: x });
      };
      // drag: grab the cap and move relative; click on the track jumps
      let drag = null;
      fader.addEventListener('pointerdown', (e) => {
        fader.setPointerCapture(e.pointerId);
        const r = fader.getBoundingClientRect();
        const onCap = e.target === cap;
        if (!onCap) apply(min + (1 - (e.clientY - r.top) / r.height) * (max - min));
        drag = { y: e.clientY, v: cur, h: r.height };
      });
      fader.addEventListener('pointermove', (e) => {
        if (!drag) return;
        apply(drag.v + ((drag.y - e.clientY) / drag.h) * (max - min) * (e.altKey ? 0.2 : 1));
      });
      const end = () => { drag = null; };
      fader.addEventListener('pointerup', end);
      fader.addEventListener('pointercancel', end);
      fader.addEventListener('wheel', (e) => { e.preventDefault(); apply(cur + (e.deltaY < 0 ? step : -step) * (step < 0.05 ? 2 : 1)); }, { passive: false });
      fader.addEventListener('dblclick', () => apply(this.app.defaults[key]));
      draw();
      return h('div', { class: 'ms' }, h('div', { class: 'ms-name' }, label), h('div', { class: 'ms-fader' }, fader), val, extra || h('div', { class: 'ms-extra' }));
    };

    const roomSeg = h('div', { class: 'ms-extra' }, this.seg(Object.entries(M.rooms), v.room, (x) => this.s.set({ room: x })));
    const resNote = h('div', { class: 'ms-extra note' }, M.resNote);

    this.meterCv = h('canvas', { class: 'meter', width: 64, height: 360 });
    this.meterRead = h('div', { class: 'ms-val' }, '−∞', h('small', {}, 'dB'));
    const meter = h('div', { class: 'ms out' }, h('div', { class: 'ms-name' }, M.out), h('div', { class: 'ms-fader' }, this.meterCv), this.meterRead,
      h('div', { class: 'ms-extra' }, h('button', { class: 'btn', onclick: () => this.app.resetMixer() }, M.reset)));

    // metronome: tempo box (drag / wheel / click arrows) + on/off
    const bpmBox = h('div', { class: 'bpm' },
      h('button', { class: 'btn', onclick: () => this.s.set({ bpm: Math.max(30, v.bpm - 1) }) }, '−'),
      h('b', { title: M.hint }, String(v.bpm)),
      h('button', { class: 'btn', onclick: () => this.s.set({ bpm: Math.min(260, v.bpm + 1) }) }, '+'));
    bpmBox.querySelector('b').addEventListener('wheel', (e) => { e.preventDefault(); this.s.set({ bpm: Math.max(30, Math.min(260, v.bpm + (e.deltaY < 0 ? 1 : -1))) }); }, { passive: false });
    const metroExtra = h('div', { class: 'ms-extra col' }, bpmBox,
      h('button', { class: `btn metro-btn${v.metro ? ' on' : ''}`, onclick: () => this.s.set({ metro: !v.metro }) }, v.metro ? M.metroOff : M.metroOn));

    $('#mixer .mixer-body').replaceChildren(
      strip(M.reverb, 'reverb', 0, 0.8, 0.01, (x) => pct(x, 0.8), '%', roomSeg),
      strip(M.resonance, 'resonance', 0, 1, 0.01, (x) => pct(x, 1), '%', resNote),
      strip(M.bass, 'bass', -9, 9, 0.5, sgn, 'dB'),
      strip(M.treble, 'brightness', -9, 9, 0.5, sgn, 'dB'),
      strip(M.metro, 'metroVol', 0, 1, 0.01, (x) => pct(x, 1), '%', metroExtra),
      h('div', { class: 'ms-sep' }),
      strip(M.master, 'volume', 0, 1, 0.005, dB, 'dB'),
      meter,
    );
  }

  meterLoop() {
    const hold = [-120, -120];
    let holdT = [0, 0];
    let readT = 0;
    const tick = (t) => {
      if ($('#mixer').hidden || !this.meterCv) return;
      const cv = this.meterCv, x = cv.getContext('2d');
      const W = cv.width, H = cv.height;
      const lv = this.app.engine.levels();
      const y = (db) => H - (Math.max(-60, Math.min(0, db)) + 60) / 60 * H;
      x.fillStyle = '#08090b';
      x.fillRect(0, 0, W, H);
      x.fillStyle = '#1d1e23';
      for (let db = 0; db >= -60; db -= 6) x.fillRect(0, Math.round(y(db)), W, 1);
      lv.forEach((l, i) => {
        const bx = 8 + i * 28, bw = 20;
        if (l.peak > hold[i] || t - holdT[i] > 1200) { hold[i] = Math.max(l.peak, hold[i] - 0.6); if (l.peak >= hold[i]) holdT[i] = t; }
        const top = y(l.rms);
        const g = x.createLinearGradient(0, H, 0, 0);
        g.addColorStop(0, '#6d6b66');
        g.addColorStop(0.8, '#d8d5ce');
        g.addColorStop(0.9, '#e0a440');
        g.addColorStop(1, '#e5484d');
        x.fillStyle = g;
        x.fillRect(bx, top, bw, H - top);
        x.fillStyle = 'rgba(216,213,206,0.45)';
        x.fillRect(bx, y(l.peak), bw, Math.max(1, y(l.rms) - y(l.peak)));
        x.fillStyle = hold[i] > -1 ? '#e5484d' : '#ece9e2';
        x.fillRect(bx, Math.round(y(hold[i])), bw, 2);
      });
      if (t - readT > 150) { readT = t; this.meterRead.firstChild.textContent = Math.max(hold[0], hold[1]) <= -60 ? '−∞' : Math.max(hold[0], hold[1]).toFixed(1); }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  refreshBar() {
    const v = this.s.v;
    $('#octVal').textContent = v.octave;
    $('#trVal').textContent = v.transpose > 0 ? `+${v.transpose}` : v.transpose;
    $('#velVal').textContent = v.velocity;
    const inst = this.app.instruments.find((i) => i.id === v.instrument);
    $('#instName').textContent = inst ? inst.name : '—';
    $('#metroCell').hidden = !v.metro;
    $('#bpmVal').textContent = v.bpm;
    const dots = $('#beatDots');
    if (dots.childElementCount !== v.beats) dots.replaceChildren(...Array.from({ length: v.beats }, () => h('i')));
    const midi = this.app.midiDevices?.length > 0;
    $('#midiFlag').hidden = !midi;
    $('#midiFlag').classList.toggle('on', midi && v.midiIn);
    $('#midiFlag').title = (this.app.midiDevices || []).join(', ');
  }

  setMods(shift) {
    $('#modVal').textContent = shift > 0 ? '+1 OCT' : shift < 0 ? '−1 OCT' : '';
  }

  // Fullscreen: the bar slides away and comes back when the pointer reaches the top edge.
  setFullscreen(on) {
    document.body.classList.toggle('fs', on);
    $('#fsBtn').classList.toggle('on', on);
    requestAnimationFrame(() => this.app.stage.layout());
    if (on && !this.fsHover) {
      this.fsHover = (e) => document.body.classList.toggle('fs-peek', e.clientY < 6 || !!e.target.closest?.('#bar, #transport, .menu'));
      window.addEventListener('pointermove', this.fsHover);
    } else if (!on && this.fsHover) {
      window.removeEventListener('pointermove', this.fsHover);
      this.fsHover = null;
      document.body.classList.remove('fs-peek');
    }
  }

  // middle / left pedal readouts show only while pressed
  setPedalFlag(which, on) {
    const el = $(which === 'soft' ? '#softFlag' : '#sostFlag');
    el.hidden = !on;
    el.classList.toggle('on', on);
  }

  setSustain(on, latched) {
    const b = $('#susFlag');
    b.classList.toggle('on', on);
    b.classList.toggle('latch', !!latched);
    b.textContent = latched ? T.menu.susLocked : 'SUS';
  }

  beat(b) {
    const dots = $('#beatDots').children;
    for (let i = 0; i < dots.length; i++) dots[i].className = i === b ? (b === 0 ? 'on acc' : 'on') : '';
  }

  setProgress(p) {
    const el = $('#progress');
    el.classList.toggle('on', p != null && p < 1);
    $('#progress i').style.width = `${Math.round((p ?? 1) * 100)}%`;
  }

  setRecording(state, fmtLabel) {
    $('#recCell').hidden = state === 'off';
    $('#recFmt').textContent = state === 'saving' ? T.toast.recSaving : fmtLabel || '';
    if (state === 'off') $('#recTime').textContent = '00:00';
  }

  setRecTime(sec) {
    const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    $('#recTime').textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  toast(text, { path: p, action, err, ms = 3200 } = {}) {
    const el = h('div', { class: `toast${err ? ' err' : ''}` },
      h('div', {}, h('span', { class: 't' }, text), p ? h('span', { class: 'p', title: p }, p.split(/[\\/]/).pop()) : null),
      action ? h('button', { onclick: () => { action.fn(); el.remove(); } }, action.label) : null);
    $('#toasts').append(el);
    setTimeout(() => el.remove(), action ? Math.max(ms, 7000) : ms);
  }

  // ---------- score transport ----------

  bindTransport() {
    const P = this.app.player;
    const RATES = [0.25, 0.5, 0.6, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 2];
    $('#tpParts').textContent = T.score.parts;
    $('#tpPractice').addEventListener('pointerdown', (e) => { e.stopPropagation(); this.openPracticeMenu(); });
    $('#tpMidi').textContent = T.score.midi;
    $('#tpPlay').addEventListener('click', () => this.app.toggleScore());
    $('#tpStop').addEventListener('click', () => P.stop());
    $('#tpClose').addEventListener('click', () => this.app.closeScore());
    $('#tpMidi').addEventListener('click', () => this.app.exportScoreMidi());
    const step = (dir) => {
      const i = RATES.findIndex((r) => r >= P.rate - 1e-6);
      P.setRate(RATES[Math.max(0, Math.min(RATES.length - 1, (i < 0 ? 5 : i) + dir))]);
    };
    $('#tpSlower').addEventListener('click', () => step(-1));
    $('#tpFaster').addEventListener('click', () => step(1));
    const seek = $('#tpSeek');
    seek.addEventListener('input', () => { this.seeking = true; seek.style.setProperty('--p', `${seek.value / 10}%`); $('#tpPos').textContent = fmtTime((seek.value / 1000) * P.duration); });
    seek.addEventListener('change', () => { this.seeking = false; P.seek((seek.value / 1000) * P.duration); seek.blur(); });
    $('#tpParts').addEventListener('pointerdown', (e) => { e.stopPropagation(); this.openPartsMenu(); });
    P.onChange = () => this.updateTransport();
  }

  updateTransport() {
    const P = this.app.player;
    const has = !!P.song;
    $('#transport').hidden = !has;
    if (document.body.classList.contains('has-score') !== has) {
      document.body.classList.toggle('has-score', has);
      requestAnimationFrame(() => this.app.stage.layout());
    }
    if (!has) return;
    $('#tpTitle').textContent = P.song.title;
    $('#tpTitle').title = P.song.title;
    const legend = $('#tpLegend');
    const hands = this.s.get('scoreHands') && P.hands && [...P.hands.values()].some(Boolean);
    const key = `${hands}|${this.app.stage.theme.name}`;
    if (legend.dataset.key !== key) {
      legend.dataset.key = key;
      const ink = this.app.stage.theme.inkSim;
      legend.replaceChildren(...(hands ? [['rh', T.score.rh], ['lh', T.score.lh]].map(([k, label]) =>
        h('span', {}, h('i', { class: 'chip', style: `background:${ink ? (k === 'rh' ? '#15130f' : '#a3271a') : (this.s.get(k === 'rh' ? 'rhColor' : 'lhColor') || HAND_COLORS[k])}` }), label)) : []));
    }
    $('#tpPlay i').className = `ic ${P.playing ? 'pause' : 'play'}`;
    $('#tpPractice').textContent = this.app.practice?.active ? T.practice.running : T.practice.title;
    $('#tpPractice').classList.toggle('on', !!this.app.practice?.active);
    const now = P.now();
    if (!this.seeking) {
      $('#tpPos').textContent = fmtTime(now);
      const f = Math.min(1, now / (P.duration || 1));
      $('#tpSeek').value = String(Math.round(f * 1000));
      $('#tpSeek').style.setProperty('--p', `${f * 100}%`);
    }
    $('#tpDur').textContent = fmtTime(P.duration);
    $('#tpRate').textContent = `${Math.round(P.rate * 100)}%`;
  }

  openPartsMenu() {
    const P = this.app.player;
    if (!P.song) return;
    const menu = $('#menu');
    this.closeSub();
    const lines = P.song.lines;
    const items = [
      ...lines.map((l) => ({ label: l.name, hint: l.piano ? T.score.piano : `${l.notes.length}`, chip: this.app.lineColor(l.id, 72), check: P.enabled.has(l.id) ? 'tick' : '', act: () => { P.setLine(l.id, !P.enabled.has(l.id)); this.openPartsMenu(); } })),
      { sep: true },
      { label: T.score.hands, check: this.s.get('scoreHands') ? 'tick' : '', act: () => { this.s.set({ scoreHands: !this.s.get('scoreHands') }); this.openPartsMenu(); this.updateTransport(); } },
      { sep: true },
      { label: T.score.pianoOnly, act: () => { for (const l of lines) P.setLine(l.id, l.piano); }, disabled: !lines.some((l) => l.piano) },
      { label: T.score.all, act: () => { for (const l of lines) P.setLine(l.id, true); } },
    ];
    this.renderMenu(menu, items);
    // keep the menu open while toggling parts
    for (const b of menu.querySelectorAll('button')) {
      const it = items.filter((x) => !x.sep)[[...menu.querySelectorAll('button')].indexOf(b)];
      if (it && it.check !== undefined) b.onclick = (e) => { e.stopPropagation(); it.act(); };
    }
    const r = $('#tpParts').getBoundingClientRect();
    menu.style.left = `${Math.min(r.left, window.innerWidth - 300)}px`;
    menu.style.top = `${r.bottom + 2}px`;
    menu.hidden = false;
    this.menuOpen = 'parts';
  }

  // Title card before a score plays: letters rise in, a hairline draws, the composer settles,
  // then it all lifts away. Click or any key skips. Resolves when it's gone.
  showIntro(song) {
    const box = $('#intro');
    const t = box.querySelector('.t');
    t.replaceChildren(...[...song.title].map((ch, i) => h('span', { style: `--i:${i}` }, ch === ' ' ? '\u00a0' : ch)));
    box.querySelector('.c').textContent = song.composer || '';
    box.querySelector('.sub').textContent = song.subtitle || '';
    const never = box.querySelector('.never input');
    never.checked = false;
    never.onchange = () => this.s.set({ introCard: !never.checked });
    box.classList.remove('out', 'play');
    box.hidden = false;
    void box.offsetWidth; // restart the animation
    box.classList.add('play');
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        window.removeEventListener('keydown', onKey, true);
        box.removeEventListener('pointerdown', onPtr);
        box.classList.add('out');
        setTimeout(() => { box.hidden = true; box.classList.remove('play', 'out'); resolve(); }, 420);
      };
      const onKey = (e) => { e.preventDefault(); e.stopPropagation(); finish(); };
      const onPtr = (e) => { if (!e.target.closest('.never')) finish(); };
      const timer = setTimeout(finish, Math.min(4200, 2400 + song.title.length * 30));
      window.addEventListener('keydown', onKey, true);
      box.addEventListener('pointerdown', onPtr);
    });
  }

  // practice: which hand, how strict, start / stop
  openPracticeMenu() {
    if (this.menuOpen === 'practice') { this.openMenu(null); return; }
    this.openMenu(null);
    const Pr = this.app.practice, v = this.s.v, Q = T.practice;
    const radio = (on, label, act) => ({ label, check: on ? 'dot' : '', act });
    const items = [
      { group: Q.hand },
      ...[['rh', T.score.rh], ['lh', T.score.lh], ['both', Q.both]].map(([k, l]) => radio(v.practiceHand === k, l, () => this.s.set({ practiceHand: k }))),
      { sep: true },
      Pr.active ? { label: Q.stop, act: () => { this.app.player.pause(); Pr.stop(); } } : { label: Q.start, act: () => Pr.start() },
    ];
    const menu = $('#menu');
    this.renderMenu(menu, items);
    const r = $('#tpPractice').getBoundingClientRect();
    menu.style.left = `${Math.min(r.left, window.innerWidth - 260)}px`;
    menu.style.top = `${r.bottom + 2}px`;
    menu.hidden = false;
    this.menuOpen = 'practice';
  }

  // ---------- help ----------

  buildHelp() {
    const grid = $('#help .help-grid');
    grid.replaceChildren(...T.help.sections.map((sec) =>
      h('section', {}, h('h3', {}, sec.title), h('dl', {}, ...sec.rows.flatMap(([k, d]) => [h('dt', {}, k), h('dd', {}, d)])))));
    $('#help .help-foot').textContent = T.help.footer;
  }

  // ---------- settings drawer ----------

  renderDrawer() {
    const tabs = $('#settings .tabs');
    tabs.replaceChildren(...Object.entries(T.settings.tabs).map(([id, label]) =>
      h('button', { role: 'tab', 'aria-selected': String(id === this.tab), onclick: () => { this.tab = id; this.renderDrawer(); } }, label)));
    const body = $('#settings .drawer-body');
    const top = body.scrollTop;
    body.replaceChildren(...this[`tab_${this.tab}`]().filter(Boolean));
    body.scrollTop = top;
  }

  row(label, ctl, note) {
    return h('div', { class: 'row' }, h('label', {}, label), h('div', { class: 'ctl' }, ctl), note ? h('div', { class: 'note' }, note) : null);
  }

  seg(options, value, pick) {
    return h('div', { class: 'seg' }, ...options.map(([v, label]) =>
      h('button', { class: v === value ? 'on' : '', onclick: () => pick(v) }, label)));
  }

  slider(min, max, step, value, fmt, onInput) {
    const out = h('span', { class: 'val' }, fmt(value));
    const pct = (x) => `${((x - min) / (max - min)) * 100}%`;
    const inp = h('input', { type: 'range', min, max, step, value, style: `--p:${pct(value)}` });
    inp.addEventListener('input', () => {
      const x = parseFloat(inp.value);
      out.textContent = fmt(x);
      inp.style.setProperty('--p', pct(x));
      onInput(x);
    });
    inp.addEventListener('change', () => inp.blur());
    return [inp, out];
  }

  colorPick(value, onChange, label) {
    const inp = h('input', { type: 'color', value });
    inp.addEventListener('input', () => onChange(inp.value));
    return h('label', { class: 'colorpick' }, inp, h('span', {}, label));
  }

  toggle(value, flip) {
    return h('button', { class: `switch${value ? ' on' : ''}`, role: 'switch', 'aria-checked': String(!!value), onclick: () => flip(!value) });
  }

  select(options, value, onChange) {
    const sel = h('select', {}, ...options.map(([v, label]) => h('option', { value: v, selected: v === value }, label)));
    sel.addEventListener('change', () => { onChange(sel.value); sel.blur(); });
    return sel;
  }

  tab_play() {
    const v = this.s.v, S = T.settings;
    return [
      this.row(S.keyLayout, this.select(Object.entries(T.presets).filter(([k]) => k !== 'custom' || v.customMap), v.keyPreset, (x) => this.s.set({ keyPreset: x }))),
      this.row('', h('button', { class: 'btn', onclick: () => this.open('keymap') }, `${S.editKeymap}  F3`)),
      this.row(S.octave, this.seg([1, 2, 3, 4, 5, 6].map((n) => [n, String(n)]), v.octave, (x) => this.s.set({ octave: x }))),
      this.row(S.transpose, this.slider(-12, 12, 1, v.transpose, (x) => (x > 0 ? `+${x}` : `${x}`), (x) => this.set({ transpose: x }))),
      this.row(S.velocity, this.slider(20, 127, 1, v.velocity, (x) => `${x}`, (x) => this.set({ velocity: x }))),
      this.row(S.humanize, this.slider(0, 24, 1, v.humanize, (x) => `±${x}`, (x) => this.set({ humanize: x }))),
      this.row(S.sustainKey, this.seg([['Space', S.sustainSpace], ['', S.sustainNone]], v.sustainKey, (x) => this.s.set({ sustainKey: x }))),
      this.row(S.sostKey, this.seg([['ControlLeft', S.keyLCtrl], ['ShiftRight', S.keyRShift], ['', S.sustainNone]], v.sostKey, (x) => this.s.set({ sostKey: x })), S.sostHint),
      this.row(S.softKey, this.seg([['ShiftLeft', S.keyLShift], ['ControlRight', S.keyRCtrl], ['', S.sustainNone]], v.softKey, (x) => this.s.set({ softKey: x })), S.softHint),
      this.row(T.menu.pedal, this.seg(Object.entries(T.menu.pedalKinds), v.pedalMode, (x) => this.s.set({ pedalMode: x }))),
    ];
  }

  tab_sound() {
    const v = this.s.v, S = T.settings;
    return [
      h('div', { class: 'group-title' }, S.instrument),
      h('div', { class: 'insts' }, ...byFamily(this.app.instruments).flatMap(([fam, list]) => [h('div', { class: 'inst-fam' }, T.families[fam] || fam), ...list.map((i) => {
        const dl = this.app.dl.has(i.id);
        let side = null;
        if (dl) side = h('button', { class: 'btn sm', 'data-dl': i.id, onclick: () => this.app.cancelDownload(i.id) }, this.dlText(i.id));
        else if (!i.installed) side = h('button', { class: 'btn sm', onclick: () => this.app.downloadInstrument(i.id) }, `${S.dlGet} · ${mb(i.size)}`);
        else if (!i.bundled) {
          // two clicks to delete
          side = h('button', { class: 'btn sm ghost', onclick: (e) => {
            if (e.currentTarget.dataset.armed) this.app.removeInstrument(i.id);
            else { e.currentTarget.dataset.armed = '1'; e.currentTarget.textContent = S.dlRemoveSure; }
          } }, S.dlRemove);
        }
        return h('div', { class: `inst-row${i.id === v.instrument ? ' on' : ''}${i.installed ? '' : ' off'}` },
          h('button', { class: 'pick', disabled: !i.installed, onclick: () => this.s.set({ instrument: i.id }) },
            h('span', { class: 'r' }), h('span', {}, h('b', {}, i.name), h('small', {}, `${i.model} · ${i.license}`))),
          side);
      })])),
      this.row('', h('button', { class: 'btn', onclick: () => this.open('mixer') }, `${T.mixer.title}  F4`)),
    ];
  }

  tab_look() {
    const v = this.s.v, S = T.settings;
    const swatch = (id, th) => {
      const light = id === 'ink';
      const el = h('button', { class: `theme${v.theme === id ? ' on' : ''}${light ? ' light' : ''}`, title: th.name, onclick: () => this.s.set({ theme: id }),
        style: `background:linear-gradient(${th.bg[0]},${th.bg[2]} 70%,${th.white[0]} 70%,${th.white[1]})` },
      h('i', { style: `position:absolute;left:30%;bottom:34%;width:3px;height:42%;border-radius:2px;background:${th.bar};box-shadow:0 0 6px ${th.barGlow}` }),
      h('i', { style: `position:absolute;left:58%;bottom:34%;width:3px;height:24%;border-radius:2px;background:${th.bar};box-shadow:0 0 6px ${th.barGlow}` }),
      h('i', { style: `position:absolute;left:0;right:0;bottom:30%;height:1px;background:${th.hitLine}` }),
      h('span', {}, th.name));
      return el;
    };
    return [
      h('div', { class: 'group-title' }, S.theme),
      h('div', { class: 'themes' }, ...[...Object.entries(THEMES), ...(v.customTheme ? [['custom', v.customTheme]] : [])].map(([id, th]) => swatch(id, th))),
      this.row(S.visualizer, this.toggle(v.visualizer, (x) => this.s.set({ visualizer: x }))),
      this.row(S.particles, this.seg(Object.entries(S.particleLevels), v.particles, (x) => this.s.set({ particles: x }))),
      this.row(S.bloom, this.toggle(v.bloom, (x) => this.s.set({ bloom: x }))),
      this.row(S.speed, this.slider(0.4, 2.2, 0.05, v.speed, (x) => `${x.toFixed(2)}×`, (x) => this.set({ speed: x }))),
      this.row(S.labels, this.seg(Object.entries(S.labelKinds), v.labels, (x) => this.s.set({ labels: x }))),
      this.row(S.noteNames, this.seg(Object.entries(S.noteNameKinds), v.noteNames, (x) => this.s.set({ noteNames: x }))),
      this.row(S.range, this.seg([[88, '88'], [61, '61'], [49, '49']], v.range, (x) => this.s.set({ range: x }))),
      this.row(T.menu.zoom, this.seg([[1, '100'], [1.25, '125'], [1.5, '150'], [2, '200'], [3, '300']], v.kbZoom, (x) => this.s.set({ kbZoom: x }))),
      this.row(T.menu.noteColor, this.select(Object.entries(T.menu.noteColorKinds), v.noteColor, (x) => this.s.set({ noteColor: x }))),
      this.row(T.menu.barWidth, this.seg([[0.7, T.menu.thin], [1, T.menu.normal], [1.4, T.menu.thick]], v.barWidth, (x) => this.s.set({ barWidth: x }))),
      h('div', { class: 'group-title' }, S.scoreGroup),
      this.row(S.scoreFall, this.toggle(v.scoreFall, (x) => this.s.set({ scoreFall: x })), S.scoreFallHint),
      this.row(S.introCard, this.toggle(v.introCard, (x) => this.s.set({ introCard: x })), S.introCardHint),
      this.row(T.score.hands, this.toggle(v.scoreHands, (x) => this.s.set({ scoreHands: x }))),
      this.row(S.handColors, [
        this.colorPick(v.rhColor, (x) => this.set({ rhColor: x }), S.rh),
        this.colorPick(v.lhColor, (x) => this.set({ lhColor: x }), S.lh),
        h('button', { class: 'btn sm ghost', onclick: () => this.s.set({ rhColor: '#ffb27a', lhColor: '#7fb0ff' }) }, S.resetColors),
      ]),
      this.row(T.menu.background, [
        h('button', { class: 'btn', onclick: () => this.app.pickBackground() }, T.menu.bgPick),
        v.bgImage ? h('button', { class: 'btn', onclick: () => this.s.set({ bgImage: '' }) }, T.settings.clear) : null,
      ]),
      v.bgImage ? this.row(S.bgDim, this.slider(0, 0.9, 0.05, v.bgDim, (x) => `${Math.round(x * 100)}%`, (x) => this.set({ bgDim: x }))) : null,
    ];
  }

  tab_rec() {
    const v = this.s.v, S = T.settings;
    const dir = v.recDir || this.app.env.recordDir;
    const rows = [
      this.row(S.recFormat, this.select(Object.entries(S.recFormats), v.recFormat, (x) => this.s.set({ recFormat: x })), S.recFormatHint[v.recFormat]),
      this.row(S.recDir, [h('span', { class: 'path', title: dir }, dir),
        h('button', { class: 'btn', onclick: async () => { const p = await window.melofi.pickFolder(dir); if (p) this.s.set({ recDir: p }); } }, S.change)]),
    ];
    if (v.recFormat === 'mp4') {
      rows.push(this.row(T.menu.recRes, this.seg(Object.entries(T.menu.recResKinds), String(v.recRes), (x) => this.s.set({ recRes: x }))));
      rows.push(this.row(S.fps, this.seg([[30, '30'], [60, '60']], v.recFps, (x) => this.s.set({ recFps: x }))));
      rows.push(this.row(S.videoQuality, this.slider(4, 40, 1, v.recMbps, (x) => `${x}M`, (x) => this.set({ recMbps: x }))));
    }
    if (v.recFormat === 'mp3') rows.push(this.row(S.mp3Rate, this.seg([[192, '192'], [256, '256'], [320, '320']], v.recKbps, (x) => this.s.set({ recKbps: x }))));
    return rows;
  }

  tab_about() {
    const S = T.settings;
    return [
      this.row(S.version, h('span', { class: 'val', style: 'width:auto' }, this.app.env.version)),
      this.row(S.graphics, [h('span', { class: 'path', style: 'direction:ltr', title: this.app.stage.renderer }, this.app.stage.renderer),
        this.toggle(v.gpu, (x) => this.app.setGpu(x))]),
      h('div', { class: 'group-title' }, S.credits),
      h('div', { class: 'credits' }, ...this.app.instruments.map((i) =>
        h('p', {}, h('b', {}, i.name), ` — ${i.maker}`, h('br'), `${i.model} · ${i.license}`, h('br'), h('span', { class: 'path', style: 'direction:ltr;display:block' }, i.url)))),
      this.row('', h('button', { class: 'btn', onclick: () => this.app.resetSettings() }, S.reset)),
    ];
  }

  // ---------- key mapping ----------

  buildKeymapTools() {
    const sel = $('#kmPreset');
    sel.addEventListener('change', () => { this.s.set({ keyPreset: sel.value }); sel.blur(); });
    $('#kmClear').addEventListener('click', () => this.kmAssign(null));
    $('#kmReset').addEventListener('click', () => { this.s.set({ keyPreset: 'piano', customMap: null }); this.kmSel = null; });
  }

  renderKeymap() {
    const v = this.s.v;
    const map = this.app.currentMap();
    const sel = $('#kmPreset');
    sel.replaceChildren(...Object.entries(T.presets).filter(([k]) => k !== 'custom' || v.customMap)
      .map(([k, label]) => h('option', { value: k, selected: k === v.keyPreset }, label)));

    $('#keymap .km-board').replaceChildren(...LAYOUT.map((row) => h('div', { class: 'km-row' }, ...row.map((code) => {
      const off = map[code];
      const mapped = off != null;
      const note = mapped ? this.app.noteFor(off, 0) : null;
      return h('button', {
        class: `cap${mapped ? ' mapped' : ''}${mapped && isBlack(note) ? ' black-note' : ''}${this.kmSel === code ? ' sel' : ''}`,
        onclick: () => { this.kmSel = this.kmSel === code ? null : code; this.renderKeymap(); },
      }, h('span', { class: 'k' }, keyLabel(code)), h('span', { class: 'n' }, mapped ? noteName(note, v.noteNames) : T.keymap.unmapped));
    }))));

    // three octaves starting one below the base octave
    const piano = $('#keymap .km-piano');
    const width = piano.clientWidth || 820;
    const offs = [];
    for (let o = -12; o < 36; o++) offs.push(o);
    const whites = offs.filter((o) => !isBlack(this.app.noteFor(o, 0)));
    const ww = width / whites.length;
    const cur = this.kmSel != null ? map[this.kmSel] : null;
    let wi = 0;
    const keys = [];
    for (const o of offs) {
      const n = this.app.noteFor(o, 0);
      const black = isBlack(n);
      const x = black ? wi * ww - ww * 0.3 : wi * ww;
      const b = h('button', {
        class: `${black ? 'b' : 'w'}${cur === o ? ' cur' : ''}`,
        style: `left:${x}px;width:${black ? ww * 0.6 : ww}px`,
        title: noteName(n, v.noteNames),
        onpointerdown: () => { this.app.preview(n); if (this.kmSel) this.kmAssign(o); },
      }, !black && n % 12 === 0 ? h('span', { class: 'c-label' }, noteName(n, 'en')) : null);
      keys.push(b);
      if (!black) wi++;
    }
    piano.replaceChildren(...keys);
  }

  kmAssign(offset) {
    if (!this.kmSel) return;
    const map = { ...this.app.currentMap() };
    if (offset == null) delete map[this.kmSel];
    else map[this.kmSel] = offset;
    this.s.set({ keyPreset: 'custom', customMap: map });
  }

  // Key handling while the mapping sheet is open. Returns true if consumed.
  keymapKey(e) {
    if (e.type !== 'keydown') return true;
    if (e.code === 'Escape') { this.close(); return true; }
    if (this.kmSel && (e.code === 'Delete' || e.code === 'Backspace')) { this.kmAssign(null); return true; }
    if (this.kmSel && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) {
      const cur = this.app.currentMap()[this.kmSel] ?? 0;
      this.kmAssign(cur + (e.code === 'ArrowLeft' ? -1 : 1));
      this.app.preview(this.app.noteFor(this.app.currentMap()[this.kmSel], 0));
      return true;
    }
    if (LAYOUT.flat().includes(e.code)) {
      this.kmSel = e.code;
      const off = this.app.currentMap()[e.code];
      if (off != null) this.app.preview(this.app.noteFor(off, 0));
      this.renderKeymap();
      return true;
    }
    return false;
  }
}

export { PRESETS };
