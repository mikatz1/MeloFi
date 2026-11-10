// Synthesised instruments. A synthesizer *is* its sound engine, so instead of downloading samples
// MeloFi renders each patch itself: one note every few semitones and two velocity layers, in an
// OfflineAudioContext (band-limited oscillators, real filters), when the instrument is chosen.
// The results are then played by the same sinc sampler as the recorded instruments.
//
// A procedural manifest looks like:
//   { name, model, family: 'synth', procedural: { patch: 'lead', step: 3, layers: 2 }, ... }
// expand() turns it into the usual { samples, regions } so the engine needs nothing else.

import { KITS } from './drums.js';

const SR = 48000;
const cents = (c) => Math.pow(2, c / 1200);

// pulse-like wave with duty d (harmonic amplitudes sin(pi n d) / n)
function pulseWave(c, d, n = 64) {
  const re = new Float32Array(n), im = new Float32Array(n);
  for (let k = 1; k < n; k++) im[k] = Math.sin(Math.PI * k * d) / k;
  return c.createPeriodicWave(re, im);
}

function osc(c, type, f, detune = 0) {
  const o = c.createOscillator();
  if (typeof type === 'string') o.type = type; else o.setPeriodicWave(type);
  o.frequency.value = f;
  o.detune.value = detune;
  return o;
}

function lowpass(c, f, q = 0.7) {
  const b = c.createBiquadFilter();
  b.type = 'lowpass';
  b.frequency.value = Math.min(f, SR * 0.45);
  b.Q.value = q;
  return b;
}

// amplitude: attack, hold at `sus` after a decay, fade to silence over the last `fade` seconds
function ampEnv(g, dur, { a = 0.005, d = 0.2, sus = 1, fade = 1 }) {
  const p = g.gain;
  p.setValueAtTime(0, 0);
  p.linearRampToValueAtTime(1, a);
  p.setTargetAtTime(sus, a, d / 3);
  p.setValueAtTime(sus, Math.max(a + d, dur - fade));
  p.linearRampToValueAtTime(0, dur - 0.01);
}

const cap = (f) => Math.min(f, SR * 0.45);

