// Piano roll for the selected channel in the current pattern (canvas).
//   tools: draw (click / drag length) · chord (one click, a whole chord) · slide (mark glide notes)
//   move: drag a note · resize: drag its right edge · erase: right-click / right-drag / double-click
//   box select: Ctrl+drag · Shift+click: add to selection
//   keys: Delete, Ctrl+A, Ctrl+C / Ctrl+V, Ctrl+D, ↑↓ (Shift: octave), ←→, Q (quantize)
//   view: wheel scrolls pitch, Shift+wheel scrolls time, Ctrl+wheel zooms time, Alt+wheel zooms pitch
//   lane at the bottom: velocity / pan / fine pitch of each note
//   scale: rows outside the scale are darker; with "lock" new and moved notes stay in the scale
import { clamp, noteLabel, isBlackKey } from './dom.js';
import { PPQ, STEP, barTicks, pattern, channel, notesOf, patternTicks, inScale, snapToScale, SCALES } from '../model.js';
import { kitNames } from '../../js/drums.js';

const KEYS_W = 54, RULER_H = 20, LANE_H = 64;

export const CHORDS = {
  auto: { name: '스케일 화음 (자동)', iv: null },
  maj: { name: '메이저', iv: [0, 4, 7] },
  min: { name: '마이너', iv: [0, 3, 7] },
  '7': { name: '도미넌트 7', iv: [0, 4, 7, 10] },
  maj7: { name: '메이저 7', iv: [0, 4, 7, 11] },
  m7: { name: '마이너 7', iv: [0, 3, 7, 10] },
  sus2: { name: 'sus2', iv: [0, 2, 7] },
  sus4: { name: 'sus4', iv: [0, 5, 7] },
  add9: { name: 'add9', iv: [0, 4, 7, 14] },
  dim: { name: '디미니시', iv: [0, 3, 6] },
  power: { name: '파워 코드', iv: [0, 7, 12] },
};
export const LANES = { v: '벨로시티', pan: '팬', fine: '파인 피치' };

export class Roll {
  constructor(studio, canvas) {
    this.S = studio;
    this.c = canvas;
    this.x = canvas.getContext('2d');
    this.pxPerTick = 0.6;   // zoom (CSS px)
    this.rowH = 14;
    this.top = 84;          // highest visible note
    this.scrollT = 0;       // first visible tick
    this.sel = new Set();   // selected note objects
    this.lastLen = STEP * 2;
    this.clip = [];
    this.drag = null;
    this.tool = 'draw';     // FL tools: draw (P) | paint (B) | delete (D) | mute (T) | slice (C) | select (E) | zoom (Z) | slide (S) | porta (O) | chord (stamp)
    this.ghosts = true;     // other channels' notes, faint (Alt+V)
    this.chord = 'auto';
    this.chordSize = 3;     // auto chords: 3 = triad, 4 = seventh
    this.lane = 'v';
    this.lock = false;      // keep notes inside the scale
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    canvas.addEventListener('pointerup', (e) => this.up(e));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    canvas.addEventListener('dblclick', (e) => this.dbl(e));
  }

  get pat() { return pattern(this.S.proj); }
  get ch() { return channel(this.S.proj); }
  get list() { return notesOf(this.pat, this.ch.id); }
  get snap() { return this.S.snap; }
  get kit() { return this.S.isKit(this.ch?.inst || '') && (this.ch.kind || 'inst') === 'inst'; }
  get scale() { return this.kit ? null : this.S.proj.scale; }

  resize() {
    const r = this.c.parentElement.getBoundingClientRect();
    const d = devicePixelRatio || 1;
    this.w = r.width; this.h = r.height;
    this.c.width = Math.round(r.width * d); this.c.height = Math.round(r.height * d);
    this.c.style.width = `${r.width}px`; this.c.style.height = `${r.height}px`;
    this.x.setTransform(d, 0, 0, d, 0, 0);
    this.draw();
  }

  // ---- geometry ----
  get gridH() { return this.h - RULER_H - LANE_H; }
  tToX(t) { return KEYS_W + (t - this.scrollT) * this.pxPerTick; }
  xToT(x) { return this.scrollT + (x - KEYS_W) / this.pxPerTick; }
  nToY(n) { return RULER_H + (this.top - n) * this.rowH; }
  yToN(y) { return Math.floor(this.top - (y - RULER_H) / this.rowH) + 1; }
  snapT(t) { return Math.max(0, Math.floor(t / this.snap) * this.snap); }
  fitN(n) { return this.lock && this.scale ? snapToScale(this.scale, n) : n; }

