// Channel settings: what the channel plays (instrument / synth editor / sample editor / slicer),
// its rhythm (own swing, groove template, step loop length) and where it goes in the mixer.
import { h, knob, popup } from './dom.js';
import { SYNTH_PARAMS, SYNTH_PRESETS, synthDefaults } from '../synth.js';
import { GROOVES } from '../transport.js';
import { decode, onsets, gridSlices, peaks } from '../media.js';
import { STEP, pattern, notesOf } from '../model.js';
import { fmtParam } from '../fx.js';

export class ChannelSheet {
  constructor(studio) {
    this.S = studio;
    this.tab = 'sound';
    // like FL Studio's channel / plugin window: it floats over the studio without dimming it,
    // moves by its title bar, stays open while you keep working and remembers where it was
    let head;
    this.el = h('section', { id: 'chsheet', class: 'ch-float', hidden: true },
      h('div', { class: 'sheet-card ch-card' },
        head = h('div', { class: 'sheet-head ch-drag', title: '끌어서 옮기기' }, this.title = h('h2', {}), h('button', { class: 'x', 'aria-label': '닫기', onclick: () => this.close() })),
        this.tabsEl = h('div', { class: 'cl-tabs ch-tabs' }),
        this.body = h('div', { class: 'ch-body' })));
    this.pos = null;
    head.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      try { head.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
      const r = this.el.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
      const move = (ev) => { this.pos = { x: Math.max(0, Math.min(innerWidth - 120, ev.clientX - dx)), y: Math.max(0, Math.min(innerHeight - 40, ev.clientY - dy)) }; this.place(); };
      const up = () => { head.removeEventListener('pointermove', move); head.removeEventListener('pointerup', up); };
      head.addEventListener('pointermove', move); head.addEventListener('pointerup', up);
    });
    this.el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); this.close(); } });
    document.body.append(this.el);
  }

  place() {
    const p = this.pos || { x: Math.max(20, innerWidth / 2 - 430), y: 90 };
    this.el.style.left = `${p.x}px`; this.el.style.top = `${p.y}px`;
  }

  get ch() { return this.S.proj.channels.find((c) => c.id === this.id); }
  close() { this.el.hidden = true; }

  show(id, tab) {
    this.id = id;
    if (tab) this.tab = tab;
    this.el.hidden = false;
    this.place();
    this.render();
  }

  render() {
    const ch = this.ch;
    if (!ch) return this.close();
    this.title.textContent = `${ch.name} 설정`;
    this.tabsEl.replaceChildren(...[['sound', '소리'], ['rhythm', '리듬'], ['vocal', '보컬'], ['out', '출력']].map(([k, l]) => h('button', { class: this.tab === k ? 'on' : '', onclick: () => { this.tab = k; this.render(); } }, l)));
    this.body.replaceChildren(this.tab === 'rhythm' ? this.rhythm(ch) : this.tab === 'out' ? this.output(ch) : this.tab === 'vocal' ? this.vocal(ch) : this.sound(ch));
  }

  // ---------- sound ----------
  sound(ch) {
    const S = this.S;
    const kinds = h('div', { class: 'seg sm ch-kind' }, ...[['inst', '악기'], ['synth', '신스'], ['sample', '샘플'], ['slicer', '슬라이서'], ['audio', '오디오'], ...(ch.kind === 'vst' ? [['vst', 'VST']] : [])].map(([k, l]) =>
      h('button', { class: (ch.kind || 'inst') === k ? 'on' : '', onclick: () => this.setKind(k) }, l)));
    let body;
    if ((ch.kind || 'inst') === 'inst') {
      body = h('div', { class: 'ch-inst' }, h('p', {}, '지금 악기: ', h('b', {}, S.instName(ch.inst))),
        h('div', { class: 'row' }, h('button', { class: 'btn', onclick: (e) => S.pickInstrument(e.clientX, e.clientY, (id) => { S.edit(() => { ch.inst = id; ch.name = S.instName(id); }); S.syncAudio(); this.render(); }, ch.inst) }, '악기 바꾸기…'),
          h('button', { class: 'btn ghost', onclick: () => S.app.store.show() }, '악기 다운로드 센터…')));
    } else if (ch.kind === 'vst') body = this.vst(ch);
    else if (ch.kind === 'synth') body = this.synth(ch);
    else if (ch.kind === 'sample' || ch.kind === 'slicer') body = this.sample(ch);
    else body = h('p', { class: 'dim' }, '오디오 트랙은 플레이리스트에 놓은 오디오 클립을 재생합니다. 브라우저에서 파일을 플레이리스트로 끌어 오세요.');
    return h('div', {}, kinds, body);
  }

  // ---------- vocal: lyrics + the singing engine ----------
  vocal(ch) {
    const S = this.S;
    const v = ch.vocal || {};
    const info = h('p', { class: 'dim' }, '보컬 엔진을 확인하는 중…');
    const setupBtn = h('button', { class: 'btn', hidden: true, onclick: async () => {
      setupBtn.disabled = true;
      const off = window.melofi.onVocalProgress((m) => { info.textContent = m; });
      const r = await window.melofi.vocalSetup();
      off();
      info.textContent = r.ok ? '설치를 마쳤습니다.' : r.message;
      setupBtn.disabled = false;
      if (r.ok) this.render();
    } }, '보컬 엔진 설치');
    window.melofi.vocalStatus().then((st) => {
      const voice = st.voices.find((x) => x.id === (v.voice || 'r9y9/yoko_latest')) || st.voices[0];
      info.textContent = st.ready ? `보이스: ${voice.name} — ${voice.note}${voice.downloaded ? '' : ' · 최초 실행 시 보컬 모델을 다운로드합니다 (약 47 MB)'}`
        : `보컬 엔진이 설치되어 있지 않습니다. 오픈소스 가창 합성기(NNSVS)를 이 기기에 설치합니다. Python 3.10~3.12 및 Microsoft C++ Build Tools가 필요합니다.${st.error ? ` (${st.error})` : ''}`;
      setupBtn.hidden = st.ready;
      singBtn.disabled = !st.ready;
    });
    const count = h('span', { class: 'dim' });
    const update = async (text) => {
      const { morae, unsupported, melodyOf } = await import('../vocal.js');
      const bad = unsupported(text);
      const n = melodyOf(S.proj, ch.id).length;
      count.textContent = bad.length ? `히라가나·가타카나만 지원합니다: ${bad.slice(0, 6).join(' ')}` : `음절 ${morae(text).length}개 · 노트 ${n}개${morae(text).length && morae(text).length < n ? ' (남는 노트는 직전 모음이 연장됩니다)' : ''}`;
    };
    const area = h('textarea', { class: 'cl-in vo-lyrics', rows: 5, placeholder: 'どこかで きみは ぼくを みているのだろうか', oninput: (e) => update(e.target.value),
      onchange: (e) => S.edit(() => { ch.vocal = { ...(ch.vocal || {}), lyrics: e.target.value }; }) });
    area.value = v.lyrics || '';
    update(area.value);
    const singBtn = h('button', { class: 'btn', disabled: true, onclick: async () => {
      S.edit(() => { ch.vocal = { ...(ch.vocal || {}), lyrics: area.value }; });
      singBtn.disabled = true;
      await S.sing(ch);
      singBtn.disabled = false;
    } }, '노래 만들기');
    return h('div', { class: 'ch-vocal' },
      h('p', {}, '이 채널의 멜로디에 가사를 입혀 노래합니다. 노트 하나당 한 음절씩 순서대로 적용되며, 완료 시 오디오 트랙으로 생성되고 이 채널은 음소거됩니다.'),
      info, h('div', { class: 'row' }, setupBtn),
      h('label', { class: 'cl-lab' }, '가사 (히라가나 · 가타카나)'), area, count,
      h('div', { class: 'row' }, singBtn));
  }

  vst(ch) {
    const S = this.S, v = ch.vst || {};
    const msg = h('p', { class: 'dim' });
    return h('div', { class: 'ch-inst' },
      h('p', {}, 'VST 플러그인: ', h('b', {}, v.name || '없음'), v.vendor ? h('span', { class: 'dim' }, ` · ${v.vendor}`) : null),
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: async () => { const r = await window.melofi.vstEditor(ch.id); msg.textContent = r.ok ? '' : r.error === 'no_editor' ? '이 플러그인은 편집 창이 없습니다.' : `창을 열지 못했습니다: ${r.message || r.error}`; } }, '플러그인 창 열기'),
        h('button', { class: 'btn ghost', onclick: (e) => S.vstMenu(e.clientX, e.clientY, (p) => { S.edit(() => { ch.vst = { plugin: p.id, file: p.file, name: p.name, vendor: p.vendor }; ch.name = p.name; }); S.syncAudio(); this.render(); }) }, '플러그인 바꾸기…')),
      msg,
      h('p', { class: 'dim' }, '실시간 연주 및 재생은 VST 호스트에서 직접 출력됩니다. 믹서 이펙트는 내보내기 및 \'Consolidate\' 실행 시 적용되며, 플러그인 설정은 프로젝트 저장 시 함께 기록됩니다.'));
  }

  setKind(kind) {
    const S = this.S, ch = this.ch;
    if ((ch.kind || 'inst') === kind) return;
    if ((kind === 'sample' || kind === 'slicer') && !ch.sample) { S.addSampleChannel(kind, ch); return; }
    S.edit(() => {
      ch.kind = kind;
      if (kind === 'synth' && !ch.synth) { ch.synth = synthDefaults(); ch.synthPreset = '기본 쏘'; }
    });
    S.syncAudio();
    this.render();
  }

  synth(ch) {
    const S = this.S;
    const p = { ...synthDefaults(), ...ch.synth };
    const apply = () => { S.engine.channels.get(ch.id)?.src?.setParams?.(ch.synth); };
    const presets = h('select', { onchange: (e) => { S.edit(() => { ch.synth = { ...synthDefaults(), ...SYNTH_PRESETS[e.target.value] }; ch.synthPreset = e.target.value; }); apply(); this.render(); S.preview(ch.id, 60, 100); } },
      h('option', { value: '' }, '프리셋 고르기…'), ...Object.keys(SYNTH_PRESETS).map((k) => h('option', { value: k, selected: ch.synthPreset === k }, k)));
    const groups = [];
    let cur = null;
    for (const d of SYNTH_PARAMS) {
      if (d.group) { cur = h('div', { class: 'sy-grp' }, h('b', {}, d.group)); groups.push(cur); continue; }
      const val = p[d.key];
      let ctl;
      if (d.choices) ctl = h('select', { onchange: (e) => { S.edit(() => { ch.synth = { ...p, ...ch.synth, [d.key]: +e.target.value }; ch.synthPreset = null; }); apply(); } }, ...d.choices.map((c, i) => h('option', { value: i, selected: Math.round(val) === i }, c)));
      else {
        const out = h('em', {}, fmtParam(d, val));
        ctl = h('span', { class: 'sy-k' }, knob({ value: val, min: d.min, max: d.max, def: d.def, size: 26, title: d.label, fmt: (v) => fmtParam(d, v),
          onInput: (v) => { ch.synth = { ...p, ...ch.synth, [d.key]: d.step ? Math.round(v / d.step) * d.step : v }; ch.synthPreset = null; out.textContent = fmtParam(d, ch.synth[d.key]); apply(); },
          onChange: () => S.changed() }), out);
      }
      cur.append(h('label', { class: 'sy-p' }, h('span', {}, d.label), ctl));
    }
    return h('div', { class: 'sy' }, h('div', { class: 'row' }, presets, h('button', { class: 'btn sm', onclick: () => S.preview(ch.id, 60, 100) }, '들어보기'),
      h('span', { class: 'dim' }, '노브를 돌리면서 건반을 눌러 보세요.')), h('div', { class: 'sy-grid' }, ...groups));
  }

  sample(ch) {
    const S = this.S, sp = ch.sample || {};
    const m = S.proj.media[sp.media];
    const cv = h('canvas', { class: 'wave' });
    const set = (patch) => { S.edit(() => { ch.sample = { ...ch.sample, ...patch }; }, false); S.syncAudio(); this.drawWave(cv, ch); };
    const num = (label, key, min, max, step, def) => h('label', { class: 'frm-row' }, h('span', {}, label),
      h('input', { type: 'number', class: 'cl-in', min, max, step, value: sp[key] ?? def, onchange: (e) => set({ [key]: +e.target.value }) }));
    const chk = (label, key) => h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: !!sp[key], onchange: (e) => set({ [key]: e.target.checked }) }), ` ${label}`);
    const tools = ch.kind === 'slicer'
      ? h('div', { class: 'row' },
        h('button', { class: 'btn sm', onclick: async () => { const b = await decode(sp.media, 48000); S.edit(() => { ch.slices = onsets(b, 0.55); }); S.syncAudio(); this.render(); } }, '소리 시작점으로 자르기'),
        h('button', { class: 'btn sm', onclick: (e) => popup(e.clientX, e.clientY, [4, 8, 16, 32].map((n) => ({ label: `${n}등분`, act: () => { S.edit(() => { ch.slices = gridSlices(m.dur, n); }); S.syncAudio(); this.render(); } }))) }, '같은 간격으로 자르기 ▾'),
        h('button', { class: 'btn sm', onclick: () => this.slicesToPattern(ch) }, '슬라이스 순서대로 패턴 만들기'),
        h('span', { class: 'dim' }, `${(ch.slices || []).length}조각 · 파형 클릭: 자르기 추가 · 우클릭: 지우기`))
      : h('div', { class: 'row' }, h('span', { class: 'dim' }, '파형에서 왼쪽 드래그: 시작점 · 오른쪽 드래그: 끝점'));
    const out = h('div', { class: 'smp' },
      h('p', {}, h('b', {}, m?.name || '파일 없음'), m ? h('span', { class: 'dim' }, `  ${m.dur.toFixed(2)}초${m.bpm ? ` · 추정 ${m.bpm} BPM` : ''}`) : null,
        h('button', { class: 'btn sm ghost', onclick: () => S.addSampleChannel(ch.kind, ch) }, '파일 바꾸기…')),
      cv, tools,
      h('div', { class: 'smp-ctl' },
        num('기준음 (MIDI)', 'root', 0, 127, 1, 60), num('미세 조정 (센트)', 'tune', -100, 100, 1, 0),
        num('어택 (초)', 'attack', 0, 2, 0.005, 0), num('릴리스 (초)', 'release', 0.01, 4, 0.01, 0.12), num('게인', 'gain', 0.1, 4, 0.05, 1),
        chk('거꾸로 재생', 'reverse'), ch.kind === 'sample' ? chk('반복 (루프)', 'loop') : null));
    requestAnimationFrame(() => this.drawWave(cv, ch, true));
    return out;
  }

  async drawWave(cv, ch, bind = false) {
    const S = this.S, sp = ch.sample;
    if (!sp?.media) return;
    const buf = await decode(sp.media, 48000).catch(() => null);
    if (!buf || !cv.isConnected) return;
    const r = cv.getBoundingClientRect(), d = devicePixelRatio || 1;
    cv.width = Math.round(r.width * d); cv.height = Math.round(r.height * d);
    const g = cv.getContext('2d'), W = cv.width, H = cv.height;
    const pk = peaks(buf, W);
    g.fillStyle = '#0b0c0f'; g.fillRect(0, 0, W, H);
    const x0 = ((sp.start || 0) / buf.duration) * W, x1 = ((sp.end ?? buf.duration) / buf.duration) * W;
    for (let x = 0; x < W; x++) {
      const lo = pk[x * 2], hi = pk[x * 2 + 1];
      g.fillStyle = ch.kind === 'sample' && (x < x0 || x > x1) ? '#3a3b40' : ch.color;
      g.fillRect(x, H / 2 - hi * H / 2, 1, Math.max(1, (hi - lo) * H / 2));
    }
    g.fillStyle = '#e0a440';
    if (ch.kind === 'slicer') for (const t of ch.slices || []) g.fillRect((t / buf.duration) * W, 0, d, H);
    else { g.fillRect(x0, 0, 2 * d, H); g.fillRect(x1 - 2 * d, 0, 2 * d, H); }
    if (!bind) return;
    const tAt = (e) => { const rr = cv.getBoundingClientRect(); return Math.max(0, Math.min(buf.duration, ((e.clientX - rr.left) / rr.width) * buf.duration)); };
    cv.oncontextmenu = (e) => {
      e.preventDefault();
      if (ch.kind !== 'slicer') return;
      const t = tAt(e), list = ch.slices || [];
      let best = -1, bd = Infinity;
      list.forEach((s, i) => { const dd = Math.abs(s - t); if (i > 0 && dd < bd) { bd = dd; best = i; } });
      if (best > 0) { S.edit(() => { ch.slices.splice(best, 1); }); S.syncAudio(); this.drawWave(cv, ch); }
    };
    cv.onpointerdown = (e) => {
      if (e.button !== 0) return;
      if (ch.kind === 'slicer') { const t = tAt(e); S.edit(() => { ch.slices = [...(ch.slices || [0]), t].sort((a, b) => a - b); }); S.syncAudio(); this.drawWave(cv, ch); S.preview(ch.id, (sp.root ?? 60) + ch.slices.indexOf(t)); return; }
      const t = tAt(e), end = sp.end ?? buf.duration, which = Math.abs(t - (sp.start || 0)) < Math.abs(t - end) ? 'start' : 'end';
      S.history.push();
      const move = (ev) => { const v = tAt(ev); ch.sample = { ...ch.sample, [which]: which === 'start' ? Math.min(v, (ch.sample.end ?? buf.duration) - 0.01) : Math.max(v, (ch.sample.start || 0) + 0.01) }; this.drawWave(cv, ch); };
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); S.syncAudio(); S.preview(ch.id, sp.root ?? 60); };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
      move(e);
    };
  }

  // the slices in order, one per 16th (or spread over the loop's real length when the tempo is known)
  slicesToPattern(ch) {
    const S = this.S, proj = S.proj, pat = pattern(proj), m = proj.media[ch.sample.media];
    const sl = ch.slices || [];
    if (!sl.length) return;
    const secPerTick = 60 / proj.bpm / 96;
    S.edit(() => {
      const list = notesOf(pat, ch.id);
      list.length = 0;
      sl.forEach((t, i) => {
        const end = sl[i + 1] ?? m.dur;
        const tt = Math.round(t / secPerTick / STEP) * STEP, d = Math.max(STEP, Math.round((end - t) / secPerTick / STEP) * STEP);
        list.push({ t: tt, d, n: (ch.sample.root ?? 60) + i, v: 100 });
      });
      const len = Math.max(...list.map((n) => n.t + n.d));
      pat.bars = Math.max(pat.bars, Math.ceil(len / (96 * 4)));
    });
    S.select(ch.id);
  }

  // ---------- rhythm ----------
  rhythm(ch) {
    const S = this.S, pat = pattern(S.proj);
    const steps = pat.bars * 16;
    return h('div', { class: 'cl-form' },
      h('label', { class: 'frm-row' }, h('span', {}, '스윙'),
        h('select', { onchange: (e) => S.edit(() => { ch.swing = e.target.value === '' ? null : +e.target.value; }) },
          h('option', { value: '', selected: ch.swing == null }, '프로젝트 설정 따르기'), ...[0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6].map((v) => h('option', { value: v, selected: ch.swing === v }, `${Math.round(v * 100)}%`)))),
      h('label', { class: 'frm-row' }, h('span', {}, '그루브'),
        h('select', { onchange: (e) => S.edit(() => { ch.groove = e.target.value || null; }) },
          h('option', { value: '', selected: !ch.groove }, '없음'), ...Object.keys(GROOVES).map((k) => h('option', { value: k, selected: ch.groove === k }, k)))),
      h('p', { class: 'dim' }, '그루브는 16분음표마다 타이밍과 벨로시티를 조금씩 밀고 당겨 사람이 연주한 느낌을 줍니다. 그루브를 고르면 스윙 대신 적용됩니다.'),
      h('label', { class: 'frm-row' }, h('span', {}, '스텝 반복 길이'),
        h('select', { onchange: (e) => S.edit(() => { ch.loopSteps = +e.target.value; }) },
          h('option', { value: 0, selected: !ch.loopSteps }, '패턴 전체'), ...[3, 4, 5, 6, 7, 8, 12, 16, 24, 32].filter((n) => n < steps).map((n) => h('option', { value: n, selected: ch.loopSteps === n }, `${n}칸마다 반복`)))),
      h('p', { class: 'dim' }, '이 채널만 짧게 반복시켜 다른 채널과 엇갈리는 리듬(폴리리듬)을 만들 수 있습니다.'),
      h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: !!ch.arp?.on, onchange: (e) => S.edit(() => { ch.arp = { mode: 'up', rate: 24, octaves: 1, gate: 0.85, ...(ch.arp || {}), on: e.target.checked }; }) }), ' 아르페지에이터: 화음을 재생할 때 한 음씩 펼쳐서 연주'),
      ch.arp?.on ? h('div', {},
        h('label', { class: 'frm-row' }, h('span', {}, '순서'), h('select', { onchange: (e) => S.edit(() => { ch.arp.mode = e.target.value; }) }, ...[['up', '위로'], ['down', '아래로'], ['updown', '위아래'], ['random', '무작위']].map(([v, l]) => h('option', { value: v, selected: ch.arp.mode === v }, l)))),
        h('label', { class: 'frm-row' }, h('span', {}, '빠르기'), h('select', { onchange: (e) => S.edit(() => { ch.arp.rate = +e.target.value; }) }, ...[[48, '8분음표'], [24, '16분음표'], [12, '32분음표'], [16, '16분 셋잇단']].map(([v, l]) => h('option', { value: v, selected: ch.arp.rate === v }, l)))),
        h('label', { class: 'frm-row' }, h('span', {}, '옥타브'), h('select', { onchange: (e) => S.edit(() => { ch.arp.octaves = +e.target.value; }) }, ...[1, 2, 3].map((v) => h('option', { value: v, selected: ch.arp.octaves === v }, `${v}옥타브`)))),
        h('label', { class: 'frm-row' }, h('span', {}, '음 길이'), h('select', { onchange: (e) => S.edit(() => { ch.arp.gate = +e.target.value; }) }, ...[[0.3, '짧게 (스타카토)'], [0.6, '중간'], [0.85, '길게'], [1, '끊김 없이']].map(([v, l]) => h('option', { value: v, selected: ch.arp.gate === v }, l))))) : null);
  }

  output(ch) {
    const S = this.S;
    return h('div', { class: 'cl-form' },
      h('label', { class: 'frm-row' }, h('span', {}, '보낼 곳'),
        h('select', { onchange: (e) => { S.edit(() => { ch.out = e.target.value; }); S.syncAudio(); } },
          h('option', { value: 'master' }, '마스터'), ...S.proj.buses.map((b) => h('option', { value: b.id, selected: ch.out === b.id }, b.name)))),
      h('p', { class: 'dim' }, `이펙트 ${ch.fx.length}개 · 이펙트는 믹서에서 넣고 조절합니다.`),
      h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => { this.close(); S.setTab('mixer'); } }, '믹서 열기')));
  }
}

