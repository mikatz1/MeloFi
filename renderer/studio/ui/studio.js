// MeloFi Studio — the composer window. Owns the project, history, engine and transport, and
// wires the panels together: channel rack / browser on the left; piano roll, playlist, mixer
// and live grid on the right; an on-screen keyboard at the bottom; the guided tour on top.
import { h, popup, ask, form, setControlMenu } from './dom.js';
import { PPQ, STEP, barTicks, patternTicks, pattern, notesOf, newProject, newPattern, History, uid, migrate, SCALES, ROOTS, newTrack, songBars, tickToSec, barAt, newBus } from '../model.js';
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
import { RiffWizard } from './riffwizard.js';
import { NewtoneWindow } from './newtone.js';
import { MidiOut } from '../midiout.js';
import { DawSheet } from './daw.js';
import { infraMenuItems } from '../../js/appinfra.js';
import { CloudSheet } from './cloud.js';
import { AiSheet } from './ai.js';
import { openPicker } from '../../js/picker-client.js';
import { TEMPLATES } from '../templates.js';
import { SYNTH_CATEGORIES } from '../synth.js';
import { LOOP_GENRES, ROLES, renderLoop } from '../loops.js';
import { encodeWav } from '../../js/recorder.js';
import { takeInput, alignTake, audioOffsetSec, inputConstraints } from '../../js/latency.js';
import { finish, encode, fmtLufs, fmtDb } from '../export-audio.js';
import { TARGETS } from '../meter.js';
import { MasteringWindow } from './mastering.js';
import { AiMini } from './aimini.js';
import { STUDIO_THEMES, setStudioTheme, studioTheme, invalidatePalette } from './theme.js';
import { T } from '../../js/strings.js';
import { t, tc, tdyn, N_, langChoices, onLangChange, translateDom, locale } from '../../i18n/i18n.js';

const SNAPS = [['bar', N_('마디')], [PPQ, '1/4'], [PPQ / 2, '1/8'], [STEP, '1/16'], [STEP / 2, '1/32'], [PPQ / 6, N_('1/16 셋잇단')], [1, N_('없음')]];
// the studio's two colour themes as the menus name them
const themeName = (k) => (k === 'white' ? t('화이트') : t('다크'));
// 16 px line icons for the toolbar's window shortcuts (drawn in currentColor)
const svg = (body) => `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="square">${body}</svg>`;
const ICONS = {
  playlist: svg('<path d="M1.5 3.5h13M1.5 8h13M1.5 12.5h13" stroke-opacity=".35"/><rect x="2" y="2" width="5" height="3" fill="currentColor" stroke="none"/><rect x="6" y="6.5" width="7" height="3" fill="currentColor" stroke="none"/><rect x="3" y="11" width="4" height="3" fill="currentColor" stroke="none"/>'),
  roll: svg('<rect x="1.5" y="1.5" width="3.5" height="13"/><path d="M1.5 5.5h2M1.5 9.5h2"/><rect x="7" y="3" width="4" height="2" fill="currentColor" stroke="none"/><rect x="9" y="7" width="5" height="2" fill="currentColor" stroke="none"/><rect x="7" y="11" width="3" height="2" fill="currentColor" stroke="none"/>'),
  rack: svg('<g fill="currentColor" stroke="none"><rect x="1" y="2" width="3" height="3"/><rect x="5" y="2" width="3" height="3" opacity=".4"/><rect x="9" y="2" width="3" height="3"/><rect x="13" y="2" width="2" height="3" opacity=".4"/><rect x="1" y="6.5" width="3" height="3" opacity=".4"/><rect x="5" y="6.5" width="3" height="3"/><rect x="9" y="6.5" width="3" height="3" opacity=".4"/><rect x="13" y="6.5" width="2" height="3"/><rect x="1" y="11" width="3" height="3"/><rect x="5" y="11" width="3" height="3" opacity=".4"/><rect x="9" y="11" width="3" height="3"/><rect x="13" y="11" width="2" height="3" opacity=".4"/></g>'),
  mixer: svg('<path d="M3.5 1.5v13M8 1.5v13M12.5 1.5v13" stroke-opacity=".45"/><g fill="currentColor" stroke="none"><rect x="2" y="9" width="3" height="2"/><rect x="6.5" y="4" width="3" height="2"/><rect x="11" y="7" width="3" height="2"/></g>'),
  browser: svg('<path d="M1.5 3.5h5l1.5 1.5h6.5v8.5h-13z"/><path d="M4 8h7M4 10.5h5" stroke-opacity=".5"/>'),
  picker: svg('<path d="M5.5 1.5v3.5M10.5 1.5v3.5"/><path d="M3.5 5h9v3.5a4.5 4.5 0 0 1-9 0z"/><path d="M8 13v2"/>'),
  live: svg('<rect x="1.5" y="1.5" width="5.5" height="5.5"/><rect x="9" y="1.5" width="5.5" height="5.5"/><rect x="1.5" y="9" width="5.5" height="5.5"/><path d="M10 9.5l4 2.5-4 2.5z" fill="currentColor" stroke="none"/>'),
};
const FAMILY_ORDER =['drums', 'piano', 'keys', 'organ', 'synth', 'strings', 'brass', 'winds', 'vocal', 'guitar', 'bass', 'mallets', 'world', 'fx'];

