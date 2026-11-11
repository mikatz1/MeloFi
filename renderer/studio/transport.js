// MeloFi Studio — transport: plays the current pattern (loop) or the playlist (song), scheduling
// notes, audio clips and automation ~150 ms ahead with exact AudioContext times. Song mode
// follows the tempo map and the loop region. Also records live notes.
import { PPQ, STEP, barTicks, patternTicks, pattern, audible, tickToSec, secToTick, songBars, barAt } from './model.js';
import { stretched } from './media.js';

const LOOKAHEAD = 0.15; // s

// groove templates: per 16th inside a beat, timing (fraction of a 16th) and velocity
export const GROOVES = {
  '스윙 16분 (MPC 58%)': { t: [0, 0.32, 0, 0.32], v: [1, 0.82, 0.95, 0.8] },
  '살짝 뒤로 (레이백)': { t: [0.04, 0.12, 0.06, 0.14], v: [1, 0.85, 0.92, 0.82] },
  '앞으로 당김 (푸시)': { t: [0, -0.08, -0.03, -0.1], v: [1, 0.9, 0.95, 0.88] },
  '셔플 8분': { t: [0, 0, 0.66, 0], v: [1, 0.85, 0.9, 0.8] },
  '힙합 그루브': { t: [0, 0.22, 0.05, 0.3], v: [1, 0.7, 0.9, 0.75] },
};

// every event of the arrangement, sorted by tick, plus the loop length:
//   { type: 'n', tick, ch, n, v, d, fine, pan, slide }   a note
//   { type: 'a', tick, ch, media, ratio, off, d, gain, fadeIn, fadeOut }   an audio clip
//   { type: 'x', tick, target, v, ramp }   an automation point
// song mode with the loop region on: ticks are relative to the region's start (`base`)
export function eventsFor(proj, mode = proj.mode) {
  const out = [];
  const on = audible(proj);
  const chans = new Map(proj.channels.map((c) => [c.id, c]));
  const bt = barTicks(proj);
  const addPattern = (pat, offset, from, limit) => {
    // from / limit: the part of the pattern (pattern ticks) this clip plays
    for (const [chId, list] of Object.entries(pat.notes)) {
      if (!on.has(chId)) continue;
      const ch = chans.get(chId);
      const loop = ch?.loopSteps > 0 ? ch.loopSteps * STEP : 0;
      const emit = (n, t) => {
        if (t < from || t >= limit) return;
        const sw = ch?.swing ?? proj.swing;
        let tick = offset + t - from;
        let v = n.v;
        const g = ch?.groove && GROOVES[ch.groove];
        if (t % STEP === 0) {
          const k = Math.round(t / STEP) % 4;
          if (g) { tick += g.t[k] * STEP; v = Math.max(1, Math.round(v * g.v[k])); }
          else if (sw && k % 2 === 1) tick += sw * STEP * 0.5;
        }
        out.push({ type: 'n', tick: Math.max(0, tick), ch: chId, n: n.n, v, d: Math.min(n.d, limit - t), fine: n.fine || 0, pan: n.pan || 0, slide: !!n.slide, porta: !!n.porta });
      };
      const src = ch?.arp?.on ? arpNotes(list, ch.arp) : list;
      for (const n of src) {
        if (n.mute) continue; // muted with the mute tool
        if (loop) { if (n.t >= loop) continue; for (let t = n.t; t < limit; t += loop) emit(n, t); }
        else emit(n, n.t);
      }
    }
  };
  let length, base = 0;
  if (mode === 'song') {
    const tracks = proj.playlist.tracks;
    const soloT = tracks.some((t) => t.solo);
    const trackOn = (i) => { const t = tracks[i]; return t && (soloT ? t.solo : !t.mute); };
    for (const c of proj.playlist.clips) {
      if (!trackOn(c.track) || c.mute) continue; // muted clips (mute tool) stay silent
      const start = c.start * bt, clipLen = c.len * bt;
      if (c.kind === 'audio') {
        const m = proj.media[c.media];
        if (!m || !on.has(c.ch)) continue;
        const ratio = c.sync && m.bpm ? m.bpm / proj.bpm : 1;
        out.push({ type: 'a', tick: start, ch: c.ch, media: c.media, ratio, off: c.offset || 0, d: clipLen, gain: c.gain ?? 1, fadeIn: c.fadeIn || 0.003, fadeOut: c.fadeOut || 0.01 });
      } else if (c.kind === 'auto') {
        const a = proj.autos.find((x) => x.id === c.auto);
        if (!a || !a.points.length) continue;
        const span = (a.len || c.len) * bt;
        for (let o = 0; o < clipLen; o += span) {
          a.points.forEach((p, i) => {
            const t = o + p.t * span;
            if (t <= clipLen) out.push({ type: 'x', tick: start + t, target: a.target, v: p.v, ramp: i > 0 });
          });
        }
      } else {
        const pat = pattern(proj, c.pattern);
        if (!pat) continue;
        const pl = patternTicks(proj, pat), off0 = (c.offset || 0) * bt;
        // a clip longer than its pattern repeats it
        let pos = 0, from = off0 % pl;
        while (pos < clipLen) {
          const take = Math.min(pl - from, clipLen - pos);
          addPattern(pat, start + pos, from, from + take);
          pos += take; from = 0;
        }
      }
    }
    length = songBars(proj) * bt;
    if (proj.loop && proj.loopOn && proj.loop.end > proj.loop.start) {
      base = proj.loop.start * bt;
      const end = proj.loop.end * bt;
      // audio that started before the region still sounds inside it
      const keep = [];
      for (const e of out) {
        if (e.type === 'a' && e.tick < base && e.tick + e.d > base) { const cut = base - e.tick; keep.push({ ...e, tick: 0, d: Math.min(e.d - cut, end - base), skipTicks: cut }); continue; }
        if (e.tick < base || e.tick >= end) continue;
        keep.push({ ...e, tick: e.tick - base, d: e.d != null ? Math.min(e.d, end - e.tick) : e.d });
      }
      out.length = 0; out.push(...keep);
      length = end - base;
    }
  } else if (mode === 'live') {
    // performance mode: every track plays its chosen pattern on a loop
    const pats = Object.values(proj.live?.active || {}).map((id) => pattern(proj, id)).filter(Boolean);
    length = pats.length ? Math.max(...pats.map((x) => patternTicks(proj, x))) : bt;
    for (const x of pats) { const pl = patternTicks(proj, x); for (let o = 0; o < length; o += pl) addPattern(x, o, 0, Math.min(pl, length - o)); }
  } else {
    const pat = pattern(proj);
    addPattern(pat, 0, 0, patternTicks(proj, pat));
    length = patternTicks(proj, pat);
  }
  out.sort((a, b) => a.tick - b.tick || (a.type === 'x' ? -1 : 1));
  return { events: out, length: Math.max(length, PPQ), base };
}

