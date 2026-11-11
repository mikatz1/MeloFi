// FLAC encoder (lossless): fixed linear predictors (orders 0..4, the best per block and channel),
// left/side, right/side or mid/side stereo when that is smaller, Rice-coded residuals with
// partitions. Input: Int32Array per channel at 16 or 24 bits. Output: a .flac file.

class Bits {
  constructor(size) { this.buf = new Uint8Array(size); this.pos = 0; this.acc = 0; this.n = 0; }
  grow(need) { if (this.pos + need + 8 < this.buf.length) return; const b = new Uint8Array(Math.max(this.buf.length * 2, this.pos + need + 1024)); b.set(this.buf); this.buf = b; }
  // up to 32 bits of an unsigned value
  put(v, bits) {
    this.grow(8);
    if (bits > 24) { this.put(Math.floor(v / 2 ** 24), bits - 24); v %= 2 ** 24; bits = 24; }
    for (let k = bits - 1; k >= 0; k--) {
      this.acc = (this.acc << 1) | ((v >>> k) & 1);
      if (++this.n === 8) { this.buf[this.pos++] = this.acc; this.acc = 0; this.n = 0; }
    }
  }
  signed(v, bits) { this.put(v < 0 ? v + 2 ** bits : v, bits); }
  unary(q) {
    this.grow((q >> 3) + 2);
    while (q >= 24) { this.put(0, 24); q -= 24; }
    this.put(1, q + 1);
  }
  align() { if (this.n) this.put(0, 8 - this.n); }
  bytes() { return this.buf.subarray(0, this.pos); }
}

const CRC8 = (() => { const t = new Uint8Array(256); for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 0x80 ? ((c << 1) ^ 0x07) & 0xff : (c << 1) & 0xff; t[i] = c; } return t; })();
const CRC16 = (() => { const t = new Uint16Array(256); for (let i = 0; i < 256; i++) { let c = i << 8; for (let k = 0; k < 8; k++) c = c & 0x8000 ? ((c << 1) ^ 0x8005) & 0xffff : (c << 1) & 0xffff; t[i] = c; } return t; })();
const crc8 = (b, s, e) => { let c = 0; for (let i = s; i < e; i++) c = CRC8[c ^ b[i]]; return c; };
const crc16 = (b, s, e) => { let c = 0; for (let i = s; i < e; i++) c = ((c << 8) & 0xffff) ^ CRC16[(c >> 8) ^ b[i]]; return c; };

// residual of a fixed predictor of the given order
function residual(x, order) {
  const n = x.length, r = new Int32Array(n - order);
  for (let i = order; i < n; i++) {
    let p = 0;
    if (order === 1) p = x[i - 1];
    else if (order === 2) p = 2 * x[i - 1] - x[i - 2];
    else if (order === 3) p = 3 * x[i - 1] - 3 * x[i - 2] + x[i - 3];
    else if (order === 4) p = 4 * x[i - 1] - 6 * x[i - 2] + 4 * x[i - 3] - x[i - 4];
    r[i - order] = x[i] - p;
  }
  return r;
}

const zz = (v) => (v >= 0 ? 2 * v : -2 * v - 1);

// Rice parameter for a run of residuals from the sum of their folded values, and the estimated
// cost in bits (sum >> k + n (k + 1), close enough to choose between options)
function riceParam(sum, n) {
  const mean = n ? sum / n : 0;
  const k0 = mean > 1 ? Math.min(30, Math.floor(Math.log2(mean))) : 0;
  let best = Infinity, bk = k0;
  for (const k of [k0 - 1, k0, k0 + 1]) {
    if (k < 0 || k > 30) continue;
    const c = sum / 2 ** k + n * (k + 1);
    if (c < best) { best = c; bk = k; }
  }
  return [bk, best];
}

// partitioned Rice coding: try partition orders 0..6, keep the cheapest
function planRice(r, blockSize, order) {
  const pre = new Float64Array(r.length + 1);
  for (let i = 0; i < r.length; i++) pre[i + 1] = pre[i] + zz(r[i]);
  let best = null;
  for (let po = 0; po <= 6; po++) {
    const parts = 1 << po;
    if (blockSize % parts || blockSize / parts <= order) break;
    const ps = blockSize / parts, ks = [];
    let cost = 0;
    for (let p = 0; p < parts; p++) {
      const s = p === 0 ? 0 : p * ps - order, e = (p + 1) * ps - order;
      const [k, c] = riceParam(pre[e] - pre[s], e - s);
      ks.push(k); cost += c + 5;
    }
    if (!best || cost < best.cost) best = { po, ks, cost };
  }
  return best;
}

function subframePlan(x, bps) {
  // constant block
  if (x.every((v) => v === x[0])) return { type: 'const', cost: bps };
  let best = { type: 'verbatim', cost: x.length * bps };
  for (let order = 0; order <= 4 && order < x.length; order++) {
    const r = residual(x, order), rice = planRice(r, x.length, order);
    if (!rice) continue;
    const cost = order * bps + 6 + rice.cost;
    if (cost < best.cost) best = { type: 'fixed', order, r, rice, cost };
  }
  return best;
}