// studio actions that can be bound to keys (Shortcut settings)
// FL Studio's keys (basics_shortcuts in the FL manual), so its tutorials can be followed key for key
export const ACTIONS = {
  play: [N_('재생 / 정지'), 'Space'], record: [N_('녹음'), 'R'], undo: [N_('실행 취소'), 'Ctrl+Z'], redo: [N_('다시 실행'), 'Ctrl+Y'],
  save: [N_('저장'), 'Ctrl+S'], open: [N_('열기'), 'Ctrl+O'], metro: [N_('메트로놈'), 'Ctrl+M'], countin: [N_('녹음 전 카운트'), 'Ctrl+P'],
  songmode: [N_('PAT / SONG 전환'), 'L'], newpattern: [N_('새 패턴'), 'F4'], renamepattern: [N_('패턴 이름 바꾸기'), 'F2'], link: [N_('채널을 믹서 트랙에 연결 (피아노 롤에서는 레가토)'), 'Ctrl+L'], timesig: [N_('박자표 바꾸기 (재생 위치부터)'), 'Shift+Alt+T'], clonechannel: [N_('채널 복제 (설정만)'), 'Alt+C'],
  playlist: [N_('플레이리스트'), 'F5'], rack: [N_('채널 랙'), 'F6'], roll: [N_('피아노 롤'), 'F7'], picker: [N_('플러그인 피커'), 'F8'], mixer: [N_('믹서'), 'F9'],
  browser: [N_('브라우저'), 'Alt+F8'], live: [N_('라이브'), 'Ctrl+F8'], keys: [N_('화면 건반'), 'Ctrl+Shift+K'], loop: [N_('반복 구간 켜기 / 끄기'), 'Ctrl+Shift+L'],
  exportWav: [N_('WAV로 내보내기'), 'Ctrl+R'], exportMp3: [N_('MP3로 내보내기'), 'Ctrl+Shift+R'], exportMidi: [N_('MIDI로 내보내기'), 'Ctrl+Shift+M'], mastering: [N_('마스터링'), 'Ctrl+Shift+B'],
  graph: [N_('Graph editor (벨로시티)'), 'Ctrl+K'],
  draw: [N_('그리기 도구'), 'P'], paint: [N_('페인트 도구'), 'B'], erase: [N_('지우기 도구'), 'D'], mutetool: [N_('뮤트 도구'), 'T'], slicetool: [N_('자르기 도구'), 'C'],
  select: [N_('선택 도구'), 'E'], zoom: [N_('확대 도구'), 'Z'], slide: [N_('슬라이드 도구'), 'S'], porta: [N_('포르타멘토 (슬라이드)'), 'O'], chord: [N_('코드 스탬프'), 'H'],
  tour: [N_('튜토리얼'), 'F1'],
};
// Shift counts for named keys and with Ctrl / Alt (Ctrl+Shift+R); a shifted letter alone is just a capital
const comboOf = (e) => `${e.ctrlKey ? 'Ctrl+' : ''}${e.shiftKey && (e.key.length > 1 || e.ctrlKey || e.altKey) ? 'Shift+' : ''}${e.altKey ? 'Alt+' : ''}${e.code === 'Space' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key}`;

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
  get riffWizard() { return (this._rw ||= new RiffWizard(this)); }
  get newtone() { return (this._nt ||= new NewtoneWindow(this)); }
  get tour() { return (this._tour ||= new Tour(this)); }
  get aiSheet() { return (this._ai ||= new AiSheet(this)); }
  get mastering() { return (this._ms ||= new MasteringWindow(this)); }

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
      // the studio shares the piano's audio context: add the mastering processors to it first
      await this.app.engine.ctx.audioWorklet.addModule('melofi://app/renderer/js/master-worklet.js');
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
    this.applyTheme();
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
    this.applyTheme(); // the piano window: back to its own colours
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
      h('b', {}, t('작곡이 처음이신가요?')),
      h('p', {}, t('화면을 하나씩 따라가며 첫 비트부터 내보내기까지 13개 강의로 안내해 드려요. 움직이는 예시로 무엇을 할지 먼저 보여 줘요.')),
      h('div', { class: 'row' },
        h('button', { class: 'btn sm ghost', onclick: () => { box.remove(); this.app.settings.set({ studioTourSeen: true }); } }, t('괜찮아요')),
        h('button', { class: 'btn sm ghost', onclick: () => { box.remove(); this.newFromTemplate(); } }, t('템플릿 보기')),
        h('button', { class: 'btn sm primary', onclick: () => { box.remove(); this.tour.start('workspace'); } }, t('투어 시작'))));
    this.el.append(box);
  }

  makeHistory() {
    const H = new History(() => this._proj, (p) => { this._proj = migrate(p); this.afterLoad(false); });
    H.labels = [];
    const push = H.push.bind(H);
    H.push = (label = N_('편집')) => { push(); H.labels.push({ label, at: Date.now() }); if (H.labels.length > H.limit) H.labels.shift(); };
    const undo = H.undo.bind(H), redo = H.redo.bind(H);
    H.undo = () => { const ok = undo(); if (ok) H.redoLabels = [...(H.redoLabels || []), H.labels.pop()]; return ok; };
    H.redo = () => { const ok = redo(); if (ok && H.redoLabels?.length) H.labels.push(H.redoLabels.pop()); return ok; };
    return H;
  }

  async syncAudio() {
    this.status(t('악기 불러오는 중…'));
    try {
      await this.engine.sync(this._proj, (id, p) => this.status(`${this.instName(id)} ${Math.round(p * 100)}%`));
      this.status('');
    } catch (err) {
      console.error(err);
      this.status(t('불러오지 못했습니다: {msg}', { msg: err.message }));
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
    if (this.floating?.[t]) this.raise(t); else this.dockTab = t;
    for (const [k, el] of Object.entries(this.panes)) el.hidden = !this.floating?.[k] && k !== this.dockTab;
    for (const b of this.el.querySelectorAll('.st-tabs button')) b.classList.toggle('on', b.dataset.tab === t);
    this.markWins();
    requestAnimationFrame(() => { if (t === 'roll') this.roll.resize(); if (t === 'playlist') this.playlist.resize(); if (t === 'mixer') this.mixer.render(); if (t === 'live') this.live.render(); });
  }

  // ---------- FL-style floating windows ----------
  // The piano roll, playlist and mixer can be torn off into windows that float over the studio
  // (as in FL Studio), moved by their title bar, resized from the corner and docked back.
  // The arrangement is remembered (settings.studioLayout).
  visible(k) { return !!this.floating?.[k] || this.dockTab === k; }

  raise(k) {
    const el = this.panes[k];
    this.zTop = (this.zTop || 30) + 1;
    el.style.zIndex = String(this.zTop);
  }

  detach(k, box = null) {
    const el = this.panes[k];
    if (!el || this.floating[k] || !['roll', 'playlist', 'mixer'].includes(k)) return;
    const host = this.el.getBoundingClientRect();
    const r = box || { x: 120 + Object.keys(this.floating).length * 40, y: 90 + Object.keys(this.floating).length * 30, w: Math.min(900, host.width * 0.6), h: Math.min(560, host.height * 0.6) };
    this.floating[k] = r;
    el.classList.add('st-float');
    this.el.append(el);
    Object.assign(el.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
    el.hidden = false;
    this.raise(k);
    // the docked area moves on to another docked pane
    if (this.dockTab === k) this.dockTab = ['playlist', 'roll', 'mixer', 'live'].find((x) => !this.floating[x]) || 'live';
    this.setTab(k);
    this.saveLayout();
  }

  dock(k) {
    const el = this.panes[k];
    if (!el || !this.floating[k]) return;
    delete this.floating[k];
    el.classList.remove('st-float');
    el.style.cssText = '';
    const order = ['roll', 'playlist', 'mixer', 'live'];
    const next = order.slice(order.indexOf(k) + 1).map((x) => this.panes[x]).find((p) => p && p.parentElement === this.rightEl);
    this.rightEl.insertBefore(el, next || null);
    this.setTab(k);
    this.saveLayout();
  }

  saveLayout() { this.app.settings.set({ studioLayout: { ...this.floating } }); }

  windowMenu(e) {
    const names = { roll: t('피아노 롤'), playlist: t('플레이리스트'), mixer: t('믹서') };
    popup(e.clientX, e.clientY + 12, [
      { group: t('창 배치') },
      ...Object.entries(names).map(([k, n]) => ({ label: this.floating[k] ? t('{n} 붙이기', { n }) : t('{n} 떼어내기', { n }), hint: t('탭 더블클릭'), act: () => (this.floating[k] ? this.dock(k) : this.detach(k)) })),
      { sep: true },
      { label: t('모두 떼어내기 (작업 창 배치)'), act: () => this.arrange('fl') },
      { label: t('모두 붙이기'), act: () => this.arrange('docked') },
    ]);
  }

  // ready-made arrangements: 'fl' puts the playlist big in the back with the roll and the mixer
  // floating over it, the way FL Studio opens; 'docked' is MeloFi's tabbed layout
  arrange(kind) {
    for (const k of Object.keys(this.floating)) this.dock(k);
    if (kind === 'fl') {
      const r = this.rightEl.getBoundingClientRect(), host = this.el.getBoundingClientRect();
      const x0 = r.left - host.left, y0 = r.top - host.top;
      this.setTab('playlist');
      this.detach('roll', { x: x0 + 30, y: y0 + 60, w: Math.max(420, r.width * 0.62), h: Math.max(260, r.height * 0.5) });
      this.detach('mixer', { x: x0 + r.width * 0.25, y: y0 + r.height * 0.45, w: Math.max(420, r.width * 0.7), h: Math.max(240, r.height * 0.5) });
      this.setTab('playlist');
    }
    this.saveLayout();
  }

  // title bar drag + corner resize for a floating pane
  wireFloat(k) {
    const el = this.panes[k];
    const head = el.querySelector(':scope > .st-fhead');
    head.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      try { head.setPointerCapture(e.pointerId); } catch { /* synthetic or lost pointer */ }
      const r0 = this.floating[k], x0 = e.clientX, y0 = e.clientY;
      const move = (ev) => { const host = this.el.getBoundingClientRect(); r0.x = Math.max(0, Math.min(host.width - 80, r0.x + ev.clientX - (move.x ?? x0))); r0.y = Math.max(0, Math.min(host.height - 30, r0.y + ev.clientY - (move.y ?? y0))); move.x = ev.clientX; move.y = ev.clientY; el.style.left = `${r0.x}px`; el.style.top = `${r0.y}px`; };
      const up = () => { head.removeEventListener('pointermove', move); head.removeEventListener('pointerup', up); this.saveLayout(); };
      head.addEventListener('pointermove', move); head.addEventListener('pointerup', up);
    });
    head.addEventListener('dblclick', () => this.dock(k));
    el.addEventListener('pointerdown', () => { if (this.floating[k]) { this.raise(k); if (this.tab !== k) { this.tab = k; for (const b of this.el.querySelectorAll('.st-tabs button')) b.classList.toggle('on', b.dataset.tab === k); } } }, true);
    new ResizeObserver(() => {
      if (!this.isOpen || el.hidden) return;
      if (this.floating[k]) { const b = el.getBoundingClientRect(); this.floating[k].w = Math.round(b.width); this.floating[k].h = Math.round(b.height); clearTimeout(this._lay); this._lay = setTimeout(() => this.saveLayout(), 300); }
      if (k === 'roll') this.roll.resize(); else if (k === 'playlist') this.playlist.resize();
    }).observe(el);
  }

  // as in FL Studio, the browser docks on the far left beside the channel rack; Alt+F8 shows / hides
  // it, F6 brings the rack forward. leftTab mirrors it ('browser' while the browser is open).
  setLeft(t) {
    if (t === 'browser') this.browserOpen = !this.browserOpen;
    this.leftTab = this.browserOpen ? 'browser' : 'rack';
    this.browserCol.hidden = !this.browserOpen;
    if (this.browserOpen) this.browser.render();
    if (t === 'rack') this.rackEl.scrollIntoView?.({ block: 'nearest' });
    this.layoutCols();
    for (const b of this.el.querySelectorAll('.st-ltabs button')) b.classList.toggle('on', b.dataset.l === 'browser' && this.browserOpen);
    this.markWins();
    requestAnimationFrame(() => { this.roll.resize(); this.playlist.resize(); });
  }

  // the toolbar's window icons light up for the pane in front (and the browser while it is open)
  markWins() {
    for (const b of this.toolEl?.querySelectorAll('.tb-ico') || []) {
      const k = b.dataset.win;
      b.classList.toggle('on', k === 'browser' ? !!this.browserOpen : k === this.tab);
    }
  }

  layoutCols(w = this.leftW) {
    this.leftW = w;
    this.mainEl.style.gridTemplateColumns = `${this.browserOpen ? '250px ' : ''}${w}px 5px 1fr`;
  }

  async rename(ch) {
    const v = await ask(t('채널 이름'), ch.name);
    if (v && v.trim()) this.edit(() => { ch.name = v.trim(); });
  }

  // ---------- sound ----------
  preview(chId, n, v = 100) { this.engine.channels.get(chId)?.noteOn(n, v, 0, 0.35); }

  // lag: ms a MIDI keyboard's notes arrive late (settings → 녹음); recorded notes are put back by it
  liveOn(n, v, lag = 0) {
    const chId = this._proj.selected;
    this.engine.channels.get(chId)?.liveOn(n, v);
    this.engine.duck(chId, this.engine.ctx.currentTime);
    this.midiOut?.liveOn(chId, n, v);
    this.transport.liveOn(chId, n, v, lag);
    this.liveHeld.add(n);
    this.keys?.light();
    const now = performance.now();
    this.scoreLog = this.scoreLog.filter((x) => now - x.on < 5 * 60e3);
    this.scoreLog.push({ n, v, on: now - lag, off: null, ch: chId });
  }

  liveOff(n, lag = 0) {
    const chId = this._proj.selected;
    this.engine.channels.get(chId)?.liveOff(n);
    this.midiOut?.liveOff(chId, n);
    this.liveHeld.delete(n);
    this.keys?.light();
    const open = [...this.scoreLog].reverse().find((x) => x.n === n && x.off == null);
    if (open) open.off = performance.now() - lag;
    this.transport.liveOff(chId, n, (r) => {
      if (this._proj.mode !== 'pattern') return;
      const pat = pattern(this._proj), len = patternTicks(this._proj, pat);
      let t = r.t % len;
      if (this.recQuant) t = Math.round(t / this.snap) * this.snap % len;
      notesOf(pat, r.ch).push({ t, d: Math.min(r.d, len), n: r.n, v: r.v });
      this.dirty = true;
      this.roll.draw();
      this.rack.render();
    }, lag);
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
    // the picker also lists MeloFi Synth presets by category (like FL Studio's FLEX browser)
    const synths = Object.entries(SYNTH_CATEGORIES).flatMap(([cat, names]) => names.map((n) => ({ id: `synth:${n}`, name: n, cat })));
    openPicker({ title: current ? t('채널 악기 바꾸기') : t('채널 추가'), heading: t('플러그인 피커'), current, closeOnPick: true, synths },
      async (id) => { await this.app.refreshInstruments(); cb(id); },
      () => this.app.store.show());
  }

  // a sample / slicer channel from an audio file (picked, or { name, data } from the browser);
  // `into`: an existing channel to turn into it
  async addSampleChannel(kind, into = null, file = null) {
    let f = file;
    if (!f) { const picked = await window.melofi.mediaPickFiles(); f = picked[0]; }
    if (!f) return;
    this.status(t('{name} 불러오는 중…', { name: f.name }));
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
    this.status(t('{name} 불러오는 중…', { name }));
    const hash = await addMedia(this._proj, name, data);
    return this.addAudioClipFromHash(hash, track, bar);
  }

  addAudioClipFromHash(hash, track = null, bar = null, chId = null) {
    const p = this._proj, m = p.media[hash];
    const secPerBar = (60 / p.bpm) * p.sig[0] * (4 / p.sig[1]);
    this.edit(() => {
      // a take recorded on an armed track goes to that track (an audio channel of the same name
      // and output when the armed one plays an instrument)
      const armed = chId && p.channels.find((c) => c.id === chId);
      let ch = armed?.kind === 'audio' ? armed : armed ? p.channels.find((c) => c.kind === 'audio' && c.name === t('{name} 녹음', { name: armed.name })) : p.channels.find((c) => c.kind === 'audio' && c.name === m.name.replace(/\.[^.]+$/, ''));
      if (!ch && armed) { ch = this.rack.makeKind('audio', t('{name} 녹음', { name: armed.name })); ch.out = armed.out; }
      if (!ch) ch = this.rack.makeKind('audio', m.name.replace(/\.[^.]+$/, ''));
      const ti = track ?? p.playlist.tracks.findIndex((_, i) => !p.playlist.clips.some((c) => c.track === i));
      const tr = ti < 0 ? p.playlist.tracks.length : ti;
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
    const name = `${m.name.replace(/\.[^.]+$/, '')} (${t({ normalize: N_('노멀라이즈'), reverse: N_('거꾸로'), trim: N_('자름') }[kind])}).wav`;
    const hash = await addMedia(p, name, wav);
    p.media[hash].bpm = m.bpm;
    this.edit(() => { c.media = hash; }, true, name);
    this.playlist.peakCache.delete(hash);
  }

  // render a channel to audio, put it on the playlist and mute the original
  async freeze(ch) {
    this.status(t('{name} 굳히는 중…', { name: ch.name }));
    try {
      const mix = await renderMix({ ...this._proj, mode: this._proj.playlist.clips.length ? 'song' : 'pattern' }, { only: ch.id, offset: 0, tail: 2 });
      const wav = encodeWav(mix);
      const hash = await addMedia(this._proj, t('{name} (굳힘).wav', { name: ch.name }), wav);
      this._proj.media[hash].bpm = this._proj.bpm; // rendered at the project tempo: never stretch it
      this.addAudioClipFromHash(hash, null, 0);
      this.edit(() => { ch.mute = true; });
      this.status(t('{name}을(를) 오디오로 굳혔습니다. 원래 채널은 음소거했어요.', { name: ch.name }));
    } catch (err) { this.status(t('굳히지 못했습니다: {msg}', { msg: err.message })); }
  }

  // sing a channel's melody with its lyrics (a voice installed in the main process) onto an audio track
  async sing(ch, onProgress) {
    const { melodyOf, toSeconds, channelSyllables, singNotes, voices } = await import('../vocal.js');
    const p = this._proj;
    const notes = melodyOf(p, ch.id);
    if (!notes.length) { this.status(t('이 채널에 노트가 없어요. 피아노 롤에 멜로디를 먼저 입력해 주세요.')); return { ok: false }; }
    const st = await voices(true);
    const voice = st.voices.find((v) => v.id === (ch.vocal?.voice === 'r9y9/yoko_latest' ? 'yoko' : ch.vocal?.voice)) || st.voices.find((v) => v.ready);
    if (!voice?.ready) { this.status(t('노래할 보이스가 없어요. 채널 설정 > 보컬에서 보이스를 내려받아 주세요.')); return { ok: false }; }
    const syl = channelSyllables(ch, notes.length, voice.langs);
    this.status(t('노래를 만드는 중…'));
    const r = await singNotes({ notes: toSeconds(p, notes), syllables: syl, voice: voice.id, speaker: ch.vocal?.speaker, onProgress: (m) => { if (m.label) this.status(m.label); onProgress?.(m); } });
    if (!r.ok) { this.status(r.message); return r; }
    const name = t('{name} (노래)', { name: ch.name });
    const hash = await addMedia(p, `${name}.wav`, r.wav);
    p.media[hash].bpm = p.bpm; // sung at the project tempo: never stretch it
    // a new take replaces the last one
    const old = p.channels.find((c) => c.kind === 'audio' && c.name === name);
    if (old) this.edit(() => { p.playlist.clips = p.playlist.clips.filter((c) => c.ch !== old.id); });
    this.addAudioClipFromHash(hash, null, 0);
    this.edit(() => { ch.mute = true; });
    const terms = r.use === 'noncommercial' ? t(' 이 보이스로 만든 노래는 비상업적으로만 쓸 수 있어요.') : r.use === 'unverified' ? t(' 이 보이스는 라이선스가 확인되지 않았어요 (개인 연습용).') : '';
    this.status(t('{name}의 노래를 만들었어요 ({s}초). 원래 채널은 음소거했어요.', { name: ch.name, s: r.seconds }) + terms + (r.credit ? ' ' + t('크레딧: {credit}', { credit: r.credit }) : ''));
    return r;
  }

  // ---------- audio recording (microphone / line in) ----------
  // armed: the mixer track (channel) armed for recording, as in FL Studio; its input is used and
  // the take lands on that channel
  // The take is lined up exactly: the input tap reports the context time of its first sample, the
  // transport where the song position was taken, and the round trip (measured in settings → 녹음,
  // per input / output pair) comes off the front, so what was played in time lands on the grid.
  async toggleAudioRec(armed = null) {
    if (this.arec) return this.stopAudioRec();
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia(inputConstraints(armed?.input)); } catch { this.status(t('마이크를 쓸 수 없습니다. 윈도우 설정에서 마이크 권한을 확인하세요.')); return; }
    const ctx = this.engine.ctx;
    let take;
    try { take = await takeInput(ctx, stream); } catch (err) { console.warn('input tap', err); stream.getTracks().forEach((t) => t.stop()); this.status(t('입력을 열 수 없습니다')); return; }
    const p = this._proj;
    if (p.mode !== 'song') this.setMode('song');
    const T2 = this.transport, was = T2.playing;
    const startTick = was ? T2.songPos() : T2.base + T2.pos;
    this.arec = { armed: armed?.id || null, input: armed?.input || null, stream, take, startTick, refCtx: ctx.currentTime };
    this.renderToolbar();
    this.status(t('오디오 녹음 중… 다시 누르면 멈춥니다'));
    if (!was) { await T2.play(); if (this.arec) this.arec.refCtx = T2.startCtx; } // the song starts a moment after the tap
  }

  async stopAudioRec() {
    const r = this.arec;
    this.arec = null;
    const raw = await r.take.stop();
    r.stream.getTracks().forEach((t) => t.stop());
    this.transport.pause();
    const rate = this.engine.ctx.sampleRate;
    if (raw.t0 == null || raw.L.length < rate * 0.2) { this.status(t('녹음이 너무 짧습니다')); this.renderToolbar(); return; }
    const lat = audioOffsetSec(this.app.settings.v, this.engine.ctx, r.input);
    // clips sit on 1/16 of a bar: start the take exactly there
    const bt = barTicks(this._proj), bar = Math.round((r.startTick / bt) * 16) / 16;
    const shift = tickToSec(this._proj, bar * bt, 'song') - tickToSec(this._proj, r.startTick, 'song');
    const { left, right } = alignTake(raw, rate, r.refCtx + shift, lat);
    if (left.length < rate * 0.1) { this.status(t('녹음이 너무 짧습니다')); this.renderToolbar(); return; }
    const wav = encodeWav({ left, right, rate });
    const hash = await addMedia(this._proj, t('녹음 {time}.wav', { time: new Date().toLocaleTimeString(locale(), { hour12: false }) }), wav);
    this._proj.media[hash].bpm = null;
    this.addAudioClipFromHash(hash, null, bar, r.armed);
    this.renderToolbar();
    this.status(t('녹음을 오디오 클립으로 넣었습니다 (지연 {ms}ms 보정)', { ms: Math.round(lat * 1000) }));
  }

  // one bar of clicks, then play (recording starts on the downbeat)
  playWithCountIn() {
    const T2 = this.transport, p = this._proj;
    if (!this.countIn) { T2.play(); return; }
    const ctx = this.engine.ctx, beat = 60 / p.bpm * (4 / p.sig[1]), t0 = ctx.currentTime + 0.1;
    for (let i = 0; i < p.sig[0]; i++) this.engine.tick(t0 + i * beat, i === 0);
    this.status(t('하나, 둘, 셋, 넷…'));
    setTimeout(() => { this.status(''); T2.play(); }, (0.1 + p.sig[0] * beat) * 1000 - 50);
  }

  // tap the button in time: the tempo follows the last few taps
  tap() {
    const now = performance.now();
    this.taps = this.taps.filter((t) => now - t < 2500);
    this.taps.push(now);
    if (this.taps.length < 3) { this.status(t('박자에 맞춰 계속 누르세요')); return; }
    const gaps = this.taps.slice(1).map((t, i) => t - this.taps[i]);
    const bpm = Math.round(60000 / (gaps.reduce((a, b) => a + b, 0) / gaps.length));
    if (bpm >= 40 && bpm <= 250) { this.edit(() => { this._proj.bpm = bpm; }, true, t('탭 템포 {bpm}', { bpm })); this.engine.info.bpm = bpm; this.status(t('템포 {bpm}', { bpm })); }
  }

  // FL's "dump score log": what you just played (without recording) becomes notes in the pattern
  dumpScoreLog(minutes = 1) {
    const now = performance.now(), chId = this._proj.selected;
    const notes = this.scoreLog.filter((x) => x.ch === chId && now - x.on < minutes * 60e3);
    if (!notes.length) { this.status(t('최근에 이 채널로 연주한 음이 없습니다')); return; }
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
    }, true, t('방금 연주한 것 넣기'));
    this.status(t('{n}개 음을 패턴에 넣었어요. 박자가 어긋나면 도구 › 퀀타이즈를 써 보세요.', { n: notes.length }));
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
      { label: 'Create automation clip', hint: t('오토메이션 클립: 시간에 따라 값 바꾸기'), act: () => this.makeAutomation(target, label) },
      { label: this.learn === target ? t('MIDI 연결 대기 중… (취소)') : t('MIDI 컨트롤러 연결'), hint: t('다음에 움직인 노브'), act: () => { this.learn = this.learn === target ? null : target; this.status(this.learn ? t('MIDI 컨트롤러의 노브나 슬라이더를 움직이세요') : ''); } },
      ...(map.length ? [{ label: t('MIDI 연결 해제 (CC {cc})', { cc: map[0].cc }), act: () => this.edit(() => { this._proj.midiMap = this._proj.midiMap.filter((m) => m.target !== target); }) }] : []),
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
      p.playlist.tracks.push({ ...newTrack(tr), name: t('오토메이션: {name}', { name }) });
      p.playlist.clips.push({ id: uid('k'), kind: 'auto', auto: a.id, track: tr, start: 0, len });
      p.mode = 'song';
    }, true, t('오토메이션 클립 만들기'));
    this.setTab('playlist');
    this.playlist.scrollTrack = Math.max(0, p.playlist.tracks.length - 4);
    this.status(t('오토메이션 클립 안을 클릭해 점을 찍고 끌어서 값을 바꾸세요'));
  }

  targetName(target, label) {
    const p = this._proj, [kind, id, a, b] = target.split(':');
    const owner = kind === 'master' || id === 'master' ? t('마스터') : (p.channels.find((c) => c.id === id) || p.buses.find((x) => x.id === id))?.name || '';
    if (kind === 'fx') { const list = id === 'master' ? p.master.fx : (p.channels.find((c) => c.id === id) || p.buses.find((x) => x.id === id))?.fx; const f = list?.find((x) => x.id === a); const spec = f && FX_TYPES[f.type].params.find((q) => q.key === b); return `${owner} ${t(FX_TYPES[f?.type]?.name || '')} ${spec?.label ? t(spec.label) : label || ''}`.trim(); }
    return `${owner} ${t({ vol: N_('볼륨'), pan: N_('팬'), send: N_('리버브') }[a] || label || N_('볼륨'))}`.trim();
  }

  // MIDI controller messages (from the app's MIDI input)
  cc(cc, val, ch) {
    if (!this.isOpen) return;
    if (this.learn) {
      const target = this.learn;
      this.learn = null;
      this.edit(() => { this._proj.midiMap = this._proj.midiMap.filter((m) => m.target !== target && !(m.cc === cc && m.ch === ch)); this._proj.midiMap.push({ cc, ch, target }); });
      this.status(t('CC {cc}번을 {target}에 연결했습니다', { cc, target: this.targetName(target) }));
      return;
    }
    let hit = false;
    for (const m of this._proj.midiMap) if (m.cc === cc && m.ch === ch) { this.setValue(m.target, val / 127); hit = true; }
    if (hit && !this.ccRender) this.ccRender = setTimeout(() => { this.ccRender = null; if (this.visible('mixer')) this.mixer.render(); this.rack.render(); }, 120);
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
    if (!st.available) { this.status(t('VST 호스트를 찾을 수 없습니다. MeloFi를 재설치해 주세요.')); return; }
    let plugins = st.plugins, folders = st.folders;
    const rescan = async (more = folders) => {
      this.status(t('VST 플러그인 스캔 중… (최초 실행 시 시간이 걸릴 수 있습니다)'));
      const r = await window.melofi.vstScan(more);
      if (!r.ok) { this.status(t('VST 플러그인을 찾지 못했습니다: {msg}', { msg: tdyn(r.message || r.error) })); return null; }
      this.status(t('VST 플러그인 {n}개를 찾았습니다.', { n: r.plugins.length }));
      return r.plugins;
    };
    if (!st.scannedAt) plugins = (await rescan()) || [];
    const inst = plugins.filter((p) => p.instrument), fx = plugins.filter((p) => !p.instrument);
    popup(x, y, [
      { group: inst.length ? t('VST 악기') : t('VST 악기가 없습니다') },
      ...inst.map((p) => ({ label: p.name, hint: p.vendor, act: () => onPick(p) })),
      ...(fx.length ? [{ group: t('이펙트 {n}개는 아직 채널 트랙에 적용할 수 없습니다', { n: fx.length }) }] : []),
      { sep: true },
      { label: t('다시 찾기'), hint: 'C:\\Program Files\\Common Files\\VST3', act: async () => { if (await rescan()) this.vstMenu(x, y, onPick); } },
      { label: t('플러그인 폴더 추가…'), act: async () => { const d = await window.melofi.mediaPickFolder(); if (d) { folders = [...new Set([...folders, d])]; if (await rescan(folders)) this.vstMenu(x, y, onPick); } } },
    ]);
  }

  async save(as = false) {
    await this.captureVstStates();
    const p = await saveProject(this._proj, as ? null : this.path);
    if (p) { this.path = p; this.app.ui.toast(t('저장됨'), { path: p }); }
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
      { group: t('새 프로젝트') },
      ...Object.entries(TEMPLATES).map(([k, tp]) => ({ label: t(tp.name), hint: t(tp.hint), act: () => {
        if (this.dirty && !confirm(t('새 프로젝트를 만들까요? 저장하지 않은 변경 사항은 자동 저장본에만 남습니다.'))) return;
        this.setProject(tp.make());
      } })),
    ]).classList.add('tall');
  }

  // FL Studio's Loop Starter: a genre in, a ready loop out — in a random key and tempo each time,
  // so pressing it again gives a different starting idea
  loopStarter(x = innerWidth / 2 - 120, y = 120) {
    popup(x, y, [
      { group: t('Loop Starter · 장르 선택') },
      ...Object.entries(LOOP_GENRES).map(([k, g]) => ({ label: t(g.name), hint: `${g.bpm[0]}–${g.bpm[1]} BPM`, act: () => {
        if (this.dirty && !confirm(t('새 루프로 시작할까요? 저장하지 않은 변경 사항은 자동 저장본에만 남습니다.'))) return;
        this.startLoops(k);
      } })),
      { sep: true },
      ...Object.entries(TEMPLATES).filter(([k]) => k !== 'empty').map(([k, tp]) => ({ label: tc('template', '{name} (패턴으로)', { name: t(tp.name) }), hint: tc('template', '편집 가능한 노트로 시작'), act: () => {
        if (this.dirty && !confirm(t('새 루프로 시작할까요? 저장하지 않은 변경 사항은 자동 저장본에만 남습니다.'))) return;
        this.setProject(this.makeLoopStart(k)); this.setMode('song');
      } })),
    ]).classList.add('tall');
  }

  // FL Studio's Loop Starter: a new project made of drum, bass, chord and melody loops (audio)
  // in a random key and tempo of the genre, laid out over 8 bars; each loop can be shuffled
  async startLoops(genre, seed = Math.floor(Math.random() * 1e6)) {
    const g = LOOP_GENRES[genre];
    const p = newProject();
    p.name = `Loop Starter · ${g.name}`;
    p.bpm = g.bpm[0] + Math.floor(Math.random() * (g.bpm[1] - g.bpm[0] + 1));
    p.scale = { root: Math.floor(Math.random() * 12), type: g.scale };
    p.playlist.clips = [];
    // keep one instrument channel to write on; the loops bring their own audio channels
    const keep = p.channels.find((c) => /piano/i.test(c.name)) || p.channels[0];
    p.channels = [keep]; p.selected = keep.id;
    for (const pat of p.patterns) pat.notes = {};
    this.setProject(p);
    const start = { drums: 0, chords: 0, bass: 4, lead: 8 }; // a build-up on loop boundaries (loops are 4 bars)
    let track = 0;
    for (const role of Object.keys(ROLES)) {
      this.status(t('Loop Starter: {role} 만드는 중… ({i}/4)', { role: t(ROLES[role]), i: track + 1 }));
      await this.addLoop(genre, role, { track, bar: start[role], seed: seed + track, until: 12 });
      track++;
    }
    this.setMode('song');
    this.setTab('playlist');
    this.status(t('Loop Starter: 클립 제목 줄을 우클릭해 ‘루프 바꾸기’로 파트마다 다른 루프를 고를 수 있어요.'));
  }

  // a loop from the library on the playlist: rendered in the project's key and tempo, placed at
  // `bar` on `track`, repeated up to bar `until` (if given)
  async addLoop(genre, role, { track = null, bar = 0, seed = 1, until = null } = {}) {
    const p = this._proj;
    const root = p.scale?.root ?? 0;
    const L = await renderLoop(genre, role, { root, bpm: p.bpm, seed });
    const hash = await addMedia(p, `${L.name}.wav`, encodeWav(L));
    p.media[hash].bpm = p.bpm;
    p.media[hash].loop = { genre, role, seed, root };
    this.edit(() => {
      const name = t('루프 {role}', { role: t(ROLES[role]) });
      let ch = p.channels.find((c) => c.kind === 'audio' && c.name === name);
      if (!ch) ch = this.rack.makeKind('audio', name);
      const ti = track ?? p.playlist.tracks.findIndex((_, i) => !p.playlist.clips.some((c) => c.track === i));
      const tr = ti < 0 ? p.playlist.tracks.length : ti;
      while (p.playlist.tracks.length <= tr + 1) p.playlist.tracks.push(newTrack(p.playlist.tracks.length));
      p.playlist.tracks[tr].name = name;
      for (let b = bar; b < (until ?? bar + L.bars); b += L.bars) p.playlist.clips.push({ id: uid('k'), kind: 'audio', media: hash, ch: ch.id, track: tr, start: b, len: L.bars, offset: 0, gain: 1, sync: true });
      p.mode = 'song';
    }, true, t('루프 넣기'));
    this.syncAudio();
    return hash;
  }

  // FL's per-loop shuffle: a new variation of the same part replaces it everywhere it is used
  async shuffleLoop(clip) {
    const p = this._proj, m = p.media[clip.media];
    if (!m?.loop) return;
    const { genre, role } = m.loop, seed = m.loop.seed + 1 + Math.floor(Math.random() * 1000);
    this.status(t('{role} 루프를 바꾸는 중…', { role: t(ROLES[role]) }));
    const L = await renderLoop(genre, role, { root: p.scale?.root ?? m.loop.root, bpm: p.bpm, seed });
    const hash = await addMedia(p, `${L.name}.wav`, encodeWav(L));
    p.media[hash].bpm = p.bpm;
    p.media[hash].loop = { genre, role, seed, root: p.scale?.root ?? m.loop.root };
    const old = clip.media;
    this.edit(() => { for (const c of p.playlist.clips) if (c.media === old) c.media = hash; }, true, t('루프 바꾸기'));
    this.syncAudio();
    this.status(t('{role} 루프를 바꿨어요.', { role: t(ROLES[role]) }));
  }

  makeLoopStart(k) {
    const t = TEMPLATES[k], p = t.make();
    const shift = Math.floor(Math.random() * 12) - 5; // -5..+6 semitones
    const drum = (c) => this.isKit(c.inst) || /kick|snare|hat|clap|perc|drum|킥|스네어|햇|클랩/i.test(c.name) || ['sample', 'slicer', 'audio'].includes(c.kind);
    const pitched = new Set(p.channels.filter((c) => !drum(c)).map((c) => c.id));
    for (const pat of p.patterns) for (const [id, list] of Object.entries(pat.notes)) if (pitched.has(id)) for (const n of list) n.n = Math.max(0, Math.min(127, n.n + shift));
    if (p.scale) p.scale = { ...p.scale, root: ((p.scale.root + shift) % 12 + 12) % 12 };
    p.bpm = Math.round(p.bpm * (0.94 + Math.random() * 0.12));
    p.name = `Loop Starter · ${t.name}`;
    return p;
  }

  // FL Studio's "customize" lesson: size, accent colour, how tall tracks and rows are, panel width
  look() { return { zoom: 100, accent: '', trackH: 0, rowH: 0, theme: 'dark', ...(this.app.settings.get('studioLook') || {}) }; }

  applyLook() {
    const L = this.look();
    if (this.app.studioWindow) window.melofi.setZoom?.(L.zoom / 100); // the studio's own window scales as a whole
    if (L.accent) document.documentElement.style.setProperty('--accent', L.accent); else document.documentElement.style.removeProperty('--accent');
    if (L.trackH && this.playlist) this.playlist.trackH = L.trackH;
    if (L.rowH && this.roll) this.roll.rowH = L.rowH;
    this.applyTheme();
    requestAnimationFrame(() => { this.roll?.resize(); this.playlist?.resize(); });
  }

  // 테마 (dark / white): on the page only while the composer is shown, so the piano window keeps its own look
  applyTheme() {
    setStudioTheme(this.look().theme, this.isOpen || this.app.studioWindow);
    invalidatePalette(); // the accent may have changed too
    const white = studioTheme() === 'white';
    if (this.keysOpen) window.melofi.keysTheme?.(white ? 'white' : 'dark');
    window.melofi.setTitleBarColors?.(white ? { color: '#d5d6d9', symbolColor: '#3a3b40', background: '#ebecee' } : { color: '#0d0e12', symbolColor: '#8d8b85', background: '#08090d' });
    if (!this.el || !this.isOpen) return;
    this.roll?.draw(); this.playlist?.draw();
    if (this._chs && !this._chs.el.hidden) this._chs.render();
    for (const w of [this._nt, this._rw]) if (w?.el && !w.el.hidden) w.draw?.(); // only the ones already made
  }

  setTheme(theme) {
    this.app.settings.set({ studioLook: { ...(this.app.settings.get('studioLook') || {}), theme } });
    this.applyTheme();
  }

  async lookSheet() {
    const L = { ...this.look(), trackH: this.playlist.trackH, rowH: this.roll.rowH, ...(this.app.settings.get('studioLook') || {}) };
    const v = await form(t('화면 꾸미기'), [
      { key: 'theme', label: t('테마'), type: 'select', value: L.theme, options: STUDIO_THEMES.map((k) => [k, themeName(k)]) },
      { key: 'zoom', label: t('화면 크기 (%)'), type: 'select', value: L.zoom, options: [80, 90, 100, 110, 125, 140].map((z) => [z, `${z}%`]) },
      { key: 'accent', label: t('강조 색'), type: 'color', value: L.accent || getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#e8a15d' },
      { key: 'trackH', label: t('플레이리스트 트랙 높이'), type: 'number', value: L.trackH, min: 28, max: 120 },
      { key: 'rowH', label: t('피아노 롤 줄 높이'), type: 'number', value: L.rowH, min: 7, max: 28 },
      { key: 'reset', label: t('기본값으로 되돌리기'), type: 'check', value: false },
    ], { note: t('색상은 작곡 스튜디오에만 적용됩니다. 패널 너비는 채널 랙 오른쪽 경계를 드래그해 조절합니다.') });
    if (!v) return;
    // the theme is chosen in the same sheet, so going back to the defaults keeps it
    this.app.settings.set({ studioLook: v.reset ? (v.theme === 'dark' ? null : { theme: v.theme }) : { zoom: v.zoom, accent: v.accent, trackH: v.trackH, rowH: v.rowH, theme: v.theme } });
    if (v.reset) { this.playlist.trackH = 46; this.roll.rowH = 14; }
    this.applyLook();
  }

  async recentMenu(e) {
    const list = await window.melofi.studioRecent();
    const vers = await window.melofi.studioVersions();
    popup(e.clientX, e.clientY, [
      { group: t('최근 프로젝트') },
      ...(list.length ? list.map((r) => ({ label: r.name, hint: new Date(r.at).toLocaleDateString('ko-KR'), act: () => this.openPath(r.path) })) : [{ label: t('없음'), disabled: true }]),
      { group: t('자동 저장 기록 (5분마다)') },
      ...(vers.length ? vers.slice(0, 12).map((v) => ({ label: v, act: async () => { const t = await window.melofi.studioVersion(v); if (t) this.setProject(JSON.parse(t)); } })) : [{ label: t('없음'), disabled: true }]),
    ]).classList.add('tall');
  }

  async exportMidi() {
    const data = projectToMidi(this._proj, (id) => this.isKit(id));
    const saved = await window.melofi.saveRecording({ dir: this.app.settings.get('recDir'), base: this._proj.name, files: [{ ext: 'mid', data }] });
    this.app.ui.toast(t('MIDI 저장됨'), { path: saved.files[0], action: { label: t('폴더 열기'), fn: () => window.melofi.showItem(saved.files[0]) } });
  }

  // audio export, as FL Studio's and Cubase's mixdown: format and bit depth, sample rate,
  // loudness or peak normalisation with a true-peak ceiling, dither; a loudness report at the end
  async exportAudio(fmt) {
    const p = this._proj, st = this.app.settings;
    const last = st.get('studioExport') || {};
    const v = await form(t('오디오로 내보내기'), [
      { key: 'format', label: t('형식'), type: 'select', value: fmt || last.format || 'wav24', options: [['wav24', t('WAV 24비트 (원본 품질)')], ['wav16', t('WAV 16비트 (CD)')], ['wav32f', t('WAV 32비트 플로트 (후반 작업용)')], ['flac24', t('FLAC 24비트 (무손실 압축)')], ['flac16', t('FLAC 16비트')], ['mp3', 'MP3 320kbps'], ['ogg', 'OGG (Opus 192kbps)']] },
      { key: 'rate', label: t('샘플레이트'), type: 'select', value: last.rate || 48000, options: [[44100, t('44.1 kHz (CD · 음원)')], [48000, t('48 kHz (영상)')], [96000, t('96 kHz (고해상도)')]] },
      { key: 'range', label: t('범위'), type: 'select', value: 'all', options: [['all', p.playlist.clips.length ? t('곡 전체') : t('현재 패턴')], ...(p.loop ? [['loop', t('반복 구간 ({a}~{b}마디)', { a: p.loop.start + 1, b: p.loop.end })]] : [])] },
      { key: 'norm', label: t('음량 맞추기'), type: 'select', value: last.norm || 'none', options: [['none', t('그대로 (마스터 그대로)')], ['loudness', t('라우드니스 (LUFS)에 맞추기')], ['peak', t('최대 피크에 맞추기')]] },
      { key: 'target', label: t('목표 라우드니스'), type: 'select', value: last.target ?? -14, options: TARGETS.map(([, n, l, c]) => [l, `${l} LUFS · ${t(n)}`]).filter((x, i, a) => a.findIndex((y) => y[0] === x[0]) === i) },
      { key: 'ceiling', label: t('최대 피크 (dBTP)'), type: 'number', value: last.ceiling ?? -1, min: -6, max: 0, step: 0.1 },
      { key: 'dither', label: t('디더'), type: 'select', value: last.dither || 'tpdf', options: [['tpdf', t('TPDF (기본)')], ['shaped', t('노이즈 셰이핑 (귀에 덜 들리게)')], ['none', t('끔')]] },
      { key: 'tail', label: t('끝 여운 (초)'), type: 'number', value: last.tail ?? 3, min: 0, max: 10, step: 0.5 },
    ], { ok: t('내보내기'), note: t('라우드니스는 BS.1770 / EBU R128로 재고, 피크는 샘플 사이의 실제 피크(dBTP)로 제한해요. 디더는 16비트·FLAC 16비트에 적용돼요.') });
    if (!v) return;
    st.set({ studioExport: { format: v.format, rate: v.rate, norm: v.norm, target: v.target, ceiling: v.ceiling, dither: v.dither, tail: v.tail } });
    this.status(t('렌더링 중…'));
    try {
      const raw = await renderMix(p, { rate: v.rate, range: v.range === 'loop' ? p.loop : null, tail: v.tail, onProgress: (ph, x) => this.status(ph === 'load' ? t('악기 불러오는 중 {p}%', { p: Math.round(x * 100) }) : t('렌더링 중…')) });
      this.status(t('음량 재는 중…'));
      const done = finish(raw, { norm: v.norm, target: v.target, ceiling: v.ceiling });
      this.status(t('파일로 쓰는 중…'));
      const { ext, data } = await encode(done.mix, v.format, v.dither);
      const saved = await window.melofi.saveRecording({ dir: st.get('recDir'), base: p.name, files: [{ ext, data }] });
      this.status('');
      const a = done.after;
      this.lastExport = { ...done, file: saved.files[0], format: v.format };
      this.app.ui.toast(t('{fmt} 저장됨 · {lufs} LUFS · 피크 {tp} dBTP · LRA {lra} LU', { fmt: ext.toUpperCase(), lufs: fmtLufs(a.I), tp: fmtDb(a.tp), lra: a.LRA.toFixed(1) }) + (done.limited > 0.05 ? ' · ' + t('리미터 {db} dB', { db: done.limited.toFixed(1) }) : '') + (raw.warnings?.length ? ' · ' + t('소리 없이 내보낸 채널: {list}', { list: raw.warnings.map((w) => w.name).join(', ') }) : ''),
        { path: saved.files[0], action: { label: t('폴더 열기'), fn: () => window.melofi.showItem(saved.files[0]) } });
    } catch (err) {
      console.error(err);
      this.status(t('내보내지 못했습니다: {msg}', { msg: err.message }));
    }
  }
  exportWav() { return this.exportAudio(); }

  // a falling-notes video of the arrangement, with its real mix as the soundtrack
  async exportVideo() {
    const p = this._proj;
    const v = await form(t('영상으로 내보내기'), [
      { key: 'res', label: t('해상도'), type: 'select', value: '1080', options: [['2160', '4K'], ['1440', '1440p'], ['1080', '1080p']] },
      { key: 'fps', label: t('프레임'), type: 'select', value: 60, options: [[60, '60fps'], [30, '30fps']] },
    ], { ok: t('만들기'), note: t('피아노 화면의 테마와 배경으로, 모든 채널의 노트가 떨어지는 영상을 만듭니다.') });
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
    if (chans.length < 2) { this.status(t('나눌 채널이 두 개 이상이어야 합니다')); return; }
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
    }, true, t('채널별로 나누기'));
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
      case 'record': if (this.arec || this._proj.channels.some((c) => c.arm)) { this.toggleAudioRec(this._proj.channels.find((c) => c.arm)); break; } T2.recording = !T2.recording; if (T2.recording && !T2.playing) this.playWithCountIn(); this.renderToolbar(); break;
      case 'undo': if (this.history.undo()) this.app.ui.toast(t('실행 취소'), { ms: 900 }); break;
      case 'redo': this.history.redo(); break;
      case 'save': this.save(); break;
      case 'open': this.openFile(); break;
      case 'keys': this.toggleKeys(); break;
      case 'metro': T2.metro = !T2.metro; this.renderToolbar(); break;
      case 'loop': if (this._proj.loop) this.edit(() => { this._proj.loopOn = !this._proj.loopOn; }); break;
      case 'roll': case 'playlist': case 'mixer': case 'live': this.setTab(a); break;
      case 'rack': this.setLeft('rack'); break;
      case 'graph': this.setLeft('rack'); this.rack.graph = this.rack.graph ? null : 'v'; this.rack.render(); break;
      case 'browser': this.setLeft('browser'); break;
      case 'picker': this.pickInstrument(0, 0, (id) => this.rack.add(id)); break;
      case 'songmode': this.setMode(this._proj.mode === 'song' ? 'pattern' : 'song'); break;
      case 'timesig': this.setTab('playlist'); this.playlist.sigDialog(this._proj.mode === 'song' ? this.transport.songPos() : 0); break;
      case 'link': { // FL: Ctrl+L links the selected channel to a free mixer track; in the piano roll it is legato
        if (this.tab === 'roll' && document.activeElement === this.roll.c) { this.roll.legato(); break; }
        this.linkToMixer(this._proj.selected);
        break;
      }
      case 'renamepattern': { const pat = pattern(this._proj); ask(t('패턴 이름'), pat.name).then((v) => { if (v && v.trim()) this.edit(() => { pat.name = v.trim(); }); }); break; }
      case 'clonechannel': { // FL's Alt+C: a copy of the selected channel's sound and settings, without its notes
        const proj = this._proj, ch = proj.channels.find((c) => c.id === proj.selected);
        if (ch) { this.edit(() => { const nc = { ...JSON.parse(JSON.stringify(ch)), id: uid('c'), name: `${ch.name} 2`, arm: false }; proj.channels.splice(proj.channels.indexOf(ch) + 1, 0, nc); proj.selected = nc.id; }, true, t('채널 복제')); this.syncAudio(); }
        break;
      }
      case 'newpattern': { const proj = this._proj, pat = pattern(proj); this.edit(() => { const p = newPattern(proj.patterns.length, pat.bars); proj.patterns.push(p); proj.current = p.id; }, true, t('새 패턴')); break; }
      case 'countin': this.countIn = !this.countIn; this.status(this.countIn ? t('녹음 전 1마디 카운트 켬') : t('녹음 전 카운트 끔')); break;
      case 'exportWav': this.exportWav?.(); break;
      case 'exportMp3': this.exportAudio('mp3'); break;
      case 'mastering': if (this.mastering.el.hidden) this.mastering.show(); else this.mastering.close(); break;
      case 'exportMidi': this.exportMidi?.(); break;
      case 'draw': case 'paint': case 'erase': case 'mutetool': case 'slicetool': case 'select': case 'zoom': case 'chord': case 'slide': case 'porta': {
        const t = { erase: 'delete', mutetool: 'mute', slicetool: 'slice' }[a] || a;
        if (this.tab === 'playlist') this.playlist.setTool?.(t); else this.roll.tool = t;
        this.renderPaneBars(); this.roll.draw(); this.playlist.draw?.();
        break;
      }
      case 'tour': this.tour.start('workspace'); break;
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
    const letter = !e.ctrlKey && !e.altKey && e.key.length === 1 && e.code !== 'Space';
    if (a && (!letter || a === 'songmode' || a === 'record' || ((this.tab === 'roll' || this.tab === 'playlist') && [this.roll.c, this.playlist.c].includes(document.activeElement)))) { e.preventDefault(); if (!e.repeat) this.runAction(a); return true; }
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

  // the on-screen keyboard is a window of its own (keys.html); its notes play the selected channel
  toggleKeys() {
    if (!this._keysWired) {
      this._keysWired = true;
      window.melofi.onKeysNote(({ n, v, on }) => { if (on) this.liveOn(n, v); else this.liveOff(n); });
      window.melofi.onKeysClosed(() => { this.keysOpen = false; this.renderToolbar(); });
    }
    this.keysOpen = !this.keysOpen;
    if (this.keysOpen) window.melofi.openKeysWindow({ theme: studioTheme() }); else window.melofi.closeKeysWindow();
    this.renderToolbar();
  }

  // ---------- sheets: undo history, shortcuts ----------
  historySheet(e) {
    const L = this.history.labels || [];
    if (!L.length) { popup(e.clientX, e.clientY, [{ label: t('기록이 없습니다'), disabled: true }]); return; }
    popup(e.clientX, e.clientY, [
      { group: t('실행 기록 (누르면 그 시점으로)') },
      ...L.slice(-20).map((x, i, arr) => ({ label: tdyn(x.label), hint: new Date(x.at).toLocaleTimeString(locale(), { hour12: false }), act: () => { for (let k = arr.length - i; k > 0; k--) this.history.undo(); } })).reverse(),
    ]).classList.add('tall');
  }

  async shortcutsSheet() {
    const cur = this.app.settings.get('studioKeys') || {};
    const v = await form(t('작곡 단축키'), Object.entries(ACTIONS).map(([k, [label, def]]) => ({ key: k, label: t(label), type: 'text', value: cur[k] || def })),
      { ok: t('저장'), note: t('예: Space, Ctrl+K, F5, B. 칸을 비우면 기본값으로 돌아갑니다.') });
    if (!v) return;
    const out = {};
    for (const [k, val] of Object.entries(v)) if (val && val !== ACTIONS[k][1]) out[k] = String(val).trim();
    this.app.settings.set({ studioKeys: out });
  }

  // ---------- UI ----------
  build() {
    const tb = h('div', { class: 'st-tool' });
    const tabs = h('div', { class: 'st-tabs' },
      ...[['roll', t('피아노 롤')], ['playlist', t('플레이리스트')], ['mixer', t('믹서')], ['live', t('라이브')]].map(([k, l]) => h('button', { 'data-tab': k, onclick: () => this.setTab(k) }, l)));
    this.rackEl = h('div', { class: 'st-rack' });
    this.browserEl = h('div', { class: 'st-browser', hidden: true });
    this.rollBar = h('div', { class: 'pane-bar' });
    this.plBar = h('div', { class: 'pane-bar' });
    const fhead = (k, name) => h('div', { class: 'st-fhead', title: t('끌어서 옮기기 · 더블클릭: 붙이기') }, h('b', {}, name), h('span', { class: 'sp' }),
      h('button', { class: 'btn sm ghost', title: t('원래 자리에 붙이기'), onclick: () => this.dock(k) }, t('붙이기')));
    const rollWrap = h('div', { class: 'st-pane roll' }, fhead('roll', t('피아노 롤')), this.rollBar, h('div', { class: 'cv' }, h('canvas', { tabIndex: 0 })));
    const plWrap = h('div', { class: 'st-pane playlist', hidden: true }, fhead('playlist', t('플레이리스트')), this.plBar, h('div', { class: 'cv' }, h('canvas', { tabIndex: 0 })));
    const mxInner = h('div', { class: 'mx-in' });
    const mxWrap = h('div', { class: 'st-pane mixer', hidden: true }, fhead('mixer', t('믹서')), mxInner);
    const lvWrap = h('div', { class: 'st-pane live', hidden: true });
    this.keysEl = h('div', { class: 'st-keys', hidden: true });
    this.statusEl = h('span', { class: 'st-status' });
    const split = h('div', { class: 'st-split', title: t('끌어서 너비 조절') });
    this.browserEl.hidden = false;
    this.browserCol = h('div', { class: 'st-bcol', hidden: true },
      h('div', { class: 'st-head' }, h('b', {}, t('브라우저')), h('button', { class: 'x', title: t('브라우저 닫기 (Alt+F8)'), onclick: () => this.setLeft('browser') })),
      this.browserEl);
    this.mainEl = h('div', { class: 'st-main' },
      this.browserCol,
      h('div', { class: 'st-left' },
        h('div', { class: 'st-head' },
          h('div', { class: 'st-ltabs' }, h('button', { 'data-l': 'browser', title: t('브라우저 보이기 / 숨기기 (Alt+F8)'), onclick: () => this.setLeft('browser') }, t('브라우저')), h('span', { 'data-l': 'rack', class: 'st-ltitle', title: t('채널 랙 (F6)') }, t('채널 랙'))),
          this.patternBar = h('div', { class: 'st-patbar' })),
        this.rackEl),
      split,
      this.rightEl = h('div', { class: 'st-right' }, tabs, rollWrap, plWrap, mxWrap, lvWrap));
    // hint bar (like FL's, under the menu bar): what the control under the mouse does
    const baseHint = () => t('Space 재생/정지 · Ctrl+Z 실행 취소 · Ctrl+S 저장 · F5 플레이리스트 · F6 채널 랙 · F7 피아노 롤 · F9 믹서 · L PAT/SONG · Alt+R Randomize') + (this.app.studioWindow ? '' : ' · ' + t('Esc 피아노로'));
    this.baseHint = baseHint;
    this.hintEl = h('span', { class: 'st-hint' }, baseHint());
    this.el = h('div', { id: 'studio', hidden: true },
      tb, this.mainEl, this.keysEl,
      h('div', { class: 'st-foot' }, this.statusEl));
    document.body.append(this.el);
    this.aiMini = new AiMini(this); // AI work still running with its window closed: a progress card in the corner
    this.el.addEventListener('mouseover', (e) => { const t = e.target.closest('[title]'); this.hintEl.textContent = t && this.el.contains(t) ? t.title : baseHint(); });
    // the left / right split can be dragged; the width is remembered
    const setW = (w) => this.layoutCols(w);
    // narrower than LEFT_MIN and the rack's names, buttons and hints break apart (one letter a line)
    const LEFT_MIN = 440;
    setW(Math.max(LEFT_MIN, this.app.settings.get('studioLeftW') || 520));
    split.addEventListener('pointerdown', (e) => {
      split.setPointerCapture(e.pointerId);
      const left = (ev) => Math.max(LEFT_MIN, Math.min(innerWidth - 400, ev.clientX - (this.browserOpen ? 250 : 0)));
      const move = (ev) => setW(left(ev));
      const up = (ev) => { split.removeEventListener('pointermove', move); split.removeEventListener('pointerup', up); this.app.settings.set({ studioLeftW: left(ev) }); this.roll.resize(); this.playlist.resize(); };
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
    this.mixer = new Mixer(this, mxInner);
    this.live = new Live(this, lvWrap);
    this.keys = new Keys(this, this.keysEl);
    this.panes = { roll: rollWrap, playlist: plWrap, mixer: mxWrap, live: lvWrap };
    new ResizeObserver(() => { if (!this.isOpen) return; if (this.visible('roll')) this.roll.resize(); if (this.visible('playlist')) this.playlist.resize(); }).observe(rollWrap.parentElement);
    this.floating = {};
    this.dockTab = 'roll';
    for (const k of ['roll', 'playlist', 'mixer']) this.wireFloat(k);
    // tabs: double-click tears a pane off (or docks it back), right-click opens the window menu
    for (const b of tabs.querySelectorAll('button')) {
      b.addEventListener('dblclick', () => { const k = b.dataset.tab; if (this.floating[k]) this.dock(k); else this.detach(k); });
      b.addEventListener('contextmenu', (e) => { e.preventDefault(); this.windowMenu(e); });
    }
    this.setTab('roll');
    const lay = this.app.settings.get('studioLayout');
    if (lay) requestAnimationFrame(() => { for (const [k, r] of Object.entries(lay)) if (r) this.detach(k, { ...r }); this.setTab(this.dockTab); });
    this.applyLook();
    // the language changed (here or in another window): swap the text built once, then redraw
    onLangChange(() => { if (!this.el) return; translateDom(this.el); this.relabel(); this.renderAll(); });
  }

  // text of the parts built once in build() (tabs, floating pane heads, hint bar)
  relabel() {
    const names = { roll: t('피아노 롤'), playlist: t('플레이리스트'), mixer: t('믹서'), live: t('라이브') };
    for (const b of this.el.querySelectorAll('.st-tabs button[data-tab]')) b.textContent = names[b.dataset.tab] || b.textContent;
    for (const [k, w] of Object.entries(this.panes || {})) { const b = w.querySelector(':scope > .st-fhead > b'); if (b && names[k]) b.textContent = names[k]; }
    if (this.hintEl) this.hintEl.textContent = this.baseHint();
  }

  renderAll() {
    if (!this.el) return;
    this.renderToolbar();
    this.renderPatternBar();
    this.renderPaneBars();
    this.rack.render();
    this.roll.draw();
    this.playlist.draw();
    if (this.visible('mixer')) this.mixer.render();
    if (this.visible('live')) this.live.render();
    if (this.leftTab === 'browser') this.browser.render();
    if (this._chs && !this._chs.el.hidden) this._chs.render();
  }

  // The top toolbar, laid out like FL Studio's: menu bar with the hint bar under it at the far left,
  // then transport (PAT/SONG, play, stop, record, tempo, position), the recording switches, pattern
  // selector, snap, the window shortcut icons, and the master volume + output meter at the right end.
  // (docs/fl-toolbar-map.md maps every control.)
  renderToolbar() {
    const proj = this._proj, Tr = this.transport;
    const btn = (label, title, act, cls = '', tour) => h('button', { class: `btn ${cls}`, title, onclick: act, 'data-tour': tour }, label);
    const icon = (k, title, act, on, tour) => { const b = h('button', { class: `tb-ico${on ? ' on' : ''}`, title, 'aria-label': title, onclick: act, 'data-win': k, 'data-tour': tour }); b.innerHTML = ICONS[k]; return b; };
    const menus = [['file', t('파일')], ['edit', t('편집')], ['add', t('추가')], ['patterns', t('패턴')], ['view', t('보기')], ['options', t('옵션')], ['tools', t('도구')], ['help', t('도움말')]];
    const tour = { file: 'file', view: 'windows', options: 'options' };
    this.toolEl.replaceChildren(
      // 1. menu bar, and the title / hint line under it
      h('div', { class: 'tb-grp tb-menu' },
        h('div', { class: 'tb-menubar' }, ...menus.map(([k, l]) => h('button', {
          class: 'mb', 'data-menu': k, 'data-tour': tour[k],
          onpointerdown: () => { this._menuWas = this._menuKey === k && !!document.querySelector('.st-menupop'); },
          onpointerenter: (e) => { if (document.querySelector('.st-menupop') && this._menuKey !== k) this.openMenu(k, e.currentTarget); },
          onclick: (e) => { if (this._menuWas) { document.querySelector('.st-menupop')?.remove(); this.menuClosed(); } else this.openMenu(k, e.currentTarget); },
        }, l))),
        h('div', { class: 'tb-title' },
          h('input', { class: 'st-name', value: proj.name, title: t('프로젝트 이름'), onchange: (e) => { proj.name = e.target.value || t('새 프로젝트'); this.dirty = true; } }),
          this.hintEl)),
      // 2. transport
      h('div', { class: 'tb-grp tb-transport' },
        h('div', { class: 'tb-mode', 'data-tour': 'mode' },
          h('button', { class: proj.mode === 'pattern' ? 'on' : '', title: t('PAT: 지금 패턴만 반복 (L)'), onclick: () => this.setMode('pattern') }, 'PAT'),
          h('button', { class: proj.mode === 'song' ? 'on' : '', title: t('SONG: 플레이리스트 전체 (L)'), onclick: () => this.setMode('song') }, 'SONG'),
          h('button', { class: `live${proj.mode === 'live' ? ' on' : ''}`, title: t('라이브: 트랙마다 패턴을 골라 실시간으로'), onclick: () => { this.setMode('live'); this.setTab('live'); } }, t('라이브'))),
        btn(Tr.playing ? '❚❚' : '▶', t('재생 / 일시정지 (Space)'), () => { Tr.toggle(); this.renderToolbar(); }, 'tb-big play', 'play'),
        btn('■', t('정지 (Space)'), () => { Tr.stop(); this.renderToolbar(); }, 'tb-big stop'),
        btn('●', t('노트 녹음: 재생 중 건반으로 친 음을 패턴에 기록 (R)'), () => this.runAction('record'), `tb-big rec${Tr.recording ? ' on' : ''}`, 'rec'),
        h('label', { class: 'tb-lcd tb-tempo', 'data-tour': 'bpm', title: t('템포 (BPM) · 우클릭: 탭 템포, 절반 / 두 배, 박자'), oncontextmenu: (e) => { e.preventDefault(); this.tempoMenu(e); } },
          h('input', { type: 'number', min: 30, max: 300, step: 1, value: proj.bpm, onchange: (e) => this.setBpm(+e.target.value || 120) }),
          h('small', {}, `BPM · ${proj.sig.join('/')}`)),
        btn(t('탭'), t('탭 템포: 박자에 맞춰 여러 번 누르면 그 빠르기로 템포가 맞춰집니다'), () => this.tap(), 'tb-tap'),
        h('div', { class: 'tb-lcd tb-pos', title: t('재생 위치 (마디:박:스텝)') }, this.posEl = h('span', {}, '1:1:1'), h('small', {}, t('마디:박:스텝')))),
      // 3. recording switches
      h('div', { class: 'tb-grp tb-rec' },
        btn(t('메트로놈'), t('메트로놈 (Ctrl+M)'), () => this.runAction('metro'), `sm${Tr.metro ? ' on' : ''}`, 'metro'),
        btn(t('카운트'), t('녹음 전 1마디 세기 (Ctrl+P)'), () => { this.runAction('countin'); this.renderToolbar(); }, `sm${this.countIn ? ' on' : ''}`),
        btn(this.arec ? t('녹음 중') : t('마이크'), t('마이크나 오디오 입력을 녹음해 플레이리스트에 넣기'), () => this.toggleAudioRec(), `sm${this.arec ? ' rec on' : ''}`, 'mic'),
        btn(t('건반'), t('화면 건반 (Ctrl+Shift+K)'), () => this.toggleKeys(), `sm${this.keysOpen ? ' on' : ''}`, 'keys')),
      // 4. pattern selector, global snap
      h('div', { class: 'tb-grp tb-pat' },
        h('select', { class: 'st-patpick', title: t('패턴 고르기 (F4: 새 패턴 · F2: 이름 바꾸기)'), 'data-tour': 'patpick', onchange: (e) => this.setPattern(e.target.value) },
          ...proj.patterns.map((p) => h('option', { value: p.id, selected: p.id === proj.current }, p.name))),
        h('label', { class: 'st-field tb-snap', title: t('스냅: 노트와 클립이 붙는 격자') }, t('스냅'), h('select', { onchange: (e) => { this.snapKey = e.target.value === 'bar' ? 'bar' : +e.target.value; this.roll.draw(); } },
          ...SNAPS.map(([v, l]) => h('option', { value: v, selected: String(this.snapKey) === String(v) }, t(l)))))),
      h('span', { class: 'sp' }),
      // 5. window shortcuts, in FL's order
      h('div', { class: 'tb-grp tb-wins' },
        icon('playlist', t('플레이리스트 (F5)'), () => this.runAction('playlist'), this.tab === 'playlist'),
        icon('roll', t('피아노 롤 (F7)'), () => this.runAction('roll'), this.tab === 'roll'),
        icon('rack', t('채널 랙 (F6)'), () => this.runAction('rack'), false),
        icon('mixer', t('믹서 (F9)'), () => this.runAction('mixer'), this.tab === 'mixer'),
        icon('browser', t('브라우저 (Alt+F8)'), () => this.runAction('browser'), this.browserOpen),
        icon('picker', t('플러그인 피커: 악기 채널 추가 (F8)'), () => this.runAction('picker'), false),
        icon('live', t('라이브 (Ctrl+F8)'), () => this.runAction('live'), this.tab === 'live')),
      // 6. master volume and output
      h('div', { class: 'tb-grp tb-master', title: t('마스터 볼륨 · 우클릭: 오토메이션 / MIDI 연결') },
        h('input', { type: 'range', class: 'tb-vol', min: 0, max: 1, step: 0.01, value: proj.master.vol, title: t('마스터 볼륨'),
          oninput: (e) => this.setValue('master:vol', +e.target.value), onchange: () => { if (this.visible('mixer')) this.mixer.render(); },
          oncontextmenu: (e) => { e.preventDefault(); this.controlMenu(e, 'master:vol', t('마스터 볼륨')); } }),
        this.outEl = h('div', { class: 'tb-out', title: t('출력 레벨') }, h('i'))));
  }

  setBpm(v) {
    const proj = this._proj;
    this.edit(() => { proj.bpm = Math.max(30, Math.min(300, Math.round(v))); });
    this.engine.info.bpm = proj.bpm; this.syncAudio();
  }

  tempoMenu(e) {
    const proj = this._proj;
    popup(e.clientX, e.clientY, [
      { label: t('탭 템포'), hint: t('여러 번 눌러서'), act: () => this.tap() },
      { label: t('절반 템포'), hint: `${Math.round(proj.bpm / 2)}`, act: () => this.setBpm(proj.bpm / 2) },
      { label: t('두 배 템포'), hint: `${Math.round(proj.bpm * 2)}`, act: () => this.setBpm(proj.bpm * 2) },
      { group: t('박자') }, ...this.sigItems(),
    ]);
  }

  sigItems() {
    const proj = this._proj;
    return ['4/4', '3/4', '6/8', '5/4', '7/8'].map((s) => ({ label: s, check: proj.sig.join('/') === s, act: () => this.edit(() => { proj.sig = s.split('/').map(Number); }) }));
  }

  // the menu bar: a click opens a menu under its name; while one is open, moving to another name opens that one
  openMenu(k, b) {
    const r = b.getBoundingClientRect(), at = { clientX: r.left, clientY: r.bottom };
    this._menuKey = k;
    for (const x of this.toolEl.querySelectorAll('.mb')) x.classList.toggle('open', x === b);
    const pop = popup(r.left, r.bottom + 1, this.menuItems(k, at));
    pop.classList.add('st-menupop');
    if (pop.offsetHeight > innerHeight * 0.6) pop.classList.add('tall');
    if (!this._menuObs) {
      this._menuObs = new MutationObserver(() => { if (this._menuKey && !document.querySelector('.st-menupop')) this.menuClosed(); });
      this._menuObs.observe(document.body, { childList: true });
    }
  }

  menuClosed() {
    this._menuKey = null;
    for (const x of this.toolEl.querySelectorAll('.mb.open')) x.classList.remove('open');
  }

  menuItems(k, at) {
    const proj = this._proj, pat = pattern(proj), Tr = this.transport;
    const x = at.clientX, y = at.clientY;
    const keyOf = (a) => (this.app.settings.get('studioKeys') || {})[a] || ACTIONS[a][1];
    const act = (a, label) => ({ label: label || t(ACTIONS[a][0]), hint: keyOf(a), act: () => this.runAction(a) });
    const M = {
      file: () => [
        { label: t('새 프로젝트 (템플릿)…'), act: () => this.newFromTemplate(x, y + 12) },
        { label: 'Loop Starter…', hint: t('장르를 고르면 바로 루프'), act: () => this.loopStarter(x, y + 12) },
        { label: t('열기…'), hint: keyOf('open'), act: () => this.openFile() },
        { label: t('최근 프로젝트 · 자동 저장 기록…'), act: () => this.recentMenu(at) },
        { label: t('저장'), hint: keyOf('save'), act: () => this.save() },
        { label: t('다른 이름으로 저장…'), hint: 'Ctrl+Shift+S', act: () => this.save(true) },
        { group: t('가져오기') },
        { label: t('MIDI 가져오기…'), act: () => this.importMidi() },
        { label: t('AI로 음원 분리 · MIDI 변환…'), hint: 'MP4 · WAV · MP3', act: () => this.aiSheet.show() },
        { group: t('내보내기') },
        { label: t('오디오로 내보내기 (WAV · FLAC · MP3 · OGG)…'), hint: keyOf('exportWav'), act: () => this.exportAudio() },
        { label: t('MIDI로 내보내기'), hint: keyOf('exportMidi'), act: () => this.exportMidi() },
        { label: t('영상으로 내보내기…'), act: () => this.exportVideo() },
        { label: T.daw.open, act: () => this.dawSheet.show() },
        { label: t('마스터링…'), hint: keyOf('mastering'), act: () => this.mastering.show() },
        { group: t('클라우드') },
        { label: T.cloud.menuSave, act: () => this.cloudSheet.show('projects') },
        { label: T.cloud.menuShared, act: () => this.cloudSheet.show('shared') },
        { label: T.cloud.menuAccount, act: () => this.cloudSheet.show('account') },
      ],
      edit: () => [
        { label: t('실행 취소'), hint: keyOf('undo'), act: () => this.history.undo() },
        { label: t('다시 실행'), hint: keyOf('redo'), act: () => this.history.redo() },
        { label: t('실행 기록…'), hint: t('그 시점으로 되돌리기'), act: () => this.historySheet(at) },
      ],
      add: () => [
        { label: t('채널 (플러그인 피커)…'), hint: keyOf('picker'), act: () => this.runAction('picker') },
        { label: t('샘플 채널 (오디오 파일)…'), act: () => this.addSampleChannel('sample') },
        { label: t('슬라이서 채널 (루프 자르기)…'), act: () => this.addSampleChannel('slicer') },
        { label: t('오디오 클립…'), hint: t('플레이리스트에'), act: async () => { const fs2 = await window.melofi.mediaPickFiles(); for (const f of fs2) await this.addAudioClip(f.name, f.data); } },
        { label: t('오토메이션 클립…'), act: () => this.autoTargetMenu(at) },
        { label: t('패턴'), hint: keyOf('newpattern'), act: () => this.runAction('newpattern') },
        { label: t('플레이리스트 트랙'), act: () => this.edit(() => proj.playlist.tracks.push(newTrack(proj.playlist.tracks.length))) },
      ],
      patterns: () => [
        act('newpattern', t('새 패턴')),
        act('renamepattern', t('이름 바꾸기…')),
        { label: t('복제'), act: () => this.edit(() => { const p = JSON.parse(JSON.stringify(pat)); p.id = uid('p'); p.name = t('{name} 복사', { name: pat.name }); proj.patterns.push(p); proj.current = p.id; }, true, t('패턴 복제')) },
        { label: t('삭제'), disabled: proj.patterns.length <= 1, act: () => { if (confirm(t("'{name}'을(를) 삭제할까요?", { name: pat.name }))) this.edit(() => { proj.patterns.splice(proj.patterns.indexOf(pat), 1); proj.playlist.clips = proj.playlist.clips.filter((c) => c.pattern !== pat.id); proj.current = proj.patterns[0].id; }, true, t('패턴 삭제')); } },
        { label: t('채널별로 패턴 나누기'), hint: t('가져온 MIDI 정리에'), act: () => this.splitByChannel() },
        act('timesig', t('박자표 바꾸기 (재생 위치부터)…')),
        { group: t('박자') }, ...this.sigItems(),
      ],
      view: () => [
        { group: t('창') },
        act('playlist'), act('roll'), act('rack'), act('mixer'), act('browser'), act('live'), act('keys'),
        { group: t('창 배치') },
        ...Object.entries({ roll: t('피아노 롤'), playlist: t('플레이리스트'), mixer: t('믹서') }).map(([w, n]) => ({ label: this.floating[w] ? t('{n} 붙이기', { n }) : t('{n} 떼어내기', { n }), hint: t('탭 더블클릭'), act: () => (this.floating[w] ? this.dock(w) : this.detach(w)) })),
        { label: t('모두 떼어내기 (작업 창 배치)'), act: () => this.arrange('fl') },
        { label: t('모두 붙이기'), act: () => this.arrange('docked') },
        { sep: true },
        { label: t('화면 꾸미기…'), hint: t('크기 · 색 · 트랙 높이'), act: () => this.lookSheet() },
      ],
      options: () => [
        { ...act('metro'), check: Tr.metro },
        { ...act('countin', t('녹음 전 1마디 세기')), check: !!this.countIn },
        { ...act('loop', t('반복 구간')), check: !!proj.loopOn, disabled: !proj.loop },
        { sep: true },
        { label: t('단축키 설정…'), act: () => this.shortcutsSheet() },
        { group: t('테마') },
        ...STUDIO_THEMES.map((k) => ({ label: themeName(k), check: this.look().theme === k, act: () => this.setTheme(k) })),
        { group: t('언어') }, // Language: follows the OS unless chosen (docs/i18n.md)
        ...langChoices().map(([k, label]) => ({ label, check: (this.app.settings.get('lang') || 'system') === k, act: () => this.app.settings.set({ lang: k }) })),
      ],
      tools: () => [
        { label: 'Riff Machine…', hint: t('코드 진행 → 아르페지오 → 리듬 → 변형'), act: () => this.riffDialog() },
        { label: 'Randomize…', hint: 'Alt+R', act: () => this.randomizeDialog() },
        { label: t('퀀타이즈…'), hint: 'Alt+Q', act: () => this.quantizeDialog() },
        { label: t('피아노 롤 도구…'), hint: t('아르페지오 · 스트럼 · Humanize …'), act: () => this.rollTools(at) },
        { sep: true },
        { label: t('방금 연주한 것 패턴에 넣기'), hint: t('녹음 안 켜고 친 것도'), act: () => this.dumpScoreLog(1) },
        { label: this.arec ? t('마이크 녹음 멈추기') : t('마이크 녹음'), hint: t('플레이리스트에 오디오 클립'), act: () => this.toggleAudioRec() },
        { label: t('채널을 믹서 트랙에 연결'), hint: keyOf('link'), act: () => this.linkToMixer(proj.selected) },
      ],
      help: () => [
        { group: t('튜토리얼') },
        ...CHAPTERS.map((c, i) => ({ label: `${i + 1}. ${t(c.name)}`, hint: i === 0 ? keyOf('tour') : '', act: () => this.tour.start(c.id) })),
        { sep: true }, ...infraMenuItems(), // 업데이트 확인 · 문제 신고 (js/appinfra.js)
      ],
    };
    return M[k]();
  }

  // tool bars above the piano roll and the playlist
  renderPaneBars() {
    if (!this.rollBar) return;
    const proj = this._proj, R = this.roll, P = this.playlist;
    const sc = proj.scale;
    const tool = (k, label, title, tour) => h('button', { class: R.tool === k ? 'on' : '', title, 'data-tour': tour, onclick: () => { R.tool = k; this.renderPaneBars(); R.draw(); } }, label);
    this.rollBar.replaceChildren(...[
      h('div', { class: 'seg sm', 'data-tour': 'roll-tools' }, tool('draw', 'Draw', t('Draw: 노트 그리기 (P)')), tool('paint', 'Paint', t('Paint: 끌면서 여러 음 칠하기 (B)')), tool('delete', 'Delete', t('Delete: 지우기 (D)')), tool('mute', 'Mute', t('Mute: 음 음소거 (T)')), tool('slice', 'Slice', t('Slice: 음 자르기 (C)')), tool('select', 'Select', t('Select: 선택 (E)')), tool('zoom', 'Zoom', t('Zoom: 확대, 오른클릭 축소 (Z)')), tool('slide', 'Slide', t('Slide 노트 (S)')), tool('porta', 'Porta', t('Portamento: 앞 음에서 미끄러져 들어오는 노트 (O)')), tool('chord', 'Stamp', t('Stamp: 클릭 한 번에 코드 (H)'), 'tool-chord')),
      R.tool === 'chord' ? h('select', { title: t('화음 종류'), onchange: (e) => { R.chord = e.target.value; R.draw(); } }, ...Object.entries(CHORDS).map(([k, c]) => h('option', { value: k, selected: R.chord === k }, t(c.name)))) : null,
      R.tool === 'chord' && R.chord === 'auto' ? h('select', { title: t('음 개수'), onchange: (e) => { R.chordSize = +e.target.value; } }, h('option', { value: 3, selected: R.chordSize === 3 }, t('3화음')), h('option', { value: 4, selected: R.chordSize === 4 }, t('7화음'))) : null,
      h('span', { class: 'bar-gap' }),
      h('label', { class: 'st-field', 'data-tour': 'scale' }, t('스케일'),
        h('select', { onchange: (e) => this.edit(() => { proj.scale = e.target.value === '' ? null : { root: +e.target.value, type: proj.scale?.type || 'major' }; }) },
          h('option', { value: '', selected: !sc }, t('끔')), ...ROOTS.map((r, i) => h('option', { value: i, selected: sc?.root === i }, r))),
        sc ? h('select', { onchange: (e) => this.edit(() => { proj.scale = { ...proj.scale, type: e.target.value }; }) }, ...Object.entries(SCALES).map(([k, s]) => h('option', { value: k, selected: sc.type === k }, t(s.name)))) : null,
        sc ? h('label', { class: 'chk', title: t('스케일 밖의 음은 찍히지 않습니다') }, h('input', { type: 'checkbox', checked: R.lock, onchange: (e) => { R.lock = e.target.checked; } }), t('고정')) : null),
      h('span', { class: 'bar-gap' }),
      h('label', { class: 'st-field' }, t('아래 칸'), h('select', { onchange: (e) => { R.lane = e.target.value; R.draw(); } }, ...Object.entries(LANES).map(([k, l]) => h('option', { value: k, selected: R.lane === k }, t(l))))),
      h('button', { class: 'btn sm', 'data-tour': 'tools', onclick: (e) => this.rollTools(e) }, t('도구 ▾')),
      h('span', { class: 'sp' }),
      h('span', { class: 'hint' }, R.tool === 'chord' ? t('클릭: 코드 찍기') : R.tool === 'slide' ? t('노트를 누르면 슬라이드로 바뀜') : t('클릭: 음 · 끌기: 길이 · 우클릭: 지우기'))].filter(Boolean));
    const ptool = (k, label, title) => h('button', { class: P.tool === k ? 'on' : '', title, onclick: () => { P.tool = k; this.renderPaneBars(); P.draw(); } }, label);
    this.plBar.replaceChildren(...[
      h('div', { class: 'seg sm', 'data-tour': 'pl-tools' }, ptool('draw', 'Draw', t('Draw: 클립 놓기 (P)')), ptool('paint', 'Paint', t('Paint: 끌면서 패턴 칠하기 (B)')), ptool('delete', 'Delete', t('Delete: 지우기 (D)')), ptool('mute', 'Mute', t('Mute: 클립 음소거 (T)')), ptool('slice', 'Slice', t('Slice: 클립 자르기 (C)')), ptool('select', 'Select', t('Select: 드래그해서 여러 클립 선택 (E) · Draw에서는 Ctrl+드래그'))),
      h('div', { class: 'seg sm' }, h('button', { class: P.grid === 'bar' ? 'on' : '', onclick: () => { P.grid = 'bar'; this.renderPaneBars(); P.draw(); } }, t('마디')), h('button', { class: P.grid === 'beat' ? 'on' : '', onclick: () => { P.grid = 'beat'; this.renderPaneBars(); P.draw(); } }, t('박'))),
      h('button', { class: `btn sm${proj.loopOn ? ' on' : ''}`, disabled: !proj.loop, title: t('눈금자를 끌어서 반복 구간을 정합니다 (Ctrl+Shift+L)'), onclick: () => this.edit(() => { proj.loopOn = !proj.loopOn; }) }, proj.loop ? t('반복 {a}~{b}마디', { a: proj.loop.start + 1, b: proj.loop.end }) : t('반복 구간 없음')),
      h('button', { class: 'btn sm', title: t('오디오 파일을 클립으로'), onclick: async () => { const fs2 = await window.melofi.mediaPickFiles(); for (const f of fs2) await this.addAudioClip(f.name, f.data); } }, t('+ 오디오')),
      h('button', { class: 'btn sm', title: t('노브를 우클릭해도 만들 수 있습니다'), 'data-tour': 'add-auto', onclick: (e) => this.autoTargetMenu(e) }, t('+ 오토메이션')),
      h('button', { class: 'btn sm', onclick: () => this.edit(() => proj.playlist.tracks.push(newTrack(proj.playlist.tracks.length))) }, t('+ 트랙')),
      h('span', { class: 'sp' }),
      h('span', { class: 'hint' }, t('눈금자 끌기: 반복 구간 · 위 띠 더블클릭: 마커 · 우클릭: 템포 변화 · Ctrl+끌기: 복제'))].filter(Boolean));
  }

  // FL's "link channel to mixer track": the channel gets a mixer track of its own (a bus) it plays into
  linkToMixer(chId) {
    const proj = this._proj, ch = proj.channels.find((c) => c.id === chId);
    if (!ch) return;
    const cur = proj.buses.find((b) => b.id === ch.out);
    if (cur) { this.status(t('{name}은(는) 이미 믹서 트랙 ‘{track}’에 연결되어 있어요.', { name: ch.name, track: cur.name })); this.setTab('mixer'); return; }
    this.edit(() => { const b = newBus(proj.buses.length, ch.name); proj.buses.push(b); ch.out = b.id; }, true, t('믹서 트랙 연결'));
    this.syncAudio();
    this.setTab('mixer');
    this.status(t('{name}을(를) 새 믹서 트랙에 연결했어요.', { name: ch.name }));
  }

  // FL Studio's quantize dialog (Alt+Q); Ctrl+Alt+Q quantizes at once
  async quantizeDialog() {
    const v = await form(t('퀀타이즈'), [
      { key: 'grid', label: t('격자'), type: 'select', value: this.snap, options: SNAPS.filter(([g]) => g !== 'bar').map(([g, l]) => [g, t(l)]) },
      { key: 'strength', label: t('강도 (%)'), type: 'number', value: 100, min: 0, max: 100 }, { key: 'lengths', label: t('길이도 맞추기'), type: 'check', value: false }]);
    if (v) this.roll.quantizeOpts({ ...v, strength: v.strength / 100 });
  }

  // FL Studio's Riff Machine (piano roll tools menu): a step-by-step window
  riffDialog() { this.riffWizard.open(); }

  // FL Studio's Randomize (Alt+R): random notes in the scale
  async randomizeDialog() {
    const sc = this._proj.scale;
    const v = await form('Randomize', [
      { key: 'style', label: t('종류'), type: 'select', value: 'melody', options: [['melody', t('멜로디')], ['bass', t('베이스 라인')], ['chords', t('코드')], ['arp', t('아르페지오 코드')]] },
      { key: 'bars', label: t('길이 (마디)'), type: 'number', value: pattern(this._proj).bars, min: 1, max: 16 },
      { key: 'density', label: t('음 밀도 (%)'), type: 'number', value: 55, min: 5, max: 100 },
      { key: 'low', label: t('가장 낮은 음 (MIDI 번호, 60 = 가운데 도)'), type: 'number', value: 60, min: 24, max: 96 },
      { key: 'range', label: t('음역 (반음)'), type: 'number', value: 14, min: 5, max: 36 },
      { key: 'replace', label: t('기존 노트 지우고 새로'), type: 'check', value: true },
    ]);
    if (!v) return;
    const n = this.roll.riff({ ...v, density: v.density / 100 });
    this.status(sc ? t('Randomize: 스케일에 맞춰 {n}개 노트를 만들었어요. 다시 하려면 Alt+R.', { n }) : t('Randomize: 스케일이 없어 C 마이너로 {n}개 노트를 만들었어요. 다시 하려면 Alt+R.', { n }));
  }

  rollTools(e) {
    const R = this.roll;
    popup(e.clientX, e.clientY + 12, [
      { label: 'Riff Machine…', hint: t('코드 진행 → 아르페지오 → 리듬 → 변형'), act: () => this.riffDialog() },
      { label: 'Randomize…', hint: 'Alt+R', act: () => this.randomizeDialog() },
      { label: t('아르페지오…'), hint: t('화음을 한 음씩 펼치기'), act: async () => { const v = await form(t('아르페지오'), [
        { key: 'pattern', label: t('순서'), type: 'select', value: 'up', options: [['up', t('아래에서 위로')], ['down', t('위에서 아래로')], ['updown', t('올라갔다 내려오기')], ['random', t('무작위')]] },
        { key: 'rate', label: t('빠르기'), type: 'select', value: STEP, options: [[PPQ / 2, t('8분음표')], [STEP, t('16분음표')], [STEP / 2, t('32분음표')], [PPQ / 6, t('16분 셋잇단')]] },
        { key: 'octaves', label: t('옥타브 범위'), type: 'number', value: 1, min: 1, max: 3 },
        { key: 'gate', label: t('음 길이 (%)'), type: 'number', value: 90, min: 10, max: 100 }]); if (v) R.arpeggiate({ ...v, gate: v.gate / 100 }); } },
      { label: t('스트럼…'), hint: t('기타처럼 살짝 엇갈리게'), act: async () => { const v = await form(t('스트럼'), [
        { key: 'spread', label: t('엇갈림 정도'), type: 'number', value: 3, min: 1, max: 24 },
        { key: 'direction', label: t('방향'), type: 'select', value: 'down', options: [['down', t('다운 (높은 음부터)')], ['up', t('업 (낮은 음부터)')]] }]); if (v) R.strum(v); } },
      { label: 'Humanize…', hint: t('사람이 친 것처럼'), act: async () => { const v = await form('Humanize', [
        { key: 'timing', label: t('타이밍 흔들기 (틱)'), type: 'number', value: 6, min: 0, max: 24 }, { key: 'velocity', label: t('벨로시티 흔들기'), type: 'number', value: 12, min: 0, max: 40 }]); if (v) R.humanize(v); } },
      { label: t('퀀타이즈…'), hint: 'Alt+Q', act: () => this.quantizeDialog() },
      { label: t('레가토'), hint: t('다음 음까지 길이 늘리기'), act: () => R.legato() },
      { label: t('Chop (스냅 길이로)'), hint: t('Ctrl+U · 하이햇 롤, 트랩 연타'), act: () => R.chop(this.snap) },
      { label: 'Glue', hint: t('Ctrl+G · 같은 높이로 이어진 음 합치기'), act: () => R.glue() },
      { sep: true },
      { label: t('좌우 뒤집기'), act: () => R.transform('reverse') },
      { label: t('위아래 뒤집기'), act: () => R.transform('flip') },
      { label: t('한 옥타브 위로 겹치기'), act: () => R.transform('octUp') },
      { label: t('한 옥타브 아래로 겹치기'), act: () => R.transform('octDown') },
      { label: t('스케일에 맞추기'), disabled: !this._proj.scale, act: () => R.transform('toScale') },
      { label: t('벨로시티 무작위'), act: () => R.transform('randVel') },
      { sep: true },
      { label: t('채널별로 패턴 나누기'), hint: t('가져온 MIDI 정리에'), act: () => this.splitByChannel() },
      { label: t('방금 연주한 것 패턴에 넣기'), hint: t('녹음 안 켜고 친 것도'), act: () => this.dumpScoreLog(1) },
      { label: this.countIn ? t('녹음 전 1마디 세기 끄기') : t('녹음 전 1마디 세기 켜기'), act: () => { this.countIn = !this.countIn; } },
    ]);
  }

  autoTargetMenu(e) {
    const p = this._proj;
    const items = [{ group: t('채널') }];
    for (const c of p.channels) items.push({ label: t('{name} 볼륨', { name: c.name }), act: () => this.makeAutomation(`ch:${c.id}:vol`) }, { label: t('{name} 팬', { name: c.name }), act: () => this.makeAutomation(`ch:${c.id}:pan`) });
    const fxList = [['master', t('마스터'), p.master.fx], ...p.channels.map((c) => [c.id, c.name, c.fx]), ...p.buses.map((b) => [b.id, b.name, b.fx])];
    const fxItems = [];
    for (const [sid, name, list] of fxList) for (const f of list) for (const q of FX_TYPES[f.type].params) if (!q.choices && !q.channel) fxItems.push({ label: `${name} · ${t(FX_TYPES[f.type].name)} ${t(q.label)}`, act: () => this.makeAutomation(`fx:${sid}:${f.id}:${q.key}`) });
    if (fxItems.length) items.push({ group: t('이펙트') }, ...fxItems);
    items.push({ group: t('마스터') }, { label: t('마스터 볼륨'), act: () => this.makeAutomation('master:vol') });
    popup(e.clientX, e.clientY + 12, items).classList.add('tall');
  }

  renderPatternBar() {
    const proj = this._proj, pat = pattern(proj);
    this.patternBar.replaceChildren(...[
      h('select', { title: t('패턴'), onchange: (e) => this.setPattern(e.target.value) },
        ...proj.patterns.map((p) => h('option', { value: p.id, selected: p.id === proj.current }, p.name))),
      h('button', { class: 'btn sm', title: t('새 패턴'), onclick: () => this.edit(() => { const p = newPattern(proj.patterns.length, pat.bars); proj.patterns.push(p); proj.current = p.id; }, true, t('새 패턴')) }, '+'),
      h('button', { class: 'btn sm', title: t('패턴 복제'), onclick: () => this.edit(() => { const p = JSON.parse(JSON.stringify(pat)); p.id = uid('p'); p.name = t('{name} 복사', { name: pat.name }); proj.patterns.push(p); proj.current = p.id; }, true, t('패턴 복제')) }, '⧉'),
      h('button', { class: 'btn sm', title: t('패턴 이름'), onclick: async () => { const v = await ask(t('패턴 이름'), pat.name); if (v && v.trim()) this.edit(() => { pat.name = v.trim(); }); } }, t('이름')),
      h('select', { title: t('패턴 길이'), onchange: (e) => this.edit(() => { pat.bars = +e.target.value; }) },
        ...[1, 2, 4, 8, 16].map((b) => h('option', { value: b, selected: pat.bars === b }, t('{n}마디', { n: b })))),
      // swing sits on the channel rack, as in FL
      h('label', { class: 'st-field st-swing', title: t('스윙: 짝수 16분음표를 뒤로 밀어 그루브 주기') }, t('스윙'), h('input', { type: 'range', min: 0, max: 0.6, step: 0.05, value: proj.swing, oninput: (e) => { proj.swing = +e.target.value; this.transport.refresh(); this.dirty = true; } })),
      h('button', { class: 'btn sm', title: t('패턴 삭제'), disabled: proj.patterns.length <= 1, onclick: () => { if (confirm(t("'{name}'을(를) 삭제할까요?", { name: pat.name }))) this.edit(() => { proj.patterns.splice(proj.patterns.indexOf(pat), 1); proj.playlist.clips = proj.playlist.clips.filter((c) => c.pattern !== pat.id); proj.current = proj.patterns[0].id; }, true, t('패턴 삭제')); } }, t('삭제')),
    ].filter(Boolean));
  }

  updatePos() {
    if (!this.posEl) return;
    const proj = this._proj, Tk = this.transport.songPos();
    // position follows time signature markers in song mode
    const B = proj.mode === 'song' && proj.sigs?.length ? barAt(proj, Tk) : { num: Math.floor(Tk / barTicks(proj)), start: Math.floor(Tk / barTicks(proj)) * barTicks(proj), beat: (PPQ * 4) / proj.sig[1] };
    const bar = B.num, b = Math.floor((Tk - B.start) / B.beat), s = Math.floor(((Tk - B.start) % B.beat) / STEP);
    this.posEl.textContent = `${bar + 1}:${b + 1}:${s + 1}`;
  }

  status(t) { if (this.statusEl) this.statusEl.textContent = t; }

  loop() {
    if (!this.isOpen) return;
    if (this.transport.playing) {
      this.updatePos();
      if (this.visible('roll')) this.roll.draw();
      if (this.visible('playlist')) this.playlist.draw();
    }
    if (this.visible('mixer')) this.mixer.tick();
    this.tickOut();
    requestAnimationFrame(() => this.loop());
  }

  // the toolbar's output meter (master peak, -48..0 dB, with a falling peak line)
  tickOut() {
    if (!this.outEl?.isConnected) return;
    const lvl = this.engine.level(), db = lvl > 1e-5 ? 20 * Math.log10(lvl) : -100;
    const f = Math.max(0, Math.min(1, (db + 48) / 48));
    this._outPk = Math.max(f, (this._outPk || 0) - 0.012);
    this.outEl.style.setProperty('--f', f.toFixed(3));
    this.outEl.style.setProperty('--p', this._outPk.toFixed(3));
    this.outEl.classList.toggle('clip', lvl > 0.98);
  }
}

