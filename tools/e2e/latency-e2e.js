// Input latency: click detection on synthetic delayed takes, and offsets applied to recordings.
//   MELOFI_SHOT=out MELOFI_SCRIPT=tools/e2e/latency-e2e.js npx electron .
// Prints LAT-BEGIN ... LAT-END. Leaves the saved latency settings as they were.
try {
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let errs = [];
window.addEventListener('error', (e) => errs.push(e.message + ' @' + (e.filename || '').split('/').pop() + ':' + e.lineno));
window.addEventListener('unhandledrejection', (e) => errs.push('rej ' + String(e.reason?.stack || e.reason).split('\n').slice(0, 3).join(' ')));
for (let i = 0; i < 150 && !window.__melofi?.engine?.inst; i++) await sleep(100);
const A = window.__melofi;
const imp = (p) => import(new URL(p, location.href).href);
const R = [];
const check = async (name, fn) => { errs = []; try { const n = await fn(); await sleep(50); R.push(`${errs.length ? 'FAIL' : 'PASS'} ${name}${n ? ` (${n})` : ''}${errs.length ? ' :: ' + errs.slice(0, 3).join(' | ') : ''}`); } catch (e) { R.push(`FAIL ${name} :: ${String(e?.stack || e).split('\n').slice(0, 3).join(' ')} ${errs.join(' | ')}`); } };
const L = await imp('js/latency.js');
const media = await imp('studio/media.js');
const { PPQ, pattern, notesOf } = await imp('studio/model.js');
const savedLatency = JSON.parse(JSON.stringify(A.settings.get('latency')));
const savedFmt = A.settings.get('recFormat');

// a take as a speaker + mic would give it: clicks delayed by D ms (fractional, windowed sinc),
// band-limited, maybe inverted, two room echoes after the direct sound, and noise
function fakeTake(rate, times, lead, D, { invert = false, gain = 0.15, noise = 0.004, echo = true, jitter = 0 } = {}) {
  const ref = L.makeClick(rate), len = Math.ceil((lead + times[times.length - 1] + 1) * rate), out = new Float32Array(len);
  const add = (pos, g) => {
    const i0 = Math.floor(pos), fr = pos - i0;
    for (let k = -16; k < ref.length + 16; k++) {
      let s = 0;
      for (let j = -8; j <= 8; j++) { const src = k - j; if (src < 0 || src >= ref.length) continue; const x = j + fr; const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x); s += ref[src] * sinc * (0.5 + 0.5 * Math.cos(Math.PI * x / 9)); }
      const o = i0 + k; if (o >= 0 && o < len) out[o] += g * s;
    }
  };
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (const t of times) {
    const pos = (lead + t + (D + (rnd() * 2 - 1) * jitter) / 1000) * rate, g = (invert ? -1 : 1) * gain;
    add(pos, g);
    if (echo) { add(pos + 0.007 * rate, g * 0.7); add(pos + 0.023 * rate, -g * 0.5); }
  }
  // speaker / mic: gentle one-pole low pass (~9 kHz) and DC block
  let lp = 0, hpx = 0, hpy = 0;
  const a = Math.exp(-2 * Math.PI * 9000 / rate);
  for (let i = 0; i < len; i++) {
    lp = (1 - a) * out[i] + a * lp;
    hpy = lp - hpx + 0.995 * hpy; hpx = lp;
    out[i] = hpy + noise * (rnd() * 2 - 1);
  }
  return out;
}

