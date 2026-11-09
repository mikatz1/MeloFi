'use strict';
const { app, BrowserWindow, Menu, ipcMain, protocol, dialog, shell, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { spawn } = require('node:child_process');

app.setName('MeloFi');
if (process.platform === 'win32') app.setAppUserModelId('com.melofi.app'); // taskbar groups under our icon
if (process.env.MELOFI_USERDATA) app.setPath('userData', process.env.MELOFI_USERDATA);
// Keep audio + animation running when the window is in the background.
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
if (process.env.MELOFI_SHOT) {
  // headless test runs: an invisible window must still animate at full rate
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
  app.commandLine.appendSwitch('disable-background-timer-throttling');
}

// One MeloFi at a time: launching it again just brings the open window forward.
// (Headless test runs use their own userData and never show a window.)
const HEADLESS = !!process.env.MELOFI_SHOT;
if (!HEADLESS && !app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}
app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
});

const ROOT = __dirname;
const INSTRUMENTS_DIR = path.join(ROOT, 'instruments');
// instruments downloaded from inside the app (only the default one ships with it)
const USER_INST = () => path.join(app.getPath('userData'), 'instruments');
const downloads = new Map(); // id -> AbortController
const SETTINGS_FILE = () => path.join(app.getPath('userData'), 'settings.json');

protocol.registerSchemesAsPrivileged([
  { scheme: 'melofi', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 800,
    minWidth: 640,  // small enough for a 1280×720 share on a 200% display
    minHeight: 360,
    title: 'MeloFi',
    backgroundColor: '#08090d',
    show: false,
    paintWhenInitiallyHidden: true,
    skipTaskbar: HEADLESS,
    focusable: !HEADLESS,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0d0e12', symbolColor: '#8d8b85', height: 32 },
    icon: path.join(ROOT, 'renderer', 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: {
      preload: path.join(ROOT, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });
  win.loadURL('melofi://app/renderer/index.html');
  if (!HEADLESS) win.once('ready-to-show', () => win.show());
  else win.once('ready-to-show', () => { win.setOpacity(0); win.showInactive(); }); // invisible, no taskbar, no focus
  const fsChanged = () => win.webContents.send('win:fullscreen', win.isFullScreen());
  win.on('enter-full-screen', fsChanged);
  win.on('leave-full-screen', fsChanged);

  // F-keys / Ctrl combos belong to the piano, not to Chromium.
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F12' && process.env.MELOFI_DEV) { win.webContents.toggleDevTools(); e.preventDefault(); }
  });
  if (process.env.MELOFI_DEV) win.webContents.openDevTools({ mode: 'detach' });
  if (process.env.MELOFI_LOG || process.env.MELOFI_SHOT) {
    win.webContents.on('console-message', (e) => console.log(`[renderer:${e.level}] ${e.message}`));
  }
  if (process.env.MELOFI_SHOT) runShotScript(win);
}

// Dev aid: MELOFI_SHOT=<dir> [MELOFI_SCRIPT=<file.js>] plays a scripted take and saves screenshots.
function runShotScript(w) {
  const dir = process.env.MELOFI_SHOT;
  fs.mkdirSync(dir, { recursive: true });
  const script = process.env.MELOFI_SCRIPT ? fs.readFileSync(process.env.MELOFI_SCRIPT, 'utf8') : 'return [1500]';
  w.webContents.once('did-finish-load', async () => {
    try {
      const shots = await w.webContents.executeJavaScript(`(async () => { ${script} })()`);
      let i = 0;
      for (const at of shots || []) {
        await new Promise((r) => setTimeout(r, at));
        const img = await w.webContents.capturePage();
        fs.writeFileSync(path.join(dir, `shot-${i++}.png`), img.toPNG());
      }
    } catch (err) { console.error('shot script failed', err); }
    app.quit();
  });
}

function findFfmpeg() {
  const candidates = [];
  const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  for (const dir of (process.env.PATH || '').split(path.delimiter)) if (dir) candidates.push(path.join(dir, exe));
  return candidates.find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } }) || null;
}

function defaultRecordDir() {
  return path.join(app.getPath('documents'), 'MeloFi');
}

// installed = every sample is on disk, either shipped with the app or downloaded into userData
function instrumentState(id, m) {
  const names = Object.keys(m.samples);
  const bundled = names.every((n) => fs.existsSync(path.join(INSTRUMENTS_DIR, id, n)));
  const installed = bundled || names.every((n) => fs.existsSync(path.join(USER_INST(), id, n)) || fs.existsSync(path.join(INSTRUMENTS_DIR, id, n)));
  return { installed, bundled };
}

