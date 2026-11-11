"""Lyrics -> phonemes for MeloFi's singing voices.

A note carries one syllable: a Hangul syllable, Japanese kana (one or more morae), a romaji syllable, or
an English word (whose further syllables sit on the following "+" notes). "+" (or "ー", or an empty
syllable) continues the previous vowel on a new pitch; "-" / "R" is a rest.

Japanese-only voices get Hangul as the nearest kana (marked approximate in the UI).
"""
import pathlib, re, unicodedata

try:
    import yaml
    _Loader = getattr(yaml, "CSafeLoader", yaml.SafeLoader)
except ImportError:  # the NNSVS environment only needs the kana helpers
    yaml = None

# ---------------------------------------------------------------- kana <-> romaji
_KANA = """
あ a い i う u え e お o か ka き ki く ku け ke こ ko さ sa し shi す su せ se そ so
た ta ち chi つ tsu て te と to な na に ni ぬ nu ね ne の no は ha ひ hi ふ fu へ he ほ ho
ま ma み mi む mu め me も mo や ya ゆ yu よ yo ら ra り ri る ru れ re ろ ro わ wa を o ん N
が ga ぎ gi ぐ gu げ ge ご go ざ za じ ji ず zu ぜ ze ぞ zo だ da ぢ ji づ zu で de ど do
ば ba び bi ぶ bu べ be ぼ bo ぱ pa ぴ pi ぷ pu ぺ pe ぽ po
きゃ kya きゅ kyu きょ kyo しゃ sha しゅ shu しょ sho ちゃ cha ちゅ chu ちょ cho にゃ nya にゅ nyu にょ nyo
ひゃ hya ひゅ hyu ひょ hyo みゃ mya みゅ myu みょ myo りゃ rya りゅ ryu りょ ryo ぎゃ gya ぎゅ gyu ぎょ gyo
じゃ ja じゅ ju じょ jo びゃ bya びゅ byu びょ byo ぴゃ pya ぴゅ pyu ぴょ pyo
しぇ she ちぇ che じぇ je てぃ ti でぃ di とぅ tu どぅ du ふぁ fa ふぃ fi ふぇ fe ふぉ fo うぃ wi うぇ we うぉ wo
つぁ tsa つぃ tsi つぇ tse つぉ tso いぇ ye ゔ vu ゔぁ va ゔぃ vi ゔぇ ve ゔぉ vo
っ cl ー -
"""
_pairs = _KANA.split()
KANA2ROMA = dict(zip(_pairs[0::2], _pairs[1::2]))
ROMA2KANA = {}
for k, r in KANA2ROMA.items():
    ROMA2KANA.setdefault(r.lower(), k)
ROMA2KANA.update({"n": "ん", "nn": "ん", "si": "し", "ti": "てぃ", "tu": "とぅ", "hu": "ふ", "zi": "じ", "di": "でぃ", "du": "どぅ",
                  "wo": "うぉ", "tya": "ちゃ", "tyu": "ちゅ", "tyo": "ちょ", "sya": "しゃ", "syu": "しゅ", "syo": "しょ", "jya": "じゃ", "jyu": "じゅ", "jyo": "じょ"})
SMALL = set("ゃゅょぁぃぅぇぉゎ")


def kata2hira(s):
    return "".join(chr(ord(c) - 0x60) if "ァ" <= c <= "ヶ" else c for c in s)


def morae(text):
    """kana -> morae (small kana join the one before; っ ん ー are morae of their own)"""
    out = []
    for c in kata2hira(unicodedata.normalize("NFC", text)):
        if c in SMALL and out:
            out[-1] += c
        elif re.match(r"[ぁ-ゖー]", c):
            out.append(c)
    return out


def romaji_to_kana(word):
    """'kira' -> 'きら' (greedy longest match); None when it is not romaji"""
    w, out, i = word.lower(), "", 0
    while i < len(w):
        if i + 1 < len(w) and w[i] == w[i + 1] and w[i] not in "aeioun":  # doubled consonant: small tsu
            out += "っ"
            i += 1
            continue
        for L in (3, 2, 1):
            k = ROMA2KANA.get(w[i:i + L])
            if k:
                out += k
                i += L
                break
        else:
            return None
    return out