// channel arpeggiator (FL's channel arp): notes starting together play one after another
// arp: { on, mode: up|down|updown|random, rate (ticks), octaves, gate (0..1) }
export function arpNotes(list, arp) {
  const groups = new Map();
  for (const n of list) { const k = Math.round(n.t); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(n); }
  const out = [];
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (const chord of groups.values()) {
    chord.sort((a, b) => a.n - b.n);
    if (chord.length < 2 && (arp.octaves || 1) < 2) { out.push(...chord); continue; }
    let seq = [];
    for (let o = 0; o < (arp.octaves || 1); o++) seq.push(...chord.map((n) => ({ ...n, n: Math.min(127, n.n + 12 * o) })));
    if (arp.mode === 'down') seq.reverse();
    if (arp.mode === 'updown' && seq.length > 2) seq = [...seq, ...seq.slice(1, -1).reverse()];
    const t0 = chord[0].t, end = Math.max(...chord.map((n) => n.t + n.d)), rate = arp.rate || 24;
    let i = 0;
    for (let t = t0; t < end; t += rate, i++) {
      const s = arp.mode === 'random' ? seq[Math.floor(rnd() * seq.length)] : seq[i % seq.length];
      out.push({ ...s, t, d: Math.max(1, Math.round(Math.min(rate, end - t) * (arp.gate ?? 0.85))) });
    }
  }
  return out;
}

export class Transport {
  constructor(engine, getProject) {
    this.engine = engine;
    this.get = getProject;
    this.playing = false;
    this.pos = 0;         // ticks (when stopped / paused), relative to `base`
    this.base = 0;
    this.metro = false;
    this.recording = false;
    this.onTick = () => {};
    this.onStop = () => {};
    this.recorded = [];   // live notes while recording: { ch, n, v, t0 }
    this.buffers = new Map(); // `${media}@${ratio}` -> AudioBuffer (ready to play)
  }

  get ctx() { return this.engine.ctx; }
  get mode() { return this.get().mode; }

