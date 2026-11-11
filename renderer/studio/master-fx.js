// i18n: source table — every Korean string here is UI text and a translation key; the screen that shows it calls t() (docs/i18n.md)
// MeloFi Studio — mastering processors (they join FX_TYPES in fx.js): eight-band parametric EQ
// (per-band mid/side, linear phase), five-band compressor, four-band stereo imager, four-band
// dynamic EQ, saturation, de-esser, soft clipper
// and a lookahead true-peak maximizer. Same unit shape as every other effect.

const P = (key, label, min, max, def, extra = {}) => ({ key, label, min, max, def, ...extra });
const db = (v) => Math.pow(10, v / 20);
// Web Audio takes a low-/high-pass Q in dB (resonance), not as a ratio: Butterworth is -3.01 dB
const BW = -3.0103;
// where a tone band of the EQ applies
const WHERE = { choices: ['스테레오', '미드', '사이드'] };
function biq(c, type, f, q = 0.7) { const b = c.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; }

function unit(input, output, map, setters = {}, stop = null) {
  return {
    input, output, map, setters,
    set(params, at) {
      for (const [k, v] of Object.entries(params)) {
        if (this.setters[k]) this.setters[k](v, at);
        else if (map[k]) map[k].setTargetAtTime(v, at, 0.015);
      }
    },
    param(k) { return map[k] || null; },
    dispose() { try { stop?.(); input.disconnect(); output.disconnect(); } catch { /* gone */ } },
  };
}

// Linkwitz-Riley 24 dB/oct: two Butterworth stages per side; low + high adds up to an all-pass
// (Q 0.707), so bands split this way sum back flat
function lr4(c, type, f) {
  const a = biq(c, type, f, BW), b = biq(c, type, f, BW);
  a.connect(b);
  return { in: a, out: b, set: (v, at) => { a.frequency.setTargetAtTime(v, at, 0.015); b.frequency.setTargetAtTime(v, at, 0.015); } };
}

function twoBands(c, src, f) {
  const lo = lr4(c, 'lowpass', f), hi = lr4(c, 'highpass', f);
  src.connect(lo.in); src.connect(hi.in);
  return { low: lo.out, high: hi.out, set: (v, at) => { lo.set(v, at); hi.set(v, at); } };
}

// n bands from n-1 crossovers that add back to an all-pass: each split's low side also goes through
// the all-passes of the splits above it, so every band carries the same phase
function bandSplit(c, src, freqs) {
  const bands = [], xs = [];
  let cur = src;
  freqs.forEach((f, i) => {
    const lo = lr4(c, 'lowpass', f), hi = lr4(c, 'highpass', f);
    cur.connect(lo.in); cur.connect(hi.in);
    let node = lo.out;
    const aps = [];
    for (const g of freqs.slice(i + 1)) { const ap = biq(c, 'allpass', g, 0.7071); node.connect(ap); node = ap; aps.push(ap); }
    bands.push(node);
    xs.push({ lo, hi, aps: [] });
    // the all-passes of later splits sit in the bands below them
    aps.forEach((ap, k) => xs[i + 1 + k] ? xs[i + 1 + k].aps.push(ap) : (xs.pending ||= []).push([i + 1 + k, ap]));
    cur = hi.out;
  });
  for (const [k, ap] of xs.pending || []) xs[k].aps.push(ap);
  bands.push(cur);
  const setX = (i, v, at) => { const x = xs[i]; x.lo.set(v, at); x.hi.set(v, at); for (const ap of x.aps) ap.frequency.setTargetAtTime(v, at, 0.015); };
  return { bands, setX };
}

// all-passes matching bandSplit's phase, for a signal that is not split (the imager's mid)
function allpassChain(c, src, freqs) {
  let node = src;
  const aps = freqs.map((f) => { const ap = biq(c, 'allpass', f, 0.7071); node.connect(ap); node = ap; return ap; });
  return { out: node, set: (i, v, at) => aps[i].frequency.setTargetAtTime(v, at, 0.015) };
}

