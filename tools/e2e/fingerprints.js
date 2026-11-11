// Builds renderer/studio/fingerprints.json: the timbre of every MeloFi instrument and synth preset
// (timbre.js features of single notes every 5 semitones over its range, 1.2 s, velocity 100),
// rendered through the same path the matching uses (midiconvert.js renderNotes). Instruments that
// are downloadable but not on this PC are downloaded first. Run headless after adding instruments or
// presets (a scratch userData is fine):
//   MELOFI_SHOT=out MELOFI_SCRIPT=tools/e2e/fingerprints.js npx electron .
// Prints FPJSON-BEGIN<json>FPJSON-END; tools/e2e/save-fingerprints.mjs writes it into the file.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const A = window.__melofi; for (let i = 0; i < 150 && !A?.engine?.inst; i++) await sleep(100);
const imp = (p) => import(new URL(p, location.href).href);
const T = await imp('studio/timbre.js');
const M = await imp('studio/ui/midiconvert.js');
const { SYNTH_PRESETS } = await imp('studio/synth.js');
const S = { app: A, isKit: (id) => A.instruments.find((i) => i.id === id)?.family === 'drums', instName: (id) => A.instruments.find((i) => i.id === id)?.name || id };
const only = window.__args?.only || null; // optional: just these ids
const STEP_S = 1.6, DUR = 1.2;

async function rangeOf(id) {
  try {
    const m = await (await fetch(`melofi://app/instruments/${id}/manifest.json`)).json();
    if (m.procedural) return [m.procedural.lo ?? 28, m.procedural.hi ?? 100];
    const rs = (m.regions || []).filter((r) => r.c != null);
    if (!rs.length) return [36, 84];
    // the sampled range, a little beyond the outermost samples
    return [Math.max(24, Math.min(...rs.map((r) => r.c)) - 3), Math.min(103, Math.max(...rs.map((r) => r.c)) + 3)];
  } catch { return [36, 84]; }
}
const pitches = (lo, hi) => { const out = []; for (let n = Math.ceil(lo / 5) * 5; n <= hi; n += 5) out.push(n); return out.length ? out : [60]; };

async function print(id, kind, fam, name, lo, hi) {
  const ps = pitches(Math.max(lo, 24), Math.min(hi, 100));
  const notes = ps.map((n, i) => [i * STEP_S, DUR, n, 100]);
  const ren = await M.renderNotes(S, id, notes, ps.length * STEP_S);
  const feats = notes.map(([t, d, n]) => T.pack(T.noteFeatures(ren.x, ren.rate, t, d, n, { off: ren.off })));
  return { kind, fam, name, range: [lo, hi], notes: feats.filter(Boolean) };
}

const out = {}, t0 = performance.now();
for (const m of A.instruments) {
  if (m.family === 'drums' || m.family === 'fx') continue;
  if (only && !only.includes(m.id)) continue;
  if (!m.installed && m.downloadable) {
    try { await A.downloadInstrument(m.id, { quiet: true }); } catch (e) { console.log('FPDL ' + m.id + ' ' + e.message); }
  }
  const cur = A.instruments.find((i) => i.id === m.id);
  if (!cur?.installed) { out[m.id] = { kind: 'inst', fam: m.family, error: 'not installed' }; continue; }
  const [lo, hi] = await rangeOf(m.id);
  try { out[m.id] = await print(m.id, 'inst', m.family || 'piano', m.name, lo, hi); } catch (e) { out[m.id] = { kind: 'inst', fam: m.family, error: String(e.message || e) }; }
  console.log(`FPPROG ${m.id} ${out[m.id].notes?.length ?? out[m.id].error}`);
}
for (const name of Object.keys(SYNTH_PRESETS)) {
  const id = `synth:${name}`;
  if (only && !only.includes(id)) continue;
  const fam = M.candKind(S, id), bass = fam === '신스 베이스';
  try { out[id] = await print(id, 'synth', fam, name, bass ? 24 : 40, bass ? 64 : 96); } catch (e) { out[id] = { kind: 'synth', fam, error: String(e.message || e) }; }
}
console.log(`FPTIME ${Math.round((performance.now() - t0) / 1000)} s, ${Object.keys(out).length} sounds`);
console.log('FPJSON-BEGIN' + JSON.stringify(out) + 'FPJSON-END' + (only ? '' : 'FPFULL'));
return [10];
