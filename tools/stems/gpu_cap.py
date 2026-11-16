"""A ceiling on how much of the graphics card the analysis takes, for test runs.

MELOFI_GPU_CAP=0.8 in the environment (tools/roundtrip.sh sets it; the app's normal use does not):
- memory: this process may hold at most that share of the card's memory;
- load: every call of a model is timed and followed by a pause in proportion to its time (REST,
  below), so the card works at most that share of the time on average. Short peaks at full load
  remain; the sustained level does not;
- the card's own reading: the pauses alone left the separation at about 90% while it worked (the
  work between the timed calls, and whatever else uses the card, is not in them). So the card's
  utilisation is read once a second (nvidia-smi, a query only) and, after a call, this process
  waits until the average of the last 10 seconds is back under the cap. Where nvidia-smi is not
  there, only the timed pauses apply.
Nothing in the system is changed (no power limit, no driver setting): only this process waits.
"""
import os, time, threading, subprocess, collections

CAP = 0.0
try:
    CAP = float(os.environ.get("MELOFI_GPU_CAP", "0") or 0)
except ValueError:
    CAP = 0.0
if not 0.05 <= CAP < 1:
    CAP = 0.0
# the pause after a call, as a share of the call's time. The card also works outside the timed
# calls (the separation's STFT and overlap-add), so the calls aim a fifth under the cap: measured
# with cap 0.8 and plain (1 / cap - 1), the highest 10-second average was 88%.
REST = (1 / (CAP * 0.8) - 1) if CAP else 0.0

WINDOW = 10            # seconds the card's load is averaged over
MARGIN = 4.0           # points under the cap the average is brought back to
_util = collections.deque(maxlen=64)  # (time, utilisation)
_watch = {"started": False, "ok": False, "waited": 0.0, "holds": 0}


def _watcher():
    # one short query a second (not a looping nvidia-smi: if this process is killed, a looping one
    # would stay behind)
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    fails = 0
    while fails < 5:
        t0 = time.perf_counter()
        try:
            out = subprocess.run(["nvidia-smi", "--query-gpu=utilization.gpu", "--format=csv,noheader,nounits"],
                                 capture_output=True, text=True, timeout=3, creationflags=flags).stdout
            _util.append((time.perf_counter(), float(out.strip().splitlines()[0].split(",")[0])))
            _watch["ok"] = True; fails = 0
        except Exception:
            fails += 1
        time.sleep(max(0.05, 1.0 - (time.perf_counter() - t0)))
    _watch["ok"] = False


def _start_watch():
    if CAP and not _watch["started"]:
        _watch["started"] = True
        threading.Thread(target=_watcher, daemon=True).start()


def load():
    """the card's average utilisation over the last seconds (0..100), or None when it cannot be read"""
    if not _watch["ok"]:
        return None
    now = time.perf_counter()
    us = [u for t, u in list(_util) if now - t <= WINDOW]
    return sum(us) / len(us) if us else None


def hold(limit=20.0):
    """wait while the card's 10-second average is at the cap (at most `limit` seconds)"""
    if not CAP:
        return
    _start_watch()
    t0 = time.perf_counter()
    while time.perf_counter() - t0 < limit:
        u = load()
        if u is None or u <= CAP * 100 - MARGIN:
            break
        time.sleep(0.25)
    w = time.perf_counter() - t0
    if w > 0.2:
        _watch["waited"] += w; _watch["holds"] += 1


def report():
    """what the cap did, for the log"""
    return {"cap": CAP, "watch": _watch["ok"], "holds": _watch["holds"], "held_s": round(_watch["waited"], 1), "load": load()}


def limit_memory(torch):
    """at most CAP of the card's memory for this process"""
    if CAP and torch.cuda.is_available():
        _start_watch()
        try:
            torch.cuda.set_per_process_memory_fraction(CAP)
        except Exception:
            pass
    return CAP


def throttle(module, torch):
    """pause after every forward call of `module` (a torch.nn.Module) so its duty stays at CAP"""
    if not CAP or module is None or not torch.cuda.is_available() or getattr(module, "_melofi_cap", False):
        return module
    state = {"t": 0.0}

    def before(_m, _inp):
        state["t"] = time.perf_counter()

    def after(_m, _inp, _out):
        try:
            torch.cuda.synchronize()
        except Exception:
            pass
        dt = time.perf_counter() - state["t"]
        if dt > 0.002:
            time.sleep(min(5.0, dt * REST))
        hold()

    try:
        module.register_forward_pre_hook(before)
        module.register_forward_hook(after)
        module._melofi_cap = True
    except Exception:
        pass
    return module


class _Paced:
    """a model called through this waits after every call (the same pause as throttle); everything
    else about the model is passed on. For models whose calls do not go through torch's hooks
    (audio-separator compiles some of its models: the compiled call skips them)."""

    def __init__(self, model, torch):
        object.__setattr__(self, "_m", model); object.__setattr__(self, "_torch", torch)

    def __call__(self, *a, **k):
        t0 = time.perf_counter()
        out = self._m(*a, **k)
        try:
            self._torch.cuda.synchronize()
        except Exception:
            pass
        dt = time.perf_counter() - t0
        if dt > 0.002:
            time.sleep(min(5.0, dt * REST))
        hold()
        return out

    def __getattr__(self, name):
        return getattr(self._m, name)

    def __setattr__(self, name, value):
        setattr(self._m, name, value)


def pace_attr(obj, name, torch):
    """obj.<name> (a callable model) replaced by a paced one"""
    if not CAP or obj is None or not torch.cuda.is_available():
        return
    m = getattr(obj, name, None)
    if m is None or isinstance(m, _Paced):
        return
    try:
        setattr(obj, name, _Paced(m, torch))
    except Exception:
        pass


def rest(seconds):
    """after GPU work that could not be hooked (another runtime): the matching pause"""
    if CAP and seconds > 0.002:
        time.sleep(min(30.0, seconds * (1 / CAP - 1)))
        hold()


def modules_of(obj, torch, depth=2):
    """the torch modules reachable from an object's attributes (a wrapper around a model)"""
    out, seen = [], set()

    def walk(o, d):
        if id(o) in seen:
            return
        seen.add(id(o))
        if isinstance(o, torch.nn.Module):
            out.append(o); return
        if d <= 0:
            return
        for name in dir(o):
            if name.startswith("__"):
                continue
            try:
                v = getattr(o, name)
            except Exception:
                continue
            if isinstance(v, torch.nn.Module):
                if id(v) not in seen:
                    seen.add(id(v)); out.append(v)
            elif hasattr(v, "__dict__") and not callable(v):
                walk(v, d - 1)

    walk(obj, depth)
    return out