// stereo <-> mid / side
function msPair(c, input) {
  const split = c.createChannelSplitter(2), mid = c.createGain(), side = c.createGain(), inv = c.createGain();
  mid.gain.value = 0.5; side.gain.value = 0.5; inv.gain.value = -1;
  input.connect(split);
  split.connect(mid, 0); split.connect(mid, 1); split.connect(side, 0); split.connect(inv, 1); inv.connect(side);
  return { mid, side };
}
function msJoin(c, mid, side) {
  const out = c.createChannelMerger(2), neg = c.createGain();
  neg.gain.value = -1;
  mid.connect(out, 0, 0); mid.connect(out, 0, 1); side.connect(out, 0, 0); side.connect(neg); neg.connect(out, 0, 1);
  return out;
}

// a linear-phase FIR with the magnitude of a chain of biquads: zero-phase spectrum -> inverse DFT,
// centred and windowed (8192 taps: 85 ms of delay at 48 kHz)
function linearFir(c, filters) {
  const N = 8192, sr = c.sampleRate, half = N / 2;
  const freqs = Float32Array.from({ length: half + 1 }, (_, k) => Math.max(1, (k * sr) / N));
  const mag = new Float64Array(half + 1).fill(1), m = new Float32Array(half + 1), ph = new Float32Array(half + 1);
  for (const f of filters) { f.getFrequencyResponse(freqs, m, ph); for (let k = 0; k <= half; k++) mag[k] *= m[k]; }
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let k = 0; k <= half; k++) { re[k] = mag[k]; if (k && k < half) re[N - k] = mag[k]; }
  fftInPlace(re, im, true);
  const buf = c.createBuffer(1, N, sr), d = buf.getChannelData(0);
  for (let i = 0; i < N; i++) {
    const j = (i + half) % N, w = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (N - 1));
    d[i] = (re[j] / N) * w;
  }
  return buf;
}

