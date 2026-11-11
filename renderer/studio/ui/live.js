// Live (performance) view: a grid of tracks × patterns. Click a cell to start that pattern on
// that track at the next bar; click it again to stop. What you played can be written into the
// playlist afterwards.
import { h } from './dom.js';
import { barTicks, uid, newTrack } from '../model.js';
import { t } from '../../i18n/i18n.js';

export class Live {
  constructor(studio, el) {
    this.S = studio;
    this.el = el;
    this.pending = null;
    this.log = []; // [{ bar, active }] while playing live
  }

  get proj() { return this.S.proj; }

  ensure() { this.proj.live ||= { active: {} }; return this.proj.live; }

  toggle(track, patId) {
    const live = this.ensure();
    const next = { ...(this.pending || live.active) };
    if (next[track] === patId) delete next[track]; else next[track] = patId;
    this.pending = next;
    const T = this.S.transport;
    if (!T.playing || this.proj.mode !== 'live') { this.apply(); this.S.setMode('live'); if (!T.playing) T.play(); return; }
    // switch on the next bar line
    clearTimeout(this.timer);
    const bt = barTicks(this.proj), now = T.now(), next0 = Math.ceil((now + 1) / bt) * bt;
    const ms = Math.max(0, (T.secAt(next0) - T.secAt(now)) * 1000 - 40);
    this.timer = setTimeout(() => this.apply(), ms);
    this.render();
  }

  apply() {
    if (!this.pending) return;
    const live = this.ensure();
    live.active = this.pending;
    this.pending = null;
    const T = this.S.transport;
    if (!this.log.length) this.t0 = performance.now();
    const secPerBar = (60 / this.proj.bpm) * this.proj.sig[0] * (4 / this.proj.sig[1]);
    const bar = Math.round((performance.now() - this.t0) / 1000 / secPerBar);
    if (this.log.length && this.log[this.log.length - 1].bar === bar) this.log.pop();
    this.log.push({ bar, active: { ...live.active } });
    if (T.playing) T.refresh();
    this.render();
  }

  stopAll() { this.pending = {}; this.apply(); }

  // what was played becomes clips at the end of the playlist
  toPlaylist() {
    const S = this.S, proj = this.proj;
    if (!this.log.length) return;
    const start = proj.playlist.clips.reduce((m, c) => Math.max(m, c.start + c.len), 0);
    S.edit(() => {
      this.log.forEach((e, i) => {
        const len = Math.max(1, (this.log[i + 1]?.bar ?? e.bar + 4) - e.bar);
        for (const [track, pid] of Object.entries(e.active)) {
          while (proj.playlist.tracks.length <= +track) proj.playlist.tracks.push(newTrack(proj.playlist.tracks.length));
          proj.playlist.clips.push({ id: uid('k'), pattern: pid, track: +track, start: start + e.bar, len });
        }
      });
    });
    this.log = [];
    S.setMode('song');
    S.setTab('playlist');
  }

  render() {
    const S = this.S, proj = this.proj, live = this.ensure(), pend = this.pending;
    const tracks = proj.playlist.tracks.slice(0, Math.max(4, Math.min(proj.playlist.tracks.length, 8)));
    const grid = h('table', { class: 'lv-grid' },
      h('tr', {}, h('th', {}, ''), ...proj.patterns.map((p) => h('th', { style: `--c:${p.color}` }, p.name))),
      ...tracks.map((tr, ti) => h('tr', {}, h('th', { class: 'tn' }, tr.name),
        ...proj.patterns.map((p) => {
          const on = live.active[ti] === p.id, q = pend && (pend[ti] === p.id) !== on;
          return h('td', {}, h('button', { class: `lv-cell${on ? ' on' : ''}${q ? ' q' : ''}`, style: `--c:${p.color}`, onclick: () => this.toggle(ti, p.id) }, on ? '■' : '▶'));
        }))));
    this.el.replaceChildren(
      h('div', { class: 'lv-bar' },
        h('b', {}, t('라이브')), h('span', { class: 'hint' }, t('칸을 누르면 다음 마디부터 그 트랙에서 패턴이 반복됩니다. 깜빡이는 칸은 대기 중입니다.')),
        h('span', { class: 'sp' }),
        h('button', { class: 'btn sm', onclick: () => this.stopAll() }, t('모두 멈춤')),
        h('button', { class: 'btn sm', disabled: !this.log.length, title: t('라이브로 연주한 순서를 플레이리스트 끝에 클립으로 남깁니다'), onclick: () => this.toPlaylist() }, t('플레이리스트로 옮기기'))),
      grid);
    void S;
  }
}
