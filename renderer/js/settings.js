export const DEFAULTS = {
  keyPreset: 'piano',
  customMap: null,
  octave: 4,
  transpose: 0,
  velocity: 90,
  humanize: 8,
  sustainKey: 'Space',
  softKey: 'ShiftLeft',     // left pedal (una corda)
  sostKey: 'ControlLeft',   // middle pedal (sostenuto)
  pedalMode: 'hold',
  midiIn: true,
  metro: false,
  bpm: 100,
  beats: 4,
  metroVol: 0.5,

  instrument: 'splendid',
  volume: 0.8,
  reverb: 0.22,
  room: 'hall',
  resonance: 0.5,
  bass: 0,
  brightness: 0,

  theme: 'midnight',
  customTheme: null,
  visualizer: true,
  gpu: true,
  particles: 'high',
  bloom: true,
  speed: 1,
  labels: 'keys',
  noteNames: 'en',
  range: 88,
  kbZoom: 1,
  noteColor: 'theme',
  scoreHands: true,
  scoreFall: false,         // a loaded score's notes come down to the keys instead of rising after they play
  introCard: true,
  streamMode: false,
  fxExtra: true,            // extra effects (bass pulse, run arcs, key gloss; rings/shafts/flash with falling notes)        // tuned for screen sharing (Discord etc.)          // title card before a score's first play
  practiceHand: 'rh',       // practice: 'rh' | 'lh' | 'both'
  rhColor: '#ffb27a', // score hand colours
  lhColor: '#7fb0ff',
  barWidth: 1,
  bgImage: '',
  bgDim: 0.55,

  recFormat: 'mp4',
  recDir: '',
  recFps: 60,
  recRes: 'window',
  recMbps: 16,
  recKbps: 320,
};

export class Settings {
  constructor() {
    this.v = { ...DEFAULTS };
    this.listeners = new Set();
    this._t = 0;
  }
  async load() {
    const s = await window.melofi.loadSettings();
    if (s && typeof s === 'object') for (const k of Object.keys(DEFAULTS)) if (k in s) this.v[k] = s[k];
  }
  get(k) { return this.v[k]; }
  set(patch) {
    Object.assign(this.v, patch);
    for (const fn of this.listeners) fn(patch, this.v);
    clearTimeout(this._t);
    this._t = setTimeout(() => window.melofi.saveSettings(this.v), 300);
  }
  reset() { this.set({ ...DEFAULTS }); }
  on(fn) { this.listeners.add(fn); }
}
