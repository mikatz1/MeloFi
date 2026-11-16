// 가상 마이크로 내보내기, end to end through a real VB-CABLE (needs it installed).
// Run with a scratch userData so the user's own settings never get the routing switched on:
//   MELOFI_USERDATA=<fresh dir> MELOFI_SHOT=<out dir> MELOFI_SCRIPT=tools/e2e/vmic-cable-e2e.js electron .
// MeloFi sends to "CABLE Input"; this page records "CABLE Output" (what Discord would hear) and
// times clicks and a piano note from when they are played to when they come back.
// Sound goes through the real cable: anything listening to CABLE Output hears a few clicks and one note.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const A = window.__melofi;
for (let i = 0; i < 150 && !A?.engine?.inst; i++) await sleep(100);
const R = [];
const ok = (name, pass, note = '') => { R.push({ name, pass: !!pass, note }); console.log(`[cable] ${pass ? 'PASS' : 'FAIL'} ${name}${note ? ' · ' + note : ''}`); };
const { listOutputs, pickSink } = await import(new URL('js/vmic.js', location.href).href);
const vm = A.vmic, c = A.engine.ctx;

const sink = pickSink({ sink: 'auto' }, await listOutputs());
ok('CABLE Input found', /cable input/i.test(sink?.label || ''), sink?.label || 'none');
const rec = (await navigator.mediaDevices.enumerateDevices()).find((d) => d.kind === 'audioinput' && /cable output/i.test(d.label));
ok('CABLE Output found', !!rec, rec?.label || 'none');
if (!sink || !rec) { console.log('[cable] stopped: no cable'); return [10]; }

A.settings.set({ vmic: { on: true, sink: 'auto', level: 1, mic: false, micDevice: '', micLevel: 1, gate: -55 } });
for (let i = 0; i < 80 && vm.status.state !== 'on'; i++) await sleep(50);
ok('sending to the cable', vm.status.state === 'on' && /cable input/i.test(vm.status.sink?.label || ''), vm.status.sink?.label);

// record CABLE Output in the app's own context, so play time and arrival share one clock
const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: rec.deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2, latency: 0 } });
await c.audioWorklet.addModule('melofi://app/renderer/js/vmic-probe-worklet.js');
const src = c.createMediaStreamSource(stream);
const probe = new AudioWorkletNode(c, 'melofi-vmic-probe');
src.connect(probe);
const track = stream.getAudioTracks()[0];
const inLat = track.getSettings?.().latency;

// clicks straight into the send (not on the speakers)
const clicks = [];
for (let i = 0; i < 8; i++) {
  const got = new Promise((res) => { probe.port.onmessage = (e) => res(e.data.time); setTimeout(() => res(null), 1500); });
  const k = c.createConstantSource(), g = c.createGain(); g.gain.value = 0.6;
  k.connect(g).connect(vm.tap);
  const at = c.currentTime + 0.05;
  k.start(at); k.stop(at + 0.004);
  const back = await got;
  k.disconnect(); g.disconnect();
  if (back != null) clicks.push((back - at) * 1000);
  await sleep(250);
}
clicks.sort((a, b) => a - b);
const med = clicks.length ? clicks[Math.floor(clicks.length / 2)] : null;
ok('clicks come back through CABLE Output', clicks.length >= 6, `${clicks.length}/8`);
ok('round trip (send + cable + recording)', med != null && med < 200, med != null ? `median ${med.toFixed(1)} ms · ${clicks.map((x) => x.toFixed(1)).join(', ')}` : '');

// a played piano note: does it arrive, and how loud
const an = c.createAnalyser(); an.fftSize = 2048; src.connect(an);
const buf = new Float32Array(an.fftSize);
let peak = 0;
A.engine.noteOn(72, 90);
for (let i = 0; i < 30; i++) { await sleep(25); an.getFloatTimeDomainData(buf); for (const v of buf) peak = Math.max(peak, Math.abs(v)); }
A.engine.noteOff(72);
ok('a piano note arrives at CABLE Output', peak > 0.01, `peak ${peak.toFixed(3)}`);

