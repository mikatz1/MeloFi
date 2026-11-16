"""MeloFi: the bass stem transcribed by a model made for basses (an optional component).

A Kong-style note transcription model trained on bass recordings (Riley, Edwards, Dixon; checkpoint
"filobass" from huggingface.co/xavriley/midi-transcription-models, tagged MIT) run through the
piano_transcription_inference package (MIT) that the piano component installs: the same network,
another checkpoint. On the round-trip songs it finds a bass guitar's notes far better than the
general transcription (docs/roundtrip-eval.md 8.3), and it fails on what it was not trained on: an
808 or a sub bass comes out with half its notes or none. So its notes are used only when it finds
at least 80% as many notes as the general transcription did; otherwise the stem keeps those.

The checkpoint is a training snapshot (weights plus the sampler's state as numpy arrays). It is
read with torch's weights-only loader and a short allowlist for those arrays: nothing in the file
is executed.

It runs as a separate process in the piano component's environment (stems-engine/piano) and writes
bass_notes.json beside the analysis:
  { source, used, ratio, general, seconds, notes: [[t, d, n, v]] }   (notes only when used)

usage: python bass_notes.py --out <analysis dir> --checkpoint <filobass.pth> [--device cuda]
"""
import argparse, json, os, sys, time, types
from pathlib import Path

MIN_RATIO = 0.8      # the model's notes / the general transcription's notes
MIN_NOTES = 8        # a stem with fewer notes than this is left alone


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--checkpoint", required=True)
    ap.add_argument("--device", default=None)
    a = ap.parse_args()
    out = Path(a.out)
    res = json.loads((out / "result.json").read_text(encoding="utf-8"))
    f = (res.get("stems") or {}).get("bass")
    general = (res.get("notes") or {}).get("bass") or []
    base = {"source": "bass_transcription", "general": len(general)}
    if not f or not Path(f).exists() or len(general) < MIN_NOTES:
        (out / "bass_notes.json").write_text(json.dumps({**base, "used": False, "ratio": 0}), encoding="utf-8")
        print(json.dumps({"used": False}))
        return 0
    t0 = time.time()
    # the package imports these at load for things MeloFi does not use (plots, its own file reader,
    # MIDI writing); they are not installed
    for name in ("matplotlib", "matplotlib.pyplot", "audioread", "mido"):
        sys.modules.setdefault(name, types.ModuleType(name))
    if not hasattr(sys.modules["mido"], "MidiFile"): sys.modules["mido"].MidiFile = object
    if not hasattr(sys.modules["audioread"], "ffdec"): sys.modules["audioread"].ffdec = types.SimpleNamespace(FFmpegAudioFile=None)
    import contextlib, io
    import numpy as np, librosa, torch
    from piano_transcription_inference import PianoTranscription
    dev = a.device or ("cuda" if torch.cuda.is_available() else "cpu")
    core = getattr(np, "_core", None) or np.core
    allow = [(core.multiarray._reconstruct, "numpy.core.multiarray._reconstruct"), (core.multiarray.scalar, "numpy.core.multiarray.scalar"),
             np.ndarray, np.dtype] + [type(np.dtype(t)) for t in ("int64", "int32", "float64", "float32", "bool")]
    # (the package fetches the piano checkpoint with wget when the file it is given is smaller than
    # the piano one: this checkpoint is, and nothing is to be fetched)
    real_system = os.system
    os.system = lambda *_a, **_k: 0
    try:
        with contextlib.redirect_stdout(io.StringIO()), torch.serialization.safe_globals(allow):
            tr = PianoTranscription(model_type="Regress_onset_offset_frame_velocity_CRNN", checkpoint_path=a.checkpoint, device=dev)
    finally:
        os.system = real_system
    try:  # MELOFI_GPU_CAP (test runs): a ceiling on the card's memory and load
        import gpu_cap
        gpu_cap.limit_memory(torch); gpu_cap.throttle(tr.model, torch)
    except ImportError:
        pass
    with contextlib.redirect_stdout(io.StringIO()):
        y, _ = librosa.load(f, sr=16000, mono=True)
        ev = tr.transcribe(y, None)["est_note_events"]
    notes = sorted([round(float(e["onset_time"]), 4), round(max(0.03, float(e["offset_time"]) - float(e["onset_time"])), 4),
                    int(e["midi_note"]), int(max(1, min(127, e["velocity"])))] for e in ev)
    ratio = len(notes) / len(general)
    used = ratio >= MIN_RATIO
    doc = {**base, "used": used, "ratio": round(ratio, 3), "seconds": round(time.time() - t0, 1)}
    if used: doc["notes"] = notes
    (out / "bass_notes.json").write_text(json.dumps(doc), encoding="utf-8")
    print(json.dumps({"used": used, "ratio": round(ratio, 3), "notes": len(notes), "seconds": doc["seconds"]}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
