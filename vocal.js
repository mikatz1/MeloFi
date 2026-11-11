'use strict';
// Singing voices (main process). Notes + one syllable per note -> WAV, through two open-source engines:
//  - NNSVS models (PyTorch): Yoko
//  - DiffSinger voicebanks in OpenUtau format (ONNX): Namine Ritsu, PJS, Hoshino Hanami
// and lyrics recognition from a sung recording (faster-whisper).
//
// Everything runs in the analysis engine's Python (userData/stems-engine, PyTorch + ONNX Runtime on
// the GPU when there is one); "보컬 구성 요소" adds the few packages singing needs to it. The older
// vocal-only environment (userData/vocal-engine, NNSVS on the CPU) still works for the NNSVS voices.
// Voices are downloaded from their authors' own pages into userData/vocal-engine/voices/<id>, with the
// licence text next to each one. Voice files are data: checkpoints are scanned before loading and
// never unpickled with code (tools/vocal/safe_models.py), and scripts bundled in voicebanks never run.
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const { spawn } = require('node:child_process');

const { t } = require('./i18n-main.js');
const N_ = (s) => s; // marks Korean shown by the window, which translates it (docs/i18n.md)

const MB = 1024 * 1024;
// use: 'commercial' (songs may be sold), 'noncommercial' (vocoder or voice licence forbids it), 'unverified'
const VOICES = {
  ritsu: {
    name: N_('波音リツ (나미네 리츠)'), gender: 'male', genderNote: N_('중성적인 음색'), langs: ['ja'], engine: 'diffsinger', vocoder: 'pc_nsf_hifigan',
    url: 'https://www.canon-voice.com/voice/NamineRitsu_DiffSinger.zip', bytes: 421940274,
    use: 'noncommercial', credit: '波音リツ (canon-voice.com)', license: 'namine-ritsu.txt', licenseUrl: 'https://www.canon-voice.com/terms/',
    note: N_('DiffSinger v1.0.1 · 보이스는 상업 이용 가능, 보코더(OpenVPI)는 비상업 라이선스'),
  },
  pjs: {
    name: 'PJS', gender: 'male', langs: ['ja'], engine: 'diffsinger', vocoder: 'pc_nsf_hifigan',
    url: 'https://github.com/UtaUtaUtau/pjs-manual-labels/releases/download/diffsinger/PJS.DiffSinger.7z', bytes: 416384247,
    use: 'noncommercial', credit: 'PJS DiffSinger (UtaUtaUtau), PJS corpus (高道慎之介, 小口純矢)', license: 'pjs-diffsinger.txt',
    licenseUrl: 'https://github.com/UtaUtaUtau/pjs-manual-labels',
    note: N_('DiffSinger · 모델 CC BY-SA 4.0, 보코더(OpenVPI)는 비상업 라이선스'),
  },
  hanami: {
    name: N_('星乃ハナミ (호시노 하나미) ~AI❤dol~'), gender: 'female', langs: ['ko', 'ja', 'en'], engine: 'diffsinger',
    url: 'https://www.mediafire.com/file/ks3hpb5zldabo3s/Hoshino_Hanami_%257EAIdol%257E_for_DiffSinger_v1.0.zip/file', mediafire: true, bytes: 549903782,
    use: 'noncommercial', credit: 'Hoshino Hanami ~AI❤dol~ (Team L❤VE)', license: 'hoshino-hanami.txt', licenseUrl: 'https://lottev.moe/utau/voicebank-license/',
    note: N_('DiffSinger · 한국어 지원 · 보이스는 상업 가능하나 내장 보코더는 비상업 라이선스, 크레딧 필요'),
    speakers: { Root: N_('기본'), Fragrance: N_('힘있게'), Nectar: N_('부드럽게') },
  },
  yoko: {
    name: 'Yoko', gender: 'female', langs: ['ja'], engine: 'nnsvs',
    url: 'https://www.dropbox.com/s/k8mya65yt52m0ps/yoko_latest.tar.gz?dl=1', bytes: 49318603,
    use: 'unverified', credit: 'NNSVS yoko (r9y9)', license: 'yoko.txt', licenseUrl: 'https://github.com/nnsvs/nnsvs',
    note: N_('NNSVS 공개 모델 · 학습 데이터 라이선스 미확인 (개인 연습용)'),
  },
};
// shared parts some voices need
const PARTS = {
  pc_nsf_hifigan: {
    name: N_('OpenVPI PC-NSF-HiFiGAN 보코더'), url: 'https://github.com/openvpi/vocoders/releases/download/pc-nsf-hifigan-44.1k-hop512-128bin-2025.02/pc_nsf_hifigan_44.1k_hop512_128bin_2025.02.oudep',
    bytes: 52760610, license: 'openvpi-pc-nsf-hifigan.txt',
  },
  // English pronunciations for voices that sing English (BSD-2-Clause)
  cmudict: {
    name: N_('CMU 발음 사전'), url: 'https://raw.githubusercontent.com/cmusphinx/cmudict/master/cmudict.dict', bytes: 3618488, raw: 'cmudict.dict', license: 'cmudict.txt',
  },
};
const OLD_IDS = { 'r9y9/yoko_latest': 'yoko' };

