// Runs tools/e2e/compat-e2e.js headless on a throw-away userData:
//   node tools/e2e/compat-run.mjs [--private] [--only <substring>]
// The committed fixtures (tools/e2e/fixtures/*.mfproj) go to <userData>/user/compat/ (the page reads
// them as melofi://app/user/compat/...), their audio (fixtures/media) to <userData>/studio-media/.
// --private adds your own autosaves: copies of %APPDATA%/MeloFi/studio-versions kept in
// tools/e2e/fixtures/private/ (git-ignored; made here if missing). The originals and the app's
// audio store are only read, never written. Their audio and any instrument you downloaded are copied
// into the temporary userData.
// Writes the report lines to stdout and the numbers to <tmp>/compat-result.json.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FIX = path.join(ROOT, 'tools/e2e/fixtures');
const PRIV = path.join(FIX, 'private');
const args = process.argv.slice(2);
const withPrivate = args.includes('--private');
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const APPDATA = path.join(process.env.APPDATA || path.join(os.homedir(), '.config'), 'MeloFi');
const UD = path.join(os.tmpdir(), 'melofi-compat-e2e');

fs.rmSync(UD, { recursive: true, force: true });
const dirs = { compat: path.join(UD, 'user/compat'), media: path.join(UD, 'studio-media'), inst: path.join(UD, 'instruments'), shots: path.join(UD, 'shots') };
for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });

const list = [];
for (const f of fs.readdirSync(FIX).filter((f) => f.endsWith('.mfproj')).sort()) { fs.copyFileSync(path.join(FIX, f), path.join(dirs.compat, f)); list.push(f); }
for (const f of fs.readdirSync(path.join(FIX, 'media'))) fs.copyFileSync(path.join(FIX, 'media', f), path.join(dirs.media, f));

if (withPrivate) {
  if (!fs.existsSync(PRIV) || !fs.readdirSync(PRIV).length) {
    fs.mkdirSync(PRIV, { recursive: true });
    for (const src of [path.join(APPDATA, 'studio-autosave.mfproj'), ...(fs.existsSync(path.join(APPDATA, 'studio-versions')) ? fs.readdirSync(path.join(APPDATA, 'studio-versions')).map((f) => path.join(APPDATA, 'studio-versions', f)) : [])]) {
      if (src.endsWith('.mfproj') && fs.existsSync(src)) fs.copyFileSync(src, path.join(PRIV, path.basename(src)));
    }
  }
  const store = path.join(APPDATA, 'studio-media');
  const stored = fs.existsSync(store) ? fs.readdirSync(store) : [];
  const insts = new Set();
  for (const f of fs.readdirSync(PRIV).filter((f) => f.endsWith('.mfproj')).sort()) {
    const name = `private-${f.replace(/\s+/g, '_')}`;
    fs.copyFileSync(path.join(PRIV, f), path.join(dirs.compat, name));
    list.push(name);
    const p = JSON.parse(fs.readFileSync(path.join(PRIV, f), 'utf8'));
    for (const h of Object.keys(p.media || {})) { const m = stored.find((n) => n.startsWith(h + '.')); if (m) fs.copyFileSync(path.join(store, m), path.join(dirs.media, m)); }
    for (const c of p.channels || []) if (c.inst) insts.add(c.inst);
  }
  // instruments the user downloaded (not shipped with the app checkout)
  for (const id of insts) {
    const src = path.join(APPDATA, 'instruments', id);
    if (fs.existsSync(src) && !fs.existsSync(path.join(ROOT, 'instruments', id, 's'))) fs.cpSync(src, path.join(dirs.inst, id), { recursive: true });
  }
}
const chosen = only ? list.filter((f) => f.includes(only)) : list;
// one app run for the generated fixtures, one for the upgrade checks, one per private project
const gen = chosen.filter((f) => !f.startsWith('private-'));
const batches = [{ files: gen, upgrade: false }, { files: gen, upgrade: true, fixtures: false }, ...chosen.filter((f) => f.startsWith('private-')).map((f) => ({ files: [f], upgrade: false }))].filter((b) => b.files.length);
console.log(`fixtures: ${chosen.length} in ${batches.length} run(s) (userData ${UD})`);

const electron = path.join(ROOT, 'node_modules/.bin', process.platform === 'win32' ? 'electron.cmd' : 'electron');
const env = { ...process.env, MELOFI_SHOT: dirs.shots, MELOFI_SCRIPT: path.join(ROOT, 'tools/e2e/compat-e2e.js'), MELOFI_USERDATA: UD };
function run(batch) {
  fs.writeFileSync(path.join(dirs.compat, 'index.json'), JSON.stringify(batch));
  return new Promise((resolve) => {
    const child = spawn(electron, ['.'], { cwd: ROOT, env, shell: process.platform === 'win32' });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const timer = setTimeout(() => { out += '\ntimed out'; child.kill(); }, 20 * 60 * 1000);
    child.on('exit', () => {
      clearTimeout(timer);
      const rep = out.match(/E2E-BEGIN\n([\s\S]*?)\nE2E-END/);
      const js = out.match(/COMPAT-JSON (.*)/);
      const lines = rep ? rep[1].replace(/\r/g, '').split('\n') : [`FAIL ${batch.files.join(', ')} :: no report (app exited) ${out.slice(-600).replace(/\s+/g, ' ')}`];
      resolve({ lines, json: js ? JSON.parse(js[1].trim()) : {} });
    });
  });
}
const lines = [], numbers = {};
for (const b of batches) {
  const r = await run(b);
  for (const l of r.lines) { console.log(l); lines.push(l); }
  Object.assign(numbers, r.json);
}
fs.writeFileSync(path.join(UD, 'compat-result.json'), JSON.stringify(numbers, null, 1));
const fails = lines.filter((l) => l.startsWith('FAIL')).length;
console.log(`\n${fails ? `${fails} FAILED` : 'all passed'}; numbers: ${path.join(UD, 'compat-result.json')}`);
process.exit(fails ? 1 : 0);
