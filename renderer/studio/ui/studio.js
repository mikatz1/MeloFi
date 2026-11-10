// MeloFi Studio — the composer window. Owns the project, history, engine and transport, and
// wires the panels together: channel rack / browser on the left; piano roll, playlist, mixer
// and live grid on the right; an on-screen keyboard at the bottom; the guided tour on top.
import { h, popup, ask, form, setControlMenu } from './dom.js';
import { PPQ, STEP, barTicks, patternTicks, pattern, notesOf, newProject, newPattern, History, uid, migrate, SCALES, ROOTS, newTrack, songBars, tickToSec } from '../model.js';
import { StudioEngine } from '../engine.js';
import { Transport, eventsFor } from '../transport.js';
import { saveProject, openProject, autosave, autoload, projectToMidi, midiToProject, renderMix } from '../io.js';
import { addMedia } from '../media.js';
import { FX_TYPES, fromNorm, toNorm } from '../fx.js';
import { Rack } from './rack.js';
import { Roll, CHORDS, LANES } from './roll.js';
import { Playlist } from './playlist.js';
import { Mixer } from './mixer.js';
import { Browser } from './browser.js';
import { Keys } from './keys.js';
import { Live } from './live.js';
import { Tour, CHAPTERS } from './tour.js';
import { ChannelSheet } from './channelsheet.js';
import { MidiOut } from '../midiout.js';
import { DawSheet } from './daw.js';
import { CloudSheet } from './cloud.js';
import { AiSheet } from './ai.js';
import { openPicker } from '../../js/picker-client.js';
import { TEMPLATES } from '../templates.js';
import { encodeWav, mp3 } from '../../js/recorder.js';
import { T } from '../../js/strings.js';

const SNAPS = [['bar', '마디'], [PPQ, '1/4'], [PPQ / 2, '1/8'], [STEP, '1/16'], [STEP / 2, '1/32'], [PPQ / 6, '1/16 셋잇단'], [1, '없음']];
const FAMILY_ORDER = ['drums', 'piano', 'keys', 'organ', 'synth', 'strings', 'brass', 'winds', 'vocal', 'guitar', 'bass', 'mallets', 'world', 'fx'];

// studio actions that can be bound to keys (Shortcut settings)
export const ACTIONS = {
  play: ['재생 / 정지', 'Space'], record: ['노트 녹음', 'R'], undo: ['실행 취소', 'Ctrl+Z'], redo: ['다시 실행', 'Ctrl+Y'],
  save: ['저장', 'Ctrl+S'], open: ['열기', 'Ctrl+O'], keys: ['화면 건반 보이기', 'Ctrl+K'], metro: ['메트로놈', 'Ctrl+M'],
  loop: ['반복 구간 켜기 / 끄기', 'Ctrl+L'], roll: ['피아노 롤', 'F5'], playlist: ['플레이리스트', 'F6'], mixer: ['믹서', 'F7'], live: ['라이브', 'F8'],
  draw: ['그리기 도구', 'B'], chord: ['코드 도구', 'H'], slide: ['슬라이드 도구', 'G'], tour: ['튜토리얼', 'F1'],
};
const comboOf = (e) => `${e.ctrlKey ? 'Ctrl+' : ''}${e.shiftKey && e.key.length > 1 ? 'Shift+' : ''}${e.altKey ? 'Alt+' : ''}${e.code === 'Space' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key}`;

export class Studio {
  constructor(app) {
    this.app = app;
    this.isOpen = false;
    this.snapKey = STEP;
    this.tab = 'roll';
    this.leftTab = 'rack';
    this.keysOpen = false;
    this.recQuant = true;
    this.liveHeld = new Set();
    this.dirty = false;
    this.learn = null;
    this.taps = [];
    this.countIn = true;
    this.scoreLog = []; // everything played live recently: { n, v, on, off } (ms)
  }

  get proj() { return this._proj; }
  get snap() { return this.snapKey === 'bar' ? barTicks(this.proj) : this.snapKey; }
  instName(id) { return this.app.instruments.find((i) => i.id === id)?.name || id; }
  instInfo(id) { return this.app.instruments.find((i) => i.id === id) || null; }
  isKit(id) { return (this.instInfo(id)?.family || (String(id).startsWith('drums') ? 'drums' : '')) === 'drums'; }
  get dawSheet() { return (this._daw ||= new DawSheet(this)); }
  get cloudSheet() { return (this._cloud ||= new CloudSheet(this)); }
  get channelSheet() { return (this._chs ||= new ChannelSheet(this)); }
  get tour() { return (this._tour ||= new Tour(this)); }
  get aiSheet() { return (this._ai ||= new AiSheet(this)); }

  // MIDI channel of a studio channel: drum kits on 10, the rest in order around it
  midiChannel(chId) {
    const list = this._proj.channels;
    const c = list.find((x) => x.id === chId);
    if (c && this.isKit(c.inst) && (c.kind || 'inst') === 'inst') return 9;
    let k = 0;
    for (const x of list) { if (this.isKit(x.inst) && (x.kind || 'inst') === 'inst') continue; if (x.id === chId) break; k++; }
    return k >= 9 ? (k + 1) % 16 : k;
  }

  // ---------- open / close ----------
  async open() {
    if (this.isOpen) return;
    if (!this.el) this.build();
    if (!this.engine) {
      this.engine = new StudioEngine(this.app.engine.ctx);
      this.transport = new Transport(this.engine, () => this._proj);
      this.transport.onTick = () => this.updatePos();
      this.transport.onStop = () => this.applyStrips();
      this.midiOut = new MidiOut(this.app.engine.ctx);
      this.midiOut.chanOf = (chId) => this.midiChannel(chId);
      this.transport.out = this.midiOut;
      this.midiOut.init().then(() => { this.midiOut.clock = !!this.app.settings.get('midiClock'); this.midiOut.select(this.app.settings.get('midiOut') || ''); });
      setControlMenu((e, target, label) => this.controlMenu(e, target, label));
    }
    if (!this._proj) {
      this._proj = (await autoload()) || newProject();
      this.history = this.makeHistory();
    }
    this.isOpen = true;
    document.body.classList.add('studio-open');
    this.el.hidden = false;
    this.renderAll();
    requestAnimationFrame(() => { this.roll.resize(); this.playlist.resize(); this.roll.focusNotes(); });
    this.syncAudio();
    this.loop();
    this.autoTimer = setInterval(async () => { if (this.dirty) { this.dirty = false; await this.captureVstStates(); autosave(this._proj); } }, 15000);
    if (!this.app.settings.get('studioTourSeen')) setTimeout(() => this.welcome(), 400);
  }

  close() {
    if (!this.isOpen) return;
    this.transport.stop();
    for (const h of this.engine.channels.values()) h.held.forEach((_, n) => h.liveOff(n));
    if (this.tour.active) this.tour.stop();
    this.isOpen = false;
    this.el.hidden = true;
    document.body.classList.remove('studio-open');
    clearInterval(this.autoTimer);
    autosave(this._proj);
    this.dirty = false;
  }

  toggle() { if (this.isOpen) this.close(); else this.open(); }

  // commands from the piano window's menus
  command(cmd) {
    const acts = {
      new: () => this.newFile(), open: () => this.openFile(), importMidi: () => this.importMidi(),
      ai: () => this.aiSheet.show(), daw: () => this.dawSheet.show(),
      cloudProjects: () => this.cloudSheet.show('projects'), cloudShared: () => this.cloudSheet.show('shared'), cloudAccount: () => this.cloudSheet.show('account'),
    };
    acts[cmd]?.();
  }

  welcome() {
    const box = h('div', { class: 'st-welcome' },
      h('b', {}, '작곡이 처음이신가요?'),
      h('p', {}, '화면을 하나씩 짚어 가며 첫 비트부터 곡 완성까지 안내해 드려요. 5분이면 됩니다.'),
      h('div', { class: 'row' },
        h('button', { class: 'btn sm ghost', onclick: () => { box.remove(); this.app.settings.set({ studioTourSeen: true }); } }, '괜찮아요'),
        h('button', { class: 'btn sm ghost', onclick: () => { box.remove(); this.newFromTemplate(); } }, '템플릿 보기'),
        h('button', { class: 'btn sm primary', onclick: () => { box.remove(); this.tour.start('beat'); } }, '투어 시작')));
    this.el.append(box);
  }

  makeHistory() {
    const H = new History(() => this._proj, (p) => { this._proj = migrate(p); this.afterLoad(false); });
    H.labels = [];
    const push = H.push.bind(H);
    H.push = (label = '편집') => { push(); H.labels.push({ label, at: Date.now() }); if (H.labels.length > H.limit) H.labels.shift(); };
    const undo = H.undo.bind(H), redo = H.redo.bind(H);
    H.undo = () => { const ok = undo(); if (ok) H.redoLabels = [...(H.redoLabels || []), H.labels.pop()]; return ok; };
    H.redo = () => { const ok = redo(); if (ok && H.redoLabels?.length) H.labels.push(H.redoLabels.pop()); return ok; };
    return H;
  }

