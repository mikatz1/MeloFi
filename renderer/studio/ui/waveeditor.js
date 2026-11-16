// MeloFi Synth — expert mode: the waveform / wavetable editor for one oscillator. A floating window like
// the channel sheet. Layout after the editors people know (Serum's WT editor, Vital's oscillator page,
// Harmor / Sytrus harmonics, Polymer): a large single-cycle view, the harmonic bars under it (both edit the
// same frame), the tool panel on the right and the frame strip with the table view along the bottom.
// Every change is heard at once: the synth fades the new table in under notes that are already sounding.
import { h, popup, ask } from './dom.js';
import { t, tdyn, N_ } from '../../i18n/i18n.js';
import * as W from '../wavetable.js';
import { CUSTOM_WAVE, primeTable } from '../synth.js';
import { userWaves, saveUserWave, deleteUserWave, loadSynthUser } from '../synth-user.js';
import { decode } from '../media.js';
import { NOTE_NAMES } from './dom.js';

const MODES = [['draw', N_('그리기')], ['harm', N_('배음')], ['formula', N_('수식')], ['audio', N_('오디오에서')]];
const EXAMPLES = ['sin(x) + 0.5*sin(3*x)', 'saw(x)*(1 - f) + square(x)*f', 'tanh((1 + 8*f)*sin(x))', 'sin(x + 3*f*sin(2*x))', 'sign(sin(x))*abs(sin(x))^(0.2 + f)', 'tri(x) + 0.3*sin(9*x)*f'];
const HARM_BTNS = [['saw', N_('톱니파')], ['square', N_('사각파')], ['triangle', N_('삼각파')], ['organ', N_('오르간')], ['bell', N_('벨')], ['sine', N_('사인파')]];
const BUILTIN_SEED = { 0: 'saw', 1: 'square', 2: 'triangle', 3: 'sine' };
const css = (el, name) => getComputedStyle(el).getPropertyValue(name).trim();

