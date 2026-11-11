// Vocals: a channel's melody plus one syllable per note, sung by a voice installed in the main
// process (vocal.js: NNSVS and DiffSinger voices). Also the shared API other windows use:
//   singNotes({ notes: [[t, d, pitch, vel]], syllables, voice })  -> { ok, wav, seconds, ... }
//   recognizeLyrics({ path | name+data, notes, language })        -> { ok, text, notes: [syl] }
// Times in that API are seconds.
import { PPQ } from './model.js';
import { t } from '../i18n/i18n.js';
import { eventsFor } from './transport.js';

// ---------------------------------------------------------------- syllables
// Japanese kana split into morae: small ゃゅょ / ぁぃぅぇぉ / ゎ join the kana before them;
// っ, ん and ー are morae of their own.
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

// English: a rough syllable count (vowel groups, a silent final e does not count)
export function englishSyllables(word) {
  const w = String(word).toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  let n = (w.match(/[aeiouy]+/g) || []).length;
  if (w.endsWith('e') && !/(le|ee|ye)$/.test(w) && n > 1) n--;
  return Math.max(1, n);
}

// romaji typed for a Japanese voice: "kirakira" -> ki ra ki ra
const ROMA = /(?:[bcdfghjklmnpqrstvwxyz]{0,2}y?[aeiou]|n(?![aeiouy])|[^aeiou\s]$)/gi;

