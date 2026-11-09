// Shared bits for the score readers.

export const PPQ = 480; // ticks per quarter used internally by the readers

// Minimal zip reader (stored + deflate). Returns Map<name, () => Promise<Uint8Array>>.
export function unzip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('zip: no central directory');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const files = new Map();
  const dec = new TextDecoder();
  for (let k = 0; k < count; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const off = dv.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nlen));
    files.set(name, async () => {
      const start = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true);
      const data = bytes.subarray(start, start + csize);
      if (method === 0) return data;
      if (method === 8) {
        const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        return new Uint8Array(await new Response(stream).arrayBuffer());
      }
      throw new Error(`zip: method ${method}`);
    });
    p += 46 + nlen + xlen + clen;
  }
  return files;
}

// Play order of measures, the way MuseScore plays them back:
// repeats (with play counts), 1st/2nd... endings, D.C. / D.S. jumps, al Fine / al Coda,
// all within sections (a section break starts things over).
// measures: [{ startRepeat, endRepeat (total plays, 0 = none), endings: [1,2] | null,
//              jump: { to, until, cont, playRepeats } | null, markers: ['segno', ...], sectionBreak }]
export function unroll(measures) {
  const order = [];
  let s0 = 0;
  for (let i = 0; i <= measures.length; i++) {
    if (i === measures.length || measures[i].sectionBreak) {
      const end = i === measures.length ? i : i + 1;
      if (end > s0) unrollSection(measures, s0, end, order);
      s0 = end;
    }
  }
  return order;
}

function unrollSection(ms, s0, s1, order) {
  const find = (label) => {
    if (!label || label === 'start') return s0;
    if (label === 'end') return s1;
    for (let i = s0; i < s1; i++) if (ms[i].markers?.includes(label)) return i;
    return -1;
  };
  // last ending number of the volta group a measure belongs to (used when repeats are skipped after a jump)
  const lastEnding = (i) => {
    let j = i;
    while (j + 1 < s1 && ms[j + 1].endings) j++;
    let max = 0;
    for (let k = i; k <= j; k++) for (const e of ms[k].endings || []) max = Math.max(max, e);
    // a volta group continues past measures that start a new ending
    return max;
  };

  let i = s0, guard = 0;
  let repStart = s0;          // where an end repeat goes back to
  let pass = 1;               // which time through the current repeat
  const taken = new Map();    // end-repeat measure -> times already gone back
  const jumped = new Set();   // a jump is only taken once
  let until = null, cont = null, inJump = false, playRepeats = true;

  while (i < s1 && guard++ < 100000) {
    const m = ms[i];
    if (m.startRepeat && i !== repStart) { repStart = i; pass = 1; }

    if (m.endings) {
      const want = inJump && !playRepeats ? lastEnding(i) : pass;
      if (!m.endings.includes(want)) { i++; continue; }
    }
    order.push(i);

    // al Fine / al Coda: stop or carry on at the coda once the marker is reached
    if (until && m.markers?.includes(until)) {
      if (cont) {
        const c = find(cont);
        until = cont = null;
        if (c < 0) break;
        i = c;
        continue;
      }
      break;
    }

    if (m.endRepeat && (!inJump || playRepeats)) {
      const t = taken.get(i) || 0;
      if (t < m.endRepeat - 1) { taken.set(i, t + 1); pass++; i = repStart; continue; }
      taken.delete(i);
    }

    if (m.jump && !jumped.has(i)) {
      jumped.add(i);
      const to = find(m.jump.to);
      if (to >= 0) {
        inJump = true;
        playRepeats = !!m.jump.playRepeats;
        until = m.jump.until && m.jump.until !== 'end' ? m.jump.until : null;
        cont = m.jump.cont || null;
        i = to;
        repStart = to;
        pass = 1;
        taken.clear();
        continue;
      }
    }
    i++;
  }
}

export function parseEndings(s) {
  const out = [];
  for (const part of String(s).split(/[,\s]+/)) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part.trim());
    if (!m) continue;
    for (let x = +m[1]; x <= +(m[2] || m[1]); x++) out.push(x);
  }
  return out.length ? out : null;
}

// tempo: [{ tick, qps }] (quarters per second). Returns tick -> seconds.
export function tempoMap(tempos) {
  const list = [...tempos].sort((a, b) => a.tick - b.tick);
  if (!list.length || list[0].tick > 0) list.unshift({ tick: 0, qps: list[0]?.qps ?? 2 });
  const segs = [];
  let sec = 0;
  for (let i = 0; i < list.length; i++) {
    segs.push({ tick: list[i].tick, sec, qps: list[i].qps });
    if (i + 1 < list.length) sec += (list[i + 1].tick - list[i].tick) / PPQ / list[i].qps;
  }
  return (tick) => {
    let s = segs[0];
    for (const x of segs) { if (x.tick <= tick) s = x; else break; }
    return s.sec + (tick - s.tick) / PPQ / s.qps;
  };
}

