// MuseScore 3/4 native format (.mscx, or inside .mscz).
import { unrollMuseScore } from './repeats.js';
import { PPQ, parseEndings, tempoMap, finishLine, PIANO_RE, expandOrnament, GRACE_TICKS, ARP_TICKS, buildTempos, DYN_VELOCITY } from './common.js';

// MuseScore ornament subtypes -> our kinds
function ornamentKind(sub) {
  if (/TurnInverted|InvertedTurn|ReverseTurn/i.test(sub)) return 'inverted-turn';
  if (/Turn/i.test(sub)) return 'turn';
  if (/ShortTrill|Prall(?!Mordent)|UpperMordent|InvertedMordent/i.test(sub)) return 'upper-mordent';
  if (/Mordent/i.test(sub)) return 'lower-mordent';
  if (/Trill/i.test(sub)) return 'trill';
  return null;
}

const DUR = { '1024th': 1.875, '512th': 3.75, '256th': 7.5, '128th': 15, '64th': 30, '32nd': 60, '16th': 120, eighth: 240, quarter: 480, half: 960, whole: 1920, breve: 3840, long: 7680 };
const GRACE = ['acciaccatura', 'appoggiatura', 'grace4', 'grace8', 'grace16', 'grace32', 'grace8after', 'grace16after', 'grace32after'];

const kids = (el, tag) => (el ? [...el.children].filter((c) => c.tagName === tag) : []);
const kid = (el, tag) => kids(el, tag)[0] || null;
const txt = (el, tag) => kid(el, tag)?.textContent?.trim() ?? '';
const frac = (s) => { const [a, b] = String(s).split('/').map(Number); return b ? (4 * PPQ * a) / b : 0; };

function durationOf(el, measureLen) {
  const type = txt(el, 'durationType');
  if (type === 'measure') return kid(el, 'duration') ? frac(txt(el, 'duration')) : measureLen;
  let d = DUR[type] ?? 0;
  const dots = +(txt(el, 'dots') || 0);
  let add = d;
  for (let i = 0; i < dots; i++) { add /= 2; d += add; }
  return d;
}

// relative location (MuseScore <location>): measures + fractions
function locationTicks(loc, ctx) {
  if (!loc) return 0;
  let t = frac(txt(loc, 'fractions') || '0/1');
  const m = +(txt(loc, 'measures') || 0);
  if (m) {
    // walk m measures forward in play order from the current measure
    const k = ctx.orderIndex;
    const from = ctx.measureStart[k];
    const to = ctx.measureStart[Math.min(ctx.measureStart.length - 1, k + m)] ?? from;
    t += to - from;
  }
  return t;
}


// MuseScore's default factors for gradual tempo changes (rit., accel. ...)
const TEMPO_FACTORS = {
  accelerando: 1.33, allargando: 0.75, calando: 0.5, lentando: 0.75, morendo: 0.5, precipitando: 1.15,
  rallentando: 0.75, ritardando: 0.75, smorzando: 0.5, sostenuto: 0.95, stringendo: 1.5,
};

// tremolo strokes -> note length in ticks
const TREM_TICKS = { r8: 240, r16: 120, r32: 60, r64: 30, buzzroll: 30 };

// fermata hold, as MuseScore plays it (Fermata::propertyDefault TIME_STRETCH)
function fermataStretch(el) {
  const ts = +txt(el, 'timeStretch');
  if (ts > 0) return ts;
  const sub = txt(el, 'subtype');
  if (/VeryShort/i.test(sub)) return 1.25;
  if (/Short/i.test(sub)) return 1.5;
  if (/VeryLong/i.test(sub)) return 4;
  if (/Long/i.test(sub)) return 3;
  return 2;
}

// 8va / 8vb / 15ma / 15mb / 22ma / 22mb (or MuseScore's old numeric types 0..5)
function ottavaShift(sub) {
  const s = String(sub).trim();
  if (/^\d$/.test(s)) return [12, -12, 24, -24, 36, -36][+s] || 0;
  const m = /^(8|15|22)(va|vb|ma|mb)/i.exec(s);
  if (!m) return 0;
  const oct = { 8: 12, 15: 24, 22: 36 }[m[1]];
  return /b$/i.test(m[2]) ? -oct : oct;
}

