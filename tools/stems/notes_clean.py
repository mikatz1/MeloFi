"""From Basic Pitch's raw output of every separated stem to the notes the app gets.

analyze.py calls transcribe() after the separation; notes_lab.py calls it with other settings on
songs already separated, to score each clean-up against the round-trip reference songs.

Clean-ups (each one measured with the round-trip test, docs/roundtrip-eval.md):
- gate: a note is kept only when its pitch is loud enough in its own stem compared with the
  same pitch in the other stems at that moment. The separation leaves a little of every
  instrument in every stem and Basic Pitch writes it down as notes (bleed).
"""
import numpy as np

FPS = 22050 / 256  # Basic Pitch's frame rate
MIDI_OFFSET = 21
N_BINS = 88
HOP = 256
SR = 22050
RANGES = {"bass": (24, 67), "vocals": (40, 88), "backing": (40, 88)}
PITCHED = ("bass", "piano", "guitar", "vocals", "backing", "other")

BASE = dict(onset=0.5, frame=0.3, min_ms=58, min_ms_voice=80, melodia=True, gate=None)
VARIANTS = {
    "base": dict(BASE),
    "noinfer": dict(BASE, infer=False),
    "monobass": dict(BASE, mono_stems=("bass",)),
    "harm.6": dict(BASE, harm=0.6),
    "harm.75": dict(BASE, harm=0.75),
    "harm.9": dict(BASE, harm=0.9),
    "dedup": dict(BASE, dedup=True),
    "dedupA": dict(BASE, dedup="audio", needs_audio=True),
    "on.6": dict(BASE, onset=0.6),
    "on.4": dict(BASE, onset=0.4),
    "fr.4": dict(BASE, frame=0.4),
}
# per stem, from a coordinate search over the 13 round-trip songs and the 3 real MIDIs together
# (notes_lab.py; 2026-11-12). Settings found on the 13 songs alone lost a third of the notes of
# piano-heavy real songs. Bass and backing vocals are one note at a time; stricter onsets where the
# separation leaves the most bleed; overtones of louder notes go on piano and guitar; the piano
# keeps quieter frames (dense real piano parts need them).
TUNED = dict(BASE, onset={"bass": 0.6, "guitar": 0.6, "backing": 0.4, "other": 0.6, "*": 0.5},
             frame={"bass": 0.4, "piano": 0.2, "guitar": 0.5, "backing": 0.4, "*": 0.3},
             mono_stems=("bass", "backing"), harm={"piano": 0.5, "guitar": 0.9},
             # the piano without Basic Pitch's second pass (notes made from leftover frame energy
             # with no onset): on the piano they are mostly sustain and bleed (lab: +1.8 / +1.1)
             melodia={"piano": False, "*": True},
             # chords in the bass stem: 10% of its onsets or more (lab: metal notes 38.5 -> 42.5)
             chords=0.1,
             # ghosts under louder notes (lab: note F1 67.5 -> 67.8 synthetic, 54.1 -> 54.6 real,
             # real precision +3)
             below={"piano": 0.8, "other": 0.8},
             # a note ends where its pitch has fallen 6 dB under its peak in the stem (Basic Pitch
             # holds notes through decay and reverb): notes with the right end 27 -> 40% (lab)
             etrim=6, needs_audio=True)
VARIANTS["tuned"] = TUNED
VARIANTS.update({f"trim{a}": dict(BASE, trim=a) for a in (0.3, 0.5, 0.7)})
VARIANTS.update({f"e{a}": dict(TUNED, etrim=a, needs_audio=True) for a in (3, 4.5, 6, 10, 15, 20)})
VARIANTS["noetrim"] = dict(TUNED, etrim=None)
VARIANTS.update({f"eg{a}": dict(TUNED, etrim=a, egrow=0.3, needs_audio=True) for a in (10, 15)})


def load_stems(res):
    """semitone CQT magnitude of every stem (drums too: bleed comes from them as well), [frames, 88]"""
    import librosa
    out = {}
    for k, path in res["stems"].items():
        y, _ = librosa.load(path, sr=SR, mono=True)
        c = np.abs(librosa.cqt(y, sr=SR, hop_length=HOP, fmin=librosa.midi_to_hz(MIDI_OFFSET), n_bins=N_BINS, bins_per_octave=12))
        out[k] = c.T.astype(np.float32)
    return out


