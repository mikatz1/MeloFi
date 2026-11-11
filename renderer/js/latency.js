// Input latency: measuring it and taking it back out of recordings.
//
// Audio round trip: a train of short noise clicks goes out of the speakers and comes back in
// through the chosen input (mic held to the speaker, or a loopback cable). Each click is found in
// the take by cross-correlation; the round trip is where it landed minus when it was scheduled.
// It is stored per input / output pair and taken off the front of every audio take.
//
// MIDI feel: play along with 8 clicks; the average early / late offset (MIDI transport, driver,
// and the player's own feel, all on the same clock the recorders use) is stored per device and
// taken off recorded notes.
//
// settings.latency = { on, audioManual, midiManual, audio: { 'in|out': {ms, spread, n, label, at} }, midi: { name: {ms, spread, n, at} } }

import { N_ } from '../i18n/i18n.js';

export const LATENCY_DEFAULT = { on: true, audioManual: 0, midiManual: 0, audio: {}, midi: {} };

const cfg = (v) => ({ ...LATENCY_DEFAULT, ...(v?.latency || {}) });
const sinkOf = (ctx) => (typeof ctx?.sinkId === 'string' && ctx.sinkId) || 'default';
export const pairKey = (inputId, sinkId) => `${inputId || 'default'}|${sinkId || 'default'}`;
export const pairKeyFor = (ctx, inputId) => pairKey(inputId, sinkOf(ctx));

// seconds to take off the front of an audio take recorded from inputId on ctx
// (uncalibrated: what the context reports for its own output, as before)
export function audioOffsetSec(v, ctx, inputId) {
  const c = cfg(v);
  if (!c.on) return 0;
  const m = c.audio[pairKeyFor(ctx, inputId)];
  const base = m ? m.ms / 1000 : (ctx?.baseLatency || 0) + (ctx?.outputLatency || 0);
  return Math.max(0, base + (c.audioManual || 0) / 1000);
}

// ms that notes from this MIDI device arrive late (negative: early); 0 when off
export function midiOffsetMs(v, device) {
  const c = cfg(v);
  if (!c.on) return 0;
  return (c.midi[device]?.ms || 0) + (c.midiManual || 0);
}

// ---------- the click ----------

// 4 ms of seeded white noise under a Hann window: flat spectrum, one sharp correlation peak
export function makeClick(rate) {
  const n = Math.round(rate * 0.004), out = new Float32Array(n);
  let s = 0x2545f491;
  for (let i = 0; i < n; i++) {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    out[i] = ((s >>> 0) / 4294967296 * 2 - 1) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1)));
  }
  return out;
}

// times (s, from the first click) of a train; slightly uneven gaps so an echo or a doubled
// buffer can never line up with the next click
export function clickTimes(count = 10, gap = 0.45) {
  return Array.from({ length: count }, (_, i) => i * gap + (i % 3) * 0.037);
}

// Find one click in rec near `at` (samples): searches at .. at + maxLag, returns the lag in
// samples (sub-sample, parabolic) of the first strong peak, and how far it stands above the floor.
export function findClick(rec, ref, at, maxLag) {
  const m = ref.length, lo = Math.max(0, Math.floor(at)), hi = Math.min(rec.length - m, Math.floor(at + maxLag));
  if (hi <= lo) return null;
  const corr = new Float32Array(hi - lo + 1);
  let peak = 0;
  for (let k = lo; k <= hi; k++) {
    let s = 0;
    for (let j = 0; j < m; j++) s += rec[k + j] * ref[j];
    const a = Math.abs(s);
    corr[k - lo] = a;
    if (a > peak) peak = a;
  }
  if (!(peak > 0)) return null;
  // the direct sound is the first peak; room echoes come after and may be as loud
  let i = 0;
  while (i < corr.length && corr[i] < 0.6 * peak) i++;
  while (i + 1 < corr.length && corr[i + 1] >= corr[i]) i++;
  const y0 = corr[i - 1] ?? corr[i], y1 = corr[i], y2 = corr[i + 1] ?? corr[i];
  const den = y0 - 2 * y1 + y2;
  const frac = den < 0 ? Math.max(-0.5, Math.min(0.5, 0.5 * (y0 - y2) / den)) : 0;
  const sorted = Float32Array.from(corr).sort();
  const floor = sorted[Math.floor(sorted.length / 2)] || 1e-12;
  return { lag: lo + i + frac - at, snr: y1 / floor };
}

