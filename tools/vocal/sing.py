"""MeloFi singing: notes + syllables -> WAV, with whichever engine the voice needs.

usage: python -I sing.py <job.json>
job: {"engine": "diffsinger" | "nnsvs", "voice_dir": DIR, "vocoder_dir": DIR?, "speaker": NAME?,
      "notes": [{"t": sec, "d": sec, "n": midi, "syl": "사"}], "out": WAV, "steps": 50}
Prints JSON lines: {"p": 0.5} progress, then {"ok": true, "sr": .., "seconds": ..} or {"ok": false, "error": ..}.
"""
import json, os, re, sys, warnings
sys.stdout.reconfigure(encoding="utf-8")  # -I ignores PYTHONIOENCODING; MeloFi reads UTF-8

warnings.filterwarnings("ignore")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def say(**o):
    print(json.dumps(o, ensure_ascii=False), flush=True)


TARGET_DB = -18.0   # level of the sung parts, the same for every voice
CEILING = 10 ** (-1 / 20)  # peaks stay under -1 dBFS


def level(wav, sr):
    """one gain for the whole take (no compression, no limiting): the sung parts sit at TARGET_DB
    RMS, unless that would push a peak over the ceiling"""
    import numpy as np
    if not len(wav):
        return wav, 0.0
    hop = max(1, int(sr * 0.05))
    n = len(wav) // hop
    if n == 0:
        return wav, 0.0
    frames = wav[: n * hop].reshape(n, hop)
    rms = np.sqrt((frames ** 2).mean(axis=1) + 1e-12)
    active = rms[rms > rms.max() * 10 ** (-30 / 20)]
    cur = float(np.sqrt((active ** 2).mean())) if len(active) else float(rms.max())
    gain = 10 ** (TARGET_DB / 20) / max(cur, 1e-6)
    peak = float(np.abs(wav).max())
    gain = min(gain, CEILING / max(peak, 1e-6))
    return (wav * gain).astype(np.float32), 20 * np.log10(gain)


def finish(wav, sr, out):
    import numpy as np, soundfile as sf
    wav = np.nan_to_num(np.asarray(wav, dtype=np.float32))
    wav, gain_db = level(wav, sr)
    sf.write(out, wav, sr, subtype="PCM_24")  # 24-bit: what every decoder (and the Studio engine) reads
    say(ok=True, sr=sr, seconds=round(len(wav) / sr, 2), peak=round(float(np.abs(wav).max()) if len(wav) else 0, 3), gain_db=round(gain_db, 1))


# ---------------------------------------------------------------- NNSVS / ENUNU
def patch_nnsvs():
    """nnsvs 0.1.1 predates NumPy 2 / SciPy 1.15: two one-line fixes, applied once to the installed copy."""
    import importlib.util, pathlib
    root = pathlib.Path(importlib.util.find_spec("nnsvs").origin).parent
    for f, old, new in [
        (root / "gen.py", "L = int(fe.duration_features(p)[0])", "L = int(np.asarray(fe.duration_features(p)).ravel()[0])"),
        (root / "dsp.py", "Wn = [norm_cutoff]", "Wn = norm_cutoff"),
    ]:
        t = f.read_text(encoding="utf-8")
        if old in t:
            f.write_text(t.replace(old, new), encoding="utf-8")


