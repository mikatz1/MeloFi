// Renders every instrument (instruments/*/manifest.json) through the Studio engine with a phrase that
// suits its family and measures it (BS.1770). Prints INSTLEVELS {json}: id -> { fam, lufs, peak, gain }.
//   MELOFI_SHOT=out MELOFI_SCRIPT=tools/e2e/instrument-levels.js npx electron .
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const A = window.__melofi; for (let i = 0; i < 150 && !A?.engine?.inst; i++) await sleep(100);
const imp = (p) => import(new URL(p, location.href).href);
const { newProject, newChannel, newPattern, PPQ } = await imp('studio/model.js');
const io = await imp('studio/io.js'), dsp = await imp('studio/master-dsp.js');
const sec = (s) => Math.round(s * 2 * PPQ); // 120 BPM
const PH = {
  low: [[0, 0.4, [36]], [0.5, 0.4, [36]], [1, 0.4, [43]], [1.5, 0.9, [41]]],
  chords: [[0, 0.9, [60, 64, 67]], [1, 0.9, [62, 65, 69]]],
  melody: [[0, 0.45, [72]], [0.5, 0.45, [74]], [1, 0.45, [76]], [1.5, 0.9, [79]]],
  mid: [[0, 0.45, [64]], [0.5, 0.45, [67]], [1, 0.45, [69]], [1.5, 0.9, [72]]],
  drums: [[0, 0.1, [36, 42]], [0.25, 0.1, [42]], [0.5, 0.1, [38, 42]], [0.75, 0.1, [42]], [1, 0.1, [36, 42]], [1.25, 0.1, [42]], [1.5, 0.1, [38, 42]], [1.75, 0.1, [42]]],
  fx: [[0, 1.6, [60]]],
};
const phraseOf = (fam, id) => (fam === 'drums' ? PH.drums : fam === 'bass' ? PH.low : fam === 'fx' ? PH.fx
  : ['winds', 'brass', 'vocal', 'mallets', 'world'].includes(fam) || ['violin', 'flute'].includes(id) ? PH.melody
  : ['cello', 'contrabass'].includes(id) ? PH.low.map(([t, d, n]) => [t, d, n.map((x) => x + 12)]) : fam === 'strings' || fam === 'organ' || fam === 'keys' || !fam ? PH.chords : PH.mid);
const out = {};
for (const m of A.instruments) {
  if (!m.installed) continue;
  try {
    const p = newProject();
    p.bpm = 120;
    const kit = m.family === 'drums';
    const ch = newChannel(m.id, m.name, 0, { vol: 1, send: 0, pan: 0, ...(kit ? { stepNote: 36 } : {}) });
    p.channels = [ch]; p.selected = ch.id;
    const pat = newPattern(0, 1); pat.notes = { [ch.id]: [] };
    for (const [t, d, notes] of phraseOf(m.family, m.id)) for (const n of notes) pat.notes[ch.id].push({ t: sec(t), d: sec(d), n, v: 100 });
    p.patterns = [pat]; p.current = pat.id; p.playlist.clips = []; p.master.fx = [];
    const mix = await io.renderMix(p, { tail: 1 });
    const r = dsp.measure(mix.left, mix.right, mix.rate);
    out[m.id] = { fam: m.family || 'piano', lufs: Math.round(r.I * 10) / 10, peak: Math.round(r.sp * 10) / 10 };
  } catch (e) { out[m.id] = { fam: m.family, error: String(e.message || e) }; }
}
console.log('INSTLEVELS ' + JSON.stringify(out));
return [10];