await check('click detection within ±1 ms (synthetic delays, echoes, noise)', async () => {
  const res = [];
  for (const rate of [48000, 44100]) {
    const times = L.clickTimes(), lead = 0.5;
    for (const [D, opt] of [[3.2, {}], [47.9, {}], [123.4, { invert: true }], [211.7, { noise: 0.02 }], [380.25, { echo: false }], [86.6, { jitter: 0.4 }]]) {
      const rec = fakeTake(rate, times, lead, D, opt);
      const r = L.measureTrain(rec, rate, times.map((t) => (lead + t) * rate));
      if (!r) throw new Error(`${rate} ${D}: no result`);
      const err = r.ms - D;
      res.push(`${D}→${r.ms.toFixed(2)}`);
      if (Math.abs(err) > 1) throw new Error(`${rate} Hz D=${D} measured ${r.ms.toFixed(3)} (spread ${r.spread.toFixed(2)})`);
    }
  }
  return res.join(' ');
});

await check('no clicks / pure noise is refused', async () => {
  const rate = 48000, times = L.clickTimes(), rec = fakeTake(rate, times, 0.5, 50, { gain: 0, noise: 0.05 });
  const r = L.measureTrain(rec, rate, times.map((t) => (0.5 + t) * rate));
  if (r) throw new Error(`gave ${r.ms}`);
});

await check('take alignment: tap start + round trip come off the front', async () => {
  const rate = 48000, n = rate, Lc = new Float32Array(n), Rc = new Float32Array(n);
  Lc[12000] = 1; Rc[12000] = 1; // the tap began at ctx 10.000; the song at 10.100; round trip 150 ms
  const a = L.alignTake({ L: Lc, R: Rc, t0: 10 }, rate, 10.1, 0.15);
  if (a.left[12000 - 0.25 * rate] !== 1) throw new Error(`skip ${a.skip}`);
  const b = L.alignTake({ L: Lc, R: Rc, t0: 10.2 }, rate, 10.1, 0); // tap started late: padded
  if (b.left[12000 + 0.1 * rate] !== 1) throw new Error(`pad ${b.skip}`);
  return `skip ${a.skip}, pad ${-b.skip}`;
});

await check('MIDI tap offsets', async () => {
  const beats = Array.from({ length: 8 }, (_, i) => 5 + i * 0.6667);
  const taps = beats.map((b, i) => b + 0.025 + (i % 2 ? 0.004 : -0.004));
  const r = L.tapOffsets([4.3, ...taps], beats); // a stray early note is ignored (no beat that close)
  if (!r || Math.abs(r.ms - 25) > 0.01 || r.n !== 8) throw new Error(JSON.stringify(r));
  if (L.tapOffsets(taps.slice(0, 4), beats)) throw new Error('4 taps accepted');
  return `${r.ms.toFixed(1)} ms ±${(r.spread / 2).toFixed(1)}`;
});

await check('offset lookups follow the switch and the manual nudge', async () => {
  const ctx = A.engine.ctx, key = L.pairKeyFor(ctx, null);
  const v = { latency: { on: true, audioManual: 5, midiManual: -2, audio: { [key]: { ms: 120 } }, midi: { K: { ms: 30 } } } };
  const a = L.audioOffsetSec(v, ctx, null), m = L.midiOffsetMs(v, 'K'), u = L.midiOffsetMs(v, 'other');
  if (Math.abs(a - 0.125) > 1e-9 || m !== 28 || u !== -2) throw new Error(`${a} ${m} ${u}`);
  v.latency.on = false;
  if (L.audioOffsetSec(v, ctx, null) !== 0 || L.midiOffsetMs(v, 'K') !== 0) throw new Error('off still shifts');
  return `key ${key}`;
});

