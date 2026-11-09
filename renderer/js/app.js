import { Settings, DEFAULTS } from './settings.js';
import { Engine } from './audio.js';
import { Stage } from './stage.js';
import { Recorder } from './recorder.js';
import { UI } from './ui.js';
import { PRESETS, RESERVED, keyLabel, noteName } from './keymap.js';
import { T } from './strings.js';
import { Metronome } from './metronome.js';
import { MidiInput } from './midi-input.js';
import { ScorePlayer } from './player.js';
import { readScore, SCORE_EXT } from './score/index.js';
import { encodeMidi } from './recorder.js';
import { themeFromImage } from './palette.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const ZOOMS = [1, 1.25, 1.5, 2, 3];
import { HAND_COLORS } from './app-colors.js';

class App {
  async start() {
    this.settings = new Settings();
    await this.settings.load();
    this.env = await window.melofi.envInfo();
    this.instruments = await window.melofi.listInstruments();

    this.engine = new Engine();
    await this.engine.init();
    this.stage = new Stage(document.getElementById('stage'), { gpu: this.settings.get('gpu') });
    console.log('renderer:', this.stage.renderer);
    this.engine.onSoundEnd = (n) => this.stage.soundOff(n); // bars last as long as the sound does
    this.metronome = new Metronome(this.engine.ctx);
    this.metronome.onBeat = (b) => this.ui?.beat(b);
    this.midiDevices = [];
    this.midi = new MidiInput({
      onNote: (n, vel, on) => (on ? this.play(n, vel) : this.release(n)),
      onSustain: (on) => this.sustain(on),
      onDevices: (list) => {
        const had = this.midiActive();
        this.midiDevices = list;
        this.ui?.refreshBar();
        if (had !== this.midiActive()) this.loadInstrument(true);
      },
    });
    this.recorder = new Recorder({
      engine: this.engine, canvas: this.stage.c, settings: this.settings, metronome: this.metronome,
      instrumentName: () => this.instruments.find((i) => i.id === this.settings.get('instrument'))?.name || 'Piano',
    });
    this.player = new ScorePlayer(this);
    this.ui = new UI(this);

    this.held = new Map();          // KeyboardEvent.code -> note
    this.count = new Uint8Array(128); // how many sources hold each note
    this.shift = 0;
    this.sustainDown = false;
    this.pedalHeld = false;
    this.pedalLatch = false;
    this.pedalScore = false;
    this.pointerNote = null;

    this.applyAll();
    this.bindInput();
    this.fullscreen = false;
    window.melofi.onFullscreen((on) => { this.fullscreen = on; this.ui.setFullscreen(on); });
    this.midi.enabled = this.settings.get('midiIn');
    this.midi.init();
    this.loop = (t) => { this.stage.frame(t); this.recorder.tick(); requestAnimationFrame(this.loop); };
    requestAnimationFrame(this.loop);
    new ResizeObserver(() => this.stage.layout()).observe(this.stage.c);

    if (!this.instruments.length) { this.ui.toast(T.toast.noInstruments, { err: true, ms: 10000 }); return; }
    if (!this.instruments.some((i) => i.id === this.settings.get('instrument'))) this.settings.set({ instrument: this.instruments[0].id });
    else this.loadInstrument();
  }

  // ---------- settings → subsystems ----------

