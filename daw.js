'use strict';
// DAW hand-off (main process): find installed DAWs, write an export folder, open the export in a
// DAW, and start an OS drag of exported files so they can be dropped onto any DAW's timeline.
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { spawn } = require('node:child_process');

// opens: what the DAW accepts on its command line from our export
//   rpp  — the REAPER project (stems on tracks + MIDI items)
//   mid  — the MIDI file (imported as a new song / project)
//   wav  — the mix
//   none — open the folder and drag files in
const KNOWN = [
  { id: 'reaper', name: 'REAPER', opens: 'rpp', find: ['%PF%\\REAPER (x64)\\reaper.exe', '%PF%\\REAPER\\reaper.exe', '%PF86%\\REAPER\\reaper.exe'] },
  { id: 'fl', name: 'FL Studio', opens: 'mid', find: ['%PF%\\Image-Line\\FL Studio */FL64.exe', '%PF%\\Image-Line\\FL Studio */FL.exe', '%PF%\\Image-Line\\FL Studio\\FL64.exe'] },
  { id: 'ableton', name: 'Ableton Live', opens: 'none', find: ['%PD%\\Ableton\\Live */Program/Ableton Live *.exe'] },
  { id: 'cubase', name: 'Cubase', opens: 'none', find: ['%PF%\\Steinberg\\Cubase */Cubase*.exe'] },
  { id: 'studioone', name: 'Studio One', opens: 'mid', find: ['%PF%\\PreSonus\\Studio One */Studio One.exe'] },
  { id: 'bitwig', name: 'Bitwig Studio', opens: 'none', find: ['%PF%\\Bitwig Studio\\Bitwig Studio.exe', '%PF%\\Bitwig Studio\\*/Bitwig Studio.exe'] },
  { id: 'cakewalk', name: 'Cakewalk', opens: 'mid', find: ['%PF%\\Cakewalk\\Cakewalk Core\\Cakewalk.exe', '%PF%\\BandLab\\Cakewalk\\Cakewalk.exe'] },
  { id: 'lmms', name: 'LMMS', opens: 'none', find: ['%PF%\\LMMS\\lmms.exe'] },
  { id: 'musescore', name: 'MuseScore', opens: 'mid', find: ['%PF%\\MuseScore 4\\bin\\MuseScore4.exe', '%PF%\\MuseScore 3\\bin\\MuseScore3.exe'] },
  { id: 'audacity', name: 'Audacity', opens: 'wav', find: ['%PF%\\Audacity\\audacity.exe'] },
];

function expand(p) {
  return p.replace('%PF%', process.env.ProgramFiles || 'C:\\Program Files')
    .replace('%PF86%', process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)')
    .replace('%PD%', process.env.ProgramData || 'C:\\ProgramData');
}

// one "*" per path segment, matched against directory listings
function glob(pattern) {
  const parts = expand(pattern).split(/[\\/]/);
  let found = [parts[0] + path.sep];
  for (const part of parts.slice(1)) {
    const next = [];
    for (const base of found) {
      if (!part.includes('*')) { const p = path.join(base, part); if (fs.existsSync(p)) next.push(p); continue; }
      const re = new RegExp(`^${part.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`, 'i');
      let names = [];
      try { names = fs.readdirSync(base); } catch { /* not there */ }
      for (const n of names) if (re.test(n)) next.push(path.join(base, n));
    }
    found = next;
    if (!found.length) break;
  }
  return found.sort().reverse(); // newest version first
}

function detect() {
  if (process.platform !== 'win32') return [];
  const out = [];
  for (const d of KNOWN) {
    const exe = d.find.flatMap(glob).find((p) => /\.exe$/i.test(p));
    if (exe) out.push({ id: d.id, name: d.name, opens: d.opens, exe });
  }
  return out;
}

let found = null;
const safeName = (s) => String(s || 'MeloFi').replace(/[\\/:*?"<>|]+/g, '_').trim().slice(0, 60) || 'MeloFi';

function register(ipcMain, { defaultDir, iconPath, shell }) {
  const exported = new Set(); // folders this run wrote; open / drag only touch files inside them
  const inside = (p) => [...exported].some((d) => path.resolve(p).startsWith(d + path.sep));

  ipcMain.handle('daw:list', () => { found = detect(); return found.map(({ id, name, opens }) => ({ id, name, opens })); });

  // files: [{ name: 'stems/01 Kick.wav', data: Uint8Array | string }]
  ipcMain.handle('daw:write', async (_e, { base, dir, files }) => {
    const d = new Date(), p2 = (n) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}${p2(d.getMinutes())}`;
    const out = path.join(dir || defaultDir(), `${safeName(base)} (DAW ${stamp})`);
    await fsp.mkdir(out, { recursive: true });
    const written = [];
    for (const f of files) {
      const rel = path.normalize(f.name);
      if (rel.startsWith('..') || path.isAbsolute(rel)) continue;
      const full = path.join(out, rel);
      await fsp.mkdir(path.dirname(full), { recursive: true });
      await fsp.writeFile(full, typeof f.data === 'string' ? f.data : Buffer.from(f.data));
      written.push(full);
    }
    exported.add(path.resolve(out));
    return { dir: out, files: written };
  });

  ipcMain.handle('daw:open', async (_e, { id, file }) => {
    if (!found) found = detect();
    const daw = found.find((x) => x.id === id);
    if (!daw) return { ok: false, error: 'not_found' };
    if (file && !inside(file)) return { ok: false, error: 'forbidden' };
    const args = file ? [file] : [];
    try {
      const p = spawn(daw.exe, args, { detached: true, stdio: 'ignore', cwd: path.dirname(daw.exe) });
      p.on('error', () => {});
      p.unref();
      return { ok: true };
    } catch (err) { return { ok: false, error: String(err.message || err) }; }
  });

  ipcMain.handle('daw:openFolder', (_e, dir) => { if (dir && exported.has(path.resolve(dir))) shell.openPath(dir); });

  ipcMain.on('daw:drag', (e, files) => {
    const list = (Array.isArray(files) ? files : [files]).filter((f) => inside(f) && fs.existsSync(f));
    if (!list.length) return;
    e.sender.startDrag({ files: list, file: list[0], icon: iconPath });
  });
}

module.exports = { register, detect };
