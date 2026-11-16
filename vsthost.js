'use strict';
// VST3 plugins (main process): runs "MeloFi VST Host", a small JUCE helper, and talks to it over
// stdin / stdout (one JSON object per line). Plugins live in the helper, so a crashing plugin takes
// down only the helper: MeloFi restarts it and puts the plugins back.
//
// Live sound: the helper does not play to a sound card. It connects back to a socket here
// (127.0.0.1, a random port) and renders on request, frame-stamped with the studio's AudioContext
// clock. Each VST channel or insert has an AudioWorklet in the studio (renderer/studio/vst-worklet.js)
// with a MessagePort to this process; requests and audio go worklet <-> here <-> socket <-> helper,
// so the sound comes back into the mixer (faders, inserts, sends, master, the virtual mic).
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const net = require('node:net');
const { spawn } = require('node:child_process');
const readline = require('node:readline');
const { MessageChannelMain } = require('electron');

const EXE = 'MeloFi VST Host.exe';
const T_RENDER = 1, T_AUDIO = 2, T_PROCESS = 3, T_EVENTS = 4;

function register(ipcMain, { app }) {
  const CACHE = () => path.join(app.getPath('userData'), 'vst-plugins.json');
  const exePath = () => {
    const cands = [
      process.env.MELOFI_VSTHOST || '',
      path.join(process.resourcesPath || '', 'vsthost', EXE),
      path.join(__dirname, 'native', 'build', 'MeloFiVstHost_artefacts', 'Release', EXE),
    ];
    return cands.find((p) => p && fs.existsSync(p)) || null;
  };

  let proc = null, ready = null, nextId = 1, device = null, quitting = false, restarting = null;
  const waiting = new Map();
  const loaded = new Map(); // slot -> { plugin, file, state, rate, effect } so a restarted helper can reload
  const chains = new Map(); // instrument slot -> effect slots the helper runs right after it
  const listeners = new Set(); // webContents that use VST sound (told when the helper restarts)

  // ---------- the audio socket ----------
  let sock = null, sockReady = null, sockResolve = null;
  const streams = new Map(); // slot -> MessagePortMain
  const server = net.createServer((s) => {
    if (sock) sock.destroy();
    sock = s;
    s.setNoDelay(true);
    let buf = Buffer.alloc(0);
    s.on('data', (chunk) => {
      buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
      let at = 0;
      while (buf.length - at >= 4) {
        const len = buf.readUInt32LE(at);
        if (buf.length - at - 4 < len) break;
        const fr = buf.subarray(at + 4, at + 4 + len);
        at += 4 + len;
        if (fr[0] !== T_AUDIO) continue;
        const sl = fr[1], slot = fr.toString('utf8', 2, 2 + sl), body = fr.subarray(2 + sl);
        const port = streams.get(slot);
        if (!port) continue;
        const f = body.readDoubleLE(0), n = body.readUInt32LE(8), ok = body[12] === 0;
        let d = null;
        if (ok) {
          const ab = new ArrayBuffer(n * 8);
          new Uint8Array(ab).set(body.subarray(13, 13 + n * 8));
          d = new Float32Array(ab);
        }
        port.postMessage({ f, n, ok, d });
      }
      buf = at >= buf.length ? Buffer.alloc(0) : buf.subarray(at);
    });
    const gone = () => { if (sock === s) { sock = null; sockReady = null; } };
    s.on('close', gone);
    s.on('error', gone);
    sockResolve?.();
  });
  server.on('error', (err) => console.warn('vst: audio socket', err.message));
  const listening = new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  server.unref();

  function frame(type, slot, payload) {
    const key = Buffer.from(slot, 'utf8');
    const head = Buffer.alloc(6);
    head.writeUInt32LE(2 + key.length + payload.length, 0);
    head[4] = type; head[5] = key.length;
    return Buffer.concat([head, key, payload]);
  }
  const write = (b) => { if (sock && !sock.destroyed) sock.write(b); return !!sock; };

  // a worklet's request: { f, n } (an instrument's next frames) or { f, n, d } (audio for an effect)
  function relay(slot, port, m) {
    if (!m || typeof m.f !== 'number') return;
    const n = m.n | 0;
    let p;
    if (m.d) {
      const d = m.d instanceof Float32Array ? m.d : new Float32Array(m.d);
      p = Buffer.alloc(12 + n * 8);
      p.writeDoubleLE(m.f, 0); p.writeUInt32LE(n, 8);
      Buffer.from(d.buffer, d.byteOffset, Math.min(d.byteLength, n * 8)).copy(p, 12);
    } else {
      p = Buffer.alloc(12);
      p.writeDoubleLE(m.f, 0); p.writeUInt32LE(n, 8);
    }
    // no helper right now (starting, or restarting after a crash): say so at once, the worklet
    // plays silence (an instrument) or the dry sound (an effect) instead of waiting
    if (!write(frame(m.d ? T_PROCESS : T_RENDER, slot, p))) port.postMessage({ f: m.f, n, ok: false, d: null });
  }

  // ---------- the helper process ----------
  async function start() {
    const exe = exePath();
    if (!exe) throw new Error('no_host');
    await listening;
    sockReady = new Promise((resolve) => { sockResolve = resolve; });
    proc = spawn(exe, [`--stream=${server.address().port}`], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: false });
    const me = proc;
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
    proc.on('exit', (code) => {
      if (proc !== me) return;
      proc = null; ready = null; device = null;
      for (const w of waiting.values()) w({ ok: false, error: 'host_exited' });
      waiting.clear();
      if (sock) sock.destroy();
      // a plugin crashed the helper: start it again and put the plugins back, so live sound returns
      if (!quitting && loaded.size) {
        console.warn('vst: helper exited', code, '- restarting');
        tellAll({ state: 'crashed' });
        setTimeout(() => { ensure().then(() => tellAll({ state: 'restarted' }), (err) => tellAll({ state: 'failed', message: err.message })); }, 300);
      }
    });
    await ready;
    // the socket follows right after the ready line; plugins work without it (offline renders)
    await Promise.race([sockReady, new Promise((r) => setTimeout(r, 3000))]);
  }

  function tellAll(msg) {
    for (const wc of listeners) { if (wc.isDestroyed()) listeners.delete(wc); else wc.send('vst:host', msg); }
  }

  async function ensure() {
    if (proc && ready) return ready;
    if (restarting) return restarting;
    restarting = (async () => {
      await start();
      device = await call('device');
      // a restarted helper: put the plugins back
      for (const [slot, l] of loaded) {
        const r = await call('load', { slot, plugin: l.plugin, file: l.file, rate: l.rate, effect: l.effect });
        if (r.ok && l.state) await call('setState', { slot, state: l.state });
      }
      for (const [slot, chain] of chains) if (loaded.has(slot)) await call('chain', { slot, chain });
    })();
    try { await restarting; } finally { restarting = null; }
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
  const guard = (fn) => async (e, ...args) => {
    if (e?.sender) listeners.add(e.sender);
    try { await ensure(); return await fn(...args); } catch (err) { return { ok: false, error: err.message === 'no_host' ? 'no_host' : 'host_failed', message: err.message }; }
  };

  ipcMain.handle('vst:status', async () => {
    let cache = null;
    try { cache = JSON.parse(await fsp.readFile(CACHE(), 'utf8')); } catch { /* never scanned */ }
    return { available: !!exePath(), running: !!proc, stream: !!sock, device, plugins: cache?.plugins || [], folders: cache?.folders || [], scannedAt: cache?.at || null };
  });

  ipcMain.handle('vst:scan', guard(async (folders = []) => {
    const r = await call('scan', { paths: folders }, 600000);
    if (r.ok) await fsp.writeFile(CACHE(), JSON.stringify({ at: Date.now(), folders, plugins: r.plugins }));
    return r;
  }));

  // slot: a channel id (instrument) or "fx:<strip>:<insert>" (effect); rate: the AudioContext's
  ipcMain.handle('vst:load', guard(async ({ slot, plugin, file, state, rate = 48000, effect = false }) => {
    const cur = loaded.get(slot);
    if (cur && cur.plugin === plugin && cur.effect === effect) {
      if (cur.rate !== rate) { cur.rate = rate; await call('config', { slot, rate }); }
      return { ok: true, already: true, latency: cur.latency || 0 };
    }
    const r = await call('load', { slot, plugin, file, rate, effect });
    if (!r.ok) return r;
    if (state) { const s = await call('setState', { slot, state }); if (s.ok) r.latency = s.latency; }
    loaded.set(slot, { plugin, file, state: state || null, rate, effect, latency: r.latency || 0 });
    if (chains.has(slot)) await call('chain', { slot, chain: chains.get(slot) });
    return r;
  }));
  ipcMain.handle('vst:unload', guard(async (slot) => { loaded.delete(slot); chains.delete(slot); return call('unload', { slot }); }));
  // the instrument may still be loading: the chain is kept and sent again once it is
  ipcMain.handle('vst:chain', guard(async (slot, chain = []) => {
    chains.set(slot, chain);
    return loaded.has(slot) ? call('chain', { slot, chain }) : { ok: true, later: true };
  }));
  ipcMain.handle('vst:editor', guard((slot) => call('editor', { slot })));
  ipcMain.handle('vst:params', guard((slot) => call('params', { slot })));
  ipcMain.handle('vst:getState', guard(async (slot) => {
    const r = await call('getState', { slot });
    if (r.ok && loaded.has(slot)) loaded.get(slot).state = r.state;
    return r;
  }));
  ipcMain.handle('vst:setState', guard(async (slot, state) => {
    const r = await call('setState', { slot, state });
    if (r.ok && loaded.has(slot)) loaded.get(slot).state = state;
    return r;
  }));

  // a stream for one slot: a MessagePort for the studio's worklet
  ipcMain.on('vst:stream', (e, { slot, nonce }) => {
    listeners.add(e.sender);
    streams.get(slot)?.close();
    const { port1, port2 } = new MessageChannelMain();
    port1.on('message', (m) => relay(slot, port1, m.data));
    port1.on('close', () => { if (streams.get(slot) === port1) streams.delete(slot); });
    port1.start();
    streams.set(slot, port1);
    e.sender.postMessage('vst:port', { slot, nonce }, [port2]);
  });
  ipcMain.on('vst:streamClose', (_e, slot) => { streams.get(slot)?.close(); streams.delete(slot); });
  // notes, parameter points and tempo for a slot, frame-stamped (see Host::events in Main.cpp)
  ipcMain.on('vst:events', (_e, slot, list) => {
    if (!Array.isArray(list) || !list.length) return;
    write(frame(T_EVENTS, slot, Buffer.from(JSON.stringify(list), 'utf8')));
  });

  // offline render -> WAV bytes
  ipcMain.handle('vst:render', guard(async ({ slot, sr, seconds, events, params, bpm, zero }) => {
    const out = path.join(os.tmpdir(), `melofi-vst-${process.pid}-${Date.now()}-${nextId}.wav`);
    const r = await call('render', { slot, sr, seconds, events, params: params || [], bpm, zero: zero || 0, out }, 600000);
    if (!r.ok) return r;
    try { return { ok: true, wav: new Uint8Array(await fsp.readFile(out)) }; } finally { await fsp.rm(out, { force: true }); }
  }));

  // tests: end the helper the hard way (a crashing plugin)
  ipcMain.handle('vst:kill', () => { if (process.env.MELOFI_SHOT && proc) { proc.kill(); return true; } return false; });

  app.on('before-quit', () => { quitting = true; if (proc) { const p = proc; tell('quit', {}); setTimeout(() => { try { p.kill(); } catch { /* gone */ } }, 1500); } server.close(); });
}

module.exports = { register };