// Walks one voice of a measure: yields every element with its position (ticks from the measure start)
// and, for chords/rests, its real duration (tuplets applied, grace notes = 0).
function* walk(voice, mlen) {
  let cur = 0;
  const tupById = new Map();
  const tupStack = [];
  for (const el of voice.children) {
    switch (el.tagName) {
      case 'location': cur += frac(txt(el, 'fractions') || '0/1'); break;
      case 'Tuplet': {
        const ratio = +txt(el, 'normalNotes') / +txt(el, 'actualNotes') || 1;
        if (el.getAttribute('id')) tupById.set(el.getAttribute('id'), ratio); else tupStack.push(ratio);
        break;
      }
      case 'endTuplet': tupStack.pop(); break;
      case 'Chord':
      case 'Rest': {
        if (el.tagName === 'Chord' && GRACE.some((g) => kid(el, g))) { yield { el, cur, d: 0, grace: true }; break; }
        let d = durationOf(el, mlen);
        const tref = kid(el, 'Tuplet');
        if (tref && tupById.has(tref.textContent.trim())) d *= tupById.get(tref.textContent.trim());
        for (const r of tupStack) d *= r;
        yield { el, cur, d };
        cur += d;
        break;
      }
      default:
        yield { el, cur, d: 0 };
    }
  }
}


// Measure layout from the first staff: lengths, time signatures, repeats, voltas,
// jumps (D.C. / D.S.) and markers (segno, coda, fine ...), section breaks.
export function measureLayout(staffEl) {
  const first = kids(staffEl, 'Measure');
  let sig = 4 * PPQ;
  const measures = first.map((m) => {
    const ts = m.querySelector('TimeSig');
    if (ts) sig = (4 * PPQ * +txt(ts, 'sigN')) / +txt(ts, 'sigD');
    const len = m.getAttribute('len') ? frac(m.getAttribute('len')) : sig;
    const er = kid(m, 'endRepeat');
    const items = [];
    for (const e of m.querySelectorAll('Jump, Marker')) {
      if (e.tagName === 'Jump') {
        items.push({ kind: 'jump', to: txt(e, 'jumpTo'), until: txt(e, 'playUntil'), cont: txt(e, 'continueAt'), playRepeats: txt(e, 'playRepeats') === '1' });
      } else {
        const label = txt(e, 'label');
        if (!label) continue;
        const style = txt(e, 'style') + ' ' + txt(e, 'subtype');
        const right = /right/i.test(style) || /^(fine|tocoda|tocodasym|dacoda|dadoublecoda)$/i.test(txt(e, 'subtype'));
        items.push({ kind: 'marker', label, right });
      }
    }
    const sectionBreak = [...m.querySelectorAll('LayoutBreak > subtype')].some((x) => x.textContent.trim() === 'section');
    const irregular = txt(m, 'irregular') === '1' || m.getAttribute('irregular') === '1';
    return { len, startRepeat: !!kid(m, 'startRepeat'), endRepeat: er ? +(er.textContent || 2) || 2 : 0, items, sectionBreak, irregular };
  });
  // section breaks can also sit on frames (VBox, HBox ...) between measures
  let mi = -1;
  for (const c of staffEl.children) {
    if (c.tagName === 'Measure') { mi++; continue; }
    if (mi >= 0 && /Box$/.test(c.tagName) && [...c.querySelectorAll('LayoutBreak > subtype')].some((x) => x.textContent.trim() === 'section')) measures[mi].sectionBreak = true;
  }
  const starts = [];
  let acc = 0;
  for (const m of measures) { starts.push(acc); acc += m.len; }
  const voltas = [];
  first.forEach((m, i) => {
    for (const sp of m.querySelectorAll('Spanner[type="Volta"]')) {
      const v = kid(sp, 'Volta');
      if (!v) continue;
      const endings = parseEndings(txt(v, 'endings') || txt(v, 'beginText') || '1') || [1];
      const loc = sp.querySelector('next > location');
      const span = +(loc?.querySelector('measures')?.textContent || 1);
      const endTick = (starts[Math.min(measures.length, i + span)] ?? acc) + frac(loc?.querySelector('fractions')?.textContent || '0/1');
      let end = i;
      while (end + 1 < measures.length && starts[end + 1] < endTick) end++;
      voltas.push({ start: i, end, endings, closed: +(txt(v, 'endHookType') || 0) > 0 });
    }
  });
  return { measures, voltas, starts };
}

