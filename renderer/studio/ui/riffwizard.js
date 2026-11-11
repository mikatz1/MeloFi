// Riff Machine window (Alt+R in the piano roll): FL Studio's step-by-step riff builder. Each step
// changes one stage; the preview shows (and plays) the riff as it stands after that step.
import { h } from './dom.js';
import { STAGES, PROGRESSIONS, GROOVES, DEFAULTS, build } from '../riffmachine.js';
import { PPQ, STEP, barTicks, pattern } from '../model.js';

export class RiffWizard {
  constructor(studio) {
    this.S = studio;
    this.step = 0;
    this.seed = 1;
    this.opts = JSON.parse(JSON.stringify(DEFAULTS));
    let head;
    this.el = h('section', { id: 'riffwin', class: 'ch-float', hidden: true },
      h('div', { class: 'sheet-card rw-card' },
        head = h('div', { class: 'sheet-head ch-drag', title: '끌어서 옮기기' }, h('h2', {}, 'Riff Machine'), h('button', { class: 'x', 'aria-label': '닫기', onclick: () => this.close() })),
        this.stepsEl = h('div', { class: 'cl-tabs rw-steps' }),
        this.body = h('div', { class: 'rw-body' }),
        this.cv = h('canvas', { class: 'rw-preview', width: 640, height: 150 }),
        this.foot = h('div', { class: 'rw-foot' })));
    head.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      try { head.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
      const r = this.el.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
      const move = (ev) => { this.el.style.left = `${Math.max(0, ev.clientX - dx)}px`; this.el.style.top = `${Math.max(0, ev.clientY - dy)}px`; };
      const up = () => { head.removeEventListener('pointermove', move); head.removeEventListener('pointerup', up); };
      head.addEventListener('pointermove', move); head.addEventListener('pointerup', up);
    });
    document.body.append(this.el);
  }

  get scale() { return this.S.proj.scale || { root: 0, type: 'minor' }; }
  notes(upto = this.step) { return build(this.scale, this.opts, this.seed, upto); }

  open() {
    // at least four bars (one chord each), longer if the pattern already is
    this.opts.progression.bars = Math.max(4, Math.min(8, Math.round(pattern(this.S.proj).bars * (barTicks(this.S.proj) / (PPQ * 4))) || 4));
    this.seed = Math.floor(Math.random() * 1e6);
    this.step = 0;
    this.el.hidden = false;
    if (!this.el.style.left) { this.el.style.left = `${Math.max(20, innerWidth / 2 - 340)}px`; this.el.style.top = '110px'; }
    this.render();
  }

  close() { this.stop(); this.el.hidden = true; }

  render() {
    const st = STAGES[this.step];
    this.stepsEl.replaceChildren(...STAGES.map((s, i) => h('button', { class: i === this.step ? 'on' : i < this.step ? 'done' : '', title: s.ko, onclick: () => { this.step = i; this.render(); } }, `${i + 1}. ${s.name}`)));
    this.body.replaceChildren(h('p', { class: 'hint' }, `${st.ko}: ${HELP[st.id]}`), ...this.controls(st.id));
    this.foot.replaceChildren(
      h('button', { class: 'btn sm ghost', disabled: this.step === 0, onclick: () => { this.step--; this.render(); } }, '이전'),
      h('button', { class: 'btn sm', title: '같은 설정으로 다르게 (주사위)', onclick: () => { this.seed = Math.floor(Math.random() * 1e6); this.render(); this.play(); } }, '다시 굴리기'),
      h('button', { class: 'btn sm', onclick: () => (this.playing ? this.stop() : this.play()) }, this.playing ? '정지' : '듣기'),
      h('span', { class: 'sp' }),
      this.step < STAGES.length - 1
        ? h('button', { class: 'btn sm primary', onclick: () => { this.step++; this.render(); } }, '다음')
        : null,
      h('button', { class: `btn sm ${this.step === STAGES.length - 1 ? 'primary' : ''}`, title: '피아노 롤의 지금 채널에 넣기', onclick: () => this.accept() }, '적용'));
    this.draw();
  }

  controls(id) {
    const o = this.opts[id];
    const set = (k, v) => { o[k] = v; this.render(); };
    const sel = (k, label, opts) => h('label', { class: 'frm-row' }, h('span', {}, label), h('select', { onchange: (e) => set(k, isNaN(+e.target.value) ? e.target.value : +e.target.value) }, ...opts.map(([v, l]) => h('option', { value: v, selected: String(o[k]) === String(v) }, l))));
    const chk = (k, label) => h('label', { class: 'frm-row' }, h('span', {}, label), h('input', { type: 'checkbox', checked: !!o[k], onchange: (e) => set(k, e.target.checked) }));
    const num = (k, label, min, max, step = 1) => h('label', { class: 'frm-row' }, h('span', {}, label), h('input', { type: 'number', class: 'cl-in', min, max, step, value: o[k], onchange: (e) => set(k, Math.max(min, Math.min(max, +e.target.value || min))) }));
    if (id === 'progression') return [
      sel('prog', '진행', Object.entries(PROGRESSIONS).map(([k, p]) => [k, p.name])),
      num('bars', '길이 (마디)', 1, 8), sel('perBar', '마디당 코드', [[1, '1개'], [2, '2개']]), sel('size', '화음', [[3, '3화음'], [4, '7화음']]),
      sel('octave', '옥타브', [[3, '3 (낮게)'], [4, '4 (가운데)'], [5, '5 (높게)']]), chk('invert', '부드럽게 잇기 (전위)')];
    if (id === 'arpeggiate') return [
      sel('mode', '순서', [['off', '끔 (화음 그대로)'], ['up', '위로'], ['down', '아래로'], ['updown', '위아래'], ['random', '무작위']]),
      sel('rate', '빠르기', [[1, '1/16'], [2, '1/8'], [4, '1/4']]), num('range', '옥타브 범위', 1, 3), num('gate', '음 길이 (0–1)', 0.1, 1, 0.05)];
    if (id === 'groove') return [
      sel('groove', '리듬', Object.entries(GROOVES).map(([k, g]) => [k, g.name])), num('density', '밀도 (0–1)', 0.1, 1, 0.05), num('swing', '스윙 (0–1)', 0, 1, 0.05)];
    if (id === 'mirror') return [chk('flipH', '좌우 뒤집기'), chk('flipV', '위아래 뒤집기'), sel('octave', '옥타브 이동', [[-1, '-1'], [0, '0'], [1, '+1']]), num('mutate', '변형 정도 (0–1)', 0, 1, 0.05)];
    return [num('vel', '기본 벨로시티', 20, 127), num('spread', '흔들림', 0, 40), chk('accent', '정박 강조'), chk('legato', '레가토')];
  }

  draw() {
    const notes = this.notes(), g = this.cv.getContext('2d'), W = this.cv.width, H = this.cv.height;
    g.fillStyle = '#121317'; g.fillRect(0, 0, W, H);
    if (!notes.length) return;
    const end = Math.max(...notes.map((x) => x.t + x.d), 16 * STEP), lo = Math.min(...notes.map((x) => x.n)) - 2, hi = Math.max(...notes.map((x) => x.n)) + 2;
    const xs = W / end, ys = H / (hi - lo + 1);
    g.fillStyle = '#23242b';
    for (let b = 0; b * 16 * STEP < end; b++) g.fillRect(Math.round(b * 16 * STEP * xs), 0, 1, H);
    for (const x of notes) {
      g.globalAlpha = 0.45 + 0.55 * (x.v / 127);
      g.fillStyle = '#e8a15d';
      g.fillRect(x.t * xs + 0.5, H - (x.n - lo + 1) * ys, Math.max(2, x.d * xs - 1), Math.max(2, ys - 1));
    }
    g.globalAlpha = 1;
  }

  // preview: play the riff once on the selected channel
  play() {
    this.stop();
    const S = this.S, ch = S.proj.selected, eng = S.engine, now = eng.ctx.currentTime + 0.05;
    const sec = (t) => (t / PPQ) * (60 / S.proj.bpm);
    const notes = this.notes();
    for (const x of notes) eng.note(ch, x.n, x.v, now + sec(x.t), sec(x.d));
    this.playing = true;
    const len = Math.max(...notes.map((x) => x.t + x.d), 0);
    this.timer = setTimeout(() => { this.playing = false; this.render(); }, sec(len) * 1000 + 300);
    this.render();
  }

  stop() {
    clearTimeout(this.timer);
    if (this.playing) this.S.engine.channels.get(this.S.proj.selected)?.stop?.();
    this.playing = false;
  }

  accept() {
    this.stop();
    const notes = this.notes(STAGES.length - 1 >= this.step ? this.step : STAGES.length - 1);
    const S = this.S, R = S.roll;
    S.edit(() => {
      const l = R.list;
      l.splice(0, l.length);
      R.sel.clear();
      for (const x of notes) { l.push(x); R.sel.add(x); }
      const bars = Math.ceil(Math.max(...notes.map((x) => x.t + x.d)) / barTicks(S.proj));
      const pat = pattern(S.proj);
      if (bars > pat.bars) pat.bars = [1, 2, 4, 8, 16].find((b) => b >= bars) || 16;
    }, true, 'Riff Machine');
    S.status(`Riff Machine: ${notes.length}개 노트를 넣었어요.`);
    this.close();
  }
}

const HELP = {
  progression: '스케일 안에서 코드 진행을 골라요. 프로젝트 스케일이 없으면 C 마이너를 써요.',
  arpeggiate: '코드를 한 음씩 펼쳐요. ‘끔’이면 화음을 그대로 둬요.',
  groove: '리듬 패턴에 맞춰 노트를 남겨요. 노트는 다음 박까지 이어져요.',
  mirror: '뒤집기, 옥타브 이동, 이웃 음으로 바꾸기로 변화를 줘요.',
  levels: '벨로시티와 길이를 다듬어요. 마음에 들면 ‘적용’을 누르세요.',
};
