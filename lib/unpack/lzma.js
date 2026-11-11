'use strict';
// LZMA / LZMA2 decoder (pure JS, no dependencies). Follows the reference decoder in the LZMA SDK
// (LzmaSpec.cpp, public domain) and the LZMA2 chunk format used by xz and 7-Zip.
//
// Input comes from a ByteSource (anything with byte() returning 0..255 and throwing at the end).
// Output goes through a sliding window that hands finished stretches to onData(Uint8Array view);
// the view is only valid during the call, so consumers that keep data must copy it.

const kNumStates = 12;
const kMatchMinLen = 2;
const kEndPosModelIndex = 14;
const kNumFullDistances = 128;
const kNumAlignBits = 4;
const kNumLenToPosStates = 4;
const PROB_INIT = 1024;

class Window {
  constructor(size, onData) {
    this.buf = new Uint8Array(Math.max(size, 4096));
    this.size = this.buf.length;
    this.pos = 0;
    this.flushed = 0;
    this.full = false;
    this.total = 0; // bytes produced since the last dictionary reset
    this.onData = onData;
  }
  reset() { this.flush(); this.pos = 0; this.flushed = 0; this.full = false; this.total = 0; }
  flush() {
    if (this.pos > this.flushed) this.onData(this.buf.subarray(this.flushed, this.pos));
    this.flushed = this.pos;
  }
  put(b) {
    this.buf[this.pos++] = b;
    this.total++;
    if (this.pos === this.size) { this.flush(); this.pos = 0; this.flushed = 0; this.full = true; }
  }
  get(dist) { // dist >= 1
    const i = this.pos >= dist ? this.pos - dist : this.size - dist + this.pos;
    return this.buf[i];
  }
  has(dist) { return dist <= this.pos || this.full; }
  copy(dist, len) {
    const buf = this.buf, size = this.size;
    let src = this.pos >= dist ? this.pos - dist : size - dist + this.pos;
    for (let k = 0; k < len; k++) {
      buf[this.pos++] = buf[src++];
      if (src === size) src = 0;
      if (this.pos === size) { this.flush(); this.pos = 0; this.flushed = 0; this.full = true; }
    }
    this.total += len;
  }
  empty() { return this.pos === 0 && !this.full; }
}

class RangeDecoder {
  init(src) {
    this.src = src;
    if (src.byte() !== 0) throw new Error('lzma: bad range coder header');
    this.range = 0xFFFFFFFF;
    this.code = 0;
    for (let i = 0; i < 4; i++) this.code = ((this.code << 8) | src.byte()) >>> 0;
    if (this.code === this.range) throw new Error('lzma: corrupted data');
  }
  bit(probs, i) {
    let p = probs[i];
    const bound = (this.range >>> 11) * p;
    let b;
    if (this.code < bound) {
      this.range = bound;
      probs[i] = p + ((2048 - p) >>> 5);
      b = 0;
    } else {
      this.range -= bound;
      this.code -= bound;
      probs[i] = p - (p >>> 5);
      b = 1;
    }
    if (this.range < 0x1000000) {
      this.range = (this.range << 8) >>> 0;
      this.code = ((this.code << 8) | this.src.byte()) >>> 0;
    }
    return b;
  }
  direct(n) {
    let res = 0;
    for (; n > 0; n--) {
      this.range >>>= 1;
      let b = 0;
      if (this.code >= this.range) { this.code -= this.range; b = 1; }
      res = ((res << 1) | b) >>> 0;
      if (this.range < 0x1000000) {
        this.range = (this.range << 8) >>> 0;
        this.code = ((this.code << 8) | this.src.byte()) >>> 0;
      }
    }
    return res;
  }
  finishedOK() { return this.code === 0; }
}

function treeDecode(rc, probs, base, numBits) {
  let m = 1;
  for (let i = 0; i < numBits; i++) m = (m << 1) + rc.bit(probs, base + m);
  return m - (1 << numBits);
}
function treeReverse(rc, probs, base, numBits) {
  let m = 1, sym = 0;
  for (let i = 0; i < numBits; i++) {
    const b = rc.bit(probs, base + m);
    m = (m << 1) + b;
    sym |= b << i;
  }
  return sym;
}

