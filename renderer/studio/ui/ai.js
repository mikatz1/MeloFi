// "AI로 곡 분석·재구성": open an audio or video file and analyse it. With the analysis engine
// installed (stems.js: open-source models run on this computer) the song is split into instrument
// stems, its beats / tempo / key come from Beat This! and each stem's notes from Basic Pitch; the
// chords and sections are read from the pitched stems on that beat grid. Without it, MeloFi's own
// quick analysis runs. Then: a project from the separated tracks, a project from the analysis, or
// a re-arrangement by Claude (only the analysis is sent to Claude, never the audio).
import { h, popup } from './dom.js';
import { newProject, newChannel, newPattern, newTrack, uid, STEP, PPQ, SCALES, secToTick, barTicks } from '../model.js';
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
    // a click beside the card closes it, but not while something is running (the × still does)
    this.el.addEventListener('pointerdown', (e) => { if (e.target === this.el && !this.busy) this.close(); });
    this.el.addEventListener('dragover', (e) => e.preventDefault());
    this.el.addEventListener('drop', async (e) => {
      e.preventDefault();
      const f = [...e.dataTransfer.files][0];
      if (f) this.load({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) });
    });
    document.body.append(this.el);
    window.melofi.onClaudeProgress((p) => { this.claudeProgress = p; this.renderProgress(); });
    window.melofi.onStemsProgress((m) => {
      if (typeof m.p === 'number') { this.progress = m.p; if (this.barEl) this.barEl.style.width = `${Math.round(m.p * 100)}%`; }
      if (m.label && m.label !== this.stemLabel) this.stage = null; // a new stage starts empty
      if (typeof m.stage === 'number') this.stage = m.stage;
      if (m.label) this.stemLabel = m.label;
      this.paintBars();
      if (m.detail) this.stemDetail = m.detail;
      this.renderProgress();
    });
    this.stems = null;       // the engine's result for the current file
    this.useAudio = true;    // separated tracks as audio clips
    this.mus = studio.app.settings.get('stemsMuscriptor') || 'off'; // MuScriptor model size or 'off'
    this.useMidi = true;     // transcribed notes as MIDI channels
    this.method = 'engine';  // engine (open-source models on this PC) | quick (MeloFi's own, a few seconds)
    this.sepMode = 'full';   // full | fast (no drum split, no lead / backing split)
    this.log = [];           // the engine's log lines, shown live under the progress bar
    window.melofi.onStemsLog((t) => this.addLog(t));
  }

  async show() {
    this.S.app.ui.close();
    this.el.hidden = false;
    this.status = await window.melofi.claudeStatus();
    this.engine = await window.melofi.stemsStatus();
    this.render();
    this.checkGpu();
    this.startGpuWatch();
  }

  async checkGpu() {
    this.gpuInfo = await window.melofi.stemsGpu().catch(() => null);
    if (!this.busy) this.render();
  }

  // live GPU line: read every 2 s while the window is open, swapped in place so nothing typed or
  // scrolled is disturbed; a full redraw only when the start button's state would change
  startGpuWatch() {
    clearInterval(this.gpuTimer);
    this.gpuTimer = setInterval(async () => {
      if (this.el.hidden) return clearInterval(this.gpuTimer);
      const before = this.gpuShort;
      this.gpuInfo = await window.melofi.stemsGpu().catch(() => this.gpuInfo);
      const old = this.el.querySelector('.ai-gpu');
      if (!old) return;
      const fresh = this.optionsView().querySelector('.ai-gpu');
      if (!this.busy && before !== this.gpuShort && !this.el.contains(document.activeElement)) return this.render();
      if (fresh) old.replaceWith(fresh);
    }, 2000);
  }

  close() { this.el.hidden = true; this.stopPreview(); clearInterval(this.gpuTimer); }

  async setupEngine() {
    if (this.busy) return;
    this.busy = 'setup'; this.progress = 0; this.stemLabel = '설치를 준비하는 중…'; this.stemDetail = ''; this.error = null; this.render();
    const r = await window.melofi.stemsSetup();
    this.busy = null;
    if (!r.ok) this.error = r.message;
    this.engine = await window.melofi.stemsStatus();
    this.render();
  }

  async pick() {
    const list = await window.melofi.mediaPickFiles({ video: true });
    if (list[0]) this.load(list[0]);
  }

  // decode (audio or the soundtrack of a video), mix to mono 22.05 kHz, analyse in a worker
  // 1) the file: read and decoded (for its length and the quick analysis), nothing is analysed yet
  async load(file) {
    this.seq = (this.seq || 0) + 1;
    this.file = file; this.features = null; this.result = null; this.error = null; this.stems = null; this.stopPreview();
    this.busy = 'decode'; this.render();
    try {
      const ctx = new OfflineAudioContext(1, 1, 22050);
      const buf = await ctx.decodeAudioData(file.data.buffer.slice(file.data.byteOffset, file.data.byteOffset + file.data.byteLength));
      const n = buf.length, mono = new Float32Array(n);
      for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) mono[i] += d[i] / buf.numberOfChannels; }
      this.audio = { mono, rate: buf.sampleRate, duration: buf.duration };
    } catch (err) {
      this.file = null;
      this.error = '이 파일에서 오디오를 불러올 수 없습니다. WAV, MP3, MP4(AAC) 파일을 사용해 보세요.';
    }
    this.busy = null;
    this.render();
  }

  // 3) the analysis, the way it was chosen in step 2
  async analyse() {
    if (!this.audio || this.busy) return;
    const seq = this.seq = (this.seq || 0) + 1;
    const stale = () => seq !== this.seq;
    const file = this.file;
    this.features = null; this.result = null; this.error = null; this.stems = null; this.stopPreview();
    this.log = []; this.t0 = Date.now();
    try {
      if (this.method === 'engine' && this.engine?.ready) {
        await this.checkGpu();
        const g = this.gpuInfo?.gpu;
        this.addLog(g ? `GPU: ${g.name} · 여유 메모리 ${(g.freeMB / 1024).toFixed(1)} GB · 사용률 ${g.util}%` : 'GPU: 없음 (CPU로 처리)');
        // stems, beats, key and notes from the engine; then chords and sections from the pitched
        // stems only, on the engine's beat grid
        this.busy = 'stems'; this.progress = 0; this.stemLabel = '분석을 시작하는 중…'; this.stemDetail = ''; this.render();
        this.addLog(`분석 시작: ${file.name} · 분리 ${this.sepMode === 'fast' ? '빠르게' : '전체'} · 채보 ${this.mus === 'off' ? 'Basic Pitch' : `MuScriptor ${this.mus}`}`);
        const r = await window.melofi.stemsRun({ name: file.name, data: file.data, quick: this.sepMode === 'fast', muscriptor: this.engine.hfToken ? this.mus : 'off' });
        if (stale()) return;
        if (!r.ok) throw new Error(r.message);
        if (r.cached) this.addLog('저장된 분석 결과를 다시 썼어요 (분리·박자는 건너뜀).');
        const res = this.stems = r.result;
        let mono = this.audio.mono, rate = this.audio.rate;
        if (res.harmonic) {
          this.addLog('코드·구간을 읽기 위해 음정 악기만 모은 소리를 불러오는 중');
          const bytes = await window.melofi.stemsRead(res.harmonic);
          if (bytes) { const b = await new OfflineAudioContext(1, 1, 22050).decodeAudioData(bytes.buffer); mono = b.getChannelData(0).slice(); rate = b.sampleRate; }
        }
        this.busy = 'analyse'; this.progress = 0; this.render();
        this.addLog('코드와 구간을 찾는 중 (박자 격자: Beat This!)');
        const feats = await this.runWorker(res.bpm, { beats: res.beats, downbeats: res.downbeats }, mono, rate);
        if (stale()) return;
        this.features = feats;
        Object.assign(this.features, { bpm: Math.round(res.bpm * 10) / 10, first_downbeat: res.first_downbeat, key_root: res.key.root, key_mode: res.key.mode === 'minor' ? 'minor' : 'major', engine: true });
        this.addLog(`끝: ${Math.round((Date.now() - this.t0) / 1000)}초`);
      } else {
        this.busy = 'analyse'; this.render();
        this.addLog('MeloFi 간이 분석 시작');
        const feats = await this.runWorker();
        if (stale()) return;
        this.features = feats;
        this.addLog(`끝: ${Math.round((Date.now() - this.t0) / 1000)}초`);
      }
    } catch (err) {
      if (stale()) return;
      this.error = `분석하지 못했습니다: ${err.message}`;
      this.addLog(`오류: ${err.message}`);
    }
    this.busy = null;
    this.render();
  }

  // the two bars: the current stage (indeterminate when the stage reports no steps) and the whole run
  paintBars() {
    if (this.barEl) { this.barEl.style.width = `${Math.round((this.progress || 0) * 100)}%`; this.allPct.textContent = `${Math.round((this.progress || 0) * 100)}%`; }
    if (this.stageEl) {
      const known = typeof this.stage === 'number';
      this.stageEl.parentElement.classList.toggle('busy', !known);
      this.stageEl.style.width = known ? `${Math.round(this.stage * 100)}%` : '';
      this.stagePct.textContent = known ? `${Math.round(this.stage * 100)}%` : '';
    }
  }

  // the live log: lines appended as they come, newest at the bottom, follows unless scrolled up
  addLog(t) {
    const sec = this.t0 ? Math.round((Date.now() - this.t0) / 1000) : 0;
    const line = `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}  ${String(t).replace(/\u001b\[[0-9;]*m/g, '')}`;
    // a progress bar redraws one line: replace the last line when it is the same bar
    const bar = /\d+%\|/.test(line), last = this.log[this.log.length - 1];
    if (bar && last && /\d+%\|/.test(last) && last.split('|')[0].replace(/\d+%/, '') === line.split('|')[0].replace(/\d+%/, '')) this.log[this.log.length - 1] = line;
    else this.log.push(line);
    if (this.log.length > 600) this.log.splice(0, this.log.length - 600);
    const el = this.logEl;
    if (el && el.isConnected) {
      const follow = el.scrollTop + el.clientHeight >= el.scrollHeight - 24;
      el.textContent = this.log.join('\n');
      if (follow) el.scrollTop = el.scrollHeight;
    }
  }

  runWorker(tempo, grid = null, mono = this.audio.mono, rate = this.audio.rate) {
    const samples = mono.slice();
    return new Promise((resolve, reject) => {
      const w = new Worker('melofi://app/renderer/studio/analyze-worker.js');
      w.onmessage = (e) => {
        if (e.data.type === 'progress') { if (this.busy === 'analyse' && this.stems) { this.stage = e.data.p; this.progress = 0.97 + 0.03 * e.data.p; } else { this.progress = e.data.p; this.stage = e.data.p; } this.renderProgress(); this.paintBars(); }
        if (e.data.type === 'done') { w.terminate(); resolve(e.data.result); }
        if (e.data.type === 'error') { w.terminate(); reject(new Error(e.data.message)); }
      };
      w.postMessage({ samples, rate, tempo, grid }, [samples.buffer]);
    });
  }

  // Tempo detection can land on half or double time (ballads, half-time trap). Re-run the
  // analysis around the corrected tempo so beats, bars and chords follow it.
  async retempo(factor) {
    if (!this.audio || !this.features || this.busy || this.stems) return;
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

  // ---------- stems ----------
  async preview(id, file) {
    if (this.playing === id) return this.stopPreview();
    this.stopPreview();
    const bytes = await window.melofi.stemsRead(file);
    if (!bytes) return;
    const url = URL.createObjectURL(new Blob([bytes], { type: /\.flac$/i.test(file) ? 'audio/flac' : 'audio/wav' }));
    const a = new Audio(url);
    a.currentTime = Math.max(0, (this.stems?.first_downbeat || 0));
    a.onended = () => this.stopPreview();
    a.play();
    this.audioEl = a; this.audioUrl = url; this.playing = id;
    this.render();
  }

  stopPreview() {
    if (this.audioEl) { this.audioEl.pause(); URL.revokeObjectURL(this.audioUrl); }
    this.audioEl = null; this.playing = null;
    if (!this.el.hidden) this.render();
  }

  async openStems() {
    const S = this.S;
    this.busy = 'build'; this.render();
    try {
      const proj = await fromStems(this.stems, this.features, this.file.name, S, { audio: this.useAudio, midi: this.useMidi });
      S.setProject(proj);
      S.setTab('playlist');
      this.close();
      S.app.ui.toast('분리한 트랙으로 프로젝트를 만들었습니다');
    } catch (err) { this.error = `프로젝트를 만들지 못했습니다: ${err.message}`; }
    this.busy = null; this.render();
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
      this.progEl.textContent = this.busy === 'stems' || this.busy === 'setup' ? `${this.stemLabel || ''} ${Math.round(this.progress * 100)}%${this.stemDetail && this.busy === 'setup' ? ` · ${this.stemDetail}` : ''}`
        : this.busy === 'build' ? '트랙을 만드는 중…'
        : this.busy === 'decode' ? '파일을 읽는 중…'
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
    // the analysis engine: separation, beats and notes with open-source models on this computer
    const eng = this.engine || {};
    if (!eng.ready) parts.push(h('div', { class: 'ai-step ai-engine' },
      h('b', {}, '정밀 분석 엔진'),
      h('p', { class: 'dim' }, `악기별 음원 분리(BS-RoFormer · BS-RoFormer SW 6-stem · DrumSep), 박자 분석(Beat This!), 채보(Basic Pitch)를 이 컴퓨터에서 실행합니다. 처음 한 번 약 3 GB를 받습니다${eng.gpu ? '. NVIDIA GPU로 빠르게 처리해요.' : '. GPU가 없으면 한 곡에 몇 분 걸려요.'} 설치하지 않으면 간이 분석을 사용합니다.`),
      eng.reason ? h('p', { class: 'cl-msg err' }, `엔진을 쓸 수 없는 이유: ${eng.reason}`) : null,
      h('div', { class: 'row' }, h('button', { class: 'btn', disabled: !!this.busy, onclick: () => this.setupEngine() }, '엔진 설치'),
        h('button', { class: 'btn sm ghost', disabled: !!this.busy, onclick: async () => { this.engine = await window.melofi.stemsStatus(); this.render(); } }, '다시 확인'))));
    parts.push(this.optionsView());
    if (this.busy) parts.push(h('div', { class: 'ai-busy' },
      h('div', { class: 'row' }, this.progEl = h('span', {}),
        this.busy === 'claude' ? h('button', { class: 'btn sm ghost', onclick: () => window.melofi.claudeCancel() }, '취소') : null,
        this.busy === 'stems' ? h('button', { class: 'btn sm ghost', onclick: () => { window.melofi.stemsCancel(); this.addLog('취소를 요청했어요.'); } }, '취소') : null),
      ['stems', 'analyse'].includes(this.busy) ? h('div', { class: 'ai-bars' },
        h('div', { class: 'ai-barrow' }, h('span', {}, '현재 단계'), h('div', { class: 'ai-bar stage' }, this.stageEl = h('i')), this.stagePct = h('em')),
        h('div', { class: 'ai-barrow' }, h('span', {}, '전체'), h('div', { class: 'ai-bar' }, this.barEl = h('i')), this.allPct = h('em'))) : null,
      this.thinkEl = h('p', { class: 'ai-think' })));
    // the live log stays under the progress while working, and after it for a look back
    if (this.log.length && (this.busy === 'stems' || this.busy === 'analyse' || this.stems || this.error)) {
      parts.push(h('details', { class: 'ai-logwrap', open: !!this.busy || !!this.error },
        h('summary', {}, `작업 로그 (${this.log.length}줄)`),
        this.logEl = h('pre', { class: 'ai-log' }, this.log.join('\n'))));
      requestAnimationFrame(() => { if (this.logEl) this.logEl.scrollTop = this.logEl.scrollHeight; });
    }
    if (this.error) parts.push(h('p', { class: 'cl-msg err' }, this.error));
    if (this.stems && f) parts.push(this.stemsView());
    if (f) {
      const bars = f.bars;
      parts.push(h('div', { class: 'ai-step' },
        h('b', {}, this.stems ? '5. 코드 · 구간' : '4. MeloFi 분석'),
        h('div', { class: 'ai-facts' },
          h('span', { class: 'ai-fact' }, h('small', {}, '템포'), h('b', {}, `${f.bpm} BPM`),
            this.stems ? null : h('span', { class: 'ai-tempo' },
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
        h('b', {}, `${this.stems ? 6 : 5}. Claude로 분석 · 재구성`),
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
    this.paintBars();
  }

  // MuScriptor (Kyutai · Mirelo): transcribes the whole mix into ~35 instrument classes. Its model
  // weights are CC BY-NC 4.0, so it is opt-in, labelled non-commercial everywhere it shows, and its
  // weights download only with the user's own HuggingFace token.
  // 2) how to analyse: chosen up front from drop-downs, then 3) start
  optionsView() {
    const eng = this.engine || {};
    const engine = this.method === 'engine' && eng.ready;
    const sel = (value, options, on, attrs = {}) => h('select', { class: 'ai-sel', disabled: !!this.busy, onchange: (e) => on(e.target.value), ...attrs },
      ...options.map(([v, l, dis]) => h('option', { value: v, selected: value === v, disabled: !!dis }, l)));
    const row = (label, ctl, note) => h('label', { class: 'ai-opt' }, h('span', {}, label), ctl, note ? h('small', { class: 'dim' }, note) : null);
    const setMus = (v) => { this.mus = v; this.S.app.settings.set({ stemsMuscriptor: v }); this.render(); this.checkGpu(); };
    const needToken = engine && this.mus !== 'off' && !eng.hfToken;
    const dur = this.audio?.duration || 0;
    const g = this.gpuInfo?.gpu;
    // graphics memory each MuScriptor model needs (MB), and the time per minute of audio measured on
    // an RTX 5060 Laptop GPU; without a usable GPU everything runs on the processor, many times slower
    const NEED = { off: 2600, small: 2700, medium: 3200, large: 5200 }; // MuScriptor runs in bfloat16 on the GPU
    const PER = { sepFull: 1.35, sepFast: 0.9, beats: 0.02, bp: 0.12, small: 0.3, medium: 0.65, large: 1.8 }; // large: bfloat16, 52 s for 30 s
    const usable = !!g && eng.gpu;
    const slow = usable ? 1 : 10;
    const sep = dur * (this.sepMode === 'fast' ? PER.sepFast : PER.sepFull) * slow;
    const tr = dur * (this.mus === 'off' ? PER.bp : PER[this.mus]) * slow;
    const fmtT = (sec) => (sec < 60 ? `${Math.max(5, Math.round(sec / 5) * 5)}초` : `${Math.round(sec / 60)}분`);
    const est = !dur ? '' : engine ? `분리 ${fmtT(sep)} · 박자 ${fmtT(dur * PER.beats * slow)} · 채보 ${fmtT(tr)} → 약 ${fmtT(sep + tr + dur * PER.beats * slow)}` : '몇 초';
    // the GPU check: enough free memory for the chosen model, not busy with something else
    const free = g ? g.freeMB : 0, need = NEED[this.mus] || 2600;
    const others = g ? g.apps.filter((a) => !/^python/i.test(a) || !g.ours) : [];
    const short = engine && usable && free < need && !g.ours;
    this.gpuShort = short;
    const gpuLine = !engine ? null : !g
      ? h('p', { class: 'cl-msg err' }, 'NVIDIA GPU를 찾지 못했어요. 프로세서(CPU)로 처리해서 아주 오래 걸려요 (예상 시간에 반영).')
      : h('div', { class: `ai-gpu${short ? ' bad' : g.util > 40 ? ' warn' : ''}` },
        h('b', {}, g.name),
        h('span', {}, `그래픽 메모리 ${(g.totalMB / 1024).toFixed(1)} GB 중 ${(g.freeMB / 1024).toFixed(1)} GB 비어 있음 · 사용률 ${g.util}%`),
        this.gpuInfo.screen ? h('span', {}, `MeloFi 화면(피아노 비주얼라이저)은 ${this.gpuInfo.screen.vendor === 'NVIDIA' ? '이 GPU에서 그려요. 분석 중에는 피아노 창을 닫거나 최소화하면 더 빨라요.' : `${this.gpuInfo.screen.vendor} 내장 그래픽에서 그려서 분석과 겹치지 않아요.`}`) : null,
        short ? h('span', { class: 'err' }, `MuScriptor ${this.mus}에는 약 ${(need / 1024).toFixed(1)} GB가 필요해요. GPU를 쓰는 다른 프로그램을 닫거나 더 작은 모델을 골라 주세요.`) : null,
        !short && g.util > 40 ? h('span', { class: 'warn' }, `다른 작업이 GPU를 ${g.util}% 쓰고 있어요${others.length ? ` (${[...new Set(others)].join(', ')})` : ''}. 그대로 시작하면 느려질 수 있어요.`) : null,
        h('span', { class: 'ai-live', title: '2초마다 새로 읽어요' }, '실시간'));
    const done = this.stems ? (this.stems.muscriptor?.notes ? this.stems.muscriptor.model : 'off') : null;
    return h('div', { class: 'ai-step' },
      h('b', {}, '2. 분석 방식'),
      h('div', { class: 'ai-opts' },
        row('분석 엔진', sel(this.method, [['engine', `정밀 분석 · 오픈소스 엔진, 이 PC에서 실행${eng.ready ? '' : ' (설치 필요)'}`, !eng.ready], ['quick', '간이 분석 · MeloFi 내장, 몇 초']], (v) => { this.method = v; this.render(); })),
        engine ? row('악기 분리', sel(this.sepMode, [['full', '전체 · 보컬·코러스·드럼(킥·스네어 등 세부)·베이스·기타·피아노·나머지'], ['fast', '빠르게 · 코러스와 드럼 세부 분리 생략']], (v) => { this.sepMode = v; this.render(); })) : null,
        engine ? row('채보 방식', h('span', { class: 'ai-opt-ctl' },
          sel(this.mus, [['off', 'Basic Pitch · 분리한 악기마다, 사용 제한 없음'], ['small', 'MuScriptor small · 가장 빠름'], ['medium', 'MuScriptor medium · 균형'], ['large', 'MuScriptor large · 가장 정확, 느림']], setMus),
          this.mus !== 'off' ? h('span', { class: 'ai-nc' }, '비상업 전용 · CC BY-NC 4.0') : null)) : null),
      engine && this.mus !== 'off' ? h('p', { class: 'dim' }, '곡 전체에서 피아노·기타·베이스·현악·관악·신스·보컬·드럼 등 약 35가지 악기로 나눠 받아 적어요. 결과를 상업적으로 쓸 수는 없어요.') : null,
      needToken ? (() => {
        const inp = h('input', { type: 'password', class: 'cl-in', placeholder: 'hf_…', style: 'max-width:300px' });
        return h('div', {},
          h('p', { class: 'dim' }, `MuScriptor를 쓰려면 처음 한 번: huggingface.co/MuScriptor/muscriptor-${this.mus} 에서 로그인한 뒤 라이선스(CC BY-NC 4.0)에 동의하고, huggingface.co/settings/tokens 에서 읽기(Read) 토큰을 만들어 넣어 주세요. 토큰은 이 PC에만 암호화해 저장해요.`),
          h('div', { class: 'row' }, inp, h('button', { class: 'btn sm', onclick: async () => { const r = await window.melofi.stemsSetToken(inp.value); if (!r.ok) this.error = r.message; this.engine = await window.melofi.stemsStatus(); this.render(); } }, '저장')));
      })() : null,
      engine && this.mus !== 'off' && eng.hfToken ? h('div', { class: 'row' }, h('span', { class: 'dim' }, 'HuggingFace 토큰이 저장돼 있어요.'),
        h('button', { class: 'btn sm ghost', disabled: !!this.busy, onclick: async () => { await window.melofi.stemsSetToken(''); this.engine = await window.melofi.stemsStatus(); this.render(); } }, '토큰 지우기')) : null,
      gpuLine,
      h('div', { class: 'ai-go' },
        h('b', {}, '3.'),
        h('button', { class: 'btn primary', disabled: !this.audio || !!this.busy || needToken || short, onclick: () => this.analyse() }, this.features ? '이 방식으로 다시 분석' : '분석 시작'),
        // after an analysis: another transcription only redoes the transcription (separation kept)
        engine && done !== null && done !== this.mus && !needToken ? h('button', { class: 'btn', disabled: !!this.busy, onclick: () => this.retranscribe() }, this.mus === 'off' ? 'Basic Pitch 결과로 보기' : `채보만 MuScriptor ${this.mus}로 다시`) : null,
        h('span', { class: 'dim' }, !this.audio ? '먼저 파일을 골라 주세요.' : `${this.file.name} · ${Math.floor(dur / 60)}분 ${Math.round(dur % 60)}초 · 예상 ${est}`)));
  }

  async retranscribe() {
    if (!this.file || this.busy) return;
    const seq = this.seq;
    this.log = []; this.t0 = Date.now();
    this.busy = 'stems'; this.progress = 0; this.stemLabel = '채보를 준비하는 중…'; this.error = null; this.render();
    this.addLog(`채보만 다시: ${this.mus === 'off' ? 'Basic Pitch' : `MuScriptor ${this.mus}`} (분리·박자 결과는 그대로)`);
    const r = await window.melofi.stemsRun({ name: this.file.name, data: this.file.data, quick: this.sepMode === 'fast', muscriptor: this.mus });
    if (seq !== this.seq) return;
    this.busy = null;
    if (!r.ok) this.error = r.message; else this.stems = r.result;
    this.render();
  }

  stemsView() {
    const r = this.stems;
    const NAMES = { vocals: '리드 보컬', backing: '코러스', drums: '드럼', bass: '베이스', guitar: '기타', piano: '피아노', other: '그 밖의 악기' };
    const DRUMS = { kick: '킥', snare: '스네어', toms: '탐', hh: '하이햇', ride: '라이드', crash: '크래시' };
    const noteCount = (k) => r.notes?.[k]?.length || 0;
    const chip = (id, name, file, sub) => h('button', { class: `ai-stem${this.playing === id ? ' on' : ''}`, title: '눌러서 들어보기', onclick: () => this.preview(id, file) },
      h('i', {}, this.playing === id ? '■' : '▶'), h('span', {}, name), sub ? h('small', {}, sub) : null);
    const order = ['vocals', 'backing', 'drums', 'bass', 'guitar', 'piano', 'other'].filter((k) => r.stems[k]);
    const t = r.times?.total;
    return h('div', { class: 'ai-step' },
      h('b', {}, '4. 악기별 분리 · 박자 · 채보'),
      h('div', { class: 'ai-facts' },
        fact('템포', `${Math.round(r.bpm * 10) / 10} BPM`), fact('박자', `${r.meter}/4`), fact('키', `${PC[r.key.root]} ${r.key.mode === 'minor' ? '마이너' : '메이저'}`),
        fact('첫 마디', `${r.first_downbeat.toFixed(2)}초`), fact('처리', `${r.device === 'cuda' ? 'GPU' : 'CPU'}${t ? ` · ${Math.round(t)}초` : ''}`)),
      h('div', { class: 'ai-stems' }, ...order.map((k) => chip(k, NAMES[k] || k, r.stems[k], k === 'drums' ? `타격 ${r.drums?.length || 0}` : noteCount(k) ? `음표 ${noteCount(k)}` : null))),
      r.muscriptor?.notes ? h('p', {}, h('span', { class: 'ai-nc' }, '비상업 전용'), ` MuScriptor(${r.muscriptor.model})가 ${Object.keys(r.muscriptor.notes).length}가지 악기, 음표 ${Object.values(r.muscriptor.notes).reduce((s, l) => s + l.length, 0).toLocaleString()}개를 받아 적었어요: ${Object.keys(r.muscriptor.notes).map((k) => MUS[k]?.[0] || k).join(', ')}`) : null,
      r.muscriptor?.error ? h('p', { class: 'cl-msg err' }, `MuScriptor를 실행하지 못했어요: ${r.muscriptor.error}`) : null,
      Object.keys(r.drum_parts || {}).length ? h('div', { class: 'ai-stems sub' }, ...Object.entries(r.drum_parts).map(([k, file]) => chip(`d-${k}`, DRUMS[k] || k, file))) : null,
      h('div', { class: 'row' },
        h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: this.useAudio, onchange: (e) => { this.useAudio = e.target.checked; this.render(); } }), ' 분리한 오디오 트랙'),
        h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: this.useMidi, onchange: (e) => { this.useMidi = e.target.checked; this.render(); } }), ' 채보한 MIDI 채널'),
        h('span', { class: 'sp' }),
        h('button', { class: 'btn primary', disabled: !!this.busy || (!this.useAudio && !this.useMidi), onclick: () => this.openStems() }, '분리한 트랙으로 프로젝트 만들기')),
      h('p', { class: 'dim' }, `오디오와 MIDI를 함께 넣으면 MIDI 채널은 음소거된 상태로 들어가요. 분리: ${r.models.vocals} · ${r.models.instruments}${r.models.drum_parts ? ` · ${r.models.drum_parts}` : ''} / 박자: ${r.models.beats} / 채보: ${r.models.notes}`));
  }

  report() {
    const a = this.result.analysis, arr = this.result.arrangement;
    const notes = arr.patterns.reduce((s, p) => s + p.notes.length, 0);
    return h('div', { class: 'ai-step ai-report' },
      h('b', {}, 'Claude의 분석'),
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
  // every 8 bars of each section gets its own pattern built from those bars (not the section's
  // first 8 bars repeated); a block whose notes match an earlier one reuses that pattern
  const seen = new Map();
  f.sections.forEach((s, si) => {
    const bars = f.bars.slice(s.start_bar - 1, s.end_bar);
    const letter = String.fromCharCode(65 + (si % 26));
    for (let b0 = 0; b0 < bars.length; b0 += 8) {
      const blk = bars.slice(b0, b0 + 8), len = blk.length;
      const pat = newPattern(p.patterns.length, len);
      const first = s.start_bar + b0;
      pat.name = `${letter} ${first}~${first + len - 1}마디`;
      const N = (ch) => (pat.notes[ch.id] ||= []);
      blk.forEach((b, bi) => {
        const base = bi * 16 * STEP;
        for (const [row, key] of [['kick', 36], ['snare', 38], ['hat', 42]]) [...b[row]].forEach((on, k) => { if (on === '1') N(drums).push({ t: base + k * STEP, d: STEP, n: key, v: key === 42 ? 80 : 105 }); });
        b.bass.forEach((n, q) => { if (n) N(bass).push({ t: base + q * 4 * STEP, d: 4 * STEP, n: fold(n, 28, 52), v: 100 }); });
        // chords on the beats where they change (older analyses: spread evenly over the bar)
        const at = b.chord_beats || b.chords.map((_, k) => (k * 4) / b.chords.length);
        b.chords.forEach((name, k) => { const q0 = at[k], q1 = at[k + 1] ?? 4; for (const n of chordNotes(name)) N(keys).push({ t: base + q0 * 4 * STEP, d: (q1 - q0) * 4 * STEP, n, v: 78 }); });
      });
      // the melody notes inside these bars
      const s0 = Math.round((blk[0].time - t0) / stepSec), s1 = s0 + len * 16;
      for (const m of f.melody) if (m.s >= s0 && m.s < s1) N(lead).push({ t: (m.s - s0) * STEP, d: m.d * STEP, n: fold(m.n, 60, 84), v: 92 });
      const sig = `${len}|${JSON.stringify([drums, bass, keys, lead].map((c) => pat.notes[c.id] || []))}`;
      let use = seen.get(sig);
      if (!use) { use = pat; seen.set(sig, pat); p.patterns.push(pat); }
      clips.push({ id: uid('k'), pattern: use.id, track: 0, start: s.start_bar - 1 + b0, len });
    }
  });
  if (!p.patterns.length) p.patterns = [newPattern(0)];
  p.playlist.clips = clips;
  p.current = p.patterns[0].id;
  p.selected = keys.id;
  p.mode = 'song';
  return p;
}

// The engine's result -> a project: the song's tempo map (one tempo per bar from the downbeats when
// the tempo moves), each stem as an audio clip on its own track, and each stem's notes as a MIDI
// channel (muted when the audio is there too) in 8-bar patterns.
export async function fromStems(r, f, fileName, S, { audio = true, midi = true } = {}) {
  const p = newProject();
  p.name = `${fileName.replace(/\.[^.]+$/, '')} (분리)`;
  p.bpm = Math.round(r.bpm * 100) / 100;
  p.sig = [Math.max(2, Math.min(7, r.meter || 4)), 4];
  p.scale = { root: r.key.root, type: r.key.mode === 'minor' ? 'minor' : 'major' };
  const db = cleanDownbeats(r.downbeats || [], r.beats || [], p.sig[0]);
  // tempo per bar when the song drifts (a live band) so bars keep lining up with the recording
  if (db.length > 3) {
    const bars = db.slice(1).map((t, i) => (60 * p.sig[0]) / (t - db[i]));
    const spread = Math.max(...bars) / Math.min(...bars);
    if (spread > 1.02) { p.bpm = Math.round(bars[0] * 100) / 100; p.tempos = bars.slice(1).map((bpm, i) => ({ bar: i + 1, bpm: Math.round(bpm * 100) / 100 })).filter((x, i, a) => i === 0 || Math.abs(x.bpm - a[i - 1].bpm) > 0.05); }
  }
  p.mode = 'song';
  const t0 = r.first_downbeat || 0;
  const tickOf = (sec) => Math.max(0, Math.round(secToTick(p, Math.max(0, sec - t0), 'song')));
  const NAMES = { vocals: '리드 보컬', backing: '코러스', drums: '드럼', bass: '베이스', guitar: '기타', piano: '피아노', other: '그 밖의 악기' };
  const INST = { vocals: ['synlead', 'splendid'], backing: ['chorus', 'oohs'], bass: ['fingerbass', 'ebass'], guitar: ['cleanguitar', 'acoustic'], piano: ['splendid', 'salamander'], other: ['synpad', 'strings'] };
  p.channels = [];
  p.playlist.tracks = [];
  p.playlist.clips = [];
  p.patterns = [];
  const order = ['vocals', 'backing', 'drums', 'bass', 'guitar', 'piano', 'other'].filter((k) => r.stems[k]);
  const secPerBar = (60 / p.bpm) * p.sig[0];
  if (audio) {
    for (const k of order) {
      const bytes = await window.melofi.stemsRead(r.stems[k]);
      if (!bytes) continue;
      const hash = await addMedia(p, `${NAMES[k]}${r.stems[k].match(/\.[a-z0-9]+$/i)?.[0] || '.wav'}`, bytes);
      p.media[hash].bpm = null; // played as recorded, never stretched
      const ch = newChannel('splendid', NAMES[k], p.channels.length, { kind: 'audio', vol: 0.8, send: 0 });
      p.channels.push(ch);
      const tr = p.playlist.tracks.length;
      p.playlist.tracks.push({ ...newTrack(tr), name: NAMES[k] });
      const len = Math.max(1, Math.ceil(secToTick(p, Math.max(0, r.duration - t0), 'song') / barTicks(p)));
      p.playlist.clips.push({ id: uid('k'), kind: 'audio', media: hash, ch: ch.id, track: tr, start: 0, len, offset: t0, gain: 1, sync: false });
    }
  }
  if (midi) {
    const chans = [];
    const mus = r.muscriptor?.notes;
    // MuScriptor's instruments (non-commercial) when it ran, else Basic Pitch per stem
    if (mus) for (const [inst, list] of Object.entries(mus)) {
      const [ko, a1, a2] = MUS[inst] || [inst, 'splendid', 'splendid'];
      const drum = inst === 'drums';
      chans.push([inst, newChannel(pickInst(S, a1, a2), `${ko} (MIDI · 비상업)`, p.channels.length + chans.length, { mute: audio, send: drum ? 0.05 : 0.15, ...(drum ? { stepNote: 36 } : {}) }), list]);
    }
    for (const k of mus ? [] : order) {
      if (k === 'drums') { if (r.drums?.length) chans.push([k, newChannel(pickInst(S, 'acousticdrums', 'drums808'), `${NAMES[k]} (MIDI)`, p.channels.length + chans.length, { stepNote: 36, mute: audio }), r.drums.map(([t, n, v]) => [t, 0.1, n, v])]); continue; }
      const list = r.notes?.[k];
      if (!list?.length) continue;
      const [a1, a2] = INST[k] || ['splendid', 'splendid'];
      chans.push([k, newChannel(pickInst(S, a1, a2), `${NAMES[k]} (MIDI)`, p.channels.length + chans.length, { mute: audio, send: 0.15 }), list]);
    }
    p.channels.push(...chans.map(([, ch]) => ch));
    const bt = barTicks(p), endBar = Math.max(1, Math.ceil(secToTick(p, Math.max(0, r.duration - t0), 'song') / bt));
    const tr = p.playlist.tracks.length;
    p.playlist.tracks.push({ ...newTrack(tr), name: 'MIDI (채보)' });
    for (let b = 0; b < endBar; b += 8) {
      const len = Math.min(8, endBar - b), pat = newPattern(p.patterns.length, len);
      pat.name = `${b + 1}~${b + len}마디`;
      const lo = b * bt, hi = (b + len) * bt;
      for (const [, ch, list] of chans) for (const [t, d, n, v] of list) {
        const tk = tickOf(t);
        if (tk < lo || tk >= hi) continue;
        const dt = Math.max(STEP / 4, tickOf(t + d) - tk);
        (pat.notes[ch.id] ||= []).push({ t: tk - lo, d: Math.round(dt), n, v });
      }
      p.patterns.push(pat);
      p.playlist.clips.push({ id: uid('k'), pattern: pat.id, track: tr, start: b, len });
    }
  }
  if (!p.patterns.length) p.patterns = [newPattern(0)];
  while (p.playlist.tracks.length < 8) p.playlist.tracks.push(newTrack(p.playlist.tracks.length));
  if (!p.channels.length) p.channels = [newChannel('splendid', 'Piano', 0)];
  p.current = p.patterns[0].id;
  p.selected = p.channels[0].id;
  void f; void PPQ; void secPerBar;
  return p;
}

// The beat tracker sometimes marks a downbeat every two beats for a stretch (a half bar read as a
// whole one, which would turn those bars into 150 BPM bars) or skips one. Rebuild a steady bar grid:
// a downbeat much closer than the usual bar length is dropped, a gap of two or more bars is filled.
// The bar length comes from the beats (steadier than the downbeats, which may be wrong for most of
// the song), else from the downbeats themselves.
export function cleanDownbeats(db, beats = [], meter = 4) {
  if (db.length < 4) return db.slice();
  const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const M = beats.length > 8 ? meter * med(beats.slice(1).map((t, i) => t - beats[i])) : med(db.slice(1).map((t, i) => t - db[i]));
  const out = [db[0]];
  for (const t of db.slice(1)) {
    const last = out[out.length - 1], gap = t - last;
    if (gap < 0.75 * M) continue;
    const n = Math.round(gap / M);
    for (let k = 1; k < n; k++) out.push(last + (gap * k) / n);
    out.push(t);
  }
  return out;
}

// MuScriptor instrument -> [Korean name, MeloFi instrument, fallback]
const MUS = {
  acoustic_piano: ['피아노', 'splendid', 'salamander'], electric_piano: ['일렉트릭 피아노', 'rhodes', 'wurlitzer'],
  chromatic_percussion: ['건반 타악기', 'vibraphone', 'glockenspiel'], organ: ['오르간', 'organ', 'drawbar'],
  acoustic_guitar: ['어쿠스틱 기타', 'acoustic', 'cleanguitar'], clean_electric_guitar: ['일렉 기타 (클린)', 'cleanguitar', 'acoustic'],
  distorted_electric_guitar: ['일렉 기타 (디스토션)', 'electric', 'cleanguitar'], acoustic_bass: ['어쿠스틱 베이스', 'upright', 'contrabass'],
  electric_bass: ['일렉 베이스', 'fingerbass', 'ebass'], violin: ['바이올린', 'violin', 'strings'], viola: ['비올라', 'violin', 'strings'],
  cello: ['첼로', 'cello', 'strings'], contrabass: ['콘트라베이스', 'contrabass', 'upright'], orchestral_harp: ['하프', 'harp', 'splendid'],
  timpani: ['팀파니', 'contrabass', 'cello'], string_ensemble: ['현악 합주', 'strings', 'synpad'], synth_strings: ['신스 스트링', 'synpad', 'strings'],
  voice: ['보컬', 'vocal', 'synlead'], orchestra_hit: ['오케스트라 히트', 'brassstab', 'synbrass'], trumpet: ['트럼펫', 'trumpet', 'synbrass'],
  trombone: ['트롬본', 'trombone', 'synbrass'], tuba: ['튜바', 'trombone', 'synbrass'], french_horn: ['호른', 'horn', 'synbrass'],
  brass_section: ['금관 합주', 'synbrass', 'trumpet'], soprano_and_alto_sax: ['알토 색소폰', 'altosax', 'tenorsax'], tenor_sax: ['테너 색소폰', 'tenorsax', 'altosax'],
  baritone_sax: ['바리톤 색소폰', 'tenorsax', 'altosax'], oboe: ['오보에', 'oboe', 'clarinet'], english_horn: ['잉글리시 호른', 'oboe', 'clarinet'],
  bassoon: ['바순', 'clarinet', 'oboe'], clarinet: ['클라리넷', 'clarinet', 'oboe'], flutes: ['플루트', 'flute', 'recorder'],
  synth_lead: ['신스 리드', 'synlead', 'supersaw'], synth_pad: ['신스 패드', 'synpad', 'strings'], drums: ['드럼', 'acousticdrums', 'drums808'],
};

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
