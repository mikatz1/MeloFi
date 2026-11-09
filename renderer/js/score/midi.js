// Standard MIDI files (type 0/1).
import { PIANO_RE } from './common.js';

const GM = ['Acoustic Grand', 'Bright Acoustic', 'Electric Grand', 'Honky-tonk', 'E.Piano 1', 'E.Piano 2', 'Harpsichord', 'Clavinet'];

export function parseMidi(bytes, fallbackTitle = 'MIDI') {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const str = (o, n) => String.fromCharCode(...bytes.subarray(o, o + n));
  if (str(0, 4) !== 'MThd') throw new Error('MIDI 파일이 아닙니다.');
  const ntr = dv.getUint16(10);
  const division = dv.getUint16(12);
  if (division & 0x8000) throw new Error('SMPTE 타임코드 MIDI는 지원하지 않습니다.');

  let p = 8 + dv.getUint32(4);
  const tracks = [];
  const tempos = [];
  let title = '';
  for (let t = 0; t < ntr && p < bytes.length; t++) {
    if (str(p, 4) !== 'MTrk') break;
    const end = p + 8 + dv.getUint32(p + 4);
    let q = p + 8, tick = 0, status = 0;
    const tr = { name: '', events: [] };
    const vlq = () => { let v = 0, b; do { b = bytes[q++]; v = (v << 7) | (b & 0x7f); } while (b & 0x80); return v; };
    while (q < end) {
      tick += vlq();
      let b = bytes[q];
      if (b & 0x80) { status = b; q++; } else b = status;
      const type = status & 0xf0, ch = status & 0x0f;
      if (status === 0xff) {
        const mt = bytes[q++]; const len = vlq();
        if (mt === 0x51) tempos.push({ tick, usq: (bytes[q] << 16) | (bytes[q + 1] << 8) | bytes[q + 2] });
        if (mt === 0x03 && !tr.name) tr.name = new TextDecoder().decode(bytes.subarray(q, q + len)).trim();
        q += len;
      } else if (status === 0xf0 || status === 0xf7) {
        q += vlq();
      } else if (type === 0xc0 || type === 0xd0) {
        tr.events.push({ tick, type, ch, a: bytes[q++] });
      } else {
        tr.events.push({ tick, type, ch, a: bytes[q], b: bytes[q + 1] });
        q += 2;
      }
    }
    if (t === 0 && tr.name) title = tr.name;
    tracks.push(tr);
    p = end;
  }

  // tempo map (shared by all tracks)
  tempos.sort((a, b) => a.tick - b.tick);
  if (!tempos.length || tempos[0].tick > 0) tempos.unshift({ tick: 0, usq: 500000 });
  const segs = [];
  let sec = 0;
  tempos.forEach((tp, i) => {
    segs.push({ tick: tp.tick, sec, usq: tp.usq });
    if (i + 1 < tempos.length) sec += ((tempos[i + 1].tick - tp.tick) / division) * (tp.usq / 1e6);
  });
  const toSec = (tick) => {
    let s = segs[0];
    for (const x of segs) { if (x.tick <= tick) s = x; else break; }
    return s.sec + ((tick - s.tick) / division) * (s.usq / 1e6);
  };

  const lines = [];
  const pedals = [];
  tracks.forEach((tr, ti) => {
    const prog = new Map();
    const open = new Map();
    const byCh = new Map();
    for (const e of tr.events) {
      if (e.type === 0xc0) { prog.set(e.ch, e.a); continue; }
      if (e.type === 0x90 && e.b > 0) {
        const k = e.ch * 128 + e.a;
        if (!open.has(k)) open.set(k, []);
        open.get(k).push({ tick: e.tick, v: e.b });
      } else if (e.type === 0x80 || (e.type === 0x90 && e.b === 0)) {
        const k = e.ch * 128 + e.a;
        const st = open.get(k)?.shift();
        if (!st) continue;
        if (!byCh.has(e.ch)) byCh.set(e.ch, []);
        byCh.get(e.ch).push({ t: toSec(st.tick), d: Math.max(0.03, toSec(e.tick) - toSec(st.tick)), n: e.a, v: st.v });
      } else if (e.type === 0xb0 && e.a === 64) {
        pedals.push({ t: toSec(e.tick), on: e.b >= 64, ch: e.ch });
      }
    }
    for (const [ch, notes] of byCh) {
      const pg = prog.get(ch) ?? 0;
      const name = tr.name || (ch === 9 ? 'Drums' : GM[pg] || `Track ${ti + 1}`);
      const piano = ch !== 9 && (pg <= 7 || PIANO_RE.test(tr.name));
      lines.push({ name: byCh.size > 1 ? `${name} (ch ${ch + 1})` : name, piano, ch, notes: notes.sort((a, b) => a.t - b.t || a.n - b.n) });
    }
  });

  const pianoCh = new Set(lines.filter((l) => l.piano).map((l) => l.ch));
  return {
    title: title || fallbackTitle,
    lines: lines.map((l, i) => ({ id: i, name: l.name, piano: l.piano, notes: l.notes })),
    pedals: pedals.filter((pd) => pianoCh.has(pd.ch)).sort((a, b) => a.t - b.t).map(({ t, on }) => ({ t, on })),
  };
}