// note list in ticks -> seconds; joins tied notes that were split by the readers
export function finishLine(notes, toSec) {
  return notes
    .filter((n) => n.dur > 0 && n.n >= 0 && n.n <= 127)
    .map((n) => ({ t: toSec(n.tick), d: Math.max(0.03, toSec(n.tick + n.dur) - toSec(n.tick)), n: n.n, v: n.v }))
    .sort((a, b) => a.t - b.t || a.n - b.n);
}

// ---------- ornaments ----------

// Diatonic neighbours in a major key with `fifths` sharps (+) or flats (-).
export function neighbours(fifths = 0) {
  const tonic = (((fifths * 7) % 12) + 12) % 12;
  const scale = new Set([0, 2, 4, 5, 7, 9, 11].map((x) => (x + tonic) % 12));
  const step = (p, dir) => {
    for (let k = 1; k <= 2; k++) if (scale.has((((p + dir * k) % 12) + 12) % 12)) return p + dir * k;
    return p + dir * 2;
  };
  return { up: (p) => step(p, 1), down: (p) => step(p, -1) };
}

const ORN_NOTE = 60; // ticks: a 32nd note, how fast ornaments are played

// Writes the notes an ornament stands for. kind: trill | upper-mordent | lower-mordent | turn | inverted-turn
export function expandOrnament(kind, start, len, pitch, vel, key, push) {
  const nb = neighbours(key);
  const up = nb.up(pitch), lo = nb.down(pitch);
  const q = Math.min(ORN_NOTE, len / 4);
  const seq = (pitches, rest = true) => {
    let t = start;
    for (const p of pitches) { push(t, q, p, vel); t += q; }
    if (rest && t < start + len) push(t, start + len - t, pitch, vel);
  };
  if (kind === 'trill') {
    let t = start, k = 0;
    while (t < start + len - q * 0.5) { push(t, Math.min(q, start + len - t), k % 2 ? up : pitch, vel - (k ? 6 : 0)); t += q; k++; }
  } else if (kind === 'upper-mordent') seq([pitch, up]);
  else if (kind === 'lower-mordent') seq([pitch, lo]);
  else if (kind === 'turn') seq([up, pitch, lo]);
  else if (kind === 'inverted-turn') seq([lo, pitch, up]);
  else push(start, len, pitch, vel);
}

export const GRACE_TICKS = 60; // a short grace (acciaccatura) lasts a 32nd, taken from the main note
export const ARP_TICKS = 24;   // spacing of a rolled chord

// MuseScore's default velocities for dynamic marks (MuseScore 4 omits <velocity> when default)
export const DYN_VELOCITY = {
  pppppp: 1, ppppp: 5, pppp: 10, ppp: 16, pp: 33, p: 49, mp: 64, mf: 80, f: 96, ff: 112, fff: 126, ffff: 127, fffff: 127, ffffff: 127,
  fp: 96, pf: 49, sf: 112, sfz: 112, sff: 126, sffz: 126, sfp: 112, sfpp: 112, rfz: 112, rf: 112, fz: 112, m: 96, r: 112, s: 112, z: 80, n: 49,
};

// Tempo list for the tick->seconds map: marks, gradual changes (as ramps) and fermata holds.
export function buildTempos(list, fermatas) {
  const marks = list.filter((x) => x.qps).sort((a, b) => a.tick - b.tick);
  const qAt = (t, arr) => { let q = 2; for (const x of arr) { if (x.tick <= t) q = x.qps; else break; } return q; };
  let out = [...marks];
  // gradual tempo changes: step the tempo across the span; it stays at the new value afterwards
  for (const r of list.filter((x) => x.ramp).sort((a, b) => a.tick - b.tick)) {
    // MuseScore changes the tempo one beat (quarter) at a time across the span
    const q0 = qAt(r.tick, out);
    const steps = Math.max(1, Math.round(r.ramp.len / PPQ));
    const end = r.tick + r.ramp.len;
    const markAtEnd = out.some((x) => Math.abs(x.tick - end) < 1);
    const ramp = [];
    for (let k = 0; k <= steps; k++) {
      if (k === steps && markAtEnd) break; // a tempo mark right where the change ends wins
      ramp.push({ tick: r.tick + (r.ramp.len * k) / steps, qps: q0 * (1 + (r.ramp.factor - 1) * (k / steps)) });
    }
    out = out.filter((x) => x.tick < r.tick || x.tick >= end - 0.5).concat(ramp).sort((a, b) => a.tick - b.tick);
  }
  // fermatas: slow the tempo for the held note/rest, then restore
  for (const [t, f] of [...fermatas.entries()].sort((a, b) => a[0] - b[0])) {
    const qIn = qAt(t, out), qOut = qAt(t + f.dur, out);
    out = out.filter((x) => x.tick < t || x.tick >= t + f.dur);
    out.push({ tick: t, qps: qIn / f.stretch }, { tick: t + f.dur, qps: qOut });
    out.sort((a, b) => a.tick - b.tick);
  }
  return out;
}

export const PIANO_RE =/piano|pno|keyboard|klavier|flügel|피아노|건반|ピアノ/i;
