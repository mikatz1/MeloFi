// Mixer: a strip per channel, per bus and the master — insert effects, routing, pan, reverb send,
// meter, fader, mute / solo — plus an effect editor and the master's loudness and spectrum.
import { h, knob, fader, popup, ask } from './dom.js';
import { FX_TYPES, FX_ORDER, FX_PRESETS, fxDefaults, fmtParam } from '../fx.js';
import { uid, newBus } from '../model.js';
import { LoudnessMeter } from '../meter.js';
import { t } from '../../i18n/i18n.js';

const panFmt = (v) => (Math.abs(v) < 0.02 ? 'C' : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`);

export class Mixer {
  constructor(studio, el) {
    this.S = studio;
    this.el = el;
    this.meters = new Map(); // strip id -> { el, peak }
    this.edit = null;        // { strip, fx } being edited
    this.meter = new LoudnessMeter(); // BS.1770, the same meter as the mastering window
    this.onBlock = (b) => { if (this.S.transport?.playing) this.meter.push(b); };
  }

  get proj() { return this.S.proj; }

  stripOf(id) {
    const p = this.proj;
    if (id === 'master') return { id: 'master', name: t('마스터'), fx: p.master.fx, obj: p.master };
    const c = p.channels.find((x) => x.id === id);
    if (c) return { id, name: c.name, fx: c.fx, obj: c, channel: c };
    const b = p.buses.find((x) => x.id === id);
    return b ? { id, name: b.name, fx: b.fx, obj: b, bus: b } : null;
  }

  addFx(stripId, type) {
    const s = this.stripOf(stripId);
    if (!s) return;
    const fx = { id: uid('f'), type, on: true, params: fxDefaults(type) };
    if (type === 'sidechain') fx.params.source = this.proj.channels.find((c) => /kick|킥/i.test(c.name))?.id || this.proj.channels[0]?.id;
    this.S.edit(() => s.fx.push(fx));
    this.edit = { strip: stripId, fx: fx.id };
    this.S.syncAudio();
    this.render();
  }

  addPreset(stripId, chain) {
    const s = this.stripOf(stripId);
    if (!s) return;
    const made = chain.map(([type, params]) => ({ id: uid('f'), type, on: true, params: { ...fxDefaults(type), ...params } }));
    this.S.edit(() => s.fx.push(...made), true, t('이펙트 프리셋'));
    this.edit = { strip: stripId, fx: made[0].id };
    this.S.syncAudio();
    this.render();
  }

  fxSlots(s) {
    const S = this.S;
    return h('div', { class: 'mx-fx' },
      ...s.fx.map((f) => h('div', { class: `mx-slot${this.edit?.fx === f.id ? ' sel' : ''}${f.on === false ? ' off' : ''}` },
        h('button', { class: 'pw', title: t('켜기 / 끄기'), onclick: () => { S.edit(() => { f.on = f.on === false; }); S.syncAudio(); } }),
        h('button', { class: 'nm', title: t(FX_TYPES[f.type]?.hint || ''), onclick: () => { this.edit = { strip: s.id, fx: f.id }; this.render(); },
          oncontextmenu: (e) => { e.preventDefault(); popup(e.clientX, e.clientY, [
            { label: t('위로'), act: () => S.edit(() => { const i = s.fx.indexOf(f); if (i > 0) s.fx.splice(i - 1, 0, ...s.fx.splice(i, 1)); }) },
            { label: t('아래로'), act: () => S.edit(() => { const i = s.fx.indexOf(f); if (i < s.fx.length - 1) s.fx.splice(i + 1, 0, ...s.fx.splice(i, 1)); }) },
            { sep: true },
            { label: t('삭제'), act: () => { S.edit(() => s.fx.splice(s.fx.indexOf(f), 1)); if (this.edit?.fx === f.id) this.edit = null; S.syncAudio(); } },
          ]); } }, t(FX_TYPES[f.type]?.name || f.type)))),
      h('button', { class: 'mx-add', onclick: (e) => popup(e.clientX, e.clientY, [
        { group: t('이펙트') }, ...FX_ORDER.map((k) => ({ label: t(FX_TYPES[k].name), hint: t(FX_TYPES[k].hint), act: () => this.addFx(s.id, k) })),
        { group: t('프리셋 (여러 이펙트 한 번에)') }, ...FX_PRESETS.map(([name, hint, chain]) => ({ label: t(name), hint: t(hint), act: () => this.addPreset(s.id, chain) })),
      ]).classList.add('tall') }, t('+ 이펙트')));
  }

  strip(s, kind) {
    const S = this.S, proj = this.proj, o = s.obj;
    const meter = h('div', { class: 'mx-meter' }, h('i'));
    this.meters.set(s.id, { el: meter, peak: 0 });
    const tgt = kind === 'master' ? 'master' : `${kind}:${s.id}`;
    const route = s.channel ? h('select', { class: 'mx-route', title: t('출력'), onchange: (e) => { S.edit(() => { o.out = e.target.value; }); S.syncAudio(); } },
      h('option', { value: 'master' }, t('→ 마스터')), ...proj.buses.map((b) => h('option', { value: b.id, selected: o.out === b.id }, `→ ${b.name}`))) : null;
    return h('div', { class: `mx-strip ${kind}${s.id === proj.selected || (this.edit?.strip === s.id) ? ' sel' : ''}`, 'data-id': s.id },
      h('div', { class: 'mx-name', style: `--c:${o.color || 'var(--accent)'}`, title: s.channel ? S.instName(o.inst) : s.name,
        onclick: () => { if (s.channel) S.select(s.id); else { this.edit = { strip: s.id, fx: s.fx[0]?.id || null }; this.render(); } },
        ondblclick: async () => { if (!s.bus) return; const v = await ask(t('믹서 트랙 이름'), o.name); if (v && v.trim()) S.edit(() => { o.name = v.trim(); }); },
        oncontextmenu: (e) => { if (!s.bus) return; e.preventDefault(); popup(e.clientX, e.clientY, [{ label: t('믹서 트랙 삭제'), act: () => { S.edit(() => { proj.buses.splice(proj.buses.indexOf(o), 1); for (const c of proj.channels) if (c.out === o.id) c.out = 'master'; }); S.syncAudio(); } }]); } }, s.name),
      route,
      this.fxSlots(s),
      kind !== 'master' ? this.sendsRow(s, o) : null,
      h('div', { class: 'mx-knobs' },
        kind !== 'master' ? h('label', {}, knob({ value: o.pan || 0, min: -1, max: 1, def: 0, bipolar: true, title: t('팬'), fmt: panFmt, target: `${tgt}:pan`,
          onInput: (v) => { o.pan = v; S.applyStrips(); }, onChange: () => S.changed() }), h('span', {}, t('팬'))) : null,
        s.channel ? h('label', {}, knob({ value: o.send, min: 0, max: 1, def: 0.15, title: t('리버브'), fmt: (v) => `${Math.round(v * 100)}%`, target: `${tgt}:send`,
          onInput: (v) => { o.send = v; S.applyStrips(); }, onChange: () => S.changed() }), h('span', {}, t('리버브'))) : null),
      h('div', { class: 'mx-body' }, meter, fader({ value: o.vol, def: kind === 'master' ? 0.85 : 0.8, title: t('볼륨'), target: kind === 'master' ? 'master:vol' : `${tgt}:vol`,
        onInput: (v) => { o.vol = v; S.applyStrips(); }, onChange: () => S.changed() })),
      kind === 'master' ? h('div', { class: 'mx-btns' }) : h('div', { class: 'mx-btns' },
        h('button', { class: `mx-m${o.mute ? ' on' : ''}`, title: t('음소거'), onclick: () => { S.edit(() => { o.mute = !o.mute; }); S.syncAudio(); } }, 'M'),
        s.channel ? h('button', { class: `mx-s${o.solo ? ' on' : ''}`, title: t('솔로'), onclick: () => S.edit(() => { o.solo = !o.solo; }) }, 'S') : null,
        // FL: arm a mixer track for audio recording; right-click picks its input
        s.channel ? h('button', { class: `mx-arm${o.arm ? ' on' : ''}`, title: t('녹음 대기: R(녹음)을 누르면 {input}을(를) 이 트랙에 녹음 · 우클릭: 입력 선택', { input: o.inputName || t('기본 입력') }),
          onclick: () => { S.edit(() => { o.arm = !o.arm; }); this.render(); },
          oncontextmenu: async (e) => { e.preventDefault(); await this.inputMenu(e, o); } }, '●') : null));
  }

  async inputMenu(e, o) {
    const S = this.S;
    let devs = [];
    try { devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput'); } catch { /* none */ }
    popup(e.clientX, e.clientY, [
      { group: t('녹음 입력') },
      { label: t('기본 입력'), hint: !o.input ? t('선택됨') : '', act: () => { S.edit(() => { o.input = null; o.inputName = null; }); this.render(); } },
      ...devs.filter((d) => d.deviceId && d.deviceId !== 'default').map((d, i) => ({ label: d.label || t('입력 {n}', { n: i + 1 }), hint: o.input === d.deviceId ? t('선택됨') : '',
        act: () => { S.edit(() => { o.input = d.deviceId; o.inputName = d.label || t('입력 {n}', { n: i + 1 }); o.arm = true; }); this.render(); } })),
    ]);
  }

  // FL-style sends: post-fader, to any bus, as many as you like (right-click a send to remove it)
  sendsRow(s, o) {
    const S = this.S, proj = this.proj;
    const targets = proj.buses.filter((b) => b.id !== s.id && !(o.sends || []).some((x) => x.to === b.id));
    const apply = () => { const st = S.engine.strip(s.id); st?.setSends(o.sends, S.engine.buses); };
    return h('div', { class: 'mx-sends' },
      ...(o.sends || []).map((x) => {
        const bus = proj.buses.find((b) => b.id === x.to);
        if (!bus) return null;
        return h('label', { title: t('{bus}(으)로 보내는 양 · 우클릭: 센드 삭제', { bus: bus.name }), oncontextmenu: (e) => { e.preventDefault(); S.edit(() => { o.sends = o.sends.filter((y) => y !== x); }); apply(); this.render(); } },
          knob({ value: x.level ?? 0.5, min: 0, max: 1, def: 0.5, title: `→ ${bus.name}`, fmt: (v) => `${Math.round(v * 100)}%`, onInput: (v) => { x.level = v; apply(); }, onChange: () => S.changed() }),
          h('span', {}, `→${bus.name}`));
      }),
      targets.length ? h('button', { class: 'mx-add sm', title: t('다른 믹서 트랙으로 보내기 (센드)'), onclick: (e) => popup(e.clientX, e.clientY, targets.map((b) => ({ label: `→ ${b.name}`, act: () => { S.edit(() => { (o.sends ||= []).push({ to: b.id, level: 0.5 }); }); apply(); this.render(); } }))) }, t('+ 센드')) : null);
  }

  // knobs for the selected effect
  editor() {
    const S = this.S, e = this.edit;
    const s = e && this.stripOf(e.strip);
    const f = s?.fx.find((x) => x.id === e.fx);
    if (!f) return h('div', { class: 'mx-ed empty' }, h('span', {}, t('이펙트를 고르면 여기서 조절합니다. 노브를 우클릭하면 오토메이션 클립을 만들거나 MIDI 컨트롤러에 연결할 수 있습니다.')));
    const def = FX_TYPES[f.type];
    const ctrls = def.params.map((p) => {
      const val = f.params[p.key] ?? p.def;
      if (p.channel) {
        return h('label', { class: 'fx-p' }, h('span', {}, t(p.label)), h('select', { onchange: (ev) => { S.edit(() => { f.params[p.key] = ev.target.value; }); S.syncAudio(); } },
          ...S.proj.channels.map((c) => h('option', { value: c.id, selected: c.id === val }, c.name))));
      }
      if (p.choices) {
        return h('label', { class: 'fx-p' }, h('span', {}, t(p.label)), h('select', { onchange: (ev) => { S.edit(() => { f.params[p.key] = +ev.target.value; }); S.applyFx(e.strip); } },
          ...p.choices.map((c, i) => h('option', { value: i, selected: Math.round(val) === i }, t(c)))));
      }
      const out = h('b', {}, fmtParam(p, val));
      const k = knob({ value: val, min: p.min, max: p.max, def: p.def, size: 30, title: t(p.label), fmt: (v) => fmtParam(p, v), target: `fx:${e.strip}:${f.id}:${p.key}`,
        onInput: (v) => { f.params[p.key] = p.step ? Math.round(v / p.step) * p.step : v; out.textContent = fmtParam(p, f.params[p.key]); S.applyFx(e.strip); },
        onChange: () => S.changed() });
      return h('label', { class: 'fx-p k' }, k, h('span', {}, t(p.label)), out);
    });
    return h('div', { class: 'mx-ed' }, h('div', { class: 'mx-ed-head' }, h('b', {}, `${s.name} · ${t(def.name)}`), h('span', {}, t(def.hint))), h('div', { class: 'mx-ed-body' }, ...ctrls));
  }

  render() {
    if (!this.proj) return; // a floating mixer restored before the project is loaded
    const S = this.S, proj = this.proj;
    this.meters.clear();
    const strips = proj.channels.map((c) => this.strip(this.stripOf(c.id), 'ch'));
    const buses = proj.buses.map((b) => this.strip(this.stripOf(b.id), 'bus'));
    const addBus = h('button', { class: 'mx-addbus', title: t('여러 채널을 묶어 함께 처리할 믹서 트랙(Insert)을 만듭니다'), onclick: () => S.edit(() => proj.buses.push(newBus(proj.buses.length))) }, t('+ 믹서 트랙'));
    this.spec = h('canvas', { class: 'mx-spec' });
    this.lufsEl = h('div', { class: 'mx-lufs' });
    const analysis = h('div', { class: 'mx-ana' }, h('b', {}, t('마스터 분석')), this.lufsEl, this.spec,
      h('p', { class: 'hint' }, t('스트리밍 서비스는 대개 -14 LUFS 근처로 맞춥니다.')),
      h('button', { class: 'btn sm', title: t('마스터 체인, 라우드니스·실제 피크 미터, 자동 마스터링, 레퍼런스 비교 (Ctrl+Shift+B)'), onclick: () => S.mastering.show() }, t('마스터링 창 열기')));
    this.el.replaceChildren(
      h('div', { class: 'mx-wrap' },
        h('div', { class: 'mx-main' },
          h('div', { class: 'mx-row' }, ...strips, h('div', { class: 'mx-gap' }), ...buses, addBus, this.strip(this.stripOf('master'), 'master'), analysis),
          this.editor()),
        this.insertPanel()));
  }

  // FL Studio's mixer side panel: the selected track's ten numbered effect slots and its output
  insertPanel() {
    const S = this.S, proj = this.proj;
    const id = this.edit?.strip || proj.selected || 'master';
    const s = this.stripOf(id) || this.stripOf('master');
    const menu = (e) => popup(e.clientX, e.clientY, [
      { group: t('이펙트') }, ...FX_ORDER.map((k) => ({ label: t(FX_TYPES[k].name), hint: t(FX_TYPES[k].hint), act: () => this.addFx(s.id, k) })),
      { group: t('프리셋 (여러 이펙트 한 번에)') }, ...FX_PRESETS.map(([name, hint, chain]) => ({ label: t(name), hint: t(hint), act: () => this.addPreset(s.id, chain) })),
    ]).classList.add('tall');
    const slots = Array.from({ length: Math.max(10, s.fx.length) }, (_, i) => {
      const f = s.fx[i];
      if (!f) return h('div', { class: 'mx-ins-slot empty', title: t('빈 슬롯: 클릭해 이펙트 넣기'), onclick: menu }, h('span', { class: 'no' }, String(i + 1)), h('span', { class: 'nm' }, t('(비어 있음)')));
      return h('div', { class: `mx-ins-slot${this.edit?.fx === f.id ? ' sel' : ''}${f.on === false ? ' off' : ''}`, title: t(FX_TYPES[f.type]?.hint || '') },
        h('span', { class: 'no' }, String(i + 1)),
        h('button', { class: 'nm', onclick: () => { this.edit = { strip: s.id, fx: f.id }; this.render(); } }, t(FX_TYPES[f.type]?.name || f.type)),
        h('input', { type: 'checkbox', checked: f.on !== false, title: t('켜기 / 끄기'), onchange: () => { S.edit(() => { f.on = f.on === false; }); S.syncAudio(); } }));
    });
    const out = s.channel ? h('label', { class: 'mx-ins-out' }, t('출력'),
      h('select', { onchange: (e) => { S.edit(() => { s.obj.out = e.target.value; }); S.syncAudio(); } },
        h('option', { value: 'master' }, t('마스터')), ...proj.buses.map((b) => h('option', { value: b.id, selected: s.obj.out === b.id }, b.name)))) : null;
    return h('div', { class: 'mx-insert' },
      h('div', { class: 'mx-ins-head' }, h('b', {}, s.name), h('span', {}, s.channel ? t('채널') : s.bus ? 'Insert' : 'Master')),
      h('div', { class: 'mx-ins-slots' }, ...slots),
      out);
  }

  // meters, loudness and spectrum, every frame while visible
  tick() {
    const S = this.S, E = S.engine;
    for (const [id, m] of this.meters) {
      const lvl = id === 'master' ? E.level() : E.strip(id)?.level() ?? 0;
      const db = lvl > 1e-5 ? 20 * Math.log10(lvl) : -100;
      const f = Math.max(0, Math.min(1, (db + 48) / 48));
      m.peak = Math.max(f, m.peak - 0.012);
      m.el.style.setProperty('--f', String(f));
      m.el.style.setProperty('--p', String(m.peak));
      m.el.classList.toggle('clip', lvl > 0.98);
    }
    if (!this.spec?.isConnected) return;
    const now = performance.now();
    if (!this.lastL || now - this.lastL > 150) {
      this.lastL = now;
      E.blockListeners?.add(this.onBlock);
      const m = this.meter, fmt = (x) => (x <= -69.5 ? '—' : x.toFixed(1));
      this.lufsEl.replaceChildren(
        h('span', {}, t('순간'), ' ', h('b', {}, fmt(m.M))), h('span', {}, t('3초'), ' ', h('b', {}, fmt(m.S))), h('span', {}, t('전체'), ' ', h('b', {}, fmt(m.I))), h('small', {}, 'LUFS'),
        h('span', {}, t('피크'), ' ', h('b', {}, fmt(m.TP))), h('small', {}, 'dBTP'),
        h('button', { class: 'btn sm ghost', onclick: () => this.meter.reset() }, t('초기화')));
    }
    // spectrum (log frequency)
    const cv = this.spec, r = cv.getBoundingClientRect();
    if (!r.width) return;
    const d = devicePixelRatio || 1;
    if (cv.width !== Math.round(r.width * d)) { cv.width = Math.round(r.width * d); cv.height = Math.round(r.height * d); }
    const g = cv.getContext('2d'), W = cv.width, H = cv.height;
    const an = E.spec, bins = this.bins && this.bins.length === an.frequencyBinCount ? this.bins : (this.bins = new Float32Array(an.frequencyBinCount));
    an.getFloatFrequencyData(bins);
    g.fillStyle = '#0b0c0f'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#24252b';
    for (const fq of [100, 1000, 10000]) { const x = (Math.log(fq / 20) / Math.log(1000)) * W; g.fillRect(x, 0, 1, H); }
    g.beginPath();
    const sr = E.ctx.sampleRate;
    for (let x = 0; x < W; x += 2) {
      const fq = 20 * Math.pow(1000, x / W), i = Math.min(bins.length - 1, Math.round((fq / (sr / 2)) * bins.length));
      const db = Math.max(-100, bins[i]), y = H - ((db + 100) / 90) * H;
      if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.strokeStyle = '#e0a440'; g.lineWidth = d; g.stroke();
  }
}
