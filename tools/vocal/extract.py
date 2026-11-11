"""Unpack a downloaded voice archive (zip / 7z / tar.gz) into a folder, safely.

usage: python -I extract.py <archive> <dest>
- zip names without the UTF-8 flag are read as Shift-JIS (Japanese voicebanks are packed that way);
- entries that would land outside <dest> (absolute paths, "..") are refused;
- nothing inside the archive is run.
Prints {"ok": true, "files": N} or {"ok": false, "error": ...}.
"""
import json, os, pathlib, sys, tarfile, zipfile
sys.stdout.reconfigure(encoding="utf-8")  # -I ignores PYTHONIOENCODING; MeloFi reads UTF-8


def junk(name):
    """macOS metadata that some archives carry: never unpacked"""
    parts = name.replace("\\", "/").split("/")
    return "__MACOSX" in parts or parts[-1].startswith("._") or parts[-1] == ".DS_Store"


def inside(dest, name):
    p = (dest / name).resolve()
    if not str(p).startswith(str(dest.resolve()) + os.sep) and p != dest.resolve():
        raise ValueError(f"unsafe path in archive: {name}")
    return p


def main():
    src, dest = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
    dest.mkdir(parents=True, exist_ok=True)
    n = 0
    with open(src, "rb") as f:
        magic = f.read(6)
    if magic[:4] == b"PK\x03\x04":
        with zipfile.ZipFile(src) as z:
            for i in z.infolist():
                name = i.filename
                if not i.flag_bits & 0x800:
                    try:
                        name = name.encode("cp437").decode("cp932")
                    except (UnicodeEncodeError, UnicodeDecodeError):
                        pass
                if junk(name):
                    continue
                p = inside(dest, name)
                if name.endswith("/"):
                    p.mkdir(parents=True, exist_ok=True)
                    continue
                p.parent.mkdir(parents=True, exist_ok=True)
                with z.open(i) as r, open(p, "wb") as w:
                    while True:
                        b = r.read(1 << 20)
                        if not b:
                            break
                        w.write(b)
                n += 1
    elif magic == b"7z\xbc\xaf\x27\x1c":
        import py7zr
        with py7zr.SevenZipFile(src) as z:
            names = [x for x in z.getnames() if not junk(x)]
            for name in names:
                inside(dest, name)
            z.extract(path=dest, targets=names)
            n = len(names)
    else:
        with tarfile.open(src) as t:
            members = []
            for m in t.getmembers():
                if not (m.isfile() or m.isdir()) or junk(m.name):
                    continue  # no links, devices or macOS metadata
                inside(dest, m.name)
                members.append(m)
            t.extractall(dest, members=members)
            n = len(members)
    print(json.dumps({"ok": True, "files": n}))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"{type(e).__name__}: {e}"}))
        sys.exit(1)
