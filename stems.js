'use strict';
// Song analysis engine (main process): splits a song into instrument stems and reads its beats,
// tempo, key and notes with open-source models (tools/stems/analyze.py). The engine lives in
// userData/stems-engine — a Python virtual environment with PyTorch (CUDA when an NVIDIA GPU is
// there), python-audio-separator, Beat This! and Basic Pitch — plus the downloaded model files.
// Results are cached per file (userData/stems-cache/<hash>) so opening the same song is instant.
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const crypto = require('node:crypto');
const { safeStorage } = require('electron');
const { spawn } = require('node:child_process');
const i18n = require('./i18n-main.js'); // i18n.t: `t` is a token in this file
const { createInstaller, InstallError } = require('./engine-install');

function run(cmd, args, opts = {}, onLine = () => {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { windowsHide: true, ...opts });
    let out = '', err = '', buf = '';
    p.stdout.on('data', (b) => {
      const s = b.toString(); out += s; buf += s;
      let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (l) onLine(l, false); }
    });
    // stderr carries the models' own logs and progress bars, which redraw with \r
    let ebuf = '';
    p.stderr.on('data', (b) => {
      const s = b.toString(); err += s; ebuf += s;
      const parts = ebuf.split(/\r\n|\r|\n/); ebuf = parts.pop();
      for (const l of parts) if (l.trim()) onLine(l.trim(), true);
    });
    p.on('error', (e) => resolve({ code: -1, out, err: String(e.message) }));
    p.on('close', (code) => resolve({ code, out, err, proc: p }));
    if (opts.onSpawn) opts.onSpawn(p);
  });
}

