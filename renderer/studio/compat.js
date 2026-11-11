// MeloFi Studio — keeping projects saved by older versions sounding as they did.
// migrate() (model.js) calls upgrade() for a project whose `version` is older than the current one.
// Every decision (what is kept, what deliberately changes) is written down in docs/compat.md.
import { autoMakeup } from './master-fx.js';

// Instrument loudness trims (dB) that version 3 brought in (instruments/levels.json, multiplied into
// each manifest's gain in bb98162). A channel of a version-2 project gets the opposite back as a
// hidden input gain (ch.legacyGain), so the mix keeps the balance it was made with.
// This is a snapshot on purpose: later re-measurements must come with a new version step.
export const LEVEL_TRIMS_V3 = {
  acoustic: -0.8, acousticdrums: 1.4, altosax: -5, banjo: 7, brassstab: -6.2, brightness: 12.6, calliope: 0.7, cello: -4,
  chip: 8.7, choir: 3, chorus: -1.4, clarinet: -8.5, clavinet: 6.9, cleanguitar: 3.8, contrabass: 1.9, cymbalswell: -3.3,
  dantranh: 4.6, drawbar: -1.3, drums808: 0.7, drums909: -1.3, drumstrap: -0.1, ebass: 9, electric: 5.4, erhu: 2.7,
  fingerbass: 9.3, flute: -10.4, fmbell: -5, fmep: -3.9, fretnoise: 4.6, glockenspiel: -1.2, handbells: -7.4, harmonica: -6.1,
  harp: -8.5, harpsichord: -5.2, headroom: -3.5, horn: -3.6, kalimba: 4.9, maestro: -1.8, marimba: -9.4, oboe: -7,
  oohs: 2.6, organ: -3.6, otamatone: 4.6, recorder: -17.8, reese: 6.6, rhodes: -2.1, salamander: -0.9, scary: -1.2,
  siren: 0.8, steeldrum: 0.8, strings: -3.1, stringspizz: -1.7, stringsstac: -1.5, sub808: -4.3, supersaw: 10.2, synbass: 2.3,
  synbrass: 4.6, synlead: 5.4, synpad: 9.5, synpluck: -0.4, synth: -1.1, tenorsax: -6.3, trombone: -3.9, trumpet: -5.6,
  upright: 2.3, vibraphone: -2.3, violin: 1.6, vocal: -7.8, wurlitzer: -7, xylophone: 3.4,
};

// the hidden input gain (dB) of a channel; only while it still plays the instrument it was saved with
export function legacyGainDb(ch) {
  const g = ch?.legacyGain;
  return g && (ch.kind || 'inst') === 'inst' && g.inst === ch.inst && Number.isFinite(g.db) ? g.db : 0;
}

const round = (v, s = 0.01) => +(Math.round(v / s) * s).toFixed(4);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
// the effect parameters this file remaps are linear: value <-> automation 0..1
const RANGES = { comp: { makeup: [0, 24] }, filter: { res: [0.1, 18] } };
const toV = (type, key, x) => { const [a, b] = RANGES[type][key]; return a + (b - a) * x; };
const toX = (type, key, v) => { const [a, b] = RANGES[type][key]; return clamp((v - a) / (b - a), 0, 1); };

// remap automation clips that drive one effect parameter
function remapAutos(p, stripId, fx, key, fn) {
  for (const a of p.autos || []) {
    if (a.target !== `fx:${stripId}:${fx.id}:${key}`) continue;
    a.points = (a.points || []).map((pt) => ({ ...pt, v: round(toX(fx.type, key, fn(toV(fx.type, key, pt.v))), 0.0001) }));
  }
}

// version 2 -> 3
function v2to3(p) {
  const strips = [...p.channels.map((c) => [c.id, c]), ...p.buses.map((b) => [b.id, b]), ['master', p.master]];
  for (const [id, s] of strips) {
    for (const fx of s.fx || []) {
      const prm = (fx.params ||= {});
      if (fx.type === 'comp') {
        // the browser's compressor added a hidden make-up gain; version 3 takes it out, so give it back
        // as the make-up knob (as far as the knob goes)
        const add = autoMakeup(prm.threshold ?? -18, prm.ratio ?? 4, prm.knee ?? 6);
        prm.makeup = round(clamp((prm.makeup ?? 4) + add, 0, 24), 0.1);
        remapAutos(p, id, fx, 'makeup', (v) => v + add);
      } else if (fx.type === 'filter' && Math.round(prm.type ?? 0) !== 2) {
        // low / high-pass resonance was the biquad's Q in dB; it is now a Q ratio (0.71 = flat)
        const conv = (r) => clamp(10 ** (r / 20), 0.1, 18);
        prm.res = round(conv(prm.res ?? 0.7));
        remapAutos(p, id, fx, 'res', conv);
      }
    }
  }
  for (const c of p.channels) {
    const t = LEVEL_TRIMS_V3[c.inst];
    if ((c.kind || 'inst') === 'inst' && t) c.legacyGain = { inst: c.inst, db: -t };
  }
}

const STEPS = { 2: v2to3 };

// bring a project from `from` up to `to` (both version numbers); changes it in place
export function upgrade(p, from, to) {
  for (let v = Math.max(2, from); v < to; v++) STEPS[v]?.(p);
  return p;
}
