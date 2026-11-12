// "AI로 음원 분리": open an audio or video file and split it into instrument stems with the analysis
// engine (stems.js: open-source models run on this computer): BS-RoFormer separation, Beat This!
// beats / tempo, Basic Pitch (or MuScriptor) notes. Then a project from the separated tracks, or the
// stems turned into MIDI with an instrument chosen for each section (midiconvert.js).
import { h, popup } from './dom.js';
import { encode } from '../export-audio.js';
import { newProject, newChannel, newPattern, newTrack, uid, STEP, secToTick, barTicks, PPQ } from '../model.js';
import { addMedia } from '../media.js';
import { sections, candidates, rangeText, renderCandidate, buildAssigned, matchAll, candKind, CATS, STEM_NAMES } from './midiconvert.js';
import { t, tc, N_, tdyn } from '../../i18n/i18n.js';

// the window's pages, one at a time: a finished page slides away and is reached again only with 뒤로
const STEPS = [['file', N_('파일')], ['options', N_('분리 방식')], ['run', N_('분리')], ['result', N_('결과')], ['midi', N_('MIDI 변환')]];

// a measured sound in words (timbre.describe), for the parts MeloFi has no close match for
function soundText(d) {
  if (!d) return '';
  const shape = d.attack > 0.06 ? t('천천히 부풀며 시작하는 소리(현·관악기·패드 계열)') : d.shape === 'sustained' ? t('길게 이어지는 소리') : t('뜯거나 두드려 잦아드는 소리');
  const colour = d.colour.startsWith('bright') ? t('밝고 배음이 많아요') : d.colour.startsWith('dark') ? t('어둡고 배음이 적어요') : t('밝기는 중간이에요');
  return `${shape}, ${colour}${d.breath.startsWith('noisy') ? t(', 숨 · 활 · 찌그러짐 같은 잡음이 섞여 있어요') : ''}${d.hollow ? t(', 홀수 배음 위주의 속 빈 소리예요') : ''}.`;
}

