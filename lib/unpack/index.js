'use strict';
// Extract the wanted files from a local archive. Pure JS (Node built-ins only), synchronous —
// run it in a worker thread (see ./worker.js) so the app's main process stays responsive.
//
//   extractFiles(archivePath, format, want, onFile)
//     format: 'zip' | '7z' | 'tar.xz' | 'tar.bz2' | 'tar.gz' | 'tar'
//     want:   Map(archive path -> destination file path)
//     onFile(name, bytes) after each file is written (progress)
// Returns the list of wanted paths that were not found in the archive.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { ByteSource } = require('./source');
const { decodeXz } = require('./xz');
const { decodeBzip2 } = require('./bzip2');
const { TarReader } = require('./tar');
const { extract7z } = require('./sevenzip');
const { listZipSync, inflateEntry, dataStart, LOCAL_SLACK } = require('./zip');

const norm = (p) => p.replace(/\\/g, '/').replace(/^\.\//, '');

function fileSink(dst, onDone) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  const tmp = dst + '.part';
  const fd = fs.openSync(tmp, 'w');
  let n = 0;
  return {
    write(chunk) { fs.writeSync(fd, chunk); n += chunk.length; },
    end() { fs.closeSync(fd); fs.renameSync(tmp, dst); onDone(n); },
  };
}

function extractFiles(file, format, want, onFile = () => {}) {
  const wanted = new Map([...want].map(([k, v]) => [norm(k), v]));
  const found = new Set();
  walk(file, format, (name) => {
    const key = norm(name);
    const dst = wanted.get(key);
    if (!dst || found.has(key)) return null;
    found.add(key);
    return fileSink(dst, (n) => onFile(key, n));
  });
  return [...wanted.keys()].filter((k) => !found.has(k));
}

// every file into destDir (build tool); returns the names
function extractAll(file, format, destDir) {
  const names = [];
  walk(file, format, (name) => {
    const key = norm(name);
    const dst = path.resolve(destDir, key);
    if (!dst.startsWith(path.resolve(destDir) + path.sep)) return null; // no escaping the folder
    names.push(key);
    return fileSink(dst, () => {});
  });
  return names;
}

function listEntries(file, format) {
  const names = [];
  walk(file, format, (name) => { names.push(norm(name)); return null; });
  return names;
}

// onEntry(name, size) -> sink | null for every file in the archive
function walk(file, format, onEntry) {
  const fd = fs.openSync(file, 'r');
  try {
    if (format === '7z') extract7z(fd, onEntry);
    else if (format === 'tar.7z') {
      // a tar inside a 7z (linuxaudio.org sample libraries; the tar is often stored without a name): stream it into the reader
      const tar = new TarReader(onEntry);
      extract7z(fd, (name) => (!name || /\.tar$/i.test(name) ? { write: (c) => { if (!tar.done) tar.write(c); }, end() {} } : null));
    } else if (format === 'zip') {
      const size = fs.fstatSync(fd).size;
      const readRange = (a, b) => { const buf = Buffer.alloc(Math.min(b, size) - a); fs.readSync(fd, buf, 0, buf.length, a); return buf; };
      const entries = listZipSync(readRange, size);
      for (const e of entries) {
        const sink = onEntry(e.name);
        if (!sink) continue;
        const local = readRange(e.off, Math.min(e.off + LOCAL_SLACK, size));
        const start = dataStart(local, e);
        sink.write(inflateEntry(e, readRange(start, start + e.csize)));
        sink.end();
      }
    } else if (format.startsWith('tar')) {
      const tar = new TarReader(onEntry);
      const src = new ByteSource(fd);
      const feed = (c) => { if (!tar.done) tar.write(c); };
      if (format === 'tar.xz') decodeXz(src, feed);
      else if (format === 'tar.bz2') decodeBzip2(src, feed);
      else if (format === 'tar.gz') {
        const data = fs.readFileSync(file);
        feed(zlib.gunzipSync(data));
      } else if (format === 'tar') src.pipe(fs.fstatSync(fd).size, feed);
      else throw new Error(`unknown archive format ${format}`);
    } else throw new Error(`unknown archive format ${format}`);
  } finally {
    fs.closeSync(fd);
  }
}

module.exports = { extractFiles, extractAll, listEntries };
