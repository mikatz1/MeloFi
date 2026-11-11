// Plays a loaded score through the same engine/visualizer as live playing.
// Audio is scheduled on the AudioContext clock (sample-accurate in the sampler);
// visuals and recording events follow on timers.

const LOOKAHEAD = 0.18; // seconds of audio scheduled ahead

// Which line is which hand: from the name when it says so, otherwise the higher of two
// piano lines is the right hand. Returns Map<lineId, 'rh' | 'lh' | null>.
function handsOf(song) {
  const out = new Map();
  const avg = (l) => l.notes.reduce((s, n) => s + n.n, 0) / Math.max(1, l.notes.length);
  for (const l of song.lines) {
    if (!l.piano) continue;
    if (/오른손|right|\brh\b|treble/i.test(l.name)) out.set(l.id, 'rh');
    else if (/왼손|left|\blh\b|bass/i.test(l.name)) out.set(l.id, 'lh');
  }
  const piano = song.lines.filter((l) => l.piano && !out.has(l.id));
  if (piano.length === 2) {
    const [a, b] = piano.sort((x, y) => avg(y) - avg(x));
    out.set(a.id, 'rh'); out.set(b.id, 'lh');
  } else if (piano.length === 1 && !out.size) {
    // a single piano line: split it at middle C
    out.set(piano[0].id, 'split');
  }
  return out;
}

export class ScorePlayer {
  constructor(app) {
    this.app = app;
    this.song = null;
    this.events = [];
    this.pedals = [];
    this.enabled = new Set();
    this.playing = false;
    this.pos = 0;
    this.rate = 1;
    this.timers = new Set();
    this.onChange = () => {};
  }

  get ctx() { return this.app.engine.ctx; }
  get duration() { return this.song?.duration ?? 0; }

  load(song) {
    this.stop();
    this.song = song;
    this.events = song.lines.flatMap((l) => l.notes.map((n) => ({ ...n, line: l.id }))).sort((a, b) => a.t - b.t);
    this.pedals = song.pedals || [];
    // every part plays on its own instrument (app.prepareParts), so all of them are on, except
    // sound effects that have nothing to play them
    // (a part waiting for its instrument to download is on, and silent until it arrives)
    this.enabled = new Set(song.lines.filter((l) => { const a = this.app.scoreParts?.get(l.id); return !(a && a.inst === null && !a.wanted); }).map((l) => l.id));
    this.hands = handsOf(song);
    this.pos = 0;
    this.onChange();
  }

  unload() {
    this.stop();
    this.song = null;
    this.events = [];
    this.onChange();
  }

  now() {
    if (!this.playing) return this.pos;
    return Math.max(0, this.startPos + (this.ctx.currentTime - this.startCtx) * this.rate);
  }

  play() {
    if (!this.song || this.playing) return;
    if (this.pos >= this.duration) this.pos = 0;
    if (this.ctx.state !== 'running') this.ctx.resume();
    this.startCtx = this.ctx.currentTime + 0.06;
    this.startPos = this.pos;
    this.idx = this.lower(this.events, this.pos);
    this.pidx = this.lower(this.pedals, this.pos);
    // pedal state at the seek point
    const before = this.pedals.filter((p) => p.t < this.pos);
    this.app.scorePedal(before.length ? before[before.length - 1].on : false, 0);
    this.playing = true;
    this.timer = setInterval(() => this.pump(), 25);
    this.pump();
    this.onChange();
  }

  pause() {
    if (!this.playing) return;
    this.pos = this.now();
    this.playing = false;
    clearInterval(this.timer);
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.app.engine.cancelScheduled();
    this.app.stopScore();
    this.onChange();
  }

  stop() {
    this.pause();
    this.pos = 0;
    this.app.stage?.clearBars?.(); // back to the start: nothing from the last run stays on screen
    this.onChange();
  }

  toggle() { if (this.playing) this.pause(); else this.play(); }

  seek(t) {
    const was = this.playing;
    this.pause();
    this.pos = Math.max(0, Math.min(this.duration, t));
    if (was) this.play(); else this.onChange();
  }

  setRate(r) {
    const was = this.playing;
    this.pause();
    this.rate = r;
    if (was) this.play(); else this.onChange();
  }

  setLine(id, on) {
    if (on) this.enabled.add(id); else this.enabled.delete(id);
    this.app.updateFall?.();
    if (this.playing) { const p = this.now(); this.pause(); this.pos = p; this.play(); } else this.onChange();
  }

  lower(list, t) {
    let lo = 0, hi = list.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (list[m].t < t) lo = m + 1; else hi = m; }
    return lo;
  }

  later(fn, ms) {
    const h = setTimeout(() => { this.timers.delete(h); fn(); }, Math.max(0, ms));
    this.timers.add(h);
  }

  pump() {
    if (!this.playing) return;
    const ctxNow = this.ctx.currentTime;
    const horizon = this.startPos + (ctxNow + LOOKAHEAD - this.startCtx) * this.rate;
    const at = (t) => this.startCtx + (t - this.startPos) / this.rate;
    while (this.idx < this.events.length && this.events[this.idx].t < horizon) {
      const e = this.events[this.idx++];
      if (!this.enabled.has(e.line)) continue;
      this.app.scoreNote(e.n, e.v, at(e.t), e.d / this.rate, this, e.line);
    }
    while (this.pidx < this.pedals.length && this.pedals[this.pidx].t < horizon) {
      const p = this.pedals[this.pidx++];
      this.app.scorePedal(p.on, (at(p.t) - ctxNow) * 1000, this);
    }
    if (this.now() > this.duration + 1.5) { this.stop(); return; }
    this.onChange();
  }
}