const PC = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export class AiSheet {
  constructor(studio) {
    this.S = studio;
    this.file = null;      // { name, data }
    this.busy = null;      // 'decode' | 'stems' | 'analyse' | 'build' | 'setup'
    this.progress = 0;
    this.el = h('section', { id: 'aisheet', class: 'sheet', hidden: true },
      h('div', { class: 'sheet-card ai-card' },
        h('div', { class: 'sheet-head' }, h('h2', {}, t('AI로 음원 분리 · MIDI 변환')), h('button', { class: 'x', 'aria-label': t('닫기'), onclick: () => this.close() })),
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

  // mode: install | reinstall (start over; the old engine stays until the new one passes) | update
  async setupEngine(mode = 'install') {
    if (this.busy) return;
    if (mode === 'reinstall' && !confirm(t('분석 엔진을 처음부터 다시 설치할까요? 약 3 GB를 다시 받아요. 받아 둔 모델과 토큰은 그대로 두고, 새 엔진이 점검을 통과할 때까지 지금 엔진도 지우지 않아요.'))) return;
    this.busy = 'setup'; this.progress = 0; this.stage = null; this.stemLabel = t('설치를 준비하는 중…'); this.stemDetail = ''; this.error = null;
    this.log = []; this.t0 = Date.now(); this.render();
    const r = await window.melofi.stemsSetup({ mode });
    this.busy = null;
    if (!r.ok) this.error = r.message;
    else this.addLog(t('완료 · 단계별 시간(초): {list}', { list: Object.entries(r.times || {}).map(([k, v]) => `${k} ${v}`).join(', ') }));
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
      // separated before (either way of separating): straight to its result
      const hit = await window.melofi.stemsCached({ data: file.data, quick: this.sepMode === 'fast', muscriptor: this.mus })
        || await window.melofi.stemsCached({ data: file.data, quick: this.sepMode !== 'fast', muscriptor: this.mus });
      if (hit && this.file === file) {
        this.stems = hit.result; this.fromCache = hit.muscriptor;
        this.log = []; this.t0 = Date.now();
        this.addLog(t('이 곡은 전에 분리해 둔 결과가 있어서 바로 불러왔어요 (채보: {how}). 다시 분리하려면 뒤로 가서 분리 방식을 고르세요.', { how: hit.muscriptor === 'off' ? 'Basic Pitch' : `MuScriptor ${hit.muscriptor}` }));
        this.step = 'result';
      }
    } catch (err) {
      this.file = null;
      this.error = t('이 파일에서 오디오를 불러올 수 없습니다. WAV, MP3, MP4(AAC) 파일을 사용해 보세요.');
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
    this.error = null; this.stems = null; this.plan = null; this.choice = null; this.fromCache = null; this.stopPreview();
    this.log = []; this.t0 = Date.now();
    try {
      await this.checkGpu();
      const g = this.gpuInfo?.gpu;
      this.addLog(g ? t('GPU: {name} · 여유 메모리 {free} GB · 사용률 {util}%', { name: g.name, free: (g.freeMB / 1024).toFixed(1), util: g.util }) : t('GPU: 없음 (CPU로 처리)'));
      this.busy = 'stems'; this.progress = 0; this.stemLabel = t('분리를 시작하는 중…'); this.stemDetail = ''; this.step = 'run'; this.render();
      this.addLog(t('분리 시작: {file} · 분리 {sep} · 채보 {notes}', { file: file.name, sep: this.sepMode === 'fast' ? t('빠르게') : tc('sep', '전체'), notes: this.mus === 'off' ? 'Basic Pitch' : `MuScriptor ${this.mus}` }));
      const r = await window.melofi.stemsRun({ name: file.name, data: file.data, quick: this.sepMode === 'fast', muscriptor: this.engine.hfToken ? this.mus : 'off' });
      if (stale()) return;
      if (!r.ok) throw new Error(r.message);
      if (r.cached) this.addLog(t('저장된 결과를 다시 썼어요 (분리·박자는 건너뜀).'));
      this.stems = r.result;
      this.addLog(t('끝: {s}초', { s: Math.round((Date.now() - this.t0) / 1000) }));
      this.step = 'result';
    } catch (err) {
      if (stale()) return;
      this.error = t('분리하지 못했습니다: {why}', { why: tdyn(err.message) });
      this.addLog(t('오류: {why}', { why: tdyn(err.message) }));
    }
    this.busy = null;
    this.render();
  }

  // the two bars: the current stage (indeterminate when the stage reports no steps) and the whole run
  paintBars() {
    if (this.barEl) {
      const p = Math.max(0, Math.min(1, this.progress || 0)), pc = Math.round(p * 100);
      this.barEl.style.width = `${pc}%`;
      this.allPct.textContent = `${pc}%`;
      this.barEl.parentElement.setAttribute('aria-valuenow', pc);
      this.barEl.parentElement.classList.toggle('low', pc < 12); // the number sits outside the fill until it fits
      // elapsed and a rough time left from the pace so far (only once there is enough to go on)
      if (this.etaEl) {
        const sec = this.t0 ? (Date.now() - this.t0) / 1000 : 0, mmss = (x) => `${Math.floor(x / 60)}:${String(Math.round(x % 60)).padStart(2, '0')}`;
        this.etaEl.textContent = !sec ? '' : p > 0.05 && p < 0.995 ? t('{elapsed} 지남 · 약 {left} 남음', { elapsed: mmss(sec), left: mmss((sec * (1 - p)) / p) }) : t('{elapsed} 지남', { elapsed: mmss(sec) });
      }
    }
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
    this.busy = 'stems'; this.progress = 0; this.stemLabel = t('악기 인식 구성 요소 설치 중…'); this.render();
    const r = await window.melofi.stemsAddInstruments();
    this.busy = null;
    if (!r.ok) this.error = r.message;
    this.engine = await window.melofi.stemsStatus();
    this.render();
  }

  async recognize() {
    this.busy = 'analyse'; this.progress = 0; this.stage = null; this.stemLabel = t('악기를 알아보는 중…'); this.error = null;
    this.addLog(t('악기 인식 시작 (AST · AudioSet)'));
    this.render();
    const r = await window.melofi.stemsInstruments(this.cacheDir);
    this.busy = null;
    if (!r.ok) { this.error = r.message; this.render(); return; }
    this.inst = r.result;
    const plan = sections(this.stems, this.inst);
    // every section is compared with MeloFi's instruments and synth presets by ear (timbre.js):
    // the candidates play the section's own notes and are measured against the separated sound
    this.busy = 'analyse'; this.progress = 0; this.stemLabel = t('어울리는 악기를 찾는 중…'); this.render();
    this.addLog(t('음색 비교 시작: 구간마다 후보 악기가 같은 음표를 연주해 원음과 비교해요'));
    const t0 = performance.now();
    try {
      await matchAll(this.S, this.stems, plan, { onProgress: (p, label) => { this.progress = p; this.stemLabel = label ? t('음색 비교 중 · {what}', { what: label }) : t('음색 비교 중…'); this.renderProgress(); if (this.barEl) this.barEl.style.width = `${Math.round(p * 100)}%`; } });
    } catch (err) { this.addLog(t('음색 비교 실패: {why}', { why: err.message })); }
    this.busy = null;
    this.plan = plan;
    // the best match for every group, unless the user picked one already; stray parts stay out
    this.choice ||= {};
    for (const [k, groups] of Object.entries(this.plan.stems)) for (const g of groups) {
      const key = `${k}:${g.cat}`;
      if (!(key in this.choice)) this.choice[key] = g.stray ? null : candidates(this.S, k, g)[0]?.id || null;
    }
    const n = Object.values(this.plan.stems).flat().filter((g) => !g.stray).length;
    this.addLog(t('음색 비교 끝 ({s}초): 구간 {n}개, 90% 이상 {good}개', { s: Math.round((performance.now() - t0) / 1000), n, good: Object.values(this.plan.stems).flat().filter((g) => !g.stray && (g.match?.cands?.[0]?.acc || 0) >= 90).length }));
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
    this.playing = id; this.error = null; this.render();
    try {
      // an instrument not downloaded yet has no samples to play: fetch it first
      const meta = this.S.app.instruments.find((i) => i.id === instId);
      if (meta && !meta.installed) {
        if (!meta.downloadable) throw new Error(t('{name}은(는) 이 PC에 없어서 들어볼 수 없어요', { name: meta.name }));
        this.S.app.ui.toast(t('{name}을(를) 받는 중이에요. 받는 대로 들려드릴게요.', { name: meta.name }), { ms: 3000 });
        const r = await this.S.app.downloadInstrument(instId, { quiet: true });
        if (!r?.ok && !this.S.app.instruments.find((i) => i.id === instId)?.installed) throw new Error(t('{name}을(를) 받지 못했어요', { name: meta.name }));
        if (this.playing !== id) return;
        this.render(); // the "(받기)" mark goes
      }
      const mix = await renderCandidate(this.S, this.stems, k, g, instId, this.plan.bars);
      if (this.playing !== id) return;
      const c = this.S.app.engine.ctx, b = c.createBuffer(2, mix.left.length, mix.rate);
      b.copyToChannel(mix.left, 0); b.copyToChannel(mix.right, 1);
      const src = c.createBufferSource(); src.buffer = b; src.connect(c.destination); src.start();
      src.onended = () => { if (this.playing === id) this.stopPreview(); };
      this.srcEl = src;
    } catch (err) { this.error = t('들어보지 못했어요: {why}', { why: err.message }); this.playing = null; this.render(); }
  }

  async buildMidi() {
    const S = this.S;
    this.busy = 'build'; this.render();
    try {
      // chosen instruments that are not downloaded yet come down first
      const want = [...new Set(Object.values(this.choice).filter(Boolean))].filter((id) => { const m = S.app.instruments.find((i) => i.id === id); return m && !m.installed && m.downloadable; });
      for (const [i, id] of want.entries()) {
        this.stemLabel = t('악기 받는 중… {name} ({i}/{n})', { name: S.instName(id), i: i + 1, n: want.length }); this.renderProgress?.();
        await S.app.downloadInstrument(id, { quiet: true });
      }
      const proj = await buildAssigned(this.stems, this.plan, this.choice, this.file.name, S, { audio: this.keepAudio !== false });
      S.setProject(proj);
      S.setTab('playlist');
      this.close();
      S.app.ui.toast(t('악기를 지정해 MIDI로 바꾼 프로젝트를 만들었습니다'));
    } catch (err) { this.error = t('MIDI 프로젝트를 만들지 못했습니다: {why}', { why: err.message }); }
    this.busy = null; this.render();
  }

  midiView() {
    const eng = this.engine || {};
    const head = h('b', {}, t('MIDI로 변환 · 악기 자동 지정'));
    if (!eng.instruments) {
      return h('div', { class: 'ai-step' }, head,
        h('p', {}, t('분리한 트랙을 구간별로 듣고 어울리는 악기를 골라 MIDI로 바꿔요. 먼저 악기 인식 구성 요소가 필요해요 (약 10MB, 처음 실행할 때 모델 약 350MB를 내려받아요).')),
        h('div', { class: 'row' }, h('span', { class: 'sp' }), h('button', { class: 'btn', disabled: !!this.busy, onclick: () => this.addInstruments() }, t('악기 인식 설치'))));
    }
    if (!this.plan) {
      return h('div', { class: 'ai-step' }, head,
        h('p', {}, t('트랙마다 어떤 악기 소리인지 알아보고 마디 단위 구간으로 나눈 뒤, 구간마다 MeloFi 악기와 신스 프리셋으로 같은 음표를 연주해 원음과 음색을 비교해요. 곡 하나에 1~3분 걸려요.')),
        h('div', { class: 'row' }, h('span', { class: 'sp' }), h('button', { class: 'btn primary', disabled: !!this.busy, onclick: () => this.recognize() }, t('악기 알아보기'))));
    }
    const rows = [], strays = [], missing = [];
    const pct = (v) => `${Math.round(v)}%`;
    const row = (k, g, stray) => {
      const key = `${k}:${g.cat}`, cands = candidates(this.S, k, g), cur = this.choice[key], best = cands[0];
      const measured = best?.acc != null;
      const sel = h('select', { class: 'mc-sel', onchange: (e) => { this.choice[key] = e.target.value || null; if (this.playing?.startsWith('c-')) this.stopPreview(); else this.render(); } },
        ...cands.map((c, i) => h('option', { value: c.id, selected: c.id === cur },
          measured ? `${pct(c.acc)} · ${c.name} (${c.kind})${i === 0 ? ' ★' : ''}${c.installed ? '' : c.downloadable ? t(' · 받기') : ''}`
            : `${c.recommended ? t('★ 추천 · ') : ''}${c.name}${i === 0 || cands[i - 1].cat !== c.cat ? ` — ${t('{cat}: 인식 {n}%', { cat: t(CATS[c.cat][0]), n: Math.round(c.share * 100) })}` : ''}${c.installed ? '' : c.downloadable ? t(' (받기)') : ''}`)),
        h('option', { value: '', selected: !cur }, t('넣지 않음')));
      const pick = cands.find((c) => c.id === cur);
      const why = pick?.parts ? (pick.parts.n != null ? t('배음 {h} · 스펙트럼 {c} · 소리 모양 {e} · 잡음 {n}', { h: pct(pick.parts.h ?? 0), c: pct(pick.parts.c ?? 0), e: pct(pick.parts.e ?? 0), n: pct(pick.parts.n) }) : t('배음 {h} · 스펙트럼 {c} · 소리 모양 {e}', { h: pct(pick.parts.h ?? 0), c: pct(pick.parts.c ?? 0), e: pct(pick.parts.e ?? 0) })) : '';
      const oId = `o-${k}-${g.cat}`, cId = `c-${k}-${g.cat}`;
      const label = measured ? best.kind : t(CATS[g.label][0]);
      const tip = stray ? t('{why}: 다른 악기에서 새어 들어온 소리거나 잘못 알아본 것일 가능성이 커서 기본은 빼 두었어요', { why: g.heard <= 2 ? t('곡 전체에서 {n}번만 들려요', { n: g.heard }) : t('음표가 {n}개뿐이에요', { n: g.notes }) })
        : g.match?.vocal ? t('노래는 악기가 아니에요: 가사와 목소리는 보컬 합성으로 옮기는 게 맞아서 음색 비교를 하지 않았어요. 멜로디만 악기로 듣고 싶으면 골라 주세요')
        : g.match?.unmeasured ? t('이 구간은 음이 또렷하지 않아 음색을 재지 못했어요') : '';
      const el = h('div', { class: `mc-row${stray ? ' thin' : ''}`, title: tip },
        h('span', { class: 'mc-cat' }, stray ? `${tc('stem', STEM_NAMES[k])} · ` : '', label, stray ? h('small', {}, t(' · 음표 {n}', { n: g.notes })) : null),
        h('span', { class: 'mc-range', title: rangeText(g.secs) }, rangeText(g.secs)),
        sel,
        h('span', { class: `mc-acc${measured && best.acc >= 90 ? ' ok' : ''}`, title: why ? t('고른 악기와 원음의 닮은 정도: {why}', { why }) : '' }, pick?.acc != null ? pct(pick.acc) : '—'),
        h('button', { class: `btn sm ghost${this.playing === oId ? ' on' : ''}`, title: t('분리한 원음 듣기'), onclick: () => this.previewOriginal(k, g) }, this.playing === oId ? t('■ 원음') : t('▶ 원음')),
        h('button', { class: `btn sm ghost${this.playing === cId ? ' on' : ''}`, disabled: !cur, title: t('고른 악기로 이 구간의 음표 듣기 (8초)'), onclick: () => this.previewCandidate(k, g) }, this.playing === cId ? t('■ 악기') : t('▶ 악기')));
      if (!stray && measured && best.acc < 90) missing.push(h('li', {}, t('{stem} {range}: 가장 가까운 {name}도 {acc}. {sound}', { stem: tc('stem', STEM_NAMES[k]), range: rangeText(g.secs), name: best.name, acc: pct(best.acc), sound: soundText(g.match.desc) })));
      return el;
    };
    for (const [k, groups] of Object.entries(this.plan.stems)) {
      const valid = groups.filter((g) => !g.stray);
      if (valid.length) rows.push(h('div', { class: 'mc-stem' }, tc('stem', STEM_NAMES[k] || k)));
      for (const g of valid) rows.push(row(k, g, false));
      for (const g of groups.filter((x) => x.stray)) strays.push(row(k, g, true));
    }
    if (strays.length) rows.push(h('div', { class: 'mc-stem dim' }, t('한두 번만 들리는 소리 · 잡음이나 잘못 알아본 것일 수 있어요')), ...strays);
    return h('div', { class: 'ai-step' }, head,
      h('p', { class: 'dim' }, t('구간마다 MeloFi의 악기와 신스 프리셋이 그 구간의 음표를 직접 연주해 보고, 원음과 배음 · 스펙트럼 · 소리 모양(어택과 감쇠) · 잡음을 비교한 닮은 정도예요. 가장 닮은 것이 골라져 있어요. 원음과 들어 보고 바꿔 주세요.')),
      h('div', { class: 'mc-table' }, ...rows),
      missing.length ? h('details', { class: 'mc-missing' }, h('summary', {}, t('90%에 못 미친 구간 {n}개 · MeloFi에 아직 없는 악기일 수 있어요', { n: missing.length })), h('ul', {}, ...missing)) : null,
      h('div', { class: 'row' },
        h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: this.keepAudio !== false, onchange: (e) => { this.keepAudio = e.target.checked; } }), t(' 분리한 원음도 넣기 (음소거, 비교용)')),
        h('span', { class: 'sp' }),
        h('button', { class: 'btn', disabled: !!this.busy, title: t('악기를 다시 알아봐요'), onclick: () => { this.plan = null; this.render(); } }, t('다시 알아보기')),
        h('button', { class: 'btn primary', disabled: !!this.busy || !Object.values(this.choice).some(Boolean), onclick: () => this.buildMidi() }, t('이 악기들로 MIDI 프로젝트 만들기'))));
  }

  // ---------- saving the separated tracks (right-click a track) ----------
  // fmt: 'flac' (the separated file itself) | 'wav24' | 'wav16' | 'mp3'
  async stemFile(file, fmt) {
    const bytes = await window.melofi.stemsRead(file);
    if (!bytes) throw new Error(t('파일을 찾지 못했어요'));
    const ext0 = (file.match(/\.([a-z0-9]+)$/i)?.[1] || 'flac').toLowerCase();
    if (fmt === 'flac' && ext0 === 'flac') return { ext: 'flac', data: bytes };
    // decoded at the file's own rate (the stems are 44.1 kHz), so nothing is resampled
    const probe = await new OfflineAudioContext(2, 1, 44100).decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const L = probe.getChannelData(0), R = probe.numberOfChannels > 1 ? probe.getChannelData(1) : L;
    return encode({ left: L, right: R, rate: probe.sampleRate }, fmt === 'flac' ? 'flac24' : fmt, 'tpdf');
  }

  // list: [[label, file]]; one file is saved as is, several go into a folder of their own
  async saveStems(list, fmt) {
    const song = (this.file?.name || t('곡')).replace(/\.[^.]+$/, '');
    const fmtName = { flac: 'FLAC', wav24: t('WAV 24비트'), wav16: t('WAV 16비트'), mp3: 'MP3' }[fmt];
    const toast = (t, o) => this.S.app.ui.toast(t, o);
    toast(list.length > 1 ? t('트랙 {n}개를 {fmt}(으)로 저장하는 중…', { n: list.length, fmt: fmtName }) : t('{name}을(를) {fmt}(으)로 저장하는 중…', { name: list[0][0], fmt: fmtName }), { ms: 2500 });
    try {
      const files = [];
      for (const [i, [label, file]] of list.entries()) {
        const { ext, data } = await this.stemFile(file, fmt);
        files.push({ ext, data, name: `${String(i + 1).padStart(2, '0')} ${label}`, suffix: ` - ${label}` });
      }
      const saved = await window.melofi.saveRecording({ dir: this.S.app.settings.get('recDir'), base: list.length > 1 ? t('{name} (분리)', { name: song }) : song, files });
      const where = saved.files[0];
      toast(list.length > 1 ? t('분리한 트랙 {n}개를 저장했어요', { n: files.length }) : t('{name} 저장됨', { name: list[0][0] }), { path: where, action: { label: t('폴더 열기'), fn: () => window.melofi.showItem(where) } });
    } catch (err) {
      toast(t('저장하지 못했어요: {why}', { why: err.message }));
    }
  }

  stemMenu(e, label, file, all) {
    e.preventDefault();
    popup(e.clientX, e.clientY, [
      { group: label },
      { label: t('▶ 들어보기'), act: () => this.preview(`m-${file}`, file) },
      { sep: true },
      { label: t('FLAC으로 저장 (분리한 원본 그대로)'), act: () => this.saveStems([[label, file]], 'flac') },
      { label: t('WAV 24비트로 저장'), act: () => this.saveStems([[label, file]], 'wav24') },
      { label: t('WAV 16비트로 저장 (CD)'), act: () => this.saveStems([[label, file]], 'wav16') },
      { label: t('MP3로 저장 (320kbps)'), act: () => this.saveStems([[label, file]], 'mp3') },
      { sep: true },
      { label: t('분리한 트랙 모두 FLAC으로 저장 ({n}개)', { n: all.length }), act: () => this.saveStems(all, 'flac') },
      { label: t('분리한 트랙 모두 WAV 24비트로 저장'), act: () => this.saveStems(all, 'wav24') },
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
      S.app.ui.toast(t('분리한 트랙으로 프로젝트를 만들었습니다'));
    } catch (err) { this.error = t('프로젝트를 만들지 못했습니다: {why}', { why: err.message }); }
    this.busy = null; this.render();
  }

  // ---------- UI ----------
  renderProgress() {
    if (this.progEl) {
      this.progEl.textContent = this.busy === 'stems' || this.busy === 'setup' ? `${tdyn(this.stemLabel || '')}${this.stemDetail && this.busy === 'setup' ? ` · ${tdyn(this.stemDetail)}` : ''}`
        : this.busy === 'build' ? t('트랙을 만드는 중…')
        : this.busy === 'decode' ? t('파일을 읽는 중…')
        : this.busy === 'analyse' ? `${tdyn(this.stemLabel) || t('분석 중…')}` : '';
    }
    this.paintBars();
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
      h('button', { class: 'btn sm ghost ai-back', disabled: at === 0 || !!this.busy, onclick: () => this.back() }, t('← 뒤로')),
      h('ol', { class: 'ai-steps' }, ...STEPS.map(([k, label], i) => h('li', { class: i === at ? 'on' : i < at ? 'done' : '' }, h('i', {}, i < at ? '✓' : String(i + 1)), t(label)))));
    const page = this.step === 'file' ? this.fileView() : this.step === 'options' ? this.optionsView() : this.step === 'run' ? this.runView()
      : this.step === 'result' ? this.stemsView() : this.midiView();
    const parts = [head, page];
    // busy on another page than the run page (installing, recognising instruments): progress under it
    if (this.busy && this.step !== 'run') parts.push(this.busyView());
    if (this.error) parts.push(h('p', { class: 'cl-msg err', style: 'white-space:pre-line' }, tdyn(this.error)));
    this.body.replaceChildren(...parts);
    this.renderProgress();
    this.paintBars();
  }

  fileView() {
    const eng = this.engine || {};
    return h('div', { class: 'ai-step' },
      h('b', {}, t('파일 고르기')),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', disabled: !!this.busy, onclick: () => this.pick() }, this.file ? t('다른 파일…') : t('파일 고르기…')),
        h('span', { class: 'dim' }, this.file ? this.file.name : t('WAV·MP3·FLAC·MP4·MOV 파일을 선택하거나 이 창으로 드래그하세요.'))),
      this.file && eng.ready ? h('div', { class: 'row' }, h('span', { class: 'sp' }), h('button', { class: 'btn', disabled: !!this.busy || !this.audio, onclick: () => { this.step = 'options'; this.render(); } }, t('다음 →'))) : null,
      // the separation engine: open-source models on this computer
      !eng.ready ? h('div', { class: 'ai-engine' },
        h('b', {}, t('분리 엔진 설치')),
        h('p', { class: 'dim' }, t('악기별 음원 분리(BS-RoFormer · BS-RoFormer SW 6-stem · DrumSep), 박자 분석(Beat This!), 채보(Basic Pitch)를 이 컴퓨터에서 실행합니다. Python을 따로 깔 필요 없이 버튼 하나로 설치돼요. 처음 한 번 {size} (빈 공간 6 GB 필요, 중간에 멈추면 이어서 받아요).', { size: eng.gpu ? t('약 3.5 GB를 받고 NVIDIA GPU로 빠르게 처리해요') : t('약 1.5 GB를 받아요. GPU가 없으면 한 곡에 몇 분 걸려요') })),
        eng.reason ? h('p', { class: 'cl-msg err' }, t('엔진을 쓸 수 없는 이유: {why}', { why: tdyn(eng.reason) })) : null,
        h('div', { class: 'row' }, h('button', { class: 'btn', disabled: !!this.busy, onclick: () => this.setupEngine('install') }, t('엔진 설치')),
          h('button', { class: 'btn sm ghost', disabled: !!this.busy, onclick: async () => { this.engine = await window.melofi.stemsStatus(); if (this.engine.ready && this.audio) this.step = 'options'; this.render(); } }, t('다시 확인')))) : null);
  }

  busyView() {
    const bars = ['stems', 'analyse', 'setup'].includes(this.busy);
    return h('div', { class: 'ai-busy' },
      h('div', { class: 'ai-prog-head' }, this.progEl = h('span', { class: 'ai-prog-label' }), this.etaEl = h('span', { class: 'ai-prog-eta' }),
        this.busy === 'stems' || this.busy === 'setup' ? h('button', { class: 'btn sm ghost', onclick: () => { window.melofi.stemsCancel(); this.addLog(t('취소를 요청했어요.')); } }, t('취소')) : null),
      bars ? h('div', { class: 'ai-meter', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100 }, this.barEl = h('i', {}, this.allPct = h('b'))) : null,
      bars ? h('div', { class: 'ai-substage' }, h('span', {}, t('현재 단계')), h('div', { class: 'ai-bar stage' }, this.stageEl = h('i')), this.stagePct = h('em')) : null,
      this.busy === 'setup' ? (() => { const log = h('pre', { class: 'ai-log' }, this.log.join('\n')); this.logEl = log; requestAnimationFrame(() => { if (this.logEl) this.logEl.scrollTop = this.logEl.scrollHeight; }); return log; })() : null);
  }

  // the installed engine: which build, and update / reinstall (on the options page, below the GPU line)
  engineRow() {
    const eng = this.engine || {};
    if (!eng.ready || this.busy) return null;
    const what = eng.managed ? t('분석 엔진 · {build} · 버전 {v}', { build: eng.build === 'gpu' ? t('GPU용') : t('CPU용'), v: eng.engineVersion }) : t('분석 엔진 · 이전 방식(컴퓨터의 Python)으로 설치됨');
    return h('div', { class: 'row ai-engine-row' }, h('span', { class: 'dim' }, eng.updatable ? t('{what} · 새 버전이 있어요', { what }) : what), h('span', { class: 'sp' }),
      eng.updatable ? h('button', { class: 'btn sm', onclick: () => this.setupEngine('update') }, t('엔진 업데이트')) : null,
      h('button', { class: 'btn sm ghost', onclick: () => this.setupEngine('reinstall') }, t('엔진 다시 설치')));
  }

  // the separation running: progress and the engine's live log
  runView() {
    const log = h('pre', { class: 'ai-log tall' }, this.log.join('\n'));
    this.logEl = log;
    requestAnimationFrame(() => { if (this.logEl) this.logEl.scrollTop = this.logEl.scrollHeight; });
    return h('div', { class: 'ai-step' },
      h('b', {}, this.busy ? t('분리하는 중 · {name}', { name: this.file?.name || '' }) : this.error ? t('분리하지 못했어요') : t('분리')),
      this.busy ? this.busyView() : null,
      this.busy && this.warn ? h('div', { class: 'ai-gpu bad' }, h('span', { class: 'err' }, tdyn(this.warn))) : null,
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
    const fmtT = (sec) => (sec < 60 ? t('{n}초', { n: Math.max(5, Math.round(sec / 5) * 5) }) : t('{n}분', { n: Math.round(sec / 60) }));
    const est = !dur || !engine ? '' : t('분리 {a} · 박자 {b} · 채보 {c} → 약 {all}', { a: fmtT(sep), b: fmtT(dur * PER.beats * slow), c: fmtT(tr), all: fmtT(sep + tr + dur * PER.beats * slow) });
    // the GPU check: enough free memory for the chosen model, not busy with something else
    const free = g ? g.freeMB : 0, need = NEED[this.mus] || 2600;
    const others = g ? g.apps.filter((a) => !/^python/i.test(a) || !g.ours) : [];
    const short = engine && usable && free < need && !g.ours;
    this.gpuShort = short;
    const gpuLine = !engine ? null : !g
      ? h('p', { class: 'cl-msg err' }, t('NVIDIA GPU를 찾지 못했어요. 프로세서(CPU)로 처리해서 아주 오래 걸려요 (예상 시간에 반영).'))
      : h('div', { class: `ai-gpu${short ? ' bad' : g.util > 40 ? ' warn' : ''}` },
        h('b', {}, g.name),
        h('span', {}, t('그래픽 메모리 {total} GB 중 {free} GB 비어 있음 · 사용률 {util}%', { total: (g.totalMB / 1024).toFixed(1), free: (g.freeMB / 1024).toFixed(1), util: g.util })),
        this.gpuInfo.screen ? h('span', {}, this.gpuInfo.screen.vendor === 'NVIDIA' ? t('MeloFi 화면(피아노 비주얼라이저)은 이 GPU에서 그려요. 분석 중에는 피아노 창을 닫거나 최소화하면 더 빨라요.') : t('MeloFi 화면(피아노 비주얼라이저)은 {vendor} 내장 그래픽에서 그려서 분석과 겹치지 않아요.', { vendor: this.gpuInfo.screen.vendor })) : null,
        short ? h('span', { class: 'err' }, t('MuScriptor {model}에는 약 {gb} GB가 필요해요. GPU를 쓰는 다른 프로그램을 닫거나 더 작은 모델을 골라 주세요.', { model: this.mus, gb: (need / 1024).toFixed(1) })) : null,
        !short && g.util > 40 ? h('span', { class: 'warn' }, t('다른 작업이 GPU를 {util}% 쓰고 있어요{apps}. 그대로 시작하면 느려질 수 있어요.', { util: g.util, apps: others.length ? ` (${[...new Set(others)].join(', ')})` : '' })) : null,
        h('span', { class: 'ai-live', title: t('2초마다 새로 읽어요') }, t('실시간')));
    const done = this.stems ? (this.stems.muscriptor?.notes ? this.stems.muscriptor.model : 'off') : null;
    return h('div', { class: 'ai-step' },
      h('b', {}, t('분리 방식')),
      h('div', { class: 'ai-opts' },
        engine ? row(t('악기 분리'), sel(this.sepMode, [['full', t('전체 · 보컬·코러스·드럼(킥·스네어 등 세부)·베이스·기타·피아노·나머지')], ['fast', t('빠르게 · 코러스와 드럼 세부 분리 생략')]], (v) => { this.sepMode = v; this.render(); })) : null,
        engine ? row(t('채보 방식'), h('span', { class: 'ai-opt-ctl' },
          sel(this.mus, [['off', t('Basic Pitch · 분리한 악기마다, 사용 제한 없음')], ['small', t('MuScriptor small · 가장 빠름')], ['medium', t('MuScriptor medium · 균형')], ['large', t('MuScriptor large · 가장 정확, 느림')]], setMus),
          this.mus !== 'off' ? h('span', { class: 'ai-nc' }, t('비상업 전용 · CC BY-NC 4.0')) : null)) : null),
      engine && this.mus !== 'off' ? h('p', { class: 'dim' }, t('곡 전체에서 피아노·기타·베이스·현악·관악·신스·보컬·드럼 등 약 35가지 악기로 나눠 받아 적어요. 결과를 상업적으로 쓸 수는 없어요.')) : null,
      needToken ? (() => {
        const inp = h('input', { type: 'password', class: 'cl-in', placeholder: 'hf_…', style: 'max-width:300px' });
        return h('div', {},
          h('p', { class: 'dim' }, t('MuScriptor를 쓰려면 처음 한 번: huggingface.co/MuScriptor/muscriptor-{model} 에서 로그인한 뒤 라이선스(CC BY-NC 4.0)에 동의하고, huggingface.co/settings/tokens 에서 읽기(Read) 토큰을 만들어 넣어 주세요. 토큰은 이 PC에만 암호화해 저장해요.', { model: this.mus })),
          h('div', { class: 'row' }, inp, h('button', { class: 'btn sm', onclick: async () => { const r = await window.melofi.stemsSetToken(inp.value); if (!r.ok) this.error = r.message; this.engine = await window.melofi.stemsStatus(); this.render(); } }, t('저장'))));
      })() : null,
      engine && this.mus !== 'off' && eng.hfToken ? h('div', { class: 'row' }, h('span', { class: 'dim' }, t('HuggingFace 토큰이 저장돼 있어요.')),
        h('button', { class: 'btn sm ghost', disabled: !!this.busy, onclick: async () => { await window.melofi.stemsSetToken(''); this.engine = await window.melofi.stemsStatus(); this.render(); } }, t('토큰 지우기'))) : null,
      gpuLine,
      this.engineRow(),
      h('div', { class: 'ai-go' },
        h('button', { class: 'btn primary', disabled: !this.audio || !!this.busy || !engine || needToken || short, onclick: () => this.analyse() }, this.stems ? t('이 방식으로 다시 분리 →') : t('분리 시작 →')),
        // after an analysis: another transcription only redoes the transcription (separation kept)
        engine && done !== null && done !== this.mus && !needToken ? h('button', { class: 'btn', disabled: !!this.busy, onclick: () => this.retranscribe() }, this.mus === 'off' ? t('Basic Pitch 결과로 보기') : t('채보만 MuScriptor {model}(으)로 다시', { model: this.mus })) : null,
        h('span', { class: 'dim' }, !engine ? t('먼저 분리 엔진을 설치해 주세요.') : !this.audio ? t('먼저 파일을 골라 주세요.') : t('{name} · {m}분 {s}초 · 예상 {est}', { name: this.file.name, m: Math.floor(dur / 60), s: Math.round(dur % 60), est }))));
  }

  async retranscribe() {
    if (!this.file || this.busy) return;
    const seq = this.seq;
    this.log = []; this.t0 = Date.now();
    this.busy = 'stems'; this.progress = 0; this.stemLabel = t('채보를 준비하는 중…'); this.error = null; this.step = 'run'; this.render();
    this.addLog(t('채보만 다시: {how} (분리·박자 결과는 그대로)', { how: this.mus === 'off' ? 'Basic Pitch' : `MuScriptor ${this.mus}` }));
    const r = await window.melofi.stemsRun({ name: this.file.name, data: this.file.data, quick: this.sepMode === 'fast', muscriptor: this.mus });
    if (seq !== this.seq) return;
    this.busy = null;
    if (!r.ok) this.error = r.message; else { this.stems = r.result; this.plan = null; this.choice = null; this.step = 'result'; }
    this.render();
  }

  stemsView() {
    const r = this.stems;
    const NAMES = { vocals: t('리드 보컬'), backing: tc('stem', '코러스'), drums: t('드럼'), bass: t('베이스'), guitar: t('기타'), piano: t('피아노'), other: t('그 밖의 악기') };
    const DRUMS = { kick: t('킥'), snare: t('스네어'), toms: t('탐'), hh: t('하이햇'), ride: t('라이드'), crash: t('크래시') };
    const noteCount = (k) => r.notes?.[k]?.length || 0;
    // every separated file, for "save all": the stems, then the drum parts
    const allFiles = [...['vocals', 'backing', 'drums', 'bass', 'guitar', 'piano', 'other'].filter((k) => r.stems[k]).map((k) => [NAMES[k] || k, r.stems[k]]),
      ...Object.entries(r.drum_parts || {}).map(([k, f]) => [t('드럼 {part}', { part: DRUMS[k] || k }), f])];
    const chip = (id, name, file, sub) => h('button', { class: `ai-stem${this.playing === id ? ' on' : ''}`, title: t('눌러서 들어보기 · 우클릭: 저장'), onclick: () => this.preview(id, file),
      oncontextmenu: (e) => this.stemMenu(e, id.startsWith('d-') ? t('드럼 {part}', { part: name }) : name, file, allFiles) },
      h('i', {}, this.playing === id ? '■' : '▶'), h('span', {}, name), sub ? h('small', {}, sub) : null);
    const order = ['vocals', 'backing', 'drums', 'bass', 'guitar', 'piano', 'other'].filter((k) => r.stems[k]);
    const total = r.times?.total;
    return h('div', { class: 'ai-step' },
      h('b', {}, t('악기별 분리 · 박자 · 채보')),
      this.fromCache ? h('p', { class: 'dim' }, t('전에 분리해 둔 결과를 바로 불러왔어요 (채보: {how}). 다른 방식으로 다시 하려면 ← 뒤로.', { how: this.fromCache === 'off' ? 'Basic Pitch' : `MuScriptor ${this.fromCache}` })) : null,
      h('div', { class: 'ai-facts' },
        fact(t('템포'), `${Math.round(r.bpm * 10) / 10} BPM`), fact(t('박자'), `${r.meter >= 2 && r.meter <= 7 ? r.meter : 4}/4`), fact(tc('music', '키'), `${PC[r.key.root]} ${r.key.mode === 'minor' ? t('마이너') : t('메이저')}`),
        fact(t('첫 마디'), t('{n}초', { n: r.first_downbeat.toFixed(2) })), fact(t('처리'), `${r.device === 'cuda' ? 'GPU' : 'CPU'}${total ? ` · ${t('{n}초', { n: Math.round(total) })}` : ''}`)),
      h('div', { class: 'ai-stems' }, ...order.map((k) => chip(k, NAMES[k] || k, r.stems[k], k === 'drums' ? t('타격 {n}', { n: r.drums?.length || 0 }) : noteCount(k) ? t('음표 {n}', { n: noteCount(k) }) : null))),
      r.muscriptor?.notes ? h('p', {}, h('span', { class: 'ai-nc' }, t('비상업 전용')), t(' MuScriptor({model})가 {n}가지 악기, 음표 {notes}개를 받아 적었어요: {list}', { model: r.muscriptor.model, n: Object.keys(r.muscriptor.notes).length, notes: Object.values(r.muscriptor.notes).reduce((s, l) => s + l.length, 0).toLocaleString(), list: Object.keys(r.muscriptor.notes).map((k) => t(MUS[k]?.[0] || k)).join(', ') })) : null,
      r.muscriptor?.error ? h('p', { class: 'cl-msg err' }, t('MuScriptor를 실행하지 못했어요: {why}', { why: r.muscriptor.error })) : null,
      Object.keys(r.drum_parts || {}).length ? h('div', { class: 'ai-stems sub' }, ...Object.entries(r.drum_parts).map(([k, file]) => chip(`d-${k}`, DRUMS[k] || k, file))) : null,
      h('div', { class: 'row' },
        h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: this.useAudio, onchange: (e) => { this.useAudio = e.target.checked; this.render(); } }), t(' 분리한 오디오 트랙')),
        h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: this.useMidi, onchange: (e) => { this.useMidi = e.target.checked; this.render(); } }), t(' 채보한 MIDI 채널')),
        h('span', { class: 'sp' }),
        h('button', { class: 'btn', disabled: !!this.busy || (!this.useAudio && !this.useMidi), onclick: () => this.openStems() }, t('분리한 트랙으로 프로젝트 만들기')),
        h('button', { class: 'btn primary', disabled: !!this.busy, title: t('구간마다 악기를 골라 MIDI로 바꾸기'), onclick: () => { this.stopPreview(); this.step = 'midi'; this.render(); } }, t('MIDI로 변환 →'))),
      h('p', { class: 'dim' }, t('트랙을 우클릭하면 파일로 저장할 수 있어요 (FLAC · WAV · MP3). 오디오와 MIDI를 함께 넣으면 MIDI 채널은 음소거된 상태로 들어가요. 분리: {sep} / 박자: {beats} / 채보: {notes}', { sep: `${r.models.vocals} · ${r.models.instruments}${r.models.drum_parts ? ` · ${r.models.drum_parts}` : ''}`, beats: r.models.beats, notes: r.models.notes })));
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
  p.name = t('{name} (분리)', { name: fileName.replace(/\.[^.]+$/, '') });
  p.bpm = Math.round(r.bpm * 100) / 100;
  p.sig = [r.meter >= 2 && r.meter <= 7 ? r.meter : 4, 4]; // older analyses could say 1
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
  // time signature changes (변박): bars whose beat count differs from the song's meter become
  // time-signature markers at their bar lines. The tempo then comes from the beats (bar lengths
  // differ), and notes stay where they were played: markers only move the bar lines.
  const mm = meterMap(r);
  if (mm.changes.length) {
    // seconds per beat over the whole song from the bar lines themselves (the beat list can run at
    // double time for a stretch), so every bar line lands where the song has it on average
    const n = mm.bars.length;
    if (n > 2) {
      const beatsSum = mm.bars.slice(0, -1).reduce((a, b) => a + b.beats, 0);
      p.bpm = Math.round(((60 * beatsSum) / (mm.bars[n - 1].t - mm.bars[0].t)) * 100) / 100;
    }
    p.tempos = [];
    p.sig = [mm.bars[0].beats, 4];
    let tick = 0, prev = mm.bars[0].beats;
    p.sigs = [];
    for (const b of mm.bars) {
      if (b.beats !== prev) { p.sigs.push({ tick, sig: [b.beats, 4] }); prev = b.beats; }
      tick += b.beats * PPQ;
    }
  }
  p.mode = 'song';
  const t0 = mm.changes.length ? mm.bars[0].t : r.first_downbeat || 0;
  const tickOf = (sec) => Math.max(0, Math.round(secToTick(p, Math.max(0, sec - t0), 'song')));
  const NAMES = { vocals: t('리드 보컬'), backing: tc('stem', '코러스'), drums: t('드럼'), bass: t('베이스'), guitar: t('기타'), piano: t('피아노'), other: t('그 밖의 악기') };
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
      chans.push([inst, newChannel(pickInst(S, a1, a2), t('{name} (MIDI · 비상업)', { name: t(ko) }), p.channels.length + chans.length, { mute: audio, send: drum ? 0.05 : 0.15, ...(drum ? { stepNote: 36 } : {}) }), list]);
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
    p.playlist.tracks.push({ ...newTrack(tr), name: t('MIDI (채보)') });
    for (let b = 0; b < endBar; b += 8) {
      const len = Math.min(8, endBar - b), pat = newPattern(p.patterns.length, len);
      pat.name = t('{a}~{b}마디', { a: b + 1, b: b + len });
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
// The song's bars with their beat counts, for time signature changes (변박). The beat tracker gives
// beats and downbeats; the beats between two downbeats are a bar's beat count. Not every odd count is
// a real change — the tracker also errs — so:
//  - a run of short bars that pair up into whole bars (2+2 in 4/4: a downbeat every two beats for a
//    stretch) is the tracker reading half bars: merged back;
//  - a bar of one beat is noise: merged into the bar before;
//  - a gap of two or three whole bars is missing downbeats: split;
//  - anything else (a lone 2/4 or 3/4 bar, a 3/4 section in a 4/4 song, 5/4, 7/4…) is kept as played.
// Returns { meter, bars: [{ t, beats }], changes: [{ bar, beats }] } (bar = 0-based index).
export function meterMap(r) {
  const meter = r.meter >= 2 && r.meter <= 7 ? r.meter : 4;
  const beats = (r.beats || []).slice().sort((a, b) => a - b), db = (r.downbeats || []).slice().sort((a, b) => a - b);
  if (db.length < 4 || beats.length < 8) return { meter, bars: db.map((t) => ({ t, beats: meter })), changes: [] };
  const count = (a, b) => beats.filter((x) => x >= a - 0.04 && x < b - 0.04).length;
  let bars = db.slice(0, -1).map((t, i) => ({ t, beats: count(t, db[i + 1]) }));
  // half-bar runs: consecutive short bars that add up to the meter
  const out = [];
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    if (b.beats < meter && b.beats > 0) {
      let j = i, sum = 0;
      while (j < bars.length && bars[j].beats < meter && sum + bars[j].beats <= meter) { sum += bars[j].beats; j++; if (sum === meter) break; }
      const run = j - i;
      // two or more short bars that make exactly one bar: the tracker split it (two real 2/4 bars
      // in a row in a 4/4 song are far rarer than this error)
      if (sum === meter && run >= 2) { out.push({ t: b.t, beats: meter }); i = j - 1; continue; }
    }
    if (b.beats <= 1) { if (out.length) out.at(-1).beats += b.beats; continue; }
    if (b.beats % meter === 0 && b.beats > meter && b.beats <= meter * 3) {
      const span = (bars[i + 1]?.t ?? db.at(-1)) - b.t, k = b.beats / meter;
      for (let s = 0; s < k; s++) out.push({ t: b.t + (span * s) / k, beats: meter });
      continue;
    }
    out.push({ ...b });
  }
  bars = out;
  // the last bar runs into the song's end (the tracker has no downbeat after it): played as the meter
  if (bars.length) bars.at(-1).beats = meter;
  // trust the counts only when the beat length is the same all through: where the tracker switches
  // to double time for a stretch, a 4/4 bar reads as two "bars" of four short beats and the counts
  // say nothing about the meter. Then no changes (the song keeps one signature, as before).
  const spb = bars.slice(0, -1).map((b, i) => (bars[i + 1].t - b.t) / b.beats).sort((a, b) => a - b);
  const m = spb[spb.length >> 1];
  if (!spb.length || spb.some((x) => Math.abs(x / m - 1) > 0.12)) return { meter, bars, changes: [], unsteady: true };
  const changes = bars.map((b, i) => ({ bar: i, beats: b.beats })).filter((c) => c.beats !== meter);
  return { meter, bars, changes };
}

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
  acoustic_piano: [N_('피아노'), 'splendid', 'salamander'], electric_piano: [N_('일렉트릭 피아노'), 'rhodes', 'wurlitzer'],
  chromatic_percussion: [N_('건반 타악기'), 'vibraphone', 'glockenspiel'], organ: [N_('오르간'), 'organ', 'drawbar'],
  acoustic_guitar: [N_('어쿠스틱 기타'), 'acoustic', 'cleanguitar'], clean_electric_guitar: [N_('일렉 기타 (클린)'), 'cleanguitar', 'acoustic'],
  distorted_electric_guitar: [N_('일렉 기타 (디스토션)'), 'electric', 'cleanguitar'], acoustic_bass: [N_('어쿠스틱 베이스'), 'upright', 'contrabass'],
  electric_bass: [N_('일렉 베이스'), 'fingerbass', 'ebass'], violin: [N_('바이올린'), 'violin', 'strings'], viola: [N_('비올라'), 'violin', 'strings'],
  cello: [N_('첼로'), 'cello', 'strings'], contrabass: [N_('콘트라베이스'), 'contrabass', 'upright'], orchestral_harp: [N_('하프'), 'harp', 'splendid'],
  timpani: [N_('팀파니'), 'contrabass', 'cello'], string_ensemble: [N_('현악 합주'), 'strings', 'synpad'], synth_strings: [N_('신스 스트링'), 'synpad', 'strings'],
  voice: [N_('보컬'), 'vocal', 'synlead'], orchestra_hit: [N_('오케스트라 히트'), 'brassstab', 'synbrass'], trumpet: [N_('트럼펫'), 'trumpet', 'synbrass'],
  trombone: [N_('트롬본'), 'trombone', 'synbrass'], tuba: [N_('튜바'), 'trombone', 'synbrass'], french_horn: [N_('호른'), 'horn', 'synbrass'],
  brass_section: [N_('금관 합주'), 'synbrass', 'trumpet'], soprano_and_alto_sax: [N_('알토 색소폰'), 'altosax', 'tenorsax'], tenor_sax: [N_('테너 색소폰'), 'tenorsax', 'altosax'],
  baritone_sax: [N_('바리톤 색소폰'), 'tenorsax', 'altosax'], oboe: [N_('오보에'), 'oboe', 'clarinet'], english_horn: [N_('잉글리시 호른'), 'oboe', 'clarinet'],
  bassoon: [N_('바순'), 'clarinet', 'oboe'], clarinet: [N_('클라리넷'), 'clarinet', 'oboe'], flutes: [N_('플루트'), 'flute', 'recorder'],
  synth_lead: [N_('신스 리드'), 'synlead', 'supersaw'], synth_pad: [N_('신스 패드'), 'synpad', 'strings'], drums: [N_('드럼'), 'acousticdrums', 'drums808'],
};

// the original as a muted reference track, lined up with bar 1
