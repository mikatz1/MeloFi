// Synthesised drum kits, built the way the machines that made these sounds famous built them:
// sine kicks with a pitch drop, two tones plus noise for snares, hand claps from noise bursts,
// cymbals from six detuned square oscillators through band-pass filters. Rendered note by note
// (see synth-gen.js) and played by the sampler like any other instrument. GM drum key layout.

function noiseSource(c, dur) {
  const n = Math.ceil(dur * c.sampleRate);
  const b = c.createBuffer(1, n, c.sampleRate);
  const d = b.getChannelData(0);
  let seed = 12345;
  for (let i = 0; i < n; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; d[i] = (seed / 0x3fffffff) - 1; }
  const s = c.createBufferSource();
  s.buffer = b;
  s.start(0);
  return s;
}

function filt(c, type, f, q = 0.7) { const b = c.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; }

// exponential decay envelope on a gain node
function decay(c, g, peak, tau, attack = 0.001) {
  g.gain.setValueAtTime(0, 0);
  g.gain.linearRampToValueAtTime(peak, attack);
  g.gain.setTargetAtTime(0, attack, tau);
}

function osc(c, type, f) { const o = c.createOscillator(); o.type = type; o.frequency.value = f; o.start(0); return o; }

// six square oscillators at inharmonic ratios: the metallic core of analog hats and cymbals
function metal(c, base = 1) {
  const mix = c.createGain(); mix.gain.value = 0.18;
  for (const f of [205.3, 304.4, 369.6, 522.7, 540, 800]) osc(c, 'square', f * base).connect(mix);
  return mix;
}

function kick(c, { f0, f1, tau, pitchTau, click = 0.3, drive = 0 }) {
  const o = osc(c, 'sine', f0);
  o.frequency.setValueAtTime(f0, 0);
  o.frequency.setTargetAtTime(f1, 0.001, pitchTau);
  const g = c.createGain(); decay(c, g, 1, tau);
  let src = o;
  if (drive) {
    const ws = c.createWaveShaper(); const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = (i / 511.5) - 1; curve[i] = Math.tanh(x * (1 + drive * 4)) / Math.tanh(1 + drive * 4); }
    ws.curve = curve; o.connect(ws); src = ws;
  }
  src.connect(g).connect(c.destination);
  if (click) {
    const n = noiseSource(c, 0.02), hp = filt(c, 'highpass', 2500), cg = c.createGain(); decay(c, cg, click, 0.004);
    n.connect(hp).connect(cg).connect(c.destination);
  }
}

function snare(c, { tones, toneTau, noiseTau, noiseF, mixT = 0.5, mixN = 0.7 }) {
  const tg = c.createGain(); decay(c, tg, mixT, toneTau);
  for (const f of tones) osc(c, 'triangle', f).connect(tg);
  tg.connect(c.destination);
  const n = noiseSource(c, noiseTau * 8), bp = filt(c, 'highpass', noiseF), ng = c.createGain(); decay(c, ng, mixN, noiseTau);
  n.connect(bp).connect(ng).connect(c.destination);
}

function clap(c, { tail, f = 1200 }) {
  const n = noiseSource(c, 1.2), bp = filt(c, 'bandpass', f, 1.4), g = c.createGain();
  g.gain.setValueAtTime(0, 0);
  for (const t of [0, 0.011, 0.022]) { g.gain.setValueAtTime(1, t); g.gain.setTargetAtTime(0.1, t + 0.001, 0.003); }
  g.gain.setValueAtTime(0.8, 0.032);
  g.gain.setTargetAtTime(0, 0.033, tail);
  n.connect(bp).connect(g).connect(c.destination);
}

