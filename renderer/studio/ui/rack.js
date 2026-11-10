// Channel rack: one row per channel — mute, pan / volume knobs, name, step sequencer.
// Graph mode shows each step's velocity, pan or fine pitch as a bar you can drag.
import { h, knob, popup, ask } from './dom.js';
import { STEP, pattern, stepOn, notesOf, newChannel } from '../model.js';
import { kitNames } from '../../js/drums.js';
import { synthDefaults, SYNTH_PRESETS } from '../synth.js';

const KIND_LABEL = { synth: '신스', sample: '샘플', slicer: '슬라이서', audio: '오디오', vst: 'VST' };
const GRAPH = { v: '세기', pan: '팬', fine: '피치' };

export class Rack {
  constructor(studio, el) {
    this.S = studio;
    this.el = el;
    this.graph = null; // null | 'v' | 'pan' | 'fine'
  }

  sub(ch) {
    const S = this.S;
    if (ch.kind === 'synth') return `신스 · ${ch.synthPreset || '사용자 설정'}`;
    if (ch.kind === 'sample' || ch.kind === 'slicer') return `${KIND_LABEL[ch.kind]} · ${S.proj.media[ch.sample?.media]?.name || '파일 없음'}`;
    if (ch.kind === 'audio') return '오디오 클립 재생';
    return S.instName(ch.inst);
  }

