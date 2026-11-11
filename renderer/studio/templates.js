// i18n: source table — every Korean string here is UI text and a translation key; the screen that shows it calls t() (docs/i18n.md)
// Starting points for new projects. Each builds a full project (channels, effects, a few
// patterns with notes, a short arrangement) so a beginner hears something right away.
import { newProject, newChannel, newPattern, newBus, uid, STEP, PPQ } from './model.js';
import { t } from '../i18n/i18n.js';
import { fxDefaults } from './fx.js';
import { synthDefaults, SYNTH_PRESETS } from './synth.js';

const fx = (type, params = {}) => ({ id: uid('f'), type, on: true, params: { ...fxDefaults(type), ...params } });
const steps = (list, n, v = 100, d = STEP) => list.map((i) => ({ t: i * STEP, d, n, v }));
const synth = (preset) => ({ kind: 'synth', synth: { ...synthDefaults(), ...SYNTH_PRESETS[preset] }, synthPreset: preset });
// chord notes from a list of [bar position in 16ths, length in 16ths, [notes]]
const chords = (list, v = 82) => list.flatMap(([at, len, ns]) => ns.map((n) => ({ t: at * STEP, d: len * STEP, n, v })));
const line = (list, v = 96) => list.map(([at, len, n]) => ({ t: at * STEP, d: len * STEP, n, v }));

function base(name, bpm, chans) {
  const p = newProject();
  p.name = name; p.bpm = bpm;
  p.channels = chans.map(([inst, nm, extra], i) => newChannel(inst, nm, i, extra));
  p.patterns = [];
  p.selected = p.channels[0].id;
  return p;
}

function pat(p, name, bars, notes) {
  const x = newPattern(p.patterns.length, bars);
  x.name = name;
  for (const [ch, list] of Object.entries(notes)) x.notes[p.channels[ch].id] = list;
  p.patterns.push(x);
  p.current = p.patterns[0].id;
  return x;
}

function arrange(p, rows) {
  // rows: [[track, pattern index, start bar, length bars]]
  p.playlist.clips = rows.map(([track, pi, start, len]) => ({ id: uid('k'), pattern: p.patterns[pi].id, track, start, len }));
}