// packages singing adds to the analysis engine. --no-deps so nothing it already has (PyTorch, ONNX
// Runtime GPU, NumPy) is swapped for another build; their own dependencies are listed here instead.
const COMPONENTS = [
  { label: N_('가사 인식 (faster-whisper)'), pip: ['--no-deps', 'faster-whisper', 'ctranslate2', 'av', 'tokenizers', 'huggingface_hub', 'tqdm'] },
  { label: N_('일본어 읽기 사전 (UniDic)'), pip: ['--no-deps', 'fugashi', 'unidic-lite'] },
  { label: N_('압축 해제 (7z)'), pip: ['--no-deps', 'py7zr', 'multivolumefile', 'inflate64', 'backports.zstd', 'pybcj', 'pyppmd', 'brotli', 'texttable', 'pycryptodomex'] },
  { label: 'NNSVS', pip: ['--no-deps', 'nnsvs==0.1.1', 'nnmnkwii==0.1.3', 'pysptk', 'pyworld', 'hydra-core', 'omegaconf', 'antlr4-python3-runtime==4.9.3', 'fastdtw', 'pyloudnorm', 'h5py', 'pysinsy==0.0.5'], build: true, optional: true },
];

function run(cmd, args, opts = {}, onLine = () => {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { windowsHide: true, ...opts });
    if (opts.onSpawn) opts.onSpawn(p);
    let out = '', err = '', buf = '';
    p.stdout.on('data', (b) => {
      const s = b.toString(); out += s; buf += s;
      let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (l) onLine(l, false); }
    });
    p.stderr.on('data', (b) => { const s = b.toString(); err += s; for (const l of s.split(/\r\n|\r|\n/)) if (l.trim()) onLine(l.trim(), true); });
    p.on('error', (e) => resolve({ code: -1, out, err: String(e.message) }));
    p.on('close', (code) => resolve({ code, out, err }));
  });
}
const lastJson = (text) => {
  const lines = String(text || '').trim().split(/\r?\n/).reverse();
  for (const l of lines) { try { const j = JSON.parse(l); if (j && typeof j === 'object' && 'ok' in j) return j; } catch { /* not JSON */ } }
  return null;
};

