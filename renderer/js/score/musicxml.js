// MusicXML (.musicxml / .xml, or inside .mxl).
import { PPQ, parseEndings, tempoMap, finishLine, PIANO_RE, expandOrnament, GRACE_TICKS, ARP_TICKS, buildTempos, DYN_VELOCITY } from './common.js';
import { unrollMuseScore } from './repeats.js';

const TREM_STEP = { 1: 240, 2: 120, 3: 60, 4: 30, 5: 15 };

const TYPE_TICKS = { maxima: 15360, long: 7680, breve: 3840, whole: 1920, half: 960, quarter: 480, eighth: 240, '16th': 120, '32nd': 60, '64th': 30, '128th': 15, '256th': 7.5 };
function typedTicks(note) {
  const base = TYPE_TICKS[txt(note, 'type')];
  if (!base) return 0;
  let d = base, add = base;
  for (let i = 0; i < kids(note, 'dot').length; i++) { add /= 2; d += add; }
  const tm = kid(note, 'time-modification');
  if (tm) d *= (+txt(tm, 'normal-notes') || 1) / (+txt(tm, 'actual-notes') || 1);
  return d;
}

function ornamentOf(notations) {
  const o = notations?.querySelector('ornaments');
  if (!o) return null;
  if (o.querySelector('trill-mark') || o.querySelector('wavy-line[type="start"]')) return 'trill';
  if (o.querySelector('inverted-mordent')) return 'upper-mordent';
  if (o.querySelector('mordent')) return 'lower-mordent';
  if (o.querySelector('inverted-turn, delayed-inverted-turn')) return 'inverted-turn';
  if (o.querySelector('turn, delayed-turn')) return 'turn';
  return null;
}

const STEP = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const kids = (el, tag) => (el ? [...el.children].filter((c) => c.tagName === tag) : []);
const kid = (el, tag) => kids(el, tag)[0] || null;
const txt = (el, tag) => kid(el, tag)?.textContent?.trim() ?? '';

export let lastOrder = [];