// text -> syllables in order. langs: what the voice sings. Hangul: one per character; kana: per mora;
// Latin: English words (word, then "+" for its further syllables) or romaji for Japanese-only voices.
// "-" is a rest, "+" holds the previous vowel; both can be typed.
export function syllables(text, langs = ['ja']) {
  const out = [];
  const english = langs.includes('en');
  for (const tok of String(text || '').normalize('NFC').split(/\s+/).filter(Boolean)) {
    if (tok === '-' || tok === '+') { out.push(tok); continue; }
    // a token can mix scripts ("사랑해요", "きらきら", "love"); walk it in runs
    for (const run of tok.match(/[가-힣]+|[ぁ-ゖァ-ヺー]+|[A-Za-z']+|[+-]/g) || []) {
      if (/^[가-힣]/.test(run)) out.push(...run);
      else if (KANA.test(run[0])) out.push(...morae(run));
      else if (run === '+' || run === '-') out.push(run);
      else if (english) { const n = englishSyllables(run); if (n) out.push(run.toLowerCase(), ...Array(n - 1).fill('+')); }
      else out.push(...(run.toLowerCase().match(ROMA) || []));
    }
  }
  return out;
}

// what a voice cannot sing in the text (for a warning under the lyrics box)
export function unsupported(text, langs = ['ja']) {
  const bad = new Set();
  for (const c of String(text || '')) {
    if (/[一-鿿]/.test(c)) bad.add(c); // kanji: type the reading in kana
    else if (/[가-힣]/.test(c) && !langs.includes('ko') && !langs.includes('ja')) bad.add(c);
  }
  return [...bad];
}
// Hangul on a Japanese-only voice is sung as the nearest kana (approximate)
export const approximates = (text, langs) => /[가-힣]/.test(String(text || '')) && !langs.includes('ko');

// one syllable per note, in order; notes past the end hold the last vowel
export function spread(text, count, langs) {
  const syl = syllables(text, langs);
  return Array.from({ length: count }, (_, i) => (i < syl.length ? syl[i] : syl.length ? '+' : 'ら'));
}

// ---------------------------------------------------------------- the channel's melody
// the channel's notes as the song (or the current pattern) plays them, one at a time:
// chords keep their top note, and a note is cut where the next one starts
export function melodyOf(proj, chId) {
  const of = (mode) => eventsFor({ ...proj, loopOn: false, channels: proj.channels.map((c) => (c.id === chId ? { ...c, mute: false } : c)) }, mode)
    .events.filter((e) => e.type === 'n' && e.ch === chId);
  // the song when its playlist plays this channel; else the pattern (a song may hold only the sung take)
  let ev = proj.playlist.clips.length ? of('song') : [];
  if (!ev.length) ev = of('pattern');
  ev.sort((a, b) => a.tick - b.tick || b.n - a.n);
  const out = [];
  for (const e of ev) {
    const prev = out[out.length - 1];
    if (prev && prev.tick === e.tick) continue; // same start: the top note is already in
    if (prev && prev.tick + prev.d > e.tick) prev.d = e.tick - prev.tick;
    out.push({ tick: e.tick, d: e.d, n: e.n, v: e.v });
  }
  return out.filter((e) => e.d > 0);
}

// ticks -> seconds at the project tempo
export function toSeconds(proj, notes) {
  const sec = 60 / (proj.bpm || 120) / PPQ;
  return notes.map((e) => [e.tick * sec, e.d * sec, e.n, e.v ?? 100]);
}

// the per-note syllables a channel sings: its edited list, else its lyrics spread over the notes
export function channelSyllables(ch, count, langs) {
  const v = ch.vocal || {};
  const base = spread(v.lyrics || '', count, langs);
  if (Array.isArray(v.syl)) for (let i = 0; i < count; i++) if (typeof v.syl[i] === 'string' && v.syl[i] !== '') base[i] = v.syl[i];
  return base;
}

// ---------------------------------------------------------------- API for other windows
let statusCache = null;
export async function voices(refresh = false) {
  if (!statusCache || refresh) statusCache = await window.melofi.vocalStatus({ refresh });
  return statusCache;
}
// the voice to use when none was picked: the first one that is ready, women and men alike
export async function defaultVoice() {
  const st = await voices();
  return st.voices.find((v) => v.ready)?.id || null;
}

/**
 * Sing notes with a voice.
 * @param {object} o
 * @param {Array<[number, number, number, number]>} o.notes  [t, d, pitch, vel] — seconds, MIDI note
 * @param {string[]|string} o.syllables  one per note ("+" holds, "-" rests), or a line of lyrics to spread
 * @param {string} [o.voice]  voice id (vocalStatus().voices[].id); the first ready voice when left out
 * @param {string} [o.speaker]  style for voices that have several
 * @param {(m: {p?: number, label?: string}) => void} [o.onProgress]
 * @returns {Promise<{ok: boolean, wav?: Uint8Array, seconds?: number, sr?: number, use?: string, credit?: string, message?: string}>}
 *   wav is a 24-bit WAV that starts at t = 0 (the same clock as the notes).
 */
export async function singNotes({ notes, syllables: syl, voice, speaker, onProgress } = {}) {
  const id = voice || (await defaultVoice());
  if (!id) return { ok: false, error: 'no_voice', message: t('설치된 보이스가 없어요. 채널 설정 > 보컬에서 보이스를 내려받아 주세요.') };
  const st = await voices();
  const langs = st.voices.find((v) => v.id === id)?.langs || ['ja'];
  const list = (notes || []).map((x) => (Array.isArray(x) ? x : [x.t, x.d, x.n ?? x.pitch, x.v ?? x.vel]));
  const per = Array.isArray(syl) ? list.map((_, i) => String(syl[i] ?? '+')) : spread(syl || '', list.length, langs);
  const off = onProgress ? window.melofi.onVocalProgress((m) => { if (m.id === 'render') onProgress(m); }) : null;
  try {
    return await window.melofi.vocalRender({ voice: id, speaker, notes: list.map(([t, d, n], i) => ({ t, d, n, syl: per[i] })) });
  } finally { off?.(); }
}

/**
 * Lyrics from a sung recording (a separated vocal stem works best).
 * @param {object} o  { path } or { name, data: Uint8Array }; notes: [[t, d, pitch, vel]] (seconds) to align to; language: 'ko'|'ja'|'en'
 * @returns {Promise<{ok: boolean, text?: string, language?: string, syllables?: {text: string, start: number, end: number}[], notes?: string[], message?: string}>}
 */
export async function recognizeLyrics({ path, name, data, notes, language, onProgress } = {}) {
  const list = (notes || []).map((x) => (Array.isArray(x) ? { t: x[0], d: x[1], n: x[2] } : x));
  const off = onProgress ? window.melofi.onVocalProgress((m) => { if (m.id === 'lyrics') onProgress(m); }) : null;
  try {
    return await window.melofi.vocalLyrics({ path, name, data, notes: list, language });
  } finally { off?.(); }
}