function writeSubframe(w, x, bps, plan) {
  if (plan.type === 'const') { w.put(0, 8); w.signed(x[0], bps); return; }
  if (plan.type === 'verbatim') { w.put(0b00000010, 8); for (const v of x) w.signed(v, bps); return; }
  w.put(0b00010000 | (plan.order << 1), 8);
  for (let i = 0; i < plan.order; i++) w.signed(x[i], bps);
  const { po, ks } = plan.rice, parts = 1 << po, ps = x.length / parts;
  w.put(1, 2); w.put(po, 4); // Rice with 5-bit parameters (24-bit residuals can need more than 14)
  for (let p = 0; p < parts; p++) {
    const k = ks[p];
    w.put(k, 5);
    const s = p === 0 ? 0 : p * ps - plan.order, e = (p + 1) * ps - plan.order;
    for (let i = s; i < e; i++) { const u = zz(plan.r[i]); w.unary(Math.floor(u / 2 ** k)); if (k) w.put(u % 2 ** k, k); }
  }
}

// the frame number, coded like UTF-8
function utf8num(w, n) {
  if (n < 0x80) { w.put(n, 8); return; }
  const len = n < 0x800 ? 2 : n < 0x10000 ? 3 : n < 0x200000 ? 4 : n < 0x4000000 ? 5 : 6;
  const tail = [];
  for (let i = 1; i < len; i++) { tail.unshift(0x80 | (n & 0x3f)); n >>>= 6; }
  w.put(((0xff00 >> len) & 0xff) | n, 8);
  for (const b of tail) w.put(b, 8);
}

const RATE_CODE = { 88200: 1, 176400: 2, 192000: 3, 8000: 4, 16000: 5, 22050: 6, 24000: 7, 32000: 8, 44100: 9, 48000: 10, 96000: 11 };

export function encodeFlac(chans, rate, bps) {
  const n = chans[0].length, BS = 4096;
  const out = new Bits(Math.max(1 << 16, n * chans.length * (bps / 8) * 0.7));
  // header + STREAMINFO (min/max frame size and MD5 left as "unknown")
  for (const c of 'fLaC') out.put(c.charCodeAt(0), 8);
  out.put(0x80, 8); out.put(34, 24);
  out.put(BS, 16); out.put(BS, 16); out.put(0, 24); out.put(0, 24);
  out.put(rate, 20); out.put(chans.length - 1, 3); out.put(bps - 1, 5);
  out.put(Math.floor(n / 2 ** 32), 4); out.put(n % 2 ** 32, 32);
  for (let i = 0; i < 16; i++) out.put(0, 8);
  let frame = 0;
  for (let s = 0; s < n; s += BS, frame++) {
    const len = Math.min(BS, n - s);
    const L = chans[0].subarray(s, s + len), R = chans[1]?.subarray(s, s + len);
    // stereo: pick independent, left/side, right/side or mid/side by size
    let mode = chans.length - 1, subs = R ? [L, R] : [L], bpsOf = R ? [bps, bps] : [bps];
    if (R) {
      const side = new Int32Array(len), mid = new Int32Array(len);
      for (let i = 0; i < len; i++) { side[i] = L[i] - R[i]; mid[i] = (L[i] + R[i]) >> 1; }
      const pL = subframePlan(L, bps), pR = subframePlan(R, bps), pS = subframePlan(side, bps + 1), pM = subframePlan(mid, bps);
      const opts = [[1, [L, R], [bps, bps], [pL, pR]], [8, [L, side], [bps, bps + 1], [pL, pS]], [9, [side, R], [bps + 1, bps], [pS, pR]], [10, [mid, side], [bps, bps + 1], [pM, pS]]];
      const pick = opts.reduce((a, b) => (b[3][0].cost + b[3][1].cost < a[3][0].cost + a[3][1].cost ? b : a));
      [mode, subs, bpsOf] = pick;
      subs.plans = pick[3];
    }
    const start = out.pos;
    out.put(0xfff8 >> 2, 14); out.put(0, 1); out.put(0, 1); // sync, reserved, fixed block size
    const bsCode = len === BS ? 12 : 7; // 4096 = 2^12 -> code 12; else 16-bit size at the end
    out.put(bsCode, 4); out.put(RATE_CODE[rate] ?? 0, 4);
    out.put(mode, 4); out.put(bps === 16 ? 4 : bps === 24 ? 6 : 0, 3); out.put(0, 1);
    utf8num(out, frame);
    if (bsCode === 7) out.put(len - 1, 16);
    out.put(crc8(out.buf, start, out.pos), 8);
    subs.forEach((x, i) => writeSubframe(out, x, bpsOf[i], subs.plans ? subs.plans[i] : subframePlan(x, bpsOf[i])));
    out.align();
    const c = crc16(out.buf, start, out.pos);
    out.put(c, 16);
  }
  return out.bytes().slice();
}
