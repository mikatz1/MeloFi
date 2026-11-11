// MeloFi Studio — an editable subtractive synthesizer channel (like FL's 3x Osc / a simple
// Sytrus): two oscillators with unison, sub and noise, a filter with its own envelope, an amp
// envelope, an LFO and glide. Built per note from Web Audio nodes, so it plays live and renders
// offline exactly the same.

const P = (key, label, min, max, def, extra = {}) => ({ key, label, min, max, def, ...extra });
const WAVES = ['sawtooth', 'square', 'triangle', 'sine'];
const WAVE_NAMES = ['톱니파', '사각파', '삼각파', '사인파'];

export const SYNTH_PARAMS = [
  { group: '오실레이터 1' },
  P('w1', '파형', 0, 3, 0, { choices: WAVE_NAMES }), P('o1', '옥타브', -2, 2, 0, { step: 1 }), P('l1', '크기', 0, 1, 0.8, { step: 0.01 }),
  { group: '오실레이터 2' },
  P('w2', '파형', 0, 3, 1, { choices: WAVE_NAMES }), P('o2', '옥타브', -2, 2, 0, { step: 1 }), P('s2', '반음', -12, 12, 0, { step: 1 }),
  P('f2', '미세 조정', -50, 50, 7, { step: 1, unit: 'ct' }), P('l2', '크기', 0, 1, 0.4, { step: 0.01 }),
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
  { group: '기타' },
  P('glide', '글라이드', 0, 0.5, 0, { step: 0.005, unit: 's' }), P('vol', '볼륨', 0, 1, 0.7, { step: 0.01 }),
];

export const synthDefaults = () => Object.fromEntries(SYNTH_PARAMS.filter((p) => p.key).map((p) => [p.key, p.def]));

// presets: only what differs from the defaults
export const SYNTH_PRESETS = {
  '기본 쏘': {},
  '슈퍼쏘 리드': { w2: 0, l2: 0.6, f2: 0, uni: 7, det: 28, spread: 0.9, cut: 9000, res: 0.8, fenv: 0.8, as: 0.9, ar: 0.35 },
  '퓨처 베이스 코드': { w2: 0, uni: 5, det: 22, cut: 1800, res: 2, fenv: 2.4, fd: 0.25, fs: 0.15, aa: 0.003, ad: 0.6, as: 0.7, lt: 2, lr: 4, ld: 0.15 },
  '808 서브': { w1: 3, l1: 1, l2: 0, sub: 0, cut: 2500, fenv: 0, as: 0.85, ad: 1.6, ar: 0.2, glide: 0.06, vol: 0.85 },
  '리스 베이스': { w2: 0, f2: 12, l2: 0.8, uni: 2, det: 14, cut: 900, res: 1.4, fenv: 1, kt: 0.3 },
  '신스 베이스': { w2: 1, o2: -1, l2: 0.5, cut: 700, res: 4, fenv: 2.5, fd: 0.18, fs: 0.1, ar: 0.12 },
  '플럭': { w2: 1, l2: 0.5, cut: 1200, res: 2, fenv: 3.5, fd: 0.16, fs: 0, ad: 0.5, as: 0, ar: 0.25 },
  '따뜻한 패드': { w2: 0, f2: 9, uni: 3, det: 16, cut: 1600, res: 0.7, fenv: 1, fa: 1.2, fd: 1.5, fs: 0.6, aa: 0.8, ad: 1, as: 0.9, ar: 1.8, lt: 2, lr: 0.3, ld: 0.2 },
  '브라스': { w2: 0, f2: 6, uni: 2, det: 10, cut: 1200, res: 1, fenv: 2, fa: 0.06, fd: 0.4, fs: 0.5, aa: 0.04, ar: 0.25 },
  '칩튠 리드': { w1: 1, l2: 0, cut: 18000, fenv: 0, lt: 1, lr: 6, ld: 0.08, aa: 0.001, ar: 0.05 },
  '레트로 리드': { w1: 1, w2: 0, o2: 1, l2: 0.3, cut: 3500, res: 3, fenv: 1, lt: 1, lr: 5.5, ld: 0.1, glide: 0.04 },
  '오르간': { w1: 3, w2: 3, o2: 1, l2: 0.6, s2: 0, f2: 0, sub: 0.4, cut: 12000, fenv: 0, aa: 0.005, as: 1, ar: 0.06, lt: 1, lr: 6, ld: 0.04 },
  '벨': { w1: 3, w2: 2, o2: 2, s2: 7, f2: 0, l2: 0.5, cut: 9000, fenv: 0, ad: 1.5, as: 0, ar: 1.2 },
  // more presets, browsed by category like FL Studio's FLEX
  '애시드 베이스': { w1: 0, l2: 0, cut: 500, res: 12, fenv: 3, fd: 0.2, fs: 0, kt: 0.2, as: 0.7, ar: 0.08, glide: 0.05 },
  '딥 하우스 베이스': { w1: 3, w2: 2, o2: -1, l2: 0.5, f2: 0, cut: 900, res: 1, fenv: 1, ad: 0.4, as: 0.6, ar: 0.1, vol: 0.8 },
  '펀치 베이스': { w1: 1, w2: 0, o2: -1, l2: 0.6, cut: 600, res: 2, fenv: 3, fd: 0.1, fs: 0.2, ar: 0.08 },
  '사인 리드': { w1: 3, l2: 0, cut: 18000, fenv: 0, lt: 1, lr: 5, ld: 0.06, glide: 0.05, ar: 0.2 },
  '스퀘어 리드': { w1: 1, w2: 1, f2: 10, l2: 0.5, cut: 4000, res: 1.5, fenv: 1, ar: 0.2 },
  '스트링 패드': { w2: 0, f2: 12, uni: 5, det: 20, spread: 0.9, cut: 2500, fenv: 0.5, fa: 0.8, aa: 0.6, as: 0.85, ar: 1.5, lt: 1, lr: 5, ld: 0.03 },
  '앰비언트 패드': { w1: 2, w2: 3, o2: 1, l2: 0.5, uni: 4, det: 12, cut: 1200, res: 1.5, fenv: 1.5, fa: 3, fd: 3, fs: 0.5, aa: 2.5, as: 1, ar: 4, lt: 2, lr: 0.15, ld: 0.4, noise: 0.03 },
  '다크 패드': { w2: 0, o2: -1, l2: 0.5, uni: 3, det: 10, cut: 600, res: 2, fenv: 0.8, fa: 1.5, aa: 1.2, as: 0.9, ar: 2.5 },
  '하프 플럭': { w1: 2, w2: 3, o2: 1, l2: 0.4, f2: 0, cut: 5000, fenv: 2, fd: 0.3, fs: 0, ad: 1.2, as: 0, ar: 0.8 },
  '하우스 스탭': { w2: 0, uni: 3, det: 15, cut: 2000, res: 3, fenv: 2.5, fd: 0.12, fs: 0.05, ad: 0.25, as: 0, ar: 0.1 },
  '일렉 피아노': { w1: 3, w2: 2, o2: 1, l2: 0.3, f2: 4, cut: 6000, fenv: 1, fd: 0.6, fs: 0.3, ad: 1.8, as: 0.2, ar: 0.5, lt: 3, lr: 4, ld: 0.12 },
  '마림바': { w1: 3, w2: 3, o2: 2, l2: 0.25, f2: 0, cut: 8000, fenv: 0, aa: 0.001, ad: 0.35, as: 0, ar: 0.2 },
  '라이저 노이즈': { l1: 0, l2: 0, noise: 1, cut: 1200, res: 5, fenv: 3, fa: 2, fd: 0.5, fs: 1, aa: 1, as: 1, ar: 1, lt: 2, lr: 0.5, ld: 0.3, vol: 0.9 },
  '레이저 FX': { w1: 0, l2: 0, cut: 8000, res: 8, fenv: -3, fd: 0.4, fs: 0, ad: 0.5, as: 0, ar: 0.2 },
  '사이렌 FX': { w1: 3, l2: 0, cut: 18000, fenv: 0, lt: 1, lr: 2, ld: 1, ar: 0.3, vol: 0.6 },
};

