// Aliasing of MeloFi Synth's user-waveform oscillator on high notes (run headless):
//   MELOFI_SHOT=out MELOFI_SCRIPT=tools/e2e/wt-alias.js npx electron .
// Measured at 48 kHz and 44.1 kHz. Renders a stepped sweep (MIDI 72..124, a semitone each) and a continuous glide (1 kHz -> 12 kHz) of a
// full-bandwidth saw drawn as a user waveform, through the band-limited wavetable worklet, and measures
//   - stepped: energy away from the harmonics of f0 (anything there is folded) vs. the harmonic energy, below 18 kHz;
//   - glide: energy below the fundamental (50 Hz .. 0.8 f0; only folding puts anything there) vs. the fundamental.
// For scale the same is measured on Chromium's own band-limited sawtooth and on a naive table (no mipmaps).
// Prints WTALIAS {json}.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const A = window.__melofi; for (let i = 0; i < 150 && !A?.engine?.inst; i++) await sleep(100);
const imp = (p) => import(new URL(p, location.href).href);
const W = await imp('studio/wavetable.js');
const { SynthChannel, synthDefaults, loadSynthWorklet, CUSTOM_WAVE } = await imp('studio/synth.js');
const all = {};
for (const SR of [48000, 44100]) all[SR] = await (async () => {
  const saw = W.presetFrame('saw');
  const base = { ...synthDefaults(), l2: 0, cut: 18000, kt: 0, fenv: 0, res: 0.1, aa: 0.001, as: 1, ar: 0.01, uni: 1, vol: 1 };
  async function render(params, plan, seconds, worklet = true) {
    const c = new OfflineAudioContext(1, Math.ceil(seconds * SR), SR);
    if (worklet) await loadSynthWorklet(c);
    const ch = new SynthChannel(c, c.destination); ch.setParams(params);
    plan(ch, c);
    return (await c.startRendering()).getChannelData(0);
  }
  // power spectrum of x[a .. a+n) with a Blackman-Harris window
  function power(x, a, n) {
    const re = new Float64Array(n), im = new Float64Array(n);
    for (let i = 0; i < n; i++) { const t = (2 * Math.PI * i) / (n - 1); re[i] = (x[a + i] || 0) * (0.35875 - 0.48829 * Math.cos(t) + 0.14128 * Math.cos(2 * t) - 0.01168 * Math.cos(3 * t)); }
    W.fft(re, im);
    const p = new Float64Array(n / 2); for (let k = 0; k < n / 2; k++) p[k] = re[k] * re[k] + im[k] * im[k];
    return p;
  }
  const db = (x) => 10 * Math.log10(Math.max(1e-30, x));
  const STEP = 0.15, notes = []; for (let m = 72; m <= 124; m++) notes.push(m);
  const steppedPlan = (ch) => notes.forEach((m, i) => ch.noteOn(m, 127, 0.02 + i * STEP, STEP - 0.01));
  function stepped(x) {
    const n = 4096, out = [];
    notes.forEach((m, i) => {
      const f0 = 440 * 2 ** ((m - 69) / 12), a = Math.floor((0.02 + i * STEP + 0.03) * SR);
      const p = power(x, a, n), bin = SR / n;
      let harm = 0, alias = 0;
      for (let k = 1; k < n / 2; k++) {
        const f = k * bin; if (f < 40 || f > 18000) continue;
        const h = f / f0, near = Math.abs(h - Math.round(h)) * f0 < 4 * bin && Math.round(h) >= 1;
        if (near) harm += p[k]; else alias += p[k];
      }
      out.push({ m, f0: Math.round(f0), db: Math.round(db(alias / harm) * 10) / 10 });
    });
    return out;
  }
  const GL = 4;
  const glidePlan = (ch, c) => {
    const v = ch.noteOn(84, 127, 0.02, GL); // 1046 Hz
    for (const o of v.oscs) if (o.frequency) { o.frequency.cancelScheduledValues(0); o.frequency.setValueAtTime(1000, 0.02); o.frequency.exponentialRampToValueAtTime(12000, 0.02 + GL); }
  };
  function glide(x) {
    const n = 4096, bin = SR / n, out = [];
    for (let s = 0.2; s < GL - 0.1; s += 0.1) {
      const a = Math.floor(s * SR), f0 = 1000 * 12 ** ((s + n / 2 / SR - 0.02) / GL), p = power(x, a, n);
      let sub = 0, fund = 0;
      for (let k = 1; k < n / 2; k++) { const f = k * bin; if (f >= 50 && f < 0.8 * f0) sub += p[k]; else if (Math.abs(f - f0) < 0.05 * f0) fund += p[k]; }
      out.push({ f0: Math.round(f0), db: Math.round(db(sub / fund) * 10) / 10 });
    }
    return out;
  }
  const custom = { ...base, w1: CUSTOM_WAVE, wt1: W.encodeTable({ name: 'saw', interp: 'xfade', frames: [saw] }) };
  const builtin = { ...base, w1: 0 };
  const r = {};
  for (const [name, params, wk] of [['wavetable', custom, true], ['chromium-saw', builtin, true]]) {
    const xs = await render(params, steppedPlan, 0.1 + notes.length * STEP, wk);
    const xg = await render(params, glidePlan, GL + 0.2, wk);
    const st = stepped(xs), gl = glide(xg);
    r[name] = { steppedWorst: Math.max(...st.map((q) => q.db)), steppedWorstAt: st.reduce((a, q) => (q.db > a.db ? q : a)), steppedTop: st.slice(-3), glideWorst: Math.max(...gl.map((q) => q.db)), glideTail: gl.slice(-4) };
  }
  // naive (no band limiting): the 2048-sample saw read with linear interpolation at the same pitches
  const naive = new Float32Array(Math.ceil((0.1 + notes.length * STEP) * SR));
  notes.forEach((m, i) => { const f0 = 440 * 2 ** ((m - 69) / 12); let ph = 0; const a = Math.floor((0.02 + i * STEP) * SR), b = Math.floor((0.02 + i * STEP + STEP - 0.01) * SR); for (let j = a; j < b; j++) { const x = ph * 2048, k = Math.floor(x), t = x - k; naive[j] = saw[k] * (1 - t) + saw[(k + 1) % 2048] * t; ph = (ph + f0 / SR) % 1; } });
  const ns = stepped(naive);
  r.naive = { steppedWorst: Math.max(...ns.map((q) => q.db)), steppedTop: ns.slice(-3) };
  r.perNote = Object.fromEntries(stepped(await render(custom, steppedPlan, 0.1 + notes.length * STEP)).map((q) => [q.m, q.db]));
  return r;
})();
console.log('WTALIAS ' + JSON.stringify(all));
return [10];
