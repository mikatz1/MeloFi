// Calibration through the separation (docs/timbre-matching.md, part B): songs arranged from known
// MeloFi instruments are rendered, separated by the engine like any song, and the matching runs on
// the stems with the engine's own transcription. Which instrument is really in a stem section is
// read from the isolated renders (the one most correlated with the stem there).
//   1) args { separate: true }: render the mixes, separate them, print CALSEP {mix, dir}
//   2) args { dirs: {mix: dir} }: match, print CALRES {json} per group
// Run headless with a scratch userData whose stems-engine is a junction to the real engine.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const A = window.__melofi; for (let i = 0; i < 150 && !A?.engine?.inst; i++) await sleep(100);
const imp = (p) => import(new URL(p, location.href).href);
const M = await imp('studio/ui/midiconvert.js');
const { newProject, newPattern, PPQ } = await imp('studio/model.js');
const io = await imp('studio/io.js');
const { encodeWav } = await imp('js/recorder.js');
const S = { app: A, isKit: (id) => A.instruments.find((i) => i.id === id)?.family === 'drums', instName: (id) => A.instruments.find((i) => i.id === id)?.name || id };
const args = window.__args || {};

// the mixes: role -> instrument
const MIXES = {
  pop: { drums: 'acousticdrums', bass: 'fingerbass', keys: 'splendid', lead: 'violin', pad: 'strings' },
  edm: { drums: 'drums808', bass: 'synth:신스 베이스', keys: 'rhodes', lead: 'synth:슈퍼쏘 리드', pad: 'synth:따뜻한 패드' },
  acoustic: { drums: 'drums909', bass: 'upright', keys: 'acoustic', lead: 'flute', pad: 'organ' },
  band: { drums: 'acousticdrums', bass: 'ebass', keys: 'marimba', lead: 'trumpet', pad: 'cleanguitar' },
  city: { drums: 'drums909', bass: 'synth:시티팝 베이스', keys: 'wurlitzer', lead: 'altosax', pad: 'synth:스트링 패드' },
};
const BPM = 120, BAR = 2, BARS = 32;
// a progression and parts written out in seconds: [t, d, n, v]
const PROG = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]; // Am F C G
function parts(seedN) {
  let seed = seedN; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const P = { drums: [], bass: [], keys: [], lead: [], pad: [] };
  for (let b = 0; b < BARS; b++) {
    const t0 = b * BAR, ch = PROG[b % 4], root = ch[0] - 24;
    for (let q = 0; q < 8; q++) P.drums.push([t0 + q * 0.25, 0.1, 42, 70]);
    P.drums.push([t0, 0.1, 36, 110], [t0 + 1, 0.1, 36, 100], [t0 + 0.5, 0.1, 38, 100], [t0 + 1.5, 0.1, 38, 105]);
    // bass: eighths with an octave jump
    for (let q = 0; q < 8; q++) P.bass.push([t0 + q * 0.25, 0.22, root + (q === 3 || q === 7 ? 12 : 0), 90 + Math.round(rnd() * 20)]);
    // keys: chord stabs on 1 and the and of 2, an arpeggio every other bar
    if (b % 2) { [0, 0.75].forEach((o) => ch.forEach((n) => P.keys.push([t0 + o, 0.6, n + 12, 85]))); }
    else ch.concat(ch.map((n) => n + 12)).forEach((n, i) => P.keys.push([t0 + i * 0.25, 0.3, n + 12, 80]));
    // pad: whole-bar chords in the second half
    if (b >= 16) ch.forEach((n) => P.pad.push([t0, BAR - 0.05, n, 75]));
    // lead: a melody in bars 8..31
    if (b >= 8) {
      let t = t0;
      while (t < t0 + BAR - 0.1) {
        const d = [0.25, 0.5, 0.5, 0.75, 1][Math.floor(rnd() * 5)];
        const n = ch[Math.floor(rnd() * 3)] + 12 + [0, 2, 0, -1][Math.floor(rnd() * 4)];
        P.lead.push([t, Math.min(d, t0 + BAR - t) * 0.95, n, 95]);
        t += d;
      }
    }
  }
  return P;
}
function project(mix, P) {
  const p = newProject(); p.bpm = BPM; p.master.fx = [];
  const tick = (s) => (s * BPM * PPQ) / 60;
  const pat = newPattern(0, BARS); pat.notes = {};
  p.channels = [];
  for (const [role, id] of Object.entries(MIXES[mix])) {
    const ch = M.channelFor(S, id, role, p.channels.length, { vol: role === 'drums' ? 0.8 : role === 'pad' ? 0.55 : 0.7, send: 0.12, pan: { keys: -0.2, pad: 0.2 }[role] || 0 });
    p.channels.push(ch);
    pat.notes[ch.id] = P[role].map(([t, d, n, v]) => ({ t: tick(t), d: tick(d), n, v }));
  }
  p.patterns = [pat]; p.current = pat.id; p.playlist.clips = []; p.selected = p.channels[0].id;
  return p;
}

