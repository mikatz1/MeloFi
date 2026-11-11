// Static check of the translations (docs/i18n.md).
//   node tools/i18n-check.mjs [--files a.js,b.js] [--list] [--json]
// - every t('…') / tc('ctx', '…') / N_('…') key in the sources has an English entry
// - placeholders ({n}, {name}) match between the Korean key and the English text
// - Korean string literals that are not keys are listed per file ("unwrapped"): they still show in
//   Korean in the English UI unless they are data (search words), comments or logs.
// Files with `// i18n: source table` count every Korean literal as a key (renderer/js/strings.js);
// `// i18n-ignore-file` skips a file, `// i18n-ignore` skips a line. Exit code 1 on missing entries.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { placeholders } from '../renderer/i18n/core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const LIST = args.includes('--list');
const HANGUL = /[가-힣]/;

// ---- the English tables ----
const EN_DIR = path.join(ROOT, 'renderer', 'i18n', 'en');
const en = new Map(); const where = new Map(); const problems = [];
for (const f of fs.readdirSync(EN_DIR).filter((x) => x.endsWith('.json')).sort()) {
  let o;
  try { o = JSON.parse(fs.readFileSync(path.join(EN_DIR, f), 'utf8')); } catch (e) { problems.push(`${f}: bad JSON ${e.message}`); continue; }
  for (const [k, v] of Object.entries(o)) {
    if (k.startsWith('//')) continue;
    if (en.has(k) && en.get(k) !== v) problems.push(`duplicate key with different text: "${k}" (${where.get(k)}: "${en.get(k)}" / ${f}: "${v}")`);
    en.set(k, v); where.set(k, f);
    if (HANGUL.test(v)) problems.push(`${f}: English text still has Korean: "${k}" -> "${v}"`);
    const kk = k.includes('::') ? k.split('::').slice(1).join('::') : k;
    const a = placeholders(kk).join(','), b = placeholders(v).join(',');
    if (a !== b) problems.push(`${f}: placeholders differ: "${k}" {${a}} -> "${v}" {${b}}`);
  }
}

// ---- the sources ----
const SRC_DIRS = ['renderer/js', 'renderer/studio', 'renderer/i18n'];
const SRC_ROOT = ['main.js', 'preload.js', 'daw.js', 'account.js', 'studio-files.js', 'vocal.js', 'stems.js', 'engine-install.js', 'vsthost.js', 'crashlog.js', 'updater.js', 'report.js', 'i18n-main.js'];
const walk = (d) => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.(m?js|html)$/.test(e.name) ? [path.join(d, e.name)] : []));
let files = opt('--files') ? opt('--files').split(',') : [...SRC_DIRS.flatMap(walk), ...SRC_ROOT.filter((f) => fs.existsSync(path.join(ROOT, f))), ...fs.readdirSync(path.join(ROOT, 'renderer')).filter((f) => f.endsWith('.html')).map((f) => `renderer/${f}`)];
files = files.map((f) => f.replace(/\\/g, '/'));

