'use strict';
// One-click install of the song analysis engine, with no Python on the computer beforehand.
//
// Everything goes into userData/stems-engine (no admin rights, no PATH or registry changes):
//   uv/uv.exe        astral-sh/uv, the package installer (one exe, pinned version, SHA256 checked)
//   python/          a relocatable CPython 3.12 (python-build-standalone "install_only", SHA256 checked)
//   venv/            the virtual environment the analysis runs in (same place as before, so engines
//                    installed with an older MeloFi and a system Python keep working untouched)
//   cache/           uv's package cache (hard-linked into venv on the same drive: no extra space)
//   models/          model files, downloaded on first use (kept by a reinstall)
//   engine.json      what was installed: engine version, GPU/CPU build, Python, uv
//   install.log      the full log of the last install / update (named in every error message)
//
// The packages come from lock files in tools/stems/engine (exact versions and SHA256 hashes,
// generated with `uv pip compile`), so every install gets the set that was tested. See
// docs/engine-install.md for the design and how to regenerate the locks.
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const crypto = require('node:crypto');
const { t, tdyn } = require('./i18n-main.js');
const { spawn } = require('node:child_process');

const ENGINE = {
  version: 2, // bump when a lock file changes: installed engines then offer "엔진 업데이트"
  uv: {
    version: '0.13.7',
    url: 'https://github.com/astral-sh/uv/releases/download/0.13.7/uv-x86_64-pc-windows-msvc.zip',
    sha256: '0cdc5b38fe5a8168ed6a25814f5ba43c21d313dd3187314fccb37b7cec46e021',
    size: 15236317,
  },
  python: {
    version: '3.12.16',
    url: 'https://github.com/astral-sh/python-build-standalone/releases/download/20261110/cpython-3.12.16%2B20261110-x86_64-pc-windows-msvc-install_only.tar.gz',
    sha256: 'e23fe5b16926de1d81661b1a97352e89fb167549c55a6825796ccd0f32ec7f1b',
    size: 47438699,
  },
  needBytes: 6 * 1024 ** 3, // free space asked for before starting (install ~5 GB unpacked + models)
  // what the package stage writes to disk, for its progress bar (measured; see docs/engine-install.md)
  unpacked: { gpu: 4.9 * 1024 ** 3, cpu: 1.9 * 1024 ** 3 },
  minDriver: 528, // NVIDIA driver for the CUDA 12.8 build (older drivers get the CPU build)
};

const GB = (b) => `${(b / 1024 ** 3).toFixed(1)} GB`;
const MB = (b) => `${Math.round(b / 1024 ** 2)} MB`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Renaming a folder right after writing it fails on Windows while the virus scanner (or the search
// indexer) still has its new files open (EPERM / EACCES / EBUSY): try again for a while, then copy.
async function moveDir(from, to) {
  for (let i = 0; ; i++) {
    try { await fsp.rename(from, to); return; } catch (e) {
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(e.code)) throw e;
      if (i >= 20) break;
      await sleep(500 + i * 250);
    }
  }
  await fsp.cp(from, to, { recursive: true, force: true, errorOnExist: false });
  await fsp.rm(from, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }).catch(() => {});
}
// bytes a process has written to disk so far, every 1.5 s (Win32_Process.WriteTransferCount)
function watchWrites(pid, onBytes) {
  if (process.platform !== 'win32' || !pid) return () => {};
  const loop = `while ($true) { $p = Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}' -ErrorAction SilentlyContinue; if (-not $p) { break }; [Console]::Out.WriteLine($p.WriteTransferCount); Start-Sleep -Milliseconds 1500 }`;
  const ps = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', loop], { windowsHide: true });
  ps.on('error', () => {});
  ps.stdout.on('data', (b) => { const n = Number(String(b).trim().split(/s+/).pop()); if (Number.isFinite(n) && n >= 0) onBytes(n); });
  return () => { try { ps.kill(); } catch { /* gone */ } };
}
const rmDir = (p) => fsp.rm(p, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });

class Cancelled extends Error { constructor() { super(t('취소했습니다.')); this.cancelled = true; } }
class InstallError extends Error {}

