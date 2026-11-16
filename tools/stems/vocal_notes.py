"""MeloFi: the lead vocal's notes from a model made for singing (an optional component).

GAME (Generative Adaptive MIDI Extractor, OpenVPI; code MIT, weights CC BY-NC-SA 4.0) writes a sung
line as notes: where each note starts and ends, and its one pitch. On the round-trip songs it gets
far more of the notes right than the general transcription, and above all their ends
(docs/roundtrip-eval.md 8.3). Its weights are for non-commercial use, so the channels made from its
notes say so.

GAME is a repository, not a package: the component holds its source at one commit, its own Python
environment and the model. This script runs GAME's own `infer.py extract` inside this process (so
a test run's GPU ceiling applies) on the vocals stem and writes vocal_notes.json beside the analysis:
  { source, used, general, seconds, notes: [[t, d, n, v]] }   (notes only when used)

usage: python vocal_notes.py --out <analysis dir> --game <GAME source dir> --model <model.pt>
"""
import argparse, csv, json, os, runpy, sys, tempfile, time
from pathlib import Path

MIN_NOTES = 8        # fewer notes than this from either transcription: the stem is left alone


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--game", required=True)
    ap.add_argument("--model", required=True)
    a = ap.parse_args()
    out = Path(a.out)
    res = json.loads((out / "result.json").read_text(encoding="utf-8"))
    f = (res.get("stems") or {}).get("vocals")
    general = (res.get("notes") or {}).get("vocals") or []
    base = {"source": "game", "general": len(general)}

    def leave():
        (out / "vocal_notes.json").write_text(json.dumps({**base, "used": False}), encoding="utf-8")
        print(json.dumps({"used": False}))
        return 0

    if not f or not Path(f).exists() or len(general) < MIN_NOTES:
        return leave()
    t0 = time.time()
    try:  # MELOFI_GPU_CAP (test runs): GAME's modules are many and built inside its own code, so the
        # ceiling is kept by the card's own reading, looked at a few times a second
        import torch, gpu_cap
        if gpu_cap.CAP:
            gpu_cap.limit_memory(torch)
            last = [0.0]

            def pace(_m, _i, _o):
                now = time.perf_counter()
                if now - last[0] > 0.25:
                    last[0] = now; gpu_cap.hold()
            torch.nn.modules.module.register_module_forward_hook(pace)
    except ImportError:
        pass
    here = os.getcwd()
    with tempfile.TemporaryDirectory(prefix="melofi-game-") as tmp:
        argv = sys.argv
        try:
            os.chdir(a.game); sys.path.insert(0, a.game)
            sys.argv = ["infer.py", "extract", str(f), "-m", a.model, "--output-formats", "csv", "--pitch-format", "number", "--round-pitch", "--output-dir", tmp]
            try:
                runpy.run_path(os.path.join(a.game, "infer.py"), run_name="__main__")
            except SystemExit as e:
                if e.code not in (0, None):
                    raise RuntimeError(f"GAME ended with {e.code}")
        finally:
            sys.argv = argv; os.chdir(here)
        files = list(Path(tmp).glob("*.csv"))
        if not files:
            raise RuntimeError("GAME wrote no notes")
        rows = list(csv.DictReader(open(files[0], encoding="utf-8")))
    notes = []
    for x in rows:
        try:
            t, e, n = float(x["onset"]), float(x["offset"]), int(round(float(x["pitch"])))
        except (KeyError, ValueError):
            continue  # (a rest)
        if e - t >= 0.03 and 0 < n < 128:
            notes.append([round(t, 4), round(e - t, 4), n, 90])
    if len(notes) < MIN_NOTES:
        return leave()
    # how hard each note was sung, from the stem's loudness over the note (as the general
    # transcription's velocities: the loudest notes near the top)
    import numpy as np, librosa
    y, sr = librosa.load(f, sr=16000, mono=True)
    rms = librosa.feature.rms(y=y, frame_length=1024, hop_length=160)[0]
    top = float(np.percentile(rms, 99)) or 1.0
    for q in notes:
        i, j = int(q[0] * sr / 160), max(int(q[0] * sr / 160) + 1, int((q[0] + q[1]) * sr / 160))
        lv = float(np.max(rms[i:j])) if i < len(rms) else 0.0
        q[3] = int(max(30, min(127, round(40 + 80 * min(1.0, lv / top)))))
    (out / "vocal_notes.json").write_text(json.dumps({**base, "used": True, "seconds": round(time.time() - t0, 1), "notes": notes}), encoding="utf-8")
    print(json.dumps({"used": True, "notes": len(notes), "seconds": round(time.time() - t0, 1)}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
