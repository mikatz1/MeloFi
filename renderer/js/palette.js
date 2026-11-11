// Builds a visualizer theme from the colours of an image.
// k-means on a small copy of the picture, then: the dominant dark colour becomes the
// backdrop, the most vivid colour drives bars/particles/glow, and a second vivid hue
// (if there is one) accents the sparks and the hit line.

import { N_ } from '../i18n/i18n.js';

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function hsl(h, s, l) {
  s = Math.max(0, Math.min(1, s)); l = Math.max(0, Math.min(1, l));
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return `#${[f(0), f(8), f(4)].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

const hueGap = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

function loadImage(url) {
  return new Promise((res, rej) => { const img = new Image(); img.onload = () => res(img); img.onerror = rej; img.src = url; });
}

function kmeans(px, k = 7, iters = 10) {
  const n = px.length / 3;
  const cent = [];
  for (let i = 0; i < k; i++) { const j = Math.floor(((i + 0.5) / k) * n) * 3; cent.push([px[j], px[j + 1], px[j + 2]]); }
  const assign = new Int32Array(n);
  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < n; i++) {
      let best = 0, bd = Infinity;
      for (let c = 0; c < k; c++) {
        const dr = px[i * 3] - cent[c][0], dg = px[i * 3 + 1] - cent[c][1], db = px[i * 3 + 2] - cent[c][2];
        const d = dr * dr + dg * dg + db * db;
        if (d < bd) { bd = d; best = c; }
      }
      assign[i] = best;
    }
    const sum = cent.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) { const s = sum[assign[i]]; s[0] += px[i * 3]; s[1] += px[i * 3 + 1]; s[2] += px[i * 3 + 2]; s[3]++; }
    sum.forEach((s, c) => { if (s[3]) cent[c] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]]; });
  }
  const count = new Array(k).fill(0);
  for (let i = 0; i < n; i++) count[assign[i]]++;
  return cent.map((c, i) => ({ rgb: c, share: count[i] / n, hsl: rgbToHsl(...c) })).filter((c) => c.share > 0.005);
}

export async function themeFromImage(url, name = N_('내 테마')) {
  const img = await loadImage(url);
  const S = 80;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const x = cv.getContext('2d', { willReadFrequently: true });
  x.drawImage(img, 0, 0, S, S);
  const d = x.getImageData(0, 0, S, S).data;
  const px = new Float32Array(S * S * 3);
  for (let i = 0, j = 0; i < d.length; i += 4, j += 3) { px[j] = d[i]; px[j + 1] = d[i + 1]; px[j + 2] = d[i + 2]; }
  const cl = kmeans(px);

  // backdrop: the colour covering most of the picture, preferring darker ones
  const base = [...cl].sort((a, b) => b.share * (1.2 - a.hsl[2]) - a.share * (1.2 - b.hsl[2]))[0];
  // accent: vivid and reasonably present
  const vivid = (c) => c.hsl[1] * Math.pow(c.share, 0.35) * (c.hsl[2] > 0.12 && c.hsl[2] < 0.92 ? 1 : 0.2);
  const ranked = [...cl].sort((a, b) => vivid(b) - vivid(a));
  let acc = ranked[0];
  let [ah, as] = acc.hsl;
  if (as < 0.12) { ah = base.hsl[1] > 0.08 ? base.hsl[0] : 220; as = 0.35; } // near-greyscale picture: stay subtle
  const second = ranked.find((c) => c !== acc && c.hsl[1] > 0.2 && hueGap(c.hsl[0], ah) > 35);
  const bh = second ? second.hsl[0] : (ah + 40) % 360;

  const [gh, gs] = base.hsl;
  const bgS = Math.min(0.55, gs * 0.9 + 0.05);
  const sat = Math.max(0.55, Math.min(0.95, as * 1.15));

  return {
    name,
    custom: true,
    bg: [hsl(gh, bgS, 0.03), hsl(gh, bgS, 0.07), hsl(gh, bgS, 0.12)],
    lane: `rgba(255,255,255,0.04)`,
    bar: hsl(ah, sat * 0.6, 0.88),
    barGlow: hsl(ah, sat, 0.56),
    hit: hsl(ah, sat * 0.7, 0.9),
    hitLine: hsl(bh, 0.7, 0.6),
    spark: ['#ffffff', hsl(ah, sat, 0.8), hsl(ah, sat, 0.62), hsl(bh, 0.75, 0.62)],
    dust: hsl(ah, sat, 0.6),
    haze: hsl(ah, sat * 0.9, 0.3),
    wisp: hsl(ah, sat * 0.8, 0.8),
    keyLit: hsl(ah, sat * 0.85, 0.7),
    blend: 'lighter', motes: 'none', bloom: 0.65,
    white: ['#f2eee6', '#d6d0c3'], black: ['#1c1c20', '#060607'], felt: hsl(bh, 0.45, 0.14),
    source: { base: hsl(gh, gs, base.hsl[2]), accent: hsl(acc.hsl[0], acc.hsl[1], acc.hsl[2]) },
  };
}
