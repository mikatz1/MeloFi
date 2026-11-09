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
export const TOUCH_STEPS = [24, 40, 56, 72, 88, 100, 112, 120, 127]; // number keys 1-9
const SOFT = 0.72; // soft pedal: velocity scale
import { HAND_COLORS } from './app-colors.js';
import { Practice } from './practice.js';
import { renderVideo } from './render-video.js';

class App {
  async start() {
    this.settings = new Settings();
    await this.settings.load();
    this.env = await window.melofi.envInfo();
    this.instruments = await window.melofi.listInstruments();
    this.dl = new Map(); // instrument id -> download progress 0..1
    this.recent = [];
    this.loadRecent();
    window.melofi.onInstrumentProgress(({ id, done, total }) => { this.dl.set(id, total ? Math.min(1, done / total) : 0); this.ui.dlProgress(id); });

    this.engine = new Engine();
    await this.engine.init();
    this.stage = new Stage(document.getElementById('stage'), { gpu: this.settings.get('gpu') });
    console.log('renderer:', this.stage.renderer);
    this.engine.onSoundEnd = (n) => this.stage.soundOff(n); // bars last as long as the sound does
    this.metronome = new Metronome(this.engine.ctx);
    this.metronome.onBeat = (b) => this.ui?.beat(b);
    this.midiDevices = [];
    this.midi = new MidiInput({
      onNote: (n, vel, on) => {
        if (on) this.midiHeld.set(n, this.userDown(n, vel));
        else { this.userUp(this.midiHeld.get(n) ?? [n]); this.midiHeld.delete(n); }
      },
      onSustain: (on) => this.sustain(on),
      onSostenuto: (on) => this.setSostenuto(on),
      onSoft: (on) => this.setSoft(on),
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
    this.practice = new Practice(this);
    this.ui = new UI(this);

    this.held = new Map();          // KeyboardEvent.code -> note
    this.count = new Uint8Array(128); // how many sources hold each note
    this.shift = 0;
    this.sustainDown = false;
    this.pedalHeld = false;
    this.pedalLatch = false;
    this.pedalScore = false;
    this.pointerNote = null;
    this.pointerPlayed = [];
    this.midiHeld = new Map();      // MIDI note -> notes it sounded

    this.applyAll();
    this.bindInput();
    this.fullscreen = false;
    window.melofi.onFullscreen((on) => { this.fullscreen = on; this.ui.setFullscreen(on); });
    this.midi.enabled = this.settings.get('midiIn');
    this.midi.init();
    this.loop = (t) => { this.practice.tick(); this.stage.frame(t); this.recorder.tick(); requestAnimationFrame(this.loop); };
    requestAnimationFrame(this.loop);
    new ResizeObserver(() => this.stage.layout()).observe(this.stage.c);

    const usable = this.instruments.filter((i) => i.installed);
    if (!usable.length) { this.ui.toast(T.toast.noInstruments, { err: true, ms: 10000 }); return; }
    if (!usable.some((i) => i.id === this.settings.get('instrument'))) this.settings.set({ instrument: (usable.find((i) => i.bundled) || usable[0]).id });
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
      if ('kbZoom' in p) { so.zoom = p.kbZoom; this.scoreZoom = null; } // picking a zoom by hand wins over the fit
      if (['kbZoom', 'octave', 'transpose', 'keyPreset', 'customMap'].some((k) => k in p)) so.center = this.playCenter();
      if ('bgImage' in p) this.stage.setBackground(p.bgImage);
      if ('bpm' in p) this.metronome.setTempo(p.bpm);
      if ('beats' in p) this.metronome.setBeats(p.beats);
      if ('metroVol' in p) this.metronome.setVolume(p.metroVol);
      if ('metro' in p) { if (p.metro) this.metronome.start(); else { this.metronome.stop(); this.ui.beat(null); } }
      if ('midiIn' in p) { this.midi.enabled = p.midiIn; this.loadInstrument(true); }
      if ('pedalMode' in p) { this.pedalHeld = false; this.setLatch(false); }
      if (Object.keys(so).length) this.stage.setOptions(so);
      if ('range' in p && this.player.song) this.fitScore(this.player.song);
      if (['scoreFall', 'scoreHands', 'rhColor', 'lhColor', 'theme'].some((k) => k in p)) { this.updateFall(); this.ui.updateTransport?.(); }
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
    if (!meta?.installed) return;
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
    let vel = velocity ?? this.velocity();
    if (this.softDown) vel = Math.max(1, Math.round(vel * SOFT)); // una corda: quieter, and a softer layer
    this.count[note]++;
    this.engine.noteOn(note, vel);
    this.stage.noteOn(note, vel);
    this.recorder.event({ type: 'on', note, vel });
  }

  // A key / MIDI note / click from the player. In practice it is judged first; in rhythm-only
  // practice it sounds the score's notes instead of its own. Returns the notes it sounded.
  userDown(note, vel) {
    const r = this.practice?.press(note);
    if (r == null) { this.play(note, vel); return [note]; }
    for (const x of r) this.play(x.n, vel ?? x.v);
    return r.map((x) => x.n);
  }

  userUp(notes) { for (const n of notes) this.release(n); }

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

  // Soft pedal (left): notes come out quieter and darker while it is down.
  setSoft(on) {
    if (this.softDown === on) return;
    this.softDown = on;
    this.ui.setPedalFlag('soft', on);
  }

  // Sostenuto (middle): keeps the notes that are down right now, nothing played after.
  setSostenuto(on) {
    if (this.sostDown === on) return;
    this.sostDown = on;
    this.engine.setSostenuto(on);
    this.ui.setPedalFlag('sost', on);
    if (!on) for (let n = 21; n <= 108; n++) if (!this.count[n]) this.engine.soundCheck(n);
  }

  releaseEverything() {
    for (const notes of this.held.values()) this.userUp(notes);
    this.held.clear();
    for (const notes of this.midiHeld.values()) this.userUp(notes);
    this.midiHeld.clear();
    if (this.pointerNote != null) { this.userUp(this.pointerPlayed); this.pointerNote = null; }
    this.sustain(false); // a locked pedal stays locked
    this.setSoft(false);
    this.setSostenuto(false);
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
      const v0 = this.settings.v;
      if (v0.softKey && e.code === v0.softKey) { e.preventDefault(); this.setSoft(true); return; }
      if (v0.sostKey && e.code === v0.sostKey) { e.preventDefault(); if (!e.repeat) this.setSostenuto(true); return; }

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
      // 1-9: touch strength, unless the key map plays notes on the number row
      const dg = /^Digit([1-9])$/.exec(e.code);
      if (dg && this.currentMap()[e.code] == null) { this.settings.set({ velocity: TOUCH_STEPS[+dg[1] - 1] }); return; }
      if (this.octaveKey(e.code)) { if (e.code === 'KeyZ') this.octZ = true; else this.octX = true; this.setShift(); return; }
      if (RESERVED.has(e.code) || this.held.has(e.code)) return;
      const off = this.currentMap()[e.code];
      if (off == null) return;
      this.held.set(e.code, this.userDown(this.noteFor(off)));
    };

    const up = (e) => {
      const v0 = this.settings.v;
      if (v0.softKey && e.code === v0.softKey) { this.setSoft(false); return; }
      if (v0.sostKey && e.code === v0.sostKey) { this.setSostenuto(false); return; }
      if (e.code === 'KeyZ' || e.code === 'KeyX') { if (e.code === 'KeyZ') this.octZ = false; else this.octX = false; this.setShift(); }
      const v = this.settings.v;
      if (v.sustainKey && e.code === v.sustainKey) { if (v.pedalMode !== 'toggle') this.sustain(false); return; }
      const notes = this.held.get(e.code);
      if (notes == null) return;
      this.held.delete(e.code);
      this.userUp(notes);
    };

    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    window.addEventListener('blur', () => { this.releaseEverything(); this.octZ = this.octX = false; this.shift = 0; this.ui.setMods(0); this.updateLabels(); });

    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', async (e) => {
      e.preventDefault();
      const file = [...(e.dataTransfer?.files || [])].find((f) => SCORE_EXT.includes(f.name.split('.').pop().toLowerCase()));
      if (!file) return;
      // dropped from disk: open by path so it shows up in the recent list
      const p = window.melofi.pathForFile(file);
      if (p) await this.openRecent(p);
      else await this.openScore(file.name, new Uint8Array(await file.arrayBuffer()));
    });

