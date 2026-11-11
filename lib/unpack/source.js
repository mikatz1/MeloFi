'use strict';
// Buffered sequential reader over a file descriptor (or a Buffer), with a byte position.
const fs = require('node:fs');

class ByteSource {
  // from: fd (number) or Buffer; start/end: byte range of the file to read
  constructor(from, start = 0, end = Infinity, bufSize = 1 << 20) {
    if (Buffer.isBuffer(from) || from instanceof Uint8Array) {
      this.fd = null;
      this.buf = from;
      this.bufStart = 0;
      this.bufLen = Math.min(from.length, end);
      this.end = this.bufLen;
    } else {
      this.fd = from;
      this.buf = Buffer.allocUnsafe(bufSize);
      this.bufStart = start;
      this.bufLen = 0;
      this.end = end;
    }
    this.pos = start; // absolute position of the next byte
    this.i = start - this.bufStart;
  }
  fill() {
    if (this.fd == null) throw new Error('unexpected end of data');
    const want = Math.min(this.buf.length, this.end - this.pos);
    if (want <= 0) throw new Error('unexpected end of data');
    const n = fs.readSync(this.fd, this.buf, 0, want, this.pos);
    if (n <= 0) throw new Error('unexpected end of file');
    this.bufStart = this.pos;
    this.bufLen = n;
    this.i = 0;
  }
  byte() {
    if (this.i >= this.bufLen) this.fill();
    this.pos++;
    return this.buf[this.i++];
  }
  bytes(n) {
    const out = Buffer.allocUnsafe(n);
    let o = 0;
    while (o < n) {
      if (this.i >= this.bufLen) this.fill();
      const k = Math.min(n - o, this.bufLen - this.i);
      this.buf.copy ? this.buf.copy(out, o, this.i, this.i + k) : out.set(this.buf.subarray(this.i, this.i + k), o);
      o += k; this.i += k; this.pos += k;
    }
    return out;
  }
  // pass n raw bytes to onData in pieces (stored / uncompressed data)
  pipe(n, onData) {
    while (n > 0) {
      if (this.i >= this.bufLen) this.fill();
      const k = Math.min(n, this.bufLen - this.i);
      onData(this.buf.subarray(this.i, this.i + k));
      n -= k; this.i += k; this.pos += k;
    }
  }
  skip(n) { for (; n > 0; n--) this.byte(); }
  eof() {
    if (this.i < this.bufLen) return false;
    return this.pos >= this.end || (this.fd != null && (() => { try { this.fill(); return false; } catch { return true; } })());
  }
  seek(p) { this.pos = p; this.i = p - this.bufStart; if (this.i < 0 || this.i > this.bufLen) { this.i = 0; this.bufLen = 0; this.bufStart = p; } }
}

module.exports = { ByteSource };
