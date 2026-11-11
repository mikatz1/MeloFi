// OGG export: Opus audio (the browser's own encoder, WebCodecs) in an Ogg container written here
// (RFC 7845: OpusHead, OpusTags, then audio pages with 48 kHz granule positions).

const CRC = (() => { const t = new Uint32Array(256); for (let i = 0; i < 256; i++) { let r = i << 24; for (let k = 0; k < 8; k++) r = r & 0x80000000 ? ((r << 1) ^ 0x04c11db7) >>> 0 : (r << 1) >>> 0; t[i] = r >>> 0; } return t; })();
const crc32 = (b) => { let c = 0; for (let i = 0; i < b.length; i++) c = ((c << 8) ^ CRC[((c >>> 24) ^ b[i]) & 255]) >>> 0; return c; };

function page(packets, { granule, serial, seq, bos = false, eos = false }) {
  const lacing = [];
  for (const p of packets) { let n = p.length; while (n >= 255) { lacing.push(255); n -= 255; } lacing.push(n); }
  const body = packets.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(27 + lacing.length + body), v = new DataView(out.buffer);
  out.set([0x4f, 0x67, 0x67, 0x53], 0); // OggS
  out[4] = 0; out[5] = (bos ? 2 : 0) | (eos ? 4 : 0);
  v.setUint32(6, granule % 2 ** 32, true); v.setUint32(10, Math.floor(granule / 2 ** 32), true);
  v.setUint32(14, serial, true); v.setUint32(18, seq, true); v.setUint32(22, 0, true);
  out[26] = lacing.length; out.set(lacing, 27);
  let o = 27 + lacing.length;
  for (const p of packets) { out.set(p, o); o += p.length; }
  v.setUint32(22, crc32(out), true);
  return out;
}

// a 48 kHz copy of the mix (Opus runs at 48 kHz)
async function to48k(mix) {
  if (mix.rate === 48000) return mix;
  const n = Math.ceil((mix.left.length * 48000) / mix.rate), c = new OfflineAudioContext(2, n, 48000);
  const b = c.createBuffer(2, mix.left.length, mix.rate);
  b.copyToChannel(mix.left, 0); b.copyToChannel(mix.right, 1);
  const s = c.createBufferSource(); s.buffer = b; s.connect(c.destination); s.start(0);
  const r = await c.startRendering();
  return { left: r.getChannelData(0), right: r.getChannelData(1), rate: 48000 };
}

export async function encodeOggOpus(src, bitrate = 192000) {
  if (typeof AudioEncoder === 'undefined') throw new Error('이 환경에서는 Opus 인코더를 쓸 수 없어요');
  const mix = await to48k(src);
  const packets = [];
  let preSkip = 312, err = null;
  const enc = new AudioEncoder({
    output: (chunk, meta) => {
      const d = new Uint8Array(chunk.byteLength); chunk.copyTo(d);
      packets.push({ data: d, frames: Math.round((chunk.duration || 20000) * 48 / 1000) });
      const desc = meta?.decoderConfig?.description;
      if (desc && desc.byteLength >= 12) { const b = new Uint8Array(desc.buffer || desc, desc.byteOffset || 0); if (b[0] === 0x4f && b[1] === 0x70) preSkip = b[10] | (b[11] << 8); }
    },
    error: (e) => { err = e; },
  });
  enc.configure({ codec: 'opus', sampleRate: 48000, numberOfChannels: 2, bitrate, opus: { frameDuration: 20000, complexity: 10 } });
  const n = mix.left.length, step = 48000;
  for (let s = 0; s < n; s += step) {
    const len = Math.min(step, n - s), data = new Float32Array(len * 2);
    data.set(mix.left.subarray(s, s + len), 0); data.set(mix.right.subarray(s, s + len), len);
    const ad = new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: len, numberOfChannels: 2, timestamp: Math.round((s / 48000) * 1e6), data });
    enc.encode(ad); ad.close();
  }
  await enc.flush(); enc.close();
  if (err) throw err;
  // headers
  const head = new Uint8Array(19), hv = new DataView(head.buffer);
  head.set([...'OpusHead'].map((ch) => ch.charCodeAt(0)), 0);
  head[8] = 1; head[9] = 2; hv.setUint16(10, preSkip, true); hv.setUint32(12, src.rate, true); hv.setInt16(16, 0, true); head[18] = 0;
  const vendor = new TextEncoder().encode('MeloFi'), tags = new Uint8Array(8 + 4 + vendor.length + 4), tv = new DataView(tags.buffer);
  tags.set([...'OpusTags'].map((ch) => ch.charCodeAt(0)), 0); tv.setUint32(8, vendor.length, true); tags.set(vendor, 12); tv.setUint32(12 + vendor.length, 0, true);
  const serial = (Math.random() * 2 ** 32) >>> 0, out = [];
  let seq = 0;
  out.push(page([head], { granule: 0, serial, seq: seq++, bos: true }));
  out.push(page([tags], { granule: 0, serial, seq: seq++ }));
  // audio: about a second per page; the last granule marks where the real audio ends
  const total = preSkip + n;
  let gran = preSkip, cur = [], segs = 0;
  packets.forEach((p, i) => {
    cur.push(p.data); segs += Math.floor(p.data.length / 255) + 1; gran += p.frames;
    const last = i === packets.length - 1;
    if (last || cur.length >= 50 || segs > 200) {
      out.push(page(cur, { granule: last ? total : Math.min(gran, total), serial, seq: seq++, eos: last }));
      cur = []; segs = 0;
    }
  });
  const size = out.reduce((a, b) => a + b.length, 0), file = new Uint8Array(size);
  let o = 0; for (const b of out) { file.set(b, o); o += b.length; }
  return file;
}
