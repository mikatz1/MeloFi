'use strict';
// bzip2 decoder (pure JS): Huffman + MTF + RLE2 per block, inverse BWT, RLE1.
// Block CRCs are not checked; the archive as a whole is verified with SHA-256 first.

class BitReader {
  constructor(src) { this.src = src; this.acc = 0; this.n = 0; }
  bits(k) {
    let v = 0;
    while (k > 0) {
      if (this.n === 0) { this.acc = this.src.byte(); this.n = 8; }
      const take = Math.min(k, this.n);
      const shift = this.n - take;
      v = (v * (1 << take)) + ((this.acc >>> shift) & ((1 << take) - 1));
      this.n -= take;
      k -= take;
    }
    return v;
  }
  bit() {
    if (this.n === 0) { this.acc = this.src.byte(); this.n = 8; }
    this.n--;
    return (this.acc >>> this.n) & 1;
  }
}

function huffTable(lengths, n) {
  const count = new Int32Array(22), first = new Int32Array(22), last = new Int32Array(22), idx = new Int32Array(22);
  for (let i = 0; i < n; i++) count[lengths[i]]++;
  const perm = [];
  for (let L = 1; L <= 20; L++) for (let s = 0; s < n; s++) if (lengths[s] === L) perm.push(s);
  let code = 0, k = 0;
  for (let L = 1; L <= 20; L++) {
    first[L] = code; idx[L] = k; last[L] = code + count[L] - 1;
    code = (code + count[L]) << 1;
    k += count[L];
  }
  return { count, first, last, idx, perm };
}

function huffDecode(br, t) {
  let c = 0;
  for (let L = 1; L <= 20; L++) {
    c = (c << 1) | br.bit();
    if (t.count[L] && c <= t.last[L]) return t.perm[t.idx[L] + c - t.first[L]];
  }
  throw new Error('bzip2: bad Huffman code');
}

function decodeBzip2(src, onData) {
  let streams = 0;
  for (;;) {
    if (streams > 0 && src.eof()) return;
    if (src.byte() !== 0x42 || src.byte() !== 0x5A || src.byte() !== 0x68) {
      if (streams > 0) return; // trailing garbage after a complete stream
      throw new Error('bzip2: not a bzip2 file');
    }
    const level = src.byte() - 0x30;
    if (level < 1 || level > 9) throw new Error('bzip2: bad block size');
    const maxBlock = level * 100000;
    const br = new BitReader(src);
    const tt = new Uint32Array(maxBlock);
    const block = new Uint8Array(maxBlock);
    for (;;) {
      const m1 = br.bits(24), m2 = br.bits(24);
      br.bits(32); // CRC
      if (m1 === 0x177245 && m2 === 0x385090) break;
      if (m1 !== 0x314159 || m2 !== 0x265359) throw new Error('bzip2: bad block header');
      if (br.bit()) throw new Error('bzip2: randomised blocks are not supported');
      const origPtr = br.bits(24);
      const used = br.bits(16);
      const seqToUnseq = [];
      for (let i = 0; i < 16; i++) if (used & (0x8000 >>> i)) {
        const u = br.bits(16);
        for (let j = 0; j < 16; j++) if (u & (0x8000 >>> j)) seqToUnseq.push(i * 16 + j);
      }
      const nInUse = seqToUnseq.length;
      if (!nInUse) throw new Error('bzip2: empty symbol map');
      const alphaSize = nInUse + 2;
      const nGroups = br.bits(3);
      const nSelectors = br.bits(15);
      if (nGroups < 2 || nGroups > 6 || nSelectors < 1) throw new Error('bzip2: bad tables');
      const mtfG = [0, 1, 2, 3, 4, 5].slice(0, nGroups);
      const selectors = new Uint8Array(nSelectors);
      for (let i = 0; i < nSelectors; i++) {
        let j = 0;
        while (br.bit()) { j++; if (j >= nGroups) throw new Error('bzip2: bad selector'); }
        const v = mtfG[j];
        mtfG.splice(j, 1);
        mtfG.unshift(v);
        selectors[i] = v;
      }
      const tables = [];
      for (let g = 0; g < nGroups; g++) {
        const len = new Uint8Array(alphaSize);
        let cur = br.bits(5);
        for (let s = 0; s < alphaSize; s++) {
          for (;;) {
            if (cur < 1 || cur > 20) throw new Error('bzip2: bad code length');
            if (!br.bit()) break;
            cur += br.bit() ? -1 : 1;
          }
          len[s] = cur;
        }
        tables.push(huffTable(len, alphaSize));
      }
      // MTF / RLE2
      const mtf = new Uint8Array(256);
      for (let i = 0; i < 256; i++) mtf[i] = i;
      const counts = new Int32Array(256);
      const EOB = nInUse + 1;
      let n = 0, groupPos = 0, sel = 0, t = null;
      let runLen = 0, runBit = 1;
      for (;;) {
        if (groupPos === 0) {
          if (sel >= nSelectors) throw new Error('bzip2: ran out of selectors');
          t = tables[selectors[sel++]];
          groupPos = 50;
        }
        groupPos--;
        const sym = huffDecode(br, t);
        if (sym <= 1) { // RUNA / RUNB
          runLen += (sym + 1) * runBit;
          runBit <<= 1;
          if (runLen > maxBlock) throw new Error('bzip2: run too long');
          continue;
        }
        if (runLen) {
          const b = seqToUnseq[mtf[0]];
          if (n + runLen > maxBlock) throw new Error('bzip2: block too long');
          block.fill(b, n, n + runLen);
          counts[b] += runLen;
          n += runLen;
          runLen = 0; runBit = 1;
        }
        if (sym === EOB) break;
        const k = sym - 1;
        const v = mtf[k];
        mtf.copyWithin(1, 0, k);
        mtf[0] = v;
        const b = seqToUnseq[v];
        if (n >= maxBlock) throw new Error('bzip2: block too long');
        block[n++] = b;
        counts[b]++;
      }
      if (origPtr >= n) throw new Error('bzip2: bad origin pointer');
      // inverse BWT
      const cf = new Int32Array(256);
      for (let i = 0, s = 0; i < 256; i++) { cf[i] = s; s += counts[i]; }
      for (let i = 0; i < n; i++) tt[cf[block[i]]++] = i;
      // RLE1 while walking the BWT vector
      const out = new Uint8Array(Math.min(n * 2 + 256, 1 << 22));
      let o = 0;
      const emit = (b) => { out[o++] = b; if (o === out.length) { onData(out); o = 0; } };
      let pos = tt[origPtr];
      let prev = -1, same = 0;
      for (let k = 0; k < n; k++) {
        const b = block[pos];
        pos = tt[pos];
        if (same === 4) {
          for (let r = 0; r < b; r++) emit(prev);
          same = 0; prev = -1;
          continue;
        }
        if (b === prev) same++; else { prev = b; same = 1; }
        emit(b);
      }
      if (o) onData(out.subarray(0, o));
    }
    // stream ends byte-aligned (the bit reader drops the padding bits); another may follow
    streams++;
  }
}

module.exports = { decodeBzip2 };