if (args.separate) {
  for (const [i, mix] of Object.keys(MIXES).entries()) {
    const P = parts(100 + i), p = project(mix, P);
    const mixed = await io.renderMix(p, { tail: 2, rate: 44100 });
    const wav = encodeWav(mixed);
    const r = await window.melofi.stemsRun({ data: wav, name: `calib-${mix}.wav`, quick: false, muscriptor: 'off' });
    if (!r.ok) { console.log('CALSEP ' + JSON.stringify({ mix, error: r.message })); continue; }
    const dir = Object.values(r.result.stems)[0].replace(/[\\/]stems[\\/][^\\/]+$/, '');
    const ins = await window.melofi.stemsInstruments(dir);
    console.log('CALSEP ' + JSON.stringify({ mix, dir, inst: ins.ok }));
  }
}

// diagnosis: for one mix and stem, the same notes measured on the isolated role (before the
// separation), on the stem, and on the candidate render: which step loses the likeness
// args { diag: { mix, stem, role, dir } }
if (args.diag) {
  const T = await imp('studio/timbre.js');
  const { mix, stem, role, dir } = args.diag, i = Object.keys(MIXES).indexOf(mix);
  const P = parts(100 + i), p = project(mix, P), ch = p.channels.find((c) => c.name === role);
  const m = await io.renderMix(p, { only: ch.id, tail: 2, rate: 44100 });
  const iso = { x: m.left.map((v, j) => 0.5 * (v + m.right[j])), rate: 44100 };
  const r = JSON.parse(new TextDecoder().decode(await window.melofi.stemsRead(`${dir}\\result.json`)));
  const st = await M.stemAudio(r.stems[stem]);
  M.fixStemOctaves(r, stem, st);
  const all = M.stemNotes(r, stem).filter(([t]) => t > 2);
  const probes = T.probeNotes(all, { max: 16 });
  const { clips, notes, length } = M.clipsFor(probes, all);
  const ren = await M.renderNotes(S, MIXES[mix][role], notes, length);
  const SF = T.measure(st.x, st.rate, probes), IF = T.measure(iso.x, iso.rate, probes);
  const CF = probes.map(([t, d, n]) => { const c = clips.find((k) => t >= k.a && t < k.b); return T.noteFeatures(ren.x, ren.rate, t - c.a + c.at, d, n, { off: ren.off }); });
  const z = (A, B) => T.median(A.map((a, j) => T.noteDiff(a, B[j])?.z).filter((v) => v != null));
  const part = (A, B) => { const o = {}; for (const k of ['h', 'c', 'e', 'n']) o[k] = +T.median(A.map((a, j) => T.noteDiff(a, B[j])?.part[k]).filter((v) => v != null)).toFixed(2); return o; };
  // the transcription against the truth: pitch of each probe vs the isolated role's notes
  const truthNotes = P[role];
  const pitchOk = probes.filter(([t, , n]) => truthNotes.some(([tt, , nn]) => Math.abs(tt + 0.05 - t) < 0.06 && nn === n)).length;
  // our render of the true notes against the engine's isolated render: should be the same sound
  const tr = await M.renderNotes(S, MIXES[mix][role], P[role], BARS * BAR + 1);
  let sxy = 0, sxx = 0, syy = 0;
  for (let j = 0; j < Math.min(tr.x.length, iso.x.length); j++) { sxy += tr.x[j] * iso.x[j]; sxx += tr.x[j] ** 2; syy += iso.x[j] ** 2; }
  const TF = probes.map(([t, d, n]) => T.noteFeatures(tr.x, tr.rate, t - 0.05, d, n, { off: tr.off }));
  // and the transcribed notes with the true velocities (nearest true note)
  const velz = {};
  for (const k of [1, 1.4, 1.8, 2.2]) {
    const rv = await M.renderNotes(S, MIXES[mix][role], notes.map(([t, d, n, v]) => [t, d, n, Math.min(127, Math.round(v * k))]), length);
    const VF = probes.map(([t, d, n]) => { const c = clips.find((q) => t >= q.a && t < q.b); return T.noteFeatures(rv.x, rv.rate, t - c.a + c.at, d, n, { off: rv.off }); });
    velz[k] = { vsIso: +z(VF, IF).toFixed(2), vsStem: +z(VF, SF).toFixed(2) };
  }
  console.log('CALDIAG2 ' + JSON.stringify({ corrTrueRender: +(sxy / Math.sqrt(sxx * syy)).toFixed(4), trueRender_vs_iso: z(TF, IF), vel: { transcribed: T.median(all.map((x) => x[3])), truth: T.median(truthNotes.map((x) => x[3])) }, dur: { transcribed: T.median(all.map((x) => x[1])), truth: T.median(truthNotes.map((x) => x[1])) }, velz }));
  probes.forEach(([t, d, n, v], j) => {
    const tn = truthNotes.reduce((b, x) => (Math.abs(x[0] + 0.05 - t) < Math.abs(b[0] + 0.05 - t) ? x : b));
    const f = (h) => (h ? h.slice(0, 5).map((q) => (q == null ? 'x' : Math.round(q))).join(',') : '-');
    console.log(`CALDIAG3 t=${t.toFixed(2)} d=${d.toFixed(2)} n=${n} v=${v} | truth t=${(tn[0] + 0.05).toFixed(2)} d=${tn[1]} n=${tn[2]} v=${tn[3]} | iso[${f(IF[j]?.harm)}] cand[${f(CF[j]?.harm)}] z=${T.noteDiff(CF[j], IF[j])?.z.toFixed(2)}`);
  });
  console.log('CALDIAG ' + JSON.stringify({ mix, stem, role, probes: probes.length, pitchOk, stem_vs_iso: z(SF, IF), cand_vs_iso: z(CF, IF), cand_vs_stem: z(CF, SF), parts_stem_iso: part(SF, IF), parts_cand_iso: part(CF, IF), parts_cand_stem: part(CF, SF) }));
}