  noteAt(x, y) {
    const t = this.xToT(x), n = this.yToN(y);
    let hit = null;
    for (const nt of this.list) if (nt.n === n && t >= nt.t && t < nt.t + nt.d) hit = nt;
    return hit;
  }

  // the chord the chord tool would place on root n
  chordNotes(n) {
    const c = CHORDS[this.chord];
    if (c?.iv) return c.iv.map((i) => n + i);
    // diatonic: stack scale thirds (C major / A minor when no scale is set)
    const sc = this.scale || { root: 0, type: 'major' };
    const steps = SCALES[sc.type]?.steps || SCALES.major.steps;
    const pcs = []; for (let o = -1; o < 4; o++) for (const s of steps) pcs.push(sc.root + s + 12 * o);
    const root = snapToScale(sc, n);
    let i = pcs.findIndex((p) => ((p - root) % 12 + 12) % 12 === 0 && p <= root + 11);
    if (i < 0) i = 0;
    const base = root - pcs[i];
    return Array.from({ length: this.chordSize }, (_, k) => pcs[i + 2 * k] + base).filter((x) => x <= 127);
  }

  // ---- drawing ----
  draw() {
    const g = this.x, W = this.w, H = this.h;
    if (!W || !this.ch) return;
    const proj = this.S.proj, pat = this.pat, len = patternTicks(proj, pat), bt = barTicks(proj), beat = (PPQ * 4) / proj.sig[1];
    const sc = this.scale;
    g.fillStyle = '#101115'; g.fillRect(0, 0, W, H);
    const gh = this.gridH;
    g.save();
    g.beginPath(); g.rect(KEYS_W, RULER_H, W - KEYS_W, gh); g.clip();
    // rows (outside the scale: darker; the scale's root: a faint line)
    for (let n = this.top; n > this.top - gh / this.rowH - 1; n--) {
      const y = this.nToY(n);
      const out = sc && !inScale(sc, n);
      g.fillStyle = out ? '#0d0e12' : isBlackKey(n) && !sc ? '#15161b' : '#1a1b21';
      g.fillRect(KEYS_W, y, W - KEYS_W, this.rowH);
      if (sc ? ((n - sc.root) % 12 + 12) % 12 === 0 : n % 12 === 0) { g.fillStyle = sc ? '#3a3420' : '#2a2c34'; g.fillRect(KEYS_W, y + this.rowH - 1, W - KEYS_W, 1); }
    }
    const endX = this.tToX(len);
    if (endX < W) { g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(endX, RULER_H, W - endX, gh); }
    // channel loop length (step sequencer loops shorter than the pattern)
    if (this.ch.loopSteps > 0) { const lx = this.tToX(this.ch.loopSteps * STEP); if (lx < W) { g.fillStyle = 'rgba(224,164,64,0.06)'; g.fillRect(lx, RULER_H, Math.max(0, endX - lx), gh); } }
    const t0 = Math.floor(this.scrollT / this.snap) * this.snap;
    for (let t = t0; this.tToX(t) < W; t += this.snap) {
      const x = Math.round(this.tToX(t)) + 0.5;
      g.fillStyle = t % bt === 0 ? '#3a3c46' : t % beat === 0 ? '#2a2c34' : '#1f2027';
      g.fillRect(x, RULER_H, 1, gh);
    }
    for (const ch of this.ghosts ? proj.channels : []) {
      if (ch.id === proj.selected) continue;
      g.fillStyle = 'rgba(255,255,255,0.07)';
      for (const nt of pat.notes[ch.id] || []) {
        const x = this.tToX(nt.t), y = this.nToY(nt.n);
        if (x > W || x + nt.d * this.pxPerTick < KEYS_W) continue;
        g.fillRect(x, y + 2, nt.d * this.pxPerTick, this.rowH - 4);
      }
    }
    const col = this.ch.color;
    for (const nt of this.list) {
      const x = this.tToX(nt.t), y = this.nToY(nt.n), w = Math.max(3, nt.d * this.pxPerTick - 1);
      if (x > W || x + w < KEYS_W) continue;
      const s = this.sel.has(nt);
      g.globalAlpha = nt.mute ? 0.22 : 0.55 + 0.45 * (nt.v / 127);
      g.fillStyle = s ? '#ffffff' : nt.mute ? '#8b8983' : col;
      g.fillRect(x, y + 1, w, this.rowH - 2);
      g.globalAlpha = 1;
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(x + w - 2, y + 1, 2, this.rowH - 2);
      if (nt.slide) { // slide notes: a ramp marker
        g.fillStyle = s ? '#333' : 'rgba(0,0,0,0.6)';
        g.beginPath(); g.moveTo(x + 2, y + this.rowH - 2); g.lineTo(x + Math.min(w, 12), y + 2); g.lineTo(x + Math.min(w, 12), y + this.rowH - 2); g.fill();
      } else if (nt.porta) { // portamento notes: a glide line into the note
        g.strokeStyle = s ? '#333' : 'rgba(0,0,0,0.6)'; g.lineWidth = 1.5;
        g.beginPath(); g.moveTo(x + 2, y + this.rowH - 3); g.quadraticCurveTo(x + 6, y + 2, x + Math.min(w, 12), y + 3); g.stroke();
      }
      if (w > 26 && this.rowH >= 12) {
        g.fillStyle = s ? '#222' : 'rgba(0,0,0,0.65)';
        g.font = '10px "Segoe UI", sans-serif';
        g.fillText(noteLabel(nt.n), x + (nt.slide || nt.porta ? 14 : 3), y + this.rowH - 4);
      }
    }
    // chord tool: ghost of the chord under the mouse
    if (this.tool === 'chord' && this.hoverPos && !this.drag) {
      const [hx, hy] = this.hoverPos, t = this.snapT(this.xToT(hx));
      g.fillStyle = 'rgba(224,164,64,0.35)';
      for (const n of this.chordNotes(this.fitN(this.yToN(hy)))) g.fillRect(this.tToX(t), this.nToY(n) + 1, this.lastLen * this.pxPerTick, this.rowH - 2);
    }
    if (this.drag?.kind === 'box') {
      const { x0, y0, x1, y1 } = this.drag;
      g.strokeStyle = '#e0a440'; g.setLineDash([4, 3]);
      g.strokeRect(Math.min(x0, x1) + 0.5, Math.min(y0, y1) + 0.5, Math.abs(x1 - x0), Math.abs(y1 - y0));
      g.setLineDash([]);
    }
    const T = this.S.playheadIn(pat);
    if (T != null) { const x = this.tToX(T); g.fillStyle = '#e0a440'; g.fillRect(x, RULER_H, 1.5, gh); }
    g.restore();

    // keyboard
    const names = this.kit ? kitNames(this.S.instInfo(this.ch.inst)) : null;
    for (let n = this.top; n > this.top - gh / this.rowH - 1; n--) {
      const y = this.nToY(n);
      if (y > RULER_H + gh) break;
      const black = isBlackKey(n);
      const lit = this.S.liveHeld?.has(n);
      g.fillStyle = lit ? '#e0a440' : black ? '#22232a' : '#d9d6cf';
      g.fillRect(0, y, KEYS_W - 1, this.rowH - (black ? 0 : 1));
      if (sc && !inScale(sc, n)) { g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(KEYS_W - 8, y, 7, this.rowH - 1); }
      const lab = names ? names[n] : n % 12 === 0 ? noteLabel(n) : null;
      if (lab && this.rowH >= 10) {
        g.fillStyle = black ? '#d9d6cf' : '#2a2a2a';
        g.font = '9.5px "Segoe UI", sans-serif';
        g.fillText(lab, 3, y + this.rowH - 3);
      }
    }
    g.fillStyle = '#101115'; g.fillRect(0, RULER_H + gh, KEYS_W, H);
    g.fillStyle = '#16171c'; g.fillRect(0, 0, W, RULER_H);
    g.fillStyle = '#8b8983'; g.font = '10px "Cascadia Mono", Consolas, monospace';
    for (let b = Math.floor(this.scrollT / bt); this.tToX(b * bt) < W; b++) {
      const x = this.tToX(b * bt);
      if (x >= KEYS_W - 1) { g.fillRect(x, 12, 1, 8); g.fillText(String(b + 1), x + 3, 12); }
    }
    // property lane
    const vy = RULER_H + gh, lane = this.lane;
    g.fillStyle = '#0c0d10'; g.fillRect(KEYS_W, vy, W - KEYS_W, LANE_H);
    g.fillStyle = '#24252b'; g.fillRect(KEYS_W, vy, W - KEYS_W, 1);
    if (lane !== 'v') { g.fillStyle = '#24252b'; g.fillRect(KEYS_W, vy + LANE_H / 2, W - KEYS_W, 1); }
    g.fillStyle = '#5d5c58'; g.font = '9.5px "Segoe UI", sans-serif'; g.fillText(LANES[lane], 6, vy + 14);
    for (const nt of this.list) {
      const x = this.tToX(nt.t);
      if (x < KEYS_W || x > W) continue;
      g.fillStyle = this.sel.has(nt) ? '#ffffff' : col;
      if (lane === 'v') {
        const hh = (nt.v / 127) * (LANE_H - 10);
        g.fillRect(x, vy + LANE_H - 4 - hh, 3, hh); g.fillRect(x - 1, vy + LANE_H - 4 - hh, 5, 2);
      } else {
        const val = lane === 'pan' ? nt.pan || 0 : (nt.fine || 0) / 100;
        const mid = vy + LANE_H / 2, hh = val * (LANE_H / 2 - 6);
        g.fillRect(x, Math.min(mid, mid - hh), 3, Math.max(1, Math.abs(hh))); g.fillRect(x - 1, mid - hh - 1, 5, 2);
      }
    }
  }

