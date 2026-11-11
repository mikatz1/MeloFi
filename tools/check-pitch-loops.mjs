// pitch of every distinct sample of a built instrument, playing its loop (unrolled) like the engine; FFT peak + harmonic check
import fs from 'node:fs'; import path from 'node:path'; import { spawnSync } from 'node:child_process';
const [root, id, which] = process.argv.slice(2);
const m = JSON.parse(fs.readFileSync(path.join(root, 'instruments', id, 'manifest.json'), 'utf8'));
const seen = new Set();
for (const r of m.regions) {
  if (seen.has(r.s)) continue; seen.add(r.s);
  const meta = m.samples[r.s];
  const out = spawnSync('ffmpeg', ['-v', 'error', '-i', path.join(root, 'instruments', id, r.s), '-ac', '1', '-f', 'f32le', '-'], { maxBuffer: 1 << 28 }).stdout;
  let x = new Float32Array(out.buffer, out.byteOffset, out.length / 4);
  const rate = meta.rate, N = Math.round(rate * 1.0);
  const y = new Float32Array(N);
  let p = Math.min(Math.round(rate * 0.1), x.length - 1);
  if (r.ls != null && p >= r.le) p = r.ls;
  for (let i = 0; i < N; i++) { y[i] = x[p] || 0; p++; if (r.le != null && p >= r.le) p = r.ls; if (p >= x.length) break; }
  const midiOf = (f) => 69 + 12 * Math.log2(f / 440);
  // check-pitch.mjs's normalised autocorrelation (first strong peak), on the unrolled loop
  const minLag = Math.floor(rate / 4200), maxLag = Math.floor(rate / 25), n = Math.min(N - maxLag, 16384);
  const ac = new Float32Array(maxLag + 2); let bestv = 0, bestLag = 0;
  for (let lag = minLag; lag <= maxLag; lag++) { let s2 = 0, e1 = 0, e2 = 0; for (let i = 0; i < n; i++) { s2 += y[i] * y[i + lag]; e1 += y[i] * y[i]; e2 += y[i + lag] * y[i + lag]; } ac[lag] = s2 / Math.sqrt(e1 * e2 + 1e-12); if (ac[lag] > bestv) { bestv = ac[lag]; bestLag = lag; } }
  for (let lag = minLag + 1; lag < maxLag; lag++) if (ac[lag] > bestv * 0.9 && ac[lag] >= ac[lag - 1] && ac[lag] >= ac[lag + 1]) { bestLag = lag; break; }
  // parabolic refinement
  const a1 = ac[bestLag - 1], a2 = ac[bestLag], a3 = ac[bestLag + 1]; const d = (a1 - a3) / (2 * (a1 - 2 * a2 + a3) || 1);
  const bestF = rate / (bestLag + (Number.isFinite(d) ? d : 0));
  const midi = midiOf(bestF);
  console.log(`${id} ${r.s} c=${r.c} t=${r.t} loop=${r.ls ?? '-'}..${r.le ?? '-'} dur=${meta.dur}s -> ${midi.toFixed(2)} (${(midi - r.c).toFixed(2)})`);
}
