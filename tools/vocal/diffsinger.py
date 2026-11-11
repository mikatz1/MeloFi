"""DiffSinger (OpenUtau voicebank format, ONNX) driver for MeloFi.

A voicebank folder has dsconfig.yaml + acoustic.onnx at its root (or under dsmain/), and optional
dsdur/ (phoneme durations), dspitch/ (natural pitch curves), dsvariance/ (breathiness and the like) and
dsvocoder/ folders, each with its own dsconfig.yaml. Banks without dsvocoder use a shared vocoder
package (OpenUtau .oudep) that MeloFi installs next to the voices.

The flow per phrase (notes separated by long rests):
  syllable -> phonemes (the bank's dsdict) -> linguistic encoder -> durations (rescaled so every vowel
  starts exactly on its note) -> pitch curve (dspitch, or the notes themselves) -> variance -> acoustic
  (mel) -> vocoder (waveform).
"""
import json, math, os, pathlib, re
import numpy as np
import yaml

from phonemize import Phonemizer


def _load_yaml(p):
    return yaml.safe_load(pathlib.Path(p).read_text(encoding="utf-8")) or {}


_PROV = None


def _providers():
    """CUDA when ONNX Runtime can load its CUDA libraries (pip wheels, see vocal.js), else the CPU"""
    global _PROV
    if _PROV is not None:
        return _PROV
    import onnxruntime as ort
    _PROV = ["CPUExecutionProvider"]
    if "CUDAExecutionProvider" in ort.get_available_providers() and os.environ.get("MELOFI_VOCAL_CPU") != "1":
        try:
            if hasattr(ort, "preload_dlls"):
                ort.preload_dlls(directory="")
            if os.name == "nt":  # the CUDA build ONNX Runtime was made for must be loadable, or it only logs errors
                import ctypes
                for name in ("cublasLt64_13.dll", "cublasLt64_12.dll"):
                    try:
                        ctypes.WinDLL(name)
                        break
                    except OSError:
                        continue
                else:
                    raise OSError("no CUDA libraries")
            _PROV = ["CUDAExecutionProvider", "CPUExecutionProvider"]
        except Exception:
            pass
    return _PROV


class Model:
    """an ONNX session that is fed only the inputs it declares"""

    def __init__(self, path):
        import onnxruntime as ort
        so = ort.SessionOptions()
        so.log_severity_level = 3
        self.s = ort.InferenceSession(str(path), so, providers=_providers())
        self.inputs = {i.name: i for i in self.s.get_inputs()}
        self.outputs = [o.name for o in self.s.get_outputs()]

    def has(self, name):
        return name in self.inputs

    def run(self, feed):
        f = {k: v for k, v in feed.items() if k in self.inputs}
        missing = [k for k in self.inputs if k not in f]
        if missing:
            raise RuntimeError(f"model input not provided: {missing}")
        return dict(zip(self.outputs, self.s.run(None, f)))


def _phoneme_table(cfg_dir, cfg):
    """token ids: phonemes.txt (one per line, the line number is the id) or phonemes.json ({name: id})"""
    p = (cfg_dir / cfg["phonemes"]).resolve()
    if p.suffix == ".json":
        return {k: int(v) for k, v in json.loads(p.read_text(encoding="utf-8")).items()}
    return {l.strip(): i for i, l in enumerate(p.read_text(encoding="utf-8").splitlines()) if l.strip()}


def _lang_table(cfg_dir, cfg):
    if not cfg.get("languages"):
        return None
    return {k: int(v) for k, v in json.loads((cfg_dir / cfg["languages"]).read_text(encoding="utf-8")).items()}


def _speaker_embed(cfg_dir, cfg, name=None):
    sp = cfg.get("speakers") or []
    if not sp:
        return None
    pick = next((s for s in sp if name and s.split("/")[-1].lower() == name.lower()), sp[0])
    f = (cfg_dir / (pick + ".emb")).resolve()
    v = np.fromfile(f, dtype=np.float32)
    return v