  // ---- input ----
  pos(e) { const r = this.c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }

  down(e) {
    const [x, y] = this.pos(e);
    this.c.setPointerCapture(e.pointerId);
    this.c.focus();
    const S = this.S;
    if (y < RULER_H) { if (x > KEYS_W) S.seekPattern(this.snapT(this.xToT(x))); return; }
    if (x < KEYS_W) { const n = this.yToN(y); S.liveOn(n, 100); this.drag = { kind: 'key', n }; return; }
    if (y > RULER_H + this.gridH) { this.drag = { kind: 'lane' }; S.history.push(); this.laneAt(x, y); return; }
    const hit = this.noteAt(x, y);
    const tool = this.tool;
    if (tool === 'zoom') { this.zoomAt(x, e.button === 2 ? 1 / 1.5 : 1.5); return; }
    if (e.button === 2) { S.history.push(); this.drag = { kind: 'erase' }; this.eraseAt(x, y); return; }
    if (e.ctrlKey || tool === 'select') { this.drag = { kind: 'box', x0: x, y0: y, x1: x, y1: y, add: e.shiftKey }; return; }
    if (tool === 'delete') { S.history.push(); this.drag = { kind: 'erase' }; this.eraseAt(x, y); return; }
    if (tool === 'mute') { S.history.push(); this.drag = { kind: 'mute', done: new Set() }; this.muteAt(x, y); return; }
    if (tool === 'slice') { if (hit) this.sliceAt(hit, this.snapT(this.xToT(x))); return; }
    if (this.tool === 'slide' && hit) { S.edit(() => { hit.slide = !hit.slide; if (hit.slide) delete hit.porta; }); return; }
    if (this.tool === 'porta' && hit) { S.edit(() => { hit.porta = !hit.porta; if (hit.porta) delete hit.slide; }); return; }
    if (hit) {
      if (e.shiftKey) { if (this.sel.has(hit)) this.sel.delete(hit); else this.sel.add(hit); this.draw(); return; }
      if (!this.sel.has(hit)) { this.sel.clear(); this.sel.add(hit); }
      S.history.push();
      const edge = x > this.tToX(hit.t + hit.d) - 6;
      const items = [...this.sel].map((nt) => ({ nt, t: nt.t, n: nt.n, d: nt.d }));
      this.drag = { kind: edge ? 'resize' : 'move', x0: x, y0: y, items, hit };
      this.lastLen = hit.d;
      S.preview(this.ch.id, hit.n, hit.v);
      this.draw();
      return;
    }
    S.history.push();
    this.sel.clear();
    const t = this.snapT(this.xToT(x)), n = this.fitN(this.yToN(y));
    if (n < 0 || n > 127) return;
    const ns = this.tool === 'chord' ? this.chordNotes(n) : [n];
    const made = ns.map((k) => ({ t, d: this.lastLen, n: k, v: 100, ...(this.tool === 'slide' ? { slide: true } : this.tool === 'porta' ? { porta: true } : {}) }));
    for (const nt of made) { this.list.push(nt); this.sel.add(nt); S.preview(this.ch.id, nt.n, nt.v); }
    // paint: dragging keeps laying notes of the last length (FL's B tool)
    this.drag = tool === 'paint' ? { kind: 'paint', n, last: t } : { kind: 'create', notes: made, nt: made[0], x0: x };
    this.draw();
  }

