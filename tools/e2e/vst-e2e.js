// VST3 plugins through MeloFi's mixer, headless. Run with: node tools/e2e/vst-run.mjs
// Uses the MeloFi Test Synth (sine voices, "Gain") and Test Effect (sound x 2 x "Gain") VST3s.
// Checks: a VST channel is heard through its strip (the fader changes it), an insert VST effect
// processes the sound (its parameter changes it), notes land on their exact sample through the
// effect (delay compensation), an automation point lands on its exact sample, an export matches
// what played live, plugin settings are saved, and MeloFi carries on when the helper is killed.
// Reports the stream latency, round trip and under-runs.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const A = window.__melofi;
for (let i = 0; i < 150 && !A?.engine?.inst; i++) await sleep(100);
const R = [];
const ok = (name, pass, note = '') => { R.push(`${pass ? 'PASS' : 'FAIL'} ${name}${note ? ` (${note})` : ''}`); };
const imp = (p) => import(new URL(p, location.href).href);
let errs = [];
window.addEventListener('error', (e) => errs.push(e.message));
window.addEventListener('unhandledrejection', (e) => errs.push(String(e.reason?.message || e.reason)));
window.confirm = () => true; window.alert = () => {};
const origErr = console.error; console.error = (...a) => { errs.push('console.error ' + a.map((x) => (x?.stack || x?.message || String(x))).join(' ').slice(0, 300)); origErr(...a); };

