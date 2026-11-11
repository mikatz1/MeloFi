// Motion graphics for the guided tour: each step can show a small looping animation that acts out
// what the step asks for (a cursor clicking steps, a note being drawn, a clip being dragged in, a
// pitch line snapping to the grid…). Everything is drawn on one canvas, so it costs nothing when
// hidden, follows the studio's accent colour and freezes on a still frame for reduced motion.
import { t, N_ } from '../../i18n/i18n.js';

const W = 300, H = 132;
const C = { bg: '#121318', panel: '#191a20', grid: '#1f2027', line: '#2b2c33', txt: '#d6d3cc', dim: '#77756e', blue: '#7fb0ff', green: '#9fd67a', pink: '#e77fb3', purple: '#c8a2ff', teal: '#5fd8d0', red: '#e5534b', white: '#ece9e2' };
let A = '#e8a15d'; // accent, read from the page when a demo starts

// ---------- helpers ----------
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const seg = (p, a, b) => clamp01((p - a) / (b - a));           // progress of p inside [a, b]
const io = (x) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);
const out = (x) => 1 - (1 - x) ** 3;
const lerp = (a, b, x) => a + (b - a) * x;
const hash = (n) => { const s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s); };

function rr(g, x, y, w, h, r, fill, stroke) {
  g.beginPath(); g.roundRect(x, y, Math.max(0, w), Math.max(0, h), r);
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (stroke) { g.strokeStyle = stroke; g.lineWidth = 1; g.stroke(); }
}
function text(g, s, x, y, { color = C.txt, size = 11, weight = 500, align = 'left', font = '"Segoe UI", "Malgun Gothic", sans-serif' } = {}) {
  g.fillStyle = color; g.font = `${weight} ${size}px ${font}`; g.textAlign = align; g.textBaseline = 'middle'; g.fillText(t(s), x, y); // labels below are N_() keys
}
function cursor(g, x, y, down = 0) {
  if (down > 0) { g.beginPath(); g.arc(x, y, 6 + 10 * down, 0, Math.PI * 2); g.strokeStyle = `rgba(232,161,93,${0.6 * (1 - down)})`; g.lineWidth = 2; g.stroke(); }
  g.save(); g.translate(x, y); g.scale(down > 0 && down < 0.4 ? 0.9 : 1, down > 0 && down < 0.4 ? 0.9 : 1);
  g.beginPath(); g.moveTo(0, 0); g.lineTo(0, 15); g.lineTo(4, 11.5); g.lineTo(7, 18); g.lineTo(9.5, 17); g.lineTo(6.5, 10.5); g.lineTo(11.5, 10.5); g.closePath();
  g.fillStyle = C.white; g.fill(); g.strokeStyle = '#000'; g.lineWidth = 1.2; g.stroke(); g.restore();
}
function keycap(g, x, y, label, down, w = 0) {
  const ww = w || Math.max(26, label.length * 7.5 + 14), dy = down ? 2 : 0;
  rr(g, x, y + 4, ww, 26, 5, '#0b0c0f');
  rr(g, x, y + dy, ww, 26, 5, down ? A : '#2a2b32', down ? null : '#3a3b43');
  text(g, label, x + ww / 2, y + 13 + dy, { color: down ? '#1b1308' : C.white, size: 12, weight: 600, align: 'center', font: 'Consolas, "Cascadia Mono", monospace' });
  return ww;
}
function keys(g, list, y, p, pressAt = [0.3, 0.55]) {
  // a chord of keys held together, centred
  const widths = list.map((k) => Math.max(26, k.length * 7.5 + 14));
  const total = widths.reduce((a, b) => a + b, 0) + (list.length - 1) * 16;
  let x = (W - total) / 2;
  const down = p > pressAt[0] && p < pressAt[1];
  list.forEach((k, i) => { keycap(g, x, y, k, down); x += widths[i]; if (i < list.length - 1) text(g, '+', x + 8, y + 13, { color: C.dim, size: 12, align: 'center' }); x += 16; });
  return down;
}
function stepRow(g, x, y, w, h, on, color, lit = 16, head = -1) {
  const cw = w / 16;
  for (let i = 0; i < 16; i++) {
    const isOn = on.has(i) && i < lit;
    const base = Math.floor(i / 4) % 2 ? '#26272e' : '#2e2f37';
    rr(g, x + i * cw + 1, y, cw - 2, h, 2, isOn ? color : base);
    if (i === head) rr(g, x + i * cw + 1, y, cw - 2, h, 2, 'rgba(255,255,255,0.18)');
  }
}
function rollBg(g, x, y, w, h, rows) {
  rr(g, x, y, w, h, 3, '#16171c');
  const rh = h / rows;
  for (let r = 0; r < rows; r++) {
    const black = [1, 3, 6, 8, 10].includes((rows - 1 - r) % 12);
    g.fillStyle = black ? '#131418' : '#1a1b21'; g.fillRect(x + 16, y + r * rh, w - 16, rh - 0.5);
    g.fillStyle = black ? '#1b1c22' : '#d9d6cf'; g.fillRect(x, y + r * rh, 14, rh - 0.5);
  }
  for (let b = 0; b <= 8; b++) { g.fillStyle = b % 4 ? '#22232a' : '#30313a'; g.fillRect(x + 16 + b * (w - 16) / 8, y, 1, h); }
  return { rh, cw: (w - 16) / 8, x0: x + 16 };
}
function note(g, x, y, w, h, color, a = 1) { g.globalAlpha = a; rr(g, x, y, w, h, 2, color); g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x + w - 2, y + 1, 2, h - 2); g.globalAlpha = 1; }
function waveShape(g, x, y, w, h, color, seed = 1, prog = 1, kind = 'wave') {
  g.strokeStyle = color; g.lineWidth = 1; g.beginPath();
  const n = Math.floor(w * prog);
  for (let i = 0; i < n; i += 2) {
    const env = kind === 'kick' ? Math.exp(-((i % 30) / 7)) : 0.35 + 0.65 * Math.abs(Math.sin(i * 0.05 + seed));
    const a = (h / 2 - 1) * env * (0.55 + 0.45 * hash(i + seed * 31));
    g.moveTo(x + i, y + h / 2 - a); g.lineTo(x + i, y + h / 2 + a);
  }
  g.stroke();
}
function clip(g, x, y, w, h, color, label, kind = 'notes', seed = 1, prog = 1) {
  g.globalAlpha = 0.85; rr(g, x, y, w * prog, h, 3, color); g.globalAlpha = 1;
  if (w * prog < 6) return;
  g.save(); g.beginPath(); g.rect(x, y, w * prog, h); g.clip();
  g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x, y, w, 11);
  text(g, label, x + 4, y + 6, { color: '#fff', size: 9 });
  if (kind === 'wave' || kind === 'kick') waveShape(g, x + 3, y + 13, w - 6, h - 15, 'rgba(0,0,0,0.55)', seed, 1, kind);
  else for (let i = 0; i < 6; i++) { g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(x + 4 + i * (w - 8) / 6, y + 14 + ((i * 7 + seed * 3) % (h - 18)), (w - 8) / 8, 2.5); }
  g.restore();
}
function track(g, y, h, name) { rr(g, 6, y, 46, h - 2, 2, '#1d1e24'); text(g, name, 10, y + h / 2 - 1, { color: C.dim, size: 9 }); g.fillStyle = '#17181d'; g.fillRect(54, y, W - 60, h - 2); }
function playhead(g, x, y0, y1) { g.fillStyle = A; g.fillRect(x, y0, 1.5, y1 - y0); }
function panel(g, x, y, w, h, title, on = false) { rr(g, x, y, w, h, 4, on ? '#22232b' : C.panel, on ? A : C.line); if (title) text(g, title, x + 7, y + 9, { color: on ? A : C.dim, size: 9, weight: 600 }); }
function knob(g, x, y, r, v, label) {
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fillStyle = '#26272e'; g.fill(); g.strokeStyle = '#3a3b43'; g.stroke();
  g.beginPath(); g.arc(x, y, r + 3, Math.PI * 0.75, Math.PI * (0.75 + 1.5 * v)); g.strokeStyle = A; g.lineWidth = 2; g.stroke(); g.lineWidth = 1;
  const a = Math.PI * (0.75 + 1.5 * v); g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * r * 0.8, y + Math.sin(a) * r * 0.8); g.strokeStyle = C.white; g.lineWidth = 2; g.stroke(); g.lineWidth = 1;
  if (label) text(g, label, x, y + r + 11, { color: C.dim, size: 9, align: 'center' });
}
function check(g, x, y, s, p) {
  g.strokeStyle = C.green; g.lineWidth = 3; g.lineCap = 'round'; g.beginPath();
  const a = [x - s, y], b = [x - s * 0.3, y + s * 0.7], c = [x + s, y - s * 0.8];
  const p1 = clamp01(p * 2), p2 = clamp01(p * 2 - 1);
  g.moveTo(...a); g.lineTo(lerp(a[0], b[0], p1), lerp(a[1], b[1], p1));
  if (p2 > 0) g.lineTo(lerp(b[0], c[0], p2), lerp(b[1], c[1], p2));
  g.stroke(); g.lineWidth = 1; g.lineCap = 'butt';
}