function hat(c, { tau, base = 1, noise = 0.2 }) {
  const m = metal(c, base);
  const bp = filt(c, 'bandpass', 10000, 0.8), hp = filt(c, 'highpass', 7000), g = c.createGain(); decay(c, g, 1, tau);
  m.connect(bp).connect(hp).connect(g).connect(c.destination);
  if (noise) { const n = noiseSource(c, tau * 8), nh = filt(c, 'highpass', 8000), ng = c.createGain(); decay(c, ng, noise, tau * 0.8); n.connect(nh).connect(ng).connect(c.destination); }
}

function cymbal(c, { tau, f = 6000, noise = 0.4 }) {
  const m = metal(c, 1.04);
  const bp = filt(c, 'bandpass', f, 0.6), hp = filt(c, 'highpass', 4000), g = c.createGain(); decay(c, g, 1, tau, 0.002);
  m.connect(bp).connect(hp).connect(g).connect(c.destination);
  const n = noiseSource(c, tau * 5), nh = filt(c, 'highpass', 5000), ng = c.createGain(); decay(c, ng, noise, tau);
  n.connect(nh).connect(ng).connect(c.destination);
}

function tom(c, { f, tau }) {
  const o = osc(c, 'sine', f * 1.35);
  o.frequency.setTargetAtTime(f, 0.001, 0.04);
  const g = c.createGain(); decay(c, g, 1, tau);
  o.connect(g).connect(c.destination);
  const n = noiseSource(c, 0.05), lp = filt(c, 'lowpass', 2500), ng = c.createGain(); decay(c, ng, 0.15, 0.01);
  n.connect(lp).connect(ng).connect(c.destination);
}

function cowbell(c) {
  const g = c.createGain(); decay(c, g, 1, 0.12);
  const bp = filt(c, 'bandpass', 2640, 2);
  osc(c, 'square', 540).connect(bp); osc(c, 'square', 800).connect(bp);
  bp.connect(g).connect(c.destination);
}

function rim(c) {
  const g = c.createGain(); decay(c, g, 1, 0.012);
  osc(c, 'triangle', 1700).connect(g);
  const n = noiseSource(c, 0.05), hp = filt(c, 'highpass', 3000), ng = c.createGain(); decay(c, ng, 0.5, 0.006);
  n.connect(hp).connect(ng).connect(c.destination);
  g.connect(c.destination);
}