    const cv = this.stage.c;
    const at = (e) => { const r = cv.getBoundingClientRect(); return this.stage.noteAt(e.clientX - r.left, e.clientY - r.top); };
    // Ctrl + wheel over the stage zooms the keyboard
    cv.addEventListener('wheel', (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const steps = ZOOMS;
      const i = steps.indexOf(this.zoomNow());
      const j = clamp((i < 0 ? 0 : i) + (e.deltaY < 0 ? 1 : -1), 0, steps.length - 1);
      if (steps[j] !== this.zoomNow()) this.settings.set({ kbZoom: steps[j] });
    }, { passive: false });
    cv.addEventListener('pointerdown', (e) => {
      const n = at(e);
      if (n == null) return;
      cv.setPointerCapture(e.pointerId);
      this.pointerNote = n;
      this.pointerPlayed = this.userDown(n);
    });
    cv.addEventListener('pointermove', (e) => {
      if (this.pointerNote == null) return;
      const n = at(e);
      if (n == null || n === this.pointerNote) return;
      this.userUp(this.pointerPlayed);
      this.pointerNote = n;
      this.pointerPlayed = this.userDown(n);
    });
    const end = () => { if (this.pointerNote != null) { this.userUp(this.pointerPlayed); this.pointerNote = null; } };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
  }

  // ---------- actions ----------

  openRecDir() {
    const dir = this.settings.get('recDir') || this.env.recordDir;
    window.melofi.openFolder(dir);
  }

  // ---------- high-quality video of the score ----------

  async renderVideo(opts) {
    if (this.rendering || !this.player.song) return;
    this.player.pause();
    this.rendering = true;
    const box = document.getElementById('renderBox');
    const bar = box.querySelector('.bar i'), phase = box.querySelector('.phase'), eta = box.querySelector('.eta');
    let cancel = false;
    box.querySelector('[data-act=cancel]').onclick = () => { cancel = true; phase.textContent = T.render.cancelling; };
    box.hidden = false;
    const fmt = (s) => (s >= 60 ? `${Math.floor(s / 60)}${T.render.min} ${Math.round(s % 60)}${T.render.sec}` : `${Math.round(s)}${T.render.sec}`);
    try {
      const out = await renderVideo(this, opts, {
        cancelled: () => cancel,
        progress: (ph, p, left) => {
          if (cancel) return;
          phase.textContent = T.render[ph];
          bar.style.width = `${Math.round(p * 1000) / 10}%`;
          eta.textContent = left != null && p > 0.02 ? `${Math.round(p * 100)}% · ${T.render.left} ${fmt(left)}` : `${Math.round(p * 100)}%`;
        },
      });
      if (out) this.ui.toast(T.toast.saved, { path: out, action: { label: T.toast.openFolder, fn: () => window.melofi.showItem(out) } });
    } catch (err) {
      console.error(err);
      this.ui.toast(`${T.render.fail} ${err.message || ''}`, { err: true, ms: 8000 });
    } finally {
      box.hidden = true;
      this.rendering = false;
    }
  }

  // ---------- instrument downloads ----------

  async refreshInstruments() {
    this.instruments = await window.melofi.listInstruments();
    this.ui.refresh();
  }

  async downloadInstrument(id) {
    const meta = this.instruments.find((i) => i.id === id);
    if (!meta || this.dl.has(id)) return;
    this.dl.set(id, 0);
    this.ui.refresh();
    const r = await window.melofi.downloadInstrument(id);
    this.dl.delete(id);
    await this.refreshInstruments();
    if (r.ok) this.ui.toast(T.toast.instReady(meta.name), { action: { label: T.toast.useNow, fn: () => this.settings.set({ instrument: id }) } });
    else if (!r.cancelled) this.ui.toast(`${T.toast.dlFail(meta.name)} ${r.error || ''}`, { err: true, ms: 7000 });
  }

  cancelDownload(id) { window.melofi.cancelDownload(id); }

  async removeInstrument(id) {
    if (this.settings.get('instrument') === id) {
      const d = this.instruments.find((i) => i.bundled) || this.instruments.find((i) => i.installed && i.id !== id);
      if (d) this.settings.set({ instrument: d.id });
    }
    await window.melofi.removeInstrument(id);
    await this.refreshInstruments();
  }

  // ---------- score playback ----------

  async pickScore() {
    const f = await window.melofi.pickScore();
    if (f) await this.openScore(f.name, f.data);
    this.loadRecent();
  }

  async openRecent(p) {
    const f = await window.melofi.openScorePath(p);
    if (f) await this.openScore(f.name, f.data);
    else this.ui.toast(T.toast.recentGone, { err: true });
    this.loadRecent();
  }

  async loadRecent() { this.recent = await window.melofi.recentScores(); }

  async openScore(name, bytes) {
    try {
      const song = await readScore(name, bytes);
      this.player.load(song);
      this.fitScore(song, true);
      this.updateFall();
      const piano = song.lines.filter((l) => l.piano).length;
      this.ui.toast(T.toast.scoreLoaded(song.title, piano, song.lines.length), { ms: 3500 });
    } catch (err) {
      console.error(err);
      this.ui.toast(`${T.toast.scoreFail} ${err.message || ''}`, { err: true, ms: 6000 });
    }
  }

  // zoom the keyboard so the score's whole range is on screen; the old zoom comes back on close
  // (the fitted zoom is not saved, so quitting with a score open leaves the user's own zoom alone)
  fitScore(song, warn = false) {
    let lo = 127, hi = 0;
    for (const l of song.lines) for (const n of l.notes) { if (n.n < lo) lo = n.n; if (n.n > hi) hi = n.n; }
    if (hi < lo) return;
    this.scoreZoom = this.stage.fitZoom(lo, hi, ZOOMS);
    this.stage.setOptions({ fit: [lo, hi], zoom: this.scoreZoom });
    // keys the chosen keyboard size can't show
    const [rlo, rhi] = this.stage.fullRange();
    let out = 0;
    for (const l of song.lines) for (const n of l.notes) if (n.n < rlo || n.n > rhi) out++;
    if (warn && out) {
      this.ui.toast(T.toast.scoreRange(out, this.settings.get('range')), { action: { label: T.toast.use88, fn: () => this.settings.set({ range: 88 }) }, ms: 9000 });
    }
  }

  // zoom actually on screen (a loaded score's fitted zoom, else the setting)
  zoomNow() { return this.scoreZoom ?? this.settings.get('kbZoom'); }

  // The title card shows once per opened score (not again for replays / retries) when it has
  // a real title or a composer, and the card hasn't been turned off.
  async intro() {
    const song = this.player.song;
    if (!song || this.introShown === song) return;
    this.introShown = song;
    if (!this.settings.get('introCard') || !(song.hasTitle || song.composer)) return;
    await this.ui.showIntro(song);
  }

  async toggleScore() {
    const P = this.player;
    if (P.playing) { P.pause(); return; }
    if (P.pos === 0) await this.intro();
    P.play();
  }

  // falling notes: the enabled parts of the loaded score, coloured by hand
  updateFall() {
    const P = this.player;
    if (!P?.song || !(this.settings.get('scoreFall') || this.practice?.active)) { this.stage.fall = null; return; }
    const notes = [];
    for (const l of P.song.lines) {
      if (!P.enabled.has(l.id)) continue;
      for (const n of l.notes) if (n.n >= 21 && n.n <= 108) notes.push({ t: n.t, d: n.d, n: n.n, color: this.lineColor(l.id, n.n) });
    }
    notes.sort((a, b) => a.t - b.t);
    this.stage.fall = { notes, maxD: notes.reduce((m, x) => Math.max(m, x.d), 0), now: () => P.now() };
    this.stage.bars.length = 0;
  }

  closeScore() {
    this.practice.stop();
    this.practice.hideResult();
    this.player.unload();
    this.stage.fall = null;
    this.scoreZoom = null;
    this.stage.setOptions({ fit: null, zoom: this.settings.get('kbZoom') });
  }

  // one score note: audio on the audio clock, visuals/recording on timers
  // colour for a score line: right hand warm, left hand cool (ink theme: black ink / vermilion)
  lineColor(line, n) {
    if (!this.settings.get('scoreHands')) return null;
    let hand = this.player.hands?.get(line);
    if (hand === 'split') hand = n >= 60 ? 'rh' : 'lh';
    const ink = this.stage.theme.inkSim;
    if (hand === 'rh') return ink ? '#15130f' : this.settings.get('rhColor') || HAND_COLORS.rh;
    if (hand === 'lh') return ink ? '#a3271a' : this.settings.get('lhColor') || HAND_COLORS.lh;
    const others = ['#c7a6ff', '#8de0b0', '#ffd27a', '#ff8fa8', '#7fe0e6'];
    return others[line % others.length];
  }

  scoreNote(n, v, at, dur, player, line) {
    if (n < 21 || n > 108) return;
    if (this.practice?.isTarget(line, n)) return; // the player's own part
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
    if (name === 'scorePlay') return this.player.song ? this.toggleScore() : this.pickScore();
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
        for (const n of [...this.held.values()].flat()) this.recorder.event({ type: 'on', note: n, vel: this.settings.get('velocity') });
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