class LenDecoder {
  constructor() { this.p = new Uint16Array(2 + 16 * 8 * 2 + 256); }
  reset() { this.p.fill(PROB_INIT); }
  // layout: [0]=choice [1]=choice2 [2..130)=low[16][8] [130..258)=mid[16][8] [258..514)=high[256]
  decode(rc, posState) {
    const p = this.p;
    if (rc.bit(p, 0) === 0) return treeDecode(rc, p, 2 + posState * 8, 3);
    if (rc.bit(p, 1) === 0) return 8 + treeDecode(rc, p, 130 + posState * 8, 3);
    return 16 + treeDecode(rc, p, 258, 8);
  }
}

class LzmaDecoder {
  constructor(dictSize, onData) {
    this.win = new Window(dictSize, onData);
    this.dictSize = dictSize;
    this.rc = new RangeDecoder();
    this.lenDec = new LenDecoder();
    this.repLenDec = new LenDecoder();
    this.isMatch = new Uint16Array(kNumStates << 4);
    this.isRep = new Uint16Array(kNumStates);
    this.isRepG0 = new Uint16Array(kNumStates);
    this.isRepG1 = new Uint16Array(kNumStates);
    this.isRepG2 = new Uint16Array(kNumStates);
    this.isRep0Long = new Uint16Array(kNumStates << 4);
    this.posSlot = new Uint16Array(kNumLenToPosStates << 6);
    this.posDec = new Uint16Array(1 + kNumFullDistances - kEndPosModelIndex);
    this.align = new Uint16Array(1 << kNumAlignBits);
    this.lit = null;
  }
  setProps(lc, lp, pb) {
    if (lc > 8 || lp > 4 || pb > 4) throw new Error('lzma: bad properties');
    this.lc = lc; this.lp = lp; this.pb = pb;
    const n = 0x300 << (lc + lp);
    if (!this.lit || this.lit.length !== n) this.lit = new Uint16Array(n);
  }
  setPropsByte(d) {
    if (d >= 9 * 5 * 5) throw new Error('lzma: bad properties');
    this.setProps(d % 9, Math.floor(d / 9) % 5, Math.floor(d / 45));
  }
  resetState() {
    this.lit.fill(PROB_INIT);
    for (const a of [this.isMatch, this.isRep, this.isRepG0, this.isRepG1, this.isRepG2, this.isRep0Long, this.posSlot, this.posDec, this.align]) a.fill(PROB_INIT);
    this.lenDec.reset();
    this.repLenDec.reset();
    this.state = 0;
    this.rep0 = this.rep1 = this.rep2 = this.rep3 = 0;
  }
  decodeDistance(len) {
    const rc = this.rc;
    let lenState = len > kNumLenToPosStates - 1 ? kNumLenToPosStates - 1 : len;
    const slot = treeDecode(rc, this.posSlot, lenState << 6, 6);
    if (slot < 4) return slot;
    const numDirect = (slot >>> 1) - 1;
    let dist = ((2 | (slot & 1)) << numDirect) >>> 0;
    if (slot < kEndPosModelIndex) {
      dist += treeReverse(rc, this.posDec, dist - slot, numDirect);
    } else {
      dist = (dist + ((rc.direct(numDirect - kNumAlignBits) << kNumAlignBits) >>> 0)) >>> 0;
      dist = (dist + treeReverse(rc, this.align, 0, kNumAlignBits)) >>> 0;
    }
    return dist;
  }
  // Decode until `limit` bytes were produced (or the end marker when allowEnd). Returns bytes produced.
  run(limit, allowEnd) {
    const rc = this.rc, win = this.win;
    const pbMask = (1 << this.pb) - 1, lpMask = (1 << this.lp) - 1, lc = this.lc;
    const lit = this.lit, isMatch = this.isMatch;
    let state = this.state;
    let rep0 = this.rep0, rep1 = this.rep1, rep2 = this.rep2, rep3 = this.rep3;
    let left = limit;
    while (left > 0) {
      const posState = win.total & pbMask;
      if (rc.bit(isMatch, (state << 4) + posState) === 0) {
        const prev = win.empty() ? 0 : win.get(1);
        const base = 0x300 * (((win.total & lpMask) << lc) + (prev >>> (8 - lc)));
        let sym = 1;
        if (state >= 7) {
          let matchByte = win.get(rep0 + 1);
          do {
            const mb = (matchByte >>> 7) & 1;
            matchByte <<= 1;
            const b = rc.bit(lit, base + ((1 + mb) << 8) + sym);
            sym = (sym << 1) | b;
            if (mb !== b) break;
          } while (sym < 0x100);
        }
        while (sym < 0x100) sym = (sym << 1) | rc.bit(lit, base + sym);
        win.put(sym - 0x100);
        state = state < 4 ? 0 : state < 10 ? state - 3 : state - 6;
        left--;
        continue;
      }
      let len;
      if (rc.bit(this.isRep, state) !== 0) {
        if (win.empty()) throw new Error('lzma: corrupted data');
        if (rc.bit(this.isRepG0, state) === 0) {
          if (rc.bit(this.isRep0Long, (state << 4) + posState) === 0) {
            state = state < 7 ? 9 : 11;
            win.put(win.get(rep0 + 1));
            left--;
            continue;
          }
        } else {
          let dist;
          if (rc.bit(this.isRepG1, state) === 0) dist = rep1;
          else {
            if (rc.bit(this.isRepG2, state) === 0) dist = rep2;
            else { dist = rep3; rep3 = rep2; }
            rep2 = rep1;
          }
          rep1 = rep0;
          rep0 = dist;
        }
        len = this.repLenDec.decode(rc, posState);
        state = state < 7 ? 8 : 11;
      } else {
        rep3 = rep2; rep2 = rep1; rep1 = rep0;
        len = this.lenDec.decode(rc, posState);
        state = state < 7 ? 7 : 10;
        rep0 = this.decodeDistance(len);
        if (rep0 === 0xFFFFFFFF) {
          if (!allowEnd) throw new Error('lzma: unexpected end marker');
          this.state = state; this.rep0 = rep0; this.rep1 = rep1; this.rep2 = rep2; this.rep3 = rep3;
          this.ended = true;
          return limit - left;
        }
        if (rep0 >= this.dictSize || !win.has(rep0 + 1)) throw new Error('lzma: corrupted distance');
      }
      len += kMatchMinLen;
      if (len > left) throw new Error('lzma: match past the end of the data');
      win.copy(rep0 + 1, len);
      left -= len;
    }
    this.state = state; this.rep0 = rep0; this.rep1 = rep1; this.rep2 = rep2; this.rep3 = rep3;
    return limit;
  }
}

