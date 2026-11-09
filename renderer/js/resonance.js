// Sympathetic string resonance for the damper pedal.
// With the dampers lifted every string is free to ring along with whatever is
// played. Modelled as one impulse response that is a bank of slowly decaying,
// slightly inharmonic partials for all 88 strings; convolving the piano with it
// excites exactly the partials that line up with the music.

export function buildResonance(rate, seconds = 3) {
  const len = Math.floor(rate * seconds);
  const out = [new Float32Array(len), new Float32Array(len)];
  const B = 0.00035; // string inharmonicity
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

  for (let k = 21; k <= 108; k++) {
    const f0 = 440 * Math.pow(2, (k - 69) / 12);
    const tau0 = Math.min(3.2, Math.max(0.5, 2.6 * Math.pow(f0 / 110, -0.4)));
    const weight = Math.pow(f0 / 262, -0.25); // bass strings carry a little more
    for (let h = 1; h <= 6; h++) {
      const f = h * f0 * Math.sqrt(1 + B * h * h);
      if (f > rate * 0.42) break;
      const amp = (weight / Math.pow(h, 1.3)) * (k > 88 ? 0.5 : 1); // top octave: no dampers, already ringing
      const tau = tau0 / Math.sqrt(h);
      const decay = Math.exp(-1 / (tau * rate));
      for (let ch = 0; ch < 2; ch++) {
        const d = out[ch];
        const w = (2 * Math.PI * f * (1 + (ch ? 0.00012 : -0.00012))) / rate;
        const c2 = 2 * Math.cos(w);
        const ph = rnd() * 2 * Math.PI;
        // damped resonator by recurrence: y[n] = r*c2*y[n-1] - r^2*y[n-2]
        let y1 = Math.sin(ph) * amp, y2 = Math.sin(ph - w) * amp / decay;
        const a1 = decay * c2, a2 = decay * decay;
        const n = Math.min(len, Math.ceil(tau * rate * 7));
        for (let i = 0; i < n; i++) {
          const y = a1 * y1 - a2 * y2;
          d[i] += y1;
          y2 = y1; y1 = y;
        }
      }
    }
  }
  // soft onset so the dry attack isn't smeared
  const fade = Math.floor(rate * 0.02);
  let e = 0;
  for (let ch = 0; ch < 2; ch++) for (let i = 0; i < len; i++) { if (i < fade) out[ch][i] *= i / fade; e += out[ch][i] * out[ch][i]; }
  const norm = 1 / Math.sqrt(e / 2);
  for (let ch = 0; ch < 2; ch++) for (let i = 0; i < len; i++) out[ch][i] *= norm;
  return out;
}
