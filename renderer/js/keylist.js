// The keys sounding right now, listed in the top-left corner over the picture: one chip per key in
// the colour it lights up with on the keyboard, low to high, with its note name. A key stays listed a
// moment after it is let go so fast passages can still be read. Off by default (화면 > 누르는 건반 목록).
import { noteName } from './keymap.js';

const HOLD = 0.35;   // seconds a released key stays listed
const MAX = 14;      // chips shown; the rest as "+n"

export class KeyList {
  constructor(stage, { names = () => 'en' } = {}) {
    this.stage = stage;
    this.names = names;
    this.el = document.createElement('div');
    this.el.id = 'keyList';
    this.el.setAttribute('aria-live', 'off');
    this.el.hidden = true;
    document.body.appendChild(this.el);
    this.on = false;
    this.seen = new Map(); // note -> time it was last held (stage clock)
    this.sig = '';
    this.raf = null;
    this.tick = this.tick.bind(this);
  }

  setEnabled(on) {
    this.on = !!on;
    if (!this.on) { cancelAnimationFrame(this.raf); this.raf = null; this.el.hidden = true; this.el.replaceChildren(); this.seen.clear(); this.sig = ''; return; }
    if (!this.raf) this.raf = requestAnimationFrame(this.tick);
  }

  tick() {
    this.raf = this.on ? requestAnimationFrame(this.tick) : null;
    if (!this.on) return;
    const S = this.stage, now = S.time;
    for (const [n, a] of S.active) if (a.off == null) this.seen.set(n, now);
    for (const [n, t] of this.seen) if (now - t > HOLD || now < t) this.seen.delete(n);
    const notes = [...this.seen.keys()].sort((a, b) => a - b);
    const style = this.names();
    const light = !!(S.theme?.paper || (S.theme?.bg && lum(S.theme.bg[0]) > 0.6));
    const sig = `${style}|${light}|${notes.map((n) => `${n}:${S.noteColor(n) || ''}:${S.active.get(n)?.off == null ? 1 : 0}`).join(',')}`;
    if (sig === this.sig) return;
    this.sig = sig;
    this.el.classList.toggle('light', light);
    this.el.hidden = !notes.length;
    const shown = notes.slice(0, MAX);
    const chips = shown.map((n) => {
      const held = S.active.get(n)?.off == null;
      const c = S.noteColor(n) || S.theme?.keyLit || '#ccc';
      const chip = document.createElement('span');
      chip.className = `kl-chip${held ? '' : ' gone'}`;
      const dot = document.createElement('i');
      dot.style.background = c;
      dot.style.boxShadow = light ? 'none' : `0 0 6px ${c}`;
      const name = document.createElement('b');
      name.textContent = noteName(n, style, true);
      chip.append(dot, name);
      return chip;
    });
    if (notes.length > MAX) { const more = document.createElement('span'); more.className = 'kl-more'; more.textContent = `+${notes.length - MAX}`; chips.push(more); }
    this.el.replaceChildren(...chips);
  }
}

// relative luminance of a #rrggbb colour (0..1)
function lum(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(String(hex || ''));
  if (!m) return 0;
  const [r, g, b] = m.slice(1).map((x) => { const v = parseInt(x, 16) / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