// For tests: 1-based measure numbers in play order.
export function playOrder(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const score = doc.querySelector('Score');
  const staff = kids(score, 'Staff').find((st) => kid(st, 'Measure'));
  const { measures: ms, voltas } = measureLayout(staff);
  // MuseScore's measure numbers: restart after a section break, skip measures excluded from the count
  const no = [];
  let n = 0;
  ms.forEach((m, i) => { if (i > 0 && ms[i - 1].sectionBreak) n = 0; if (!m.irregular) n++; no.push(Math.max(1, n)); });
  return unrollMuseScore(ms, voltas).map((i) => no[i]);
}

export function parseMscx(xml, fallbackTitle = 'Score') {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const score = doc.querySelector('Score');
  if (!score) throw new Error('MuseScore 파일에서 Score를 찾지 못했습니다.');

  const title = [...score.querySelectorAll('metaTag')].find((m) => m.getAttribute('name') === 'workTitle')?.textContent?.trim() || fallbackTitle;

  // parts and which staves belong to them
  const staffInfo = new Map();
  for (const part of kids(score, 'Part')) {
    const inst = kid(part, 'Instrument');
    const name = txt(part, 'trackName') || txt(inst, 'longName') || 'Part';
    const ids = `${inst?.getAttribute('id') || ''} ${txt(inst, 'instrumentId')}`;
    const progEl = inst?.querySelector('Channel > program');
    const prog = progEl ? +progEl.getAttribute('value') : -1;
    const piano = PIANO_RE.test(`${name} ${ids}`) || (prog >= 0 && prog <= 7);
    const staves = kids(part, 'Staff');
    staves.forEach((st, k) => staffInfo.set(st.getAttribute('id'), { name, piano, k, count: staves.length }));
  }

  const staves = kids(score, 'Staff').filter((s) => kid(s, 'Measure'));
  if (!staves.length) throw new Error('악보에 마디가 없습니다.');

  const { measures, voltas, starts: layoutStarts } = measureLayout(staves[0]);
  const order = unrollMuseScore(measures, voltas);
  const measureStart = [];
  let acc = 0;
  for (const mi of order) { measureStart.push(acc); acc += measures[mi].len; }
  measureStart.push(acc);

  const tempos = [];
  const pedals = [];
  const lines = [];
  const fermatas = new Map(); // unrolled tick -> { dur, stretch }
  const raw = layoutStarts;   // score-order start tick of each measure
  const rawEnd = (mi, loc) => {
    // where a spanner ends, in score-order ticks: <next><location> is relative to its start measure
    const m = +(loc?.querySelector('measures')?.textContent || 0);
    const f = frac(loc?.querySelector('fractions')?.textContent || '0/1');
    return (raw[Math.min(raw.length - 1, mi + m)] ?? raw[raw.length - 1]) - raw[mi] + f;
  };

  staves.forEach((staffEl, si) => {
    const id = staffEl.getAttribute('id');
    const info = staffInfo.get(id) || { name: `Staff ${id}`, piano: false, k: 0, count: 1 };
    const ms = kids(staffEl, 'Measure');
    const notes = [];

    // --- pass 1, score order: dynamics, hairpins, octave lines ---
    const dyns = [];      // { at, v }
    const hairpins = [];  // { s, e, dir, velo }
    const ottavas = [];   // { s, e, shift }
    ms.forEach((m, mi) => {
      const mlen = measures[mi]?.len ?? 4 * PPQ;
      const voices = kids(m, 'voice');
      for (const voice of voices.length ? voices : [m]) {
        for (const { el, cur } of walk(voice, mlen)) {
          const at = raw[mi] + cur;
          if (el.tagName === 'Dynamic') {
            const v = +txt(el, 'velocity') || DYN_VELOCITY[txt(el, 'subtype')];
            if (v) dyns.push({ at, v });
          } else if (el.tagName === 'Spanner') {
            const type = el.getAttribute('type');
            const loc = el.querySelector('next > location');
            if (type === 'HairPin' && kid(el, 'HairPin')) {
              const hp = kid(el, 'HairPin');
              const sub = +(txt(hp, 'subtype') || 0);
              hairpins.push({ s: at, e: at + rawEnd(mi, loc) - cur, dir: sub === 1 || sub === 3 ? -1 : 1, velo: +txt(hp, 'veloChange') || 0 });
            } else if (type === 'Ottava' && kid(el, 'Ottava')) {
              ottavas.push({ s: at, e: at + rawEnd(mi, loc) - cur, shift: ottavaShift(txt(kid(el, 'Ottava'), 'subtype')) });
            }
          }
        }
      }
    });
    dyns.sort((a, b) => a.at - b.at);
    const dynAt = (t) => { let v = 80; for (const d of dyns) { if (d.at <= t) v = d.v; else break; } return v; };
    const velAt = (t) => {
      let v = dynAt(t);
      for (const hp of hairpins) {
        if (t < hp.s || t >= hp.e) continue;
        const from = dynAt(hp.s);
        let to = hp.velo ? from + hp.dir * Math.abs(hp.velo) : dynAt(hp.e + 1);
        if (!hp.velo && Math.sign(to - from) !== hp.dir) to = from + hp.dir * 16; // no target dynamic: one step louder/softer
        v = from + (to - from) * ((t - hp.s) / Math.max(1, hp.e - hp.s));
      }
      return Math.round(v);
    };
    const octAt = (t) => { for (const o of ottavas) if (t >= o.s && t < o.e) return o.shift; return 0; };

    // MuseScore 4.5+ writes a tie on its END note as <Tie><startElement>id</startElement>...;
    // older files put <Tie/> or <Spanner type="Tie"><next> on the START note
    const tieStarts = new Set([...staffEl.querySelectorAll('Note > Tie > startElement')].map((e) => e.textContent.trim()));
    const startsTie = (n) => {
      const t = kid(n, 'Tie');
      if (t && !kid(t, 'startElement')) return true;
      if (tieStarts.has(txt(n, 'eid'))) return true;
      return [...kids(n, 'Spanner')].some((sp) => sp.getAttribute('type') === 'Tie' && kid(sp, 'next'));
    };

    // --- pass 2, play order ---
    const tieOpen = new Map();
    let key = 0;
    let graces = [];
    let trillNext = false;
    let lastChord = null;
    let fermataNext = 0;
    let tremPending = null; // first chord of a two-note tremolo
    const measureNotes = new Map(); // score measure -> notes written in it (for measure-repeat signs)
    // measure-repeat groups: each measure carries its place in the group; the sign (with the group size) sits in one of them
    const repeatSize = new Map();
    for (let i = 0; i < ms.length; i++) {
      if (+txt(ms[i], 'measureRepeatCount') !== 1 && !ms[i].querySelector('RepeatMeasure')) continue;
      let j = i, n = 0;
      const group = [];
      do { group.push(j); j++; } while (j < ms.length && +txt(ms[j], 'measureRepeatCount') === group.length + 1);
      for (const g of group) { const r = ms[g].querySelector('MeasureRepeat, RepeatMeasure'); if (r) n = Math.max(n, +txt(r, 'subtype') || 1); }
      for (const g of group) repeatSize.set(g, n || group.length);
      i = j - 1;
    }
    let recording = null;
    const push = (tick, dur, n, v) => {
      const note = { tick, dur, n, v: Math.max(1, Math.min(127, v)) };
      notes.push(note);
      if (recording) recording.push(note);
      return note;
    };

    order.forEach((mi, oi) => {
      const m = ms[mi];
      if (!m) return;
      const base = measureStart[oi];
      const mlen = measures[mi].len;
      recording = [];
      const voices = kids(m, 'voice');
      // measure repeat sign: play the previous measure(s) again
      if (repeatSize.has(mi)) {
        const n = repeatSize.get(mi);
        const src = measureNotes.get(mi - n) || [];
        const srcBase = src.base ?? 0;
        for (const x of src) push(base + (x.tick - srcBase), x.dur, x.n, x.v);
        recording.base = base;
        measureNotes.set(mi, recording);
        recording = null;
        return;
      }
      recording.base = base;
      for (const voice of voices.length ? voices : [m]) {
        for (const { el, cur, d, grace } of walk(voice, mlen)) {
          const at = raw[mi] + cur; // score-order position
          switch (el.tagName) {
            case 'KeySig': {
              const k = kid(el, 'concertKey') || kid(el, 'accidental');
              if (k) key = +k.textContent || 0;
              break;
            }
            case 'Tempo': {
              const q = +txt(el, 'tempo');
              if (si === 0 && q > 0) tempos.push({ tick: base + cur, qps: q });
              break;
            }
            case 'Fermata':
              fermataNext = Math.max(fermataNext, fermataStretch(el));
              break;
            case 'Spanner': {
              const type = el.getAttribute('type');
              if (type === 'Trill' && kid(el, 'Trill')) trillNext = true;
              if (type === 'Pedal' && kid(el, 'Pedal') && info.piano) {
                const len = locationTicks(el.querySelector('next > location'), { orderIndex: oi, measureStart });
                if (len > 0) { pedals.push({ tick: base + cur, on: true }); pedals.push({ tick: base + cur + len - 2, on: false }); }
              }
              if (type === 'GradualTempoChange' && si === 0 && kid(el, 'GradualTempoChange')) {
                const g = kid(el, 'GradualTempoChange');
                const factor = +txt(g, 'tempoChangeFactor') || TEMPO_FACTORS[txt(g, 'tempoChangeType').toLowerCase()] || 1;
                const len = locationTicks(el.querySelector('next > location'), { orderIndex: oi, measureStart });
                if (len > 0 && factor !== 1) tempos.push({ tick: base + cur, ramp: { len, factor } });
              }
              break;
            }
            case 'Chord':
            case 'Rest': {
              let stretch = fermataNext;
              fermataNext = 0;
              if (el.tagName === 'Chord') for (const a of el.querySelectorAll('Articulation > subtype')) if (/fermata/i.test(a.textContent)) stretch = Math.max(stretch, 2);
              if (stretch > 1 && d > 0) {
                const t = base + cur;
                const f = fermatas.get(t);
                if (!f || f.stretch < stretch) fermatas.set(t, { dur: d, stretch });
              }
              if (grace) {
                // grace notes take no time of their own; they borrow it from a neighbouring note
                const pitches = kids(el, 'Note').map((n) => +txt(n, 'pitch') + octAt(at));
                const graceTag = GRACE.find((g) => kid(el, g));
                if (/after/.test(graceTag) && lastChord) {
                  const g = Math.min(GRACE_TICKS, lastChord.len / 4);
                  for (const n of lastChord.notes) n.dur = Math.max(10, n.dur - g);
                  for (const p of pitches) push(lastChord.start + lastChord.len - g, g, p, velAt(at) - 10);
                } else graces.push({ pitches, appog: graceTag === 'appoggiatura' });
                break;
              }
              if (el.tagName !== 'Chord') break;
              const tick = base + cur;
              const vel = velAt(at);
              const shift = octAt(at);
              let start = tick, len = d;
              if (graces.length) {
                const appog = graces.length === 1 && graces[0].appog; // appoggiatura: half the main note
                const g = appog ? d / 2 : Math.min(GRACE_TICKS, d / (graces.length + 1));
                graces.forEach((gr, i) => gr.pitches.forEach((p) => push(start + i * g, g, p, vel - (appog ? 0 : 8))));
                start += g * graces.length;
                len -= g * graces.length;
                graces = [];
              }
              // tremolo
              const tremEl = el.querySelector('Tremolo, TremoloSingleChord, TremoloTwoChord');
              const tremSub = tremEl ? txt(tremEl, 'subtype') : '';
              const pitches = kids(el, 'Note').map((n) => +txt(n, 'pitch') + shift);
              if (tremPending) {
                // second chord of a two-note tremolo: alternate the two chords over both durations
                const tp = tremPending;
                tremPending = null;
                const total = tick + d - tp.start;
                for (let t = tp.start, k = 0; t < tp.start + total - 1; t += tp.step, k++) {
                  for (const p of k % 2 ? pitches : tp.pitches) push(t, Math.min(tp.step, tp.start + total - t), p, k % 2 ? vel : tp.vel);
                }
                lastChord = null;
                break;
              }
              if (/^c\d+/.test(tremSub) || el.querySelector('TremoloTwoChord')) {
                tremPending = { start, pitches, vel, step: TREM_TICKS[tremSub.replace(/^c/, 'r')] || 120 };
                break;
              }
              if (/^r\d+|buzz/i.test(tremSub)) {
                const step = TREM_TICKS[tremSub] || 30;
                for (let t = start; t < start + len - 1; t += step) for (const p of pitches) push(t, Math.min(step, start + len - t), p, vel);
                lastChord = null;
                break;
              }
              // articulation / ornaments on this chord
              let durMul = 1, velAdd = 0, orn = trillNext ? 'trill' : null;
              trillNext = false;
              for (const sub of el.querySelectorAll('Articulation > subtype, Ornament > subtype')) {
                const a = sub.textContent;
                if (/Staccatissimo/i.test(a)) durMul = 0.35;
                else if (/Staccato/i.test(a)) durMul = Math.min(durMul, 0.5);
                if (/Marcato/i.test(a)) velAdd = 20;
                else if (/Accent/i.test(a)) velAdd = Math.max(velAdd, 14);
                orn = ornamentKind(a) || orn;
              }
              const arp = !!kid(el, 'Arpeggio');
              const noteEls = kids(el, 'Note').sort((a, b) => +txt(a, 'pitch') - +txt(b, 'pitch'));
              const made = [];
              noteEls.forEach((n, idx) => {
                const pitch = +txt(n, 'pitch') + shift;
                const s0 = start + (arp ? idx * ARP_TICKS : 0);
                const l0 = Math.max(10, len - (arp ? idx * ARP_TICKS : 0));
                const v = vel + velAdd;
                if (orn && idx === noteEls.length - 1) { expandOrnament(orn, s0, l0, pitch, v, key, push); return; }
                const prev = tieOpen.get(pitch);
                const tiesOn = startsTie(n);
                if (prev && Math.abs(prev.tick + prev.dur - tick) < 4) {
                  prev.dur = tick + d - prev.tick;
                  if (!tiesOn) tieOpen.delete(pitch);
                  return;
                }
                const note = push(s0, tiesOn ? l0 : l0 * durMul, pitch, v);
                made.push(note);
                if (tiesOn) tieOpen.set(pitch, note); else tieOpen.delete(pitch);
              });
              lastChord = { start, len, notes: made };
              break;
            }
          }
        }
      }
      measureNotes.set(mi, recording);
      recording = null;
    });

    const hand = info.count === 2 ? (info.k === 0 ? '오른손' : '왼손') : info.count > 1 ? `${info.k + 1}단` : '';
    lines.push({ name: hand ? `${info.name} · ${hand}` : info.name, piano: info.piano, notes });
  });

  const toSec = tempoMap(buildTempos(tempos, fermatas));
  return {
    title,
    lines: lines.map((l, i) => ({ id: i, name: l.name, piano: l.piano, notes: finishLine(l.notes, toSec) })).filter((l) => l.notes.length),
    pedals: pedals.sort((a, b) => a.tick - b.tick).map((p) => ({ t: toSec(p.tick), on: p.on })),
  };
}
