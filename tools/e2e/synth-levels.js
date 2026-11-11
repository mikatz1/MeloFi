// Renders every MeloFi Synth preset with a phrase that suits its family and measures it (BS.1770),
// so the presets can be levelled to a loudness per family. Run headless:
//   MELOFI_SHOT=out MELOFI_SCRIPT=tools/e2e/synth-levels.js npx electron .
// Prints SYNTHLEVELS {json}: name -> { lufs, peak, ok }.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const A = window.__melofi; for (let i = 0; i < 150 && !A?.engine?.inst; i++) await sleep(100);
const imp = (p) => import(new URL(p, location.href).href);
const { SynthChannel, synthDefaults, SYNTH_PRESETS, SYNTH_CATEGORIES } = await imp('studio/synth.js');
const dsp = await imp('studio/master-dsp.js');
const fam = {};
for (const [c, names] of Object.entries(SYNTH_CATEGORIES)) for (const n of names) fam[n] = c;
// phrases: [start s, length s, notes]
const PH = {
  '베이스': [[0, 0.4, [36]], [0.5, 0.4, [36]], [1, 0.4, [43]], [1.5, 0.9, [41]]],
  '패드': [[0, 2.4, [60, 64, 67]]],
  '리드': [[0, 0.45, [72]], [0.5, 0.45, [74]], [1, 0.45, [76]], [1.5, 0.9, [79]]],
  '플럭': [[0, 0.2, [60]], [0.25, 0.2, [64]], [0.5, 0.2, [67]], [0.75, 0.2, [72]], [1, 0.2, [67]], [1.25, 0.2, [64]]],
  '건반': [[0, 0.9, [60, 64, 67]], [1, 0.9, [62, 65, 69]]],
  '아르프·시퀀스': [[0, 0.12, [60]], [0.125, 0.12, [64]], [0.25, 0.12, [67]], [0.375, 0.12, [72]], [0.5, 0.12, [60]], [0.625, 0.12, [64]], [0.75, 0.12, [67]], [0.875, 0.12, [72]]],
  '브라스·스트링': [[0, 0.9, [60, 64, 67]], [1, 0.9, [62, 65, 69]]],
  '벨·말렛': [[0, 0.4, [72]], [0.5, 0.4, [76]], [1, 0.4, [79]], [1.5, 0.9, [84]]],
  '보컬': [[0, 1.8, [60, 64, 67]]],
  'FX': [[0, 1.6, [60]]],
};
const out = {};
for (const [name, pr] of Object.entries(SYNTH_PRESETS)) {
  const SR = 48000, N = SR * 4, c = new OfflineAudioContext(2, N, SR);
  const ch = new SynthChannel(c, c.destination);
  ch.setParams({ ...synthDefaults(), ...pr });
  for (const [t, d, notes] of PH[fam[name]] || PH['리드']) for (const n of notes) ch.noteOn(n, 100, 0.05 + t, d);
  const r = await c.startRendering();
  const L = r.getChannelData(0), R = r.getChannelData(1);
  let bad = false; for (let i = 0; i < L.length; i += 97) if (!Number.isFinite(L[i])) { bad = true; break; }
  const m = dsp.measure(L, R, SR);
  out[name] = { fam: fam[name], lufs: Math.round(m.I * 10) / 10, peak: Math.round(m.sp * 10) / 10, vol: pr.vol ?? 0.7, ok: !bad && m.I > -60 };
}
console.log('SYNTHLEVELS ' + JSON.stringify(out));
return [10];