const capture = ((inLat || 0) * 1000);
const speakers = ((c.baseLatency || 0) + (c.outputLatency || 0)) * 1000;
console.log(`[cable] app context: base ${(c.baseLatency * 1000).toFixed(1)} ms, speakers out ${(c.outputLatency * 1000).toFixed(1)} ms · cable context: base ${(vm.out.baseLatency * 1000).toFixed(1)} ms, out ${(vm.out.outputLatency * 1000).toFixed(1)} ms · recording reports ${inLat != null ? capture.toFixed(1) + ' ms' : 'no latency'}`);
if (med != null) console.log(`[cable] key to CABLE Output (what Discord gets) about ${(med - capture + (c.baseLatency || 0) * 1000).toFixed(1)} ms; speakers alone ${speakers.toFixed(1)} ms`);
let m = null;
try { m = await vm.measure(); console.log(`[cable] up to the cable's input: ${m.bridgeMs.toFixed(1)} ms after the speakers, key to cable about ${m.totalMs.toFixed(1)} ms`); } catch (e) { console.log('[cable] measure failed', e.message); }
const loop = await vm.measureLoop().catch((e) => { console.log('[cable] measureLoop failed', e.message); return null; });
// (two measurements a moment apart differ by up to about 20 ms: how the cable's and the recording's buffers line up)
ok("settings' measurement goes through the cable", loop && Math.abs(loop.loopMs - (med - capture + (c.baseLatency || 0) * 1000)) < 30, loop ? `${loop.loopMs} ms (runs ${loop.runs.map((x) => x.toFixed(1)).join(', ')}) · status shows ${vm.status.latencyMs} ms` : 'none');

ok('hop between the contexts', vm.hop === 'port', vm.hop);

// the defaults (FIFO 384 frames, the cable context at its smallest buffer) and two alternatives:
// the loop latency, and dropouts while chords ring (10 s for the default)
const matrix = [];
for (const [target, hint, secs] of [[undefined, undefined, 10], [512, 0, 3], [384, 'interactive', 3]]) {
  vm.bridgeTarget = target; vm.latencyHint = hint;
  await vm.apply({ ...A.settings.v.vmic }, true);
  for (let i = 0; i < 60 && vm.status.state !== 'on'; i++) await sleep(50);
  await sleep(300);
  const before = await vm.bridgeStats();
  for (let s = 0; s < secs; s++) {
    const chord = s % 2 ? [57, 60, 64, 69] : [60, 64, 67, 72];
    for (const n of chord) A.engine.noteOn(n, 80);
    await sleep(1000);
    for (const n of chord) A.engine.noteOff(n);
  }
  const after = await vm.bridgeStats();
  const lp = await vm.measureLoop().catch(() => null);
  const row = { target, hint, loopMs: lp?.loopMs ?? null, cableBase: +(vm.out.baseLatency * 1000).toFixed(1), cableOut: +(vm.out.outputLatency * 1000).toFixed(1),
    under: after && before ? after.under - before.under : null, drops: after && before ? after.drops - before.drops : null, repeats: after && before ? after.repeats - before.repeats : null,
    jumps: after && before ? after.jumps - before.jumps : null, avg: after?.avg };
  matrix.push(row);
  // an underrun now fades out (no click); at most one short one in 10 s is allowed
  if (target === undefined) ok('default: at most one short gap in 10 s of chords', row.under <= 1 && row.jumps === 0, `gaps ${row.under}, drift fixes ${row.drops + row.repeats}`);
  console.log(`[cable] target ${target ?? 'default'} hint ${hint ?? 'default'}: loop ${row.loopMs} ms · cable ctx base ${row.cableBase} out ${row.cableOut} · fill avg ${row.avg} · underruns ${row.under}, drops ${row.drops}, repeats ${row.repeats}, jumps ${row.jumps}`);
}
vm.bridgeTarget = undefined; vm.latencyHint = undefined;

// leave nothing on
src.disconnect(); track.stop();
A.settings.set({ vmic: { on: false, sink: 'auto', level: 1, mic: false, micDevice: '', micLevel: 1, gate: -55 } });
for (let i = 0; i < 40 && vm.status.state !== 'off'; i++) await sleep(50);
ok('off again', vm.status.state === 'off' && !vm.out);
await sleep(500);
console.log(`[cable] ${R.filter((r) => r.pass).length}/${R.length} passed`);
return [10];
