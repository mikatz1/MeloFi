// "AI로 곡 분석·재구성": open an audio or video file, analyse it in MeloFi (tempo, key, chords,
// bass, melody, drums, sections), then either build a project straight from that analysis or
// ask Claude for a report and a re-arrangement in a chosen style. Only the analysis is sent to
// Claude, never the audio.
import { h, popup } from './dom.js';
import { newProject, newChannel, newPattern, newTrack, uid, STEP, SCALES } from '../model.js';
import { FX_PRESETS, fxDefaults } from '../fx.js';
import { addMedia } from '../media.js';

const STYLES = ['원곡 느낌 그대로 재구성', '로파이 힙합으로', '케이팝 댄스로', '트랩 비트로', '피아노 발라드로', '시티팝으로', 'EDM으로', '어쿠스틱 밴드로', '오케스트라풍으로'];
const EFFORT = [['medium', '보통 (빠름)'], ['high', '깊게'], ['max', '최대 (느림)']];
const PC = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export class AiSheet {
  constructor(studio) {
    this.S = studio;
    this.file = null;      // { name, data }
    this.features = null;
    this.result = null;
    this.busy = null;      // 'decode' | 'analyse' | 'claude'
    this.progress = 0;
    this.style = STYLES[0];
    this.request = '';
    this.model = 'claude-opus-5-5';
    this.effort = 'high';
    this.withOriginal = true;
    this.el = h('section', { id: 'aisheet', class: 'sheet', hidden: true },
      h('div', { class: 'sheet-card ai-card' },
        h('div', { class: 'sheet-head' }, h('h2', {}, 'AI로 곡 분석 · 재구성'), h('button', { class: 'x', 'aria-label': '닫기', onclick: () => this.close() })),
        this.body = h('div', { class: 'ai-body' })));
    this.el.addEventListener('pointerdown', (e) => { if (e.target === this.el) this.close(); });
    this.el.addEventListener('dragover', (e) => e.preventDefault());
    this.el.addEventListener('drop', async (e) => {
      e.preventDefault();
      const f = [...e.dataTransfer.files][0];
      if (f) this.load({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) });
    });
    document.body.append(this.el);
    window.melofi.onClaudeProgress((p) => { this.claudeProgress = p; this.renderProgress(); });
  }

  async show() {
    this.S.app.ui.close();
    this.el.hidden = false;
    this.status = await window.melofi.claudeStatus();
    this.render();
  }

  close() { this.el.hidden = true; }

  async pick() {
    const list = await window.melofi.mediaPickFiles({ video: true });
    if (list[0]) this.load(list[0]);
  }

  // decode (audio or the soundtrack of a video), mix to mono 22.05 kHz, analyse in a worker
  async load(file) {
    this.file = file; this.features = null; this.result = null; this.error = null;
    this.busy = 'decode'; this.progress = 0; this.render();
    try {
      const ctx = new OfflineAudioContext(1, 1, 22050);
      const buf = await ctx.decodeAudioData(file.data.buffer.slice(file.data.byteOffset, file.data.byteOffset + file.data.byteLength));
      const n = buf.length, mono = new Float32Array(n);
      for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) mono[i] += d[i] / buf.numberOfChannels; }
      this.audio = { mono, rate: buf.sampleRate };
      this.busy = 'analyse'; this.render();
      this.features = await this.runWorker();
    } catch (err) {
      this.error = /decode|Unable/i.test(String(err.message)) ? '이 파일에서 오디오를 불러올 수 없습니다. WAV, MP3, MP4(AAC) 파일을 사용해 보세요.' : `분석하지 못했습니다: ${err.message}`;
    }
    this.busy = null;
    this.render();
  }

  runWorker(tempo) {
    const samples = this.audio.mono.slice();
    return new Promise((resolve, reject) => {
      const w = new Worker('melofi://app/renderer/studio/analyze-worker.js');
      w.onmessage = (e) => {
        if (e.data.type === 'progress') { this.progress = e.data.p; this.renderProgress(); }
        if (e.data.type === 'done') { w.terminate(); resolve(e.data.result); }
        if (e.data.type === 'error') { w.terminate(); reject(new Error(e.data.message)); }
      };
      w.postMessage({ samples, rate: this.audio.rate, tempo }, [samples.buffer]);
    });
  }

  // Tempo detection can land on half or double time (ballads, half-time trap). Re-run the
  // analysis around the corrected tempo so beats, bars and chords follow it.
  async retempo(factor) {
    if (!this.audio || !this.features || this.busy) return;
    this.busy = 'analyse'; this.error = null; this.render();
    try { this.features = await this.runWorker(this.features.bpm * factor); } catch (err) { this.error = `분석하지 못했습니다: ${err.message}`; }
    this.busy = null; this.render();
  }

  // ---------- Claude ----------
  async askClaude() {
    if (!this.features || this.busy) return;
    this.busy = 'claude'; this.error = null; this.result = null; this.claudeProgress = null;
    this.render();
    const S = this.S;
    const instruments = S.app.instruments.filter((i) => i.installed).map((i) => ({ id: i.id, name: i.name, family: i.family }));
    const r = await window.melofi.claudeArrange({
      features: trimFeatures(this.features), fileName: this.file.name, style: this.style, request: this.request,
      instruments, presets: FX_PRESETS.map(([n]) => n), model: this.model, effort: this.effort,
    });
    this.busy = null;
    if (r.ok) { this.result = r.data; this.usage = r.usage; this.servedBy = r.model; } else this.error = r.message;
    this.render();
  }

  // ---------- projects ----------
  async open(fromClaude) {
    const S = this.S;
    const proj = fromClaude ? fromArrangement(this.result.arrangement, S) : fromFeatures(this.features, this.file.name, S);
    if (this.withOriginal) await addOriginal(proj, this.file, this.features);
    S.setProject(proj);
    S.setTab('playlist');
    this.close();
    S.app.ui.toast(fromClaude ? 'Claude가 재구성한 프로젝트를 열었습니다' : '분석 결과로 프로젝트를 만들었습니다');
  }

  // ---------- UI ----------
  renderProgress() {
    if (this.progEl) {
      const p = this.busy === 'claude' ? this.claudeProgress : null;
      this.progEl.textContent = this.busy === 'decode' ? '파일을 읽는 중…'
        : this.busy === 'analyse' ? `분석 중… ${Math.round(this.progress * 100)}%`
          : this.busy === 'claude' ? (p?.phase === 'writing' ? `프로젝트를 쓰는 중… (${p.chars.toLocaleString()}자)` : p?.phase === 'thinking' ? 'Claude가 곡을 살펴보는 중…' : 'Claude에 보내는 중…') : '';
      if (this.thinkEl && this.busy === 'claude') this.thinkEl.textContent = this.claudeProgress?.phase === 'thinking' ? this.claudeProgress.text : '';
    }
  }

  render() {
    if (this.el.hidden) return;
    const f = this.features, st = this.status || {};
    const parts = [];
    parts.push(h('div', { class: 'ai-step' },
      h('b', {}, '1. 파일'),
      h('div', { class: 'row' }, h('button', { class: 'btn', disabled: !!this.busy, onclick: () => this.pick() }, this.file ? '다른 파일…' : '파일 고르기…'),
        h('span', { class: 'dim' }, this.file ? this.file.name : 'WAV·MP3·FLAC·MP4·MOV 파일을 선택하거나 이 창으로 드래그하세요.'))));
    if (this.busy) parts.push(h('div', { class: 'ai-busy' }, this.progEl = h('span', {}), this.busy === 'claude' ? h('button', { class: 'btn sm ghost', onclick: () => window.melofi.claudeCancel() }, '취소') : null, this.thinkEl = h('p', { class: 'ai-think' })));
    if (this.error) parts.push(h('p', { class: 'cl-msg err' }, this.error));
    if (f) {
      const bars = f.bars;
      parts.push(h('div', { class: 'ai-step' },
        h('b', {}, '2. MeloFi 분석'),
        h('div', { class: 'ai-facts' },
          h('span', { class: 'ai-fact' }, h('small', {}, '템포'), h('b', {}, `${f.bpm} BPM`),
            h('span', { class: 'ai-tempo' },
              h('button', { disabled: !!this.busy, title: '박자가 실제보다 느리게 잡혔을 때', onclick: () => this.retempo(2) }, '×2'),
              h('button', { disabled: !!this.busy, title: '박자가 실제보다 빠르게 잡혔을 때', onclick: () => this.retempo(0.5) }, '÷2'))),
          fact('키', keyName(f)), fact('길이', `${Math.floor(f.duration / 60)}분 ${Math.round(f.duration % 60)}초`), fact('마디', `${bars.length}`), fact('구간', `${f.sections.length}`)),
        h('div', { class: 'ai-chords' }, ...bars.slice(0, 32).map((b) => h('span', { title: `${b.bar}마디` }, b.chords.join(' · ')))),
        h('div', { class: 'ai-secs' }, ...f.sections.map((s, i) => h('span', { style: `flex:${s.end_bar - s.start_bar + 1}`, title: `${s.start_bar}~${s.end_bar}마디 · ${s.chords.join(' ')}` }, String.fromCharCode(65 + (i % 26))))),
        h('div', { class: 'row' },
          h('button', { class: 'btn', disabled: !!this.busy, onclick: () => this.open(false) }, '이 분석으로 바로 프로젝트 만들기'),
          h('span', { class: 'dim' }, 'API 키 없이 사용할 수 있습니다. 드럼·베이스·코드·멜로디를 구간별 패턴으로 변환합니다.'))));
      // Claude
      const keyRow = st.hasKey
        ? h('div', { class: 'row' }, h('span', { class: 'dim' }, st.fromEnv ? '환경 변수의 API 키를 씁니다.' : 'API 키가 저장돼 있습니다.'),
          h('button', { class: 'btn sm ghost', onclick: async () => { await window.melofi.claudeSetKey(''); this.status = await window.melofi.claudeStatus(); this.render(); } }, '키 지우기'))
        : (() => { const inp = h('input', { type: 'password', class: 'cl-in', placeholder: 'sk-ant-…', style: 'max-width:340px' });
          return h('div', { class: 'row' }, inp, h('button', { class: 'btn sm', onclick: async () => { const r = await window.melofi.claudeSetKey(inp.value); if (!r.ok) { this.error = r.message; } this.status = await window.melofi.claudeStatus(); this.render(); } }, '저장'),
            h('span', { class: 'dim' }, 'console.anthropic.com에서 발급받은 키를 입력하세요. 이 기기에만 암호화하여 저장됩니다.')); })();
      parts.push(h('div', { class: 'ai-step' },
        h('b', {}, '3. Claude로 분석 · 재구성'),
        keyRow,
        h('label', { class: 'frm-row' }, h('span', {}, '재구성 방식'), h('select', { onchange: (e) => { this.style = e.target.value; } }, ...STYLES.map((s) => h('option', { value: s, selected: this.style === s }, s)))),
        h('label', { class: 'frm-row' }, h('span', {}, '추가 요청'), h('textarea', { class: 'cl-in', rows: 2, placeholder: '예: 후렴만 8마디로, 템포는 90으로, 기타 대신 피아노', oninput: (e) => { this.request = e.target.value; } }, this.request)),
        h('label', { class: 'frm-row' }, h('span', {}, '모델'), h('select', { onchange: (e) => { this.model = e.target.value; } }, ...Object.entries(st.models || {}).map(([k, v]) => h('option', { value: k, selected: this.model === k }, k === 'claude-sonnet-5-5' ? `${v} (더 저렴)` : v)))),
        h('label', { class: 'frm-row' }, h('span', {}, '생각 깊이'), h('select', { onchange: (e) => { this.effort = e.target.value; } }, ...EFFORT.map(([k, l]) => h('option', { value: k, selected: this.effort === k }, l)))),
        h('div', { class: 'row' }, h('button', { class: 'btn primary', disabled: !st.hasKey || !!this.busy, onclick: () => this.askClaude() }, 'Claude에게 맡기기'),
          h('span', { class: 'dim' }, '분석 결과(숫자 및 코드명)만 전송하며 오디오 파일은 전송하지 않습니다. 약 1~3분 소요됩니다.'))));
    }
    if (this.result) parts.push(this.report());
    if (f) parts.push(h('label', { class: 'chk ai-orig' }, h('input', { type: 'checkbox', checked: this.withOriginal, onchange: (e) => { this.withOriginal = e.target.checked; } }), ' 원곡을 음소거된 참고 트랙으로 함께 넣기'));
    this.body.replaceChildren(...parts);
    this.renderProgress();
  }

  report() {
    const a = this.result.analysis, arr = this.result.arrangement;
    const notes = arr.patterns.reduce((s, p) => s + p.notes.length, 0);
    return h('div', { class: 'ai-step ai-report' },
      h('b', {}, '4. Claude의 분석'),
      h('p', {}, a.summary),
      h('div', { class: 'ai-facts' }, fact('장르', a.genre), fact('분위기', a.mood), fact('악기', a.instruments.join(', '))),
      h('div', { class: 'ai-struct' }, ...a.structure.map((s) => h('div', {}, h('em', {}, `${s.start_bar}~${s.end_bar}마디`), h('b', {}, s.name), h('span', {}, s.description)))),
      h('p', {}, h('em', {}, '화성 '), a.harmony),
      h('p', {}, h('em', {}, '사운드 '), a.production_notes),
      h('ul', {}, ...a.tips.map((t) => h('li', {}, t))),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', onclick: () => this.open(true) }, `재구성한 프로젝트 열기 (채널 ${arr.channels.length} · 패턴 ${arr.patterns.length} · 노트 ${notes})`),
        h('span', { class: 'dim' }, `${this.servedBy || ''} · 입력 ${this.usage?.input?.toLocaleString()} / 출력 ${this.usage?.output?.toLocaleString()} 토큰`)));
  }
}