function register(ipcMain, { app }) {
  const ROOT = () => path.join(app.getPath('userData'), 'vocal-engine');
  const VOICE_DIR = () => path.join(ROOT(), 'voices');
  const STEMS_PY = () => path.join(app.getPath('userData'), 'stems-engine', 'venv', 'Scripts', 'python.exe');
  const STEMS_MODELS = () => path.join(app.getPath('userData'), 'stems-engine', 'models');
  const OLD_PY = () => path.join(ROOT(), 'venv', 'Scripts', 'python.exe');
  const TOOLS = path.join(__dirname, 'tools', 'vocal').replace('app.asar', 'app.asar.unpacked');
  const script = (n) => path.join(TOOLS, n);
  const env = { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' };
  let busy = null, child = null, dl = null;

  const exists = (p) => { try { return fs.existsSync(p); } catch { return false; } };
  const stemsPy = () => (process.env.MELOFI_VOCAL_PYTHON && exists(process.env.MELOFI_VOCAL_PYTHON) ? process.env.MELOFI_VOCAL_PYTHON : exists(STEMS_PY()) ? STEMS_PY() : null);

  // what each Python can do (cached until something is installed)
  let caps = null;
  const probe = async (py) => {
    if (!py) return {};
    const r = await run(py, ['-c', 'import importlib.util as u, json; print(json.dumps({m: bool(u.find_spec(m)) for m in ("onnxruntime","yaml","soundfile","faster_whisper","py7zr","fugashi","nnsvs","pysinsy","torch","librosa")}))'], { env });
    try { return JSON.parse(r.out.trim().split(/\r?\n/).pop()); } catch { return {}; }
  };
  const capabilities = async () => {
    if (caps) return caps;
    const py = stemsPy();
    const a = await probe(py);
    const old = exists(OLD_PY()) ? await probe(OLD_PY()) : {};
    caps = {
      python: py,
      diffsinger: !!(a.onnxruntime && a.yaml && a.soundfile),
      lyrics: !!(a.faster_whisper && a.torch),
      sevenzip: !!a.py7zr,
      kanji: !!a.fugashi,
      check: !!(a.librosa && a.soundfile),
      // NNSVS: in the analysis engine (GPU) when it is there, else the older CPU-only environment
      nnsvs: a.nnsvs && a.pysinsy ? py : old.nnsvs && old.pysinsy ? OLD_PY() : null,
      componentsMissing: !(a.faster_whisper && a.py7zr && a.fugashi && a.nnsvs && a.pysinsy),
    };
    return caps;
  };

  // ---------------------------------------------------------------- voices on disk
  const voicePath = (id) => path.join(VOICE_DIR(), path.basename(id));
  const partPath = (id) => path.join(VOICE_DIR(), '_parts', path.basename(id));
  const readMeta = (dir) => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'melofi-voice.json'), 'utf8')); } catch { return null; } };
  const installed = (id) => {
    const m = readMeta(voicePath(id));
    if (m) return { dir: path.join(voicePath(id), m.root || '.'), meta: m };
    // a Yoko model the older version downloaded
    const old = path.join(ROOT(), 'models', 'r9y9', 'yoko_latest');
    if (id === 'yoko' && exists(path.join(old, 'acoustic_model.pth'))) return { dir: old, meta: { root: '.' } };
    return null;
  };
  const partInstalled = (id) => (readMeta(partPath(id)) ? partPath(id) : null);

  // the folder inside an unpacked archive that holds the model
  const findRoot = async (dir, engine) => {
    const want = engine === 'nnsvs' ? 'acoustic_model.pth' : engine === 'vocoder' ? 'vocoder.yaml' : 'dsconfig.yaml';
    const walk = async (d, depth) => {
      if (exists(path.join(d, want)) && (engine !== 'diffsinger' || /acoustic/.test(await fsp.readFile(path.join(d, want), 'utf8')))) return d;
      if (depth > 3) return null;
      for (const e of await fsp.readdir(d, { withFileTypes: true })) {
        if (e.isDirectory()) { const r = await walk(path.join(d, e.name), depth + 1); if (r) return r; }
      }
      return null;
    };
    const r = await walk(dir, 0);
    return r ? path.relative(dir, r) || '.' : null;
  };

  // ---------------------------------------------------------------- download
  async function resolveUrl(v, signal) {
    if (!v.mediafire) return v.url;
    // MediaFire serves the file from a short-lived link written into the download page
    const r = await fetch(v.url, { signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
    const html = await r.text();
    const m = html.match(/href="(https:\/\/download\d+\.mediafire\.com\/[^"]+)"/);
    if (!m) throw new Error(t('다운로드 링크를 찾지 못했어요 (배포 페이지가 바뀌었을 수 있어요).'));
    return m[1];
  }
  async function download(url, file, total, signal, onBytes) {
    const r = await fetch(url, { signal, redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 MeloFi' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const len = +r.headers.get('content-length') || total;
    const out = fs.createWriteStream(file);
    let got = 0;
    try {
      for await (const c of r.body) {
        got += c.length;
        if (!out.write(c)) await new Promise((res) => out.once('drain', res));
        onBytes(got, len);
      }
    } finally { await new Promise((res) => out.end(res)); }
    if (len && got < len) throw new Error(t('다운로드가 중간에 끊겼어요.'));
    return got;
  }
  async function fetchAndUnpack(e, { id, url, bytes, dest, engine, label, licenseFile, from, span }) {
    const send = (m) => { if (!e.sender.isDestroyed()) e.sender.send('vocal:progress', { id, ...m }); };
    const tmp = path.join(VOICE_DIR(), `_dl-${path.basename(id)}`);
    await fsp.rm(tmp, { recursive: true, force: true });
    await fsp.mkdir(tmp, { recursive: true });
    const archive = path.join(tmp, 'archive');
    let last = 0;
    try {
      const real = await resolveUrl({ url, mediafire: /mediafire\.com/.test(url) }, dl.signal);
      await download(real, archive, bytes, dl.signal, (got, len) => {
        const now = Date.now();
        if (now - last < 150) return;
        last = now;
        send({ p: from + span * 0.85 * (got / (len || bytes)), label: t('{label} 받는 중… {got} / {total} MB', { label: t(label), got: Math.round(got / MB), total: Math.round((len || bytes) / MB) }), done: got, total: len || bytes });
      });
      send({ p: from + span * 0.88, label: t('{label} 압축 푸는 중…', { label: t(label) }) });
      const py = (await capabilities()).python;
      if (!py) throw new Error(t('분석 엔진(Python)이 없어서 압축을 풀 수 없어요.'));
      const unpack = path.join(tmp, 'x');
      const r = await run(py, ['-I', script('extract.py'), archive, unpack], { env, onSpawn: (p) => { child = p; } });
      child = null;
      const res = lastJson(r.out);
      if (!res?.ok) throw new Error(t('압축을 풀지 못했어요: {why}', { why: res?.error || r.err.slice(-200) }));
      const root = await findRoot(unpack, engine);
      if (!root) throw new Error(t('받은 파일에서 모델을 찾지 못했어요.'));
      // licence next to the voice: MeloFi's notes plus whatever the archive itself carries
      if (licenseFile) await fsp.copyFile(path.join(TOOLS, 'licenses', licenseFile), path.join(unpack, 'LICENSE-MeloFi.txt'));
      await fsp.writeFile(path.join(unpack, 'melofi-voice.json'), JSON.stringify({ id, root, url, installed: new Date().toISOString() }, null, 1));
      await fsp.rm(dest, { recursive: true, force: true });
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      await fsp.rename(unpack, dest);
    } finally {
      await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
    }
  }

  // ---------------------------------------------------------------- IPC
  ipcMain.handle('vocal:status', async (_e, opts = {}) => {
    if (opts.refresh) caps = null;
    const c = await capabilities();
    const voices = Object.entries(VOICES).map(([id, v]) => {
      const ins = installed(id);
      const needs = v.engine === 'nnsvs' ? !!c.nnsvs : c.diffsinger;
      return {
        id, name: v.name, gender: v.gender, genderNote: v.genderNote || '', langs: v.langs, engine: v.engine, use: v.use, credit: v.credit, note: v.note,
        licenseUrl: v.licenseUrl, bytes: v.bytes + (v.vocoder && !partInstalled(v.vocoder) ? PARTS[v.vocoder].bytes : 0),
        installed: !!ins, ready: !!ins && needs && (!v.vocoder || !!partInstalled(v.vocoder)), dir: ins?.dir || null,
        speakers: v.speakers || null,
      };
    });
    return {
      engine: !!c.python, python: c.python, diffsinger: c.diffsinger, nnsvs: !!c.nnsvs, lyrics: c.lyrics, componentsMissing: c.componentsMissing,
      voices, busy: busy || (dl ? 'download' : null),
    };
  });

  // add the packages singing needs to the analysis engine
  ipcMain.handle('vocal:setup', async (e) => {
    const py = stemsPy();
    if (!py) return { ok: false, message: t('먼저 AI 분석 엔진을 설치해 주세요 (AI 창 > 분석 엔진 설치).') };
    if (busy) return { ok: false, message: t('다른 작업이 끝날 때까지 기다려 주세요.') };
    const send = (m) => { if (!e.sender.isDestroyed()) e.sender.send('vocal:progress', { id: 'setup', ...m }); };
    busy = 'setup';
    const notes = [];
    try {
      // MSVC for pysinsy, which is built from source
      let vcvars = null;
      const vswhere = path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
      if (exists(vswhere)) {
        const r = await run(vswhere, ['-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath']);
        const p = r.out.trim().split(/\r?\n/)[0];
        if (p && exists(path.join(p, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat'))) vcvars = path.join(p, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat');
      }
      const steps = [...COMPONENTS];
      // GPU: ONNX Runtime's own CUDA libraries (pip wheels), so DiffSinger runs on the graphics card
      const gpu = (await run('nvidia-smi', ['-L'])).code === 0;
      if (gpu) {
        const v = await run(py, ['-c', 'import importlib.metadata as m; print(m.version("onnxruntime-gpu"))'], { env });
        const ver = v.code === 0 ? v.out.trim() : null;
        if (ver) steps.push({ label: N_('GPU 가속 (CUDA 라이브러리)'), pip: [`onnxruntime-gpu[cuda,cudnn]==${ver}`], optional: true });
      }
      for (let i = 0; i < steps.length; i++) {
        const s = steps[i];
        send({ p: 0.03 + 0.94 * (i / steps.length), label: t('{label} 설치 중… ({i}/{n})', { label: t(s.label), i: i + 1, n: steps.length }) });
        let r;
        if (s.build && vcvars) {
          const bat = path.join(os.tmpdir(), `melofi-vocal-${process.pid}.bat`);
          await fsp.writeFile(bat, ['@echo off', `call "${vcvars}" >nul`, 'set DISTUTILS_USE_SDK=1', `"${py}" -m pip install --disable-pip-version-check ${s.pip.map((x) => `"${x}"`).join(' ')}`].join('\r\n'));
          r = await run('cmd.exe', ['/d', '/c', bat], { env }, (l) => { if (/^(Collecting|Downloading|Building|Installing|Successfully)/.test(l)) send({ detail: l.slice(0, 110) }); });
          await fsp.rm(bat, { force: true });
        } else {
          r = await run(py, ['-m', 'pip', 'install', '--disable-pip-version-check', ...s.pip], { env }, (l) => { if (/^(Collecting|Downloading|Building|Installing|Successfully)/.test(l)) send({ detail: l.slice(0, 110) }); });
        }
        if (r.code) {
          const tail = (r.err || r.out).split(/\r?\n/).filter(Boolean).slice(-2).join(' ').slice(-240);
          if (!s.optional) return { ok: false, message: t('{label}을(를) 설치하지 못했어요: {why}', { label: t(s.label), why: tail }) };
          notes.push(s.build && !vcvars ? t('{label}: Microsoft C++ Build Tools가 있어야 설치돼요', { label: t(s.label) }) : `${t(s.label)}: ${tail}`);
        }
      }
      caps = null;
      send({ p: 1, label: t('설치를 마쳤어요.') });
      return { ok: true, notes };
    } finally { busy = null; }
  });

  ipcMain.handle('vocal:install', async (e, id) => {
    const v = VOICES[id];
    if (!v) return { ok: false, message: t('모르는 보이스예요.') };
    if (dl || busy) return { ok: false, message: t('다른 작업이 끝날 때까지 기다려 주세요.') };
    const c = await capabilities();
    if (!c.python) return { ok: false, message: t('먼저 AI 분석 엔진을 설치해 주세요.') };
    if (/\.7z$/.test(v.url) && !c.sevenzip) return { ok: false, message: t('먼저 \'보컬 구성 요소 설치\'를 눌러 주세요 (7z 압축 해제).') };
    dl = new AbortController();
    try {
      if (v.langs.includes('en') && !partInstalled('cmudict')) {
        const c = PARTS.cmudict, dir = partPath('cmudict');
        await fsp.mkdir(dir, { recursive: true });
        await download(c.url, path.join(dir, `${c.raw}.part`), c.bytes, dl.signal, () => {});
        await fsp.rename(path.join(dir, `${c.raw}.part`), path.join(dir, c.raw));
        await fsp.copyFile(path.join(TOOLS, 'licenses', c.license), path.join(dir, 'LICENSE-MeloFi.txt'));
        await fsp.writeFile(path.join(dir, 'melofi-voice.json'), JSON.stringify({ id: 'cmudict', root: '.', url: c.url }));
      }
      const part = v.vocoder && !partInstalled(v.vocoder) ? PARTS[v.vocoder] : null;
      const total = v.bytes + (part ? part.bytes : 0);
      if (part) await fetchAndUnpack(e, { id, url: part.url, bytes: part.bytes, dest: partPath(v.vocoder), engine: 'vocoder', label: N_('보코더'), licenseFile: part.license, from: 0, span: part.bytes / total });
      if (!installed(id) || readMeta(voicePath(id)) === null) {
        await fetchAndUnpack(e, { id, url: v.url, bytes: v.bytes, dest: voicePath(id), engine: v.engine, label: v.name.split(' (')[0], licenseFile: v.license, from: part ? part.bytes / total : 0, span: v.bytes / total });
      }
      if (!e.sender.isDestroyed()) e.sender.send('vocal:progress', { id, p: 1, label: t('설치를 마쳤어요.') });
      return { ok: true };
    } catch (err) {
      return { ok: false, cancelled: dl.signal.aborted, message: dl.signal.aborted ? t('취소했어요.') : t('설치하지 못했어요: {why}', { why: err.message || err }) };
    } finally { dl = null; }
  });

  ipcMain.handle('vocal:cancel', () => { dl?.abort(); try { child?.kill(); } catch { /* gone */ } return true; });

  ipcMain.handle('vocal:remove', async (_e, id) => {
    if (!VOICES[id]) return { ok: false };
    if (busy || dl) return { ok: false, message: t('다른 작업이 끝날 때까지 기다려 주세요.') };
    await fsp.rm(voicePath(id), { recursive: true, force: true });
    return { ok: true };
  });

  ipcMain.handle('vocal:license', async (_e, id) => {
    const v = VOICES[id] || PARTS[id];
    if (!v) return null;
    return fsp.readFile(path.join(TOOLS, 'licenses', v.license), 'utf8');
  });

  // payload: { voice, notes: [{t, d, n, syl}] (seconds), speaker?, steps? } -> { ok, wav, seconds, sr }
  ipcMain.handle('vocal:render', async (e, payload = {}) => {
    const id = OLD_IDS[payload.voice] || payload.voice;
    const v = VOICES[id];
    if (!v) return { ok: false, error: 'voice', message: t('보이스를 골라 주세요.') };
    const ins = installed(id);
    if (!ins) return { ok: false, error: 'not_installed', message: t('{name} 보이스를 먼저 내려받아 주세요.', { name: t(v.name) }) };
    const c = await capabilities();
    const py = v.engine === 'nnsvs' ? c.nnsvs : c.diffsinger ? c.python : null;
    if (!py) return { ok: false, error: 'no_engine', message: v.engine === 'nnsvs' ? t('NNSVS가 설치돼 있지 않아요. \'보컬 구성 요소 설치\'를 눌러 주세요.') : t('먼저 AI 분석 엔진을 설치해 주세요.') };
    if (v.vocoder && !partInstalled(v.vocoder)) return { ok: false, error: 'not_installed', message: t('보코더가 없어요. 보이스를 다시 내려받아 주세요.') };
    const notes = (payload.notes || []).filter((x) => x && x.d > 0 && Number.isFinite(x.t) && Number.isFinite(x.n)).map((x) => ({ t: +x.t, d: +x.d, n: Math.round(+x.n), syl: String(x.syl ?? '') }));
    if (!notes.length) return { ok: false, error: 'no_notes', message: t('노트가 없어요.') };
    if (busy) return { ok: false, error: 'busy', message: t('다른 작업이 끝날 때까지 기다려 주세요.') };
    busy = 'render';
    const send = (m) => { if (!e.sender.isDestroyed()) e.sender.send('vocal:progress', { id: 'render', ...m }); };
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'melofi-sing-'));
    try {
      const out = path.join(dir, 'out.wav'), job = path.join(dir, 'job.json');
      await fsp.writeFile(job, JSON.stringify({ engine: v.engine, voice_dir: ins.dir, vocoder_dir: v.vocoder ? partInstalled(v.vocoder) : null, speaker: payload.speaker || null, notes, out, steps: payload.steps || 50,
        cmudict: partInstalled('cmudict') ? path.join(partInstalled('cmudict'), PARTS.cmudict.raw) : null }));
      send({ p: 0.02, label: t('{name} 노래 만드는 중…', { name: v.name.split(' (')[0] }) });
      let err = null;
      const r = await run(py, ['-I', script('sing.py'), job], { env, onSpawn: (p) => { child = p; } }, (l, isErr) => {
        if (isErr) return;
        try { const m = JSON.parse(l); if (m.p != null) send({ p: m.p, label: t('{name} 노래 만드는 중… {pct}%', { name: v.name.split(' (')[0], pct: Math.round(m.p * 100) }) }); if (m.ok === false) err = m.error; } catch { /* log line */ }
      });
      child = null;
      const res = lastJson(r.out);
      if (!res?.ok || !exists(out)) return { ok: false, error: 'render', message: t('노래를 만들지 못했어요: {why}', { why: err || res?.error || (r.err.split(/\r?\n/).filter(Boolean).pop() || '').slice(0, 300) }) };
      return { ok: true, wav: new Uint8Array(await fsp.readFile(out)), seconds: res.seconds, sr: res.sr, voice: id, use: v.use, credit: v.credit };
    } finally {
      busy = null;
      await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  // payload: { path } or { name, data }, notes?: [{t, d, n}], language?: 'ko'|'ja'|'en'
  //   -> { ok, language, text, syllables: [{text, start, end}], notes: [syllable | '+' | ''] }
  ipcMain.handle('vocal:lyrics', async (e, payload = {}) => {
    const c = await capabilities();
    if (!c.lyrics) return { ok: false, error: 'no_engine', message: t('가사 인식을 쓰려면 \'보컬 구성 요소 설치\'를 먼저 눌러 주세요.') };
    if (busy) return { ok: false, error: 'busy', message: t('다른 작업이 끝날 때까지 기다려 주세요.') };
    busy = 'lyrics';
    const send = (m) => { if (!e.sender.isDestroyed()) e.sender.send('vocal:progress', { id: 'lyrics', ...m }); };
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'melofi-lyrics-'));
    try {
      let audio = payload.path ? path.resolve(String(payload.path)) : null;
      if (!audio && payload.data) {
        audio = path.join(dir, `in${path.extname(String(payload.name || '.wav')) || '.wav'}`);
        await fsp.writeFile(audio, Buffer.from(payload.data));
      }
      if (!audio || !exists(audio)) return { ok: false, message: t('오디오 파일을 찾지 못했어요.') };
      const job = path.join(dir, 'job.json');
      const notes = (payload.notes || []).map((x) => ({ t: +x.t, d: +x.d, n: +x.n || 60 }));
      await fsp.writeFile(job, JSON.stringify({ audio, notes, language: payload.language || null, model: payload.model || 'large-v3-turbo', models_dir: STEMS_MODELS() }));
      const first = !exists(path.join(STEMS_MODELS(), 'hf', 'hub', 'models--mobiuslabsgmbh--faster-whisper-large-v3-turbo'));
      send({ p: 0.02, label: first ? t('가사 인식 모델 받는 중… (처음 한 번, 약 1.6 GB)') : t('가사 듣는 중…') });
      const r = await run(c.python, ['-I', script('lyrics.py'), job], { env, onSpawn: (p) => { child = p; } }, (l, isErr) => {
        if (isErr) return;
        try { const m = JSON.parse(l); if (m.p != null) send({ p: m.p, label: m.label === 'model' ? (first ? t('가사 인식 모델 받는 중… (처음 한 번, 약 1.6 GB)') : t('모델 여는 중…')) : t('가사 듣는 중… {pct}%', { pct: Math.round(m.p * 100) }) }); } catch { /* log line */ }
      });
      child = null;
      const res = lastJson(r.out);
      if (!res?.ok) return { ok: false, message: t('가사를 알아듣지 못했어요: {why}', { why: res?.error || (r.err.split(/\r?\n/).filter(Boolean).pop() || '').slice(0, 300) }) };
      return res;
    } finally {
      busy = null;
      await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  // tests: check a rendered take against its notes (tools/vocal/check_sing.py)
  ipcMain.handle('vocal:check', async (_e, { wav, notes }) => {
    const c = await capabilities();
    if (!c.check) return { ok: false, message: t('librosa가 없어요.') };
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'melofi-check-'));
    try {
      await fsp.writeFile(path.join(dir, 'a.wav'), Buffer.from(wav));
      await fsp.writeFile(path.join(dir, 'n.json'), JSON.stringify(notes));
      const r = await run(c.python, ['-I', script('check_sing.py'), path.join(dir, 'a.wav'), path.join(dir, 'n.json')], { env });
      try { return JSON.parse(r.out.trim().split(/\r?\n/).pop()); } catch { return { ok: false, message: r.err.slice(-300) }; }
    } finally { await fsp.rm(dir, { recursive: true, force: true }).catch(() => {}); }
  });
}

module.exports = { register, VOICES };