export const PATCHES = {
  // Otamatone: a buzzy pulse through a "mouth" (two formant filters) that opens on every note,
  // a little scoop up into the pitch, and vibrato that arrives late.
  otamatone: {
    dur: 3.2, stereo: false, release: 0.25, level: 0.6,
    render(c, f, bright) {
      const o = osc(c, pulseWave(c, 0.32), f * cents(-90));
      o.frequency.setTargetAtTime(f, 0, 0.025);
      const lfo = osc(c, 'sine', 5.6), depth = c.createGain();
      depth.gain.setValueAtTime(0, 0);
      depth.gain.setValueAtTime(0, 0.22);
      depth.gain.linearRampToValueAtTime(f * 0.014, 0.9);
      lfo.connect(depth).connect(o.frequency);
      const f1 = c.createBiquadFilter(), f2 = c.createBiquadFilter();
      f1.type = f2.type = 'bandpass';
      f1.Q.value = 5; f2.Q.value = 7;
      // mouth opening: "u" -> "a"
      f1.frequency.setValueAtTime(330, 0); f1.frequency.setTargetAtTime(760, 0.01, 0.05);
      f2.frequency.setValueAtTime(880, 0); f2.frequency.setTargetAtTime(1250 + 250 * bright, 0.01, 0.05);
      const g1 = c.createGain(), g2 = c.createGain(), dry = c.createGain();
      g1.gain.value = 1; g2.gain.value = 0.55 + 0.25 * bright; dry.gain.value = 0.18;
      const lp = lowpass(c, 2400 + 1600 * bright);
      const amp = c.createGain();
      o.connect(f1).connect(g1).connect(amp);
      o.connect(f2).connect(g2).connect(amp);
      o.connect(lp).connect(dry).connect(amp);
      ampEnv(amp, this.dur, { a: 0.012, d: 0.1, sus: 0.92, fade: 0.9 });
      amp.connect(c.destination);
      o.start(0); lfo.start(0);
    },
  },

  // Classic saw lead: two detuned saws and a sub, a 4-pole low-pass that closes after the attack
  lead: {
    dur: 4, stereo: false, release: 0.3, level: 0.55,
    render(c, f, bright) {
      const a = osc(c, 'sawtooth', f, -7), b = osc(c, 'sawtooth', f, 7), sub = osc(c, 'square', f / 2);
      const sg = c.createGain(); sg.gain.value = 0.14; // a hint of sub; more and the note reads an octave low
      const mix = c.createGain(); mix.gain.value = 0.5;
      a.connect(mix); b.connect(mix); sub.connect(sg).connect(mix);
      const l1 = lowpass(c, 1, 1.6), l2 = lowpass(c, 1, 0.7);
      for (const l of [l1, l2]) {
        l.frequency.setValueAtTime(cap(f * (10 + 10 * bright)), 0);
        l.frequency.setTargetAtTime(cap(f * (4 + 3 * bright) + 400), 0.01, 0.18);
      }
      const amp = c.createGain();
      mix.connect(l1).connect(l2).connect(amp);
      ampEnv(amp, this.dur, { a: 0.004, d: 0.3, sus: 0.85, fade: 1.2 });
      amp.connect(c.destination);
      for (const o of [a, b, sub]) o.start(0);
    },
  },

  // Warm pad: four saws spread across the stereo field, slow attack, soft filter swell
  pad: {
    dur: 7, stereo: true, release: 1.2, level: 0.4,
    render(c, f, bright) {
      const merge = c.createChannelMerger(2);
      const side = (detunes, ch) => {
        const mix = c.createGain(); mix.gain.value = 0.35;
        for (const dt of detunes) osc(c, 'sawtooth', f, dt).connect(mix);
        const tri = osc(c, 'triangle', f / 2); const tg = c.createGain(); tg.gain.value = 0.4; tri.connect(tg).connect(mix);
        const lp = lowpass(c, 1, 0.8);
        lp.frequency.setValueAtTime(cap(400 + f), 0);
        lp.frequency.linearRampToValueAtTime(cap(1300 + 900 * bright + f * 1.5), 1.2);
        mix.connect(lp).connect(merge, 0, ch);
      };
      side([-12, 5], 0);
      side([-5, 12], 1);
      const amp = c.createGain();
      merge.connect(amp);
      ampEnv(amp, this.dur, { a: 0.45, d: 0.5, sus: 0.9, fade: 2.2 });
      amp.connect(c.destination);
    },
  },

  // Synth bass: saw + square sub through a resonant low-pass with a fast "pluck" sweep
  bass: {
    dur: 3, stereo: false, release: 0.15, level: 0.6,
    render(c, f, bright) {
      // saw + square exactly in tune: a sub-octave made notes read an octave low, and detuning
      // them let the fundamentals cancel every few seconds (a hollow, pulsing low end)
      const a = osc(c, 'sawtooth', f), sub = osc(c, 'square', f);
      const sg = c.createGain(); sg.gain.value = 0.55;
      const mix = c.createGain(); mix.gain.value = 0.6;
      a.connect(mix); sub.connect(sg).connect(mix);
      const lp = lowpass(c, 1, 5);
      lp.frequency.setValueAtTime(cap(f * 6 + 1800 * bright + 600), 0);
      lp.frequency.setTargetAtTime(cap(f * 2.2 + 180), 0.005, 0.09);
      const amp = c.createGain();
      mix.connect(lp).connect(amp);
      ampEnv(amp, this.dur, { a: 0.003, d: 0.35, sus: 0.7, fade: 0.8 });
      amp.connect(c.destination);
      a.start(0); sub.start(0);
    },
  },

  // Synth brass: the filter opens with the note (the "blat"), then settles
  brass: {
    dur: 4, stereo: false, release: 0.25, level: 0.5,
    render(c, f, bright) {
      const a = osc(c, 'sawtooth', f, -5), b = osc(c, 'sawtooth', f, 5);
      const mix = c.createGain(); mix.gain.value = 0.5;
      a.connect(mix); b.connect(mix);
      const lp = lowpass(c, 1, 1.2);
      lp.frequency.setValueAtTime(cap(f * 1.2 + 200), 0);
      lp.frequency.linearRampToValueAtTime(cap(f * (6 + 4 * bright) + 1200), 0.09);
      lp.frequency.setTargetAtTime(cap(f * (3.5 + 2 * bright) + 700), 0.1, 0.25);
      const amp = c.createGain();
      mix.connect(lp).connect(amp);
      ampEnv(amp, this.dur, { a: 0.03, d: 0.3, sus: 0.88, fade: 1.2 });
      amp.connect(c.destination);
      a.start(0); b.start(0);
    },
  },

  // Analog pluck: bright and short, decays like a struck string
  pluck: {
    dur: 2.6, stereo: false, release: 0.2,
    render(c, f, bright) {
      const a = osc(c, 'sawtooth', f, -4), b = osc(c, pulseWave(c, 0.25), f, 4);
      const mix = c.createGain(); mix.gain.value = 0.5;
      a.connect(mix); b.connect(mix);
      const lp = lowpass(c, 1, 2.2);
      lp.frequency.setValueAtTime(cap(f * (12 + 10 * bright) + 2000), 0);
      lp.frequency.setTargetAtTime(cap(f * 1.5 + 250), 0.002, 0.07 + 0.05 * bright);
      const amp = c.createGain();
      amp.gain.setValueAtTime(0, 0);
      amp.gain.linearRampToValueAtTime(1, 0.002);
      amp.gain.setTargetAtTime(0, 0.003, 0.45);
      mix.connect(lp).connect(amp);
      amp.connect(c.destination);
      a.start(0); b.start(0);
    },
  },

  // ---- sounds chosen from what current K-pop / pop / J-pop records use (docs/instruments.md) ----

  // Supersaw: seven saws spread a little apart in pitch and across the stereo field — EDM drops,
  // K-pop choruses, trance-pop leads and chords
  supersaw: {
    dur: 4, stereo: true, release: 0.35, level: 0.42,
    render(c, f, bright) {
      const merge = c.createChannelMerger(2);
      const detunes = [-31, -19, -9, 0, 9, 19, 31];
      const side = [c.createGain(), c.createGain()];
      side[0].gain.value = side[1].gain.value = 0.22;
      detunes.forEach((dt, i) => {
        const o = osc(c, 'sawtooth', f, dt * (0.8 + 0.2 * bright));
        // centre voice in both sides, the rest alternate left / right
        if (i === 3) { o.connect(side[0]); o.connect(side[1]); } else o.connect(side[i % 2]);
      });
      for (let ch = 0; ch < 2; ch++) {
        const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = Math.min(f * 0.5, 120);
        const lp = lowpass(c, 1, 0.6);
        lp.frequency.setValueAtTime(cap(f * (14 + 10 * bright) + 2500), 0);
        lp.frequency.setTargetAtTime(cap(f * (8 + 6 * bright) + 1800), 0.02, 0.3);
        side[ch].connect(hp).connect(lp).connect(merge, 0, ch);
      }
      const amp = c.createGain();
      merge.connect(amp);
      ampEnv(amp, this.dur, { a: 0.008, d: 0.3, sus: 0.9, fade: 1.1 });
      amp.connect(c.destination);
    },
  },

  // 808 bass: a sine that drops into pitch with a soft saturation so it carries on small speakers;
  // long decay like the hip-hop / trap / K-pop 808
  sub808: {
    dur: 3.6, stereo: false, release: 0.12, level: 0.75,
    render(c, f, bright) {
      const o = osc(c, 'sine', f * 1.9);
      o.frequency.setValueAtTime(f * 1.9, 0);
      o.frequency.setTargetAtTime(f, 0.001, 0.018);
      const drive = c.createWaveShaper();
      const k = 1.4 + 2.2 * bright, curve = new Float32Array(2048);
      for (let i = 0; i < 2048; i++) { const x = i / 1023.5 - 1; curve[i] = Math.tanh(x * k) / Math.tanh(k); }
      drive.curve = curve;
      const lp = lowpass(c, cap(f * 7 + 600), 0.5);
      const amp = c.createGain();
      amp.gain.setValueAtTime(0, 0);
      amp.gain.linearRampToValueAtTime(1, 0.003);
      amp.gain.setValueAtTime(1, 0.08);
      amp.gain.setTargetAtTime(0, 0.08, 0.55 + 0.9 * Math.min(1, 80 / f));
      o.connect(drive).connect(lp).connect(amp);
      amp.connect(c.destination);
    },
  },

  // Reese bass: two saws a few cents apart beating against each other, darkened
  reese: {
    dur: 4, stereo: true, release: 0.2, level: 0.5,
    render(c, f, bright) {
      const merge = c.createChannelMerger(2);
      [[-11, 7], [11, -6]].forEach(([d1, d2], ch) => {
        const mix = c.createGain(); mix.gain.value = 0.5;
        osc(c, 'sawtooth', f, d1).connect(mix);
        osc(c, 'sawtooth', f, d2).connect(mix);
        const lp = lowpass(c, cap(f * (3 + 3 * bright) + 280), 0.9);
        mix.connect(lp).connect(merge, 0, ch);
      });
      const amp = c.createGain();
      merge.connect(amp);
      ampEnv(amp, this.dur, { a: 0.006, d: 0.2, sus: 0.95, fade: 1 });
      amp.connect(c.destination);
    },
  },

  // FM electric piano in the manner of the 80s digital EP: a body pair (1:1) and a short bright
  // "tine" pair (14:1) — city pop, J-pop and R&B ballads
  fmep: {
    dur: 4.5, stereo: false, release: 0.35, level: 0.6,
    render(c, f, bright) {
      const decayT = 0.9 + 1.4 * Math.min(1, 220 / f);
      const pair = (ratio, index, tauI, level) => {
        const car = osc(c, 'sine', f);
        const mod = osc(c, 'sine', f * ratio);
        const mi = c.createGain();
        mi.gain.setValueAtTime(f * ratio * index, 0);
        mi.gain.setTargetAtTime(f * ratio * index * 0.12, 0.002, tauI);
        mod.connect(mi).connect(car.frequency);
        const g = c.createGain(); g.gain.value = level;
        car.connect(g);
        return g;
      };
      const body = pair(1, 0.6 + 1.4 * bright, 0.5, 1);
      const tine = pair(14, 0.25 + 0.5 * bright, 0.03, 0.35 + 0.25 * bright);
      const amp = c.createGain();
      body.connect(amp); tine.connect(amp);
      amp.gain.setValueAtTime(0, 0);
      amp.gain.linearRampToValueAtTime(1, 0.002);
      amp.gain.setTargetAtTime(0, 0.003, decayT);
      amp.connect(c.destination);
    },
  },

  // FM bell: a 1:4 pair whose brightness dies away, plus a quicker 3:7 "strike" pair. Both pairs
  // stay harmonic so the bell sounds at the key played (a 1:3.5 pair reads an octave low)
  fmbell: {
    dur: 5, stereo: false, release: 0.8, level: 0.5,
    render(c, f, bright) {
      const pair = (cr, mr, index, tauI, level, tauA) => {
        if (f * cr > SR * 0.45) return;
        const car = osc(c, 'sine', f * cr), mod = osc(c, 'sine', f * mr);
        const mi = c.createGain();
        mi.gain.setValueAtTime(f * mr * index, 0);
        mi.gain.setTargetAtTime(f * mr * index * 0.08, 0.002, tauI);
        mod.connect(mi).connect(car.frequency);
        const g = c.createGain();
        g.gain.setValueAtTime(0, 0); g.gain.linearRampToValueAtTime(level, 0.002); g.gain.setTargetAtTime(0, 0.003, tauA);
        car.connect(g).connect(c.destination);
      };
      pair(1, 4, 0.9 + 1.3 * bright, 0.9, 1, 1.7);
      pair(3, 7, 0.6 + 0.8 * bright, 0.15, 0.25 + 0.15 * bright, 0.35);
    },
  },

  // Chiptune square: 8-bit game-console lead (hyperpop, J-pop game songs)
  chip: {
    dur: 3, stereo: false, release: 0.04, level: 0.35,
    render(c, f, bright) {
      const o = osc(c, pulseWave(c, bright > 0.5 ? 0.5 : 0.25, 48), f);
      const lfo = osc(c, 'sine', 6), depth = c.createGain();
      depth.gain.setValueAtTime(0, 0); depth.gain.setValueAtTime(0, 0.3); depth.gain.linearRampToValueAtTime(f * 0.008, 0.6);
      lfo.connect(depth).connect(o.frequency);
      const amp = c.createGain();
      ampEnv(amp, this.dur, { a: 0.001, d: 0.05, sus: 0.9, fade: 0.3 });
      o.connect(amp).connect(c.destination);
    },
  },

  // Drawbar organ: 8' 4' 2⅔' 2' sines, a decaying third-harmonic "percussion", key click and a
  // slow rotary-speaker shimmer between the two sides — gospel, R&B, funk
  drawbar: {
    dur: 5, stereo: true, release: 0.06, level: 0.45,
    render(c, f, bright) {
      const merge = c.createChannelMerger(2);
      for (let ch = 0; ch < 2; ch++) {
        const mix = c.createGain(); mix.gain.value = 0.32;
        const lfo = osc(c, 'sine', 6.4 + ch * 0.37), dep = c.createGain(); dep.gain.value = 5 + ch * 2;
        for (const [ratio, lvl] of [[1, 1], [2, 0.7], [3, 0.45], [4, 0.35]]) {
          if (f * ratio > SR * 0.45) continue;
          const o = osc(c, 'sine', f * ratio);
          lfo.connect(dep).connect(o.detune);
          const g = c.createGain(); g.gain.value = lvl;
          o.connect(g).connect(mix);
        }
        if (f * 3 < SR * 0.45) {
          const p = osc(c, 'sine', f * 3), pg = c.createGain();
          pg.gain.setValueAtTime(0.6 * bright + 0.2, 0); pg.gain.setTargetAtTime(0, 0.002, 0.2);
          p.connect(pg).connect(mix);
        }
        mix.connect(merge, 0, ch);
      }
      const click = c.createBufferSource();
      { const n = Math.round(SR * 0.006), b = c.createBuffer(1, n, SR), d = b.getChannelData(0); let s = 7; for (let i = 0; i < n; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; d[i] = ((s / 0x3fffffff) - 1) * (1 - i / n); } click.buffer = b; }
      const cg = c.createGain(); cg.gain.value = 0.05 + 0.05 * bright;
      const chp = c.createBiquadFilter(); chp.type = 'bandpass'; chp.frequency.value = 2500;
      click.connect(chp).connect(cg).connect(merge, 0, 0); cg.connect(merge, 0, 1);
      click.start(0);
      const amp = c.createGain();
      merge.connect(amp);
      ampEnv(amp, this.dur, { a: 0.004, d: 0.05, sus: 1, fade: 0.3 });
      amp.connect(c.destination);
    },
  },

  // Synth choir: chorused saws and a little breath through "ah" formants, slow vibrato
  choir: {
    dur: 6, stereo: true, release: 0.9, level: 0.45,
    render(c, f, bright) {
      const merge = c.createChannelMerger(2);
      const formants = [[750, 7, 1], [1150, 9, 0.5], [2700, 11, 0.22 + 0.15 * bright], [3400, 12, 0.1]];
      [[-9, 4], [-4, 10]].forEach((dts, ch) => {
        const src = c.createGain(); src.gain.value = 0.4;
        const lfo = osc(c, 'sine', 5.2 + ch * 0.4), dep = c.createGain();
        dep.gain.setValueAtTime(0, 0); dep.gain.linearRampToValueAtTime(14, 1.2);
        for (const dt of dts) { const o = osc(c, 'sawtooth', f, dt); lfo.connect(dep).connect(o.detune); o.connect(src); }
        const out = c.createGain(); out.gain.value = 1;
        for (const [ff, q, g] of formants) {
          const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = ff; bp.Q.value = q;
          const gg = c.createGain(); gg.gain.value = g * 2.2;
          src.connect(bp).connect(gg).connect(out);
        }
        const body = lowpass(c, cap(f * 3 + 300), 0.7), bg = c.createGain(); bg.gain.value = 0.35;
        src.connect(body).connect(bg).connect(out);
        out.connect(merge, 0, ch);
      });
      const amp = c.createGain();
      merge.connect(amp);
      ampEnv(amp, this.dur, { a: 0.28, d: 0.4, sus: 0.92, fade: 1.8 });
      amp.connect(c.destination);
    },
  },

  // Clavinet: a struck, damped string read by a pickup — a narrow pulse through a bright,
  // resonant band that closes as the note decays, plus the pickup's click; funk and disco comping
  clavinet: {
    dur: 2.4, stereo: false, release: 0.05, level: 0.5,
    render(c, f, bright) {
      const o = osc(c, pulseWave(c, 0.18, 64), f);
      const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = cap(f * 0.9); hp.Q.value = 0.5;
      const bp = c.createBiquadFilter(); bp.type = 'lowpass'; bp.Q.value = 3.5 + 2 * bright;
      bp.frequency.setValueAtTime(cap(f * (9 + 6 * bright)), 0);
      bp.frequency.setTargetAtTime(cap(f * 2.2 + 400), 0.004, 0.18);
      const amp = c.createGain();
      amp.gain.setValueAtTime(0, 0);
      amp.gain.linearRampToValueAtTime(1, 0.002);
      amp.gain.setTargetAtTime(0.32, 0.002, 0.12);
      amp.gain.setTargetAtTime(0, 0.5, 0.45);
      o.connect(hp).connect(bp).connect(amp).connect(c.destination);
      const click = c.createBufferSource();
      { const n = Math.round(SR * 0.004), b = c.createBuffer(1, n, SR), d = b.getChannelData(0); let s = 11; for (let i = 0; i < n; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; d[i] = ((s / 0x3fffffff) - 1) * (1 - i / n); } click.buffer = b; }
      const cbp = c.createBiquadFilter(); cbp.type = 'bandpass'; cbp.frequency.value = cap(f * 6 + 1800); cbp.Q.value = 1.2;
      const cg = c.createGain(); cg.gain.value = 0.18 + 0.12 * bright;
      click.connect(cbp).connect(cg).connect(c.destination); click.start(0);
    },
  },

  // Calliope lead: a steam whistle — an almost pure tone with a breathy edge that blooms in,
  // a little chiff at the start and a slow, wide vibrato
  calliope: {
    dur: 4, stereo: false, release: 0.12, level: 0.45,
    render(c, f, bright) {
      const o = osc(c, 'sine', f), o2 = osc(c, 'triangle', f * 2);
      const g2 = c.createGain(); g2.gain.value = 0.12 + 0.1 * bright;
      const lfo = osc(c, 'sine', 5.8), dep = c.createGain();
      dep.gain.setValueAtTime(0, 0); dep.gain.linearRampToValueAtTime(f * 0.012, 0.9);
      lfo.connect(dep); dep.connect(o.frequency); dep.connect(o2.frequency);
      const amp = c.createGain();
      ampEnv(amp, this.dur, { a: 0.03, d: 0.2, sus: 0.9, fade: 0.4 });
      o.connect(amp); o2.connect(g2).connect(amp);
      // breath: noise in a band around the note, steady under the tone
      const n = c.createBufferSource();
      { const len = SR * this.dur, b = c.createBuffer(1, len, SR), d = b.getChannelData(0); let s = 5; for (let i = 0; i < len; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; d[i] = (s / 0x3fffffff) - 1; } n.buffer = b; }
      const nb = c.createBiquadFilter(); nb.type = 'bandpass'; nb.frequency.value = cap(f * 2); nb.Q.value = 2.5;
      const ng = c.createGain(); ng.gain.setValueAtTime(0.0, 0); ng.gain.linearRampToValueAtTime(0.5, 0.01); ng.gain.setTargetAtTime(0.12 + 0.08 * bright, 0.01, 0.05);
      n.connect(nb).connect(ng).connect(amp); n.start(0);
      amp.connect(c.destination);
    },
  },

  // Brightness pad: airy and glassy — detuned saws through an open filter, a soft octave above,
  // slow swell and shimmer (General MIDI "FX 5 brightness")
  brightness: {
    dur: 6, stereo: true, release: 1.2, level: 0.35,
    render(c, f, bright) {
      const merge = c.createChannelMerger(2);
      [[-11, 7], [-6, 12]].forEach((dts, ch) => {
        const sum = c.createGain(); sum.gain.value = 0.3;
        for (const dt of dts) osc(c, 'sawtooth', f, dt).connect(sum);
        const oct = osc(c, 'sine', f * 2, ch ? 4 : -4), og = c.createGain(); og.gain.value = 0.35; oct.connect(og).connect(sum);
        const lp = lowpass(c, cap(f * (10 + 8 * bright) + 2500), 0.9);
        const trem = osc(c, 'sine', 0.35 + ch * 0.11), td = c.createGain(); td.gain.value = 0.12;
        const out = c.createGain(); out.gain.value = 0.9;
        trem.connect(td).connect(out.gain);
        sum.connect(lp).connect(out).connect(merge, 0, ch);
      });
      const amp = c.createGain();
      merge.connect(amp);
      ampEnv(amp, this.dur, { a: 0.7, d: 0.6, sus: 0.85, fade: 1.8 });
      amp.connect(c.destination);
    },
  },

  // Scratch / fret noise: a quick squeal of noise through a resonant band that sweeps up and back
  // around the key — guitar slides and turntable scratches (General MIDI "guitar fret noise")
  fretnoise: {
    dur: 0.8, stereo: false, release: 0.04, level: 0.45,
    render(c, f, bright) {
      const n = c.createBufferSource();
      { const len = Math.round(SR * this.dur), b = c.createBuffer(1, len, SR), d = b.getChannelData(0); let s = 9; for (let i = 0; i < len; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; d[i] = (s / 0x3fffffff) - 1; } n.buffer = b; }
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 9 + 6 * bright;
      const base = cap(f * 2 + 300);
      bp.frequency.setValueAtTime(base * 0.6, 0);
      bp.frequency.exponentialRampToValueAtTime(cap(base * 2.4), 0.12);
      bp.frequency.exponentialRampToValueAtTime(base * 0.8, 0.32);
      const amp = c.createGain();
      amp.gain.setValueAtTime(0, 0);
      amp.gain.linearRampToValueAtTime(1, 0.01);
      amp.gain.setTargetAtTime(0.5, 0.12, 0.05);
      amp.gain.setTargetAtTime(0, 0.3, 0.08);
      const drive = c.createGain(); drive.gain.value = 3.2;
      n.connect(bp).connect(drive).connect(amp).connect(c.destination); n.start(0);
    },
  },

  // Voice "oohs": the choir with its mouth rounded — "oo" formants, a darker body, softer onset
  // (General MIDI "Voice Oohs")
  oohs: {
    dur: 6, stereo: true, release: 0.9, level: 0.5,
    render(c, f, bright) {
      const merge = c.createChannelMerger(2);
      const formants = [[320, 7, 1], [800, 9, 0.38], [2400, 11, 0.08 + 0.06 * bright], [3200, 12, 0.04]];
      [[-8, 5], [-3, 9]].forEach((dts, ch) => {
        const src = c.createGain(); src.gain.value = 0.4;
        const lfo = osc(c, 'sine', 5 + ch * 0.35), dep = c.createGain();
        dep.gain.setValueAtTime(0, 0); dep.gain.linearRampToValueAtTime(12, 1.3);
        for (const dt of dts) { const o = osc(c, 'sawtooth', f, dt); lfo.connect(dep).connect(o.detune); o.connect(src); }
        const out = c.createGain(); out.gain.value = 1;
        for (const [ff, q, g] of formants) {
          const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = ff; bp.Q.value = q;
          const gg = c.createGain(); gg.gain.value = g * 2.4;
          src.connect(bp).connect(gg).connect(out);
        }
        const body = lowpass(c, cap(f * 2 + 250), 0.7), bg = c.createGain(); bg.gain.value = 0.45;
        src.connect(body).connect(bg).connect(out);
        out.connect(merge, 0, ch);
      });
      const amp = c.createGain();
      merge.connect(amp);
      ampEnv(amp, this.dur, { a: 0.35, d: 0.4, sus: 0.92, fade: 1.8 });
      amp.connect(c.destination);
    },
  },

  // Log drum (amapiano): a pitched, woody thump that slides down into the note
  logdrum: {
    dur: 1.8, stereo: false, release: 0.1, level: 0.7,
    render(c, f, bright) {
      const o = osc(c, 'sine', f * 1.7), t = osc(c, 'triangle', f * 1.7);
      for (const x of [o, t]) { x.frequency.setValueAtTime(f * 1.7, 0); x.frequency.setTargetAtTime(f, 0.001, 0.014); }
      const tg = c.createGain(); tg.gain.value = 0.35 + 0.25 * bright;
      const mix = c.createGain(); o.connect(mix); t.connect(tg).connect(mix);
      const lp = lowpass(c, 1, 3);
      lp.frequency.setValueAtTime(cap(f * 8 + 1500 * bright), 0);
      lp.frequency.setTargetAtTime(cap(f * 2 + 120), 0.004, 0.06);
      const drive = c.createWaveShaper(), curve = new Float32Array(1024);
      for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; curve[i] = Math.tanh(x * 2) / Math.tanh(2); }
      drive.curve = curve;
      const amp = c.createGain();
      amp.gain.setValueAtTime(0, 0); amp.gain.linearRampToValueAtTime(1, 0.002); amp.gain.setTargetAtTime(0, 0.01, 0.28);
      mix.connect(lp).connect(drive).connect(amp);
      amp.connect(c.destination);
    },
  },
};

