// MeloFi Studio — audio files: store / decode, BPM guess, onset slicing (slicer), time stretch
// without pitch change (WSOLA), and turning a file into a playable sampler instrument.
import { PAD, toInt16 } from '../js/audio.js';

const bytesCache = new Map();  // hash -> Promise<ArrayBuffer>
const decCache = new Map();    // `${hash}@${rate}` -> Promise<AudioBuffer>
const stretchCache = new Map();
const instCache = new Map();

const api = () => window.melofi;

// add a file's bytes to the store and the project; returns its hash
export async function addMedia(proj, name, data) {
  const { hash } = await api().mediaPut(name, data);
  bytesCache.set(hash, Promise.resolve(data.buffer ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : data));
  if (!proj.media[hash]) {
    const buf = await decode(hash, 48000);
    proj.media[hash] = { name, rate: buf.sampleRate, ch: buf.numberOfChannels, dur: +buf.duration.toFixed(4), bpm: guessBpm(buf.duration) };
  }
  return hash;
}

async function bytesOf(hash) {
  if (!bytesCache.has(hash)) bytesCache.set(hash, api().mediaGet(hash).then((u8) => { if (!u8) throw new Error('오디오 파일을 찾을 수 없습니다'); return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength); }));
  return bytesCache.get(hash);
}

// decoded at the rate of the context that will play it (the browser's decoder resamples well;
// an AudioBufferSourceNode would resample with plain linear interpolation)
export function decode(hash, rate) {
  const k = `${hash}@${rate}`;
  if (!decCache.has(k)) {
    decCache.set(k, (async () => {
      const ab = await bytesOf(hash);
      const c = new OfflineAudioContext(2, 1, rate);
      return c.decodeAudioData(ab.slice(0));
    })());
    decCache.get(k).catch(() => decCache.delete(k));
  }
  return decCache.get(k);
}

// a loop's length is usually 1, 2, 4 or 8 bars: pick the tempo nearest 120 in a sensible range
export function guessBpm(dur) {
  let best = null;
  for (const beats of [4, 8, 16, 32, 2]) {
    const bpm = (beats * 60) / dur;
    if (bpm < 70 || bpm > 180) continue;
    if (!best || Math.abs(bpm - 120) < Math.abs(best - 120)) best = bpm;
  }
  return best ? Math.round(best * 10) / 10 : null;
}

// ---------- onsets (for the slicer) ----------
// energy-flux onset detector: returns slice start times in seconds (first one is 0)
export function onsets(buf, sensitivity = 0.5, maxSlices = 32) {
  const sr = buf.sampleRate, L = buf.getChannelData(0), R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
  const hop = Math.round(sr * 0.005), win = hop * 2;
  const env = [];
  for (let i = 0; i + win < L.length; i += hop) {
    let e = 0;
    for (let j = 0; j < win; j++) { const x = (L[i + j] + R[i + j]) * 0.5; e += x * x; }
    env.push(Math.sqrt(e / win));
  }
  const flux = env.map((e, i) => Math.max(0, e - (env[i - 1] ?? e)));
  const mean = flux.reduce((a, b) => a + b, 0) / (flux.length || 1);
  const thr = mean * (2 + (1 - sensitivity) * 10);
  const out = [0];
  const minGap = Math.round(0.07 / 0.005);
  let last = -minGap;
  for (let i = 1; i < flux.length - 1; i++) {
    if (flux[i] > thr && flux[i] >= flux[i - 1] && flux[i] >= flux[i + 1] && i - last >= minGap) {
      const t = (i * hop) / sr;
      if (t > 0.03) out.push(t);
      last = i;
    }
  }
  // too many: keep the strongest
  if (out.length > maxSlices) {
    const scored = out.slice(1).map((t) => ({ t, s: flux[Math.round((t * sr) / hop)] || 0 })).sort((a, b) => b.s - a.s).slice(0, maxSlices - 1);
    return [0, ...scored.map((x) => x.t).sort((a, b) => a - b)];
  }
  return out;
}

// equal slices on the beat grid (for loops whose tempo is known)
export const gridSlices = (dur, n) => Array.from({ length: n }, (_, i) => (i * dur) / n);

// ---------- time stretch (WSOLA): change length, keep pitch ----------
export async function stretched(hash, rate, ratio) {
  if (Math.abs(ratio - 1) < 0.001) return decode(hash, rate);
  const k = `${hash}@${rate}@${ratio.toFixed(4)}`;
  if (!stretchCache.has(k)) stretchCache.set(k, decode(hash, rate).then((b) => wsola(b, ratio)));
  return stretchCache.get(k);
}