# ---------------------------------------------------------------- Hangul
_L = ["g", "kk", "n", "d", "tt", "r", "m", "b", "pp", "s", "ss", "", "j", "jj", "ch", "k", "t", "p", "h"]
_V = ["a", "ae", "ya", "yae", "eo", "e", "yeo", "ye", "o", "wa", "wae", "oe", "yo", "u", "wo", "we", "wi", "yu", "eu", "ui", "i"]
_T = ["", "k", "k", "k", "n", "n", "n", "t", "l", "k", "m", "l", "l", "l", "p", "l", "m", "p", "p", "t", "t", "ng", "t", "t", "k", "t", "p", "t"]
# nearest kana per (initial, vowel); the Japanese voices cannot make Korean vowels like eo / eu
_KO_INIT_KANA = {"g": "k", "kk": "k", "n": "n", "d": "t", "tt": "t", "r": "r", "m": "m", "b": "p", "pp": "p", "s": "s", "ss": "s", "": "",
                 "j": "ch", "jj": "ch", "ch": "ch", "k": "k", "t": "t", "p": "p", "h": "h"}
_KO_VOW_KANA = {"a": "a", "ae": "e", "ya": "ya", "yae": "ye", "eo": "o", "e": "e", "yeo": "yo", "ye": "ye", "o": "o", "wa": "wa", "wae": "we",
                "oe": "we", "yo": "yo", "u": "u", "wo": "wo", "we": "we", "wi": "wi", "yu": "yu", "eu": "u", "ui": "ui", "i": "i"}


def is_hangul(s):
    return any("가" <= c <= "힣" for c in s)


