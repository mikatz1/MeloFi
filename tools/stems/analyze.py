"""MeloFi song analysis engine: open-source models, run locally (GPU if there is one).

  separation   python-audio-separator (MIT) running
                 - BS-RoFormer (vocals / instrumental)
                 - Mel-Band RoFormer karaoke (lead / backing vocals)
                 - BS-RoFormer SW 6-stem (drums, bass, guitar, piano, other); on MUSDB18 it beat
                   HTDemucs 6-stem by +1.2 dB drums, +1.0 dB bass, +1.8 dB other
                 - MDX23C DrumSep (kick, snare, toms, hi-hat, ride, crash)
  beats        Beat This! (CPJKU, MIT): beats and downbeats -> tempo, bar grid
  notes        Basic Pitch (Spotify, Apache-2.0) on each pitched stem -> MIDI notes
  drums        onsets of each DrumSep stem -> drum hits
  key          chroma of the pitched stems against major / minor key profiles

usage: python analyze.py --input song.mp3 --out <dir> --models <dir> [--ffmpeg ffmpeg.exe] [--quick]
Prints one JSON object per line: {"p": 0..1, "label": "..."} while working, then writes
<out>/result.json.
"""
import argparse, json, os, sys, time, subprocess, shutil, glob, re
from pathlib import Path


# The overall bar: each part of the run gets a share of 0..1 by how long it takes. With MuScriptor
# on, its transcription is often the longest part, so the stages before it are squeezed into the
# first share instead of the bar sitting at ~94% for the whole transcription.
_SPAN = [0.0, 1.0]
SECONDS_PER_AUDIO_SECOND = {"sep_full": 1.35, "sep_fast": 0.9, "rest": 0.15, "small": 0.3, "medium": 0.65, "large": 1.8}


def say(p, label, **extra):
    lo, hi = _SPAN
    print(json.dumps({"p": round(lo + (hi - lo) * max(0.0, min(1.0, p)), 3), "label": label, **extra}, ensure_ascii=False), flush=True)


def set_span(lo, hi):
    _SPAN[0], _SPAN[1] = lo, hi


def run_muscriptor(src, out, model, times):
    """MuScriptor (Kyutai x Mirelo) on the whole mix -> {model, license, notes: {instrument: [[t, d, pitch, vel]]}}
    or {error}. Weights are CC BY-NC 4.0 (non-commercial) and gated: HF_TOKEN must be set."""
    say(0.0, f"MuScriptor {model} 모델을 불러오는 중… (비상업 전용)")
    t0 = time.time()
    # run as a module with this Python: a console-script .exe remembers the folder it was installed in
    js = out / f"muscriptor_{model}.json"
    # its progress goes to stderr: pass every line on to the app's log as it comes
    import torch
    dtype = ["--dtype", "bfloat16"] if torch.cuda.is_available() else []  # float32 large spills out of an 8 GB card
    p2 = subprocess.Popen([sys.executable, "-m", "muscriptor", "transcribe", str(src), "--format", "json", "-o", str(js), "--model", model, *dtype],
                          stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace", bufsize=1,
                          env={**os.environ, "PYTHONUNBUFFERED": "1"})
    tail_lines = []
    buf = ""
    total, started, first = 0, 0, None

    def progress(line):
        nonlocal total, started, first
        m = re.search(r"(\d+) chunk\(s\) of ([\d.]+)s", line)
        if m:
            total = int(m.group(1))
            say(0.02, f"MuScriptor {model} · 구간 0/{total} (구간마다 {float(m.group(2)):g}초)", stage=0.0)
        elif "encode conditions" in line and total:
            started += 1
            now = time.time()
            first = first or now
            done = started - 1  # the chunk that just began is not finished yet
            eta = ""
            if done >= 1:
                left = (now - first) / done * (total - done)
                eta = f" · 남은 시간 약 {max(1, round(left / 60))}분" if left >= 60 else f" · 남은 시간 약 {max(5, round(left / 5) * 5)}초"
            say(0.02 + 0.97 * done / total, f"MuScriptor {model} · 구간 {started}/{total}{eta}", stage=done / total)

    while True:
        ch = p2.stdout.read(1)
        if not ch: break
        if ch in "\r\n":
            if buf.strip():
                print(json.dumps({"log": "[MuScriptor] " + buf.strip()[:300]}, ensure_ascii=False), flush=True)
                tail_lines = (tail_lines + [buf.strip()])[-6:]
                progress(buf)
            buf = ""
        else:
            buf += ch
    p2.wait()
    class _R: pass
    r2 = _R(); r2.returncode = p2.returncode; r2.stderr = "\n".join(tail_lines); r2.stdout = ""
    times[f"muscriptor_{model}"] = round(time.time() - t0, 1)
    if r2.returncode or not js.exists():
        tail = (r2.stderr or r2.stdout).strip().splitlines()[-3:]
        msg = " ".join(tail)[-300:]
        if "401" in msg or "403" in msg or "gated" in msg.lower() or "token" in msg.lower():
            msg = "HuggingFace 토큰이 없거나, 모델 페이지에서 라이선스 동의가 필요합니다. " + msg
        elif "out of memory" in msg.lower():
            msg = "그래픽 메모리가 부족합니다. 더 작은 모델(medium·small)을 골라 주세요. " + msg
        return {"model": model, "error": msg}
    ev = json.loads(js.read_text(encoding="utf-8"))
    starts = {e["index"]: e for e in ev if e.get("type") == "start"}
    by = {}
    for e in ev:
        if e.get("type") != "end": continue
        s0 = starts.get(e["start_event_index"])
        if not s0: continue
        by.setdefault(s0["instrument"], []).append([round(s0["start_time"], 4), round(max(0.02, e["end_time"] - s0["start_time"]), 4), int(s0["pitch"]), 100])
    for v in by.values(): v.sort()
    return {"model": model, "license": "CC BY-NC 4.0 (non-commercial)", "notes": by, "seconds": times[f"muscriptor_{model}"]}



