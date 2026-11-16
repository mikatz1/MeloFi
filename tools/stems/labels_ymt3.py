"""Instrument labels for a separated song from YourMT3+ (experimental; docs/roundtrip-eval.md).

A multi-instrument transcription of the whole song says which instrument plays which note. The
app uses that only as a hint: how a stem's notes split into instruments and which families each
part is matched in (midiconvert.js labelParts / splitByLabels); the notes stay Basic Pitch's and
the instrument is still chosen by listening.

  python labels_ymt3.py --out <analysis folder> [--audio <file>] [--device cuda|cpu]

Writes <analysis folder>/labels.json: { source, model, seconds, parts: { category: [[t, d, n, v]] } },
categories as MuScriptor's (ai.js MUS). Without --audio the song is the sum of the folder's stems.

Runs in its own Python environment with the mt3-infer package (MIT wrapper; YourMT3+ checkpoint
"YPTF.MoE+Multi (noPS)"). The upstream YourMT3 code is GPL-3.0 and its checkpoints are tagged
Apache-2.0 on Hugging Face: this script is a separate process and is not part of the default
pipeline until that is settled. MT3_CHECKPOINT_DIR says where the checkpoint is.
"""
import argparse, json, os, sys, time
from pathlib import Path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # gpu_cap.py next to this file


def category(program, name, is_drum):
    if is_drum:
        return "drums"
    n = (name or "").lower()
    p = program
    if "electric piano" in n: return "electric_piano"
    if p <= 3: return "acoustic_piano"
    if p <= 5: return "electric_piano"
    if p <= 7: return "acoustic_piano"
    if p <= 15: return "chromatic_percussion"
    if p <= 23: return "organ"
    if p <= 25: return "acoustic_guitar"
    if p <= 28: return "clean_electric_guitar"
    if p <= 31: return "distorted_electric_guitar"
    if p == 32: return "acoustic_bass"
    if p <= 39: return "electric_bass"
    if p == 40: return "violin"
    if p == 41: return "viola"
    if p == 42: return "cello"
    if p == 43: return "contrabass"
    if p <= 45: return "string_ensemble"
    if p == 46: return "orchestral_harp"
    if p == 47: return "timpani"
    if p <= 49: return "string_ensemble"
    if p <= 51: return "synth_strings"
    if p <= 54: return "voice"
    if p == 55: return "orchestra_hit"
    if p in (56, 59): return "trumpet"
    if p == 57: return "trombone"
    if p == 58: return "tuba"
    if p == 60: return "french_horn"
    if p <= 63: return "brass_section"
    if p <= 65: return "soprano_and_alto_sax"
    if p == 66: return "tenor_sax"
    if p == 67: return "baritone_sax"
    if p == 68: return "oboe"
    if p == 69: return "english_horn"
    if p == 70: return "bassoon"
    if p == 71: return "clarinet"
    if p <= 79: return "flutes"
    if p <= 87: return "synth_lead"
    if p <= 95: return "synth_pad"
    return "synth_lead"


def midi_parts(mid):
    """notes per category from a mido MidiFile, times in seconds"""
    import mido
    tempo, tpb = 500000, mid.ticks_per_beat
    for tr in mid.tracks:
        for e in tr:
            if e.type == "set_tempo":
                tempo = e.tempo; break
    sec = lambda ticks: mido.tick2second(ticks, tpb, tempo)
    parts = {}
    for tr in mid.tracks:
        name, prog, t, on, notes, drum = "", 0, 0, {}, [], False
        for e in tr:
            t += e.time
            if e.type == "track_name": name = e.name
            elif e.type == "program_change": prog = e.program
            elif e.type == "note_on" and e.velocity > 0:
                on[e.note] = (t, e.velocity); drum = drum or e.channel == 9
            elif e.type in ("note_off", "note_on"):
                o = on.pop(e.note, None)
                if o: notes.append([round(sec(o[0]), 4), round(max(0.03, sec(t - o[0])), 4), e.note, o[1]])
        if notes:
            parts.setdefault(category(prog, name, drum), []).extend(notes)
    return {c: sorted(v) for c, v in parts.items()}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--audio", default=None)
    ap.add_argument("--device", default="auto")
    a = ap.parse_args()
    out = Path(a.out)
    import numpy as np
    import librosa
    import mt3_infer
    t0 = time.time()
    if a.audio:
        y, _ = librosa.load(a.audio, sr=16000, mono=True)
    else:
        res = json.loads((out / "result.json").read_text(encoding="utf-8"))
        y = None
        for f in res["stems"].values():
            s, _ = librosa.load(f, sr=16000, mono=True)
            y = s if y is None else y[: len(s)] + s[: len(y)]
    model = mt3_infer.load_model("yourmt3", device=a.device, auto_download=False)
    try:  # MELOFI_GPU_CAP (test runs): a ceiling on the card's memory and load
        import torch, gpu_cap
        gpu_cap.limit_memory(torch)
        for m in gpu_cap.modules_of(model, torch, depth=3): gpu_cap.throttle(m, torch)
    except ImportError:
        pass
    mid = model.transcribe(np.asarray(y, dtype=np.float32), sr=16000)
    parts = midi_parts(mid)
    parts.pop("drums", None)
    (out / "labels.json").write_text(json.dumps({"source": "yourmt3", "model": "YPTF.MoE+Multi (noPS)", "seconds": round(time.time() - t0, 1), "parts": parts}), encoding="utf-8")
    print(json.dumps({"labels": {c: len(v) for c, v in parts.items()}, "seconds": round(time.time() - t0, 1)}))


if __name__ == "__main__":
    sys.exit(main())