function createInstaller({ root, scriptDir, run, models }) {
  const P = {
    uv: () => path.join(root(), 'uv', 'uv.exe'),
    python: () => path.join(root(), 'python', 'python.exe'),
    venv: () => path.join(root(), 'venv'),
    venvPy: () => path.join(root(), 'venv', 'Scripts', 'python.exe'),
    cache: () => path.join(root(), 'cache'),
    downloads: () => path.join(root(), 'downloads'),
    manifest: () => path.join(root(), 'engine.json'),
    log: () => path.join(root(), 'install.log'),
    lock: (gpu) => path.join(scriptDir, 'engine', gpu ? 'lock-gpu.txt' : 'lock-cpu.txt'),
    nodeps: () => path.join(scriptDir, 'engine', 'nodeps.txt'),
    selftest: () => path.join(scriptDir, 'engine', 'selftest.py'),
  };

  // a clean environment for everything the install runs: the user's own Python / pip / uv settings
  // (PYTHONHOME, PIP_INDEX_URL, a uv.toml, an active venv…) must not leak in
  const cleanEnv = () => {
    const env = {};
    for (const [k, v] of Object.entries(process.env)) if (!/^(PYTHON|PIP_|UV_|VIRTUAL_ENV|CONDA)/i.test(k)) env[k] = v;
    return {
      ...env,
      PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', PYTHONNOUSERSITE: '1',
      UV_CACHE_DIR: P.cache(), UV_NO_CONFIG: '1', UV_PYTHON_DOWNLOADS: 'never',
      UV_HTTP_TIMEOUT: '300', UV_HTTP_RETRIES: '8', UV_CONCURRENT_DOWNLOADS: '4',
      UV_NATIVE_TLS: '1', // Windows' certificate store: works behind company / antivirus proxies
      UV_NO_PROGRESS: '1',
      UV_COMPILE_BYTECODE: '1', // .pyc made during the install: the first analysis does not wait minutes on imports
    };
  };

  async function readManifest() {
    try { return JSON.parse(await fsp.readFile(P.manifest(), 'utf8')); } catch { return null; }
  }

  // nvidia-smi: the card and its driver. The CUDA 12.8 build needs driver 528+ (RTX 50-series need 570+
  // to work at all, so they always have it); everything else gets the CPU build.
  async function detectGpu() {
    const r = await run('nvidia-smi', ['--query-gpu=name,driver_version,memory.total', '--format=csv,noheader,nounits']);
    if (r.code !== 0) return { gpu: false, why: t('NVIDIA GPU를 찾지 못했어요') };
    const [name, driver, mem] = r.out.trim().split(/\r?\n/)[0].split(',').map((x) => x.trim());
    const major = parseInt(driver, 10) || 0;
    if (major < ENGINE.minDriver) return { gpu: false, name, driver, why: t('{name}의 드라이버 {driver}가 오래돼 CPU용으로 설치해요 (드라이버 {min} 이상이면 GPU용)', { name, driver, min: ENGINE.minDriver }) };
    return { gpu: true, name, driver, memMB: +mem };
  }

  async function freeBytes(dir) {
    try { const s = await fsp.statfs(dir); return s.bavail * s.bsize; } catch { return null; }
  }

  // ---- downloads: resumable (.part + Range), retried with backoff, stall-checked, SHA256-verified ----
  async function sha256(file) {
    const h = crypto.createHash('sha256');
    for await (const b of fs.createReadStream(file)) h.update(b);
    return h.digest('hex');
  }
  let netFetch = null;
  try { const { net } = require('electron'); if (net?.fetch) netFetch = (u, o) => net.fetch(u, o); } catch { /* plain node */ }
  const doFetch = (u, o) => (netFetch || fetch)(u, o); // Chromium's network stack: system proxy and certificates

  async function download({ url, sha256: want, size }, dest, { onProgress, signal, log }) {
    const part = `${dest}.part`;
    if (fs.existsSync(dest) && (await sha256(dest)) === want) return dest;
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    let lastErr = null;
    for (let attempt = 1; attempt <= 8; attempt++) {
      if (signal.aborted) throw new Cancelled();
      let have = 0;
      try { have = (await fsp.stat(part)).size; } catch { /* fresh */ }
      if (size && have > size) { await fsp.rm(part, { force: true }); have = 0; }
      const ctl = new AbortController();
      const onAbort = () => ctl.abort();
      signal.addEventListener('abort', onAbort);
      let stall = null;
      const kick = () => { clearTimeout(stall); stall = setTimeout(() => ctl.abort(), 45000); };
      try {
        if (have < size || !size) {
          kick();
          const res = await doFetch(url, { headers: have ? { Range: `bytes=${have}-` } : {}, signal: ctl.signal, redirect: 'follow', cache: 'no-store' });
          if (res.status === 416) { await fsp.rm(part, { force: true }); throw new Error('HTTP 416'); }
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          if (have && res.status !== 206) have = 0; // the server ignored the range: start over
          const total = size || (have + (+res.headers.get('content-length') || 0));
          const fh = await fsp.open(part, have ? 'a' : 'w');
          try {
            for await (const chunk of res.body) {
              kick();
              await fh.write(chunk);
              have += chunk.length;
              onProgress?.(have, total);
            }
          } finally { await fh.close(); }
        }
        clearTimeout(stall);
        const got = await sha256(part);
        if (got !== want) { await fsp.rm(part, { force: true }); throw new Error(`SHA256 불일치 (${got.slice(0, 12)}…)`); }
        await fsp.rm(dest, { force: true });
        await moveDir(part, dest);
        return dest;
      } catch (e) {
        clearTimeout(stall);
        if (signal.aborted) throw new Cancelled();
        lastErr = e;
        const wait = Math.min(30, 2 ** attempt);
        log(`다운로드 실패 (${attempt}/8): ${e.message} — ${wait}초 뒤 이어받기`);
        await sleep(wait * 1000);
      } finally { signal.removeEventListener('abort', onAbort); }
    }
    throw new InstallError(t('{file}을(를) 받지 못했습니다: {why}', { file: path.basename(dest), why: lastErr?.message }));
  }

  const TAR = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'); // bsdtar: zip and tar.gz
  async function extract(archive, into, log) {
    await rmDir(into);
    await fsp.mkdir(into, { recursive: true });
    const r = await run(TAR, ['-xf', archive, '-C', into]);
    if (r.code) { log(r.err); throw new InstallError(t('압축을 풀지 못했습니다: {why}', { why: (r.err || '').trim().slice(-200) })); }
  }

  // ---- the install ----
  // mode: 'install' (nothing there yet, or finishing a stopped install), 'reinstall' (start over with
  // the bundled Python; the old engine is kept aside until the new one passes its self-test),
  // 'update' (apply this MeloFi's lock to the existing venv: only changed packages are touched).
  async function install(mode, { send, signal, setChild }) {
    await fsp.mkdir(root(), { recursive: true });
    const logFile = P.log();
    await fsp.writeFile(logFile, `MeloFi 엔진 ${mode} ${new Date().toISOString()}\n`); // i18n-ignore (the install log)
    const log = (t) => { fs.appendFile(logFile, `${t}\n`, () => {}); send({ log: t }); };
    const times = {};
    const stages = [];
    let at = 0;
    const plan = (list) => { stages.splice(0, stages.length, ...list); };
    // overall progress: every stage gets a share by its expected time
    const stage = (key, label, frac = null, detail) => {
      const i = stages.findIndex((s) => s.key === key);
      const before = stages.slice(0, i).reduce((a, s) => a + s.w, 0), all = stages.reduce((a, s) => a + s.w, 0);
      const p = (before + stages[i].w * (frac ?? 0)) / all;
      send({ p: Math.min(0.999, p), label: `${i + 1}/${stages.length} ${label}`, ...(frac == null ? {} : { stage: frac }), ...(detail ? { detail } : {}) });
    };
    const timed = async (key, fn) => { const t = Date.now(); if (signal.aborted) throw new Cancelled(); try { return await fn(); } finally { times[key] = Math.round((Date.now() - t) / 100) / 10; log(`· ${key}: ${times[key]}s`); } };

    // run uv / python, the log in install.log and the window; the process can be cancelled
    const spawnLogged = (cmd, args, onLine, onSpawn) => new Promise((resolve) => {
      log(`> ${path.basename(cmd)} ${args.join(' ')}`);
      const p = spawn(cmd, args, { windowsHide: true, env: cleanEnv(), cwd: root() });
      setChild(p);
      onSpawn?.(p);
      let tail = [];
      const feed = (isErr) => { let buf = ''; return (b) => { buf += b.toString(); const parts = buf.split(/\r\n|\r|\n/); buf = parts.pop(); for (const l of parts) if (l.trim()) { tail = [...tail.slice(-11), l.trim()]; if (!/^\{"(log|label|p)"/.test(l)) fs.appendFile(logFile, `${l}\n`, () => {}); onLine?.(l.trim(), isErr); } }; };
      p.stdout.on('data', feed(false)); p.stderr.on('data', feed(true));
      p.on('error', (e) => { setChild(null); resolve({ code: -1, tail: [String(e.message)] }); });
      p.on('close', (code) => { setChild(null); resolve({ code, tail }); });
    });
    const fail = (what, r) => {
      if (signal.aborted) throw new Cancelled();
      const why = r.tail.filter((l) => /error|failed|×|오류|denied|No space|timed out|connect/i.test(l)).slice(-3).join(' / ') || r.tail.slice(-2).join(' / ');
      throw new InstallError(`${what}: ${why.slice(0, 400)}`);
    };

    const gpuInfo = await detectGpu();
    const gpu = gpuInfo.gpu;
    const had = fs.existsSync(P.venvPy());
    const old = await readManifest();
    if (mode === 'update' && !had) mode = 'install';
    const fresh = mode !== 'update';
    plan([
      { key: 'check', w: 1 },
      { key: 'uv', w: 2 },
      ...(fresh ? [{ key: 'python', w: 4 }, { key: 'venv', w: 1 }] : []),
      { key: 'packages', w: gpu ? 60 : 30 },
      { key: 'selftest', w: fs.existsSync(path.join(models(), 'model_bs_roformer_ep_317_sdr_12.9755.ckpt')) ? 4 : 25 },
    ]);
    log(`GPU: ${gpu ? `${gpuInfo.name} (드라이버 ${gpuInfo.driver}) → CUDA 12.8용 PyTorch` : `${gpuInfo.why} → CPU용 PyTorch`}`);

    // 1. room on the disk
    await timed('check', async () => {
      stage('check', t('디스크 공간과 GPU를 확인하는 중'));
      const free = await freeBytes(root());
      log(`빈 공간: ${free == null ? '알 수 없음' : GB(free)} (${root()})`);
      const need = fresh ? ENGINE.needBytes : 2 * 1024 ** 3;
      if (free != null && free < need) throw new InstallError(t('디스크 공간이 모자랍니다: {free} 남음, {need} 필요 ({drive} 드라이브). 공간을 비운 뒤 다시 눌러 주세요.', { free: GB(free), need: GB(need), drive: path.parse(root()).root }));
    });

    // 2. uv (also for engines installed with pip before: an update uses it too)
    await timed('uv', async () => {
      const ok = fs.existsSync(P.uv()) && (await run(P.uv(), ['--version'])).out.includes(ENGINE.uv.version);
      if (ok) return;
      const label = t('설치 도구 uv 받는 중 ({size})', { size: MB(ENGINE.uv.size) });
      stage('uv', label, 0);
      const zip = await download(ENGINE.uv, path.join(P.downloads(), 'uv.zip'), { signal, log, onProgress: (n, t) => stage('uv', label, n / t, `${MB(n)} / ${MB(t)}`) });
      await extract(zip, path.join(root(), 'uv'), log);
      if (!fs.existsSync(P.uv())) throw new InstallError(t('uv.exe를 찾지 못했습니다.'));
    });

    let backup = null;
    try {
      if (fresh) {
        // 3. the bundled Python
        await timed('python', async () => {
          const have = fs.existsSync(P.python()) && (await run(P.python(), ['-c', 'import sys; print(sys.version.split()[0])'], { env: cleanEnv() })).out.trim() === ENGINE.python.version;
          if (have && mode !== 'reinstall') return;
          const label = t('Python {version} 받는 중 ({size})', { version: ENGINE.python.version, size: MB(ENGINE.python.size) });
          stage('python', label, 0);
          const tgz = await download(ENGINE.python, path.join(P.downloads(), 'python.tar.gz'), { signal, log, onProgress: (n, t) => stage('python', label, n / t, `${MB(n)} / ${MB(t)}`) });
          stage('python', t('Python 압축을 푸는 중'), 1);
          const tmp = path.join(root(), 'python.new');
          await extract(tgz, tmp, log); // the archive holds python/
          await fsp.rm(path.join(root(), 'python'), { recursive: true, force: true });
          await moveDir(path.join(tmp, 'python'), path.join(root(), 'python'));
          await rmDir(tmp);
          const v = await run(P.python(), ['-c', 'import sys, venv, ssl; print(sys.version.split()[0])'], { env: cleanEnv() });
          if (v.out.trim() !== ENGINE.python.version) throw new InstallError(t('받은 Python이 실행되지 않습니다: {why}', { why: (v.err || v.out).slice(-200) }));
        });

        // 4. the venv (a reinstall moves the old one aside first: restored if anything below fails)
        await timed('venv', async () => {
          stage('venv', t('가상 환경을 만드는 중'));
          // a stopped install on the bundled Python is finished in place; anything else (a reinstall, an
          // older engine on the computer's own Python that no longer works) is set aside and rebuilt
          const cfg = had ? await fsp.readFile(path.join(P.venv(), 'pyvenv.cfg'), 'utf8').catch(() => '') : '';
          const ours = cfg.toLowerCase().includes(path.join(root(), 'python').toLowerCase());
          if (had && (mode === 'reinstall' || !ours)) {
            backup = path.join(root(), 'venv.old');
            await rmDir(backup);
            await moveDir(P.venv(), backup);
            log('기존 엔진을 venv.old로 옮겨 두었습니다 (새 엔진이 점검을 통과하면 지웁니다).');
          }
          if (fs.existsSync(P.venvPy())) return;
          // --seed: pip inside the venv too, for anyone who wants to add a package by hand
          const r = await spawnLogged(P.uv(), ['venv', '--python', P.python(), '--seed', P.venv()]);
          if (r.code) fail(t('가상 환경을 만들지 못했습니다'), r);
        });
      } else {
        // an update needs Python 3.12 (the locks are made for it); older engines on 3.10 / 3.11 reinstall
        const v = await run(P.venvPy(), ['-c', 'import sys; print("%d.%d" % sys.version_info[:2])'], { env: cleanEnv() });
        if (v.out.trim() !== '3.12') throw new InstallError(t('지금 엔진은 Python {version}(으)로 만들어져 업데이트할 수 없습니다. "엔진 다시 설치"를 눌러 주세요.', { version: v.out.trim() || '?' }));
      }

      // 5. the packages: the whole lock in one go (uv downloads in parallel and only changes what differs)
      await timed('packages', async () => {
        const label = gpu ? t('분석 패키지 설치 중 (GPU용 PyTorch 포함 약 3 GB)') : t('분석 패키지 설치 중 (약 1 GB)');
        stage('packages', label, 0);
        // progress: what uv has written to disk so far (Windows' per-process I/O counter, read by one
        // PowerShell loop for the whole stage) against the measured total; other programs writing at the
        // same time do not count. uv's own "Downloading torch (2.4GiB)" lines go in the detail.
        const want = ENGINE.unpacked[gpu ? 'gpu' : 'cpu'];
        const pending = new Map(); let current = '', written = 0, stopWatch = () => {};
        const show = () => stage('packages', label, Math.min(0.97, written / want), `${current ? `${current} · ` : ''}${t('{done} / 약 {total}', { done: GB(written), total: GB(want) })}`);
        try {
          const args = ['pip', 'install', '--python', P.venvPy(), '--torch-backend', gpu ? 'cu128' : 'cpu', '--require-hashes', '-r', P.lock(gpu)];
          // a GPU build replacing a CPU one (or the reverse) needs the torch packages swapped, not kept
          if (!fresh && old && old.gpu !== gpu) args.push('--reinstall-package', 'torch', '--reinstall-package', 'torchaudio', '--reinstall-package', 'torchvision');
          if (!fresh && !old) args.push('--reinstall-package', 'torch', '--reinstall-package', 'torchaudio', '--reinstall-package', 'torchvision'); // pip-era engine: make torch match the lock's build exactly
          const names = () => [...pending].map(([k, v]) => `${k} ${v}`).join(', ');
          const r = await spawnLogged(P.uv(), args, (l) => {
            let m;
            if ((m = /^Downloading (\S+) \(([^)]+)\)/.exec(l))) { pending.set(m[1], m[2]); current = t('{names} 받는 중', { names: names() }); }
            else if ((m = /^Downloaded (\S+)/.exec(l))) { pending.delete(m[1]); current = pending.size ? t('{names} 받는 중', { names: names() }) : ''; }
            else if (/^Prepared /.test(l)) { current = t('설치하고 미리 컴파일하는 중'); log(l); }
            else if (/^(Resolved|Installed|Uninstalled|Audited|Bytecode) /.test(l)) { log(l); return; }
            else return;
            show();
          }, (p) => { stopWatch = watchWrites(p.pid, (n) => { written = n; show(); }); });
          stopWatch();
          log(`uv가 디스크에 쓴 양: ${GB(written)}`);
          if (r.code) fail(t('분석 패키지를 설치하지 못했습니다'), r);
          const r2 = await spawnLogged(P.uv(), ['pip', 'install', '--python', P.venvPy(), '--no-deps', '--require-hashes', '-r', P.nodeps()]);
          if (r2.code) fail(t('Basic Pitch를 설치하지 못했습니다'), r2);
        } finally { stopWatch(); }
      });

      // 6. self-test: every import, the GPU, a 2-second separation and a Basic Pitch run
      let summary = null;
      await timed('selftest', async () => {
        stage('selftest', t('자체 점검 중 (첫 설치는 분리 모델 약 640 MB를 받아요)'), 0);
        let err = null;
        const work = path.join(root(), 'selftest');
        const r = await spawnLogged(P.venvPy(), [P.selftest(), '--models', models(), '--work', work, ...(gpu ? ['--gpu'] : [])], (l, isErr) => {
          if (isErr) {
            const pct = /(\d{1,3})%\|/.exec(l);
            if (pct) stage('selftest', t('자체 점검: 분리 모델 받는 중'), Math.min(1, +pct[1] / 100) * 0.9);
            return;
          }
          try {
            const m = JSON.parse(l);
            if (m.error) { err = m.error; log(`오류: ${m.error}`); } else if (m.log) log(m.log);
            else if (m.ok) summary = m;
            else if (m.label) stage('selftest', t('자체 점검: {label}', { label: t(m.label) }), m.p);
          } catch { /* plain output */ }
        });
        await rmDir(work).catch(() => {});
        if (r.code || !summary) { if (signal.aborted) throw new Cancelled(); throw new InstallError(t('자체 점검에 실패했습니다: {why}', { why: tdyn(err) || r.tail.slice(-2).join(' / ') })); }
      });

      if (backup) { await rmDir(backup).catch(() => {}); backup = null; }
      await rmDir(P.downloads()).catch(() => {});
      const pyv = (await run(P.venvPy(), ['-c', 'import sys; print(sys.version.split()[0])'], { env: cleanEnv() })).out.trim();
      const manifest = { version: ENGINE.version, gpu, torch: summary.torch, cuda: summary.cuda, gpuName: summary.gpu || null, python: pyv, bundledPython: fresh || !!old?.bundledPython, uv: ENGINE.uv.version, installedAt: new Date().toISOString(), times };
      await fsp.writeFile(P.manifest(), JSON.stringify(manifest, null, 2));
      log(`완료: ${JSON.stringify(times)}`);
      send({ p: 1, label: mode === 'update' ? t('엔진을 업데이트했습니다.') : t('설치를 마쳤습니다.'), stage: 1 });
      return { ok: true, gpu, times, summary };
    } catch (e) {
      // a reinstall that did not finish: the old engine comes back
      if (backup && fs.existsSync(backup)) {
        await rmDir(P.venv()).catch(() => {});
        await moveDir(backup, P.venv()).then(() => log('기존 엔진을 되돌려 놓았습니다.')).catch((x) => log(`기존 엔진을 되돌리지 못했습니다: ${x.message}`));
      }
      throw e;
    }
  }

  // engine.json for the status: managed (installed this way) and whether this MeloFi has a newer lock
  async function info() {
    const m = await readManifest();
    return { managed: !!m, engineVersion: m?.version || 0, updatable: !!m && m.version < ENGINE.version, build: m ? (m.gpu ? 'gpu' : 'cpu') : null };
  }

  return { install, info, paths: P, logFile: P.log };
}

module.exports = { createInstaller, ENGINE, Cancelled, InstallError };
