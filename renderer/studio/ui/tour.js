// Guided tour: one thing at a time. Each step lights up a part of the screen, says what it is and,
// where it makes sense, asks you to try it — the tour moves on by itself once you have. The
// lessons (lessons.js) follow Image-Line's official "Learn FL Studio" course.
import { h } from './dom.js';
import { CHAPTERS } from './lessons.js';

export { CHAPTERS };

export class Tour {
  constructor(studio) {
    this.S = studio;
    this.ch = null;
    this.i = 0;
    this.spot = h('div', { class: 'tour-spot', hidden: true });
    this.tip = h('div', { class: 'tour-tip', hidden: true });
    document.body.append(this.spot, this.tip);
    window.addEventListener('resize', () => this.place());
  }

  get active() { return !!this.ch; }

  start(id = 'workspace') {
    this.ch = CHAPTERS.find((c) => c.id === id) || CHAPTERS[0];
    this.go(0);
  }

  stop() {
    this.ch = null;
    clearInterval(this.poll);
    this.spot.hidden = this.tip.hidden = true;
    this.S.app.settings.set({ studioTourSeen: true });
  }

  go(i) {
    clearInterval(this.poll);
    clearTimeout(this.auto);
    this.i = i;
    const st = this.ch.steps[i];
    if (!st) return this.stop();
    st.prep?.(this.S);
    this.done = false;
    this.render();
    // wait for the user to do it, then move on
    if (st.wait) this.poll = setInterval(() => {
      if (!this.ch || this.done) return;
      this.place();
      if (st.wait(this.S)) {
        this.done = true;
        clearInterval(this.poll);
        this.render();
        this.auto = setTimeout(() => this.go(this.i + 1), 900);
      }
    }, 250);
    else this.poll = setInterval(() => this.place(), 400);
  }

  render() {
    const st = this.ch.steps[this.i], n = this.ch.steps.length;
    const next = st.next ? CHAPTERS.find((c) => c.id === st.next) : null;
    this.tip.replaceChildren(
      h('div', { class: 'tt-head' }, h('small', {}, `${CHAPTERS.indexOf(this.ch) + 1}강 ${this.ch.name} · ${this.i + 1} / ${n}`), h('button', { class: 'x', title: '투어 끝내기', onclick: () => this.stop() })),
      h('b', {}, st.title),
      h('p', {}, st.body),
      st.wait ? h('p', { class: `tt-do${this.done ? ' ok' : ''}` }, this.done ? '잘했어요!' : '직접 해 보세요. 하면 자동으로 넘어가요.') : null,
      h('div', { class: 'row' },
        this.i > 0 ? h('button', { class: 'btn sm ghost', onclick: () => this.go(this.i - 1) }, '이전') : null,
        h('span', { class: 'sp' }),
        next ? h('button', { class: 'btn sm primary', onclick: () => this.start(next.id) }, `다음 장: ${next.name}`)
          : h('button', { class: `btn sm ${st.wait && !this.done ? 'ghost' : 'primary'}`, onclick: () => this.go(this.i + 1) }, st.wait && !this.done ? '건너뛰기' : this.i === n - 1 ? '끝내기' : '다음')));
    this.tip.hidden = false;
    this.place();
  }

  place() {
    if (!this.ch) return;
    const st = this.ch.steps[this.i];
    const el = st?.sel?.(this.S);
    const tip = this.tip, W = innerWidth, H = innerHeight;
    if (!el || !el.getBoundingClientRect().width) {
      this.spot.hidden = true;
      tip.classList.add('center');
      tip.style.left = `${(W - tip.offsetWidth) / 2}px`; tip.style.top = `${H * 0.28}px`;
      return;
    }
    tip.classList.remove('center');
    const r = el.getBoundingClientRect(), pad = 6;
    Object.assign(this.spot.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
    this.spot.hidden = false;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let x = r.right + 14, y = r.top;
    if (x + tw > W - 10) { x = r.left - tw - 14; }
    if (x < 10) { x = Math.min(W - tw - 10, Math.max(10, r.left)); y = r.bottom + 14; if (y + th > H - 10) y = r.top - th - 14; }
    tip.style.left = `${Math.max(10, x)}px`;
    tip.style.top = `${Math.max(10, Math.min(H - th - 10, y))}px`;
  }
}
