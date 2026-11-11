"""Lyrics from a sung recording (MeloFi): faster-whisper -> syllables -> one syllable per note.

usage: python -I lyrics.py <job.json>
job: {"audio": WAV/FLAC/MP3, "notes": [{"t": sec, "d": sec, "n": midi}]?, "language": "ko"|"ja"|"en"|null,
      "model": "large-v3-turbo", "models_dir": DIR}
Prints JSON lines: {"p": .., "label": ..} progress, then
{"ok": true, "language": "ko", "text": "...", "syllables": [{"text", "start", "end"}], "notes": ["사", "+", ...]}

Syllables: a Hangul character; a Japanese mora (kanji are read with the UniDic dictionary when it is
installed); an English word, whose further syllables become "+" notes. The notes list holds one entry
per given note: a syllable, "+" (hold the previous vowel) or "" (no lyric found there).
"""
import json, os, re, sys, unicodedata, warnings
sys.stdout.reconfigure(encoding="utf-8")  # -I ignores PYTHONIOENCODING; MeloFi reads UTF-8

warnings.filterwarnings("ignore")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from phonemize import morae, kata2hira  # noqa: E402


def say(**o):
    print(json.dumps(o, ensure_ascii=False), flush=True)


# ---------------------------------------------------------------- syllables
_VG = re.compile(r"[aeiouy]+", re.I)


def english_syllables(word):
    """rough vowel-group count, at least 1 (a silent final e does not count)"""
    w = re.sub(r"[^a-z]", "", word.lower())
    if not w:
        return 0
    n = len(_VG.findall(w))
    if w.endswith("e") and not w.endswith(("le", "ee", "ye")) and n > 1:
        n -= 1
    return max(1, n)


_tagger = None


def japanese_reading(text):
    """kanji -> hiragana with fugashi + UniDic when available; kana pass through"""
    global _tagger
    if not re.search(r"[一-鿿々]", text):
        return kata2hira(text)
    try:
        if _tagger is None:
            import fugashi
            _tagger = fugashi.Tagger()
        out = ""
        for w in _tagger(text):
            k = getattr(w.feature, "kana", None) or getattr(w.feature, "pron", None)
            out += kata2hira(k) if k and k != "*" else w.surface
        return out
    except Exception:
        return kata2hira(text)


def read_in_context(words):
    """kanji need their neighbours to be read right (光る alone reads ひかり+る): read the whole
    segment, then give every word the readings of the dictionary words that start inside it"""
    global _tagger
    text = "".join(w for w, _, _ in words)
    if not re.search(r"[一-鿿々]", text):
        return words
    try:
        if _tagger is None:
            import fugashi
            _tagger = fugashi.Tagger()
        toks = list(_tagger(text))
    except Exception:
        return words
    bounds, pos = [], 0
    for w, _, _ in words:
        bounds.append((pos, pos + len(w)))
        pos += len(w)
    reading = [""] * len(words)
    pos = 0
    for tk in toks:
        at = text.find(tk.surface, pos)
        if at < 0:
            at = pos
        pos = at + len(tk.surface)
        k = getattr(tk.feature, "kana", None) or getattr(tk.feature, "pron", None)
        r = kata2hira(k) if k and k != "*" else tk.surface
        i = next((n for n, (a, b) in enumerate(bounds) if a <= at < b), len(words) - 1)
        reading[i] += r
    out = []
    for r, (w, s, e) in zip(reading, words):
        if r:
            out.append((r, s, e))
        elif out:  # its sound is already in the word before: that word lasts longer
            out[-1] = (out[-1][0], out[-1][1], e)
    return out


def split_word(word, start, end, lang):
    """one recognised word -> [(text, start, end)] syllables, time shared out by length"""
    w = unicodedata.normalize("NFC", word.strip())
    w = re.sub(r"[.,!?;:\"“”‘’()\[\]、。！？「」『』…~〜]", "", w)
    if not w:
        return []
    if re.search(r"[가-힣]", w):
        parts = [c for c in w if "가" <= c <= "힣"]
    elif re.search(r"[ぁ-ゖァ-ヺ一-鿿々]", w) or lang == "ja":
        parts = [m for m in morae(japanese_reading(w)) if m != "ー"] or [w]
    else:
        n = english_syllables(w)
        parts = [w.lower()] + ["+"] * (n - 1) if n else []
    if not parts:
        return []
    step = (end - start) / len(parts)
    return [(p, start + i * step, start + (i + 1) * step) for i, p in enumerate(parts)]


# ---------------------------------------------------------------- alignment
def snap(parts, notes, start, end, cursor):
    """Whisper's word times are coarse (often a little early) and its syllable split is even. A word
    takes the next notes nobody took yet that start from its own start on (up to 0.6 s late), one
    per syllable, and each syllable gets its note's time. Notes it skips (before its start) stay free
    for holds. cursor: [index of the first note not taken yet]"""
    if not notes or not parts:
        return parts
    idx = [i for i in range(cursor[0], len(notes)) if notes[i]["t"] >= start - 0.3 and notes[i]["t"] < end + 0.6][: len(parts)]
    if len(idx) == len(parts):
        cursor[0] = idx[-1] + 1
        return [(p[0], notes[i]["t"], notes[i]["t"] + notes[i]["d"]) for p, i in zip(parts, idx)]
    return parts


