'use strict';
// 7z reader (pure JS): header (plain or LZMA-encoded), folders made of a chain of simple coders
// (Copy, LZMA, LZMA2, Delta, BZip2, Deflate), solid substreams. Encryption and branch converters
// for executables are not supported — sample libraries don't use them.
const zlib = require('node:zlib');
const { ByteSource } = require('./source');
const { decodeLzma, decodeLzma2 } = require('./lzma');
const { decodeBzip2 } = require('./bzip2');
const { deltaFilter } = require('./filters');

const SIG = [0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C];
const K = { End: 0, Header: 1, ArchiveProperties: 2, AdditionalStreamsInfo: 3, MainStreamsInfo: 4, FilesInfo: 5, PackInfo: 6, UnPackInfo: 7, SubStreamsInfo: 8, Size: 9, CRC: 10, Folder: 11, CodersUnPackSize: 12, NumUnPackStream: 13, EmptyStream: 14, EmptyFile: 15, Name: 17, EncodedHeader: 23, Dummy: 25 };

class Reader {
  constructor(buf) { this.b = buf; this.p = 0; }
  byte() { if (this.p >= this.b.length) throw new Error('7z: truncated header'); return this.b[this.p++]; }
  num() {
    const first = this.byte();
    let mask = 0x80, v = 0;
    for (let i = 0; i < 8; i++) {
      if ((first & mask) === 0) return v + (first & (mask - 1)) * Math.pow(2, 8 * i);
      v += this.byte() * Math.pow(2, 8 * i);
      mask >>>= 1;
    }
    return v;
  }
  u32() { const v = this.b.readUInt32LE(this.p); this.p += 4; return v; }
  bytes(n) { const v = this.b.subarray(this.p, this.p + n); this.p += n; return v; }
  bits(n) {
    const out = [];
    let mask = 0, cur = 0;
    for (let i = 0; i < n; i++) {
      if (mask === 0) { cur = this.byte(); mask = 0x80; }
      out.push(!!(cur & mask));
      mask >>>= 1;
    }
    return out;
  }
  digests(n) {
    const all = this.byte();
    const defined = all ? new Array(n).fill(true) : this.bits(n);
    return defined.map((d) => (d ? this.u32() : null));
  }
}

function readPackInfo(r) {
  const packPos = r.num();
  const n = r.num();
  const sizes = [];
  for (;;) {
    const id = r.num();
    if (id === K.End) break;
    if (id === K.Size) for (let i = 0; i < n; i++) sizes.push(r.num());
    else if (id === K.CRC) r.digests(n);
    else throw new Error('7z: bad PackInfo');
  }
  return { packPos, sizes };
}

function readFolder(r) {
  const nCoders = r.num();
  const coders = [];
  let totalIn = 0, totalOut = 0;
  for (let i = 0; i < nCoders; i++) {
    const flags = r.byte();
    const id = Buffer.from(r.bytes(flags & 0x0F)).toString('hex');
    let nIn = 1, nOut = 1;
    if (flags & 0x10) { nIn = r.num(); nOut = r.num(); }
    const props = flags & 0x20 ? Buffer.from(r.bytes(r.num())) : Buffer.alloc(0);
    if (flags & 0x80) throw new Error('7z: alternative coders are not supported');
    coders.push({ id, nIn, nOut, props, inBase: totalIn, outBase: totalOut });
    totalIn += nIn; totalOut += nOut;
  }
  const bindPairs = [];
  for (let i = 0; i < totalOut - 1; i++) bindPairs.push({ inIndex: r.num(), outIndex: r.num() });
  const nPacked = totalIn - bindPairs.length;
  const packed = [];
  if (nPacked === 1) {
    for (let i = 0; i < totalIn; i++) if (!bindPairs.some((b) => b.inIndex === i)) { packed.push(i); break; }
  } else for (let i = 0; i < nPacked; i++) packed.push(r.num());
  return { coders, bindPairs, packed, totalOut, unpackSizes: [] };
}

function readUnpackInfo(r) {
  if (r.num() !== K.Folder) throw new Error('7z: bad UnPackInfo');
  const n = r.num();
  if (r.byte() !== 0) throw new Error('7z: external folders are not supported');
  const folders = [];
  for (let i = 0; i < n; i++) folders.push(readFolder(r));
  if (r.num() !== K.CodersUnPackSize) throw new Error('7z: bad UnPackInfo');
  for (const f of folders) for (let i = 0; i < f.totalOut; i++) f.unpackSizes.push(r.num());
  for (;;) {
    const id = r.num();
    if (id === K.End) break;
    if (id === K.CRC) r.digests(n);
    else throw new Error('7z: bad UnPackInfo');
  }
  return folders;
}