// ---- piano recorder: a MIDI note from a measured keyboard is moved back by its offset ----
await check('piano: MIDI notes shifted by the device offset', async () => {
  A.settings.set({ recFormat: 'midi', latency: { ...savedLatency, on: true, midiManual: 0, midi: { TestKbd: { ms: 40 } } } });
  await A.recorder.start();
  A.midi.enabled = true;
  try { localStorage.setItem('melofi.activeWindow', 'piano'); } catch { /* */ }
  // each event's time against the page clock read just before it was sent (a first note can
  // take a few ms to sound, so the two keyboards are not compared with each other)
  const t0 = A.recorder.active.t0, sent = {};
  const send = (d, dev) => { sent[`${d[0] & 0xf0}-${d[1]}`] = performance.now() - t0; A.midi.handle(d, dev); };
  send([0x90, 60, 100], 'Other');
  send([0x90, 64, 100], 'TestKbd');
  await sleep(120);
  send([0x80, 60, 0], 'Other');
  send([0x80, 64, 0], 'TestKbd');
  const ev = A.recorder.active.events;
  await A.recorder.stop();
  const lagOf = (type, n) => sent[`${type === 'on' ? 0x90 : 0x80}-${n}`] - ev.find((e) => e.type === type && e.note === n).ms;
  const r = [lagOf('on', 60), lagOf('off', 60), lagOf('on', 64), lagOf('off', 64)];
  // moved back by the offset, give or take the time the call itself took
  if (r.slice(0, 2).some((x) => x > 0.01 || x < -15) || r.slice(2).some((x) => x > 40.01 || x < 25)) throw new Error(r.map((x) => x.toFixed(2)).join(' '));
  return `Other ${r[0].toFixed(1)}/${r[1].toFixed(1)} ms, TestKbd ${r[2].toFixed(1)}/${r[3].toFixed(1)} ms earlier than sent`;
});


const S = A.studio;
await check('studio: open', async () => { A.settings.set({ studioTourSeen: true }); await S.open(); await sleep(400); });

// ---- studio: live notes recorded into the pattern are moved back by the lag ----
await check('studio: recorded MIDI notes shifted by the device offset', async () => {
  const T = S.transport, p = S.proj;
  if (p.mode !== 'pattern') S.setMode('pattern');
  S.recQuant = false;
  const ch = p.selected, pat = pattern(p), before = notesOf(pat, ch).length;
  T.recording = true;
  await T.play(); await sleep(400);
  // the clock held still across each pair of calls (a headless audio clock jumps 512 frames)
  const at = T.now();
  T.now = () => at;
  S.liveOn(72, 100, 0); S.liveOn(76, 100, 60);
  T.now = () => at + PPQ / 2;
  S.liveOff(72, 0); S.liveOff(76, 60);
  delete T.now;
  T.recording = false; T.pause();
  const list = notesOf(pattern(S.proj), ch).slice(before);
  const a = list.find((x) => x.n === 72), b = list.find((x) => x.n === 76);
  if (!a || !b) throw new Error(`notes ${JSON.stringify(list)}`);
  const ms = (tk) => tk / PPQ * 60 / S.proj.bpm * 1000;
  const d = ms(a.t - b.t), dd = ms(a.d - b.d);
  if (Math.abs(d - 60) > 0.5 || Math.abs(dd) > 0.5) throw new Error(`start ${d.toFixed(2)} len ${dd.toFixed(2)}`);
  return `${d.toFixed(1)} ms earlier, same length`;
});


