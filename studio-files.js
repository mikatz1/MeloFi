'use strict';
// Composer files (main process): the audio store (content-addressed), the sample browser,
// project save / open with the project's audio next to it, recent projects and autosave versions.
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const crypto = require('node:crypto');
const { t } = require('./i18n-main.js');

const AUDIO = /\.(wav|mp3|ogg|flac|m4a|aac|aif|aiff|opus|webm)$/i;

function register(ipcMain, { app, dialog, getWin, defaultDir, settings }) {
  const STORE = () => path.join(app.getPath('userData'), 'studio-media');
  const RECENT = () => path.join(app.getPath('userData'), 'studio-recent.json');
  const VERSIONS = () => path.join(app.getPath('userData'), 'studio-versions');
  const AUTOSAVE = () => path.join(app.getPath('userData'), 'studio-autosave.mfproj');
  const roots = new Set(); // folders the user opened in the browser (reads stay inside them)

  const storePath = async (hash) => {
    const names = await fsp.readdir(STORE()).catch(() => []);
    const f = names.find((n) => n.startsWith(hash + '.'));
    return f ? path.join(STORE(), f) : null;
  };

  async function put(name, data) {
    const buf = Buffer.from(data);
    const hash = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 20);
    const ext = (path.extname(name || '').toLowerCase().match(/^\.[a-z0-9]{1,5}$/) || ['.wav'])[0];
    await fsp.mkdir(STORE(), { recursive: true });
    if (!(await storePath(hash))) await fsp.writeFile(path.join(STORE(), hash + ext), buf);
    return { hash };
  }

  ipcMain.handle('media:put', (_e, name, data) => put(name, data));
  ipcMain.handle('media:get', async (_e, hash) => {
    if (!/^[a-f0-9]{20}$/.test(hash)) return null;
    const p = await storePath(hash);
    return p ? new Uint8Array(await fsp.readFile(p)) : null;
  });
  ipcMain.handle('media:pickFiles', async (_e, opts = {}) => {
    const audio = ['wav', 'mp3', 'ogg', 'flac', 'm4a', 'aif', 'aiff'];
    const filters = opts.video ? [{ name: t('오디오 · 동영상'), extensions: [...audio, 'mp4', 'mov', 'webm', 'mkv', 'aac'] }] : [{ name: t('오디오'), extensions: audio }];
    const r = await dialog.showOpenDialog(getWin(), { properties: opts.video ? ['openFile'] : ['openFile', 'multiSelections'], filters });
    if (r.canceled) return [];
    return Promise.all(r.filePaths.slice(0, 32).map(async (p) => ({ name: path.basename(p), data: new Uint8Array(await fsp.readFile(p)) })));
  });

  // ---- sample browser ----
  ipcMain.handle('media:pickFolder', async () => {
    const r = await dialog.showOpenDialog(getWin(), { properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    roots.add(path.resolve(r.filePaths[0]));
    return r.filePaths[0];
  });
  ipcMain.handle('media:allowRoots', (_e, list) => { for (const p of list || []) if (typeof p === 'string' && fs.existsSync(p)) roots.add(path.resolve(p)); return true; });
  const inside = (p) => [...roots].some((r) => { const x = path.resolve(p); return x === r || x.startsWith(r + path.sep); });
  ipcMain.handle('media:list', async (_e, dir) => {
    if (!inside(dir)) return null;
    const ents = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
    return ents.filter((d) => !d.name.startsWith('.') && (d.isDirectory() || AUDIO.test(d.name)))
      .map((d) => ({ name: d.name, path: path.join(dir, d.name), dir: d.isDirectory() }))
      .sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name, 'ko'));
  });
  ipcMain.handle('media:read', async (_e, p) => {
    if (!inside(p) || !AUDIO.test(p)) return null;
    const st = await fsp.stat(p).catch(() => null);
    if (!st || st.size > 200e6) return null;
    return new Uint8Array(await fsp.readFile(p));
  });

  // ---- project files: <name>.mfproj + "<name> 오디오/" holding the audio it uses ----
  const mediaDir = (file) => file.replace(/\.mfproj$/i, '') + ' 오디오'; // i18n-ignore (a folder name projects are read back from)
  ipcMain.handle('studio:save', async (_e, json, name, p) => {
    let target = p;
    if (!target) {
      const safe = String(name || 'project').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'project';
      const r = await dialog.showSaveDialog(getWin(), { defaultPath: path.join(defaultDir(), `${safe}.mfproj`), filters: [{ name: 'MeloFi Studio', extensions: ['mfproj'] }] });
      if (r.canceled || !r.filePath) return null;
      target = r.filePath;
    }
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, json);
    const hashes = Object.keys(JSON.parse(json).media || {});
    if (hashes.length) {
      const dir = mediaDir(target);
      await fsp.mkdir(dir, { recursive: true });
      for (const h of hashes) {
        const src = await storePath(h);
        if (src) { const dst = path.join(dir, path.basename(src)); if (!fs.existsSync(dst)) await fsp.copyFile(src, dst); }
      }
    }
    await addRecent(target, name);
    return target;
  });
  async function openPath(file) {
    const text = await fsp.readFile(file, 'utf8');
    const dir = mediaDir(file);
    for (const n of await fsp.readdir(dir).catch(() => [])) {
      const h = n.split('.')[0];
      if (/^[a-f0-9]{20}$/.test(h) && !(await storePath(h))) { await fsp.mkdir(STORE(), { recursive: true }); await fsp.copyFile(path.join(dir, n), path.join(STORE(), n)); }
    }
    await addRecent(file, path.basename(file, '.mfproj'));
    return { path: file, text };
  }
  ipcMain.handle('studio:open', async () => {
    const r = await dialog.showOpenDialog(getWin(), { properties: ['openFile'], filters: [{ name: 'MeloFi Studio', extensions: ['mfproj'] }, { name: 'All files', extensions: ['*'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    return openPath(r.filePaths[0]);
  });
  ipcMain.handle('studio:openPath', async (_e, p) => { try { return await openPath(p); } catch { return null; } });

  // ---- recent projects ----
  async function loadRecent() { try { return JSON.parse(await fsp.readFile(RECENT(), 'utf8')); } catch { return []; } }
  async function addRecent(file, name) {
    const list = (await loadRecent()).filter((x) => x.path.toLowerCase() !== file.toLowerCase());
    list.unshift({ path: file, name: name || path.basename(file, '.mfproj'), at: Date.now() });
    await fsp.writeFile(RECENT(), JSON.stringify(list.slice(0, 12)));
  }
  ipcMain.handle('studio:recent', async () => (await loadRecent()).filter((x) => fs.existsSync(x.path)));

  // ---- autosave + versions (a copy every few minutes, last 20 kept) ----
  let lastVersion = 0;
  ipcMain.handle('studio:autosave', async (_e, json) => {
    await fsp.mkdir(path.dirname(AUTOSAVE()), { recursive: true });
    await fsp.writeFile(AUTOSAVE(), json);
    if (Date.now() - lastVersion > 5 * 60e3) {
      lastVersion = Date.now();
      await fsp.mkdir(VERSIONS(), { recursive: true });
      const d = new Date(), p2 = (n) => String(n).padStart(2, '0');
      await fsp.writeFile(path.join(VERSIONS(), `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}${p2(d.getMinutes())}.mfproj`), json);
      const all = (await fsp.readdir(VERSIONS())).sort();
      for (const old of all.slice(0, Math.max(0, all.length - 20))) await fsp.rm(path.join(VERSIONS(), old), { force: true });
    }
    return true;
  });
  ipcMain.handle('studio:autoload', async () => { try { return await fsp.readFile(AUTOSAVE(), 'utf8'); } catch { return null; } });
  ipcMain.handle('studio:versions', async () => (await fsp.readdir(VERSIONS()).catch(() => [])).sort().reverse().map((n) => n.replace(/\.mfproj$/, '')));
  ipcMain.handle('studio:version', async (_e, name) => {
    if (!/^[\d\- ]+$/.test(name)) return null;
    try { return await fsp.readFile(path.join(VERSIONS(), name + '.mfproj'), 'utf8'); } catch { return null; }
  });
  void settings;
}

module.exports = { register };
