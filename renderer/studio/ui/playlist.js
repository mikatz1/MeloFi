// Playlist: pattern, audio and automation clips on tracks (positions in bars, snapped to the grid).
//   draw tool: click empty space places the current pattern · drag moves · drag the right edge resizes
//   slice tool: click a clip to cut it in two · right-click: clip menu · double-click: edit
//   automation clips: click inside to add / drag points, right-click a point to remove it
//   ruler: click = jump, drag = loop region · marker lane: double-click adds a marker, right-click: tempo change
//   track headers: double-click renames, M / S buttons mute / solo
import { clamp, popup, ask, form } from './dom.js';
import { pattern, patternTicks, barTicks, uid, newTrack, songBars, barLines, barAt, tickToSec } from '../model.js';
import { decode, peaks } from '../media.js';
import { t, tc } from '../../i18n/i18n.js';
import { studioPalette } from './theme.js';

const HEAD_W = 112, RULER_H = 20, LANE_H = 16, SB = 12; // SB: scroll bar thickness

export class Playlist {
  constructor(studio, canvas) {
    this.S = studio;
    this.c = canvas;
    this.x = canvas.getContext('2d');
    this.barW = 46;
    this.trackH = 46;
    this.scrollBar = 0;
    this.scrollTrack = 0;
    this.drag = null;
    this.tool = 'draw'; // FL tools: draw (P) | paint (B) | delete (D) | mute (T) | slice (C) | select (E)
    this.sel = new Set(); // clips picked with the select tool or Ctrl+drag
    this.grid = 'beat'; // bar | beat
    this.peakCache = new Map();
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    canvas.addEventListener('pointerup', () => this.up());
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('dblclick', (e) => this.dbl(e));
    canvas.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    // files dropped from the browser panel (or the desktop) become audio clips
    canvas.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
    canvas.addEventListener('drop', (e) => this.drop(e));
  }

  get proj() { return this.S.proj; }
  get top() { return RULER_H + LANE_H; }
  get step() { return this.grid === 'bar' ? 1 : 1 / this.proj.sig[0]; }

  resize() {
    const r = this.c.parentElement.getBoundingClientRect();
    const d = devicePixelRatio || 1;
    this.w = r.width; this.h = r.height;
    this.c.width = Math.round(r.width * d); this.c.height = Math.round(r.height * d);
    this.c.style.width = `${r.width}px`; this.c.style.height = `${r.height}px`;
    this.x.setTransform(d, 0, 0, d, 0, 0);
    this.draw();
  }

  bToX(b) { return HEAD_W + (b - this.scrollBar) * this.barW; }
  xToB(x) { return this.scrollBar + (x - HEAD_W) / this.barW; }
  tToY(t) { return this.top + (t - this.scrollTrack) * this.trackH; }
  yToT(y) { return Math.floor((y - this.top) / this.trackH) + this.scrollTrack; }
  // scroll ranges: the song plus room to add more, at least what is on screen
  get viewBars() { return Math.max(1, (this.w - HEAD_W - SB) / this.barW); }
  get totalBars() { return Math.max(songBars(this.proj) + 8, this.scrollBar + this.viewBars); }
  get viewTracks() { return Math.max(1, (this.h - this.top - SB) / this.trackH); }
  get maxTrack() { return Math.max(0, this.proj.playlist.tracks.length + 1 - Math.floor(this.viewTracks)); }
  // [start, size] of each thumb in px along its bar
  hThumb() { const len = this.w - HEAD_W - SB, sz = Math.max(24, len * Math.min(1, this.viewBars / this.totalBars)); return [HEAD_W + (len - sz) * (this.scrollBar / Math.max(1e-6, this.totalBars - this.viewBars)), sz, len]; }
  vThumb() { const len = this.h - this.top - SB, n = this.proj.playlist.tracks.length + 1, sz = Math.max(24, len * Math.min(1, this.viewTracks / n)); return [this.top + (len - sz) * (this.maxTrack ? this.scrollTrack / this.maxTrack : 0), sz, len]; }

  snapB(b) { return Math.max(0, Math.round(b / this.step) * this.step); }
  floorB(b) { return Math.max(0, Math.floor(b / this.step) * this.step); }

  clipAt(x, y) {
    const b = this.xToB(x), t = this.yToT(y);
    let hit = null;
    for (const c of this.proj.playlist.clips) if (c.track === t && b >= c.start && b < c.start + c.len) hit = c;
    return hit;
  }

  clipName(c) {
    const p = this.proj;
    if (c.kind === 'audio') return p.media[c.media]?.name || t('오디오');
    if (c.kind === 'auto') return p.autos.find((a) => a.id === c.auto)?.name || t('오토메이션');
    return pattern(p, c.pattern)?.name || t('패턴');
  }
  clipColor(c) {
    const p = this.proj;
    if (c.kind === 'audio') return p.channels.find((x) => x.id === c.ch)?.color || '#6c8';
    if (c.kind === 'auto') return p.autos.find((a) => a.id === c.auto)?.color || '#9a8cd6';
    return pattern(p, c.pattern)?.color || '#5a7bd6';
  }

  async ensurePeaks(hash) {
    if (this.peakCache.has(hash)) return;
    this.peakCache.set(hash, null);
    try { const b = await decode(hash, 48000); this.peakCache.set(hash, { pk: peaks(b, 2000), dur: b.duration }); this.draw(); } catch { /* missing */ }
  }