// procedural manifest -> sample table + regions (one sample per `step` semitones, `layers` velocity bands)
export function expand(m) {
  const P = m.procedural;
  if (KITS[P.patch]) return expandKit(m);
  const patch = PATCHES[P.patch];
  const step = P.step || 3, layers = P.layers || 2;
  const lo = P.lo ?? 21, hi = P.hi ?? 108;
  const samples = {}, regions = [];
  for (let L = 0; L < layers; L++) {
    const [lv, hv] = [Math.round((L * 127) / layers) + 1, Math.round(((L + 1) * 127) / layers)];
    for (let c = lo + Math.floor(step / 2); c <= hi + step; c += step) {
      const s = `gen/${P.patch}/${c}/${L}`;
      samples[s] = { rate: SR, ch: patch.stereo ? 2 : 1, dur: patch.dur, note: c, layer: L, layers };
      regions.push({ s, lo: c - Math.floor(step / 2), hi: c - Math.floor(step / 2) + step - 1, c, t: 0, lv, hv, g: 1, r: patch.release, off: 0 });
    }
  }
  return { ...m, gain: m.gain ?? 1, samples, regions };
}

// render one sample (an AudioBuffer), peak-normalised so every note sits at the same level
export async function renderSample(m, s) {
  if (KITS[m.procedural.patch]) return renderKitSample(m, s);
  const meta = m.samples[s], patch = PATCHES[m.procedural.patch];
  const c = new OfflineAudioContext(patch.stereo ? 2 : 1, Math.ceil(patch.dur * SR), SR);
  const f = 440 * Math.pow(2, (meta.note - 69) / 12);
  const bright = meta.layers > 1 ? meta.layer / (meta.layers - 1) : 1;
  // every oscillator a patch creates is started at 0 (patches only build the graph)
  const realOsc = c.createOscillator.bind(c);
  const made = [];
  c.createOscillator = () => { const o = realOsc(); made.push(o); return o; };
  patch.render(c, f, bright);
  for (const o of made) { try { o.start(0); } catch { /* already started */ } }
  const buf = await c.startRendering();
  let peak = 0;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; } }
  const target = 0.2 * (patch.level ?? 1) * (0.75 + 0.25 * bright); // sits level with the sampled pianos
  if (peak > 0) for (let ch = 0; ch < buf.numberOfChannels; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < d.length; i++) d[i] *= target / peak; }
  return buf;
}