// key -> { dur, render(c, bright) }   (bright 0..1: the louder velocity layer is snappier)
export const KITS = {
  drums808: {
    36: { dur: 1.4, render: (c, b) => kick(c, { f0: 140 + 30 * b, f1: 46, tau: 0.32, pitchTau: 0.035, click: 0.15 + 0.15 * b }) },
    35: { dur: 1.8, render: (c, b) => kick(c, { f0: 120 + 20 * b, f1: 41, tau: 0.5, pitchTau: 0.04, click: 0.1 }) },
    37: { dur: 0.2, render: (c) => rim(c) },
    38: { dur: 0.6, render: (c, b) => snare(c, { tones: [180, 330], toneTau: 0.06, noiseTau: 0.09 + 0.03 * b, noiseF: 1800 }) },
    40: { dur: 0.7, render: (c, b) => snare(c, { tones: [200, 360], toneTau: 0.05, noiseTau: 0.13 + 0.03 * b, noiseF: 1500, mixN: 0.85 }) },
    39: { dur: 1, render: (c, b) => clap(c, { tail: 0.12 + 0.05 * b }) },
    42: { dur: 0.3, render: (c, b) => hat(c, { tau: 0.025 + 0.01 * b }) },
    44: { dur: 0.3, render: (c) => hat(c, { tau: 0.02, noise: 0.1 }) },
    46: { dur: 1.2, render: (c, b) => hat(c, { tau: 0.2 + 0.08 * b }) },
    41: { dur: 1.2, render: (c) => tom(c, { f: 82, tau: 0.25 }) },
    43: { dur: 1.2, render: (c) => tom(c, { f: 98, tau: 0.24 }) },
    45: { dur: 1, render: (c) => tom(c, { f: 123, tau: 0.22 }) },
    47: { dur: 1, render: (c) => tom(c, { f: 146, tau: 0.2 }) },
    48: { dur: 0.9, render: (c) => tom(c, { f: 175, tau: 0.18 }) },
    50: { dur: 0.9, render: (c) => tom(c, { f: 208, tau: 0.16 }) },
    49: { dur: 3, render: (c, b) => cymbal(c, { tau: 0.7 + 0.3 * b }) },
    57: { dur: 3, render: (c, b) => cymbal(c, { tau: 0.6 + 0.3 * b, f: 5200 }) },
    51: { dur: 2.5, render: (c) => cymbal(c, { tau: 0.55, f: 7500, noise: 0.15 }) },
    56: { dur: 0.6, render: (c) => cowbell(c) },
  },
  drums909: {
    36: { dur: 1.1, render: (c, b) => kick(c, { f0: 300, f1: 52, tau: 0.22 + 0.04 * b, pitchTau: 0.018, click: 0.45, drive: 0.6 }) },
    35: { dur: 1.3, render: (c) => kick(c, { f0: 260, f1: 46, tau: 0.3, pitchTau: 0.02, click: 0.35, drive: 0.4 }) },
    37: { dur: 0.2, render: (c) => rim(c) },
    38: { dur: 0.7, render: (c, b) => snare(c, { tones: [220, 440], toneTau: 0.045, noiseTau: 0.14 + 0.04 * b, noiseF: 2500, mixT: 0.45, mixN: 0.9 }) },
    40: { dur: 0.8, render: (c) => snare(c, { tones: [240, 470], toneTau: 0.04, noiseTau: 0.18, noiseF: 2200, mixT: 0.4, mixN: 1 }) },
    39: { dur: 1.2, render: (c, b) => clap(c, { tail: 0.18 + 0.06 * b, f: 1400 }) },
    42: { dur: 0.3, render: (c, b) => hat(c, { tau: 0.03 + 0.01 * b, base: 1.3, noise: 0.45 }) },
    44: { dur: 0.3, render: (c) => hat(c, { tau: 0.022, base: 1.3, noise: 0.3 }) },
    46: { dur: 1.4, render: (c, b) => hat(c, { tau: 0.28 + 0.08 * b, base: 1.3, noise: 0.5 }) },
    41: { dur: 1.1, render: (c) => tom(c, { f: 90, tau: 0.2 }) },
    43: { dur: 1.1, render: (c) => tom(c, { f: 108, tau: 0.19 }) },
    45: { dur: 1, render: (c) => tom(c, { f: 135, tau: 0.18 }) },
    47: { dur: 1, render: (c) => tom(c, { f: 160, tau: 0.16 }) },
    48: { dur: 0.9, render: (c) => tom(c, { f: 190, tau: 0.15 }) },
    50: { dur: 0.9, render: (c) => tom(c, { f: 225, tau: 0.13 }) },
    49: { dur: 3.2, render: (c, b) => cymbal(c, { tau: 0.9 + 0.3 * b, f: 6500, noise: 0.6 }) },
    57: { dur: 3.2, render: (c) => cymbal(c, { tau: 0.8, f: 5600, noise: 0.6 }) },
    51: { dur: 2.8, render: (c) => cymbal(c, { tau: 0.7, f: 8000, noise: 0.25 }) },
    56: { dur: 0.6, render: (c) => cowbell(c) },
  },
  // trap / modern pop: a long tuned 808 kick, a tight crisp snare, a wide clap, very short hats
  drumstrap: {
    36: { dur: 2.4, render: (c, b) => kick(c, { f0: 170 + 30 * b, f1: 49, tau: 0.75, pitchTau: 0.03, click: 0.2 + 0.15 * b, drive: 0.55 }) },
    35: { dur: 0.9, render: (c, b) => kick(c, { f0: 220, f1: 58, tau: 0.16 + 0.04 * b, pitchTau: 0.012, click: 0.5, drive: 0.7 }) },
    37: { dur: 0.2, render: (c) => rim(c) },
    38: { dur: 0.6, render: (c, b) => snare(c, { tones: [205, 390], toneTau: 0.035, noiseTau: 0.1 + 0.03 * b, noiseF: 2600, mixT: 0.35, mixN: 1 }) },
    40: { dur: 0.5, render: (c) => snare(c, { tones: [260, 520], toneTau: 0.025, noiseTau: 0.07, noiseF: 3500, mixT: 0.3, mixN: 0.9 }) },
    39: { dur: 1.2, render: (c, b) => clap(c, { tail: 0.2 + 0.06 * b, f: 1100 }) },
    42: { dur: 0.2, render: (c, b) => hat(c, { tau: 0.014 + 0.006 * b, base: 1.45, noise: 0.55 }) },
    44: { dur: 0.2, render: (c) => hat(c, { tau: 0.01, base: 1.45, noise: 0.4 }) },
    46: { dur: 1.2, render: (c, b) => hat(c, { tau: 0.22 + 0.06 * b, base: 1.45, noise: 0.6 }) },
    41: { dur: 1.6, render: (c) => tom(c, { f: 73, tau: 0.38 }) },
    43: { dur: 1.5, render: (c) => tom(c, { f: 92, tau: 0.34 }) },
    45: { dur: 1.4, render: (c) => tom(c, { f: 116, tau: 0.3 }) },
    47: { dur: 1.3, render: (c) => tom(c, { f: 138, tau: 0.27 }) },
    48: { dur: 1.2, render: (c) => tom(c, { f: 164, tau: 0.24 }) },
    50: { dur: 1.1, render: (c) => tom(c, { f: 196, tau: 0.22 }) },
    49: { dur: 3.2, render: (c, b) => cymbal(c, { tau: 0.85 + 0.3 * b, f: 7000, noise: 0.7 }) },
    57: { dur: 3.2, render: (c) => cymbal(c, { tau: 0.7, f: 5800, noise: 0.6 }) },
    51: { dur: 2.6, render: (c) => cymbal(c, { tau: 0.6, f: 8500, noise: 0.2 }) },
    56: { dur: 0.6, render: (c) => cowbell(c) },
  },
};