def to_wav(a, dst):
    """The input as a 44.1 kHz stereo float WAV. ffmpeg reads anything (video too); without it (most PCs
    have none: it is not part of Windows) soundfile reads WAV, FLAC, OGG/Opus and MP3 itself and soxr
    resamples, so a missing ffmpeg is not the "file not found" it used to look like."""
    try:
        r = subprocess.run([a.ffmpeg, "-y", "-v", "error", "-i", a.input, "-vn", "-ac", "2", "-ar", "44100", "-c:a", "pcm_f32le", str(dst)], capture_output=True, text=True)
        if r.returncode == 0:
            return
        why = r.stderr.strip()[-300:]
    except (FileNotFoundError, PermissionError, OSError):
        why = None  # no ffmpeg on this PC
    import numpy as np
    import soundfile as sf
    try:
        x, rate = sf.read(a.input, dtype="float32", always_2d=True)
    except Exception as e:
        if why:
            raise SystemExit(f"ffmpeg: {why}")
        raise SystemExit("이 형식은 열 수 없어요(ffmpeg가 없어서 WAV·MP3·FLAC·OGG만 읽을 수 있어요). "
                         f"음원을 그 형식으로 바꿔 다시 넣어 주세요. ({type(e).__name__}: {e})")
    x = x[:, :2] if x.shape[1] >= 2 else np.repeat(x, 2, axis=1)
    if rate != 44100:
        try:
            import soxr
            x = soxr.resample(x, rate, 44100, quality="VHQ")
        except ImportError:
            from scipy.signal import resample_poly
            from math import gcd
            g = gcd(int(rate), 44100)
            x = resample_poly(x, 44100 // g, int(rate) // g, axis=0).astype("float32")
    sf.write(str(dst), x, 44100, subtype="FLOAT")

def only_muscriptor(a):
    """Add a MuScriptor run to an analysis that is already done (the stems, beats and notes stay)."""
    out = Path(a.out)
    res = json.loads((out / "result.json").read_text(encoding="utf-8"))
    say(0.02, "오디오를 준비하는 중")
    src = out / "input.wav"
    to_wav(a, src)
    times = res.setdefault("times", {})
    set_span(0.03, 0.99)
    mus = run_muscriptor(src, out, a.muscriptor, times)
    set_span(0.0, 1.0)
    runs = res.setdefault("muscriptor_runs", {})
    if "error" not in mus: runs[a.muscriptor] = mus
    res["muscriptor"] = mus
    (out / "result.json").write_text(json.dumps(res, ensure_ascii=False), encoding="utf-8")
    try: os.remove(src)
    except OSError: pass
    say(1.0, "끝", result=str(out / "result.json"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--models", required=True)
    ap.add_argument("--ffmpeg", default="ffmpeg")
    ap.add_argument("--quick", action="store_true", help="skip the drum split and the lead/backing vocal split")
    ap.add_argument("--muscriptor", default="off", choices=["off", "small", "medium", "large"],
                    help="also transcribe the whole mix with MuScriptor (weights: CC BY-NC 4.0, non-commercial; needs HF_TOKEN)")
    ap.add_argument("--only-muscriptor", action="store_true", help="add a MuScriptor run to the finished analysis in --out")
    a = ap.parse_args()
    if a.only_muscriptor:
        return only_muscriptor(a)
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    models = Path(a.models); models.mkdir(parents=True, exist_ok=True)
    t_all = time.time(); times = {}

    # ---------- 1. a clean 44.1 kHz stereo WAV to work on ----------
    say(0.01, "오디오를 준비하는 중")
    src = out / "input.wav"
    to_wav(a, src)

    import numpy as np
    import soundfile as sf
    import torch
    dev = "cuda" if torch.cuda.is_available() else "cpu"
    say(0.03, f"장치: {torch.cuda.get_device_name(0) if dev == 'cuda' else 'CPU'}")
    mix, sr = sf.read(str(src), always_2d=True)
    duration = len(mix) / sr
    if a.muscriptor != "off":
        pre = SECONDS_PER_AUDIO_SECOND["sep_fast" if a.quick else "sep_full"] + SECONDS_PER_AUDIO_SECOND["rest"]
        mus_share = SECONDS_PER_AUDIO_SECOND[a.muscriptor] / (pre + SECONDS_PER_AUDIO_SECOND[a.muscriptor])
        pre_end = round(1 - mus_share, 3)
        set_span(0.0, pre_end / 0.95)  # the stages before MuScriptor run 0..0.95 of their own scale

    # ---------- 2. separation ----------
    from audio_separator.separator import Separator
    sep_dir = out / "sep"; sep_dir.mkdir(exist_ok=True)

    def separate(model, path, p, label):
        say(p, label)
        t0 = time.time()
        # overlap 4 + fp16: 4x faster than the default overlap 8, output within -42 dB of it (inaudible)
        s = Separator(output_dir=str(sep_dir), model_file_dir=str(models), output_format="WAV", sample_rate=44100, log_level=20,
                      use_autocast=dev == "cuda",
                      mdxc_params={"segment_size": 256, "override_model_segment_size": False, "batch_size": 1, "overlap": 4, "pitch_shift": 0})
        s.load_model(model_filename=model)
        files = s.separate(str(path))
        times[model] = round(time.time() - t0, 1)
        got = {}
        for f in files:
            f = sep_dir / Path(f).name
            # the stem is the LAST "(Name)" in the file name: separating a separated file keeps the first
            m = re.findall(r"_\(([^)]+)\)", f.name)
            if m: got[m[-1].lower()] = f
        del s
        if dev == "cuda": torch.cuda.empty_cache()
        return got

    stems = {}
    v = separate("model_bs_roformer_ep_317_sdr_12.9755.ckpt", src, 0.06, "보컬을 분리하는 중 (BS-RoFormer)")
    vocals, inst = v.get("vocals"), v.get("instrumental")
    m6 = separate("BS-Roformer-SW.ckpt", inst, 0.30, "악기를 분리하는 중 (BS-RoFormer SW 6-stem)")
    for k in ("drums", "bass", "guitar", "piano", "other"):
        if k in m6: stems[k] = m6[k]
    # whatever the 6-stem model still hears as voice goes back with "other"
    if "vocals" in m6 and "other" in stems:
        o, s1 = sf.read(str(stems["other"]), always_2d=True)
        vv, _ = sf.read(str(m6["vocals"]), always_2d=True)
        n = min(len(o), len(vv)); sf.write(str(stems["other"]), o[:n] + vv[:n], s1, subtype="FLOAT")
    if vocals:
        if not a.quick:
            lb = separate("mel_band_roformer_karaoke_aufr33_viperx_sdr_10.1956.ckpt", vocals, 0.50, "리드·코러스 보컬을 나누는 중 (Mel-Band RoFormer)")
            if lb.get("vocals") and lb.get("instrumental"):
                stems["vocals"], stems["backing"] = lb["vocals"], lb["instrumental"]
            else:
                stems["vocals"] = vocals
        else:
            stems["vocals"] = vocals
    drum_parts = {}
    if "drums" in stems and not a.quick:
        ds = separate("MDX23C-DrumSep-aufr33-jarredou.ckpt", stems["drums"], 0.62, "드럼을 킥·스네어·하이햇으로 나누는 중 (DrumSep)")
        for k, f in ds.items():
            drum_parts[k] = f

    # tidy names: stems/<id>.wav (float WAV, 44.1 kHz stereo)
    final = out / "stems"; final.mkdir(exist_ok=True)
    def keep(src_path, name):
        # 24-bit FLAC: lossless, 144 dB of range (far past any recording), about a third of the float WAV
        dst = final / f"{name}.flac"
        x, rate = sf.read(str(src_path), always_2d=True)
        sf.write(str(dst), np.clip(x, -1.0, 1.0), rate, format="FLAC", subtype="PCM_24")
        os.remove(src_path)
        return dst
    stems = {k: keep(f, k) for k, f in stems.items()}
    drum_parts = {k: keep(f, f"drum_{k}") for k, f in drum_parts.items()}

    # a small mono mix of the pitched instruments only (no drums, no voice) for the app's chord analysis
    import librosa
    harm = None
    for k in ("bass", "piano", "guitar", "other"):
        if k in stems:
            s2, _ = librosa.load(str(stems[k]), sr=22050, mono=True)
            harm = s2 if harm is None else harm[: len(s2)] + s2[: len(harm)]
    if harm is not None:
        sf.write(str(final / "harmonic_22k.wav"), harm.astype("float32"), 22050, subtype="FLOAT")

    # ---------- 3. beats and tempo ----------
    say(0.74, "박자와 템포를 찾는 중 (Beat This!)")
    t0 = time.time()
    from beat_this.inference import File2Beats
    f2b = File2Beats(checkpoint_path="final0", device=dev, dbn=False)
    beats, downbeats = f2b(str(src))
    beats = [float(x) for x in beats]; downbeats = [float(x) for x in downbeats]
    times["beat_this"] = round(time.time() - t0, 1)
    ibi = np.diff(beats) if len(beats) > 2 else np.array([0.5])
    bpm = float(60.0 / np.median(ibi))
    # beats per bar from the downbeats
    if len(downbeats) > 2:
        per = [sum(1 for b in beats if d0 - 1e-3 <= b < d1 - 1e-3) for d0, d1 in zip(downbeats, downbeats[1:])]
        # only bar lengths a song can have count (the tracker marks some downbeats a beat apart on
        # busy fast songs, which gave "1/4"); when most bars are not like that the downbeats can't be
        # trusted and the song is taken as 4/4, by far the most common
        ok = [c for c in per if 2 <= c <= 7]
        meter = int(np.bincount(ok).argmax()) if len(ok) >= 0.6 * len(per) and ok else 4
    else:
        meter = 4

    # ---------- 4. key ----------
    say(0.78, "조성을 찾는 중")
    import librosa
    y = None
    for k in ("bass", "piano", "guitar", "other", "vocals", "backing"):
        if k in stems:
            s, _ = librosa.load(str(stems[k]), sr=22050, mono=True)
            y = s if y is None else y[: len(s)] + s[: len(y)]
    if y is None:
        y, _ = librosa.load(str(src), sr=22050, mono=True)
    chroma = librosa.feature.chroma_cqt(y=y, sr=22050).mean(axis=1)
    major = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
    minor = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
    best = (-9, 0, "major")
    for r in range(12):
        for prof, mode in ((major, "major"), (minor, "minor")):
            c = float(np.corrcoef(np.roll(prof, r), chroma)[0, 1])
            if c > best[0]: best = (c, r, mode)
    key = {"root": best[1], "mode": best[2], "confidence": round(best[0], 3)}

    # ---------- 5. notes of each pitched stem ----------
    notes = {}
    from basic_pitch.inference import predict
    from basic_pitch import ICASSP_2022_MODEL_PATH
    pitched = [k for k in ("bass", "piano", "guitar", "vocals", "backing", "other") if k in stems]
    ranges = {"bass": (28, 67), "vocals": (40, 88), "backing": (40, 88)}
    for i, k in enumerate(pitched):
        say(0.80 + 0.14 * i / max(1, len(pitched)), f"음표를 받아 적는 중: {k} (Basic Pitch)")
        t0 = time.time()
        lo, hi = ranges.get(k, (21, 108))
        try:
            _, _, ev = predict(str(stems[k]), ICASSP_2022_MODEL_PATH, onset_threshold=0.5, frame_threshold=0.3,
                               minimum_note_length=80 if k in ("vocals", "backing") else 58,
                               minimum_frequency=librosa.midi_to_hz(lo), maximum_frequency=librosa.midi_to_hz(hi),
                               multiple_pitch_bends=False, melodia_trick=True)
        except Exception as e:  # one stem failing must not lose the rest
            say(0.80, f"{k}: {e}")
            continue
        notes[k] = [[round(float(s), 4), round(float(e - s), 4), int(n), int(max(1, min(127, round(a * 127))))] for s, e, n, a, *_ in ev]
        notes[k].sort()
        times[f"basic_pitch_{k}"] = round(time.time() - t0, 1)

    # ---------- 5b. MuScriptor: the whole mix -> notes per instrument (35 classes) ----------
    mus = None
    if a.muscriptor != "off":
        set_span(pre_end, 0.985)
        mus = run_muscriptor(src, out, a.muscriptor, times)
        set_span(0.985 - 0.95 * 0.015 / 0.05, 0.985 + 0.05 * 0.015 / 0.05)  # drums: the last sliver

    # ---------- 6. drum hits from the DrumSep stems ----------
    say(0.95, "드럼 타격을 찾는 중")
    GM = {"kick": 36, "snare": 38, "toms": 45, "hh": 42, "hihat": 42, "ride": 51, "crash": 49, "cymbals": 49}
    drums = []
    for k, f in drum_parts.items():
        n = GM.get(k.replace(" ", "").replace("-", ""), None)
        if n is None: continue
        s, _ = librosa.load(str(f), sr=22050, mono=True)
        if np.sqrt(np.mean(s ** 2)) < 1e-4: continue
        env = librosa.onset.onset_strength(y=s, sr=22050, hop_length=256)
        peak = env.max() or 1
        env = env / peak  # onset_detect thresholds a 0..1 envelope
        # a hit must also be loud in absolute terms: bleed from other drums is quiet in a clean stem
        rms = librosa.feature.rms(y=s, frame_length=1024, hop_length=256)[0]
        loud = rms / (rms.max() or 1)
        on = [fr for fr in librosa.onset.onset_detect(onset_envelope=env, sr=22050, hop_length=256, backtrack=False, delta=0.07, wait=3, normalize=False)
              if loud[min(len(loud) - 1, fr + 2)] > 0.12]
        peak = 1
        for fr in on:
            drums.append([round(float(fr * 256 / 22050), 4), n, int(max(30, min(127, 40 + 87 * env[fr] / peak)))])
    drums.sort()

    res = {
        "version": 1, "engine": "melofi-stems", "device": dev, "duration": round(duration, 3),
        "bpm": round(bpm, 2), "meter": meter, "beats": beats, "downbeats": downbeats,
        "first_downbeat": downbeats[0] if downbeats else (beats[0] if beats else 0.0),
        "key": key,
        "stems": {k: str(p) for k, p in stems.items()},
        "drum_parts": {k: str(p) for k, p in drum_parts.items()},
        "harmonic": str(final / "harmonic_22k.wav") if harm is not None else None,
        "notes": notes, "drums": drums, "muscriptor": mus,
        "muscriptor_runs": {mus["model"]: mus} if mus and "error" not in mus else {},
        "models": {"vocals": "BS-RoFormer (ep 317, SDR 12.98)", "lead_backing": None if a.quick else "Mel-Band RoFormer karaoke",
                   "instruments": "BS-RoFormer SW 6-stem", "drum_parts": None if a.quick else "MDX23C DrumSep", "beats": "Beat This! final0", "notes": "Basic Pitch (ICASSP 2022)"},
        "times": {**times, "total": round(time.time() - t_all, 1)},
    }
    (out / "result.json").write_text(json.dumps(res, ensure_ascii=False), encoding="utf-8")
    try: os.remove(src)
    except OSError: pass
    shutil.rmtree(sep_dir, ignore_errors=True)
    say(1.0, "끝", result=str(out / "result.json"))


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as e:  # report to the app as one line
        import traceback
        print(json.dumps({"error": f"{type(e).__name__}: {e}", "trace": traceback.format_exc()[-1500:]}, ensure_ascii=False), flush=True)
        sys.exit(1)
