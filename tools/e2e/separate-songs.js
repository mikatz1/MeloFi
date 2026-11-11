// Separates a list of songs with the analysis engine and runs instrument recognition on each, so the
// timbre-matching tests (tools/e2e/timbre-songs.js) have stems to work on. Run headless with a
// scratch userData whose stems-engine is a junction to the real engine:
//   MELOFI_USERDATA=<scratch> MELOFI_SHOT=<out> MELOFI_SCRIPT=<wrapper.js> npx electron .
// where the wrapper is `window.__args = { songs: [paths] };` followed by this file.
// Prints SEPARATED {"path": "<cache dir>"} per song.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const A = window.__melofi; for (let i = 0; i < 150 && !A?.engine?.inst; i++) await sleep(100);
const songs = window.__args?.songs || [];
window.melofi.onStemsLog((t) => { if (/error|Traceback|C624B958/i.test(t)) console.log('LOG ' + t); });
for (const path of songs) {
  const t0 = performance.now();
  const r = await window.melofi.stemsRun({ path, name: path, quick: false, muscriptor: 'off' });
  if (!r.ok) { console.log('SEPFAIL ' + JSON.stringify({ path, msg: r.message })); continue; }
  const dir = Object.values(r.result.stems)[0].replace(/[\\/]stems[\\/][^\\/]+$/, '');
  const ins = await window.melofi.stemsInstruments(dir);
  console.log('SEPARATED ' + JSON.stringify({ path, dir, ok: ins.ok, msg: ins.message, sec: Math.round((performance.now() - t0) / 1000) }));
}
return [10];
