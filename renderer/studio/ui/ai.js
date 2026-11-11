// "AI로 음원 분리": open an audio or video file and split it into instrument stems with the analysis
// engine (stems.js: open-source models run on this computer): BS-RoFormer separation, Beat This!
// beats / tempo, Basic Pitch (or MuScriptor) notes. Then a project from the separated tracks, or the
// stems turned into MIDI with an instrument chosen for each section (midiconvert.js).
import { h, popup } from './dom.js';
import { encode } from '../export-audio.js';
import { newProject, newChannel, newPattern, newTrack, uid, STEP, secToTick, barTicks } from '../model.js';
import { addMedia } from '../media.js';
import { sections, candidates, rangeText, renderCandidate, buildAssigned, CATS, STEM_NAMES } from './midiconvert.js';

// the window's pages, one at a time: a finished page slides away and is reached again only with 뒤로
const STEPS = [['file', '파일'], ['options', '분리 방식'], ['run', '분리'], ['result', '결과'], ['midi', 'MIDI 변환']];

const PC = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export class AiSheet {
  constructor(studio) {
    this.S = studio;
    this.file = null;      // { name, data }
    this.busy = null;      // 'decode' | 'stems' | 'analyse' | 'build' | 'setup'
    this.progress = 0;
    this.el = h('section', { id: 'aisheet', class: 'sheet', hidden: true },
      h('div', { class: 'sheet-card ai-card' },
        h('div', { class: 'sheet-head' }, h('h2', {}, 'AI로 음원 분리 · MIDI 변환'), h('button', { class: 'x', 'aria-label': '닫기', onclick: () => this.close() })),
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
    window.melofi.onStemsProgress((m) => {
      if (typeof m.p === 'number') { this.progress = m.p; if (this.barEl) this.barEl.style.width = `${Math.round(m.p * 100)}%`; }
      if (m.label && m.label !== this.stemLabel) this.stage = null; // a new stage starts empty
      if (typeof m.stage === 'number') this.stage = m.stage;
      if (m.label) this.stemLabel = m.label;
      this.paintBars();
      if (m.detail) this.stemDetail = m.detail;
      if (typeof m.warn === 'string' && m.warn !== this.warn) { this.warn = m.warn; if (!this.el.hidden) this.render(); }
      this.renderProgress();
    });
    this.stems = null;       // the engine's result for the current file
    this.useAudio = true;    // separated tracks as audio clips
    this.mus = studio.app.settings.get('stemsMuscriptor') || 'off'; // MuScriptor model size or 'off'
    this.useMidi = true;     // transcribed notes as MIDI channels
    this.sepMode = 'full';   // full | fast (no drum split, no lead / backing split)
    this.log = [];           // the engine's log lines, shown live under the progress bar
    this.step = 'file';      // the page shown (STEPS)
    window.melofi.onStemsLog((t) => this.addLog(t));
  }

  async show() {
    this.S.app.ui.close();
    this.el.hidden = false;
    this.engine = await window.melofi.stemsStatus();
    if (!this.busy) this.step = this.stems ? (this.step === 'midi' ? 'midi' : 'result') : this.audio && this.engine.ready ? 'options' : 'file';
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
    if (this.engine.ready && this.audio) this.step = 'options';
    this.render();
  }

  async pick() {
    const list = await window.melofi.mediaPickFiles({ video: true });
    if (list[0]) this.load(list[0]);
  }

  // 1) the file: read and decoded (for its length and the time estimate), nothing is analysed yet
  async load(file) {
    this.seq = (this.seq || 0) + 1;
    this.file = file; this.error = null; this.stems = null; this.plan = null; this.choice = null; this.stopPreview();
    this.busy = 'decode'; this.render();
    try {
      const ctx = new OfflineAudioContext(1, 1, 22050);
      const buf = await ctx.decodeAudioData(file.data.buffer.slice(file.data.byteOffset, file.data.byteOffset + file.data.byteLength));
      const n = buf.length, mono = new Float32Array(n);
      for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) mono[i] += d[i] / buf.numberOfChannels; }
      this.audio = { mono, rate: buf.sampleRate, duration: buf.duration };
      if (this.engine?.ready) this.step = 'options';
    } catch (err) {
      this.file = null;
      this.error = '이 파일에서 오디오를 불러올 수 없습니다. WAV, MP3, MP4(AAC) 파일을 사용해 보세요.';
    }
    this.busy = null;
    this.render();
  }

  // 3) the separation, the way it was chosen in step 2
  async analyse() {
    if (!this.audio || this.busy || !this.engine?.ready) return;
    const seq = this.seq = (this.seq || 0) + 1;
    const stale = () => seq !== this.seq;
    const file = this.file;
    this.error = null; this.stems = null; this.plan = null; this.choice = null; this.stopPreview();
    this.log = []; this.t0 = Date.now();
    try {
      await this.checkGpu();
      const g = this.gpuInfo?.gpu;
      this.addLog(g ? `GPU: ${g.name} · 여유 메모리 ${(g.freeMB / 1024).toFixed(1)} GB · 사용률 ${g.util}%` : 'GPU: 없음 (CPU로 처리)');
      this.busy = 'stems'; this.progress = 0; this.stemLabel = '분리를 시작하는 중…'; this.stemDetail = ''; this.step = 'run'; this.render();
      this.addLog(`분리 시작: ${file.name} · 분리 ${this.sepMode === 'fast' ? '빠르게' : '전체'} · 채보 ${this.mus === 'off' ? 'Basic Pitch' : `MuScriptor ${this.mus}`}`);
      const r = await window.melofi.stemsRun({ name: file.name, data: file.data, quick: this.sepMode === 'fast', muscriptor: this.engine.hfToken ? this.mus : 'off' });
      if (stale()) return;
      if (!r.ok) throw new Error(r.message);
      if (r.cached) this.addLog('저장된 결과를 다시 썼어요 (분리·박자는 건너뜀).');
      this.stems = r.result;
      this.addLog(`끝: ${Math.round((Date.now() - this.t0) / 1000)}초`);
      this.step = 'result';
    } catch (err) {
      if (stale()) return;
      this.error = `분리하지 못했습니다: ${err.message}`;
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

  // ---------- stems ----------
  async preview(id, file, at = null) {
    if (this.playing === id) return this.stopPreview();
    this.stopPreview();
    const bytes = await window.melofi.stemsRead(file);
    if (!bytes) return;
    const url = URL.createObjectURL(new Blob([bytes], { type: /\.flac$/i.test(file) ? 'audio/flac' : 'audio/wav' }));
    const a = new Audio(url);
    a.currentTime = Math.max(0, at ?? (this.stems?.first_downbeat || 0));
    a.onended = () => this.stopPreview();
    a.play();
    this.audioEl = a; this.audioUrl = url; this.playing = id;
    this.render();
  }

  stopPreview() {
    if (this.audioEl) { this.audioEl.pause(); URL.revokeObjectURL(this.audioUrl); }
    if (this.srcEl) { try { this.srcEl.stop(); } catch { /* ended */ } this.srcEl = null; }
    this.audioEl = null; this.playing = null;
    if (!this.el.hidden) this.render();
  }

  // ---------- stems -> MIDI with an instrument per section ----------
  get cacheDir() { const f = Object.values(this.stems?.stems || {})[0]; return f ? f.replace(/[\\/]stems[\\/][^\\/]+$/, '') : null; }

  async addInstruments() {
    this.busy = 'stems'; this.progress = 0; this.stemLabel = '악기 인식 구성 요소 설치 중…'; this.render();
    const r = await window.melofi.stemsAddInstruments();
    this.busy = null;
    if (!r.ok) this.error = r.message;
    this.engine = await window.melofi.stemsStatus();
    this.render();
  }

  async recognize() {
    this.busy = 'analyse'; this.progress = 0; this.stage = null; this.stemLabel = '악기를 알아보는 중…'; this.error = null;
    this.addLog('악기 인식 시작 (AST · AudioSet)');
    this.render();
    const r = await window.melofi.stemsInstruments(this.cacheDir);
    this.busy = null;
    if (!r.ok) { this.error = r.message; this.render(); return; }
    this.inst = r.result;
    this.plan = sections(this.stems, this.inst);
    // the recommended instrument for every group, unless the user picked one already
    this.choice ||= {};
    for (const [k, groups] of Object.entries(this.plan.stems)) for (const g of groups) {
      const key = `${k}:${g.cat}`;
      // a stem with only a handful of notes is bleed from the others: left out unless picked
      if (!(key in this.choice)) this.choice[key] = g.thin ? null : candidates(this.S, k, g)[0]?.id || null;
    }
    this.addLog(`악기 인식 끝: ${Object.entries(this.plan.stems).map(([k, gs]) => `${STEM_NAMES[k]} ${gs.map((g) => CATS[g.label][0]).join('/')}`).join(', ')}`);
    this.render();
  }

  // the stem itself from the start of the group's first section
  async previewOriginal(k, g) {
    const id = `o-${k}-${g.cat}`;
    if (this.playing === id) return this.stopPreview();
    await this.preview(id, this.stems.stems[k], this.plan.bars[g.secs[0].start]);
  }

  async previewCandidate(k, g) {
    const instId = this.choice[`${k}:${g.cat}`], id = `c-${k}-${g.cat}`;
    if (!instId) return;
    if (this.playing === id) return this.stopPreview();
    this.stopPreview();
    this.playing = id; this.render();
    try {
      const mix = await renderCandidate(this.S, this.stems, k, g, instId, this.plan.bars);
      if (this.playing !== id) return;
      const c = this.S.app.engine.ctx, b = c.createBuffer(2, mix.left.length, mix.rate);
      b.copyToChannel(mix.left, 0); b.copyToChannel(mix.right, 1);
      const src = c.createBufferSource(); src.buffer = b; src.connect(c.destination); src.start();
      src.onended = () => { if (this.playing === id) this.stopPreview(); };
      this.srcEl = src;
    } catch (err) { this.error = `들어보지 못했어요: ${err.message}`; this.playing = null; this.render(); }
  }

  async buildMidi() {
    const S = this.S;
    this.busy = 'build'; this.render();
    try {
      // chosen instruments that are not downloaded yet come down first
      const want = [...new Set(Object.values(this.choice).filter(Boolean))].filter((id) => { const m = S.app.instruments.find((i) => i.id === id); return m && !m.installed && m.downloadable; });
      for (const [i, id] of want.entries()) {
        this.stemLabel = `악기 받는 중… ${S.instName(id)} (${i + 1}/${want.length})`; this.renderProgress?.();
        await S.app.downloadInstrument(id, { quiet: true });
      }
      const proj = await buildAssigned(this.stems, this.plan, this.choice, this.file.name, S, { audio: this.keepAudio !== false });
      S.setProject(proj);
      S.setTab('playlist');
      this.close();
      S.app.ui.toast('악기를 지정해 MIDI로 바꾼 프로젝트를 만들었습니다');
    } catch (err) { this.error = `MIDI 프로젝트를 만들지 못했습니다: ${err.message}`; }
    this.busy = null; this.render();
  }

  midiView() {
    const eng = this.engine || {};
    const head = h('b', {}, 'MIDI로 변환 · 악기 자동 지정');
    if (!eng.instruments) {
      return h('div', { class: 'ai-step' }, head,
        h('p', {}, '분리한 트랙을 구간별로 듣고 어울리는 악기를 골라 MIDI로 바꿔요. 먼저 악기 인식 구성 요소가 필요해요 (약 10MB, 처음 실행할 때 모델 약 350MB를 내려받아요).'),
        h('div', { class: 'row' }, h('span', { class: 'sp' }), h('button', { class: 'btn', disabled: !!this.busy, onclick: () => this.addInstruments() }, '악기 인식 설치')));
    }
    if (!this.plan) {
      return h('div', { class: 'ai-step' }, head,
        h('p', {}, '트랙마다 2초 간격으로 어떤 악기 소리인지 알아본 뒤, 마디 단위 구간으로 나눠 MeloFi 악기 후보를 보여 드려요. GPU로 곡 하나에 1~2분 걸려요.'),
        h('div', { class: 'row' }, h('span', { class: 'sp' }), h('button', { class: 'btn primary', disabled: !!this.busy, onclick: () => this.recognize() }, '악기 알아보기')));
    }
    const rows = [];
    for (const [k, groups] of Object.entries(this.plan.stems)) {
      rows.push(h('div', { class: 'mc-stem' }, STEM_NAMES[k] || k));
      for (const g of groups) {
        const key = `${k}:${g.cat}`, cands = candidates(this.S, k, g), cur = this.choice[key];
        const sel = h('select', { class: 'mc-sel', onchange: (e) => { this.choice[key] = e.target.value || null; if (this.playing?.startsWith('c-')) this.stopPreview(); else this.render(); } },
          ...cands.map((c, i) => h('option', { value: c.id, selected: c.id === cur }, `${c.recommended ? '★ 추천 · ' : ''}${c.name}${i === 0 || cands[i - 1].cat !== c.cat ? ` — ${CATS[c.cat][0]} ${Math.round(c.share * 100)}%` : ''}${c.installed ? '' : c.downloadable ? ' (받기)' : ''}`)),
          h('option', { value: '', selected: !cur }, '넣지 않음'));
        const oId = `o-${k}-${g.cat}`, cId = `c-${k}-${g.cat}`;
        rows.push(h('div', { class: `mc-row${g.thin ? ' thin' : ''}`, title: g.thin ? `음표가 ${g.notes}개뿐이에요: 다른 악기에서 새어 든 소리일 가능성이 커서 기본은 빼 두었어요` : '' },
          h('span', { class: 'mc-cat' }, CATS[g.label][0], g.thin ? h('small', {}, ` · 음표 ${g.notes}`) : null),
          h('span', { class: 'mc-range', title: rangeText(g.secs) }, rangeText(g.secs)),
          sel,
          h('button', { class: `btn sm ghost${this.playing === oId ? ' on' : ''}`, title: '분리한 원음 듣기', onclick: () => this.previewOriginal(k, g) }, this.playing === oId ? '■ 원음' : '▶ 원음'),
          h('button', { class: `btn sm ghost${this.playing === cId ? ' on' : ''}`, disabled: !cur, title: '고른 악기로 이 구간의 음표 듣기 (8초)', onclick: () => this.previewCandidate(k, g) }, this.playing === cId ? '■ 악기' : '▶ 악기')));
      }
    }
    return h('div', { class: 'ai-step' }, head,
      h('p', { class: 'dim' }, '구간마다 알아본 악기와 MeloFi 후보예요. ★ 추천이 처음부터 골라져 있어요. 원음과 후보를 들어 보고 바꿔 주세요.'),
      h('div', { class: 'mc-table' }, ...rows),
      h('div', { class: 'row' },
        h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: this.keepAudio !== false, onchange: (e) => { this.keepAudio = e.target.checked; } }), ' 분리한 원음도 넣기 (음소거, 비교용)'),
        h('span', { class: 'sp' }),
        h('button', { class: 'btn', disabled: !!this.busy, title: '악기를 다시 알아봐요', onclick: () => { this.plan = null; this.render(); } }, '다시 알아보기'),
        h('button', { class: 'btn primary', disabled: !!this.busy || !Object.values(this.choice).some(Boolean), onclick: () => this.buildMidi() }, '이 악기들로 MIDI 프로젝트 만들기')));
  }

  // ---------- saving the separated tracks (right-click a track) ----------
  // fmt: 'flac' (the separated file itself) | 'wav24' | 'wav16' | 'mp3'
  async stemFile(file, fmt) {
    const bytes = await window.melofi.stemsRead(file);
    if (!bytes) throw new Error('파일을 찾지 못했어요');
    const ext0 = (file.match(/\.([a-z0-9]+)$/i)?.[1] || 'flac').toLowerCase();
    if (fmt === 'flac' && ext0 === 'flac') return { ext: 'flac', data: bytes };
    // decoded at the file's own rate (the stems are 44.1 kHz), so nothing is resampled
    const probe = await new OfflineAudioContext(2, 1, 44100).decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const L = probe.getChannelData(0), R = probe.numberOfChannels > 1 ? probe.getChannelData(1) : L;
    return encode({ left: L, right: R, rate: probe.sampleRate }, fmt === 'flac' ? 'flac24' : fmt, 'tpdf');
  }

  // list: [[label, file]]; one file is saved as is, several go into a folder of their own
  async saveStems(list, fmt) {
    const song = (this.file?.name || '곡').replace(/\.[^.]+$/, '');
    const fmtName = { flac: 'FLAC', wav24: 'WAV 24비트', wav16: 'WAV 16비트', mp3: 'MP3' }[fmt];
    const toast = (t, o) => this.S.app.ui.toast(t, o);
    toast(`${list.length > 1 ? `트랙 ${list.length}개를` : `${list[0][0]}을(를)`} ${fmtName}로 저장하는 중…`, { ms: 2500 });
    try {
      const files = [];
      for (const [i, [label, file]] of list.entries()) {
        const { ext, data } = await this.stemFile(file, fmt);
        files.push({ ext, data, name: `${String(i + 1).padStart(2, '0')} ${label}`, suffix: ` - ${label}` });
      }
      const saved = await window.melofi.saveRecording({ dir: this.S.app.settings.get('recDir'), base: list.length > 1 ? `${song} (분리)` : song, files });
      const where = saved.files[0];
      toast(list.length > 1 ? `분리한 트랙 ${files.length}개를 저장했어요` : `${list[0][0]} 저장됨`, { path: where, action: { label: '폴더 열기', fn: () => window.melofi.showItem(where) } });
    } catch (err) {
      toast(`저장하지 못했어요: ${err.message}`);
    }
  }

  stemMenu(e, label, file, all) {
    e.preventDefault();
    popup(e.clientX, e.clientY, [
      { group: label },
      { label: '▶ 들어보기', act: () => this.preview(`m-${file}`, file) },
      { sep: true },
      { label: 'FLAC으로 저장 (분리한 원본 그대로)', act: () => this.saveStems([[label, file]], 'flac') },
      { label: 'WAV 24비트로 저장', act: () => this.saveStems([[label, file]], 'wav24') },
      { label: 'WAV 16비트로 저장 (CD)', act: () => this.saveStems([[label, file]], 'wav16') },
      { label: 'MP3로 저장 (320kbps)', act: () => this.saveStems([[label, file]], 'mp3') },
      { sep: true },
      { label: `분리한 트랙 모두 FLAC으로 저장 (${all.length}개)`, act: () => this.saveStems(all, 'flac') },
      { label: `분리한 트랙 모두 WAV 24비트로 저장`, act: () => this.saveStems(all, 'wav24') },
    ]);
  }

  async openStems() {
    const S = this.S;
    this.busy = 'build'; this.render();
    try {
      const proj = await fromStems(this.stems, null, this.file.name, S, { audio: this.useAudio, midi: this.useMidi });
      S.setProject(proj);
      S.setTab('playlist');
      this.close();
      S.app.ui.toast('분리한 트랙으로 프로젝트를 만들었습니다');
    } catch (err) { this.error = `프로젝트를 만들지 못했습니다: ${err.message}`; }
    this.busy = null; this.render();
  }

  // ---------- UI ----------
  renderProgress() {
    if (this.progEl) {
      this.progEl.textContent = this.busy === 'stems' || this.busy === 'setup' ? `${this.stemLabel || ''} ${Math.round(this.progress * 100)}%${this.stemDetail && this.busy === 'setup' ? ` · ${this.stemDetail}` : ''}`
        : this.busy === 'build' ? '트랙을 만드는 중…'
        : this.busy === 'decode' ? '파일을 읽는 중…'
        : this.busy === 'analyse' ? `${this.stemLabel || '분석 중…'} ${Math.round(this.progress * 100)}%` : '';
    }
  }

  // the page before this one (the run page is skipped: it is only a progress view)
  back() {
    if (this.busy) return;
    const to = { options: 'file', run: 'options', result: 'options', midi: 'result' }[this.step];
    if (!to) return;
    this.stopPreview(); this.error = null; this.step = to; this.render();
  }

  render() {
    if (this.el.hidden) return;
    const at = STEPS.findIndex(([k]) => k === this.step);
    const head = h('div', { class: 'ai-wiz' },
      h('button', { class: 'btn sm ghost ai-back', disabled: at === 0 || !!this.busy, onclick: () => this.back() }, '← 뒤로'),
      h('ol', { class: 'ai-steps' }, ...STEPS.map(([k, label], i) => h('li', { class: i === at ? 'on' : i < at ? 'done' : '' }, h('i', {}, i < at ? '✓' : String(i + 1)), label))));
    const page = this.step === 'file' ? this.fileView() : this.step === 'options' ? this.optionsView() : this.step === 'run' ? this.runView()
      : this.step === 'result' ? this.stemsView() : this.midiView();
    const parts = [head, page];
    // busy on another page than the run page (installing, recognising instruments): progress under it
    if (this.busy && this.step !== 'run') parts.push(this.busyView());
    if (this.error) parts.push(h('p', { class: 'cl-msg err' }, this.error));
    this.body.replaceChildren(...parts);
    this.renderProgress();
    this.paintBars();
  }

  fileView() {
    const eng = this.engine || {};
    return h('div', { class: 'ai-step' },
      h('b', {}, '파일 고르기'),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', disabled: !!this.busy, onclick: () => this.pick() }, this.file ? '다른 파일…' : '파일 고르기…'),
        h('span', { class: 'dim' }, this.file ? this.file.name : 'WAV·MP3·FLAC·MP4·MOV 파일을 선택하거나 이 창으로 드래그하세요.')),
      this.file && eng.ready ? h('div', { class: 'row' }, h('span', { class: 'sp' }), h('button', { class: 'btn', disabled: !!this.busy || !this.audio, onclick: () => { this.step = 'options'; this.render(); } }, '다음 →')) : null,
      // the separation engine: open-source models on this computer
      !eng.ready ? h('div', { class: 'ai-engine' },
        h('b', {}, '분리 엔진 설치'),
        h('p', { class: 'dim' }, `악기별 음원 분리(BS-RoFormer · BS-RoFormer SW 6-stem · DrumSep), 박자 분석(Beat This!), 채보(Basic Pitch)를 이 컴퓨터에서 실행합니다. 처음 한 번 약 3 GB를 받습니다${eng.gpu ? '. NVIDIA GPU로 빠르게 처리해요.' : '. GPU가 없으면 한 곡에 몇 분 걸려요.'}`),
        eng.reason ? h('p', { class: 'cl-msg err' }, `엔진을 쓸 수 없는 이유: ${eng.reason}`) : null,
        h('div', { class: 'row' }, h('button', { class: 'btn', disabled: !!this.busy, onclick: () => this.setupEngine() }, '엔진 설치'),
          h('button', { class: 'btn sm ghost', disabled: !!this.busy, onclick: async () => { this.engine = await window.melofi.stemsStatus(); if (this.engine.ready && this.audio) this.step = 'options'; this.render(); } }, '다시 확인'))) : null);
  }

  busyView() {
    return h('div', { class: 'ai-busy' },
      h('div', { class: 'row' }, this.progEl = h('span', {}),
        this.busy === 'stems' ? h('button', { class: 'btn sm ghost', onclick: () => { window.melofi.stemsCancel(); this.addLog('취소를 요청했어요.'); } }, '취소') : null),
      ['stems', 'analyse', 'setup'].includes(this.busy) ? h('div', { class: 'ai-bars' },
        h('div', { class: 'ai-barrow' }, h('span', {}, '현재 단계'), h('div', { class: 'ai-bar stage' }, this.stageEl = h('i')), this.stagePct = h('em')),
        h('div', { class: 'ai-barrow' }, h('span', {}, '전체'), h('div', { class: 'ai-bar' }, this.barEl = h('i')), this.allPct = h('em'))) : null);
  }

  // the separation running: progress and the engine's live log
  runView() {
    const log = h('pre', { class: 'ai-log tall' }, this.log.join('\n'));
    this.logEl = log;
    requestAnimationFrame(() => { if (this.logEl) this.logEl.scrollTop = this.logEl.scrollHeight; });
    return h('div', { class: 'ai-step' },
      h('b', {}, this.busy ? `분리하는 중 · ${this.file?.name || ''}` : this.error ? '분리하지 못했어요' : '분리'),
      this.busy ? this.busyView() : null,
      this.busy && this.warn ? h('div', { class: 'ai-gpu bad' }, h('span', { class: 'err' }, this.warn)) : null,
      log);
  }

  // MuScriptor (Kyutai · Mirelo): transcribes the whole mix into ~35 instrument classes. Its model
  // weights are CC BY-NC 4.0, so it is opt-in, labelled non-commercial everywhere it shows, and its
  // weights download only with the user's own HuggingFace token.
  // 2) how to analyse: chosen up front from drop-downs, then 3) start
  optionsView() {
    const eng = this.engine || {};
    const engine = !!eng.ready;
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
    const est = !dur || !engine ? '' : `분리 ${fmtT(sep)} · 박자 ${fmtT(dur * PER.beats * slow)} · 채보 ${fmtT(tr)} → 약 ${fmtT(sep + tr + dur * PER.beats * slow)}`;
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
      h('b', {}, '분리 방식'),
      h('div', { class: 'ai-opts' },
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
        h('button', { class: 'btn primary', disabled: !this.audio || !!this.busy || !engine || needToken || short, onclick: () => this.analyse() }, this.stems ? '이 방식으로 다시 분리 →' : '분리 시작 →'),
        // after an analysis: another transcription only redoes the transcription (separation kept)
        engine && done !== null && done !== this.mus && !needToken ? h('button', { class: 'btn', disabled: !!this.busy, onclick: () => this.retranscribe() }, this.mus === 'off' ? 'Basic Pitch 결과로 보기' : `채보만 MuScriptor ${this.mus}로 다시`) : null,
        h('span', { class: 'dim' }, !engine ? '먼저 분리 엔진을 설치해 주세요.' : !this.audio ? '먼저 파일을 골라 주세요.' : `${this.file.name} · ${Math.floor(dur / 60)}분 ${Math.round(dur % 60)}초 · 예상 ${est}`)));
  }

  async retranscribe() {
    if (!this.file || this.busy) return;
    const seq = this.seq;
    this.log = []; this.t0 = Date.now();
    this.busy = 'stems'; this.progress = 0; this.stemLabel = '채보를 준비하는 중…'; this.error = null; this.step = 'run'; this.render();
    this.addLog(`채보만 다시: ${this.mus === 'off' ? 'Basic Pitch' : `MuScriptor ${this.mus}`} (분리·박자 결과는 그대로)`);
    const r = await window.melofi.stemsRun({ name: this.file.name, data: this.file.data, quick: this.sepMode === 'fast', muscriptor: this.mus });
    if (seq !== this.seq) return;
    this.busy = null;
    if (!r.ok) this.error = r.message; else { this.stems = r.result; this.plan = null; this.choice = null; this.step = 'result'; }
    this.render();
  }

  stemsView() {
    const r = this.stems;
    const NAMES = { vocals: '리드 보컬', backing: '코러스', drums: '드럼', bass: '베이스', guitar: '기타', piano: '피아노', other: '그 밖의 악기' };
    const DRUMS = { kick: '킥', snare: '스네어', toms: '탐', hh: '하이햇', ride: '라이드', crash: '크래시' };
    const noteCount = (k) => r.notes?.[k]?.length || 0;
    // every separated file, for "save all": the stems, then the drum parts
    const allFiles = [...['vocals', 'backing', 'drums', 'bass', 'guitar', 'piano', 'other'].filter((k) => r.stems[k]).map((k) => [NAMES[k] || k, r.stems[k]]),
      ...Object.entries(r.drum_parts || {}).map(([k, f]) => [`드럼 ${DRUMS[k] || k}`, f])];
    const chip = (id, name, file, sub) => h('button', { class: `ai-stem${this.playing === id ? ' on' : ''}`, title: '눌러서 들어보기 · 우클릭: 저장', onclick: () => this.preview(id, file),
      oncontextmenu: (e) => this.stemMenu(e, id.startsWith('d-') ? `드럼 ${name}` : name, file, allFiles) },
      h('i', {}, this.playing === id ? '■' : '▶'), h('span', {}, name), sub ? h('small', {}, sub) : null);
    const order = ['vocals', 'backing', 'drums', 'bass', 'guitar', 'piano', 'other'].filter((k) => r.stems[k]);
    const t = r.times?.total;
    return h('div', { class: 'ai-step' },
      h('b', {}, '악기별 분리 · 박자 · 채보'),
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
        h('button', { class: 'btn', disabled: !!this.busy || (!this.useAudio && !this.useMidi), onclick: () => this.openStems() }, '분리한 트랙으로 프로젝트 만들기'),
        h('button', { class: 'btn primary', disabled: !!this.busy, title: '구간마다 악기를 골라 MIDI로 바꾸기', onclick: () => { this.stopPreview(); this.step = 'midi'; this.render(); } }, 'MIDI로 변환 →')),
      h('p', { class: 'dim' }, `트랙을 우클릭하면 파일로 저장할 수 있어요 (FLAC · WAV · MP3). 오디오와 MIDI를 함께 넣으면 MIDI 채널은 음소거된 상태로 들어가요. 분리: ${r.models.vocals} · ${r.models.instruments}${r.models.drum_parts ? ` · ${r.models.drum_parts}` : ''} / 박자: ${r.models.beats} / 채보: ${r.models.notes}`));
  }
}

