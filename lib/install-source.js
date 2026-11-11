'use strict';
// Installs an instrument whose samples are not loose files on GitHub, straight from the original
// publisher (nothing is re-hosted):
//
//   source.kind === 'archive'  a zip / 7z / tar.xz / tar.bz2 / tar.gz. Zip entries are fetched one by
//                              one with HTTP Range requests when the host allows it; otherwise the
//                              whole archive is downloaded (resumable), checked against its SHA-256,
//                              unpacked in a worker thread (only the files the instrument uses) and
//                              deleted.
//   source.kind === 'sf2'      a SoundFont: only the byte ranges holding one preset's samples are
//                              fetched (Range), each checked against its SHA-256, and turned into WAV
//                              files by lib/sf2.js — or, if the host ignores Range, the whole file is
//                              downloaded, used and deleted.
//
// Every produced sample is checked against the SHA-256 recorded when the manifest was built, so the
// app plays exactly what was auditioned at build time. Files are written as <name>.part and renamed.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { Worker } = require('node:worker_threads');
const sf2 = require('./sf2');
const { interleaveWavs, playable } = require('./wav');

// identity: byte ranges and checksums refer to the file itself, never to a compressed transfer
const UA = { 'User-Agent': 'MeloFi', 'Accept-Encoding': 'identity' };
class NoRange extends Error {}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
async function sha256File(file) {
  const h = crypto.createHash('sha256');
  for await (const c of fs.createReadStream(file)) h.update(c);
  return h.digest('hex');
}

async function retry(signal, fn) {
  for (let attempt = 0; ; attempt++) {
    try { return await fn(); } catch (err) {
      if (signal.aborted || err instanceof NoRange || attempt >= 3) throw err;
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
  }
}

// [a, b) of url; throws NoRange when the host answers with the whole file instead
async function fetchRange(url, a, b, signal, onBytes) {
  if (process.env.MELOFI_TEST_NO_RANGE) throw new NoRange('range requests disabled for a test run');
  return retry(signal, async () => {
    const r = await fetch(url, { signal, headers: { ...UA, Range: `bytes=${a}-${b - 1}` } });
    if (r.status === 200) { try { await r.body?.cancel(); } catch { /* ignore */ } throw new NoRange('range requests not supported'); }
    if (r.status !== 206) throw new Error(`HTTP ${r.status}`);
    const parts = [];
    let got = 0;
    try {
      for await (const c of r.body) { parts.push(c); got += c.length; onBytes(c.length); }
      if (got !== b - a) throw new Error('short read');
    } catch (err) { onBytes(-got); throw err; }
    return Buffer.concat(parts);
  });
}

// [a, b) of a source that may be split into parts (GitHub release assets like Audio.zip.001, .002, …):
// the parts are one file cut in pieces, so a span can cross from one part into the next.
async function readSpan(src, a, b, signal, onBytes) {
  if (!src.parts) return fetchRange(src.url, a, b, signal, onBytes);
  const out = [];
  let base = 0;
  for (const part of src.parts) {
    const lo = Math.max(a, base), hi = Math.min(b, base + part.size);
    if (lo < hi) out.push(await fetchRange(part.url, lo - base, hi - base, signal, onBytes));
    base += part.size;
  }
  return Buffer.concat(out);
}

// Whole file to dst, resuming a previous .part; verified against sha (when one is known — release assets
// may have none; every sample made from them is still checked).
async function fetchFile(url, dst, { size, sha, signal, onBytes }) {
  const part = dst + '.part';
  await fsp.mkdir(path.dirname(dst), { recursive: true });
  if (fs.existsSync(dst) && (sha ? (await sha256File(dst)) === sha : fs.statSync(dst).size === size)) { onBytes(size); return; }
  // a bad checksum (a corrupted transfer or a resumed .part that no longer fits) gets one fresh download
  for (let pass = 0; ; pass++) {
    let counted = 0;
    await retry(signal, async () => {
      const before = counted;
      const count = (n) => { counted += n; onBytes(n); };
      try { await attempt(count); } catch (err) { onBytes(before - counted); counted = before; throw err; }
    });
    if (!sha || (await sha256File(part)) === sha) break;
    await fsp.rm(part, { force: true });
    onBytes(-counted);
    if (pass >= 1 || signal.aborted) throw new Error('downloaded file does not match its checksum');
  }
  await fsp.rename(part, dst);
  return;
  async function attempt(onBytes) {
    let have = 0;
    try { have = (await fsp.stat(part)).size; } catch { /* fresh */ }
    if (have > size) { await fsp.rm(part, { force: true }); have = 0; }
    if (have === size) { onBytes(have); return; } // complete already (interrupted before the check)
    const headers = { ...UA, ...(have ? { Range: `bytes=${have}-` } : {}) };
    const r = await fetch(url, { signal, headers });
    if (r.status === 200 && have) have = 0; // server restarted from the beginning
    else if (!r.ok) throw new Error(`HTTP ${r.status}`);
    onBytes(have);
    const out = fs.createWriteStream(part, { flags: have ? 'a' : 'w' });
    try {
      for await (const c of r.body) {
        if (!out.write(c)) await new Promise((res) => out.once('drain', res));
        onBytes(c.length);
      }
    } finally { await new Promise((res) => out.end(res)); }
    const got = (await fsp.stat(part)).size;
    if (got !== size) throw new Error(`incomplete download (${got} of ${size} bytes)`);
  }
}

async function writeChecked(dst, data, sha) {
  if (sha && sha256(data) !== sha) throw new Error(`${path.basename(dst)}: checksum mismatch`);
  await fsp.mkdir(path.dirname(dst), { recursive: true });
  await fsp.writeFile(dst + '.part', data);
  await fsp.rename(dst + '.part', dst);
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await fn(items[i++]); }));
}