// the folder's final output: the out stream that no bind pair consumes
function folderSize(f) {
  for (let i = f.totalOut - 1; i >= 0; i--) if (!f.bindPairs.some((b) => b.outIndex === i)) return f.unpackSizes[i];
  throw new Error('7z: bad folder');
}

function readSubStreams(r, folders) {
  const counts = folders.map(() => 1);
  let id = r.num();
  if (id === K.NumUnPackStream) { for (let i = 0; i < folders.length; i++) counts[i] = r.num(); id = r.num(); }
  const sizes = [];
  const hasSizes = id === K.Size;
  folders.forEach((f, i) => {
    if (counts[i] === 0) return;
    let sum = 0;
    if (hasSizes) for (let k = 1; k < counts[i]; k++) { const s = r.num(); sizes.push(s); sum += s; }
    sizes.push(folderSize(f) - sum);
  });
  if (hasSizes) id = r.num();
  while (id !== K.End) {
    if (id === K.CRC) {
      let n = 0;
      folders.forEach((f, i) => { n += counts[i]; }); // streams without a folder CRC; close enough to skip
      r.digests(n);
    } else throw new Error('7z: bad SubStreamsInfo');
    id = r.num();
  }
  return { counts, sizes };
}

function readStreamsInfo(r) {
  const out = { pack: null, folders: [], sub: null };
  for (;;) {
    const id = r.num();
    if (id === K.End) break;
    if (id === K.PackInfo) out.pack = readPackInfo(r);
    else if (id === K.UnPackInfo) out.folders = readUnpackInfo(r);
    else if (id === K.SubStreamsInfo) out.sub = readSubStreams(r, out.folders);
    else throw new Error('7z: bad StreamsInfo');
  }
  if (!out.sub) out.sub = { counts: out.folders.map(() => 1), sizes: out.folders.map(folderSize) };
  return out;
}

function readFilesInfo(r) {
  const n = r.num();
  const files = Array.from({ length: n }, () => ({ name: '', empty: false, emptyFile: false }));
  let emptyStreams = [];
  for (;;) {
    const type = r.num();
    if (type === K.End) break;
    const size = r.num();
    const end = r.p + size;
    if (type === K.EmptyStream) {
      emptyStreams = r.bits(n);
      emptyStreams.forEach((e, i) => { files[i].empty = e; });
    } else if (type === K.EmptyFile) {
      const nEmpty = emptyStreams.filter(Boolean).length;
      const bits = r.bits(nEmpty);
      let k = 0;
      files.forEach((f) => { if (f.empty) f.emptyFile = bits[k++]; });
    } else if (type === K.Name) {
      if (r.byte() !== 0) throw new Error('7z: external names are not supported');
      const text = Buffer.from(r.bytes(end - r.p)).toString('utf16le');
      text.split('\0').slice(0, n).forEach((s, i) => { files[i].name = s; });
    }
    r.p = end;
  }
  return files;
}

// Decode one folder, streaming its final output to onData.
function decodeFolder(fd, packStart, folder, onData) {
  // only chains of 1-in/1-out coders: coder i's input is bound to coder i+1's output (7-Zip's layout)
  if (folder.coders.some((c) => c.nIn !== 1 || c.nOut !== 1)) throw new Error('7z: complex coders are not supported');
  // find the chain order starting from the coder whose input is the packed stream
  const order = [];
  let inIdx = folder.packed[0];
  for (;;) {
    const c = folder.coders.find((x) => x.inBase === inIdx);
    order.push(c);
    const bp = folder.bindPairs.find((b) => b.outIndex === c.outBase);
    if (!bp) break;
    inIdx = bp.inIndex;
  }
  // order[0] reads packed bytes; each next coder reads the previous one's output.
  // Run them as nested streaming callbacks: build sinks from the last coder outward.
  if (order.length > 2) throw new Error('7z: coder chains longer than two are not supported');
  let sink = onData;
  if (order.length === 2) {
    const post = order[1];
    if (post.id === '03') sink = deltaFilter(post.props[0] + 1, onData);
    else if (post.id === '00') sink = onData;
    else throw new Error(`7z: unsupported filter ${post.id}`);
  }
  const first = order[0];
  const outSize = folder.unpackSizes[first.outBase];
  const src = new ByteSource(fd, packStart, Infinity);
  switch (first.id) {
    case '00': src.pipe(outSize, sink); break;
    case '030101': decodeLzma(src, first.props, outSize, sink); break;
    case '21': decodeLzma2(src, first.props[0], sink, outSize); break;
    case '040202': decodeBzip2(src, sink); break;
    case '040108': {
      // deflate: inflate in one go (only seen in small archives)
      const packed = src.bytes(folder.packSize);
      sink(zlib.inflateRawSync(packed));
      break;
    }
    default: throw new Error(`7z: unsupported coder ${first.id}`);
  }
}

