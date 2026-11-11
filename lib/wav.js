'use strict';
// Minimal PCM WAV reading/writing (16/24/32-bit integer, 32-bit float) for sample conversion.

function parseWav(buf) {
  if (buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WAVE') throw new Error('wav: not a WAV file');
  let fmt = null, data = null;
  for (let p = 12; p + 8 <= buf.length;) {
    const id = buf.toString('latin1', p, p + 4);
    const len = buf.readUInt32LE(p + 4);
    if (id === 'fmt ') {
      let tag = buf.readUInt16LE(p + 8);
      if (tag === 0xFFFE) tag = buf.readUInt16LE(p + 8 + 24); // WAVE_FORMAT_EXTENSIBLE: subformat GUID
      fmt = { tag, ch: buf.readUInt16LE(p + 10), rate: buf.readUInt32LE(p + 12), bits: buf.readUInt16LE(p + 22) };
    } else if (id === 'data') data = buf.subarray(p + 8, Math.min(buf.length, p + 8 + len));
    p += 8 + len + (len & 1);
  }
  if (!fmt || !data) throw new Error('wav: missing fmt or data');
  if (fmt.tag !== 1 && fmt.tag !== 3) throw new Error(`wav: format ${fmt.tag} not supported`);
  const block = fmt.ch * (fmt.bits / 8);
  return { ...fmt, data, frames: Math.floor(data.length / block), block };
}

function header(ch, rate, bits, tag, dataLen) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0, 'latin1'); h.writeUInt32LE(36 + dataLen, 4); h.write('WAVE', 8, 'latin1');
  h.write('fmt ', 12, 'latin1'); h.writeUInt32LE(16, 16); h.writeUInt16LE(tag, 20); h.writeUInt16LE(ch, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * ch * (bits / 8), 28); h.writeUInt16LE(ch * (bits / 8), 32); h.writeUInt16LE(bits, 34);
  h.write('data', 36, 'latin1'); h.writeUInt32LE(dataLen, 40);
  return h;
}

// Two mono files of the same format -> one stereo file, sample data copied bit for bit.
// frames: optional length (default: the shorter of the two).
function interleaveWavs(left, right, frames) {
  const L = parseWav(left), R = parseWav(right);
  if (L.ch !== 1 || R.ch !== 1 || L.bits !== R.bits || L.rate !== R.rate || L.tag !== R.tag) throw new Error('wav: channels differ in format');
  const n = Math.min(frames ?? Infinity, L.frames, R.frames);
  const bps = L.bits / 8;
  const out = Buffer.alloc(n * 2 * bps);
  for (let i = 0, o = 0; i < n; i++, o += 2 * bps) {
    L.data.copy(out, o, i * bps, (i + 1) * bps);
    R.data.copy(out, o + bps, i * bps, (i + 1) * bps);
  }
  return Buffer.concat([header(2, L.rate, L.bits, L.tag, out.length), out]);
}

// float samples of one channel (for analysis at build time)
function channelFloats(w, c = 0) {
  const out = new Float32Array(w.frames);
  const bps = w.bits / 8;
  for (let i = 0; i < w.frames; i++) {
    const o = i * w.block + c * bps;
    out[i] = w.tag === 3 ? w.data.readFloatLE(o) : bps === 2 ? w.data.readInt16LE(o) / 32768 : bps === 3 ? w.data.readIntLE(o, 3) / 8388608 : w.data.readInt32LE(o) / 2147483648;
  }
  return out;
}

// 80-bit IEEE extended (AIFF sample rate) -> number
function extended(b, o) {
  const exp = ((b[o] & 0x7F) << 8) | b[o + 1];
  const hi = b.readUInt32BE(o + 2), lo = b.readUInt32BE(o + 6);
  if (!exp && !hi && !lo) return 0;
  return (hi * 2 ** 32 + lo) * 2 ** (exp - 16383 - 63);
}

// AIFF / AIFC (uncompressed: NONE, twos, sowt, in24, in32) -> WAV with the same samples, bit for bit
// (only the byte order changes). Chromium's audio decoder doesn't read AIFF.
function aiffToWav(buf) {
  const form = buf.toString('latin1', 8, 12);
  let ch = 0, bits = 0, rate = 0, frames = 0, comp = 'NONE', ssnd = null;
  for (let p = 12; p + 8 <= buf.length;) {
    const id = buf.toString('latin1', p, p + 4), len = buf.readUInt32BE(p + 4);
    if (id === 'COMM') {
      ch = buf.readUInt16BE(p + 8); frames = buf.readUInt32BE(p + 10); bits = buf.readUInt16BE(p + 14); rate = extended(buf, p + 16);
      if (form === 'AIFC') comp = buf.toString('latin1', p + 26, p + 30);
    } else if (id === 'SSND') {
      const off = buf.readUInt32BE(p + 8);
      ssnd = buf.subarray(p + 16 + off, Math.min(buf.length, p + 8 + len));
    }
    p += 8 + len + (len & 1);
  }
  if (!ch || !ssnd) throw new Error('aiff: missing COMM or SSND');
  const le = comp === 'sowt';
  if (!['NONE', 'twos', 'sowt', 'in24', 'in32'].includes(comp)) throw new Error(`aiff: compression ${comp} not supported`);
  const bps = Math.ceil(bits / 8);
  const n = Math.min(frames * ch * bps, ssnd.length - (ssnd.length % bps));
  const out = Buffer.alloc(n);
  if (bps === 1) for (let i = 0; i < n; i++) out[i] = (ssnd[i] + 128) & 255; // AIFF 8-bit is signed, WAV unsigned
  else if (le) ssnd.copy(out, 0, 0, n);
  else for (let i = 0; i < n; i += bps) for (let k = 0; k < bps; k++) out[i + k] = ssnd[i + bps - 1 - k];
  return Buffer.concat([header(ch, Math.round(rate), bps * 8, 1, n), out]);
}

// bytes the app can decode: AIFF becomes WAV, anything else is left as it is
function playable(buf) {
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'FORM' && /^AIF[FC]$/.test(buf.toString('latin1', 8, 12))) return aiffToWav(buf);
  return buf;
}

module.exports = { parseWav, interleaveWavs, channelFloats, aiffToWav, playable };
