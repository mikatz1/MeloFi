"""Self-test of the MeloFi analysis engine, run at the end of an install or update.

usage: python selftest.py --models <dir> --work <dir> [--gpu]

Imports every package the analysis uses, checks that PyTorch sees the GPU when one was installed
for, then separates a generated 2-second tone with the vocal model the first analysis uses anyway
(BS-RoFormer; it downloads here on a fresh install, so the first song does not wait for it) and
reads its notes with Basic Pitch. Prints JSON lines like analyze.py: {"p", "label"} for progress,
{"log"} for the window's log, {"error"} on failure, and a final {"ok": true, ...} summary.
"""
import argparse, json, os, sys, time, traceback
from pathlib import Path


def say(**m):
    print(json.dumps(m, ensure_ascii=False), flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", required=True)
    ap.add_argument("--work", required=True)
    ap.add_argument("--gpu", action="store_true", help="the CUDA build was installed: fail when PyTorch cannot use the GPU")
    a = ap.parse_args()
    t0 = time.time()
    work = Path(a.work); work.mkdir(parents=True, exist_ok=True)
    summary = {"python": sys.version.split()[0]}

    # 1. every package the analysis imports
    say(p=0.02, label="구성 요소를 불러오는 중")
    import importlib
    for name in ("numpy", "scipy", "soundfile", "librosa", "torch", "torchaudio", "onnxruntime", "audio_separator.separator",
                 "beat_this.inference", "basic_pitch.inference", "pretty_midi", "muscriptor", "transformers"):
        t = time.time()
        try:
            mod = importlib.import_module(name)
        except Exception as e:  # noqa: BLE001 - every import failure is reported the same way
            say(error=f"{name}을(를) 불러오지 못했습니다: {type(e).__name__}: {e}")
            if "DLL load failed" in str(e):
                say(log="Windows 구성 요소(Microsoft Visual C++ 재배포 가능 패키지)가 없을 때 이 오류가 납니다.")
            return 1
        ver = getattr(mod, "__version__", "")
        say(log=f"  {name} {ver} ({time.time() - t:.1f}s)")

    # 2. the GPU
    import torch
    import onnxruntime as ort
    summary["torch"] = torch.__version__
    summary["cuda"] = bool(torch.cuda.is_available())
    summary["onnx_providers"] = ort.get_available_providers()
    if summary["cuda"]:
        summary["gpu"] = torch.cuda.get_device_name(0)
        x = torch.randn(512, 512, device="cuda")
        float((x @ x).sum())  # a kernel actually runs (a wrong CUDA build fails here, not at import)
        say(log=f"GPU: {summary['gpu']} · PyTorch {torch.__version__} · CUDA {torch.version.cuda}")
    else:
        say(log=f"GPU 없음 · PyTorch {torch.__version__} (CPU)")
    if a.gpu and not summary["cuda"]:
        say(error=f"GPU용 PyTorch({torch.__version__})가 GPU를 쓰지 못합니다. NVIDIA 드라이버를 최신으로 올린 뒤 다시 확인해 주세요.")
        return 1

    # 3. a 2-second tone: A3 with harmonics, a little noise, stereo 44.1 kHz
    import numpy as np
    import soundfile as sf
    sr = 44100
    t = np.arange(2 * sr) / sr
    tone = sum(0.25 / k * np.sin(2 * np.pi * 220 * k * t) for k in range(1, 6)) * np.minimum(1, t * 20)
    tone = tone + 0.003 * np.random.default_rng(1).standard_normal(t.size)
    src = work / "selftest_tone.wav"
    sf.write(src, np.stack([tone, tone], 1).astype(np.float32), sr)

    # 4. separation with the real vocal model (the download, ~640 MB on a fresh install, shows its own progress)
    say(p=0.1, label="시험 분리: BS-RoFormer 모델 준비 및 2초 분리")
    from audio_separator.separator import Separator
    out = work / "sep"; out.mkdir(exist_ok=True)
    t = time.time()
    s = Separator(output_dir=str(out), model_file_dir=a.models, output_format="WAV", sample_rate=sr, log_level=30,
                  use_autocast=summary["cuda"],
                  mdxc_params={"segment_size": 256, "override_model_segment_size": False, "batch_size": 1, "overlap": 4, "pitch_shift": 0})
    s.load_model(model_filename="model_bs_roformer_ep_317_sdr_12.9755.ckpt")
    files = [out / Path(f).name for f in s.separate(str(src))]
    summary["separation_s"] = round(time.time() - t, 1)
    if len(files) < 2 or not all(f.exists() for f in files):
        say(error=f"시험 분리 결과가 없습니다: {[str(f) for f in files]}")
        return 1
    total = np.zeros(1)
    for f in files:
        y, _ = sf.read(f)
        if not np.isfinite(y).all():
            say(error=f"시험 분리 결과에 잘못된 값이 있습니다: {f.name}")
            return 1
        total = total + float(np.sqrt(np.mean(y ** 2)))
    if total[0] < 1e-4:
        say(error="시험 분리 결과가 무음입니다.")
        return 1
    say(log=f"시험 분리: {len(files)}개 트랙, {summary['separation_s']}s")

    # 5. Basic Pitch on the tone: its lowest note should be A3 (MIDI 57)
    say(p=0.9, label="시험 채보 (Basic Pitch)")
    from basic_pitch.inference import predict
    from basic_pitch import ICASSP_2022_MODEL_PATH
    _, _, notes = predict(str(src), ICASSP_2022_MODEL_PATH)
    pitches = sorted({int(n[2]) for n in notes})
    summary["basic_pitch_notes"] = pitches[:6]
    if 57 not in pitches:
        say(error=f"시험 채보에서 A3(57)를 찾지 못했습니다: {pitches[:10]}")
        return 1

    for f in [src, *files]:
        try: os.remove(f)
        except OSError: pass
    summary["seconds"] = round(time.time() - t0, 1)
    say(p=1, label="자체 점검을 통과했습니다")
    say(ok=True, **summary)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:  # noqa: BLE001
        say(error=f"{type(e).__name__}: {e}")
        traceback.print_exc()
        sys.exit(1)