def raw_notes(raw, k, onset, frame, min_ms, min_ms_voice, melodia, infer=True, **_):
    if isinstance(onset, dict): onset = onset.get(k, onset.get("*", 0.5))
    if isinstance(frame, dict): frame = frame.get(k, frame.get("*", 0.3))
    if isinstance(melodia, dict): melodia = melodia.get(k, melodia.get("*", True))
    from basic_pitch.note_creation import model_output_to_notes
    import librosa
    lo, hi = RANGES.get(k, (21, 108))
    ml = min_ms_voice if k in ("vocals", "backing") else min_ms
    _, ev = model_output_to_notes(raw, onset_thresh=onset, frame_thresh=frame, min_note_len=int(np.round(ml / 1000 * FPS)), infer_onsets=infer,
                                  min_freq=librosa.midi_to_hz(lo), max_freq=librosa.midi_to_hz(hi), multiple_pitch_bends=False, melodia_trick=melodia)
    return sorted([round(float(s), 4), round(float(e - s), 4), int(n), int(max(1, min(127, round(a * 127))))] for s, e, n, a, *_ in ev)


def note_energy(C, t, d, n, look=0.12):
    """mean CQT power at pitch n over the note's first `look` seconds"""
    i0 = int(t * SR / HOP); i1 = max(i0 + 1, int(min(t + d, t + look) * SR / HOP))
    b = n - MIDI_OFFSET
    if b < 0 or b >= N_BINS or i0 >= len(C):
        return 0.0
    return float(np.mean(C[i0:i1, b] ** 2))


def gate_notes(notes, k, stems, thr):
    """keep notes whose pitch is at least thr of the loudest stem at that pitch and moment"""
    if k not in stems:
        return notes
    keep = []
    for x in notes:
        own = note_energy(stems[k], x[0], x[1], x[2])
        top = max(note_energy(C, x[0], x[1], x[2]) for C in stems.values())
        if top <= 0 or own >= thr * top:
            keep.append(x)
    return keep


def trim_ends(notes, raw, k, alpha):
    """A note ends where its own activation falls under alpha of its peak (Basic Pitch keeps it
    going while any activation is left, so decay and reverb tails come out as note length)"""
    if not alpha:
        return notes
    if isinstance(alpha, dict):
        alpha = alpha.get(k, alpha.get("*"))
        if not alpha:
            return notes
    A = raw["note"]
    out = []
    for t, d, n, v in notes:
        b = n - MIDI_OFFSET
        i0 = int(round(t * FPS)); i1 = int(round((t + d) * FPS))
        if b < 0 or b >= A.shape[1] or i1 - i0 < 3:
            out.append([t, d, n, v]); continue
        seg = A[i0:i1, b]
        pk = int(np.argmax(seg)); lim = alpha * float(seg[pk])
        below = np.where(seg[pk:] < lim)[0]
        end = i0 + pk + (int(below[0]) if len(below) else len(seg) - pk)
        out.append([t, round(max(0.05, min(d, end / FPS - t)), 4), n, v])
    return out


def trim_energy(notes, C, db, grow=0.0):
    """A note ends where its pitch's level in the stem has fallen db under the note's peak (the
    release of the key); C: the stem's semitone CQT. Only shortens (grow: may also lengthen by
    up to that many seconds while the level holds)."""
    out = []
    k = 10 ** (-db / 10)
    for t, d, n, v in notes:
        b = n - MIDI_OFFSET
        i0 = int(round(t * SR / HOP)); i1 = int(round((t + d + grow) * SR / HOP))
        if b < 0 or b >= N_BINS or i1 - i0 < 4 or i0 >= len(C):
            out.append([t, d, n, v]); continue
        seg = C[i0:i1, b] ** 2
        pk = int(np.argmax(seg[: max(2, int(0.15 * SR / HOP))])); lim = k * float(seg[pk])
        below = np.where(seg[pk:] < lim)[0]
        end = i0 + pk + (int(below[0]) if len(below) else len(seg) - pk)
        nd = end * HOP / SR - t
        out.append([t, round(max(0.05, nd if grow else min(d, nd)), 4), n, v])
    return out


def mono(notes, overlap=0.06):
    """a monophonic part: of notes starting together, the loudest"""
    out = []
    for x in sorted(notes, key=lambda x: -x[3]):
        if not any(abs(y[0] - x[0]) <= overlap for y in out):
            out.append(x)
    return sorted(out)


OVERTONES = (12, 19, 24, 28, 31, 36)