def align(syls, notes):
    """monotonic alignment: every syllable starts on one note (in order); notes in between hold;
    a syllable that fits no note joins the one before it. Maximises time overlap."""
    n, m = len(syls), len(notes)
    if not m:
        return []
    NEG = -1e9

    def score(i, j):
        s0, s1 = syls[i][1], syls[i][2]
        a, b = notes[j]["t"], notes[j]["t"] + notes[j]["d"]
        ov = max(0.0, min(s1, b) - max(s0, a))
        return ov / max(1e-3, min(s1 - s0, b - a)) - 0.8 * abs(s0 - a) + 0.1

    DROP = 1.0
    dp = [[NEG] * (m + 1) for _ in range(n + 1)]
    bk = [[0] * (m + 1) for _ in range(n + 1)]
    for j in range(m + 1):
        dp[0][j] = 0.0
    for i in range(1, n + 1):
        for j in range(0, m + 1):
            best, how = NEG, 0
            if j > 0 and dp[i][j - 1] > best:
                best, how = dp[i][j - 1], 1  # note j-1 holds
            if j > 0 and dp[i - 1][j - 1] > NEG / 2:
                v = dp[i - 1][j - 1] + score(i - 1, j - 1)
                if v > best:
                    best, how = v, 2  # syllable i-1 starts on note j-1
            if dp[i - 1][j] > NEG / 2 and i > 1 and j > 0:
                v = dp[i - 1][j] - DROP
                if v > best:
                    best, how = v, 3  # syllable i-1 merges into the previous note
            dp[i][j], bk[i][j] = best, how
    out = [""] * m
    i, j = n, m
    merged = []
    while i > 0 and j >= 0:
        how = bk[i][j]
        if how == 1:
            j -= 1
        elif how == 2:
            txt = syls[i - 1][0]
            if merged:
                txt += "".join(reversed(merged))
                merged = []
            out[j - 1] = txt
            i -= 1
            j -= 1
        elif how == 3:
            merged.append(syls[i - 1][0] if syls[i - 1][0] != "+" else "")
            i -= 1
        else:
            break
    # notes after a syllable and before the next one: hold the vowel when they follow closely
    last_end = None
    for k in range(m):
        if out[k]:
            last_end = notes[k]["t"] + notes[k]["d"]
        elif last_end is not None and notes[k]["t"] - last_end < 0.35:
            out[k] = "+"
            last_end = notes[k]["t"] + notes[k]["d"]
        else:
            last_end = None
    # English words carry their own "+" syllables: a "+" syllable that won a note keeps it as a hold
    return out


# ---------------------------------------------------------------- main
def main():
    with open(sys.argv[1], encoding="utf-8") as f:
        job = json.load(f)
    models = job.get("models_dir")
    if models:
        os.environ.setdefault("HF_HOME", os.path.join(models, "hf"))
    try:
        import torch  # its CUDA libraries (cuBLAS, cuDNN) are the ones CTranslate2 loads
        gpu = torch.cuda.is_available()
    except Exception:
        gpu = False
    from faster_whisper import WhisperModel
    name = job.get("model") or "large-v3-turbo"
    say(p=0.05, label="model")
    try:
        model = WhisperModel(name, device="cuda" if gpu else "cpu", compute_type="float16" if gpu else "int8")
    except Exception:
        model = WhisperModel(name, device="cpu", compute_type="int8")
    say(p=0.2, label="listen")
    # decoded here (16 kHz mono), not by faster-whisper's PyAV reader, whose API differs between versions
    import librosa
    audio, _ = librosa.load(job["audio"], sr=16000, mono=True)
    # no voice-activity filter: it is trained on speech and drops sung phrases. Long silences are
    # guarded by Whisper's own hallucination check instead.
    segments, info = model.transcribe(audio, language=job.get("language") or None, word_timestamps=True, vad_filter=False,
                                      hallucination_silence_threshold=2.0, beam_size=5, condition_on_previous_text=False)
    lang = info.language
    words, text = [], []
    dur = max(1.0, float(info.duration or 1.0))
    for seg in segments:
        text.append(seg.text.strip())
        seg_words = [(w.word, float(w.start), float(w.end)) for w in seg.words or []]
        words += read_in_context(seg_words) if lang == "ja" else seg_words
        say(p=0.2 + 0.7 * min(1.0, float(seg.end) / dur), label="listen")
    notes = sorted(job.get("notes") or [], key=lambda x: x["t"])
    syls, cursor = [], [0]
    for w, s, e in words:
        syls += snap(split_word(w, s, e, lang), notes, s, e, cursor)
    res = {"ok": True, "language": lang, "text": " ".join(t for t in text if t),
           "syllables": [{"text": t, "start": round(s, 3), "end": round(e, 3)} for t, s, e in syls]}
    if notes:
        res["notes"] = align(syls, notes)
    say(**res)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        import traceback
        traceback.print_exc()
        say(ok=False, error=f"{type(e).__name__}: {e}")
        sys.exit(1)
