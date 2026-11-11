'use strict';
// Streaming tar reader (ustar, GNU long names, pax path records). Feed it decompressed chunks;
// it calls onEntry(name) -> sink | null for every regular file, then sink.write(chunk) for its
// data and sink.end() when the file is complete.

function octal(b, off, len) {
  if (b[off] & 0x80) { // base-256 (GNU, files > 8 GB)
    let v = b[off] & 0x7F;
    for (let i = 1; i < len; i++) v = v * 256 + b[off + i];
    return v;
  }
  const s = Buffer.from(b.subarray(off, off + len)).toString('latin1').replace(/\0.*$/s, '').trim();
  return s ? parseInt(s, 8) : 0;
}
function str(b, off, len) {
  let e = off;
  while (e < off + len && b[e]) e++;
  return Buffer.from(b.subarray(off, e)).toString('utf8');
}

class TarReader {
  constructor(onEntry) {
    this.onEntry = onEntry;
    this.hdr = new Uint8Array(512);
    this.hn = 0;
    this.left = 0;    // data bytes left in the current entry
    this.pad = 0;     // padding bytes after it
    this.sink = null;
    this.meta = null; // collecting a long-name / pax record
    this.metaBuf = null;
    this.nextName = null;
    this.done = false;
  }
  write(chunk) {
    let i = 0;
    while (i < chunk.length && !this.done) {
      if (this.left > 0) {
        const k = Math.min(this.left, chunk.length - i);
        const part = chunk.subarray(i, i + k);
        if (this.meta) this.metaBuf.push(Buffer.from(part));
        else if (this.sink) this.sink.write(part);
        this.left -= k; i += k;
        if (this.left === 0) this.finishEntry();
        continue;
      }
      if (this.pad > 0) { const k = Math.min(this.pad, chunk.length - i); this.pad -= k; i += k; continue; }
      const k = Math.min(512 - this.hn, chunk.length - i);
      this.hdr.set(chunk.subarray(i, i + k), this.hn);
      this.hn += k; i += k;
      if (this.hn === 512) { this.hn = 0; this.header(); }
    }
  }
  header() {
    const h = this.hdr;
    if (h.every((x) => x === 0)) { this.zeros = (this.zeros || 0) + 1; if (this.zeros >= 2) this.done = true; return; }
    this.zeros = 0;
    const type = String.fromCharCode(h[156] || 0x30);
    const size = octal(h, 124, 12);
    let name = str(h, 0, 100);
    if (str(h, 257, 5) === 'ustar') { const prefix = str(h, 345, 155); if (prefix) name = prefix + '/' + name; }
    if (this.nextName) { name = this.nextName; this.nextName = null; }
    this.left = size;
    this.pad = (512 - (size % 512)) % 512;
    this.sink = null;
    this.meta = null;
    if (type === 'L' || type === 'x') { this.meta = type; this.metaBuf = []; }
    else if (type === '0' || type === '7') this.sink = this.onEntry(name.replace(/^\.\//, ''), size);
    if (size === 0) this.finishEntry();
  }
  finishEntry() {
    if (this.meta) {
      const text = Buffer.concat(this.metaBuf).toString('utf8');
      if (this.meta === 'L') this.nextName = text.replace(/\0.*$/s, '');
      else {
        const m = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(text);
        if (m) this.nextName = m[1];
      }
      this.meta = null;
    } else if (this.sink) { this.sink.end(); this.sink = null; }
  }
}

module.exports = { TarReader };
