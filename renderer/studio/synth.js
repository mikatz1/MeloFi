// i18n: source table — every Korean string here is UI text and a translation key; the screen that shows it calls t() (docs/i18n.md)
// MeloFi Studio — an editable subtractive synthesizer channel (like FL's 3x Osc / a simple
// Sytrus): two oscillators with unison, sub and noise, a filter with its own envelope, an amp
// envelope, an LFO and glide. Built per note from Web Audio nodes, so it plays live and renders
// offline exactly the same.

const P = (key, label, min, max, def, extra = {}) => ({ key, label, min, max, def, ...extra });
const WAVES = ['sawtooth', 'square', 'triangle', 'sine'];
// past the four built-in shapes: harmonic recipes as periodic waves (made once per audio context)
const WAVE_NAMES = ['톱니파', '사각파', '삼각파', '사인파', '펄스 25%', '펄스 12%', '드로바 오르간', '브라스 (배음 많음)', '보컬 (아)', '보컬 (우)', '튜브 (하프 사인)'];
const HARM = 48;
const RECIPES = [
  (k) => [0, Math.sin(Math.PI * k * 0.25) / k],                       // pulse 25%
  (k) => [0, Math.sin(Math.PI * k * 0.125) / k],                      // pulse 12.5%
  (k) => [0, ({ 1: 1, 2: 0.8, 3: 0.6, 4: 0.5, 6: 0.35, 8: 0.3, 10: 0.12, 12: 0.15, 16: 0.1 })[k] || 0], // drawbars 888 600 000-ish
  (k) => [0, (1 / k) * (k <= 8 ? 1 : 0.6) * (1 + 0.5 * Math.exp(-((k - 4) ** 2) / 6))],              // bright brass
  (k) => [0, formant(k, [[730, 90], [1090, 110], [2440, 160]])],     // "ah"
  (k) => [0, formant(k, [[300, 70], [870, 90], [2240, 150]])],       // "oo"
  (k) => [k === 1 ? 0 : (k % 2 === 0 ? -2 / Math.PI / (k * k - 1) : 0), k === 1 ? 0.5 : 0],             // half-wave rectified sine
];
// a vowel as a harmonic spectrum around 220 Hz: peaks at the formants
function formant(k, peaks) {
  const f = 220 * k;
  return peaks.reduce((a, [fc, bw], i) => a + (i ? 0.6 : 1) * Math.exp(-(((f - fc) / bw) ** 2) / 2), 0) / Math.sqrt(k) + 0.02 / k;
}
const waveCache = new WeakMap();
function setWave(c, o, w) {
  const i = Math.round(w);
  if (i < 4) { o.type = WAVES[i] || 'sawtooth'; return; }
  let list = waveCache.get(c);
  if (!list) { list = []; waveCache.set(c, list); }
  if (!list[i]) {
    const re = new Float32Array(HARM), im = new Float32Array(HARM), r = RECIPES[i - 4] || RECIPES[0];
    for (let k = 1; k < HARM; k++) { const [a, b] = r(k); re[k] = a; im[k] = b; }
    list[i] = c.createPeriodicWave(re, im);
  }
  o.setPeriodicWave(list[i]);
}
// soft saturation curves, one per drive amount
const driveCurves = new Map();
function driveCurve(d) {
  const k = Math.round(d * 20) / 20;
  if (!driveCurves.has(k)) {
    const g = 1 + k * 12;
    driveCurves.set(k, Float32Array.from({ length: 2049 }, (_, i) => { const x = i / 1024 - 1; return Math.tanh(g * x) / Math.tanh(g); }));
  }
  return driveCurves.get(k);
}