  move(e) {
    const [x, y] = this.pos(e);
    const d = this.drag;
    if (!d) {
      const hit = x > KEYS_W && y > RULER_H && y < RULER_H + this.gridH ? this.noteAt(x, y) : null;
      this.c.style.cursor = hit && x > this.tToX(hit.t + hit.d) - 6 ? 'ew-resize' : hit ? 'move' : 'default';
      if (this.tool === 'chord') { this.hoverPos = [x, y]; this.draw(); }
      return;
    }
    if (d.kind === 'key') { const n = this.yToN(y); if (n !== d.n) { this.S.liveOff(d.n); this.S.liveOn(n, 100); d.n = n; } return; }
    if (d.kind === 'lane') { this.laneAt(x, y); return; }
    if (d.kind === 'erase') { this.eraseAt(x, y); return; }
    if (d.kind === 'mute') { this.muteAt(x, y); return; }
    if (d.kind === 'paint') {
      const t = this.snapT(this.xToT(x));
      const n = this.fitN(this.yToN(y));
      if (t >= d.last + this.lastLen || t <= d.last - this.lastLen) {
        if (!this.list.some((o) => o.t === t && o.n === n)) { const nt = { t, d: this.lastLen, n, v: 100 }; this.list.push(nt); this.S.preview(this.ch.id, n, 100); }
        d.last = t;
        this.draw();
      }
      return;
    }
    if (d.kind === 'box') { d.x1 = x; d.y1 = y; this.draw(); return; }
    if (d.kind === 'create') {
      const end = Math.max(d.nt.t + this.snap, this.snapT(this.xToT(x)) + this.snap);
      for (const nt of d.notes) nt.d = end - nt.t;
      this.lastLen = d.nt.d;
      this.draw();
      return;
    }
    const dt = Math.round((this.xToT(x) - this.xToT(d.x0)) / this.snap) * this.snap;
    if (d.kind === 'resize') {
      for (const it of d.items) it.nt.d = Math.max(this.snap, it.d + dt);
      this.lastLen = d.hit.d;
    } else {
      const dn = Math.round((d.y0 - y) / this.rowH);
      const minT = Math.min(...d.items.map((i) => i.t));
      const shift = Math.max(-minT, dt);
      for (const it of d.items) { it.nt.t = it.t + shift; it.nt.n = clamp(this.fitN(it.n + dn), 0, 127); }
      if (dn !== d.lastDn) { d.lastDn = dn; this.S.preview(this.ch.id, d.hit.n, d.hit.v); }
    }
    this.draw();
  }