const fact = (k, v) => h('span', { class: 'ai-fact' }, h('small', {}, k), h('b', {}, v));
const keyName = (f) => `${PC[f.key_root]} ${f.key_mode === 'minor' ? '마이너' : '메이저'}`;

// what Claude needs, without the bulk: bars, sections, melody (capped)
function trimFeatures(f) {
  return { duration: f.duration, bpm: f.bpm, key: f.key, sections: f.sections, bars: f.bars.slice(0, 160).map(({ bar, chords, chord_beats, bass, kick, snare, hat, energy }) => ({ bar, chords, chord_beats, bass, kick, snare, hat, energy })), melody: f.melody.slice(0, 400) };
}

const pickInst = (S, want, fallback) => {
  const list = S.app.instruments;
  return (list.find((i) => i.id === want && i.installed) || list.find((i) => i.id === fallback && i.installed) || list.find((i) => i.installed))?.id || 'splendid';
};

// Claude's arrangement -> a MeloFi project
export function fromArrangement(arr, S) {
  const p = newProject();
  p.name = arr.name || 'AI 재구성';
  p.bpm = Math.max(30, Math.min(300, Math.round(arr.bpm || 120)));
  p.scale = SCALES[arr.scale] ? { root: ((arr.key_root % 12) + 12) % 12, type: arr.scale } : null;
  const idMap = new Map();
  p.channels = arr.channels.map((c, i) => {
    const inst = pickInst(S, c.instrument, S.isKit(c.instrument) ? 'drums808' : 'splendid');
    const ch = newChannel(inst, c.name || inst, i, { vol: clamp01(c.volume ?? 0.8), pan: Math.max(-1, Math.min(1, c.pan || 0)), send: clamp01(c.reverb ?? 0.15) });
    const preset = FX_PRESETS.find(([n]) => n === c.effect_preset);
    if (preset) ch.fx = preset[2].map(([type, params]) => ({ id: uid('f'), type, on: true, params: { ...fxDefaults(type), ...params } }));
    idMap.set(c.id, ch);
    return ch;
  });
  if (!p.channels.length) p.channels = [newChannel('splendid', 'Piano', 0)];
  const patMap = new Map();
  p.patterns = arr.patterns.map((pt, i) => {
    const x = newPattern(i, Math.max(1, Math.min(16, pt.bars || 1)));
    x.name = pt.name || x.name;
    for (const n of pt.notes) {
      const ch = idMap.get(n.ch);
      if (!ch) continue;
      (x.notes[ch.id] ||= []).push({ t: Math.max(0, n.t) * STEP, d: Math.max(1, n.d) * STEP, n: Math.max(0, Math.min(127, n.n)), v: Math.max(1, Math.min(127, n.v || 100)) });
    }
    patMap.set(pt.id, x);
    return x;
  });
  if (!p.patterns.length) p.patterns = [newPattern(0)];
  for (const ch of p.channels) if (S.isKit(ch.inst)) { const first = p.patterns.flatMap((x) => x.notes[ch.id] || [])[0]; ch.stepNote = first?.n ?? 36; }
  const tracks = Math.max(8, ...arr.playlist.map((c) => c.track + 1));
  p.playlist.tracks = Array.from({ length: tracks }, (_, i) => newTrack(i));
  p.playlist.clips = arr.playlist.filter((c) => patMap.has(c.pattern)).map((c) => ({ id: uid('k'), pattern: patMap.get(c.pattern).id, track: Math.max(0, c.track), start: Math.max(0, c.start_bar), len: Math.max(1, c.bars) }));
  p.current = p.patterns[0].id;
  p.selected = (p.channels.find((c) => !S.isKit(c.inst)) || p.channels[0]).id;
  p.mode = p.playlist.clips.length ? 'song' : 'pattern';
  p.master.fx = FX_PRESETS.find(([n]) => n === '마스터 기본')[2].map(([type, params]) => ({ id: uid('f'), type, on: true, params: { ...fxDefaults(type), ...params } }));
  return p;
}