  applyAll() {
    const v = this.settings.v;
    this.engine.setVolume(v.volume);
    this.engine.setReverb(v.reverb);
    this.engine.setRoom(v.room);
    this.engine.setResonance(v.resonance);
    this.engine.setBass(v.bass);
    this.engine.setBrightness(v.brightness);
    this.stage.setTheme(v.theme, v.customTheme);
    this.stage.setOptions({ visualizer: v.visualizer, particles: v.particles, bloom: v.bloom, speed: v.speed, labels: v.labels, range: v.range,
      noteColor: v.noteColor, barWidth: v.barWidth, bgDim: v.bgDim, zoom: v.kbZoom, center: this.playCenter() });
    this.stage.setBackground(v.bgImage);
    this.metronome.setTempo(v.bpm);
    this.metronome.setBeats(v.beats);
    this.metronome.setVolume(v.metroVol);
    if (v.metro) this.metronome.start();
    this.updateLabels();

    this.settings.on((p) => {
      if ('volume' in p) this.engine.setVolume(p.volume);
      if ('reverb' in p) this.engine.setReverb(p.reverb);
      if ('brightness' in p) this.engine.setBrightness(p.brightness);
      if ('bass' in p) this.engine.setBass(p.bass);
      if ('room' in p) this.engine.setRoom(p.room);
      if ('resonance' in p) this.engine.setResonance(p.resonance);
      if ('theme' in p || 'customTheme' in p) this.stage.setTheme(this.settings.get('theme'), this.settings.get('customTheme'));
      const so = {};
      for (const k of ['visualizer', 'particles', 'bloom', 'speed', 'labels', 'range', 'noteColor', 'barWidth', 'bgDim']) if (k in p) so[k] = p[k];
      if ('kbZoom' in p) so.zoom = p.kbZoom;
      if (['kbZoom', 'octave', 'transpose', 'keyPreset', 'customMap'].some((k) => k in p)) so.center = this.playCenter();
      if ('bgImage' in p) this.stage.setBackground(p.bgImage);
      if ('bpm' in p) this.metronome.setTempo(p.bpm);
      if ('beats' in p) this.metronome.setBeats(p.beats);
      if ('metroVol' in p) this.metronome.setVolume(p.metroVol);
      if ('metro' in p) { if (p.metro) this.metronome.start(); else { this.metronome.stop(); this.ui.beat(null); } }
      if ('midiIn' in p) { this.midi.enabled = p.midiIn; this.loadInstrument(true); }
      if ('pedalMode' in p) { this.pedalHeld = false; this.setLatch(false); }
      if (Object.keys(so).length) this.stage.setOptions(so);
      if (['octave', 'transpose', 'keyPreset', 'customMap', 'labels', 'noteNames', 'range'].some((k) => k in p)) this.updateLabels();
      if ('instrument' in p) this.loadInstrument();
      else if ('velocity' in p || 'humanize' in p) { clearTimeout(this._vt); this._vt = setTimeout(() => this.loadInstrument(true), 350); }
    });
  }

  get defaults() { return DEFAULTS; }

  resetMixer() {
    const p = {};
    for (const k of ['volume', 'reverb', 'room', 'resonance', 'bass', 'brightness']) p[k] = DEFAULTS[k];
    this.settings.set(p);
  }

  resetSettings() {
    const keep = { recDir: this.settings.get('recDir') };
    this.settings.set({ ...DEFAULTS, ...keep });
    this.stage.setOptions({ ...DEFAULTS });
  }

  midiActive() { return this.settings.get('midiIn') && this.midiDevices.length > 0; }

  velRange() {
    const v = this.settings.v;
    // a real keyboard can hit any velocity, so spread the loaded layers across the whole range
    if (this.midiActive()) return [1, 127];
    return [clamp(v.velocity - v.humanize, 1, 127), clamp(v.velocity + v.humanize, 1, 127)];
  }

  async loadInstrument(layersOnly = false) {
    const id = this.settings.get('instrument');
    const meta = this.instruments.find((i) => i.id === id);
    if (!meta) return;
    const [lo, hi] = this.velRange();
    if (!layersOnly) this.ui.setProgress(0);
    try {
      const ok = await this.engine.load(id, lo, hi, (p) => this.ui.setProgress(p), { budgetMB: 700 });
      this.ui.setProgress(null);
      if (ok && !layersOnly) this.ui.toast(T.toast.instLoaded(meta.name), { ms: 1600 });
      if (ok) setTimeout(() => this.recorder.warmup(), 300);
    } catch (err) {
      console.error(err);
      this.ui.setProgress(null);
      this.ui.toast(T.toast.instFail(meta.name), { err: true });
    }
    this.ui.refreshBar();
  }

