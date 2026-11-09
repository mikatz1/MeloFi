// Play order of measures, following MuseScore's own algorithm (engraving/dom/repeatlist.cpp)
// so a score plays back in MeloFi exactly as it does in MuseScore: repeats with play
// counts, voltas (1st/2nd... endings, open or closed), D.C./D.S. jumps with al Fine /
// al Coda, "play repeats" on jumps, markers left/right of the barline, and sections.
//
// measures[i]: { startRepeat, endRepeat (total plays, 0 = none), sectionBreak,
//                items: [{ kind: 'jump', to, until, cont, playRepeats } | { kind: 'marker', label, right }] }
// voltas: [{ start, end, endings: [..], closed }]  (measure indices, sorted by start)

const START = 'REPEAT_START', END = 'REPEAT_END', VSTART = 'VOLTA_START', VEND = 'VOLTA_END', JUMP = 'JUMP', MARKER = 'MARKER', BREAK = 'SECTION_BREAK';

const el = (type, measure, element = null) => ({ type, measure, element, count: type === START ? 1 : 0 });
const firstEnding = (v) => (v.endings.length ? Math.min(...v.endings) : 0);
const lastEnding = (v) => (v.endings.length ? Math.max(...v.endings) : 0);

// Voltas can overlap (duplicates on several staves, or real overlaps such as 1-5 and 2-4).
// Split them into non-overlapping pieces whose endings are the intersection, as MuseScore does.
function mergeVoltas(list) {
  const out = [];
  for (const v0 of [...list].sort((a, b) => a.start - b.start)) {
    let v = { ...v0, endings: [...v0.endings] };
    if (!out.length) { out.push(v); continue; }
    const toMerge = [];
    while (out.length && v.start <= out[out.length - 1].end) toMerge.push(out.pop());
    while (toMerge.length) {
      const last = toMerge[toMerge.length - 1];
      let rem = { ...last, endings: [...last.endings] };
      if (v.start !== rem.start) { last.end = v.start - 1; rem.start = v.start; out.push(last); }
      toMerge.pop();
      if (v.end < rem.end) { const t = v; v = rem; rem = t; }
      rem.endings = rem.endings.filter((e) => v.endings.includes(e));
      out.push(rem);
      if (v.end !== rem.end) v.start = rem.end + 1;
      else { out.push(...toMerge); toMerge.length = 0; v = null; }
    }
    if (v) out.push(v);
  }
  return out;
}

function collect(ms, voltas) {
  const sections = [];
  const n = ms.length;
  let sec = [];
  let start = el(START, 0);
  sec.push(start);
  let volta = null;
  const pv = mergeVoltas(voltas);
  for (let i = 0; i < n; i++) {
    const m = ms[i];
    if (pv.length && pv[0].start === i) {
      if (volta) sec.push(el(VEND, i - 1, volta));
      volta = pv.shift();
      sec.push(el(VSTART, i, volta));
    }
    if (m.startRepeat) {
      if (volta && volta.start !== i) { sec.push(el(VEND, i - 1, volta)); volta = null; }
      start = el(START, i);
      sec.push(start);
    }
    for (const it of m.items || []) {
      if (it.kind === 'jump') {
        sec.push(el(JUMP, i, it));
        if (volta && (volta.end < i || (volta.end === i && !volta.closed)) && !m.endRepeat) {
          sec.push(el(VEND, i, volta));
          volta = null;
        }
      } else if (it.kind === 'marker') {
        // right markers (Fine, To Coda) go after left ones; markers are evaluated before jumps
        const rle = el(MARKER, i, it);
        let at = sec.length - 1;
        while (at > 0 && sec[at].measure === i) {
          const before = (sec[at].type === MARKER && !it.right && sec[at].element.right) || sec[at].type === JUMP;
          if (before) at--; else break;
        }
        sec.splice(at + 1, 0, rle);
      }
    }
    if (m.endRepeat) {
      sec.push(el(END, i));
      start.count += m.endRepeat - 1;
      if (volta) { sec.push(el(VEND, i, volta)); volta = null; }
    }
    if (volta && volta.end === i && volta.closed) { sec.push(el(VEND, i, volta)); volta = null; }
    if (m.sectionBreak || i === n - 1) {
      if (volta) { sec.push(el(VEND, i, volta)); volta = null; }
      sec.push(el(BREAK, i));
      sections.push(sec);
      if (i < n - 1) { sec = []; start = el(START, i + 1); sec.push(start); }
    }
  }
  return sections;
}

class Segment {
  constructor() { this.list = []; }
  add(m) { if (!this.list.length || this.list[this.list.length - 1] !== m) this.list.push(m); }
  addUpTo(m) {
    if (this.list.length) {
      let next = this.list[this.list.length - 1] + 1;
      if (next < m) while (next !== m) this.list.push(next++);
      while (this.list.length && this.list[this.list.length - 1] >= m) this.list.pop();
    }
    this.add(m);
  }
  pop() { this.list.pop(); }
  get empty() { return !this.list.length; }
}