const fact = (k, v) => h('span', { class: 'ai-fact' }, h('small', {}, k), h('b', {}, v));

const pickInst = (S, want, fallback) => {
  const list = S.app.instruments;
  return (list.find((i) => i.id === want && i.installed) || list.find((i) => i.id === fallback && i.installed) || list.find((i) => i.installed))?.id || 'splendid';
};

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
    // one straight line through the downbeats: a steady song keeps one tempo; the beat tracker's
    // ~20 ms wobble per bar is not a tempo change
    const n = db.length, xm = (n - 1) / 2, ym = db.reduce((a, t) => a + t, 0) / n;
    let sxy = 0, sxx = 0; db.forEach((t, i) => { sxy += (i - xm) * (t - ym); sxx += (i - xm) ** 2; });
    const barSec = sxy / sxx, worst = Math.max(...db.map((t, i) => Math.abs(t - (ym + (i - xm) * barSec))));
    if (worst < Math.min(0.06, barSec * 0.04)) p.bpm = Math.round(((60 * p.sig[0]) / barSec) * 100) / 100;
    else {
      // a real drift (a live band): tempo per bar, smoothed over 5 bars so the wobble stays out
      const raw = db.slice(1).map((t, i) => t - db[i]);
      const sm = raw.map((_, i) => { const w = raw.slice(Math.max(0, i - 2), i + 3).sort((x, y) => x - y); return w[w.length >> 1]; });
      const bars = sm.map((d) => (60 * p.sig[0]) / d);
      p.bpm = Math.round(bars[0] * 100) / 100;
      p.tempos = bars.slice(1).map((bpm, i) => ({ bar: i + 1, bpm: Math.round(bpm * 10) / 10 })).filter((x, i, a) => i === 0 || Math.abs(x.bpm - a[i - 1].bpm) > 0.3);
    }
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
  void f; void secPerBar;
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