// a cursor path: list of [time, x, y, click?] keyframes over 0..1
function path(g, p, frames) {
  let i = 0; while (i < frames.length - 1 && p > frames[i + 1][0]) i++;
  const a = frames[i], b = frames[Math.min(i + 1, frames.length - 1)];
  const k = b[0] > a[0] ? io(seg(p, a[0], b[0])) : 1;
  const x = lerp(a[1], b[1], k), y = lerp(a[2], b[2], k);
  let down = 0;
  for (const f of frames) if (f[3] && p >= f[0] && p < f[0] + 0.08) down = (p - f[0]) / 0.08;
  cursor(g, x, y, down);
  return { x, y };
}

// ---------- the demos: (g, p, t) with p = 0..1 through the loop, t = seconds ----------
const D = {
  welcome: { dur: 4, draw(g, p) {
    const bars = [[100, 56, 80], [128, 30, 106], [156, 70, 66]];
    bars.forEach(([x, y, h], i) => { const k = out(seg(p, 0.05 + i * 0.08, 0.35 + i * 0.08)); rr(g, x, y + h * (1 - k), 18, h * k, 9, C.white); });
    rr(g, 94, 112, 86 * out(seg(p, 0.35, 0.6)), 6, 3, A);
    for (let i = 0; i < 13; i++) { const on = p > 0.55 + i * 0.025; g.beginPath(); g.arc(205 + (i % 7) * 12, 64 + Math.floor(i / 7) * 14, 4, 0, Math.PI * 2); g.fillStyle = on ? A : '#2e2f37'; g.fill(); }
    text(g, N_('13강'), 205, 102, { color: C.dim, size: 10 });
  } },
  layout: { dur: 6, draw(g, p) {
    const parts = [[N_('툴바'), 10, 8, 280, 16, 'Space · L'], [N_('채널 랙'), 10, 30, 110, 94, 'F6'], [N_('피아노 롤'), 126, 30, 164, 94, 'F7'], [N_('플레이리스트'), 126, 30, 164, 94, 'F5'], [N_('믹서'), 126, 30, 164, 94, 'F9']];
    const k = Math.max(0, Math.min(parts.length - 1, Math.floor(p * parts.length)));
    parts.forEach(([n, x, y, w, h], i) => { if (i >= 2 && i !== Math.max(2, k)) return; panel(g, x, y, w, h, n, i === k); });
    const [, x, y, w, h, key] = parts[Math.min(k, parts.length - 1)];
    keycap(g, x + w - 60, y + h / 2 - 13, key, (p * parts.length) % 1 > 0.35 && (p * parts.length) % 1 < 0.55, 54);
  } },
  key: { dur: 2.4, draw(g, p, t, o) {
    const down = keys(g, o.keys, 30, p);
    if (o.show) { const k = out(seg(p, 0.45, 0.75)); g.globalAlpha = k; text(g, o.show, W / 2, 88 + (1 - k) * 8, { color: down ? A : C.txt, size: 13, weight: 600, align: 'center' }); g.globalAlpha = 1; }
  } },
  steps: { dur: 5, draw(g, p, t, o) {
    const on = new Set(o.on), list = [...on].sort((a, b) => a - b), x0 = 20, cw = 260 / 16, y = 50;
    const n = list.filter((_, i) => p > 0.1 + i * (0.55 / list.length) + 0.05).length;
    stepRow(g, x0, y, 260, 26, new Set(list.slice(0, n)), o.color || A, 16, p > 0.75 ? Math.floor(seg(p, 0.75, 1) * 16) : -1);
    text(g, o.label || '', x0, 30, { color: C.dim, size: 10 });
    const frames = [[0, 150, 110]]; list.forEach((s, i) => frames.push([0.1 + i * (0.55 / list.length), x0 + s * cw + cw / 2, y + 14, true]));
    frames.push([0.75, 250, 110]);
    path(g, p, frames);
  } },
  stepsDrag: { dur: 4.5, draw(g, p, t, o) {
    const x0 = 20, cw = 260 / 16, y = 50, erase = o.erase;
    const k = seg(p, 0.15, 0.7), upto = Math.floor(k * 12) + 1;
    const set = new Set();
    for (let i = 0; i < 16; i++) { const touched = i < upto && p > 0.15; if (erase ? !touched : touched) set.add(i); }
    stepRow(g, x0, y, 260, 26, set, erase ? C.green : (o.color || C.green));
    text(g, erase ? N_('오른쪽 버튼을 누른 채 드래그') : N_('누른 채 옆으로 드래그'), x0, 30, { color: C.dim, size: 10 });
    const cx = x0 + cw / 2 + Math.min(11, k * 12) * cw;
    cursor(g, cx, y + 14, p > 0.15 && p < 0.7 ? 0.05 : 0);
  } },
  play: { dur: 3, draw(g, p) {
    stepRow(g, 20, 34, 260, 16, new Set([0, 4, 8, 12]), A, 16, Math.floor(p * 16));
    stepRow(g, 20, 54, 260, 16, new Set([4, 12]), C.blue, 16, Math.floor(p * 16));
    stepRow(g, 20, 74, 260, 16, new Set([0, 2, 4, 6, 8, 10, 12, 14]), C.green, 16, Math.floor(p * 16));
    keycap(g, 120, 98, 'Space', p < 0.08, 60);
    const lvl = Math.exp(-((p * 16) % 4) / 1.2); rr(g, 290, 92 - lvl * 58, 4, lvl * 58, 2, C.green);
  } },
  velocity: { dur: 4, draw(g, p) {
    const target = [0.95, 0.5, 0.75, 0.45, 0.9, 0.5, 0.7, 0.4, 0.95, 0.55, 0.8, 0.45, 0.9, 0.5, 0.65, 0.4];
    for (let i = 0; i < 16; i++) { const k = out(seg(p, 0.1 + i * 0.03, 0.35 + i * 0.03)); const v = lerp(0.78, target[i], k); rr(g, 22 + i * 16.2, 112 - v * 80, 12, v * 80, 2, i % 4 === 0 ? A : C.green); }
    keycap(g, 230, 8, 'Ctrl+K', p < 0.12, 58);
  } },
  tempo: { dur: 4, draw(g, p) {
    const bpm = Math.round(lerp(90, 128, io(seg(p, 0.1, 0.6))));
    text(g, `${bpm}`, 90, 62, { color: C.white, size: 34, weight: 600, align: 'center', font: 'Consolas, monospace' });
    text(g, 'BPM', 90, 92, { color: C.dim, size: 11, align: 'center' });
    const beat = (p * 4 * (bpm / 90)) % 2, a = Math.sin(beat * Math.PI) * 0.5;
    g.save(); g.translate(215, 108); g.rotate(a); g.fillStyle = C.line; g.fillRect(-1.5, -72, 3, 72); rr(g, -8, -60, 16, 10, 2, A); g.restore();
    rr(g, 190, 104, 50, 14, 3, '#26272e');
  } },
  rollDraw: { dur: 5.5, draw(g, p) {
    const R = rollBg(g, 10, 8, 280, 116, 10);
    const y = 8 + 4 * R.rh + 1, x = R.x0 + R.cw * 2;
    const grow = io(seg(p, 0.35, 0.6));
    if (p > 0.18 && p < 0.85) note(g, x, y, R.cw * (1 + grow * 1.5), R.rh - 2, A, p > 0.75 ? 1 - seg(p, 0.75, 0.85) : 1);
    path(g, p, [[0, 200, 120], [0.15, x + 6, y + 5, true], [0.35, x + R.cw - 2, y + 5], [0.6, x + R.cw * 2.5 - 2, y + 5], [0.72, x + R.cw, y + 5, true], [0.95, 220, 118]]);
    text(g, p < 0.35 ? N_('클릭: 노트') : p < 0.7 ? N_('끝을 끌기: 길이') : N_('오른쪽 클릭: 지우기'), 280, 120, { color: C.dim, size: 9.5, align: 'right' });
  } },
  tools: { dur: 6, draw(g, p) {
    const T = [['P', 'Draw'], ['B', 'Paint'], ['D', 'Delete'], ['T', 'Mute'], ['C', 'Slice'], ['E', 'Select']];
    const k = Math.floor(p * T.length);
    T.forEach(([key, name], i) => { const x = 14 + i * 47; keycap(g, x, 26, key, i === k && (p * T.length) % 1 < 0.25, 38); text(g, name, x + 19, 70, { color: i === k ? A : C.dim, size: 10, weight: i === k ? 600 : 400, align: 'center' }); });
    const sub = (p * T.length) % 1, R = { x: 20, y: 88 };
    if (k === 1) for (let i = 0; i < Math.floor(sub * 8); i++) note(g, R.x + i * 32, R.y + 12, 28, 10, A);
    else if (k === 0) { if (sub > 0.3) note(g, 120, 100, 50, 10, A); }
    else if (k === 2) { note(g, 120, 100, 50, 10, A, 1 - sub); }
    else if (k === 3) { note(g, 120, 100, 50, 10, sub > 0.3 ? '#4a4b52' : A); }
    else if (k === 4) { note(g, 100, 100, 44, 10, A); note(g, 148, 100, 44, 10, A); if (sub < 0.5) { g.fillStyle = C.white; g.fillRect(146, 94, 1, 22); } }
    else { note(g, 90, 100, 40, 10, A); note(g, 150, 96, 40, 10, A); rr(g, 84, 90, 112 * out(sub), 26, 2, null, A); }
  } },
  scale: { dur: 4, draw(g, p) {
    const R = rollBg(g, 10, 8, 280, 116, 12);
    const inC = [0, 2, 4, 5, 7, 9, 11], k = out(seg(p, 0.15, 0.5));
    for (let r = 0; r < 12; r++) { const pc = 11 - r; if (inC.includes(pc)) { g.fillStyle = `rgba(232,161,93,${0.16 * k})`; g.fillRect(R.x0, 8 + r * R.rh, 264, R.rh - 0.5); } else { g.fillStyle = `rgba(0,0,0,${0.35 * k})`; g.fillRect(R.x0, 8 + r * R.rh, 264, R.rh - 0.5); } }
    rr(g, 200, 14, 80, 20, 3, '#26272e', C.line); text(g, N_('C  메이저'), 240, 24, { color: p > 0.1 ? A : C.dim, size: 10, align: 'center' });
  } },
  chord: { dur: 3.5, draw(g, p) {
    const R = rollBg(g, 10, 8, 280, 116, 12);
    const x = R.x0 + R.cw * 3, rows = [7, 5, 3];
    rows.forEach((r, i) => { const k = out(seg(p, 0.3 + i * 0.05, 0.45 + i * 0.05)); if (k > 0) note(g, x, 8 + r * R.rh + 1 + (1 - k) * 6, R.cw * 1.8, R.rh - 2, A, k); });
    path(g, p, [[0, 230, 118], [0.25, x + 8, 8 + 7 * R.rh + 5, true], [0.9, 240, 116]]);
    keycap(g, 252, 14, 'H', p < 0.15, 28);
  } },
  progression: { dur: 5, draw(g, p) {
    const R = rollBg(g, 10, 8, 280, 116, 14);
    const chords = [[10, 8, 6], [7, 5, 3], [9, 7, 5], [8, 6, 4]], names = [N_('1 · 도'), N_('6 · 라'), N_('4 · 파'), N_('5 · 솔')];
    chords.forEach((rows, b) => { const k = out(seg(p, 0.1 + b * 0.18, 0.22 + b * 0.18)); rows.forEach((r) => k > 0 && note(g, R.x0 + b * R.cw * 2 + 2, 8 + r * R.rh + 1, R.cw * 2 - 4, R.rh - 2, [A, C.blue, C.green, C.pink][b], k)); if (k > 0.5) text(g, names[b], R.x0 + b * R.cw * 2 + 4, 120, { color: C.dim, size: 9 }); });
  } },
  riff: { dur: 5, draw(g, p) {
    const R = rollBg(g, 10, 8, 280, 116, 12);
    const steps = [N_('코드 진행'), N_('아르페지오'), N_('그루브'), N_('변형')];
    const st = Math.min(3, Math.floor(p * 4.4));
    for (let i = 0; i < 12; i++) {
      const settle = out(seg(p, 0.2 + i * 0.02, 0.45 + i * 0.02)), rnd = hash(i + Math.floor(p * 8));
      const row = Math.round(lerp(rnd * 11, [8, 6, 4, 6, 7, 5, 3, 5, 8, 6, 4, 2][i], settle));
      note(g, R.x0 + i * 22 + 2, 8 + row * R.rh + 1, 18, R.rh - 2, settle > 0.95 ? A : '#8b8983');
    }
    steps.forEach((s, i) => { rr(g, 18 + i * 70, 112, 64, 14, 7, i <= st ? A : '#26272e'); text(g, s, 50 + i * 70, 119, { color: i <= st ? '#1b1308' : C.dim, size: 9, weight: 600, align: 'center' }); });
  } },
  ghost: { dur: 3.6, draw(g, p) {
    const R = rollBg(g, 10, 8, 280, 116, 12);
    const k = p < 0.5 ? out(seg(p, 0.1, 0.35)) : 1 - out(seg(p, 0.7, 0.9));
    [[0, 9], [2, 7], [4, 9], [6, 5]].forEach(([b, r]) => note(g, R.x0 + b * R.cw + 2, 8 + r * R.rh + 1, R.cw * 2 - 4, R.rh - 2, C.blue, 0.35 * k));
    [[0, 3], [1, 2], [3, 3], [5, 1]].forEach(([b, r]) => note(g, R.x0 + b * R.cw + 2, 8 + r * R.rh + 1, R.cw - 4, R.rh - 2, A));
    keycap(g, 236, 96, 'Alt+V', p > 0.05 && p < 0.15, 52);
  } },
  browser: { dur: 4, draw(g, p, t, o) {
    const k = io(o.close ? 1 - seg(p, 0.3, 0.6) : seg(p, 0.2, 0.5));
    panel(g, 10 + 100 * k, 10, 280 - 100 * k, 112, N_('채널 랙'));
    g.save(); g.beginPath(); g.rect(10, 10, 96 * k, 112); g.clip();
    panel(g, 10, 10, 94, 112, N_('브라우저'), true);
    ['Drums 128', 'Bass loop', 'Chords Am', 'Lead hook', 'Vox chop'].forEach((n, i) => { rr(g, 16, 26 + i * 18, 82, 14, 2, '#23242b'); text(g, n, 20, 33 + i * 18, { color: C.txt, size: 9 }); });
    g.restore();
    keycap(g, 214, 92, 'Alt+F8', p > 0.15 && p < 0.3, 60);
  } },
  dragDrop: { dur: 5, draw(g, p) {
    panel(g, 6, 8, 80, 116, N_('브라우저'), true);
    ['Drums', 'Bass', 'Chords'].forEach((n, i) => { rr(g, 12, 24 + i * 18, 68, 14, 2, i === 0 && p > 0.15 && p < 0.6 ? '#3a3b43' : '#23242b'); text(g, n, 16, 31 + i * 18, { color: C.txt, size: 9 }); });
    g.fillStyle = '#17181d'; g.fillRect(92, 8, 202, 116);
    for (let i = 0; i < 3; i++) { g.fillStyle = C.line; g.fillRect(92, 44 + i * 30, 202, 1); }
    const k = io(seg(p, 0.2, 0.6)), x = lerp(46, 110, k), y = lerp(31, 22, k);
    if (p > 0.2 && p < 0.62) { g.globalAlpha = 0.8; rr(g, x - 30, y - 7, 70, 14, 2, '#3a3b43'); text(g, 'Drums', x - 26, y, { color: C.white, size: 9 }); g.globalAlpha = 1; }
    if (p >= 0.62) clip(g, 100, 12, 180, 30, A, 'Drums', 'kick', 3, out(seg(p, 0.62, 0.8)));
    path(g, p, [[0, 60, 110], [0.15, 40, 31, true], [0.6, 120, 24], [0.85, 200, 110]]);
  } },
  layers: { dur: 6, draw(g, p) {
    const parts = [['Drums', A, 'kick'], ['Bass', C.blue, 'wave'], ['Chords', C.green, 'wave'], ['Lead', C.pink, 'wave']];
    parts.forEach(([n, col, kind], i) => { track(g, 8 + i * 30, 30, n); const k = out(seg(p, 0.08 + i * 0.15, 0.2 + i * 0.15)); if (k > 0) clip(g, 58, 10 + i * 30, 230, 25, col, n, kind, i + 1, k); });
    if (p > 0.7) playhead(g, 58 + seg(p, 0.7, 1) * 230, 6, 128);
  } },
  starter: { dur: 6, draw(g, p) {
    const genres = [N_('트랩'), N_('하우스'), N_('로파이'), N_('케이팝')];
    genres.forEach((n, i) => { rr(g, 10 + i * 70, 8, 62, 18, 9, i === 1 && p > 0.12 ? A : '#26272e'); text(g, n, 41 + i * 70, 17, { color: i === 1 && p > 0.12 ? '#1b1308' : C.txt, size: 10, weight: 600, align: 'center' }); });
    const parts = [['Drums', A, 'kick'], ['Bass', C.blue], ['Chords', C.green], ['Lead', C.pink]];
    parts.forEach(([n, col, kind], i) => { track(g, 32 + i * 24, 24, n); const k = out(seg(p, 0.2 + i * 0.08, 0.3 + i * 0.08)); const shuffled = i === 3 && p > 0.72; if (k > 0) clip(g, 58, 33 + i * 24, 230, 20, shuffled ? C.purple : col, shuffled ? N_('Lead (셔플)') : n, kind || 'wave', shuffled ? 9 : i + 1, shuffled ? out(seg(p, 0.72, 0.85)) : k); });
    path(g, p, [[0, 150, 128], [0.1, 110, 17, true], [0.55, 200, 128], [0.68, 150, 110, true], [0.95, 220, 128]]);
  } },
  paintClips: { dur: 5, draw(g, p) {
    track(g, 30, 34, 'Track 1'); track(g, 64, 34, 'Track 2');
    const k = seg(p, 0.15, 0.75), n = Math.min(5, Math.floor(k * 5.5) + (p > 0.15 ? 1 : 0));
    for (let i = 0; i < n; i++) clip(g, 58 + i * 46, 32, 44, 29, A, N_('비트'), 'notes', 2);
    cursor(g, 70 + Math.min(4, k * 5) * 46, 46, p > 0.15 && p < 0.75 ? 0.05 : 0);
    keycap(g, 236, 4, 'B', p < 0.12, 28);
  } },
  select: { dur: 5.5, draw(g, p) {
    track(g, 20, 34, 'Track 1'); track(g, 54, 34, 'Track 2');
    const base = [[58, 22, A], [104, 22, A], [58, 56, C.blue], [104, 56, C.blue]];
    const dup = out(seg(p, 0.6, 0.8));
    base.forEach(([x, y, c]) => { clip(g, x, y, 44, 29, c, N_('패턴')); if (dup > 0) { g.globalAlpha = dup; clip(g, x + 92 * dup, y, 44, 29, c, N_('패턴')); g.globalAlpha = 1; } });
    const m = io(seg(p, 0.15, 0.45));
    if (p > 0.15 && p < 0.9) { g.strokeStyle = A; g.setLineDash([3, 3]); g.strokeRect(54, 18, 98 * m, 70 * m); g.setLineDash([]); }
    keycap(g, 200, 100, 'E', p < 0.12, 28); keycap(g, 236, 100, 'Ctrl+B', p > 0.55 && p < 0.65, 56);
  } },
  sliceMute: { dur: 5, draw(g, p) {
    track(g, 30, 34, 'Track 1'); track(g, 64, 34, 'Track 2');
    const cut = p > 0.3; const gap = cut ? 4 * out(seg(p, 0.3, 0.4)) : 0;
    clip(g, 58, 32, cut ? 70 : 140, 29, A, N_('패턴')); if (cut) clip(g, 130 + gap, 32, 68, 29, A, N_('패턴'));
    if (p > 0.2 && p < 0.32) { g.fillStyle = C.white; g.fillRect(128, 28, 1.5, 38); }
    clip(g, 58, 66, 140, 29, p > 0.7 ? '#4a4b52' : C.blue, p > 0.7 ? N_('뮤트됨') : N_('패턴'));
    keycap(g, 220, 34, 'C', p > 0.15 && p < 0.3, 28); keycap(g, 220, 68, 'T', p > 0.6 && p < 0.72, 28);
  } },
  songmode: { dur: 6, draw(g, p) {
    const song = p > 0.5;
    rr(g, 10, 8, 104, 22, 4, '#1d1e24'); rr(g, song ? 62 : 12, 10, 50, 18, 3, A);
    text(g, 'PAT', 37, 19, { color: song ? C.dim : '#1b1308', size: 10, weight: 700, align: 'center' }); text(g, 'SONG', 87, 19, { color: song ? '#1b1308' : C.dim, size: 10, weight: 700, align: 'center' });
    keycap(g, 124, 6, 'L', p > 0.45 && p < 0.55, 28);
    [A, C.blue, C.green].forEach((c, i) => { track(g, 40 + i * 28, 28, [N_('비트'), N_('베이스'), N_('코드')][i]); for (let b = 0; b < 5; b++) if (b >= i) clip(g, 58 + b * 46, 41 + i * 28, 44, 24, c, ''); });
    const x = song ? 58 + seg(p, 0.5, 1) * 230 : 58 + ((p * 2) % 1) * 46;
    playhead(g, x, 36, 128);
    if (!song) { g.fillStyle = 'rgba(232,161,93,0.08)'; g.fillRect(58, 36, 46, 92); }
  } },
  picker: { dur: 5.5, draw(g, p, t, o) {
    panel(g, 8, 8, 120, 116, N_('채널 랙'));
    const added = p > 0.62;
    ['Kick', 'Clap', 'Hat', 'Piano', ...(added ? [o.preset ? 'Super Saw' : 'Strings'] : [])].forEach((n, i) => { const k = i === 4 ? out(seg(p, 0.62, 0.75)) : 1; g.globalAlpha = k; rr(g, 14, 24 + i * 19, 108, 15, 2, i === 4 ? '#3a3b43' : '#23242b'); text(g, n, 18, 31.5 + i * 19, { color: C.txt, size: 9 }); g.globalAlpha = 1; });
    const win = io(seg(p, 0.1, 0.3)) * (1 - seg(p, 0.55, 0.62));
    if (win > 0) {
      g.globalAlpha = win; panel(g, 140, 8 + (1 - win) * 10, 150, 116, o.preset ? N_('신스 프리셋') : N_('플러그인 피커'), true);
      const items = o.preset ? ['Bass · Reese', 'Lead · Super Saw', 'Pad · Warm', 'Pluck · Bell'] : ['Piano', 'Strings', 'Brass', 'Choir'];
      items.forEach((n, i) => { const sel = i === 1 && p > 0.35; rr(g, 146, 26 + i * 22, 138, 18, 2, sel ? A : '#23242b'); text(g, n, 152, 35 + i * 22, { color: sel ? '#1b1308' : C.txt, size: 9.5 }); });
      g.globalAlpha = 1;
    }
    keycap(g, 92, 96, 'F8', p > 0.04 && p < 0.12, 30);
    if (o.preset) { // a waveform morphing between saw and square, like a synth preset changing
      const m = (Math.sin(p * Math.PI * 2) + 1) / 2; g.strokeStyle = C.purple; g.beginPath();
      for (let i = 0; i <= 60; i++) { const ph = (i / 60 * 3) % 1, saw = 1 - 2 * ph, sq = ph < 0.5 ? 1 : -1; g.lineTo(150 + i * 2.2, 112 - lerp(saw, sq, m) * 6); }
      if (win === 0) g.stroke();
    }
  } },
  channelWin: { dur: 5, draw(g, p) {
    panel(g, 8, 8, 120, 116, N_('채널 랙'));
    ['Kick', 'Clap', 'Piano'].forEach((n, i) => { rr(g, 14, 24 + i * 19, 108, 15, 2, i === 2 && p > 0.1 ? '#3a3b43' : '#23242b'); text(g, n, 18, 31.5 + i * 19, { color: C.txt, size: 9 }); });
    const open = out(seg(p, 0.2, 0.35)), drag = io(seg(p, 0.5, 0.8));
    if (open > 0) {
      const x = lerp(120, 150, drag), y = lerp(30, 20, drag);
      g.globalAlpha = open; panel(g, x, y, 138, 96, N_('Piano 설정'), true);
      knob(g, x + 26, y + 40, 11, 0.3 + 0.4 * Math.sin(p * 6) ** 2, 'Attack'); knob(g, x + 68, y + 40, 11, 0.6, 'Cutoff'); knob(g, x + 110, y + 40, 11, 0.4, 'Release');
      g.globalAlpha = 1;
    }
    path(g, p, [[0, 200, 120], [0.1, 60, 70, true], [0.13, 60, 70, true], [0.45, 200, 27], [0.8, 230, 17], [0.95, 240, 110]]);
  } },
  fx: { dur: 5, draw(g, p) {
    panel(g, 8, 8, 100, 116, 'Piano');
    const added = p > 0.35;
    ['1  EQ', added ? '2  Reverb' : N_('2  (비어 있음)'), N_('3  (비어 있음)')].forEach((n, i) => { rr(g, 14, 24 + i * 18, 88, 14, 2, i === 1 && added ? A : '#23242b'); text(g, n, 18, 31 + i * 18, { color: i === 1 && added ? '#1b1308' : C.dim, size: 9 }); });
    // a hit and its tail: dry first, then with a long reverb tail
    const wet = out(seg(p, 0.35, 0.55));
    g.strokeStyle = A; g.beginPath();
    for (let i = 0; i < 170; i++) { const env = Math.exp(-i / lerp(8, 60, wet)); const v = Math.sin(i * 0.9) * env * 30; g.lineTo(118 + i, 66 - v); }
    g.stroke(); text(g, added ? N_('소리 뒤에 잔향이 남아요') : N_('원래 소리'), 120, 112, { color: C.dim, size: 9.5 });
    path(g, p, [[0, 150, 128], [0.2, 50, 49, true], [0.5, 60, 49], [0.95, 160, 128]]);
  } },
  knob: { dur: 3.5, draw(g, p) {
    const v = lerp(0.2, 0.85, io(seg(p, 0.15, 0.6))) * (p > 0.8 ? 1 - seg(p, 0.8, 0.82) * 0.65 : 1);
    knob(g, 110, 62, 26, v, N_('믹스'));
    text(g, `${Math.round(v * 100)}%`, 170, 62, { color: C.white, size: 22, weight: 600, font: 'Consolas, monospace' });
    const y = lerp(80, 40, io(seg(p, 0.15, 0.6)));
    cursor(g, 115, p < 0.75 ? y : 62, p > 0.8 && p < 0.86 ? 0.5 : 0.05);
    text(g, p > 0.78 ? N_('더블클릭: 기본값') : N_('위아래로 드래그'), 150, 110, { color: C.dim, size: 9.5 });
  } },
  sends: { dur: 4, draw(g, p) {
    panel(g, 14, 20, 70, 96, 'Piano'); panel(g, 216, 20, 70, 96, 'Reverb', true);
    knob(g, 49, 70, 12, 0.6, '→ Reverb');
    for (let i = 0; i < 6; i++) { const k = ((p * 2 + i / 6) % 1); g.beginPath(); g.arc(lerp(90, 210, k), 66 + Math.sin(k * Math.PI) * -18, 3, 0, Math.PI * 2); g.fillStyle = A; g.globalAlpha = Math.sin(k * Math.PI); g.fill(); g.globalAlpha = 1; }
  } },
  sidechain: { dur: 3, draw(g, p) {
    text(g, 'Kick', 10, 30, { color: C.dim, size: 9 }); text(g, 'Pad', 10, 84, { color: C.dim, size: 9 });
    for (let i = 0; i < 4; i++) waveShape(g, 40 + i * 64, 14, 30, 32, A, i, 1, 'kick');
    g.strokeStyle = C.blue; g.beginPath();
    for (let x = 0; x < 250; x++) { const ph = (x % 64) / 64, duck = 1 - 0.75 * Math.exp(-ph * 6); const a = 16 * duck; g.moveTo(40 + x, 84 - a * Math.abs(Math.sin(x * 0.7))); g.lineTo(40 + x, 84 + a * Math.abs(Math.sin(x * 0.7))); }
    g.stroke(); playhead(g, 40 + p * 256, 8, 110);
  } },
  automation: { dur: 5, draw(g, p) {
    track(g, 14, 70, 'Cutoff'); const pts = [[60, 74], [120, 30], [180, 60], [270, 22]];
    const k = io(seg(p, 0.05, 0.5)); g.strokeStyle = A; g.lineWidth = 2; g.beginPath();
    pts.forEach(([x, y], i) => { if (i === 0) g.moveTo(x, y); else if (i <= Math.ceil(k * 3)) { const f = Math.min(1, k * 3 - (i - 1)); const [px, py] = pts[i - 1]; g.lineTo(lerp(px, x, f), lerp(py, y, f)); } });
    g.stroke(); g.lineWidth = 1; pts.forEach(([x, y], i) => { if (i <= k * 3) { g.beginPath(); g.arc(x, y, 3.5, 0, Math.PI * 2); g.fillStyle = C.white; g.fill(); } });
    const hx = 60 + seg(p, 0.55, 1) * 210; if (p > 0.55) { playhead(g, hx, 14, 84); let v = 0; for (let i = 1; i < 4; i++) if (hx <= pts[i][0]) { const f = (hx - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0]); v = 1 - (lerp(pts[i - 1][1], pts[i][1], f) - 14) / 70; break; } knob(g, 150, 108, 9, clamp01(v)); }
  } },
  arm: { dur: 2.5, draw(g, p, t) {
    panel(g, 100, 10, 100, 112, 'Vocal');
    const on = p > 0.2; g.beginPath(); g.arc(150, 92, 10, 0, Math.PI * 2); g.fillStyle = on ? C.red : '#26272e'; g.fill();
    if (on) { g.beginPath(); g.arc(150, 92, 10 + 6 * ((t * 1.5) % 1), 0, Math.PI * 2); g.strokeStyle = `rgba(229,83,75,${1 - (t * 1.5) % 1})`; g.stroke(); }
    const lvl = on ? 0.3 + 0.6 * Math.abs(Math.sin(t * 7) * Math.sin(t * 3.1)) : 0; rr(g, 140, 70 - lvl * 44, 20, lvl * 44, 2, C.green);
    text(g, on ? N_('녹음 대기') : '', 150, 115, { color: C.red, size: 9, align: 'center' });
    path(g, p, [[0, 250, 120], [0.15, 154, 96, true], [0.9, 250, 120]]);
  } },
  record: { dur: 4, draw(g, p, t) {
    keycap(g, 10, 10, 'R', p < 0.1, 28);
    g.beginPath(); g.arc(56, 23, 6, 0, Math.PI * 2); g.fillStyle = p < 0.9 && Math.floor(t * 2) % 2 ? C.red : '#5a2a28'; g.fill();
    track(g, 46, 50, 'Vocal');
    clip(g, 58, 48, 230, 44, C.red, N_('녹음'), 'wave', 5, seg(p, 0.08, 0.9));
    playhead(g, 58 + seg(p, 0.08, 0.9) * 230, 44, 98);
  } },
  pitch: { dur: 5, draw(g, p) {
    const R = rollBg(g, 10, 8, 280, 116, 8);
    const snap = io(seg(p, 0.35, 0.6));
    const blobs = [[0, 2.4, 3], [1, 4.7, 5], [2, 3.3, 3], [3, 5.6, 6]];
    blobs.forEach(([b, raw, tgt]) => { const row = lerp(raw, tgt, snap), x = R.x0 + b * R.cw * 1.9 + 2; note(g, x, 8 + row * R.rh + 2, R.cw * 2 - 8, R.rh - 4, snap > 0.95 ? A : C.teal, 0.85);
      g.strokeStyle = 'rgba(255,255,255,0.7)'; g.beginPath(); for (let i = 0; i < R.cw * 2 - 8; i += 2) g.lineTo(x + i, 8 + row * R.rh + R.rh / 2 + Math.sin(i * 0.4) * 3 * (1 - snap * 0.8)); g.stroke(); });
    text(g, snap > 0.95 ? N_('음정이 스케일에 맞춰졌어요') : N_('녹음한 음정'), 286, 120, { color: C.dim, size: 9.5, align: 'right' });
  } },
  keyboard: { dur: 3.5, draw(g, p) {
    const whites = 14, ww = 280 / whites, seq = [0, 2, 4, 5, 4, 2, 0, 7], hit = seq[Math.floor(p * seq.length)];
    for (let i = 0; i < whites; i++) rr(g, 10 + i * ww, 20, ww - 1.5, 92, 2, i === hit ? A : '#e9e6df');
    for (let i = 0; i < whites; i++) if ([0, 1, 3, 4, 5].includes(i % 7)) rr(g, 10 + (i + 0.68) * ww, 20, ww * 0.64, 56, 2, '#17181c');
    ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K'].forEach((k, i) => text(g, k, 10 + (i + 0.5) * ww, 102, { color: i === hit ? '#1b1308' : '#7a776f', size: 9, align: 'center' }));
  } },
  metro: { dur: 2.4, draw(g, p) {
    const beat = Math.floor(p * 4);
    for (let i = 0; i < 4; i++) { g.beginPath(); g.arc(70 + i * 40, 52, i === beat ? 13 : 10, 0, Math.PI * 2); g.fillStyle = i === beat ? (i === 0 ? A : C.white) : '#2a2b32'; g.fill(); text(g, String(i + 1), 70 + i * 40, 52, { color: i === beat ? '#1b1308' : C.dim, size: 11, weight: 700, align: 'center' }); }
    keycap(g, 86, 92, 'Ctrl+M', p < 0.12, 58); keycap(g, 156, 92, 'Ctrl+P', false, 58);
  } },
  quantize: { dur: 4, draw(g, p) {
    const R = rollBg(g, 10, 8, 280, 116, 8), k = io(seg(p, 0.35, 0.6));
    [[0.2, 5], [1.85, 3], [3.15, 4], [4.8, 2], [6.1, 3]].forEach(([b, r]) => { const grid = Math.round(b); note(g, R.x0 + lerp(b, grid, k) * R.cw + 2, 8 + r * R.rh + 1, R.cw - 4, R.rh - 2, k > 0.95 ? A : '#8b8983'); });
    keycap(g, 196, 100, 'Ctrl+Alt+Q', p > 0.25 && p < 0.38, 86);
  } },
  export: { dur: 5, draw(g, p) {
    clip(g, 10, 40, 130, 50, A, N_('내 곡'), 'wave', 2);
    [['WAV', 'Ctrl+R'], ['MP3', 'Ctrl+Shift+R'], ['MIDI', 'Ctrl+Shift+M']].forEach(([n, key], i) => {
      const k = out(seg(p, 0.15 + i * 0.18, 0.35 + i * 0.18)); if (k <= 0) return;
      const x = lerp(140, 166, k), y = 14 + i * 38; g.globalAlpha = k;
      rr(g, x, y, 34, 30, 3, '#26272e', C.line); text(g, n, x + 17, y + 15, { color: C.white, size: 9, weight: 700, align: 'center' });
      text(g, key, x + 42, y + 15, { color: C.dim, size: 9.5, font: 'Consolas, monospace' }); g.globalAlpha = 1;
    });
  } },
  stems: { dur: 5, draw(g, p) {
    const parts = [['Drums', A], ['Bass', C.blue], ['Chords', C.green], ['Lead', C.pink]];
    const k = io(seg(p, 0.25, 0.6));
    parts.forEach(([n, col], i) => { const y = lerp(40 + i * 3, 10 + i * 29, k), x = lerp(20, 20, k); clip(g, x, y, 150, 24, col, n, 'wave', i + 2); if (k > 0.9) { rr(g, 190, y + 2, 92, 20, 3, '#26272e', C.line); text(g, `${n}.wav`, 198, y + 12, { color: C.txt, size: 9.5 }); } });
  } },
  windows: { dur: 6, draw(g, p) {
    rr(g, 6, 6, 288, 120, 4, '#101115', C.line);
    const k = io(seg(p, 0.15, 0.5)) * (1 - io(seg(p, 0.75, 0.95)));
    const P = [[N_('피아노 롤'), [126, 24, 162, 96], [22, 30, 150, 70]], [N_('플레이리스트'), [126, 24, 162, 96], [120, 14, 168, 64]], [N_('믹서'), [126, 24, 162, 96], [150, 66, 136, 56]]];
    panel(g, 12, 24, 108, 96, N_('채널 랙'));
    P.forEach(([n, a, b], i) => { if (k < 0.05 && i > 0) return; const r = a.map((v, j) => lerp(v, b[j], k)); panel(g, r[0], r[1], r[2], r[3], n, i === 1); });
    text(g, k > 0.5 ? N_('떠 있는 창') : N_('붙어 있는 창'), 150, 14, { color: C.dim, size: 9.5, align: 'center' });
  } },
  look: { dur: 6, draw(g, p) {
    const cols = ['#e8a15d', '#7fb0ff', '#9fd67a', '#e77fb3'], c = cols[Math.floor(p * 4)];
    const s = 1 + 0.12 * Math.sin(p * Math.PI * 2);
    g.save(); g.translate(150, 66); g.scale(s, s); g.translate(-150, -66);
    panel(g, 40, 20, 220, 92, '');
    rr(g, 48, 28, 60, 14, 3, c); rr(g, 114, 28, 40, 14, 3, '#26272e'); rr(g, 160, 28, 40, 14, 3, '#26272e');
    stepRow(g, 48, 56, 204, 14, new Set([0, 4, 8, 12]), c); stepRow(g, 48, 76, 204, 14, new Set([4, 12]), c);
    g.restore();
  } },
  resize: { dur: 4, draw(g, p) {
    const x = lerp(110, 170, io((Math.sin(p * Math.PI * 2) + 1) / 2));
    panel(g, 10, 10, x - 14, 112, N_('채널 랙')); panel(g, x + 4, 10, 286 - x, 112, N_('플레이리스트'));
    g.fillStyle = A; g.fillRect(x - 2, 10, 4, 112); cursor(g, x, 70, 0.05);
  } },
  done: { dur: 2.6, draw(g, p) {
    g.beginPath(); g.arc(150, 62, 34, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * out(seg(p, 0, 0.4))); g.strokeStyle = C.green; g.lineWidth = 3; g.stroke(); g.lineWidth = 1;
    check(g, 150, 62, 14, seg(p, 0.35, 0.65));
  } },
};

// One animated illustration inside the tour card
export class Demo {
  constructor() {
    this.c = document.createElement('canvas');
    this.c.className = 'tt-demo';
    this.c.width = W * 2; this.c.height = H * 2;
    this.g = this.c.getContext('2d');
    this.g.scale(2, 2);
    this.raf = 0;
    this.still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  show(spec) {
    cancelAnimationFrame(this.raf);
    const d = spec && D[spec.kind];
    this.c.hidden = !d;
    if (!d) return null;
    A = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || A;
    const t0 = performance.now();
    const frame = (now) => {
      // the first frame's time stamp can be a little before t0: never run a demo at a negative time
      const t = Math.max(0, (now - t0) / 1000), p = this.still ? (spec.still ?? 0.7) : (t % d.dur) / d.dur;
      const g = this.g;
      g.clearRect(0, 0, W, H); rr(g, 0, 0, W, H, 4, C.bg);
      g.save(); d.draw(g, p, t, spec); g.restore();
      if (!this.still && this.c.isConnected && !this.c.hidden) this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
    return this.c;
  }

  stop() { cancelAnimationFrame(this.raf); }
}

export const DEMO_KINDS = Object.keys(D);
