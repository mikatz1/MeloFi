// On-screen keyboard window: plays the window that opened it (MeloFi Studio's selected channel, or
// the piano). Mouse: press / drag across keys. Computer keys while this window is focused:
// A S D F G H J K L ; ' white keys, W E T Y U O P black keys, Z / X octave down / up.
import '../i18n/i18n.js'; // the static text in keys.html follows the language (translateDom)

const api = window.melofi;
const $ = (s) => document.querySelector(s);
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const BLACK = new Set([1, 3, 6, 8, 10]);
const WHITE_KEYS = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon', 'Quote'];
const BLACK_KEYS = { KeyW: 1, KeyE: 3, KeyT: 6, KeyY: 8, KeyU: 10, KeyO: 13, KeyP: 15 };

let low = 48, span = 37, vel = 100;
const held = new Map(); // source -> note

function noteOn(n, src) { if (held.has(src)) noteOff(src); held.set(src, n); api.keysNote({ n, v: vel, on: true }); light(n, true); }
function noteOff(src) { const n = held.get(src); if (n == null) return; held.delete(src); api.keysNote({ n, on: false }); if (![...held.values()].includes(n)) light(n, false); }
function light(n, on) { document.querySelector(`[data-n="${n}"]`)?.classList.toggle('on', on); }

// the note a computer key plays: white keys from C of the lowest octave shown + 1 octave
function keyNote(code) {
  const base = low + 12;
  const w = WHITE_KEYS.indexOf(code);
  if (w >= 0) return base + [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17][w];
  if (code in BLACK_KEYS) return base + BLACK_KEYS[code];
  return null;
}

function render() {
  const kb = $('#kb');
  const whites = [];
  for (let n = low; n < low + span; n++) if (!BLACK.has(n % 12)) whites.push(n);
  const w = 100 / whites.length;
  const labels = new Map();
  for (const c of WHITE_KEYS) labels.set(keyNote(c), c.replace('Key', '').replace('Semicolon', ';').replace('Quote', "'"));
  for (const c of Object.keys(BLACK_KEYS)) labels.set(keyNote(c), c.replace('Key', ''));
  const els = [];
  whites.forEach((n, i) => {
    const el = document.createElement('div');
    el.className = 'wk'; el.dataset.n = n; el.style.left = `${i * w}%`; el.style.width = `${w}%`;
    const s = document.createElement('small');
    s.textContent = labels.get(n) || (n % 12 === 0 ? `C${Math.floor(n / 12) - 1}` : '');
    if (!labels.has(n) && n % 12 === 0) s.className = 'c';
    el.append(s); els.push(el);
  });
  for (let n = low; n < low + span; n++) {
    if (!BLACK.has(n % 12)) continue;
    const i = whites.indexOf(n - 1);
    const el = document.createElement('div');
    el.className = 'bk'; el.dataset.n = n; el.style.left = `${(i + 0.68) * w}%`; el.style.width = `${w * 0.64}%`;
    if (labels.has(n)) { const s = document.createElement('small'); s.textContent = labels.get(n); el.append(s); }
    els.push(el);
  }
  kb.replaceChildren(...els);
  $('#range').textContent = `${NAMES[low % 12]}${Math.floor(low / 12) - 1} – ${NAMES[(low + span - 1) % 12]}${Math.floor((low + span - 1) / 12) - 1}`;
  for (const n of held.values()) light(n, true);
}

function shift(oct) {
  for (const src of [...held.keys()]) noteOff(src);
  low = Math.max(12, Math.min(96, low + 12 * oct));
  render();
}

// mouse: press and drag across keys
const kb = $('#kb');
kb.addEventListener('pointerdown', (e) => {
  const k = e.target.closest('[data-n]'); if (!k) return;
  kb.setPointerCapture(e.pointerId);
  noteOn(+k.dataset.n, `p${e.pointerId}`);
});
kb.addEventListener('pointermove', (e) => {
  if (!held.has(`p${e.pointerId}`)) return;
  const k = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-n]');
  if (k && +k.dataset.n !== held.get(`p${e.pointerId}`)) noteOn(+k.dataset.n, `p${e.pointerId}`);
});
for (const ev of ['pointerup', 'pointercancel']) kb.addEventListener(ev, (e) => noteOff(`p${e.pointerId}`));

// computer keys
window.addEventListener('keydown', (e) => {
  if (e.repeat || e.ctrlKey || e.altKey) return;
  if (e.code === 'KeyZ') { shift(-1); return; }
  if (e.code === 'KeyX') { shift(1); return; }
  const n = keyNote(e.code);
  if (n != null) { e.preventDefault(); noteOn(n, e.code); }
});
window.addEventListener('keyup', (e) => noteOff(e.code));
window.addEventListener('blur', () => { for (const src of [...held.keys()]) noteOff(src); });

$('#down').onclick = () => shift(-1);
$('#up').onclick = () => shift(1);
$('#vel').oninput = (e) => { vel = +e.target.value; $('#velv').textContent = vel; };
new ResizeObserver(render).observe(kb);
render();
