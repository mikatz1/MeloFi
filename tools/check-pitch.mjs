// Measures the pitch of a few samples of a built instrument and compares it with the key they're
// mapped to, to catch octave mistakes in generated mappings.   node tools/check-pitch.mjs <id>
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const id = process.argv[2];
const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'instruments', id, 'manifest.json'), 'utf8'));
const RATE = 44100;

function pcm(file, from = 0.15, len = 0.6) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-ss', String(from), '-t', String(len), '-i', file, '-ac', '1', '-ar', String(RATE), '-f', 'f32le', '-'], { maxBuffer: 1 << 26 });
  const b = r.stdout;
  return new Float32Array(b.buffer, b.byteOffset, b.length / 4);
}

// normalised autocorrelation, first strong peak
function pitch(x) {
  const minLag = Math.floor(RATE / 2000), maxLag = Math.floor(RATE / 25);
  const n = Math.min(x.length - maxLag, 8192);
  let best = 0, bestLag = 0;
  const ac = new Float32Array(maxLag + 1);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0, e1 = 0, e2 = 0;
    for (let i = 0; i < n; i++) { s += x[i] * x[i + lag]; e1 += x[i] * x[i]; e2 += x[i + lag] * x[i + lag]; }
    ac[lag] = s / Math.sqrt(e1 * e2 + 1e-12);
    if (ac[lag] > best) { best = ac[lag]; bestLag = lag; }
  }
  // prefer the shortest lag that is nearly as good (avoids picking an octave below)
  for (let lag = minLag; lag <= maxLag; lag++) if (ac[lag] > best * 0.9 && ac[lag] >= ac[lag - 1] && ac[lag] >= ac[lag + 1]) { bestLag = lag; break; }
  return RATE / bestLag;
}

const regs = m.regions.filter((r, i, a) => a.findIndex((x) => x.s === r.s) === i);
const pick = [regs[Math.floor(regs.length * 0.3)], regs[Math.floor(regs.length * 0.5)], regs[Math.floor(regs.length * 0.7)]];
for (const r of pick) {
  const f = pitch(pcm(path.join(ROOT, 'instruments', id, r.s)));
  const midi = 69 + 12 * Math.log2(f / 440);
  console.log(`${id} ${r.s}: mapped to ${r.c}, sounds ${midi.toFixed(2)} (${f.toFixed(1)} Hz) -> off by ${(midi - r.c).toFixed(2)} semitones`);
}
