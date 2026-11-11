"""Separation quality check on MUSDB18 (the standard benchmark): runs the same models as analyze.py
on the test songs' mixtures and scores each stem against the real multitrack with SDR (museval,
BSSEval v4, median over frames then over songs) — the number papers and leaderboards report.

usage: python eval_musdb.py --models <dir> --work <dir> [--root <musdb dir>] [--songs 10]
Without --root it uses the free 7-second MUSDB18 preview that the musdb package downloads.
"""
import argparse, json, re, shutil, time
from pathlib import Path
import numpy as np
import soundfile as sf


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", required=True)
    ap.add_argument("--work", required=True)
    ap.add_argument("--root", default=None)
    ap.add_argument("--songs", type=int, default=10)
    ap.add_argument("--multi", default="htdemucs_6s.yaml", help="the instrument model run on the instrumental")
    a = ap.parse_args()
    import musdb, museval
    from audio_separator.separator import Separator
    db = musdb.DB(root=a.root, download=a.root is None, subsets="test")
    work = Path(a.work); work.mkdir(parents=True, exist_ok=True)
    seps = {}

    def sep(model, path):
        if model not in seps:
            s = Separator(output_dir=str(work / "out"), model_file_dir=a.models, output_format="WAV", sample_rate=44100, log_level=40, use_autocast=True,
                          mdxc_params={"segment_size": 256, "override_model_segment_size": False, "batch_size": 1, "overlap": 4, "pitch_shift": 0})
            s.load_model(model_filename=model)
            seps[model] = s
        files = seps[model].separate(str(path))
        got = {}
        for f in files:
            f = work / "out" / Path(f).name
            # the stem is the LAST "(Name)" in the file name: separating a separated file keeps the first
            m = re.findall(r"_\(([^)]+)\)", f.name)
            if m: got[m[-1].lower()] = f
        return got

    scores = {k: [] for k in ("vocals", "drums", "bass", "other")}
    per_song = []
    for track in db.tracks[: a.songs]:
        t0 = time.time()
        mix = work / "mix.wav"
        sf.write(str(mix), track.audio, track.rate)
        v = sep("model_bs_roformer_ep_317_sdr_12.9755.ckpt", mix)
        m6 = sep(a.multi, v["instrumental"])
        rd = lambda f: sf.read(str(f), always_2d=True)[0]
        est = {"vocals": rd(v["vocals"]), "drums": rd(m6["drums"]), "bass": rd(m6["bass"])}
        # MUSDB's "other" = everything else: guitar + piano + other (+ voice the 6-stem model still heard)
        o = sum(rd(m6[k]) for k in ("guitar", "piano", "other", "vocals") if k in m6)
        est["other"] = o
        n = track.audio.shape[0]
        est = {k: np.pad(x, ((0, max(0, n - len(x))), (0, 0)))[:n] for k, x in est.items()}
        res = museval.eval_mus_track(track, est)
        row = {"song": track.name}
        for k in scores:
            sdr = np.nanmedian([f["metrics"]["SDR"] for f in res.scores["targets"][[t["name"] for t in res.scores["targets"]].index(k)]["frames"]])
            scores[k].append(float(sdr)); row[k] = round(float(sdr), 2)
        row["sec"] = round(time.time() - t0, 1)
        per_song.append(row)
        print(json.dumps(row, ensure_ascii=False), flush=True)
        shutil.rmtree(work / "out", ignore_errors=True)
    summary = {k: round(float(np.median(v)), 2) for k, v in scores.items() if v}
    summary["songs"] = len(per_song); summary["multi"] = a.multi
    print("SUMMARY " + json.dumps(summary), flush=True)
    (work / "musdb_scores.json").write_text(json.dumps({"summary": summary, "songs": per_song}, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