  up() {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    if (d.kind === 'key') { this.S.liveOff(d.n); return; }
    if (d.kind === 'box') {
      const t0 = this.xToT(Math.min(d.x0, d.x1)), t1 = this.xToT(Math.max(d.x0, d.x1));
      const n1 = this.yToN(Math.min(d.y0, d.y1)), n0 = this.yToN(Math.max(d.y0, d.y1));
      if (!d.add) this.sel.clear();
      for (const nt of this.list) if (nt.t + nt.d > t0 && nt.t < t1 && nt.n >= n0 && nt.n <= n1) this.sel.add(nt);
      this.draw();
      return;
    }
    this.S.changed();
  }

  dbl(e) {
    const [x, y] = this.pos(e);
    const hit = this.noteAt(x, y);
    if (!hit) return;
    this.S.edit(() => { const l = this.list; l.splice(l.indexOf(hit), 1); this.sel.delete(hit); });
  }

  // mute tool: a muted note stays on screen, greyed, and does not play
  muteAt(x, y) {
    const hit = this.noteAt(x, y);
    if (!hit || this.drag?.done?.has(hit)) return;
    this.drag?.done?.add(hit);
    hit.mute = !hit.mute;
    this.draw();
  }

  // slice tool: cut a note in two at a snapped point
  sliceAt(nt, t) {
    if (t <= nt.t || t >= nt.t + nt.d) return;
    this.S.edit(() => { const rest = { ...nt, t, d: nt.t + nt.d - t }; nt.d = t - nt.t; this.list.push(rest); });
  }

  // zoom tool / Ctrl+wheel: horizontal zoom around a point
  zoomAt(x, k) {
    const t = this.xToT(x);
    this.pxPerTick = Math.max(0.08, Math.min(6, this.pxPerTick * k));
    this.scrollT = Math.max(0, t - (x - KEYS_W) / this.pxPerTick);
    this.draw();
  }

  eraseAt(x, y) {
    const hit = this.noteAt(x, y);
    if (!hit) return;
    const l = this.list;
    l.splice(l.indexOf(hit), 1);
    this.sel.delete(hit);
    this.draw();
  }

  laneAt(x, y) {
    const top = RULER_H + this.gridH;
    const targets = this.sel.size ? [...this.sel] : this.list;
    for (const nt of targets) {
      const nx = this.tToX(nt.t);
      if (Math.abs(nx - x) >= Math.max(5, this.snap * this.pxPerTick * 0.5)) continue;
      if (this.lane === 'v') nt.v = clamp(Math.round(((top + LANE_H - 4 - y) / (LANE_H - 10)) * 127), 1, 127);
      else {
        const f = clamp((top + LANE_H / 2 - y) / (LANE_H / 2 - 6), -1, 1);
        if (this.lane === 'pan') nt.pan = Math.abs(f) < 0.04 ? 0 : Math.round(f * 100) / 100;
        else nt.fine = Math.abs(f) < 0.04 ? 0 : Math.round(f * 100);
      }
    }
    this.draw();
  }

