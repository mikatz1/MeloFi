'use strict';
// Zip reader: central directory (incl. Zip64), stored and deflated entries.
// Works on a local file or — given a function that fetches byte ranges — on a remote archive,
// so only the entries that are needed get downloaded.
const zlib = require('node:zlib');

function parseEocd(tail, tailStart) {
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) !== 0x06054b50) continue;
    let count = tail.readUInt16LE(i + 10);
    let cdSize = tail.readUInt32LE(i + 12);
    let cdOff = tail.readUInt32LE(i + 16);
    // Zip64 locator sits right before the EOCD
    if (i >= 20 && tail.readUInt32LE(i - 20) === 0x07064b50) {
      const eocd64 = Number(tail.readBigUInt64LE(i - 20 + 8));
      const j = eocd64 - tailStart;
      if (j < 0 || tail.readUInt32LE(j) !== 0x06064b50) return { zip64At: eocd64 };
      count = Number(tail.readBigUInt64LE(j + 32));
      cdSize = Number(tail.readBigUInt64LE(j + 40));
      cdOff = Number(tail.readBigUInt64LE(j + 48));
    }
    return { count, cdSize, cdOff };
  }
  throw new Error('zip: end of central directory not found');
}

function parseCentral(cd, count) {
  const out = [];
  let p = 0;
  for (let n = 0; n < count; n++) {
    if (cd.readUInt32LE(p) !== 0x02014b50) throw new Error('zip: bad central directory');
    const flags = cd.readUInt16LE(p + 8);
    const method = cd.readUInt16LE(p + 10);
    const crc = cd.readUInt32LE(p + 16);
    let csize = cd.readUInt32LE(p + 20), size = cd.readUInt32LE(p + 24);
    const nl = cd.readUInt16LE(p + 28), xl = cd.readUInt16LE(p + 30), cl = cd.readUInt16LE(p + 32);
    let off = cd.readUInt32LE(p + 42);
    const name = cd.subarray(p + 46, p + 46 + nl).toString(flags & 0x800 ? 'utf8' : 'latin1');
    let x = p + 46 + nl;
    const xe = x + xl;
    while (x + 4 <= xe) {
      const id = cd.readUInt16LE(x), len = cd.readUInt16LE(x + 2);
      if (id === 1) {
        let q = x + 4;
        if (size === 0xFFFFFFFF) { size = Number(cd.readBigUInt64LE(q)); q += 8; }
        if (csize === 0xFFFFFFFF) { csize = Number(cd.readBigUInt64LE(q)); q += 8; }
        if (off === 0xFFFFFFFF) { off = Number(cd.readBigUInt64LE(q)); q += 8; }
      }
      x += 4 + len;
    }
    if (flags & 1) throw new Error('zip: encrypted entries are not supported');
    if (!name.endsWith('/')) out.push({ name, method, crc, csize, size, off });
    p = xe + cl;
  }
  return out;
}

// readRange(start, end) -> Promise<Buffer> (end exclusive); size = total archive size
async function listZip(readRange, size) {
  const tailLen = Math.min(size, 65557 + 20);
  const tailStart = size - tailLen;
  const tail = await readRange(tailStart, size);
  let e = parseEocd(tail, tailStart);
  if (e.zip64At != null) {
    const b = await readRange(e.zip64At, e.zip64At + 56);
    e = { count: Number(b.readBigUInt64LE(32)), cdSize: Number(b.readBigUInt64LE(40)), cdOff: Number(b.readBigUInt64LE(48)) };
  }
  const cd = e.cdOff >= tailStart ? tail.subarray(e.cdOff - tailStart, e.cdOff - tailStart + e.cdSize) : await readRange(e.cdOff, e.cdOff + e.cdSize);
  return parseCentral(cd, e.count);
}

function listZipSync(readRange, size) {
  const tailLen = Math.min(size, 65557 + 20);
  const tailStart = size - tailLen;
  const tail = readRange(tailStart, size);
  let e = parseEocd(tail, tailStart);
  if (e.zip64At != null) {
    const b = readRange(e.zip64At, e.zip64At + 56);
    e = { count: Number(b.readBigUInt64LE(32)), cdSize: Number(b.readBigUInt64LE(40)), cdOff: Number(b.readBigUInt64LE(48)) };
  }
  const cd = e.cdOff >= tailStart ? tail.subarray(e.cdOff - tailStart, e.cdOff - tailStart + e.cdSize) : readRange(e.cdOff, e.cdOff + e.cdSize);
  return parseCentral(cd, e.count);
}

// Where an entry's data starts: needs the local header (its extra field may differ from the central one).
function dataStart(local, entry) {
  if (local.readUInt32LE(0) !== 0x04034b50) throw new Error('zip: bad local header');
  return entry.off + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
}

function inflateEntry(entry, data) {
  let out;
  if (entry.method === 0) out = data;
  else if (entry.method === 8) out = zlib.inflateRawSync(data);
  else throw new Error(`zip: compression method ${entry.method} is not supported`);
  if (out.length !== entry.size) throw new Error(`zip: ${entry.name}: size mismatch`);
  if (zlib.crc32 && (zlib.crc32(out) >>> 0) !== entry.crc) throw new Error(`zip: ${entry.name}: CRC mismatch`);
  return out;
}

// The span to fetch for an entry when its local header is not known yet: header + name + generous extra.
const LOCAL_SLACK = 30 + 1024 + 1024;

async function readEntry(readRange, entry) {
  const buf = await readRange(entry.off, entry.off + LOCAL_SLACK + entry.csize);
  const start = dataStart(buf, entry) - entry.off;
  if (start + entry.csize > buf.length) {
    const more = await readRange(entry.off + start, entry.off + start + entry.csize);
    return inflateEntry(entry, more);
  }
  return inflateEntry(entry, buf.subarray(start, start + entry.csize));
}

module.exports = { listZip, listZipSync, readEntry, inflateEntry, dataStart, LOCAL_SLACK };
