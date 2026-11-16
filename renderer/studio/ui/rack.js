// Channel rack: one row per channel — mute, pan / volume knobs, name, step sequencer.
// Graph mode shows each step's velocity, pan or fine pitch as a bar you can drag.
import { h, knob, popup, ask } from './dom.js';
import { STEP, pattern, stepOn, notesOf, newChannel } from '../model.js';
import { kitNames } from '../../js/drums.js';
import { synthDefaults, SYNTH_PRESETS } from '../synth.js';
import { presetParams } from '../synth-user.js';
import { t, N_ } from '../../i18n/i18n.js';

const KIND_LABEL = { synth: N_('신스'), sample: N_('샘플'), slicer: N_('슬라이서'), audio: N_('오디오'), vst: 'VST' };
const GRAPH = { v: N_('벨로시티'), pan: N_('팬'), fine: N_('파인 피치') };

export class Rack {
  constructor(studio, el) {
    this.S = studio;
    this.el = el;
    this.graph = null; // null | 'v' | 'pan' | 'fine'
  }

  sub(ch) {
    const S = this.S;
    if (ch.kind === 'synth') return `${t('신스')} · ${ch.synthPreset ? t(ch.synthPreset) : t('사용자 설정')}`;
    if (ch.kind === 'sample' || ch.kind === 'slicer') return `${t(KIND_LABEL[ch.kind])} · ${S.proj.media[ch.sample?.media]?.name || t('파일 없음')}`;
    if (ch.kind === 'audio') return t('오디오 클립 재생');
    return S.instName(ch.inst);
  }