// names for the step sequencer / piano roll
export const DRUM_NAMES = {
  35: 'Kick 2', 36: 'Kick', 37: 'Rim', 38: 'Snare', 39: 'Clap', 40: 'Snare 2', 41: 'Tom Low 2', 42: 'Hat Closed', 43: 'Tom Low',
  44: 'Hat Pedal', 45: 'Tom Mid 2', 46: 'Hat Open', 47: 'Tom Mid', 48: 'Tom High 2', 49: 'Crash', 50: 'Tom High', 51: 'Ride', 56: 'Cowbell', 57: 'Crash 2',
  54: 'Tambourine', 60: 'Bongo High', 61: 'Bongo Low', 62: 'Conga Mute', 63: 'Conga Open', 64: 'Conga Low', 67: 'Agogo High', 68: 'Agogo Low',
  69: 'Cabasa', 70: 'Shaker', 73: 'Guiro Short', 74: 'Guiro Long', 75: 'Claves', 76: 'Woodblock', 80: 'Triangle Mute', 81: 'Triangle', 82: 'Shaker 2', 83: 'Sleigh Bells',
};

// the drum names one kit actually has: its own names if the manifest gives them, else GM names
// for the keys it plays (info: an entry of the instrument list)
export function kitNames(info) {
  if (!info) return DRUM_NAMES;
  const keys = info.keyNames ? Object.keys(info.keyNames).map(Number)
    : info.procedural && KITS[info.procedural] ? Object.keys(KITS[info.procedural]).map(Number)
      : info.kitKeys || Object.keys(DRUM_NAMES).map(Number);
  const out = {};
  for (const k of keys.sort((a, b) => a - b)) out[k] = info.keyNames?.[k] || DRUM_NAMES[k] || `Key ${k}`;
  return out;
}