  // seconds from the start of the loop to `tick` inside it
  secAt(tick) { const p = this.get(); return tickToSec(p, this.base + tick, this.mode) - tickToSec(p, this.base, this.mode); }
  tickAt(sec) { const p = this.get(); return secToTick(p, tickToSec(p, this.base, this.mode) + sec, this.mode) - this.base; }
  // absolute ticks (loops unrolled) -> seconds from the start of the first loop
  secAbs(abs) {
    const L = this.length;
    return Math.floor(abs / L) * this.lenSec + this.secAt(((abs % L) + L) % L);
  }

  // decode / stretch every audio file the arrangement uses (call before playing)
  async prepare(proj = this.get()) {
    const need = new Set();
    for (const c of proj.playlist.clips) if (c.kind === 'audio' && proj.media[c.media]) {
      const m = proj.media[c.media];
      need.add(`${c.media}@${(c.sync && m.bpm ? m.bpm / proj.bpm : 1).toFixed(4)}`);
    }
    await Promise.all([...need].filter((k) => !this.buffers.has(k)).map(async (k) => {
      const [hash, r] = k.split('@');
      // r = source BPM / project BPM = output length / input length
      try { this.buffers.set(k, await stretched(hash, this.ctx.sampleRate, +r)); } catch (err) { console.warn('audio clip', err); }
    }));
  }

  // position in ticks (inside the loop)
  now() {
    if (!this.playing) return this.pos;
    const el = this.ctx.currentTime - this.startCtx + this.secAt(this.startTick);
    const lenSec = this.lenSec || 1;
    const inLoop = ((el % lenSec) + lenSec) % lenSec;
    return Math.max(0, this.tickAt(inLoop));
  }

  // song position in ticks (adds the loop region's start)
  songPos() { return this.base + this.now(); }
  // seconds into the song (for a reference track started at the same point)
  songSec() { return tickToSec(this.get(), this.songPos(), 'song'); }

  build() {
    const { events, length, base } = eventsFor(this.get());
    this.events = events; this.length = length; this.base = base;
    this.lenSec = this.secAt(length);
  }

  // the arrangement changed while playing: pick it up from where we are
  refresh() {
    if (!this.playing) return;
    const p = this.now();
    this.build();
    this.engine.stopAll();
    this.begin(Math.min(p, this.length - 1), this.ctx.currentTime + 0.03);
  }

  async play() {
    if (this.playing) return;
    if (this.ctx.state !== 'running') this.ctx.resume();
    this.build();
    if (this.pos >= this.length) this.pos = 0;
    this.playing = true;
    if (this.get().playlist.clips.some((c) => c.kind === 'audio')) await this.prepare();
    if (!this.playing) return;
    this.begin(this.pos, this.ctx.currentTime + 0.05);
    this.out?.start(this.startCtx, this.base + this.pos, PPQ);
    clearInterval(this.timer);
    this.timer = setInterval(() => this.pump(), 20);
    this.pump();
  }

  begin(fromTick, ctxTime) {
    this.startTick = fromTick;
    this.startCtx = ctxTime;
    this.cursor = this.events.findIndex((e) => e.tick >= fromTick);
    if (this.cursor < 0) this.cursor = this.events.length;
    this.loopBase = 0;
    this.nextBeat = Math.ceil(fromTick / PPQ) * PPQ;
    this.nextClock = Math.ceil(fromTick / (PPQ / 24)) * (PPQ / 24);
    // audio already under way and automation values at the start position
    const proj = this.get();
    const last = new Map();
    for (const e of this.events) {
      if (e.tick > fromTick) break;
      if (e.type === 'x') last.set(e.target, e);
    }
    for (const e of this.events) if (e.type === 'x' && e.tick > fromTick && e.ramp && last.has(e.target)) {
      // between two points: interpolate
      const a = last.get(e.target);
      if (a && a.tick <= fromTick) { const f = (fromTick - a.tick) / ((e.tick - a.tick) || 1); last.set(e.target, { ...a, v: a.v + (e.v - a.v) * f }); }
    }
    for (const [target, e] of last) this.engine.target(proj, target)?.set(e.v, ctxTime, false);
    for (const e of this.events) if (e.type === 'a' && e.tick < fromTick && e.tick + e.d > fromTick) this.audio(e, e.tick);
  }

  at(abs) { return this.startCtx + this.secAbs(abs) - this.secAbs(this.startTick); }

  audio(e, abs) {
    const buf = this.buffers.get(`${e.media}@${e.ratio.toFixed(4)}`);
    if (!buf) return;
    const t = this.at(abs);
    const dur = this.secAbs(abs + e.d) - this.secAbs(abs);
    const skip = e.skipTicks ? tickToSec(this.get(), e.skipTicks) : 0;
    this.engine.playAudio(e.ch, buf, t, e.off + skip, dur, e);
  }