// ratio = output length / input length
export function wsola(buf, ratio) {
  const sr = buf.sampleRate, N = Math.round(sr * 0.046) & ~1, Hs = N / 2, Ha = Hs / ratio, tol = Math.round(sr * 0.012);
  const chans = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
  const mono = new Float32Array(chans[0].length);
  for (const ch of chans) for (let i = 0; i < mono.length; i++) mono[i] += ch[i] / chans.length;
  const outLen = Math.round(mono.length * ratio) + N;
  const out = chans.map(() => new Float32Array(outLen));
  const norm = new Float32Array(outLen);
  const w = new Float32Array(N);
  for (let i = 0; i < N; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  let prev = 0; // input position of the previous frame
  for (let k = 0, o = 0; o < outLen - N; k++, o += Hs) {
    const ideal = Math.round(k * Ha);
    if (ideal >= mono.length) break;
    let pos = ideal;
    if (k > 0) {
      // best match for the natural continuation of the previous frame (decimated search)
      const nat = prev + Hs;
      let best = -Infinity;
      for (let d = -tol; d <= tol; d += 4) {
        const cand = ideal + d;
        if (cand < 0 || cand + N > mono.length) continue;
        let s = 0;
        for (let j = 0; j < Hs; j += 8) s += mono[cand + j] * (mono[nat + j] || 0);
        if (s > best) { best = s; pos = cand; }
      }
    }
    for (let c = 0; c < chans.length; c++) {
      const src = chans[c], dst = out[c];
      for (let j = 0; j < N; j++) { const x = src[pos + j]; if (x === undefined) break; dst[o + j] += x * w[j]; }
    }
    for (let j = 0; j < N; j++) norm[o + j] += w[j];
    prev = pos;
  }
  const len = Math.round(mono.length * ratio);
  const res = new AudioBuffer({ length: Math.max(1, len), numberOfChannels: chans.length, sampleRate: sr });
  for (let c = 0; c < chans.length; c++) {
    const d = res.getChannelData(c), src = out[c];
    for (let i = 0; i < len; i++) d[i] = norm[i] > 1e-3 ? src[i] / norm[i] : src[i];
  }
  return res;
}

// ---------- sampler instruments made from a file ----------
// spec: { media, root (MIDI note the file sounds at), start, end (seconds), reverse, loop,
//         attack, release (seconds), slices: [seconds] (slicer: one slice per key from `root`) }
export async function sampleInstrument(spec, rate = 48000) {
  const key = JSON.stringify({ ...spec, rate });
  if (instCache.has(key)) return instCache.get(key);
  const p = (async () => {
    const buf = await decode(spec.media, rate);
    const sr = buf.sampleRate;
    const L0 = buf.getChannelData(0), R0 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : null;
    const cut = (from, to) => {
      const a = Math.max(0, Math.round(from * sr)), b = Math.min(L0.length, Math.round((to ?? buf.duration) * sr));
      let L = L0.slice(a, Math.max(a + 1, b)), R = R0 ? R0.slice(a, Math.max(a + 1, b)) : null;
      if (spec.reverse) { L.reverse(); if (R) R.reverse(); }
      // a short fade at the cut so slices don't click
      const f = Math.min(L.length, Math.round(sr * 0.003));
      for (let i = 0; i < f; i++) { const g = i / f; L[L.length - 1 - i] *= g; if (R) R[R.length - 1 - i] *= g; }
      return { L, R };
    };
    const data = new Map(), samples = {}, regions = [];
    const add = (s, part, lo, hi, c) => {
      const n = part.L.length + PAD * 2;
      data.set(s, { L: toInt16(part.L, new Int16Array(n)), R: part.R ? toInt16(part.R, new Int16Array(n)) : null });
      samples[s] = { rate: sr, ch: part.R ? 2 : 1, dur: part.L.length / sr };
      regions.push({ s, lo, hi, c, t: spec.tune || 0, lv: 1, hv: 127, g: 1, r: spec.release ?? 0.12, off: 0, attack: spec.attack || 0,
        loop: spec.loop ? [0, part.L.length] : null });
    };
    if (spec.slices?.length) {
      const ts = spec.slices;
      ts.forEach((t, i) => { const k = (spec.root ?? 60) + i; if (k <= 127) add(`slice${i}`, cut(t, ts[i + 1] ?? spec.end ?? buf.duration), k, k, k); });
    } else {
      add('one', cut(spec.start || 0, spec.end), 0, 127, spec.root ?? 60);
    }
    const byKey = Array.from({ length: 128 }, () => []);
    for (const r of regions) for (let k = r.lo; k <= r.hi; k++) byKey[k].push(r);
    // peak-normalise to the level of the built-in instruments
    let pk = 0;
    for (const d of data.values()) for (let i = 0; i < d.L.length; i += 7) { const a = Math.abs(d.L[i]); if (a > pk) pk = a; }
    const gain = pk ? Math.min(4, (0.32 * 32768) / pk) * (spec.gain ?? 1) : 1;
    return { id: `media:${spec.media}:${hashStr(key)}`, manifest: { gain, samples }, byKey, data };
  })();
  instCache.set(key, p);
  p.catch(() => instCache.delete(key));
  return p;
}

function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }

// waveform peaks for drawing: n columns of [min, max]
export function peaks(buf, n) {
  const d = buf.getChannelData(0), out = new Float32Array(n * 2), step = d.length / n;
  for (let i = 0; i < n; i++) {
    let lo = 1, hi = -1;
    const a = Math.floor(i * step), b = Math.min(d.length, Math.floor((i + 1) * step));
    for (let j = a; j < b; j += Math.max(1, ((b - a) / 64) | 0)) { const x = d[j]; if (x < lo) lo = x; if (x > hi) hi = x; }
    out[i * 2] = lo; out[i * 2 + 1] = hi;
  }
  return out;
}