  render() {
    const S = this.S, proj = S.proj, pat = pattern(proj);
    const steps = pat.bars * 16;
    const rows = proj.channels.map((ch) => {
      const sel = ch.id === proj.selected;
      const loop = ch.loopSteps > 0 ? ch.loopSteps : 0;
      let grid;
      if (ch.kind === 'audio') grid = h('div', { class: 'steps audio' }, h('span', {}, t('플레이리스트의 오디오 클립이 이 채널로 재생됩니다')));
      else if (this.graph) grid = this.graphRow(ch, pat, steps);
      else {
        const cells = [];
        for (let i = 0; i < steps; i++) {
          const on = stepOn(pat, ch, i);
          cells.push(h('button', {
            class: `sq${on ? ' on' : ''}${Math.floor(i / 4) % 2 ? ' alt' : ''}${i % 16 === 0 && i ? ' bar' : ''}${loop && i >= loop ? ' past' : ''}`,
            'data-i': i, style: on ? `--c:${ch.color}` : '',
          }));
        }
        grid = h('div', { class: 'steps', style: `--n:${steps}`, oncontextmenu: (e) => e.preventDefault() }, ...cells);
        // Enter / Space on a focused step (a click without a pointer) toggles it too
        grid.addEventListener('click', (e) => {
          const b = e.detail === 0 && e.target.closest('.sq');
          if (!b) return;
          const i = +b.dataset.i, want = !stepOn(pat, ch, i);
          S.edit(() => setStep(pat, ch, i, want));
          if (want) S.preview(ch.id, ch.stepNote);
        });
        grid.addEventListener('pointerdown', (e) => {
          const b = e.target.closest('.sq');
          if (!b) return;
          e.preventDefault();
          // as in FL Studio: left-click turns a step on (or off again), right-click turns it off
          const i = +b.dataset.i, want = e.button === 2 ? false : !stepOn(pat, ch, i);
          S.edit(() => setStep(pat, ch, i, want), false);
          b.classList.toggle('on', want); b.style.cssText = want ? `--c:${ch.color}` : '';
          if (want) S.preview(ch.id, ch.stepNote);
          const move = (ev) => {
            const t = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.sq');
            if (!t || t.parentElement !== grid) return;
            const j = +t.dataset.i;
            if (stepOn(pat, ch, j) === want) return;
            setStep(pat, ch, j, want);
            t.classList.toggle('on', want); t.style.cssText = want ? `--c:${ch.color}` : '';
          };
          const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); S.changed(); };
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', up);
        });
      }
      const count = notesOf(pat, ch.id).length;
      // FL's piano roll preview: a channel whose notes are more than steps shows them instead of the steps
      if (!this.graph && ch.kind !== 'audio' && notesOf(pat, ch.id).some((n) => n.n !== ch.stepNote || n.d > STEP || n.t % STEP)) grid = this.preview(ch, pat, steps);
      const busI = proj.buses.findIndex((b) => b.id === ch.out);
      return h('div', { class: `rack-row${sel ? ' sel' : ''}`, 'data-ch': ch.id },
        h('button', { class: `led${ch.mute ? '' : ' on'}${ch.solo ? ' solo' : ''}`, title: t('음소거 (Ctrl+클릭 · 우클릭: 솔로)'),
          onclick: (e) => S.edit(() => { if (e.ctrlKey || e.altKey) { const was = ch.solo; for (const c of proj.channels) c.solo = false; ch.solo = !was; } else ch.mute = !ch.mute; }),
          oncontextmenu: (e) => { e.preventDefault(); S.edit(() => { const was = ch.solo; for (const c of proj.channels) c.solo = false; ch.solo = !was; }); } }),
        knob({ value: ch.pan, min: -1, max: 1, def: 0, bipolar: true, title: t('팬'), size: 18, target: `ch:${ch.id}:pan`, fmt: (v) => (Math.abs(v) < 0.02 ? 'C' : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`),
          onInput: (v) => { ch.pan = v; S.applyStrips(); }, onChange: () => S.changed() }),
        knob({ value: ch.vol, min: 0, max: 1, def: 0.8, title: t('볼륨'), size: 18, target: `ch:${ch.id}:vol`, fmt: (v) => `${Math.round(v * 100)}%`,
          onInput: (v) => { ch.vol = v; S.applyStrips(); }, onChange: () => S.changed() }),
        // FL's mixer track routing box: the mixer track this channel plays into ('-' is the master)
        h('button', { class: 'cbus', title: t('믹서 트랙: {name} · 클릭해서 바꾸기', { name: busI >= 0 ? proj.buses[busI].name : t('마스터') }), onclick: (e) => this.busMenu(ch, e.clientX, e.clientY) }, busI >= 0 ? String(busI + 1) : '-'),
        // FL: clicking the channel button opens (or closes) its settings; the selector on the right selects
        h('button', { class: 'cname', style: `--c:${ch.color}`, title: t('클릭: 채널 설정 열기 / 닫기 · 우클릭: 메뉴'),
          onclick: () => { S.select(ch.id, { keepTab: true }); this.toggleSheet(ch); },
          oncontextmenu: (e) => { e.preventDefault(); this.menu(ch, e.clientX, e.clientY); } },
        h('b', {}, ch.name), h('small', {}, count ? `${this.sub(ch)} · ${count}` : this.sub(ch))),
        grid,
        h('button', { class: `csel${sel ? ' on' : ''}`, title: t('채널 선택 (피아노 롤이 이 채널을 엽니다)'), onclick: () => S.select(ch.id) }));
    });
    this.el.replaceChildren(
      ...rows,
      h('div', { class: 'rack-foot' },
        // FL: the + at the bottom of the rack adds a channel
        h('button', { class: 'btn sm', 'data-tour': 'add-channel', title: t('채널 추가'), onclick: (e) => this.addMenu(e.clientX, e.clientY) }, t('+ 채널')),
        this.graph ? h('div', { class: 'seg sm' }, ...Object.entries(GRAPH).map(([k, l]) => h('button', { class: this.graph === k ? 'on' : '', title: t('스텝마다 {l} 조절', { l: t(l) }), onclick: () => { this.graph = k; this.render(); } }, t(l)))) : null,
        h('span', { class: 'hint' }, this.graph ? t('막대를 위아래로 끌어 조절') : t('칸 클릭/드래그 · 이름 클릭: 채널 설정 · 오른쪽 막대: 선택'))),
    );
  }

  // FL's piano roll preview: the channel's notes drawn small in the step area; a click opens the piano roll
  preview(ch, pat, steps) {
    const S = this.S, list = notesOf(pat, ch.id), len = steps * STEP;
    const ns = list.map((n) => n.n), lo = Math.min(...ns), hi = Math.max(...ns), span = Math.max(1, hi - lo);
    return h('button', { class: 'steps preview', title: t('피아노 롤에서 열기'), style: `--c:${ch.color}`, onclick: () => { S.select(ch.id); S.setTab('roll'); } },
      ...list.filter((n) => n.t < len).slice(0, 400).map((n) => h('i', { style: `left:${(n.t / len) * 100}%;width:${Math.max(0.4, (Math.min(n.d, len - n.t) / len) * 100)}%;top:${(1 - (n.n - lo) / span) * 78 + 6}%` })));
  }

  // FL: the channel button toggles the channel settings window
  toggleSheet(ch) {
    const cs = this.S.channelSheet;
    if (!cs.el.hidden && cs.id === ch.id) cs.close(); else cs.show(ch.id);
  }

  // the routing box's menu: the master or any mixer track, or a new one (Ctrl+L)
  busMenu(ch, x, y) {
    const S = this.S, proj = S.proj;
    popup(x, y, [
      { group: t('믹서 트랙') },
      { label: t('마스터'), check: !proj.buses.some((b) => b.id === ch.out), act: () => { S.edit(() => { ch.out = 'master'; }); S.syncAudio(); } },
      ...proj.buses.map((b, i) => ({ label: `${i + 1}. ${b.name}`, check: ch.out === b.id, act: () => { S.edit(() => { ch.out = b.id; }); S.syncAudio(); } })),
      { sep: true },
      { label: t('새 믹서 트랙에 연결'), hint: 'Ctrl+L', act: () => S.linkToMixer(ch.id) },
    ]);
  }

  // FL's Channel Options menu (the arrow at the top-left of the rack)
  optionsMenu(x, y) {
    const S = this.S, proj = S.proj, ch = proj.channels.find((c) => c.id === proj.selected) || proj.channels[0];
    const i = proj.channels.indexOf(ch);
    popup(x, y, [
      { label: t('채널 추가…'), act: () => this.addMenu(x, y) },
      { label: 'Loop Starter…', act: () => S.loopStarter(x, y) },
      { label: t('안 쓰는 채널 선택'), act: () => S.selectUnusedChannel() },
      { sep: true },
      { label: t('선택한 채널 복제'), hint: 'Alt+C', act: () => S.runAction('clonechannel') },
      { label: t('선택한 채널 삭제'), hint: 'Alt+Del', disabled: proj.channels.length <= 1, act: () => this.remove(ch) },
      { label: t('선택한 채널 위로'), hint: 'Alt+↑', disabled: i <= 0, act: () => S.edit(() => { proj.channels.splice(i, 1); proj.channels.splice(i - 1, 0, ch); }) },
      { label: t('선택한 채널 아래로'), hint: 'Alt+↓', disabled: i >= proj.channels.length - 1, act: () => S.edit(() => { proj.channels.splice(i, 1); proj.channels.splice(i + 1, 0, ch); }) },
      { label: t('이름순으로 정렬'), act: () => S.edit(() => { proj.channels.sort((a, b) => a.name.localeCompare(b.name)); }) },
      { sep: true },
      { label: t('선택한 채널 음소거'), act: () => S.edit(() => { ch.mute = true; }) },
      { label: t('모든 채널 음소거 해제'), act: () => S.edit(() => { for (const c of proj.channels) { c.mute = false; c.solo = false; } }) },
      { label: t('선택한 채널을 새 믹서 트랙에'), hint: 'Ctrl+L', act: () => S.linkToMixer(ch.id) },
      { sep: true },
      { label: 'Graph editor', hint: 'Ctrl+K', check: !!this.graph, act: () => S.runAction('graph') },
    ]);
  }

  // FL's channel rack title bar: options arrow, swing, pattern length, graph editor
  header() {
    const S = this.S, proj = S.proj, pat = pattern(proj);
    return [
      h('button', { class: 'btn sm rk-opt', title: t('채널 옵션'), onclick: (e) => this.optionsMenu(e.clientX, e.clientY + 10) }, '▾'),
      h('label', { class: 'st-field st-swing', title: t('스윙: 짝수 16분음표를 뒤로 밀어 그루브 주기') }, t('스윙'),
        knob({ value: proj.swing || 0, min: 0, max: 0.6, def: 0, size: 18, title: t('스윙'), fmt: (v) => `${Math.round((v / 0.6) * 100)}%`, onInput: (v) => { proj.swing = v; S.transport.refresh(); }, onChange: () => S.changed() })),
      h('label', { class: 'st-field', title: t('패턴 길이') }, t('길이'), h('select', { onchange: (e) => S.edit(() => { pat.bars = +e.target.value; }) },
        ...[1, 2, 4, 8, 16].map((b) => h('option', { value: b, selected: pat.bars === b }, t('{n}마디', { n: b }))))),
      h('button', { class: `btn sm${this.graph ? ' on' : ''}`, title: t('Graph editor: 스텝마다 벨로시티·팬·파인 피치 (Ctrl+K)'), onclick: () => S.runAction('graph') }, 'Graph'),
    ];
  }

  // bars for each step's notes; drag to set velocity / pan / fine pitch
  graphRow(ch, pat, steps) {
    const S = this.S, key = this.graph;
    const notesAt = (i) => notesOf(pat, ch.id).filter((n) => n.t === i * STEP);
    const cells = [];
    for (let i = 0; i < steps; i++) {
      const ns = notesAt(i);
      const val = ns.length ? (key === 'v' ? ns[0].v / 127 : key === 'pan' ? ((ns[0].pan || 0) + 1) / 2 : ((ns[0].fine || 0) / 100 + 1) / 2) : null;
      cells.push(h('div', { class: `gb${ns.length ? '' : ' empty'}${i % 16 === 0 && i ? ' bar' : ''}`, 'data-i': i, style: `--v:${val ?? 0};--c:${ch.color}` }, key !== 'v' && val != null ? h('i', { class: 'mid' }) : null));
    }
    const grid = h('div', { class: 'steps graph', style: `--n:${steps}` }, ...cells);
    const setAt = (ev) => {
      const t = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.gb');
      if (!t || t.parentElement !== grid) return;
      const r = t.getBoundingClientRect(), f = Math.max(0, Math.min(1, 1 - (ev.clientY - r.top) / r.height));
      for (const n of notesAt(+t.dataset.i)) {
        if (key === 'v') n.v = Math.max(1, Math.round(f * 127));
        else if (key === 'pan') n.pan = Math.abs(f - 0.5) < 0.03 ? 0 : Math.round((f * 2 - 1) * 100) / 100;
        else n.fine = Math.abs(f - 0.5) < 0.03 ? 0 : Math.round((f * 2 - 1) * 100);
      }
      t.style.setProperty('--v', String(f));
    };
    grid.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      S.history.push();
      setAt(e);
      const up = () => { window.removeEventListener('pointermove', setAt); window.removeEventListener('pointerup', up); S.changed(); };
      window.addEventListener('pointermove', setAt);
      window.addEventListener('pointerup', up);
    });
    return grid;
  }

  addMenu(x, y) {
    const S = this.S;
    popup(x, y, [
      { label: t('악기…'), hint: t('피아노, 드럼, 스트링…'), act: () => S.pickInstrument(x, y, (id) => this.add(id)) },
      { label: t('신디사이저'), hint: t('직접 소리를 만드는 신스'), act: () => this.addKind('synth') },
      { label: t('샘플 (오디오 파일)…'), hint: t('원샷, 보컬 찹'), act: () => S.addSampleChannel('sample') },
      { label: t('슬라이서 (루프 자르기)…'), hint: t('드럼 루프를 잘라 건반에'), act: () => S.addSampleChannel('slicer') },
      { label: t('오디오 트랙'), hint: t('오디오 클립 재생용'), act: () => this.addKind('audio') },
      { label: t('보컬 (가사로 노래)'), hint: t('멜로디와 가사로 노래 만들기'), act: () => this.addVocal() },
      { label: t('VST 악기…'), hint: t('설치된 VST3 플러그인'), act: () => S.vstMenu(x, y, (p) => this.addVst(p)) },
    ]);
  }

  add(inst) {
    const S = this.S;
    // a MeloFi Synth preset picked in the instrument browser ("synth:<preset>")
    if (String(inst).startsWith('synth:')) {
      const name = inst.slice(6);
      S.edit(() => { const ch = this.makeKind('synth', name, { synth: { ...synthDefaults(), ...(presetParams(name) || {}) }, synthPreset: name }); S.proj.selected = ch.id; });
      S.syncAudio();
      return;
    }
    S.edit(() => {
      const kit = S.isKit(inst);
      const names = kitNames(S.instInfo(inst));
      const ch = newChannel(inst, S.instName(inst), S.proj.channels.length, { stepNote: kit ? (names[36] ? 36 : Number(Object.keys(names)[0])) : 60 });
      S.proj.channels.push(ch);
      S.proj.selected = ch.id;
    });
    S.syncAudio();
  }

  // a new channel of a kind, added to the project (no undo step, no audio sync: callers do that)
  makeKind(kind, name = null, extra = {}) {
    const S = this.S, i = S.proj.channels.length;
    const made = newChannel(kind === 'synth' ? 'synth' : 'splendid', name || (kind === 'synth' ? t('신스') : kind === 'audio' ? t('오디오 {n}', { n: i + 1 }) : t('샘플')), i,
      { kind, ...(kind === 'synth' ? { synth: synthDefaults(), synthPreset: '기본 쏘' } : {}), ...extra }); // i18n-ignore: synth preset names (keys of SYNTH_PRESETS)
    S.proj.channels.push(made);
    return made;
  }

  // a vocal channel: a soft lead to hear the melody while writing; the singing comes from the
  // channel sheet's 보컬 tab, which renders it to an audio track
  addVocal() {
    const S = this.S;
    let made;
    S.edit(() => {
      made = this.makeKind('synth', t('보컬'), { synth: { ...synthDefaults(), ...SYNTH_PRESETS['레트로 리드'] }, synthPreset: '레트로 리드', vocal: { lyrics: '' } }); // i18n-ignore: synth preset names
      S.proj.selected = made.id;
    });
    S.syncAudio();
    S.channelSheet.show(made.id, 'vocal');
    return made;
  }

  addVst(p) {
    const S = this.S;
    let made;
    S.edit(() => { made = this.makeKind('vst', p.name, { vst: { plugin: p.id, file: p.file, name: p.name, vendor: p.vendor } }); S.proj.selected = made.id; });
    S.syncAudio();
    S.status(t('{name}을(를) 불러왔습니다. 채널 설정에서 플러그인 창을 열 수 있습니다.', { name: p.name }));
    return made;
  }

  addKind(kind, extra = {}) {
    const S = this.S;
    let made;
    S.edit(() => { made = this.makeKind(kind, null, extra); if (kind !== 'audio') S.proj.selected = made.id; });
    S.syncAudio();
    return made;
  }

  menu(ch, x, y) {
    const S = this.S, proj = S.proj;
    const kit = S.isKit(ch.inst) && (ch.kind || 'inst') === 'inst';
    popup(x, y, [
      ...S.stemConvert.menuItems(ch), // a separated track: MIDI로 변환… / 보컬로 변환…
      // FL's channel button menu starts: Piano roll, Graph editor, Rename…
      { label: t('피아노 롤'), hint: 'F7', disabled: ch.kind === 'audio', act: () => { S.select(ch.id); S.setTab('roll'); } },
      { label: 'Graph editor', hint: 'Ctrl+K', disabled: ch.kind === 'audio', act: () => { S.select(ch.id, { keepTab: true }); this.graph = 'v'; this.render(); } },
      { label: t('채널 설정…'), act: () => S.channelSheet.show(ch.id) },
      ...(ch.kind === 'audio' ? [{ label: t('Newtone으로 음정 편집…'), hint: t('이 채널의 첫 오디오 클립'), disabled: !proj.playlist.clips.some((c) => c.ch === ch.id && c.kind === 'audio'), act: () => S.newtone.open(proj.playlist.clips.filter((c) => c.ch === ch.id && c.kind === 'audio').sort((a, b) => a.start - b.start)[0]) }] : []),
      ...(['inst', 'synth'].includes(ch.kind || 'inst') ? [{ label: t('악기 바꾸기…'), act: () => S.pickInstrument(x, y, (id) => {
        S.edit(() => {
          if (String(id).startsWith('synth:')) { const n = id.slice(6); ch.kind = 'synth'; ch.inst = 'synth'; ch.synth = { ...synthDefaults(), ...(presetParams(n) || {}) }; ch.synthPreset = n; } else { ch.kind = 'inst'; ch.inst = id; }
        });
        S.syncAudio();
      }, ch.kind === 'synth' ? `synth:${ch.synthPreset}` : ch.inst) }] : []),
      { label: t('이름 바꾸기…'), act: () => S.rename(ch) },
      ...(kit ? [{ group: t('타격할 드럼 악기') }, ...Object.entries(kitNames(S.instInfo(ch.inst))).map(([n, name]) => ({ label: name, hint: n, check: ch.stepNote === +n, act: () => S.edit(() => { ch.stepNote = +n; }) }))]
        : ch.kind === 'audio' ? [] : [{ label: t('스텝 음높이: {n}', { n: ch.stepNote }), act: async () => { const v = await ask(t('스텝 음높이 (MIDI 번호, 60 = 중앙 도)'), String(ch.stepNote), { type: 'number' }); if (v && +v >= 0 && +v <= 127) S.edit(() => { ch.stepNote = +v; }); } }]),
      { sep: true },
      { label: t('복제'), hint: t('노트 포함'), act: () => S.edit(() => { const nc = { ...JSON.parse(JSON.stringify(ch)), id: `c${Date.now().toString(36)}`, name: `${ch.name} 2` }; proj.channels.splice(proj.channels.indexOf(ch) + 1, 0, nc); for (const p of proj.patterns) if (p.notes[ch.id]) p.notes[nc.id] = p.notes[ch.id].map((n) => ({ ...n })); }) },
      { group: t('스텝 채우기') },
      ...[[2, t('2칸마다')], [4, t('4칸마다 (박마다)')], [8, t('8칸마다')]].map(([k, l]) => ({ label: l, act: () => S.edit(() => {
        const pat = pattern(proj), steps = pat.bars * 16, list = notesOf(pat, ch.id);
        for (let i = 0; i < steps; i += k) if (!list.some((n) => n.t === i * STEP && n.n === ch.stepNote)) list.push({ t: i * STEP, d: STEP, n: ch.stepNote, v: 100 });
      }, true, t('스텝 채우기 ({l})', { l })) })),
      { label: t('무작위 리듬'), hint: t('영감이 필요할 때'), act: () => S.edit(() => {
        const pat = pattern(proj), steps = pat.bars * 16;
        pat.notes[ch.id] = (pat.notes[ch.id] || []).filter((n) => n.n !== ch.stepNote);
        for (let i = 0; i < steps; i++) if (Math.random() < (i % 4 === 0 ? 0.55 : 0.22)) pat.notes[ch.id].push({ t: i * STEP, d: STEP, n: ch.stepNote, v: 70 + Math.round(Math.random() * 50) });
      }, true, t('무작위 리듬')) },
      { label: t('왼쪽으로 돌리기'), hint: 'Shift+Ctrl+←', act: () => this.rotate(ch, -1) },
      { label: t('오른쪽으로 돌리기'), hint: 'Shift+Ctrl+→', act: () => this.rotate(ch, 1) },
      { label: t('스텝 복사'), hint: 'Ctrl+C', act: () => this.copySteps(ch) },
      { label: t('스텝 붙여넣기'), hint: 'Ctrl+V', disabled: !this.stepClip, act: () => this.pasteSteps(ch) },
      { sep: true },
      { label: t('Consolidate (오디오로)'), hint: t('채널을 오디오 클립으로 · CPU 절약'), disabled: ch.kind === 'audio', act: () => S.freeze(ch) },
      { label: t('이 패턴의 노트 지우기'), act: () => S.edit(() => { pattern(proj).notes[ch.id] = []; }) },
      { label: t('채널 삭제'), hint: 'Alt+Del', disabled: proj.channels.length <= 1, act: () => this.remove(ch) },
    ]);
  }
}

// rack actions shared by the menu and the keys
Rack.prototype.remove = function (ch) {
  const S = this.S, proj = S.proj;
  if (proj.channels.length <= 1) return;
  S.edit(() => { proj.channels.splice(proj.channels.indexOf(ch), 1); for (const p of proj.patterns) delete p.notes[ch.id]; proj.playlist.clips = proj.playlist.clips.filter((c) => c.ch !== ch.id); if (proj.selected === ch.id) proj.selected = proj.channels[0].id; }, true, t('채널 삭제'));
  S.syncAudio();
};
Rack.prototype.rotate = function (ch, dir) {
  const S = this.S, pat = pattern(S.proj), len = pat.bars * 16 * STEP;
  S.edit(() => { for (const n of notesOf(pat, ch.id)) n.t = (n.t + dir * STEP + len) % len; }, true, dir > 0 ? t('오른쪽으로 돌리기') : t('왼쪽으로 돌리기'));
};
Rack.prototype.copySteps = function (ch) { this.stepClip = notesOf(pattern(this.S.proj), ch.id).map((n) => ({ ...n })); this.S.status(t('스텝 {n}개를 복사했어요.', { n: this.stepClip.length })); };
Rack.prototype.pasteSteps = function (ch) { const c = this.stepClip; if (!c) return; this.S.edit(() => { pattern(this.S.proj).notes[ch.id] = c.map((n) => ({ ...n })); }, true, t('스텝 붙여넣기')); };

function setStep(pat, ch, i, on) {
  const list = notesOf(pat, ch.id);
  const k = list.findIndex((n) => n.t === i * STEP && n.n === ch.stepNote);
  if (on && k < 0) list.push({ t: i * STEP, d: STEP, n: ch.stepNote, v: 100 });
  if (!on && k >= 0) list.splice(k, 1);
}
