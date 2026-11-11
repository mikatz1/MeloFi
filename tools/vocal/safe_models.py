"""Guards for voice models downloaded from the internet.

Voice files are data, never code. PyTorch checkpoints (.pth) are pickles, and NNSVS configs name the
Python classes to build (Hydra `_target_`), so a tampered voice could run code. Before a voice is
loaded MeloFi checks both:
- every pickle inside a checkpoint may only name tensor-rebuilding globals (scanned with pickletools,
  which reads the opcodes without executing anything), and torch.load is forced to weights_only;
- every `_target_` in the voice's YAML files must be one of the model classes NNSVS ships.
ENUNU extension scripts bundled with some voices are never run.
"""
import io, pathlib, pickletools, re, zipfile

SAFE_GLOBALS = {
    "collections OrderedDict", "torch._utils _rebuild_tensor_v2", "torch._utils _rebuild_parameter",
    "torch FloatStorage", "torch LongStorage", "torch IntStorage", "torch HalfStorage", "torch DoubleStorage",
    "torch BoolStorage", "torch ByteStorage", "torch BFloat16Storage", "torch._utils _rebuild_tensor",
    "builtins set", "torch float32", "torch device", "torch.nn.parameter Parameter",
}
SAFE_TARGET = re.compile(r"^(nnsvs|usfgan|parallel_wavegan)\.[A-Za-z0-9_.]+$|^torch\.(optim|nn)\.[A-Za-z0-9_.]+$")


class UnsafeVoice(Exception):
    pass


def pickle_globals(data):
    names, strs = set(), []
    for op, arg, _ in pickletools.genops(io.BytesIO(data)):
        if op.name in ("SHORT_BINUNICODE", "BINUNICODE", "UNICODE", "BINUNICODE8"):
            strs.append(arg)
        elif op.name == "GLOBAL":
            names.add(arg.replace("\n", " ").strip())
        elif op.name == "STACK_GLOBAL":
            names.add(f"{strs[-2]} {strs[-1]}" if len(strs) >= 2 else "?")
        elif op.name in ("INST", "OBJ", "EXT1", "EXT2", "EXT4"):
            names.add(f"<{op.name}>")
    return names


def _legacy_pickles(f, count=5):
    """the legacy (pre-1.6) torch.save format: five pickles (magic, protocol, sys info, the object,
    storage keys) followed by raw tensor bytes. Yields each pickle's globals."""
    for _ in range(count):
        names, strs = set(), []
        for op, arg, _ in pickletools.genops(f):
            if op.name in ("SHORT_BINUNICODE", "BINUNICODE", "UNICODE", "BINUNICODE8"):
                strs.append(arg)
            elif op.name == "GLOBAL":
                names.add(arg.replace("\n", " ").strip())
            elif op.name == "STACK_GLOBAL":
                names.add(f"{strs[-2]} {strs[-1]}" if len(strs) >= 2 else "?")
            elif op.name in ("INST", "OBJ", "EXT1", "EXT2", "EXT4"):
                names.add(f"<{op.name}>")
        yield names


def check_checkpoint(path):
    path = pathlib.Path(path)
    if zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as z:
            sets = [pickle_globals(z.read(n)) for n in z.namelist() if n.endswith(".pkl")]
    else:
        with open(path, "rb") as f:
            sets = list(_legacy_pickles(f))
    for names in sets:
        bad = names - SAFE_GLOBALS
        if bad:
            raise UnsafeVoice(f"{path.name}: {sorted(bad)[:3]}")


def check_targets(path):
    for m in re.finditer(r"_target_\s*:\s*['\"]?([^\s'\"#]+)", pathlib.Path(path).read_text(encoding="utf-8", errors="replace")):
        if not SAFE_TARGET.match(m.group(1)):
            raise UnsafeVoice(f"{pathlib.Path(path).name}: {m.group(1)}")


def check_voice_dir(model_dir):
    d = pathlib.Path(model_dir)
    for f in d.glob("*.pth"):
        if not f.name.startswith("._"):  # macOS resource forks that some archives carry
            check_checkpoint(f)
    for f in d.glob("*.yaml"):
        if not f.name.startswith("._"):
            check_targets(f)


def force_weights_only():
    import torch
    orig = torch.load

    def load(*a, **k):
        k["weights_only"] = True
        return orig(*a, **k)

    torch.load = load
