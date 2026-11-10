// Vocals: turn a channel's melody plus lyrics into MusicXML for the singing engine (NNSVS in the
// main process). One syllable (mora) per note; a note without a syllable continues the previous one.
import { PPQ, barTicks } from './model.js';
import { eventsFor } from './transport.js';

// The voice available today (NNSVS "yoko") sings Japanese, so lyrics are kana.
// Japanese kana split into morae: small ゃゅょ / ぁぃぅぇぉ / ゎ join the kana before them;
// っ, ん and ー are morae of their own. Anything else (spaces, punctuation) is dropped.
const SMALL = new Set([...'ゃゅょぁぃぅぇぉゎャュョァィゥェォヮ']);
const KANA = /[ぁ-ゖァ-ヺー]/;
export function morae(text) {
  const out = [];
  for (const c of String(text || '').normalize('NFC')) {
    if (!KANA.test(c)) continue;
    if (SMALL.has(c) && out.length) out[out.length - 1] += c;
    else out.push(c);
  }
  return out;
}

// what the engine cannot sing: kanji or other scripts in the lyrics
export function unsupported(text) {
  const bad = new Set();
  for (const c of String(text || '')) if (/[一-鿿가-힣A-Za-z]/.test(c)) bad.add(c);
  return [...bad];
}

const STEPS = ['C', 'C', 'D', 'D', 'E', 'F', 'F', 'G', 'G', 'A', 'A', 'B'];
const ALTER = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];

// the channel's notes as the song (or the current pattern) plays them, one at a time:
// chords keep their top note, and a note is cut where the next one starts
export function melodyOf(proj, chId) {
  const mode = proj.playlist.clips.length ? 'song' : 'pattern';
  const { events } = eventsFor({ ...proj, loopOn: false, channels: proj.channels.map((c) => (c.id === chId ? { ...c, mute: false } : c)) }, mode);
  const ev = events.filter((e) => e.type === 'n' && e.ch === chId)
    .sort((a, b) => a.tick - b.tick || b.n - a.n);
  const out = [];
  for (const e of ev) {
    const prev = out[out.length - 1];
    if (prev && prev.tick === e.tick) continue; // same start: the top note is already in
    if (prev && prev.tick + prev.d > e.tick) prev.d = e.tick - prev.tick;
    out.push({ tick: e.tick, d: e.d, n: e.n, lyr: e.lyr });
  }
  return out.filter((e) => e.d > 0);
}

// MusicXML (partwise, divisions = PPQ) with ties across bar lines and rests in the gaps
export function toMusicXml(proj, notes, lyrics) {
  const syl = morae(lyrics);
  const bar = barTicks(proj);
  const [beats, beatType] = proj.sig || [4, 4];
  const end = notes.length ? notes[notes.length - 1].tick + notes[notes.length - 1].d : bar;
  const bars = Math.ceil(end / bar) + 1; // one empty bar at the end lets the last note release
  const measures = Array.from({ length: bars }, () => []);
  const restAt = (b, from, to) => { if (to > from) measures[b].push(`<note><rest/><duration>${to - from}</duration></note>`); };
  let k = 0, cursor = 0;
  const pitch = (n) => `<pitch><step>${STEPS[n % 12]}</step>${ALTER[n % 12] ? '<alter>1</alter>' : ''}<octave>${Math.floor(n / 12) - 1}</octave></pitch>`;
  for (const e of notes) {
    // no lyrics at all: sing "ら"; lyrics ran out: hold the vowel ("ー")
    const lyr = e.lyr || (syl.length ? syl[k++] || 'ー' : 'ら');
    // rest up to the note, bar by bar
    while (cursor < e.tick) { const b = Math.floor(cursor / bar), z = Math.min(e.tick, (b + 1) * bar); restAt(b, cursor, z); cursor = z; }
    let t = e.tick, left = e.d, first = true;
    while (left > 0) {
      const b = Math.floor(t / bar), z = Math.min(t + left, (b + 1) * bar), len = z - t;
      const tieStart = z < t + left, tieStop = !first;
      const ties = `${tieStop ? '<tie type="stop"/>' : ''}${tieStart ? '<tie type="start"/>' : ''}`;
      const notat = tieStart || tieStop ? `<notations>${tieStop ? '<tied type="stop"/>' : ''}${tieStart ? '<tied type="start"/>' : ''}</notations>` : '';
      measures[b].push(`<note>${pitch(e.n)}<duration>${len}</duration>${ties}${notat}${first && lyr ? `<lyric><text>${lyr}</text></lyric>` : ''}</note>`);
      t = z; left -= len; first = false;
    }
    cursor = e.tick + e.d;
  }
  for (let b = Math.floor(cursor / bar); b < bars; b++) { restAt(b, Math.max(cursor, b * bar), (b + 1) * bar); cursor = (b + 1) * bar; }
  const head = `<attributes><divisions>${PPQ}</divisions><key><fifths>0</fifths></key><time><beats>${beats}</beats><beat-type>${beatType}</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${proj.bpm}</per-minute></metronome></direction-type><sound tempo="${proj.bpm}"/></direction>`;
  const body = measures.map((m, i) => `<measure number="${i + 1}">${i === 0 ? head : ''}${m.join('')}</measure>`).join('');
  return { xml: `<?xml version="1.0" encoding="UTF-8"?>\n<score-partwise version="3.1"><part-list><score-part id="P1"><part-name>Vocal</part-name></score-part></part-list><part id="P1">${body}</part></score-partwise>`, used: Math.min(k, syl.length), syllables: syl.length, notes: notes.length };
}