  draw() {
    const g = this.x, W = this.w, H = this.h, proj = this.proj;
    if (!W) return;
    this.follow();
    const bt = barTicks(proj), tracks = proj.playlist.tracks, P = studioPalette();
    g.fillStyle = P.bg; g.fillRect(0, 0, W, H);
    for (let t = this.scrollTrack; t < tracks.length; t++) {
      const y = this.tToY(t);
      if (y > H) break;
      g.fillStyle = t % 2 ? P.trackAlt : P.track;
      g.fillRect(HEAD_W, y, W - HEAD_W, this.trackH);
    }
    // loop region
    if (proj.loop) {
      const x0 = this.bToX(proj.loop.start), x1 = this.bToX(proj.loop.end);
      g.fillStyle = proj.loopOn ? P.loopOn : P.loopOff;
      g.fillRect(Math.max(HEAD_W, x0), this.top, x1 - Math.max(HEAD_W, x0), H);
    }
    // grid: bar lines follow time signature markers
    const lines = barLines(proj, Math.max(0, this.xToB(HEAD_W)) * bt, this.xToB(W) * bt + bt);
    for (const L of lines) {
      const beatT = (96 * 4) / L.sig[1];
      if (this.barW * beatT / bt > 10) for (let k = 1; k < L.sig[0]; k++) { const x = Math.round(this.bToX((L.tick + k * beatT) / bt)) + 0.5; if (x >= HEAD_W) { g.fillStyle = P.plBeat; g.fillRect(x, this.top, 1, H - this.top); } }
      const x = Math.round(this.bToX(L.tick / bt)) + 0.5;
      if (x < HEAD_W) continue;
      g.fillStyle = L.num % 4 === 0 ? P.plBar4 : P.plBar;
      g.fillRect(x, this.top, 1, H - this.top);
    }
    // clips
    g.save();
    g.beginPath(); g.rect(HEAD_W, this.top, W - HEAD_W, H - this.top); g.clip();
    for (const c of proj.playlist.clips) {
      const x = this.bToX(c.start), y = this.tToY(c.track), w = c.len * this.barW;
      if (x > W || x + w < HEAD_W || y > H || y + this.trackH < this.top) continue;
      const col = this.clipColor(c);
      g.fillStyle = c.mute ? P.clipMute : col; g.globalAlpha = c.kind === 'auto' ? 0.35 : c.mute ? 0.5 : P.clipA;
      g.fillRect(x + 1, y + 2, w - 2, this.trackH - 4);
      g.globalAlpha = 1;
      g.fillStyle = P.clipBand; g.fillRect(x + 1, y + 2, w - 2, 13);
      g.fillStyle = P.clipInk; g.font = '10.5px "Segoe UI", "Malgun Gothic", sans-serif';
      g.fillText(this.clipName(c), x + 5, y + 12, Math.max(10, w - 10));
      const iy = y + 16, ih = this.trackH - 21;
      if (c.kind === 'audio') this.drawAudio(g, c, x, iy, w, ih);
      else if (c.kind === 'auto') this.drawAuto(g, c, x, iy, w, ih);
      else this.drawNotes(g, c, x, iy, w, ih, bt);
      if (this.S.selClip === c || this.sel.has(c)) { g.strokeStyle = P.clipSel; g.lineWidth = 1.5; g.strokeRect(x + 1.5, y + 2.5, w - 3, this.trackH - 5); }
    }
    if (this.drag?.kind === 'marquee') {
      const d = this.drag, mx = Math.min(d.x0, d.x1), my = Math.min(d.y0, d.y1);
      g.fillStyle = 'rgba(232,161,93,0.12)'; g.fillRect(mx, my, Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
      g.strokeStyle = 'rgba(232,161,93,0.8)'; g.lineWidth = 1; g.strokeRect(mx + 0.5, my + 0.5, Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
    }
    g.restore();
    // track headers
    for (let t = this.scrollTrack; t < tracks.length; t++) {
      const y = this.tToY(t), tr = tracks[t];
      if (y > H) break;
      g.fillStyle = P.head; g.fillRect(0, y, HEAD_W - 1, this.trackH - 1);
      if (tr.color) { g.fillStyle = tr.color; g.fillRect(0, y, 3, this.trackH - 1); }
      g.fillStyle = tr.mute ? P.headInkMute : P.headInk; g.font = '11px "Segoe UI", "Malgun Gothic", sans-serif';
      g.fillText(tr.name, 8, y + 16, HEAD_W - 16);
      for (const [i, k, on, oc] of [[0, 'M', tr.mute, P.muteOn], [1, 'S', tr.solo, P.soloOn]]) {
        const bx = 8 + i * 22, by = y + this.trackH - 20;
        g.fillStyle = on ? oc : P.msOff; g.fillRect(bx, by, 18, 14);
        g.fillStyle = on ? P.msInkOn : P.msInk; g.font = '600 10px "Segoe UI", sans-serif'; g.fillText(k, bx + 5, by + 11);
      }
    }
    // marker / tempo lane
    g.fillStyle = P.markerLane; g.fillRect(0, RULER_H, W, LANE_H);
    g.fillStyle = P.laneInk; g.font = '9.5px "Segoe UI", "Malgun Gothic", sans-serif'; g.fillText(t('마커 · 템포'), 8, RULER_H + 12);
    for (const m of proj.markers) { const x = this.bToX(m.bar); if (x < HEAD_W || x > W) continue; g.fillStyle = P.marker; g.fillRect(x, RULER_H, 2, LANE_H); g.fillText(m.name, x + 4, RULER_H + 12); }
    for (const tc of proj.tempos) { const x = this.bToX(tc.bar); if (x < HEAD_W || x > W) continue; g.fillStyle = P.tempo; g.fillRect(x, RULER_H, 2, LANE_H); g.fillText(`BPM ${tc.bpm}`, x + 4, RULER_H + 12); }
    for (const sm of proj.sigs || []) { const x = this.bToX(sm.tick / bt); if (x < HEAD_W || x > W) continue; g.fillStyle = P.sig; g.fillRect(x, RULER_H, 2, LANE_H); g.fillText(`${sm.sig[0]}/${sm.sig[1]}`, x + 4, RULER_H + 12); }
    // ruler
    g.fillStyle = P.ruler; g.fillRect(0, 0, W, RULER_H);
    if (proj.loop) { const x0 = Math.max(HEAD_W, this.bToX(proj.loop.start)), x1 = this.bToX(proj.loop.end); if (x1 > HEAD_W) { g.fillStyle = proj.loopOn ? P.loopBarOn : P.loopBarOff; g.fillRect(x0, 0, x1 - x0, 6); } }
    g.fillStyle = P.rulerInk; g.font = '10px "Cascadia Mono", Consolas, monospace';
    for (const L of lines) {
      const x = this.bToX(L.tick / bt);
      if (x >= HEAD_W - 1) { g.fillRect(x, 14, 1, 6); if (this.barW * L.len / bt > 16 || L.num % 4 === 0) g.fillText(String(L.num + 1), x + 3, 15); }
    }
    g.fillStyle = P.ruler; g.fillRect(0, 0, HEAD_W, RULER_H);
    g.fillStyle = P.laneInk; g.fillText(this.tool === 'slice' ? t('자르기 도구') : '', 8, 14);
    if (this.proj.mode === 'song' && this.S.transport) {
      const T = this.S.transport.songPos();
      const x = this.bToX(T / bt);
      if (x >= HEAD_W) { g.fillStyle = P.playhead; g.fillRect(x, 0, 1.5, H); }
    }
    if (this.drag?.kind === 'loop') { g.fillStyle = P.loopDrag; const a = this.bToX(Math.min(this.drag.b0, this.drag.b1)), b = this.bToX(Math.max(this.drag.b0, this.drag.b1)); g.fillRect(a, 0, b - a, H); }
    // scroll bars: horizontal along the bottom, vertical down the right edge
    g.fillStyle = P.scroll; g.fillRect(HEAD_W, H - SB, W - HEAD_W, SB); g.fillRect(W - SB, this.top, SB, H - this.top);
    g.fillStyle = P.ruler; g.fillRect(0, H - SB, HEAD_W, SB);
    const [hx, hs] = this.hThumb(), [vy, vs] = this.vThumb();
    g.fillStyle = this.drag?.kind === 'hbar' ? P.thumbOn : P.thumb; g.fillRect(hx + 1, H - SB + 3, hs - 2, SB - 6);
    g.fillStyle = this.drag?.kind === 'vbar' ? P.thumbOn : P.thumb; g.fillRect(W - SB + 3, vy + 1, SB - 6, vs - 2);
  }

  // while playing, page along when the playhead runs off the right edge (as FL does)
  follow() {
    if (this.drag || this.proj.mode !== 'song' || !this.S.transport?.playing) return;
    const b = this.S.transport.songPos() / barTicks(this.proj);
    if (b > this.scrollBar + this.viewBars - 0.5 || b < this.scrollBar) this.scrollBar = Math.max(0, b - 1);
  }

  drawNotes(g, c, x, y, w, h, bt) {
    const p = pattern(this.proj, c.pattern);
    if (!p) return;
    const all = Object.values(p.notes).flat();
    if (!all.length) return;
    const ns = all.map((n) => n.n), lo = Math.min(...ns), hi = Math.max(...ns) + 1;
    const pl = patternTicks(this.proj, p), off = (c.offset || 0) * bt;
    g.fillStyle = studioPalette().clipNotes;
    for (let o = -off; o < c.len * bt; o += pl) for (const n of all) {
      const t = o + n.t;
      if (t < 0 || t >= c.len * bt) continue;
      const nx = x + (t / bt) * this.barW, ny = y + (1 - (n.n - lo) / Math.max(1, hi - lo)) * (h - 2);
      g.fillRect(nx, ny, Math.max(1, (n.d / bt) * this.barW), 2);
    }
  }

  drawAudio(g, c, x, y, w, h) {
    const pc = this.peakCache.get(c.media);
    if (pc === undefined) { this.ensurePeaks(c.media); return; }
    if (!pc) return;
    const m = this.proj.media[c.media];
    const ratio = c.sync && m?.bpm ? m.bpm / this.proj.bpm : 1;
    const secPerBar = (60 / this.proj.bpm) * this.proj.sig[0] * (4 / this.proj.sig[1]);
    // a clip played as recorded follows the song's tempo map, so its waveform does too
    const bt = barTicks(this.proj), t0 = tickToSec(this.proj, c.start * bt);
    const at = c.sync || !this.proj.tempos?.length ? (px) => (px / this.barW) * secPerBar : (px) => tickToSec(this.proj, (c.start + px / this.barW) * bt) - t0;
    g.fillStyle = studioPalette().clipWave;
    const n = pc.pk.length / 2;
    for (let px = 0; px < w; px += 1) {
      const sec = ((c.offset || 0) + at(px)) / ratio; // stretched seconds -> source seconds
      const i = Math.floor((sec / pc.dur) * n);
      if (i >= n) break;
      const lo = pc.pk[i * 2], hi = pc.pk[i * 2 + 1];
      g.fillRect(x + px, y + h / 2 - hi * h / 2, 1, Math.max(1, (hi - lo) * h / 2));
    }
  }

  drawAuto(g, c, x, y, w, h) {
    const a = this.proj.autos.find((q) => q.id === c.auto);
    if (!a || !a.points.length) return;
    const span = (a.len || c.len) * this.barW;
    g.strokeStyle = studioPalette().autoLine; g.lineWidth = 1.5;
    g.beginPath();
    for (let o = 0; o < w; o += span) a.points.forEach((p, i) => { const px = x + o + p.t * span, py = y + (1 - p.v) * h; if (px > x + w) return; if (i === 0) g.moveTo(px, py); else g.lineTo(px, py); });
    g.stroke();
    g.fillStyle = studioPalette().autoPoint;
    for (const p of a.points) g.fillRect(x + p.t * span - 2.5, y + (1 - p.v) * h - 2.5, 5, 5);
  }

  pos(e) { const r = this.c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }

  // point of an automation clip near (x, y)
  autoPoint(c, x, y) {
    const a = this.proj.autos.find((q) => q.id === c.auto);
    if (!a) return null;
    const cx = this.bToX(c.start), cy = this.tToY(c.track) + 16, h = this.trackH - 21, span = (a.len || c.len) * this.barW;
    const i = a.points.findIndex((p) => Math.abs(cx + p.t * span - x) < 6 && Math.abs(cy + (1 - p.v) * h - y) < 6);
    return { a, i, cx, cy, h, span };
  }

  down(e) {
    const [x, y] = this.pos(e);
    const S = this.S, proj = this.proj;
    this.c.setPointerCapture(e.pointerId);
    if (this.c.tabIndex < 0) this.c.tabIndex = 0;
    this.c.focus({ preventScroll: true }); // tool keys (P B D T C) act on the playlist
    if (y >= this.h - SB && x >= HEAD_W) { // horizontal bar: drag the thumb, click beside it pages
      const [hx, hs, len] = this.hThumb();
      if (x < hx || x > hx + hs) this.scrollBar = Math.max(0, this.scrollBar + Math.sign(x - hx) * this.viewBars * 0.9);
      this.drag = { kind: 'hbar', x0: x, sb: this.scrollBar, per: (this.totalBars - this.viewBars) / Math.max(1, len - hs) };
      this.draw(); return;
    }
    if (x >= this.w - SB && y >= this.top) {
      const [vy, vs, len] = this.vThumb();
      if (y < vy || y > vy + vs) this.scrollTrack = clamp(this.scrollTrack + Math.sign(y - vy) * Math.max(1, Math.floor(this.viewTracks) - 1), 0, this.maxTrack);
      this.drag = { kind: 'vbar', y0: y, st: this.scrollTrack, per: this.maxTrack / Math.max(1, len - vs) };
      this.draw(); return;
    }
    if (y < RULER_H && x >= HEAD_W) { this.drag = { kind: 'ruler', x0: x, b0: this.snapB(this.xToB(x)), b1: this.snapB(this.xToB(x)) }; return; }
    if (y < this.top && x >= HEAD_W) {
      if (e.button === 2) this.laneMenu(e, this.floorB(this.xToB(x)), this.xToB(x));
      return;
    }
    if (x < HEAD_W) { // track header
      const t = this.yToT(y), tr = proj.playlist.tracks[t];
      if (!tr) return;
      const by = this.tToY(t) + this.trackH - 20;
      if (y >= by && y <= by + 14) {
        if (x >= 8 && x < 26) S.edit(() => { tr.mute = !tr.mute; });
        else if (x >= 30 && x < 48) S.edit(() => { tr.solo = !tr.solo; });
      }
      if (e.button === 2) this.trackMenu(e, t);
      return;
    }
    const hit = this.clipAt(x, y);
    const onTitle = hit && y < this.tToY(hit.track) + 16;
    if (e.button === 2) {
      // as in FL Studio: right-click deletes (and keeps deleting while dragged); the clip's
      // title strip opens its menu
      if (hit && onTitle) { this.clipMenu(e, hit); return; }
      if (hit) { S.history.push(); this.removeClip(hit); this.drag = { kind: 'erase' }; }
      return;
    }
    if (hit && this.tool === 'slice') { this.slice(hit, this.snapB(this.xToB(x))); return; }
    // FL: the select tool (E), or Ctrl+drag on empty space, draws a selection box; dragging a
    // selected clip moves the whole selection
    if (hit && this.sel.has(hit) && this.sel.size > 1 && this.tool !== 'delete' && this.tool !== 'mute') {
      S.history.push();
      this.drag = { kind: 'group', x0: x, y0: y, items: [...this.sel].map((c) => ({ c, start: c.start, track: c.track })) };
      return;
    }
    if ((this.tool === 'select' || e.ctrlKey) && !hit) { this.sel.clear(); S.selClip = null; this.drag = { kind: 'marquee', x0: x, y0: y, x1: x, y1: y }; this.draw(); return; }
    if (this.tool === 'select' && hit) { if (!e.shiftKey) this.sel.clear(); this.sel.add(hit); S.history.push(); this.drag = { kind: 'group', x0: x, y0: y, items: [...this.sel].map((c) => ({ c, start: c.start, track: c.track })) }; this.draw(); return; }
    this.sel.clear();
    if (this.tool === 'delete') { S.history.push(); if (hit) this.removeClip(hit); this.drag = { kind: 'erase' }; return; }
    if (this.tool === 'mute') { S.history.push(); this.drag = { kind: 'mute', done: new Set() }; this.muteClip(hit); return; }
    if (this.tool === 'paint' && !hit) {
      const t = this.yToT(y);
      if (t >= proj.playlist.tracks.length) return;
      S.history.push();
      const p = pattern(proj), start = this.floorB(this.xToB(x));
      proj.playlist.clips.push({ id: uid('k'), pattern: p.id, track: t, start, len: p.bars });
      this.drag = { kind: 'paint', track: t, last: start, len: p.bars, pat: p.id };
      this.draw();
      return;
    }
    if (hit && hit.kind === 'auto' && y > this.tToY(hit.track) + 14) {
      // edit automation points
      const ap = this.autoPoint(hit, x, y);
      S.history.push();
      S.selClip = hit;
      const tv = (px, py) => ({ t: clamp((px - ap.cx) / ap.span, 0, 1), v: clamp(1 - (py - ap.cy) / ap.h, 0, 1) });
      let idx = ap.i;
      if (idx < 0) { const p = tv(x, y); ap.a.points.push(p); ap.a.points.sort((a, b) => a.t - b.t); idx = ap.a.points.indexOf(p); }
      this.drag = { kind: 'autopt', a: ap.a, p: ap.a.points[idx], tv };
      this.draw();
      return;
    }
    if (hit) {
      S.history.push();
      S.selClip = hit;
      if (e.ctrlKey) { const c = { ...hit, id: uid('k') }; proj.playlist.clips.push(c); this.drag = { kind: 'move', clip: c, x0: x, y0: y, start: c.start, track: c.track }; this.draw(); return; }
      const edge = x > this.bToX(hit.start + hit.len) - 7;
      this.drag = { kind: edge ? 'resize' : 'move', clip: hit, x0: x, y0: y, start: hit.start, track: hit.track, len: hit.len };
      this.draw();
      return;
    }
    const t = this.yToT(y);
    if (t >= proj.playlist.tracks.length || this.tool === 'slice') return;
    const p = pattern(proj);
    S.history.push();
    const c = { id: uid('k'), pattern: p.id, track: t, start: this.floorB(this.xToB(x)), len: p.bars };
    proj.playlist.clips.push(c);
    S.selClip = c;
    this.drag = { kind: 'move', clip: c, x0: x, y0: y, start: c.start, track: c.track, len: c.len };
    this.draw();
  }

  move(e) {
    const d = this.drag;
    const [x, y] = this.pos(e);
    if (!d) {
      const hit = x > HEAD_W && y > this.top && y < this.h - SB && x < this.w - SB ? this.clipAt(x, y) : null;
      this.c.style.cursor = this.tool === 'slice' && hit ? 'col-resize' : hit && x > this.bToX(hit.start + hit.len) - 7 ? 'ew-resize' : hit ? 'move' : 'default';
      return;
    }
    if (d.kind === 'hbar') { this.scrollBar = clamp(d.sb + (x - d.x0) * d.per, 0, Math.max(0, this.totalBars - this.viewBars)); this.draw(); return; }
    if (d.kind === 'vbar') { this.scrollTrack = clamp(Math.round(d.st + (y - d.y0) * d.per), 0, this.maxTrack); this.draw(); return; }
    if (d.kind === 'erase') { const h = this.clipAt(x, y); if (h) this.removeClip(h); return; }
    if (d.kind === 'marquee') {
      d.x1 = x; d.y1 = y;
      const b0 = this.xToB(Math.min(d.x0, x)), b1 = this.xToB(Math.max(d.x0, x)), t0 = this.yToT(Math.min(d.y0, y)), t1 = this.yToT(Math.max(d.y0, y));
      this.sel = new Set(this.proj.playlist.clips.filter((c) => c.track >= t0 && c.track <= t1 && c.start < b1 && c.start + c.len > b0));
      this.draw();
      return;
    }
    if (d.kind === 'group') {
      const db = Math.round((x - d.x0) / this.barW / this.step) * this.step, dt = Math.round((y - d.y0) / this.trackH);
      const minS = Math.min(...d.items.map((i) => i.start)), minT = Math.min(...d.items.map((i) => i.track)), maxT = Math.max(...d.items.map((i) => i.track));
      const sb = Math.max(-minS, db), st = clamp(dt, -minT, this.proj.playlist.tracks.length - 1 - maxT);
      for (const i of d.items) { i.c.start = i.start + sb; i.c.track = i.track + st; }
      this.draw();
      return;
    }
    if (d.kind === 'mute') { this.muteClip(this.clipAt(x, y)); return; }
    if (d.kind === 'paint') {
      const b = this.floorB(this.xToB(x));
      let added = false;
      while (b >= d.last + d.len) {
        d.last += d.len;
        this.proj.playlist.clips.push({ id: uid('k'), pattern: d.pat, track: d.track, start: d.last, len: d.len });
        added = true;
      }
      if (added) this.draw();
      return;
    }
    if (d.kind === 'ruler') { d.b1 = this.snapB(this.xToB(x)); if (Math.abs(x - d.x0) > 4) d.kind = 'loop'; this.draw(); return; }
    if (d.kind === 'loop') { d.b1 = this.snapB(this.xToB(x)); this.draw(); return; }
    if (d.kind === 'autopt') { Object.assign(d.p, d.tv(x, y)); d.a.points.sort((a, b) => a.t - b.t); this.draw(); return; }
    const db = Math.round((x - d.x0) / this.barW / this.step) * this.step;
    if (d.kind === 'resize') d.clip.len = Math.max(this.step, d.len + db);
    else {
      d.clip.start = Math.max(0, d.start + db);
      d.clip.track = clamp(d.track + Math.round((y - d.y0) / this.trackH), 0, this.proj.playlist.tracks.length - 1);
    }
    this.draw();
  }

  up() {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    const S = this.S, proj = this.proj;
    if (d.kind === 'marquee' || d.kind === 'hbar' || d.kind === 'vbar') { this.draw(); return; }
    if (d.kind === 'ruler') { S.setMode('song'); S.transport.seek(Math.max(0, d.b0 * barTicks(proj) - (proj.loopOn && proj.loop ? proj.loop.start * barTicks(proj) : 0))); this.draw(); return; }
    if (d.kind === 'loop') {
      const a = Math.min(d.b0, d.b1), b = Math.max(d.b0, d.b1);
      S.edit(() => { if (b - a >= this.step) { proj.loop = { start: a, end: b }; proj.loopOn = true; } else { proj.loop = null; proj.loopOn = false; } });
      return;
    }
    if (proj.playlist.clips.length && Math.max(...proj.playlist.clips.map((c) => c.track)) >= proj.playlist.tracks.length - 1) proj.playlist.tracks.push(newTrack(proj.playlist.tracks.length));
    S.changed();
  }

  dbl(e) {
    const [x, y] = this.pos(e);
    if (x < HEAD_W) {
      const ti = this.yToT(y), tr = this.proj.playlist.tracks[ti];
      if (tr) ask(t('트랙 이름'), tr.name).then((v) => { if (v && v.trim()) this.S.edit(() => { tr.name = v.trim(); }); });
      return;
    }
    if (y < this.top && y >= RULER_H) { const b = this.floorB(this.xToB(x)); ask(t('마커 이름'), t('구간 {n}', { n: this.proj.markers.length + 1 })).then((v) => { if (v) this.S.edit(() => this.proj.markers.push({ bar: b, name: v })); }); return; }
    const hit = this.clipAt(x, y);
    if (!hit) return;
    if (!hit.kind) this.S.setPattern(hit.pattern, true);
    else if (hit.kind === 'audio') this.S.channelSheet.show(hit.ch);
  }

  slice(c, at) {
    if (at <= c.start || at >= c.start + c.len) return;
    const bt = barTicks(this.proj);
    this.S.edit(() => {
      const first = at - c.start;
      const second = { ...c, id: uid('k'), start: at, len: c.len - first };
      if (!c.kind) second.offset = ((c.offset || 0) + first) % (patternTicks(this.proj, pattern(this.proj, c.pattern)) / bt);
      if (c.kind === 'audio') {
        const secPerBar = (60 / this.proj.bpm) * this.proj.sig[0] * (4 / this.proj.sig[1]);
        second.offset = (c.offset || 0) + first * secPerBar; // seconds into the (stretched) clip
      }
      if (c.kind === 'auto') { second.offsetT = first; }
      c.len = first;
      this.proj.playlist.clips.push(second);
    });
  }

  clipMenu(e, c) {
    const S = this.S, proj = this.proj;
    const items = [];
    if (!c.kind) {
      items.push({ label: t('패턴 편집'), act: () => S.setPattern(c.pattern, true) });
      items.push({ label: 'Make unique', hint: t('이 클립만 따로 수정 (고유 패턴)'), act: () => S.edit(() => { const p = pattern(proj, c.pattern); const np = JSON.parse(JSON.stringify(p)); np.id = uid('p'); np.name = `${p.name} *`; proj.patterns.push(np); c.pattern = np.id; }) });
      items.push({ label: t('패턴 길이에 맞추기'), act: () => S.edit(() => { c.len = pattern(proj, c.pattern).bars; }) });
    }
    if (c.kind === 'audio' && proj.media[c.media]?.loop) {
      items.push({ label: t('루프 바꾸기 (셔플)'), hint: t('같은 파트의 다른 변형'), act: () => S.shuffleLoop(c) });
    }
    if (c.kind === 'audio') items.push({ label: t('Newtone으로 음정 편집…'), hint: t('노래 한 줄의 음정·길이 고치기'), act: () => S.newtone.open(c) });
    if (c.kind === 'audio') {
      const m = proj.media[c.media];
      items.push({ label: c.sync ? t('템포 맞추기 끄기') : t('프로젝트 템포에 맞추기'), hint: m?.bpm ? t('원본 {bpm} BPM', { bpm: m.bpm }) : t('원본 템포 모름'), disabled: !m?.bpm, act: () => S.edit(() => { c.sync = !c.sync; }) });
      items.push({ label: t('원본 템포 입력…'), act: async () => { const v = await ask(t('이 파일의 원래 BPM'), String(m?.bpm || 120), { type: 'number' }); if (v && +v > 20) S.edit(() => { m.bpm = +v; }); } });
      items.push({ label: t('게인…'), act: async () => { const v = await ask(t('클립 게인 (1 = 그대로)'), String(c.gain ?? 1), { type: 'number' }); if (v && +v >= 0) S.edit(() => { c.gain = +v; }); } });
      items.push({ label: tc('clip', '노멀라이즈'), hint: t('가장 큰 소리를 -1dB까지'), act: () => this.S.processClip(c, 'normalize') });
      items.push({ label: tc('clip', '거꾸로'), act: () => this.S.processClip(c, 'reverse') });
      items.push({ label: t('앞뒤 무음 자르기'), act: () => this.S.processClip(c, 'trim') });
      items.push({ label: t('페이드 인/아웃 0.5초'), act: () => S.edit(() => { c.fadeIn = 0.5; c.fadeOut = 0.5; }) });
      items.push({ label: t('페이드 없애기'), act: () => S.edit(() => { c.fadeIn = 0.003; c.fadeOut = 0.01; }) });
      items.push({ label: t('오디오 파일 길이에 맞추기'), act: () => S.edit(() => { const secPerBar = (60 / proj.bpm) * proj.sig[0] * (4 / proj.sig[1]); const ratio = c.sync && m?.bpm ? m.bpm / proj.bpm : 1; c.len = Math.max(this.step, Math.round((m.dur * ratio / secPerBar) / this.step) * this.step); }) });
    }
    if (c.kind === 'auto') {
      const a = proj.autos.find((q) => q.id === c.auto);
      items.push({ label: t('이름 바꾸기…'), act: async () => { const v = await ask(t('오토메이션 이름'), a.name); if (v) S.edit(() => { a.name = v; }); } });
      items.push({ label: t('점 모두 지우기'), act: () => S.edit(() => { a.points = [{ t: 0, v: a.points[0]?.v ?? 0.5 }]; }) });
      items.push({ label: t('상승 곡선'), act: () => S.edit(() => { a.points = [{ t: 0, v: 0 }, { t: 1, v: 1 }]; }) });
      items.push({ label: t('하강 곡선'), act: () => S.edit(() => { a.points = [{ t: 0, v: 1 }, { t: 1, v: 0 }]; }) });
      const ap = this.autoPoint(c, ...this.pos(e));
      if (ap && ap.i >= 0) items.unshift({ label: t('이 점 지우기'), act: () => S.edit(() => { ap.a.points.splice(ap.i, 1); }) });
    }
    items.push({ sep: true }, { label: t('복제'), hint: t('Ctrl+드래그'), act: () => S.edit(() => proj.playlist.clips.push({ ...c, id: uid('k'), start: c.start + c.len })) },
      { label: t('삭제'), act: () => S.edit(() => { proj.playlist.clips.splice(proj.playlist.clips.indexOf(c), 1); S.selClip = null; }) });
    popup(e.clientX, e.clientY, items);
  }

  trackMenu(e, ti) {
    const S = this.S, proj = this.proj, tr = proj.playlist.tracks[ti];
    popup(e.clientX, e.clientY, [
      { label: t('이름 바꾸기…'), act: async () => { const v = await ask(t('트랙 이름'), tr.name); if (v) S.edit(() => { tr.name = v; }); } },
      { label: t('트랙 추가'), act: () => S.edit(() => proj.playlist.tracks.splice(ti + 1, 0, newTrack(proj.playlist.tracks.length))) },
      { label: t('트랙 삭제'), disabled: proj.playlist.tracks.length <= 1, act: () => S.edit(() => {
        proj.playlist.tracks.splice(ti, 1);
        proj.playlist.clips = proj.playlist.clips.filter((c) => c.track !== ti);
        for (const c of proj.playlist.clips) if (c.track > ti) c.track--;
      }) },
    ]);
  }

  // FL Studio's time signature marker (Shift+Alt+T): from the bar line at `tick` on
  async sigDialog(tick) {
    const S = this.S, proj = this.proj, b = barAt(proj, tick);
    const SIGS = ['2/4', '3/4', '4/4', '5/4', '6/8', '7/8', '9/8', '12/8'];
    const cur = `${b.sig[0]}/${b.sig[1]}`;
    const v = await form(t('{bar}마디부터 박자표', { bar: b.num + 1 }), [{ key: 'sig', label: t('박자'), type: 'select', value: cur, options: SIGS.map((s) => [s, s]) }],
      { note: t('이 마디부터 눈금·마디 번호와 메트로놈이 바뀌며, 패턴 길이는 그대로 유지됩니다.') });
    if (!v) return;
    const sig = String(v.sig).split('/').map(Number);
    S.edit(() => {
      proj.sigs = (proj.sigs || []).filter((x) => x.tick !== b.start);
      if (b.start === 0) proj.sig = sig; else proj.sigs.push({ tick: b.start, sig });
    });
  }

  laneMenu(e, bar, exact = bar) {
    const S = this.S, proj = this.proj, bt = barTicks(proj);
    const tick = Math.max(0, exact * bt), here = barAt(proj, tick);
    popup(e.clientX, e.clientY, [
      { label: t('{bar}마디부터 박자표 바꾸기…', { bar: here.num + 1 }), hint: 'Shift+Alt+T', act: () => this.sigDialog(tick) },
      ...(proj.sigs || []).filter((x) => x.tick === here.start).map((x) => ({ label: t('박자표 {sig} 지우기', { sig: `${x.sig[0]}/${x.sig[1]}` }), act: () => S.edit(() => proj.sigs.splice(proj.sigs.indexOf(x), 1)) })),
      { label: t('{bar}마디에 마커 추가…', { bar: bar + 1 }), act: async () => { const v = await ask(t('마커 이름'), t('구간 {n}', { n: proj.markers.length + 1 })); if (v) S.edit(() => proj.markers.push({ bar, name: v })); } },
      { label: t('{bar}마디부터 템포 바꾸기…', { bar: bar + 1 }), disabled: bar === 0, act: async () => { const v = await ask(t('{bar}마디부터 쓸 BPM', { bar: bar + 1 }), String(proj.bpm), { type: 'number' }); if (v && +v >= 30 && +v <= 300) S.edit(() => { proj.tempos = proj.tempos.filter((x) => x.bar !== bar); proj.tempos.push({ bar, bpm: +v }); }); } },
      { sep: true },
      ...proj.markers.filter((m) => Math.abs(m.bar - bar) < 1).map((m) => ({ label: t('마커 "{name}" 지우기', { name: m.name }), act: () => S.edit(() => proj.markers.splice(proj.markers.indexOf(m), 1)) })),
      ...proj.tempos.filter((x) => Math.abs(x.bar - bar) < 1).map((x) => ({ label: t('템포 변화 ({bpm}) 지우기', { bpm: x.bpm }), act: () => S.edit(() => proj.tempos.splice(proj.tempos.indexOf(x), 1)) })),
      { label: proj.loopOn ? t('반복 구간 끄기') : t('반복 구간 켜기'), disabled: !proj.loop, act: () => S.edit(() => { proj.loopOn = !proj.loopOn; }) },
    ]);
  }

  async drop(e) {
    e.preventDefault();
    const [x, y] = this.pos(e);
    const t = Math.max(0, this.yToT(y)), b = this.floorB(this.xToB(x));
    const loop = e.dataTransfer.getData('application/x-melofi-loop');
    if (loop) { const { genre, role } = JSON.parse(loop); await this.S.addLoop(genre, role, { track: t, bar: b, seed: 1 }); return; }
    const path = e.dataTransfer.getData('application/x-melofi-file');
    const files = [];
    if (path) { const data = await window.melofi.mediaRead(path); if (data) files.push({ name: path.split(/[\\/]/).pop(), data }); }
    else for (const f of e.dataTransfer.files) if (/\.(wav|mp3|ogg|flac|m4a|aif|aiff)$/i.test(f.name)) files.push({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) });
    let row = t;
    for (const f of files) { await this.S.addAudioClip(f.name, f.data, row, b); row++; }
  }

  wheel(e) {
    e.preventDefault();
    if (e.ctrlKey) {
      const [x] = this.pos(e), b = this.xToB(x);
      this.barW = clamp(this.barW * (e.deltaY < 0 ? 1.15 : 1 / 1.15), 8, 240);
      this.scrollBar = Math.max(0, b - (x - HEAD_W) / this.barW);
    } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) this.scrollBar = clamp(this.scrollBar + (e.deltaX || e.deltaY) / this.barW * 0.5, 0, Math.max(0, this.totalBars - this.viewBars));
    else if (e.altKey) this.trackH = clamp(this.trackH + (e.deltaY < 0 ? 4 : -4), 28, 120);
    else this.scrollTrack = clamp(this.scrollTrack + Math.sign(e.deltaY), 0, this.maxTrack);
    this.draw();
  }

