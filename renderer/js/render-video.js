// High-quality video of the loaded score, rendered rather than recorded:
// the audio goes through the same sampler and effects in an OfflineAudioContext (sample-exact,
// no glitches however dense the music), the picture is drawn frame by frame at the chosen size
// (up to 4K) by a second Stage, and both are encoded with WebCodecs into an MP4 written straight
// to disk. It runs faster or slower than real time depending on the machine; nothing is dropped.
import { Engine } from './audio.js';
import { Stage } from './stage.js';
import { Muxer, StreamTarget } from '../../node_modules/mp4-muxer/build/mp4-muxer.mjs';

const SR = 48000;
const LEAD = 0.6;  // seconds of quiet before the first note
const TAIL = 3.5;  // let the last notes and the reverb ring out

async function pickVideoConfig(width, height, fps) {
  const bitrate = Math.round((height >= 2160 ? 48e6 : height >= 1440 ? 26e6 : 16e6) * (fps / 60) ** 0.7);
  for (const codec of ['avc1.640034', 'avc1.640033', 'avc1.640032', 'avc1.64002A', 'avc1.640028']) {
    for (const hardwareAcceleration of ['prefer-hardware', 'no-preference']) {
      const cfg = { codec, width, height, bitrate, framerate: fps, hardwareAcceleration, avc: { format: 'avc' }, latencyMode: 'quality' };
      try { if ((await VideoEncoder.isConfigSupported(cfg)).supported) return cfg; } catch { /* try the next */ }
    }
  }
  throw new Error('H.264 encoder not available');
}

async function pickAudioConfig() {
  // AAC plays everywhere (editors included); Opus only if this Chromium has no AAC encoder
  for (const [codec, mux, bitrate] of [['mp4a.40.2', 'aac', 256000], ['mp4a.40.2', 'aac', 192000], ['mp4a.40.2', 'aac', 128000], ['opus', 'opus', 192000]]) {
    const cfg = { codec, sampleRate: SR, numberOfChannels: 2, bitrate };
    try { if ((await AudioEncoder.isConfigSupported(cfg)).supported) return { cfg, mux }; } catch { /* next */ }
  }
  throw new Error('audio encoder not available');
}

