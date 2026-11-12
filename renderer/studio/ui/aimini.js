// While the AI window (separation, MIDI conversion, engine install) is closed but still working, a
// small progress card sits in the Studio's bottom-right corner: what is running, a bar, the percent
// and the time left. Clicking it opens the window again. When the work ends with the window still
// closed, the card says so (done or failed) until it is clicked or dismissed.
import { h } from './dom.js';
import { t, tdyn } from '../../i18n/i18n.js';

const KIND = {
  stems: () => t('음원 분리 중'), setup: () => t('분석 엔진 설치 중'), analyse: () => t('MIDI 변환 · 악기 찾는 중'),
  build: () => t('트랙을 만드는 중'), decode: () => t('파일을 읽는 중'),
};

export class AiMini {
  constructor(studio) {
    this.S = studio;
    this.was = null;   // what was running the last time we looked
    this.ended = null; // { ok } once a run ended with the window closed
    this.el = h('button', { class: 'ai-mini', hidden: true, type: 'button', onclick: (e) => { if (e.target.closest('.ai-mini-x')) return; this.open(); } },
      h('div', { class: 'ai-mini-top' }, this.titleEl = h('b'), this.pctEl = h('em'),
        this.xEl = h('span', { class: 'ai-mini-x', role: 'button', title: t('닫기'), onclick: () => { this.ended = null; this.el.hidden = true; } }, '×')),
      h('div', { class: 'ai-mini-bar' }, this.barEl = h('i')),
      this.subEl = h('small'));
    studio.el.append(this.el);
    this.timer = setInterval(() => this.paint(), 250);
  }

  open() { this.ended = null; this.el.hidden = true; this.S.aiSheet.show(); }

  paint() {
    const sh = this.S._ai; // created on first use; nothing to show before that
    window.__melofiAiBusy = sh?.busy || null; // the updater asks every window before restarting
    if (!sh || this.S.el.hidden) { this.el.hidden = true; return; }
    const closed = sh.el.hidden;
    if (sh.busy) {
      this.was = sh.busy; this.ended = null;
      if (!closed) { this.el.hidden = true; return; }
      const p = Math.max(0, Math.min(1, sh.progress || 0)), pc = Math.round(p * 100);
      const bar = ['stems', 'setup', 'analyse'].includes(sh.busy);
      this.el.classList.remove('done', 'err');
      this.el.classList.toggle('indet', !bar);
      this.titleEl.textContent = (KIND[sh.busy] || KIND.stems)();
      this.pctEl.textContent = bar ? `${pc}%` : '';
      this.barEl.style.width = bar ? `${pc}%` : '';
      const sec = sh.t0 ? (Date.now() - sh.t0) / 1000 : 0, mmss = (x) => `${Math.floor(x / 60)}:${String(Math.round(x % 60)).padStart(2, '0')}`;
      // the same recent-pace estimate as the window's (ai.js paintBars keeps the samples)
      const hist = sh.etaHist || [], h0 = hist[0], now = Date.now();
      const rate = h0 && now - h0.t > 15000 && p > h0.p ? (p - h0.p) / ((now - h0.t) / 1000) : 0;
      const own = /남은 시간|left/i.test(tdyn(sh.stemLabel || '')); // the stage says its own time left
      const left = bar && rate > 0 && p < 0.995 && !own ? t('약 {left} 남음', { left: mmss((1 - p) / rate) }) : '';
      this.subEl.textContent = [tdyn(sh.stemLabel || ''), left].filter(Boolean).join(' · ');
      this.el.title = t('눌러서 AI 창 열기');
      this.xEl.hidden = true;
      this.el.hidden = false;
      return;
    }
    // just finished while closed: say how it went
    if (this.was && closed) this.ended = { ok: !sh.error, kind: this.was };
    this.was = null;
    if (!this.ended || !closed) { this.el.hidden = true; if (!closed) this.ended = null; return; }
    this.el.classList.remove('indet');
    this.el.classList.toggle('done', this.ended.ok);
    this.el.classList.toggle('err', !this.ended.ok);
    this.titleEl.textContent = this.ended.ok ? t('AI 작업이 끝났어요') : t('AI 작업이 멈췄어요');
    this.pctEl.textContent = '';
    this.barEl.style.width = '100%';
    this.subEl.textContent = this.ended.ok ? t('눌러서 결과 보기') : tdyn(sh.error || '').split('\n')[0].slice(0, 80) || t('눌러서 자세히 보기');
    this.xEl.hidden = false;
    this.el.hidden = false;
  }
}
