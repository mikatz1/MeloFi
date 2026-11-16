// Discord로 연주 보내기 (renderer/js/vmic.js), headless.
// Run: MELOFI_USERDATA=<fresh dir> MELOFI_SHOT=<out dir> MELOFI_SCRIPT=tools/e2e/vmic-e2e.js electron .
// Checks: device picking, the copy reaching the cable context (Chromium's silent output stands in
// for a cable when this PC has none), the measured latency, the microphone path, settings saved
// to settings.json, turning it off, and the settings rows.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const A = window.__melofi;
for (let i = 0; i < 150 && !A?.engine?.inst; i++) await sleep(100);
const R = [];
const ok = (name, pass, note = '') => { R.push({ name, pass: !!pass, note }); console.log(`[vmic] ${pass ? 'PASS' : 'FAIL'} ${name}${note ? ' · ' + note : ''}`); };
const vmicMod = await import(new URL('js/vmic.js', location.href).href);
const { pickSink, isCable, listOutputs, TEST_SINK } = vmicMod;
const vm = A.vmic;
const h2 = (rows) => { const d = document.createElement('div'); d.append(...rows.filter(Boolean)); return d; };
const waitState = async (want, ms = 4000) => { for (let i = 0; i < ms / 50 && vm.status.state !== want; i++) await sleep(50); return vm.status.state; };

// 1. which outputs this PC has, and picking a cable
const outs = await listOutputs();
ok('outputs listed', Array.isArray(outs), outs.map((o) => o.label || o.id.slice(0, 8)).join(' | ') || '(none)');
// (sending always goes to Chromium's silent output, never to a real cable someone may be listening to)
const cable = pickSink({ sink: 'auto' }, outs);
ok('cable device on this PC', true, cable ? `auto would pick: ${cable.label}` : 'none');
const fake = [{ id: 'spk', label: 'Speakers (Realtek(R) Audio)' }, { id: '16', label: 'CABLE In 16ch (VB-Audio Virtual Cable)' }, { id: 'cab', label: 'CABLE Input (VB-Audio Virtual Cable)' }, { id: 'vm', label: 'VoiceMeeter Input (VB-Audio VoiceMeeter VAIO)' }];
ok('auto picks the plain CABLE Input', pickSink({ sink: 'auto' }, fake)?.id === 'cab');
ok('auto finds VoiceMeeter', pickSink({ sink: 'auto' }, fake.filter((d) => d.id !== 'cab' && d.id !== '16'))?.id === 'vm');
ok('auto never falls back to speakers', pickSink({ sink: 'auto' }, [fake[0]]) === null);
ok('chosen device kept', pickSink({ sink: 'spk' }, fake)?.id === 'spk');
ok('missing chosen device', pickSink({ sink: 'gone' }, fake) === null);

// 2. a chosen device that is gone: nothing sent (and the guide's text renders)
A.settings.set({ vmic: { ...A.settings.v.vmic, on: true, sink: 'no-such-device' } });
ok('missing device: nothing sent', (await waitState('missing')) === 'missing' && !vm.out);
{
  // the card when nothing was found: the install step with VB-Audio's credit
  const keep = vm.status;
  vm.status = { state: 'nodevice' };
  const box = h2(A.ui.vmicRows());
  vm.status = keep;
  ok('card: install step', /VB-CABLE 설치하기/.test(box.textContent) && /CABLE Output/.test(box.textContent) && box.querySelectorAll('.vm-step').length === 3);
  ok('card: VB-Audio credit', /donationware/.test(box.textContent) && /vb-cable\.com/.test(box.textContent));
  const miss = h2(A.ui.vmicRows());
  ok('card: missing device offers auto', /자동으로 찾기/.test(miss.textContent));
}
// VB-CABLE's settings read through the main process (vbcable.js); nothing is changed here
{
  const r = await window.melofi.vbcable('status');
  ok('VB-CABLE status', r?.ok && typeof r.data.installed === 'boolean', r?.ok ? `installed ${r.data.installed}, buffer ${r.data.latency}, ${r.data.sampleRate} Hz` : r?.message);
  A.ui.vbStatus = r?.data;
  const row = A.ui.vbcableRow();
  ok('cable buffer row', /VB-CABLE|버퍼|buffer/i.test(row.textContent), row.textContent.slice(0, 80));
}