// categories for the preset browser (FL Studio's FLEX browses its presets the same way)
export const SYNTH_CATEGORIES = {
  '베이스': ['808 서브', '리스 베이스', '신스 베이스', '애시드 베이스', '딥 하우스 베이스', '펀치 베이스'],
  '리드': ['기본 쏘', '슈퍼쏘 리드', '칩튠 리드', '레트로 리드', '사인 리드', '스퀘어 리드'],
  '패드': ['따뜻한 패드', '스트링 패드', '앰비언트 패드', '다크 패드'],
  '플럭·건반': ['플럭', '퓨처 베이스 코드', '하프 플럭', '하우스 스탭', '일렉 피아노', '오르간', '벨', '마림바'],
  '브라스·FX': ['브라스', '라이저 노이즈', '레이저 FX', '사이렌 FX'],
};

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
    const vg = 0.18 * p.vol * (0.35 + 0.65 * (vel / 127) * (vel / 127));
    const v = { nodes: [], stopAt: Infinity };
    const mix = c.createGain(); mix.gain.value = 1;
    const filt = c.createBiquadFilter(); filt.type = ['lowpass', 'highpass', 'bandpass'][Math.round(p.ft)] || 'lowpass'; filt.Q.value = p.res;
    const amp = c.createGain(); amp.gain.value = 0;
    let tail = amp;
    if (opts.pan) { const pn = c.createStereoPanner(); pn.pan.value = opts.pan; amp.connect(pn); tail = pn; v.nodes.push(pn); }
    mix.connect(filt).connect(amp);
    tail.connect(this.out);
    v.nodes.push(mix, filt, amp);
    const oscs = [];
    const addOsc = (wave, freq, level, detuneSpread) => {
      if (level <= 0) return;
      const n = Math.max(1, Math.round(p.uni));
      for (let i = 0; i < n; i++) {
        const o = c.createOscillator(); o.type = WAVES[Math.round(wave)] || 'sawtooth';
        const off = n === 1 ? 0 : (i / (n - 1) - 0.5) * 2; // -1..1
        o.detune.value = off * detuneSpread;
        const g = c.createGain(); g.gain.value = level / Math.sqrt(n);
        if (n > 1 && p.spread > 0) { const pn = c.createStereoPanner(); pn.pan.value = off * p.spread; o.connect(g).connect(pn).connect(mix); v.nodes.push(pn); } else o.connect(g).connect(mix);
        if (glideFrom != null) { o.frequency.setValueAtTime(freq * freqOf(glideFrom) / freqOf(note), t0); o.frequency.exponentialRampToValueAtTime(freq, t0 + Math.max(0.005, p.glide)); } else o.frequency.value = freq;
        oscs.push(o); v.nodes.push(g);
      }
    };
    addOsc(p.w1, f * Math.pow(2, Math.round(p.o1)), p.l1, p.det);
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
