'use strict';
// .xz container (https://tukaani.org/xz/xz-file-format.txt): streams of blocks, each block a
// filter chain ending in LZMA2 (optionally preceded by Delta). Integrity checks inside the
// container are skipped: the whole archive is verified with SHA-256 before it is opened.
const { decodeLzma2 } = require('./lzma');
const { deltaFilter } = require('./filters');

const MAGIC = [0xFD, 0x37, 0x7A, 0x58, 0x5A, 0x00];
const CHECK_SIZE = [0, 4, 4, 4, 8, 8, 8, 16, 16, 16, 32, 32, 32, 64, 64, 64];

function varint(src) {
  let v = 0, mul = 1;
  for (let i = 0; i < 9; i++) {
    const b = src.byte();
    v += (b & 0x7F) * mul;
    if (!(b & 0x80)) return v;
    mul *= 128;
  }
  throw new Error('xz: bad integer');
}

function decodeXz(src, onData) {
  let streams = 0;
  for (;;) {
    // stream padding (multiples of four zero bytes) between streams
    if (streams > 0) {
      if (src.eof()) return;
      let b = src.byte();
      while (b === 0) { if (src.eof()) return; b = src.byte(); }
      src.seek(src.pos - 1);
    }
    for (let i = 0; i < 6; i++) if (src.byte() !== MAGIC[i]) throw new Error('xz: not an xz file');
    src.byte();
    const check = src.byte() & 0x0F;
    src.skip(4); // CRC32 of the flags
    for (;;) {
      const blockStart = src.pos;
      const hb = src.byte();
      if (hb === 0) break; // index follows
      const headerSize = (hb + 1) * 4;
      const flags = src.byte();
      const nFilters = (flags & 3) + 1;
      if (flags & 0x40) varint(src);
      if (flags & 0x80) varint(src);
      const filters = [];
      for (let f = 0; f < nFilters; f++) {
        const id = varint(src);
        const size = varint(src);
        filters.push({ id, props: src.bytes(size) });
      }
      src.seek(blockStart + headerSize); // header padding + CRC32
      const last = filters[filters.length - 1];
      if (last.id !== 0x21) throw new Error(`xz: unsupported filter 0x${last.id.toString(16)}`);
      let sink = onData;
      for (let f = filters.length - 2; f >= 0; f--) {
        const flt = filters[f];
        if (flt.id === 0x03) sink = deltaFilter(flt.props[0] + 1, sink);
        else throw new Error(`xz: unsupported filter 0x${flt.id.toString(16)}`);
      }
      const dataStart = src.pos;
      decodeLzma2(src, last.props[0], sink);
      const unpadded = src.pos - dataStart;
      src.skip((4 - (unpadded % 4)) % 4);
      src.skip(CHECK_SIZE[check]);
    }
    // index: count, records, padding, CRC32; then the 12-byte stream footer
    const indexStart = src.pos - 1;
    const n = varint(src);
    for (let i = 0; i < n; i++) { varint(src); varint(src); }
    const len = src.pos - indexStart;
    src.skip((4 - (len % 4)) % 4);
    src.skip(4);
    src.skip(12);
    streams++;
  }
}

module.exports = { decodeXz };