try {
  const cfg = await (await fetch('melofi://app/user/vst-e2e.json')).json();
  const model = await imp('studio/model.js');
  const io = await imp('studio/io.js');
  const { streamStats } = await imp('studio/vststream.js');
  A.settings.set({ studioTourSeen: true });
  const S = A.studio;
  await S.open();
  await sleep(300);
  const E = () => S.engine;
  const ctx = E().ctx, sr = ctx.sampleRate;

  // ---- capture: the studio's output (after the master), with frame numbers ----
  await ctx.audioWorklet.addModule('melofi://app/user/vst-cap.js');
  const cap = new AudioWorkletNode(ctx, 'e2e-cap', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 2, channelCountMode: 'explicit' });
  E().limiter.connect(cap);
  async function capture(from, to) {
    const L = new Float32Array(to - from), Rr = new Float32Array(to - from);
    let got = 0;
    const done = new Promise((resolve) => {
      cap.port.onmessage = (e) => {
        const { f, L: l, R: r } = e.data;
        for (let k = 0; k < 128; k++) { const i = f + k - from; if (i >= 0 && i < L.length) { L[i] = l[k]; Rr[i] = r[k]; got++; } }
        if (f + 128 >= to) resolve();
      };
    });
    cap.port.postMessage({ from, to });
    await Promise.race([done, sleep(((to - ctx.currentTime * sr) / sr) * 1000 + 2000)]);
    cap.port.postMessage({ from: 0, to: 0 });
    return { L, R: Rr, got };
  }
  const rms = (a, i = 0, j = a.length) => { let s = 0; for (let k = i; k < j; k++) s += a[k] * a[k]; return Math.sqrt(s / Math.max(1, j - i)); };
  const q = (x) => Math.ceil(x / 128) * 128;
  const nowF = () => Math.round(ctx.currentTime * sr);

  // ---- project: one VST channel (the test synth), straight to the master ----
  const p = model.newProject();
  p.bpm = 120;
  const ch0 = model.newChannel('splendid', 'Test Synth', 0, { kind: 'vst', vol: 1, send: 0, vst: { plugin: cfg.synth, file: cfg.synth, name: 'MeloFi Test Synth', vendor: 'MeloFi' } });
  p.channels = [ch0]; p.selected = ch0.id; p.master.vol = 1;
  p.patterns[0].notes = {};
  S.setProject(p);
  const ch = S.proj.channels[0];
  await S.syncAudio();
  await sleep(400);

  // a sustained note at frame F, captured from F to F + len
  async function noteAt(F, len, n = 69, from = F) {
    E().note(ch.id, n, 127, F / sr, len / sr - 0.05);
    return capture(from, from + len);
  }
  const status = await window.melofi.vstStatus();
  ok('helper streaming', status.running && status.stream, `device ${JSON.stringify(status.device)}`);

  // 1. heard through the mixer: the fader changes it
  let F = q(nowF() + sr * 0.3);
  const a1 = await noteAt(F, sr * 0.6);
  const lvl1 = rms(a1.L, sr * 0.2, sr * 0.5);
  await sleep(300);
  ch.vol = 0.5; S.applyStrips(); await sleep(100);
  F = q(nowF() + sr * 0.3);
  const a2 = await noteAt(F, sr * 0.6);
  const lvl2 = rms(a2.L, sr * 0.2, sr * 0.5);
  ok('VST channel heard through the mixer', lvl1 > 0.01, `rms ${lvl1.toFixed(4)}`);
  ok('fader changes the VST sound', Math.abs(lvl2 / lvl1 - 0.25) < 0.02, `fader 1 -> 0.5: ${(lvl2 / lvl1).toFixed(4)} (want 0.25)`);
  ch.vol = 1; S.applyStrips();

  // 2. a VST effect in an insert slot processes the sound
  const fx = { id: model.uid('f'), type: 'vst', on: true, params: {}, vst: { plugin: cfg.effect, file: cfg.effect, name: 'MeloFi Test Effect', vendor: 'MeloFi' } };
  ch.fx = [fx];
  await S.syncAudio();
  await sleep(500);
  const fxSlot = `fx:${ch.id}:${fx.id}`;
  const params = await S.vstParamList(fxSlot, true);
  const gi = params?.find((x) => x.name === 'Gain')?.i;
  ok('effect parameters listed', gi != null, params ? params.map((x) => x.name).join(', ') : 'none');
  const target = `vst:${ch.id}:${fx.id}:${gi}`;
  // let both streams find their delay (it grows to the browser's burst size in the first second)
  for (let k = 0; k < 6; k++) E().note(ch.id, 60, 90, ctx.currentTime + 0.1 + k * 0.3, 0.25);
  await sleep(2200);
  F = q(nowF() + sr * 0.3);
  const a3 = await noteAt(F, sr * 0.6);
  const lvl3 = rms(a3.L, sr * 0.2, sr * 0.5);
  ok('VST effect passes sound at unity', Math.abs(lvl3 / lvl1 - 1) < 0.02, `${(lvl3 / lvl1).toFixed(4)} of the dry level`);
  S.setValue(target, 0.25);
  await sleep(200);
  F = q(nowF() + sr * 0.3);
  const a4 = await noteAt(F, sr * 0.6);
  const lvl4 = rms(a4.L, sr * 0.2, sr * 0.5);
  ok('VST effect parameter changes the output', Math.abs(lvl4 / lvl1 - 0.5) < 0.02, `gain 0.5 -> 0.25: ${(lvl4 / lvl1).toFixed(4)} (want 0.5)`);
  S.setValue(target, 0.5);
  await sleep(300);

  // 2b. MIDI learn: a controller moves the plugin's parameter
  {
    S.learn = target;
    S.cc(21, 0, 0);
    S.cc(21, 127, 0);
    await sleep(300);
    const fresh = await S.vstParamList(fxSlot, true);
    const v = fresh?.find((x) => x.i === gi)?.value;
    ok('MIDI learn moves a VST parameter', S.proj.midiMap.some((m) => m.target === target) && Math.abs(v - 1) < 1e-3, `CC 21 -> ${S.targetName(target)}; value now ${v}`);
    S.proj.midiMap = [];
    S.setValue(target, 0.5);
    await sleep(300);
  }

  // 3. timing: a note lands on its sample, through the effect's delay (compensated)
  const comp = E().stripComp(ch.id);
  F = q(nowF() + sr * 0.3);
  const a5 = await noteAt(F + 37, sr * 0.3, 69, F);
  const first = a5.L.findIndex((x) => Math.abs(x) > 1e-7);
  ok('scheduled note lands on its sample (through the effect)', first === 38, `first sound at +${first} (note at +37, sine starts at 0 so +38), compensation ${(comp * 1000).toFixed(2)} ms`);

  // 4. automation: a step lands on its sample (compare with the same note without it)
  await sleep(300);
  F = q(nowF() + sr * 0.3);
  const ref = await noteAt(F, sr * 0.5);
  await sleep(300);
  F = q(nowF() + sr * 0.3);
  const G = Math.round(sr * 0.25) + 13;
  E().target(S.proj, target).set(0.25, (F + G) / sr, false);
  const aut = await noteAt(F, sr * 0.5);
  let step = -1;
  for (let k = Math.round(sr * 0.05); k < aut.L.length; k++) if (Math.abs(ref.L[k]) > 0.02 && Math.abs(aut.L[k] / ref.L[k]) < 0.75) { step = k; break; }
  const ratioAfter = rms(aut.L, G, G + 4800) / rms(ref.L, G, G + 4800);
  ok('automation point lands on its sample', step >= G && step < G + 4, `step at +${step}, point at +${G}; after it ${ratioAfter.toFixed(3)} (want 0.5)`);
  E().target(S.proj, target).set(0.5, -1);
  await sleep(300);

  // 5. live keyboard: time from the key to the first sound in the graph, against one of MeloFi's own
  // synths on the same engine (both go through the master; the difference is what VST adds)
  const { SynthChannel } = await imp('studio/synth.js');
  const keyLat = async (src) => {
      const lat = [];
      for (let k = 0; k < 5; k++) {
        await sleep(250);
        const at = nowF();
        const capP = capture(at, at + sr * 0.2);
        src.liveOn(72, 120);
        const c = await capP;
        src.liveOff(72);
        const fi = c.L.findIndex((x) => Math.abs(x) > 1e-5);
        if (fi >= 0) lat.push((fi / sr) * 1000);
      }
      lat.sort((x, y) => x - y);
      return lat;
    };
  const med = (l) => l[Math.floor(l.length / 2)];
  {
    const native = new SynthChannel(ctx, E().masterStrip.input);
    native.setParams({});
    const v = await keyLat(E().channels.get(ch.id));
    const m = await keyLat(native);
    native.dispose?.();
    const sNow = streamStats.get(ch.id), fNow = streamStats.get(fxSlot), msf = (x) => ((x / sr) * 1000).toFixed(1);
    ok('live key reaches the mixer', v.length >= 3 && m.length >= 3, `key to sound: VST ${v.map((x) => x.toFixed(1)).join(', ')} ms, MeloFi synth ${m.map((x) => x.toFixed(1)).join(', ')} ms; VST adds ${(med(v) - med(m)).toFixed(1)} ms here (instrument ${msf(sNow?.delay || 0)} ms ahead + messages; its insert effect runs with it in the helper: ${fNow ? `${msf(fNow.delay)} ms more` : 'nothing more'})`);
  }

  // 6. a few seconds of steady play: under-runs and the round trip
  {
    const u0 = streamStats.get(ch.id)?.under || 0;
    for (let k = 0; k < 10; k++) E().note(ch.id, 60 + (k % 5) * 2, 100, ctx.currentTime + 0.1 + k * 0.4, 0.35);
    await sleep(4500);
    const g = streamStats.get(ch.id);
    const ms = (x) => ((x / sr) * 1000).toFixed(2);
    ok('stream: instrument', g && g.under - u0 === 0, g ? `renders ${ms(g.delay)} ms ahead (browser burst ${ms(g.burst)} ms), round trip avg ${ms(g.rttAvg)} / max ${ms(g.rttMax)} ms, under-runs ${g.under - u0} in 4.5 s (${g.under} since the start, while it settled)` : 'no stats');
    const u = E().vstUnits().find((x) => x.slot === fxSlot);
    ok('insert effect after the instrument runs in the helper with it', u?.chained && !streamStats.has(fxSlot) && E().stripComp(ch.id) === 0, `chained ${!!u?.chained}, compensation ${E().stripComp(ch.id)} s`);
  }

  // 6b. a VST effect on the master: streamed on its own (input -> helper -> output)
  const mfx = { id: model.uid('f'), type: 'vst', on: true, params: {}, vst: { plugin: cfg.effect, file: cfg.effect, name: 'MeloFi Test Effect', vendor: 'MeloFi' } };
  S.proj.master.fx = [mfx];
  await S.syncAudio();
  const mSlot = `fx:master:${mfx.id}`, mTarget = `vst:master:${mfx.id}:${gi}`;
  for (let k = 0; k < 6; k++) E().note(ch.id, 60, 90, ctx.currentTime + 0.1 + k * 0.3, 0.25);
  await sleep(2200);
  {
    F = q(nowF() + sr * 0.3);
    const b1 = rms((await noteAt(F, sr * 0.6)).L, sr * 0.2, sr * 0.5);
    S.setValue(mTarget, 0.25);
    await sleep(200);
    F = q(nowF() + sr * 0.3);
    const b2 = rms((await noteAt(F, sr * 0.6)).L, sr * 0.2, sr * 0.5);
    S.setValue(mTarget, 0.5);
    ok('master VST effect processes the mix', Math.abs(b1 / lvl1 - 1) < 0.02 && Math.abs(b2 / b1 - 0.5) < 0.02, `unity ${(b1 / lvl1).toFixed(4)}, gain 0.25: ${(b2 / b1).toFixed(4)} (want 0.5)`);
    await sleep(300);
    F = q(nowF() + sr * 0.3);
    const a6 = await noteAt(F + 37, sr * 0.3, 69, F);
    const first = a6.L.findIndex((x) => Math.abs(x) > 1e-7);
    ok('note lands on its sample through the master effect', first === 38, `first sound at +${first} (want +38), compensation ${(E().stripComp(ch.id) * 1000).toFixed(2)} ms`);
    const f0 = streamStats.get(mSlot)?.under || 0;
    for (let k = 0; k < 10; k++) E().note(ch.id, 60 + (k % 5) * 2, 100, ctx.currentTime + 0.1 + k * 0.4, 0.35);
    await sleep(4500);
    const f = streamStats.get(mSlot), ms = (x) => ((x / sr) * 1000).toFixed(2);
    ok('stream: master effect (one late block allowed while it adapts)', f && f.under - f0 <= 1, f ? `delay ${ms(f.delay)} ms, round trip avg ${ms(f.rttAvg)} / max ${ms(f.rttMax)} ms, under-runs ${f.under - f0} in 4.5 s (${f.under} since the start), late ${f.late}` : 'no stats');
    await sleep(22000);
    const g2 = streamStats.get(ch.id), f2 = streamStats.get(mSlot);
    ok('stream: settled delay', g2 && f2, g2 && f2 ? `instrument ${ms(g2.delay)} ms ahead, master effect ${ms(f2.delay)} ms (floor: browser burst ${ms(g2.burst)} ms + 2.67 ms)` : 'no stats');
  }

  // 6c. a send into a bus with a VST effect: the direct sound waits for it (delay compensation on
  // every way out), so both arrive together and add up (2x, not a comb filter)
  {
    const bus = model.newBus(0, 'VST bus');
    bus.vol = 1;
    bus.fx = [{ id: model.uid('f'), type: 'vst', on: true, params: {}, vst: { plugin: cfg.effect, file: cfg.effect, name: 'MeloFi Test Effect', vendor: 'MeloFi' } }];
    S.proj.buses = [bus];
    await S.syncAudio();
    for (let k = 0; k < 6; k++) E().note(ch.id, 60, 90, ctx.currentTime + 0.1 + k * 0.3, 0.25);
    await sleep(2200);
    F = q(nowF() + sr * 0.3);
    const dry = rms((await noteAt(F, sr * 0.6)).L, sr * 0.2, sr * 0.5);
    ch.sends = [{ to: bus.id, level: 1 }];
    S.applyStrips?.(); await S.syncAudio();
    await sleep(600);
    F = q(nowF() + sr * 0.3);
    const both = rms((await noteAt(F, sr * 0.6)).L, sr * 0.2, sr * 0.5);
    await sleep(300);
    F = q(nowF() + sr * 0.3);
    const a7 = await noteAt(F + 37, sr * 0.3, 69, F);
    const first = a7.L.findIndex((x) => Math.abs(x) > 1e-7);
    const busD = streamStats.get(`fx:${bus.id}:${bus.fx[0].id}`)?.delay || 0;
    ok('send into a VST bus arrives with the direct sound', Math.abs(both / dry - 2) < 0.02 && first === 38, `direct + send ${(both / dry).toFixed(4)} x the direct sound (want 2), first sound at +${first} (want +38), bus effect ${((busD / sr) * 1000).toFixed(2)} ms, channel compensation ${(E().stripComp(ch.id) * 1000).toFixed(2)} ms`);
  }

  // 6d. live key once the streams have settled (the bus and master effects are on this channel's
  // way out now: compensation makes a live key wait for them too)
  {
    for (let i = 0; i < 40; i++) { const g = streamStats.get(ch.id); if (g && g.delay <= (g.burst || 512) + 256) break; await sleep(1000); }
    const native = new SynthChannel(ctx, E().masterStrip.input);
    native.setParams({});
    const v = await keyLat(E().channels.get(ch.id));
    const m = await keyLat(native);
    native.dispose?.();
    const g = streamStats.get(ch.id), msf = (x) => ((x / sr) * 1000).toFixed(1);
    ok('live key after settling', v.length >= 3, `VST adds ${(med(v) - med(m)).toFixed(1)} ms (instrument ${msf(g?.delay || 0)} ms ahead, browser burst ${msf(g?.burst || 0)} ms) plus ${(E().stripComp(ch.id) * 1000).toFixed(1)} ms compensation for the bus and master VST effects on its way out`);
  }

  // 7. export matches live: a song with a note and an automation clip on the effect
  {
    const PPQ = model.PPQ, bt = model.barTicks(S.proj);
    const pat = S.proj.patterns[0];
    pat.bars = 1;
    pat.notes[ch.id] = [{ t: 0, d: PPQ * 3, n: 64, v: 110 }, { t: PPQ * 2, d: PPQ, n: 71, v: 90 }];
    const auto = { id: model.uid('a'), name: 'gain', color: '#888', target, len: 1, points: [{ t: 0, v: 0.5 }, { t: 0.375, v: 0.5 }, { t: 0.625, v: 0.2 }, { t: 0.7, v: 0.2 }, { t: 0.7, v: 0.45 }] };
    S.proj.autos = [auto];
    S.proj.playlist.clips = [{ id: model.uid('k'), pattern: pat.id, track: 0, start: 0, len: 1 }, { id: model.uid('k'), kind: 'auto', auto: auto.id, track: 1, start: 0, len: 1 }];
    S.proj.mode = 'song';
    S.transport.refresh?.();
    await sleep(500);
    const secs = (bt / PPQ) * (60 / S.proj.bpm);
    const off = await io.renderMix(S.proj, { offset: 0, tail: 0.2 });
    // live
    S.transport.stop?.();
    S.transport.pos = 0;
    await S.transport.play();
    const F0 = Math.round(S.transport.startCtx * sr);
    const live = await capture(F0, F0 + Math.round(secs * sr));
    S.transport.stop?.();
    const n = Math.min(live.L.length, off.left.length) - 8;
    let best = { err: Infinity, s: 0 };
    for (let s = -4; s <= 4; s++) {
      let e = 0, sig = 0;
      for (let k = 8; k < n; k++) { const d = live.L[k] - off.left[k + s]; e += d * d; sig += live.L[k] * live.L[k]; }
      if (e < best.err) best = { err: e, s, sig };
    }
    const snr = 10 * Math.log10(best.sig / Math.max(1e-20, best.err));
    let maxd = 0;
    for (let k = 8; k < n; k++) maxd = Math.max(maxd, Math.abs(live.L[k] - off.left[k + best.s]));
    const win = (a, i) => rms(a, i * 2400, i * 2400 + 2400).toFixed(3);
    console.log('[vst-e2e] windows live/export: ' + Array.from({ length: Math.floor(n / 2400) }, (_, i) => `${win(live.L, i)}/${win(off.left, i)}`).join(' '));
    ok('export matches live (notes + chained and master effects + automation)', snr > 60 && Math.abs(best.s) <= 1, `offset ${best.s} samples, match ${snr.toFixed(1)} dB, largest difference ${maxd.toExponential(2)}, live rms ${rms(live.L).toFixed(4)}, export rms ${rms(off.left, 0, n).toFixed(4)}, warnings ${off.warnings.length}`);
  }

  // 8. plugin settings go into the project
  {
    await S.captureVstStates();
    ok('plugin settings saved', !!ch.vst.state && !!fx.vst.state, `instrument ${ch.vst.state?.length || 0} chars, effect ${fx.vst.state?.length || 0} chars`);
  }

  // 9. the helper dies: MeloFi carries on, the helper comes back with the plugins
  {
    const killed = await window.melofi.vstKill();
    await sleep(200);
    const during = await window.melofi.vstStatus();
    let back = null;
    for (let i = 0; i < 60; i++) { await sleep(200); const st = await window.melofi.vstStatus(); if (st.running && st.stream) { back = st; break; } }
    await sleep(600);
    F = q(nowF() + sr * 0.3);
    const a9 = await noteAt(F, sr * 0.6);
    const lvl9 = rms(a9.L, sr * 0.2, sr * 0.5);
    ok('helper killed: studio keeps running', killed && ctx.state === 'running' && !during.running, `context ${ctx.state}`);
    ok('helper restarted with its plugins', !!back && lvl9 > 0.005, `sound after restart rms ${lvl9.toFixed(4)} (gain 0.45 from the automation: ${(lvl9 / lvl1).toFixed(3)} of dry)`);
  }
  S.setProject(model.newProject());
  await sleep(300);
} catch (e) {
  R.push(`FAIL run :: ${String(e?.stack || e).split('\n').slice(0, 4).join(' | ')}`);
}
// (a fresh userData has no downloaded piano samples: the default project's sampler cannot decode them)
errs = errs.filter((x) => !/Unable to decode audio data/.test(x));
if (errs.length) R.push(`FAIL page errors :: ${[...new Set(errs)].slice(0, 5).join(' | ')}`);
console.log('VST-E2E-BEGIN\n' + R.join('\n') + '\nVST-E2E-END');
return [100];
