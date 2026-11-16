// 가상 마이크로 내보내기: a copy of what MeloFi plays goes to a virtual audio cable (VB-Audio
// CABLE Input, VoiceMeeter …), so Discord, Zoom or OBS can pick it up as a microphone
// ("CABLE Output"). Windows has no virtual mic of its own; the cable driver is installed by the user.
//
//   window's context:  engine.out ┐
//                      studio.out ┴─ tap (send level) ─ MediaStreamDestination
//   cable context (sinkId = cable):  stream ─────────────────────────┬─ mix ─ destination
//                                    microphone ─ gate ─ mic level ──┘
//
// The speakers keep playing as before; only the copy goes to the cable. The microphone is mixed
// in the cable context only, so it is never heard on the speakers (no feedback).
import { t } from '../i18n/i18n.js';

export const VMIC_DEFAULT = {
  on: false,
  sink: 'auto',    // 'auto' = the first virtual cable found, or an output deviceId
  level: 1,        // send level of MeloFi's sound
  mic: false,      // mix the real microphone in
  micDevice: '',   // '' = the system default input
  micLevel: 1,
  gate: -55,       // noise gate threshold in dB; -100 = off
};

// names virtual audio cables go by (the playback side, "… Input")
const CABLE_RE = /cable input|cable-[a-z] input|voicemeeter|vb-audio|virtual (audio )?cable|line 1 \(virtual/i;
const SKIP = new Set(['default', 'communications']);

export const isCable = (label) => CABLE_RE.test(label || '');

export async function listOutputs() {
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter((d) => d.kind === 'audiooutput' && !SKIP.has(d.deviceId)).map((d) => ({ id: d.deviceId, label: d.label || '' }));
  } catch { return []; }
}

export async function listInputs() {
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    // a cable's own recording side would feed MeloFi back into itself
    return all.filter((d) => d.kind === 'audioinput' && !SKIP.has(d.deviceId) && !/cable output|voicemeeter out/i.test(d.label || ''))
      .map((d) => ({ id: d.deviceId, label: d.label || '' }));
  } catch { return []; }
}

// '__none__' (tests only): Chromium's silent output, which still runs the graph
export const TEST_SINK = '__none__';

export function pickSink(cfg, outputs) {
  if (cfg.sink === TEST_SINK) return { id: TEST_SINK, label: 'silent test output' };
  if (cfg.sink && cfg.sink !== 'auto') return outputs.find((o) => o.id === cfg.sink) || null;
  // the plain stereo "CABLE Input" first (the one Discord's "CABLE Output" pairs with), then the rest
  const cables = outputs.filter((o) => isCable(o.label));
  return cables.find((o) => /^cable input/i.test(o.label)) || cables[0] || null;
}

export class VirtualMic {
  constructor(ctx, { withMic = true } = {}) {
    this.ctx = ctx;
    this.withMic = withMic;
    this.sources = new Set();
    this.cfg = { ...VMIC_DEFAULT };
    this.status = { state: 'off' };
    this.listeners = new Set();
    this.tap = null;
    this.out = null;     // the cable's AudioContext
    this.sinkId = null;
    this.micStream = null;
    this.micKey = null;
    this.bridgeMs = null; // measured stream hop between the two contexts (measure())
    this._busy = Promise.resolve();
    navigator.mediaDevices?.addEventListener?.('devicechange', () => { if (this.cfg.on) this.apply(this.cfg, true); });
  }

  onStatus(fn) { this.listeners.add(fn); fn(this.status); return () => this.listeners.delete(fn); }
  setStatus(s) { this.status = s; for (const fn of this.listeners) fn(s); }

  // a node whose output is sent (the window's master out); safe to call before apply()
  attach(node) {
    if (!node || this.sources.has(node)) return;
    this.sources.add(node);
    if (this.tap) node.connect(this.tap);
  }

  // apply settings; calls run one after another
  apply(cfg, force = false) {
    this._busy = this._busy.then(() => this._apply({ ...VMIC_DEFAULT, ...(cfg || {}) }, force)).catch((e) => {
      console.warn('vmic', e);
      this.setStatus({ state: 'error', error: e?.message || String(e) });
    });
    return this._busy;
  }

