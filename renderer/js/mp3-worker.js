/* global lamejs */
importScripts('melofi://app/node_modules/lamejs/lame.min.js');

self.onmessage = (e) => {
  const { left, right, rate, kbps } = e.data;
  const enc = new lamejs.Mp3Encoder(2, rate, kbps);
  const toI16 = (f) => {
    const o = new Int16Array(f.length);
    for (let i = 0; i < f.length; i++) {
      const v = Math.max(-1, Math.min(1, f[i])) * 32767 + (Math.random() - Math.random());
      o[i] = v < -32768 ? -32768 : v > 32767 ? 32767 : Math.round(v);
    }
    return o;
  };
  const L = toI16(left), R = toI16(right);
  const parts = [];
  const block = 1152 * 8;
  for (let i = 0; i < L.length; i += block) {
    const b = enc.encodeBuffer(L.subarray(i, i + block), R.subarray(i, i + block));
    if (b.length) parts.push(new Uint8Array(b));
  }
  const end = enc.flush();
  if (end.length) parts.push(new Uint8Array(end));
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  self.postMessage(out, [out.buffer]);
};
