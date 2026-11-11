"""Check a sung take against its notes: audible, not clipped, and on pitch.

usage: python -I check_sing.py <wav> <notes.json>   (notes: [{t, d, n}] in seconds)
Prints one JSON line: {"ok", "rms_db", "peak", "voiced", "cents_median", "notes_on_pitch", "per_note"}.
A note is on pitch when the median f0 over its middle half is within 50 cents of the written note.
"""
import json, sys
sys.stdout.reconfigure(encoding="utf-8")  # -I ignores PYTHONIOENCODING; MeloFi reads UTF-8
import numpy as np, soundfile as sf, librosa


def main():
    wav, sr = sf.read(sys.argv[1], dtype="float32", always_2d=True)
    y = wav.mean(axis=1)
    notes = json.load(open(sys.argv[2], encoding="utf-8"))
    if isinstance(notes, dict):
        notes = notes["notes"]
    peak = float(np.abs(y).max()) if len(y) else 0.0
    rms = float(np.sqrt(np.mean(y ** 2))) if len(y) else 0.0
    if sr > 24000:
        y = librosa.resample(y, orig_sr=sr, target_sr=22050)
        sr = 22050
    hop = 256
    # YIN (no voicing decision of its own: pYIN's is unreliable on breathy synthetic voices), gated by
    # level and by YIN's own periodicity so noise and consonants do not count
    f0 = librosa.yin(y, fmin=65, fmax=1100, sr=sr, frame_length=2048, hop_length=hop)
    frms = librosa.feature.rms(y=y, frame_length=2048, hop_length=hop)[0][: len(f0)]
    ref = np.percentile(frms, 95) if len(frms) else 1.0
    zcr = librosa.feature.zero_crossing_rate(y, frame_length=2048, hop_length=hop)[0][: len(f0)]
    vflag = (frms > ref * 10 ** (-24 / 20)) & (zcr < 0.25)
    t = np.arange(len(f0)) * hop / sr
    per, errs = [], []
    for x in notes:
        if str(x.get("syl", "")) in ("-", "R"):
            continue
        a, b = x["t"] + x["d"] * 0.25, x["t"] + x["d"] * 0.75
        m = (t >= a) & (t <= b) & vflag & np.isfinite(f0)
        if m.sum() < 3:
            per.append(None)
            continue
        midi = float(np.median(librosa.hz_to_midi(f0[m])))
        c = (midi - x["n"]) * 100
        # an octave slip of the tracker is not the singer's fault
        if abs(abs(c) - 1200) < 60:
            c = abs(c) - 1200
        per.append(round(c, 1))
        errs.append(abs(c))
    on = sum(1 for c in per if c is not None and abs(c) <= 50)
    voiced = float(np.mean(vflag)) if len(vflag) else 0.0
    out = {
        "rms_db": round(20 * np.log10(rms + 1e-12), 1), "peak": round(peak, 3), "voiced": round(voiced, 2),
        "cents_median": round(float(np.median(errs)), 1) if errs else None, "notes_on_pitch": f"{on}/{len(per)}", "per_note": per,
    }
    out["ok"] = bool(out["rms_db"] > -40 and peak <= 1.0 and errs and on >= 0.75 * len(per))
    print(json.dumps(out))


if __name__ == "__main__":
    main()
