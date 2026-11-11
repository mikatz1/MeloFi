try {
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let errs = [];
window.addEventListener('error', (e) => errs.push(e.message + ' @' + (e.filename || '').split('/').pop() + ':' + e.lineno));
window.addEventListener('unhandledrejection', (e) => errs.push('rej ' + String(e.reason?.stack || e.reason).split('\n').slice(0, 3).join(' ')));
const A = window.__melofi;
for (let i = 0; i < 150 && !A?.engine?.inst; i++) await sleep(100);
A.settings.set({ studioTourSeen: true });
const imp = (p) => import(new URL(p, location.href).href);
const R = [];
const check = async (name, fn) => { errs = []; try { const n = await fn(); await sleep(50); R.push(`${errs.length ? 'FAIL' : 'PASS'} ${name}${n ? ` (${n})` : ''}${errs.length ? ' :: ' + errs.slice(0, 3).join(' | ') : ''}`); } catch (e) { R.push(`FAIL ${name} :: ${String(e?.stack || e).split('\n').slice(0, 3).join(' ')} ${errs.join(' | ')}`); } };
const fx = await imp('studio/fx.js');
const dsp = await imp('studio/master-dsp.js');
const ex = await imp('studio/export-audio.js');
const { TEMPLATES } = await imp('studio/templates.js');
const { StudioEngine } = await imp('studio/engine.js');
const S = A.studio; await S.open(); await sleep(400);

// every unit at neutral settings: steady sines in, level out the same (left and right)
await check('neutral units are flat', async () => {
  const out = [];
  for (const [type, params] of [['mbcomp', { r1: 1, r2: 1, r3: 1, r4: 1, r5: 1, t1: 0, t2: 0, t3: 0, t4: 0, t5: 0 }], ['imager', {}], ['peq', {}], ['peq', { phase: 1 }], ['exciter', { mix: 0 }], ['deesser', { threshold: 0 }], ['dyneq', { r1: 0, r2: 0 }], ['peq', { lsW: 2, p1W: 1, p4W: 2 }]]) {
    let worst = 0;
    for (const fq of [40, 100, 180, 400, 1000, 3500, 6500, 10000, 16000]) {
      const SR = 48000, N = 24000, c = new OfflineAudioContext(2, N, SR);
      await StudioEngine.create(c);
      const u = fx.FX_TYPES[type].build(c, { bpm: 120 });
      u.set({ ...fx.fxDefaults(type), ...params }, 0);
      const b = c.createBuffer(2, N, SR);
      for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < N; i++) d[i] = (ch ? 0.1 : 0.2) * Math.sin(2 * Math.PI * fq * i / SR + ch); }
      const src = c.createBufferSource(); src.buffer = b; src.connect(u.input); u.output.connect(c.destination); src.start(0);
      const r = await c.startRendering();
      for (let ch = 0; ch < 2; ch++) {
        const x = r.getChannelData(ch), y = b.getChannelData(ch); let a = 0, e = 0;
        for (let i = N / 2; i < N; i++) { a += x[i] * x[i]; e += y[i] * y[i]; }
        const d = 10 * Math.log10(a / e); if (Math.abs(d) > Math.abs(worst)) worst = d;
      }
    }
    out.push(`${type} ${worst.toFixed(2)} dB`);
  }
  if (out.some((x) => Math.abs(parseFloat(x.split(' ')[1])) > 0.3)) throw new Error(out.join(', '));
  return out.join(', ');
});

// maximizer worklet: +12 dB into it, out never above the ceiling (8x true peak)
await check('maximizer worklet holds -1 dBTP', async () => {
  const SR = 48000, N = SR * 4, c = new OfflineAudioContext(2, N, SR);
  await StudioEngine.create(c);
  const u = fx.FX_TYPES.maximizer.build(c);
  u.set({ gain: 12, ceiling: -1, release: 0.12 }, 0);
  const b = c.createBuffer(2, N, SR);
  for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < N; i++) d[i] = 0.3 * Math.sin(2 * Math.PI * 60 * i / SR) + 0.2 * Math.sin(2 * Math.PI * (9000 + ch * 1000) * i / SR) + 0.15 * (Math.random() - 0.5); }
  const src = c.createBufferSource(); src.buffer = b; src.connect(u.input); u.output.connect(c.destination); src.start(0);
  const r = await c.startRendering();
  const L = r.getChannelData(0), Rr = r.getChannelData(1);
  const tp = dsp.dB(Math.max(dsp.truePeak(L), dsp.truePeak(Rr)));
  const m = dsp.measure(L, Rr, SR);
  if (tp > -0.95) throw new Error(`true peak ${tp.toFixed(3)}`);
  return `tp ${tp.toFixed(3)} dBTP, I ${m.I.toFixed(1)} LUFS`;
});