// no Claude: one pattern per section with drums, bass, chords and melody from the analysis
export function fromFeatures(f, fileName, S) {
  const p = newProject();
  p.name = `${fileName.replace(/\.[^.]+$/, '')} (분석)`;
  p.bpm = Math.round(f.bpm);
  p.scale = { root: f.key_root, type: f.key_mode === 'minor' ? 'minor' : 'major' };
  const drums = newChannel(pickInst(S, 'drumstrap', 'drums808'), 'Drums', 0, { stepNote: 36 });
  const bass = newChannel(pickInst(S, 'synbass', 'splendid'), 'Bass', 1);
  const keys = newChannel(pickInst(S, 'fmep', 'splendid'), 'Chords', 2, { send: 0.25 });
  const lead = newChannel(pickInst(S, 'synlead', 'splendid'), 'Melody', 3, { vol: 0.65 });
  p.channels = [drums, bass, keys, lead];
  p.patterns = [];
  const clips = [];
  const t0 = f.first_downbeat;
  const stepSec = 60 / f.bpm / 4;
  f.sections.forEach((s, si) => {
    const bars = f.bars.slice(s.start_bar - 1, s.end_bar);
    const len = Math.min(8, bars.length);
    const pat = newPattern(si, len);
    pat.name = `구간 ${String.fromCharCode(65 + (si % 26))}`;
    const N = (ch) => (pat.notes[ch.id] ||= []);
    bars.slice(0, len).forEach((b, bi) => {
      const base = bi * 16 * STEP;
      for (const [row, key] of [['kick', 36], ['snare', 38], ['hat', 42]]) [...b[row]].forEach((on, k) => { if (on === '1') N(drums).push({ t: base + k * STEP, d: STEP, n: key, v: key === 42 ? 80 : 105 }); });
      b.bass.forEach((n, q) => { if (n) N(bass).push({ t: base + q * 4 * STEP, d: 4 * STEP, n: fold(n, 28, 52), v: 100 }); });
      // chords on the beats where they change (older analyses: spread evenly over the bar)
      const at = b.chord_beats || b.chords.map((_, k) => (k * 4) / b.chords.length);
      b.chords.forEach((name, k) => { const q0 = at[k], q1 = at[k + 1] ?? 4; for (const n of chordNotes(name)) N(keys).push({ t: base + q0 * 4 * STEP, d: (q1 - q0) * 4 * STEP, n, v: 78 }); });
    });
    // the melody notes inside this section's first `len` bars
    const s0 = Math.round((bars[0].time - t0) / stepSec), s1 = s0 + len * 16;
    for (const m of f.melody) if (m.s >= s0 && m.s < s1) N(lead).push({ t: (m.s - s0) * STEP, d: m.d * STEP, n: fold(m.n, 60, 84), v: 92 });
    p.patterns.push(pat);
    for (let b = 0; b < bars.length; b += len) clips.push({ id: uid('k'), pattern: pat.id, track: 0, start: s.start_bar - 1 + b, len: Math.min(len, bars.length - b) });
  });
  if (!p.patterns.length) p.patterns = [newPattern(0)];
  p.playlist.clips = clips;
  p.current = p.patterns[0].id;
  p.selected = keys.id;
  p.mode = 'song';
  return p;
}

