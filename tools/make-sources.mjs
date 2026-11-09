// Adds a `source` block to each instruments/<id>/manifest.json so the app can download the
// instrument itself: which GitHub archive to fetch and which file in it becomes each s/NNNN.flac.
// Only the SFZ text files are fetched here (the parser never opens the audio).
//   node tools/make-sources.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIBS, respanKeys, tileVelocity } from './build-instruments.mjs';
import { readSfz } from './sfz.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'melofi-sfz-'));
const AUDIO = /\.(flac|wav|ogg|aif|aiff)$/i;

async function json(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'MeloFi-build' } });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

for (const [id, cfg] of Object.entries(LIBS)) {
  const repo = cfg.url.replace('https://github.com/', '');
  const top = cfg.sfz.split('/')[0];                 // e.g. SplendidGrandPiano-master
  const branch = top.slice(top.lastIndexOf('-') + 1); // master
  const tree = (await json(`https://api.github.com/repos/${repo}/git/trees/${branch}?recursive=1`)).tree;
  const blobs = tree.filter((t) => t.type === 'blob');
  for (const b of blobs) {
    if (AUDIO.test(b.path) || b.size > 2e6) continue;
    const r = await fetch(`https://raw.githubusercontent.com/${repo}/${branch}/${b.path.split('/').map(encodeURIComponent).join('/')}`);
    const dst = path.join(TMP, top, b.path);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, Buffer.from(await r.arrayBuffer()));
  }
  let regions = readSfz(path.join(TMP, cfg.sfz)).filter((r) => r.hi >= 0 && r.lo <= 127);
  if (cfg.filter) regions = regions.filter(cfg.filter);
  regions = tileVelocity(respanKeys(regions));
  const files = [...new Set(regions.map((r) => r.file))].sort();

  const mfPath = path.join(ROOT, 'instruments', id, 'manifest.json');
  const mf = JSON.parse(fs.readFileSync(mfPath, 'utf8'));
  if (files.length !== Object.keys(mf.samples).length) throw new Error(`${id}: ${files.length} files vs ${Object.keys(mf.samples).length} in manifest`);
  const sizes = new Map(blobs.map((b) => [b.path, b.size]));
  const map = {};
  let bytes = 0;
  files.forEach((f, n) => {
    const rel = path.relative(path.join(TMP, top), f).split(path.sep).join('/');
    if (!sizes.has(rel)) throw new Error(`${id}: ${rel} not in the repository`);
    map[`s/${String(n).padStart(4, '0')}.flac`] = rel;
    bytes += sizes.get(rel);
  });
  // same regions as the shipped manifest?
  const key = (r) => `${r.lo}-${r.hi}-${r.lv}-${r.hv}`;
  const want = new Set(mf.regions.map((r) => `${key(r)}:${r.s}`));
  const nameOf = new Map(files.map((f, n) => [f, `s/${String(n).padStart(4, '0')}.flac`]));
  const bad = regions.filter((r) => !want.has(`${key(r)}:${nameOf.get(r.file)}`)).length;
  if (bad) throw new Error(`${id}: ${bad} regions differ from the manifest`);
  mf.source = { repo, branch, archive: `https://codeload.github.com/${repo}/zip/refs/heads/${branch}`, root: top, bytes, files: map };
  fs.writeFileSync(mfPath, JSON.stringify(mf));
  console.log(`${id}: ${files.length} files, ${(bytes / 1e6).toFixed(0)} MB to download`);
}
fs.rmSync(TMP, { recursive: true, force: true });