def chordal(notes, win=0.06):
    """the share of onsets where two notes start together that are not overtones of one another"""
    groups, cur = [], []
    for x in sorted(notes):
        if cur and x[0] - cur[0][0] > win:
            groups.append(cur); cur = []
        cur.append(x)
    if cur: groups.append(cur)
    if not groups:
        return 0.0
    c = 0
    for g in groups:
        ps = sorted(x[2] for x in g)
        if any(b != a and (b - a) not in OVERTONES for i, a in enumerate(ps) for b in ps[i + 1:]): c += 1
    return c / len(groups)


def lowest(notes, win=0.06):
    """of notes starting together an octave, a twelfth, two octaves... apart, the lowest stays (the
    others are its overtones); notes at other intervals, a chord, all stay"""
    out = []
    for x in sorted(notes, key=lambda x: x[2]):
        if any(abs(y[0] - x[0]) <= win and (x[2] - y[2]) in OVERTONES for y in out):
            continue
        out.append(x)
    return sorted(out)


def ghosts_below(notes, ratio, ivs=(12, 19, 24), win=0.06):
    """a note an octave, a twelfth or two octaves under a louder note starting with it: Basic Pitch's
    ghost of the upper one (the commonest wrong note on real piano recordings). A real doubling in
    octaves is played about as loud as its upper note and stays."""
    out = []
    for x in notes:
        up = [y[3] for y in notes if (y[2] - x[2]) in ivs and abs(y[0] - x[0]) <= win]
        if up and x[3] < ratio * max(up):
            continue
        out.append(x)
    return out


def harmonics(notes, ratio, ivs=(12, 19, 24), win=0.06):
    """a note an octave, a twelfth or two octaves over a louder note starting with it: its overtone"""
    out = []
    for x in notes:
        par = [y for y in notes if y[2] in [x[2] - i for i in ivs] and abs(y[0] - x[0]) <= win]
        if par and x[3] < ratio * max(y[3] for y in par):
            continue
        out.append(x)
    return out


def dedupe(notes_by_stem, stems=None, win=0.05):
    """the same pitch starting together in two stems: kept in the louder one"""
    allx = [(x, k) for k, ns in notes_by_stem.items() for x in ns]
    def strength(x, k):
        return note_energy(stems[k], x[0], x[1], x[2]) if stems is not None and k in stems else x[3]
    drop = set()
    for i, (x, k) in enumerate(allx):
        for j, (y, k2) in enumerate(allx):
            if k2 != k and y[2] == x[2] and abs(y[0] - x[0]) <= win and strength(y, k2) > strength(x, k):
                drop.add(i); break
    keep = {}
    for i, (x, k) in enumerate(allx):
        if i not in drop:
            keep.setdefault(k, []).append(x)
    return {k: sorted(keep.get(k, [])) for k in notes_by_stem}


def transcribe(raw, res, stems=None, gate=None, needs_audio=False, mono_stems=(), harm=None, dedup=False, trim=None, etrim=None, egrow=0.0, chords=None, below=None, **opt):
    out = {}
    for k in PITCHED:
        if k not in raw:
            continue
        ns = raw_notes(raw[k], k, **opt)
        if gate is not None and stems is not None:
            ns = gate_notes(ns, k, stems, gate)
        if k in mono_stems:
            # one note at a time, unless the stem plays chords (the separation puts low distorted
            # guitars in the bass stem: power chords). Then the loudest-only rule deletes real
            # notes; the stem is read again with the usual thresholds and only overtones go.
            if chords and k == "bass" and chordal(ns) >= chords:
                ns = lowest(raw_notes(raw[k], k, **dict(opt, onset=0.5, frame=0.3)))
            else:
                ns = mono(ns)
        if harm:
            r = harm.get(k, harm.get("*")) if isinstance(harm, dict) else harm
            if r: ns = harmonics(ns, r)
        if below and below.get(k):
            ns = ghosts_below(ns, below[k])
        if trim:
            ns = trim_ends(ns, raw[k], k, trim)
        if etrim and stems is not None and k in stems:
            ns = trim_energy(ns, stems[k], etrim, egrow)
        out[k] = ns
    if dedup:
        out = dedupe(out, stems if dedup == "audio" else None)
    return out


# ---------- beats per bar ----------
def onset_env(y, sr=SR):
    import librosa
    env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=HOP)
    return env / (np.percentile(env, 95) + 1e-9)


