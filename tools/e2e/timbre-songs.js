// End-to-end check of the instrument matching on separated songs: for every section group of every
// stem, the best MeloFi instrument and its accuracy (midiconvert.js matchAll). Songs are separated
// first with tools/e2e/separate-songs.js (same userData). Run headless:
//   MELOFI_USERDATA=<scratch> MELOFI_SHOT=<out> MELOFI_SCRIPT=<wrapper.js> npx electron .
// wrapper: `window.__args = { dirs: [<stems-cache dirs>], names: [..] };` followed by this file.
// Prints TSONG {json} per song and TSUMMARY {json} at the end.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const A = window.__melofi; for (let i = 0; i < 150 && !A?.engine?.inst; i++) await sleep(100);
const imp = (p) => import(new URL(p, location.href).href);
const M = await imp('studio/ui/midiconvert.js');
const S = { app: A, isKit: (id) => A.instruments.find((i) => i.id === id)?.family === 'drums', instName: (id) => A.instruments.find((i) => i.id === id)?.name || id };
const readJson = async (f) => { const b = await window.melofi.stemsRead(f); return b ? JSON.parse(new TextDecoder().decode(b)) : null; };
const args = window.__args || {};
const summary = { valid: 0, ok: 0, stray: 0, vocal: 0, unmeasured: 0, sec: 0, fails: [] };
for (const [si, dir] of (args.dirs || []).entries()) {
  const t0 = performance.now();
  const r = await readJson(`${dir}\\result.json`), inst = await readJson(`${dir}\\instruments.json`);
  if (!r || !inst) { console.log('TSONG ' + JSON.stringify({ dir, error: 'missing result or instruments' })); continue; }
  const plan = M.sections(r, inst);
  await M.matchAll(S, r, plan, { onProgress: () => {}, normalize: args.normalize !== false, synthSearch: args.synthSearch !== false, reverb: args.reverb !== false });
  const rows = [];
  for (const [k, groups] of Object.entries(plan.stems)) for (const g of groups) {
    const m = g.match || {}, best = m.cands?.[0];
    const t0 = plan.bars[g.secs[0].start], t1 = plan.bars[g.secs.at(-1).end] ?? r.duration;
    const row = {
      stem: k, vocal: !!m.vocal, bars: M.rangeText(g.secs), sec: [+t0.toFixed(1), +Math.min(t1, r.duration).toFixed(1)], ast: g.label,
      astTop: Object.entries(g.share || {}).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c, v]) => `${c} ${Math.round(v * 100)}%`),
      bestKind: best ? M.candKind(S, best.id) : null, bestName: best ? M.candName(S, best.id) : null,
      octave: r.octaveFix?.[k] || null, stats: m.stats, notes: g.notes, heard: g.heard, stray: g.stray,
      probes: m.probes, best: best ? `${best.id} (${M.candKind(S, best.id)}) ${best.acc}%` : null, acc: best?.acc ?? 0,
      parts: best?.parts, top: (m.cands || []).slice(0, 5).map((c) => `${c.id} ${c.acc}`), tried: m.cands?.length || 0, desc: m.desc, error: m.error,
    };
    row.room = m.room || null;
    rows.push(row);
    if (g.stray) summary.stray++;
    else if (m.vocal) summary.vocal++;
    else if (m.unmeasured || !best) summary.unmeasured++;
    else { summary.valid++; if (best.acc >= 90) summary.ok++; else summary.fails.push({ song: args.names?.[si] || dir, stem: k, bars: row.bars, ast: g.label, best: row.best, desc: m.desc }); }
  }
  const sec = Math.round((performance.now() - t0) / 1000);
  summary.sec += sec;
  // the song's style, roughly, from what the recognition heard across all stems (for the report)
  const vote = {};
  for (const rows2 of Object.values(inst.stems || {})) for (const w of rows2) for (const [c, v] of Object.entries(w.p || {})) vote[c] = (vote[c] || 0) + v;
  console.log('TSONG ' + JSON.stringify({ name: args.names?.[si] || dir, dir, sec, bpm: r.bpm, vote, rows }));
}
console.log('TSUMMARY ' + JSON.stringify(summary));
return [10];
