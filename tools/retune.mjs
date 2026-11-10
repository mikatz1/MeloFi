// Some recordings are a little out of tune (a kalimba tuned by ear, a banjo a quarter-tone sharp).
// This measures every sample of a built instrument and stores a correction in each region's `t`
// (cents), so every key sounds in tune. Corrections are capped at 75 cents: anything further off
// is a mapping mistake to fix by hand (tools/check-pitch.mjs), not something to paper over.
//   node tools/retune.mjs <id> [--dry]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RATE = 44100;

function pcm(file, from, len) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-ss', String(from), '-t', String(len), '-i', file, '-ac', '1', '-ar', String(RATE), '-f', 'f32le', '-'], { maxBuffer: 1 << 26 });
  const b = r.stdout;
  return new Float32Array(b.buffer, b.byteOffset, b.length / 4);
}

// normalised autocorrelation around the expected period, refined with a parabola
function pitchNear(x, fExpect) {
  const lag0 = RATE / fExpect;
  const lo = Math.max(2, Math.floor(lag0 / Math.pow(2, 1 / 12))), hi = Math.ceil(lag0 * Math.pow(2, 1 / 12));
  const n = Math.min(x.length - hi - 1, 16384);
  if (n < 2048) return null;
  const ac = (lag) => { let s = 0, e1 = 0, e2 = 0; for (let i = 0; i < n; i++) { s += x[i] * x[i + lag]; e1 += x[i] * x[i]; e2 += x[i + lag] * x[i + lag]; } return s / Math.sqrt(e1 * e2 + 1e-12); };
  let best = -1, bl = lo;
  const v = {};
  for (let lag = lo - 1; lag <= hi + 1; lag++) v[lag] = ac(lag);
  for (let lag = lo; lag <= hi; lag++) if (v[lag] > best) { best = v[lag]; bl = lag; }
  if (best < 0.6) return null; // too noisy / inharmonic to trust
  const a = v[bl - 1], b = v[bl], c = v[bl + 1];
  const shift = (a - c) / (2 * (a - 2 * b + c) || 1);
  return RATE / (bl + shift);
}

export function retune(id, { dry = false, from = 0.12, len = 0.5, log = console.log } = {}) {
  const file = path.join(ROOT, 'instruments', id, 'manifest.json');
  const m = JSON.parse(fs.readFileSync(file, 'utf8'));
  const done = new Map();
  let fixed = 0, skipped = 0;
  for (const r of m.regions) {
    if (!done.has(r.s)) {
      const fExpect = 440 * Math.pow(2, (r.c - 69) / 12) * Math.pow(2, (r.t || 0) / 1200);
      const f = pitchNear(pcm(path.join(ROOT, 'instruments', id, r.s), from, len), fExpect);
      let cents = null;
      if (f) {
        const off = 1200 * Math.log2(f / fExpect);
        if (Math.abs(off) <= 75) cents = off; else skipped++;
      } else skipped++;
      done.set(r.s, cents);
      if (cents != null && Math.abs(cents) >= 3) fixed++;
    }
    const c = done.get(r.s);
    if (c != null && Math.abs(c) >= 3) r.t = Math.round(((r.t || 0) - c) * 10) / 10;
  }
  const offs = [...done.values()].filter((x) => x != null);
  const mean = offs.reduce((a, b) => a + b, 0) / (offs.length || 1);
  log(`${id}: ${done.size} samples, mean ${mean >= 0 ? '+' : ''}${mean.toFixed(1)} cents, ${fixed} corrected, ${skipped} left alone`);
  if (!dry) fs.writeFileSync(file, JSON.stringify(m));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  for (const id of args.filter((a) => !a.startsWith('--'))) retune(id, { dry: args.includes('--dry') });
}
