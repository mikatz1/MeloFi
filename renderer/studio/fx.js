// MeloFi Studio — insert effects, all built from Web Audio nodes so they run the same live and
// in the offline renderer. Each effect type lists its parameters (for the UI and automation) and
// builds a unit { input, output, set(params, at), param(name) -> AudioParam | null, dispose() }.
import { makeImpulse } from '../js/audio.js';
import { MASTER_TYPES, MASTER_FX, PEAK_FX } from './master-fx.js';

// p: { key, label, min, max, def, unit?, log?, step?, choices? }
const P = (key, label, min, max, def, extra = {}) => ({ key, label, min, max, def, ...extra });

export const FX_TYPES = {
  eq: {
    name: 'EQ', hint: '음역대별 크기 조절',
    params: [
      P('cut', '저역 컷', 20, 400, 20, { unit: 'Hz', log: true }),
      P('low', '저음', -15, 15, 0, { unit: 'dB', step: 0.5 }),
      P('lowF', '저음 주파수', 40, 400, 110, { unit: 'Hz', log: true }),
      P('mid', '중음', -15, 15, 0, { unit: 'dB', step: 0.5 }),
      P('midF', '중음 주파수', 200, 6000, 1000, { unit: 'Hz', log: true }),
      P('q', '중음 폭', 0.3, 6, 1, { step: 0.1 }),
      P('high', '고음', -15, 15, 0, { unit: 'dB', step: 0.5 }),
      P('highF', '고음 주파수', 2000, 16000, 7000, { unit: 'Hz', log: true }),
    ],
    build(c) {
      const hp = biq(c, 'highpass', 20, 0.7), lo = biq(c, 'lowshelf', 110), mid = biq(c, 'peaking', 1000, 1), hi = biq(c, 'highshelf', 7000);
      hp.connect(lo).connect(mid).connect(hi);
      const map = { cut: hp.frequency, low: lo.gain, lowF: lo.frequency, mid: mid.gain, midF: mid.frequency, q: mid.Q, high: hi.gain, highF: hi.frequency };
      return unit(hp, hi, map);
    },
  },
  comp: {
    name: '컴프레서', hint: '큰 소리를 눌러 소리를 단단하게',
    params: [
      P('threshold', '스레숄드', -60, 0, -18, { unit: 'dB' }),
      P('ratio', '비율', 1, 20, 4, { step: 0.5 }),
      P('attack', '어택', 0.001, 0.2, 0.01, { unit: 's', log: true }),
      P('release', '릴리스', 0.02, 1, 0.15, { unit: 's', log: true }),
      P('knee', '니', 0, 30, 6, { unit: 'dB' }),
      P('makeup', '메이크업', 0, 24, 4, { unit: 'dB', step: 0.5 }),
    ],
    build(c) {
      const k = c.createDynamicsCompressor(), g = c.createGain();
      k.connect(g);
      return unit(k, g, { threshold: k.threshold, ratio: k.ratio, attack: k.attack, release: k.release, knee: k.knee }, {
        makeup: (v, at) => g.gain.setTargetAtTime(db(v), at, 0.01),
      });
    },
  },
  delay: {
    name: '딜레이', hint: '메아리',
    params: [
      P('time', '간격', 0, 5, 2, { choices: ['1/16', '1/8', '1/8 점', '1/4', '1/4 점', '1/2'] }),
      P('feedback', '반복', 0, 0.9, 0.35, { step: 0.01 }),
      P('tone', '밝기', 500, 16000, 5000, { unit: 'Hz', log: true }),
      P('ping', '좌우 핑퐁', 0, 1, 1, { choices: ['끔', '켬'] }),
      P('mix', '믹스', 0, 1, 0.25, { step: 0.01 }),
    ],
    beats: [0.25, 0.5, 0.75, 1, 1.5, 2],
    build(c, ctx) {
      const input = c.createGain(), output = c.createGain();
      const dry = c.createGain(), wet = c.createGain();
      const split = c.createChannelSplitter(2), merge = c.createChannelMerger(2);
      const dL = c.createDelay(4), dR = c.createDelay(4), fbL = c.createGain(), fbR = c.createGain();
      const tone = biq(c, 'lowpass', 5000, 0.5);
      input.connect(dry).connect(output);
      input.connect(tone).connect(split);
      split.connect(dL, 0); split.connect(dR, 1);
      dL.connect(merge, 0, 0); dR.connect(merge, 0, 1);
      merge.connect(wet).connect(output);
      let ping = 1, fb = 0.35;
      const wire = () => {
        try { dL.disconnect(fbL); dR.disconnect(fbR); fbL.disconnect(); fbR.disconnect(); } catch { /* first time */ }
        dL.connect(fbL); dR.connect(fbR);
        if (ping) { fbL.connect(dR); fbR.connect(dL); } else { fbL.connect(dL); fbR.connect(dR); }
      };
      wire();
      const setTime = (v, at) => {
        const beats = FX_TYPES.delay.beats[Math.round(v)] ?? 0.5, sec = Math.min(3.9, (60 / (ctx.bpm || 120)) * beats);
        dL.delayTime.setTargetAtTime(sec, at, 0.02); dR.delayTime.setTargetAtTime(ping ? sec : sec * 1.01, at, 0.02);
      };
      let lastTime = 2;
      return unit(input, output, { tone: tone.frequency }, {
        time: (v, at) => { lastTime = v; setTime(v, at); },
        feedback: (v, at) => { fb = v; fbL.gain.setTargetAtTime(v, at, 0.02); fbR.gain.setTargetAtTime(v, at, 0.02); },
        ping: (v, at) => { const p = v >= 0.5 ? 1 : 0; if (p !== ping) { ping = p; wire(); setTime(lastTime, at); } void fb; },
        mix: (v, at) => { wet.gain.setTargetAtTime(v, at, 0.02); dry.gain.setTargetAtTime(1 - v * 0.5, at, 0.02); },
      });
    },
  },
  chorus: {
    name: '코러스', hint: '소리를 넓고 풍성하게',
    params: [P('rate', '속도', 0.1, 5, 0.8, { unit: 'Hz', step: 0.05 }), P('depth', '깊이', 0, 1, 0.5, { step: 0.01 }), P('mix', '믹스', 0, 1, 0.5, { step: 0.01 })],
    build(c) {
      const input = c.createGain(), output = c.createGain(), dry = c.createGain(), wet = c.createGain();
      const split = c.createChannelSplitter(2), merge = c.createChannelMerger(2);
      const lfos = [], depths = [];
      input.connect(dry).connect(output);
      input.connect(split);
      for (let ch = 0; ch < 2; ch++) {
        const d = c.createDelay(0.05); d.delayTime.value = 0.012 + ch * 0.004;
        const lfo = c.createOscillator(); lfo.frequency.value = 0.8 * (ch ? 1.13 : 1);
        const dep = c.createGain(); dep.gain.value = 0.002;
        lfo.connect(dep).connect(d.delayTime); lfo.start();
        split.connect(d, ch); d.connect(merge, 0, ch);
        lfos.push(lfo); depths.push(dep);
      }
      merge.connect(wet).connect(output);
      return unit(input, output, {}, {
        rate: (v, at) => lfos.forEach((l, i) => l.frequency.setTargetAtTime(v * (i ? 1.13 : 1), at, 0.05)),
        depth: (v, at) => depths.forEach((d) => d.gain.setTargetAtTime(0.0002 + v * 0.004, at, 0.05)),
        mix: (v, at) => { wet.gain.setTargetAtTime(v, at, 0.02); dry.gain.setTargetAtTime(1 - v * 0.4, at, 0.02); },
      }, () => lfos.forEach((l) => l.stop()));
    },
  },
  dist: {
    name: '디스토션', hint: '소리를 찌그러뜨려 거칠게',
    params: [P('drive', '드라이브', 0, 1, 0.4, { step: 0.01 }), P('tone', '톤', 500, 16000, 6000, { unit: 'Hz', log: true }), P('mix', '믹스', 0, 1, 1, { step: 0.01 })],
    build(c) {
      const input = c.createGain(), output = c.createGain(), dry = c.createGain(), wet = c.createGain();
      const ws = c.createWaveShaper(); ws.oversample = '4x';
      const tone = biq(c, 'lowpass', 6000, 0.6);
      input.connect(dry).connect(output);
      input.connect(ws).connect(tone).connect(wet).connect(output);
      return unit(input, output, { tone: tone.frequency }, {
        drive: (v) => { const k = 1 + v * 30, curve = new Float32Array(2048); for (let i = 0; i < 2048; i++) { const x = i / 1023.5 - 1; curve[i] = Math.tanh(x * k) / Math.tanh(k); } ws.curve = curve; },
        mix: (v, at) => { wet.gain.setTargetAtTime(v, at, 0.02); dry.gain.setTargetAtTime(1 - v, at, 0.02); },
      });
    },
  },
  filter: {
    name: '필터', hint: '특정 음역만 남기기 (오토메이션과 함께 쓰면 좋음)',
    params: [
      P('type', '종류', 0, 2, 0, { choices: ['로우패스', '하이패스', '밴드패스'] }),
      P('freq', '주파수', 30, 20000, 20000, { unit: 'Hz', log: true }),
      P('res', '레조넌스', 0.1, 18, 0.7, { step: 0.1 }),
    ],
    build(c) {
      const f = biq(c, 'lowpass', 20000, 0.7);
      return unit(f, f, { freq: f.frequency, res: f.Q }, { type: (v) => { f.type = ['lowpass', 'highpass', 'bandpass'][Math.round(v)] || 'lowpass'; } });
    },
  },
  reverb: {
    name: '리버브', hint: '공간감',
    params: [P('room', '공간', 0, 2, 1, { choices: ['룸', '홀', '성당'] }), P('mix', '믹스', 0, 1, 0.25, { step: 0.01 })],
    build(c) {
      const input = c.createGain(), output = c.createGain(), dry = c.createGain(), wet = c.createGain();
      const conv = c.createConvolver();
      input.connect(dry).connect(output);
      input.connect(conv).connect(wet).connect(output);
      let room = -1;
      return unit(input, output, {}, {
        room: (v) => { const r = Math.round(v); if (r !== room) { room = r; conv.buffer = makeImpulse(c, ['room', 'hall', 'church'][r] || 'hall'); } },
        mix: (v, at) => { wet.gain.setTargetAtTime(v, at, 0.02); dry.gain.setTargetAtTime(1 - v * 0.5, at, 0.02); },
      });
    },
  },
  width: {
    name: '스테레오 폭', hint: '좌우로 넓게, 또는 모노로',
    params: [P('width', '폭', 0, 2, 1, { step: 0.01 })],
    build(c) {
      // mid/side: L' = M + wS, R' = M - wS
      const input = c.createGain(), output = c.createChannelMerger(2), split = c.createChannelSplitter(2);
      const m = c.createGain(), s = c.createGain(), sw = c.createGain(), inv = c.createGain();
      m.gain.value = 0.5; s.gain.value = 0.5; inv.gain.value = -1;
      input.connect(split);
      split.connect(m, 0); split.connect(m, 1); split.connect(s, 0); split.connect(inv, 1).connect(s);
      s.connect(sw);
      const negS = c.createGain(); negS.gain.value = -1; sw.connect(negS);
      m.connect(output, 0, 0); m.connect(output, 0, 1); sw.connect(output, 0, 0); negS.connect(output, 0, 1);
      return unit(input, output, { width: sw.gain });
    },
  },
  limiter: {
    name: '리미터', hint: '최대 음량을 막아 소리를 키움',
    params: [P('gain', '입력 게인', 0, 18, 3, { unit: 'dB', step: 0.5 }), P('ceiling', '최대', -6, 0, -0.3, { unit: 'dB', step: 0.1 })],
    build(c) {
      const pre = c.createGain(), k = c.createDynamicsCompressor(), post = c.createGain();
      k.knee.value = 0; k.ratio.value = 20; k.attack.value = 0.002; k.release.value = 0.08;
      pre.connect(k).connect(post);
      return unit(pre, post, {}, {
        gain: (v, at) => pre.gain.setTargetAtTime(db(v), at, 0.01),
        // a 20:1 compressor lets peaks overshoot its threshold by ~1 dB: set it that much lower
        ceiling: (v, at) => k.threshold.setTargetAtTime(v - 1, at, 0.01),
      });
    },
  },
  // live pitch correction (FL Studio's Pitcher; Newtone does it offline): snaps a singing voice
  // or a lead to the nearest note of the chosen key and scale
  pitchfix: {
    name: 'Pitcher', hint: '실시간 피치 보정: 보컬 음정을 스케일에 맞춤 (오토튠)',
    params: [
      P('root', '키', 0, 11, 0, { choices: ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] }),
      P('scale', '스케일', 0, 5, 0, { choices: ['크로매틱 (모든 반음)', '메이저', '마이너', '메이저 펜타토닉', '마이너 펜타토닉', '블루스'] }),
      P('speed', '보정 속도', 0, 200, 20, { unit: 'ms' }),
    ],
    masks: [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], [0, 2, 4, 5, 7, 9, 11], [0, 2, 3, 5, 7, 8, 10], [0, 2, 4, 7, 9], [0, 3, 5, 7, 10], [0, 3, 5, 6, 7, 10]].map((l) => l.reduce((m, p) => m | (1 << p), 0)),
    build(c) {
      const node = new AudioWorkletNode(c, 'pitch-fix', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
      const pr = (k) => node.parameters.get(k);
      return unit(node, node, {}, {
        root: (v, at) => pr('root').setValueAtTime(Math.round(v), at),
        scale: (v, at) => pr('mask').setValueAtTime(FX_TYPES.pitchfix.masks[Math.round(v)] ?? 4095, at),
        speed: (v, at) => pr('speed').setValueAtTime(v / 1000, at),
      });
    },
  },
  sidechain: {
    name: '사이드체인', hint: '킥이 울릴 때마다 이 소리를 잠깐 줄임',
    params: [
      P('source', '따라갈 채널', 0, 0, 0, { channel: true }),
      P('mode', '기준', 0, 1, 1, { choices: ['노트', '오디오'] }),
      P('threshold', '감도', -48, 0, -24, { unit: 'dB' }),
      P('depth', '깊이', 0, 1, 0.7, { step: 0.01 }),
      P('release', '복귀', 0.03, 0.6, 0.18, { unit: 's', log: true }),
    ],
    build(c, ctx) {
      const g = c.createGain();
      // audio mode, as in FL Studio: the source's own sound (post-fader) drives the ducking.
      // |x| -> smoothing low-pass -> curve that turns level into gain reduction on g.gain
      const scIn = c.createGain(), rect = c.createWaveShaper(), env = c.createBiquadFilter(), map = c.createWaveShaper();
      rect.curve = Float32Array.from({ length: 2049 }, (_, i) => Math.abs(i / 1024 - 1));
      env.type = 'lowpass'; env.Q.value = 0.5;
      scIn.connect(rect).connect(env).connect(map);
      const u = unit(g, g, {}, {}, () => { u.link(null); scIn.disconnect(); map.disconnect(); });
      u.duck = { depth: 0.7, release: 0.18, source: null, mode: 1, threshold: -24 };
      const curve = () => {
        const thr = 10 ** (u.duck.threshold / 20), d = u.duck.depth;
        map.curve = Float32Array.from({ length: 2049 }, (_, i) => { const x = i / 1024 - 1; return x <= 0 ? 0 : -d * Math.min(1, x / thr); });
      };
      const mode = () => { try { map.disconnect(); } catch { /* not yet */ } if (u.duck.mode === 1) map.connect(g.gain); };
      curve(); mode();
      env.frequency.value = 1 / (2 * Math.PI * 0.18 / 3);
      u.setters = {
        source: (v) => { u.duck.source = v; },
        mode: (v) => { u.duck.mode = Math.round(v); mode(); },
        threshold: (v) => { u.duck.threshold = v; curve(); },
        depth: (v) => { u.duck.depth = v; curve(); },
        release: (v, at) => { u.duck.release = v; env.frequency.setTargetAtTime(1 / (2 * Math.PI * v / 3), at, 0.01); },
      };
      // the engine feeds the source strip in here (audio mode)
      u.scIn = scIn;
      u.linked = null;
      u.link = (strip) => {
        if (u.linked === strip) return;
        if (u.linked) try { u.linked.panner.disconnect(scIn); } catch { /* gone */ }
        u.linked = strip;
        if (strip) strip.panner.connect(scIn);
      };
      // note mode: the engine calls this for every note on the source channel
      u.trigger = (at) => {
        if (u.duck.mode === 1) return;
        const lo = 1 - u.duck.depth;
        g.gain.cancelScheduledValues(at);
        g.gain.setTargetAtTime(lo, at, 0.003);
        g.gain.setTargetAtTime(1, at + 0.02, u.duck.release / 3);
      };
      void ctx;
      return u;
    },
  },
};