// opts: { height, fps }   ui: { progress(phase, 0..1), cancelled() }
export async function renderVideo(app, { height = 2160, fps = 60 } = {}, ui = {}) {
  const progress = ui.progress || (() => {});
  const cancelled = ui.cancelled || (() => false);
  const P = app.player, v = app.settings.v;
  const song = P.song;
  const width = Math.round((height * 16) / 9 / 2) * 2;

  // ---- what to play ----
  const notes = [];
  for (const l of song.lines) {
    if (!P.enabled.has(l.id)) continue;
    for (const n of l.notes) if (n.n >= 21 && n.n <= 108) notes.push({ t: n.t + LEAD, d: n.d, n: n.n, v: n.v, color: app.lineColor(l.id, n.n) });
  }
  notes.sort((a, b) => a.t - b.t);
  const pedals = (song.pedals || []).map((p) => ({ t: p.t + LEAD, on: p.on })).sort((a, b) => a.t - b.t);
  const dur = song.duration + LEAD + TAIL;
  const pedalAt = (t) => { let on = false; for (const p of pedals) { if (p.t <= t) on = p.on; else break; } return on; };
  const pedalUpAfter = (t) => pedals.find((p) => p.t > t && !p.on)?.t ?? Infinity;

  // ---- audio, offline ----
  progress('audio', 0);
  const octx = new OfflineAudioContext(2, Math.ceil(dur * SR), SR);
  const eng = new Engine(octx);
  await eng.init();
  eng.setVolume(v.volume); eng.setReverb(v.reverb); eng.setRoom(v.room); eng.setResonance(v.resonance); eng.setBass(v.bass); eng.setBrightness(v.brightness);
  await eng.load(v.instrument, 1, 127, (p) => progress('load', p), { budgetMB: 1500 });
  if (cancelled()) return null;

  // The whole performance is handed to the sampler before rendering starts: every note-on and
  // release carries its exact time, so nothing depends on when messages arrive.
  // A key that is struck again cuts its previous voice (noteOn does that); releases follow the
  // pedal: key up with the pedal down rings on until the pedal comes up.
  const voices = [];
  for (const x of notes) {
    const vid = eng.noteOn(x.n, x.v, x.t);
    if (vid != null) voices.push({ vid, x });
  }
  for (const { vid, x } of voices) {
    const up = x.t + x.d;
    const at = pedalAt(up) ? Math.min(pedalUpAfter(up), dur - 0.05) : up;
    const rel = eng.voices.get(vid)?.rel ?? 0.4;
    eng.node.port.postMessage({ type: 'off', vid, tau: rel / 4.5, at });
  }
  // pedal resonance follows the pedal, as live
  for (const p of pedals) eng.resGate.gain.setTargetAtTime(p.on ? 1 : 0, p.t, p.on ? 0.03 : 0.09);
  const tick = setInterval(() => progress('audio', Math.min(0.99, octx.currentTime / dur)), 200);
  const audio = await octx.startRendering().finally(() => clearInterval(tick));
  if (cancelled()) return null;

  // ---- encoders + file ----
  const vcfg = await pickVideoConfig(width, height, fps);
  const { cfg: acfg, mux: amux } = await pickAudioConfig();
  const file = await window.melofi.renderOpen({ dir: v.recDir, base: `${song.title} (${height}p)` });
  const writes = [];
  let failed = null;
  const muxer = new Muxer({
    target: new StreamTarget({ onData: (data, pos) => writes.push(window.melofi.renderWrite(file.id, data.slice(), pos)), chunked: true, chunkSize: 8 << 20 }),
    video: { codec: 'avc', width, height, frameRate: fps },
    audio: { codec: amux, numberOfChannels: 2, sampleRate: SR },
    fastStart: false,
    firstTimestampBehavior: 'offset',
  });
  const venc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: (e) => { failed = e; } });
  venc.configure(vcfg);
  const aenc = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: (e) => { failed = e; } });
  aenc.configure(acfg);

  try {
    // audio first: it's quick
    const L = audio.getChannelData(0), R = audio.getChannelData(1);
    const N = 1024;
    for (let i = 0; i < audio.length; i += N) {
      const n = Math.min(N, audio.length - i);
      const data = new Float32Array(n * 2);
      data.set(L.subarray(i, i + n), 0);
      data.set(R.subarray(i, i + n), n);
      const ad = new AudioData({ format: 'f32-planar', sampleRate: SR, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((i / SR) * 1e6), data });
      aenc.encode(ad);
      ad.close();
    }
    await aenc.flush();

    // ---- picture, frame by frame ----
    const canvas = document.createElement('canvas');
    const st = new Stage(canvas, { gpu: true, size: { w: width, h: height } });
    st.setTheme(v.theme, v.customTheme);
    st.setOptions({
      visualizer: true, particles: 'high', bloom: v.bloom, speed: v.speed, labels: 'none', range: v.range,
      noteColor: v.noteColor, barWidth: v.barWidth, bgDim: v.bgDim, zoom: app.zoomNow(), fit: app.stage.opts.fit, center: app.stage.opts.center, fxExtra: v.fxExtra,
    });
    if (v.bgImage) {
      st.setBackground(v.bgImage);
      for (let i = 0; i < 50 && !st.bgImg; i++) await new Promise((r) => setTimeout(r, 40));
    }
    let tf = 0;
    if (v.scoreFall) st.fall = { notes: notes.map((x) => ({ t: x.t, d: x.d, n: x.n, color: x.color })), maxD: notes.reduce((m, x) => Math.max(m, x.d), 0), now: () => tf };

    // visual events: key down, key up, and when the sound stops (pedal up, or ~ring time)
    const vis = [];
    for (const x of notes) {
      const up = x.t + x.d;
      const held = pedalAt(up);
      vis.push({ t: x.t, k: 0, x });
      vis.push({ t: up, k: 1, x, held });
      vis.push({ t: held ? Math.min(pedalUpAfter(up), x.t + 9) : up, k: 2, x });
    }
    for (const p of pedals) vis.push({ t: p.t, k: 3, on: p.on });
    vis.sort((a, b) => a.t - b.t || a.k - b.k);
    let vi = 0;
    const frames = Math.ceil(dur * fps);
    st.time = 0;
    const t0 = performance.now();
    for (let f = 0; f < frames; f++) {
      if (cancelled() || failed) break;
      tf = f / fps;
      while (vi < vis.length && vis[vi].t <= tf) {
        const e = vis[vi++];
        if (e.k === 0) st.noteOn(e.x.n, e.x.v, e.x.color);
        else if (e.k === 1) st.noteOff(e.x.n, e.held);
        else if (e.k === 2) st.soundOff(e.x.n);
        else st.setPedal(e.on);
      }
      st.frame(tf * 1000);
      const frame = new VideoFrame(canvas, { timestamp: Math.round(tf * 1e6), duration: Math.round(1e6 / fps) });
      venc.encode(frame, { keyFrame: f % (fps * 2) === 0 });
      frame.close();
      while (venc.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 1));
      if (f % 15 === 0) {
        const el = (performance.now() - t0) / 1000;
        progress('video', f / frames, el * (frames - f) / Math.max(1, f));
        await new Promise((r) => setTimeout(r, 0)); // let the window breathe
      }
    }
    if (failed) throw failed;
    if (cancelled()) { venc.close(); await Promise.all(writes); await window.melofi.renderClose(file.id, false); return null; }
    await venc.flush();
    muxer.finalize();
    await Promise.all(writes);
    st.glr?.gl.getExtension('WEBGL_lose_context')?.loseContext();
    return await window.melofi.renderClose(file.id, true);
  } catch (err) {
    try { venc.close(); } catch { /* already closed */ }
    await Promise.all(writes).catch(() => {});
    await window.melofi.renderClose(file.id, false);
    throw err;
  }
}
