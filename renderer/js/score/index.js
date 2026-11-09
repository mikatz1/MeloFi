// Opens a score file and returns { title, lines: [{ id, name, piano, notes: [{t, d, n, v}] }], pedals, duration }.
import { unzip } from './common.js';
import { parseMscx } from './mscx.js';
import { parseMusicXml } from './musicxml.js';
import { parseMidi } from './midi.js';

export const SCORE_EXT = ['mscz', 'mscx', 'mxl', 'musicxml', 'xml', 'mid', 'midi'];

// XML can come as UTF-8 or UTF-16 (Finale / Sibelius exports), with or without a BOM
export function text(b) {
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2));
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b.subarray(2));
  if (b[0] === 0x3c && b[1] === 0x00) return new TextDecoder('utf-16le').decode(b);
  if (b[0] === 0x00 && b[1] === 0x3c) return new TextDecoder('utf-16be').decode(b);
  const s = new TextDecoder('utf-8').decode(b);
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

export async function readScore(name, bytes) {
  const ext = name.split('.').pop().toLowerCase();
  const base = name.replace(/\.[^.]+$/, '');
  let song;
  if (ext === 'mid' || ext === 'midi') song = parseMidi(bytes, base);
  else if (ext === 'mscx') song = parseMscx(text(bytes), base);
  else if (ext === 'musicxml' || ext === 'xml') song = parseMusicXml(text(bytes), base);
  else if (ext === 'mscz' || ext === 'mxl') {
    const files = unzip(bytes);
    const container = files.get('META-INF/container.xml');
    // MuseScore 4 lists the style sheet, thumbnail and settings as rootfiles too (style first),
    // so take the first rootfile that is actually a score
    const want = ext === 'mscz' ? /\.mscx$/i : /\.(musicxml|xml)$/i;
    const isScore = (f) => !!f && files.has(f) && (want.test(f) || /\.mscx$/i.test(f)) && !f.startsWith('META-INF');
    let root = null;
    if (container) {
      const doc = new DOMParser().parseFromString(text(await container()), 'application/xml');
      root = [...doc.querySelectorAll('rootfile')].map((r) => r.getAttribute('full-path')).find(isScore) || null;
    }
    if (!root) root = [...files.keys()].find(isScore);
    if (!root) throw new Error('압축 파일 안에서 악보를 찾지 못했습니다.');
    const xml = text(await files.get(root)());
    song = /\.mscx$/i.test(root) ? parseMscx(xml, base) : parseMusicXml(xml, base);
  } else {
    throw new Error(`지원하지 않는 형식입니다: .${ext}`);
  }
  if (!song.lines.length) throw new Error('악보에 음표가 없습니다.');
  song.duration = Math.max(...song.lines.map((l) => (l.notes.length ? l.notes[l.notes.length - 1].t + l.notes[l.notes.length - 1].d : 0)));
  return song;
}
