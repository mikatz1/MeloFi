// F2 recording: MP4 (canvas + audio), MP3, WAV, MIDI, or MIDI + WAV for FL Studio.

// ---------- MIDI ----------

function vlq(n) {
  const out = [n & 0x7f];
  while ((n >>= 7)) out.unshift((n & 0x7f) | 0x80);
  return out;
}

function chunk(type, bytes) {
  const len = bytes.length;
  return [...type].map((c) => c.charCodeAt(0)).concat([(len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255], bytes);
}

function text(metaType, s) {
  const b = [...new TextEncoder().encode(s)];
  return [0xff, metaType, ...vlq(b.length), ...b];
}

// events: [{ ms, type: 'on'|'off'|'sus', note, vel, on }]
export function encodeMidi(events, { name = 'MeloFi', bpm = 120, ppq = 960 } = {}) {
  const usPerQ = Math.round(60000000 / bpm);
  const tick = (ms) => Math.round((ms / 1000) * (bpm / 60) * ppq);

  const t0 = [
    0, ...text(0x03, 'MeloFi'),
    0, 0xff, 0x51, 0x03, (usPerQ >> 16) & 255, (usPerQ >> 8) & 255, usPerQ & 255,
    0, 0xff, 0x58, 0x04, 4, 2, 24, 8,
    0, 0xff, 0x2f, 0x00,
  ];

  const sorted = [...events].sort((a, b) => a.ms - b.ms || (a.type === 'off' ? -1 : 1));
  const t1 = [0, ...text(0x03, name), 0, 0xc0, 0x00];
  let last = 0;
  for (const e of sorted) {
    const tk = tick(e.ms);
    t1.push(...vlq(Math.max(0, tk - last)));
    last = tk;
    if (e.type === 'on') t1.push(0x90, e.note & 127, Math.max(1, e.vel & 127));
    else if (e.type === 'off') t1.push(0x80, e.note & 127, 64);
    else t1.push(0xb0, 64, e.on ? 127 : 0);
  }
  t1.push(0, 0xff, 0x2f, 0x00);

  const header = chunk('MThd', [0, 1, 0, 2, (ppq >> 8) & 255, ppq & 255]);
  return new Uint8Array([...header, ...chunk('MTrk', t0), ...chunk('MTrk', t1)]);
}

// ---------- WAV (24-bit) ----------

export function encodeWav({ left, right, rate }) {
  const n = left.length;
  const bps = 3;
  const buf = new ArrayBuffer(44 + n * 2 * bps);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2 * bps, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2 * bps, true); v.setUint16(32, 2 * bps, true); v.setUint16(34, 24, true);
  str(36, 'data'); v.setUint32(40, n * 2 * bps, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (const ch of [left, right]) {
      let s = Math.round(Math.max(-1, Math.min(1, ch[i])) * 8388607);
      if (s < 0) s += 16777216;
      v.setUint8(o, s & 255); v.setUint8(o + 1, (s >> 8) & 255); v.setUint8(o + 2, (s >> 16) & 255);
      o += 3;
    }
  }
  return new Uint8Array(buf);
}

// Trim leading silence to the first note and keep a tail for the reverb.
function trimPcm(pcm, startMs, lastEventMs) {
  const start = Math.max(0, Math.floor(((startMs ?? 0) / 1000) * pcm.rate));
  let end = pcm.left.length;
  const minEnd = Math.floor(((lastEventMs ?? 0) / 1000) * pcm.rate);
  const thr = 1e-4;
  while (end > minEnd && Math.abs(pcm.left[end - 1]) < thr && Math.abs(pcm.right[end - 1]) < thr) end--;
  end = Math.min(pcm.left.length, end + Math.floor(0.25 * pcm.rate));
  return { left: pcm.left.subarray(start, end), right: pcm.right.subarray(start, end), rate: pcm.rate, offsetMs: (start / pcm.rate) * 1000 };
}

function mp3(pcm, kbps) {
  return new Promise((res, rej) => {
    const w = new Worker('melofi://app/renderer/js/mp3-worker.js');
    w.onmessage = (e) => { w.terminate(); res(e.data); };
    w.onerror = (e) => { w.terminate(); rej(e); };
    const L = pcm.left.slice(), R = pcm.right.slice();
    w.postMessage({ left: L, right: R, rate: pcm.rate, kbps }, [L.buffer, R.buffer]);
  });
}

// ---------- session ----------

export class Recorder {
  constructor({ engine, canvas, settings, instrumentName, metronome }) {
    this.engine = engine;
    this.metronome = metronome;
    this.canvas = canvas;
    this.settings = settings;
    this.instrumentName = instrumentName;
    this.active = null;
  }

  get recording() { return !!this.active; }

  mp4Mime() {
    const types = ['video/mp4;codecs=avc1.640033,mp4a.40.2', 'video/mp4;codecs=avc1.4D0033,mp4a.40.2', 'video/mp4;codecs=avc1.640033,opus'];
    return types.find((t) => MediaRecorder.isTypeSupported(t)) || null;
  }