// Raw LZMA stream as stored in 7z: 5 property bytes (separately) + data. unpackSize is known.
function decodeLzma(src, props, unpackSize, onData) {
  const dictSize = Math.max((props[1] | (props[2] << 8) | (props[3] << 16) | (props[4] << 24)) >>> 0, 4096);
  const d = new LzmaDecoder(Math.min(dictSize, Math.max(unpackSize, 4096)), onData);
  d.dictSize = dictSize;
  d.setPropsByte(props[0]);
  d.resetState();
  d.rc.init(src);
  d.run(unpackSize, true);
  d.win.flush();
}

function lzma2DictSize(p) {
  if (p > 40) throw new Error('lzma2: bad dictionary size');
  if (p === 40) return 0xFFFFFFFF;
  return ((2 | (p & 1)) * Math.pow(2, (p >>> 1) + 11)) >>> 0;
}

// LZMA2 stream: a sequence of chunks ending with a 0x00 control byte.
// sizeHint (optional): known unpacked size, to keep the window no bigger than needed.
function decodeLzma2(src, dictProp, onData, sizeHint) {
  let dictSize = lzma2DictSize(dictProp);
  if (sizeHint != null) dictSize = Math.min(dictSize, Math.max(sizeHint, 4096));
  dictSize = Math.min(dictSize, 1 << 30);
  const d = new LzmaDecoder(dictSize, onData);
  let needProps = true;
  for (;;) {
    const c = src.byte();
    if (c === 0) break;
    if (c === 1 || c === 2) {
      if (c === 1) d.win.reset();
      const size = ((src.byte() << 8) | src.byte()) + 1;
      for (let i = 0; i < size; i++) d.win.put(src.byte());
      continue;
    }
    if (c < 0x80) throw new Error('lzma2: bad control byte');
    const unpacked = ((c & 0x1F) << 16) + (src.byte() << 8) + src.byte() + 1;
    const packed = (src.byte() << 8) + src.byte() + 1;
    const mode = (c >>> 5) & 3;
    if (mode === 3) d.win.reset();
    if (mode >= 2) { d.setPropsByte(src.byte()); needProps = false; }
    else if (needProps) throw new Error('lzma2: missing properties');
    if (mode >= 1) d.resetState();
    const start = src.pos;
    d.rc.init(src);
    d.run(unpacked, false);
    if (src.pos - start !== packed) throw new Error('lzma2: chunk size mismatch');
  }
  d.win.flush();
}

module.exports = { decodeLzma, decodeLzma2, LzmaDecoder };
