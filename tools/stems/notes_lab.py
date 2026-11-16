"""Development tool: the transcription step alone, on songs already separated by a round-trip run.

The round-trip test (docs/roundtrip-eval.md) takes minutes per idea because every run goes through
the app. The note score is mostly decided here, in Basic Pitch and what is done with its output, so
this script keeps Basic Pitch's raw output of every cached stem (once) and scores note clean-ups
against the reference songs in seconds.

  python -I tools/stems/notes_lab.py <round-trip run dir> [--cache <dir for raw outputs>] [--variant name ...]

The run dir needs <id>.truth.json and <id>.out.json (its "dir" is the song's analysis folder).
Scores are the round-trip scorer's: pooled pitched notes, onset within 50 ms and the same pitch, F1,
after the best overall time shift. Run with the analysis engine's Python.
"""
import argparse, json, sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import notes_clean as NC  # noqa: E402

TOL = 0.05


def match_count(ref, out, tol=TOL):
    """one-to-one matches: same pitch, |dt| <= tol, nearest first. ref/out: arrays [t, n]"""
    if not len(ref) or not len(out):
        return 0
    cand = []
    by = {}
    for j, (t, n) in enumerate(out):
        by.setdefault(int(n), []).append((t, j))
    for i, (t, n) in enumerate(ref):
        for (u, j) in by.get(int(n), []):
            d = abs(u - t)
            if d <= tol:
                cand.append((d, i, j))
    cand.sort()
    ui, uj, m = set(), set(), 0
    for _, i, j in cand:
        if i not in ui and j not in uj:
            ui.add(i); uj.add(j); m += 1
    return m


def best_shift(ref, out):
    best = (0.0, -1)
    if not len(out):
        return 0.0
    for d in np.arange(-0.4, 0.4001, 0.01):
        m = match_count(ref, [(t + d, n) for t, n in out])
        if m > best[1]:
            best = (d, m)
    # refine
    c = best[0]
    for d in np.arange(c - 0.01, c + 0.0101, 0.0025):
        m = match_count(ref, [(t + d, n) for t, n in out])
        if m > best[1]:
            best = (d, m)
    return best[0]


def load_songs(run):
    songs = []
    for tf in sorted(Path(run).glob("*.truth.json")):
        sid = tf.name.replace(".truth.json", "")
        of = Path(run) / f"{sid}.out.json"
        if not of.exists():
            continue
        truth = json.loads(tf.read_text(encoding="utf-8"))
        out = json.loads(of.read_text(encoding="utf-8"))
        res = json.loads((Path(out["dir"]) / "result.json").read_text(encoding="utf-8"))
        ref = [(t, n, pi) for pi, p in enumerate(truth["parts"]) if not p["kit"] for (t, d, n, v, *_) in p["notes"]]
        refd = [d for pi, p in enumerate(truth["parts"]) if not p["kit"] for (t, d, n, v, *_) in p["notes"]]
        songs.append({"id": sid, "truth": truth, "ref": ref, "refd": refd, "res": res, "dir": out["dir"]})
    return songs


def raw_outputs(song, cache):
    """Basic Pitch's model output per pitched stem, computed once"""
    f = Path(cache) / f"{song['id']}.npz"
    if f.exists():
        z = np.load(f, allow_pickle=True)
        return z["out"].item()
    from basic_pitch.inference import run_inference, Model
    from basic_pitch import ICASSP_2022_MODEL_PATH
    model = Model(ICASSP_2022_MODEL_PATH)
    outs = {}
    for k, path in song["res"]["stems"].items():
        if k in ("drums",):
            continue
        outs[k] = run_inference(path, model)
    np.savez_compressed(f, out=np.array(outs, dtype=object))
    return outs


def offset_hits(ref, refd, out, outd, tol=TOL):
    """matched notes (as match_count) whose ends also agree: within 50 ms or 20% of the length"""
    cand = []
    by = {}
    for j, (t, n) in enumerate(out):
        by.setdefault(int(n), []).append((t, j))
    for i, (t, n) in enumerate(ref):
        for (u, j) in by.get(int(n), []):
            if abs(u - t) <= tol:
                cand.append((abs(u - t), i, j))
    cand.sort()
    ui, uj, m = set(), set(), 0
    for _, i, j in cand:
        if i not in ui and j not in uj:
            ui.add(i); uj.add(j)
            if abs((ref[i][0] + refd[i]) - (out[j][0] + outd[j])) <= max(0.05, 0.2 * refd[i]): m += 1
    return m


def score(ref, notes, refd=None):
    """notes: list of [t, d, n, v] pooled. returns f1, precision, recall, octave-free f1"""
    r = [(t, n) for t, n, _ in ref]
    o = [(x[0], x[2]) for x in notes]
    sh = best_shift(r, o)
    o = [(t + sh, n) for t, n in o]
    m = match_count(r, o)
    mo = match_count([(t, n % 12) for t, n in r], [(t, n % 12) for t, n in o])
    f = 200 * m / max(1, len(r) + len(o))
    off = 200 * offset_hits(r, refd, o, [x[1] for x in notes]) / max(1, len(r) + len(o)) if refd else None
    return {"f1": f, "p": 100 * m / max(1, len(o)), "r": 100 * m / max(1, len(r)), "oct": 200 * mo / max(1, len(r) + len(o)), "off": off, "shift": sh}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("run")
    ap.add_argument("--cache", default=None)
    ap.add_argument("--variant", nargs="*", default=None)
    ap.add_argument("--per-stem", action="store_true")
    a = ap.parse_args()
    cache = Path(a.cache or (Path(a.run) / "bp-raw")); cache.mkdir(exist_ok=True, parents=True)
    songs = load_songs(a.run)
    variants = a.variant or list(NC.VARIANTS)
    tot = {v: [] for v in variants}
    for s in songs:
        raw = raw_outputs(s, cache)
        stems = NC.load_stems(s["res"]) if any(NC.VARIANTS[v].get("needs_audio") for v in variants) else None
        line = [s["id"].ljust(11)]
        for v in variants:
            notes = NC.transcribe(raw, s["res"], stems, **NC.VARIANTS[v])
            pooled = [x for k, ns in notes.items() for x in ns]
            sc = score(s["ref"], pooled, s["refd"])
            tot[v].append(sc)
            line.append(f"{v}:{sc['f1']:.1f}({sc['p']:.0f}/{sc['r']:.0f})")
        print("  ".join(line), flush=True)
    print()
    for v in variants:
        L = tot[v]
        print(f"{v.ljust(14)} f1 {np.mean([x['f1'] for x in L]):.1f}  precision {np.mean([x['p'] for x in L]):.1f}  recall {np.mean([x['r'] for x in L]):.1f}  octave-free {np.mean([x['oct'] for x in L]):.1f}  with ends {np.mean([x['off'] for x in L]):.1f}")


if __name__ == "__main__":
    main()