// rec: the take (mono); starts: where each click would sit with no latency (samples).
// Returns { ms, spread (max - min of the clicks used), sd, n, of } or null when the clicks
// weren't heard clearly enough.
export function measureTrain(rec, rate, starts, { maxMs = 400, ref = makeClick(rate) } = {}) {
  const lags = [];
  for (const at of starts) {
    const r = findClick(rec, ref, at, Math.round(maxMs / 1000 * rate));
    if (r && r.snr > 6) lags.push(r.lag / rate * 1000);
  }
  if (lags.length < Math.max(3, Math.ceil(starts.length / 2))) return null;
  // drop clicks far from the median (a cough, a knock), then average
  const med = [...lags].sort((a, b) => a - b)[Math.floor(lags.length / 2)];
  const ok = lags.filter((x) => Math.abs(x - med) < 3);
  if (ok.length < Math.max(3, Math.ceil(starts.length / 2))) return null;
  const ms = ok.reduce((a, b) => a + b, 0) / ok.length;
  const sd = Math.sqrt(ok.reduce((a, b) => a + (b - ms) ** 2, 0) / ok.length);
  return { ms, spread: Math.max(...ok) - Math.min(...ok), sd, n: ok.length, of: starts.length };
}

// ---------- taking an input ----------

const tapLoaded = new WeakMap();
async function tapNode(ctx) {
  if (!tapLoaded.get(ctx)) { tapLoaded.set(ctx, ctx.audioWorklet.addModule('melofi://app/renderer/js/input-tap.js')); }
  await tapLoaded.get(ctx);
  return new AudioWorkletNode(ctx, 'input-tap', { numberOfOutputs: 0 });
}

export const inputConstraints = (deviceId) => ({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2, ...(deviceId ? { deviceId: { exact: deviceId } } : {}) } });

// Starts taking `stream` on ctx. stop() resolves to { L, R, t0 } where t0 is the context time of
// the first sample (frame-exact, from inside the worklet).
export async function takeInput(ctx, stream) {
  const src = ctx.createMediaStreamSource(stream), tap = await tapNode(ctx);
  const chunks = [];
  let t0 = null, gotStart;
  const started = new Promise((r) => { gotStart = r; });
  tap.port.onmessage = (e) => { if (Array.isArray(e.data)) chunks.push(e.data); else if (e.data?.t0 != null) { t0 = e.data.t0; gotStart(t0); } };
  src.connect(tap);
  tap.port.postMessage('start');
  return {
    started,
    async stop() {
      const done = new Promise((r) => { const prev = tap.port.onmessage; tap.port.onmessage = (e) => { if (e.data === 'stopped') r(); else prev(e); }; });
      tap.port.postMessage('stop');
      await Promise.race([done, new Promise((r) => setTimeout(r, 500))]);
      src.disconnect();
      const n = chunks.reduce((s, c) => s + c[0].length, 0), L = new Float32Array(n), R = new Float32Array(n);
      let o = 0;
      for (const [l, r] of chunks) { L.set(l, o); R.set(r, o); o += l.length; }
      return { L, R, t0 };
    },
  };
}

// Cut a take so that its first sample is the moment `refCtx` (context time) as the player heard
// it: skips the time the tap ran before refCtx, plus the round trip. Pads with silence if the
// tap started late.
export function alignTake({ L, R, t0 }, rate, refCtx, offsetSec) {
  const skip = Math.round(((refCtx - t0) + offsetSec) * rate);
  if (skip >= 0) return { left: L.subarray(Math.min(skip, L.length)), right: R.subarray(Math.min(skip, R.length)), skip };
  const pad = -skip, l = new Float32Array(L.length + pad), r = new Float32Array(R.length + pad);
  l.set(L, pad); r.set(R, pad);
  return { left: l, right: r, skip };
}

// ---------- the audio round-trip test ----------

// waits on the audio clock itself (it can run behind the page's timers)
async function untilCtx(ctx, t) {
  const limit = performance.now() + (t - ctx.currentTime) * 1000 + 5000;
  while (ctx.currentTime < t && performance.now() < limit) await new Promise((r) => setTimeout(r, Math.max(10, Math.min(100, (t - ctx.currentTime) * 1000))));
}