// string literals of a JS source: [{ s, start, text, line }]; template literals give their static
// parts with ${…} as {…}. A rough tokenizer: comments, strings, templates; regex literals are guessed.
function literals(src) {
  const out = []; let i = 0, line = 1;
  const n = src.length;
  const prevSig = (k) => { let j = k - 1; while (j >= 0 && /\s/.test(src[j])) j--; return j >= 0 ? src[j] : ''; };
  while (i < n) {
    const c = src[i];
    if (c === '\n') { line++; i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); const seg = src.slice(i, e < 0 ? n : e + 2); line += (seg.match(/\n/g) || []).length; i = e < 0 ? n : e + 2; continue; }
    if (c === '/' && /[(,=:[!&|?{};+\-*%<>~^]|^$/.test(prevSig(i)) ) {
      // regex literal
      let j = i + 1, cls = false;
      while (j < n && src[j] !== '\n') { if (src[j] === '\\') { j += 2; continue; } if (src[j] === '[') cls = true; else if (src[j] === ']') cls = false; else if (src[j] === '/' && !cls) break; j++; }
      i = j + 1; continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1, s = '';
      while (j < n && src[j] !== c && src[j] !== '\n') { if (src[j] === '\\') { s += src[j + 1] === 'n' ? '\n' : src[j + 1]; j += 2; continue; } s += src[j]; j++; }
      out.push({ text: s, start: i, line, q: c });
      i = j + 1; continue;
    }
    if (c === '`') {
      let j = i + 1, s = '', depth = 0, startLine = line;
      while (j < n) {
        const d = src[j];
        if (d === '\\') { s += src[j + 1]; j += 2; continue; }
        if (d === '`') break;
        if (d === '\n') line++;
        if (d === '$' && src[j + 1] === '{') {
          // skip the expression (nested braces / strings, roughly)
          let k = j + 2; depth = 1;
          const lineAt = line;
          while (k < n && depth) { const e = src[k]; if (e === '{') depth++; else if (e === '}') depth--; else if (e === '\n') line++; else if (e === '`' || e === '"' || e === "'") { const q = e; k++; while (k < n && src[k] !== q) { if (src[k] === '\\') k++; k++; } } k++; }
          // the literals inside the expression count too (`${on ? '켜기' : '끄기'}`)
          for (const L of literals(src.slice(j + 2, k - 1))) out.push({ ...L, start: L.start + j + 2, line: lineAt + L.line - 1 });
          s += '{…}'; j = k; continue;
        }
        s += d; j++;
      }
      out.push({ text: s, start: i, line: startLine, q: '`' });
      i = j + 1; continue;
    }
    i++;
  }
  return out;
}

const keys = new Map(); // key -> first place
const report = [];
let totalKeys = 0, totalUnwrapped = 0;
for (const f of files) {
  const abs = path.join(ROOT, f);
  if (!fs.existsSync(abs)) continue;
  const src = fs.readFileSync(abs, 'utf8');
  if (/i18n-ignore-file/.test(src)) continue;
  const table = /\/\/ i18n: source table/.test(src);
  const lines = src.split('\n');
  let k = 0; const un = [];
  if (f.endsWith('.html')) {
    // static markup: text and attributes with Korean are keys (translateDom swaps them)
    const body = src.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/g, '');
    for (const m of body.matchAll(/>([^<>]+)</g)) { const s = m[1].trim(); if (HANGUL.test(s)) { k++; if (!keys.has(s)) keys.set(s, f); } }
    for (const m of body.matchAll(/\s(?:title|placeholder|aria-label|alt)="([^"]+)"/g)) { const s = m[1].trim(); if (HANGUL.test(s)) { k++; if (!keys.has(s)) keys.set(s, f); } }
  } else {
    for (const L of literals(src)) {
      if (!HANGUL.test(L.text)) continue;
      const lineText = lines[L.line - 1] || '';
      if (/i18n-ignore/.test(lineText)) continue;
      const before = src.slice(Math.max(0, L.start - 80), L.start);
      let key = null;
      if (table || /(?:^|[^\w$.]|i18n\.)(?:t|N_|tdyn)\(\s*$/.test(before)) key = L.text;
      else { const m = /(?:^|[^\w$.]|i18n\.)tc\(\s*(['"])([^'"]+)\1\s*,\s*$/.exec(before); if (m) key = `${m[2]}::${L.text}`; }
      if (key != null && L.q !== '`') {
        k++;
        if (!keys.has(key)) keys.set(key, `${f}:${L.line}`);
      } else if (key != null && L.q === '`') {
        un.push(`${L.line}: template literal used as a key (use '…' with {placeholders}): ${L.text.slice(0, 80)}`);
      } else if (!/console\.(log|warn|error|info|debug)|\blog\(|crashlog|throw new Error\(|new Error\(/.test(lineText)) {
        un.push(`${L.line}: ${L.text.replace(/\s+/g, ' ').slice(0, 90)}`);
      }
    }
  }
  totalKeys += k; totalUnwrapped += un.length;
  if (k || un.length) report.push({ f, k, un });
}

// instrument descriptions (model / use in the manifests) are shown through t() as well
for (const d of fs.readdirSync(path.join(ROOT, 'instruments'))) {
  let m;
  try { m = JSON.parse(fs.readFileSync(path.join(ROOT, 'instruments', d, 'manifest.json'), 'utf8')); } catch { continue; }
  for (const k of ['model', 'use']) if (typeof m[k] === 'string' && HANGUL.test(m[k]) && !keys.has(m[k])) keys.set(m[k], `instruments/${d}/manifest.json ${k}`);
}

const missingKeys = [...keys].filter(([key]) => !en.has(key) && !(key.includes('::') && en.has(key.split('::').slice(1).join('::'))));
report.sort((a, b) => b.un.length - a.un.length);
console.log('file\tkeys\tunwrapped');
for (const r of report) {
  console.log(`${r.f}\t${r.k}\t${r.un.length}`);
  if (LIST) for (const u of r.un) console.log(`    ${u}`);
}
console.log(`\n${keys.size} distinct keys in ${totalKeys} uses; ${en.size} English entries; ${missingKeys.length} keys without English; ${totalUnwrapped} Korean literals not wrapped`);
for (const [key, at] of missingKeys.slice(0, LIST ? 1e9 : 60)) console.log(`  missing: ${JSON.stringify(key)}  (${at})`);
if (missingKeys.length > 60 && !LIST) console.log(`  … ${missingKeys.length - 60} more (--list)`);
for (const p of problems) console.log(`  problem: ${p}`);
if (args.includes('--json')) fs.writeFileSync(path.join(ROOT, 'tools', 'i18n-missing.json'), JSON.stringify(Object.fromEntries(missingKeys.map(([k2]) => [k2, ''])), null, 1));
process.exitCode = missingKeys.length || problems.length ? 1 : 0;