  // ---------- notes ----------

  currentMap() {
    const v = this.settings.v;
    if (v.keyPreset === 'custom' && v.customMap) return v.customMap;
    return PRESETS[v.keyPreset] || PRESETS.piano;
  }

  // middle of the notes the current key map reaches; a zoomed keyboard centres on it
  playCenter() {
    const offs = Object.values(this.currentMap());
    if (!offs.length) return 60;
    return Math.round(this.noteFor((Math.min(...offs) + Math.max(...offs)) / 2, 0));
  }

  noteFor(offset, shift = this.shift) {
    const v = this.settings.v;
    return 12 * (v.octave + 1) + offset + v.transpose + 12 * shift;
  }

  updateLabels() {
    const v = this.settings.v;
    const map = this.currentMap();
    const labels = new Map();
    for (const [code, off] of Object.entries(map)) {
      const n = this.noteFor(off);
      if (labels.has(n)) continue;
      labels.set(n, v.labels === 'notes' ? noteName(n, v.noteNames, false) : keyLabel(code));
    }
    this.stage.setLabels(labels);
  }

  velocity() {
    const v = this.settings.v;
    return clamp(Math.round(v.velocity + (Math.random() * 2 - 1) * v.humanize), 1, 127);
  }

  play(note, velocity) {
    if (note < 21 || note > 108) return;
    if (this.engine.ctx.state !== 'running') this.engine.ctx.resume();
    const vel = velocity ?? this.velocity();
    this.count[note]++;
    this.engine.noteOn(note, vel);
    this.stage.noteOn(note, vel);
    this.recorder.event({ type: 'on', note, vel });
  }

  release(note) {
    if (note < 21 || note > 108 || !this.count[note]) return;
    if (--this.count[note] > 0) return;
    this.engine.noteOff(note);
    this.stage.noteOff(note, this.engine.isSounding(note));
    this.recorder.event({ type: 'off', note });
  }

  preview(note) {
    this.play(note);
    setTimeout(() => this.release(note), 260);
  }

  // The pedal is down while it is held (key / MIDI) or locked.
  sustain(held) {
    this.pedalHeld = held;
    this.applyPedal();
  }

  setLatch(on) {
    this.pedalLatch = on;
    this.applyPedal();
  }

  applyPedal() {
    const on = !!(this.pedalHeld || this.pedalLatch || this.pedalScore);
    this.ui.setSustain(on, this.pedalLatch);
    if (this.sustainDown === on) return;
    this.sustainDown = on;
    this.engine.setSustain(on);
    this.recorder.event({ type: 'sus', on });
  }

  releaseEverything() {
    for (const note of this.held.values()) this.release(note);
    this.held.clear();
    if (this.pointerNote != null) { this.release(this.pointerNote); this.pointerNote = null; }
    this.sustain(false); // a locked pedal stays locked
  }

  // ---------- input ----------

  // Z held: one octave down, X held: one octave up (unless the key map plays notes on Z / X)
  octaveKey(code) {
    return (code === 'KeyZ' || code === 'KeyX') && this.currentMap()[code] == null;
  }

  setShift() {
    const s = (this.octX ? 1 : 0) - (this.octZ ? 1 : 0);
    if (s !== this.shift) {
      this.shift = s;
      this.ui.setMods(s);
      this.updateLabels();
    }
  }