export const SYNTH_PARAMS = [
  { group: '오실레이터 1' },
  P('w1', '파형', 0, WAVE_NAMES.length - 1, 0, { choices: WAVE_NAMES }), P('o1', '옥타브', -2, 2, 0, { step: 1 }), P('l1', '크기', 0, 1, 0.8, { step: 0.01 }),
  { group: '오실레이터 2' },
  P('w2', '파형', 0, WAVE_NAMES.length - 1, 1, { choices: WAVE_NAMES }), P('o2', '옥타브', -2, 2, 0, { step: 1 }), P('s2', '반음', -12, 12, 0, { step: 1 }),
  P('f2', '미세 조정', -50, 50, 7, { step: 1, unit: 'ct' }), P('l2', '크기', 0, 1, 0.4, { step: 0.01 }),
  { group: 'FM (오실레이터 1을 변조)' },
  P('fm', 'FM 양', 0, 10, 0, { step: 0.1 }), P('fmr', 'FM 비율', 0.5, 14, 2, { step: 0.5 }), P('fmd', 'FM 감쇠', 0.01, 4, 0.6, { log: true, unit: 's' }),
  { group: '서브·노이즈' },
  P('sub', '서브 (한 옥타브 아래)', 0, 1, 0, { step: 0.01 }), P('noise', '노이즈', 0, 1, 0, { step: 0.01 }),
  { group: '유니즌' },
  P('uni', '보이스 수', 1, 7, 1, { step: 1 }), P('det', '디튠', 0, 60, 18, { step: 1, unit: 'ct' }), P('spread', '좌우 퍼짐', 0, 1, 0.6, { step: 0.01 }),
  { group: '필터' },
  P('ft', '종류', 0, 2, 0, { choices: ['로우패스', '하이패스', '밴드패스'] }), P('cut', '컷오프', 40, 18000, 4000, { log: true, unit: 'Hz' }),
  P('res', '레조넌스', 0.1, 15, 1, { step: 0.1 }), P('fenv', '엔벨로프 양', -4, 4, 1.5, { step: 0.1, unit: 'oct' }), P('kt', '키 따라가기', 0, 1, 0.5, { step: 0.01 }),
  { group: '필터 엔벨로프' },
  P('fa', '어택', 0.001, 3, 0.005, { log: true, unit: 's' }), P('fd', '디케이', 0.01, 4, 0.35, { log: true, unit: 's' }), P('fs', '서스테인', 0, 1, 0.3, { step: 0.01 }), P('fr', '릴리스', 0.01, 5, 0.3, { log: true, unit: 's' }),
  { group: '앰프 엔벨로프' },
  P('aa', '어택', 0.001, 4, 0.004, { log: true, unit: 's' }), P('ad', '디케이', 0.01, 4, 0.3, { log: true, unit: 's' }), P('as', '서스테인', 0, 1, 0.8, { step: 0.01 }), P('ar', '릴리스', 0.01, 6, 0.25, { log: true, unit: 's' }),
  { group: 'LFO' },
  P('lt', '대상', 0, 3, 0, { choices: ['끔', '음높이 (비브라토)', '필터', '볼륨 (트레몰로)'] }), P('lr', '속도', 0.1, 12, 5, { step: 0.1, unit: 'Hz' }), P('ld', '깊이', 0, 1, 0.2, { step: 0.01 }),
  { group: '기타 설정' },
  P('drv', '드라이브', 0, 1, 0, { step: 0.01 }),
  P('lvl', '레벨 보정', -24, 24, 0, { step: 0.1, unit: 'dB' }),
  P('glide', '글라이드', 0, 0.5, 0, { step: 0.005, unit: 's' }), P('vol', '볼륨', 0, 1, 0.7, { step: 0.01 }),
];

export const synthDefaults = () => Object.fromEntries(SYNTH_PARAMS.filter((p) => p.key).map((p) => [p.key, p.def]));

// presets and their browser categories live in synth-presets.js
import { SYNTH_PRESETS, SYNTH_CATEGORIES } from './synth-presets.js';
export { SYNTH_PRESETS, SYNTH_CATEGORIES };

const cents = (c) => Math.pow(2, c / 1200);
const freqOf = (n) => 440 * Math.pow(2, (n - 69) / 12);

let noiseBuf = null;
function noise(c) {
  if (!noiseBuf || noiseBuf.sampleRate !== c.sampleRate) {
    noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    let s = 1;
    for (let i = 0; i < d.length; i++) { s = (s * 16807) % 2147483647; d[i] = s / 1073741823.5 - 1; }
  }
  const n = c.createBufferSource(); n.buffer = noiseBuf; n.loop = true;
  return n;
}

