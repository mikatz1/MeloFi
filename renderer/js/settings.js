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
  midiOut: '', // MIDI output port name for sending the studio to a DAW
  midiClock: false,
  browserRoots: [],      // composer: sample folders in the browser
  studioTourSeen: false, // composer: the guided tour was offered
  studioKeys: {},        // composer: shortcut overrides
  studioLeftW: 520,      // composer: width of the left panel
  studioLook: null,      // composer: size / accent / track and row heights (화면 꾸미기)
  studioLayout: null,    // composer: floating windows { roll: {x,y,w,h}, ... }
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
  stemsMuscriptor: 'off',  // song analysis: MuScriptor model (small / medium / large) or off
  scoreBarHidden: false,    // the score's play bar tucked away (it peeks out at the top edge)
  // audio spectrum behind the notes
  spectrum: false,
  specStyle: 'bars',        // 'bars' | 'blocks' | 'dots' | 'mirror'
  specPos: 'bottom',        // 'bottom' | 'center' | 'top'
  specHeight: 0.35,         // share of the area above the keys
  specBars: 64,
  specColor: 'theme',       // 'theme' | 'rainbow' | 'custom'
  specCustom: '#7fb0ff',
  specOpacity: 0.45,
  specSmooth: 0.8,
  specPeaks: true,
  scoreFall: false,         // a loaded score's notes come down to the keys instead of rising after they play
  introCard: true,
  streamMode: false,
  winCustom: [1280, 720],   // last custom window size (real pixels)
  fxExtra: true,            // extra effects (bass pulse, run arcs, key gloss; rings/shafts/flash with falling notes)        // tuned for screen sharing (Discord etc.)          // title card before a score's first play
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
    this._dirty = {};
    // the other window changed something: take it without saving it back
    window.melofi.onSettingsChanged?.((p) => this.apply(p));
  }
  apply(patch) {
    const p = {};
    for (const k of Object.keys(patch)) if (k in DEFAULTS) p[k] = patch[k];
    Object.assign(this.v, p);
    for (const fn of this.listeners) fn(p, this.v);
  }
  async load() {
    const s = await window.melofi.loadSettings();
    if (s && typeof s === 'object') for (const k of Object.keys(DEFAULTS)) if (k in s) this.v[k] = s[k];
  }
  get(k) { return this.v[k]; }
  set(patch) {
    Object.assign(this.v, patch);
    Object.assign(this._dirty, patch);
    for (const fn of this.listeners) fn(patch, this.v);
    clearTimeout(this._t);
    this._t = setTimeout(() => { const d = this._dirty; this._dirty = {}; window.melofi.saveSettings(d); }, 300);
  }
  reset() { this.set({ ...DEFAULTS }); }
  on(fn) { this.listeners.add(fn); }
}