// ---- recently opened scores (userData/recent.json, newest first) ----
const RECENT_FILE = () => path.join(app.getPath('userData'), 'recent.json');
async function loadRecent() { try { return JSON.parse(await fsp.readFile(RECENT_FILE(), 'utf8')); } catch { return []; } }
async function saveRecent(list) { await fsp.mkdir(path.dirname(RECENT_FILE()), { recursive: true }); await fsp.writeFile(RECENT_FILE(), JSON.stringify(list, null, 2)); }
async function forgetRecent(p) { await saveRecent((await loadRecent()).filter((x) => x.path !== p)); }
async function readScoreFile(p) {
  const data = new Uint8Array(await fsp.readFile(p));
  const list = (await loadRecent()).filter((x) => x.path.toLowerCase() !== p.toLowerCase());
  list.unshift({ path: p, name: path.basename(p) });
  await saveRecent(list.slice(0, 10));
  return { name: path.basename(p), data, path: p };
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);

  // Everything the page loads comes from melofi://app/... so workers, worklets and
  // sample fetches are all same-origin.
  const ALLOWED = ['renderer', 'instruments', path.join('node_modules', 'lamejs'), path.join('node_modules', 'mp4-muxer')].map((p) => path.join(ROOT, p) + path.sep);
  const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.ogg': 'audio/ogg', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
  protocol.handle('melofi', async (req) => {
    const url = new URL(req.url);
    if (url.host !== 'app') return new Response('not found', { status: 404 });
    const rel = decodeURIComponent(url.pathname);
    let full;
    if (rel.startsWith('/user/')) {
      // user files (background images) live in userData
      const base = path.join(app.getPath('userData'), 'user') + path.sep;
      full = path.normalize(path.join(base, rel.slice(6)));
      if (!full.startsWith(base)) return new Response('forbidden', { status: 403 });
    } else if (rel.startsWith('/instruments/') && rel.includes('/s/')) {
      // samples: a downloaded copy in userData first, else the one shipped with the app
      const base = USER_INST() + path.sep;
      const user = path.normalize(path.join(base, rel.slice('/instruments/'.length)));
      if (!user.startsWith(base)) return new Response('forbidden', { status: 403 });
      full = fs.existsSync(user) ? user : path.normalize(path.join(ROOT, rel));
      if (full !== user && !full.startsWith(path.join(ROOT, 'instruments') + path.sep)) return new Response('forbidden', { status: 403 });
    } else {
      full = path.normalize(path.join(ROOT, rel));
      if (!ALLOWED.some((a) => full.startsWith(a))) return new Response('forbidden', { status: 403 });
    }
    try {
      const data = await fsp.readFile(full);
      return new Response(data, { headers: { 'content-type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream' } });
    } catch {
      return new Response('not found', { status: 404 });
    }
  });

  ipcMain.handle('instruments:list', async () => {
    const out = [];
    let entries = [];
    try { entries = await fsp.readdir(INSTRUMENTS_DIR, { withFileTypes: true }); } catch { return out; }
    for (const ent of entries) {
      if (!ent.isDirectory() || ent.name.startsWith('_')) continue;
      try {
        const m = JSON.parse(await fsp.readFile(path.join(INSTRUMENTS_DIR, ent.name, 'manifest.json'), 'utf8'));
        const st = instrumentState(ent.name, m);
        out.push({ id: ent.name, name: m.name, maker: m.maker, model: m.model, license: m.license, credit: m.credit, url: m.url, order: m.order ?? 99, regionCount: m.regions.length,
          family: m.family || 'piano', installed: st.installed, bundled: st.bundled, size: m.source?.bytes || 0, downloadable: !!m.source, downloading: downloads.has(ent.name) });
      } catch { /* not built yet */ }
    }
    return out.sort((a, b) => a.order - b.order);
  });

  // Download an instrument's samples straight from its original GitHub repository.
  // Each file is written as <name>.part and renamed when complete, so a cancelled or broken
  // download resumes where it stopped and never leaves a half-written sample behind.
  ipcMain.handle('instruments:download', async (e, id) => {
    if (downloads.has(id)) return { ok: false, busy: true };
    const m = JSON.parse(await fsp.readFile(path.join(INSTRUMENTS_DIR, path.basename(id), 'manifest.json'), 'utf8'));
    const src = m.source;
    if (!src) return { ok: false };
    const dir = path.join(USER_INST(), path.basename(id));
    await fsp.mkdir(path.join(dir, 's'), { recursive: true });
    const ac = new AbortController();
    downloads.set(id, ac);
    const jobs = Object.entries(src.files);
    const total = src.bytes;
    let done = 0, last = 0;
    const send = (force) => {
      const now = Date.now();
      if (!force && now - last < 120) return;
      last = now;
      if (!e.sender.isDestroyed()) e.sender.send('instruments:progress', { id, done, total });
    };
    const url = (f) => `https://raw.githubusercontent.com/${src.repo}/${src.branch}/${f.split('/').map(encodeURIComponent).join('/')}`;
    const one = async ([name, file]) => {
      const dst = path.join(dir, name);
      if (fs.existsSync(dst)) { done += (await fsp.stat(dst)).size; send(); return; }
      for (let attempt = 0; ; attempt++) {
        try {
          const r = await fetch(url(file), { signal: ac.signal, headers: { 'User-Agent': 'MeloFi' } });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const chunks = [];
          let got = 0;
          for await (const c of r.body) { chunks.push(c); got += c.length; done += c.length; send(); }
          await fsp.writeFile(dst + '.part', Buffer.concat(chunks));
          await fsp.rename(dst + '.part', dst);
          return;
        } catch (err) {
          if (ac.signal.aborted || attempt >= 3) throw err;
          await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
        }
      }
    };
    try {
      let i = 0;
      await Promise.all(Array.from({ length: 6 }, async () => { while (i < jobs.length) { const j = jobs[i++]; await one(j); } }));
      send(true);
      return { ok: true };
    } catch (err) {
      return { ok: false, cancelled: ac.signal.aborted, error: String(err.message || err) };
    } finally {
      downloads.delete(id);
    }
  });
  ipcMain.handle('instruments:cancel', (_e, id) => { downloads.get(id)?.abort(); return true; });
  ipcMain.handle('instruments:remove', async (_e, id) => {
    downloads.get(id)?.abort();
    await fsp.rm(path.join(USER_INST(), path.basename(id)), { recursive: true, force: true });
    return true;
  });

  ipcMain.handle('settings:load', async () => {
    try { return JSON.parse(await fsp.readFile(SETTINGS_FILE(), 'utf8')); } catch { return null; }
  });
  ipcMain.handle('settings:save', async (_e, data) => {
    await fsp.mkdir(path.dirname(SETTINGS_FILE()), { recursive: true });
    await fsp.writeFile(SETTINGS_FILE(), JSON.stringify(data, null, 2));
    return true;
  });

  ipcMain.handle('env:info', () => ({
    recordDir: defaultRecordDir(),
    ffmpeg: !!findFfmpeg(),
    version: app.getVersion(),
    platform: process.platform,
  }));

  ipcMain.handle('dialog:pickFolder', async (_e, current) => {
    const r = await dialog.showOpenDialog(win, { defaultPath: current || defaultRecordDir(), properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });

  ipcMain.handle('app:relaunch', () => { app.relaunch(); app.exit(0); });
  ipcMain.handle('win:toggleFullscreen', () => { if (win) win.setFullScreen(!win.isFullScreen()); });
  ipcMain.handle('win:setFullscreen', (_e, on) => { if (win) win.setFullScreen(!!on); });
  // exact window size (the whole window is content: the title bar is drawn by the page)
  // Size in real screen pixels (what a screen share captures). Electron sizes windows in
  // scaled units, so divide by the display scale; if it doesn't fit the screen, take the
  // largest 16:9 size that does. Returns the pixel size actually set.
  ipcMain.handle('win:setSize', (_e, w, h) => {
    if (!win) return null;
    if (win.isFullScreen()) win.setFullScreen(false);
    if (win.isMaximized()) win.unmaximize();
    const d = screen.getDisplayMatching(win.getBounds());
    const sf = d.scaleFactor || 1;
    let cw = w / sf, ch = h / sf;
    const wa = d.workArea;
    const fits = cw <= wa.width && ch <= wa.height;
    if (!fits) { const k = Math.min(wa.width / cw, wa.height / ch); cw = Math.floor(cw * k); ch = Math.floor((cw * h) / w); }
    // (Windows sizes in whole scaled units, so at 125% / 150% it can land a pixel or two off;
    // a screen share rescales anyway)
    win.setContentSize(Math.round(cw), Math.round(ch));
    win.center();
    return { fits, w: Math.round(cw * sf), h: Math.round(ch * sf), scale: sf };
  });

  ipcMain.handle('score:pick', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [
      { name: 'Scores', extensions: ['mscz', 'mscx', 'mxl', 'musicxml', 'xml', 'mid', 'midi'] },
      { name: 'All files', extensions: ['*'] },
    ] });
    if (r.canceled || !r.filePaths[0]) return null;
    return readScoreFile(r.filePaths[0]);
  });
  ipcMain.handle('score:openPath', async (_e, p) => { try { return await readScoreFile(p); } catch { await forgetRecent(p); return null; } });
  ipcMain.handle('score:recent', async () => {
    const list = await loadRecent();
    return list.filter((x) => fs.existsSync(x.path));
  });
  ipcMain.handle('score:clearRecent', async () => { await saveRecent([]); return []; });

  ipcMain.handle('bg:pick', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    const src = r.filePaths[0];
    const dir = path.join(app.getPath('userData'), 'user', 'backgrounds');
    await fsp.mkdir(dir, { recursive: true });
    const name = `${Date.now()}${path.extname(src).toLowerCase()}`;
    await fsp.copyFile(src, path.join(dir, name));
    return `melofi://app/user/backgrounds/${name}`;
  });

  ipcMain.handle('shell:showItem', (_e, p) => { if (p) shell.showItemInFolder(p); });
  ipcMain.handle('shell:openFolder', async (_e, p) => {
    const dir = p || defaultRecordDir();
    await fsp.mkdir(dir, { recursive: true });
    return shell.openPath(dir);
  });

  // files: [{ ext, data: Uint8Array, sub?: true }] — written next to each other with one shared stamp.
  // Video rendering streams the MP4 straight to disk (it can be gigabytes at 4K).
  const renders = new Map(); // id -> { fh, path }
  let renderId = 0;
  ipcMain.handle('render:open', async (_e, { dir, base }) => {
    const target = dir || defaultRecordDir();
    await fsp.mkdir(target, { recursive: true });
    const safe = base ? String(base).replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) : 'MeloFi';
    const p = path.join(target, `${safe}_${stamp()}.mp4`);
    const fh = await fsp.open(p, 'w');
    const id = ++renderId;
    renders.set(id, { fh, path: p });
    return { id, path: p };
  });
  ipcMain.handle('render:write', async (_e, id, data, pos) => {
    const r = renders.get(id);
    if (r) await r.fh.write(Buffer.from(data.buffer, data.byteOffset, data.byteLength), 0, data.byteLength, pos);
  });
  ipcMain.handle('render:close', async (_e, id, keep) => {
    const r = renders.get(id);
    if (!r) return null;
    renders.delete(id);
    await r.fh.close();
    if (!keep) { await fsp.unlink(r.path).catch(() => {}); return null; }
    return r.path;
  });

  ipcMain.handle('recording:save', async (_e, { dir, files, convert, base }) => {
    const target = dir || defaultRecordDir();
    await fsp.mkdir(target, { recursive: true });
    const safe = base ? String(base).replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) : '';
    const name = safe ? `${safe}_${stamp()}` : `MeloFi_${stamp()}`;
    let folder = target;
    if (files.length > 1) { folder = path.join(target, name); await fsp.mkdir(folder, { recursive: true }); }
    const written = [];
    for (const f of files) {
      const p = path.join(folder, `${name}${f.suffix || ''}.${f.ext}`);
      await fsp.writeFile(p, Buffer.from(f.data));
      written.push(p);
    }
    // webm -> mp4 fallback when Chromium could not record mp4 directly.
    if (convert === 'webm-to-mp4') {
      const src = written[0];
      const dst = src.replace(/\.webm$/, '.mp4');
      const ff = findFfmpeg();
      if (ff) {
        const ok = await new Promise((res) => {
          const p = spawn(ff, ['-y', '-i', src, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '256k', dst], { windowsHide: true });
          p.on('close', (code) => res(code === 0));
          p.on('error', () => res(false));
        });
        if (ok) { await fsp.unlink(src).catch(() => {}); written[0] = dst; }
      }
    }
    return { folder, files: written };
  });

  createWindow();
});

app.on('window-all-closed', () => app.quit());
