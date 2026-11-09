// Downloads one GitHub sample library into instruments/_dl/<Repo>-<branch>/ for building.
// Text files (SFZ, includes) always; audio only for the files a program actually uses.
//   node tools/fetch-lib.mjs <owner/repo> [program.sfz ...]
// With no program, only the text files are fetched (enough to inspect the mappings).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { readSfz } from './sfz.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DL = path.join(ROOT, 'instruments', '_dl');
const TEXT = /\.(sfz|sfzh|txt|inc|def|h)$/i; // mappings and their includes
const H = { headers: { 'User-Agent': 'MeloFi-build' } };

// File list (path + size) of the default branch. Uses a blob-less shallow git clone rather than
// the GitHub API, which only allows 60 unauthenticated requests an hour.
export async function repoTree(repo) {
  const dir = path.join(DL, '.trees', repo.replace('/', '__'));
  if (!fs.existsSync(dir)) {
    const r = spawnSync('git', ['clone', '--quiet', '--bare', '--depth', '1', '--filter=blob:none', `https://github.com/${repo}.git`, dir], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git clone ${repo}: ${r.stderr}`);
  }
  const branch = spawnSync('git', ['-C', dir, 'symbolic-ref', '--short', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  // no -l: asking for sizes would make a blob-less clone download every file
  const out = spawnSync('git', ['-C', dir, 'ls-tree', '-r', '-z', 'HEAD'], { encoding: 'utf8', maxBuffer: 1 << 28 }).stdout;
  const blobs = out.split('\0').filter(Boolean).map((line) => {
    const tab = line.indexOf('\t');
    const [, type] = line.slice(0, tab).split(/\s+/);
    return { type, path: line.slice(tab + 1) };
  }).filter((b) => b.type === 'blob');
  return { branch, top: `${repo.split('/')[1]}-${branch}`, blobs };
}

const raw = (repo, branch, p) => `https://raw.githubusercontent.com/${repo}/${branch}/${p.split('/').map(encodeURIComponent).join('/')}`;

async function get(url, dst) {
  if (fs.existsSync(dst)) return;
  for (let a = 0; ; a++) {
    try {
      const r = await fetch(url, { ...H, signal: AbortSignal.timeout(120000) });
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.writeFileSync(dst + '.part', Buffer.from(await r.arrayBuffer()));
      fs.renameSync(dst + '.part', dst);
      return;
    } catch (e) { if (a >= 3) throw e; await new Promise((r) => setTimeout(r, 1000 * (a + 1))); }
  }
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) await fn(items[i++]); }));
}

// extra: [{ name, text }] SFZ files of our own to drop into the library folder before parsing
export async function fetchLib(repo, programs = [], extra = [], sfzOpts = {}) {
  const { branch, top, blobs } = await repoTree(repo);
  if (typeof extra === 'function') extra = extra(blobs);
  extra = extra || [];
  const base = path.join(DL, top);
  await pool(blobs.filter((b) => TEXT.test(b.path)), 8, (b) => get(raw(repo, branch, b.path), path.join(base, b.path)));
  for (const x of extra) { fs.mkdirSync(path.dirname(path.join(base, x.name)), { recursive: true }); fs.writeFileSync(path.join(base, x.name), x.text); }
  const need = new Set();
  for (const p of programs) for (const r of readSfz(path.join(base, p), sfzOpts)) need.add(path.relative(base, r.file).split(path.sep).join('/'));
  const have = new Set(blobs.map((b) => b.path));
  const missing = [...need].filter((f) => !have.has(f));
  if (missing.length) console.log(`${repo}: ${missing.length} mapped files not in the repository, e.g. ${missing[0]}`);
  const list = [...need].filter((f) => have.has(f));
  let done = 0;
  await pool(list, 8, async (f) => { await get(raw(repo, branch, f), path.join(base, f)); if (++done % 100 === 0) console.log(`  ${done}/${list.length}`); });
  return { branch, top, base, count: list.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [repo, ...programs] = process.argv.slice(2);
  const r = await fetchLib(repo, programs);
  console.log(`${repo} -> ${path.relative(ROOT, r.base)} (${r.count} audio files)`);
}
