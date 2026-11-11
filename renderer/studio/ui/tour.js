// Guided tour: one thing at a time. Each lesson opens with a card saying what it covers; each step
// shows a short animation of the action (tourfx.js), lights up the part of the screen it is about,
// points at it with a ghost cursor and, where it makes sense, waits for you to do it — then moves on.
import { h } from './dom.js';
import { CHAPTERS } from './lessons.js';
import { Demo } from './tourfx.js';
import { t } from '../../i18n/i18n.js';

export { CHAPTERS };

export class Tour {
  constructor(studio) {
    this.S = studio;
    this.ch = null;
    this.i = 0;
    this.spot = h('div', { class: 'tour-spot', hidden: true });
    this.hand = h('div', { class: 'tour-hand', hidden: true });
    this.tip = h('div', { class: 'tour-tip', hidden: true, role: 'dialog', 'aria-live': 'polite' });
    this.demo = new Demo();
    document.body.append(this.spot, this.hand, this.tip);
    window.addEventListener('resize', () => this.place());
    this.tip.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.stop(); });
  }

  get active() { return !!this.ch; }

  // a lesson starts with its intro card (i = -1)
  start(id = 'workspace') {
    this.ch = CHAPTERS.find((c) => c.id === id) || CHAPTERS[0];
    this.go(-1);
  }

  stop() {
    this.ch = null;
    clearInterval(this.poll); clearTimeout(this.auto);
    this.demo.stop();
    this.spot.hidden = this.tip.hidden = this.hand.hidden = true;
    this.S.app.settings.set({ studioTourSeen: true });
  }

  go(i) {
    clearInterval(this.poll);
    clearTimeout(this.auto);
    this.i = i;
    if (i < 0) { this.render(); this.poll = setInterval(() => this.place(), 400); return; }
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
        this.auto = setTimeout(() => this.go(this.i + 1), 1100);
      }
    }, 250);
    else this.poll = setInterval(() => this.place(), 400);
  }

  render() {
    const ch = this.ch, n = ch.steps.length, num = CHAPTERS.indexOf(ch) + 1;
    const intro = this.i < 0;
    const st = intro ? null : ch.steps[this.i];
    const next = st?.next ? CHAPTERS.find((c) => c.id === st.next) : null;
    const prog = intro ? 0 : (this.i + (this.done || !st.wait ? 1 : 0.5)) / n;
    const head = h('div', { class: 'tt-head' },
      h('span', { class: 'tt-num' }, t('{num}강', { num })),
      h('span', { class: 'tt-ch' }, t(ch.name)),
      h('span', { class: 'tt-count' }, intro ? t('{n}단계', { n }) : `${this.i + 1} / ${n}`),
      h('button', { class: 'x', title: t('튜토리얼 끝내기 (Esc)'), 'aria-label': t('튜토리얼 끝내기'), onclick: () => this.stop() }));
    const bar = h('div', { class: 'tt-prog' }, h('i', { style: `width:${Math.round(prog * 100)}%` }));
    const dots = h('div', { class: 'tt-dots' }, ...ch.steps.map((_, k) => h('i', { class: k < this.i || (k === this.i && this.done) ? 'done' : k === this.i ? 'now' : '' })));
    let body;
    if (intro) {
      body = [
        // the lesson's most telling animation previews it
        this.demo.show(num === 1 ? { kind: 'welcome' } : ch.steps.find((s) => s.demo && !['done', 'key'].includes(s.demo.kind))?.demo || { kind: 'welcome' }),
        h('b', { class: 'tt-title' }, t(ch.name)),
        h('p', {}, t(ch.goal)),
        h('ol', { class: 'tt-plan' }, ...ch.steps.filter((s) => !s.next && s.title && !/끝|마쳤어요|환영/.test(s.title)).map((s) => h('li', {}, t(s.title)))),
        h('div', { class: 'row' },
          num > 1 ? h('button', { class: 'btn sm ghost', onclick: () => this.start(CHAPTERS[num - 2].id) }, t('이전 강의')) : null,
          h('span', { class: 'sp' }),
          h('button', { class: 'btn sm primary', onclick: () => this.go(0) }, t('시작'))),
      ];
    } else {
      body = [
        this.demo.show(st.demo),
        h('b', { class: 'tt-title' }, t(st.title)),
        h('p', {}, t(st.body)),
        st.wait ? h('div', { class: `tt-do${this.done ? ' ok' : ''}` }, h('i'), this.done ? t('잘했어요! 다음으로 넘어가요.') : t('직접 해 보세요. 하면 자동으로 넘어가요.')) : null,
        h('div', { class: 'row' },
          h('button', { class: 'btn sm ghost', onclick: () => this.go(this.i - 1) }, this.i > 0 ? t('이전') : t('처음으로')),
          h('span', { class: 'sp' }),
          next ? h('button', { class: 'btn sm primary', onclick: () => this.start(next.id) }, t('다음 강의: {name}', { name: t(next.name) }))
            : h('button', { class: `btn sm ${st.wait && !this.done ? 'ghost' : 'primary'}`, onclick: () => this.go(this.i + 1) }, st.wait && !this.done ? t('건너뛰기') : this.i === n - 1 ? t('끝내기') : t('다음'))),
      ];
    }
    // replaceChildren() would print a null child as the text "null": drop empty parts first
    this.tip.replaceChildren(...[head, bar, ...body, intro ? null : dots].filter(Boolean));
    this.tip.hidden = false;
    // replay the entrance animation for every new card
    this.tip.classList.remove('enter'); void this.tip.offsetWidth; this.tip.classList.add('enter');
    this.place();
  }

  place() {
    if (!this.ch) return;
    const st = this.i >= 0 ? this.ch.steps[this.i] : null;
    const el = st?.sel?.(this.S);
    const tip = this.tip, W = innerWidth, H = innerHeight;
    if (!el || !el.getBoundingClientRect().width) {
      this.spot.classList.remove('on'); this.spot.hidden = true; this.hand.hidden = true;
      tip.classList.add('center');
      tip.style.left = `${(W - tip.offsetWidth) / 2}px`; tip.style.top = `${Math.max(16, (H - tip.offsetHeight) / 2 - 20)}px`;
      return;
    }
    tip.classList.remove('center');
    const r = el.getBoundingClientRect(), pad = 6;
    Object.assign(this.spot.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
    this.spot.hidden = false; this.spot.classList.add('on');
    // the ghost cursor points at what to do while the step waits for you
    this.hand.hidden = !(st.wait && !this.done);
    if (!this.hand.hidden) Object.assign(this.hand.style, { left: `${r.left + Math.min(r.width / 2, 60)}px`, top: `${r.top + Math.min(r.height / 2, 30)}px` });
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let x = r.right + 18, y = r.top;
    if (x + tw > W - 10) { x = r.left - tw - 18; }
    if (x < 10) { x = Math.min(W - tw - 10, Math.max(10, r.left)); y = r.bottom + 18; if (y + th > H - 10) y = r.top - th - 18; }
    tip.style.left = `${Math.max(10, x)}px`;
    tip.style.top = `${Math.max(10, Math.min(H - th - 10, y))}px`;
  }
}