  setTool(t) { if (['draw', 'paint', 'delete', 'mute', 'slice', 'select'].includes(t)) this.tool = t; }

  removeClip(c) {
    const l = this.proj.playlist.clips, i = l.indexOf(c);
    if (i >= 0) l.splice(i, 1);
    if (this.S.selClip === c) this.S.selClip = null;
    this.draw();
  }

  muteClip(c) {
    if (!c || this.drag?.done?.has(c)) return;
    this.drag?.done?.add(c);
    c.mute = !c.mute;
    this.draw();
  }

  key(e) {
    const c = this.S.selClip, S = this.S, l = this.proj.playlist.clips;
    if (e.ctrlKey && e.key.toLowerCase() === 'a') { this.sel = new Set(l); this.draw(); return true; }
    if (this.sel.size > 1) {
      if (e.key === 'Delete' || e.key === 'Backspace') { S.edit(() => { for (const x of this.sel) { const i = l.indexOf(x); if (i >= 0) l.splice(i, 1); } this.sel.clear(); S.selClip = null; }); return true; }
      if (e.ctrlKey && ['d', 'b'].includes(e.key.toLowerCase())) {
        const items = [...this.sel], a = Math.min(...items.map((x) => x.start)), b = Math.max(...items.map((x) => x.start + x.len));
        S.edit(() => { this.sel = new Set(items.map((x) => { const y = { ...x, id: uid('k'), start: x.start + (b - a) }; l.push(y); return y; })); });
        return true;
      }
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && c) {
      this.S.edit(() => { const l = this.proj.playlist.clips; const i = l.indexOf(c); if (i >= 0) l.splice(i, 1); this.S.selClip = null; });
      return true;
    }
    if (e.ctrlKey && ['d', 'b'].includes(e.key.toLowerCase()) && c) { this.S.edit(() => this.proj.playlist.clips.push({ ...c, id: uid('k'), start: c.start + c.len })); return true; }
    if (e.key.toLowerCase() === 'c' && !e.ctrlKey) { this.tool = this.tool === 'slice' ? 'draw' : 'slice'; this.S.renderPaneBars(); this.draw(); return true; }
    return false;
  }
}

export const songEndBar = (proj) => songBars(proj);