  async _apply(cfg, force) {
    const prev = this.cfg;
    this.cfg = cfg;
    if (!cfg.on) { await this.stop(); this.setStatus({ state: 'off' }); return; }

    const outputs = await listOutputs();
    const sink = pickSink(cfg, outputs);
    if (!sink) {
      await this.stop();
      this.setStatus({ state: cfg.sink === 'auto' ? 'nodevice' : 'missing', outputs });
      return;
    }

    // the copy of MeloFi's sound
    if (!this.tap) {
      this.tap = this.ctx.createGain();
      for (const n of this.sources) n.connect(this.tap);
    }
    this.tap.gain.setTargetAtTime(cfg.level, this.ctx.currentTime, 0.02);

    // the cable side: rebuilt when the device changes
    if (!this.out || this.sinkId !== sink.id || force) {
      await this.closeOut();
      // the smallest buffer the device allows (0): on this PC 2.7 ms + 15 ms out instead of 10 + 50 ms
      const opts = { latencyHint: this.latencyHint ?? 0, sampleRate: this.ctx.sampleRate };
      const sinkId = sink.id === TEST_SINK ? { type: 'none' } : sink.id;
      let out;
      try { out = new AudioContext({ ...opts, sinkId }); } catch { out = new AudioContext(opts); }
      if (sink.id !== TEST_SINK && out.sinkId !== sink.id && out.setSinkId) await out.setSinkId(sink.id);
      this.out = out;
      this.sinkId = sink.id;
      this.mix = out.createGain();
      this.mix.connect(out.destination);
      await out.audioWorklet.addModule('melofi://app/renderer/js/vmic-gate-worklet.js');
      // the hop: audio thread to audio thread over a MessagePort (a few ms); a MediaStream (about
      // 20 ms more) only if that cannot be set up
      try { this.fromApp = await this.bridge(out); this.hop = 'port'; } catch (e) {
        console.warn('vmic bridge', e);
        this.dest = this.ctx.createMediaStreamDestination();
        this.dest.channelCount = 2;
        this.tap.connect(this.dest);
        this.fromApp = out.createMediaStreamSource(this.dest.stream);
        this.hop = 'stream';
      }
      this.fromApp.connect(this.mix);
      this.micKey = null;
      if (out.state !== 'running') await out.resume().catch(() => {});
    }

    // the microphone (only one window sends it)
    const micWanted = cfg.mic && this.withMic;
    const key = micWanted ? cfg.micDevice || 'default' : null;
    if (key !== this.micKey) {
      this.stopMic();
      if (key) {
        const ask = navigator.mediaDevices.getUserMedia({ audio: {
          deviceId: cfg.micDevice ? { exact: cfg.micDevice } : undefined,
          echoCancellation: false, autoGainControl: false, noiseSuppression: true, channelCount: 1, latency: 0,
        } });
        // a permission prompt nobody answers must not hold the other settings up
        this.micStream = await Promise.race([ask, new Promise((_, no) => setTimeout(() => no(new Error(t('마이크를 열지 못했습니다'))), 8000))]);
        this.micSrc = this.out.createMediaStreamSource(this.micStream);
        this.gate = new AudioWorkletNode(this.out, 'melofi-vmic-gate', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
        this.micGain = this.out.createGain();
        this.micSrc.connect(this.gate).connect(this.micGain).connect(this.mix);
      }
      this.micKey = key;
    }
    if (this.micGain) this.micGain.gain.setTargetAtTime(cfg.micLevel, this.out.currentTime, 0.02);
    if (this.gate) this.gate.parameters.get('threshold').value = cfg.gate;

    const micLabel = micWanted ? (this.micStream?.getAudioTracks()[0]?.label || '') : '';
    this.setStatus({ state: 'on', sink, outputs, micLabel, latencyMs: this.latencyMs() });
    void prev;
  }

  // 소리 확인: a short chime sent to the cable only (the speakers stay quiet), long enough for
  // Discord's input meter or mic test to show it
  testSound() {
    if (!this.out || !this.mix) throw new Error(t('가상 마이크가 꺼져 있습니다'));
    const c = this.out, t0 = c.currentTime + 0.05;
    [[659.25, 0], [783.99, 0.18], [1046.5, 0.36]].forEach(([f, at]) => {
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'triangle'; o.frequency.value = f;
      g.gain.setValueAtTime(0, t0 + at);
      g.gain.linearRampToValueAtTime(0.35, t0 + at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + at + 0.9);
      o.connect(g).connect(this.mix);
      o.start(t0 + at); o.stop(t0 + at + 0.95);
    });
    return 1.4; // seconds
  }

  // what a note takes from MeloFi to the cable: this window's buffer, the hop between the two
  // contexts and the cable context's own buffer and output
  // bridgeMs (measured) is how much later the cable plays a sound than the speakers do, so the
  // total is the speakers' own delay plus that; before a measurement it is estimated.
  latencyMs() {
    if (!this.out) return null;
    if (this.loopMs != null) return this.loopMs; // measured through the cable and back (measureLoop)
    const speakers = ((this.ctx.baseLatency || 0) + (this.ctx.outputLatency || 0)) * 1000;
    const extra = this.bridgeMs ?? ((this.out.baseLatency || 0) + (this.out.outputLatency || 0)) * 1000 + 10;
    return Math.round((speakers + extra) * 10) / 10;
  }

  // sender in this window's context, receiver in the cable's, joined by a MessageChannel
  async bridge(out) {
    const url = 'melofi://app/renderer/js/vmic-bridge-worklet.js';
    await this.ctx.audioWorklet.addModule(url);
    await out.audioWorklet.addModule(url);
    const send = new AudioWorkletNode(this.ctx, 'melofi-vmic-send', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 2, channelCountMode: 'explicit' });
    // the sender has to be pulled by the graph: through a silent gain to the destination
    const pull = this.ctx.createGain(); pull.gain.value = 0;
    send.connect(pull).connect(this.ctx.destination);
    const recv = new AudioWorkletNode(out, 'melofi-vmic-recv', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2], processorOptions: { target: this.bridgeTarget ?? 384 } }); // 8 ms: no underruns measured
    const ch = new MessageChannel();
    send.port.postMessage({ port: ch.port1 }, [ch.port1]);
    recv.port.postMessage({ port: ch.port2 }, [ch.port2]);
    this.tap.connect(send);
    this.sender = send; this.pull = pull; this.recv = recv;
    return recv;
  }

  // the receiver's FIFO: fill, underruns and drift corrections (tests)
  bridgeStats() {
    if (!this.recv) return Promise.resolve(null);
    return new Promise((res) => { this.recv.port.onmessage = (e) => res(e.data); this.recv.port.postMessage('stats'); setTimeout(() => res(null), 500); });
  }

  stopMic() {
    for (const n of [this.micSrc, this.gate, this.micGain]) try { n?.disconnect(); } catch { /* gone */ }
    this.micStream?.getTracks().forEach((tr) => tr.stop());
    this.micStream = this.micSrc = this.gate = this.micGain = null;
    this.micKey = null;
  }

  async closeOut() {
    this.stopMic();
    try { this.fromApp?.disconnect(); } catch { /* gone */ }
    for (const n of [this.sender, this.pull, this.dest]) try { n?.disconnect(); } catch { /* gone */ }
    if (this.tap) for (const n of [this.sender, this.dest]) try { if (n) this.tap.disconnect(n); } catch { /* not connected */ }
    if (this.out) await this.out.close().catch(() => {});
    this.out = this.fromApp = this.mix = this.sender = this.pull = this.recv = this.dest = null;
    this.sinkId = null;
    this.loopMs = this.bridgeMs = null; // measurements belong to the device they were taken on
  }

  async stop() {
    await this.closeOut();
    if (this.tap) {
      for (const n of this.sources) try { n.disconnect(this.tap); } catch { /* not connected */ }
      try { this.tap.disconnect(); } catch { /* gone */ }
    }
    this.tap = this.dest = null;
  }

  // The recording side of the cable being sent to ("CABLE Input" -> "CABLE Output"), if present.
  async loopbackDevice() {
    const label = this.status.sink?.label || '';
    const want = /cable input/i.test(label) ? /cable output/i : /voicemeeter/i.test(label) ? /voicemeeter out/i : null;
    if (!want) return null;
    try { return (await navigator.mediaDevices.enumerateDevices()).find((d) => d.kind === 'audioinput' && want.test(d.label)) || null; } catch { return null; }
  }

  // Through the cable and back: clicks sent into the cable are recorded from its other end (what
  // Discord hears) in this window's context, so play time and arrival share one clock. The cable
  // driver's own buffer is included. Returns { loopMs, runs } or null when there is no other end.
  async measureLoop() {
    const dev = await this.loopbackDevice();
    if (!dev || !this.tap) return null;
    const c = this.ctx;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: dev.deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false, latency: 0 } });
    const track = stream.getAudioTracks()[0];
    const capture = (track.getSettings?.().latency || 0) * 1000;
    await c.audioWorklet.addModule('melofi://app/renderer/js/vmic-probe-worklet.js');
    const src = c.createMediaStreamSource(stream);
    const probe = new AudioWorkletNode(c, 'melofi-vmic-probe');
    src.connect(probe);
    const runs = [];
    try {
      for (let i = 0; i < 5; i++) {
        const got = new Promise((res) => { probe.port.onmessage = (e) => res(e.data.time); setTimeout(() => res(null), 1500); });
        const k = c.createConstantSource(), g = c.createGain(); g.gain.value = 0.5;
        k.connect(g).connect(this.tap); // into the send only, not the speakers
        const at = c.currentTime + 0.05;
        k.start(at); k.stop(at + 0.004);
        const back = await got;
        k.disconnect(); g.disconnect();
        // a key press is heard after this context's own buffer; the recording's buffer is taken off
        if (back != null) runs.push((back - at) * 1000 - capture + (c.baseLatency || 0) * 1000);
        await new Promise((res) => setTimeout(res, 200));
      }
    } finally { src.disconnect(); track.stop(); }
    if (!runs.length) return null;
    runs.sort((x, y) => x - y);
    this.loopMs = Math.round(runs[Math.floor(runs.length / 2)] * 10) / 10;
    this.setStatus({ ...this.status, latencyMs: this.latencyMs() });
    return { loopMs: this.loopMs, runs, device: dev.label };
  }

  // Sends a click and times when it arrives in the cable context: the hop between the contexts.
  // Returns { bridgeMs, totalMs }. Used by the settings' 지연 측정 and the headless test.
  async measure() {
    if (!this.out || !this.tap) throw new Error(t('가상 마이크가 꺼져 있습니다'));
    const out = this.out, c = this.ctx;
    await out.audioWorklet.addModule('melofi://app/renderer/js/vmic-probe-worklet.js');
    const probe = new AudioWorkletNode(out, 'melofi-vmic-probe');
    this.fromApp.connect(probe);
    const runs = [];
    for (let i = 0; i < 5; i++) {
      const got = new Promise((res) => { probe.port.onmessage = (e) => res(e.data); setTimeout(() => res(null), 1000); });
      const osc = c.createConstantSource();
      const g = c.createGain(); g.gain.value = 0.5;
      osc.connect(g).connect(this.tap);
      const at = c.currentTime + 0.05;
      const pa = c.getOutputTimestamp?.();
      const sentPerf = pa ? pa.performanceTime + (at - pa.contextTime) * 1000 : performance.now() + 50;
      osc.start(at); osc.stop(at + 0.01);
      const r = await got;
      osc.disconnect(); g.disconnect();
      if (r) {
        const pb = out.getOutputTimestamp?.();
        const arrivePerf = pb ? pb.performanceTime + (r.time - pb.contextTime) * 1000 : performance.now();
        runs.push(arrivePerf - sentPerf);
      }
      await new Promise((res) => setTimeout(res, 120));
    }
    try { this.fromApp.disconnect(probe); } catch { /* gone */ }
    if (!runs.length) throw new Error(t('측정용 소리가 가상 마이크에 닿지 않았습니다'));
    runs.sort((x, y) => x - y);
    this.bridgeMs = Math.max(0, runs[Math.floor(runs.length / 2)]);
    const latencyMs = this.latencyMs();
    this.setStatus({ ...this.status, latencyMs });
    return { bridgeMs: this.bridgeMs, totalMs: latencyMs, runs };
  }
}