// Unpack in a worker thread so the window stays responsive. libDir: where this file lives,
// unpacked from the asar (worker scripts can't run from inside it).
function unpackInWorker(archive, format, want, signal) {
  const script = path.join(__dirname.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1'), 'unpack', 'worker.js');
  return new Promise((resolve, reject) => {
    const w = new Worker(script, { workerData: { archive, format, want: [...want] } });
    const stop = () => w.terminate();
    signal.addEventListener('abort', stop, { once: true });
    w.on('message', (m) => { if (m.done) resolve(m.missing); else if (m.error) reject(new Error(m.error)); });
    w.on('error', reject);
    w.on('exit', (code) => { signal.removeEventListener('abort', stop); if (signal.aborted) reject(new Error('cancelled')); else if (code) reject(new Error(`unpack worker exited with ${code}`)); });
  });
}

// ---------------- archive ----------------

async function installArchive(src, dir, ctx) {
  const need = Object.entries(src.files).filter(([name]) => !fs.existsSync(path.join(dir, name)));
  if (!need.length) return;
  // zip with entry offsets: fetch only the entries we need
  if (src.format === 'zip' && src.zip) {
    try {
      ctx.total(src.bytes);
      const getEntry = async (entry) => {
        const [off, csize, size, method, crc] = src.zip[entry];
        const raw = await readSpan(src, off, off + csize, ctx.signal, ctx.onBytes);
        const data = method === 0 ? raw : zlib.inflateRawSync(raw);
        if (data.length !== size || (zlib.crc32 && zlib.crc32(data) >>> 0 !== crc)) throw new Error(`${entry}: corrupted`);
        return data;
      };
      await pool(need, 4, async ([name, entry]) => {
        const data = typeof entry === 'string' ? playable(await getEntry(entry))
          : interleaveWavs(await getEntry(entry.stereo[0]), await getEntry(entry.stereo[1]), entry.frames);
        await writeChecked(path.join(dir, name), data, src.sha?.[name]);
      });
      return;
    } catch (err) {
      if (!(err instanceof NoRange)) throw err;
    }
  }
  // whole archive
  ctx.total(src.size, 0.08);
  const tmp = path.join(ctx.tmpDir, `${ctx.id}.${src.format}`);
  if (src.parts) {
    // a split archive: fetch every part, then join them into the one file they were cut from
    if (!fs.existsSync(tmp)) {
      for (const [i, part] of src.parts.entries()) await fetchFile(part.url, `${tmp}.${i}`, { size: part.size, sha: part.sha256 || null, signal: ctx.signal, onBytes: ctx.onBytes });
      const out = fs.createWriteStream(tmp + '.join');
      for (const i of src.parts.keys()) for await (const c of fs.createReadStream(`${tmp}.${i}`)) if (!out.write(c)) await new Promise((r) => out.once('drain', r));
      await new Promise((r) => out.end(r));
      await fsp.rename(tmp + '.join', tmp);
      for (const i of src.parts.keys()) await fsp.rm(`${tmp}.${i}`, { force: true });
    } else ctx.onBytes(src.size);
  } else await fetchFile(src.url, tmp, { size: src.size, sha: src.sha256, signal: ctx.signal, onBytes: ctx.onBytes });
  ctx.phase('extract');
  const stage = path.join(dir, '.unpack');
  // stereo pairs: both mono files come out as <name>.0 / <name>.1 and are joined afterwards
  const want = new Map();
  for (const [name, entry] of need) {
    if (typeof entry === 'string') want.set(entry, path.join(stage, name));
    else entry.stereo.forEach((e, i) => want.set(e, path.join(stage, `${name}.${i}`)));
  }
  try {
    const missing = await unpackInWorker(tmp, src.format, want, ctx.signal);
    if (missing.length) throw new Error(`not in the archive: ${missing.slice(0, 3).join(', ')}`);
    for (const [name, entry] of need) {
      const f = path.join(stage, name);
      if (typeof entry !== 'string') {
        await fsp.writeFile(f, interleaveWavs(await fsp.readFile(f + '.0'), await fsp.readFile(f + '.1'), entry.frames));
      } else {
        const data = await fsp.readFile(f);
        const play = playable(data);
        if (play !== data) await fsp.writeFile(f, play); // AIFF -> WAV
      }
      if (src.sha?.[name] && (await sha256File(f)) !== src.sha[name]) throw new Error(`${name}: checksum mismatch`);
      await fsp.mkdir(path.dirname(path.join(dir, name)), { recursive: true });
      await fsp.rename(f, path.join(dir, name));
    }
  } finally {
    await fsp.rm(stage, { recursive: true, force: true });
  }
  await fsp.rm(tmp, { force: true }); // the archive is not kept
}

// ---------------- sf2 ----------------

async function installSf2(src, dir, ctx) {
  const need = Object.entries(src.files).filter(([name]) => !fs.existsSync(path.join(dir, name)));
  if (!need.length) return;
  let read = null, cleanup = async () => {};
  try {
    ctx.total(src.bytes);
    const got = [];
    await pool(src.ranges, 4, async ([a, b, sha]) => {
      const buf = await fetchRange(src.url, a, b, ctx.signal, ctx.onBytes);
      if (sha256(buf) !== sha) throw new Error('sample data does not match its checksum');
      got.push([a, b, buf]);
    });
    read = (off, len) => {
      const r = got.find(([a, b]) => off >= a && off + len <= b);
      if (!r) throw new Error('sf2: range not fetched');
      return r[2].subarray(off - r[0], off - r[0] + len);
    };
  } catch (err) {
    if (!(err instanceof NoRange)) throw err;
    ctx.total(src.size);
    const tmp = path.join(ctx.tmpDir, `${ctx.id}.sf2`);
    await fetchFile(src.url, tmp, { size: src.size, sha: src.sha256, signal: ctx.signal, onBytes: ctx.onBytes });
    const fd = fs.openSync(tmp, 'r');
    read = (off, len) => { const b = Buffer.alloc(len); fs.readSync(fd, b, 0, len, off); return b; };
    cleanup = async () => { fs.closeSync(fd); await fsp.rm(tmp, { force: true }); };
  }
  ctx.phase('extract');
  try {
    for (const [name, spec] of need) {
      const { wav } = sf2.renderFile(spec, src.smpl, src.sm24, read);
      await writeChecked(path.join(dir, name), wav, spec.sha256);
    }
  } finally { await cleanup(); }
}

// ctx: { id, signal, tmpDir, progress(done, total) }
async function installSource(src, dir, { id, signal, tmpDir, progress }) {
  let done = 0, total = 1, extra = 0;
  const ctx = {
    id, signal, tmpDir,
    total: (t, extraShare = 0.02) => { total = t; done = 0; extra = Math.round(t * extraShare); progress(0, total + extra); },
    onBytes: (n) => { done += n; progress(done, total + extra); },
    phase: () => progress(total, total + extra),
  };
  await fsp.mkdir(path.join(dir, 's'), { recursive: true });
  await fsp.mkdir(tmpDir, { recursive: true });
  if (src.kind === 'archive') await installArchive(src, dir, ctx);
  else if (src.kind === 'sf2') await installSf2(src, dir, ctx);
  else throw new Error(`unknown source kind ${src.kind}`);
  progress(total + extra, total + extra);
}

module.exports = { installSource, fetchRange, fetchFile, sha256, sha256File, NoRange };