const hold = (p, t) => { if (p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(t); else p.cancelScheduledValues(t); };

// ADSR on an AudioParam: from `base` up to `peak`, down to base + (peak-base)*sus
function adsr(p, at, base, peak, a, d, s) {
  p.cancelScheduledValues(at);
  p.setValueAtTime(base, at);
  p.linearRampToValueAtTime(peak, at + a);
  p.setTargetAtTime(base + (peak - base) * s, at + a, Math.max(0.001, d / 3));
}

export class SynthChannel {
  constructor(ctx, out) {
    this.ctx = ctx;
    this.out = out;
    this.p = synthDefaults();
    this.voices = new Set();
    this.held = new Map();
    this.lastNote = null;
  }

  setParams(params) { this.p = { ...synthDefaults(), ...(params || {}) }; }

  // opts: { fine (cents), pan (-1..1), glideFrom (note) }
  noteOn(note, vel, at = 0, dur = null, opts = {}) {
    const c = this.ctx, p = this.p;
    const t0 = Math.max(at || 0, c.currentTime);
    const f = freqOf(note) * cents(opts.fine || 0);
    const glideFrom = opts.glideFrom ?? (p.glide > 0 && this.lastNote != null && this.lastHeld ? this.lastNote : null);
    this.lastNote = note;
    // lvl: the preset's measured level trim (dB), so presets sit at their family's loudness
    const vg = 0.18 * p.vol * Math.pow(10, (p.lvl || 0) / 20) * (0.35 + 0.65 * (vel / 127) * (vel / 127));
    const v = { nodes: [], stopAt: Infinity };
    const mix = c.createGain(); mix.gain.value = 1;
    const filt = c.createBiquadFilter(); filt.type = ['lowpass', 'highpass', 'bandpass'][Math.round(p.ft)] || 'lowpass'; filt.Q.value = p.res;
    const amp = c.createGain(); amp.gain.value = 0;
    let tail = amp;
    if (opts.pan) { const pn = c.createStereoPanner(); pn.pan.value = opts.pan; amp.connect(pn); tail = pn; v.nodes.push(pn); }
    if (p.drv > 0.01) {
      const ws = c.createWaveShaper(); ws.curve = driveCurve(p.drv); ws.oversample = '2x';
      const comp = c.createGain(); comp.gain.value = 1 / (1 + p.drv * 0.8);
      mix.connect(filt).connect(ws).connect(comp).connect(amp); v.nodes.push(ws, comp);
    } else mix.connect(filt).connect(amp);
    tail.connect(this.out);
    v.nodes.push(mix, filt, amp);
    const oscs = [];
    // FM: a sine at the ratio modulates oscillator 1's frequency, its depth easing off over fmd
    let fmGain = null;
    if (p.fm > 0) {
      const mf = f * p.fmr, mod = c.createOscillator(); mod.frequency.value = mf;
      fmGain = c.createGain();
      const top = mf * p.fm;
      fmGain.gain.setValueAtTime(top, t0);
      fmGain.gain.setTargetAtTime(top * 0.15, t0 + 0.002, Math.max(0.005, p.fmd / 3));
      mod.connect(fmGain); oscs.push(mod); v.nodes.push(fmGain);
    }
    const addOsc = (wave, freq, level, detuneSpread, fmTo = false) => {
      if (level <= 0) return;
      const n = Math.max(1, Math.round(p.uni));
      for (let i = 0; i < n; i++) {
        const o = c.createOscillator(); setWave(c, o, wave);
        if (fmTo && fmGain) fmGain.connect(o.frequency);
        const off = n === 1 ? 0 : (i / (n - 1) - 0.5) * 2; // -1..1
        o.detune.value = off * detuneSpread;
        const g = c.createGain(); g.gain.value = level / Math.sqrt(n);
        if (n > 1 && p.spread > 0) { const pn = c.createStereoPanner(); pn.pan.value = off * p.spread; o.connect(g).connect(pn).connect(mix); v.nodes.push(pn); } else o.connect(g).connect(mix);
        if (glideFrom != null) { o.frequency.setValueAtTime(freq * freqOf(glideFrom) / freqOf(note), t0); o.frequency.exponentialRampToValueAtTime(freq, t0 + Math.max(0.005, p.glide)); } else o.frequency.value = freq;
        oscs.push(o); v.nodes.push(g);
      }
    };
    addOsc(p.w1, f * Math.pow(2, Math.round(p.o1)), p.l1, p.det, true);
    addOsc(p.w2, f * Math.pow(2, Math.round(p.o2) + Math.round(p.s2) / 12) * cents(p.f2), p.l2, p.det);
    if (p.sub > 0) { const o = c.createOscillator(); o.type = 'square'; o.frequency.value = f / 2; const g = c.createGain(); g.gain.value = p.sub * 0.6; o.connect(g).connect(mix); oscs.push(o); v.nodes.push(g); }
    if (p.noise > 0) { const nz = noise(c); const g = c.createGain(); g.gain.value = p.noise * 0.5; nz.connect(g).connect(mix); oscs.push(nz); v.nodes.push(g); }
    // filter: cutoff follows the key and its envelope (in octaves)
    const base = Math.min(c.sampleRate * 0.45, p.cut * Math.pow(f / 261.6, p.kt));
    const peak = Math.min(c.sampleRate * 0.45, base * Math.pow(2, p.fenv));
    adsr(filt.frequency, t0, base, Math.max(20, peak), p.fa, p.fd, p.fs);
    adsr(amp.gain, t0, 0, vg, p.aa, p.ad, p.as);
    // LFO
    const lt = Math.round(p.lt);
    if (lt > 0 && p.ld > 0) {
      const lfo = c.createOscillator(); lfo.frequency.value = p.lr;
      const dep = c.createGain();
      if (lt === 1) { dep.gain.value = p.ld * 60; lfo.connect(dep); for (const o of oscs) if (o.detune) dep.connect(o.detune); }
      else if (lt === 2) { dep.gain.value = base * p.ld * 2; lfo.connect(dep).connect(filt.frequency); }
      else { const trem = c.createGain(); trem.gain.value = 1 - p.ld / 2; dep.gain.value = p.ld / 2; lfo.connect(dep).connect(trem.gain); filt.disconnect(); filt.connect(trem).connect(amp); v.nodes.push(trem); }
      oscs.push(lfo); v.nodes.push(dep);
    }
    for (const o of oscs) o.start(t0);
    v.oscs = oscs; v.amp = amp; v.filt = filt; v.base = base;
    this.voices.add(v);
    if (dur != null) this.release(v, t0 + dur);
    return v;
  }

  release(v, at) {
    const c = this.ctx, p = this.p;
    const t = Math.max(at, c.currentTime);
    if (t >= v.stopAt) return;
    // hold whatever level the envelope reached (a note shorter than the attack must still sound;
    // cancelScheduledValues would drop the unfinished attack ramp and leave the voice silent)
    hold(v.amp.gain, t);
    v.amp.gain.setTargetAtTime(0, t, Math.max(0.003, p.ar / 4));
    hold(v.filt.frequency, t);
    v.filt.frequency.setTargetAtTime(v.base, t, Math.max(0.003, p.fr / 4));
    const end = t + p.ar * 1.6 + 0.05;
    v.stopAt = end;
    for (const o of v.oscs) { try { o.stop(end); } catch { /* already */ } }
    v.oscs[0].onended = () => { for (const n of v.nodes) try { n.disconnect(); } catch { /* gone */ } this.voices.delete(v); };
  }

  liveOn(note, vel) { this.liveOff(note); this.lastHeld = this.held.size > 0; const v = this.noteOn(note, vel); this.held.set(note, v); }
  liveOff(note) { const v = this.held.get(note); if (v) { this.release(v, this.ctx.currentTime); this.held.delete(note); } }

  stop() {
    const t = this.ctx.currentTime;
    for (const v of this.voices) {
      if (v.stopAt <= t) continue;
      hold(v.amp.gain, t); v.amp.gain.setTargetAtTime(0, t, 0.01);
      for (const o of v.oscs) try { o.stop(t + 0.08); } catch { /* already */ }
      v.stopAt = t + 0.08;
    }
    this.held.clear();
  }

  dispose() { this.stop(); }
}