export function parseMusicXml(xml, fallbackTitle = 'Score') {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const root = doc.querySelector('score-partwise');
  if (!root) {
    if (doc.querySelector('score-timewise')) throw new Error('timewise MusicXML은 지원하지 않습니다. partwise로 내보내 주세요.');
    throw new Error('MusicXML을 읽지 못했습니다.');
  }
  const title = doc.querySelector('work > work-title')?.textContent?.trim() || doc.querySelector('movement-title')?.textContent?.trim() || fallbackTitle;

  const partMeta = new Map();
  for (const sp of root.querySelectorAll('part-list > score-part')) {
    const name = txt(sp, 'part-name') || 'Part';
    const inst = sp.querySelector('score-instrument > instrument-name')?.textContent || '';
    const prog = +(sp.querySelector('midi-instrument > midi-program')?.textContent || 0); // 1-based
    partMeta.set(sp.getAttribute('id'), { name, piano: PIANO_RE.test(`${name} ${inst}`) || (prog >= 1 && prog <= 8) });
  }

  const parts = kids(root, 'part');
  if (!parts.length) throw new Error('파트가 없습니다.');

  // divisions per measure (they carry over) and measure lengths, from the first part
  const divAt = (part) => {
    let div = 1;
    return kids(part, 'measure').map((m) => {
      const d = m.querySelector('attributes > divisions');
      if (d) div = +d.textContent || div;
      return div;
    });
  };
  const firstMs = kids(parts[0], 'measure');
  const firstDiv = divAt(parts[0]);
  let openVolta = null;
  const voltas = [];
  let pendingLeft = [], prevItems = null;
  const measures = firstMs.map((m, i) => {
    // length = furthest point any voice reaches
    let cur = 0, max = 0, last = 0;
    const posOf = new Map(); // direction/sound element -> position in the measure (divisions)
    for (const el of m.children) {
      if (el.tagName === 'direction' || el.tagName === 'sound') posOf.set(el, cur + (+txt(el, 'offset') || 0));
      let d = +txt(el, 'duration') || 0;
      if (el.tagName === 'note') {
        const ty = (typedTicks(el) * firstDiv[i]) / PPQ;
        if (ty && Math.abs(d - ty) / ty > 0.5) d = ty;
        if (kid(el, 'grace')) continue;
        if (kid(el, 'chord')) { max = Math.max(max, last + d); continue; }
        last = cur; cur += d; max = Math.max(max, cur);
      } else if (el.tagName === 'backup') cur -= d;
      else if (el.tagName === 'forward') { cur += d; max = Math.max(max, cur); }
    }
    let startRepeat = false, endRepeat = 0;
    for (const bl of kids(m, 'barline')) {
      const rep = kid(bl, 'repeat');
      if (rep?.getAttribute('direction') === 'forward') startRepeat = true;
      if (rep?.getAttribute('direction') === 'backward') endRepeat = +(rep.getAttribute('times') || 2);
      const end = kid(bl, 'ending');
      if (end) {
        const type = end.getAttribute('type');
        if (type === 'start') openVolta = { start: i, endings: parseEndings(end.getAttribute('number')) || [1] };
        if ((type === 'stop' || type === 'discontinue') && openVolta) {
          voltas.push({ ...openVolta, end: i, closed: type === 'stop' });
          openVolta = null;
        }
      }
    }
    // jumps and markers: <sound dacapo/dalsegno/fine/tocoda/segno/coda> or plain words.
    // A segno/coda written at the very end of a measure belongs to the next one; a To Coda /
    // Fine / D.S. at the very start belongs to the end of the previous one (as MuseScore reads them).
    const items = [], carry = [], backfill = [];
    for (const el of m.querySelectorAll('direction, sound')) {
      if (el.tagName === 'sound' && el.parentElement?.tagName === 'direction') continue; // handled with its direction
      const pos = posOf.get(el) ?? 0;
      const atEnd = max > 0 && pos >= max, atStart = pos <= 0;
      const snd = el.tagName === 'sound' ? el : kid(el, 'sound');
      const dt = el.tagName === 'direction' ? el.querySelector('direction-type') : null;
      const words = (dt?.querySelector('words')?.textContent || '').trim();
      const a = (n) => snd?.getAttribute(n);
      const left = (it) => (atEnd ? carry : items).push(it);
      const right = (it) => (atStart && i > 0 ? backfill : items).push(it);
      if (dt?.querySelector('segno') || a('segno')) left({ kind: 'marker', label: `segno:${a('segno') || 'segno'}`, right: false });
      if (dt?.querySelector('coda') && !a('tocoda')) left({ kind: 'marker', label: `coda:${a('coda') || 'coda'}`, right: false });
      if (a('fine') || /^fine\b/i.test(words)) right({ kind: 'marker', label: 'fine', right: true });
      if (a('tocoda') || /^to\s*coda/i.test(words)) right({ kind: 'marker', label: `tocoda:${a('tocoda') || 'coda'}`, right: true });
      if (a('dacapo') === 'yes' || (!snd && /^d\.?\s*c\.?(\s|$)/i.test(words))) right({ kind: 'jump', to: 'start' });
      else if (a('dalsegno') || (!snd && /^d\.?\s*s\.?(\s|$)/i.test(words))) right({ kind: 'jump', to: `segno:${a('dalsegno') || 'segno'}` });
    }
    items.unshift(...pendingLeft);
    pendingLeft = carry;
    if (backfill.length && prevItems) prevItems.push(...backfill);
    prevItems = items;
    return { len: (max * PPQ) / firstDiv[i], startRepeat, endRepeat, items };
  });
  if (openVolta) voltas.push({ ...openVolta, end: measures.length - 1, closed: false });
  // al Fine if the score has a Fine, else al Coda if it has a To Coda
  const labels = measures.flatMap((m) => m.items.filter((x) => x.kind === 'marker').map((x) => x.label));
  const toCoda = labels.find((l) => l.startsWith('tocoda:'));
  for (const m of measures) for (const it of m.items) {
    if (it.kind !== 'jump') continue;
    if (labels.includes('fine')) { it.until = 'fine'; it.cont = ''; }
    else if (toCoda) { it.until = toCoda; it.cont = `coda:${toCoda.slice(7)}`; }
    else { it.until = 'end'; it.cont = ''; }
  }

  const order = unrollMuseScore(measures, voltas);
  lastOrder = order; // for tests
  const start = [];
  let acc = 0;
  for (const mi of order) { start.push(acc); acc += measures[mi].len; }

  const tempos = [];
  const pedals = [];
  const lines = [];
  const fermatas = new Map();

  parts.forEach((part, pi) => {
    const meta = partMeta.get(part.getAttribute('id')) || { name: `Part ${pi + 1}`, piano: false };
    const ms = kids(part, 'measure');
    const div = divAt(part);
    const byStaff = new Map();
    const tieOpen = new Map();
    let vel = 80;
    let staves = 1;
    let fifths = 0;
    const graces = new Map(); // staff -> grace notes waiting for their main note
    const addNote = (staff, note) => { if (!byStaff.has(staff)) byStaff.set(staff, []); byStaff.get(staff).push(note); };
    const dynEvents = [];   // { tick, v }
    const wedges = [];      // { s, e, dir }
    let wedgeOpen = null;
    const tremPending = new Map(); // staff -> first note of a two-note tremolo

    order.forEach((mi, oi) => {
      const m = ms[mi];
      if (!m) return;
      const k = PPQ / div[mi];
      const base = start[oi];
      const st = m.querySelector('attributes > staves');
      if (st) staves = +st.textContent || 1;
      const ks = m.querySelector('attributes > key > fifths');
      if (ks) fifths = +ks.textContent || 0;
      let cur = 0, lastStart = 0, shift = 0, chordIdx = 0;
      for (const el of m.children) {
        if (el.tagName === 'backup') { cur -= +txt(el, 'duration') * k; continue; }
        if (el.tagName === 'forward') { cur += +txt(el, 'duration') * k; continue; }
        if (el.tagName === 'direction' || el.tagName === 'sound') {
          const snd = el.tagName === 'sound' ? el : kid(el, 'sound');
          const off = el.tagName === 'direction' ? (+txt(el, 'offset') || 0) * k : 0;
          if (snd?.getAttribute('tempo') && pi === 0) tempos.push({ tick: base + cur + off, qps: +snd.getAttribute('tempo') / 60 });
          if (snd?.getAttribute('dynamics')) vel = Math.max(1, Math.min(127, Math.round(+snd.getAttribute('dynamics') * 0.9)));
          else {
            const dyn = el.querySelector('direction-type > dynamics > *');
            if (dyn && DYN_VELOCITY[dyn.tagName]) vel = DYN_VELOCITY[dyn.tagName];
          }
          if (snd?.getAttribute('dynamics') || el.querySelector('direction-type > dynamics')) dynEvents.push({ tick: base + cur + off, v: vel });
          const wedge = el.querySelector('direction-type > wedge');
          if (wedge) {
            const wt = wedge.getAttribute('type');
            if (wt === 'crescendo' || wt === 'diminuendo') wedgeOpen = { s: base + cur + off, dir: wt === 'crescendo' ? 1 : -1 };
            else if (wt === 'stop' && wedgeOpen) { wedges.push({ ...wedgeOpen, e: base + cur + off }); wedgeOpen = null; }
          }
          const damper = snd?.getAttribute('damper-pedal');
          if (meta.piano && damper) pedals.push({ tick: base + cur + off, on: damper === 'yes' || /^\d/.test(damper) });
          const ped = el.querySelector('direction-type > pedal');
          if (meta.piano && ped && !damper) {
            const type = ped.getAttribute('type');
            if (type === 'start') pedals.push({ tick: base + cur + off, on: true });
            else if (type === 'stop') pedals.push({ tick: base + cur + off - 2, on: false });
            else if (type === 'change') { pedals.push({ tick: base + cur + off - 2, on: false }); pedals.push({ tick: base + cur + off, on: true }); }
          }
          continue;
        }
        if (el.tagName !== 'note') continue;
        const pitch = kid(el, 'pitch');
        const n = pitch ? (+txt(pitch, 'octave') + 1) * 12 + STEP[txt(pitch, 'step')] + (+txt(pitch, 'alter') || 0) : null;
        const staff = +(txt(el, 'staff') || 1);
        const grace = kid(el, 'grace');
        if (grace) {
          // no time of its own: it borrows from the main note that follows
          if (n != null) {
            const g = graces.get(staff) || [];
            if (kid(el, 'chord') && g.length) g[g.length - 1].pitches.push(n);
            // MuseScore: only an unslashed eighth-note grace is a (long) appoggiatura
            else g.push({ pitches: [n], appog: grace.getAttribute('slash') !== 'yes' && txt(el, 'type') === 'eighth' });
            graces.set(staff, g);
          }
          continue;
        }
        let d = +txt(el, 'duration') * k;
        // some exporters write durations that contradict the note type; trust the type then
        const typed = typedTicks(el);
        if (typed && Math.abs(d - typed) / typed > 0.5) d = typed;
        const isChord = !!kid(el, 'chord');
        const at = base + (isChord ? lastStart : cur);
        if (!isChord) { lastStart = cur; cur += d; chordIdx = 0; shift = 0; } else chordIdx++;
        if (n == null || kid(el, 'rest')) continue;
        const v0 = el.getAttribute('dynamics') ? Math.round(+el.getAttribute('dynamics') * 0.9) : vel;

        if (!isChord) {
          const g = graces.get(staff);
          if (g && g.length) {
            const appog = g.length === 1 && g[0].appog;
            const gl = appog ? d / 2 : Math.min(GRACE_TICKS, d / (g.length + 1));
            g.forEach((gr, i) => gr.pitches.forEach((p) => addNote(staff, { tick: at + i * gl, dur: gl, n: p, v: v0 - (appog ? 0 : 8) })));
            shift = gl * g.length;
            graces.set(staff, []);
          }
        }
        const nt = kid(el, 'notations');
        let durMul = 1, velAdd = 0;
        const art = nt?.querySelector('articulations');
        if (art?.querySelector('staccatissimo, spiccato')) durMul = 0.35;
        else if (art?.querySelector('staccato')) durMul = 0.5;
        if (art?.querySelector('strong-accent')) velAdd = 20;
        else if (art?.querySelector('accent')) velAdd = 14;
        const roll = nt?.querySelector('arpeggiate') ? chordIdx * ARP_TICKS : 0;
        const tick = at + shift + roll;
        const len = Math.max(10, d - shift - roll);
        const v = Math.max(1, Math.min(127, v0 + velAdd));

        // fermata: hold this note/rest twice as long (MuseScore's default for a normal fermata)
        if (nt?.querySelector('fermata') && !isChord) {
          const f = fermatas.get(at);
          if (!f || f.dur < d) fermatas.set(at, { dur: d, stretch: 2 });
        }
        // tremolo: one note repeated, or two notes alternating
        const trem = nt?.querySelector('ornaments > tremolo');
        if (trem) {
          const step = TREM_STEP[+trem.textContent || 3] || 60;
          const type = trem.getAttribute('type') || 'single';
          if (type === 'start') { tremPending.set(staff, { n, start: tick, v, step }); continue; }
          if (type === 'stop' && tremPending.has(staff)) {
            const tp = tremPending.get(staff);
            tremPending.delete(staff);
            const total = tick + len - tp.start;
            for (let t = tp.start, j = 0; t < tp.start + total - 1; t += tp.step, j++) addNote(staff, { tick: t, dur: Math.min(tp.step, tp.start + total - t), n: j % 2 ? n : tp.n, v: j % 2 ? v : tp.v });
            continue;
          }
          for (let t = tick; t < tick + len - 1; t += step) addNote(staff, { tick: t, dur: Math.min(step, tick + len - t), n, v });
          continue;
        }
        const orn = ornamentOf(nt);
        if (orn) { expandOrnament(orn, tick, len, n, v, fifths, (t, dd, p, vv) => addNote(staff, { tick: t, dur: dd, n: p, v: Math.max(1, Math.min(127, vv)) })); continue; }

        const ties = kids(el, 'tie').map((t) => t.getAttribute('type'));
        const key = `${staff}:${n}`; // MuseScore joins ties across voices too
        const prev = tieOpen.get(key);
        if (prev && Math.abs(prev.tick + prev.dur - at) < 4) { // MuseScore ties a started tie to the next same pitch even without a stop
          prev.dur = at + d - prev.tick;
          if (!ties.includes('start')) tieOpen.delete(key);
          continue;
        }
        const note = { tick, dur: ties.includes('start') ? len : len * durMul, n, v };
        addNote(staff, note);
        if (ties.includes('start')) tieOpen.set(key, note);
      }
    });

    // crescendo / diminuendo wedges: ramp note velocities from the dynamic before to the one after
    if (wedges.length) {
      dynEvents.sort((a, b) => a.tick - b.tick);
      const dynAt = (t) => { let v = 80; for (const d of dynEvents) { if (d.tick <= t) v = d.v; else break; } return v; };
      for (const notes of byStaff.values()) for (const note of notes) {
        const w = wedges.find((x) => note.tick >= x.s && note.tick < x.e);
        if (!w) continue;
        const from = dynAt(w.s);
        let to = dynAt(w.e + 1);
        if (Math.sign(to - from) !== w.dir) to = from + w.dir * 16;
        note.v = Math.max(1, Math.min(127, Math.round(from + (to - from) * ((note.tick - w.s) / Math.max(1, w.e - w.s)))));
      }
    }
    for (const [staff, notes] of [...byStaff.entries()].sort((a, b) => a[0] - b[0])) {
      const hand = staves === 2 ? (staff === 1 ? '오른손' : '왼손') : staves > 2 ? `${staff}단` : '';
      lines.push({ name: hand ? `${meta.name} · ${hand}` : meta.name, piano: meta.piano, notes });
    }
  });

  const toSec = tempoMap(buildTempos(tempos, fermatas));
  return {
    title,
    lines: lines.map((l, i) => ({ id: i, name: l.name, piano: l.piano, notes: finishLine(l.notes, toSec) })).filter((l) => l.notes.length),
    pedals: pedals.sort((a, b) => a.tick - b.tick).map((p) => ({ t: toSec(p.tick), on: p.on })),
  };
}
