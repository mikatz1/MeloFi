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

function run(cmd, args, opts = {}, onLine = () => {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { windowsHide: true, ...opts });
    let out = '', err = '', buf = '';
    p.stdout.on('data', (b) => {
      const s = b.toString(); out += s; buf += s;
      let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (l) onLine(l, false); }
    });
    p.stderr.on('data', (b) => { const s = b.toString(); err += s; for (const l of s.split(/\r?\n/)) if (l.trim()) onLine(l.trim(), true); });
    p.on('error', (e) => resolve({ code: -1, out, err: String(e.message) }));
    p.on('close', (code) => resolve({ code, out, err, proc: p }));
    if (opts.onSpawn) opts.onSpawn(p);
  });
}

// the packages, in install order. PyTorch goes in last and over whatever the others pulled in: their
// dependencies fetch the CPU build from PyPI, and the GPU build (CUDA 12.8, needed by RTX 50-series)
// only comes from PyTorch's own index.
const PIP = (gpu) => [
  [gpu ? 'audio-separator[gpu]' : 'audio-separator[cpu]'],
  ['https://github.com/CPJKU/beat_this/archive/main.zip'],
  ['--no-deps', 'basic-pitch'],
  [gpu ? 'onnxruntime-gpu' : 'onnxruntime', 'librosa', 'audioread', 'pretty_midi', 'mir_eval', 'resampy', 'soundfile'],
  ['muscriptor'], // code MIT; its model weights are CC BY-NC 4.0 and download only with the user's HuggingFace token
  gpu ? ['--force-reinstall', '--no-deps', 'torch', 'torchaudio', 'torchvision', '--index-url', 'https://download.pytorch.org/whl/cu128'] : ['torch', 'torchaudio'],
];