// ---- studio: an audio take lands on the grid ----
// A take as the input tap would hand it over: the tap began 250 ms before the song position
// was taken, and a click on every beat arrives 90 ms late (the round trip). With 90 ms stored for
// this input / output pair the clip's clicks must sit on the beats; recording started mid-bar
// (the clip snaps to 1/16 bar) must not move them either.
await check('studio: audio take shifted by the stored round trip', async () => {
  const ctx = S.engine.ctx, rate = ctx.sampleRate, key = L.pairKeyFor(ctx, null), RT = 90;
  const { barTicks, tickToSec } = await imp('studio/model.js');
  S.setMode('song');
  const out = [];
  for (const [startBar, stored] of [[0, RT], [0.3, RT], [2.71, RT], [0, 0]]) {
    A.settings.set({ latency: { ...savedLatency, on: true, audioManual: 0, audio: { [key]: { ms: stored } } } });
    const p = S.proj, bt = barTicks(p), startTick = Math.round(startBar * bt), beat = 60 / p.bpm;
    const tapT0 = 100, refCtx = 100.25, startSec = tickToSec(p, startTick, 'song'), dur = 6;
    const Lc = new Float32Array(Math.round(dur * rate)), Rc = new Float32Array(Lc.length), ref = L.makeClick(rate);
    const beats = [];
    for (let k = Math.ceil(startSec / beat) + 1; (k * beat - startSec) < dur - 1.2; k++) {
      beats.push(k * beat);
      const at = Math.round((refCtx - tapT0 + (k * beat - startSec) + RT / 1000) * rate);
      for (let j = 0; j < ref.length; j++) { Lc[at + j] += 0.3 * ref[j]; Rc[at + j] += 0.3 * ref[j]; }
    }
    const nClips = p.playlist.clips.length;
    S.arec = { armed: null, input: null, stream: { getTracks: () => [] }, take: { stop: async () => ({ L: Lc, R: Rc, t0: tapT0 }) }, startTick, refCtx };
    await S.stopAudioRec();
    const clip = S.proj.playlist.clips[nClips], hash = clip?.media;
    if (clip?.kind !== 'audio') throw new Error('no clip');
    const bar = clip.start, clipSec = tickToSec(p, bar * bt, 'song');
    if (bar !== Math.round(startBar * 16) / 16) throw new Error(`clip at bar ${bar}`);
    const ab = await media.decode(hash, rate);
    // searched from 5 ms before each beat, so a click that came out early is found too
    const r = L.measureTrain(ab.getChannelData(0), rate, beats.map((b) => (b - clipSec - 0.005) * rate), { maxMs: 150 });
    if (!r) throw new Error(`start ${startBar}: clicks not found`);
    const off = r.ms - 5, want = RT - stored;
    out.push(`bar ${startBar}→${bar} stored ${stored}: ${off.toFixed(2)} ms`);
    if (Math.abs(off - want) > 1) throw new Error(out.join(', ') + ` (want ${want})`);
  }
  return out.join(', ');
});

// ---- the same measurement the dialog runs, with the stream path as the "loopback" ----
await check('round-trip routine finds the loopback', async () => {
  const ctx = A.engine.ctx;
  // route: everything the context plays -> a stream -> back in. No speakers, so only the
  // stream path (a few ms) is measured; checks the routine end to end.
  const dest = ctx.createMediaStreamDestination();
  const orig = navigator.mediaDevices.getUserMedia;
  navigator.mediaDevices.getUserMedia = async () => dest.stream;
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (to, ...rest) { if (to === ctx.destination && this.context === ctx) connect.call(this, dest, ...rest); return connect.call(this, to, ...rest); };
  try {
    const r = await L.measureRoundTrip(ctx, null, { level: 0.3 });
    if (!(r.ms >= 0 && r.ms < 60) || r.n < 8) throw new Error(JSON.stringify(r));
    return `${r.ms.toFixed(2)} ms over ${r.n}/${r.of} clicks, spread ${r.spread.toFixed(2)}, base ${r.base.toFixed(1)} out ${r.out.toFixed(1)}`;
  } finally { navigator.mediaDevices.getUserMedia = orig; AudioNode.prototype.connect = connect; }
});

await check('settings drawer: 녹음 tab renders the latency rows', async () => {
  S.close(); await sleep(200);
  A.ui.tab = 'rec'; A.ui.open('settings'); await sleep(200);
  const body = document.querySelector('#settings .drawer-body');
  if (!body.textContent.includes('입력 지연 보정') || !body.textContent.includes('왕복 지연')) throw new Error(body.textContent.slice(0, 200));
  body.scrollTop = body.scrollHeight;
});

A.settings.set({ latency: savedLatency, recFormat: savedFmt });
console.log('LAT-BEGIN\n' + R.join('\n') + '\nLAT-END');
return [300];
} catch (e) { console.log('TOPFAIL ' + (e?.stack || e?.message || e)); return [10]; }