export function unrollMuseScore(ms, voltas = []) {
  if (!ms.length) return [];
  const S = collect(ms, voltas);
  const out = [];
  const push = (rs) => { if (rs && !rs.empty) out.push(...rs.list); };
  const taken = new Map(); // jump -> set of playback counts it was taken at

  const findMarker = (label, si, ei) => {
    if (label === 'start') return { s: si, e: 0 };
    if (label === 'end') return { s: si, e: S[si].length - 1 };
    const isIt = (x) => x.type === MARKER && x.element.label === label;
    for (let e = ei - 1; e >= 0; e--) if (isIt(S[si][e])) return { s: si, e };
    for (let e = ei + 1; e < S[si].length; e++) if (isIt(S[si][e])) return { s: si, e };
    for (let s = si - 1; s >= 0; s--) for (let e = S[s].length - 1; e >= 0; e--) if (isIt(S[s][e])) return { s, e };
    for (let s = si + 1; s < S.length; s++) for (let e = 0; e < S[s].length; e++) if (isIt(S[s][e])) return { s, e };
    return { s: -1, e: -1 };
  };

  // fast-forward state up to a jump target
  const performJump = (s, target, withRepeats) => {
    let volta = null, ref = S[s][0];
    for (let e = 0; e < target; e++) {
      const x = S[s][e];
      if (x.type === VSTART) volta = x.element;
      else if (x.type === VEND) volta = null;
      else if (x.type === START) ref = x;
    }
    let pc;
    if (withRepeats) pc = volta ? firstEnding(volta) || 1 : 1;
    else pc = volta ? lastEnding(volta) || ref.count : ref.count;
    return { volta, ref, pc };
  };

  let rs = null, pc = 1, volta = null, activeJump = null, forceFinal = false;
  let until = { s: -1, e: -1 }, cont = { s: -1, e: -1 };
  let guard = 0;

  for (let si = 0; si < S.length; si++) {
    let ref;
    pc = 1;
    let ei = 0;
    ref = S[si][0];
    volta = null;
    until = { s: -1, e: -1 };
    cont = { s: -1, e: -1 };
    forceFinal = false;
    rs = new Segment();
    rs.add(S[si][ei].measure);
    ei++;

    while (ei < S[si].length && guard++ < 200000) {
      const x = S[si][ei];
      if (rs) rs.addUpTo(x.measure);
      switch (x.type) {
        case BREAK:
          push(rs);
          break;
        case VSTART:
          volta = x.element;
          if (!volta.endings.includes(pc)) {
            rs.pop();
            push(rs);
            do { ei++; } while (S[si][ei].type !== VEND);
            volta = null;
            const next = S[si][ei].measure + 1;
            if (next >= ms.length) rs = null;
            else { rs = new Segment(); rs.add(next); }
          }
          break;
        case VEND:
          volta = null;
          break;
        case START:
          if (rs === null) {
            rs = new Segment();
            rs.add(x.measure);
          } else {
            const desired = forceFinal ? x.count : 1;
            if (pc !== desired) {
              rs.pop();
              push(rs);
              pc = desired;
              rs = new Segment();
              rs.add(x.measure);
            }
            ref = x;
          }
          break;
        case END:
          x.count += 1;
          if (pc < ref.count && x.count < ms[x.measure].endRepeat) {
            push(rs);
            rs = null;
            do {
              ei--;
              const y = S[si][ei];
              if (y.type === VSTART) volta = null;
              else if (y.type === VEND) volta = y.element;
            } while (S[si][ei] !== ref);
            pc++;
            continue;
          }
          break;
        case JUMP: {
          if (activeJump === x.element) forceFinal = false;
          if (pc >= ref.count || (volta && pc === lastEnding(volta))) {
            const key = x.element;
            const seen = taken.has(key) ? taken.get(key) : null;
            if (!(seen && seen.has(pc))) {
              if (!taken.has(key)) taken.set(key, new Set());
              taken.get(key).add(pc);
              const to = findMarker(x.element.to, si, ei);
              until = findMarker(x.element.until, si, ei);
              cont = findMarker(x.element.cont, si, ei);
              if (to.s >= 0) {
                push(rs);
                rs = null;
                activeJump = x.element;
                const j = performJump(to.s, to.e, !!activeJump.playRepeats);
                pc = j.pc; volta = j.volta; ref = j.ref;
                si = to.s;
                ei = to.e;
                forceFinal = !activeJump.playRepeats;
                if (until.s >= 0) {
                  for (let k = ei + 1; k < S[si].length; k++) {
                    const y = S[si][k];
                    if (y.type === END && y.count !== 0) {
                      y.count = 0;
                      if (forceFinal) y.count = ms[y.measure].endRepeat;
                    }
                  }
                }
                if (volta && pc < ref.count) {
                  let f = ei;
                  do { f--; } while (S[si][f] !== ref);
                  f++;
                  let vref = null, processed = 1;
                  while (f < S[si].length && S[si][f].type !== START && processed < ref.count) {
                    const y = S[si][f];
                    if (y.type === VSTART) {
                      vref = y.element;
                      if (lastEnding(vref) < pc) vref = null;
                    } else if (y.type === END) {
                      if (vref) {
                        let remaining = 0;
                        for (const e of vref.endings) if (e >= pc) remaining++;
                        y.count = ms[y.measure].endRepeat - remaining - 1;
                      }
                      processed += ms[y.measure].endRepeat - 1;
                    }
                    f++;
                  }
                }
                rs = new Segment();
                rs.add(S[si][ei].measure);
              }
            }
          }
          break;
        }
        case MARKER:
          if (si === until.s && ei === until.e && (pc === ref.count || (volta && pc === lastEnding(volta)))) {
            push(rs);
            rs = null;
            until = { s: -1, e: -1 };
            forceFinal = false;
            if (cont.s >= 0) {
              const j = performJump(cont.s, cont.e, true);
              pc = j.pc; volta = j.volta; ref = j.ref;
              si = cont.s;
              ei = cont.e;
              if (ref.measure !== S[si][ei].measure) ref = S[si][ei];
              rs = new Segment();
              rs.add(S[si][ei].measure);
              cont = { s: -1, e: -1 };
            } else {
              ei = S[si].length;
              continue;
            }
          }
          break;
      }
      ei++;
    }
  }
  return out;
}
