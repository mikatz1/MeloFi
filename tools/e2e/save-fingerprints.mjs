// Takes the log of a tools/e2e/fingerprints.js run and writes renderer/studio/fingerprints.json
// (a full run replaces the file; one limited to some ids is merged into it).
//   node tools/e2e/save-fingerprints.mjs <log file>
import fs from 'node:fs';
import path from 'node:path';
const log = fs.readFileSync(process.argv[2], 'utf8');
const m = /FPJSON-BEGIN(.*?)FPJSON-END/s.exec(log);
if (!m) { console.error('no FPJSON in the log'); process.exit(1); }
const fresh = JSON.parse(m[1]);
const file = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '..', '..', 'renderer', 'studio', 'fingerprints.json');
let old = {};
try { old = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* first time */ }
// a full run replaces the file (sounds that are gone go too); a partial one is merged in
const all = /FPJSON-END\s*FPFULL/.test(log) ? fresh : { ...old, ...fresh };
const sorted = Object.fromEntries(Object.keys(all).sort().map((k) => [k, all[k]]));
// one sound per line: small diffs when a few change
fs.writeFileSync(file, '{\n' + Object.entries(sorted).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n') + '\n}\n');
const bad = Object.entries(fresh).filter(([, v]) => v.error).map(([k, v]) => `${k}: ${v.error}`);
console.log(`${Object.keys(fresh).length} written (${Object.keys(sorted).length} in the file)${bad.length ? `; errors:\n  ${bad.join('\n  ')}` : ''}`);