  bindInput() {
    const down = (e) => {
      const tag = e.target?.tagName;
      const typing = tag === 'INPUT' && e.target.type !== 'range';
      if (typing) return;

      if (/^F([1-9]|10)$/.test(e.code)) {
        e.preventDefault();
        if (!e.repeat) this.action({ F1: 'help', F2: 'record', F3: 'keymap', F4: 'mixer', F5: 'fullscreen', F6: 'metro', F7: 'latch', F8: 'scorePlay', F9: 'scoreStop', F10: 'settings' }[e.code]);
        return;
      }
      if (this.ui.modal === 'keymap') { e.preventDefault(); this.ui.keymapKey(e); return; }
      if (e.code === 'Escape') {
        e.preventDefault();
        if (!this.ui.modal && !this.ui.menuOpen && this.fullscreen) window.melofi.setFullscreen(false);
        else this.ui.close();
        return;
      }
      if (this.ui.menuOpen) this.ui.openMenu(null);
      if (e.code === 'Tab' || e.altKey) return;

      e.preventDefault();
      if (e.repeat) return;

      const v = this.settings.v;
      switch (e.code) {
        case 'ArrowLeft': this.settings.set({ transpose: clamp(v.transpose - 1, -12, 12) }); return;
        case 'ArrowRight': this.settings.set({ transpose: clamp(v.transpose + 1, -12, 12) }); return;
        case 'ArrowUp': this.settings.set({ octave: clamp(v.octave + 1, 0, 7) }); return;
        case 'ArrowDown': this.settings.set({ octave: clamp(v.octave - 1, 0, 7) }); return;
      }
      if (v.sustainKey && e.code === v.sustainKey) { if (v.pedalMode === 'toggle') this.setLatch(!this.pedalLatch); else this.sustain(true); return; }
      if (this.octaveKey(e.code)) { if (e.code === 'KeyZ') this.octZ = true; else this.octX = true; this.setShift(); return; }
      if (RESERVED.has(e.code) || this.held.has(e.code)) return;
      const off = this.currentMap()[e.code];
      if (off == null) return;
      const note = this.noteFor(off);
      this.held.set(e.code, note);
      this.play(note);
    };

    const up = (e) => {
      if (e.code === 'KeyZ' || e.code === 'KeyX') { if (e.code === 'KeyZ') this.octZ = false; else this.octX = false; this.setShift(); }
      const v = this.settings.v;
      if (v.sustainKey && e.code === v.sustainKey) { if (v.pedalMode !== 'toggle') this.sustain(false); return; }
      const note = this.held.get(e.code);
      if (note == null) return;
      this.held.delete(e.code);
      this.release(note);
    };

    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    window.addEventListener('blur', () => { this.releaseEverything(); this.octZ = this.octX = false; this.shift = 0; this.ui.setMods(0); this.updateLabels(); });

    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', async (e) => {
      e.preventDefault();
      const file = [...(e.dataTransfer?.files || [])].find((f) => SCORE_EXT.includes(f.name.split('.').pop().toLowerCase()));
      if (file) await this.openScore(file.name, new Uint8Array(await file.arrayBuffer()));
    });

    const cv = this.stage.c;
    const at = (e) => { const r = cv.getBoundingClientRect(); return this.stage.noteAt(e.clientX - r.left, e.clientY - r.top); };
    // Ctrl + wheel over the stage zooms the keyboard
    cv.addEventListener('wheel', (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const steps = ZOOMS;
      const i = steps.indexOf(this.settings.get('kbZoom'));
      const j = clamp((i < 0 ? 0 : i) + (e.deltaY < 0 ? 1 : -1), 0, steps.length - 1);
      if (steps[j] !== this.settings.get('kbZoom')) this.settings.set({ kbZoom: steps[j] });
    }, { passive: false });
    cv.addEventListener('pointerdown', (e) => {
      const n = at(e);
      if (n == null) return;
      cv.setPointerCapture(e.pointerId);
      this.pointerNote = n;
      this.play(n);
    });
    cv.addEventListener('pointermove', (e) => {
      if (this.pointerNote == null) return;
      const n = at(e);
      if (n == null || n === this.pointerNote) return;
      this.release(this.pointerNote);
      this.pointerNote = n;
      this.play(n);
    });
    const end = () => { if (this.pointerNote != null) { this.release(this.pointerNote); this.pointerNote = null; } };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
  }

  // ---------- actions ----------

  openRecDir() {
    const dir = this.settings.get('recDir') || this.env.recordDir;
    window.melofi.openFolder(dir);
  }

  // ---------- score playback ----------

  async pickScore() {
    const f = await window.melofi.pickScore();
    if (f) await this.openScore(f.name, f.data);
  }

  async openScore(name, bytes) {
    try {
      const song = await readScore(name, bytes);
      this.player.load(song);
      this.fitScore(song);
      const piano = song.lines.filter((l) => l.piano).length;
      this.ui.toast(T.toast.scoreLoaded(song.title, piano, song.lines.length), { ms: 3500 });
    } catch (err) {
      console.error(err);
      this.ui.toast(`${T.toast.scoreFail} ${err.message || ''}`, { err: true, ms: 6000 });
    }
  }

  // zoom the keyboard so the score's whole range is on screen; the old zoom comes back on close
  fitScore(song) {
    let lo = 127, hi = 0;
    for (const l of song.lines) for (const n of l.notes) { if (n.n < lo) lo = n.n; if (n.n > hi) hi = n.n; }
    if (hi < lo) return;
    if (this.zoomBeforeScore == null) this.zoomBeforeScore = this.settings.get('kbZoom');
    this.stage.setOptions({ fit: [lo, hi] });
    const z = this.stage.fitZoom(lo, hi, ZOOMS);
    if (z !== this.settings.get('kbZoom')) this.settings.set({ kbZoom: z });
  }

  closeScore() {
    this.player.unload();
    this.stage.setOptions({ fit: null });
    if (this.zoomBeforeScore != null) {
      const z = this.zoomBeforeScore;
      this.zoomBeforeScore = null;
      if (z !== this.settings.get('kbZoom')) this.settings.set({ kbZoom: z });
    }
  }

  // one score note: audio on the audio clock, visuals/recording on timers
  // colour for a score line: right hand warm, left hand cool (ink theme: black ink / vermilion)
  lineColor(line, n) {
    if (!this.settings.get('scoreHands')) return null;
    let hand = this.player.hands?.get(line);
    if (hand === 'split') hand = n >= 60 ? 'rh' : 'lh';
    const ink = this.stage.theme.inkSim;
    if (hand === 'rh') return ink ? '#15130f' : HAND_COLORS.rh;
    if (hand === 'lh') return ink ? '#a3271a' : HAND_COLORS.lh;
    const others = ['#c7a6ff', '#8de0b0', '#ffd27a', '#ff8fa8', '#7fe0e6'];
    return others[line % others.length];
  }

  scoreNote(n, v, at, dur, player, line) {
    if (n < 21 || n > 108) return;
    const vid = this.engine.noteOn(n, v, at);
    const delay = (at - this.engine.ctx.currentTime) * 1000;
    const color = this.lineColor(line, n);
    player.later(() => { this.stage.noteOn(n, v, color); this.recorder.event({ type: 'on', note: n, vel: v }); }, delay);
    player.later(() => {
      if (vid != null) this.engine.releaseVoice(vid);
      this.stage.noteOff(n, this.engine.isSounding(n));
      this.recorder.event({ type: 'off', note: n });
    }, delay + dur * 1000 - 3);
  }

  scorePedal(on, delayMs, player) {
    const set = () => { this.pedalScore = on; this.applyPedal(); };
    if (player && delayMs > 1) player.later(set, delayMs); else set();
  }

  stopScore() {
    this.pedalScore = false;
    this.applyPedal();
    this.engine.allOff(0.12);
    this.stage.clearAll();
  }

  // the parts that are switched on, as a MIDI file for FL Studio
  async exportScoreMidi() {
    const P = this.player;
    if (!P.song) return;
    const evs = [];
    for (const l of P.song.lines) {
      if (!P.enabled.has(l.id)) continue;
      for (const n of l.notes) { evs.push({ type: 'on', note: n.n, vel: n.v, ms: n.t * 1000 }); evs.push({ type: 'off', note: n.n, ms: (n.t + n.d) * 1000 - 1 }); }
    }
    for (const p of P.song.pedals) evs.push({ type: 'sus', on: p.on, ms: p.t * 1000 });
    const data = encodeMidi(evs, { name: P.song.title, bpm: 120 });
    const saved = await window.melofi.saveRecording({ dir: this.settings.get('recDir'), base: P.song.title, files: [{ ext: 'mid', data }] });
    this.ui.toast(T.toast.saved, { path: saved.files[0], action: { label: T.toast.openFolder, fn: () => window.melofi.showItem(saved.files[0]) } });
  }

  setGpu(on) {
    this.settings.set({ gpu: on });
    this.ui.toast(T.toast.gpuRestart, { action: { label: T.toast.restart, fn: () => window.melofi.relaunch() } });
  }

  async pickBackground() {
    const url = await window.melofi.pickBackground();
    if (!url) return;
    this.settings.set({ bgImage: url });
    await this.themeFromBackground(); // a new picture gets matching colours straight away
  }

  async themeFromBackground() {
    const url = this.settings.get('bgImage');
    if (!url) return;
    try {
      const theme = await themeFromImage(url, T.menu.customTheme);
      this.settings.set({ customTheme: theme, theme: 'custom' });
      this.ui.toast(T.toast.themeMade, { ms: 2200 });
    } catch (err) { console.error(err); }
  }

  action(name) {
    if (name === 'record') return this.toggleRecord();
    if (name === 'metro') return this.settings.set({ metro: !this.settings.get('metro') });
    if (name === 'latch') return this.setLatch(!this.pedalLatch);
    if (name === 'fullscreen') return window.melofi.toggleFullscreen();
    if (name === 'scorePlay') return this.player.song ? this.player.toggle() : this.pickScore();
    if (name === 'scoreStop') return this.player.stop();
    this.ui.open(name);
  }

  async toggleRecord() {
    if (this._recBusy) return;
    this._recBusy = true;
    try {
      if (!this.recorder.recording) {
        if (this.engine.ctx.state !== 'running') await this.engine.ctx.resume();
        await this.recorder.start();
        const fmt = this.settings.get('recFormat');
        this.ui.setRecording('on', T.settings.recFormats[fmt].split(' ')[0]);
        const t0 = performance.now();
        this._recTimer = setInterval(() => this.ui.setRecTime((performance.now() - t0) / 1000), 250);
        // notes already held when recording starts belong in the take
        for (const n of this.held.values()) this.recorder.event({ type: 'on', note: n, vel: this.settings.get('velocity') });
        if (this.sustainDown) this.recorder.event({ type: 'sus', on: true });
      } else {
        clearInterval(this._recTimer);
        this.ui.setRecording('saving');
        const res = await this.recorder.stop();
        if (!res) { this.ui.toast(T.toast.recEmpty); return; }
        const saved = await window.melofi.saveRecording({
          dir: this.settings.get('recDir'),
          convert: res.convert,
          files: res.files.map((f) => ({ ext: f.ext, data: f.data })),
        });
        const shown = saved.files.length > 1 ? saved.folder : saved.files[0];
        if (res.videoOk === false) this.ui.toast(T.toast.noVideo, { err: true, path: shown });
        else this.ui.toast(T.toast.saved, { path: shown, action: { label: T.toast.openFolder, fn: () => window.melofi.showItem(saved.files[0]) } });
      }
    } catch (err) {
      console.error(err);
      this.ui.toast(T.toast.recFail, { err: true });
    } finally {
      if (!this.recorder.recording) this.ui.setRecording('off');
      this._recBusy = false;
    }
  }
}

const app = new App();
window.__melofi = app;
app.start().catch((e) => { console.error(e); document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;bottom:0;left:0;color:#e5484d;padding:12px">${String(e.stack || e)}</pre>`); });