def bar_periodicity(env, downbeats, n=48):
    """how the onsets inside a bar repeat: circular autocorrelation of the average bar's onset
    profile at a third and a quarter of the bar (the phase of the downbeats does not matter)"""
    fps = SR / HOP
    def E(t):
        i = int(round(t * fps))
        return float(env[max(0, i - 1):i + 2].max()) if 0 <= i < len(env) else 0.0
    prof = np.zeros(n)
    for a, b in zip(downbeats, downbeats[1:]):
        for k in range(n):
            prof[k] += E(a + k / n * (b - a))
    p = prof - prof.mean()
    den = float(np.dot(p, p)) + 1e-9
    return {m: float(np.dot(p, np.roll(p, n // m))) / den for m in (2, 3, 4)}


def fix_meter(beats, downbeats, meter, env):
    """The beat tracker finds the bars well but not always how many beats are in one (a 3/4 waltz
    came out as 4/4 at 4/3 the tempo). The bars stay; their count of beats is decided by whether the
    onsets repeat every third or every quarter of a bar. Returns (beats, meter, scores)."""
    if meter not in (3, 4) or len(downbeats) < 5:
        return beats, meter, None
    A = bar_periodicity(env, downbeats)
    want = 3 if A[3] > A[4] + 0.3 and A[3] > 0.3 else 4 if A[4] > A[3] + 0.3 and A[4] > 0.3 else meter
    if want == meter:
        return beats, meter, A
    # the bars' own beats: each bar split evenly, before the first and after the last downbeat too
    db = list(downbeats)
    L = float(np.median(np.diff(db)))
    out = []
    t = db[0]
    while t - L / want > (beats[0] if beats else 0) - 1e-3:
        t -= L / want; out.insert(0, round(t, 4))
    for a, b in zip(db, db[1:]):
        out += [round(a + k * (b - a) / want, 4) for k in range(want)]
    t = db[-1]
    end = beats[-1] if beats else db[-1]
    while t <= end + 1e-3:
        out.append(round(t, 4)); t += L / want
    return out, want, A



# ---------- the beat grid checked against the notes ----------
def _comb(t, w, period):
    z = np.sum(w * np.exp(2j * np.pi * t / period))
    return abs(z) / (w.sum() + 1e-9), float(np.angle(z))


def refine_grid(beats, downbeats, meter, notes, drums, duration, min_r=0.35, off=0.03):
    """A beat tracker can be a few percent off on music without drums (an orchestral piece at 92
    BPM tracked at 88, in three), and then every bar line drifts. Notes are played on a grid: the
    tempo at which the transcribed onsets line up best on 16ths (a comb over 55-220 BPM) is found
    from the notes alone. Where that is clear (min_r) and the tracker's tempo is more than 3% away
    from it (folding double / half time), the grid is rebuilt from the notes: beats from the comb's
    tempo and phase, beats per bar from how the onsets repeat (3 or 4), bar 1 where the long and
    low notes start. Otherwise None: the tracker's grid stays. Returns (beats, downbeats, meter, info)."""
    on = sorted([(x[0], x[1], x[2], x[3]) for ns in notes.values() for x in ns])
    if len(on) < 60 or len(beats) < 8:
        return None
    t = np.array([x[0] for x in on] + [d[0] for d in drums]); w = np.array([x[3] for x in on] + [d[2] for d in drums]) / 127 + 0.3
    bpms = np.arange(55, 220, 0.05)
    R = np.array([_comb(t, w, 60 / b / 4)[0] for b in bpms])
    i = int(R.argmax())
    if R[i] < min_r:
        return None
    P = 60 / float(bpms[i]); P0 = float(np.median(np.diff(beats)))
    while P / P0 > 1.41: P /= 2
    while P / P0 < 0.71: P *= 2
    if abs(P / P0 - 1) <= off:
        return None
    # finer tempo around the peak, then the phase: 16ths from the comb, the beat among them where
    # the beat-level comb points
    fine = P * np.arange(0.995, 1.0051, 0.0002)
    P = float(fine[int(np.argmax([_comb(t, w, q / 4)[0] for q in fine]))])
    a16 = _comb(t, w, P / 4)[1]; ab = _comb(t, w, P)[1]
    ph16 = (a16 / (2 * np.pi)) * (P / 4); phb = (ab / (2 * np.pi)) * P
    cands = [ph16 + j * P / 4 for j in range(4)]
    circ = lambda a, b: abs(((a - b + P / 2) % P) - P / 2)
    ph = min(cands, key=lambda c: circ(c, phb)) % P
    nb = np.arange(ph, duration, P)
    # beats per bar: the 16th-step onset pattern repeats every bar
    steps = np.zeros(len(nb) * 4 + 8)
    for tt, ww in zip(t, w):
        k = int(round((tt - ph) / (P / 4)))
        if 0 <= k < len(steps): steps[k] += ww
    v = steps - steps.mean()
    def ac(lag):
        return float(np.dot(v[:-lag], v[lag:]) / (np.dot(v, v) + 1e-9))
    m = 3 if ac(12) > ac(16) + 0.1 else 4
    # bar 1: the beat phase where long and low notes start (chords change and the bass moves there)
    lo = np.percentile([x[2] for x in on], 25)
    score = np.zeros(m)
    for tt, d, n, vv in on:
        k = (tt - ph) / P; kb = int(round(k))
        if abs(k - kb) * P <= 0.06 and kb >= 0:
            score[kb % m] += min(d, 2.0) * (2.0 if n <= lo else 1.0)
    first = int(score.argmax())
    db = [float(x) for x in nb[first::m]]
    return [round(float(x), 4) for x in nb], [round(x, 4) for x in db], m, {"bpm": round(60 / P, 2), "r": round(float(R[i]), 2), "tracked_bpm": round(60 / P0, 2)}

# ---------- what analyze.py runs ----------
POST_VERSION = 9  # results made by an older version get their beats-per-bar and notes done again
DEFAULT = TUNED


def basic_pitch(stem_paths, say=None, times=None):
    """Basic Pitch's raw output (note, onset, contour activations) of every pitched stem"""
    import time
    from basic_pitch.inference import run_inference, Model
    from basic_pitch import ICASSP_2022_MODEL_PATH
    model = Model(ICASSP_2022_MODEL_PATH)
    pitched = [k for k in PITCHED if k in stem_paths]
    raw = {}
    for i, k in enumerate(pitched):
        if say: say(i / max(1, len(pitched)), k)
        t0 = time.time()
        try:
            raw[k] = run_inference(str(stem_paths[k]), model)
        except Exception as e:  # one stem failing must not lose the rest
            if say: say(i / max(1, len(pitched)), f"{k}: {e}")
        if times is not None: times[f"basic_pitch_{k}"] = round(time.time() - t0, 1)
        try:
            import gpu_cap
            gpu_cap.rest(time.time() - t0)  # (test runs: MELOFI_GPU_CAP)
        except ImportError:
            pass
    return raw


def stems_mix(stem_paths):
    """the stems summed, mono 22.05 kHz: the song again, for onset analysis"""
    import librosa
    y = None
    for k in ("vocals", "backing", "drums", "bass", "guitar", "piano", "other"):
        if k in stem_paths:
            s, _ = librosa.load(str(stem_paths[k]), sr=SR, mono=True)
            y = s if y is None else y[: len(s)] + s[: len(y)]
    return y


# ---------- how freely the lead voice moves in pitch ----------
def voice_expression(raw):
    """From Basic Pitch's pitch contour of the lead vocal (3 bins a semitone): the share of sung
    time with vibrato (a 4-9 Hz wobble over 60 cents wide) and with glides (the pitch sliding
    faster than 4 semitones a second), and the median vibrato width. Notes cannot hold either:
    the app says so before converting the voice to MIDI."""
    C = raw["contour"]
    fps = FPS
    top = C.argmax(axis=1); peak = C.max(axis=1)
    # sub-bin pitch (parabola through the peak and its neighbours), in cents from MIDI 21
    i = np.clip(top, 1, C.shape[1] - 2)
    a, b, c = C[np.arange(len(i)), i - 1], C[np.arange(len(i)), i], C[np.arange(len(i)), i + 1]
    den = a - 2 * b + c
    off = np.where(np.abs(den) > 1e-6, 0.5 * (a - c) / den, 0.0)
    cents = (i + np.clip(off, -0.5, 0.5)) * (100 / 3)
    voiced = peak > 0.2
    runs, st = [], None
    for k, v in enumerate(np.append(voiced, False)):
        if v and st is None: st = k
        if not v and st is not None:
            if k - st >= int(0.3 * fps): runs.append((st, k))
            st = None
    tot = sum(e - s0 for s0, e in runs)
    if tot < 2 * fps:
        return {"voiced": round(tot / fps, 1), "vibrato": 0.0, "glide": 0.0, "width": 0.0}
    from scipy.ndimage import median_filter
    vib, gl, widths = 0, 0, []
    W = int(0.5 * fps)
    for s0, e in runs:
        p = cents[s0:e]
        # the held pitch: a median over 0.2 s (longer than a vibrato cycle, shorter than a note)
        med = median_filter(p, size=max(3, int(0.2 * fps)) | 1, mode="nearest")
        res = p - med
        ok = np.abs(res) < 150  # the moments between two notes are not vibrato
        for k in range(0, len(res) - W + 1, W // 2):
            r, m = res[k:k + W], ok[k:k + W]
            if m.mean() < 0.9: continue
            r = r[m] - r[m].mean()
            zc = np.sum(np.diff(np.sign(r)) != 0) / (len(r) / fps)
            width = 2 * np.sqrt(2) * np.std(r)
            if 7 <= zc <= 18 and 50 < width < 300:
                vib += W // 2; widths.append(width)
        # glides: the held pitch moving smoothly (not jumping) by over 4 semitones a second for 60 ms
        sl = np.abs(np.gradient(med)) * fps
        g = (sl > 400) & (sl < 2500)
        run = 0
        for x in g:
            run = run + 1 if x else 0
            if run >= int(0.06 * fps): gl += 1
    return {"voiced": round(tot / fps, 1), "vibrato": round(min(1.0, vib / tot), 3), "glide": round(min(1.0, gl / tot), 3), "width": round(float(np.median(widths)) if widths else 0.0, 1)}


# ---------- drum hits from the drum-part stems ----------
DRUM_GM = {"kick": 36, "snare": 38, "toms": 45, "hh": 42, "hihat": 42, "ride": 51, "crash": 49, "cymbals": 49}
DRUMS_BASE = dict(delta=0.07, loud=0.12, share=0.0, loud_by={}, share_by={})
# from a search over the round-trip songs with drums (2026-11-12; drum F1 68.4 -> 83.0): the toms
# stem counts only where it holds 70% of the kit's power (it is mostly what is left of the kick and
# snare), the snare needs a louder hit (hi-hat bleed), the hi-hat a much quieter one (hats under a
# kick or snare are faint in their stem)
DRUMS = dict(delta=0.1, loud=0.12, loud_by={"toms": 0.03, "snare": 0.3, "hh": 0.03, "hihat": 0.03}, share_by={"toms": 0.7})


def drum_features(part_paths):
    """per drum part: onset envelope (0..1), RMS, and each frame's share of all the parts' power"""
    import librosa
    feats = {}
    for k, f in part_paths.items():
        key = k.replace(" ", "").replace("-", "")
        if key not in DRUM_GM:
            continue
        y, _ = librosa.load(str(f), sr=SR, mono=True)
        if np.sqrt(np.mean(y ** 2)) < 1e-4:
            continue
        env = librosa.onset.onset_strength(y=y, sr=SR, hop_length=HOP)
        env = env / (env.max() or 1)
        rms = librosa.feature.rms(y=y, frame_length=1024, hop_length=HOP)[0]
        feats[key] = {"env": env, "rms": rms}
    n = min((len(v["rms"]) for v in feats.values()), default=0)
    tot = sum((v["rms"][:n] ** 2 for v in feats.values()), np.zeros(n)) + 1e-12
    for v in feats.values():
        v["share"] = (v["rms"][:n] ** 2) / tot
    return feats


def drum_hits(feats, delta=0.07, loud=0.12, share=0.0, loud_by=None, share_by=None):
    """[[t, GM note, velocity]]: onsets of each part that are loud for the part (bleed from other
    drums is quiet in a clean stem) and hold a share of the whole kit's power at that moment (what
    is left of a kick in the toms stem is a sliver of the kick)"""
    import librosa
    out = []
    for k, v in feats.items():
        env, rms, sh = v["env"], v["rms"], v["share"]
        lo = (loud_by or {}).get(k, loud); smin = (share_by or {}).get(k, share)
        rel = rms / (rms.max() or 1)
        for fr in librosa.onset.onset_detect(onset_envelope=env, sr=SR, hop_length=HOP, backtrack=False, delta=delta, wait=3, normalize=False):
            a = min(len(rel) - 1, fr + 2)
            if rel[a] <= lo:
                continue
            if smin and float(np.max(sh[min(len(sh) - 1, fr):min(len(sh), fr + 4)], initial=0)) < smin:
                continue
            out.append([round(float(fr * HOP / SR), 4), DRUM_GM[k], int(max(30, min(127, 40 + 87 * env[fr])))])
    out.sort()
    return out