function register(ipcMain, { app, findFfmpeg }) {
  const ROOT = () => path.join(app.getPath('userData'), 'stems-engine');
  const VENV_PY = () => path.join(ROOT(), 'venv', 'Scripts', 'python.exe');
  const MODELS = () => path.join(ROOT(), 'models');
  const CACHE = () => path.join(app.getPath('userData'), 'stems-cache');
  const SCRIPT = path.join(__dirname, 'tools', 'stems', 'analyze.py').replace('app.asar', 'app.asar.unpacked');
  const python = () => (fs.existsSync(VENV_PY()) ? VENV_PY() : null);
  let busy = null, child = null;

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
    if (!/^hf_[A-Za-z0-9]{20,}$/.test(t)) return { ok: false, message: 'hf_로 시작하는 HuggingFace 토큰을 넣어 주세요.' };
    if (!safeStorage.isEncryptionAvailable()) return { ok: false, message: '이 PC에서 토큰을 암호화해 저장할 수 없습니다.' };
    await fsp.writeFile(HF(), JSON.stringify({ t: safeStorage.encryptString(t).toString('base64') }));
    return { ok: true, has: true };
  });

  // the check says why when the engine is not usable, and leaves a note in stems-engine/status.log
  ipcMain.handle('stems:status', async () => {
    const py = python();
    const gpu = await hasGpu();
    const note = async (o) => { try { await fsp.mkdir(ROOT(), { recursive: true }); await fsp.appendFile(path.join(ROOT(), 'status.log'), `${new Date().toISOString()} ${JSON.stringify(o)}\n`); } catch { /* best effort */ } return o; };
    if (!py) return note({ ready: false, gpu, busy: !!busy, hfToken: !!(await readToken()), reason: `엔진이 없습니다 (${VENV_PY()})` });
    const r = await run(py, ['-c', 'import importlib.util as u, sys; miss = [m for m in ("audio_separator", "beat_this", "basic_pitch", "torch", "muscriptor") if not u.find_spec(m)]; print(",".join(miss)); sys.exit(1 if set(miss) - {"muscriptor"} else 0)']);
    const missing = r.out.trim();
    const out = { ready: r.code === 0, gpu, busy: !!busy, muscriptor: r.code === 0 && !/muscriptor/.test(missing), hfToken: !!(await readToken()) };
    if (!out.ready) out.reason = r.code === -1 ? `Python을 실행하지 못했습니다: ${r.err.slice(0, 200)}` : missing ? `빠진 구성 요소: ${missing}` : (r.err.split(/\r?\n/).filter(Boolean).pop() || `종료 코드 ${r.code}`).slice(0, 200);
    return out.ready ? out : note({ ...out, python: py });
  });

  // one-time install (about 3 GB with the GPU build of PyTorch)
  ipcMain.handle('stems:setup', async (e) => {
    if (busy) return { ok: false, message: '이미 작업 중입니다.' };
    const send = (m) => { if (!e.sender.isDestroyed()) e.sender.send('stems:progress', m); };
    busy = 'setup';
    try {
      let base = null;
      for (const [cmd, args] of [['py', ['-3.12']], ['py', ['-3.11']], ['py', ['-3.10']], ['python', []]]) {
        const r = await run(cmd, [...args, '-c', 'import sys; print(sys.executable); print((3, 10) <= sys.version_info[:2] <= (3, 12))']);
        if (r.code === 0 && /True/.test(r.out)) { base = r.out.split(/\r?\n/)[0].trim(); break; }
      }
      if (!base) return { ok: false, message: 'Python 3.10~3.12가 필요합니다. python.org에서 설치한 뒤 다시 눌러 주세요.' };
      await fsp.mkdir(ROOT(), { recursive: true });
      if (!fs.existsSync(VENV_PY())) {
        send({ p: 0.02, label: '가상 환경을 만드는 중…' });
        const r = await run(base, ['-m', 'venv', path.join(ROOT(), 'venv')]);
        if (r.code) return { ok: false, message: `가상 환경을 만들지 못했습니다: ${r.err.slice(-200)}` };
      }
      const gpu = await hasGpu();
      const steps = PIP(gpu);
      const names = ['음원 분리 (audio-separator)', '박자 분석 (Beat This!)', '채보 (Basic Pitch)', '오디오 도구', '악기별 채보 (MuScriptor)', 'PyTorch'];
      for (let i = 0; i < steps.length; i++) {
        send({ p: 0.05 + 0.9 * (i / steps.length), label: `${names[i]} 설치 중… (${i + 1}/${steps.length})` });
        const r = await run(VENV_PY(), ['-m', 'pip', 'install', '--disable-pip-version-check', ...steps[i]], {}, (l) => { if (/^(Collecting|Downloading|Installing|Successfully)/.test(l)) send({ detail: l.slice(0, 110) }); });
        if (r.code) return { ok: false, message: `${names[i]}을(를) 설치하지 못했습니다: ${(r.err || r.out).split(/\r?\n/).filter(Boolean).slice(-2).join(' ').slice(-300)}` };
      }
      send({ p: 1, label: '설치를 마쳤습니다.' });
      return { ok: true, gpu };
    } finally { busy = null; }
  });

  // payload: { path } or { name, data } -> { ok, result } (result.stems are file paths)
  // payload: { path } or { name, data } -> { ok, result } (result.stems are file paths). Asking again
  // for the song that is already running (the window was closed and reopened) joins that run.
  const running = new Map(); // hash -> Promise of the reply
  ipcMain.handle('stems:run', async (e, payload) => {
    const py = python();
    if (!py) return { ok: false, error: 'no_engine', message: '분석 엔진을 먼저 설치해 주세요.' };
    const data = payload.data ? Buffer.from(payload.data) : await fsp.readFile(payload.path);
    const hash = crypto.createHash('sha1').update(data).update(payload.quick ? 'q' : 'f').update(`m:${payload.muscriptor || 'off'}`).digest('hex').slice(0, 16);
    if (running.has(hash)) return running.get(hash);
    if (busy) return { ok: false, error: 'busy', message: '다른 곡을 분석하고 있습니다. 끝날 때까지 기다려 주세요.' };
    const job = analyse(e, payload, py, data, hash);
    running.set(hash, job);
    try { return await job; } finally { running.delete(hash); }
  });

  async function analyse(e, payload, py, data, hash) {
    const send = (m) => { if (!e.sender.isDestroyed()) e.sender.send('stems:progress', m); };
    busy = 'run';
    try {
      const out = path.join(CACHE(), hash);
      const done = path.join(out, 'result.json');
      if (fs.existsSync(done)) {
        const res = JSON.parse(await fsp.readFile(done, 'utf8'));
        if (Object.values(res.stems).every((f) => fs.existsSync(f))) return { ok: true, result: res, cached: true };
      }
      await fsp.mkdir(out, { recursive: true });
      const ext = (payload.name || payload.path || '').match(/\.[a-z0-9]+$/i)?.[0] || '.bin';
      const input = path.join(out, `source${ext}`);
      await fsp.writeFile(input, data);
      let err = null, last = '';
      const args = [SCRIPT, '--input', input, '--out', out, '--models', MODELS(), '--ffmpeg', findFfmpeg() || 'ffmpeg', ...(payload.quick ? ['--quick'] : []), '--muscriptor', ['small', 'medium', 'large'].includes(payload.muscriptor) ? payload.muscriptor : 'off'];
      const token = payload.muscriptor && payload.muscriptor !== 'off' ? await readToken() : null;
      const r = await run(py, args, { env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', ...(token ? { HF_TOKEN: token } : {}) }, onSpawn: (p) => { child = p; } }, (l, isErr) => {
        if (isErr) { last = l; return; }
        try { const m = JSON.parse(l); if (m.error) err = m.error; else send(m); } catch { last = l; }
      });
      child = null;
      await fsp.rm(input, { force: true });
      if (r.code || !fs.existsSync(done)) return { ok: false, error: 'run', message: `분석하지 못했습니다: ${err || last || r.err.slice(-300)}` };
      return { ok: true, result: JSON.parse(await fsp.readFile(done, 'utf8')) };
    } finally { busy = null; }
  }

  ipcMain.handle('stems:cancel', () => { try { child?.kill(); } catch { /* gone */ } return true; });
  ipcMain.handle('stems:read', async (_e, file) => {
    // only files inside the cache
    const f = path.resolve(file);
    if (!f.startsWith(path.resolve(CACHE()))) return null;
    return new Uint8Array(await fsp.readFile(f));
  });
}

module.exports = { register };