Object.assign(FX_TYPES, MASTER_TYPES);
export { MASTER_FX, PEAK_FX };

export const FX_ORDER = ['pitchfix', 'eq', 'comp', 'filter', 'dist', 'chorus', 'delay', 'reverb', 'width', 'sidechain', 'limiter'];

// ready-made chains for beginners: [name, hint, [[type, params]]]
export const FX_PRESETS = [
  ['보컬 리버브', '목소리나 리드에 공간감', [['eq', { cut: 100, high: 2 }], ['comp', { threshold: -20, ratio: 3 }], ['reverb', { room: 1, mix: 0.25 }]]],
  ['킥 펀치', '킥을 단단하게', [['eq', { low: 4, lowF: 60, mid: -3, midF: 400 }], ['comp', { threshold: -14, ratio: 5, attack: 0.02, release: 0.1, makeup: 3 }]]],
  ['로파이', '오래된 테이프 같은 소리', [['filter', { type: 0, freq: 3500, res: 0.9 }], ['dist', { drive: 0.15, mix: 0.6 }], ['chorus', { rate: 0.4, depth: 0.3, mix: 0.3 }]]],
  ['라디오 목소리', '좁고 얇은 전화기 소리', [['eq', { cut: 450, low: -6, mid: 4, midF: 1800, high: -8 }], ['dist', { drive: 0.2, mix: 0.5 }]]],
  ['넓은 패드', '패드를 좌우로 넓게', [['chorus', { rate: 0.6, depth: 0.6, mix: 0.5 }], ['width', { width: 1.6 }], ['reverb', { room: 1, mix: 0.35 }]]],
  ['808 진하게', '808을 작은 스피커에서도 들리게', [['dist', { drive: 0.25, tone: 3000, mix: 0.45 }], ['eq', { cut: 25, low: 2, lowF: 55 }]]],
  ['마스터 기본', '마스터에 넣으면 소리가 단단하고 커짐', [['eq', { cut: 25, high: 1 }], ['comp', { threshold: -16, ratio: 2, attack: 0.03, release: 0.2, makeup: 2 }], ['limiter', { gain: 4, ceiling: -0.5 }]]],
];

