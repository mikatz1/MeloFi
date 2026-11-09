// Canvas renderer: background, rising note bars, particles, bloom, keyboard.
// Everything that ends up in a video recording is drawn here.
import { THEMES } from './themes.js';
import { isBlack } from './keymap.js';
import { GLRenderer } from './gl-renderer.js';

const QUALITY = { off: 0, low: 0.35, medium: 0.65, high: 1, ultra: 1.7 };
const POOL = 24000;
const SPARK = 0, DUST = 1, HAZE = 2, PETAL = 3, EMBER = 4, SNOW = 5, INK = 6;
const BLACK_SHIFT = { 1: -0.07, 3: 0.07, 6: -0.09, 8: 0, 10: 0.09 };
const RANGES = { 88: [21, 108], 61: [36, 96], 49: [36, 84] };

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
// index in a white-key list of the white key at/below (dir -1) or at/above (dir 1) a note
function whiteIndex(wl, n, dir) {
  if (dir < 0) { let i = wl.length - 1; while (i > 0 && wl[i] > n) i--; return i; }
  let i = 0; while (i < wl.length - 1 && wl[i] < n) i++; return i;
}
// a + (b - a) * k for two hex colours
function mixHex(a, b, k) {
  const x = hexToRgb(a), y = hexToRgb(b);
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * k).toString(16).padStart(2, '0')).join('');
}

function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgba = (h, a) => { const [r, g, b] = hexToRgb(h); return `rgba(${r},${g},${b},${a})`; };

function glowSprite(color, size = 64, hot = 0.35) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  const [r, gg, b] = hexToRgb(color);
  const mix = (k) => `rgb(${Math.round(r + (255 - r) * k)},${Math.round(gg + (255 - gg) * k)},${Math.round(b + (255 - b) * k)})`;
  g.addColorStop(0, `rgba(${r},${gg},${b},1)`.replace(/rgba\(([^)]+),1\)/, (_, v) => (hot > 0 ? mix(hot).replace('rgb', 'rgba').replace(')', ',1)') : `rgba(${v},1)`)));
  g.addColorStop(0.18, `rgba(${r},${gg},${b},0.85)`);
  g.addColorStop(0.45, `rgba(${r},${gg},${b},0.28)`);
  g.addColorStop(1, `rgba(${r},${gg},${b},0)`);
  x.fillStyle = g;
  x.fillRect(0, 0, size, size);
  return c;
}

function blotSprite(color, size = 64) {
  // soft-edged ink blot with an uneven rim
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d');
  const [r, g, b] = hexToRgb(color);
  for (let i = 0; i < 7; i++) {
    const ox = size / 2 + rand(-6, 6), oy = size / 2 + rand(-6, 6), rr = rand(size * 0.22, size * 0.42);
    const gr = x.createRadialGradient(ox, oy, 0, ox, oy, rr);
    gr.addColorStop(0, `rgba(${r},${g},${b},0.35)`);
    gr.addColorStop(0.7, `rgba(${r},${g},${b},0.18)`);
    gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
    x.fillStyle = gr;
    x.fillRect(0, 0, size, size);
  }
  return c;
}

function petalSprite(color, size = 48) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d');
  x.translate(size / 2, size / 2);
  const g = x.createLinearGradient(0, -size * 0.4, 0, size * 0.4);
  g.addColorStop(0, '#fff3f8');
  g.addColorStop(1, color);
  x.fillStyle = g;
  x.beginPath();
  // a petal: rounded with a small notch at the tip
  x.moveTo(0, size * 0.38);
  x.bezierCurveTo(size * 0.34, size * 0.18, size * 0.3, -size * 0.3, size * 0.06, -size * 0.38);
  x.lineTo(0, -size * 0.3);
  x.lineTo(-size * 0.06, -size * 0.38);
  x.bezierCurveTo(-size * 0.3, -size * 0.3, -size * 0.34, size * 0.18, 0, size * 0.38);
  x.fill();
  return c;
}

function flakeSprite(size = 32) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(235,245,255,0.7)');
  g.addColorStop(1, 'rgba(220,235,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, size, size);
  return c;
}