if (args.dirs) {
  const readJson = async (f) => { const b = await window.melofi.stemsRead(f); return b ? JSON.parse(new TextDecoder().decode(b)) : null; };
  for (const [i, mix] of Object.keys(MIXES).entries()) {
    const dir = args.dirs[mix];
    if (!dir) continue;
    const P = parts(100 + i), p = project(mix, P);
    // the isolated roles, as heard in the mix (offset 0.05 s like the mix render)
    const iso = {};
    for (const ch of p.channels) { const m = await io.renderMix(p, { only: ch.id, tail: 2, rate: 44100 }); iso[ch.name] = m.left.map((v, j) => 0.5 * (v + m.right[j])); }
    const r = await readJson(`${dir}\\result.json`), inst = await readJson(`${dir}\\instruments.json`);
    const plan = M.sections(r, inst);
    await M.matchAll(S, r, plan, { also: Object.values(MIXES[mix]), mix: args.mix !== false });
    for (const [k, groups] of Object.entries(plan.stems)) {
      const st = await M.stemAudio(r.stems[k]);
      for (const g of groups) {
        const a = Math.round(plan.bars[g.secs[0].start] * 44100), b = Math.round(Math.min(r.duration, plan.bars[g.secs.at(-1).end] ?? r.duration) * 44100);
        // the role most correlated with the stem here, and how much of the stem it explains
        const corr = {};
        for (const [role, x] of Object.entries(iso)) {
          let sxy = 0, sxx = 0, syy = 0;
          for (let j = a; j < Math.min(b, x.length, st.x.length); j += 2) { sxy += x[j] * st.x[j]; sxx += x[j] * x[j]; syy += st.x[j] * st.x[j]; }
          corr[role] = sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
        }
        const [role, cr] = Object.entries(corr).sort((x, y) => y[1] - x[1])[0];
        const truth = MIXES[mix][role], c = g.match?.cands || [], me = c.find((x) => x.id === truth);
        console.log('CALRES ' + JSON.stringify({ mix, stem: k, bars: M.rangeText(g.secs), stray: g.stray, role, truth, corr: +cr.toFixed(2), best: c[0] ? `${c[0].id} ${c[0].acc}` : null, truthAcc: me?.acc ?? null, truthRank: c.findIndex((x) => x.id === truth) + 1, top: c.slice(0, 4).map((x) => `${x.id} ${x.acc}`), raw: me?.raw }));
      }
    }
  }
}
console.log('CALDONE');
return [10];