export class WaveEditor {
  constructor(studio) {
    this.S = studio;
    this.mode = 'draw';
    this.tool = 'free';
    this.curve = 'smooth';
    this.grid = { x: 16, y: 8, snap: false };
    this.formula = EXAMPLES[0];
    this.formulaFrames = 1;
    this.audio = { src: '', frames: 1, from: 0, to: 100, info: '' };
    this.hn = 64;           // harmonics shown as bars (64 / 128 / 256)
    this.dbView = false;    // bar heights in dB (Harmor, Vital's power scale) instead of linear
    this.allFrames = false; // processing reaches every frame (Serum's Process menu) instead of this one
    this.clip = null;       // a copied frame
    this.redo = [];
    this.history = [];
    this.pts = new Map();   // frame -> points (points mode)
    this.selPt = -1;
    this.hover = null;
    let head;
    this.el = h('section', { id: 'wavewin', class: 'ch-float', hidden: true, tabindex: '-1' },
      h('div', { class: 'sheet-card wv-card' },
        head = h('div', { class: 'sheet-head ch-drag', title: t('끌어서 옮기기') }, this.titleEl = h('h2', {}), h('button', { class: 'x', 'aria-label': t('닫기'), onclick: () => this.close() })),
        this.modesEl = h('div', { class: 'cl-tabs wv-modes' }),
        h('div', { class: 'wv-main' },
          h('div', { class: 'wv-views' },
            h('div', { class: 'wv-lbl' }, h('span', {}, t('한 주기')), this.frameLbl = h('em', {})),
            this.wcv = h('canvas', { class: 'wv-wave' }),
            h('div', { class: 'wv-lbl' }, this.harmCap = h('span', {}), this.harmLbl = h('em', {})),
            this.hcv = h('canvas', { class: 'wv-harm' })),
          this.side = h('div', { class: 'wv-side' })),
        h('div', { class: 'wv-table' },
          h('div', { class: 'wv-strip-bar' },
            h('span', { class: 'wv-cap' }, t('프레임')),
            this.countEl = h('em', { class: 'wv-count' }),
            h('button', { class: 'btn sm', onclick: () => this.dupFrame() }, t('복제')),
            h('button', { class: 'btn sm', onclick: () => this.delFrame() }, t('삭제')),
            h('button', { class: 'btn sm', title: t('현재 프레임과 다음 프레임 사이를 스펙트럼 모프로 채워요.'), onclick: () => this.fillBetween() }, t('사이 채우기')),
            h('span', { class: 'sp' }),
            h('label', { class: 'wv-inline' }, h('span', {}, t('프레임 사이')), this.interpSel = h('select', { onchange: (e) => { this.snapshot(); this.wt.interp = e.target.value; this.commit(); } },
              h('option', { value: 'xfade' }, t('크로스페이드')), h('option', { value: 'spectral' }, t('스펙트럼 모프')))),
            h('label', { class: 'wv-inline' }, h('span', {}, t('테이블 위치')), this.posIn = h('input', { type: 'range', min: 0, max: 1, step: 0.001, oninput: (e) => this.setPos(+e.target.value) }), this.posOut = h('em', { class: 'wv-num' }))),
          h('div', { class: 'wv-strip-row' },
            this.strip = h('div', { class: 'wv-strip' }),
            this.tcv = h('canvas', { class: 'wv-3d', title: t('테이블 보기: 위치 막대를 끌어 보세요') }))),
        this.foot = h('div', { class: 'wv-foot' },
          h('button', { class: 'btn sm', onclick: () => this.importWav() }, t('WAV 불러오기…')),
          h('button', { class: 'btn sm', onclick: () => this.exportWav() }, t('WAV 내보내기…')),
          h('button', { class: 'btn sm', onclick: (e) => this.libraryMenu(e) }, t('내 파형 ▾')),
          this.msg = h('span', { class: 'wv-msg' }),
          h('span', { class: 'sp' }),
          h('button', { class: 'btn sm', onclick: () => this.play() }, t('들어보기')),
          h('button', { class: 'btn sm primary', onclick: () => this.close() }, t('완료')))));
    head.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      try { head.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
      const r = this.el.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
      const move = (ev) => { this.el.style.left = `${Math.max(0, Math.min(innerWidth - 120, ev.clientX - dx))}px`; this.el.style.top = `${Math.max(0, Math.min(innerHeight - 40, ev.clientY - dy))}px`; };
      const up = () => { head.removeEventListener('pointermove', move); head.removeEventListener('pointerup', up); };
      head.addEventListener('pointermove', move); head.addEventListener('pointerup', up);
    });
    this.el.addEventListener('keydown', (e) => {
      if (e.target.matches('input, textarea, select')) { if (e.key === 'Escape') { e.stopPropagation(); e.target.blur(); } return; }
      if (e.key === 'Escape') { e.stopPropagation(); this.close(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.stopPropagation(); if (e.shiftKey) this.redoStep(); else this.undoStep(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); e.stopPropagation(); this.redoStep(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') { e.stopPropagation(); this.copyFrame(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') { e.stopPropagation(); this.pasteFrame(); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.stopPropagation(); this.select(this.cur + (e.key === 'ArrowLeft' ? -1 : 1)); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && this.tool === 'points' && this.selPt >= 0) { e.stopPropagation(); this.removePoint(this.selPt); }
    });
    this.bindWave();
    this.bindHarm();
    this.bindTable();
    new ResizeObserver(() => { if (!this.el.hidden) this.draw(); }).observe(this.wcv);
    document.body.append(this.el);
  }

  get ch() { return this.S.proj.channels.find((c) => c.id === this.chId) || null; }
  get frame() { return this.wt.frames[this.cur]; }
  get posKey() { return this.k ? 'wp2' : 'wp1'; }

  // ---------- open / close ----------
  open(chId, k = 0) {
    this.chId = chId; this.k = k;
    const ch = this.ch;
    if (!ch) return;
    const p = ch.synth || {};
    const stored = p[`wt${k + 1}`];
    const wt = stored ? W.decodeTable(stored) : null;
    if (wt) this.wt = { name: wt.name, interp: wt.interp, frames: wt.frames.map((f) => Float32Array.from(f)) };
    else this.wt = { name: '', interp: 'xfade', frames: [W.presetFrame(BUILTIN_SEED[Math.round(p[`w${k + 1}`] ?? 0)] || 'saw')] };
    this.cur = Math.min(this.wt.frames.length - 1, Math.round((p[this.posKey] || 0) * (this.wt.frames.length - 1)));
    this.pts = new Map(); this.selPt = -1;
    this.history = []; this.redo = [];
    this.el.hidden = false;
    if (!this.el.style.left) { this.el.style.left = `${Math.max(10, innerWidth / 2 - 490)}px`; this.el.style.top = `${Math.max(10, innerHeight / 2 - 360)}px`; }
    // the oscillator plays the user waveform from now on
    if (!stored || Math.round(p[`w${k + 1}`]) !== CUSTOM_WAVE) { this.S.history?.push?.(t('사용자 파형')); this.commit(); }
    this.render();
    this.el.focus({ preventScroll: true });
    loadSynthUser();
  }

  close() { this.el.hidden = true; const cs = this.S._chs; if (cs && !cs.el.hidden) cs.render(); }

  // ---------- state ----------
  // before every change: the editor's own undo (Ctrl+Z here) and the studio's
  snapshot(label = null) {
    this.S.history?.push?.(label || t('파형 편집'));
    this.history.push(this.state());
    if (this.history.length > 60) this.history.shift();
    this.redo = [];
  }
  state() { return { frames: this.wt.frames.map((f) => Float32Array.from(f)), cur: this.cur, interp: this.wt.interp }; }
  restore(st) {
    this.wt.frames = st.frames; this.cur = Math.min(st.cur, st.frames.length - 1); this.wt.interp = st.interp;
    this.pts.clear(); this.selPt = -1;
    this.commit();
    this.render();
  }
  undoStep() { const st = this.history.pop(); if (!st) return; this.redo.push(this.state()); this.restore(st); }
  redoStep() { const st = this.redo.pop(); if (!st) return; this.history.push(this.state()); this.restore(st); }

  // writes the table to the channel; live = while dragging (no undo entry, no re-render of the studio)
  commit(final = true) {
    const ch = this.ch;
    if (!ch) return;
    const stored = W.encodeTable(this.wt);
    primeTable(stored, this.wt);
    const key = `wt${this.k + 1}`, wkey = `w${this.k + 1}`;
    ch.synth = { ...ch.synth, [key]: stored, [wkey]: CUSTOM_WAVE };
    ch.synthPreset = null;
    this.S.engine?.channels.get(ch.id)?.src?.setParams?.(ch.synth);
    if (final) this.S.dirty = true;
  }
  liveCommit() {
    // a change while dragging: at most every 40 ms (the synth fades the new table in)
    if (this.liveT) return;
    this.liveT = setTimeout(() => { this.liveT = null; this.commit(false); }, 40);
  }
  endDrag() {
    clearTimeout(this.liveT); this.liveT = null;
    this.dragging = false;
    this.commit(true);
    this.drawStrip(true);
    this.drawTable();
  }

  setPos(v) {
    const ch = this.ch;
    if (!ch) return;
    ch.synth = { ...ch.synth, [this.posKey]: v };
    this.S.engine?.channels.get(ch.id)?.src?.setParams?.(ch.synth);
    this.S.dirty = true;
    this.posOut.textContent = `${Math.round(v * 100)}%`;
    const n = this.wt.frames.length;
    if (n > 1) { const i = Math.round(v * (n - 1)); if (i !== this.cur) { this.cur = i; this.selPt = -1; this.render(false); } }
    this.drawTable();
  }

  select(i) {
    const n = this.wt.frames.length;
    this.cur = Math.max(0, Math.min(n - 1, i));
    this.selPt = -1;
    this.render(false);
  }

  // ---------- frames ----------
  dupFrame() {
    if (this.wt.frames.length >= W.MAX_FRAMES) return this.say(t('프레임은 최대 {n}개까지 가능해요.', { n: W.MAX_FRAMES }));
    this.snapshot();
    this.wt.frames.splice(this.cur + 1, 0, Float32Array.from(this.frame));
    this.cur++;
    this.commit(); this.render();
  }
  delFrame() {
    if (this.wt.frames.length <= 1) return this.say(t('마지막 프레임은 지울 수 없어요.'));
    this.snapshot();
    this.wt.frames.splice(this.cur, 1);
    this.cur = Math.min(this.cur, this.wt.frames.length - 1);
    this.pts.clear();
    this.commit(); this.render();
  }
  copyFrame() { this.clip = Float32Array.from(this.frame); this.say(t('프레임을 복사했어요.')); }
  pasteFrame(replace = false) {
    if (!this.clip) return;
    if (!replace && this.wt.frames.length >= W.MAX_FRAMES) return this.say(t('프레임은 최대 {n}개까지 가능해요.', { n: W.MAX_FRAMES }));
    this.snapshot();
    if (replace) this.frame.set(this.clip); else { this.wt.frames.splice(this.cur + 1, 0, Float32Array.from(this.clip)); this.cur++; }
    this.pts.delete(this.cur);
    this.commit(); this.render();
  }
  moveFrame(d) {
    const fr = this.wt.frames, j = this.cur + d;
    if (j < 0 || j >= fr.length) return;
    this.snapshot();
    [fr[this.cur], fr[j]] = [fr[j], fr[this.cur]];
    this.cur = j; this.pts.clear();
    this.commit(); this.render();
  }
  frameMenu(e, i) {
    e.preventDefault();
    this.select(i);
    const n = this.wt.frames.length;
    popup(e.clientX, e.clientY, [
      { label: t('복사'), hint: 'Ctrl+C', act: () => this.copyFrame() },
      { label: t('뒤에 붙여넣기'), hint: 'Ctrl+V', disabled: !this.clip, act: () => this.pasteFrame() },
      { label: t('이 프레임에 덮어쓰기'), disabled: !this.clip, act: () => this.pasteFrame(true) },
      { sep: true },
      { label: t('앞으로 옮기기'), disabled: i === 0, act: () => this.moveFrame(-1) },
      { label: t('뒤로 옮기기'), disabled: i >= n - 1, act: () => this.moveFrame(1) },
      { label: t('복제'), act: () => this.dupFrame() },
      { label: t('삭제'), disabled: n <= 1, act: () => this.delFrame() },
    ]);
  }
  async fillBetween() {
    const fr = this.wt.frames;
    if (this.cur >= fr.length - 1) return this.say(t('다음 프레임이 필요해요. 먼저 프레임을 복제한 뒤 변경해 보세요.'));
    const v = await ask(t('사이에 넣을 프레임 수'), '6', { type: 'number' });
    const n = Math.max(1, Math.min(W.MAX_FRAMES - fr.length, Math.round(+v || 0)));
    if (!v || n < 1) return;
    this.snapshot();
    fr.splice(this.cur + 1, 0, ...W.morphFrames(fr[this.cur], fr[this.cur + 1], n));
    this.pts.clear();
    this.commit(); this.render();
  }

  // ---------- render ----------
  render(full = true) {
    const ch = this.ch;
    const osc = this.k ? t('오실레이터 2') : t('오실레이터 1');
    this.titleEl.textContent = `${t('파형 편집')} · ${osc}${ch ? ` · ${ch.name}` : ''}`;
    this.modesEl.replaceChildren(...MODES.map(([id, ko]) => h('button', { class: this.mode === id ? 'on' : '', onclick: () => { this.mode = id; this.render(); } }, t(ko))),
      h('span', { class: 'sp' }),
      h('button', { class: 'wv-hist', title: t('실행 취소 (Ctrl+Z)'), disabled: !this.history.length, onclick: () => this.undoStep() }, t('되돌리기')),
      h('button', { class: 'wv-hist', title: t('다시 실행 (Ctrl+Y)'), disabled: !this.redo.length, onclick: () => this.redoStep() }, t('다시 실행')));
    this.interpSel.value = this.wt.interp;
    const pos = ch?.synth?.[this.posKey] || 0;
    this.posIn.value = pos; this.posOut.textContent = `${Math.round(pos * 100)}%`;
    this.posIn.disabled = this.wt.frames.length < 2;
    this.countEl.textContent = t('{i} / {n}', { i: this.cur + 1, n: this.wt.frames.length });
    if (full) this.side.replaceChildren(...this.panel());
    this.draw();
    this.drawStrip(full);
  }

  draw() { this.drawWave(); this.drawHarm(); this.drawTable(); }

  seg(items, value, set) {
    return h('div', { class: 'wv-seg' }, ...items.map(([id, ko]) => h('button', { class: value === id ? 'on' : '', onclick: () => { set(id); } }, t(ko))));
  }
  box(title, ...kids) { return h('div', { class: 'wv-box' }, h('b', {}, title), ...kids); }

  panel() {
    const op = (label, fn, title) => h('button', { class: 'btn sm', title, onclick: () => {
      this.snapshot();
      for (const f of this.allFrames ? this.wt.frames : [this.frame]) fn(f);
      if (this.allFrames) this.pts.clear(); else this.pts.delete(this.cur);
      this.commit(); this.render();
    } }, label);
    const every = () => h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: this.allFrames, onchange: (e) => { this.allFrames = e.target.checked; } }), ` ${t('모든 프레임에 적용')}`);
    if (this.mode === 'draw') {
      return [
        this.box(t('도구'), this.seg([['free', N_('자유 그리기')], ['points', N_('점과 곡선')]], this.tool, (v) => { this.tool = v; this.selPt = -1; this.render(); })),
        this.box(t('곡선'), this.seg([['smooth', N_('부드럽게')], ['linear', N_('직선')], ['step', N_('계단')]], this.curve, (v) => {
          this.curve = v;
          const pts = this.pts.get(this.cur);
          if (this.tool === 'points' && pts) { this.snapshot(); for (const [i, p] of pts.entries()) if (this.selPt < 0 || i === this.selPt) p.c = v; this.applyPoints(); this.commit(); }
          this.render();
        }), h('p', { class: 'wv-hint' }, this.tool === 'points' ? t('선택한 점의 다음 구간에 적용되며, 선택한 점이 없으면 전체에 적용돼요.') : t('점과 곡선 도구에서 사용해요.'))),
        this.box(t('격자'),
          h('div', { class: 'wv-row' },
            h('label', { class: 'wv-inline' }, h('span', {}, t('가로')), h('select', { onchange: (e) => { this.grid.x = +e.target.value; this.drawWave(); } }, ...[4, 8, 16, 32, 64].map((n) => h('option', { value: n, selected: this.grid.x === n }, n)))),
            h('label', { class: 'wv-inline' }, h('span', {}, t('세로')), h('select', { onchange: (e) => { this.grid.y = +e.target.value; this.drawWave(); } }, ...[2, 4, 8, 16, 32].map((n) => h('option', { value: n, selected: this.grid.y === n }, n))))),
          h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: this.grid.snap, onchange: (e) => { this.grid.snap = e.target.checked; } }), ` ${t('격자에 맞추기')}`)),
        this.box(t('다듬기'), h('div', { class: 'wv-ops' },
          op(t('정규화'), W.normalize, t('최댓값이 1이 되도록 키워요.')),
          op(t('위아래 뒤집기'), W.invert),
          op(t('좌우 뒤집기'), W.mirror),
          op(t('DC 제거'), W.removeDC, t('파형의 중심을 0에 맞춰요.')),
          op(t('이음매 다듬기'), (f) => W.seam(f), t('주기 끝이 처음과 자연스럽게 이어지도록 만들어 딸깍거림을 줄여요.')),
          op(t('부드럽게'), (f) => W.smooth(f), t('높은 배음을 조금씩 줄여요.')),
          op(t('사인파로 초기화'), (f) => f.set(W.sineFrame()))), every()),
        h('p', { class: 'wv-hint' }, this.tool === 'points' ? t('클릭: 점 추가 · 끌기: 옮기기 · 오른쪽 클릭: 점 지우기 · 직선 구간 가운데 점: 끌어서 휘기, 두 번 클릭하면 다시 직선') : t('끌어서 그리기 · Shift를 누르고 끌면 직선')),
      ];
    }
    if (this.mode === 'harm') {
      return [
        this.box(t('프리셋'), h('div', { class: 'wv-ops' }, ...HARM_BTNS.map(([id, ko]) => h('button', { class: 'btn sm', onclick: () => { this.snapshot(); this.frame.set(W.presetFrame(id)); this.pts.delete(this.cur); this.commit(); this.render(false); } }, t(ko))))),
        this.box(t('보기'),
          this.seg([['lin', N_('선형')], ['db', N_('dB')]], this.dbView ? 'db' : 'lin', (v) => { this.dbView = v === 'db'; this.render(); }),
          h('label', { class: 'wv-inline' }, h('span', {}, t('막대 수')), h('select', { onchange: (e) => { this.hn = +e.target.value; this.render(); } }, ...[64, 128, 256].map((n) => h('option', { value: n, selected: this.hn === n }, n))))),
        this.box(t('배음 편집'), h('div', { class: 'wv-ops' },
          h('button', { class: 'btn sm', onclick: () => this.harmOp((a, p) => { p.fill(0); }) }, t('위상을 모두 0으로')),
          h('button', { class: 'btn sm', title: t('배음마다 위상을 무작위로 바꿔요. 소리는 거의 같지만 파형 모양과 피크가 달라져요.'), onclick: () => { let r = (Date.now() % 2147483646) + 1; this.harmOp((a, p) => { for (let k = 1; k < p.length; k++) { r = (r * 16807) % 2147483647; p[k] = (r / 2147483647) * 2 * Math.PI; } }); } }, t('위상 무작위')),
          h('button', { class: 'btn sm', title: t('옥타브마다 +1.5 dB'), onclick: () => this.harmOp((a) => { for (let k = 2; k < a.length; k++) a[k] *= k ** 0.25; }) }, t('밝게')),
          h('button', { class: 'btn sm', title: t('옥타브마다 −1.5 dB'), onclick: () => this.harmOp((a) => { for (let k = 2; k < a.length; k++) a[k] /= k ** 0.25; }) }, t('어둡게')),
          h('button', { class: 'btn sm', onclick: () => this.harmOp((a) => { for (let k = 2; k < a.length; k += 2) a[k] = 0; }) }, t('홀수 배음만')),
          h('button', { class: 'btn sm', title: t('막대로 보이는 범위보다 높은 배음을 모두 지워요.'), onclick: () => this.harmOp((a) => { for (let k = this.hn + 1; k < a.length; k++) a[k] = 0; }) }, t('범위 밖 배음 지우기'))), every()),
        h('p', { class: 'wv-hint' }, t('위쪽 막대: 배음 크기 · 아래쪽 막대: 위상. 끌어서 조절하면 파형이 바로 바뀌고, 파형을 직접 그리면 막대도 따라 바뀌어요.')),
      ];
    }
    if (this.mode === 'formula') {
      const err = h('p', { class: 'wv-err' });
      const input = h('textarea', { class: 'wv-formula', rows: 3, spellcheck: false, oninput: (e) => { this.formula = e.target.value; err.textContent = this.checkFormula(); } });
      input.value = this.formula; // (a textarea's text is its value, not an attribute)
      const nIn = h('input', { type: 'number', class: 'cl-in wv-n', min: 1, max: W.MAX_FRAMES, value: this.formulaFrames, onchange: (e) => { this.formulaFrames = Math.max(1, Math.min(W.MAX_FRAMES, Math.round(+e.target.value || 1))); } });
      return [
        this.box(t('수식'), input, err,
          h('div', { class: 'wv-row' },
            h('button', { class: 'btn sm', onclick: () => this.applyFormula(false, err) }, t('현재 프레임에 적용')),
            h('span', { class: 'sp' }),
            h('label', { class: 'wv-inline' }, h('span', {}, t('프레임')), nIn),
            h('button', { class: 'btn sm primary', onclick: () => this.applyFormula(true, err) }, t('테이블 만들기')))),
        this.box(t('예시'), h('div', { class: 'wv-ex' }, ...EXAMPLES.map((x) => h('button', { class: 'wv-code', onclick: () => { this.formula = x; input.value = x; err.textContent = this.checkFormula(); } }, x)))),
        h('p', { class: 'wv-hint' }, t('x: 위상 (0 ~ 2π) · t: 주기 내 위치 (0 ~ 1) · f: 테이블 내 위치 (0 ~ 1) · pi')),
        h('p', { class: 'wv-hint mono' }, 'sin cos tan tanh abs sqrt exp log pow min max floor round sign frac clamp saw square tri mix'),
      ];
    }
    // from audio
    const a = this.audio, media = Object.entries(this.S.proj.media || {});
    const info = h('p', { class: 'wv-hint' }, a.info);
    const nIn = h('input', { type: 'number', class: 'cl-in wv-n', min: 2, max: W.MAX_FRAMES, value: Math.max(2, a.frames), disabled: a.frames <= 1, onchange: (e) => { a.frames = Math.max(2, Math.min(W.MAX_FRAMES, Math.round(+e.target.value || 2))); } });
    const range = (label, key) => h('label', { class: 'wv-inline' }, h('span', {}, label), h('input', { type: 'number', class: 'cl-in wv-n', min: 0, max: 100, value: a[key], onchange: (e) => { a[key] = Math.max(0, Math.min(100, +e.target.value || 0)); } }), h('span', { class: 'dim' }, '%'));
    return [
      this.box(t('소리'),
        h('select', { class: 'wv-src', onchange: (e) => { a.src = e.target.value; } },
          h('option', { value: '' }, media.length ? t('프로젝트에서 오디오 선택…') : t('프로젝트에 오디오가 없어요')),
          ...media.map(([hash, m]) => h('option', { value: hash, selected: a.src === hash }, `${m.name}${m.dur ? ` · ${m.dur.toFixed(1)}s` : ''}`))),
        h('button', { class: 'btn sm', onclick: () => this.audioFromFile(info) }, t('파일에서 가져오기…'))),
      this.box(t('가져오는 방식'),
        this.seg([['one', N_('한 주기 (음높이 감지)')], ['run', N_('여러 프레임')]], a.frames <= 1 ? 'one' : 'run', (v) => { a.frames = v === 'one' ? 1 : Math.max(16, a.frames); this.render(); }),
        h('div', { class: 'wv-row' }, h('label', { class: 'wv-inline' }, h('span', {}, t('프레임 수')), nIn)),
        h('div', { class: 'wv-row' }, range(t('시작'), 'from'), range(t('끝'), 'to'))),
      h('div', { class: 'wv-row' }, h('button', { class: 'btn sm primary', disabled: !media.length, onclick: () => this.audioFromProject(info) }, t('가져오기'))),
      info,
      h('p', { class: 'wv-hint' }, t('녹음한 소리나 분리한 스템도 프로젝트 오디오에 포함되어 있어 여기서 선택할 수 있어요. 단일음이 나는 구간을 사용하는 것이 가장 좋아요.')),
    ];
  }

  say(text) { this.msg.textContent = text; clearTimeout(this.msgT); this.msgT = setTimeout(() => { this.msg.textContent = ''; }, 5000); }

  // ---------- harmonics ----------
  harmOp(fn) {
    this.snapshot();
    for (const f of this.allFrames ? this.wt.frames : [this.frame]) {
      const sp = W.spectrum(f);
      fn(sp.amp, sp.phase);
      f.set(W.fromHarmonics(sp.amp, sp.phase, W.N, W.MAXH - 1, 0));
    }
    if (this.allFrames) this.pts.clear(); else this.pts.delete(this.cur);
    this.commit(); this.render();
  }

  // ---------- formula ----------
  checkFormula() {
    try { W.compileFormula(this.formula); return ''; } catch (e) { return this.formulaError(e); }
  }
  formulaError(e) {
    const at = (e.at ?? 0) + 1;
    if (e.code === 'unknown') return t('{at}번째 글자: 알 수 없는 이름 "{what}"', { at, what: e.what });
    if (e.code === 'bad_char') return t('{at}번째 글자를 읽을 수 없어요.', { at });
    if (e.code === 'end') return t('수식이 아직 끝나지 않았어요{what}', { what: e.what ? ` (${e.what})` : '' });
    if (e.code === 'too_long') return t('수식이 너무 길어요.');
    return t('{at}번째 글자 근처를 확인해 주세요', { at });
  }
  applyFormula(table, err) {
    try {
      const fr = table
        ? Array.from({ length: this.formulaFrames }, (_, i) => W.formulaFrame(this.formula, this.formulaFrames > 1 ? i / (this.formulaFrames - 1) : 0))
        : [W.formulaFrame(this.formula, this.wt.frames.length > 1 ? this.cur / (this.wt.frames.length - 1) : 0)];
      // scale the whole set together so the frames keep their relative sizes
      const pk = Math.max(...fr.map(W.peak));
      if (pk > 1) for (const f of fr) for (let i = 0; i < f.length; i++) f[i] /= pk;
      this.snapshot();
      if (table) { this.wt.frames = fr; this.cur = 0; if (fr.length > 1) this.wt.interp = 'spectral'; } else this.frame.set(fr[0]);
      this.pts.clear();
      err.textContent = '';
      this.commit(); this.render();
    } catch (e) { err.textContent = e instanceof W.FormulaError ? this.formulaError(e) : tdyn(e.message || e); }
  }

  // ---------- from audio ----------
  async audioFromProject(info) {
    const a = this.audio;
    if (!a.src) { info.textContent = t('먼저 오디오를 선택해 주세요.'); return; }
    try {
      const b = await decode(a.src, 48000);
      this.takeAudio(b.getChannelData(0), b.sampleRate, this.S.proj.media[a.src]?.name || '', info);
    } catch (e) { info.textContent = t('오디오를 읽지 못했어요: {err}', { err: tdyn(e.message || e) }); }
  }
  async audioFromFile(info) {
    const f = (await window.melofi.mediaPickFiles())?.[0];
    if (!f) return;
    try {
      const c = new OfflineAudioContext(1, 1, 48000);
      const b = await c.decodeAudioData(f.data.buffer.slice(f.data.byteOffset, f.data.byteOffset + f.data.byteLength));
      this.takeAudio(b.getChannelData(0), b.sampleRate, f.name.replace(/\.[^.]+$/, ''), info);
    } catch (e) { info.textContent = t('오디오를 읽지 못했어요: {err}', { err: tdyn(e.message || e) }); }
  }
  takeAudio(x, rate, name, info) {
    const a = this.audio;
    try {
      const wt = W.audioToTable(x, rate, { frames: a.frames, from: a.from / 100, to: Math.max(a.from + 1, a.to) / 100, name });
      this.snapshot();
      this.wt = { name: wt.name, interp: wt.interp, frames: wt.frames };
      this.cur = 0; this.pts.clear();
      const midi = 69 + 12 * Math.log2(wt.hz / 440), nn = Math.round(midi);
      a.info = t('감지된 음높이: {hz} Hz ({note}) · 프레임 {n}개', { hz: wt.hz.toFixed(1), note: `${NOTE_NAMES[((nn % 12) + 12) % 12]}${Math.floor(nn / 12) - 1}`, n: wt.frames.length });
      this.commit(); this.render();
    } catch (e) {
      info.textContent = e.message === 'no_pitch' ? t('음높이를 찾지 못했어요. 단일음이 또렷하게 나는 구간을 선택해 주세요.') : tdyn(e.message || e);
    }
  }

  // ---------- WAV / library ----------
  async importWav() {
    const f = (await window.melofi.mediaPickFiles())?.[0];
    if (!f) return;
    try {
      const r = W.wavToTable(f.data, f.name.replace(/\.[^.]+$/, ''));
      this.snapshot(t('웨이브테이블 불러오기'));
      this.wt = { name: r.table.name, interp: r.table.interp, frames: r.table.frames };
      this.cur = 0; this.pts.clear();
      this.commit(); this.render();
      this.say(t('{n}개 프레임 · 프레임당 {size}샘플{clm}', { n: r.table.frames.length, size: r.frameSize, clm: r.clm ? ` · ${t('Serum/Vital 정보 있음')}` : '' }));
    } catch (e) { this.say(t('이 WAV를 읽지 못했어요: {err}', { err: tdyn(e.message || e) })); }
  }
  async exportWav() {
    const name = this.wt.name || this.ch?.name || 'MeloFi';
    const p = await window.melofi.wavetableSave(W.encodeWavetableWav(this.wt), name);
    if (p) this.say(t('저장했어요: {path}', { path: p }));
  }
  libraryMenu(e) {
    const waves = userWaves();
    const items = [
      { label: t('현재 테이블 저장…'), act: async () => {
        const name = (await ask(t('파형 이름'), this.wt.name || ''))?.trim();
        if (!name) return;
        this.wt.name = name;
        await saveUserWave(name, W.encodeTable(this.wt));
        this.say(t('"{name}"을(를) 내 파형에 저장했어요.', { name }));
      } },
    ];
    const names = Object.keys(waves).sort((a, b) => a.localeCompare(b, 'ko'));
    if (names.length) {
      items.push({ sep: true }, { group: t('불러오기') });
      for (const n of names) items.push({ label: n, hint: t('{n}프레임', { n: Math.max(1, Math.round((waves[n].data?.length || 0) * 3 / 4 / (W.N * 4))) }), act: () => {
        const wt = W.decodeTable(waves[n]);
        if (!wt) return;
        this.snapshot();
        this.wt = { name: n, interp: wt.interp, frames: wt.frames };
        this.cur = 0; this.pts.clear();
        this.commit(); this.render();
      } });
      items.push({ sep: true }, { group: t('지우기') });
      for (const n of names) items.push({ label: t('{name} 지우기', { name: n }), act: async () => { await deleteUserWave(n); this.say(t('지웠어요.')); } });
    }
    popup(e.clientX, e.clientY, items);
  }

  play() {
    const ch = this.ch;
    if (ch) this.S.engine?.channels.get(ch.id)?.noteOn(60, 100, 0, 0.6);
  }

  // ---------- the waveform view ----------
  geom(cv) {
    const r = cv.getBoundingClientRect(), d = devicePixelRatio || 1;
    const w = Math.max(10, Math.round(r.width * d)), hh = Math.max(10, Math.round(r.height * d));
    if (cv.width !== w || cv.height !== hh) { cv.width = w; cv.height = hh; }
    return { w, h: hh, d, r };
  }
  colors() {
    const e = this.el;
    return { bg: css(e, '--wv-bg'), grid: css(e, '--wv-grid'), grid2: css(e, '--wv-grid-2'), zero: css(e, '--wv-zero'), line: css(e, '--wv-line'), fill: css(e, '--wv-fill'), ghost: css(e, '--wv-ghost'), ink: css(e, '--wv-ink'), pt: css(e, '--wv-point'), ph: css(e, '--wv-phase'), bar: css(e, '--wv-bar'), barHi: css(e, '--wv-bar-hi'), sel: css(e, '--wv-sel') };
  }
  drawWave() {
    const cv = this.wcv, g = this.geom(cv), c = cv.getContext('2d'), C = this.colors();
    const { w, h: H, d } = g, pad = 8 * d, mid = H / 2, amp = (H / 2 - pad);
    c.fillStyle = C.bg; c.fillRect(0, 0, w, H);
    c.lineWidth = 1;
    for (let i = 1; i < this.grid.x; i++) { const x = Math.round((i / this.grid.x) * w) + 0.5; c.strokeStyle = i % (this.grid.x / 4) === 0 ? C.grid2 : C.grid; c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); }
    for (let i = 1; i < this.grid.y; i++) { const y = Math.round(pad + (i / this.grid.y) * (H - 2 * pad)) + 0.5; c.strokeStyle = C.grid; c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }
    c.strokeStyle = C.zero; c.beginPath(); c.moveTo(0, Math.round(mid) + 0.5); c.lineTo(w, Math.round(mid) + 0.5); c.stroke();
    const path = (f) => { c.beginPath(); for (let x = 0; x <= w; x++) { const v = f[Math.min(W.N - 1, Math.floor((x / w) * W.N))]; const y = mid - Math.max(-1.2, Math.min(1.2, v)) * amp; if (x) c.lineTo(x, y); else c.moveTo(x, y); } };
    // neighbouring frames, faint
    for (const j of [this.cur - 1, this.cur + 1]) if (this.wt.frames[j]) { path(this.wt.frames[j]); c.strokeStyle = C.ghost; c.lineWidth = 1 * d; c.stroke(); }
    path(this.frame);
    c.lineTo(w, mid); c.lineTo(0, mid); c.closePath(); c.fillStyle = C.fill; c.fill();
    path(this.frame); c.strokeStyle = C.line; c.lineWidth = 1.6 * d; c.lineJoin = 'round'; c.stroke();
    if (this.tool === 'points' && this.mode === 'draw') {
      const pts = this.pointsFor();
      pts.forEach((p, i) => {
        const x = p.x * w, y = mid - p.y * amp;
        c.beginPath();
        if (p.c === 'step') c.rect(x - 4 * d, y - 4 * d, 8 * d, 8 * d); else if (p.c === 'linear') { c.moveTo(x, y - 5 * d); c.lineTo(x + 5 * d, y); c.lineTo(x, y + 5 * d); c.lineTo(x - 5 * d, y); c.closePath(); } else c.arc(x, y, 4.2 * d, 0, Math.PI * 2);
        c.fillStyle = i === this.selPt ? C.sel : C.bg; c.fill(); c.strokeStyle = C.pt; c.lineWidth = 1.5 * d; c.stroke();
      });
      // tension: a small dot in the middle of every straight segment
      for (const hd of this.handles()) { c.beginPath(); c.arc(hd.x * w, mid - hd.y * amp, 3 * d, 0, Math.PI * 2); c.fillStyle = hd.seg.b ? C.pt : C.ghost; c.fill(); }
    }
    if (this.hoverAt) {
      const { x, y } = this.hoverAt;
      this.frameLbl.textContent = t('x {x} · y {y} · 프레임 {i} / {n}', { x: x.toFixed(3), y: `${y >= 0 ? '+' : ''}${y.toFixed(3)}`, i: this.cur + 1, n: this.wt.frames.length });
      return;
    }
    this.frameLbl.textContent = t('프레임 {i} / {n} · 최대 {pk}', { i: this.cur + 1, n: this.wt.frames.length, pk: W.peak(this.frame).toFixed(2) });
  }
  // (x 0..1, y -1..1) of a pointer event on the wave view, snapped to the grid when asked
  at(e, snapX = this.grid.snap) {
    const r = this.wcv.getBoundingClientRect(), pad = 8;
    let x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    let y = Math.max(-1, Math.min(1, (r.height / 2 - (e.clientY - r.top)) / (r.height / 2 - pad)));
    if (this.grid.snap) { y = Math.round(((y + 1) / 2) * this.grid.y) / this.grid.y * 2 - 1; if (snapX) x = Math.round(x * this.grid.x) / this.grid.x; }
    return { x: Math.min(x, 0.99999), y };
  }
  pointsFor() {
    if (!this.pts.has(this.cur)) {
      // start from the frame as it is: a point on every grid column
      const n = this.grid.x, f = this.frame;
      this.pts.set(this.cur, Array.from({ length: n }, (_, i) => ({ x: i / n, y: Math.max(-1, Math.min(1, f[Math.floor((i / n) * W.N)])), c: this.curve })));
    }
    return this.pts.get(this.cur);
  }
  applyPoints() { this.frame.set(W.fromPoints(this.pointsFor())); }
  // the middle of each straight segment (the last one wraps to the first point)
  handles() {
    const pts = this.pointsFor(), out = [];
    pts.forEach((a, i) => {
      if (a.c !== 'linear') return;
      const b = pts[(i + 1) % pts.length], bx = i + 1 < pts.length ? b.x : b.x + 1;
      const mx = (a.x + bx) / 2;
      out.push({ seg: a, next: b, x: mx % 1, y: a.y + (b.y - a.y) * W.bend(0.5, a.b || 0) });
    });
    return out;
  }
  hitHandle(e) {
    const r = this.wcv.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
    let best = null, bd = 8 * 8;
    for (const hd of this.handles()) { const dx = hd.x * r.width - px, dy = r.height / 2 - hd.y * (r.height / 2 - 8) - py, dd = dx * dx + dy * dy; if (dd < bd) { bd = dd; best = hd; } }
    return best;
  }
  removePoint(i) {
    const pts = this.pointsFor();
    if (pts.length <= 1) return;
    this.snapshot(); pts.splice(i, 1); this.selPt = -1; this.applyPoints(); this.commit(); this.draw(); this.drawStrip(true);
  }
  bindWave() {
    const cv = this.wcv;
    cv.addEventListener('dblclick', (e) => {
      if (this.tool !== 'points' || this.mode !== 'draw') return;
      const hd = this.hitHandle(e);
      if (hd && hd.seg.b) { this.snapshot(); hd.seg.b = 0; this.applyPoints(); this.commit(); this.draw(); }
    });
    cv.addEventListener('pointermove', (e) => { if (!this.dragging) { this.hoverAt = this.at(e, false); this.drawWave(); } });
    cv.addEventListener('pointerleave', () => { this.hoverAt = null; this.drawWave(); });
    cv.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (this.tool !== 'points') return;
      const i = this.hitPoint(e);
      if (i >= 0) this.removePoint(i);
    });
    cv.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      this.el.focus({ preventScroll: true });
      try { cv.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
      this.snapshot();
      this.dragging = true;
      if (this.tool === 'points' && this.mode === 'draw') {
        const pts = this.pointsFor();
        const hd = this.hitPoint(e) < 0 ? this.hitHandle(e) : null;
        if (hd) {
          // bend the segment: it passes through the pointer at its middle
          const move = (ev) => { const p = this.at(ev, false); hd.seg.b = W.bendFor(hd.seg.y, hd.next.y, p.y); this.applyPoints(); this.drawWave(); this.drawHarm(); this.liveCommit(); };
          const up = () => { cv.removeEventListener('pointermove', move); cv.removeEventListener('pointerup', up); this.endDrag(); this.drawWave(); };
          cv.addEventListener('pointermove', move); cv.addEventListener('pointerup', up);
          return;
        }
        let i = this.hitPoint(e);
        if (i < 0) { const p = this.at(e); pts.push({ ...p, c: this.curve }); pts.sort((a, b) => a.x - b.x); i = pts.findIndex((q) => q.x === p.x && q.y === p.y); }
        this.selPt = i;
        const drag = pts[i];
        const move = (ev) => { const p = this.at(ev); drag.x = p.x; drag.y = p.y; pts.sort((a, b) => a.x - b.x); this.selPt = pts.indexOf(drag); this.applyPoints(); this.drawWave(); this.drawHarm(); this.liveCommit(); };
        const up = () => { cv.removeEventListener('pointermove', move); cv.removeEventListener('pointerup', up); this.endDrag(); this.drawWave(); };
        this.applyPoints(); this.drawWave(); this.drawHarm(); this.liveCommit();
        cv.addEventListener('pointermove', move); cv.addEventListener('pointerup', up);
        return;
      }
      // freehand: every sample between the last pointer position and this one (Shift: a straight line from the press)
      const f = this.frame, start = this.at(e, false);
      let last = start;
      const paint = (a, b) => {
        const i0 = Math.floor(a.x * W.N), i1 = Math.floor(b.x * W.N);
        const lo = Math.min(i0, i1), hi = Math.max(i0, i1);
        for (let i = lo; i <= hi; i++) { const u = hi === lo ? 1 : (i - i0) / (i1 - i0); f[Math.min(W.N - 1, i)] = a.y + (b.y - a.y) * u; }
      };
      const base = Float32Array.from(f);
      paint(start, start);
      const move = (ev) => {
        const p = this.at(ev, false);
        if (ev.shiftKey) { f.set(base); paint(start, p); } else paint(last, p);
        last = p;
        this.pts.delete(this.cur);
        this.drawWave(); this.drawHarm(); this.liveCommit();
      };
      const up = () => { cv.removeEventListener('pointermove', move); cv.removeEventListener('pointerup', up); this.endDrag(); };
      this.drawWave(); this.liveCommit();
      cv.addEventListener('pointermove', move); cv.addEventListener('pointerup', up);
    });
  }
  hitPoint(e) {
    const r = this.wcv.getBoundingClientRect(), pts = this.pointsFor();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    let best = -1, bd = 9 * 9;
    pts.forEach((p, i) => { const dx = p.x * r.width - px, dy = r.height / 2 - p.y * (r.height / 2 - 8) - py, dd = dx * dx + dy * dy; if (dd < bd) { bd = dd; best = i; } });
    return best;
  }

  // ---------- the harmonics view ----------
  drawHarm() {
    const cv = this.hcv, g = this.geom(cv), c = cv.getContext('2d'), C = this.colors();
    const { w, h: H, d } = g, split = Math.round(H * 0.68), gap = 6 * d;
    c.fillStyle = C.bg; c.fillRect(0, 0, w, H);
    const s = W.spectrum(this.frame);
    this.spec = s;
    const HN = this.hn;
    this.harmCap.textContent = t('배음 1–{n} · 크기 / 위상', { n: HN });
    let top = 0; for (let k = 1; k <= HN; k++) top = Math.max(top, s.amp[k]);
    const scale = Math.max(1, top);
    const bw = w / HN;
    c.strokeStyle = C.grid; c.lineWidth = 1;
    const marks = HN === 64 ? [8, 16, 32, 48] : HN === 128 ? [16, 32, 64, 96] : [32, 64, 128, 192];
    for (const k of marks) { const x = Math.round(k * bw) + 0.5; c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); }
    c.strokeStyle = C.zero; c.beginPath(); c.moveTo(0, split + 0.5); c.lineTo(w, split + 0.5); c.stroke();
    const pm = split + gap + (H - split - gap) / 2;
    c.strokeStyle = C.grid; c.beginPath(); c.moveTo(0, Math.round(pm) + 0.5); c.lineTo(w, Math.round(pm) + 0.5); c.stroke();
    for (let k = 1; k <= HN; k++) {
      const x = (k - 1) * bw + (bw > 4 * d ? d : 0), bwi = Math.max(1, bw - (bw > 4 * d ? 2 * d : 0));
      const a = this.barOf(s.amp[k] / scale), hgt = a * (split - gap);
      c.fillStyle = this.hover?.k === k ? C.barHi : C.bar;
      if (hgt > 0.5) c.fillRect(x, split - hgt, bwi, hgt);
      if (s.amp[k] > 1e-4) {
        let ph = s.phase[k]; ph = Math.atan2(Math.sin(ph), Math.cos(ph));
        const ph0 = (ph / Math.PI) * ((H - split - gap) / 2 - 1);
        c.fillStyle = C.ph;
        c.fillRect(x, Math.min(pm, pm - ph0), bwi, Math.max(1, Math.abs(ph0)));
      }
    }
    c.fillStyle = C.ink; c.font = `${10 * d}px ${css(this.el, '--mono') || 'monospace'}`;
    for (const k of [1, ...marks, HN]) c.fillText(String(k), Math.min(w - 22 * d, (k - 1) * bw + 2 * d), 11 * d);
    if (this.dbView) { c.fillText('0 dB', w - 34 * d, 22 * d); c.fillText('−60', w - 26 * d, split - 3 * d); }
    if (this.hover) {
      const k = this.hover.k, a = s.amp[k], db = a > 1e-6 ? (20 * Math.log10(a)).toFixed(1) : '−∞';
      let ph = s.phase[k]; ph = Math.atan2(Math.sin(ph), Math.cos(ph));
      this.harmLbl.textContent = t('배음 {k} · 크기 {a} ({db} dB) · 위상 {ph}°', { k, a: a.toFixed(3), db, ph: Math.round((ph * 180) / Math.PI) });
    } else this.harmLbl.textContent = scale > 1 ? t('막대 높이 기준 {s}', { s: scale.toFixed(2) }) : '';
  }
  // bar height (0..1) for an amplitude relative to the scale, and back: linear or 60 dB
  barOf(a) { return this.dbView ? (a > 1e-3 ? Math.max(0, Math.min(1, (20 * Math.log10(a) + 60) / 60)) : 0) : a; }
  ampOf(v) { return this.dbView ? (v <= 0 ? 0 : 10 ** ((v * 60 - 60) / 20)) : v;
  }
  bindHarm() {
    const cv = this.hcv;
    const where = (e) => {
      const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      const HN = this.hn, k = Math.max(1, Math.min(HN, Math.floor((x / r.width) * HN) + 1)), split = r.height * 0.68, gap = 6;
      // the bottom few pixels of a bar are zero, so a harmonic can be taken out completely
      if (y <= split) { const v = (split - y) / (split - gap); return { k, kind: 'amp', v: v < 0.025 ? 0 : Math.min(1, v) }; }
      const mid = split + gap + (r.height - split - gap) / 2, half = (r.height - split - gap) / 2;
      return { k, kind: 'phase', v: Math.max(-1, Math.min(1, (mid - y) / half)) * Math.PI };
    };
    cv.addEventListener('pointerleave', () => { if (!this.dragging) { this.hover = null; this.drawHarm(); } });
    cv.addEventListener('pointermove', (e) => { if (this.dragging) return; this.hover = where(e); this.drawHarm(); });
    cv.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      this.el.focus({ preventScroll: true });
      try { cv.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
      this.snapshot();
      this.dragging = true;
      const s = W.spectrum(this.frame);
      let top = 0; for (let k = 1; k <= this.hn; k++) top = Math.max(top, s.amp[k]);
      const scale = Math.max(1, top), first = where(e);
      let last = first;
      const set = (a, b) => {
        const k0 = Math.min(a.k, b.k), k1 = Math.max(a.k, b.k);
        for (let k = k0; k <= k1; k++) {
          const u = k1 === k0 ? 1 : (k - a.k) / (b.k - a.k), v = a.v + (b.v - a.v) * u;
          if (first.kind === 'amp') s.amp[k] = this.ampOf(v) * scale; else { s.phase[k] = v; if (s.amp[k] < 1e-4) s.amp[k] = 0; }
        }
        this.frame.set(W.fromHarmonics(s.amp, s.phase, W.N, W.MAXH - 1, 0));
        this.pts.delete(this.cur);
        this.hover = b;
        this.drawWave(); this.drawHarm(); this.liveCommit();
      };
      const move = (ev) => { const p = where(ev); p.kind = first.kind; if (first.kind === 'phase') p.v = where({ clientX: ev.clientX, clientY: ev.clientY }).v; set(last, p); last = p; };
      const up = () => { cv.removeEventListener('pointermove', move); cv.removeEventListener('pointerup', up); this.endDrag(); };
      set(first, first);
      cv.addEventListener('pointermove', move); cv.addEventListener('pointerup', up);
    });
  }

  // ---------- frame strip and table view ----------
  drawStrip(rebuild) {
    const fr = this.wt.frames;
    if (rebuild || this.strip.children.length !== fr.length) {
      this.strip.replaceChildren(...fr.map((_, i) => h('canvas', { class: 'wv-thumb', width: 64, height: 36, title: t('프레임 {i}', { i: i + 1 }), onclick: () => this.select(i), oncontextmenu: (e) => this.frameMenu(e, i) })));
      [...this.strip.children].forEach((cv, i) => this.thumb(cv, i));
    } else this.thumb(this.strip.children[this.cur], this.cur);
    [...this.strip.children].forEach((cv, i) => cv.classList.toggle('on', i === this.cur));
    this.strip.children[this.cur]?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    this.countEl.textContent = t('{i} / {n}', { i: this.cur + 1, n: fr.length });
  }
  thumb(cv, i) {
    if (!cv) return;
    const c = cv.getContext('2d'), C = this.colors(), f = this.wt.frames[i], w = cv.width, H = cv.height;
    c.fillStyle = C.bg; c.fillRect(0, 0, w, H);
    c.strokeStyle = C.line; c.lineWidth = 1; c.beginPath();
    for (let x = 0; x < w; x++) { const y = H / 2 - Math.max(-1.1, Math.min(1.1, f[Math.floor((x / w) * W.N)])) * (H / 2 - 3); if (x) c.lineTo(x, y); else c.moveTo(x, y); }
    c.stroke();
  }
  // the whole table at an angle (the way Serum and Vital show it): back frames up and to the right
  drawTable() {
    const cv = this.tcv, g = this.geom(cv), c = cv.getContext('2d'), C = this.colors();
    const { w, h: H, d } = g, fr = this.wt.frames, n = fr.length;
    c.fillStyle = C.bg; c.fillRect(0, 0, w, H);
    const show = Math.min(n, 40), dx = (w * 0.28) / Math.max(1, show - 1), dy = (H * 0.42) / Math.max(1, show - 1);
    const ww = w * 0.7, hh = H * 0.24, base = H - hh - 6 * d;
    const pos = this.ch?.synth?.[this.posKey] || 0, posF = pos * (n - 1);
    for (let j = show - 1; j >= 0; j--) {
      const i = show === 1 ? 0 : Math.round((j / (show - 1)) * (n - 1));
      const ox = 4 * d + j * dx, oy = base - j * dy, f = fr[i];
      c.beginPath();
      for (let x = 0; x <= 64; x++) { const v = f[Math.min(W.N - 1, Math.floor((x / 64) * W.N))]; const X = ox + (x / 64) * ww, Y = oy - Math.max(-1.1, Math.min(1.1, v)) * hh; if (x) c.lineTo(X, Y); else c.moveTo(X, Y); }
      const near = Math.abs(i - posF) <= (n - 1) / Math.max(1, show - 1) / 2;
      c.strokeStyle = i === this.cur ? C.line : near ? C.pt : C.ghost;
      c.lineWidth = (i === this.cur || near ? 1.4 : 1) * d;
      c.stroke();
    }
  }
  bindTable() {
    // drag across the table view to move the table position
    const cv = this.tcv;
    cv.addEventListener('pointerdown', (e) => {
      if (this.wt.frames.length < 2) return;
      try { cv.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
      const r = cv.getBoundingClientRect();
      const go = (ev) => { const v = Math.max(0, Math.min(1, (ev.clientX - r.left - r.width * 0.05) / (r.width * 0.9))); this.posIn.value = v; this.setPos(v); };
      go(e);
      const up = () => { cv.removeEventListener('pointermove', go); cv.removeEventListener('pointerup', up); };
      cv.addEventListener('pointermove', go); cv.addEventListener('pointerup', up);
    });
  }
}
