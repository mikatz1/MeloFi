// Newtone window: a recorded voice (an audio clip) shown as note blobs over its pitch line, the way
// FL Studio's Newtone does. Drag a blob up/down to change its pitch (snaps to semitones; hold Alt
// for cents), drag its right edge to make it longer or shorter, and set Center (how much of the
// slow drift stays) and Variation (how much vibrato stays). 적용 renders a corrected copy as a new
// clip; the original recording stays in the project.
import { h } from './dom.js';
import { analyse, render, snapAll } from '../newtone.js';
import { SCALES } from '../model.js';
import { encodeWav } from '../../js/recorder.js';
import { addMedia } from '../media.js';

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const LEFT = 44;

export class NewtoneWindow {
  constructor(studio) {
    this.S = studio;
    let head;
    this.el = h('section', { id: 'ntwin', class: 'ch-float', hidden: true },
      h('div', { class: 'sheet-card nt-card' },
        head = h('div', { class: 'sheet-head ch-drag', title: '끌어서 옮기기' }, this.title = h('h2', {}, 'Newtone'), h('button', { class: 'x', 'aria-label': '닫기', onclick: () => this.close() })),
        this.bar = h('div', { class: 'nt-bar' }),
        h('div', { class: 'nt-cvwrap' }, this.cv = h('canvas', { class: 'nt-cv', tabIndex: 0 })),
        this.info = h('div', { class: 'nt-info hint' })));
    head.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      try { head.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
      const r = this.el.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
      const move = (ev) => { this.el.style.left = `${Math.max(0, ev.clientX - dx)}px`; this.el.style.top = `${Math.max(0, ev.clientY - dy)}px`; };
      const up = () => { head.removeEventListener('pointermove', move); head.removeEventListener('pointerup', up); };
      head.addEventListener('pointermove', move); head.addEventListener('pointerup', up);
    });
    this.cv.addEventListener('pointerdown', (e) => this.down(e));
    this.cv.addEventListener('pointermove', (e) => this.move(e));
    this.cv.addEventListener('pointerup', () => this.up());
    this.cv.addEventListener('dblclick', (e) => { const nt = this.hit(e)?.nt; if (nt) { nt.target = nt.median; nt.stretch = 1; this.dirty = true; this.draw(); } });
    this.cv.addEventListener('wheel', (e) => { e.preventDefault(); if (e.ctrlKey) this.zoom = Math.max(1, Math.min(20, this.zoom * (e.deltaY < 0 ? 1.2 : 1 / 1.2))); else this.scroll = Math.max(0, this.scroll + e.deltaY / (this.pxPerSec())); this.draw(); }, { passive: false });
    this.cv.addEventListener('keydown', (e) => {
      if (e.key === 'Delete') return;
      if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && this.sel.size) { e.preventDefault(); for (const nt of this.sel) nt.target += e.key === 'ArrowUp' ? 1 : -1; this.dirty = true; this.draw(); }
      if (e.ctrlKey && e.key.toLowerCase() === 'a') { e.preventDefault(); this.sel = new Set(this.an?.notes || []); this.renderBar(); this.draw(); }
    });
    new ResizeObserver(() => { if (!this.el.hidden) this.draw(); }).observe(this.cv);
    document.body.append(this.el);
    this.sel = new Set();
    this.zoom = 1; this.scroll = 0;
  }

  async open(clip) {
    const S = this.S, p = S.proj, m = p.media[clip.media];
    if (!m) return;
    this.clip = clip;
    this.stopPreview();
    this.el.hidden = false;
    if (!this.el.style.left) { this.el.style.left = `${Math.max(10, innerWidth / 2 - 480)}px`; this.el.style.top = '90px'; }
    this.title.textContent = `Newtone · ${m.name}`;
    this.an = null; this.sel = new Set(); this.zoom = 1; this.scroll = 0;
    this.info.textContent = '음정을 분석하는 중…';
    this.renderBar(); this.draw();
    const { decode } = await import('../media.js');
    this.buf = await decode(clip.media, 48000);
    this.chans = Array.from({ length: Math.min(2, this.buf.numberOfChannels) }, (_, i) => this.buf.getChannelData(i));
    this.an = await analyse(this.buf, { onProgress: (x) => { this.info.textContent = `음정을 분석하는 중… ${Math.round(x * 100)}%`; } });
    this.dirty = false;
    this.info.textContent = this.an.notes.length
      ? `노트 ${this.an.notes.length}개 · 위아래로 끌어 음정 (Alt: 미세하게) · 오른쪽 끝을 끌어 길이 · 더블클릭: 되돌리기 · Ctrl+휠: 확대`
      : '노트를 찾지 못했어요. 목소리나 악기 한 줄만 녹음된 클립에 쓰세요.';
    this.renderBar(); this.draw();
  }

  close() { this.stopPreview(); this.el.hidden = true; }

  targets() { return this.sel.size ? [...this.sel] : this.an?.notes || []; }

  renderBar() {
    const sc = this.S.proj.scale;
    const one = this.targets()[0];
    const slider = (key, label, title) => h('label', { class: 'nt-sl', title }, h('span', {}, label),
      h('input', { type: 'range', min: 0, max: 1, step: 0.01, value: one ? one[key] : key === 'center' ? 0 : 1, disabled: !this.an, oninput: (e) => { for (const nt of this.targets()) nt[key] = +e.target.value; this.dirty = true; this.draw(); } }));
    this.bar.replaceChildren(
      h('button', { class: 'btn sm', disabled: !this.an, title: sc ? `${NAMES[sc.root]} ${SCALES[sc.type]?.name || ''}에 맞춤` : '스케일이 없으면 가장 가까운 반음에 맞춤', onclick: () => { this.snap(); } }, sc ? '스케일에 맞추기' : '반음에 맞추기'),
      slider('center', 'Center', '음이 천천히 흔들리는 것을 음 가운데로 당기는 정도 (0 = 그대로, 1 = 가운데에 고정)'),
      slider('variation', 'Variation', '비브라토 크기 (1 = 그대로, 0 = 없앰)'),
      h('span', { class: 'sp' }, this.sel.size ? `${this.sel.size}개 선택` : '전체에 적용'),
      h('button', { class: 'btn sm ghost', disabled: !this.an, onclick: () => { for (const nt of this.an.notes) { nt.target = nt.median; nt.stretch = 1; nt.center = 0; nt.variation = 1; } this.dirty = true; this.renderBar(); this.draw(); } }, '처음대로'),
      h('button', { class: 'btn sm', disabled: !this.an, onclick: () => (this.preview ? this.stopPreview() : this.listen()) }, this.preview ? '정지' : '듣기'),
      h('button', { class: 'btn sm primary', disabled: !this.an, onclick: () => this.apply() }, '적용'));
  }

  snap() {
    const sc = this.S.proj.scale;
    const notes = this.targets();
    const tmp = { notes };
    snapAll(tmp, sc ? SCALES[sc.type]?.steps : null, sc?.root || 0);
    this.dirty = true;
    this.draw();
  }

  // ---- drawing ----
  pxPerSec() { const W = this.cv.clientWidth - LEFT; return (W / Math.max(0.5, this.buf ? this.buf.duration : 4)) * this.zoom; }
  range() {
    const ns = this.an?.notes || [];
    if (!ns.length) return [55, 72];
    const lo = Math.floor(Math.min(...ns.map((n) => Math.min(n.median, n.target)))) - 3, hi = Math.ceil(Math.max(...ns.map((n) => Math.max(n.median, n.target)))) + 3;
    return [lo, Math.max(hi, lo + 12)];
  }
  // seconds of the original -> seconds of the output timeline (stretched notes push later audio)
  outTime(t) {
    let shift = 0;
    for (const nt of this.an.notes) { if (nt.end <= t) shift += (nt.end - nt.start) * (nt.stretch - 1); else if (nt.start < t) shift += (t - nt.start) * (nt.stretch - 1); }
    return t + shift;
  }
  x(t) { return LEFT + (this.outTime(t) - this.scroll) * this.pxPerSec(); }
  y(m) { const [lo, hi] = this.range(); return this.cv.clientHeight - ((m - lo) / (hi - lo)) * this.cv.clientHeight; }

  draw() {
    const c = this.cv, d = devicePixelRatio || 1, W = c.clientWidth, H = c.clientHeight;
    if (!W || !H) return;
    c.width = W * d; c.height = H * d;
    const g = c.getContext('2d');
    g.setTransform(d, 0, 0, d, 0, 0);
    g.fillStyle = '#131418'; g.fillRect(0, 0, W, H);
    const [lo, hi] = this.range(), rowH = H / (hi - lo);
    const sc = this.S.proj.scale, st = sc ? SCALES[sc.type]?.steps : null;
    for (let m = lo; m < hi; m++) {
      const y = this.y(m + 0.5), pc = ((m % 12) + 12) % 12;
      const black = [1, 3, 6, 8, 10].includes(pc), inSc = !st || st.includes(((m - (sc?.root || 0)) % 12 + 12) % 12);
      g.fillStyle = inSc ? (black ? '#17181d' : '#1b1c22') : '#141519';
      g.fillRect(LEFT, y - rowH / 2, W - LEFT, rowH);
      g.fillStyle = black ? '#2a2b31' : '#d9d6cf'; g.fillRect(0, y - rowH / 2, LEFT - 4, rowH - 1);
      if (pc === 0 || rowH > 12) { g.fillStyle = black ? '#9a978f' : '#3b3a36'; g.font = '9.5px "Segoe UI", sans-serif'; g.fillText(`${NAMES[pc]}${Math.floor(m / 12) - 1}`, 3, y + 3); }
    }
    if (!this.an) return;
    // the sung pitch line (original), then each note's blob at its target with its moved line
    const fr = this.an.frames;
    g.strokeStyle = 'rgba(160,170,190,0.45)'; g.lineWidth = 1; g.beginPath();
    let pen = false;
    for (const f of fr) { if (!f.midi) { pen = false; continue; } const X = this.x(f.t), Y = this.y(f.midi); if (X < LEFT || X > W) { pen = false; continue; } if (pen) g.lineTo(X, Y); else g.moveTo(X, Y); pen = true; }
    g.stroke();
    for (const nt of this.an.notes) {
      const x0 = this.x(nt.start), x1 = this.x(nt.end);
      if (x1 < LEFT || x0 > W) continue;
      const y = this.y(nt.target), sel = this.sel.has(nt), moved = Math.abs(nt.target - nt.median) > 0.01 || nt.stretch !== 1;
      g.fillStyle = sel ? 'rgba(240,190,120,0.9)' : moved ? 'rgba(232,161,93,0.75)' : 'rgba(120,150,210,0.55)';
      roundRect(g, Math.max(LEFT, x0), y - rowH * 0.42, x1 - Math.max(LEFT, x0), rowH * 0.84, Math.min(6, rowH * 0.4));
      g.fill();
      // the note's own motion, moved with it
      g.strokeStyle = sel ? '#2a1a08' : 'rgba(255,255,255,0.7)'; g.beginPath(); pen = false;
      for (let i = nt.a; i < nt.b; i++) { const f = fr[i]; if (!f.midi) continue; const X = this.x(f.t); if (X < LEFT) continue; const Y = this.y(nt.target + (f.midi - nt.median) * nt.variation); if (pen) g.lineTo(X, Y); else g.moveTo(X, Y); pen = true; }
      g.stroke();
      const cents = Math.round((nt.target - Math.round(nt.target)) * 100);
      if (x1 - x0 > 34) { g.fillStyle = sel ? '#2a1a08' : '#fff'; g.font = '10px "Segoe UI", sans-serif'; g.fillText(`${NAMES[((Math.round(nt.target) % 12) + 12) % 12]}${cents ? (cents > 0 ? '+' : '') + cents : ''}`, Math.max(LEFT, x0) + 4, y + 3.5); }
    }
  }

  // ---- editing ----
  pos(e) { const r = this.cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
  hit(e) {
    if (!this.an) return null;
    const [x, y] = this.pos(e), [lo, hi] = this.range(), rowH = this.cv.clientHeight / (hi - lo);
    for (const nt of this.an.notes) {
      const x0 = this.x(nt.start), x1 = this.x(nt.end), yy = this.y(nt.target);
      if (x >= x0 && x <= x1 && Math.abs(y - yy) <= rowH * 0.5) return { nt, edge: x > x1 - 6 };
    }
    return null;
  }
  down(e) {
    this.cv.focus();
    const hit = this.hit(e);
    if (!hit) { if (!e.shiftKey) { this.sel.clear(); this.renderBar(); this.draw(); } return; }
    try { this.cv.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
    if (e.shiftKey) { if (this.sel.has(hit.nt)) this.sel.delete(hit.nt); else this.sel.add(hit.nt); }
    else if (!this.sel.has(hit.nt)) { this.sel = new Set([hit.nt]); }
    const [x, y] = this.pos(e);
    this.drag = { kind: hit.edge ? 'len' : 'pitch', x0: x, y0: y, items: [...this.sel].map((nt) => ({ nt, target: nt.target, stretch: nt.stretch })), fine: e.altKey, hitNt: hit.nt };
    this.renderBar(); this.draw();
  }
  move(e) {
    const d = this.drag;
    if (!d) { const h2 = this.hit(e); this.cv.style.cursor = h2?.edge ? 'ew-resize' : h2 ? 'ns-resize' : 'default'; return; }
    const [x, y] = this.pos(e), [lo, hi] = this.range(), perSemi = this.cv.clientHeight / (hi - lo);
    if (d.kind === 'pitch') {
      const dm = (d.y0 - y) / perSemi;
      for (const it of d.items) it.nt.target = e.altKey ? it.target + dm : Math.round(it.target + dm);
    } else {
      const dur = d.hitNt.end - d.hitNt.start, px = dur * this.pxPerSec();
      for (const it of d.items) it.nt.stretch = Math.max(0.25, Math.min(4, it.stretch * (px + (x - d.x0)) / px));
    }
    this.dirty = true;
    this.draw();
  }
  up() { this.drag = null; }

  // ---- output ----
  rendered() { return render(this.an, this.chans); }

  async listen() {
    this.stopPreview();
    this.info.textContent = '렌더링 중…';
    await new Promise((r) => setTimeout(r, 0));
    const outs = this.rendered(), ctx = this.S.engine.ctx;
    const b = ctx.createBuffer(outs.length, outs[0].length, this.an.sr);
    outs.forEach((o, i) => b.copyToChannel(o, i));
    const src = ctx.createBufferSource(); src.buffer = b; src.connect(ctx.destination); src.start();
    this.preview = src;
    src.onended = () => { if (this.preview === src) { this.preview = null; this.renderBar(); } };
    this.info.textContent = '미리 듣는 중 · 정지하려면 ‘정지’';
    this.renderBar();
  }
  stopPreview() { try { this.preview?.stop(); } catch { /* ended */ } this.preview = null; }

  async apply() {
    const S = this.S, p = S.proj, c = this.clip, m = p.media[c.media];
    this.info.textContent = '렌더링 중…';
    await new Promise((r) => setTimeout(r, 0));
    const outs = this.rendered();
    const wav = encodeWav({ left: outs[0], right: outs[1] || outs[0], rate: this.an.sr });
    const name = `${m.name.replace(/\.[^.]+$/, '')} (Newtone).wav`;
    const hash = await addMedia(p, name, wav);
    p.media[hash].bpm = m.bpm;
    const secPerBar = (60 / p.bpm) * p.sig[0] * (4 / p.sig[1]);
    S.edit(() => { const grow = outs[0].length / this.an.sr - this.buf.duration; c.media = hash; if (Math.abs(grow) > 0.01) c.len = Math.max(0.25, c.len + grow / secPerBar); }, true, 'Newtone');
    S.playlist.peakCache?.delete(hash);
    S.syncAudio();
    this.dirty = false;
    S.status('Newtone: 고친 소리를 새 클립으로 넣었어요. 원래 녹음은 프로젝트 오디오에 남아 있어요.');
    this.close();
  }
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r); g.lineTo(x + w, y + h - r);
  g.quadraticCurveTo(x + w, y + h, x + w - r, y + h); g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r); g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.closePath();
}
