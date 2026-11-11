// Checks for lib/unpack and lib/sf2 (docs/archive-import.md):
//  1. every cached archive in instruments/_dl/_archives unpacks byte-identical to the system's bsdtar
//     (Windows' tar.exe / libarchive), when that can read the format;
//  2. every built SoundFont instrument re-renders from the cached .sf2 to the exact SHA-256 its manifest pins.
//   node tools/test-archive-import.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import unpack from '../lib/unpack/index.js';
import sf2 from '../lib/sf2.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARC = path.join(ROOT, 'instruments', '_dl', '_archives');
const FORMATS = [[/\.tar\.xz$/, 'tar.xz'], [/\.tar\.bz2$/, 'tar.bz2'], [/\.tar\.gz$/, 'tar.gz'], [/\.tar\.7z$/, 'tar.7z'], [/\.7z$/, '7z'], [/\.zip$/, 'zip']];
const TAR = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) pass++; else fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${msg}`); };

function walk(dir, base = dir, out = new Map()) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f, base, out);
    else out.set(path.relative(base, f).split(path.sep).join('/'), crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'));
  }
  return out;
}

for (const name of fs.existsSync(ARC) ? fs.readdirSync(ARC) : []) {
  const fmt = FORMATS.find(([re]) => re.test(name))?.[1];
  if (!fmt || fmt === 'tar.7z' || fs.statSync(path.join(ARC, name)).size > 100e6) continue; // keep the run short
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'melofi-unpack-'));
  try {
    const mine = path.join(tmp, 'mine'), ref = path.join(tmp, 'ref');
    fs.mkdirSync(ref);
    const t = Date.now();
    unpack.extractAll(path.join(ARC, name), fmt, mine);
    const ms = Date.now() - t;
    const r = spawnSync(TAR, ['-xf', path.join(ARC, name), '-C', ref]);
    if (r.status !== 0) { console.log(`skip ${name}: system tar can't read it`); continue; }
    const a = walk(mine), b = walk(ref);
    const same = a.size === b.size && [...b].every(([k, h]) => a.get(k) === h);
    ok(same, `${name}: ${a.size} files identical to bsdtar (${ms} ms)`);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

for (const fontName of ['MuseScore_General.sf2', 'GeneralUser-GS.sf2']) {
const font = path.join(ARC, fontName);
if (!fs.existsSync(font)) continue;
{
  const fd = fs.openSync(font, 'r');
  const read = (off, len) => { const b = Buffer.alloc(len); fs.readSync(fd, b, 0, len, off); return b; };
  for (const id of fs.readdirSync(path.join(ROOT, 'instruments'))) {
    let m;
    try { m = JSON.parse(fs.readFileSync(path.join(ROOT, 'instruments', id, 'manifest.json'), 'utf8')); } catch { continue; }
    if (m.source?.kind !== 'sf2' || !m.source.url.endsWith(fontName)) continue;
    let good = 0;
    const files = Object.entries(m.source.files);
    for (const [, spec] of files) {
      const { wav } = sf2.renderFile(spec, m.source.smpl, m.source.sm24, read);
      if (crypto.createHash('sha256').update(wav).digest('hex') === spec.sha256) good++;
    }
    const ranges = m.source.ranges.every(([a, b, h]) => crypto.createHash('sha256').update(read(a, b - a)).digest('hex') === h);
    ok(good === files.length && ranges, `${id}: ${good}/${files.length} files re-render to their pinned SHA-256, ranges ${ranges ? 'match' : 'DIFFER'}`);
  }
  fs.closeSync(fd);
}
}
console.log(`${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
