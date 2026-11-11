# Analysis engine install (one click, no Python needed)

The AI window's analysis (stem separation, beats, notes, instrument recognition) runs open-source
models in Python. Until MeloFi 0.2.x the user had to install Python 3.10–3.12 first; now the app
brings its own. Code: [`engine-install.js`](../engine-install.js) (called by `stems:setup` in
[`stems.js`](../stems.js)), locks and self-test in [`tools/stems/engine/`](../tools/stems/engine).

## What goes where

Everything stays in `userData/stems-engine` — no admin rights, no PATH or registry changes, nothing
outside userData:

| path | what |
|---|---|
| `uv/uv.exe` | [astral-sh/uv](https://github.com/astral-sh/uv) 0.13.7, the package installer (15 MB zip) |
| `python/` | CPython 3.12.16 from [python-build-standalone](https://github.com/astral-sh/python-build-standalone) `install_only` (45 MB tar.gz) |
| `venv/` | the virtual environment the analysis runs in — **same place as before** |
| `cache/` | uv's package cache (hard-linked into `venv/`, so it costs no extra space) |
| `models/` | model files, downloaded on first use; kept by a reinstall |
| `engine.json` | what was installed (engine version, GPU/CPU build, Python, uv, stage times) |
| `install.log` | full log of the last install / update; every error message names it |
| `status.log` | notes from `stems:status` when the engine is not usable (unchanged) |

Both downloads are pinned in `ENGINE` (engine-install.js) with the SHA256 that the release
publishes (`uv-…zip.sha256`, python-build-standalone's `SHA256SUMS`); a file that does not match
is thrown away and fetched again. Archives are unpacked with Windows' own `tar.exe` (bsdtar, in
System32 since Windows 10 1803), which reads both zip and tar.gz.

### Python: python-build-standalone, not the embeddable zip

The python.org embeddable zip has no `venv`, no `ensurepip`, no tkinter/headers, and a `._pth` file
that ignores `site-packages` unless edited — packages with C extensions or `.pth` hooks (torch,
onnxruntime) need workarounds. python-build-standalone's `install_only` build is a complete,
relocatable CPython (the same builds uv and Rye use), so `uv venv` works on it unchanged and every
wheel installs as on a normal Python.

## Stages

`stems:setup` takes `{ mode }`: `install` (default; also finishes a stopped install),
`reinstall`, `update`. The window gets `stems:progress` `{ p, label, detail, stage }` (label is
`n/N 단계…`, `stage` is this stage's 0..1) and `stems:log` lines.

1. **Check** — free space on the userData drive (`fs.statfs`; 6 GB for an install, 2 GB for an
   update) and the GPU (`nvidia-smi`): an NVIDIA card with driver ≥ 528 gets the CUDA 12.8 PyTorch
   (needed by RTX 50-series), anything else the CPU build (about a third of the size).
2. **uv** — download (resumable) + unpack, skipped when the right version is there.
3. **Python** — download + unpack + check it runs (`import venv, ssl`). Install / reinstall only.
4. **venv** — `uv venv --python <bundled> --seed venv`. A reinstall, or an older engine on the
   computer's own Python that no longer works, is first moved to `venv.old`; it comes back if
   anything later fails or is cancelled and is deleted only after the self-test passes.
5. **Packages** — one `uv pip install --require-hashes -r lock-{gpu,cpu}.txt --torch-backend
   {cu128,cpu}`, then `--no-deps` Basic Pitch (its own requirements pull TensorFlow, which MeloFi
   does not use). Progress: the disk space written so far against the measured total, plus uv's
   `Downloading torch (2.4GiB)` / `Downloaded torch` lines in the detail.
6. **Self-test** (`selftest.py`) — imports every package the analysis uses, checks
   `torch.cuda.is_available()` and runs a kernel when the GPU build was installed, separates a
   generated 2-second tone with the BS-RoFormer vocal model (downloaded here on a fresh install, so
   the first song does not wait for it), and checks Basic Pitch finds the tone's A3. Only then is
   `engine.json` written.

**Robustness**: downloads resume from `.part` with HTTP Range, retry 8 times with backoff, abort on
a 45-second stall and go through Electron's `net.fetch` (Chromium's network stack: the system proxy
and certificate store). uv runs with `UV_HTTP_RETRIES=8`, a 300 s timeout and `UV_NATIVE_TLS=1`
(works behind company / antivirus TLS inspection); everything already in its cache is not fetched
again, so pressing "엔진 설치" after a failure continues where it stopped. The user's own
`PYTHON*`, `PIP_*`, `UV_*`, `VIRTUAL_ENV` and `CONDA*` variables are removed from the environment
of every step, and `UV_NO_CONFIG` ignores any `uv.toml`. Cancel (`stems:cancel`) aborts the
download or kills uv / Python with its whole process tree (`taskkill /T`). Folder moves retry and
fall back to copying: on this PC the very first test hit `EPERM` renaming the freshly unpacked
Python folder while Defender was still scanning it.

**Errors** are Korean, name the stage and the last relevant lines, and end with
`자세한 기록: …\stems-engine\install.log`.

## Existing engines

Engines installed before this change (a venv made from the computer's Python 3.10–3.12 with pip)
keep working: `stems:status` and the analysis only look at `venv/Scripts/python.exe`, as before.
No reinstall is forced. The AI window's options page shows the engine's build and two buttons:

- **엔진 다시 설치** — builds a fresh engine on the bundled Python (old one restored on failure).
- **엔진 업데이트** — shown when `engine.json` is older than this MeloFi's `ENGINE.version`.
  Applies the new lock to the existing venv: uv changes only the packages whose pinned version
  differs (the rest are "Audited"), then runs the self-test. An engine on Python 3.10 / 3.11 is
  told to reinstall (the locks are made for 3.12).

## uv or pip — why uv

Measured on this PC (RTX 5060 Laptop, same lock, empty caches):

| | uv 0.13.7 | pip 24 (system Python 3.12 venv) |
|---|---|---|
| packages stage, lock-gpu.txt, empty cache (incl. `.pyc` compile) | **394 s** | 964 s |
| same, re-run with everything installed | 0.3 s | — |
| update of an older engine (3 torch packages swapped) | 85 s | — |

Full clean install on this PC, from an empty userData to a passing self-test (2026-11-12, other
sessions were using the GPU and network at the same time):

| stage | seconds |
|---|---|
| 1 check (disk, GPU) | 0 |
| 2 uv download + unpack | 9 |
| 3 Python download + unpack + check | 11 |
| 4 venv | 2 |
| 5 packages (101, 4.9 GB on disk) | 394 |
| 6 self-test (imports 23 s, vocal model download + 2-second separation 78 s) | 106 |
| **total** | **523** |

Then a real separation, headless (`stemsRun({ path, quick: true })`, 20-second clip): 229 s on
CUDA, 6 stems, 150 BPM, E minor — most of it the first download of the 6-stem model. Precompiling
bytecode at install time (`UV_COMPILE_BYTECODE`) took the self-test's first imports from 380 s to
23 s (torch 93 → 7 s, audio-separator 100 → 10 s, transformers 112 → 2.5 s) for +26 s of install.

- **Speed**: 2.4× faster here. uv downloads in parallel and installs by hard-linking from its cache; pip downloads
  one file at a time and unzips into the venv.
- **One resolve, right torch**: `--torch-backend cu128` takes torch / torchaudio / torchvision from
  PyTorch's index and everything else from PyPI in a single resolve. With pip the CUDA build had to
  be force-reinstalled last over the CPU torch the other packages pulled in (≈ 2.4 GB downloaded
  twice before, and a window where the venv had mismatched torch builds).
- **Lock with hashes**: `uv pip compile` produces the exact, hash-checked set that was tested
  (lock-gpu.txt / lock-cpu.txt). Every install gets the same versions; a broken upstream release
  (a new transformers, numpy, librosa) cannot break new installs; update = apply a new lock.
- **Resume**: a stopped uv install keeps every finished package in its cache.
- **Cost**: one 15 MB exe, pinned and checksum-verified. pip stays available inside the venv
  (`--seed`) and the old pip-made engines still work.

## Changing the packages

1. Edit `tools/stems/engine/requirements-gpu.in` and `requirements-cpu.in`.
2. Regenerate both locks (the first line of each lock file is its exact command):

   ```
   uv pip compile tools/stems/engine/requirements-gpu.in --python-version 3.12 --python-platform x86_64-pc-windows-msvc --torch-backend cu128 --generate-hashes --no-header --no-annotate -o tools/stems/engine/lock-gpu.txt
   uv pip compile tools/stems/engine/requirements-cpu.in --python-version 3.12 --python-platform x86_64-pc-windows-msvc --torch-backend cpu   --generate-hashes --no-header --no-annotate -o tools/stems/engine/lock-cpu.txt
   ```
   (then put the `# generated by:` line back on top)
3. Bump `ENGINE.version` in engine-install.js — installed engines then offer "엔진 업데이트".
4. To move uv or Python: change the URL, size and SHA256 in `ENGINE` (from the release's published
   `.sha256` / `SHA256SUMS`).

Not covered on this PC: a computer without the Microsoft Visual C++ runtime (PyTorch's DLLs need it;
the self-test then says so), and an AMD/Intel-only computer (gets the CPU build; the CPU lock
resolves, but its install was not run here).
