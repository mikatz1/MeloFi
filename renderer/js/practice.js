// Practice: the score plays itself except the hand you chose, which comes down the screen for you
// to play. Every note is judged on timing (and pitch, unless "rhythm only"), rhythm-game style.
import { T } from './strings.js';

// timing windows in real seconds (the score's own time is divided by the playback rate)
const WINDOWS = [['perfect', 0.05, 300], ['great', 0.1, 200], ['good', 0.15, 100]];
const MISS = 0.15;
const CHORD = 0.035; // notes this close together are one press in rhythm-only mode
const GRADES = [['S', 95], ['A', 90], ['B', 80], ['C', 70], ['D', 60], ['F', 0]];

export function gradeOf(acc) { return GRADES.find(([, min]) => acc >= min)[0]; }

export class Practice {
  constructor(app) {
    this.app = app;
    this.active = false;
    this.hud = document.getElementById('hud');
    this.result = document.getElementById('result');
    this.result.querySelector('[data-act=again]').addEventListener('click', () => { this.hideResult(); this.start(); });
    this.result.querySelector('[data-act=close]').addEventListener('click', () => this.hideResult());
  }

  get P() { return this.app.player; }

  handOf(line, n) {
    let hand = this.P.hands?.get(line);
    if (hand === 'split') hand = n >= 60 ? 'rh' : 'lh';
    return hand;
  }

  // is this score note one the player plays themselves?
  isTarget(line, n) {
    if (!this.active || !this.P.enabled.has(line)) return false;
    const want = this.app.settings.get('practiceHand');
    return want === 'both' || this.handOf(line, n) === want;
  }

  async start() {
    const P = this.P;
    if (!P.song) return;
    P.pause();
    await this.app.intro(); // only the first time for this score
    this.hideResult();
    this.active = true;
    this.targets = [];
    for (const l of P.song.lines) for (const n of l.notes) {
      if (n.n >= 21 && n.n <= 108 && this.isTarget(l.id, n.n)) this.targets.push({ t: n.t, d: n.d, n: n.n, v: n.v, judged: null });
    }
    this.targets.sort((a, b) => a.t - b.t || a.n - b.n);
    if (!this.targets.length) { this.active = false; this.app.ui.toast(T.practice.noNotes, { err: true }); return; }
    this.next = 0; // first target not yet judged (by time)
    this.reached = 0;
    this.counts = { perfect: 0, great: 0, good: 0, miss: 0 };
    this.points = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.last = null;
    this.app.updateFall();
    this.renderHud();
    this.hud.hidden = false;
    P.seek(0);
    P.play();
    this.app.ui.updateTransport?.();
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    this.hud.hidden = true;
    this.app.updateFall();
    this.app.ui.updateTransport?.();
  }

  // A key went down. Returns the notes to sound: null = the key's own note (pitch mode),
  // an array = the score's notes for that press (rhythm only; empty = nothing to hit).
  press(note) {
    if (!this.active || !this.P.playing) return null;
    const now = this.P.now(), rate = this.P.rate;
    const rhythm = this.app.settings.get('practiceJudge') === 'rhythm';
    let best = -1, bestErr = Infinity;
    for (let i = this.next; i < this.targets.length; i++) {
      const x = this.targets[i];
      const err = (x.t - now) / rate;
      if (err > MISS) break;
      if (x.judged || err < -MISS) continue;
      if (!rhythm && x.n !== note) continue;
      if (Math.abs(err) < Math.abs(bestErr)) { best = i; bestErr = err; }
      if (rhythm) break; // earliest open note wins
    }
    if (best < 0) return rhythm ? [] : null;
    const group = [best];
    if (rhythm) for (let i = best + 1; i < this.targets.length && this.targets[i].t - this.targets[best].t <= CHORD; i++) if (!this.targets[i].judged) group.push(i);
    const [name, , pts] = WINDOWS.find(([, w]) => Math.abs(bestErr) <= w) || WINDOWS[2];
    for (const i of group) this.judge(this.targets[i], name, pts);
    this.flash(name, bestErr);
    return rhythm ? group.map((i) => ({ n: this.targets[i].n, v: this.targets[i].v })) : null;
  }

  judge(x, name, pts) {
    x.judged = name;
    this.counts[name]++;
    this.points += pts;
    if (name === 'miss') this.combo = 0;
    else { this.combo++; this.maxCombo = Math.max(this.maxCombo, this.combo); }
  }

  // every frame: notes that went by unplayed are misses; the end of the piece shows the result
  tick() {
    if (!this.active) return;
    const P = this.P;
    if (P.playing) {
      const now = P.now();
      this.reached = now;
      let missed = false;
      while (this.next < this.targets.length) {
        const x = this.targets[this.next];
        if (x.judged) { this.next++; continue; }
        if ((now - x.t) / P.rate > MISS) { this.judge(x, 'miss', 0); this.next++; missed = true; continue; }
        break;
      }
      if (missed) this.flash('miss', 0);
      this.renderHud();
    } else if (P.pos === 0 || P.pos >= P.duration - 0.05) {
      // stopped, or played to the end: only what was actually reached counts
      const upTo = P.pos >= P.duration - 0.05 ? P.duration : this.reached || 0;
      for (const x of this.targets) if (!x.judged && x.t <= upTo - MISS) this.judge(x, 'miss', 0);
      if (this.targets.some((x) => x.judged)) this.finish();
      else this.stop();
    }
  }

  accuracy() {
    const judged = this.counts.perfect + this.counts.great + this.counts.good + this.counts.miss;
    return judged ? (this.points / (judged * 300)) * 100 : 100;
  }

  flash(name, err) {
    this.last = { name, err, at: performance.now() };
  }

  renderHud() {
    const acc = this.accuracy();
    const h = this.hud;
    h.querySelector('.acc').textContent = `${acc.toFixed(1)}%`;
    h.querySelector('.grade').textContent = gradeOf(acc);
    h.querySelector('.combo').textContent = this.combo ? `${this.combo} ${T.practice.combo}` : '';
    const j = h.querySelector('.judge');
    if (this.last && performance.now() - this.last.at < 700) {
      j.textContent = T.practice[this.last.name] + (this.last.name !== 'miss' && Math.abs(this.last.err) > 0.012 ? (this.last.err > 0 ? ` ${T.practice.early}` : ` ${T.practice.late}`) : '');
      j.dataset.kind = this.last.name;
      j.style.opacity = String(1 - Math.max(0, performance.now() - this.last.at - 350) / 350);
    } else j.textContent = '';
  }

  finish() {
    const acc = this.accuracy();
    this.stop();
    const r = this.result;
    r.querySelector('.big').textContent = gradeOf(acc);
    r.querySelector('.big').dataset.grade = gradeOf(acc);
    r.querySelector('.acc').textContent = `${acc.toFixed(2)}%`;
    r.querySelector('.score').textContent = this.points.toLocaleString();
    r.querySelector('.combo').textContent = String(this.maxCombo);
    for (const k of ['perfect', 'great', 'good', 'miss']) r.querySelector(`.n-${k}`).textContent = String(this.counts[k]);
    r.hidden = false;
  }

  hideResult() { this.result.hidden = true; }
}