def musicxml(notes, bpm=120):
    """notes in seconds -> MusicXML at a fixed tempo (480 divisions: about 1 ms steps at 120 BPM)"""
    from phonemize import to_kana
    div = 480
    q = 60.0 / bpm
    tick = lambda s: int(round(s / q * div))
    bar = 4 * div
    STEPS = ["C", "C", "D", "D", "E", "F", "F", "G", "G", "A", "A", "B"]
    ALT = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0]
    items, cur = [], 0  # (kind, len, midi, lyric)
    for x in notes:
        s, e = tick(x["t"]), tick(x["t"] + x["d"])
        s = max(s, cur)
        if e <= s:
            continue
        # a gap shorter than 40 ms is a slightly short note in the piano roll, not a breath: the
        # note before it is held on (a rest there would cut the phrase, and a hold "ー" right
        # after a rest is an error for NEUTRINO and Sinsy)
        if 0 < s - cur < tick(0.04) and items and items[-1][0] == "n":
            k, ln, n_, ly = items[-1]
            items[-1] = (k, ln + s - cur, n_, ly)
            cur = s
        if s > cur:
            items.append(("r", s - cur, 0, ""))
        syl = str(x.get("syl") or "").strip()
        if syl in ("-", "R"):
            items.append(("r", e - s, 0, ""))
        else:
            kana = "ー" if syl in ("", "+", "ー", "~") else (to_kana(syl)[0] or "ら")
            items.append(("n", e - s, int(x["n"]), kana))
        cur = e
    items.append(("r", bar, 0, ""))
    measures, m, used = [], [], 0
    for kind, length, n, lyr in items:
        first = True
        while length > 0:
            room = bar - used
            take = min(room, length)
            tie_start, tie_stop = take < length, not first
            if kind == "r":
                m.append(f"<note><rest/><duration>{take}</duration></note>")
            else:
                pitch = f"<pitch><step>{STEPS[n % 12]}</step>{'<alter>1</alter>' if ALT[n % 12] else ''}<octave>{n // 12 - 1}</octave></pitch>"
                ties = ("<tie type=\"stop\"/>" if tie_stop else "") + ("<tie type=\"start\"/>" if tie_start else "")
                nots = ("<notations>" + ("<tied type=\"stop\"/>" if tie_stop else "") + ("<tied type=\"start\"/>" if tie_start else "") + "</notations>") if (tie_start or tie_stop) else ""
                ly = f"<lyric><text>{lyr}</text></lyric>" if first and lyr else ""
                m.append(f"<note>{pitch}<duration>{take}</duration>{ties}{nots}{ly}</note>")
            used += take
            length -= take
            first = False
            if used == bar:
                measures.append(m)
                m, used = [], 0
    if m:
        m.append(f"<note><rest/><duration>{bar - used}</duration></note>")
        measures.append(m)
    head = (f"<attributes><divisions>{div}</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time>"
            f"<clef><sign>G</sign><line>2</line></clef></attributes><direction placement=\"above\"><direction-type><metronome><beat-unit>quarter</beat-unit>"
            f"<per-minute>{bpm}</per-minute></metronome></direction-type><sound tempo=\"{bpm}\"/></direction>")
    body = "".join(f"<measure number=\"{i + 1}\">{head if i == 0 else ''}{''.join(x)}</measure>" for i, x in enumerate(measures))
    return ('<?xml version="1.0" encoding="UTF-8"?>\n<score-partwise version="3.1"><part-list><score-part id="P1"><part-name>Vocal</part-name>'
            f'</score-part></part-list><part id="P1">{body}</part></score-partwise>')


SMALL_KANA = set("ゃゅょぁぃぅぇぉゎャュョァィゥェォヮ")


def split_morae(notes):
    """NNSVS (Sinsy) sings one mora per note: a note that carries several (lyrics recognised from a
    recording often put two or three on one note) is split into equal parts, one mora each, on the
    same pitch. Small kana stay with the mora before them."""
    out = []
    for x in notes:
        s = str(x.get("syl") or "")
        morae = []
        if s and re.fullmatch(r"[぀-ヿー]+", s):
            for ch in s:
                if ch in SMALL_KANA and morae:
                    morae[-1] += ch
                else:
                    morae.append(ch)
        # each part needs room to be sung (the score is written at 1/16-beat steps; a part that rounds
        # to nothing breaks the synthesis): morae that don't fit are left out
        morae = morae[:max(1, int(x["d"] / 0.09))]
        if len(morae) == 1 and s:
            out.append({**x, "syl": morae[0]})
        elif len(morae) > 1:
            k, step = len(morae), x["d"] / len(morae)
            out += [{**x, "t": x["t"] + i * step, "d": step, "syl": mo} for i, mo in enumerate(morae)]
        else:
            out.append(x)
    return out


