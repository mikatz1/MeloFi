// Checks our repeat/jump unrolling against MuseScore's own repeat tests.
//   node tools/test-repeats.mjs [-v]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from 'linkedom';

globalThis.DOMParser = DOMParser;
const here = path.dirname(fileURLToPath(import.meta.url));
const { playOrder } = await import('../renderer/js/score/mscx.js');

const src = fs.readFileSync(path.join(here, 'fixtures', 'repeat_tests.cpp'), 'utf8');
const cases = [...src.matchAll(/repeat\("(repeat\d+\.mscx)",\s*u"([^"]*)"\)/g)].map((m) => [m[1], m[2].replace(/\s/g, '')]);
let pass = 0;
const fails = [];
for (const [file, want] of cases) {
  const xml = fs.readFileSync(path.join(here, 'fixtures', 'repeat', file), 'utf8');
  let got;
  try { got = playOrder(xml).join(';'); } catch (e) { got = `ERROR ${e.message}`; }
  if (got === want) pass++; else fails.push([file, want, got]);
}
console.log(`${pass}/${cases.length} match MuseScore`);
if (process.argv.includes('-v')) for (const [f, w, g] of fails) console.log(`${f}\n  want ${w}\n  got  ${g}`);
