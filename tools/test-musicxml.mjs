// Cross-check: our MusicXML reader vs our MuseScore reader on MuseScore's own import of the same file.
//   node tools/test-musicxml.mjs [-v]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from 'linkedom';
globalThis.DOMParser = DOMParser;
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'musicxml');
const { parseMusicXml } = await import('../renderer/js/score/musicxml.js');
const { parseMscx } = await import('../renderer/js/score/mscx.js');
const { text } = await import('../renderer/js/score/index.js');
const sig = (song) => song.lines.flatMap((l) => l.notes).map((n) => [Math.round(n.t * 1000), n.n]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
let ok = 0, n = 0;
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.xml'))) {
  const name = f.slice(0, -4);
  if (!fs.existsSync(path.join(dir, `${name}_ref.mscx`))) continue;
  n++;
  try {
    const a = sig(parseMusicXml(text(new Uint8Array(fs.readFileSync(path.join(dir, f)))), name));
    const b = sig(parseMscx(text(new Uint8Array(fs.readFileSync(path.join(dir, `${name}_ref.mscx`)))), name));
    const same = a.length === b.length && a.every((x, i) => Math.abs(x[0] - b[i][0]) <= 15 && x[1] === b[i][1]);
    if (same) ok++;
    const first = a.findIndex((x, i) => !b[i] || Math.abs(x[0] - b[i][0]) > 15 || x[1] !== b[i][1]);
    console.log(`${same ? 'ok  ' : 'DIFF'} ${name}: xml ${a.length} notes / MuseScore ${b.length} notes` + (same ? '' : ` | first diff #${first}: xml ${JSON.stringify(a[first])} mscz ${JSON.stringify(b[first])}`));
  } catch (e) { console.log(`ERR  ${name}: ${e.message}`); }
}
console.log(`\n${ok}/${n} identical`);
