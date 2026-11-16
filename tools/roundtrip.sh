#!/bin/bash
# Round-trip test of the separation -> DAW pipeline (docs/roundtrip-eval.md).
#   tools/roundtrip.sh <out dir> [args json]     e.g. tools/roundtrip.sh /tmp/rt1 '{"seed":1}'
# Renders the reference songs, runs them through the app headless with a scratch userData that
# borrows the installed analysis engine and instruments, then scores the result:
#   node tools/roundtrip-score.mjs <out dir> [--baseline docs/roundtrip-baseline.json]
set -e
cd "$(dirname "$0")/.."
OUT="$1"; ARGS="${2:-{\}}"
[ -n "$OUT" ] || { echo "usage: tools/roundtrip.sh <out dir> [args json]"; exit 2; }
mkdir -p "$OUT/ud"
APP="$(cygpath -m "$APPDATA")/MeloFi"
UD="$(cygpath -m "$OUT/ud")"
for d in stems-engine instruments; do
  [ -e "$OUT/ud/$d" ] || powershell -NoProfile -Command "New-Item -ItemType Junction -Path '$UD/$d' -Target '$APP/$d' | Out-Null"
done
# the oracle phase's stems live in the run folder, seen by the app as stems-cache\oracle
mkdir -p "$OUT/ud/stems-cache"
[ -e "$OUT/ud/stems-cache/oracle" ] || powershell -NoProfile -Command "New-Item -ItemType Junction -Path '$UD/stems-cache/oracle' -Target '$(cygpath -m "$OUT")' | Out-Null"
CACHE="$(cygpath -m "$OUT/ud/stems-cache/oracle")"
ARGS="$(echo "$ARGS" | sed "s|^{|{\"cacheDir\":\"$CACHE\",|; s|,}$|}|")"
{ echo "window.__args = $ARGS;"; cat tools/e2e/roundtrip-eval.js; } > "$OUT/script.js"
# test runs take at most 80% of the graphics card (tools/stems/gpu_cap.py); MELOFI_GPU_CAP=0 lifts it
MELOFI_GPU_CAP="${MELOFI_GPU_CAP:-0.8}" MELOFI_SHOT="$OUT" MELOFI_SCRIPT="$OUT/script.js" MELOFI_USERDATA="$OUT/ud" npx electron . > "$OUT/log.txt" 2>&1 || true
grep -E "RENDERED|RENDERFAIL|DONE|RUNFAIL|ROUNDTRIP-END" "$OUT/log.txt" | sed 's/^\[renderer:info\] //'
KIND=out; echo "$ARGS" | grep -q '"phase": *"oracle"' && KIND=oracle
node tools/roundtrip-score.mjs "$OUT" --kind $KIND ${BASELINE:+--baseline "$BASELINE"}
