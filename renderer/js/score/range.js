// Notes past the piano's 88 keys (A0 = 21 … C8 = 108) are brought inside by octaves, the way an
// arranger would, instead of being dropped:
//  1. a part that mostly sits outside (a MIDI exported an octave off, a piccolo line) moves as a
//     whole, by the number of octaves that leaves the fewest notes outside;
//  2. whatever is still outside moves an octave at a time until it fits;
//  3. a moved note that lands on the same key at the same moment as another is played once.
// Drum parts (MIDI channel 10, or a part named like one) are left alone: their numbers are drum
// sounds, not pitches.
// The original notes are kept, so the change can be undone.
export const LO = 21, HI = 108;

const outside = (n) => n < LO || n > HI;

export function fitToPiano(song, isPercussion = (l) => l.drum) {
  const report = { moved: 0, merged: 0, shifted: [] };
  for (const l of song.lines) {
    if (isPercussion(l) || !l.notes.length || !l.notes.some((n) => outside(n.n))) continue;
    l.orig = l.notes;
    // 1. the whole part, when that helps a lot
    const count = (k) => l.notes.reduce((s, n) => s + (outside(n.n + 12 * k) ? 1 : 0), 0);
    const before = count(0);
    let best = 0;
    for (let k = -4; k <= 4; k++) if (count(k) < count(best) || (count(k) === count(best) && Math.abs(k) < Math.abs(best))) best = k;
    // only for a part that largely sits outside: a few stray notes are folded one by one below,
    // so the rest of the part keeps its register
    const mostlyOut = l.notes.length >= 8 && before / l.notes.length >= 0.4;
    const shift = mostlyOut && best !== 0 && count(best) <= before * 0.5 ? best : 0;
    if (shift) report.shifted.push({ name: l.name, octaves: shift });
    // 2. note by note
    const placed = l.notes.map((n0) => {
      let n = n0.n + 12 * shift;
      while (n > HI) n -= 12;
      while (n < LO) n += 12;
      return { n0, n };
    });
    // 3. one key, one onset: notes that stayed where they were win over notes moved onto them
    const key = (p) => `${p.n}@${Math.round(p.n0.t * 200)}`;
    const seen = new Set(placed.filter((p) => p.n === p.n0.n).map(key));
    const notes = [];
    for (const p of placed) {
      if (p.n === p.n0.n) { notes.push(p.n0); continue; }
      if (outside(p.n0.n)) report.moved++;
      if (seen.has(key(p))) { report.merged++; continue; }
      seen.add(key(p));
      notes.push({ ...p.n0, n: p.n });
    }
    l.notes = notes;
  }
  report.changed = report.moved > 0;
  return report;
}

// back to the score as written (notes outside the 88 keys are then left out when it plays)
export function unfitPiano(song) {
  for (const l of song.lines) if (l.orig) { l.notes = l.orig; delete l.orig; }
}