function register(ipcMain, { app, findFfmpeg }) {
  const ROOT = () => path.join(app.getPath('userData'), 'stems-engine');
  const VENV_PY = () => path.join(ROOT(), 'venv', 'Scripts', 'python.exe');
  const MODELS = () => path.join(ROOT(), 'models');
  const CACHE = () => path.join(app.getPath('userData'), 'stems-cache');
  const SCRIPT = path.join(__dirname, 'tools', 'stems', 'analyze.py').replace('app.asar', 'app.asar.unpacked');
  const INST_SCRIPT = path.join(__dirname, 'tools', 'stems', 'instruments.py').replace('app.asar', 'app.asar.unpacked');
  // tools/stems/notes_clean.py POST_VERSION: a saved result made before has its steps after the
  // separation (beats per bar, notes) done again on its stems (analyze.py --redo, seconds)
  const POST_VERSION = 9;
  const stale = (res) => (res.post || 0) < POST_VERSION;
  const python = () => (fs.existsSync(VENV_PY()) ? VENV_PY() : null);
  let busy = null, child = null;
  module.exports.busyNow = () => busy; // the updater asks before restarting (updater.js)
  const installer = createInstaller({ root: ROOT, models: MODELS, run, scriptDir: path.dirname(SCRIPT) });

  const hasGpu = async () => (await run('nvidia-smi', ['-L'])).code === 0;

  // HuggingFace token for MuScriptor's gated weights: entered by the user, kept encrypted by the OS
  const HF = () => path.join(ROOT(), 'hf.json');
  const readToken = async () => {
    try { const j = JSON.parse(await fsp.readFile(HF(), 'utf8')); return j.t && safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(j.t, 'base64')) : null; } catch { return null; }
  };
  ipcMain.handle('stems:setToken', async (_e, token) => {
    const t = String(token || '').trim();
    await fsp.mkdir(ROOT(), { recursive: true });
    if (!t) { await fsp.rm(HF(), { force: true }); return { ok: true, has: false }; }
    if (!/^hf_[A-Za-z0-9]{20,}$/.test(t)) return { ok: false, message: i18n.t('hf_로 시작하는 HuggingFace 토큰을 넣어 주세요.') };
    if (!safeStorage.isEncryptionAvailable()) return { ok: false, message: i18n.t('이 PC에서 토큰을 암호화해 저장할 수 없습니다.') };
    await fsp.writeFile(HF(), JSON.stringify({ t: safeStorage.encryptString(t).toString('base64') }));
    return { ok: true, has: true };
  });

  // the check says why when the engine is not usable, and leaves a note in stems-engine/status.log
  ipcMain.handle('stems:status', async () => {
    const py = python();
    const gpu = await hasGpu();
    const note = async (o) => { try { await fsp.mkdir(ROOT(), { recursive: true }); await fsp.appendFile(path.join(ROOT(), 'status.log'), `${new Date().toISOString()} ${JSON.stringify(o)}\n`); } catch { /* best effort */ } return o; };
    if (!py) return note({ ...(await installer.info()), ready: false, gpu, log: installer.logFile(), busy: !!busy, hfToken: !!(await readToken()), reason: i18n.t('엔진이 없습니다 ({path})', { path: VENV_PY() }) });
    const r = await run(py, ['-c', 'import importlib.util as u, sys; miss = [m for m in ("audio_separator", "beat_this", "basic_pitch", "torch", "muscriptor", "transformers") if not u.find_spec(m)]; print(",".join(miss)); sys.exit(1 if set(miss) - {"muscriptor", "transformers"} else 0)']);
    const missing = r.out.trim();
    const out = { ...(await installer.info()), ready: r.code === 0, gpu, busy: !!busy, log: installer.logFile(), muscriptor: r.code === 0 && !/muscriptor/.test(missing), instruments: r.code === 0 && !/transformers/.test(missing), hfToken: !!(await readToken()) };
    if (!out.ready) out.reason = r.code === -1 ? i18n.t('Python을 실행하지 못했습니다: {why}', { why: r.err.slice(0, 200) }) : missing ? i18n.t('빠진 구성 요소: {list}', { list: missing }) : (r.err.split(/\r?\n/).filter(Boolean).pop() || i18n.t('종료 코드 {code}', { code: r.code })).slice(0, 200);
    return out.ready ? out : note({ ...out, python: py });
  });

  // one-click install / reinstall / update (engine-install.js): its own Python and uv, nothing needed beforehand
  let setupAbort = null;
  ipcMain.handle('stems:setup', async (e, opts = {}) => {
    if (busy) return { ok: false, message: i18n.t('이미 작업 중입니다.') };
    const mode = ['install', 'reinstall', 'update'].includes(opts?.mode) ? opts.mode : 'install';
    const send = (m) => {
      if (e.sender.isDestroyed()) return;
      if (m.log) e.sender.send('stems:log', m.log); else e.sender.send('stems:progress', m);
    };
    busy = 'setup';
    setupAbort = new AbortController();
    try {
      return await installer.install(mode, { send, signal: setupAbort.signal, setChild: (p) => { child = p; } });
    } catch (err) {
      if (err.cancelled || setupAbort.signal.aborted) return { ok: false, cancelled: true, message: i18n.t('설치를 취소했습니다. 다시 누르면 받은 데까지 이어서 설치해요.') };
      const msg = err instanceof InstallError ? err.message : i18n.t('예기치 못한 오류: {why}', { why: err.message });
      try { await fsp.appendFile(installer.logFile(), `실패: ${err.stack || err.message}\n`); } catch { /* best effort */ } // i18n-ignore (the install log)
      return { ok: false, message: `${msg}\n${i18n.t('자세한 기록: {file}', { file: installer.logFile() })}`, log: installer.logFile() };
    } finally { busy = null; setupAbort = null; child = null; }
  });

  // While a run is on: graphics memory per program (Windows' GPU counters). When the engine's own
  // Python has had to spill into shared system memory (another program holds the card's memory),
  // the models crawl; say so, and name the programs holding the most.
  const GPU_MEM_PS = "$c = Get-Counter '\\GPU Process Memory(*)\\Dedicated Usage','\\GPU Process Memory(*)\\Shared Usage' -ErrorAction SilentlyContinue; "
    + "$c.CounterSamples | Where-Object { $_.CookedValue -gt 100MB } | ForEach-Object { $id = [int]([regex]::Match($_.InstanceName,'pid_(\\d+)').Groups[1].Value); "
    + "[pscustomobject]@{ pid = $id; name = (Get-Process -Id $id -ErrorAction SilentlyContinue).ProcessName; kind = ($_.Path -replace '.*\\\\', ''); mb = [math]::Round($_.CookedValue / 1MB) } } | ConvertTo-Json -Compress";
  function watchGpuMemory(send, log) {
    if (process.platform !== 'win32') return () => {};
    let last = '', stop = false, timer = null;
    const tick = async () => {
      if (stop) return;
      const r = await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', GPU_MEM_PS]);
      if (stop) return;
      try {
        const rows = [].concat(JSON.parse(r.out || '[]') || []);
        const spill = rows.filter((x) => /^python/i.test(x.name || '') && /shared/i.test(x.kind)).reduce((a, x) => a + x.mb, 0);
        const others = rows.filter((x) => !/^python/i.test(x.name || '') && /dedicated/i.test(x.kind) && x.mb >= 300).sort((a, b) => b.mb - a.mb).slice(0, 3);
        const warn = spill >= 1500
          ? [i18n.t('그래픽 메모리가 모자라 분석이 일반 메모리로 {gb} GB 넘쳤어요. 이러면 몇 배 느려져요.', { gb: (spill / 1024).toFixed(1) }),
            others.length ? i18n.t('GPU 메모리를 쓰는 프로그램: {list}.', { list: others.map((x) => `${x.name} ${(x.mb / 1024).toFixed(1)} GB`).join(', ') }) : '',
            i18n.t('그 프로그램을 닫고 취소 후 다시 시작하면 빨라져요 (분리 결과는 저장돼 있어요).')].filter(Boolean).join(' ')
          : '';
        if (warn !== last) { last = warn; send({ warn }); if (warn) log(`경고: ${warn}`); }
      } catch { /* counters unavailable */ }
      timer = setTimeout(tick, 10000);
    };
    timer = setTimeout(tick, 15000);
    return () => { stop = true; clearTimeout(timer); };
  }

  // payload: { path } or { name, data } -> { ok, result } (result.stems are file paths)
  // payload: { path } or { name, data } -> { ok, result } (result.stems are file paths). Asking again
  // for the song that is already running (the window was closed and reopened) joins that run.
  const running = new Map(); // hash -> Promise of the reply
  ipcMain.handle('stems:run', async (e, payload) => {
    const py = python();
    if (!py) return { ok: false, error: 'no_engine', message: i18n.t('분석 엔진을 먼저 설치해 주세요.') };
    const data = payload.data ? Buffer.from(payload.data) : await fsp.readFile(payload.path);
    const hash = crypto.createHash('sha1').update(data).update(payload.quick ? 'q' : 'f').digest('hex').slice(0, 16);
    const model = ['small', 'medium', 'large'].includes(payload.muscriptor) ? payload.muscriptor : 'off';
    const key = `${hash}:${model}`;
    if (running.has(key)) return running.get(key);
    if (busy) return { ok: false, error: 'busy', message: i18n.t('다른 곡을 분석하고 있습니다. 끝날 때까지 기다려 주세요.') };
    const job = analyse(e, payload, py, data, hash, model);
    running.set(key, job);
    try { return await job; } finally { running.delete(key); }
  });

  // a song separated before: its saved result, without running anything (null when there is none).
  // The MuScriptor run asked for comes with it when it was made; else the Basic Pitch notes.
  ipcMain.handle('stems:cached', async (_e, payload) => {
    try {
      const data = Buffer.from(payload.data);
      const hash = crypto.createHash('sha1').update(data).update(payload.quick ? 'q' : 'f').digest('hex').slice(0, 16);
      const done = path.join(CACHE(), hash, 'result.json');
      if (!fs.existsSync(done)) return null;
      const res = JSON.parse(await fsp.readFile(done, 'utf8'));
      if (!Object.values(res.stems).every((f) => fs.existsSync(f))) return null;
      if (stale(res)) return null; // stems:run brings it up to date first
      const runs = res.muscriptor_runs || {};
      const mus = runs[payload.muscriptor] || null;
      return { result: { ...res, muscriptor: mus }, muscriptor: mus ? payload.muscriptor : 'off' };
    } catch { return null; }
  });

  // the separation, beats and Basic Pitch notes are done once per song; a MuScriptor model asked
  // for later only adds its own run to that result
  async function analyse(e, payload, py, data, hash, model) {
    const send = (m) => { if (!e.sender.isDestroyed()) e.sender.send('stems:progress', m); };
    busy = 'run';
    try {
      const out = path.join(CACHE(), hash);
      const done = path.join(out, 'result.json');
      // 다시 분리 (payload.fresh): the saved result of this song and way is dropped and it runs again
      if (payload.fresh) await fsp.rm(out, { recursive: true, force: true });
      // results kept under the older one-folder-per-MuScriptor-choice names move to the song's folder
      if (!fs.existsSync(done) && !payload.fresh) {
        for (const m of ['off', 'small', 'medium', 'large']) {
          const old = path.join(CACHE(), crypto.createHash('sha1').update(data).update(payload.quick ? 'q' : 'f').update(`m:${m}`).digest('hex').slice(0, 16));
          const oldRes = path.join(old, 'result.json');
          if (!fs.existsSync(oldRes)) continue;
          try {
            const res = JSON.parse(await fsp.readFile(oldRes, 'utf8'));
            await fsp.rename(old, out);
            const fix = (f) => (typeof f === 'string' ? f.split(old).join(out) : f);
            for (const k of ['stems', 'drum_parts']) for (const s of Object.keys(res[k] || {})) res[k][s] = fix(res[k][s]);
            res.harmonic = fix(res.harmonic);
            res.muscriptor_runs = res.muscriptor_runs || (res.muscriptor?.notes ? { [res.muscriptor.model]: res.muscriptor } : {});
            await fsp.writeFile(done, JSON.stringify(res));
            break;
          } catch { /* leave it; analyse again */ }
        }
      }
      let only = false, redo = false;
      if (fs.existsSync(done)) {
        const res = JSON.parse(await fsp.readFile(done, 'utf8'));
        if (Object.values(res.stems).every((f) => fs.existsSync(f)) && stale(res)) redo = true;
        else if (Object.values(res.stems).every((f) => fs.existsSync(f))) {
          const runs = res.muscriptor_runs || {};
          if (model === 'off') return { ok: true, result: { ...res, muscriptor: null }, cached: true };
          if (runs[model]) return { ok: true, result: { ...res, muscriptor: runs[model] }, cached: true };
          only = true; // just the MuScriptor run
        }
      }
      if (redo) {
        const r = await run(py, [SCRIPT, '--input', '-', '--out', out, '--models', MODELS(), '--redo'], { env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }, onSpawn: (p) => { child = p; } }, (l, isErr) => {
          if (isErr) return;
          try { const m = JSON.parse(l); if (!m.error && !m.log) send(m.label ? { ...m, label: i18n.tdyn(m.label) } : m); } catch { /* a library's own line */ }
        });
        child = null;
        const res = JSON.parse(await fsp.readFile(done, 'utf8'));
        // a failed redo keeps the older notes: still a usable result
        if (model === 'off' || !stale(res)) {
          const runs = res.muscriptor_runs || {};
          if (model === 'off') return { ok: true, result: { ...res, muscriptor: null }, cached: true };
          if (runs[model]) return { ok: true, result: { ...res, muscriptor: runs[model] }, cached: true };
          only = true;
        }
      }
      await fsp.mkdir(out, { recursive: true });
      const ext = (payload.name || payload.path || '').match(/\.[a-z0-9]+$/i)?.[0] || '.bin';
      const input = path.join(out, `source${ext}`);
      await fsp.writeFile(input, data);
      let err = null, last = '';
      const args = [SCRIPT, '--input', input, '--out', out, '--models', MODELS(), '--ffmpeg', findFfmpeg() || 'ffmpeg', ...(payload.quick ? ['--quick'] : []), '--muscriptor', model, ...(only ? ['--only-muscriptor'] : [])];
      const token = model !== 'off' ? await readToken() : null;
      const stopWatch = watchGpuMemory(send, (t) => { if (!e.sender.isDestroyed()) e.sender.send('stems:log', t); });
      const r = await run(py, args, { env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', ...(token ? { HF_TOKEN: token } : {}) }, onSpawn: (p) => { child = p; } }, (l, isErr) => {
        // every line also goes to the window's live log
        const log = (t) => {
          if (e.sender.isDestroyed()) return;
          e.sender.send('stems:log', t);
          // the current stage's own progress: a progress bar's "42%|" or MuScriptor's "12/40" chunks
          const pct = /(\d{1,3})%\|/.exec(t), frac = /^\[MuScriptor\].*?\b(\d+)\s*\/\s*(\d+)\b/.exec(t);
          if (pct) send({ stage: Math.min(1, +pct[1] / 100) });
          else if (frac && +frac[2] > 0) send({ stage: Math.min(1, +frac[1] / +frac[2]) });
        };
        if (isErr) { last = l; log(l); return; }
        try {
          const m = JSON.parse(l);
          if (m.error) { err = m.error; log(`오류: ${m.error}`); } else if (m.log) log(m.log); else { send(m.label ? { ...m, label: i18n.tdyn(m.label) } : m); if (m.label) log(`▶ ${m.label}`); }
        } catch { last = l; log(l); }
      });
      child = null;
      stopWatch(); send({ warn: '' });
      await fsp.rm(input, { force: true });
      if (r.code || !fs.existsSync(done)) return { ok: false, error: 'run', message: i18n.t('분석하지 못했습니다: {why}', { why: i18n.tdyn(err) || last || r.err.slice(-300) }) };
      return { ok: true, result: JSON.parse(await fsp.readFile(done, 'utf8')) };
    } finally { busy = null; }
  }

  // an engine installed before instrument recognition existed: add just that package
  ipcMain.handle('stems:addInstruments', async (e) => {
    const py = python();
    if (!py) return { ok: false, message: i18n.t('분석 엔진을 먼저 설치해 주세요.') };
    if (busy) return { ok: false, message: i18n.t('이미 작업 중입니다.') };
    const send = (m) => { if (!e.sender.isDestroyed()) e.sender.send('stems:progress', m); };
    busy = 'setup';
    try {
      send({ p: 0.1, label: i18n.t('악기 인식 구성 요소 설치 중…') });
      const r = await run(py, ['-m', 'pip', 'install', '--disable-pip-version-check', 'transformers'], {}, (l) => { if (/^(Collecting|Downloading|Installing|Successfully)/.test(l)) send({ detail: l.slice(0, 110) }); });
      if (r.code) return { ok: false, message: i18n.t('설치하지 못했습니다: {why}', { why: (r.err || r.out).split(/\r?\n/).filter(Boolean).slice(-2).join(' ').slice(-300) }) };
      send({ p: 1, label: i18n.t('설치를 마쳤습니다.') });
      return { ok: true };
    } finally { busy = null; }
  });

  // which instrument plays in each stem and when (tools/stems/instruments.py), cached with the song
  ipcMain.handle('stems:instruments', async (e, dir) => {
    const py = python();
    if (!py) return { ok: false, message: i18n.t('분석 엔진을 먼저 설치해 주세요.') };
    const d = path.resolve(String(dir || ''));
    if (!d.startsWith(path.resolve(CACHE())) || !fs.existsSync(path.join(d, 'result.json'))) return { ok: false, message: i18n.t('분석 결과를 찾지 못했습니다.') };
    const file = path.join(d, 'instruments.json');
    if (fs.existsSync(file)) return { ok: true, result: JSON.parse(await fsp.readFile(file, 'utf8')), cached: true };
    if (busy) return { ok: false, message: i18n.t('다른 작업이 끝날 때까지 기다려 주세요.') };
    const send = (m) => { if (!e.sender.isDestroyed()) e.sender.send('stems:progress', m); };
    const log = (t) => { if (!e.sender.isDestroyed()) e.sender.send('stems:log', t); };
    busy = 'instruments';
    try {
      let err = null;
      const r = await run(py, [INST_SCRIPT, '--dir', d, '--models', MODELS()], { env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', HF_HOME: path.join(MODELS(), 'hf') }, onSpawn: (p) => { child = p; } }, (l, isErr) => {
        if (isErr) { if (!/warn/i.test(l)) log(l); return; }
        try { const m = JSON.parse(l); if (m.error) { err = m.error; log(`오류: ${m.error}`); } else if (m.log) log(m.log); else { send(m.label ? { ...m, label: i18n.tdyn(m.label) } : m); if (m.label) log(`▶ ${m.label}`); } } catch { log(l); }
      });
      child = null;
      if (r.code || !fs.existsSync(file)) return { ok: false, message: i18n.t('악기를 알아보지 못했습니다: {why}', { why: i18n.tdyn(err) || r.err.split(/\r?\n/).filter(Boolean).pop() || r.code }) };
      return { ok: true, result: JSON.parse(await fsp.readFile(file, 'utf8')) };
    } finally { busy = null; }
  });

  // ---- instrument labels per note (YourMT3+), an optional component ----
  // A multi-instrument transcription of the whole song says which instrument plays which note; the
  // conversion uses it as a hint to split a stem that holds several instruments (an orchestra in
  // "other"). It lives in its own Python environment (stems-engine/ymt3: the mt3-infer package, MIT,
  // from PyPI, and the YourMT3+ checkpoint, tagged Apache-2.0 on Hugging Face) and runs only as a
  // separate process (tools/stems/labels_ymt3.py): the YourMT3 code it is derived from is GPL-3.0,
  // so none of it is linked into or shipped with the app. Installed on request (stems:labelsSetup).
  const YMT3 = () => path.join(ROOT(), 'ymt3');
  const YMT3_PY = () => path.join(YMT3(), 'venv', 'Scripts', 'python.exe');
  const YMT3_NAME = 'mc13_256_g4_all_v7_mt3f_sqr_rms_moe_wf4_n8k2_silu_rope_rp_b36_nops';
  const YMT3_CKPT = () => path.join(YMT3(), 'ckpt', 'yourmt3', YMT3_NAME, 'last.ckpt');
  const YMT3_URL = `https://huggingface.co/spaces/mimbres/YourMT3/resolve/main/amt/logs/2024/${YMT3_NAME}/checkpoints/last.ckpt`;
  const YMT3_SHA = 'ae38e415c79efd5592dcb9b658cdb99ddb11d4c4e1eaa364cab04a052473fc25', YMT3_BYTES = 561544628;
  const LABELS_SCRIPT = path.join(__dirname, 'tools', 'stems', 'labels_ymt3.py').replace('app.asar', 'app.asar.unpacked');
  const labelsReady = () => fs.existsSync(YMT3_PY()) && fs.existsSync(YMT3_CKPT());
  ipcMain.handle('stems:labelsStatus', async () => ({ installed: labelsReady(), engine: !!python(), bytes: YMT3_BYTES }));
  ipcMain.handle('stems:labelsSetup', async (e) => {
    const py = python();
    if (!py) return { ok: false, message: i18n.t('분석 엔진을 먼저 설치해 주세요.') };
    if (busy) return { ok: false, message: i18n.t('다른 작업이 끝날 때까지 기다려 주세요.') };
    const send = (m) => { if (!e.sender.isDestroyed()) e.sender.send('stems:progress', m); };
    busy = 'setup';
    try {
      await fsp.mkdir(YMT3(), { recursive: true });
      // 1. its own environment, borrowing the engine's packages (torch, librosa) through a .pth file
      if (!fs.existsSync(YMT3_PY())) {
        send({ p: 0.02, label: i18n.t('악기별 분리 구성 요소 준비 중') });
        const v = await run(py, ['-m', 'venv', path.join(YMT3(), 'venv')]);
        if (v.code) return { ok: false, message: (v.err || '').slice(-300) };
        await fsp.writeFile(path.join(YMT3(), 'venv', 'Lib', 'site-packages', 'zz_engine.pth'), path.join(ROOT(), 'venv', 'Lib', 'site-packages') + '\n');
      }
      send({ p: 0.05, label: i18n.t('악기별 분리 구성 요소 받는 중') });
      for (const args of [['--no-deps', 'mt3-infer==0.2.0'], ['transformers>=4.40,<4.46']]) {
        const r = await run(YMT3_PY(), ['-m', 'pip', 'install', '--disable-pip-version-check', '-q', ...args], { onSpawn: (p) => { child = p; } });
        child = null;
        if (r.code) return { ok: false, message: (r.err || r.out || '').split(/\r?\n/).filter(Boolean).pop()?.slice(0, 300) || 'pip' };
      }
      // 2. the checkpoint, resumable, checked against its SHA-256
      const dst = YMT3_CKPT();
      if (!fs.existsSync(dst)) {
        await fsp.mkdir(path.dirname(dst), { recursive: true });
        const { fetchFile } = require('./lib/install-source');
        let done = 0;
        await fetchFile(YMT3_URL, dst, { size: YMT3_BYTES, sha: YMT3_SHA, signal: new AbortController().signal, onBytes: (n) => { done += n; send({ p: 0.1 + 0.9 * Math.min(1, done / YMT3_BYTES), label: i18n.t('악기별 분리 구성 요소 받는 중') }); } });
      }
      return { ok: labelsReady() };
    } catch (err) { return { ok: false, message: String(err.message || err).slice(0, 300) }; } finally { busy = null; child = null; }
  });
  // labels.json beside the analysis (made once per song)
  ipcMain.handle('stems:labels', async (e, dir) => {
    const d = path.resolve(String(dir || ''));
    if (!d.startsWith(path.resolve(CACHE())) || !fs.existsSync(path.join(d, 'result.json'))) return { ok: false, message: i18n.t('분석 결과를 찾지 못했습니다.') };
    const file = path.join(d, 'labels.json');
    if (fs.existsSync(file)) return { ok: true, result: JSON.parse(await fsp.readFile(file, 'utf8')), cached: true };
    if (!labelsReady()) return { ok: false, missing: true };
    if (busy) return { ok: false, message: i18n.t('다른 작업이 끝날 때까지 기다려 주세요.') };
    busy = 'labels';
    try {
      const r = await run(YMT3_PY(), [LABELS_SCRIPT, '--out', d], { env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', MT3_CHECKPOINT_DIR: path.join(YMT3(), 'ckpt') }, onSpawn: (p) => { child = p; } });
      child = null;
      if (r.code || !fs.existsSync(file)) return { ok: false, message: (r.err || '').split(/\r?\n/).filter(Boolean).pop()?.slice(0, 300) || String(r.code) };
      return { ok: true, result: JSON.parse(await fsp.readFile(file, 'utf8')) };
    } finally { busy = null; }
  });

  // ---- the piano stem transcribed by a piano model, an optional component ----
  // High-resolution Piano Transcription (the piano_transcription_inference package, MIT; checkpoint
  // CC BY 4.0 on Zenodo, trained on MAESTRO, CC BY-NC-SA 4.0: MeloFi treats its notes as for
  // non-commercial use). Its own environment (stems-engine/piano) and a separate process
  // (tools/stems/piano_notes.py); used only where the stem is heard as an acoustic piano.
  const PIANO = () => path.join(ROOT(), 'piano');
  const PIANO_PY = () => path.join(PIANO(), 'venv', 'Scripts', 'python.exe');
  const PIANO_CKPT = () => path.join(PIANO(), 'note_F1=0.9677_pedal_F1=0.9186.pth');
  const PIANO_URL = 'https://zenodo.org/record/4034264/files/CRNN_note_F1%3D0.9677_pedal_F1%3D0.9186.pth?download=1';
  const PIANO_SHA = 'c3fa9730725bf4a762f1c14bc80cd5986eacda01b026f5a4a2525cd607876141', PIANO_BYTES = 171966578;
  const PIANO_SCRIPT = path.join(__dirname, 'tools', 'stems', 'piano_notes.py').replace('app.asar', 'app.asar.unpacked');
  const pianoPkg = () => path.join(PIANO(), 'venv', 'Lib', 'site-packages', 'piano_transcription_inference');
  const pianoReady = () => fs.existsSync(PIANO_PY()) && fs.existsSync(pianoPkg()) && fs.existsSync(PIANO_CKPT());
  ipcMain.handle('stems:pianoStatus', async () => ({ installed: pianoReady(), engine: !!python(), bytes: PIANO_BYTES }));
  ipcMain.handle('stems:pianoSetup', async (e) => {
    const py = python();
    if (!py) return { ok: false, message: i18n.t('분석 엔진을 먼저 설치해 주세요.') };
    if (busy) return { ok: false, message: i18n.t('다른 작업이 끝날 때까지 기다려 주세요.') };
    const send = (m) => { if (!e.sender.isDestroyed()) e.sender.send('stems:progress', m); };
    busy = 'setup';
    try {
      await fsp.mkdir(PIANO(), { recursive: true });
      if (!fs.existsSync(PIANO_PY())) {
        send({ p: 0.02, label: i18n.t('피아노 채보 구성 요소 준비 중') });
        const v = await run(py, ['-m', 'venv', path.join(PIANO(), 'venv')]);
        if (v.code) return { ok: false, message: (v.err || '').slice(-300) };
        await fsp.writeFile(path.join(PIANO(), 'venv', 'Lib', 'site-packages', 'zz_engine.pth'), path.join(ROOT(), 'venv', 'Lib', 'site-packages') + '\n');
      }
      send({ p: 0.05, label: i18n.t('피아노 채보 구성 요소 받는 중') });
      // (--no-deps: torch and librosa come from the engine; the rest of its requirements are for
      // plots and file reading MeloFi does not use)
      const r = await run(PIANO_PY(), ['-m', 'pip', 'install', '--disable-pip-version-check', '-q', '--no-deps', 'piano-transcription-inference==0.0.6', 'torchlibrosa==0.1.0'], { onSpawn: (p) => { child = p; } });
      child = null;
      if (r.code) return { ok: false, message: (r.err || r.out || '').split(/\r?\n/).filter(Boolean).pop()?.slice(0, 300) || 'pip' };
      const dst = PIANO_CKPT();
      if (!fs.existsSync(dst)) {
        const { fetchFile } = require('./lib/install-source');
        let done = 0;
        await fetchFile(PIANO_URL, dst, { size: PIANO_BYTES, sha: PIANO_SHA, signal: new AbortController().signal, onBytes: (n) => { done += n; send({ p: 0.1 + 0.9 * Math.min(1, done / PIANO_BYTES), label: i18n.t('피아노 채보 구성 요소 받는 중') }); } });
      }
      return { ok: pianoReady() };
    } catch (err) { return { ok: false, message: String(err.message || err).slice(0, 300) }; } finally { busy = null; child = null; }
  });
  // piano_notes.json beside the analysis (made once per song, after the instruments are recognised)
  ipcMain.handle('stems:piano', async (e, dir) => {
    const d = path.resolve(String(dir || ''));
    if (!d.startsWith(path.resolve(CACHE())) || !fs.existsSync(path.join(d, 'result.json'))) return { ok: false, message: i18n.t('분석 결과를 찾지 못했습니다.') };
    const file = path.join(d, 'piano_notes.json');
    if (fs.existsSync(file)) return { ok: true, result: JSON.parse(await fsp.readFile(file, 'utf8')), cached: true };
    if (!pianoReady()) return { ok: false, missing: true };
    if (!fs.existsSync(path.join(d, 'instruments.json'))) return { ok: false, wait: true };
    if (busy) return { ok: false, message: i18n.t('다른 작업이 끝날 때까지 기다려 주세요.') };
    busy = 'piano';
    try {
      const r = await run(PIANO_PY(), [PIANO_SCRIPT, '--out', d, '--checkpoint', PIANO_CKPT()], { env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }, onSpawn: (p) => { child = p; } });
      child = null;
      if (r.code || !fs.existsSync(file)) return { ok: false, message: (r.err || '').split(/\r?\n/).filter(Boolean).pop()?.slice(0, 300) || String(r.code) };
      return { ok: true, result: JSON.parse(await fsp.readFile(file, 'utf8')) };
    } finally { busy = null; }
  });

  // ---- the bass stem transcribed by a bass model, an optional component ----
  // The same network as the piano component with a checkpoint trained on bass recordings
  // ("filobass", huggingface.co/xavriley/midi-transcription-models, tagged MIT; its training data
  // is not documented, so MeloFi treats its notes as for non-commercial use). It runs in the piano
  // component's environment (stems-engine/piano), which this sets up too when it is not there, as
  // a separate process (tools/stems/bass_notes.py). Used only where it finds at least 80% as many
  // notes as the general transcription: an 808 or a sub bass keeps the general one.
  const BASS_CKPT = () => path.join(PIANO(), 'filobass_20000_iterations.pth');
  const BASS_URL = 'https://huggingface.co/xavriley/midi-transcription-models/resolve/main/filobass_20000_iterations.pth';
  const BASS_SHA = 'cbc792a1b6b6002a73ee0a433c0fe5e097ee728034fe2ea70b24bd06b5026e84', BASS_BYTES = 98882013;
  const BASS_SCRIPT = path.join(__dirname, 'tools', 'stems', 'bass_notes.py').replace('app.asar', 'app.asar.unpacked');
  const bassReady = () => fs.existsSync(PIANO_PY()) && fs.existsSync(pianoPkg()) && fs.existsSync(BASS_CKPT());
  ipcMain.handle('stems:bassStatus', async () => ({ installed: bassReady(), engine: !!python(), bytes: BASS_BYTES }));
  ipcMain.handle('stems:bassSetup', async (e) => {
    const py = python();
    if (!py) return { ok: false, message: i18n.t('분석 엔진을 먼저 설치해 주세요.') };
    if (busy) return { ok: false, message: i18n.t('다른 작업이 끝날 때까지 기다려 주세요.') };
    const send = (m) => { if (!e.sender.isDestroyed()) e.sender.send('stems:progress', m); };
    busy = 'setup';
    try {
      await fsp.mkdir(PIANO(), { recursive: true });
      if (!fs.existsSync(PIANO_PY())) {
        send({ p: 0.02, label: i18n.t('베이스 채보 구성 요소 준비 중') });
        const v = await run(py, ['-m', 'venv', path.join(PIANO(), 'venv')]);
        if (v.code) return { ok: false, message: (v.err || '').slice(-300) };
        await fsp.writeFile(path.join(PIANO(), 'venv', 'Lib', 'site-packages', 'zz_engine.pth'), path.join(ROOT(), 'venv', 'Lib', 'site-packages') + '\n');
      }
      send({ p: 0.05, label: i18n.t('베이스 채보 구성 요소 받는 중') });
      if (!fs.existsSync(pianoPkg())) {
        const r = await run(PIANO_PY(), ['-m', 'pip', 'install', '--disable-pip-version-check', '-q', '--no-deps', 'piano-transcription-inference==0.0.6', 'torchlibrosa==0.1.0'], { onSpawn: (p) => { child = p; } });
        child = null;
        if (r.code) return { ok: false, message: (r.err || r.out || '').split(/\r?\n/).filter(Boolean).pop()?.slice(0, 300) || 'pip' };
      }
      const dst = BASS_CKPT();
      if (!fs.existsSync(dst)) {
        const { fetchFile } = require('./lib/install-source');
        let done = 0;
        await fetchFile(BASS_URL, dst, { size: BASS_BYTES, sha: BASS_SHA, signal: new AbortController().signal, onBytes: (n) => { done += n; send({ p: 0.1 + 0.9 * Math.min(1, done / BASS_BYTES), label: i18n.t('베이스 채보 구성 요소 받는 중') }); } });
      }
      return { ok: bassReady() };
    } catch (err) { return { ok: false, message: String(err.message || err).slice(0, 300) }; } finally { busy = null; child = null; }
  });
  // bass_notes.json beside the analysis (made once per song)
  ipcMain.handle('stems:bass', async (e, dir) => {
    const d = path.resolve(String(dir || ''));
    if (!d.startsWith(path.resolve(CACHE())) || !fs.existsSync(path.join(d, 'result.json'))) return { ok: false, message: i18n.t('분석 결과를 찾지 못했습니다.') };
    const file = path.join(d, 'bass_notes.json');
    if (fs.existsSync(file)) return { ok: true, result: JSON.parse(await fsp.readFile(file, 'utf8')), cached: true };
    if (!bassReady()) return { ok: false, missing: true };
    if (busy) return { ok: false, message: i18n.t('다른 작업이 끝날 때까지 기다려 주세요.') };
    busy = 'bass';
    try {
      const r = await run(PIANO_PY(), [BASS_SCRIPT, '--out', d, '--checkpoint', BASS_CKPT()], { env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }, onSpawn: (p) => { child = p; } });
      child = null;
      if (r.code || !fs.existsSync(file)) return { ok: false, message: (r.err || '').split(/\r?\n/).filter(Boolean).pop()?.slice(0, 300) || String(r.code) };
      return { ok: true, result: JSON.parse(await fsp.readFile(file, 'utf8')) };
    } finally { busy = null; }
  });

  // ---- the lead vocal's notes from a singing transcription model, an optional component ----
  // GAME (github.com/openvpi/GAME: code MIT, weights CC BY-NC-SA 4.0, so its notes are for
  // non-commercial use). It is a repository, not a package: the component holds its source at one
  // commit, its own environment (stems-engine/game: Lightning and a few small packages on top of
  // the engine's torch) and the medium model, and runs as a separate process
  // (tools/stems/vocal_notes.py).
  const GAME = () => path.join(ROOT(), 'game');
  const GAME_PY = () => path.join(GAME(), 'venv', 'Scripts', 'python.exe');
  const GAME_COMMIT = '69ba01ded0ddda5495e51ba373685f1be1a67ea2';
  const GAME_SRC = () => path.join(GAME(), 'src', `GAME-${GAME_COMMIT}`);
  const GAME_SRC_URL = `https://codeload.github.com/openvpi/GAME/zip/${GAME_COMMIT}`;
  const GAME_SRC_SHA = 'ed9c59f52d4988d62d2f7eb6562dcf9db61dd8df5d2078f1bfc6dca633a95ed3', GAME_SRC_BYTES = 222141;
  const GAME_MODEL = () => path.join(GAME(), 'GAME-1.0-medium', 'GAME-1.0-medium', 'model.pt');
  const GAME_MODEL_URL = 'https://github.com/openvpi/GAME/releases/download/v1.0.0/GAME-1.0-medium.zip';
  const GAME_MODEL_SHA = '8c5b3e531e2905b935e664e2f533921cd637243770fab5282413bdb5051ca60c', GAME_MODEL_BYTES = 184550485;
  const GAME_PIP = ['lightning==2.6.6', 'loguru==0.8.0', 'colorednoise==2.2.0', 'matplotlib==3.11.2', 'torchmetrics==1.9.0', 'tensorboardX==2.6.5'];
  const VOCAL_SCRIPT = path.join(__dirname, 'tools', 'stems', 'vocal_notes.py').replace('app.asar', 'app.asar.unpacked');
  const gamePkg = () => path.join(GAME(), 'venv', 'Lib', 'site-packages', 'lightning');
  const vocalReady = () => fs.existsSync(GAME_PY()) && fs.existsSync(gamePkg()) && fs.existsSync(path.join(GAME_SRC(), 'infer.py')) && fs.existsSync(GAME_MODEL());
  ipcMain.handle('stems:vocalNotesStatus', async () => ({ installed: vocalReady(), engine: !!python(), bytes: GAME_MODEL_BYTES }));
  ipcMain.handle('stems:vocalNotesSetup', async (e) => {
    const py = python();
    if (!py) return { ok: false, message: i18n.t('분석 엔진을 먼저 설치해 주세요.') };
    if (busy) return { ok: false, message: i18n.t('다른 작업이 끝날 때까지 기다려 주세요.') };
    const send = (m) => { if (!e.sender.isDestroyed()) e.sender.send('stems:progress', m); };
    busy = 'setup';
    try {
      await fsp.mkdir(GAME(), { recursive: true });
      if (!fs.existsSync(GAME_PY())) {
        send({ p: 0.02, label: i18n.t('보컬 채보 구성 요소 준비 중') });
        const v = await run(py, ['-m', 'venv', path.join(GAME(), 'venv')]);
        if (v.code) return { ok: false, message: (v.err || '').slice(-300) };
        await fsp.writeFile(path.join(GAME(), 'venv', 'Lib', 'site-packages', 'zz_engine.pth'), path.join(ROOT(), 'venv', 'Lib', 'site-packages') + '\n');
      }
      send({ p: 0.05, label: i18n.t('보컬 채보 구성 요소 받는 중') });
      if (!fs.existsSync(gamePkg())) {
        // (torch, librosa and the rest of what GAME needs come from the engine through the .pth)
        const r = await run(GAME_PY(), ['-m', 'pip', 'install', '--disable-pip-version-check', '-q', ...GAME_PIP], { onSpawn: (p) => { child = p; } });
        child = null;
        if (r.code) return { ok: false, message: (r.err || r.out || '').split(/\r?\n/).filter(Boolean).pop()?.slice(0, 300) || 'pip' };
      }
      const { fetchFile } = require('./lib/install-source');
      // the source at its commit and the model: zips, checked against their SHA-256, unpacked by Python
      const unzip = async (zip, to) => {
        const r = await run(GAME_PY(), ['-m', 'zipfile', '-e', zip, to]);
        if (r.code) throw new Error((r.err || '').split(/\r?\n/).filter(Boolean).pop() || 'unzip');
        await fsp.rm(zip, { force: true });
      };
      if (!fs.existsSync(path.join(GAME_SRC(), 'infer.py'))) {
        const zip = path.join(GAME(), 'src.zip');
        await fetchFile(GAME_SRC_URL, zip, { size: GAME_SRC_BYTES, sha: GAME_SRC_SHA, signal: new AbortController().signal, onBytes: () => {} });
        await unzip(zip, path.join(GAME(), 'src'));
      }
      if (!fs.existsSync(GAME_MODEL())) {
        const zip = path.join(GAME(), 'model.zip');
        let done = 0;
        await fetchFile(GAME_MODEL_URL, zip, { size: GAME_MODEL_BYTES, sha: GAME_MODEL_SHA, signal: new AbortController().signal, onBytes: (n) => { done += n; send({ p: 0.1 + 0.85 * Math.min(1, done / GAME_MODEL_BYTES), label: i18n.t('보컬 채보 구성 요소 받는 중') }); } });
        await unzip(zip, path.join(GAME(), 'GAME-1.0-medium'));
      }
      return { ok: vocalReady() };
    } catch (err) { return { ok: false, message: String(err.message || err).slice(0, 300) }; } finally { busy = null; child = null; }
  });
  // vocal_notes.json beside the analysis (made once per song)
  ipcMain.handle('stems:vocalNotes', async (e, dir) => {
    const d = path.resolve(String(dir || ''));
    if (!d.startsWith(path.resolve(CACHE())) || !fs.existsSync(path.join(d, 'result.json'))) return { ok: false, message: i18n.t('분석 결과를 찾지 못했습니다.') };
    const file = path.join(d, 'vocal_notes.json');
    if (fs.existsSync(file)) return { ok: true, result: JSON.parse(await fsp.readFile(file, 'utf8')), cached: true };
    if (!vocalReady()) return { ok: false, missing: true };
    if (busy) return { ok: false, message: i18n.t('다른 작업이 끝날 때까지 기다려 주세요.') };
    busy = 'vocalNotes';
    try {
      const r = await run(GAME_PY(), [VOCAL_SCRIPT, '--out', d, '--game', GAME_SRC(), '--model', GAME_MODEL()], { env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }, onSpawn: (p) => { child = p; } });
      child = null;
      if (r.code || !fs.existsSync(file)) return { ok: false, message: (r.err || '').split(/\r?\n/).filter(Boolean).pop()?.slice(0, 300) || String(r.code) };
      return { ok: true, result: JSON.parse(await fsp.readFile(file, 'utf8')) };
    } finally { busy = null; }
  });

  // GPU check before an analysis: the NVIDIA card (name, memory, load, programs on it) and which GPU
  // MeloFi's own screen (the piano visualizer) is drawn on
  ipcMain.handle('stems:gpu', async () => {
    const q = await run('nvidia-smi', ['--query-gpu=name,memory.total,memory.used,utilization.gpu', '--format=csv,noheader,nounits']);
    let gpu = null;
    if (q.code === 0) {
      const [name, total, used, util] = q.out.trim().split(/\r?\n/)[0].split(',').map((x) => x.trim());
      gpu = { name, totalMB: +total, usedMB: +used, freeMB: +total - +used, util: +util };
      const apps = await run('nvidia-smi', ['--query-compute-apps=pid,process_name', '--format=csv,noheader']);
      gpu.apps = apps.code === 0 ? apps.out.trim().split(/\r?\n/).filter(Boolean).map((l) => path.basename(l.split(',').slice(1).join(',').trim())) : [];
      gpu.ours = !!child; // our own analysis is on it right now
    }
    let screen = null;
    try {
      const info = await app.getGPUInfo('basic');
      const active = (info.gpuDevice || []).find((d) => d.active) || (info.gpuDevice || [])[0];
      if (active) screen = { vendor: active.vendorId === 0x10de ? 'NVIDIA' : active.vendorId === 0x8086 ? 'Intel' : active.vendorId === 0x1002 ? 'AMD' : 'other' };
    } catch { /* unknown */ }
    return { gpu, screen };
  });

  ipcMain.handle('stems:cancel', () => {
    setupAbort?.abort();
    const p = child;
    if (p?.pid && process.platform === 'win32') spawn('taskkill', ['/PID', String(p.pid), '/T', '/F'], { windowsHide: true }).on('error', () => {});
    try { p?.kill(); } catch { /* gone */ }
    return true;
  });
  ipcMain.handle('stems:read', async (_e, file) => {
    // only files inside the cache
    const f = path.resolve(file);
    if (!f.startsWith(path.resolve(CACHE()))) return null;
    // (a file that is not there yet, the instrument recognition's before it has run, reads as null)
    try { return new Uint8Array(await fsp.readFile(f)); } catch (err) { if (err.code === 'ENOENT') return null; throw err; }
  });
}

module.exports = { register };
