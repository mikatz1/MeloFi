// MeloFi Studio — the final steps of an audio export, as FL Studio's and Cubase's mixdown dialogs
// offer them: loudness or peak normalisation (with a true-peak ceiling), bit depth with dither or
// noise shaping, WAV (16/24-bit PCM, 32-bit float), FLAC (16/24), MP3 and OGG (Opus); then a report.
import { measure, limit, gain, quantize, dB } from './master-dsp.js';
import { encodeFlac } from './flac.js';
import { mp3 } from '../js/recorder.js';
import { encodeOggOpus } from './ogg.js';

// mix: { left, right, rate } (float). opts.norm: 'none' | 'peak' | 'loudness'
export function finish(mix, { norm = 'none', target = -14, ceiling = -1 } = {}) {
  const before = measure(mix.left, mix.right, mix.rate);
  let out = mix, limited = 0;
  if (norm === 'loudness' && before.I > -70) {
    out = gain(mix, target - before.I);
    // louder than the ceiling allows: the true-peak limiter holds it there
    if (before.tp + (target - before.I) > ceiling) { const r = limit(out.left, out.right, out.rate, { ceilingDb: ceiling }); limited = r.maxGrDb; out = r; }
  } else if (norm === 'peak' && before.tp > -100) {
    out = gain(mix, ceiling - before.tp);
  }
  const after = out === mix ? before : measure(out.left, out.right, out.rate);
  return { mix: out, before, after, limited };
}

function wavHeader(v, n, ch, rate, bits, float) {
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  const bps = bits / 8, data = n * ch * bps;
  str(0, 'RIFF'); v.setUint32(4, 36 + data, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, float ? 3 : 1, true); v.setUint16(22, ch, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * ch * bps, true); v.setUint16(32, ch * bps, true); v.setUint16(34, bits, true);
  str(36, 'data'); v.setUint32(40, data, true);
}

export function encodeWavPcm(mix, bits, dither) {
  const n = mix.left.length, L = quantize(mix.left, bits, dither), R = quantize(mix.right, bits, dither);
  const buf = new ArrayBuffer(44 + n * 2 * (bits / 8)), v = new DataView(buf);
  wavHeader(v, n, 2, mix.rate, bits, false);
  let o = 44;
  for (let i = 0; i < n; i++) for (const c of [L, R]) {
    if (bits === 16) { v.setInt16(o, c[i], true); o += 2; } else { const s = c[i]; v.setUint8(o, s & 255); v.setUint8(o + 1, (s >> 8) & 255); v.setUint8(o + 2, (s >> 16) & 255); o += 3; }
  }
  return new Uint8Array(buf);
}

export function encodeWavFloat(mix) {
  const n = mix.left.length, buf = new ArrayBuffer(44 + n * 8), v = new DataView(buf);
  wavHeader(v, n, 2, mix.rate, 32, true);
  let o = 44;
  for (let i = 0; i < n; i++) { v.setFloat32(o, mix.left[i], true); v.setFloat32(o + 4, mix.right[i], true); o += 8; }
  return new Uint8Array(buf);
}

export function encodeFlacMix(mix, bits, dither) {
  return encodeFlac([quantize(mix.left, bits, dither), quantize(mix.right, bits, dither)], mix.rate, bits);
}

// format: wav16 | wav24 | wav32f | flac16 | flac24 | mp3 | ogg
export async function encode(mix, format, dither = 'tpdf') {
  if (format === 'mp3') return { ext: 'mp3', data: await mp3(mix, 320) };
  if (format === 'ogg') return { ext: 'ogg', data: await encodeOggOpus(mix, 192000) };
  if (format === 'wav32f') return { ext: 'wav', data: encodeWavFloat(mix) };
  const bits = format.endsWith('16') ? 16 : 24;
  if (format.startsWith('flac')) return { ext: 'flac', data: encodeFlacMix(mix, bits, dither) };
  return { ext: 'wav', data: encodeWavPcm(mix, bits, dither) };
}

export const fmtLufs = (x) => (x <= -69.5 ? '—' : x.toFixed(1));
export const fmtDb = (x) => (x <= -100 ? '—' : `${x > 0 ? '+' : ''}${x.toFixed(1)}`);
export { dB };