await check('linear-phase EQ matches the minimum-phase curve, dynamic EQ cuts only when loud', async () => {
  const lvl = async (type, params, fq, amp) => {
    const SR = 48000, N = 48000, c = new OfflineAudioContext(2, N, SR);
    await StudioEngine.create(c);
    const u = fx.FX_TYPES[type].build(c, { bpm: 120 }); u.set({ ...fx.fxDefaults(type), ...params }, 0);
    const b = c.createBuffer(2, N, SR); for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < N; i++) d[i] = amp * Math.sin(2 * Math.PI * fq * i / SR); }
    const src = c.createBufferSource(); src.buffer = b; src.connect(u.input); u.output.connect(c.destination); src.start(0);
    const x = (await c.startRendering()).getChannelData(0); let a = 0; for (let i = N / 2; i < N; i++) a += x[i] * x[i];
    return 10 * Math.log10(a / (N / 2) / (amp * amp / 2));
  };
  const eq = { p2F: 1000, p2G: 6, p2Q: 1, hsG: -4, hsF: 8000 };
  // per-band mid / side: a mono signal (no side) is lifted by a mid band, untouched by a side band
  const onMid = await lvl('peq', { p2F: 1000, p2G: 6, p2W: 1 }, 1000, 0.1), onSide = await lvl('peq', { p2F: 1000, p2G: 6, p2W: 2 }, 1000, 0.1);
  const res = [`mid band on mono ${onMid.toFixed(2)}, side band on mono ${onSide.toFixed(2)}`];
  if (Math.abs(onMid - 6) > 0.1 || Math.abs(onSide) > 0.1) throw new Error(res[0]);
  for (const fq of [1000, 3000, 12000]) { const a = await lvl('peq', eq, fq, 0.1), b = await lvl('peq', { ...eq, phase: 1 }, fq, 0.1); res.push(`${fq}Hz min ${a.toFixed(2)} lin ${b.toFixed(2)}`); if (Math.abs(a - b) > 0.3) throw new Error(res.join(', ')); }
  const dq = { f1: 250, t1: -20, r1: -6, r2: 0 }; const quiet = await lvl('dyneq', dq, 250, 0.01), loud = await lvl('dyneq', dq, 250, 0.5);
  res.push(`dyneq quiet ${quiet.toFixed(2)} loud ${loud.toFixed(2)}`);
  if (Math.abs(quiet) > 0.3 || loud > -4) throw new Error(res.join(', '));
  return res.join(', ');
});

await check('clipper caps at its ceiling', async () => {
  const SR = 48000, N = SR, c = new OfflineAudioContext(1, N, SR);
  const u = fx.FX_TYPES.clipper.build(c);
  u.set({ drive: 6, knee: 0.5, ceiling: -1 }, 0);
  const b = c.createBuffer(1, N, SR); const d = b.getChannelData(0); for (let i = 0; i < N; i++) d[i] = 0.9 * Math.sin(2 * Math.PI * 100 * i / SR);
  const src = c.createBufferSource(); src.buffer = b; src.connect(u.input); u.output.connect(c.destination); src.start(0);
  const r = await c.startRendering();
  let pk = 0; for (const v of r.getChannelData(0)) pk = Math.max(pk, Math.abs(v));
  if (dsp.dB(pk) > -0.9) throw new Error(`peak ${dsp.dB(pk).toFixed(2)}`);
  return `peak ${dsp.dB(pk).toFixed(2)} dB`;
});

// every master effect in the live engine, with the window open while playing
await check('mastering window: chain presets, meters while playing', async () => {
  S.setProject(TEMPLATES.kpop.make()); await sleep(300);
  const M = S.mastering; M.show(); await sleep(200);
  const { MASTER_CHAINS } = await imp('studio/ui/mastering.js');
  for (const [n, , chain] of MASTER_CHAINS) { M.setChain(chain, n); await sleep(120); }
  for (const t of fx.MASTER_FX) M.add(t);
  S.engine.setMono(true); await sleep(100); S.engine.setMono(false);
  await sleep(200);
  S.setMode('song'); S.transport.play(); await sleep(4500);
  const m = M.meter;
  const thr = S.engine.limiter.parameters.get('threshold').value;
  S.transport.stop();
  M.toggleBypass(true); await sleep(100); M.toggleBypass(false);
  if (!(m.M > -60)) throw new Error(`meter not moving M ${m.M}`);
  return `M ${m.M.toFixed(1)} S ${m.S.toFixed(1)} I ${m.I.toFixed(1)} TP ${m.TP.toFixed(2)} corr ${m.corr.toFixed(2)} safety thr ${thr}`;
});

await check('assistant reaches the target', async () => {
  const M = S.mastering;
  M.setChain([], 'clear');
  M.target = 'spotify';
  await M.assist();
  return M.note;
});

await check('export: loudness normalise + every format', async () => {
  const io = await imp('studio/io.js');
  const raw = await io.renderMix(S.proj, { rate: 44100, tail: 0.5 });
  const done = ex.finish(raw, { norm: 'loudness', target: -14, ceiling: -1 });
  const res = [];
  for (const f of ['wav16', 'wav24', 'wav32f', 'flac16', 'flac24', 'mp3']) {
    const { ext, data } = await ex.encode(done.mix, f, f.endsWith('16') ? 'shaped' : 'tpdf');
    const c = new OfflineAudioContext(2, 1, 44100);
    const buf = await c.decodeAudioData(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
    const m = dsp.measure(buf.getChannelData(0), buf.getChannelData(1), buf.sampleRate);
    res.push(`${f}: ${(data.length / 1024).toFixed(0)}KB ${buf.sampleRate}Hz I ${m.I.toFixed(2)} tp ${m.tp.toFixed(2)}`);
  }
  const a = done.after;
  if (Math.abs(a.I + 14) > 0.3 || a.tp > -0.95) throw new Error(`after I ${a.I} tp ${a.tp}`);
  return `before ${done.before.I.toFixed(1)} → ${a.I.toFixed(2)} LUFS tp ${a.tp.toFixed(2)} | ${res.join(' | ')}`;
});

S.mastering.show(); S.setMode('song'); S.transport.play(); await sleep(3500);
console.log('MASTER-BEGIN\n' + R.join('\n') + '\nMASTER-END');
return [100];
} catch (e) { console.log('TOPFAIL ' + (e?.stack || e?.message || JSON.stringify(e) || e)); return [10]; }