// ---- drum kits: one sample per key (no pitch shifting), two velocity layers ----
function expandKit(m) {
  const P = m.procedural, kit = KITS[P.patch], layers = P.layers || 2;
  const samples = {}, regions = [];
  for (const [key, snd] of Object.entries(kit)) {
    const n = +key;
    for (let L = 0; L < layers; L++) {
      const [lv, hv] = [Math.round((L * 127) / layers) + 1, Math.round(((L + 1) * 127) / layers)];
      const s = `gen/${P.patch}/${n}/${L}`;
      samples[s] = { rate: SR, ch: 1, dur: snd.dur, note: n, layer: L, layers };
      regions.push({ s, lo: n, hi: n, c: n, t: 0, lv, hv, g: 1, r: 0.08, off: 0 });
    }
  }
  return { ...m, gain: m.gain ?? 1, samples, regions };
}

async function renderKitSample(m, s) {
  const meta = m.samples[s], snd = KITS[m.procedural.patch][meta.note];
  const c = new OfflineAudioContext(1, Math.ceil(snd.dur * SR), SR);
  const bright = meta.layers > 1 ? meta.layer / (meta.layers - 1) : 1;
  snd.render(c, bright);
  const buf = await c.startRendering();
  const d = buf.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; }
  const target = 0.3 * (0.7 + 0.3 * bright);
  if (peak > 0) for (let i = 0; i < d.length; i++) d[i] *= target / peak;
  // a few ms fade at the end so nothing clicks off
  const f = Math.min(d.length, Math.round(SR * 0.005));
  for (let i = 0; i < f; i++) d[d.length - 1 - i] *= i / f;
  return buf;
}
