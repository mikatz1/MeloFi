// An instrument made from a separated stem: clean single notes of the recording, cut out and
// spread over the keyboard (a sample channel, media.js sampleInstrument with spec.cuts). The MIDI
// stays editable; the sound is the song's own. docs/roundtrip-eval.md section 8.
//
// A note is a good sample when it sounds alone in its stem, its energy sits on the partials of its
// pitch (timbre.js `sal`: what bleeds in from other instruments or a reverb tail lowers it), it is
// long enough to hear, and the stem is quiet again before the next note. For every pitch the stem
// plays, the cleanest such note is kept; the keys between two kept pitches go to the nearer one,
// played a few semitones off. A stem that plays chords, or that has too few clean notes for the
// pitches it uses, gets no instrument (null): the caller falls back to matching a preset.
import * as T from './timbre.js';

const MIN_LEN = 0.12;      // seconds: shorter notes say too little about the sound
const MIN_SAL = 0.45;      // share of the note's energy on its own partials
const MAX_TAIL = 0.3;      // seconds kept after the note's end (its release), up to the next note
const MAX_SHIFT = 7;       // semitones a cut may be played away from its own pitch
const HEAD = 0.004;        // seconds before the transcribed onset (the attack starts a little early)

// notes: [[t, d, n, v]] of one stem (or one part of it), x / rate: the stem's audio, mono.
// Returns { cuts, wav: { left, rate }, coverage, clean, poly, pitches } or null.
//   cuts: [{ start, end, root, lo, hi, g, release }] in seconds of `wav` (the kept notes back to back)
//   coverage: share of the stem's notes within MAX_SHIFT of a kept pitch; clean: their median sal
export function stemInstrument(x, rate, notes, { minCoverage = 0.8, maxPoly = 0.2, minCuts = 2 } = {}) {
  const ns = notes.filter((q) => q[1] > 0.03).slice().sort((a, b) => a[0] - b[0]);
  if (ns.length < 8) return null;
  // how much of the stem is chords: notes that start while another is well under way, or together
  let over = 0;
  const alone = ns.map((q, i) => {
    const a = q[0], b = q[0] + q[1];
    let ok = true;
    for (let j = i - 1; j >= 0 && ns[j][0] > a - 8; j--) if (ns[j][0] + ns[j][1] > a + 0.04) { ok = false; break; }
    if (ok) for (let j = i + 1; j < ns.length && ns[j][0] < b - 0.04; j++) if (ns[j][0] < a + 0.04 || ns[j][0] < b - Math.min(0.5 * q[1], 0.15)) { ok = false; break; }
    if (!ok) over++;
    return ok;
  });
  const poly = over / ns.length;
  if (poly > maxPoly) return null;
  // candidates: alone, long enough, measured
  const best = new Map(); // pitch -> { i, sal, score, lvl }
  ns.forEach((q, i) => {
    const [t, d, n] = q;
    if (!alone[i] || d < MIN_LEN) return;
    const f = T.noteFeatures(x, rate, t, d, n, {});
    if (!f || f.sal < MIN_SAL) return;
    // the cleanest, with a little for length (a longer note carries its decay) and loudness
    const score = f.sal + 0.08 * Math.min(1, d / 0.6) + 0.002 * Math.max(-40, f.lvl);
    const cur = best.get(n);
    if (!cur || score > cur.score) best.set(n, { i, sal: f.sal, score, lvl: f.lvl });
  });
  const pitches = [...best.keys()].sort((a, b) => a - b);
  if (pitches.length < minCuts) return null;
  const near = (n) => pitches.reduce((b, p) => (Math.abs(p - n) < Math.abs(b - n) ? p : b), pitches[0]);
  const covered = ns.filter((q) => Math.abs(near(q[2]) - q[2]) <= MAX_SHIFT).length / ns.length;
  if (covered < minCoverage) return null;
  // the cuts, back to back in one small recording (it travels with the project as media)
  const GAP = Math.round(0.02 * rate), parts = [], cuts = [];
  let at = 0;
  const peakOf = (a, b) => { let p = 0; for (let k = a; k < b; k++) { const v = Math.abs(x[k]); if (v > p) p = v; } return p; };
  const peaks = pitches.map((n) => { const q = ns[best.get(n).i]; return peakOf(Math.round(q[0] * rate), Math.round((q[0] + q[1]) * rate)); });
  const ref = T.median(peaks.filter((p) => p > 0)) || 1;
  pitches.forEach((n, k) => {
    const { i } = best.get(n), [t, d] = ns[i];
    const next = ns[i + 1] ? ns[i + 1][0] : Infinity;
    const a = Math.max(0, Math.round((t - HEAD) * rate)), b = Math.min(x.length, Math.round(Math.min(t + d + MAX_TAIL, next - 0.005) * rate));
    if (b - a < MIN_LEN * rate * 0.8) return;
    const seg = x.slice(a, b);
    // fades: a few ms in (the cut starts just before the attack), the tail out
    const fi = Math.min(seg.length, Math.round(0.002 * rate)), fo = Math.min(seg.length, Math.round(0.03 * rate));
    for (let j = 0; j < fi; j++) seg[j] *= j / fi;
    for (let j = 0; j < fo; j++) seg[seg.length - 1 - j] *= j / fo;
    const lo = k === 0 ? 0 : Math.floor((pitches[k - 1] + n) / 2) + 1, hi = k === pitches.length - 1 ? 127 : Math.floor((n + pitches[k + 1]) / 2);
    cuts.push({ start: at / rate, end: (at + seg.length) / rate, root: n, lo, hi, g: +(Math.min(4, Math.max(0.25, ref / (peaks[k] || ref)))).toFixed(3), release: 0.08, sal: +best.get(n).sal.toFixed(3) });
    parts.push(seg);
    at += seg.length + GAP;
  });
  if (cuts.length < minCuts) return null;
  // every key belongs to the nearest kept pitch (a note that was too short to cut leaves no hole)
  cuts.forEach((c, k) => { c.lo = k === 0 ? 0 : Math.floor((cuts[k - 1].root + c.root) / 2) + 1; c.hi = k === cuts.length - 1 ? 127 : Math.floor((c.root + cuts[k + 1].root) / 2); });
  const left = new Float32Array(at);
  let o = 0;
  for (const seg of parts) { left.set(seg, o); o += seg.length + GAP; }
  return { cuts, wav: { left, rate }, coverage: covered, clean: T.median(cuts.map((c) => c.sal)), poly, pitches };
}