// Plays the train and listens. onState(text) for progress. Resolves to the measurement plus the
// context's own figures, or throws Error with a Korean message.
export async function measureRoundTrip(ctx, deviceId, { onState = () => {}, level = 0.5 } = {}) {
  if (ctx.state !== 'running') await ctx.resume();
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia(inputConstraints(deviceId)); } catch { throw new Error('입력 장치를 열 수 없습니다'); }
  const label = stream.getAudioTracks()[0]?.label || '';
  try {
    const take = await takeInput(ctx, stream);
    const t0 = await Promise.race([take.started, new Promise((r) => setTimeout(() => r(null), 1500))]);
    if (t0 == null) { await take.stop(); throw new Error('입력에서 소리가 들어오지 않습니다'); }
    const rate = ctx.sampleRate, ref = makeClick(rate), times = clickTimes();
    const buf = ctx.createBuffer(1, ref.length, rate);
    buf.copyToChannel(ref, 0);
    const g = ctx.createGain();
    g.gain.value = level;
    g.connect(ctx.destination);
    const first = ctx.currentTime + 0.5;
    for (const t of times) { const s = ctx.createBufferSource(); s.buffer = buf; s.connect(g); s.start(first + t); }
    onState(N_('클릭 재생 중'));
    const end = first + times[times.length - 1] + 0.6;
    await untilCtx(ctx, end);
    const rec = await take.stop();
    g.disconnect();
    // the louder channel (a mono mic may come in on one side only)
    let eL = 0, eR = 0;
    for (let i = 0; i < rec.L.length; i++) { eL += rec.L[i] * rec.L[i]; eR += rec.R[i] * rec.R[i]; }
    const mono = eR > eL ? rec.R : rec.L;
    const res = measureTrain(mono, rate, times.map((t) => (first + t - rec.t0) * rate), { ref });
    if (!res) throw new Error('클릭이 잘 안 잡혔습니다. 볼륨을 올리거나 마이크를 스피커에 더 가까이 대세요');
    return { ...res, label, base: (ctx.baseLatency || 0) * 1000, out: (ctx.outputLatency || 0) * 1000, key: pairKeyFor(ctx, deviceId) };
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
}

// ---------- the MIDI tap test ----------

// Match taps (context times) to beats (context times): each tap to the nearest beat within half
// a beat; returns { ms (mean tap - beat), spread, sd, n } or null with fewer than 6.
export function tapOffsets(taps, beats) {
  if (beats.length < 2) return null;
  const half = (beats[1] - beats[0]) / 2, used = new Set(), d = [];
  for (const t of taps) {
    let best = -1;
    for (let i = 0; i < beats.length; i++) if (!used.has(i) && Math.abs(t - beats[i]) < half && (best < 0 || Math.abs(t - beats[i]) < Math.abs(t - beats[best]))) best = i;
    if (best >= 0) { used.add(best); d.push((t - beats[best]) * 1000); }
  }
  if (d.length < 6) return null;
  const ms = d.reduce((a, b) => a + b, 0) / d.length;
  const sd = Math.sqrt(d.reduce((a, b) => a + (b - ms) ** 2, 0) / d.length);
  return { ms, spread: Math.max(...d) - Math.min(...d), sd, n: d.length };
}

// 4 count-in clicks, then 8 to play along with. midi: the app's MidiInput (its `tap` hook is
// borrowed for the test). Resolves to { device, ...tapOffsets } or throws.
export function midiTapTest(ctx, midi, click, { bpm = 90, onState = () => {}, onBeat = () => {} } = {}) {
  return new Promise((resolve, reject) => {
    const beat = 60 / bpm, first = ctx.currentTime + 0.3, all = [];
    for (let i = 0; i < 12; i++) { const t = first + i * beat; all.push(t); click(t, i % 4 === 0); setTimeout(() => onBeat(i), Math.max(0, (t - ctx.currentTime) * 1000)); }
    const beats = all.slice(4), taps = new Map();
    onState(N_('넷을 세고 나서 클릭에 맞춰 8번 치세요'));
    midi.tap = (device) => {
      const t = ctx.currentTime;
      if (t < beats[0] - beat / 2) return;
      if (!taps.has(device)) taps.set(device, []);
      taps.get(device).push(t);
    };
    untilCtx(ctx, beats[beats.length - 1] + beat).then(() => {
      midi.tap = null;
      // the device that played the most (normally the only one)
      const [device, list] = [...taps.entries()].sort((a, b) => b[1].length - a[1].length)[0] || [];
      const r = list && tapOffsets(list, beats);
      if (!r) reject(new Error(list ? '박자에 맞는 음이 6개보다 적습니다. 다시 해보세요' : 'MIDI 입력이 없었습니다'));
      else resolve({ device, ...r });
    });
  });
}