  wheel(e) {
    e.preventDefault();
    if (e.ctrlKey) {
      const [x] = this.pos(e);
      const t = this.xToT(x);
      this.pxPerTick = clamp(this.pxPerTick * (e.deltaY < 0 ? 1.15 : 1 / 1.15), 0.08, 6);
      this.scrollT = Math.max(0, t - (x - KEYS_W) / this.pxPerTick);
    } else if (e.altKey) this.rowH = clamp(this.rowH + (e.deltaY < 0 ? 1 : -1), 7, 28);
    else if (e.shiftKey) this.scrollT = Math.max(0, this.scrollT + e.deltaY / this.pxPerTick * 0.6);
    else this.top = clamp(this.top - Math.sign(e.deltaY) * 3, 20, 127);
    this.draw();
  }

  // ---- note tools (act on the selection, or every note when nothing is selected) ----
  targets() { return this.sel.size ? [...this.sel] : [...this.list]; }

  // notes starting together form a chord
  groups(list) {
    const m = new Map();
    for (const n of list) { const k = Math.round(n.t); if (!m.has(k)) m.set(k, []); m.get(k).push(n); }
    return [...m.values()].map((g) => g.sort((a, b) => a.n - b.n));
  }

  arpeggiate({ pattern: mode = 'up', rate = STEP, gate = 0.9, octaves = 1 }) {
    const S = this.S, l = this.list;
    S.edit(() => {
      const made = [];
      for (const chord of this.groups(this.targets())) {
        const t0 = chord[0].t, end = Math.max(...chord.map((n) => n.t + n.d));
        let seq = [];
        for (let o = 0; o < octaves; o++) seq.push(...chord.map((n) => ({ n: n.n + 12 * o, v: n.v })));
        if (mode === 'down') seq.reverse();
        if (mode === 'updown') seq = [...seq, ...seq.slice(1, -1).reverse()];
        for (const n of chord) l.splice(l.indexOf(n), 1);
        let i = 0;
        for (let t = t0; t < end; t += rate, i++) {
          const src = mode === 'random' ? seq[Math.floor(Math.random() * seq.length)] : seq[i % seq.length];
          const nt = { t, d: Math.max(1, Math.round(Math.min(rate, end - t) * gate)), n: clamp(src.n, 0, 127), v: src.v };
          l.push(nt); made.push(nt);
        }
      }
      this.sel = new Set(made);
    });
  }

  strum({ spread = 3, direction = 'down' }) {
    const ticks = Math.round(spread * (PPQ / 48)); // spread in 1/192 notes
    this.S.edit(() => {
      for (const chord of this.groups(this.targets())) {
        const order = direction === 'up' ? chord : [...chord].reverse();
        order.forEach((n, i) => { const sh = i * ticks; n.t += sh; n.d = Math.max(1, n.d - sh); });
      }
    });
  }

  humanize({ timing = 6, velocity = 12 }) {
    const r = (a) => (Math.random() * 2 - 1) * a;
    this.S.edit(() => {
      for (const n of this.targets()) {
        n.t = Math.max(0, Math.round(n.t + r(timing * PPQ / 96)));
        n.v = clamp(Math.round(n.v + r(velocity)), 1, 127);
      }
    });
  }

  quantizeOpts({ grid = this.snap, strength = 1, lengths = false }) {
    this.S.edit(() => {
      for (const n of this.targets()) {
        const q = Math.round(n.t / grid) * grid;
        n.t = Math.max(0, Math.round(n.t + (q - n.t) * strength));
        if (lengths) n.d = Math.max(grid, Math.round(n.d / grid) * grid);
      }
    });
  }

  legato() {
    this.S.edit(() => {
      const list = this.targets().sort((a, b) => a.t - b.t);
      const starts = [...new Set(list.map((n) => n.t))].sort((a, b) => a - b);
      const end = patternTicks(this.S.proj, this.pat);
      for (const n of list) { const next = starts.find((t) => t > n.t); n.d = Math.max(1, (next ?? end) - n.t); }
    });
  }

  // chop: cut each note into pieces of `size` ticks · glue: join same-pitch notes that touch
  chop(size = this.snap) {
    this.S.edit(() => {
      const l = this.list, made = [];
      for (const n of this.targets()) {
        if (n.d <= size) continue;
        l.splice(l.indexOf(n), 1);
        for (let t = n.t; t < n.t + n.d; t += size) { const c = { ...n, t, d: Math.min(size, n.t + n.d - t) }; l.push(c); made.push(c); }
      }
      this.sel = new Set(made);
    }, true, 'Chop');
  }