  render() {
    const S = this.S, proj = S.proj, pat = pattern(proj);
    const steps = pat.bars * 16;
    const rows = proj.channels.map((ch) => {
      const sel = ch.id === proj.selected;
      const loop = ch.loopSteps > 0 ? ch.loopSteps : 0;
      let grid;
      if (ch.kind === 'audio') grid = h('div', { class: 'steps audio' }, h('span', {}, '플레이리스트의 오디오 클립이 이 채널로 재생됩니다'));
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
        grid = h('div', { class: 'steps', style: `--n:${steps}` }, ...cells);
        grid.addEventListener('pointerdown', (e) => {
          const b = e.target.closest('.sq');
          if (!b) return;
          e.preventDefault();
          const i = +b.dataset.i, want = !stepOn(pat, ch, i);
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
      return h('div', { class: `rack-row${sel ? ' sel' : ''}`, 'data-ch': ch.id },
        h('button', { class: `led${ch.mute ? '' : ' on'}${ch.solo ? ' solo' : ''}`, title: '음소거 (우클릭: 솔로)',
          onclick: () => S.edit(() => { ch.mute = !ch.mute; }),
          oncontextmenu: (e) => { e.preventDefault(); S.edit(() => { const was = ch.solo; for (const c of proj.channels) c.solo = false; ch.solo = !was; }); } }),
        knob({ value: ch.pan, min: -1, max: 1, def: 0, bipolar: true, title: '팬', size: 18, target: `ch:${ch.id}:pan`, fmt: (v) => (Math.abs(v) < 0.02 ? 'C' : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`),
          onInput: (v) => { ch.pan = v; S.applyStrips(); }, onChange: () => S.changed() }),
        knob({ value: ch.vol, min: 0, max: 1, def: 0.8, title: '볼륨', size: 18, target: `ch:${ch.id}:vol`, fmt: (v) => `${Math.round(v * 100)}%`,
          onInput: (v) => { ch.vol = v; S.applyStrips(); }, onChange: () => S.changed() }),
        h('button', { class: 'cname', style: `--c:${ch.color}`, title: '클릭: 선택 · 더블클릭: 채널 설정 · 우클릭: 메뉴',
          onclick: () => S.select(ch.id),
          ondblclick: () => S.channelSheet.show(ch.id),
          oncontextmenu: (e) => { e.preventDefault(); this.menu(ch, e.clientX, e.clientY); } },
        h('b', {}, ch.name), h('small', {}, count ? `${this.sub(ch)} · ${count}` : this.sub(ch))),
        grid);
    });
    this.el.replaceChildren(
      ...rows,
      h('div', { class: 'rack-foot' },
        h('button', { class: 'btn sm', 'data-tour': 'add-channel', onclick: (e) => this.addMenu(e.clientX, e.clientY) }, '+ 채널'),
        h('div', { class: 'seg sm' }, h('button', { class: this.graph ? '' : 'on', onclick: () => { this.graph = null; this.render(); } }, '스텝'),
          ...Object.entries(GRAPH).map(([k, l]) => h('button', { class: this.graph === k ? 'on' : '', title: `스텝마다 ${l} 조절`, onclick: () => { this.graph = k; this.render(); } }, l))),
        h('span', { class: 'hint' }, this.graph ? '막대를 위아래로 끌어 조절' : '칸 클릭/드래그 · 이름 더블클릭: 설정')),
    );
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
      { label: '악기…', hint: '피아노, 드럼, 스트링…', act: () => S.pickInstrument(x, y, (id) => this.add(id)) },
      { label: '신디사이저', hint: '직접 소리를 만드는 신스', act: () => this.addKind('synth') },
      { label: '샘플 (오디오 파일)…', hint: '원샷, 보컬 찹', act: () => S.addSampleChannel('sample') },
      { label: '슬라이서 (루프 자르기)…', hint: '드럼 루프를 잘라 건반에', act: () => S.addSampleChannel('slicer') },
      { label: '오디오 트랙', hint: '오디오 클립 재생용', act: () => this.addKind('audio') },
      { label: '보컬 (가사로 노래)', hint: '멜로디와 가사로 노래 만들기', act: () => this.addVocal() },
      { label: 'VST 악기…', hint: '설치된 VST3 플러그인', act: () => S.vstMenu(x, y, (p) => this.addVst(p)) },
    ]);
  }

  add(inst) {
    const S = this.S;
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
    const made = newChannel(kind === 'synth' ? 'synth' : 'splendid', name || (kind === 'synth' ? '신스' : kind === 'audio' ? `오디오 ${i + 1}` : '샘플'), i,
      { kind, ...(kind === 'synth' ? { synth: synthDefaults(), synthPreset: '기본 쏘' } : {}), ...extra });
    S.proj.channels.push(made);
    return made;
  }

  // a vocal channel: a soft lead to hear the melody while writing; the singing comes from the
  // channel sheet's 보컬 tab, which renders it to an audio track
  addVocal() {
    const S = this.S;
    let made;
    S.edit(() => {
      made = this.makeKind('synth', '보컬', { synth: { ...synthDefaults(), ...SYNTH_PRESETS['레트로 리드'] }, synthPreset: '레트로 리드', vocal: { lyrics: '', voice: 'r9y9/yoko_latest' } });
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
    S.status(`${p.name}을(를) 불러왔습니다. 채널 설정에서 플러그인 창을 열 수 있습니다.`);
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
      { label: '채널 설정…', act: () => S.channelSheet.show(ch.id) },
      ...((ch.kind || 'inst') === 'inst' ? [{ label: '악기 바꾸기…', act: () => S.pickInstrument(x, y, (id) => { S.edit(() => { ch.inst = id; }); S.syncAudio(); }, ch.inst) }] : []),
      { label: '이름 바꾸기…', act: () => S.rename(ch) },
      ...(kit ? [{ group: '타격할 드럼 악기' }, ...Object.entries(kitNames(S.instInfo(ch.inst))).map(([n, name]) => ({ label: name, hint: n, check: ch.stepNote === +n, act: () => S.edit(() => { ch.stepNote = +n; }) }))]
        : ch.kind === 'audio' ? [] : [{ label: `스텝 음높이: ${ch.stepNote}`, act: async () => { const v = await ask('스텝 음높이 (MIDI 번호, 60 = 중앙 도)', String(ch.stepNote), { type: 'number' }); if (v && +v >= 0 && +v <= 127) S.edit(() => { ch.stepNote = +v; }); } }]),
      { sep: true },
      { label: '복제', act: () => S.edit(() => { const nc = { ...JSON.parse(JSON.stringify(ch)), id: `c${Date.now().toString(36)}`, name: `${ch.name} 2` }; proj.channels.splice(proj.channels.indexOf(ch) + 1, 0, nc); for (const p of proj.patterns) if (p.notes[ch.id]) p.notes[nc.id] = p.notes[ch.id].map((n) => ({ ...n })); }) },
      { group: '스텝 채우기' },
      ...[[2, '2칸마다'], [4, '4칸마다 (박마다)'], [8, '8칸마다']].map(([k, l]) => ({ label: l, act: () => S.edit(() => {
        const pat = pattern(proj), steps = pat.bars * 16, list = notesOf(pat, ch.id);
        for (let i = 0; i < steps; i += k) if (!list.some((n) => n.t === i * STEP && n.n === ch.stepNote)) list.push({ t: i * STEP, d: STEP, n: ch.stepNote, v: 100 });
      }, true, `스텝 채우기 (${l})`) })),
      { label: '무작위 리듬', hint: '영감이 필요할 때', act: () => S.edit(() => {
        const pat = pattern(proj), steps = pat.bars * 16;
        pat.notes[ch.id] = (pat.notes[ch.id] || []).filter((n) => n.n !== ch.stepNote);
        for (let i = 0; i < steps; i++) if (Math.random() < (i % 4 === 0 ? 0.55 : 0.22)) pat.notes[ch.id].push({ t: i * STEP, d: STEP, n: ch.stepNote, v: 70 + Math.round(Math.random() * 50) });
      }, true, '무작위 리듬') },
      { label: '한 칸씩 밀기 →', act: () => S.edit(() => { const pat = pattern(proj), len = pat.bars * 16 * STEP; for (const n of notesOf(pat, ch.id)) n.t = (n.t + STEP) % len; }) },
      { label: '← 한 칸씩 당기기', act: () => S.edit(() => { const pat = pattern(proj), len = pat.bars * 16 * STEP; for (const n of notesOf(pat, ch.id)) n.t = (n.t - STEP + len) % len; }) },
      { sep: true },
      { label: '오디오로 굳히기', hint: 'CPU 절약', disabled: ch.kind === 'audio', act: () => S.freeze(ch) },
      { label: '이 패턴의 노트 지우기', act: () => S.edit(() => { pattern(proj).notes[ch.id] = []; }) },
      { label: '채널 삭제', disabled: proj.channels.length <= 1, act: () => S.edit(() => { proj.channels.splice(proj.channels.indexOf(ch), 1); for (const p of proj.patterns) delete p.notes[ch.id]; proj.playlist.clips = proj.playlist.clips.filter((c) => c.ch !== ch.id); if (proj.selected === ch.id) proj.selected = proj.channels[0].id; }) },
    ]);
  }
}

function setStep(pat, ch, i, on) {
  const list = notesOf(pat, ch.id);
  const k = list.findIndex((n) => n.t === i * STEP && n.n === ch.stepNote);
  if (on && k < 0) list.push({ t: i * STEP, d: STEP, n: ch.stepNote, v: 100 });
  if (!on && k >= 0) list.splice(k, 1);
}
