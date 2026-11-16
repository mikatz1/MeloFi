// MeloFi Studio — the live sound of a VST3 plugin, as an AudioWorklet (see vsthost.js).
// The node has a MessagePort to the main process, which passes requests to the MeloFi VST Host.
// Everything is stamped with this context's frames, so the helper renders in step with our clock.
//
// gen (an instrument): asks for its next frames `delay` frames ahead of what plays now and plays
//   them when the clock reaches them. Notes scheduled ahead land on their exact sample; a note
//   played live waits about `delay` frames.
// fx (an insert effect): sends what comes in, plays what comes back `delay` frames later (the
//   engine schedules notes earlier by that much, so the song stays in time). If an answer is
//   late, or the helper is gone, the dry sound plays instead of a gap.
// Offline (export): fx sends whole chunks of `delay` frames; the renderer suspends the
//   OfflineAudioContext at each chunk until the answer is back (engine.pumpOffline).
// Late answers raise `delay` by one quantum (live only) and are counted for the status line.
const Q = 128;
const SIZE = 1 << 15; // ring, in frames

class VstStream extends AudioWorkletProcessor {
  constructor(o) {
    super();
    const p = o.processorOptions || {};
    this.floor = p.floor || 0; // the browser's own buffer, frames (bursts are at least this long)
    this.mode = p.mode === 'fx' ? 'fx' : 'gen';
    this.offline = !!p.offline;
    this.delay = Math.max(Q, Math.ceil((p.delay || 256) / Q) * Q);
    this.max = p.max || 4096;
    this.L = new Float32Array(SIZE); this.R = new Float32Array(SIZE);
    this.stamp = new Float64Array(SIZE / Q).fill(-1); // frame held by each quantum of the ring
    this.ok = new Uint8Array(SIZE / Q);
    if (this.mode === 'fx') { this.dL = new Float32Array(SIZE); this.dR = new Float32Array(SIZE); }
    this.reqEnd = -1;
    this.sent = new Map(); // frame -> currentFrame when asked (round trip)
    this.st = { under: 0, late: 0, rttN: 0, rttSum: 0, rttMax: 0, blocks: 0 };
    this.lateWindow = 0;
    this.lastReport = 0;
    this.gap = false; this.last = [0, 0];
    this.alive = true;
    this.link = null;
    // the browser renders in bursts (one sound-card period at a time) and answers only arrive
    // between bursts, so the round trip can never be shorter than a burst: measure it
    this.lastWall = 0; this.inBurst = 0; this.burst = 1;
    this.clean = 0; this.peak = 0;
    if (this.offline && this.mode === 'fx') { this.chunk = this.delay; this.cL = new Float32Array(this.chunk); this.cR = new Float32Array(this.chunk); }
    this.port.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'port') { this.link = m.port; this.link.onmessage = (x) => this.receive(x.data); }
      else if (m.type === 'close') { this.alive = false; try { this.link?.close(); } catch { /* gone */ } }
      else if (m.type === 'reset') { this.reqEnd = -1; this.stamp.fill(-1); }
      else if (m.type === 'hold') this.hold = !!m.on; // playing: notes are scheduled with today's delay, keep it
    };
  }

  receive({ f, n, ok, d }) {
    const asked = this.sent.get(f);
    if (asked !== undefined) {
      this.sent.delete(f);
      const rtt = currentFrame - asked;
      this.st.rttN++; this.st.rttSum += rtt; if (rtt > this.st.rttMax) this.st.rttMax = rtt;
    }
    // the frames it is for: an instrument's own, an effect's are heard `delay` later
    const due = this.mode === 'fx' ? f + this.delay : f;
    if (!this.offline && due + n <= currentFrame) { this.st.late++; this.lateWindow++; return; }
    for (let k = 0; k < n; k += Q) {
      const at = f + k, i = (at % SIZE), b = i / Q;
      if (ok && d) { this.L.set(d.subarray(k, k + Q), i); this.R.set(d.subarray(n + k, n + k + Q), i); }
      this.stamp[b] = at; this.ok[b] = ok ? 1 : 0;
    }
    if (this.offline) this.port.postMessage({ type: 'done', upTo: f + n });
  }

  ask(f, n, d) {
    if (!this.link) return;
    this.sent.set(f, currentFrame);
    if (this.sent.size > 256) this.sent.clear();
    this.link.postMessage(d ? { f, n, d } : { f, n });
  }

  // frames [at, at + Q) from the ring into out; false when they are not there
  take(at, outL, outR) {
    const i = at % SIZE, b = i / Q;
    if (this.stamp[b] !== at) return 0;
    if (!this.ok[b]) return 1; // the helper has no plugin here: nothing (an effect: dry)
    outL.set(this.L.subarray(i, i + Q));
    outR.set(this.R.subarray(i, i + Q));
    return 2;
  }

  process(inputs, outputs) {
    const out = outputs[0], oL = out[0], oR = out[1] || out[0];
    const cf = currentFrame;
    if (this.mode === 'gen') {
      if (!this.offline) {
        // keep `delay` frames asked for ahead of the clock
        if (this.reqEnd < cf) { this.reqEnd = cf + this.delay; this.fresh = this.reqEnd; }
        while (this.reqEnd < cf + Q + this.delay) { this.ask(this.reqEnd, Q); this.reqEnd += Q; }
      }
      const got = this.take(cf, oL, oR);
      if (got === 0 && cf >= (this.fresh ?? 0)) this.miss(oL, oR); else if (got === 2) this.heal(oL, oR); else { oL.fill(0); oR.fill(0); }
    } else {
      const inp = inputs[0], iL = inp[0] || new Float32Array(Q), iR = inp[1] || iL;
      const i = cf % SIZE;
      for (let k = 0; k < Q; k += 8) { const a = Math.abs(iL[k]) + Math.abs(iR[k]); if (a > this.peak) this.peak = a; }
      this.dL.set(iL, i); this.dR.set(iR, i);
      if (this.offline) {
        const off = cf % this.chunk;
        this.cL.set(iL, off); this.cR.set(iR, off);
        if (off + Q === this.chunk) {
          const d = new Float32Array(this.chunk * 2);
          d.set(this.cL, 0); d.set(this.cR, this.chunk);
          this.ask(cf + Q - this.chunk, this.chunk, d);
        }
      } else {
        const d = new Float32Array(Q * 2);
        d.set(iL, 0); d.set(iR, Q);
        this.ask(cf, Q, d);
      }
      const at = cf - this.delay;
      const got = at < 0 ? 1 : this.take(at, oL, oR);
      if (got !== 2) {
        // dry, as late as the wet sound would be
        const j = ((at % SIZE) + SIZE) % SIZE;
        if (at < 0) { oL.fill(0); oR.fill(0); } else { oL.set(this.dL.subarray(j, j + Q)); oR.set(this.dR.subarray(j, j + Q)); }
        if (got === 0 && at >= 0 && !this.offline) this.st.under++;
      }
    }
    for (let c = 2; c < out.length; c++) out[c].set(oL);
    this.st.blocks++;
    // the usual burst (the most common length in the first second: a busy moment can run several
    // together and must not count), plus one quantum of room; late answers add more later (adapt)
    if (!this.offline && !this.burstDone) {
      const now = Date.now();
      if (now - this.lastWall > 1 && this.inBurst) { this.seen = this.seen || new Map(); this.seen.set(this.inBurst, (this.seen.get(this.inBurst) || 0) + 1); this.inBurst = 0; }
      this.inBurst++;
      this.lastWall = now;
      if (this.st.blocks > sampleRate / Q) {
        this.burstDone = true;
        let best = 1, n = 0;
        for (const [len, c] of this.seen || []) if (c > n || (c === n && len > best)) { best = len; n = c; }
        this.burst = Math.max(best, Math.ceil(this.floor / Q));
        const want = Math.min(this.max, (best + 1) * Q);
        if (this.delay < want) this.delay = want;
      }
    }
    if (!this.offline) this.adapt(cf);
    return this.alive;
  }

  // an instrument's frames did not come in time: fade out from the last sample, count it
  miss(oL, oR) {
    if (!this.gap) {
      const [l, r] = this.last;
      for (let k = 0; k < Q; k++) { const g = Math.max(0, 1 - k / 32); oL[k] = l * g; oR[k] = r * g; }
    } else { oL.fill(0); oR.fill(0); }
    this.gap = true;
    this.st.under++;
  }

  heal(oL, oR) {
    if (this.gap) for (let k = 0; k < 32; k++) { oL[k] *= k / 32; oR[k] *= k / 32; }
    this.gap = false;
    this.last[0] = oL[Q - 1]; this.last[1] = oR[Q - 1];
  }

  // every half second: late answers make the delay longer at once; two clean seconds take one
  // quantum off again (a busy moment should not leave it long), down to a burst plus a quantum.
  // An effect only shortens while its input is silent (the jump would click); a shortening that
  // turns out too short is undone, and the next try waits 30 seconds.
  adapt(cf) {
    if (cf - this.lastReport < sampleRate / 2) return;
    this.lastReport = cf;
    const late = this.lateWindow > 0 || this.st.under > (this.underSeen || 0);
    this.cleanRtt = Math.max(this.cleanRtt || 0, this.st.rttMax);
    if (late) {
      if (this.delay < this.max) this.delay = Math.min(this.max, Math.max(this.delay + Q, (Math.ceil(this.st.rttMax / Q) + 1) * Q));
      // a shortening that ran late: wait before the next one, and keep one more quantum of room
      if (cf - (this.shortened || -1e12) < sampleRate * 2) { this.holdUntil = cf + sampleRate * 30; this.margin = Math.min(3, (this.margin || 0) + 1); }
      this.clean = 0; this.cleanRtt = 0;
    } else if (++this.clean >= 4 && !this.hold && this.burstDone && cf >= (this.holdUntil || 0) && this.delay > (this.burst + 1 + (this.margin || 0)) * Q && (this.mode === 'gen' || this.peak < 1e-4)) {
      // straight down to what the round trips of these clean seconds needed (a busy load can have
      // pushed it far up), never below a burst plus a quantum
      const m = this.margin || 0;
      const need = Math.max((this.burst + 1 + m) * Q, (Math.ceil(this.cleanRtt / Q) + 1 + m) * Q);
      this.delay = Math.min(this.delay, need);
      this.cleanRtt = 0;
      this.shortened = cf;
      this.clean = 0;
    }
    this.peak = 0;
    this.underSeen = this.st.under;
    this.lateWindow = 0;
    const s = this.st;
    this.port.postMessage({ type: 'stats', delay: this.delay, burst: this.burst * Q, under: s.under, late: s.late, rttAvg: s.rttN ? s.rttSum / s.rttN : 0, rttMax: s.rttMax, blocks: s.blocks });
    s.rttMax = 0; s.rttN = 0; s.rttSum = 0;
  }
}

registerProcessor('melofi-vst-stream', VstStream);