  pump() {
    if (!this.playing) return;
    const proj = this.get();
    const horizon = this.tickAt(((this.ctx.currentTime + LOOKAHEAD - this.startCtx + this.secAt(this.startTick)) % this.lenSec)) + Math.floor((this.ctx.currentTime + LOOKAHEAD - this.startCtx + this.secAt(this.startTick)) / this.lenSec) * this.length;
    while (true) {
      if (this.cursor >= this.events.length) {
        if (this.loopBase + this.length > horizon) break;
        this.loopBase += this.length;
        this.cursor = 0;
        if (!this.events.length) break;
        continue;
      }
      const e = this.events[this.cursor];
      const abs = this.loopBase + e.tick;
      if (abs >= horizon) break;
      this.cursor++;
      if (abs < this.startTick - 1e-6) continue;
      if (e.type === 'n') {
        const t = this.at(abs), dur = this.secAbs(abs + e.d) - this.secAbs(abs);
        this.engine.note(e.ch, e.n, e.v, t, dur, { fine: e.fine, pan: e.pan, slide: e.slide, porta: e.porta });
        if (!e.slide) this.out?.note(e.ch, e.n, e.v, t, dur);
      } else if (e.type === 'a') this.audio(e, abs);
      else if (e.type === 'x') this.engine.target(proj, e.target)?.set(e.v, this.at(abs), e.ramp);
    }
    if (this.metro) {
      const bt = barTicks(proj), beat = (PPQ * 4) / proj.sig[1];
      const sigs = proj.mode === 'song' && proj.sigs?.length;
      while (this.nextBeat < horizon) {
        const song = Math.round(this.base + (this.nextBeat % this.length));
        // song mode follows time signature markers: accent on each bar line, beats of that bar
        const b = sigs ? barAt(proj, song) : null;
        if (this.nextBeat >= this.startTick) this.engine.tick(this.at(this.nextBeat), b ? song === b.start : song % bt === 0);
        this.nextBeat += b ? b.beat : beat;
      }
    } else this.nextBeat = Math.ceil(horizon / PPQ) * PPQ;
    if (this.out?.clock) {
      while (this.nextClock < horizon) { if (this.nextClock >= this.startTick) this.out.tick(this.at(this.nextClock)); this.nextClock += PPQ / 24; }
    } else this.nextClock = horizon;
    this.onTick();
  }

  pause() {
    if (!this.playing) return;
    this.pos = this.now();
    this.playing = false;
    clearInterval(this.timer);
    this.engine.stopAll();
    this.out?.stop();
    this.onStop();
    this.onTick();
  }

  stop() {
    if (this.playing) this.pause();
    this.pos = 0;
    this.onTick();
  }

  toggle() { if (this.playing) this.pause(); else this.play(); }

  // tick: position inside the current loop / region
  seek(tick) {
    const was = this.playing;
    this.pause();
    this.pos = Math.max(0, tick);
    if (was) this.play(); else this.onTick();
  }

  // ---- recording live notes into the current pattern ----
  liveOn(chId, n, v) {
    if (!this.recording || !this.playing) return;
    this.recorded.push({ ch: chId, n, v, t0: this.now(), open: true });
  }

  liveOff(chId, n, commit) {
    if (!this.recording) return;
    const r = this.recorded.find((x) => x.open && x.ch === chId && x.n === n);
    if (!r) return;
    r.open = false;
    let d = this.now() - r.t0;
    if (d <= 0) d += this.length; // wrapped around the loop
    commit({ ch: r.ch, t: r.t0, d: Math.max(STEP / 2, d), n: r.n, v: r.v });
  }
}

// offline: schedule a whole arrangement on an engine (WAV / stem / video export)
export async function scheduleAll(engine, proj, { offset = 0.05, mode } = {}) {
  const T = new Transport(engine, () => proj);
  if (mode) proj = { ...proj, mode };
  T.get = () => proj;
  T.build();
  await T.prepare(proj);
  T.startTick = 0; T.startCtx = offset;
  for (const e of T.events) {
    const t = T.at(e.tick);
    if (e.type === 'n') engine.note(e.ch, e.n, e.v, t, T.secAbs(e.tick + e.d) - T.secAbs(e.tick), { fine: e.fine, pan: e.pan, slide: e.slide, porta: e.porta });
    else if (e.type === 'a') T.audio(e, e.tick);
    else engine.target(proj, e.target)?.set(e.v, t, e.ramp);
  }
  return { length: T.length, seconds: T.lenSec, events: T.events };
}
