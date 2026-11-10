"""MeloFi vocal engine (NNSVS): MusicXML with one lyric syllable per note -> WAV.

usage: python svs_render.py <in.musicxml> <out.wav> [--model r9y9/yoko_latest] [--models-dir DIR]
Prints one JSON line on success: {"ok": true, "sr": 48000, "seconds": 12.3}
"""
import argparse, json, os, sys, warnings
warnings.filterwarnings("ignore")


def patch_nnsvs():
    """nnsvs 0.1.1 predates NumPy 2 / SciPy 1.15: two one-line fixes, applied once to the installed copy."""
    import importlib.util, pathlib
    spec = importlib.util.find_spec("nnsvs")
    root = pathlib.Path(spec.origin).parent
    fixes = [
        (root / "gen.py", "L = int(fe.duration_features(p)[0])", "L = int(np.asarray(fe.duration_features(p)).ravel()[0])"),
        (root / "dsp.py", "Wn = [norm_cutoff]", "Wn = norm_cutoff"),
    ]
    for f, old, new in fixes:
        t = f.read_text(encoding="utf-8")
        if old in t:
            f.write_text(t.replace(old, new), encoding="utf-8")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("xml")
    ap.add_argument("out")
    ap.add_argument("--model", default="r9y9/yoko_latest")
    ap.add_argument("--models-dir", default=None)
    a = ap.parse_args()
    if a.models_dir:
        os.environ["NNSVS_CACHE_DIR"] = a.models_dir
    patch_nnsvs()
    import numpy as np, soundfile as sf, pysinsy, torch
    from nnmnkwii.io import hts
    from nnsvs.pretrained import retrieve_pretrained_model
    from nnsvs.svs import SPSVS

    model_dir = retrieve_pretrained_model(a.model)
    engine = SPSVS(model_dir, device="cuda" if torch.cuda.is_available() else "cpu")
    contexts = pysinsy.extract_fullcontext(a.xml)
    labels = hts.HTSLabelFile.create_from_contexts(contexts)
    wav, sr = engine.svs(labels)
    wav = np.asarray(wav, dtype=np.float32)
    if np.abs(wav).max() > 1.5:  # int16-scaled output
        wav = wav / 32768.0
    sf.write(a.out, wav, sr, subtype="FLOAT")
    print(json.dumps({"ok": True, "sr": sr, "seconds": round(len(wav) / sr, 2)}))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # report to MeloFi instead of a traceback
        print(json.dumps({"ok": False, "error": f"{type(e).__name__}: {e}"}))
        sys.exit(1)
