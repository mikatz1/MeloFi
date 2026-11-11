// End-to-end check of instruments that come from archives / SoundFonts (lib/install-source.js):
// download through the app's own IPC, then render a phrase and a held note through the Studio engine,
// measure loudness (not silent) and the pitch of the held note. Prints ARCHIVE_E2E {json}.
//   MELOFI_USERDATA=<scratch> MELOFI_SHOT=<dir> MELOFI_SCRIPT=tools/e2e/archive-e2e.js [MELOFI_E2E_IDS=a,b] electron .
//   (MELOFI_TEST_NO_RANGE=1 forces the whole-file fallback.)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const A = window.__melofi; for (let i = 0; i < 150 && !A?.engine?.inst; i++) await sleep(100);
const imp = (p) => import(new URL(p, location.href).href);
const { newProject, newChannel, newPattern, PPQ } = await imp('studio/model.js');
const io = await imp('studio/io.js'), dsp = await imp('studio/master-dsp.js');
const sec = (s) => Math.round(s * 2 * PPQ); // 120 BPM
const ids = (window.__e2eIds || '').split(',').filter(Boolean);
const list = await window.melofi.listInstruments();
const want = ids.length ? list.filter((m) => ids.includes(m.id)) : list.filter((m) => m.downloadable && !m.bundled);

function pitchOf(x, rate) {
  const minLag = Math.floor(rate / 2000), maxLag = Math.floor(rate / 25), n = Math.min(x.length - maxLag, 8192);
  const ac = new Float32Array(maxLag + 2);
  let best = 0, bestLag = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0, e1 = 0, e2 = 0;
    for (let i = 0; i < n; i++) { s += x[i] * x[i + lag]; e1 += x[i] * x[i]; e2 += x[i + lag] * x[i + lag]; }
    ac[lag] = s / Math.sqrt(e1 * e2 + 1e-12);
    if (ac[lag] > best) { best = ac[lag]; bestLag = lag; }
  }
  for (let lag = minLag + 1; lag < maxLag; lag++) if (ac[lag] > best * 0.9 && ac[lag] >= ac[lag - 1] && ac[lag] >= ac[lag + 1]) { bestLag = lag; break; }
  const a1 = ac[bestLag - 1], a2 = ac[bestLag], a3 = ac[bestLag + 1], d = (a1 - a3) / (2 * (a1 - 2 * a2 + a3));
  const f = rate / (bestLag + (Number.isFinite(d) ? d : 0));
  return 69 + 12 * Math.log2(f / 440);
}

async function render(id, notes) {
  const p = newProject();
  p.bpm = 120;
  const ch = newChannel(id, id, 0, { vol: 1, send: 0, pan: 0 });
  p.channels = [ch]; p.selected = ch.id;
  const pat = newPattern(0, 1); pat.notes = { [ch.id]: [] };
  for (const [t, d, n, v] of notes) pat.notes[ch.id].push({ t: sec(t), d: sec(d), n, v: v ?? 100 });
  p.patterns = [pat]; p.current = pat.id; p.playlist.clips = []; p.master.fx = [];
  return io.renderMix(p, { tail: 1, noMaster: true });
}

const out = {};
for (const m of want) {
  const r = { kind: null };
  try {
    const progress = [];
    const off = window.melofi.onInstrumentProgress?.((p) => { if (p.id === m.id) progress.push(p.total ? p.done / p.total : 0); });
    const t0 = performance.now();
    const res = await window.melofi.downloadInstrument(m.id);
    r.download = res.ok ? 'ok' : `FAIL ${res.error || ''}`;
    r.seconds = Math.round((performance.now() - t0) / 100) / 10;
    r.progressEvents = progress.length;
    r.lastProgress = progress.length ? Math.round(progress[progress.length - 1] * 100) : null;
    r.sizeMB = Math.round(m.size / 1e5) / 10;
    const after = (await window.melofi.listInstruments()).find((x) => x.id === m.id);
    r.installed = after?.installed;
    if (!res.ok) { out[m.id] = r; continue; }
    // a phrase that suits it
    const kit = m.family === 'drums';
    const phrase = await render(m.id, kit ? [0, 0.5, 1, 1.5].flatMap((t, i) => [[t, 0.1, i % 2 ? 38 : 36], [t, 0.1, 42], [t + 0.25, 0.1, 42, 70]]).concat([[2, 0.5, 49]])
      : [[0, 0.45, 60], [0.5, 0.45, 64], [1, 0.45, 67], [1.5, 0.9, 72], [2.5, 1, 48], [2.5, 1, 55], [2.5, 1, 64]]);
    const lv = dsp.measure(phrase.left, phrase.right, phrase.rate);
    r.lufs = Math.round(lv.I * 10) / 10;
    r.peak = Math.round(lv.sp * 10) / 10;
    r.silent = !(lv.I > -60);
    // held note: pitch of A3 and A4 between 0.3 s and 1.2 s
    r.pitch = {};
    for (const n of kit ? [] : [57, 69]) {
      const h = await render(m.id, [[0, 1.5, n, 100]]);
      const s = Math.round(0.05 * h.rate + 0.3 * h.rate), mono = new Float32Array(Math.round(0.9 * h.rate));
      for (let i = 0; i < mono.length; i++) mono[i] = h.left[s + i] + h.right[s + i];
      r.pitch[n] = Math.round((pitchOf(mono, h.rate) - n) * 100) / 100;
    }
    if (typeof off === "function") off();
  } catch (e) { r.error = String(e?.stack || e).split('\n').slice(0, 2).join(' '); }
  out[m.id] = r;
}
console.log('ARCHIVE_E2E ' + JSON.stringify(out));
return [10];