// A drum kit made from the separated drum parts (kick, snare, hi-hat, toms, ride, crash): for each
// drum the transcription wrote, one hit of the recording, cut from that drum's own part so a hat
// that fell on the kick is not in the kick. The hit kept is one that rings out before the same drum
// is struck again and that was played about as hard as the drum's louder hits.
//   parts: { [GM note]: Float32Array } (the part's audio for each note the kit should play)
//   hits: [[t, d, n, v]]
// Returns { cuts, wav: { left, rate }, coverage } or null. Each cut sits on its own key only.
const RING = { 36: 0.35, 38: 0.45, 42: 0.25, 45: 0.6, 51: 1.2, 49: 1.8 }; // seconds a drum is given to ring
export function stemDrumKit(parts, rate, hits, { minCoverage = 0.95 } = {}) {
  const by = new Map();
  for (const h of hits) { if (!by.has(h[2])) by.set(h[2], []); by.get(h[2]).push(h); }
  const GAP = Math.round(0.02 * rate), segs = [], cuts = [];
  let at = 0, covered = 0;
  for (const [n, list] of [...by.entries()].sort((a, b) => a[0] - b[0])) {
    const x = parts[n];
    if (!x) continue;
    list.sort((a, b) => a[0] - b[0]);
    const want = RING[n] || 0.4;
    const vs = list.map((h) => h[3] || 90).sort((a, b) => a - b), v80 = vs[Math.floor(0.8 * (vs.length - 1))];
    let best = null;
    list.forEach((h, i) => {
      const free = Math.min(want, (list[i + 1]?.[0] ?? Infinity) - h[0] - 0.005, x.length / rate - h[0]);
      if (free < 0.05) return;
      const score = free / want - Math.abs((h[3] || 90) - v80) / 127;
      if (!best || score > best.score) best = { h, free, score };
    });
    if (!best) continue;
    const a = Math.max(0, Math.round((best.h[0] - HEAD) * rate)), b = Math.min(x.length, Math.round((best.h[0] + best.free) * rate));
    const seg = x.slice(a, b);
    let pk = 0;
    for (let j = 0; j < seg.length; j++) { const v = Math.abs(seg[j]); if (v > pk) pk = v; }
    if (pk < 1e-3) continue;
    const fi = Math.min(seg.length, Math.round(0.001 * rate)), fo = Math.min(seg.length, Math.round(Math.min(0.08, 0.3 * best.free) * rate));
    for (let j = 0; j < fi; j++) seg[j] *= j / fi;
    for (let j = 0; j < fo; j++) seg[seg.length - 1 - j] *= j / fo;
    // played at the velocity it was struck with, the cut sounds as loud as it was (the sampler's
    // velocity curve, 0.45 + 0.55 v^2, undone)
    const xv = (best.h[3] || 90) / 127;
    cuts.push({ start: at / rate, end: (at + seg.length) / rate, root: n, lo: n, hi: n, g: +(1 / (0.45 + 0.55 * xv * xv)).toFixed(3), release: +(9 * best.free).toFixed(3) });
    segs.push(seg);
    at += seg.length + GAP;
    covered += list.length;
  }
  if (!cuts.length || covered / hits.length < minCoverage) return null;
  const left = new Float32Array(at);
  let o = 0;
  for (const seg of segs) { left.set(seg, o); o += seg.length + GAP; }
  return { cuts, wav: { left, rate }, coverage: covered / hits.length };
}
