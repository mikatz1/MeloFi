'use strict';
// VST3 plugins (main process): runs "MeloFi VST Host", a small JUCE helper, and talks to it over
// stdin / stdout (one JSON object per line). Plugins live in the helper, so a crashing plugin takes
// down only the helper: MeloFi restarts it and reloads the channels on the next call.
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const { spawn } = require('node:child_process');
const readline = require('node:readline');

const EXE = 'MeloFi VST Host.exe';

function register(ipcMain, { app }) {
  const CACHE = () => path.join(app.getPath('userData'), 'vst-plugins.json');
  const exePath = () => {
    const cands = [
      path.join(process.resourcesPath || '', 'vsthost', EXE),
      path.join(__dirname, 'native', 'build', 'MeloFiVstHost_artefacts', 'Release', EXE),
    ];
    return cands.find((p) => fs.existsSync(p)) || null;
  };

  let proc = null, ready = null, nextId = 1, device = null;
  const waiting = new Map();
  const loaded = new Map(); // slot -> { plugin, state } so a restarted helper can reload

  function start() {
    const exe = exePath();
    if (!exe) return Promise.reject(new Error('no_host'));
    proc = spawn(exe, [], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: false });
    const rl = readline.createInterface({ input: proc.stdout });
    ready = new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('host_timeout')), 15000);
      rl.on('line', (line) => {
        let m; try { m = JSON.parse(line); } catch { return; }
        if (m.ready) { clearTimeout(t); resolve(); return; }
        const w = waiting.get(m.id);
        if (w) { waiting.delete(m.id); w(m); }
      });
    });
    proc.on('exit', () => {
      proc = null; ready = null; device = null;
      for (const w of waiting.values()) w({ ok: false, error: 'host_exited' });
      waiting.clear();
    });
    return ready;
  }

  async function ensure() {
    if (proc && ready) return ready;
    await start();
    device = await call('device');
    // a restarted helper: put the channels' plugins back
    for (const [slot, l] of loaded) {
      const r = await call('load', { slot, plugin: l.plugin, file: l.file });
      if (r.ok && l.state) await call('setState', { slot, state: l.state });
    }
  }

  function call(op, args = {}, timeout = 120000) {
    return new Promise((resolve) => {
      if (!proc) return resolve({ ok: false, error: 'no_host' });
      const id = nextId++;
      const t = setTimeout(() => { waiting.delete(id); resolve({ ok: false, error: 'timeout' }); }, timeout);
      waiting.set(id, (m) => { clearTimeout(t); resolve(m); });
      proc.stdin.write(JSON.stringify({ id, op, ...args }) + '\n');
    });
  }
  const tell = (op, args) => { if (proc) proc.stdin.write(JSON.stringify({ op, ...args }) + '\n'); };
  const guard = (fn) => async (_e, ...args) => {
    try { await ensure(); return await fn(...args); } catch (err) { return { ok: false, error: err.message === 'no_host' ? 'no_host' : 'host_failed', message: err.message }; }
  };

  ipcMain.handle('vst:status', async () => {
    let cache = null;
    try { cache = JSON.parse(await fsp.readFile(CACHE(), 'utf8')); } catch { /* never scanned */ }
    return { available: !!exePath(), running: !!proc, device, plugins: cache?.plugins || [], folders: cache?.folders || [], scannedAt: cache?.at || null };
  });

  ipcMain.handle('vst:scan', guard(async (folders = []) => {
    const r = await call('scan', { paths: folders }, 600000);
    if (r.ok) await fsp.writeFile(CACHE(), JSON.stringify({ at: Date.now(), folders, plugins: r.plugins }));
    return r;
  }));

  ipcMain.handle('vst:load', guard(async ({ slot, plugin, file, state }) => {
    const cur = loaded.get(slot);
    if (cur && cur.plugin === plugin) return { ok: true, already: true };
    const r = await call('load', { slot, plugin, file });
    if (!r.ok) return r;
    if (state) await call('setState', { slot, state });
    loaded.set(slot, { plugin, file, state: state || null });
    return r;
  }));
  ipcMain.handle('vst:unload', guard(async (slot) => { loaded.delete(slot); return call('unload', { slot }); }));
  ipcMain.handle('vst:editor', guard((slot) => call('editor', { slot })));
  ipcMain.handle('vst:getState', guard(async (slot) => {
    const r = await call('getState', { slot });
    if (r.ok && loaded.has(slot)) loaded.get(slot).state = r.state;
    return r;
  }));
  ipcMain.handle('vst:gain', guard((slot, gain) => call('gain', { slot, gain })));
  ipcMain.handle('vst:allOff', guard((slot) => call('allOff', { slot })));
  // live notes: no reply, no waiting
  ipcMain.on('vst:note', (_e, m) => tell('note', m));

  // offline render -> WAV bytes
  ipcMain.handle('vst:render', guard(async ({ slot, sr, seconds, events }) => {
    const out = path.join(os.tmpdir(), `melofi-vst-${process.pid}-${Date.now()}.wav`);
    const r = await call('render', { slot, sr, seconds, events, out }, 600000);
    if (!r.ok) return r;
    try { return { ok: true, wav: new Uint8Array(await fsp.readFile(out)) }; } finally { await fsp.rm(out, { force: true }); }
  }));

  app.on('before-quit', () => { if (proc) { tell('quit', {}); setTimeout(() => proc?.kill(), 1500); } });
}

module.exports = { register };