function hslHex(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return `#${[f(0), f(8), f(4)].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

// Per-note colour modes. null = use the theme.
const SPLIT_POINT = 60;
const NOTE_COLORS = {
  theme: () => null,
  rainbow: (n) => hslHex(((n % 12) * 30 + 220) % 360, 85, 70),
  split: (n) => (n < SPLIT_POINT ? '#7fb0ff' : '#ffb27a'),
};

export class Stage {
  // size: { w, h } in device pixels for an off-screen stage (video rendering); offline: no load shedding
  constructor(canvas, { gpu = true, size = null } = {}) {
    this.c = canvas;
    this.fixed = size; // (this.size is the particle-size array)
    // GPU (WebGL2) when asked for and available; Canvas2D otherwise
    this.glr = gpu ? GLRenderer.create(canvas) : null;
    this.ctx = this.glr ? null : canvas.getContext('2d', { alpha: false });
    this.staticDirty = true;
    this.fx = document.createElement('canvas');
    this.fxx = this.fx.getContext('2d');
    this.b1 = document.createElement('canvas');
    this.b2 = document.createElement('canvas');
    this.opts = { visualizer: true, particles: 'high', bloom: true, speed: 1, labels: 'keys', range: 88, noteColor: 'theme', barWidth: 1, bgDim: 0.55 };
    this.spriteCache = new Map();
    this.bgImg = null;
    this.theme = THEMES.midnight;
    this.labels = new Map();

    this.active = new Map();
    this.inkQueue = [];
    this.noteColors = new Map();
    this.heat = new Map(); // note -> { v, t }: how hard a key is being hammered right now
    // extra effects (settings: fxExtra) — see fxNote / stepFx / fxShapes
    this.fxs = { pulse: 0, intensity: 64, rings: [], beams: new Map(), flash: null, shake: 0, recent: [] };
    this.fxNow = null;
    this.pedal = false;
    this.ringing = new Set(); // notes still sounding, held or carried by the pedal
    this.bars = [];
    this.wisps = [];

    this.n = 0;
    this.px = new Float32Array(POOL); this.py = new Float32Array(POOL);
    this.vx = new Float32Array(POOL); this.vy = new Float32Array(POOL);
    this.life = new Float32Array(POOL); this.max = new Float32Array(POOL);
    this.size = new Float32Array(POOL); this.seed = new Float32Array(POOL);
    this.rot = new Float32Array(POOL); this.vr = new Float32Array(POOL);
    this.kind = new Uint8Array(POOL); this.col = new Uint8Array(POOL);

    this.time = performance.now() / 1000;
    this.load = 1;
    this.slow = 0;
    this.ambientAcc = 0;
    this.makeSprites();
    this.layout();
  }

  // ---------- configuration ----------

  setTheme(id, custom) {
    this.theme = (id === 'custom' && custom) ? custom : THEMES[id] || THEMES.midnight;
    this.makeSprites();
    this.renderStatic();
  }

  setOptions(o) {
    const changed = (k) => k in o && o[k] !== this.opts[k];
    const relayout = changed('range') || changed('visualizer') || changed('zoom') || changed('fit') || (changed('center') && (o.zoom ?? this.opts.zoom) > 1);
    Object.assign(this.opts, o);
    if (relayout) this.layout();
    else if ('labels' in o || 'bgDim' in o || 'stream' in o) this.renderStatic();
  }

  setBackground(url) {
    if (!url) { this.bgImg = null; this.renderStatic(); return; }
    const img = new Image();
    img.onload = () => { this.bgImg = img; this.renderStatic(); };
    img.onerror = () => { this.bgImg = null; this.renderStatic(); };
    img.src = url;
  }

  // colour for a note, or null for theme colours
  colorOf(note) { return (NOTE_COLORS[this.opts.noteColor] || NOTE_COLORS.theme)(note); }

  glow(color, size, hot) {
    const k = `${color}|${size}|${hot}`;
    let s = this.spriteCache.get(k);
    if (!s) { s = glowSprite(color, size, hot); this.spriteCache.set(k, s); }
    return s;
  }

  // spark sprite index for a note: theme palette (0..3) or a per-note colour slot
  // colour for a note on screen: the score line's colour if it has one, else the note-colour setting
  noteColor(note) { return this.noteColors.get(note) || this.colorOf(note); }

  sparkIndex(note) {
    const c = this.noteColor(note);
    // score hands keep their own colour; the note-colour setting still mixes in some theme sparks
    if (!c || (!this.noteColors.has(note) && Math.random() < 0.25)) return (Math.random() * this.theme.spark.length) | 0;
    let i = this.extraSparks.indexOf(c);
    if (i < 0) { this.extraSparks.push(c); this.sp.spark.push(glowSprite(c, 32, 0.45)); i = this.extraSparks.length - 1; }
    return this.theme.spark.length + i;
  }

  fullRange() { return RANGES[this.opts.range] || RANGES[88]; }

  // most zoomed-in step that still shows every key from lo to hi, plus a key either side
  fitZoom(lo, hi, steps) {
    const [rlo, rhi] = RANGES[this.opts.range] || RANGES[88];
    let all = 0, need = 0;
    for (let n = rlo; n <= rhi; n++) if (!isBlack(n)) { all++; if (n >= lo - 2 && n <= hi + 2) need++; }
    let best = 1;
    for (const z of steps) if (Math.max(10, Math.min(all, Math.round(all / z))) >= need) best = Math.max(best, z);
    return best;
  }

  // arcade theme: a particle snapped onto the pixel grid -> [centre x, centre y, half size]
  pixel(x, y, s) {
    const P = this.P, side = P * (s > 1.6 * this.dpr ? 2 : 1);
    return [Math.floor(x / P) * P + side / 2, Math.floor(y / P) * P + side / 2, side / 2];
  }

  // arcade theme: a note bar on the pixel grid -> [x, y, w, h]
  pixelBar(cx, w, yTop, yBot) {
    const P = this.P, pw = Math.max(P, Math.round(w / P) * P);
    const x = Math.round((cx - pw / 2) / P) * P, y0 = Math.floor(yTop / P) * P;
    return [x, y0, pw, Math.max(P, Math.ceil(yBot / P) * P - y0)];
  }

  // colour slot for mist, dust and wisps: 0 = theme colours, n = this.tints[n - 1] (a note's own colour)
  tintIndex(note) {
    const c = this.noteColor(note);
    if (!c) return 0;
    let i = this.tints.findIndex((x) => x.key === c);
    if (i < 0) {
      const t = this.theme;
      this.tints.push({
        key: c,
        haze: mixHex(mixHex(c, '#000000', 0.4), t.haze, 0.25),
        dust: mixHex(c, t.dust, 0.2),
        wisp: mixHex(c, '#ffffff', 0.35),
      });
      i = this.tints.length - 1;
    }
    return i + 1;
  }

  setLabels(map) {
    this.labels = map;
    this.renderStatic();
  }

  makeSprites() {
    const t = this.theme;
    this.extraSparks = [];
    this.tints = [];
    this.spriteCache?.clear();
    this.sp = {
      spark: t.spark.map((c, i) => glowSprite(c, 32, i === 0 ? 0 : 0.45)),
      dust: glowSprite(t.dust, 32, 0.2),
      haze: glowSprite(t.haze, 128, 0),
      hit: glowSprite(t.hit, 128, 0.6),
      barGlow: glowSprite(t.barGlow, 64, 0),
      keyLit: glowSprite(t.keyLit, 128, 0.3),
      petal: petalSprite(t.spark[3] || '#ff8fbd'),
      flake: flakeSprite(),
      blot: [blotSprite(t.spark[0]), blotSprite(t.spark[1]), blotSprite(t.spark[3])],
    };
  }

  layout() {
    // an off-screen stage is laid out as if on a 1080p screen, scaled up (so 4K looks like 1080p, only sharper)
    const dpr = this.fixed ? this.fixed.h / 1080 : Math.min(2, window.devicePixelRatio || 1);
    const cw = this.fixed ? this.fixed.w / dpr : this.c.clientWidth || window.innerWidth;
    const ch = this.fixed ? this.fixed.h / dpr : this.c.clientHeight || window.innerHeight;
    const W = Math.max(2, Math.round(cw * dpr) & ~1);
    const H = Math.max(2, Math.round(ch * dpr) & ~1);
    this.dpr = dpr;
    this.W = W; this.H = H;
    for (const cv of [this.c, this.fx]) { cv.width = W; cv.height = H; }
    this.b1.width = Math.max(2, W >> 2); this.b1.height = Math.max(2, H >> 2);
    this.b2.width = Math.max(2, W >> 3); this.b2.height = Math.max(2, H >> 3);

    let [lo, hi] = RANGES[this.opts.range] || RANGES[88];
    // zoom: show fewer, bigger keys around the range being played
    const zoom = this.opts.zoom || 1;
    if (zoom > 1) {
      const wl = [];
      for (let n = lo; n <= hi; n++) if (!isBlack(n)) wl.push(n);
      const count = Math.max(10, Math.min(wl.length, Math.round(wl.length / zoom)));
      let start;
      const fit = this.opts.fit;
      if (fit) {
        // a loaded score: centre the window on the score's whole range
        const ia = whiteIndex(wl, fit[0], -1), ib = whiteIndex(wl, fit[1], 1);
        start = clamp(Math.round((ia + ib + 1) / 2 - count / 2), 0, wl.length - count);
      } else {
        const c = this.opts.center ?? 66;
        let ci = wl.findIndex((n) => n >= c);
        if (ci < 0) ci = wl.length - 1;
        start = clamp(ci - Math.floor(count / 2), 0, wl.length - count);
      }
      lo = wl[start];
      hi = wl[start + count - 1];
    }
    this.lo = lo; this.hi = hi;
    let whites = 0;
    for (let n = lo; n <= hi; n++) if (!isBlack(n)) whites++;
    const vis = this.opts.visualizer;
    const grow = 1 + (Math.min(zoom, 3) - 1) * 0.3;
    this.kbH = Math.round(vis ? clamp(H * 0.19 * grow, 84 * dpr, Math.max(210 * dpr, H * 0.34)) : clamp(H * 0.42, 120 * dpr, 330 * dpr * grow));
    this.top = vis ? H - this.kbH : Math.round((H - this.kbH) * 0.62);
    this.ww = W / whites;
    this.bw = this.ww * 0.58;
    this.P = Math.max(3, Math.round(this.ww * 0.11)); // pixel size for the arcade theme
    this.bh = this.kbH * 0.63;
    this.keys = [];
    let wi = 0;
    for (let n = lo; n <= hi; n++) {
      if (!isBlack(n)) {
        this.keys[n] = { x: wi * this.ww, w: this.ww, black: false };
        wi++;
      } else {
        const x = wi * this.ww - this.bw / 2 + (BLACK_SHIFT[n % 12] || 0) * this.ww;
        this.keys[n] = { x, w: this.bw, black: true };
      }
      this.keys[n].cx = this.keys[n].x + this.keys[n].w / 2;
    }
    this.renderStatic();
  }

  // ---------- cached layers ----------

  renderStatic() {
    if (!this.keys) return;
    this.staticDirty = true; // GPU path re-uploads these layers on the next frame
    const { W, H, dpr, theme: t, top } = this;

    // background
    const bg = (this.bgC ||= document.createElement('canvas'));
    bg.width = W; bg.height = H;
    const b = bg.getContext('2d');
    const g = b.createLinearGradient(0, 0, 0, top);
    g.addColorStop(0, t.bg[0]);
    g.addColorStop(0.65, t.bg[1]);
    g.addColorStop(1, t.bg[2]);
    b.fillStyle = g;
    b.fillRect(0, 0, W, H);
    if (t.paper) this.paintPaper(b, W, top);
    if (this.bgImg) {
      // cover-fit the user's picture over the play area, then dim it so the light still reads
      const img = this.bgImg;
      const s = Math.max(W / img.naturalWidth, top / img.naturalHeight);
      const iw = img.naturalWidth * s, ih = img.naturalHeight * s;
      b.drawImage(img, (W - iw) / 2, (top - ih) / 2, iw, ih);
      b.fillStyle = `rgba(0,0,0,${this.opts.bgDim})`;
      b.fillRect(0, 0, W, top);
      const fade = b.createLinearGradient(0, top * 0.6, 0, top);
      fade.addColorStop(0, 'rgba(0,0,0,0)');
      fade.addColorStop(1, t.bg[2]);
      b.fillStyle = fade;
      b.fillRect(0, top * 0.6, W, top * 0.4);
    }
    if (this.opts.visualizer) {
      // octave lanes
      b.fillStyle = t.lane;
      for (let n = this.lo; n <= this.hi; n++) {
        if (n % 12 === 0 || n % 12 === 5) b.fillRect(Math.round(this.keys[n].x), 0, Math.max(1, dpr), top);
      }
      // light pooling just above the keys
      const pool = b.createLinearGradient(0, top - H * 0.25, 0, top);
      pool.addColorStop(0, rgba(t.haze, 0));
      pool.addColorStop(1, rgba(t.haze, t.blend === 'lighter' ? 0.12 : 0.05));
      b.fillStyle = pool;
      b.fillRect(0, top - H * 0.25, W, H * 0.25);
    }
    if (t.pixel) {
      // CRT scanlines
      b.fillStyle = 'rgba(0,0,0,0.3)';
      const step = Math.max(2, Math.round(3 * dpr)), lw = Math.max(1, Math.round(dpr));
      for (let y = 0; y < top; y += step) b.fillRect(0, y, W, lw);
    }
    // grain to stop gradient banding (not when streaming: noise is what video compression handles worst)
    if (!this.opts.stream) {
      const img = b.getImageData(0, 0, W, Math.max(1, top));
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const k = (Math.random() - 0.5) * 5;
        d[i] += k; d[i + 1] += k; d[i + 2] += k;
      }
      b.putImageData(img, 0, 0);
    }

    // keys
    const kh = this.kbH;
    const wc = (this.whiteC ||= document.createElement('canvas'));
    const bc = (this.blackC ||= document.createElement('canvas'));
    wc.width = bc.width = W;
    wc.height = bc.height = kh;
    const w = wc.getContext('2d');
    const k = bc.getContext('2d');
    k.clearRect(0, 0, W, kh);
    w.fillStyle = '#000';
    w.fillRect(0, 0, W, kh);
    const gap = Math.max(1, dpr);
    const rad = 3 * dpr;
    const fontPx = (sz) => `${Math.round(sz)}px "Segoe UI Variable Text","Segoe UI","Malgun Gothic",sans-serif`;
    const showLabels = this.opts.labels !== 'none' && !this.opts.stream;
    if (t.keys === 'ink') { this.paintInkKeys(w, k, kh, showLabels, fontPx); return; }
    if (t.keys === 'pixel') { this.paintPixelKeys(w, k, kh, showLabels); return; }
    for (let n = this.lo; n <= this.hi; n++) {
      const key = this.keys[n];
      if (key.black) continue;
      const x = key.x + gap / 2, ww = key.w - gap;
      const gr = w.createLinearGradient(0, 0, 0, kh);
      gr.addColorStop(0, t.white[1]);
      gr.addColorStop(0.08, t.white[0]);
      gr.addColorStop(0.92, t.white[0]);
      gr.addColorStop(1, t.white[1]);
      w.fillStyle = gr;
      w.beginPath();
      w.roundRect(x, -rad, ww, kh + rad - gap, rad);
      w.fill();
      // left edge highlight, right edge shade
      w.fillStyle = 'rgba(255,255,255,0.35)';
      w.fillRect(x, 0, Math.max(1, dpr * 0.75), kh - rad);
      w.fillStyle = 'rgba(0,0,0,0.07)';
      w.fillRect(x + ww - dpr, 0, dpr, kh - rad);
      if (showLabels && this.labels.has(n)) {
        w.fillStyle = 'rgba(30,28,26,0.55)';
        w.font = fontPx(clamp(ww * 0.42, 8 * dpr, 13 * dpr));
        w.textAlign = 'center';
        w.textBaseline = 'alphabetic';
        w.fillText(this.labels.get(n), x + ww / 2, kh - 9 * dpr);
      }
    }
    // shadow cast by the felt / black keys onto the whites
    const sh = w.createLinearGradient(0, 0, 0, 12 * dpr);
    sh.addColorStop(0, 'rgba(0,0,0,0.55)');
    sh.addColorStop(1, 'rgba(0,0,0,0)');
    w.fillStyle = sh;
    w.fillRect(0, 0, W, 12 * dpr);

    for (let n = this.lo; n <= this.hi; n++) {
      const key = this.keys[n];
      if (!key.black) continue;
      const x = key.x, bw = key.w, bh = this.bh;
      // drop shadow
      k.fillStyle = 'rgba(0,0,0,0.35)';
      k.beginPath(); k.roundRect(x + dpr * 1.5, 0, bw, bh + dpr * 3, rad); k.fill();
      const gr = k.createLinearGradient(x, 0, x + bw, 0);
      gr.addColorStop(0, t.black[1]);
      gr.addColorStop(0.18, t.black[0]);
      gr.addColorStop(0.82, t.black[0]);
      gr.addColorStop(1, t.black[1]);
      k.fillStyle = gr;
      k.beginPath(); k.roundRect(x, -rad, bw, bh + rad, rad); k.fill();
      // front lip
      const lip = k.createLinearGradient(0, bh - bh * 0.1, 0, bh);
      lip.addColorStop(0, 'rgba(255,255,255,0.05)');
      lip.addColorStop(1, 'rgba(255,255,255,0.16)');
      k.fillStyle = lip;
      k.fillRect(x + bw * 0.12, bh - bh * 0.1, bw * 0.76, bh * 0.1 - dpr);
      // glossy top strip
      k.fillStyle = 'rgba(255,255,255,0.06)';
      k.fillRect(x + bw * 0.2, 0, bw * 0.12, bh * 0.82);
      if (showLabels && this.labels.has(n)) {
        k.fillStyle = 'rgba(235,232,225,0.6)';
        k.font = fontPx(clamp(bw * 0.5, 7 * dpr, 11 * dpr));
        k.textAlign = 'center';
        k.fillText(this.labels.get(n), x + bw / 2, bh - bh * 0.14);
      }
    }
  }

  // ---------- themed keyboards ----------

  // 먹: keys of rice paper, crisp ink lines between them, black keys in solid ink with
  // dry-brush streaks inside. Seeded, so it looks the same every time.
  paintInkKeys(w, k, kh, showLabels, fontPx) {
    const d = this.dpr, W = this.W, bh = this.bh;
    let seed = 11;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    w.fillStyle = '#efe7d6';
    w.fillRect(0, 0, W, kh);
    for (let i = 0; i < 40; i++) {
      const x = r() * W, y = r() * kh, rr = (30 + r() * 120) * d;
      const g = w.createRadialGradient(x, y, 0, x, y, rr);
      g.addColorStop(0, r() < 0.5 ? 'rgba(150,125,90,0.05)' : 'rgba(255,253,246,0.12)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      w.fillStyle = g;
      w.fillRect(x - rr, y - rr, rr * 2, rr * 2);
    }
    w.lineCap = 'round';
    for (let i = 0, n = Math.round((W * kh) / (700 * d * d)); i < n; i++) {
      const x = r() * W, y = r() * kh, len = (5 + r() * 22) * d, a = r() * Math.PI * 2;
      w.strokeStyle = r() < 0.6 ? `rgba(150,130,100,${0.05 + r() * 0.08})` : `rgba(255,255,250,${0.1 + r() * 0.15})`;
      w.lineWidth = (0.4 + r() * 0.8) * d;
      w.beginPath();
      w.moveTo(x, y);
      w.quadraticCurveTo(x + Math.cos(a + 0.6) * len * 0.5, y + Math.sin(a + 0.6) * len * 0.5, x + Math.cos(a) * len, y + Math.sin(a) * len);
      w.stroke();
    }
    // a wash of ink under the felt
    const sh = w.createLinearGradient(0, 0, 0, 16 * d);
    sh.addColorStop(0, 'rgba(40,30,22,0.45)');
    sh.addColorStop(1, 'rgba(40,30,22,0)');
    w.fillStyle = sh;
    w.fillRect(0, 0, W, 16 * d);
    // a clean ink line down each gap
    const lw = Math.max(1, Math.round(1.5 * d));
    const brush = (x) => {
      w.fillStyle = '#1a1612';
      w.fillRect(Math.round(x - lw / 2), 0, lw, kh);
    };
    let first = true;
    for (let n = this.lo; n <= this.hi; n++) {
      const key = this.keys[n];
      if (key.black) continue;
      if (!first) brush(key.x);
      first = false;
      if (showLabels && this.labels.has(n)) {
        w.fillStyle = 'rgba(25,20,15,0.6)';
        w.font = fontPx(clamp(key.w * 0.42, 8 * d, 13 * d));
        w.textAlign = 'center';
        w.textBaseline = 'alphabetic';
        w.fillText(this.labels.get(n), key.x + key.w / 2, kh - 9 * d);
      }
    }
    for (let n = this.lo; n <= this.hi; n++) {
      const key = this.keys[n];
      if (!key.black) continue;
      const x = key.x, bw = key.w;
      // body: solid ink, crisp edges
      k.fillStyle = '#16130f';
      k.fillRect(Math.round(x), 0, Math.round(bw), Math.round(bh));
      // dry-brush streaks
      for (let i = 0, n2 = 3 + ((r() * 3) | 0); i < n2; i++) {
        const sx = x + bw * (0.15 + r() * 0.7);
        k.strokeStyle = `rgba(95,84,70,${0.12 + r() * 0.12})`;
        k.lineWidth = (0.5 + r() * 0.8) * d;
        k.beginPath();
        k.moveTo(sx, bh * r() * 0.2);
        k.lineTo(sx + (r() - 0.5) * d, bh * (0.55 + r() * 0.4));
        k.stroke();
      }
      // a wet sheen
      const gl = k.createLinearGradient(x, 0, x + bw, 0);
      gl.addColorStop(0, 'rgba(255,250,240,0)');
      gl.addColorStop(0.3, 'rgba(255,250,240,0.06)');
      gl.addColorStop(0.45, 'rgba(255,250,240,0)');
      k.fillStyle = gl;
      k.fillRect(x, 0, bw, bh * 0.85);
      if (showLabels && this.labels.has(n)) {
        k.fillStyle = 'rgba(240,232,215,0.55)';
        k.font = fontPx(clamp(bw * 0.5, 7 * d, 11 * d));
        k.textAlign = 'center';
        k.fillText(this.labels.get(n), x + bw / 2, bh - bh * 0.14);
      }
    }
  }

  // 아케이드: flat colours, hard edges, chunky bevels (lit top-left, shaded bottom-right)
  paintPixelKeys(w, k, kh, showLabels) {
    const W = this.W, bh = Math.round(this.bh);
    const P = Math.max(2, Math.round(this.P * 0.75));
    const gap = Math.max(1, Math.round(P / 2));
    const font = (sz) => `bold ${Math.round(sz)}px "Cascadia Mono", Consolas, monospace`;
    w.fillStyle = '#1b1528';
    w.fillRect(0, 0, W, kh);
    for (let n = this.lo; n <= this.hi; n++) {
      const key = this.keys[n];
      if (key.black) continue;
      const x0 = Math.round(key.x) + gap, x1 = Math.round(key.x + key.w) - gap, ww = x1 - x0;
      w.fillStyle = '#e6e1ef'; w.fillRect(x0, 0, ww, kh);
      w.fillStyle = '#ffffff'; w.fillRect(x0, 0, P, kh - 2 * P);
      w.fillStyle = '#b4adc6'; w.fillRect(x1 - P, 0, P, kh - 2 * P);
      w.fillStyle = '#a39cb8'; w.fillRect(x0, kh - 2 * P, ww, 2 * P);
      if (showLabels && this.labels.has(n)) {
        w.fillStyle = '#5a5270';
        w.font = font(clamp(ww * 0.42, 8 * this.dpr, 13 * this.dpr));
        w.textAlign = 'center';
        w.textBaseline = 'alphabetic';
        w.fillText(this.labels.get(n), x0 + ww / 2, kh - 2 * P - 6 * this.dpr);
      }
    }
    // the felt's shadow, as two hard bands
    w.fillStyle = '#2a2140'; w.fillRect(0, 0, W, P);
    w.fillStyle = 'rgba(0,0,0,0.22)'; w.fillRect(0, P, W, P);
    for (let n = this.lo; n <= this.hi; n++) {
      const key = this.keys[n];
      if (!key.black) continue;
      const x = Math.round(key.x), bw = Math.round(key.w);
      k.fillStyle = 'rgba(0,0,0,0.45)'; k.fillRect(x + P, 0, bw, bh + P);
      k.fillStyle = '#2b2340'; k.fillRect(x, 0, bw, bh);
      k.fillStyle = '#4d4170'; k.fillRect(x, 0, P, bh - P);
      k.fillStyle = '#171126'; k.fillRect(x + bw - P, 0, P, bh - P);
      k.fillStyle = '#5d5185'; k.fillRect(x, bh - P, bw, P);
      if (showLabels && this.labels.has(n)) {
        k.fillStyle = '#b9b0d6';
        k.font = font(clamp(bw * 0.5, 7 * this.dpr, 11 * this.dpr));
        k.textAlign = 'center';
        k.fillText(this.labels.get(n), x + bw / 2, bh - P - 5 * this.dpr);
      }
    }
  }

  // hanji: mottled tone, scattered fibres, a soft warm vignette
  paintPaper(b, W, H) {
    const d = this.dpr;
    let seed = 7;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 90; i++) {
      const x = r() * W, y = r() * H, rr = (60 + r() * 220) * d;
      const g = b.createRadialGradient(x, y, 0, x, y, rr);
      g.addColorStop(0, r() < 0.4 ? 'rgba(140,120,90,0.022)' : 'rgba(255,252,244,0.07)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      b.fillStyle = g;
      b.fillRect(x - rr, y - rr, rr * 2, rr * 2);
    }
    b.lineCap = 'round';
    const n = Math.round((W * H) / (900 * d * d));
    for (let i = 0; i < n; i++) {
      const x = r() * W, y = r() * H, len = (6 + r() * 28) * d, a = r() * Math.PI * 2;
      b.strokeStyle = r() < 0.6 ? `rgba(150,130,100,${0.05 + r() * 0.08})` : `rgba(255,255,250,${0.1 + r() * 0.15})`;
      b.lineWidth = (0.4 + r() * 0.9) * d;
      b.beginPath();
      b.moveTo(x, y);
      b.quadraticCurveTo(x + Math.cos(a + 0.6) * len * 0.5, y + Math.sin(a + 0.6) * len * 0.5, x + Math.cos(a) * len, y + Math.sin(a) * len);
      b.stroke();
    }
    const v = b.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.3, W / 2, H * 0.45, Math.max(W, H) * 0.75);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(70,50,30,0.12)');
    b.fillStyle = v;
    b.fillRect(0, 0, W, H);
  }

  // ink drops for the GPU ink simulation: { x, y, r, p (pigment), w (water) }
  inkDrop(x, y, r, p, w) {
    if (!this.glr || !this.theme.inkSim) return;
    if (this.inkQueue.length < 400) this.inkQueue.push({ x, y, r, p, w, seed: Math.random() * 100 });
  }

  // ---------- events ----------

  noteOn(note, vel, color = null) {
    if (note < this.lo || note > this.hi) return;
    if (color) this.noteColors.set(note, color); else this.noteColors.delete(note);
    // fast repeats of one key (trills, repeated notes) light up less each time instead of piling up to white
    const h = this.heat.get(note);
    const heat = (h ? h.v * Math.pow(0.5, (this.time - h.t) / 0.25) : 0) + 1;
    this.heat.set(note, { v: heat, t: this.time });
    const rep = clamp(1.6 / (heat + 0.6), 0.3, 1);
    this.active.set(note, { t: this.time, vel, off: null, color, rep });
    this.ringing.add(note);
    if (this.opts.visualizer) {
      if (!this.fall) this.bars.push({ note, t0: this.time, t1: null, vel, color });
      if (this.bars.length > 300) this.bars.shift();
      this.burst(note, vel, rep);
      this.fxNote(note, vel, color);
    }
  }

  // Key released. If the sound carries on (pedal), the bar keeps growing until soundOff.
  noteOff(note, stillSounding = false) {
    const a = this.active.get(note);
    if (a && a.off == null) a.off = this.time;
    if (!stillSounding) this.soundOff(note);
  }

  // The note has actually stopped ringing.
  soundOff(note) {
    const a = this.active.get(note);
    if (a && a.off == null) return; // key still down: the bar stays attached until it comes up
    this.ringing.delete(note);
    for (const b of this.bars) if (b.note === note && b.t1 == null) b.t1 = this.time;
  }

  clearAll() {
    for (const n of this.active.keys()) this.noteOff(n);
  }

  noteAt(cssX, cssY) {
    const x = cssX * this.dpr, y = cssY * this.dpr;
    if (y < this.top || y > this.top + this.kbH) return null;
    for (let n = this.lo; n <= this.hi; n++) {
      const k = this.keys[n];
      if (k.black && y < this.top + this.bh && x >= k.x && x < k.x + k.w) return n;
    }
    for (let n = this.lo; n <= this.hi; n++) {
      const k = this.keys[n];
      if (!k.black && x >= k.x && x < k.x + k.w) return n;
    }
    return null;
  }

  // ---------- particles ----------

  q() {
    const base = QUALITY[this.opts.particles] ?? 1;
    return base * this.load * (this.theme.sparse ? 0.4 : 1) * (this.opts.stream ? 0.45 : 1);
  }

  // stream mode: knobs for screen sharing (see setOptions 'stream')
  get barScale() { return this.opts.barWidth * (this.opts.stream ? 1.35 : 1); }
  get bloomK() { return this.theme.bloom * 0.85 * (this.opts.stream ? 0.6 : 1) * (this.fxOn ? 0.85 + 0.25 * this.dyn : 1); }

  // ---------- extra effects (settings: fxExtra) ----------
  // Always: bass notes make the background breathe, loud passages get bigger light,
  // and the keys reflect the light above them.
  // Falling-notes mode only: shock rings on hard hits, light shafts while the pedal holds notes,
  // a flash (and a small shake) on big loud chords, and sparks that fall back and bounce on the key line.
  get fxOn() { return this.opts.fxExtra !== false && this.opts.visualizer; }
  get dyn() { return this.fxOn ? clamp((this.fxs.intensity - 40) / 80, 0, 1) : 0.5; } // how loud it's been lately
  get hitK() { return this.fxOn ? 0.8 + 0.2 * this.dyn : 0.9; }
  get fallFx() { return this.fxOn && !!this.fall; }
  setPedal(on) { this.pedal = !!on; }

  fxNote(note, vel, color) {
    if (!this.fxOn) return;
    const F = this.fxs, T = this.time, k = this.keys[note];
    F.intensity += (vel - F.intensity) * 0.12;
    if (note < 50) F.pulse = Math.min(1.4, F.pulse + (vel / 127) * (0.55 - ((note - 21) / 29) * 0.3));
    if (!this.fall) return;
    // 'hard' is relative to how loud the piece has been playing (a ff in a quiet piece still counts)
    if (vel >= 45 && vel >= Math.min(78, F.intensity + 8)) {
      F.rings.push({ x: k.cx, t0: T, v: vel / 127, color: color || this.noteColor(note) });
      if (F.rings.length > 40) F.rings.shift();
    }
    F.recent = F.recent.filter((h) => T - h.t < 0.045);
    F.recent.push({ t: T, v: vel });
    const avg = F.recent.reduce((s, h) => s + h.v, 0) / F.recent.length;
    if (F.recent.length >= 4 && avg >= Math.min(88, F.intensity + 14) && (!F.flash || T - F.flash.t0 > 0.35)) {
      F.flash = { t0: T, s: Math.min(1, F.recent.length / 6), color };
      if (!this.opts.stream && !this.fixed) F.shake = 1;
    }
  }

  stepFx(dt) {
    const F = this.fxs, T = this.time;
    F.pulse *= Math.exp(-dt / 0.35);
    F.intensity += (64 - F.intensity) * (1 - Math.exp(-dt / 4));
    F.rings = F.rings.filter((r) => T - r.t0 < 0.6);
    if (F.flash && T - F.flash.t0 > 0.4) F.flash = null;
    // light shafts follow the pedal and the notes it holds
    if (this.fallFx) {
      if (this.pedal) for (const n of this.ringing) if (!F.beams.has(n)) F.beams.set(n, 0);
      for (const [n, lv] of F.beams) {
        const target = this.pedal && this.ringing.has(n) ? 1 : 0;
        const v = lv + (target - lv) * (1 - Math.exp(-dt / (target ? 0.15 : 0.35)));
        if (!target && v < 0.01) F.beams.delete(n); else F.beams.set(n, v);
      }
    } else F.beams.clear();
    // shake: a CSS transform on the canvas, so it costs nothing to draw
    if (F.shake > 0.02) {
      F.shake *= Math.exp(-dt / 0.09);
      this.c.style.transform = `translate(${(Math.random() * 2 - 1) * 3 * F.shake}px, ${(Math.random() * 2 - 1) * 2 * F.shake}px)`;
    } else if (F.shake) { F.shake = 0; this.c.style.transform = ''; }
    this.fxNow = this.fxShapes();
  }

  // what to draw this frame (both renderers read this)
  fxShapes() {
    const F = this.fxs, T = this.time, { top, H, W, dpr, theme: t } = this;
    const out = { pulse: 0, beams: [], rings: [], flash: null };
    if (!this.fxOn) return out;
    out.pulse = Math.min(1, F.pulse) * 0.22;
    if (!this.fall) return out;
    for (const r of F.rings) {
      const age = (T - r.t0) / 0.6, e = 1 - (1 - age) ** 3;
      const rad = (18 + 110 * r.v ** 1.5) * dpr * e + 6 * dpr;
      out.rings.push({ x: r.x, y: top - 2 * dpr, rx: rad, ry: rad * 0.3, a: (1 - age) ** 1.6 * 0.85, color: r.color || t.hit });
    }
    const crowd = 1 / Math.sqrt(Math.max(1, F.beams.size));
    for (const [n, lv] of F.beams) {
      const k = this.keys[n];
      if (!k) continue;
      const len = H * 0.55;
      out.beams.push({ x: k.cx, y: top - len / 2, hw: Math.max(this.ww * 0.8, 10 * dpr), hh: len / 2, a: lv * 0.14 * crowd, color: this.noteColor(n) || t.barGlow });
    }
    if (F.flash) {
      const age = (T - F.flash.t0) / 0.4;
      out.flash = { a: (1 - age) ** 2 * 0.18 * F.flash.s, color: F.flash.color || t.hit, y: top - H * 0.55, h: H * 0.55 };
    }
    return out;
  }

  // Canvas2D versions
  drawFxBack(f) {
    const S = this.fxNow;
    if (!S || this.theme.blend !== 'lighter') return;
    const { W, H, top } = this;
    f.save();
    f.globalCompositeOperation = 'lighter';
    if (S.pulse > 0.005) { f.globalAlpha = S.pulse; f.drawImage(this.glow(this.theme.barGlow, 128, 0), W / 2 - W * 0.75, top - H * 0.5, W * 1.5, H); }
    for (const b of S.beams) { f.globalAlpha = b.a; f.drawImage(this.glow(b.color, 64, 0), b.x - b.hw, b.y - b.hh, b.hw * 2, b.hh * 4); }
    f.restore();
  }

  drawFxFront(f) {
    const S = this.fxNow;
    if (!S) return;
    f.save();
    f.globalCompositeOperation = this.theme.blend;
    for (const r of S.rings) {
      f.strokeStyle = rgba(r.color, r.a);
      f.lineWidth = 2 * this.dpr;
      f.beginPath();
      f.ellipse(r.x, r.y, r.rx, r.ry, 0, 0, Math.PI * 2);
      f.stroke();
    }
    if (S.flash && this.theme.blend === 'lighter') {
      const g = f.createLinearGradient(0, S.flash.y, 0, S.flash.y + S.flash.h);
      g.addColorStop(0, rgba(S.flash.color, 0));
      g.addColorStop(1, rgba(S.flash.color, S.flash.a));
      f.fillStyle = g;
      f.fillRect(0, S.flash.y, this.W, S.flash.h);
    }
    f.restore();
  }

  // glossy keys: the light above, mirrored on the key fronts and fading down
  drawGloss(ctx) {
    if (!this.fxOn || this.theme.blend !== 'lighter') return;
    const depth = this.kbH * 0.55;
    for (const [frac, a] of [[1, 0.07], [0.66, 0.08], [0.33, 0.1]]) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, this.top, this.W, depth * frac);
      ctx.clip();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = a;
      ctx.translate(0, 2 * this.top + 4 * this.dpr);
      ctx.scale(1, -1);
      ctx.drawImage(this.fx, 0, 0);
      ctx.restore();
    }
  }
  get hazeK() { return this.opts.stream ? 0.6 : 1; }

  spawn(kind, x, y, vx, vy, life, size, col = 0) {
    if (this.n >= POOL) return;
    if (this.opts.stream && (kind === SPARK || kind === DUST || kind === EMBER)) size *= 1.5;
    const i = this.n++;
    this.kind[i] = kind; this.px[i] = x; this.py[i] = y; this.vx[i] = vx; this.vy[i] = vy;
    this.life[i] = this.max[i] = life; this.size[i] = size; this.col[i] = col;
    this.seed[i] = Math.random() * 1000; this.rot[i] = Math.random() * 6.28; this.vr[i] = rand(-2, 2);
  }

  burst(note, vel, rep = 1) {
    const q = this.q();
    if (q <= 0) return;
    const k = this.keys[note];
    const d = this.dpr, H = this.H, t = this.theme;
    const vf = 0.45 + (vel / 127) * 0.9;
    const sc = H / 900;
    const n = Math.round(30 * q * vf * rep * (this.fxOn ? 0.6 + 0.9 * this.dyn : 1));
    const tint = this.tintIndex(note);
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + rand(-1.15, 1.15);
      const sp = rand(60, 330) * sc * d * vf;
      this.spawn(SPARK, k.cx + rand(-0.4, 0.4) * k.w, this.top - rand(0, 3) * d, Math.cos(a) * sp, Math.sin(a) * sp,
        rand(0.45, 1.35), rand(0.9, 2.4) * d, this.sparkIndex(note));
    }
    // falling notes: a few sparks thrown sideways that land and bounce on the key line
    if (this.fallFx) {
      for (let i = 0; i < Math.round(8 * q * vf); i++) {
        const a = -Math.PI / 2 + (Math.random() < 0.5 ? -1 : 1) * rand(0.9, 1.4);
        const sp = rand(120, 260) * sc * d * vf;
        this.spawn(SPARK, k.cx + rand(-0.3, 0.3) * k.w, this.top - rand(1, 4) * d, Math.cos(a) * sp, Math.sin(a) * sp, rand(0.9, 1.6), rand(0.9, 2) * d, this.sparkIndex(note));
      }
    }
    if (!t.sparse && !t.pixel) {
      for (let i = 0; i < Math.round(3 * q); i++) {
        this.spawn(HAZE, k.cx + rand(-1, 1) * k.w, this.top - rand(4, 30) * d, rand(-8, 8) * d, -rand(10, 30) * sc * d, rand(1.8, 3.2), rand(26, 56) * d * sc + 18 * d, tint);
      }
    }
    if (t.motes === 'petal') {
      for (let i = 0; i < Math.round(rand(1, 3) * Math.min(1, q + 0.3)); i++) {
        this.spawn(PETAL, k.cx, this.top - 4 * d, rand(-60, 60) * d * sc, -rand(90, 220) * d * sc, rand(2.2, 3.8), rand(7, 12) * d);
      }
    }
    if (t.motes === 'ink') {
      // the drop that lands where the key is struck, plus a little spatter on hard hits
      // fewer, lighter drops when lots is ringing so fast passages don't pool into a black mass
      const busy = Math.min(1, 3 / Math.sqrt(Math.max(1, this.ringing.size)));
      this.inkDrop(k.cx + rand(-0.15, 0.15) * k.w, this.top - rand(10, 26) * d, (10 + 14 * vf) * d * Math.min(1.6, this.ww / (22 * d) + 0.4), 0.6 * busy, 1.2);
      if (vel > 95) for (let i = 0; i < 2 + (Math.random() * 4 | 0); i++) {
        const a = -Math.PI / 2 + rand(-1.3, 1.3), dist = rand(30, 90) * d * vf;
        this.inkDrop(k.cx + Math.cos(a) * dist, this.top - 14 * d + Math.sin(a) * dist, rand(1.5, 4.5) * d, 0.8, 0.5);
      }
      for (let i = 0; i < 3; i++) this.spawn(INK, k.cx + rand(-0.6, 0.6) * k.w, this.top - rand(6, 40) * d, rand(-10, 10) * d, -rand(15, 50) * d * sc, rand(1.6, 2.8), rand(8, 18) * d, (Math.random() * 3) | 0);
    }
    if (q >= 0.5 && t.motes !== 'ink' && !t.pixel && rep > 0.6 && !this.opts.stream) {
      const count = (vel > 100 ? 2 : 1) * (t.wispBoost || 1);
      for (let i = 0; i < count; i++) this.spawnWisp(k.cx + rand(-0.3, 0.3) * k.w, this.top - 2 * d, vf, tint);
    }
  }

  spawnWisp(x, y, vf, tint = 0) {
    if (this.wisps.length > 60) this.wisps.shift();
    const N = 22;
    const pts = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) { pts[i * 2] = x; pts[i * 2 + 1] = y; }
    const sc = this.H / 900;
    this.wisps.push({
      pts, head: 0, N, x, y, tint,
      ang: -Math.PI / 2 + rand(-0.55, 0.55),
      va: rand(0.9, 2.2) * (Math.random() < 0.5 ? -1 : 1),
      sp: rand(140, 280) * sc * this.dpr * vf,
      life: rand(1.0, 1.9), max: 0, w: rand(2.2, 4) * this.dpr,
    });
    this.wisps[this.wisps.length - 1].max = this.wisps[this.wisps.length - 1].life;
  }

  emitHeld(dt) {
    const q = this.q();
    if (q <= 0) return;
    const d = this.dpr, t = this.theme, sc = this.H / 900;
    const sources = [];
    for (const [note, a] of this.active) if (a.off == null) sources.push([note, a.t, a.rep ?? 1]);
    for (const b of this.bars) {
      // pedal-sustained notes keep breathing a little after the key comes up
      if (b.t1 == null && !(this.active.get(b.note)?.off == null && this.active.has(b.note))) sources.push([b.note, b.t0, 0.4]);
    }
    // big chords under the pedal: each note gets a smaller share so the pile-up stays readable
    const crowd = Math.min(1, 2.6 / Math.sqrt(Math.max(1, sources.length)));
    for (const [note, t0, level0] of sources) {
      const level = level0 * crowd;
      const k = this.keys[note];
      if (!k) continue; // scrolled out of a zoomed keyboard
      const held = this.time - t0;
      const fade = clamp(1.4 - held * 0.25, 0.35, 1) * level;
      const rate = (r) => { const v = r * dt * fade; return Math.floor(v) + (Math.random() < v % 1 ? 1 : 0); };
      const tint = this.tintIndex(note);
      for (let i = rate(18 * q); i > 0; i--) {
        this.spawn(SPARK, k.cx + rand(-0.45, 0.45) * k.w, this.top - rand(0, 4) * d, rand(-25, 25) * d, -rand(40, 160) * sc * d,
          rand(0.4, 1.1), rand(0.7, 1.8) * d, this.sparkIndex(note));
      }
      for (let i = rate(80 * q * (this.opts.stream ? 0.4 : 1)); i > 0; i--) {
        this.spawn(DUST, k.cx + rand(-0.9, 0.9) * k.w, this.top - rand(0, 18) * d, rand(-12, 12) * d, -rand(20, 75) * sc * d,
          rand(1.8, 4.2), rand(0.6, 1.5) * d, tint);
      }
      if (!t.sparse && !t.pixel) for (let i = rate(4 * q); i > 0; i--) {
        this.spawn(HAZE, k.cx + rand(-1.2, 1.2) * k.w, this.top - rand(10, 40) * d, rand(-6, 6) * d, -rand(12, 30) * sc * d, rand(2.2, 3.6), rand(30, 60) * d * sc + 16 * d, tint);
      }
      if (t.motes === 'ember') for (let i = rate(14 * q); i > 0; i--) {
        this.spawn(EMBER, k.cx + rand(-0.5, 0.5) * k.w, this.top - 2 * d, rand(-20, 20) * d, -rand(70, 190) * sc * d, rand(1.2, 2.6), rand(1.2, 2.4) * d, this.noteColors.has(note) ? this.sparkIndex(note) : 2);
      }
      if (t.motes === 'ink' && Math.random() < dt * 3 * level) this.inkDrop(k.cx + rand(-0.3, 0.3) * k.w, this.top - rand(8, 20) * d, rand(5, 9) * d, 0.22, 0.8);
      if (t.motes === 'ink') for (let i = rate(5); i > 0; i--) {
        this.spawn(INK, k.cx + rand(-0.6, 0.6) * k.w, this.top - rand(6, 30) * d, rand(-6, 6) * d, -rand(15, 40) * d * sc, rand(1.6, 2.6), rand(6, 14) * d, (Math.random() * 3) | 0);
      }
    }
  }

  emitAmbient(dt) {
    const t = this.theme;
    if (!this.opts.visualizer || this.q() <= 0) return;
    const d = this.dpr;
    if (t.motes === 'snow') {
      this.ambientAcc += dt * 9 * this.q();
      while (this.ambientAcc >= 1) { this.ambientAcc--; this.spawn(SNOW, rand(0, this.W), -10 * d, rand(-8, 8) * d, rand(18, 45) * d, rand(10, 18), rand(1.2, 3.4) * d); }
    } else if (t.motes === 'petal') {
      this.ambientAcc += dt * 1.1 * this.q();
      while (this.ambientAcc >= 1) { this.ambientAcc--; this.spawn(PETAL, rand(0, this.W), -12 * d, rand(10, 40) * d, rand(25, 55) * d, rand(12, 20), rand(6, 10) * d); }
    }
  }

  stepParticles(dt) {
    const T = this.time;
    const top = this.top;
    const d = this.dpr;
    let i = 0;
    while (i < this.n) {
      this.life[i] -= dt;
      const k = this.kind[i];
      const out = this.py[i] < -60 * d || this.py[i] > top + 4 * d && k !== SNOW && k !== PETAL || this.py[i] > top;
      if (this.life[i] <= 0 || (out && !(k === SNOW && this.py[i] < top) && !(k === PETAL && this.py[i] < top))) {
        const j = --this.n;
        if (i !== j) {
          this.kind[i] = this.kind[j]; this.px[i] = this.px[j]; this.py[i] = this.py[j]; this.vx[i] = this.vx[j]; this.vy[i] = this.vy[j];
          this.life[i] = this.life[j]; this.max[i] = this.max[j]; this.size[i] = this.size[j]; this.col[i] = this.col[j];
          this.seed[i] = this.seed[j]; this.rot[i] = this.rot[j]; this.vr[i] = this.vr[j];
        }
        continue;
      }
      const x = this.px[i], y = this.py[i], s = this.seed[i];
      const ang = Math.sin(x * 0.0035 / d + T * 0.35 + s) * 2.4 + Math.cos(y * 0.0042 / d - T * 0.27);
      switch (k) {
        case SPARK: {
          const drag = Math.pow(0.12, dt);
          this.vx[i] = this.vx[i] * drag + Math.cos(ang) * 30 * d * dt;
          if (this.fallFx) {
            // falling-notes mode: gravity, and a bounce on the key line
            this.vy[i] = this.vy[i] * Math.pow(0.5, dt) + 260 * d * dt;
            if (this.py[i] >= top - 1.5 * d && this.vy[i] > 0) { this.py[i] = top - 1.5 * d; this.vy[i] *= -0.38; this.vx[i] *= 0.7; }
          } else this.vy[i] = this.vy[i] * drag - 28 * d * dt;
          break;
        }
        case DUST:
          this.vx[i] = this.vx[i] * Math.pow(0.6, dt) + Math.cos(ang) * 40 * d * dt;
          this.vy[i] += (Math.sin(ang) * 10 - 6) * d * dt;
          break;
        case HAZE:
          this.vx[i] += Math.cos(ang) * 6 * d * dt;
          this.size[i] += 9 * d * dt;
          break;
        case PETAL:
          if (this.vy[i] < 0) this.vy[i] += 75 * d * dt; // launched up, then drifts down
          this.vy[i] = Math.min(this.vy[i], 55 * d);
          this.vx[i] += Math.cos(ang) * 30 * d * dt;
          this.rot[i] += this.vr[i] * dt;
          break;
        case EMBER:
          this.vx[i] += Math.cos(ang + s) * 60 * d * dt;
          this.vy[i] -= 10 * d * dt;
          break;
        case SNOW:
          this.vx[i] = Math.sin(T * 0.6 + s) * 14 * d;
          this.rot[i] += dt;
          break;
        case INK:
          this.size[i] += 14 * d * dt;
          this.vy[i] *= Math.pow(0.5, dt);
          break;
      }
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      i++;
    }

    for (let w = this.wisps.length - 1; w >= 0; w--) {
      const ws = this.wisps[w];
      ws.life -= dt;
      if (ws.life <= -0.4) { this.wisps.splice(w, 1); continue; }
      ws.ang += ws.va * dt;
      ws.va *= Math.pow(0.7, dt);
      ws.sp *= Math.pow(0.45, dt);
      ws.x += Math.cos(ws.ang) * ws.sp * dt;
      ws.y += Math.sin(ws.ang) * ws.sp * dt;
      ws.head = (ws.head + 1) % ws.N;
      ws.pts[ws.head * 2] = ws.x;
      ws.pts[ws.head * 2 + 1] = ws.y;
    }
  }

  // ---------- drawing ----------

  get renderer() { return this.glr ? `GPU · ${this.glr.gpuName}` : 'CPU · Canvas2D'; }

  // drop bars that have floated off the top
  pruneBars() {
    const speed = this.H * 0.21 * this.opts.speed;
    this.bars = this.bars.filter((b) => b.t1 == null || this.top - (this.time - b.t1) * speed >= -40 * this.dpr);
  }

  frame(nowMs) {
    const now = nowMs / 1000;
    const dt = clamp(now - this.time, 0, 0.05);
    this.time = now;
    this.adapt(dt);
    this.stepFx(dt);

    const { ctx, W, H, top, theme: t, dpr } = this;
    const vis = this.opts.visualizer;

    if (vis) {
      this.emitHeld(dt);
      this.emitAmbient(dt);
      this.stepParticles(dt);
    }

    // lit amounts
    const lit = [];
    for (const [note, a] of this.active) {
      let v;
      if (a.off == null) v = 1 - 0.35 * Math.min(1, (this.time - a.t) / 0.45);
      else v = 0.65 * (1 - (this.time - a.off) / 0.35) * (a.off - a.t < 0.45 ? 1 + 0.35 * (1 - (a.off - a.t) / 0.45) : 1);
      if (v <= 0 || !this.keys[note]) { this.active.delete(note); continue; }
      lit.push([note, Math.min(1, v) * (a.rep ?? 1), a]);
    }

    this.crowd = Math.min(1, 2.2 / Math.sqrt(Math.max(1, lit.length)));
    if (this.glr) {
      this.pruneBars();
      this.glr.draw(this, lit);
      return;
    }

    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.drawImage(this.bgC, 0, 0);
    this.drawKeyboard(ctx, lit);

    if (vis) {
      const f = this.fxx;
      f.globalCompositeOperation = 'source-over';
      f.globalAlpha = 1;
      f.clearRect(0, 0, W, H);
      f.globalCompositeOperation = t.blend;
      this.drawFxBack(f);
      this.drawParticles(f, [HAZE]);
      this.drawParticles(f, [DUST, INK]);
      this.drawBars(f);
      this.drawWisps(f);
      this.drawParticles(f, [SPARK, EMBER, PETAL, SNOW]);
      // hit glows
      f.globalCompositeOperation = t.blend;
      for (const [note, v] of lit) {
        const k = this.keys[note];
        // wide soft halo + small hot core, squashed so it sits on the key line
        const gu = Math.min(this.ww, 26 * this.dpr); // glow size stops growing with keyboard zoom
        const r = gu * (1.9 + 0.9 * v) * this.hitK;
        f.globalAlpha = (t.blend === 'lighter' ? 0.26 * v : 0.12 * v) * this.crowd;
        const nc = this.noteColor(note);
        const hit = nc ? this.glow(nc, 128, 0.6) : this.sp.hit;
        f.drawImage(hit, k.cx - r, top - r * 0.7, r * 2, r * 1.4);
        const c = gu * (0.55 + 0.35 * v);
        f.globalAlpha = (t.blend === 'lighter' ? 0.45 * v : 0.2 * v) * this.crowd;
        f.drawImage(hit, k.cx - c, top - c * 0.8, c * 2, c * 1.6);
      }
      this.drawFxFront(f);
      // the light runs a little way onto the keys and fades, instead of stopping dead at the key line
      const fade = this.fadeLen();
      const m = f.createLinearGradient(0, top - 2 * dpr, 0, top + fade);
      m.addColorStop(0, 'rgba(0,0,0,1)');
      m.addColorStop(0.35, 'rgba(0,0,0,0.45)');
      m.addColorStop(1, 'rgba(0,0,0,0)');
      f.globalAlpha = 1;
      f.globalCompositeOperation = 'destination-in';
      f.fillStyle = m;
      f.fillRect(0, 0, W, H);
      f.fillStyle = '#000';
      f.fillRect(0, 0, W, top - 2 * dpr); // above the key line stays untouched
      f.globalCompositeOperation = 'source-over';

      ctx.globalCompositeOperation = t.blend === 'lighter' ? 'lighter' : 'source-over';
      ctx.drawImage(this.fx, 0, 0);
      this.drawGloss(ctx);

      if (this.opts.bloom && t.bloom > 0 && this.load > 0.45) {
        const b1 = this.b1.getContext('2d'), b2 = this.b2.getContext('2d');
        b1.globalCompositeOperation = 'copy';
        b1.filter = 'blur(2px)';
        b1.drawImage(this.fx, 0, 0, this.b1.width, this.b1.height);
        b2.globalCompositeOperation = 'copy';
        b2.filter = 'blur(3px)';
        b2.drawImage(this.b1, 0, 0, this.b2.width, this.b2.height);
        ctx.globalCompositeOperation = 'lighter';
        ctx.imageSmoothingQuality = 'high';
        ctx.globalAlpha = 0.55 * this.bloomK;
        ctx.drawImage(this.b1, 0, 0, W, H);
        ctx.globalAlpha = 0.75 * this.bloomK;
        ctx.drawImage(this.b2, 0, 0, W, H);
        ctx.globalAlpha = 1;
      }
    }

    this.drawHitLine(ctx, lit);
  }

  fadeLen() { return Math.max(10 * this.dpr, this.kbH * 0.22); }

  drawParticles(f, kinds) {
    const sp = this.sp;
    const t = this.theme;
    const T = this.time;
    for (let i = 0; i < this.n; i++) {
      const k = this.kind[i];
      if (!kinds.includes(k)) continue;
      const lf = this.life[i] / this.max[i];
      let s = this.size[i];
      const x = this.px[i], y = this.py[i];
      if (t.pixel && (k === SPARK || k === DUST || k === EMBER)) {
        // flat square pixels, alpha in steps
        const [cx, cy, hs] = this.pixel(x, y, k === DUST ? 0 : s);
        const tn = k === DUST && this.col[i] && this.tints[this.col[i] - 1];
        f.fillStyle = k === DUST ? (tn ? tn.dust : t.dust) : ([...t.spark, ...this.extraSparks][this.col[i]] || t.spark[0]);
        const a = k === DUST ? Math.sin(lf * Math.PI) * 0.35 : Math.min(1, lf * 1.6);
        f.globalAlpha = Math.round(a * 4) / 4;
        f.fillRect(cx - hs, cy - hs, hs * 2, hs * 2);
        continue;
      }
      switch (k) {
        case SPARK: {
          const tw = 0.65 + 0.35 * Math.sin(T * 26 + this.seed[i]);
          f.globalAlpha = Math.min(1, lf * 1.6) * tw;
          s *= 3.2;
          f.drawImage(sp.spark[this.col[i]], x - s, y - s, s * 2, s * 2);
          break;
        }
        case DUST: {
          f.globalAlpha = Math.sin(lf * Math.PI) * 0.55;
          s *= 3;
          const tn = this.col[i] && this.tints[this.col[i] - 1];
          f.drawImage(tn ? this.glow(tn.dust, 32, 0.2) : sp.dust, x - s, y - s, s * 2, s * 2);
          break;
        }
        case HAZE: {
          f.globalAlpha = Math.sin(lf * Math.PI) * (t.blend === 'lighter' ? 0.16 : 0.07) * this.hazeK;
          const tn = this.col[i] && this.tints[this.col[i] - 1];
          f.drawImage(tn ? this.glow(tn.haze, 128, 0) : sp.haze, x - s, y - s, s * 2, s * 2);
          break;
        }
        case EMBER: {
          const fl = 0.55 + 0.45 * Math.sin(T * 17 + this.seed[i] * 3);
          f.globalAlpha = lf * fl;
          s *= 2.6;
          f.drawImage(sp.spark[this.col[i]], x - s, y - s, s * 2, s * 2);
          break;
        }
        case PETAL: {
          f.globalCompositeOperation = 'source-over';
          f.globalAlpha = Math.min(1, lf * 3) * 0.85;
          const flip = Math.abs(Math.sin(this.rot[i] * 1.3 + this.seed[i]));
          f.setTransform(Math.cos(this.rot[i]) * (0.35 + 0.65 * flip), Math.sin(this.rot[i]) * (0.35 + 0.65 * flip), -Math.sin(this.rot[i]), Math.cos(this.rot[i]), x, y);
          f.drawImage(sp.petal, -s, -s, s * 2, s * 2);
          f.setTransform(1, 0, 0, 1, 0, 0);
          f.globalCompositeOperation = t.blend;
          break;
        }
        case SNOW:
          f.globalAlpha = Math.min(1, lf * 4) * 0.8;
          f.drawImage(sp.flake, x - s, y - s, s * 2, s * 2);
          break;
        case INK:
          f.globalAlpha = Math.sin(lf * Math.PI) * 0.55;
          s *= 2;
          f.drawImage(sp.blot[this.col[i]], x - s, y - s, s * 2, s * 2);
          break;
      }
    }
    f.globalAlpha = 1;
  }

  // Note bars for this frame, the same list for both renderers:
  // rising bars for what was played, or (falling mode) a loaded score's notes coming down to the keys.
  barShapes() {
    const { top, H, dpr } = this;
    const speed = H * 0.21 * this.opts.speed;
    const out = [];
    if (this.fall) {
      const F = this.fall, N = F.notes, now = F.now();
      const ahead = top / speed + 0.1;
      let lo = 0, hi = N.length;
      const from = now - F.maxD;
      while (lo < hi) { const m = (lo + hi) >> 1; if (N[m].t < from) lo = m + 1; else hi = m; }
      for (let i = lo; i < N.length && N[i].t <= now + ahead; i++) {
        const x = N[i];
        if (x.t + x.d < now) continue;
        const k = this.keys[x.n];
        if (!k) continue;
        const live = x.t <= now;
        out.push({ note: x.n, k, y1: top - (x.t + x.d - now) * speed, y2: Math.min(top - dpr, top - (x.t - now) * speed), color: x.color, live, fresh: live ? 1 : 0.8, seed: x.t });
      }
      return out;
    }
    const T = this.time;
    for (const b of this.bars) {
      const k = this.keys[b.note];
      if (!k) continue;
      const y2 = b.t1 == null ? top - dpr : top - (T - b.t1) * speed;
      if (y2 < -40 * dpr) continue;
      out.push({ note: b.note, k, y1: top - (T - b.t0) * speed, y2, color: b.color, live: b.t1 == null,
        fresh: b.t1 == null ? 1 : Math.max(0.75, 1 - (T - b.t1) * 0.1), seed: b.t0 });
    }
    return out;
  }

  drawBars(f) {
    const { theme: t } = this;
    f.save();
    for (const b of this.barShapes()) {
      const { k, y1, y2 } = b;
      const w = (k.black ? k.w * 0.7 : this.ww * 0.46) * this.barScale;
      const nc = b.color || this.colorOf(b.note);
      const x = k.cx - w / 2;
      const h = Math.max(w, y2 - y1);
      const yy = y2 - h;
      if (t.pixel) {
        const [px, py, pw, ph] = this.pixelBar(k.cx, w, yy, y2);
        f.globalCompositeOperation = t.blend;
        f.globalAlpha = 0.35;
        f.drawImage(nc ? this.glow(nc, 64, 0) : this.sp.barGlow, px - pw, py - pw, pw * 3, ph + pw * 2);
        f.globalCompositeOperation = 'source-over';
        f.globalAlpha = b.live ? 1 : 0.85;
        f.fillStyle = nc || t.bar;
        f.fillRect(px, py, pw, ph);
        continue;
      }
      // glow
      f.globalCompositeOperation = t.blend;
      f.globalAlpha = t.blend === 'lighter' ? 0.45 : 0.18;
      f.drawImage(nc ? this.glow(nc, 64, 0) : this.sp.barGlow, x - w * 1.6, yy - w * 1.6, w * 4.2, h + w * 3.2);
      // core
      f.globalCompositeOperation = 'source-over';
      const g = f.createLinearGradient(0, yy, 0, yy + h);
      const fresh = b.fresh;
      g.addColorStop(0, rgba(nc || t.bar, 0.55 * fresh));
      g.addColorStop(1, rgba(nc || t.bar, 0.95 * fresh));
      f.globalAlpha = 1;
      f.fillStyle = g;
      f.beginPath();
      f.roundRect(x, yy, w, h, w / 2);
      f.fill();
    }
    f.restore();
    this.pruneBars();
  }

  drawWisps(f) {
    const t = this.theme;
    f.save();
    f.globalCompositeOperation = t.blend;
    f.lineCap = 'round';
    for (const ws of this.wisps) {
      f.strokeStyle = (ws.tint && this.tints[ws.tint - 1]?.wisp) || t.wisp;
      const life = Math.max(0, ws.life / ws.max);
      const fadeIn = Math.min(1, (ws.max - ws.life) * 6);
      for (let s = 1; s < ws.N; s++) {
        const i0 = (ws.head + s) % ws.N, i1 = (ws.head + s + 1) % ws.N;
        const p = s / ws.N;
        f.globalAlpha = Math.min(1, p * p * life * fadeIn * 1.25);
        f.lineWidth = ws.w * Math.sin(p * Math.PI * 0.95 + 0.05);
        f.beginPath();
        f.moveTo(ws.pts[i0 * 2], ws.pts[i0 * 2 + 1]);
        f.lineTo(ws.pts[i1 * 2], ws.pts[i1 * 2 + 1]);
        f.stroke();
      }
    }
    f.restore();
  }

  drawKeyboard(ctx, lit) {
    const { top, W, kbH, dpr, theme: t } = this;
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.drawImage(this.whiteC, 0, top);

    const tint = (note, v, black) => {
      const k = this.keys[note];
      const h = black ? this.bh : kbH;
      if (t.keys === 'pixel') {
        // flat fill, hard edges
        ctx.fillStyle = rgba(this.noteColor(note) || t.keyLit, (black ? 0.8 : 0.6) * v);
        const gp = black ? 0 : Math.max(1, Math.round(this.P * 0.375));
        ctx.fillRect(Math.round(k.x) + gp, top, Math.round(k.w) - gp * 2, h - (black ? 0 : Math.max(2, Math.round(this.P * 0.75)) * 2));
        return;
      }
      const g = ctx.createLinearGradient(0, top, 0, top + h);
      const lc = this.noteColor(note) || t.keyLit;
      g.addColorStop(0, rgba(lc, (black ? 0.9 : 0.75) * v));
      g.addColorStop(1, rgba(lc, (black ? 0.35 : 0.18) * v));
      ctx.fillStyle = g;
      const gap = black ? 0 : Math.max(1, dpr) / 2;
      ctx.beginPath();
      ctx.roundRect(k.x + gap, top - 2, k.w - gap * 2, h + 2 - (black ? 0 : dpr), 3 * dpr);
      ctx.fill();
      // pressed key sinks: darker top edge
      ctx.fillStyle = `rgba(0,0,0,${0.25 * v})`;
      ctx.fillRect(k.x + gap, top, k.w - gap * 2, 4 * dpr);
    };

    for (const [note, v] of lit) if (!this.keys[note].black) tint(note, v, false);
    ctx.drawImage(this.blackC, 0, top);
    for (const [note, v] of lit) if (this.keys[note].black) tint(note, v, true);

    // light spilling onto the keys (not on the flat pixel keys)
    if (t.blend === 'lighter' && t.keys !== 'pixel') {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, top, W, kbH);
      ctx.clip();
      ctx.globalCompositeOperation = 'lighter';
      for (const [note, v] of lit) {
        const k = this.keys[note];
        const r = Math.min(this.ww, 26 * dpr) * 2.6;
        ctx.globalAlpha = 0.28 * v;
        const nc = this.noteColor(note);
        ctx.drawImage(nc ? this.glow(nc, 128, 0.3) : this.sp.keyLit, k.cx - r, top - r * 0.6, r * 2, r * 1.6);
      }
      ctx.restore();
    }

    // keys reflected in the board above them (three bands for a quick fade)
    if (this.fxOn) {
      const h = Math.max(8 * dpr, kbH * 0.16), y0 = top - 3 * dpr;
      for (const [frac, a] of [[1, 0.035], [0.6, 0.04], [0.3, 0.05]]) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, y0 - h * frac, W, h * frac);
        ctx.clip();
        ctx.globalAlpha = a * (t.blend === 'lighter' ? 1 : 0.6);
        ctx.translate(0, 2 * y0);
        ctx.scale(1, -1);
        ctx.drawImage(this.whiteC, 0, y0);
        ctx.drawImage(this.blackC, 0, y0);
        ctx.restore();
      }
    }
    // felt + hit line
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = t.felt;
    ctx.fillRect(0, top - 3 * dpr, W, 3 * dpr);
  }

  // hit line and its glows go on top of everything, including the light layer
  drawHitLine(ctx, lit) {
    const { top, W, dpr, theme: t } = this;
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = rgba(t.hitLine, 0.85);
    ctx.fillRect(0, top - 3 * dpr, W, Math.max(1, dpr));
    if (lit.length) {
      ctx.globalCompositeOperation = t.blend === 'lighter' ? 'lighter' : 'source-over';
      for (const [note, v] of lit) {
        const k = this.keys[note];
        const r = Math.min(this.ww, 26 * dpr) * 1.4;
        ctx.globalAlpha = 0.8 * v;
        ctx.drawImage(this.sp.hit, k.cx - r, top - 3 * dpr - r * 0.25, r * 2, r * 0.5);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  adapt(dt) {
    if (this.fixed) return; // rendering a video: always full quality
    // Keep frame time sane on weaker GPUs by thinning particles, never by dropping the look entirely.
    if (dt > 0.024) this.slow = Math.min(60, this.slow + 1);
    else this.slow = Math.max(0, this.slow - 1);
    if (this.slow > 30) { this.load = Math.max(0.3, this.load * 0.92); this.slow = 15; }
    else if (this.slow === 0 && this.load < 1) this.load = Math.min(1, this.load + 0.002);
  }
}
