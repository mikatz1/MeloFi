"""MeloFi: the piano stem transcribed by a model made for pianos (an optional component).

High-resolution Piano Transcription (Kong et al. 2021; the piano_transcription_inference package,
MIT) hears an acoustic piano's notes, their ends and how hard they were struck far better than the
general transcription does (round-trip test, docs/roundtrip-eval.md 8.3: a solo piano piece went
from 49% of its notes found to 87-99%). It is worse on electric pianos, so it is used only where the
instrument recognition (instruments.json, AST) hears an acoustic piano in the stem: "piano" above
"electric piano" in at least 70% of the windows where the stem sounds.

The checkpoint is published under CC BY 4.0, but it was trained on MAESTRO (CC BY-NC-SA 4.0), so
MeloFi treats what it writes as for non-commercial use: the channels made from it say so.

It runs as a separate process in its own environment (stems-engine/piano) and writes
piano_notes.json beside the analysis:
  { source, acoustic, share, windows, seconds, notes: [[t, d, n, v]] }   (notes only when acoustic)

usage: python piano_notes.py --out <analysis dir> --checkpoint <note.pth> [--device cuda]
"""
import argparse, json, sys, time, types
from pathlib import Path

MIN_SHARE = 0.7      # of the windows where the stem sounds: "piano" above "electric piano"
MIN_DB = -60.0       # a window quieter than this says nothing


def acoustic_share(inst):
    """(share, windows): how often the piano stem is heard as an acoustic piano"""
    ws = [w for w in (inst.get("stems") or {}).get("piano", []) if w.get("p") and w.get("db", -180) > MIN_DB]
    if not ws:
        return 0.0, 0
    return sum(w["p"].get("piano", 0) > w["p"].get("epiano", 0) for w in ws) / len(ws), len(ws)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--checkpoint", required=True)
    ap.add_argument("--device", default=None)
    a = ap.parse_args()
    out = Path(a.out)
    res = json.loads((out / "result.json").read_text(encoding="utf-8"))
    f = (res.get("stems") or {}).get("piano")
    ifile = out / "instruments.json"
    if not ifile.exists():
        print(json.dumps({"wait": "instruments"}))  # (asked again once the instruments are recognised)
        return 0
    share, windows = acoustic_share(json.loads(ifile.read_text(encoding="utf-8")))
    base = {"source": "piano_transcription", "share": round(share, 3), "windows": windows}
    if not f or not Path(f).exists() or share < MIN_SHARE:
        (out / "piano_notes.json").write_text(json.dumps({**base, "acoustic": False}), encoding="utf-8")
        print(json.dumps({"acoustic": False, "share": round(share, 3)}))
        return 0
    t0 = time.time()
    # the package imports these at load for things MeloFi does not use (plots, its own file reader,
    # MIDI writing); they are not installed
    for name in ("matplotlib", "matplotlib.pyplot", "audioread", "mido"):
        sys.modules.setdefault(name, types.ModuleType(name))
    if not hasattr(sys.modules["mido"], "MidiFile"): sys.modules["mido"].MidiFile = object
    if not hasattr(sys.modules["audioread"], "ffdec"): sys.modules["audioread"].ffdec = types.SimpleNamespace(FFmpegAudioFile=None)
    import contextlib, io
    import librosa, torch
    from piano_transcription_inference import PianoTranscription
    dev = a.device or ("cuda" if torch.cuda.is_available() else "cpu")
    with contextlib.redirect_stdout(io.StringIO()):  # (the package prints its progress)
        tr = PianoTranscription(device=dev, checkpoint_path=a.checkpoint)
        try:  # MELOFI_GPU_CAP (test runs): a ceiling on the card's memory and load
            import gpu_cap
            gpu_cap.limit_memory(torch); gpu_cap.throttle(tr.model, torch)
        except ImportError:
            pass
        y, _ = librosa.load(f, sr=16000, mono=True)
        ev = tr.transcribe(y, None)["est_note_events"]
    notes = sorted([round(float(e["onset_time"]), 4), round(max(0.03, float(e["offset_time"]) - float(e["onset_time"])), 4),
                    int(e["midi_note"]), int(max(1, min(127, e["velocity"])))] for e in ev)
    (out / "piano_notes.json").write_text(json.dumps({**base, "acoustic": True, "seconds": round(time.time() - t0, 1), "notes": notes}), encoding="utf-8")
    print(json.dumps({"acoustic": True, "notes": len(notes), "seconds": round(time.time() - t0, 1)}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