  glue() {
    this.S.edit(() => {
      const l = this.list;
      const list = this.targets().sort((a, b) => a.n - b.n || a.t - b.t);
      for (let i = 0; i < list.length - 1; i++) {
        const a = list[i], b = list[i + 1];
        if (a.n === b.n && b.t <= a.t + a.d + 1) { a.d = Math.max(a.d, b.t + b.d - a.t); l.splice(l.indexOf(b), 1); list.splice(i + 1, 1); i--; }
      }
    }, true, 'Glue');
  }

  // FL Studio's Randomizer / Riff Machine: new notes in the project's scale for this channel.
  // style: melody | bass | chords | arp; density 0..1; low: lowest note; range in semitones
  riff({ style = 'melody', bars = null, density = 0.55, low = 60, range = 14, replace = true } = {}) {
    const S = this.S, sc = S.proj.scale || { root: 0, type: 'minor' };
    const pat = pattern(S.proj), len = (bars || pat.bars) * barTicks(S.proj), steps = Math.round(len / STEP);
    const pool = []; for (let n = low; n <= low + range; n++) if (inScale(sc, n)) pool.push(n);
    const roots = pool.filter((n) => ((n - sc.root) % 12 + 12) % 12 === 0);
    const rnd = (a) => a[Math.floor(Math.random() * a.length)];
    const out = [];
    if (style === 'chords' || style === 'arp') {
      const deg = [0, 5, 3, 4, 0, 3, 5, 4]; // I vi IV V style motion, shuffled per bar
      const per = style === 'chords' ? 16 : 2;
      for (let s = 0, b = 0; s < steps; s += 16, b++) {
        const d = (b === 0 ? 0 : rnd(deg)), base = pool[Math.min(pool.length - 1, d)] ?? low;
        const i0 = pool.indexOf(base), tri = [pool[i0], pool[i0 + 2], pool[i0 + 4]].filter((n) => n != null);
        if (style === 'chords') for (const n of tri) out.push({ t: s * STEP, d: per * STEP - 2, n, v: 80 + Math.round(Math.random() * 12) });
        else for (let k = 0; k < 16 / per; k++) out.push({ t: (s + k * per) * STEP, d: per * STEP - 2, n: tri[k % tri.length] + (Math.floor(k / tri.length) % 2 ? 12 : 0), v: 78 + Math.round(Math.random() * 20) });
      }
    } else {
      let i = Math.floor(pool.length / 3);
      const onsets = [];
      for (let s = 0; s < steps; s++) {
        const strong = s % 4 === 0, p = style === 'bass' ? (strong ? 0.85 : density * 0.35) : (strong ? Math.min(1, density + 0.3) : density * 0.6);
        if (s === 0 || Math.random() < p) onsets.push(s);
      }
      onsets.forEach((s, k) => {
        const next = onsets[k + 1] ?? steps;
        const d = Math.max(1, Math.min(style === 'bass' ? 4 : 6, next - s));
        let n;
        if (style === 'bass') n = s % 8 === 0 || !roots.length ? (roots[0] ?? pool[0]) : rnd([roots[0] ?? pool[0], pool[Math.min(pool.length - 1, 4)], pool[Math.min(pool.length - 1, 2)]]);
        else { i = Math.max(0, Math.min(pool.length - 1, i + rnd([-2, -1, -1, 0, 1, 1, 2, 3, -3]))); n = pool[i]; }
        out.push({ t: s * STEP, d: d * STEP - 2, n, v: (s % 4 === 0 ? 96 : 82) + Math.round(Math.random() * 14) });
      });
      // end on the root, like a riff that resolves
      if (out.length && roots.length && style === 'melody') out[out.length - 1].n = roots.reduce((a, r) => (Math.abs(r - out[out.length - 1].n) < Math.abs(a - out[out.length - 1].n) ? r : a), roots[0]);
    }
    S.edit(() => {
      const l = this.list;
      if (replace) l.splice(0, l.length);
      this.sel.clear();
      for (const n of out) { l.push(n); this.sel.add(n); }
    }, true, 'Randomize');
    return out.length;
  }

  transform(kind) {
    this.S.edit(() => {
      const list = this.targets();
      if (!list.length) return;
      if (kind === 'reverse') { const a = Math.min(...list.map((n) => n.t)), b = Math.max(...list.map((n) => n.t + n.d)); for (const n of list) n.t = a + (b - (n.t + n.d)); }
      if (kind === 'flip') { const lo = Math.min(...list.map((n) => n.n)), hi = Math.max(...list.map((n) => n.n)); for (const n of list) n.n = this.fitN(hi - (n.n - lo)); }
      if (kind === 'octUp' || kind === 'octDown') { const d = kind === 'octUp' ? 12 : -12; for (const n of list) { const c = { ...n, n: clamp(n.n + d, 0, 127) }; this.list.push(c); } }
      if (kind === 'toScale' && this.S.proj.scale) for (const n of list) n.n = snapToScale(this.S.proj.scale, n.n);
      if (kind === 'randVel') for (const n of list) n.v = clamp(Math.round(70 + Math.random() * 50), 1, 127);
    });
  }

