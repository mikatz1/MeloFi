// On-screen keyboard for the composer: click (or drag across) to play the selected channel.
// Shows which computer keys play which notes, follows the octave shift, lights held notes.
import { h } from './dom.js';
import { keyLabel } from '../../js/keymap.js';

export class Keys {
  constructor(studio, el) {
    this.S = studio;
    this.el = el;
    this.low = 48;     // first note shown
    this.span = 36;    // three octaves
    this.down = null;
    el.addEventListener('pointerdown', (e) => this.press(e));
    el.addEventListener('pointermove', (e) => this.slide(e));
    window.addEventListener('pointerup', () => this.release());
  }

  // computer key labels for the notes the current key map plays
  labels() {
    const app = this.S.app, out = new Map();
    try {
      for (const [code, off] of Object.entries(app.currentMap())) {
        const n = app.noteFor(off, 0);
        if (!out.has(n)) out.set(n, keyLabel(code));
      }
    } catch { /* no map */ }
    return out;
  }

  noteAt(e) {
    const t = e.target.closest('[data-n]');
    return t ? +t.dataset.n : null;
  }

  press(e) {
    const n = this.noteAt(e);
    if (n == null) return;
    e.preventDefault();
    this.el.setPointerCapture?.(e.pointerId);
    const r = e.target.getBoundingClientRect();
    const vel = Math.round(50 + 77 * Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))); // lower on the key = louder
    this.down = { n, vel };
    this.S.liveOn(n, vel);
  }

  slide(e) {
    if (!this.down) return;
    const t = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-n]');
    if (!t) return;
    const n = +t.dataset.n;
    if (n === this.down.n) return;
    this.S.liveOff(this.down.n);
    this.down.n = n;
    this.S.liveOn(n, this.down.vel);
  }

  release() {
    if (!this.down) return;
    this.S.liveOff(this.down.n);
    this.down = null;
  }

  render() {
    const labels = this.labels(), held = this.S.liveHeld || new Set();
    const whites = [], blacks = [];
    const isBlack = (n) => [1, 3, 6, 8, 10].includes(n % 12);
    let wi = 0;
    for (let n = this.low; n < this.low + this.span; n++) {
      if (isBlack(n)) blacks.push({ n, at: wi });
      else { whites.push(n); wi++; }
    }
    const W = 100 / whites.length;
    const key = (n, cls, style) => h('div', { class: `vk ${cls}${held.has(n) ? ' on' : ''}`, 'data-n': n, style },
      h('small', {}, labels.get(n) || ''), n % 12 === 0 ? h('em', {}, `C${n / 12 - 1}`) : null);
    this.el.replaceChildren(
      h('div', { class: 'vk-ctl' },
        h('button', { class: 'btn sm', title: '한 옥타브 아래', onclick: () => { this.low = Math.max(12, this.low - 12); this.render(); } }, '◀'),
        h('span', {}, `C${this.low / 12 - 1}–C${(this.low + this.span) / 12 - 1}`),
        h('button', { class: 'btn sm', title: '한 옥타브 위', onclick: () => { this.low = Math.min(96, this.low + 12); this.render(); } }, '▶')),
      h('div', { class: 'vk-keys' },
        ...whites.map((n, i) => key(n, 'w', `left:${i * W}%;width:${W}%`)),
        ...blacks.map(({ n, at }) => key(n, 'b', `left:${at * W - W * 0.3}%;width:${W * 0.6}%`))));
  }

  // light keys played from the computer keyboard / MIDI as well
  light() {
    const held = this.S.liveHeld || new Set();
    for (const k of this.el.querySelectorAll('.vk')) k.classList.toggle('on', held.has(+k.dataset.n));
  }
}
