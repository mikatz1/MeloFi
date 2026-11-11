"""Which instrument plays in each separated stem, and when.

Runs the Audio Spectrogram Transformer fine-tuned on AudioSet (MIT/ast-finetuned-audioset-10-10-0.4593,
BSD-3-Clause) over 4-second windows of every stem (2-second hop) and keeps the probabilities of the
AudioSet classes that name instruments, grouped into the categories MeloFi maps to its own sounds.

  python instruments.py --dir <song cache dir> --models <engine models dir>

Writes <dir>/instruments.json:
  { "version": 1, "model": ..., "win": 4, "hop": 2,
    "stems": { "<stem>": [ { "t": start s, "db": RMS dBFS, "p": { "<category>": prob } } ] } }
Progress goes to stdout as JSON lines ({"p", "label"} / {"log"} / {"error"}).
"""
import argparse
import json
import math
import os
import sys

MODEL = "MIT/ast-finetuned-audioset-10-10-0.4593"
WIN, HOP, SR = 4.0, 2.0, 16000

# MeloFi categories <- AudioSet class names
CATEGORIES = {
    "piano": ["Piano"],
    "epiano": ["Electric piano"],
    "organ": ["Organ", "Electronic organ", "Hammond organ"],
    "harpsichord": ["Harpsichord"],
    "synth": ["Synthesizer", "Sampler"],
    "guitar_ac": ["Acoustic guitar"],
    "guitar_el": ["Electric guitar", "Guitar"],
    "plucked": ["Banjo", "Mandolin", "Ukulele", "Sitar", "Zither", "Plucked string instrument"],
    "harp": ["Harp"],
    "bass": ["Bass guitar"],
    "upright": ["Double bass"],
    "strings": ["String section", "Bowed string instrument", "Orchestra"],
    "violin": ["Violin, fiddle"],
    "cello": ["Cello"],
    "pizzicato": ["Pizzicato"],
    "brass": ["Brass instrument", "Trumpet", "Trombone", "French horn"],
    "sax": ["Saxophone"],
    "flute": ["Flute"],
    "clarinet": ["Clarinet", "Wind instrument, woodwind instrument"],
    "mallet": ["Marimba, xylophone", "Vibraphone", "Glockenspiel", "Steelpan"],
    "bell": ["Bell", "Chime", "Tubular bells", "Church bell"],
    "harmonica": ["Harmonica", "Accordion"],
    "choir": ["Choir"],
    "voice": ["Singing", "Male singing", "Female singing", "Child singing", "Rapping", "Humming"],
    "drums_ac": ["Drum kit", "Snare drum", "Drum roll", "Rimshot"],
    "drums_el": ["Drum machine", "Electronic music", "Techno", "Dubstep", "Drum and bass"],
}


def say(**m):
    print(json.dumps(m, ensure_ascii=False), flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", required=True)
    ap.add_argument("--models", required=True)
    a = ap.parse_args()
    os.environ.setdefault("HF_HOME", os.path.join(a.models, "hf"))
    try:
        import numpy as np
        import soundfile as sf
        import torch
        import librosa
        from transformers import ASTFeatureExtractor, ASTForAudioClassification
    except Exception as e:  # noqa: BLE001
        say(error=f"악기 인식 구성 요소가 없습니다: {e}")
        sys.exit(2)

    res = json.load(open(os.path.join(a.dir, "result.json"), encoding="utf-8"))
    stems = {k: v for k, v in res["stems"].items() if os.path.exists(v)}
    dev = "cuda" if torch.cuda.is_available() else "cpu"
    say(p=0.02, label="악기 인식 모델을 불러오는 중… (처음엔 내려받아요, 약 350MB)")
    fe = ASTFeatureExtractor.from_pretrained(MODEL)
    model = ASTForAudioClassification.from_pretrained(MODEL).to(dev).eval()
    if dev == "cuda":
        model = model.half()
    names = model.config.id2label
    idx = {n: i for i, n in names.items()}
    cats = {c: [idx[n] for n in labels if n in idx] for c, labels in CATEGORIES.items()}
    missing = [n for labels in CATEGORIES.values() for n in labels if n not in idx]
    if missing:
        say(log=f"[악기 인식] 모델에 없는 분류: {', '.join(missing)}")

    out = {"version": 1, "model": MODEL, "win": WIN, "hop": HOP, "stems": {}}
    order = [k for k in ["vocals", "backing", "drums", "bass", "guitar", "piano", "other"] if k in stems]
    for si, k in enumerate(order):
        say(p=0.05 + 0.9 * si / len(order), label=f"악기를 알아보는 중… {k} ({si + 1}/{len(order)})")
        y, sr = sf.read(stems[k], dtype="float32", always_2d=True)
        y = y.mean(axis=1)
        y = librosa.resample(y, orig_sr=sr, target_sr=SR)
        n_win = max(1, int(math.ceil((len(y) / SR - WIN) / HOP)) + 1)
        rows, batch, metas = [], [], []

        def flush():
            if not batch:
                return
            feats = fe(batch, sampling_rate=SR, return_tensors="pt")["input_values"].to(dev)
            if dev == "cuda":
                feats = feats.half()
            with torch.no_grad():
                prob = torch.sigmoid(model(feats).logits.float()).cpu().numpy()
            for (t, dbv), pr in zip(metas, prob):
                rows.append({"t": round(t, 2), "db": round(dbv, 1), "p": {c: round(float(max(pr[i] for i in ids)), 3) for c, ids in cats.items() if ids}})
            batch.clear(); metas.clear()

        for w in range(n_win):
            t0 = w * HOP
            seg = y[int(t0 * SR): int((t0 + WIN) * SR)]
            if len(seg) < SR * 0.5:
                break
            rms = float(np.sqrt(np.mean(seg ** 2)) + 1e-9)
            dbv = 20 * math.log10(rms)
            if dbv < -50:  # silent: no need to ask the model
                rows.append({"t": round(t0, 2), "db": round(dbv, 1), "p": {}})
                continue
            batch.append(seg); metas.append((t0, dbv))
            if len(batch) >= 32:
                flush()
        flush()
        rows.sort(key=lambda r: r["t"])
        out["stems"][k] = rows
        say(log=f"[악기 인식] {k}: 창 {len(rows)}개")
    out["device"] = dev
    with open(os.path.join(a.dir, "instruments.json"), "w", encoding="utf-8") as f:
        json.dump(out, f)
    say(p=1, label="악기 인식을 마쳤어요")


if __name__ == "__main__":
    main()