  key(e) {
    const S = this.S, l = this.list;
    const sel = [...this.sel];
    const k = e.key.toLowerCase();
    if (e.key === 'Delete' || e.key === 'Backspace') { if (sel.length) S.edit(() => { for (const nt of sel) l.splice(l.indexOf(nt), 1); this.sel.clear(); }); return true; }
    if (e.ctrlKey && k === 'a') { this.sel = new Set(l); this.draw(); return true; }
    if (e.ctrlKey && k === 'c') { this.clip = sel.map((n) => ({ ...n })); return true; }
    if (e.ctrlKey && k === 'v' && this.clip.length) {
      const base = Math.min(...this.clip.map((n) => n.t));
      const at = S.transport.playing ? this.snapT(S.transport.now()) : sel.length ? Math.max(...sel.map((n) => n.t + n.d)) : this.snapT(this.scrollT);
      S.edit(() => { this.sel.clear(); for (const n of this.clip) { const c = { ...n, t: n.t - base + at }; l.push(c); this.sel.add(c); } });
      return true;
    }
    if (e.ctrlKey && k === 'd' && sel.length) {
      const t0 = Math.min(...sel.map((n) => n.t)), t1 = Math.max(...sel.map((n) => n.t + n.d));
      S.edit(() => { this.sel.clear(); for (const n of sel) { const c = { ...n, t: n.t + (t1 - t0) }; l.push(c); this.sel.add(c); } });
      return true;
    }
    if (!e.ctrlKey && !e.altKey && k === 'q') { this.quantizeOpts({}); return true; }
    // FL Studio piano roll keys
    if (e.ctrlKey && e.altKey && k === 'q') { this.quantizeOpts({}); return true; }                 // quick quantize
    if (e.altKey && !e.ctrlKey && k === 'q') { this.S.quantizeDialog(); return true; } // FL: Alt+Q quantize dialog
    if (e.ctrlKey && k === 'b' && sel.length) { return this.key({ ...e, key: 'd', ctrlKey: true, altKey: false, shiftKey: false }); } // duplicate
    if (e.ctrlKey && sel.length && (k === 'arrowup' || k === 'arrowdown')) { return this.key({ ...e, ctrlKey: false, shiftKey: true }); } // octave
    if (e.altKey && k === 'a') { this.arpeggiate({}); return true; }
    if (e.altKey && k === 's') { this.strum({}); return true; }
    if (e.altKey && k === 'r') { this.S.randomizeDialog(); return true; } // FL: Alt+R Randomize
    if (e.ctrlKey && k === 'u') { this.chop(); return true; }
    if (e.ctrlKey && k === 'g') { this.glue(); return true; }
    if (e.ctrlKey && k === 'l') { this.legato(); return true; }
    if (e.altKey && k === 'v') { this.ghosts = !this.ghosts; this.draw(); return true; }
    if (sel.length && ['arrowup', 'arrowdown'].includes(k)) {
      const up = k === 'arrowup';
      S.edit(() => {
        for (const n of sel) {
          if (e.shiftKey) n.n = clamp(n.n + (up ? 12 : -12), 0, 127);
          else if (this.lock && this.scale) { let m = n.n + (up ? 1 : -1); while (!inScale(this.scale, m) && m > 0 && m < 127) m += up ? 1 : -1; n.n = m; }
          else n.n = clamp(n.n + (up ? 1 : -1), 0, 127);
        }
      });
      S.preview(this.ch.id, sel[0].n, sel[0].v);
      return true;
    }
    if (sel.length && ['arrowleft', 'arrowright'].includes(k)) {
      const dt = (k === 'arrowright' ? 1 : -1) * this.snap;
      if (Math.min(...sel.map((n) => n.t)) + dt < 0) return true;
      S.edit(() => { for (const n of sel) n.t += dt; });
      return true;
    }
    return false;
  }

  reset() { this.sel.clear(); }

  focusNotes() {
    const l = this.list;
    if (l.length) { const ns = l.map((n) => n.n); this.top = clamp(Math.max(...ns) + 6, 20, 127); }
    else this.top = this.kit ? 60 : 84;
    this.scrollT = 0;
    this.draw();
  }
}
