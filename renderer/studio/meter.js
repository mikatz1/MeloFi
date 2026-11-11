// Loudness from the live meter's 100 ms blocks (js/master-worklet.js), as the BS.1770 / EBU R128
// meters in FL Studio and Cubase show it: momentary (400 ms), short-term (3 s), integrated (gated),
// loudness range, true peak (max), PLR, and the stereo correlation.
const L = (ms) => (ms > 1e-20 ? -0.691 + 10 * Math.log10(ms) : -70);

export class LoudnessMeter {
  constructor() { this.reset(); }

  reset() {
    this.blocks = [];      // mean squares, last 3 s
    this.mom = [];         // gated momentary mean squares for integrated (every 100 ms)
    this.shorts = [];      // short-term loudness values for LRA (every 100 ms)
    this.tpMax = 0; this.spMax = 0;
    this.corr = 1; this.scope = new Float32Array(0);
    this.M = -70; this.S = -70; this.Mmax = -70; this.Smax = -70;
  }

  push(b) {
    this.blocks.push(b.ms);
    if (this.blocks.length > 30) this.blocks.shift();
    const n = this.blocks.length, mean = (k) => this.blocks.slice(-k).reduce((a, x) => a + x, 0) / Math.min(k, n);
    if (n >= 4) {
      const m = mean(4);
      this.M = L(m);
      if (this.M > -70) this.mom.push(m);
      if (this.M > this.Mmax) this.Mmax = this.M;
    }
    if (n >= 30) {
      this.S = L(mean(30));
      if (this.S > -70) this.shorts.push(this.S);
      if (this.S > this.Smax) this.Smax = this.S;
    }
    this.tpMax = Math.max(this.tpMax, b.tp); this.spMax = Math.max(this.spMax, b.sp);
    const den = Math.sqrt(b.ll * b.rr);
    this.corr = den > 1e-12 ? b.lr / den : this.corr;
    this.scope = b.scope;
  }

  get I() {
    if (!this.mom.length) return -70;
    const rel = L(this.mom.reduce((a, x) => a + x, 0) / this.mom.length) - 10;
    const g = this.mom.filter((m) => L(m) > rel);
    return g.length ? L(g.reduce((a, x) => a + x, 0) / g.length) : -70;
  }

  get LRA() {
    if (this.shorts.length < 2) return 0;
    const lin = this.shorts.map((x) => 10 ** (x / 10)), rel = 10 * Math.log10(lin.reduce((a, x) => a + x, 0) / lin.length) - 20;
    const s = this.shorts.filter((x) => x > rel).sort((a, b) => a - b);
    if (s.length < 2) return 0;
    const p = (q) => s[Math.min(s.length - 1, Math.round(q * (s.length - 1)))];
    return p(0.95) - p(0.1);
  }

  get TP() { return this.tpMax > 1e-10 ? 20 * Math.log10(this.tpMax) : -70; }
}

// what streaming services and broadcasters play back at (integrated LUFS, true-peak ceiling)
export const TARGETS = [
  ['spotify', 'Spotify · YouTube · 타이달', -14, -1],
  ['apple', 'Apple Music', -16, -1],
  ['melon', '멜론 · 지니 등 국내 음원', -14, -1],
  ['soundcloud', 'SoundCloud · 클럽', -9, -1],
  ['ebu', '방송 (EBU R128)', -23, -1],
  ['cd', 'CD · 다운로드 (크게)', -10, -0.3],
];