  async syncAudio() {
    this.status('악기 불러오는 중…');
    try {
      await this.engine.sync(this._proj, (id, p) => this.status(`${this.instName(id)} ${Math.round(p * 100)}%`));
      this.status('');
    } catch (err) {
      console.error(err);
      this.status(`불러오지 못했습니다: ${err.message}`);
    }
  }

  // quick updates while dragging a knob / fader (no rebuild)
  applyStrips() {
    if (!this.engine) return;
    const p = this._proj;
    for (const c of p.channels) this.engine.channels.get(c.id)?.set(c);
    for (const b of p.buses) this.engine.buses.get(b.id)?.set({ vol: b.vol, pan: b.pan, mute: b.mute });
    this.engine.masterStrip.set({ vol: p.master.vol, pan: 0 });
  }

  applyFx(stripId) {
    const p = this._proj;
    const list = stripId === 'master' ? p.master.fx : (p.channels.find((c) => c.id === stripId) || p.buses.find((b) => b.id === stripId))?.fx;
    this.engine.strip(stripId)?.setFx(list || []);
  }

  // ---------- edits ----------
  edit(fn, render = true, label) {
    this.history.push(label);
    fn();
    if (render) this.changed();
  }

  changed() {
    this.dirty = true;
    this.transport.refresh();
    this.applyStrips();
    this.renderAll();
  }

  afterLoad(resync = true) {
    this.roll.reset();
    this.selClip = null;
    this.transport.refresh();
    this.renderAll();
    if (resync) this.syncAudio();
    else this.engine.sync(this._proj);
  }

  setProject(p, path = null) {
    this.transport.stop();
    this._proj = migrate(p);
    this.history = this.makeHistory();
    this.path = path;
    this.afterLoad(true);
    this.roll.focusNotes();
    this.dirty = true;
  }

  select(id) {
    this._proj.selected = id;
    this.roll.reset();
    this.setTab('roll');
    this.renderAll();
    this.roll.focusNotes();
  }

  setPattern(id, edit = false) {
    this._proj.current = id;
    this.roll.reset();
    if (this._proj.mode === 'pattern') this.transport.refresh();
    if (edit) this.setTab('roll');
    this.renderAll();
  }

  setMode(m) {
    if (this._proj.mode === m) return;
    this._proj.mode = m;
    const was = this.transport.playing;
    this.transport.stop();
    if (was) this.transport.play();
    this.renderToolbar();
  }

  setTab(t) {
    this.tab = t;
    for (const [k, el] of Object.entries(this.panes)) el.hidden = k !== t;
    for (const b of this.el.querySelectorAll('.st-tabs button')) b.classList.toggle('on', b.dataset.tab === t);
    requestAnimationFrame(() => { if (t === 'roll') this.roll.resize(); if (t === 'playlist') this.playlist.resize(); if (t === 'mixer') this.mixer.render(); if (t === 'live') this.live.render(); });
  }

  setLeft(t) {
    this.leftTab = t;
    this.rackEl.hidden = t !== 'rack';
    this.browserEl.hidden = t !== 'browser';
    if (t === 'browser') this.browser.render();
    for (const b of this.el.querySelectorAll('.st-ltabs button')) b.classList.toggle('on', b.dataset.l === t);
  }

  async rename(ch) {
    const v = await ask('채널 이름', ch.name);
    if (v && v.trim()) this.edit(() => { ch.name = v.trim(); });
  }

  // ---------- sound ----------
  preview(chId, n, v = 100) { this.engine.channels.get(chId)?.noteOn(n, v, 0, 0.35); }

  liveOn(n, v) {
    const chId = this._proj.selected;
    this.engine.channels.get(chId)?.liveOn(n, v);
    this.engine.duck(chId, this.engine.ctx.currentTime);
    this.midiOut?.liveOn(chId, n, v);
    this.transport.liveOn(chId, n, v);
    this.liveHeld.add(n);
    this.keys?.light();
    const now = performance.now();
    this.scoreLog = this.scoreLog.filter((x) => now - x.on < 5 * 60e3);
    this.scoreLog.push({ n, v, on: now, off: null, ch: chId });
  }

  liveOff(n) {
    const chId = this._proj.selected;
    this.engine.channels.get(chId)?.liveOff(n);
    this.midiOut?.liveOff(chId, n);
    this.liveHeld.delete(n);
    this.keys?.light();
    const open = [...this.scoreLog].reverse().find((x) => x.n === n && x.off == null);
    if (open) open.off = performance.now();
    this.transport.liveOff(chId, n, (r) => {
      if (this._proj.mode !== 'pattern') return;
      const pat = pattern(this._proj), len = patternTicks(this._proj, pat);
      let t = r.t % len;
      if (this.recQuant) t = Math.round(t / this.snap) * this.snap % len;
      notesOf(pat, r.ch).push({ t, d: Math.min(r.d, len), n: r.n, v: r.v });
      this.dirty = true;
      this.roll.draw();
      this.rack.render();
    });
  }

  playheadIn(pat) {
    if (!this.transport?.playing) return null;
    const T = this.transport.now();
    if (this._proj.mode === 'pattern') return pat.id === this._proj.current ? T : null;
    if (this._proj.mode === 'live') return Object.values(this._proj.live?.active || {}).includes(pat.id) ? T % patternTicks(this._proj, pat) : null;
    const bt = barTicks(this._proj), S = this.transport.songPos();
    const clip = this._proj.playlist.clips.find((c) => !c.kind && c.pattern === pat.id && S >= c.start * bt && S < (c.start + c.len) * bt);
    return clip ? (S - clip.start * bt + (clip.offset || 0) * bt) % patternTicks(this._proj, pat) : null;
  }

  seekPattern(t) { if (this._proj.mode === 'pattern') this.transport.seek(t); }

  // ---------- instruments, samples, audio ----------
  // the instrument picker window; it closes once a channel's instrument is chosen
  pickInstrument(x, y, cb, current = null) {
    openPicker({ title: current ? '채널 악기 바꾸기' : '채널 추가', current, closeOnPick: true },
      async (id) => { await this.app.refreshInstruments(); cb(id); },
      () => this.app.store.show());
  }

  // a sample / slicer channel from an audio file (picked, or { name, data } from the browser);
  // `into`: an existing channel to turn into it
  async addSampleChannel(kind, into = null, file = null) {
    let f = file;
    if (!f) { const picked = await window.melofi.mediaPickFiles(); f = picked[0]; }
    if (!f) return;
    this.status(`${f.name} 불러오는 중…`);
    const hash = await addMedia(this._proj, f.name, f.data);
    await this.addSampleChannelFromHash(kind, hash, into);
  }

  async addSampleChannelFromHash(kind, hash, into = null) {
    const m = this._proj.media[hash];
    let ch = into;
    this.edit(() => {
      if (!ch) ch = this.rack.makeKind(kind, m.name.replace(/\.[^.]+$/, ''));
      ch.kind = kind;
      ch.sample = { media: hash, root: 60, start: 0, end: null, reverse: false, loop: false, attack: 0, release: kind === 'slicer' ? 0.05 : 0.12, gain: 1, tune: 0 };
      if (kind === 'slicer') ch.slices = [0];
      this._proj.selected = ch.id;
    });
    if (kind === 'slicer') {
      const { decode, onsets } = await import('../media.js');
      const b = await decode(hash, 48000);
      ch.slices = onsets(b, 0.55);
    }
    await this.syncAudio();
    this.renderAll();
    this.channelSheet.show(ch.id, 'sound');
  }

  // an audio clip on the playlist (on its own audio channel)
  async addAudioClip(name, data, track = null, bar = null) {
    this.status(`${name} 불러오는 중…`);
    const hash = await addMedia(this._proj, name, data);
    return this.addAudioClipFromHash(hash, track, bar);
  }

  addAudioClipFromHash(hash, track = null, bar = null) {
    const p = this._proj, m = p.media[hash];
    const secPerBar = (60 / p.bpm) * p.sig[0] * (4 / p.sig[1]);
    this.edit(() => {
      let ch = p.channels.find((c) => c.kind === 'audio' && c.name === m.name.replace(/\.[^.]+$/, ''));
      if (!ch) ch = this.rack.makeKind('audio', m.name.replace(/\.[^.]+$/, ''));
      const t = track ?? p.playlist.tracks.findIndex((_, i) => !p.playlist.clips.some((c) => c.track === i));
      const tr = t < 0 ? p.playlist.tracks.length : t;
      while (p.playlist.tracks.length <= tr + 1) p.playlist.tracks.push(newTrack(p.playlist.tracks.length));
      const sync = !!m.bpm && Math.abs(m.bpm - p.bpm) > 0.5 && m.dur > 1.5;
      const ratio = sync ? m.bpm / p.bpm : 1;
      p.playlist.clips.push({ id: uid('k'), kind: 'audio', media: hash, ch: ch.id, track: tr, start: bar ?? 0, len: Math.max(0.25, Math.round((m.dur * ratio) / secPerBar * 4) / 4), offset: 0, gain: 1, sync });
      p.mode = 'song';
    });
    this.status('');
    this.syncAudio();
    this.setTab('playlist');
  }