function fftInPlace(re, im, inverse = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const a = ((inverse ? 2 : -2) * Math.PI) / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const j = i + k + len / 2, vr = re[j] * cr - im[j] * ci, vi = re[j] * ci + im[j] * cr;
        re[j] = re[i + k] - vr; im[j] = im[i + k] - vi; re[i + k] += vr; im[i + k] += vi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

// The browser's compressor adds a hidden make-up gain: (1 / gain at 0 dBFS) ^ 0.6. Its static curve
// is linear up to the threshold, an exponential knee (slope easing from 1 to 1/ratio) over `knee` dB,
// then 1/ratio. This returns that make-up in dB so it can be taken back out.
export function autoMakeup(thresholdDb, ratio, kneeDb) {
  if (ratio <= 1.0001) return 0;
  const lin = (d) => 10 ** (d / 20), lt = lin(thresholdDb), kneeT = lin(thresholdDb + kneeDb), slope = 1 / ratio;
  const curve = (x, k) => (x < lt ? x : lt + (1 - Math.exp(-k * (x - lt))) / k);
  const dbSlope = (x, k) => { const x2 = x * 1.001, y = curve(x, k), y2 = curve(x2, k); return (20 * Math.log10(y2 / y)) / (20 * Math.log10(x2 / x)); };
  let y0;
  if (kneeDb <= 0.01) y0 = thresholdDb + (0 - thresholdDb) * slope;
  else {
    // the knee's k: its slope at the end of the knee is 1/ratio
    let lo = 0.1, hi = 10000;
    for (let i = 0; i < 60; i++) { const k = Math.sqrt(lo * hi); if (dbSlope(kneeT, k) > slope) lo = k; else hi = k; }
    const k = Math.sqrt(lo * hi);
    const yKnee = 20 * Math.log10(curve(kneeT, k));
    y0 = thresholdDb + kneeDb >= 0 ? 20 * Math.log10(curve(1, k)) : yKnee + (0 - (thresholdDb + kneeDb)) * slope;
  }
  return -0.6 * y0;
}

export const MASTER_TYPES = {
  // eight bands (low cut, low shelf, four bells, high shelf, high cut); each tone band works on the
  // whole stereo signal, or only its mid or its side; minimum or linear phase
  peq: {
    name: '파라메트릭 EQ', hint: '8밴드 정밀 EQ · 밴드마다 미드/사이드 · 선형 위상 (마스터링용)',
    params: [
      P('phase', '위상', 0, 1, 0, { choices: ['최소 위상 (지연 없음)', '선형 위상 (85ms 지연, 위상 변화 없음)'] }),
      P('hpF', '로우 컷', 10, 500, 10, { unit: 'Hz', log: true }),
      P('lsF', '로우 셸프', 30, 500, 100, { unit: 'Hz', log: true }), P('lsG', '로우 셸프 양', -12, 12, 0, { unit: 'dB', step: 0.1 }), P('lsW', '로우 셸프 적용', 0, 2, 0, WHERE),
      P('p1F', '밴드 1', 30, 1000, 120, { unit: 'Hz', log: true }), P('p1G', '밴드 1 양', -12, 12, 0, { unit: 'dB', step: 0.1 }), P('p1Q', '밴드 1 폭', 0.2, 8, 1, { step: 0.05 }), P('p1W', '밴드 1 적용', 0, 2, 0, WHERE),
      P('p2F', '밴드 2', 100, 4000, 400, { unit: 'Hz', log: true }), P('p2G', '밴드 2 양', -12, 12, 0, { unit: 'dB', step: 0.1 }), P('p2Q', '밴드 2 폭', 0.2, 8, 1, { step: 0.05 }), P('p2W', '밴드 2 적용', 0, 2, 0, WHERE),
      P('p3F', '밴드 3', 400, 10000, 2000, { unit: 'Hz', log: true }), P('p3G', '밴드 3 양', -12, 12, 0, { unit: 'dB', step: 0.1 }), P('p3Q', '밴드 3 폭', 0.2, 8, 1, { step: 0.05 }), P('p3W', '밴드 3 적용', 0, 2, 0, WHERE),
      P('p4F', '밴드 4', 1500, 18000, 6000, { unit: 'Hz', log: true }), P('p4G', '밴드 4 양', -12, 12, 0, { unit: 'dB', step: 0.1 }), P('p4Q', '밴드 4 폭', 0.2, 8, 1, { step: 0.05 }), P('p4W', '밴드 4 적용', 0, 2, 0, WHERE),
      P('hsF', '하이 셸프', 2000, 18000, 8000, { unit: 'Hz', log: true }), P('hsG', '하이 셸프 양', -12, 12, 0, { unit: 'dB', step: 0.1 }), P('hsW', '하이 셸프 적용', 0, 2, 0, WHERE),
      P('lpF', '하이 컷', 2000, 22000, 22000, { unit: 'Hz', log: true }),
      P('out', '출력', -12, 12, 0, { unit: 'dB', step: 0.1 }),
    ],
    build(c) {
      // one chain for the mid and one for the side; a band set to "both" is the same in each,
      // which is exactly stereo processing (the encode / decode is lossless)
      const chain = () => {
        const f = { hp: biq(c, 'highpass', 10, BW), ls: biq(c, 'lowshelf', 100), p1: biq(c, 'peaking', 120, 1), p2: biq(c, 'peaking', 400, 1), p3: biq(c, 'peaking', 2000, 1), p4: biq(c, 'peaking', 6000, 1), hs: biq(c, 'highshelf', 8000), lp: biq(c, 'lowpass', 22000, BW) };
        f.hp.connect(f.ls).connect(f.p1).connect(f.p2).connect(f.p3).connect(f.p4).connect(f.hs).connect(f.lp);
        return f;
      };
      const input = c.createGain(), out = c.createGain();
      const { mid, side } = msPair(c, input);
      const M = chain(), S = chain(), mOut = c.createGain(), sOut = c.createGain();
      msJoin(c, mOut, sOut).connect(out);
      const convM = c.createConvolver(), convS = c.createConvolver();
      convM.normalize = false; convS.normalize = false;
      const nyq = c.sampleRate * 0.49;
      const st = {};
      for (const p of MASTER_TYPES.peq.params) st[p.key] = p.def;
      let linear = -1, timer = 0;
      const rebuild = () => { if (linear !== 1) return; convM.buffer = linearFir(c, Object.values(M)); convS.buffer = linearFir(c, Object.values(S)); };
      const route = (lin) => {
        if (lin === linear) return;
        linear = lin;
        for (const n of [mid, side, M.lp, S.lp, convM, convS]) try { n.disconnect(); } catch { /* fresh */ }
        if (lin) { rebuild(); mid.connect(convM).connect(mOut); side.connect(convS).connect(sOut); } else { mid.connect(M.hp); side.connect(S.hp); M.lp.connect(mOut); S.lp.connect(sOut); }
      };
      const offline = typeof OfflineAudioContext !== 'undefined' && c instanceof OfflineAudioContext;
      const later = () => { if (linear !== 1) return; if (offline) { rebuild(); return; } clearTimeout(timer); timer = setTimeout(rebuild, 30); };
      // a tone band's gain in each chain follows where it applies (0 both, 1 mid, 2 side)
      const apply = (b) => {
        const g = st[`${b}G`], w = Math.round(st[`${b}W`] ?? 0);
        M[b].frequency.value = S[b].frequency.value = st[`${b}F`];
        if (st[`${b}Q`] != null) M[b].Q.value = S[b].Q.value = st[`${b}Q`];
        M[b].gain.value = w === 2 ? 0 : g; S[b].gain.value = w === 1 ? 0 : g;
      };
      const tone = ['ls', 'p1', 'p2', 'p3', 'p4', 'hs'];
      const setters = {
        phase: (v) => route(Math.round(v)),
        hpF: (v) => { st.hpF = v; M.hp.frequency.value = S.hp.frequency.value = v; later(); },
        lpF: (v) => { st.lpF = v; M.lp.frequency.value = S.lp.frequency.value = Math.min(v, nyq); later(); },
        out: (v, at) => out.gain.setTargetAtTime(db(v), at, 0.01),
      };
      for (const b of tone) for (const k of ['F', 'G', 'Q', 'W']) if (`${b}${k}` in st) setters[`${b}${k}`] = (v) => { st[`${b}${k}`] = v; apply(b); later(); };
      route(0);
      tone.forEach(apply);
      const u = unit(input, out, {}, setters);
      // the response curve for the display: the mid chain (what "both" and "mid" bands do)
      u.response = (freqs) => {
        const mag = new Float32Array(freqs.length).fill(1), m = new Float32Array(freqs.length), ph = new Float32Array(freqs.length);
        for (const f of Object.values(M)) { f.getFrequencyResponse(freqs, m, ph); for (let i = 0; i < m.length; i++) mag[i] *= m[i]; }
        return mag;
      };
      return u;
    },
  },
  // five-band compressor on phase-matched Linkwitz-Riley crossovers
  mbcomp: {
    name: '멀티밴드 컴프레서', hint: '5개 음역대를 따로 눌러 균형을 잡음 (마스터링용)',
    params: [
      P('x1', '경계 1', 30, 300, 90, { unit: 'Hz', log: true }), P('x2', '경계 2', 120, 1000, 300, { unit: 'Hz', log: true }),
      P('x3', '경계 3', 500, 5000, 1500, { unit: 'Hz', log: true }), P('x4', '경계 4', 2000, 14000, 6000, { unit: 'Hz', log: true }),
      ...[['서브', -18], ['저음', -18], ['중음', -18], ['중고음', -20], ['고음', -20]].flatMap(([n, t], i) => [
        P(`t${i + 1}`, `${n} 스레숄드`, -40, 0, t, { unit: 'dB' }), P(`r${i + 1}`, `${n} 비율`, 1, 10, 2, { step: 0.1 }), P(`g${i + 1}`, `${n} 게인`, -12, 12, 0, { unit: 'dB', step: 0.1 })]), // i18n-ignore ("서브 스레숄드" … are entries of their own)
      P('attack', '어택', 0.001, 0.2, 0.02, { unit: 's', log: true }), P('release', '릴리스', 0.02, 1, 0.2, { unit: 's', log: true }),
    ],
    build(c) {
      const input = c.createGain(), output = c.createGain();
      const x = bandSplit(c, input, [90, 300, 1500, 6000]);
      const comps = x.bands.map((b) => { const k = c.createDynamicsCompressor(), g = c.createGain(); k.knee.value = 6; b.connect(k).connect(g).connect(output); return { k, g }; });
      // the browser's compressor adds its own make-up gain, about 0.6 x the reduction a full-scale
      // signal would get; take it back out so a band only gets louder by its own gain knob
      const st = comps.map(() => ({ t: -18, r: 2, g: 0 }));
      const level = (i, at) => { const { t, r, g } = st[i]; comps[i].g.gain.setTargetAtTime(db(g - autoMakeup(t, r, 6)), at, 0.01); };
      const setters = {
        attack: (v, at) => comps.forEach(({ k }) => k.attack.setTargetAtTime(v, at, 0.01)),
        release: (v, at) => comps.forEach(({ k }) => k.release.setTargetAtTime(v, at, 0.01)),
      };
      for (let i = 0; i < 4; i++) setters[`x${i + 1}`] = (v, at) => x.setX(i, v, at);
      comps.forEach(({ k }, i) => {
        setters[`t${i + 1}`] = (v, at) => { st[i].t = v; k.threshold.setTargetAtTime(v, at, 0.01); level(i, at); };
        setters[`r${i + 1}`] = (v, at) => { st[i].r = v; k.ratio.setTargetAtTime(v, at, 0.01); level(i, at); };
        setters[`g${i + 1}`] = (v, at) => { st[i].g = v; level(i, at); };
      });
      const u = unit(input, output, {}, setters);
      u.reduction = () => comps.map(({ k }) => -k.reduction);
      return u;
    },
  },
  // stereo width in four bands (mid kept, side scaled); width 0 makes a band mono
  imager: {
    name: '스테레오 이미저', hint: '4개 음역대별 좌우 폭 · 저음은 모노로 모아 단단하게 (마스터링용)',
    params: [
      P('x1', '경계 1', 60, 600, 200, { unit: 'Hz', log: true }), P('x2', '경계 2', 400, 4000, 1500, { unit: 'Hz', log: true }), P('x3', '경계 3', 2000, 14000, 6000, { unit: 'Hz', log: true }),
      P('w1', '저음 폭', 0, 2, 1, { step: 0.01 }), P('w2', '중저음 폭', 0, 2, 1, { step: 0.01 }), P('w3', '중고음 폭', 0, 2, 1, { step: 0.01 }), P('w4', '고음 폭', 0, 2, 1, { step: 0.01 }),
    ],
    build(c) {
      const input = c.createGain();
      const { mid, side } = msPair(c, input);
      const fr = [200, 1500, 6000];
      // the mid takes the same all-pass phase as the split side, so 100% everywhere changes nothing
      const ap = allpassChain(c, mid, fr);
      const x = bandSplit(c, side, fr), sOut = c.createGain();
      const ws = x.bands.map((b) => { const g = c.createGain(); b.connect(g).connect(sOut); return g; });
      const output = msJoin(c, ap.out, sOut);
      const setters = {};
      for (let i = 0; i < 3; i++) setters[`x${i + 1}`] = (v, at) => { x.setX(i, v, at); ap.set(i, v, at); };
      return unit(input, output, Object.fromEntries(ws.map((g, i) => [`w${i + 1}`, g.gain])), setters);
    },
  },
  exciter: {
    name: '새추레이션', hint: '테이프·튜브 질감, 또는 고음에만 배음을 더해 선명하게',
    params: [
      P('mode', '종류', 0, 2, 0, { choices: ['테이프', '튜브', '익사이터 (고음만)'] }),
      P('drive', '드라이브', 0, 1, 0.3, { step: 0.01 }),
      P('freq', '익사이터 시작', 1000, 12000, 4000, { unit: 'Hz', log: true }),
      P('mix', '믹스', 0, 1, 0.5, { step: 0.01 }),
    ],
    build(c) {
      const input = c.createGain(), output = c.createGain(), dry = c.createGain(), wet = c.createGain();
      const hp = biq(c, 'highpass', 20, BW), ws = c.createWaveShaper(), post = biq(c, 'highpass', 20, BW), trim = c.createGain();
      ws.oversample = '4x';
      input.connect(dry).connect(output);
      input.connect(hp).connect(ws).connect(post).connect(trim).connect(wet).connect(output);
      let mode = 0, drive = 0.3, freq = 4000, mix = 0.5;
      const shape = (at = c.currentTime) => {
        const k = 1 + drive * (mode === 2 ? 12 : 5);
        ws.curve = Float32Array.from({ length: 4097 }, (_, i) => {
          const x = i / 2048 - 1;
          // tube: a little asymmetry for even harmonics, DC removed by the high-pass after it
          if (mode === 1) return Math.tanh(k * (x + 0.2 * x * x)) / Math.tanh(k * 1.2);
          return Math.tanh(k * x) / Math.tanh(k);
        });
        const f = mode === 2 ? freq : 12;
        hp.frequency.setValueAtTime(f, at); post.frequency.setValueAtTime(f, at);
        trim.gain.setValueAtTime(mode === 2 ? 0.5 : 1, at);
        // tape / tube take over from the dry signal as the mix goes up; the exciter adds on top
        wet.gain.setTargetAtTime(mix, at, 0.02); dry.gain.setTargetAtTime(mode === 2 ? 1 : 1 - mix, at, 0.02);
      };
      shape();
      return unit(input, output, {}, {
        mode: (v, at) => { mode = Math.round(v); shape(at); },
        drive: (v, at) => { drive = v; shape(at); },
        freq: (v, at) => { freq = v; shape(at); },
        mix: (v, at) => { mix = v; shape(at); },
      });
    },
  },
  deesser: {
    name: '디에서', hint: '"ㅅ·ㅊ" 같은 날카로운 치찰음 대역만 줄임',
    params: [P('freq', '주파수', 3000, 12000, 6500, { unit: 'Hz', log: true }), P('threshold', '스레숄드', -50, 0, -28, { unit: 'dB' }), P('range', '세기', 1, 20, 8, { unit: 'dB', step: 0.5 })],
    build(c) {
      const input = c.createGain(), output = c.createGain();
      const x = twoBands(c, input, 6500), k = c.createDynamicsCompressor(), trim = c.createGain();
      k.ratio.value = 5; k.knee.value = 3; k.attack.value = 0.001; k.release.value = 0.06;
      x.low.connect(output); x.high.connect(k).connect(trim).connect(output);
      // only reduce: take out the compressor's own make-up gain
      let t = -28, r = 5;
      const fix = (at) => trim.gain.setTargetAtTime(db(-autoMakeup(t, r, 3)), at, 0.01);
      return unit(input, output, {}, {
        freq: x.set,
        threshold: (v, at) => { t = v; k.threshold.setTargetAtTime(v, at, 0.01); fix(at); },
        range: (v, at) => { r = Math.min(20, 1 + v / 2); k.ratio.setTargetAtTime(r, at, 0.02); fix(at); },
      });
    },
  },
  dyneq: {
    name: '다이내믹 EQ', hint: '4밴드: 해당 대역이 커질 때만 깎거나 올림 (울리는 저음, 튀는 고음 잡기)',
    params: [
      ...[[120, 1.5], [400, 1.5], [2500, 2], [7000, 2]].flatMap(([f, q], i) => [
        P(`f${i + 1}`, `밴드 ${i + 1}`, 20, 18000, f, { unit: 'Hz', log: true }), P(`q${i + 1}`, `밴드 ${i + 1} 폭`, 0.3, 8, q, { step: 0.05 }), // i18n-ignore ("밴드 1 폭" … are entries)
        P(`t${i + 1}`, `밴드 ${i + 1} 스레숄드`, -60, 0, -24, { unit: 'dB' }), P(`r${i + 1}`, `밴드 ${i + 1} 범위`, -18, 18, i === 1 ? -3 : 0, { unit: 'dB', step: 0.1 })]), // i18n-ignore
      P('attack', '어택', 0.001, 0.2, 0.005, { unit: 's', log: true }), P('release', '릴리스', 0.01, 2, 0.12, { unit: 's', log: true }),
    ],
    build(c) {
      const node = new AudioWorkletNode(c, 'melofi-dyneq', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit' });
      const map = {};
      for (const p of MASTER_TYPES.dyneq.params) map[p.key] = node.parameters.get(p.key);
      const u = unit(node, node, map, {}, () => { node.port.onmessage = null; });
      u.gains = [0, 0, 0, 0];
      node.port.onmessage = (e) => { u.gains = e.data; };
      return u;
    },
  },
  clipper: {
    name: '소프트 클리퍼', hint: '순간 피크만 부드럽게 깎아 리미터 부담을 줄임',
    params: [P('drive', '입력 게인', 0, 12, 0, { unit: 'dB', step: 0.1 }), P('knee', '부드러움', 0, 1, 0.5, { step: 0.01 }), P('ceiling', '최대', -6, 0, -0.3, { unit: 'dB', step: 0.1 })],
    build(c) {
      // the curve spans -4..4 (12 dB of headroom), 4x oversampled so the clipping does not alias
      const pre = c.createGain(), ws = c.createWaveShaper(), post = c.createGain();
      ws.oversample = '4x';
      pre.connect(ws).connect(post);
      post.gain.value = 4;
      let drive = 0, knee = 0.5, ceiling = -0.3;
      const apply = (at = c.currentTime) => {
        const ce = db(ceiling), start = ce * (1 - knee * 0.6);
        ws.curve = Float32Array.from({ length: 8193 }, (_, i) => {
          const x = (i / 4096 - 1) * 4, a = Math.abs(x);
          const y = a <= start ? a : start + (ce - start) * Math.tanh((a - start) / Math.max(1e-6, ce - start));
          return (Math.sign(x) * Math.min(y, ce)) / 4;
        });
        pre.gain.setTargetAtTime(db(drive) / 4, at, 0.01);
      };
      apply();
      return unit(pre, post, {}, {
        drive: (v, at) => { drive = v; apply(at); },
        knee: (v, at) => { knee = v; apply(at); },
        ceiling: (v, at) => { ceiling = v; apply(at); },
      });
    },
  },
  maximizer: {
    name: '맥시마이저', hint: '실제 피크(dBTP)를 넘지 않게 막으면서 음량을 끝까지 올림 (3ms 미리 보기)',
    params: [
      P('gain', '입력 게인', 0, 24, 3, { unit: 'dB', step: 0.1 }),
      P('ceiling', '최대 (dBTP)', -3, 0, -1, { unit: 'dB', step: 0.1 }),
      P('release', '릴리스', 0.01, 1, 0.12, { unit: 's', log: true }),
    ],
    build(c) {
      const node = new AudioWorkletNode(c, 'melofi-maximizer', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit' });
      const pr = (k) => node.parameters.get(k);
      const u = unit(node, node, {}, {
        gain: (v, at) => pr('gain').setValueAtTime(db(v), at),
        ceiling: (v, at) => pr('ceiling').setValueAtTime(db(v), at),
        release: (v, at) => pr('release').setValueAtTime(v, at),
      }, () => { node.port.onmessage = null; });
      u.gr = 0;
      node.port.onmessage = (e) => { u.gr = -20 * Math.log10(Math.max(1e-6, e.data)); };
      return u;
    },
  },
};

export const MASTER_FX = Object.keys(MASTER_TYPES);
// effects that cap the master's peaks: the engine's safety limiter then stays out of their way
export const PEAK_FX = new Set(['limiter', 'maximizer', 'clipper']);