def run_nnsvs(job):
    job = {**job, "notes": split_morae(job["notes"])}
    import tempfile, pathlib
    import safe_models
    d = pathlib.Path(job["voice_dir"])
    safe_models.check_voice_dir(d)  # data only, before anything is loaded
    safe_models.force_weights_only()
    patch_nnsvs()
    import numpy as np, pysinsy, torch
    from nnmnkwii.io import hts
    import nnsvs.util
    from nnsvs.svs import SPSVS
    import nnsvs.gen
    # nnsvs 0.1.1 writes a log line with float() of a one-element array when it stretches note lengths
    # (long songs); NumPy 2 refuses that. Its own module gets a float() that takes such an array.
    import builtins
    nnsvs.gen.float = lambda x=0.0: builtins.float(np.asarray(x).reshape(-1)[0]) if getattr(x, "ndim", 0) else builtins.float(x)
    world_only = True
    if (d / "vocoder_model.pth").exists():
        # the voice's own neural vocoder (uSFGAN) when its package is installed; otherwise WORLD
        try:
            import usfgan.models  # noqa: F401
            nnsvs.util._pwg_available = True
            world_only = False
        except ImportError:
            pass
    src = d
    if world_only and (d / "vocoder_model.pth").exists():
        # load the voice without its vocoder files: a folder of links to everything else
        src = pathlib.Path(tempfile.mkdtemp(prefix="melofi-nnsvs-"))
        for f in d.iterdir():
            if f.is_file() and not f.name.startswith("vocoder_model") and not f.name.startswith("in_vocoder"):
                try:
                    os.link(f, src / f.name)
                except OSError:
                    import shutil
                    shutil.copy2(f, src / f.name)
    say(p=0.1, label="model")
    engine = SPSVS(src, device="cuda" if torch.cuda.is_available() else "cpu")
    with tempfile.TemporaryDirectory() as tmp:
        xml = os.path.join(tmp, "in.musicxml")
        with open(xml, "w", encoding="utf-8") as f:
            f.write(musicxml(job["notes"]))
        labels = hts.HTSLabelFile.create_from_contexts(pysinsy.extract_fullcontext(xml))
    say(p=0.3, label="sing")
    wav, sr = engine.svs(labels, vocoder_type="world" if world_only else "auto")
    wav = np.asarray(wav, dtype=np.float32)
    if np.abs(wav).max() > 1.5:  # int16-scaled output
        wav = wav / 32768.0
    finish(wav, sr, job["out"])


# ---------------------------------------------------------------- DiffSinger
def run_diffsinger(job):
    import diffsinger
    say(p=0.05, label="model")
    v = diffsinger.Voice(job["voice_dir"], job.get("vocoder_dir"), job.get("speaker"), job.get("cmudict"))
    wav, sr = diffsinger.render(v, job["notes"], steps=int(job.get("steps", 50)), on_progress=lambda p: say(p=0.1 + 0.85 * p, label="sing"))
    finish(wav, sr, job["out"])


# ---------------------------------------------------------------- NEUTRINO
def run_neutrino(job):
    """NEUTRINO (STUDIO NEUTRINO, freeware): the user's own install, run as its Run.bat does.
    job: neutrino_dir (the folder with bin/ and model/), model (a folder name under model/)."""
    import subprocess, tempfile, pathlib
    import numpy as np, soundfile as sf
    root = pathlib.Path(job["neutrino_dir"])
    model = root / "model" / job["model"]
    if not (root / "bin" / "neutrino.exe").exists() or not (model / "info.toml").exists():
        raise FileNotFoundError("NEUTRINO or its voice model is missing")
    flags = {"creationflags": 0x08000000} if os.name == "nt" else {}  # no console window
    with tempfile.TemporaryDirectory(prefix="melofi-neutrino-") as tmp:
        t = pathlib.Path(tmp)
        (t / "s.musicxml").write_text(musicxml(job["notes"]), encoding="utf-8")
        say(p=0.05, label="label")
        r = subprocess.run([str(root / "bin" / "musicXMLtoLabel.exe"), str(t / "s.musicxml"), str(t / "full.lab"), str(t / "mono.lab")],
                           cwd=root, capture_output=True, **flags)
        if r.returncode or not (t / "full.lab").exists():
            raise RuntimeError("musicXMLtoLabel failed: " + r.stderr.decode("utf-8", "replace")[-300:])
        say(p=0.15, label="sing")
        args = [str(root / "bin" / "neutrino.exe"), str(t / "full.lab"), str(t / "timing.lab"), str(t / "s.f0"), str(t / "s.melspec"), str(t / "s.wav"),
                str(model) + os.sep, "-n", str(job.get("threads", 8)), "-k", str(job.get("style", 0)), "-f", "0", "-s", "48000", "-b", "16", "-m", "-t"]
        r = subprocess.run(args, cwd=root, capture_output=True, **flags)
        if r.returncode or not (t / "s.wav").exists():
            raise RuntimeError("NEUTRINO failed: " + r.stderr.decode("utf-8", "replace")[-300:])
        wav, sr = sf.read(str(t / "s.wav"), dtype="float32", always_2d=True)
    finish(np.ascontiguousarray(wav.mean(axis=1)), sr, job["out"])


def main():
    with open(sys.argv[1], encoding="utf-8") as f:
        job = json.load(f)
    if not job.get("notes"):
        raise ValueError("no notes")
    {"diffsinger": run_diffsinger, "neutrino": run_neutrino}.get(job["engine"], run_nnsvs)(job)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # report to MeloFi instead of a traceback
        import traceback
        traceback.print_exc()
        say(ok=False, error=f"{type(e).__name__}: {e}")
        sys.exit(1)