// the original as a muted reference track, lined up with bar 1
async function addOriginal(p, file, f) {
  const hash = await addMedia(p, file.name, file.data);
  p.media[hash].bpm = f.bpm;
  const ch = newChannel('splendid', '원곡 (참고)', p.channels.length, { kind: 'audio', vol: 0.8 });
  p.channels.push(ch);
  const tr = p.playlist.tracks.length;
  p.playlist.tracks.push({ ...newTrack(tr), name: '원곡 (참고)', mute: true });
  const secPerBar = (60 / p.bpm) * p.sig[0];
  p.playlist.clips.push({ id: uid('k'), kind: 'audio', media: hash, ch: ch.id, track: tr, start: 0, len: Math.max(1, Math.ceil((f.duration - f.first_downbeat) * (f.bpm / p.bpm) / secPerBar)), offset: f.first_downbeat * (f.bpm / p.bpm), gain: 1, sync: Math.abs(f.bpm - p.bpm) > 0.5 });
}

const clamp01 = (v) => Math.max(0, Math.min(1, +v || 0));
const fold = (n, lo, hi) => { while (n < lo) n += 12; while (n > hi) n -= 12; return n; };
function chordNotes(name) {
  const m = /^([A-G]#?)(.*)$/.exec(name || '');
  if (!m) return [];
  const r = PC.indexOf(m[1]);
  const iv = { '': [0, 4, 7], m: [0, 3, 7], '7': [0, 4, 7, 10], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10], sus4: [0, 5, 7], add9: [0, 4, 7, 14], dim: [0, 3, 6] }[m[2]] || [0, 4, 7];
  return iv.map((i) => fold(48 + r + i, 52, 76));
}

void popup;