  // Chromium's first H.264 MediaRecorder of a session can lose the race with the
  // encoder start-up and write an MP4 with audio only. One throwaway take fixes it.
  warmup() {
    if (this._warm) return this._warm;
    const mime = this.mp4Mime();
    if (!mime) return (this._warm = Promise.resolve());
    this._warm = (async () => {
      const vs = this.canvas.captureStream(30);
      const mr = new MediaRecorder(new MediaStream([...vs.getVideoTracks(), ...this.engine.stream.stream.getAudioTracks()]), { mimeType: mime, audioBitsPerSecond: 192000 });
      mr.ondataavailable = () => {};
      mr.start(500);
      await new Promise((r) => setTimeout(r, 1500));
      await new Promise((r) => { mr.onstop = r; mr.stop(); });
      vs.getVideoTracks().forEach((t) => t.stop());
    })().catch(() => {});
    return this._warm;
  }

  event(e) {
    if (!this.active) return;
    this.active.events.push({ ...e, ms: performance.now() - this.active.t0 });
  }

  async start() {
    const fmt = this.settings.get('recFormat');
    const s = { fmt, events: [], t0: performance.now() };
    if (fmt === 'mp4') {
      await this.warmup();
      const fps = this.settings.get('recFps');
      // fixed output size: scale the stage into a second canvas every frame
      const res = this.settings.get('recRes');
      let src = this.canvas;
      this.scaled = null;
      if (res !== 'window') {
        const H = +res;
        const W = Math.round((H * this.canvas.width) / this.canvas.height / 2) * 2;
        const c = document.createElement('canvas');
        c.width = W; c.height = H;
        const x = c.getContext('2d', { alpha: false });
        x.imageSmoothingQuality = 'high';
        this.scaled = { c, x };
        this.tick();
        src = c;
      }
      const vs = src.captureStream(fps);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const stream = new MediaStream([...vs.getVideoTracks(), ...this.engine.stream.stream.getAudioTracks()]);
      let mime = this.mp4Mime();
      s.convert = null;
      if (!mime) { mime = 'video/webm;codecs=vp9,opus'; s.convert = 'webm-to-mp4'; }
      s.ext = mime.startsWith('video/mp4') ? 'mp4' : 'webm';
      // 192k: Windows' AAC encoder rejects higher rates, and Chromium then silently drops the video track.
      s.mr = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: this.settings.get('recMbps') * 1e6, audioBitsPerSecond: mime.includes('mp4a') ? 192000 : 256000 });
      s.blobs = [];
      s.mr.ondataavailable = (e) => e.data.size && s.blobs.push(e.data);
      s.mr.start(1000);
      s.vtracks = vs.getVideoTracks();
    } else if (fmt === 'mp3' || fmt === 'wav' || fmt === 'fl') {
      s.stopPcm = await this.engine.startCapture();
    }
    s.t0 = performance.now();
    const m = this.metronome;
    s.grid = m && m.on ? { origin: m.originPerf, bpm: m.bpm, beats: m.beats } : null;
    this.active = s;
  }

  // called once per animation frame after the stage has drawn
  tick() {
    const sc = this.scaled;
    if (sc) sc.x.drawImage(this.canvas, 0, 0, sc.c.width, sc.c.height);
  }

  // Returns { files: [{ext, data, suffix}], convert }
  async stop() {
    const s = this.active;
    this.active = null;
    const bpm = this.settings.get('bpm');
    if (!s) return null;
    const firstOn = s.events.find((e) => e.type === 'on')?.ms;
    const lastMs = s.events.length ? s.events[s.events.length - 1].ms : 0;
    const name = this.instrumentName();

    if (s.fmt === 'mp4') {
      await new Promise((res) => { s.mr.onstop = res; s.mr.stop(); });
      s.vtracks.forEach((t) => t.stop());
      this.scaled = null;
      if (!s.blobs.length) return null;
      const blob = new Blob(s.blobs, { type: s.mr.mimeType });
      const data = new Uint8Array(await blob.arrayBuffer());
      const head = new TextDecoder('latin1').decode(data.subarray(0, Math.min(data.length, 262144)));
      const videoOk = s.ext !== 'mp4' || head.includes('avcC');
      return { files: [{ ext: s.ext, data }], convert: s.convert, videoOk };
    }

    // Time zero of the exported take: the bar line before the first note when the
    // metronome was running (so the notes sit on the DAW grid), else just before it.
    let zero = Math.max(0, (firstOn ?? 0) - 50);
    if (s.grid && firstOn != null) {
      const barMs = (s.grid.beats * 60000) / s.grid.bpm;
      const abs = s.t0 + firstOn;
      const bar = Math.floor((abs - s.grid.origin) / barMs);
      const z = s.grid.origin + bar * barMs - s.t0;
      if (z >= 0) zero = z;
    }

    if (s.fmt === 'midi') {
      if (!s.events.some((e) => e.type === 'on')) return null;
      const shift = zero;
      return { files: [{ ext: 'mid', data: encodeMidi(s.events.map((e) => ({ ...e, ms: e.ms - shift })), { name, bpm }) }] };
    }

    const raw = await s.stopPcm();
    if (firstOn == null) return null;
    const pcm = trimPcm(raw, zero, lastMs);
    if (s.fmt === 'wav') return { files: [{ ext: 'wav', data: encodeWav(pcm) }] };
    if (s.fmt === 'mp3') return { files: [{ ext: 'mp3', data: await mp3(pcm, this.settings.get('recKbps')) }] };
    // FL Studio: MIDI and WAV aligned to the same zero point
    const evs = s.events.map((e) => ({ ...e, ms: e.ms - pcm.offsetMs }));
    return {
      files: [
        { ext: 'mid', data: encodeMidi(evs, { name, bpm }) },
        { ext: 'wav', data: encodeWav(pcm) },
      ],
    };
  }
}