  // destructive edits on a clip's audio (a new file; the original stays in the project)
  async processClip(c, kind) {
    const { decode } = await import('../media.js');
    const p = this._proj, m = p.media[c.media];
    const buf = await decode(c.media, 48000);
    const L = buf.getChannelData(0).slice(), R = (buf.numberOfChannels > 1 ? buf.getChannelData(1) : buf.getChannelData(0)).slice();
    let a = 0, b = L.length;
    if (kind === 'normalize') { let pk = 0; for (let i = 0; i < L.length; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i])); const g = pk ? 0.891 / pk : 1; for (let i = 0; i < L.length; i++) { L[i] *= g; R[i] *= g; } }
    if (kind === 'reverse') { L.reverse(); R.reverse(); }
    if (kind === 'trim') { const thr = 0.003; while (a < b && Math.abs(L[a]) < thr && Math.abs(R[a]) < thr) a++; while (b > a && Math.abs(L[b - 1]) < thr && Math.abs(R[b - 1]) < thr) b--; }
    const wav = encodeWav({ left: L.subarray(a, b), right: R.subarray(a, b), rate: 48000 });
    const name = `${m.name.replace(/\.[^.]+$/, '')} (${{ normalize: '노멀라이즈', reverse: '거꾸로', trim: '자름' }[kind]}).wav`;
    const hash = await addMedia(p, name, wav);
    p.media[hash].bpm = m.bpm;
    this.edit(() => { c.media = hash; }, true, name);
    this.playlist.peakCache.delete(hash);
  }

  // render a channel to audio, put it on the playlist and mute the original
  async freeze(ch) {
    this.status(`${ch.name} 굳히는 중…`);
    try {
      const mix = await renderMix({ ...this._proj, mode: this._proj.playlist.clips.length ? 'song' : 'pattern' }, { only: ch.id, offset: 0, tail: 2 });
      const wav = encodeWav(mix);
      const hash = await addMedia(this._proj, `${ch.name} (굳힘).wav`, wav);
      this._proj.media[hash].bpm = this._proj.bpm; // rendered at the project tempo: never stretch it
      this.addAudioClipFromHash(hash, null, 0);
      this.edit(() => { ch.mute = true; });
      this.status(`${ch.name}을(를) 오디오로 굳혔습니다. 원래 채널은 음소거했어요.`);
    } catch (err) { this.status(`굳히지 못했습니다: ${err.message}`); }
  }

  // sing a channel's melody with its lyrics (NNSVS in the main process) onto an audio track
  async sing(ch) {
    const { melodyOf, toMusicXml, unsupported } = await import('../vocal.js');
    const p = this._proj;
    const notes = melodyOf(p, ch.id);
    if (!notes.length) { this.status('이 채널에 노트가 없습니다. 피아노 롤에 멜로디를 먼저 입력해 주세요.'); return { ok: false }; }
    const bad = unsupported(ch.vocal?.lyrics);
    if (bad.length) { this.status('가사는 히라가나나 가타카나로 써 주세요.'); return { ok: false }; }
    const { xml } = toMusicXml(p, notes, ch.vocal?.lyrics);
    const off = window.melofi.onVocalProgress((m) => this.status(m));
    this.status('노래를 만드는 중…');
    let r;
    try { r = await window.melofi.vocalRender({ xml, voice: ch.vocal?.voice }); } finally { off(); }
    if (!r.ok) { this.status(r.message); return r; }
    const name = `${ch.name} (노래)`;
    const hash = await addMedia(p, `${name}.wav`, r.wav);
    p.media[hash].bpm = p.bpm; // sung at the project tempo: never stretch it
    // a new take replaces the last one
    const old = p.channels.find((c) => c.kind === 'audio' && c.name === name);
    if (old) this.edit(() => { p.playlist.clips = p.playlist.clips.filter((c) => c.ch !== old.id); });
    this.addAudioClipFromHash(hash, null, 0);
    this.edit(() => { ch.mute = true; });
    this.status(`${ch.name}의 가창 오디오를 생성했습니다 (${r.seconds}초). 기존 채널은 음소거 처리되었습니다.`);
    return r;
  }

  // ---------- audio recording (microphone / line in) ----------
  async toggleAudioRec() {
    if (this.arec) return this.stopAudioRec();
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2 } }); } catch { this.status('마이크를 쓸 수 없습니다. 윈도우 설정에서 마이크 권한을 확인하세요.'); return; }
    const ctx = this.engine.ctx;
    await ctx.audioWorklet.addModule('melofi://app/renderer/js/pcm-tap.js').catch(() => {});
    const src = ctx.createMediaStreamSource(stream), tap = new AudioWorkletNode(ctx, 'pcm-tap', { numberOfOutputs: 0 });
    const chunks = [];
    tap.port.onmessage = (e) => chunks.push(e.data);
    src.connect(tap);
    const p = this._proj;
    if (p.mode !== 'song') this.setMode('song');
    const startTick = this.transport.playing ? this.transport.songPos() : this.transport.base + this.transport.pos;
    tap.port.postMessage('start');
    if (!this.transport.playing) this.transport.play();
    this.arec = { stream, src, tap, chunks, startTick, latency: (ctx.baseLatency || 0) + (ctx.outputLatency || 0) };
    this.renderToolbar();
    this.status('오디오 녹음 중… 다시 누르면 멈춥니다');
  }

  async stopAudioRec() {
    const r = this.arec;
    this.arec = null;
    r.tap.port.postMessage('stop');
    await new Promise((res) => setTimeout(res, 150));
    r.src.disconnect(); r.stream.getTracks().forEach((t) => t.stop());
    this.transport.pause();
    const n = r.chunks.reduce((s, c) => s + c[0].length, 0), rate = this.engine.ctx.sampleRate;
    const skip = Math.min(n, Math.round(r.latency * rate)); // what we heard came out late: shift the take earlier
    const L = new Float32Array(n), R = new Float32Array(n);
    let o = 0;
    for (const [l, rr] of r.chunks) { L.set(l, o); R.set(rr, o); o += l.length; }
    if (n < rate * 0.2) { this.status('녹음이 너무 짧습니다'); this.renderToolbar(); return; }
    const wav = encodeWav({ left: L.subarray(skip), right: R.subarray(skip), rate });
    const bt = barTicks(this._proj);
    const hash = await addMedia(this._proj, `녹음 ${new Date().toLocaleTimeString('ko-KR', { hour12: false })}.wav`, wav);
    this._proj.media[hash].bpm = null;
    this.addAudioClipFromHash(hash, null, Math.round((r.startTick / bt) * 16) / 16);
    this.renderToolbar();
    this.status('녹음을 오디오 클립으로 넣었습니다');
  }

  // one bar of clicks, then play (recording starts on the downbeat)
  playWithCountIn() {
    const T2 = this.transport, p = this._proj;
    if (!this.countIn) { T2.play(); return; }
    const ctx = this.engine.ctx, beat = 60 / p.bpm * (4 / p.sig[1]), t0 = ctx.currentTime + 0.1;
    for (let i = 0; i < p.sig[0]; i++) this.engine.tick(t0 + i * beat, i === 0);
    this.status('하나, 둘, 셋, 넷…');
    setTimeout(() => { this.status(''); T2.play(); }, (0.1 + p.sig[0] * beat) * 1000 - 50);
  }

  // tap the button in time: the tempo follows the last few taps
  tap() {
    const now = performance.now();
    this.taps = this.taps.filter((t) => now - t < 2500);
    this.taps.push(now);
    if (this.taps.length < 3) { this.status('박자에 맞춰 계속 누르세요'); return; }
    const gaps = this.taps.slice(1).map((t, i) => t - this.taps[i]);
    const bpm = Math.round(60000 / (gaps.reduce((a, b) => a + b, 0) / gaps.length));
    if (bpm >= 40 && bpm <= 250) { this.edit(() => { this._proj.bpm = bpm; }, true, `탭 템포 ${bpm}`); this.engine.info.bpm = bpm; this.status(`템포 ${bpm}`); }
  }

  // FL's "dump score log": what you just played (without recording) becomes notes in the pattern
  dumpScoreLog(minutes = 1) {
    const now = performance.now(), chId = this._proj.selected;
    const notes = this.scoreLog.filter((x) => x.ch === chId && now - x.on < minutes * 60e3);
    if (!notes.length) { this.status('최근에 이 채널로 연주한 음이 없습니다'); return; }
    const p = this._proj, msPerTick = 60000 / p.bpm / PPQ;
    const t0 = notes[0].on;
    const pat = pattern(p);
    this.edit(() => {
      const list = notesOf(pat, chId);
      let end = 0;
      for (const x of notes) {
        const t = Math.round((x.on - t0) / msPerTick / this.snap) * this.snap;
        const d = Math.max(this.snap, Math.round(((x.off ?? now) - x.on) / msPerTick / this.snap) * this.snap);
        list.push({ t, d, n: x.n, v: x.v });
        end = Math.max(end, t + d);
      }
      pat.bars = Math.max(pat.bars, Math.min(16, Math.ceil(end / barTicks(p))));
    }, true, '방금 연주한 것 넣기');
    this.status(`${notes.length}개 음을 패턴에 넣었습니다. 박자가 어긋나면 도구 › 퀀타이즈를 쓰세요.`);
    this.setTab('roll');
    this.roll.focusNotes();
  }

  // ---------- automation & MIDI learn (right-click on any knob / fader) ----------
  valueOf(target) {
    const p = this._proj, [kind, id, a, b] = target.split(':');
    if (kind === 'master') return p.master.vol;
    const o = kind === 'ch' ? p.channels.find((c) => c.id === id) : kind === 'bus' ? p.buses.find((x) => x.id === id) : null;
    if (o) return a === 'pan' ? (o.pan + 1) / 2 : a === 'send' ? o.send : o.vol;
    if (kind === 'fx') {
      const list = id === 'master' ? p.master.fx : (p.channels.find((c) => c.id === id) || p.buses.find((x) => x.id === id))?.fx;
      const f = list?.find((x) => x.id === a), spec = f && FX_TYPES[f.type].params.find((q) => q.key === b);
      return spec ? toNorm(spec, f.params[b] ?? spec.def) : 0.5;
    }
    return 0.5;
  }

  setValue(target, v) {
    const p = this._proj, [kind, id, a, b] = target.split(':');
    if (kind === 'master') p.master.vol = v;
    const o = kind === 'ch' ? p.channels.find((c) => c.id === id) : kind === 'bus' ? p.buses.find((x) => x.id === id) : null;
    if (o) { if (a === 'pan') o.pan = v * 2 - 1; else if (a === 'send') o.send = v; else o.vol = v; this.applyStrips(); }
    if (kind === 'fx') {
      const list = id === 'master' ? p.master.fx : (p.channels.find((c) => c.id === id) || p.buses.find((x) => x.id === id))?.fx;
      const f = list?.find((x) => x.id === a), spec = f && FX_TYPES[f.type].params.find((q) => q.key === b);
      if (spec) { f.params[b] = fromNorm(spec, v); this.applyFx(id); }
    }
    if (kind === 'master') this.applyStrips();
    this.dirty = true;
  }

  controlMenu(e, target, label) {
    const map = this._proj.midiMap.filter((m) => m.target === target);
    popup(e.clientX, e.clientY, [
      { label: '자동화 클립 만들기', hint: '시간에 따라 값 바꾸기', act: () => this.makeAutomation(target, label) },
      { label: this.learn === target ? 'MIDI 연결 대기 중… (취소)' : 'MIDI 컨트롤러 연결', hint: '다음에 움직인 노브', act: () => { this.learn = this.learn === target ? null : target; this.status(this.learn ? 'MIDI 컨트롤러의 노브나 슬라이더를 움직이세요' : ''); } },
      ...(map.length ? [{ label: `MIDI 연결 해제 (CC ${map[0].cc})`, act: () => this.edit(() => { this._proj.midiMap = this._proj.midiMap.filter((m) => m.target !== target); }) }] : []),
    ]);
  }

  makeAutomation(target, label) {
    const p = this._proj, v = this.valueOf(target);
    const len = Math.max(4, songBars(p));
    const name = this.targetName(target, label);
    this.edit(() => {
      const a = { id: uid('a'), name, color: '#9a8cd6', target, len, points: [{ t: 0, v }, { t: 1, v }] };
      p.autos.push(a);
      const tr = p.playlist.tracks.length;
      p.playlist.tracks.push({ ...newTrack(tr), name: `자동화: ${name}` });
      p.playlist.clips.push({ id: uid('k'), kind: 'auto', auto: a.id, track: tr, start: 0, len });
      p.mode = 'song';
    }, true, '자동화 클립 만들기');
    this.setTab('playlist');
    this.playlist.scrollTrack = Math.max(0, p.playlist.tracks.length - 4);
    this.status('자동화 클립 안을 클릭해 점을 찍고 끌어서 값을 바꾸세요');
  }

  targetName(target, label) {
    const p = this._proj, [kind, id, a, b] = target.split(':');
    const owner = kind === 'master' || id === 'master' ? '마스터' : (p.channels.find((c) => c.id === id) || p.buses.find((x) => x.id === id))?.name || '';
    if (kind === 'fx') { const list = id === 'master' ? p.master.fx : (p.channels.find((c) => c.id === id) || p.buses.find((x) => x.id === id))?.fx; const f = list?.find((x) => x.id === a); const spec = f && FX_TYPES[f.type].params.find((q) => q.key === b); return `${owner} ${FX_TYPES[f?.type]?.name || ''} ${spec?.label || label || ''}`.trim(); }
    return `${owner} ${{ vol: '볼륨', pan: '팬', send: '리버브' }[a] || label || '볼륨'}`.trim();
  }

  // MIDI controller messages (from the app's MIDI input)
  cc(cc, val, ch) {
    if (!this.isOpen) return;
    if (this.learn) {
      const target = this.learn;
      this.learn = null;
      this.edit(() => { this._proj.midiMap = this._proj.midiMap.filter((m) => m.target !== target && !(m.cc === cc && m.ch === ch)); this._proj.midiMap.push({ cc, ch, target }); });
      this.status(`CC ${cc}번을 ${this.targetName(target)}에 연결했습니다`);
      return;
    }
    let hit = false;
    for (const m of this._proj.midiMap) if (m.cc === cc && m.ch === ch) { this.setValue(m.target, val / 127); hit = true; }
    if (hit && !this.ccRender) this.ccRender = setTimeout(() => { this.ccRender = null; if (this.tab === 'mixer') this.mixer.render(); this.rack.render(); }, 120);
  }

  // ---------- files ----------
  // a VST plugin's settings live in the helper: copy them into the project before it is saved
  async captureVstStates() {
    for (const c of this._proj.channels) {
      if (c.kind !== 'vst' || !c.vst?.plugin) continue;
      const r = await window.melofi.vstGetState(c.id);
      if (r.ok) c.vst.state = r.state;
    }
  }

  // VST plugins found by the helper, grouped for a menu; scans the first time
  async vstMenu(x, y, onPick) {
    const st = await window.melofi.vstStatus();
    if (!st.available) { this.status('VST 호스트를 찾을 수 없습니다. MeloFi를 재설치해 주세요.'); return; }
    let plugins = st.plugins, folders = st.folders;
    const rescan = async (more = folders) => {
      this.status('VST 플러그인 스캔 중… (최초 실행 시 시간이 걸릴 수 있습니다)');
      const r = await window.melofi.vstScan(more);
      if (!r.ok) { this.status(`VST 플러그인을 찾지 못했습니다: ${r.message || r.error}`); return null; }
      this.status(`VST 플러그인 ${r.plugins.length}개를 찾았습니다.`);
      return r.plugins;
    };
    if (!st.scannedAt) plugins = (await rescan()) || [];
    const inst = plugins.filter((p) => p.instrument), fx = plugins.filter((p) => !p.instrument);
    popup(x, y, [
      { group: inst.length ? 'VST 악기' : 'VST 악기가 없습니다' },
      ...inst.map((p) => ({ label: p.name, hint: p.vendor, act: () => onPick(p) })),
      ...(fx.length ? [{ group: `이펙트 ${fx.length}개는 아직 채널 트랙에 적용할 수 없습니다` }] : []),
      { sep: true },
      { label: '다시 찾기', hint: 'C:\\Program Files\\Common Files\\VST3', act: async () => { if (await rescan()) this.vstMenu(x, y, onPick); } },
      { label: '플러그인 폴더 추가…', act: async () => { const d = await window.melofi.mediaPickFolder(); if (d) { folders = [...new Set([...folders, d])]; if (await rescan(folders)) this.vstMenu(x, y, onPick); } } },
    ]);
  }

  async save(as = false) {
    await this.captureVstStates();
    const p = await saveProject(this._proj, as ? null : this.path);
    if (p) { this.path = p; this.app.ui.toast('저장됨', { path: p }); }
  }

  async openFile() {
    const r = await openProject();
    if (r) this.setProject(r.project, r.path);
  }

  async openPath(path) {
    const f = await window.melofi.studioOpenPath(path);
    if (f) this.setProject(JSON.parse(f.text), f.path);
  }

  newFromTemplate(x = innerWidth / 2 - 120, y = 120) {
    popup(x, y, [
      { group: '새 프로젝트' },
      ...Object.entries(TEMPLATES).map(([k, t]) => ({ label: t.name, hint: t.hint, act: () => {
        if (this.dirty && !confirm('새 프로젝트를 만들까요? 저장하지 않은 변경 사항은 자동 저장본에만 남습니다.')) return;
        this.setProject(t.make());
      } })),
    ]).classList.add('tall');
  }

  async recentMenu(e) {
    const list = await window.melofi.studioRecent();
    const vers = await window.melofi.studioVersions();
    popup(e.clientX, e.clientY, [
      { group: '최근 프로젝트' },
      ...(list.length ? list.map((r) => ({ label: r.name, hint: new Date(r.at).toLocaleDateString('ko-KR'), act: () => this.openPath(r.path) })) : [{ label: '없음', disabled: true }]),
      { group: '자동 저장 기록 (5분마다)' },
      ...(vers.length ? vers.slice(0, 12).map((v) => ({ label: v, act: async () => { const t = await window.melofi.studioVersion(v); if (t) this.setProject(JSON.parse(t)); } })) : [{ label: '없음', disabled: true }]),
    ]).classList.add('tall');
  }

  async exportMidi() {
    const data = projectToMidi(this._proj, (id) => this.isKit(id));
    const saved = await window.melofi.saveRecording({ dir: this.app.settings.get('recDir'), base: this._proj.name, files: [{ ext: 'mid', data }] });
    this.app.ui.toast('MIDI 저장됨', { path: saved.files[0], action: { label: '폴더 열기', fn: () => window.melofi.showItem(saved.files[0]) } });
  }

  // WAV / MP3, the whole song or the loop region
  async exportAudio() {
    const p = this._proj;
    const v = await form('오디오로 내보내기', [
      { key: 'format', label: '형식', type: 'select', value: 'wav24', options: [['wav24', 'WAV 24비트 (원본 품질)'], ['wav16', 'WAV 16비트 (CD)'], ['mp3', 'MP3 320kbps']] },
      { key: 'range', label: '범위', type: 'select', value: 'all', options: [['all', p.playlist.clips.length ? '곡 전체' : '현재 패턴'], ...(p.loop ? [['loop', `반복 구간 (${p.loop.start + 1}~${p.loop.end}마디)`]] : [])] },
      { key: 'tail', label: '끝 여운 (초)', type: 'number', value: 3, min: 0, max: 10, step: 0.5 },
    ], { ok: '내보내기' });
    if (!v) return;
    this.status('렌더링 중…');
    try {
      const mix = await renderMix(p, { range: v.range === 'loop' ? p.loop : null, tail: v.tail, onProgress: (ph, x) => this.status(ph === 'load' ? `악기 불러오는 중 ${Math.round(x * 100)}%` : '렌더링 중…') });
      let data, ext = 'wav';
      if (v.format === 'mp3') { data = await mp3(mix, 320); ext = 'mp3'; }
      else if (v.format === 'wav16') data = wav16(mix);
      else data = encodeWav(mix);
      const saved = await window.melofi.saveRecording({ dir: this.app.settings.get('recDir'), base: p.name, files: [{ ext, data }] });
      this.status('');
      this.app.ui.toast(`${ext.toUpperCase()} 저장됨`, { path: saved.files[0], action: { label: '폴더 열기', fn: () => window.melofi.showItem(saved.files[0]) } });
    } catch (err) {
      console.error(err);
      this.status(`내보내지 못했습니다: ${err.message}`);
    }
  }
  exportWav() { return this.exportAudio(); }

  // a falling-notes video of the arrangement, with its real mix as the soundtrack
  async exportVideo() {
    const p = this._proj;
    const v = await form('영상으로 내보내기', [
      { key: 'res', label: '해상도', type: 'select', value: '1080', options: [['2160', '4K'], ['1440', '1440p'], ['1080', '1080p']] },
      { key: 'fps', label: '프레임', type: 'select', value: 60, options: [[60, '60fps'], [30, '30fps']] },
    ], { ok: '만들기', note: '피아노 화면의 테마와 배경으로, 모든 채널의 노트가 떨어지는 영상을 만듭니다.' });
    if (!v) return;
    const mode = p.playlist.clips.length ? 'song' : 'pattern';
    const src = { ...p, mode };
    const { events, length, base } = eventsFor(src);
    const sec = (t) => tickToSec(src, base + t, mode) - tickToSec(src, base, mode);
    const notes = events.filter((e) => e.type === 'n' && !e.slide).map((e) => ({ t: sec(e.tick), d: Math.max(0.05, sec(e.tick + e.d) - sec(e.tick)), n: e.n, v: e.v, color: p.channels.find((c) => c.id === e.ch)?.color }));
    const duration = sec(length);
    this.close();
    await this.app.renderVideo({ height: +v.res, fps: +v.fps }, {
      title: p.name, duration, notes,
      render: async (lead, dur, progress) => {
        const mix = await renderMix(src, { offset: lead, tail: Math.max(0, dur - lead - duration), onProgress: (ph, x) => progress(ph === 'render' ? 0.5 + x / 2 : x / 2) });
        const ab = new AudioBuffer({ length: mix.left.length, numberOfChannels: 2, sampleRate: mix.rate });
        ab.copyToChannel(mix.left, 0); ab.copyToChannel(mix.right, 1);
        return ab;
      },
    });
    if (this.app.studioWindow) await this.open(); // its own window: back to the composer
  }

  async importMidi() {
    const f = await window.melofi.studioOpenMidi();
    if (f) this.setProject(midiToProject(f.data, f.name));
  }

  // one pattern per channel (FL's "split by channel"), the playlist clips follow
  splitByChannel() {
    const p = this._proj, pat = pattern(p);
    const chans = Object.entries(pat.notes).filter(([, l]) => l.length);
    if (chans.length < 2) { this.status('나눌 채널이 두 개 이상이어야 합니다'); return; }
    this.edit(() => {
      const made = chans.map(([chId, list], i) => {
        const np = newPattern(p.patterns.length + i, pat.bars);
        np.name = `${pat.name} - ${p.channels.find((c) => c.id === chId)?.name || ''}`;
        np.notes = { [chId]: list.map((n) => ({ ...n })) };
        return np;
      });
      p.patterns.push(...made);
      const clips = p.playlist.clips.filter((c) => c.pattern === pat.id);
      for (const c of clips) {
        p.playlist.clips.splice(p.playlist.clips.indexOf(c), 1);
        made.forEach((np, i) => {
          const tr = c.track + i;
          while (p.playlist.tracks.length <= tr) p.playlist.tracks.push(newTrack(p.playlist.tracks.length));
          p.playlist.clips.push({ ...c, id: uid('k'), pattern: np.id, track: tr });
        });
      }
      p.current = made[0].id;
    }, true, '채널별로 나누기');
  }

  // ---------- keys ----------
  shortcut(e) {
    const map = { ...Object.fromEntries(Object.entries(ACTIONS).map(([k, [, d]]) => [k, d])), ...(this.app.settings.get('studioKeys') || {}) };
    const combo = comboOf(e);
    return Object.keys(map).find((k) => map[k] === combo) || null;
  }

  runAction(a) {
    const T2 = this.transport;
    switch (a) {
      case 'play': T2.toggle(); this.renderToolbar(); break;
      case 'record': T2.recording = !T2.recording; if (T2.recording && !T2.playing) this.playWithCountIn(); this.renderToolbar(); break;
      case 'undo': if (this.history.undo()) this.app.ui.toast('실행 취소', { ms: 900 }); break;
      case 'redo': this.history.redo(); break;
      case 'save': this.save(); break;
      case 'open': this.openFile(); break;
      case 'keys': this.toggleKeys(); break;
      case 'metro': T2.metro = !T2.metro; this.renderToolbar(); break;
      case 'loop': if (this._proj.loop) this.edit(() => { this._proj.loopOn = !this._proj.loopOn; }); break;
      case 'roll': case 'playlist': case 'mixer': case 'live': this.setTab(a); break;
      case 'draw': case 'chord': case 'slide': this.roll.tool = a; this.renderPaneBars(); this.roll.draw(); break;
      case 'tour': this.tour.start('beat'); break;
      default: return false;
    }
    return true;
  }

  key(e) {
    if (!this.isOpen) return false;
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return false;
    if (document.querySelector('.st-ask')) return false;
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 's') { e.preventDefault(); this.save(true); return true; }
    const a = this.shortcut(e);
    // single letters (draw / chord / slide / record) only when the roll is focused, so they still play notes elsewhere
    const letter = !e.ctrlKey && !e.altKey && e.key.length === 1;
    if (a && (!letter || (this.tab === 'roll' && document.activeElement === this.roll.c))) { e.preventDefault(); if (!e.repeat) this.runAction(a); return true; }
    if (e.key === 'Escape') { e.preventDefault(); if (this.tour.active) this.tour.stop(); else if (!this.app.studioWindow) this.close(); return true; }
    const inRoll = this.tab === 'roll' && (document.activeElement === this.roll.c || this.el.contains(document.activeElement) || document.activeElement === document.body);
    if (inRoll && this.roll.key(e)) { e.preventDefault(); return true; }
    if (this.tab === 'playlist' && document.activeElement === this.playlist.c && this.playlist.key(e)) { e.preventDefault(); return true; }
    return false;
  }

  keyUp(e) {
    if (!this.isOpen) return false;
    return e.code === 'Space';
  }

  toggleKeys() {
    this.keysOpen = !this.keysOpen;
    this.keysEl.hidden = !this.keysOpen;
    if (this.keysOpen) this.keys.render();
    this.renderToolbar();
    requestAnimationFrame(() => { this.roll.resize(); this.playlist.resize(); });
  }

  // ---------- sheets: undo history, shortcuts ----------
  historySheet(e) {
    const L = this.history.labels || [];
    if (!L.length) { popup(e.clientX, e.clientY, [{ label: '기록이 없습니다', disabled: true }]); return; }
    popup(e.clientX, e.clientY, [
      { group: '실행 기록 (누르면 그 시점으로)' },
      ...L.slice(-20).map((x, i, arr) => ({ label: x.label, hint: new Date(x.at).toLocaleTimeString('ko-KR', { hour12: false }), act: () => { for (let k = arr.length - i; k > 0; k--) this.history.undo(); } })).reverse(),
    ]).classList.add('tall');
  }

  async shortcutsSheet() {
    const cur = this.app.settings.get('studioKeys') || {};
    const v = await form('작곡 단축키', Object.entries(ACTIONS).map(([k, [label, def]]) => ({ key: k, label, type: 'text', value: cur[k] || def })),
      { ok: '저장', note: '예: Space, Ctrl+K, F5, B. 칸을 비우면 기본값으로 돌아갑니다.' });
    if (!v) return;
    const out = {};
    for (const [k, val] of Object.entries(v)) if (val && val !== ACTIONS[k][1]) out[k] = String(val).trim();
    this.app.settings.set({ studioKeys: out });
  }

  // ---------- UI ----------
  build() {
    const tb = h('div', { class: 'st-tool' });
    const tabs = h('div', { class: 'st-tabs' },
      ...[['roll', '피아노 롤'], ['playlist', '플레이리스트'], ['mixer', '믹서'], ['live', '라이브']].map(([k, l]) => h('button', { 'data-tab': k, onclick: () => this.setTab(k) }, l)));
    this.rackEl = h('div', { class: 'st-rack' });
    this.browserEl = h('div', { class: 'st-browser', hidden: true });
    this.rollBar = h('div', { class: 'pane-bar' });
    this.plBar = h('div', { class: 'pane-bar' });
    const rollWrap = h('div', { class: 'st-pane roll' }, this.rollBar, h('div', { class: 'cv' }, h('canvas', { tabIndex: 0 })));
    const plWrap = h('div', { class: 'st-pane playlist', hidden: true }, this.plBar, h('div', { class: 'cv' }, h('canvas', { tabIndex: 0 })));
    const mxWrap = h('div', { class: 'st-pane mixer', hidden: true });
    const lvWrap = h('div', { class: 'st-pane live', hidden: true });
    this.keysEl = h('div', { class: 'st-keys', hidden: true });
    this.statusEl = h('span', { class: 'st-status' });
    const split = h('div', { class: 'st-split', title: '끌어서 너비 조절' });
    this.mainEl = h('div', { class: 'st-main' },
      h('div', { class: 'st-left' },
        h('div', { class: 'st-head' },
          h('div', { class: 'st-ltabs' }, h('button', { 'data-l': 'rack', class: 'on', onclick: () => this.setLeft('rack') }, '채널 랙'), h('button', { 'data-l': 'browser', onclick: () => this.setLeft('browser') }, '브라우저')),
          this.patternBar = h('div', { class: 'st-patbar' })),
        this.rackEl, this.browserEl),
      split,
      h('div', { class: 'st-right' }, tabs, rollWrap, plWrap, mxWrap, lvWrap));
    this.el = h('div', { id: 'studio', hidden: true },
      tb, this.mainEl, this.keysEl,
      h('div', { class: 'st-foot' }, this.statusEl, h('span', { class: 'hint' }, `Space 재생/정지 · Ctrl+Z 실행 취소 · Ctrl+S 저장 · Ctrl+K 화면 건반${this.app.studioWindow ? '' : ' · Esc 피아노로'}`)));
    document.body.append(this.el);
    // hint bar (like FL's): what the control under the mouse does
    this.hintEl = this.el.querySelector('.st-foot .hint');
    const baseHint = this.hintEl.textContent;
    this.el.addEventListener('mouseover', (e) => { const t = e.target.closest('[title]'); this.hintEl.textContent = t && this.el.contains(t) ? t.title : baseHint; });
    // the left / right split can be dragged; the width is remembered
    const setW = (w) => { this.mainEl.style.gridTemplateColumns = `${w}px 5px 1fr`; };
    setW(this.app.settings.get('studioLeftW') || 520);
    split.addEventListener('pointerdown', (e) => {
      split.setPointerCapture(e.pointerId);
      const move = (ev) => setW(Math.max(300, Math.min(innerWidth - 400, ev.clientX)));
      const up = (ev) => { split.removeEventListener('pointermove', move); split.removeEventListener('pointerup', up); this.app.settings.set({ studioLeftW: Math.max(300, Math.min(innerWidth - 400, ev.clientX)) }); this.roll.resize(); this.playlist.resize(); };
      split.addEventListener('pointermove', move); split.addEventListener('pointerup', up);
    });
    // a file dropped on the rack becomes a sample channel
    this.rackEl.addEventListener('dragover', (e) => { e.preventDefault(); });
    this.rackEl.addEventListener('drop', async (e) => {
      e.preventDefault();
      const path = e.dataTransfer.getData('application/x-melofi-file');
      if (path) { const data = await window.melofi.mediaRead(path); if (data) this.addSampleChannel('sample', null, { name: path.split(/[\\/]/).pop(), data }); return; }
      const f = [...e.dataTransfer.files].find((x) => /\.(wav|mp3|ogg|flac|m4a|aif|aiff)$/i.test(x.name));
      if (f) this.addSampleChannel('sample', null, { name: f.name, data: new Uint8Array(await f.arrayBuffer()) });
    });
    this.toolEl = tb;
    this.rack = new Rack(this, this.rackEl);
    this.browser = new Browser(this, this.browserEl);
    this.roll = new Roll(this, rollWrap.querySelector('canvas'));
    this.playlist = new Playlist(this, plWrap.querySelector('canvas'));
    this.mixer = new Mixer(this, mxWrap);
    this.live = new Live(this, lvWrap);
    this.keys = new Keys(this, this.keysEl);
    this.panes = { roll: rollWrap, playlist: plWrap, mixer: mxWrap, live: lvWrap };
    new ResizeObserver(() => { if (!this.isOpen) return; if (this.tab === 'roll') this.roll.resize(); if (this.tab === 'playlist') this.playlist.resize(); }).observe(rollWrap.parentElement);
    this.setTab('roll');
  }

  renderAll() {
    if (!this.el) return;
    this.renderToolbar();
    this.renderPatternBar();
    this.renderPaneBars();
    this.rack.render();
    this.roll.draw();
    this.playlist.draw();
    if (this.tab === 'mixer') this.mixer.render();
    if (this.tab === 'live') this.live.render();
    if (this.leftTab === 'browser') this.browser.render();
    if (this._chs && !this._chs.el.hidden) this._chs.render();
  }

  renderToolbar() {
    const proj = this._proj, Tr = this.transport;
    const btn = (label, title, act, cls = '', tour) => h('button', { class: `btn ${cls}`, title, onclick: act, 'data-tour': tour }, label);
    this.toolEl.replaceChildren(
      this.app.studioWindow ? btn('피아노 창', '피아노 창으로 이동', () => window.melofi.focusMainWindow(), 'ghost') : btn('← 피아노', '피아노 화면으로 (Esc)', () => this.close(), 'ghost'),
      h('input', { class: 'st-name', value: proj.name, title: '프로젝트 이름', onchange: (e) => { proj.name = e.target.value || '새 프로젝트'; this.dirty = true; } }),
      h('div', { class: 'seg st-mode', 'data-tour': 'mode' },
        h('button', { class: proj.mode === 'pattern' ? 'on' : '', title: '지금 패턴만 반복', onclick: () => this.setMode('pattern') }, '패턴'),
        h('button', { class: proj.mode === 'song' ? 'on' : '', title: '플레이리스트 전체', onclick: () => this.setMode('song') }, '곡'),
        h('button', { class: proj.mode === 'live' ? 'on' : '', title: '라이브: 트랙마다 패턴을 골라 실시간으로', onclick: () => { this.setMode('live'); this.setTab('live'); } }, '라이브')),
      btn(Tr.playing ? '❚❚' : '▶', '재생 / 일시정지 (Space)', () => { Tr.toggle(); this.renderToolbar(); }, 'play', 'play'),
      btn('■', '정지', () => { Tr.stop(); this.renderToolbar(); }),
      btn('●', '노트 녹음: 재생 중 건반으로 친 음을 패턴에 기록', () => this.runAction('record'), `rec${Tr.recording ? ' on' : ''}`, 'rec'),
      btn(this.arec ? '마이크 녹음 중' : '마이크', '마이크나 오디오 입력을 녹음해 플레이리스트에 넣기', () => this.toggleAudioRec(), this.arec ? 'rec on' : ''),
      this.posEl = h('span', { class: 'st-pos' }, '1:1:1'),
      h('label', { class: 'st-field', 'data-tour': 'bpm' }, 'BPM', h('input', { type: 'number', min: 30, max: 300, step: 1, value: proj.bpm, onchange: (e) => { this.edit(() => { proj.bpm = Math.max(30, Math.min(300, +e.target.value || 120)); }); this.engine.info.bpm = proj.bpm; this.syncAudio(); } })),
      btn('탭', '박자에 맞춰 여러 번 누르면 그 빠르기로 템포가 맞춰집니다', () => this.tap(), 'sm'),
      h('label', { class: 'st-field' }, '박자', h('select', { onchange: (e) => this.edit(() => { proj.sig = e.target.value.split('/').map(Number); }) },
        ...['4/4', '3/4', '6/8', '5/4', '7/8'].map((s) => h('option', { value: s, selected: proj.sig.join('/') === s }, s)))),
      h('label', { class: 'st-field' }, '스윙', h('input', { type: 'range', min: 0, max: 0.6, step: 0.05, value: proj.swing, oninput: (e) => { proj.swing = +e.target.value; this.transport.refresh(); this.dirty = true; } })),
      h('label', { class: 'st-field' }, '스냅', h('select', { onchange: (e) => { this.snapKey = e.target.value === 'bar' ? 'bar' : +e.target.value; this.roll.draw(); } },
        ...SNAPS.map(([v, l]) => h('option', { value: v, selected: String(this.snapKey) === String(v) }, l)))),
      btn(Tr.metro ? '메트로놈 ●' : '메트로놈', '메트로놈 (Ctrl+M)', () => this.runAction('metro'), Tr.metro ? 'on' : ''),
      btn('건반', '화면 건반 (Ctrl+K)', () => this.toggleKeys(), this.keysOpen ? 'on' : '', 'keys'),
      h('span', { class: 'sp' }),
      h('button', { class: 'btn', title: '실행 취소 (Ctrl+Z) · 우클릭: 실행 기록', onclick: () => this.history.undo(), oncontextmenu: (e) => { e.preventDefault(); this.historySheet(e); } }, '↶'),
      btn('↷', '다시 실행 (Ctrl+Y)', () => this.history.redo()),
      btn('튜토리얼', '처음부터 하나씩 안내', (e) => popup(e.clientX, e.clientY + 12, CHAPTERS.map((c, i) => ({ label: `${i + 1}. ${c.name}`, act: () => this.tour.start(c.id) })))),
      btn('파일 ▾', '새로 / 열기 / 저장 / 내보내기', (e) => popup(e.clientX, e.clientY + 12, [
        { label: '새 프로젝트 (템플릿)…', act: () => this.newFromTemplate(e.clientX - 200, e.clientY + 12) },
        { label: '열기…', hint: 'Ctrl+O', act: () => this.openFile() },
        { label: '최근 프로젝트 · 자동 저장 기록…', act: () => this.recentMenu(e) },
        { label: '저장', hint: 'Ctrl+S', act: () => this.save() },
        { label: '다른 이름으로 저장…', hint: 'Ctrl+Shift+S', act: () => this.save(true) },
        { sep: true },
        { label: '오디오로 내보내기 (WAV · MP3)…', act: () => this.exportAudio() },
        { label: 'MIDI로 내보내기', act: () => this.exportMidi() },
        { label: '영상으로 내보내기…', act: () => this.exportVideo() },
        { label: 'MIDI 가져오기…', act: () => this.importMidi() },
        { label: 'AI로 곡 분석 · 재구성…', hint: 'MP4 · WAV · MP3', act: () => this.aiSheet.show() },
        { sep: true },
        { label: T.daw.open, act: () => this.dawSheet.show() },
        { label: T.cloud.menuSave, act: () => this.cloudSheet.show('projects') },
        { label: T.cloud.menuShared, act: () => this.cloudSheet.show('shared') },
        { label: T.cloud.menuAccount, act: () => this.cloudSheet.show('account') },
        { sep: true },
        { label: '단축키 설정…', act: () => this.shortcutsSheet() },
      ]), '', 'file'),
    );
  }

  // tool bars above the piano roll and the playlist
  renderPaneBars() {
    if (!this.rollBar) return;
    const proj = this._proj, R = this.roll, P = this.playlist;
    const sc = proj.scale;
    const tool = (k, label, title, tour) => h('button', { class: R.tool === k ? 'on' : '', title, 'data-tour': tour, onclick: () => { R.tool = k; this.renderPaneBars(); R.draw(); } }, label);
    this.rollBar.replaceChildren(
      h('div', { class: 'seg sm' }, tool('draw', '그리기', '음 찍기 (B)'), tool('chord', '코드', '클릭 한 번에 화음 (H)', 'tool-chord'), tool('slide', '슬라이드', '음높이를 미끄러지듯 잇는 노트 (G)')),
      R.tool === 'chord' ? h('select', { title: '화음 종류', onchange: (e) => { R.chord = e.target.value; R.draw(); } }, ...Object.entries(CHORDS).map(([k, c]) => h('option', { value: k, selected: R.chord === k }, c.name))) : null,
      R.tool === 'chord' && R.chord === 'auto' ? h('select', { title: '음 개수', onchange: (e) => { R.chordSize = +e.target.value; } }, h('option', { value: 3, selected: R.chordSize === 3 }, '3화음'), h('option', { value: 4, selected: R.chordSize === 4 }, '7화음')) : null,
      h('span', { class: 'bar-gap' }),
      h('label', { class: 'st-field', 'data-tour': 'scale' }, '스케일',
        h('select', { onchange: (e) => this.edit(() => { proj.scale = e.target.value === '' ? null : { root: +e.target.value, type: proj.scale?.type || 'major' }; }) },
          h('option', { value: '', selected: !sc }, '끔'), ...ROOTS.map((r, i) => h('option', { value: i, selected: sc?.root === i }, r))),
        sc ? h('select', { onchange: (e) => this.edit(() => { proj.scale = { ...proj.scale, type: e.target.value }; }) }, ...Object.entries(SCALES).map(([k, s]) => h('option', { value: k, selected: sc.type === k }, s.name))) : null,
        sc ? h('label', { class: 'chk', title: '스케일 밖의 음은 찍히지 않습니다' }, h('input', { type: 'checkbox', checked: R.lock, onchange: (e) => { R.lock = e.target.checked; } }), '고정') : null),
      h('span', { class: 'bar-gap' }),
      h('label', { class: 'st-field' }, '아래 칸', h('select', { onchange: (e) => { R.lane = e.target.value; R.draw(); } }, ...Object.entries(LANES).map(([k, l]) => h('option', { value: k, selected: R.lane === k }, l)))),
      h('button', { class: 'btn sm', 'data-tour': 'tools', onclick: (e) => this.rollTools(e) }, '도구 ▾'),
      h('span', { class: 'sp' }),
      h('span', { class: 'hint' }, R.tool === 'chord' ? '클릭: 코드 찍기' : R.tool === 'slide' ? '노트를 누르면 슬라이드로 바뀜' : '클릭: 음 · 끌기: 길이 · 우클릭: 지우기'));
    const ptool = (k, label, title) => h('button', { class: P.tool === k ? 'on' : '', title, onclick: () => { P.tool = k; this.renderPaneBars(); P.draw(); } }, label);
    this.plBar.replaceChildren(
      h('div', { class: 'seg sm' }, ptool('draw', '그리기', '빈 곳 클릭: 지금 패턴 놓기'), ptool('slice', '자르기', '클립을 눌러 둘로 자르기 (C)')),
      h('div', { class: 'seg sm' }, h('button', { class: P.grid === 'bar' ? 'on' : '', onclick: () => { P.grid = 'bar'; this.renderPaneBars(); P.draw(); } }, '마디'), h('button', { class: P.grid === 'beat' ? 'on' : '', onclick: () => { P.grid = 'beat'; this.renderPaneBars(); P.draw(); } }, '박')),
      h('button', { class: `btn sm${proj.loopOn ? ' on' : ''}`, disabled: !proj.loop, title: '눈금자를 끌어서 반복 구간을 정합니다 (Ctrl+L)', onclick: () => this.edit(() => { proj.loopOn = !proj.loopOn; }) }, proj.loop ? `반복 ${proj.loop.start + 1}~${proj.loop.end}마디` : '반복 구간 없음'),
      h('button', { class: 'btn sm', title: '오디오 파일을 클립으로', onclick: async () => { const fs2 = await window.melofi.mediaPickFiles(); for (const f of fs2) await this.addAudioClip(f.name, f.data); } }, '+ 오디오'),
      h('button', { class: 'btn sm', title: '노브를 우클릭해도 만들 수 있습니다', onclick: (e) => this.autoTargetMenu(e) }, '+ 자동화'),
      h('button', { class: 'btn sm', onclick: () => this.edit(() => proj.playlist.tracks.push(newTrack(proj.playlist.tracks.length))) }, '+ 트랙'),
      h('span', { class: 'sp' }),
      h('span', { class: 'hint' }, '눈금자 끌기: 반복 구간 · 위 띠 더블클릭: 마커 · 우클릭: 템포 변화 · Ctrl+끌기: 복제'));
  }

  rollTools(e) {
    const R = this.roll;
    popup(e.clientX, e.clientY + 12, [
      { label: '아르페지오…', hint: '화음을 한 음씩 펼치기', act: async () => { const v = await form('아르페지오', [
        { key: 'pattern', label: '순서', type: 'select', value: 'up', options: [['up', '아래에서 위로'], ['down', '위에서 아래로'], ['updown', '올라갔다 내려오기'], ['random', '무작위']] },
        { key: 'rate', label: '빠르기', type: 'select', value: STEP, options: [[PPQ / 2, '8분음표'], [STEP, '16분음표'], [STEP / 2, '32분음표'], [PPQ / 6, '16분 셋잇단']] },
        { key: 'octaves', label: '옥타브 범위', type: 'number', value: 1, min: 1, max: 3 },
        { key: 'gate', label: '음 길이 (%)', type: 'number', value: 90, min: 10, max: 100 }]); if (v) R.arpeggiate({ ...v, gate: v.gate / 100 }); } },
      { label: '스트럼…', hint: '기타처럼 살짝 엇갈리게', act: async () => { const v = await form('스트럼', [
        { key: 'spread', label: '엇갈림 정도', type: 'number', value: 3, min: 1, max: 24 },
        { key: 'direction', label: '방향', type: 'select', value: 'down', options: [['down', '다운 (높은 음부터)'], ['up', '업 (낮은 음부터)']] }]); if (v) R.strum(v); } },
      { label: '휴머나이즈…', hint: '사람이 친 것처럼', act: async () => { const v = await form('휴머나이즈', [
        { key: 'timing', label: '타이밍 흔들기 (틱)', type: 'number', value: 6, min: 0, max: 24 }, { key: 'velocity', label: '세기 흔들기', type: 'number', value: 12, min: 0, max: 40 }]); if (v) R.humanize(v); } },
      { label: '퀀타이즈…', hint: '박자에 맞추기', act: async () => { const v = await form('퀀타이즈', [
        { key: 'grid', label: '격자', type: 'select', value: this.snap, options: SNAPS.filter(([g]) => g !== 'bar').map(([g, l]) => [g, l]) },
        { key: 'strength', label: '강도 (%)', type: 'number', value: 100, min: 0, max: 100 }, { key: 'lengths', label: '길이도 맞추기', type: 'check', value: false }]); if (v) R.quantizeOpts({ ...v, strength: v.strength / 100 }); } },
      { label: '레가토', hint: '다음 음까지 길이 늘리기', act: () => R.legato() },
      { label: '노트 자르기 (스냅 길이로)', hint: '하이햇 롤, 트랩 연타', act: () => R.chop(this.snap) },
      { label: '노트 붙이기', hint: '같은 높이로 이어진 음 합치기', act: () => R.glue() },
      { sep: true },
      { label: '좌우 뒤집기', act: () => R.transform('reverse') },
      { label: '위아래 뒤집기', act: () => R.transform('flip') },
      { label: '한 옥타브 위로 겹치기', act: () => R.transform('octUp') },
      { label: '한 옥타브 아래로 겹치기', act: () => R.transform('octDown') },
      { label: '스케일에 맞추기', disabled: !this._proj.scale, act: () => R.transform('toScale') },
      { label: '세기 무작위', act: () => R.transform('randVel') },
      { sep: true },
      { label: '채널별로 패턴 나누기', hint: '가져온 MIDI 정리에', act: () => this.splitByChannel() },
      { label: '방금 연주한 것 패턴에 넣기', hint: '녹음 안 켜고 친 것도', act: () => this.dumpScoreLog(1) },
      { label: this.countIn ? '녹음 전 1마디 세기 끄기' : '녹음 전 1마디 세기 켜기', act: () => { this.countIn = !this.countIn; } },
    ]);
  }

  autoTargetMenu(e) {
    const p = this._proj;
    const items = [{ group: '채널' }];
    for (const c of p.channels) items.push({ label: `${c.name} 볼륨`, act: () => this.makeAutomation(`ch:${c.id}:vol`) }, { label: `${c.name} 팬`, act: () => this.makeAutomation(`ch:${c.id}:pan`) });
    const fxList = [['master', '마스터', p.master.fx], ...p.channels.map((c) => [c.id, c.name, c.fx]), ...p.buses.map((b) => [b.id, b.name, b.fx])];
    const fxItems = [];
    for (const [sid, name, list] of fxList) for (const f of list) for (const q of FX_TYPES[f.type].params) if (!q.choices && !q.channel) fxItems.push({ label: `${name} · ${FX_TYPES[f.type].name} ${q.label}`, act: () => this.makeAutomation(`fx:${sid}:${f.id}:${q.key}`) });
    if (fxItems.length) items.push({ group: '이펙트' }, ...fxItems);
    items.push({ group: '마스터' }, { label: '마스터 볼륨', act: () => this.makeAutomation('master:vol') });
    popup(e.clientX, e.clientY + 12, items).classList.add('tall');
  }

  renderPatternBar() {
    const proj = this._proj, pat = pattern(proj);
    this.patternBar.replaceChildren(
      h('select', { title: '패턴', onchange: (e) => this.setPattern(e.target.value) },
        ...proj.patterns.map((p) => h('option', { value: p.id, selected: p.id === proj.current }, p.name))),
      h('button', { class: 'btn sm', title: '새 패턴', onclick: () => this.edit(() => { const p = newPattern(proj.patterns.length, pat.bars); proj.patterns.push(p); proj.current = p.id; }, true, '새 패턴') }, '+'),
      h('button', { class: 'btn sm', title: '패턴 복제', onclick: () => this.edit(() => { const p = JSON.parse(JSON.stringify(pat)); p.id = uid('p'); p.name = `${pat.name} 복사`; proj.patterns.push(p); proj.current = p.id; }, true, '패턴 복제') }, '⧉'),
      h('button', { class: 'btn sm', title: '패턴 이름', onclick: async () => { const v = await ask('패턴 이름', pat.name); if (v && v.trim()) this.edit(() => { pat.name = v.trim(); }); } }, '이름'),
      h('select', { title: '패턴 길이', onchange: (e) => this.edit(() => { pat.bars = +e.target.value; }) },
        ...[1, 2, 4, 8, 16].map((b) => h('option', { value: b, selected: pat.bars === b }, `${b}마디`))),
      h('button', { class: 'btn sm', title: '패턴 삭제', disabled: proj.patterns.length <= 1, onclick: () => { if (confirm(`'${pat.name}'을(를) 삭제할까요?`)) this.edit(() => { proj.patterns.splice(proj.patterns.indexOf(pat), 1); proj.playlist.clips = proj.playlist.clips.filter((c) => c.pattern !== pat.id); proj.current = proj.patterns[0].id; }, true, '패턴 삭제'); } }, '삭제'),
    );
  }

  updatePos() {
    if (!this.posEl) return;
    const proj = this._proj, Tk = this.transport.songPos(), bt = barTicks(proj), beat = (PPQ * 4) / proj.sig[1];
    const bar = Math.floor(Tk / bt), b = Math.floor((Tk % bt) / beat), s = Math.floor((Tk % beat) / STEP);
    this.posEl.textContent = `${bar + 1}:${b + 1}:${s + 1}`;
  }

  status(t) { if (this.statusEl) this.statusEl.textContent = t; }

  loop() {
    if (!this.isOpen) return;
    if (this.transport.playing) {
      this.updatePos();
      if (this.tab === 'roll') this.roll.draw();
      if (this.tab === 'playlist') this.playlist.draw();
    }
    if (this.tab === 'mixer') this.mixer.tick();
    requestAnimationFrame(() => this.loop());
  }
}

// 16-bit WAV with TPDF dither
function wav16({ left, right, rate }) {
  const n = left.length, buf = new ArrayBuffer(44 + n * 4), v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 4, true); str(8, 'WAVE'); str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * 4, true);
  let o = 44;
  for (let i = 0; i < n; i++) for (const ch of [left, right]) { const s = Math.round(Math.max(-1, Math.min(1, ch[i])) * 32767 + (Math.random() - Math.random())); v.setInt16(o, Math.max(-32768, Math.min(32767, s)), true); o += 2; }
  return new Uint8Array(buf);
}