// 3. sending: the copy reaches the cable context
A.settings.set({ vmic: { ...A.settings.v.vmic, on: true, sink: TEST_SINK, level: 1 } });
const s3 = await waitState('on');
ok('sending', s3 === 'on', vm.status.sink?.label);
ok('cable context running', vm.out?.state === 'running', `sample rate ${vm.out?.sampleRate} (app ${A.engine.ctx.sampleRate})`);
ok('speakers untouched', A.engine.out.numberOfOutputs === 1 && A.engine.ctx.state === 'running');
let lat = null;
try { lat = await vm.measure(); } catch (e) { ok('measure', false, e.message); }
if (lat) {
  ok('sound reaches the cable', lat.runs.length >= 3, `${lat.runs.length}/5 clicks`);
  ok('latency', lat.totalMs < 120, `cable ${lat.bridgeMs.toFixed(1)} ms after the speakers; key to cable about ${lat.totalMs.toFixed(1)} ms; runs ${lat.runs.map((x) => x.toFixed(1)).join(', ')}`);
}
console.log(`[vmic] contexts: app base ${(A.engine.ctx.baseLatency * 1000).toFixed(1)} out ${(A.engine.ctx.outputLatency * 1000).toFixed(1)} · cable base ${(vm.out.baseLatency * 1000).toFixed(1)} out ${(vm.out.outputLatency * 1000).toFixed(1)} ms`);

// 3b. 소리 확인: the chime reaches the cable context only
{
  const an = vm.out.createAnalyser(); an.fftSize = 2048;
  vm.mix.connect(an);
  const app = A.engine.ctx.createAnalyser(); app.fftSize = 2048;
  A.engine.out.connect(app);
  const buf = new Float32Array(2048);
  let peak = 0, appPeak = 0;
  vm.testSound();
  for (let i = 0; i < 30; i++) {
    await sleep(25);
    an.getFloatTimeDomainData(buf); for (const v of buf) peak = Math.max(peak, Math.abs(v));
    app.getFloatTimeDomainData(buf); for (const v of buf) appPeak = Math.max(appPeak, Math.abs(v));
  }
  vm.mix.disconnect(an); A.engine.out.disconnect(app);
  ok('test sound reaches the cable, not the speakers', peak > 0.05 && appPeak < 0.001, `cable ${peak.toFixed(3)} · speakers ${appPeak.toFixed(4)}`);
  const card = h2(A.ui.vmicRows());
  ok('card while sending', card.querySelectorAll('.vm-step.done').length === 2 && /소리 확인/.test(card.textContent) && /보내는 중/.test(card.textContent));
}

// 4. a played note goes out too (the engine's real output, not only the test click)
{
  const an = vm.out.createAnalyser(); an.fftSize = 2048;
  vm.fromApp.connect(an);
  const buf = new Float32Array(an.fftSize);
  let peak = 0;
  A.engine.noteOn(60, 120);
  for (let i = 0; i < 40; i++) { await sleep(25); an.getFloatTimeDomainData(buf); for (const v of buf) peak = Math.max(peak, Math.abs(v)); }
  A.engine.noteOff(60);
  vm.fromApp.disconnect(an);
  ok('a piano note reaches the cable', peak > 0.01, `peak ${peak.toFixed(3)}`);
}

// 5. the microphone (needs an input device; this PC may have none)
A.settings.set({ vmic: { ...A.settings.v.vmic, mic: true, gate: -55 } });
for (let i = 0; i < 100 && !vm.micGain && vm.status.state !== 'error'; i++) await sleep(100);
const ins = await vmicMod.listInputs();
ok('mic mixed in', !!vm.micGain, `${vm.status.state} · ${vm.status.micLabel || vm.status.error || ''} · inputs: ${ins.map((d) => d.label).join(' | ') || 'none'}`);
A.settings.set({ vmic: { ...A.settings.v.vmic, mic: false } });
await sleep(400);
ok('mic released', !vm.micStream);

// 6. saved across restarts
await sleep(600);
const saved = await window.melofi.loadSettings();
ok('saved to settings.json', saved?.vmic?.on === true && saved.vmic.sink === TEST_SINK);

// 7. the settings rows
A.ui.tab = 'sound'; A.ui.open('settings'); await sleep(400);
const text = document.querySelector('#settings .drawer-body').innerText;
document.querySelector('#vmicCard')?.scrollIntoView({ block: 'start' });
document.querySelector('.vm-more')?.setAttribute('open', '');
await sleep(200);
ok('settings rows', /Discord로 연주 보내기/.test(text) && /연주 크기/.test(text) && /내 목소리도 같이/.test(text) && /자세히/.test(text));
ok('studio sends nothing', !A.studio.engine?.out || !vm.sources.has(A.studio.engine.out));
const shots = [10];

// 8. off
A.settings.set({ vmic: { ...A.settings.v.vmic, on: false } });
const s8 = await waitState('off');
ok('off', s8 === 'off' && !vm.out && !vm.tap);
// leave the settings as a fresh user would have them
A.settings.set({ vmic: { on: false, sink: 'auto', level: 1, mic: false, micDevice: '', micLevel: 1, gate: -55 } });
await sleep(500);

const fails = R.filter((r) => !r.pass);
console.log(`[vmic] ${R.length - fails.length}/${R.length} passed`);
window.melofi.testWrite?.('vmic-e2e.json', JSON.stringify({ results: R, latency: lat }, null, 2));
return shots;