function decodeBuffer(fd, packStart, folder) {
  const parts = [];
  decodeFolder(fd, packStart, folder, (c) => parts.push(Buffer.from(c)));
  return Buffer.concat(parts);
}

// List entries: [{ name, size, folder, offsetInFolder }]
function open7z(fd) {
  const sh = Buffer.alloc(32);
  require('node:fs').readSync(fd, sh, 0, 32, 0);
  for (let i = 0; i < 6; i++) if (sh[i] !== SIG[i]) throw new Error('7z: not a 7z archive');
  const nextOff = Number(sh.readBigUInt64LE(12)), nextSize = Number(sh.readBigUInt64LE(20));
  let hb = Buffer.alloc(nextSize);
  require('node:fs').readSync(fd, hb, 0, nextSize, 32 + nextOff);
  let r = new Reader(hb);
  let id = r.num();
  while (id === K.EncodedHeader) {
    const si = readStreamsInfo(r);
    const f = si.folders[0];
    f.packSize = si.pack.sizes[0];
    hb = decodeBuffer(fd, 32 + si.pack.packPos, f);
    r = new Reader(hb);
    id = r.num();
  }
  if (id !== K.Header) throw new Error('7z: bad header');
  let si = null, files = [];
  for (;;) {
    const t = r.num();
    if (t === K.End) break;
    if (t === K.ArchiveProperties) { for (;;) { const p = r.num(); if (p === 0) break; r.p += r.num(); } }
    else if (t === K.AdditionalStreamsInfo) readStreamsInfo(r);
    else if (t === K.MainStreamsInfo) si = readStreamsInfo(r);
    else if (t === K.FilesInfo) files = readFilesInfo(r);
    else throw new Error('7z: bad header');
  }
  const folders = si ? si.folders : [];
  // pack stream offsets
  let pos = 32 + (si ? si.pack.packPos : 0), ps = 0;
  for (const f of folders) {
    f.packStart = pos;
    f.packSize = si.pack.sizes[ps];
    for (let k = 0; k < f.packed.length; k++) pos += si.pack.sizes[ps++];
  }
  // assign substreams to files in order
  const entries = [];
  let fi = 0, si2 = 0, inFolder = 0, offset = 0;
  for (const file of files) {
    if (file.empty) { if (file.emptyFile) entries.push({ name: file.name, size: 0, folder: -1 }); continue; }
    while (fi < folders.length && inFolder >= si.sub.counts[fi]) { fi++; inFolder = 0; offset = 0; }
    const size = si.sub.sizes[si2++];
    entries.push({ name: file.name.replace(/\\/g, '/'), size, folder: fi, offset });
    offset += size;
    inFolder++;
  }
  return { entries, folders };
}

// Stream every needed entry out of the archive. onEntry(name, size) -> sink {write, end} | null.
function extract7z(fd, onEntry) {
  const { entries, folders } = open7z(fd);
  for (const e of entries) if (e.folder === -1) { const s = onEntry(e.name, 0); if (s) s.end(); }
  folders.forEach((f, fi) => {
    const list = entries.filter((e) => e.folder === fi);
    const sinks = list.map((e) => onEntry(e.name, e.size));
    if (!sinks.some(Boolean)) return; // nothing wanted from this folder: skip decoding it
    const lastNeeded = list.reduce((m, e, i) => (sinks[i] ? e.offset + e.size : m), 0);
    let at = 0, k = 0;
    const STOP = {};
    try {
      decodeFolder(fd, f.packStart, f, (chunk) => {
        let i = 0;
        while (i < chunk.length) {
          while (k < list.length && at >= list[k].offset + list[k].size) { if (sinks[k]) sinks[k].end(); k++; }
          if (k >= list.length || at >= lastNeeded) throw STOP;
          const e = list[k];
          const n = Math.min(chunk.length - i, e.offset + e.size - at);
          if (sinks[k]) sinks[k].write(chunk.subarray(i, i + n));
          i += n; at += n;
        }
      });
    } catch (err) { if (err !== STOP) throw err; }
    for (; k < list.length; k++) if (sinks[k] && at >= list[k].offset + list[k].size) sinks[k].end();
  });
}

module.exports = { open7z, extract7z };
