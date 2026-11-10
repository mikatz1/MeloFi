'use strict';
// Vocal engine (main process): sings a MusicXML melody with lyrics through NNSVS, an open-source
// singing synthesizer, and returns the WAV. The engine lives in userData/vocal-engine (a Python
// virtual environment plus the downloaded voice models); MELOFI_VOCAL_PYTHON can point at another
// Python that already has nnsvs installed.
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const { spawn } = require('node:child_process');

const VOICES = {
  'r9y9/yoko_latest': { name: 'Yoko', lang: 'ja', note: '일본어 여성 보이스 · NNSVS 공개 모델 (나고야공업대 공개 가창 데이터로 학습)' },
};

function run(cmd, args, opts = {}, onLine = () => {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { windowsHide: true, ...opts });
    let out = '', err = '';
    const feed = (buf, isErr) => {
      const s = buf.toString();
      if (isErr) err += s; else out += s;
      for (const l of s.split(/\r?\n/)) if (l.trim()) onLine(l.trim());
    };
    p.stdout.on('data', (b) => feed(b, false));
    p.stderr.on('data', (b) => feed(b, true));
    p.on('error', (e) => resolve({ code: -1, out, err: String(e.message) }));
    p.on('close', (code) => resolve({ code, out, err }));
  });
}

function register(ipcMain, { app }) {
  const ROOT = () => path.join(app.getPath('userData'), 'vocal-engine');
  const VENV_PY = () => path.join(ROOT(), 'venv', 'Scripts', 'python.exe');
  const MODELS = () => path.join(ROOT(), 'models');
  const SCRIPT = path.join(__dirname, 'tools', 'vocal', 'svs_render.py').replace('app.asar', 'app.asar.unpacked');
  const python = () => {
    const env = process.env.MELOFI_VOCAL_PYTHON;
    if (env && fs.existsSync(env)) return env;
    return fs.existsSync(VENV_PY()) ? VENV_PY() : null;
  };
  let busy = null;

  ipcMain.handle('vocal:status', async () => {
    const py = python();
    const voices = Object.keys(VOICES).map((id) => ({ id, ...VOICES[id], downloaded: fs.existsSync(path.join(MODELS(), id)) }));
    if (!py) return { ready: false, voices };
    // find_spec, not import: importing torch takes several seconds
    const r = await run(py, ['-c', 'import importlib.util as u, sys; sys.exit(0 if u.find_spec("nnsvs") and u.find_spec("pysinsy") else 1)']);
    return { ready: r.code === 0, python: py, voices, busy: !!busy, error: r.code === 0 ? null : (r.err.split('\n').filter(Boolean).pop() || '').slice(0, 200) };
  });

  // One-time install: a virtual environment with nnsvs. pysinsy is compiled from source, which needs
  // the Microsoft C++ Build Tools, so pip runs inside their environment when they are present.
  ipcMain.handle('vocal:setup', async (e) => {
    if (busy) return { ok: false, message: '이미 설치하고 있습니다.' };
    const send = (line) => { if (!e.sender.isDestroyed()) e.sender.send('vocal:progress', line); };
    busy = 'setup';
    try {
      let base = null;
      for (const [cmd, args] of [['py', ['-3.12']], ['py', ['-3.11']], ['py', ['-3.10']], ['python', []]]) {
        const r = await run(cmd, [...args, '-c', 'import sys; print(sys.executable); print((3, 10) <= sys.version_info[:2] <= (3, 12))']);
        if (r.code === 0 && /True/.test(r.out)) { base = r.out.split(/\r?\n/)[0].trim(); break; }
      }
      if (!base) return { ok: false, message: 'Python 3.10~3.12가 필요합니다. python.org에서 설치한 뒤 다시 눌러 주세요.' };
      await fsp.mkdir(ROOT(), { recursive: true });
      send('가상 환경을 만드는 중…');
      if (!fs.existsSync(VENV_PY())) {
        const r = await run(base, ['-m', 'venv', path.join(ROOT(), 'venv')]);
        if (r.code) return { ok: false, message: `가상 환경을 만들지 못했습니다: ${r.err.slice(-200)}` };
      }
      const vswhere = path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
      let vcvars = null;
      if (fs.existsSync(vswhere)) {
        const r = await run(vswhere, ['-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath']);
        const p = r.out.trim().split(/\r?\n/)[0];
        if (p && fs.existsSync(path.join(p, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat'))) vcvars = path.join(p, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat');
      }
      send('NNSVS를 설치하는 중… (몇 분 걸립니다)');
      const bat = path.join(os.tmpdir(), `melofi-vocal-setup-${process.pid}.bat`);
      await fsp.writeFile(bat, [
        '@echo off',
        `set PATH=${path.dirname(vswhere)};%PATH%`,
        vcvars ? `call "${vcvars}" >nul` : '',
        'set DISTUTILS_USE_SDK=1',
        `"${VENV_PY()}" -m pip install --disable-pip-version-check nnsvs h5py "setuptools<81"`,
      ].join('\r\n'));
      const r = await run('cmd.exe', ['/d', '/c', bat], {}, (l) => { if (/^(Collecting|Building|Installing|Successfully)/.test(l)) send(l.slice(0, 120)); });
      await fsp.rm(bat, { force: true });
      if (r.code) {
        const tail = (r.out + r.err).split(/\r?\n/).filter(Boolean).slice(-4).join(' ');
        return { ok: false, message: vcvars ? `설치하지 못했습니다: ${tail.slice(-300)}` : 'pysinsy를 빌드하려면 Microsoft C++ Build Tools가 필요합니다. 설치한 뒤 다시 눌러 주세요.' };
      }
      send('설치를 마쳤습니다.');
      return { ok: true };
    } finally { busy = null; }
  });

  // payload: { xml, voice } -> { ok, wav: Uint8Array, seconds }
  ipcMain.handle('vocal:render', async (e, payload) => {
    const py = python();
    if (!py) return { ok: false, error: 'no_engine', message: '보컬 엔진을 먼저 설치해 주세요.' };
    if (busy) return { ok: false, error: 'busy', message: '다른 작업이 끝날 때까지 기다려 주세요.' };
    const voice = VOICES[payload.voice] ? payload.voice : 'r9y9/yoko_latest';
    busy = 'render';
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'melofi-vocal-'));
    try {
      const xml = path.join(dir, 'in.musicxml'), out = path.join(dir, 'out.wav');
      await fsp.writeFile(xml, payload.xml, 'utf8');
      await fsp.mkdir(MODELS(), { recursive: true });
      if (!e.sender.isDestroyed()) e.sender.send('vocal:progress', fs.existsSync(path.join(MODELS(), voice)) ? '노래를 만드는 중…' : '보이스 모델을 받는 중… (처음 한 번, 약 47 MB)');
      const r = await run(py, [SCRIPT, xml, out, '--model', voice, '--models-dir', MODELS()], { env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
      const last = r.out.trim().split(/\r?\n/).pop() || '';
      let res = null;
      try { res = JSON.parse(last); } catch { /* a traceback instead of the result line */ }
      if (!res?.ok) return { ok: false, error: 'render', message: `노래를 만들지 못했습니다: ${res?.error || (r.err.split('\n').filter(Boolean).pop() || '').slice(0, 300)}` };
      return { ok: true, wav: new Uint8Array(await fsp.readFile(out)), seconds: res.seconds };
    } finally {
      busy = null;
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });
}

module.exports = { register, VOICES };