function biq(c, type, f, q = 0.7) { const b = c.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; }
const db = (v) => Math.pow(10, v / 20);

// map: param -> AudioParam (set directly); setters: param -> fn(value, at)
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

export function fxDefaults(type) {
  const out = {};
  for (const p of FX_TYPES[type].params) out[p.key] = p.def;
  return out;
}

// normalised 0..1 <-> parameter value (log for frequencies and times)
export function fromNorm(p, x) {
  if (p.choices) return Math.round(x * (p.choices.length - 1));
  if (p.log) return p.min * Math.pow(p.max / p.min, x);
  return p.min + (p.max - p.min) * x;
}
export function toNorm(p, v) {
  if (p.choices) return p.choices.length > 1 ? v / (p.choices.length - 1) : 0;
  if (p.log) return Math.log(v / p.min) / Math.log(p.max / p.min);
  return (v - p.min) / ((p.max - p.min) || 1);
}
export function fmtParam(p, v) {
  if (p.choices) return p.choices[Math.round(v)] ?? '';
  if (p.unit === 'Hz') return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`;
  if (p.unit === 's') return v < 1 ? `${Math.round(v * 1000)}ms` : `${v.toFixed(2)}s`;
  if (p.unit === 'dB') return `${v > 0 ? '+' : ''}${v.toFixed(1)}`;
  if (p.max <= 1) return `${Math.round(v * 100)}%`;
  return (Math.round(v * 10) / 10).toString();
}