def hangul_parts(c):
    o = ord(c) - 0xAC00
    return _L[o // 588], _V[(o % 588) // 28], _T[o % 28]


def hangul_to_kana(text):
    """사랑 -> さらん: an approximation for voices that only sing Japanese"""
    out = ""
    for c in text:
        if not ("가" <= c <= "힣"):
            continue
        l, v, t = hangul_parts(c)
        cons, vow = _KO_INIT_KANA[l], _KO_VOW_KANA[v]
        if vow == "ui":
            vow = "i" if cons else "ui"
        if cons == "ch" and vow.startswith("y"):
            vow = vow[1:]  # 쳐 -> ちょ
        if cons and vow.startswith("w"):
            vow = vow[1:]  # 과 -> か (kwa is not singable in Japanese)
        r = {("s", "i"): "shi", ("t", "i"): "chi", ("t", "u"): "tsu", ("h", "u"): "fu", ("j", "i"): "ji"}.get((cons, vow), cons + vow)
        k = romaji_to_kana(r) or romaji_to_kana(vow) or ""
        if t in ("n", "m", "ng"):
            k += "ん"
        elif t in ("k", "t", "p"):
            k += "っ"
        # a final ㄹ is left out: Japanese has no sound for it
        out += k
    return out


def to_kana(syl):
    """any lyric -> kana for the Japanese-only engines (NNSVS). Returns (kana, approximate)"""
    s = unicodedata.normalize("NFC", syl.strip())
    if not s:
        return "", False
    if is_hangul(s):
        return hangul_to_kana(s), True
    if re.search(r"[ぁ-ゖァ-ヺー]", s):
        return "".join(morae(s)), False
    k = romaji_to_kana(re.sub(r"[^a-zA-Z]", "", s))
    return (k or ""), False


# ---------------------------------------------------------------- dictionaries
class Dict:
    def __init__(self, path):
        data = yaml.load(pathlib.Path(path).read_text(encoding="utf-8"), Loader=_Loader) or {}
        self.entries = {}
        for e in data.get("entries") or []:
            g = str(e.get("grapheme"))
            self.entries.setdefault(g, list(e.get("phonemes") or []))
            self.entries.setdefault(g.lower(), list(e.get("phonemes") or []))
        self.types = {str(s["symbol"]): s.get("type", "") for s in data.get("symbols") or []}

    def get(self, g):
        return self.entries.get(g) or self.entries.get(g.lower())


# English words the bank's own dictionary lacks: the CMU Pronouncing Dictionary (ARPAbet), for banks
# that use ARPAbet phoneme names (OpenUtau does the same with its built-in G2P)
_CMU = {}
ARPABET = {"aa", "ae", "ah", "ao", "aw", "ay", "eh", "er", "ey", "ih", "iy", "ow", "oy", "uh", "uw", "b", "ch", "d", "dh", "f", "g",
           "hh", "jh", "k", "l", "m", "n", "ng", "p", "r", "s", "sh", "t", "th", "v", "w", "y", "z", "zh"}


def cmu(word, path):
    if not path or not pathlib.Path(path).exists():
        return None
    if path not in _CMU:
        d = {}
        with open(path, encoding="utf-8", errors="replace") as f:
            for line in f:
                parts = line.split("#")[0].split()
                if len(parts) > 1 and "(" not in parts[0]:  # first pronunciation only
                    d.setdefault(parts[0], [re.sub(r"\d", "", x).lower() for x in parts[1:]])
        _CMU[path] = d
    return _CMU[path].get(word.lower().strip("'"))


class Phonemizer:
    def __init__(self, root, phonemes, langs=None, cmudict=None):
        self.cmudict = cmudict
        root = pathlib.Path(root)
        folder = root / "dsdur" if (root / "dsdur").exists() else root
        self.files = {}
        for f in sorted(folder.glob("dsdict*.yaml")):
            m = re.match(r"dsdict-?([a-z]{2}(?:-[a-z]+)?)?\.yaml$", f.name)
            self.files[(m.group(1) if m and m.group(1) else "")] = f
        if not self.files:
            for f in sorted(root.rglob("dsdict*.yaml")):
                self.files.setdefault("", f)
        self.cache = {}
        self.phonemes = phonemes
        self.langs = langs or {}
        self.vowels = None

    def dict(self, lang):
        if lang not in self.files:
            return None
        if lang not in self.cache:
            self.cache[lang] = Dict(self.files[lang])
            if self.vowels is None or not self.vowels:
                self.vowels = {s for s, t in self.cache[lang].types.items() if t == "vowel"}
        return self.cache[lang]

    def languages(self):
        """which lyric languages this bank can sing (for the UI)"""
        out = set()
        for k in self.files:
            if k in ("ko", "ja", "en"):
                out.add(k)
        if "" in self.files:
            d = self.dict("")
            if d.get("か") or d.get("ka"):
                out.add("ja")
            if d.get("가"):
                out.add("ko")
            if d.get("the") or d.get("love"):
                out.add("en")
        return sorted(out)

    def is_vowel(self, p):
        if self.vowels is None:
            for k in self.files:
                self.dict(k)
                break
        return p in (self.vowels or set()) or p in ("SP", "AP")

    def _lookup(self, syl):
        """phones for one lyric, trying the language dictionaries in order of the script"""
        s = unicodedata.normalize("NFC", syl.strip())
        if is_hangul(s):
            order = ["ko", "", "en"]
        elif re.search(r"[ぁ-ゖァ-ヺー]", s):
            order = ["ja", ""]
        else:
            order = ["en", "", "ja"]
        for lang in order:
            d = self.dict(lang)
            if d is None:
                continue
            p = d.get(s)
            if p:
                return p, lang
            if lang == "ko" and len(s) > 1:  # several Hangul syllables on one note
                parts = [d.get(c) for c in s if "가" <= c <= "힣"]
                if parts and all(parts):
                    return [x for q in parts for x in q], lang
        # English: the CMU dictionary, when the bank knows every ARPAbet phoneme it needs
        if re.fullmatch(r"[A-Za-z']+", s) and self.phonemes and ARPABET <= set(self.phonemes):
            p = cmu(s, self.cmudict)
            if p:
                return p, "en"
        # Japanese, mora by mora (kana or romaji -> the bank's own romaji or kana keys)
        kana = s if re.search(r"[ぁ-ゖァ-ヺ]", s) else (hangul_to_kana(s) if is_hangul(s) else romaji_to_kana(re.sub(r"[^a-zA-Z]", "", s)) or "")
        out = []
        for lang in ("ja", ""):
            d = self.dict(lang)
            if d is None or not kana:
                continue
            out = []
            for m in morae(kana):
                p = d.get(m) or d.get(KANA2ROMA.get(m, "")) or (d.get(KANA2ROMA.get(m, "")[-1:]) if m not in ("っ",) else d.get("cl"))
                if m == "ん":
                    p = d.get("ん") or d.get("N") or d.get("n")
                if m == "ー":
                    continue
                if not p:
                    out = None
                    break
                out += p
            if out:
                return out, "ja"
        return None, None

    def phrase(self, notes):
        """notes [{t, d, n, syl}] (t from the phrase start) -> everything the models need, with
        words split at vowel onsets (each note's vowel starts exactly on the note)."""
        # 1) phones per note
        per = []  # [note, phones or None for slur, rest?]
        pending, last = [], None  # extra vowel groups of a multi-syllable word, sung on the following "+" notes

        def flush():
            # vowel groups that found no "+" note are sung on the word's last note
            if pending and last is not None:
                per[last][1] = per[last][1] + [p for g in pending for p in g]
            pending.clear()

        for x in notes:
            syl = str(x.get("syl") or "").strip()
            if syl in ("-", "R", "SP"):
                flush()
                per.append([x, ["SP"], True])
                last = None
                continue
            if syl in ("", "+", "ー", "~"):
                if pending:
                    per.append([x, pending.pop(0), False])
                    last = len(per) - 1
                else:
                    per.append([x, None, False])
                continue
            flush()
            phones, _ = self._lookup(syl)
            if not phones:
                phones = self._lookup("a")[0] or ["a"]
            groups = self._split_vowel_groups(phones)
            per.append([x, groups[0], False])
            last = len(per) - 1
            pending.extend(groups[1:])
        flush()
        # 2) timeline: [SP head] + notes, rests where there are gaps
        phones, langs, ph_midi, fixed, guess = [], [], [], [], []
        word_div, word_edges = [], [0.0]
        notes_out, note_edges = [], [0.0]
        head = notes[0]["t"]
        prev_end = head
        events = []  # (start, end, midi, phones-or-None, rest)
        for x, p, rest in per:
            if x["t"] - prev_end > 0.05 and events:
                events.append((prev_end, x["t"], events[-1][2], ["SP"], True))
            events.append((x["t"], x["t"] + x["d"], x["n"], p, rest))
            prev_end = x["t"] + x["d"]
        tail_end = prev_end + 0.3
        events.append((prev_end, tail_end, events[-1][2], ["SP"], True))
        # head note (rest) for the pitch model
        notes_out.append({"midi": float(notes[0]["n"]), "rest": True})
        note_edges = [0.0, head]
        words = []  # (start, phones, midis)
        words.append([0.0, ["SP"], [notes[0]["n"]]])
        for (s, e, n, p, rest) in events:
            notes_out.append({"midi": float(n), "rest": bool(rest)})
            note_edges.append(e)
            if p is None:  # slur: the word goes on, the note changes
                continue
            # leading non-vowels belong before the onset (end of the previous word)
            k = 0
            while k < len(p) and not self.is_vowel(p[k]):
                k += 1
            if k == len(p):  # no vowel at all (a lone consonant): keep it on the note
                k = 0
            words[-1][1] += p[:k]
            words[-1][2] += [n] * k
            words.append([s, list(p[k:]), [n] * (len(p) - k)])
        for i, (s, ps, ms) in enumerate(words):
            for ph, m in zip(ps, ms):
                phones.append(ph)
                langs.append("")
                ph_midi.append(int(round(m)))
                fixed.append(not self.is_vowel(ph))
                guess.append(0.08 if not self.is_vowel(ph) else 0.3)
            word_div.append(len(ps))
            word_edges.append(words[i + 1][0] if i + 1 < len(words) else tail_end)
        return {"phones": phones, "langs": langs, "ph_midi": ph_midi, "ph_fixed": fixed, "ph_guess": guess,
                "word_div": word_div, "word_edges": word_edges, "notes": notes_out, "note_edges": note_edges}

    def _split_vowel_groups(self, phones):
        """[s, ih, l, v, er] -> [[s, ih, l], [v, er]]: one group per vowel (a vowel's trailing
        consonants stay with it unless the next vowel needs an onset)"""
        idx = [i for i, p in enumerate(phones) if self.is_vowel(p)]
        if len(idx) <= 1:
            return [phones]
        groups, start = [], 0
        for a, b in zip(idx, idx[1:]):
            between = b - a - 1
            cut = a + 1 + between // 2 if between > 1 else (a + 1 if between == 1 else b)
            groups.append(phones[start:cut])
            start = cut
        groups.append(phones[start:])
        return groups