class Stage:
    """one sub-model folder (root, dsdur, dspitch, dsvariance) with its config and linguistic encoder"""

    def __init__(self, root, sub, main_cfg=None):
        self.dir = root / sub if sub else root
        self.cfg = _load_yaml(self.dir / "dsconfig.yaml")
        self.phonemes = _phoneme_table(self.dir, self.cfg)
        self.langs = _lang_table(self.dir, self.cfg)
        self.ling = Model((self.dir / self.cfg["linguistic"]).resolve()) if self.cfg.get("linguistic") else None


class Voice:
    def __init__(self, root, vocoder_dir=None, speaker=None, cmudict=None):
        root = pathlib.Path(root)
        # some banks keep their models in a subfolder of the zip; find the folder with character.txt / dsconfig.yaml
        if not (root / "dsconfig.yaml").exists():
            cand = [p.parent for p in root.rglob("dsconfig.yaml") if not p.parent.name.startswith("ds")]
            if cand:
                root = sorted(cand, key=lambda p: len(p.parts))[0]
        self.root = root
        self.cfg = _load_yaml(root / "dsconfig.yaml")
        self.phonemes = _phoneme_table(root, self.cfg)
        self.langs = _lang_table(root, self.cfg)
        self.hop = int(self.cfg.get("hop_size", 512))
        self.sr = int(self.cfg.get("sample_rate", 44100))
        self.frame = self.hop / self.sr
        self.acoustic = Model(root / self.cfg["acoustic"])
        self.spk = _speaker_embed(root, self.cfg, speaker)
        self.speaker = speaker
        self.dur = Stage(root, "dsdur") if (root / "dsdur" / "dsconfig.yaml").exists() else None
        if self.dur:
            self.dur.model = Model(self.dur.dir / self.dur.cfg["dur"])
        self.pitch = Stage(root, "dspitch") if (root / "dspitch" / "dsconfig.yaml").exists() else None
        if self.pitch:
            self.pitch.model = Model(self.pitch.dir / self.pitch.cfg["pitch"])
        self.var = Stage(root, "dsvariance") if (root / "dsvariance" / "dsconfig.yaml").exists() else None
        if self.var:
            self.var.model = Model(self.var.dir / self.var.cfg["variance"])
        # vocoder: the bank's own (dsvocoder) or the shared one named in dsconfig
        vdir = root / "dsvocoder" if (root / "dsvocoder").exists() else (pathlib.Path(vocoder_dir) if vocoder_dir else None)
        if vdir is None or not vdir.exists():
            raise FileNotFoundError(f"vocoder '{self.cfg.get('vocoder')}' is not installed")
        vy = vdir / "vocoder.yaml" if (vdir / "vocoder.yaml").exists() else next(iter(sorted(vdir.glob("*.yaml"))), None)
        vcfg = _load_yaml(vy) if vy else {}
        onnx = vdir / vcfg["model"] if vcfg.get("model") else next(vdir.glob("*.onnx"))
        self.vocoder = Model(onnx)
        self.vcfg = vcfg
        # dictionary: dsdur's dsdict (the same file sits in every folder), per-language variants beside it
        self.phonemizer = Phonemizer(root, self.phonemes, self.langs, cmudict)

    # ------------------------------------------------------------------
    def _encode(self, stage, tokens, word_div, word_dur, ph_dur, langs):
        st = stage if stage.ling else None
        model = st.ling if st else None
        if model is None:
            return None
        table = stage.phonemes or self.phonemes
        ids = np.array([[table.get(p, table.get(p.split("/")[-1], 0)) for p in tokens]], dtype=np.int64)
        feed = {"tokens": ids, "word_div": np.array([word_div], dtype=np.int64), "word_dur": np.array([word_dur], dtype=np.int64)}
        if ph_dur is not None:
            feed["ph_dur"] = np.array([ph_dur], dtype=np.int64)
        if model.has("languages"):
            lt = stage.langs or self.langs or {}
            feed["languages"] = np.array([[lt.get(l, 0) for l in langs]], dtype=np.int64)
        return model.run(feed)

    def _spk_frames(self, stage_cfg_dir, stage_cfg, n):
        emb = _speaker_embed(stage_cfg_dir, stage_cfg, self.speaker)
        if emb is None:
            return None
        return np.tile(emb[None, None, :], (1, n, 1)).astype(np.float32)

    def render_phrase(self, notes, steps=50):
        """notes: [{t, d, n, syl}] in seconds, t relative to the phrase start (first note may start > 0).
        Returns (wave float32, f0 Hz per frame)."""
        ph = self.phonemizer.phrase(notes)  # phones, word groups, frames
        F = self.frame
        tokens, langs = ph["phones"], ph["langs"]
        word_div = ph["word_div"]
        # word durations in frames, rounded on the cumulative time so nothing drifts
        edges = np.round(np.array(ph["word_edges"]) / F).astype(np.int64)
        word_dur = np.diff(edges).clip(min=1).tolist()
        n_frames = int(sum(word_dur))
        ph_midi = ph["ph_midi"]

        # ---- phoneme durations: predicted, then fitted inside each word
        if self.dur is not None:
            enc = self._encode(self.dur, tokens, word_div, word_dur, None, langs)
            feed = {"encoder_out": enc["encoder_out"], "x_masks": enc["x_masks"], "ph_midi": np.array([ph_midi], dtype=np.int64)}
            if self.dur.model.has("spk_embed"):
                feed["spk_embed"] = self._spk_frames(self.dur.dir, self.dur.cfg, len(tokens))
            pred = self.dur.model.run(feed)["ph_dur_pred"][0].astype(np.float64)
        else:
            pred = np.array(ph["ph_guess"], dtype=np.float64) / F
        ph_dur = []
        i = 0
        for wd, wf in zip(word_div, word_dur):
            seg = np.maximum(pred[i:i + wd], 1e-3)
            fixed = ph["ph_fixed"][i:i + wd]
            # consonants keep their predicted length when they fit; the vowel takes the rest
            free = [k for k in range(wd) if not fixed[k]]
            if free and seg[[k for k in range(wd) if fixed[k]]].sum() < wf * 0.8:
                cons = seg.copy()
                for k in free:
                    cons[k] = 0
                rest = wf - cons.sum()
                share = seg[free] / seg[free].sum()
                for k, s in zip(free, share):
                    cons[k] = rest * s
                seg = cons
            else:
                seg = seg * (wf / seg.sum())
            # integer frames, rounded on the running sum
            cum = np.round(np.cumsum(seg)).astype(np.int64)
            cum[-1] = wf
            d = np.diff(np.concatenate([[0], cum]))
            if (d < 1).any() and wf >= wd:  # every phone at least one frame
                d = np.maximum(d, 1)
                while d.sum() > wf:
                    d[np.argmax(d)] -= 1
            ph_dur += d.tolist()
            i += wd
        ph_dur = np.array(ph_dur, dtype=np.int64)

        # ---- pitch: notes as a step curve (MIDI), then the bank's pitch model for natural transitions
        note_midi = np.array([x["midi"] for x in ph["notes"]], dtype=np.float32)
        note_rest = np.array([x["rest"] for x in ph["notes"]], dtype=bool)
        nedges = np.round(np.array(ph["note_edges"]) / F).astype(np.int64)
        note_dur = np.diff(nedges).clip(min=1)
        note_dur[-1] += n_frames - note_dur.sum()
        step = np.repeat(note_midi, note_dur)[:n_frames]
        midi = step.astype(np.float32)
        if self.pitch is not None:
            enc = self._encode(self.pitch, tokens, word_div, word_dur, ph_dur.tolist(), langs)
            m = self.pitch.model
            feed = {"encoder_out": enc["encoder_out"], "ph_dur": ph_dur[None], "note_midi": note_midi[None], "note_dur": note_dur[None].astype(np.int64),
                    "note_rest": note_rest[None], "pitch": step[None].astype(np.float32), "expr": np.ones((1, n_frames), np.float32),
                    "retake": np.ones((1, n_frames), bool)}
            if m.has("x_masks"):
                feed["x_masks"] = enc["x_masks"]
            if m.has("spk_embed"):
                feed["spk_embed"] = self._spk_frames(self.pitch.dir, self.pitch.cfg, n_frames)
            self._steps(m, feed, steps)
            pred = m.run(feed)["pitch_pred"][0]
            # the model's curve, held to the written notes: the vowel centres follow the score exactly
            midi = self._hold_to_notes(pred, note_midi, note_dur, note_rest)
        f0 = (440.0 * 2 ** ((midi - 69) / 12)).astype(np.float32)

        # ---- variance parameters the acoustic model expects
        acc = self.acoustic
        feed = {"tokens": np.array([[self.phonemes.get(p, self.phonemes.get(p.split("/")[-1], 0)) for p in tokens]], dtype=np.int64),
                "durations": ph_dur[None], "f0": f0[None]}
        if acc.has("languages"):
            lt = self.langs or {}
            feed["languages"] = np.array([[lt.get(l, 0) for l in langs]], dtype=np.int64)
        want = [k for k in ("energy", "breathiness", "voicing", "tension") if acc.has(k)]
        if want:
            vals = {}
            if self.var is not None:
                enc = self._encode(self.var, tokens, word_div, word_dur, ph_dur.tolist(), langs)
                vm = self.var.model
                vf = {"encoder_out": enc["encoder_out"], "ph_dur": ph_dur[None], "pitch": midi[None].astype(np.float32)}
                for k in want:
                    vf[k] = np.zeros((1, n_frames), np.float32)
                vf["retake"] = np.ones((1, n_frames, max(1, len([x for x in vm.inputs if x in ("energy", "breathiness", "voicing", "tension")]))), bool)
                if vm.has("spk_embed"):
                    vf["spk_embed"] = self._spk_frames(self.var.dir, self.var.cfg, n_frames)
                if vm.has("x_masks"):
                    vf["x_masks"] = enc["x_masks"]
                self._steps(vm, vf, steps)
                out = vm.run(vf)
                for k in want:
                    vals[k] = out.get(f"{k}_pred", np.zeros((1, n_frames), np.float32))
            for k in want:
                feed[k] = vals.get(k, np.full((1, n_frames), -96.0 if k != "tension" else 0.0, np.float32)).astype(np.float32)
        if acc.has("gender"):
            feed["gender"] = np.zeros((1, n_frames), np.float32)
        if acc.has("velocity"):
            feed["velocity"] = np.ones((1, n_frames), np.float32)
        if acc.has("spk_embed"):
            feed["spk_embed"] = np.tile(self.spk[None, None, :], (1, n_frames, 1)).astype(np.float32) if self.spk is not None else None
        self._steps(acc, feed, steps, acoustic=True)
        mel = acc.run(feed)["mel"]

        # ---- vocoder. Banks and vocoders made before 2024 have no mel_base key and use log10 mels;
        # newer ones say "e". Convert when they differ (as OpenUtau does), or the vocoder hears noise.
        a_base, v_base = str(self.cfg.get("mel_base", "10")), str(self.vcfg.get("mel_base", "10"))
        if a_base != v_base:
            mel = mel * (math.log(10) if v_base == "e" else 1 / math.log(10))
        voc = self.vocoder
        vin = list(voc.inputs)
        vfeed = {vin[0]: mel.astype(np.float32), "f0": f0[None]}
        if "mel" in voc.inputs:
            vfeed = {"mel": mel.astype(np.float32), "f0": f0[None]}
        wav = list(voc.run(vfeed).values())[0].reshape(-1).astype(np.float32)
        return wav, f0

    def _steps(self, m, feed, steps, acoustic=False):
        """diffusion depth / step count inputs, in whichever form the export uses"""
        max_depth = self.cfg.get("max_depth", 1000) if acoustic else 1000
        if acoustic and os.environ.get("MELOFI_DS_DEPTH"):
            max_depth = type(max_depth)(float(os.environ["MELOFI_DS_DEPTH"]))
        if m.has("depth"):
            t = m.inputs["depth"].type
            if "float" in t:
                feed["depth"] = np.array(float(max_depth) if float(max_depth) <= 1 else 1.0, dtype=np.float32)
            else:
                feed["depth"] = np.array(int(max_depth), dtype=np.int64)
        if m.has("steps"):
            feed["steps"] = np.array(int(steps), dtype=np.int64)
        if m.has("speedup"):
            depth = int(max_depth) if (acoustic and m.has("depth") and "int" in m.inputs["depth"].type) else 1000
            feed["speedup"] = np.array(max(1, depth // max(1, steps)), dtype=np.int64)

    @staticmethod
    def _hold_to_notes(pred, note_midi, note_dur, rest):
        """keep the model's transitions and vibrato, but sit every sung note on its written pitch:
        the offset of the note's middle (its median) is taken out, faded in and out at the edges so
        the slides between notes stay as the model made them"""
        pred = np.asarray(pred, dtype=np.float64)
        n = len(pred)
        shift = np.zeros(n)
        a = 0
        for m, d, r in zip(note_midi, note_dur, rest):
            b = min(n, a + int(d))
            if not r and b - a > 4:
                seg = pred[a:b]
                core = seg[len(seg) // 4: len(seg) - len(seg) // 4] if len(seg) > 8 else seg
                off = float(np.median(core) - m)
                if abs(off) > 3.0:  # the model went somewhere else entirely: follow the score
                    pred[a:b] = m + (seg - np.median(core)) * 0.5
                    off = 0.0
                w = np.ones(b - a)
                e = min((b - a) // 4, 6)
                if e:
                    w[:e] = np.linspace(0, 1, e)
                    w[-e:] = np.linspace(1, 0, e)
                shift[a:b] = off * w
            a = b
        return (pred - shift).astype(np.float32)


def render(voice, notes, sr_out=None, steps=50, gap=0.6, on_progress=None):
    """notes: [{t, d, n, syl}] (seconds, MIDI) for the whole take -> float32 mono at voice.sr"""
    notes = sorted([dict(x) for x in notes if x["d"] > 0.01], key=lambda x: x["t"])
    for a, b in zip(notes, notes[1:]):  # one voice: a note ends where the next starts
        if a["t"] + a["d"] > b["t"]:
            a["d"] = max(0.02, b["t"] - a["t"])
    # phrases split at rests of `gap` seconds or more
    phrases, cur = [], []
    for x in notes:
        if cur and x["t"] - (cur[-1]["t"] + cur[-1]["d"]) >= gap:
            phrases.append(cur)
            cur = []
        cur.append(x)
    if cur:
        phrases.append(cur)
    end = (notes[-1]["t"] + notes[-1]["d"] + 1.0) if notes else 1.0
    out = np.zeros(int(end * voice.sr) + voice.sr, np.float32)
    lead = 0.4  # room for the first consonant and the breath before the phrase
    for k, ph in enumerate(phrases):
        t0 = max(0.0, ph[0]["t"] - lead)
        rel = [{**x, "t": x["t"] - t0} for x in ph]
        wav, _ = voice.render_phrase(rel, steps=steps)
        a = int(round(t0 * voice.sr))
        b = min(len(out), a + len(wav))
        # short fades so phrase edges never click
        w = wav[: b - a].copy()
        fl = min(len(w) // 4, int(0.01 * voice.sr))
        if fl > 0:
            w[:fl] *= np.linspace(0, 1, fl, dtype=np.float32)
            w[-fl:] *= np.linspace(1, 0, fl, dtype=np.float32)
        out[a:b] += w
        if on_progress:
            on_progress((k + 1) / len(phrases))
    # trim trailing silence past the last note's release
    last = int((notes[-1]["t"] + notes[-1]["d"] + 0.6) * voice.sr) if notes else len(out)
    return out[: min(len(out), last)], voice.sr