export const TEMPLATES = {
  empty: {
    name: '빈 프로젝트', hint: '악기 하나로 처음부터',
    make() { const p = newProject(); p.channels = [newChannel('splendid', 'Piano', 0, { send: 0.25 })]; p.selected = p.channels[0].id; p.patterns[0].notes = {}; return p; },
  },
  basic: {
    name: '기본 비트', hint: '드럼 4개 + 피아노 (튜토리얼과 같은 구성)',
    make() { return newProject(); },
  },
  kpop: {
    name: '케이팝 댄스', hint: '트랩 드럼, 808, 슈퍼쏘, 브라스 스탭 · 128 BPM',
    make() {
      const p = base(t('케이팝 댄스'), 128, [
        ['drumstrap', 'Kick', { stepNote: 36 }], ['drumstrap', 'Clap', { stepNote: 39 }], ['drumstrap', 'Hat', { stepNote: 42, vol: 0.55 }],
        ['sub808', '808', { stepNote: 36, ...{} }], ['synth', 'Supersaw', { ...synth('슈퍼쏘 리드'), vol: 0.6, send: 0.2 }],
        ['brassstab', 'Brass', { send: 0.18 }],
      ]);
      p.scale = { root: 9, type: 'minor' };
      const ch = p.channels;
      ch[3].fx = [fx('sidechain', { source: ch[0].id, depth: 0.6 })];
      ch[4].fx = [fx('sidechain', { source: ch[0].id, depth: 0.75 }), fx('delay', { mix: 0.15 })];
      p.master.fx = [fx('eq', { cut: 25, high: 1.5 }), fx('limiter', { gain: 4 })];
      pat(p, t('비트'), 1, { 0: steps([0, 4, 8, 12], 36), 1: steps([4, 12], 39), 2: steps([0, 2, 4, 6, 8, 10, 12, 14, 15], 42, 80) });
      pat(p, t('808 베이스'), 2, { 3: line([[0, 6, 33], [6, 2, 33], [8, 8, 36], [16, 6, 31], [22, 2, 31], [24, 8, 28]], 110) });
      pat(p, t('코드'), 2, { 4: chords([[0, 8, [57, 60, 64]], [8, 8, [53, 57, 60]], [16, 8, [55, 59, 62]], [24, 8, [52, 55, 59]]]) });
      pat(p, t('브라스 히트'), 2, { 5: chords([[0, 2, [69, 72, 76]], [3, 2, [69, 72, 76]], [14, 2, [65, 69, 72]], [16, 2, [67, 71, 74]], [30, 2, [64, 67, 71]]], 110) });
      arrange(p, [[0, 0, 0, 16], [1, 1, 4, 12], [2, 2, 0, 16], [3, 3, 8, 8]]);
      p.markers = [{ bar: 0, name: t('인트로') }, { bar: 4, name: t('벌스') }, { bar: 8, name: t('후렴') }];
      return p;
    },
  },
  trap: {
    name: '힙합 · 트랩', hint: '긴 808, 빠른 하이햇, 어두운 피아노 · 140 BPM',
    make() {
      const p = base(t('트랩 비트'), 140, [
        ['drumstrap', 'Kick', { stepNote: 36 }], ['drumstrap', 'Snare', { stepNote: 38 }], ['drumstrap', 'Hat', { stepNote: 42, vol: 0.5 }],
        ['sub808', '808', { stepNote: 36 }], ['splendid', 'Piano', { send: 0.3 }],
      ]);
      p.scale = { root: 1, type: 'minor' };
      p.channels[4].fx = [fx('filter', { freq: 3500 }), fx('reverb', { mix: 0.3 })];
      p.master.fx = [fx('limiter', { gain: 3 })];
      const hats = [0, 2, 4, 6, 8, 9, 10, 11, 12, 14].map((i) => i);
      pat(p, t('비트'), 2, { 0: steps([0, 10, 16, 22, 26], 36), 1: steps([8, 24], 38), 2: [...steps(hats, 42, 85), ...steps(hats.map((i) => i + 16), 42, 85)] });
      pat(p, '808', 2, { 3: line([[0, 10, 37], [10, 6, 37], [16, 8, 40], [24, 8, 32]], 115) });
      pat(p, t('피아노'), 2, { 4: line([[0, 4, 61], [4, 4, 64], [8, 4, 68], [12, 4, 66], [16, 8, 64], [24, 8, 61]], 80) });
      arrange(p, [[0, 0, 0, 16], [1, 1, 4, 12], [2, 2, 0, 16]]);
      return p;
    },
  },
  lofi: {
    name: '로파이', hint: '로즈 피아노, 느린 스윙 비트 · 78 BPM',
    make() {
      const p = base(t('로파이'), 78, [
        ['drums808', 'Kick', { stepNote: 36 }], ['drums808', 'Snare', { stepNote: 38, vol: 0.7 }], ['drums808', 'Hat', { stepNote: 42, vol: 0.45 }],
        ['rhodes', 'Rhodes', { send: 0.3 }], ['upright', 'Bass', {}],
      ]);
      p.swing = 0.45;
      p.scale = { root: 2, type: 'dorian' };
      p.channels[3].fx = [fx('chorus', { mix: 0.35 }), fx('filter', { freq: 5000 })];
      p.master.fx = [fx('eq', { high: -3 }), fx('comp', { threshold: -20, ratio: 3 }), fx('limiter', { gain: 2 })];
      pat(p, t('비트'), 1, { 0: steps([0, 7, 10], 36), 1: steps([4, 12], 38, 90), 2: steps([0, 2, 4, 6, 8, 10, 12, 14], 42, 70) });
      pat(p, t('코드'), 2, { 3: chords([[0, 16, [50, 53, 57, 60]], [16, 16, [55, 59, 62, 65]]], 70) });
      pat(p, t('베이스'), 2, { 4: line([[0, 6, 38], [8, 4, 38], [12, 4, 41], [16, 6, 43], [24, 8, 41]], 90) });
      arrange(p, [[0, 0, 0, 8], [1, 1, 0, 8], [2, 2, 0, 8]]);
      return p;
    },
  },
  ballad: {
    name: '발라드', hint: '그랜드 피아노, 스트링 앙상블, 첼로 · 72 BPM',
    make() {
      const p = base(t('발라드'), 72, [['splendid', 'Piano', { send: 0.35 }], ['strings', 'Strings', { send: 0.35, vol: 0.7 }], ['cello', 'Cello', { send: 0.3, vol: 0.7 }]]);
      p.scale = { root: 7, type: 'major' };
      p.master.fx = [fx('reverb', { room: 1, mix: 0.12 }), fx('limiter', { gain: 2 })];
      pat(p, t('피아노'), 4, { 0: chords([[0, 16, [55, 59, 62]], [16, 16, [52, 55, 59]], [32, 16, [48, 52, 55]], [48, 16, [50, 54, 57]]], 70) });
      pat(p, t('스트링'), 4, { 1: chords([[0, 16, [67, 71, 74]], [16, 16, [64, 67, 71]], [32, 16, [60, 64, 67]], [48, 16, [62, 66, 69]]], 60), 2: line([[0, 16, 43], [16, 16, 40], [32, 16, 36], [48, 16, 38]], 70) });
      arrange(p, [[0, 0, 0, 8], [1, 1, 4, 4]]);
      return p;
    },
  },
  citypop: {
    name: '시티팝', hint: 'FM 전자피아노, 핑거 베이스, 브라스 · 112 BPM',
    make() {
      const p = base(t('시티팝'), 112, [
        ['acousticdrums', 'Drums', { stepNote: 36 }], ['fmep', 'E.Piano', { send: 0.25 }], ['fingerbass', 'Bass', {}], ['trumpet', 'Trumpet', { send: 0.2, vol: 0.7 }],
      ]);
      p.scale = { root: 5, type: 'major' };
      p.channels[1].fx = [fx('chorus', { mix: 0.4 })];
      p.master.fx = [fx('comp', { threshold: -16, ratio: 2.5 }), fx('limiter', { gain: 3 })];
      pat(p, t('그루브'), 2, {
        0: [...steps([0, 8, 16, 24], 36), ...steps([4, 12, 20, 28], 38, 95), ...steps([0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30], 42, 70)],
        1: chords([[0, 6, [64, 67, 69, 72]], [6, 10, [64, 67, 69, 72]], [16, 6, [62, 65, 69, 72]], [22, 10, [62, 65, 69, 72]]], 80),
        2: line([[0, 3, 41], [3, 3, 41], [6, 2, 48], [8, 4, 46], [16, 3, 38], [19, 3, 38], [22, 2, 45], [24, 4, 43]], 100),
      });
      arrange(p, [[0, 0, 0, 16]]);
      return p;
    },
  },
};

void newBus; void PPQ;
