// MeloFi Studio — the link between a VST3 plugin in the MeloFi VST Host and the audio graph:
// an AudioWorklet node (vst-worklet.js) with a MessagePort to the main process (vsthost.js).
const api = () => window.melofi;

// ports come back from the preload as window messages
const waitingPorts = new Map(); // nonce -> resolve
let listening = false;
let nonceSeq = 0;
function listen() {
  if (listening) return;
  listening = true;
  window.addEventListener('message', (e) => {
    const info = e.data?.melofiVstPort;
    if (!info || !e.ports?.length) return;
    const w = waitingPorts.get(info.nonce);
    if (w) { waitingPorts.delete(info.nonce); w(e.ports[0]); } else e.ports[0].close();
  });
}

function openPort(slot) {
  listen();
  const nonce = `${Date.now().toString(36)}-${++nonceSeq}`;
  return new Promise((resolve) => {
    const t = setTimeout(() => { waitingPorts.delete(nonce); resolve(null); }, 5000);
    waitingPorts.set(nonce, (p) => { clearTimeout(t); resolve(p); });
    api().vstStream(slot, nonce);
  });
}

// live: 256 frames ahead (5.3 ms at 48 kHz) to start with; the worklet adds more if answers run late
export const LIVE_DELAY = 256;
// offline: chunks of 4096 frames per suspend of the OfflineAudioContext
export const OFFLINE_CHUNK = 4096;

// the latest numbers from every live stream (the status line and the tests read them)
export const streamStats = new Map(); // slot -> { delay, under, late, rttAvg, rttMax, mode }

export class VstStreamNode {
  // mode: 'gen' (an instrument: output only) | 'fx' (an insert: input -> output)
  constructor(ctx, slot, mode) {
    this.ctx = ctx;
    this.slot = slot;
    this.mode = mode;
    this.offline = typeof OfflineAudioContext !== 'undefined' && ctx instanceof OfflineAudioContext;
    // live: start at the browser's own buffer plus a quantum (answers only come in between its bursts)
    this.delay = mode === 'fx' && this.offline ? OFFLINE_CHUNK : Math.max(LIVE_DELAY, Math.ceil(((ctx.baseLatency || 0) * ctx.sampleRate) / 128) * 128 + 128);
    this.node = new AudioWorkletNode(ctx, 'melofi-vst-stream', {
      numberOfInputs: mode === 'fx' ? 1 : 0, numberOfOutputs: 1, outputChannelCount: [2],
      channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers',
      processorOptions: { mode, offline: this.offline, delay: this.delay, floor: Math.round((ctx.baseLatency || 0) * ctx.sampleRate) },
    });
    this.upTo = 0;
    this.waiters = [];
    this.onDelay = null;
    this.node.port.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'stats') {
        streamStats.set(slot, { ...m, mode });
        if (m.delay !== this.delay) { this.delay = m.delay; this.onDelay?.(m.delay); }
      } else if (m.type === 'done') {
        this.upTo = Math.max(this.upTo, m.upTo);
        this.waiters = this.waiters.filter(([at, r]) => (at <= this.upTo ? (r(true), false) : true));
      }
    };
    this.linked = this.link();
  }

  async link() {
    const port = await openPort(this.slot);
    if (!port) return false;
    if (this.closed) { port.close(); return false; }
    this.node.port.postMessage({ type: 'port', port }, [port]);
    return true;
  }

  // offline: resolves once the helper has answered every chunk up to `frame` (false: gave up)
  until(frame, ms = 20000) {
    if (this.upTo >= frame) return Promise.resolve(true);
    return new Promise((resolve) => {
      const t = setTimeout(() => { this.waiters = this.waiters.filter((w) => w[1] !== done); resolve(false); }, ms);
      const done = (v) => { clearTimeout(t); resolve(v); };
      this.waiters.push([frame, done]);
    });
  }

  // while the song plays the delay may grow (late answers) but not shrink: notes already scheduled
  // were moved earlier by the delay of the moment
  hold(on) { try { this.node.port.postMessage({ type: 'hold', on }); } catch { /* gone */ } }

  dispose() {
    this.closed = true;
    try { this.node.port.postMessage({ type: 'close' }); this.node.disconnect(); } catch { /* gone */ }
    api().vstStreamClose(this.slot);
    streamStats.delete(this.slot);
  }
}

// events for the helper, collected per slot and sent once per task (one IPC message for a chord)
const outbox = new Map();
export function sendEvents(slot, ...list) {
  let q = outbox.get(slot);
  if (!q) {
    q = [];
    outbox.set(slot, q);
    queueMicrotask(() => { outbox.delete(slot); api().vstEvents(slot, q); });
  }
  q.push(...list);
}
