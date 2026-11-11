// Headless: errors thrown in the piano and studio windows end up in userData/logs/melofi.log,
// and 문제 신고 (report:info) lists them. Run: node tools/test-errorlog.mjs
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const electron = require('electron');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'melofi-errlog-'));
const ud = path.join(tmp, 'userdata');
const piano = path.join(tmp, 'piano.js'), studio = path.join(tmp, 'studio.js');

fs.writeFileSync(piano, `
  for (let i = 0; i < 150 && !window.__melofi?.ui; i++) await new Promise((r) => setTimeout(r, 100));
  const A = window.__melofi;
  setTimeout(() => { throw new Error('errlog-piano-throw'); });
  Promise.reject(new Error('errlog-piano-reject'));
  console.error('errlog-piano-console');
  await new Promise((r) => setTimeout(r, 400));
  // the menu entries are there
  const items = A.ui.menuItems('settings').map((i) => i.label).join('|');
  console.log('menu: ' + items);
  await window.melofi.openStudioWindow();
  await new Promise((r) => setTimeout(r, 300));
  return [];
`);
fs.writeFileSync(studio, `
  await new Promise((r) => setTimeout(r, 2500));
  setTimeout(() => { throw new TypeError('errlog-studio-throw'); });
  await new Promise((r) => setTimeout(r, 600));
  const info = await window.melofi.reportInfo();
  console.log('report: ' + JSON.stringify({ n: info.errors.length, sys: Object.keys(info.system), hasPiano: info.errors.some((e) => e.includes('errlog-piano-throw')) }));
  return [];
`);

const out = await new Promise((resolve) => {
  let text = '';
  const p = spawn(electron, ['.'], { cwd: ROOT, env: { ...process.env, MELOFI_SHOT: tmp, MELOFI_USERDATA: ud, MELOFI_SCRIPT: piano, MELOFI_STUDIO_SCRIPT: studio }, windowsHide: true });
  p.stdout.on('data', (d) => { text += d; });
  p.stderr.on('data', (d) => { text += d; });
  const kill = setTimeout(() => p.kill(), 90000);
  p.on('close', () => { clearTimeout(kill); resolve(text); });
});

let log = '';
try { log = fs.readFileSync(path.join(ud, 'logs', 'melofi.log'), 'utf8'); } catch { /* none */ }
let fails = 0;
const ok = (cond, name) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${name}`); if (!cond) fails++; };
const line = (s) => log.split('\n').find((l) => l.includes(s)) || '';

ok(/v\d+\.\d+\.\d+ win32|v\d+\.\d+\.\d+ \w+ /.test(log) && log.includes('] info: start'), 'log file started with version and OS');
ok(/\[piano\] error: (Uncaught )?(Error: )?errlog-piano-throw/.test(line('errlog-piano-throw')), `piano throw logged: ${line('errlog-piano-throw').slice(0, 160)}`);
ok(/errlog-piano-throw \(index\.html:\d+\)\r?\n\s+Error: errlog-piano-throw\r?\n\s+at /.test(log), 'piano throw has its source line and stack');
ok(/\[piano\] error: unhandledrejection: errlog-piano-reject/.test(log), 'piano unhandled rejection logged');
ok(/\[piano\] console: errlog-piano-console/.test(log), 'piano console.error logged');
ok(/\[studio\] error: .*errlog-studio-throw/.test(log), 'studio throw logged');
ok(/menu: .*업데이트 확인.*문제 신고/.test(out), 'settings menu has 업데이트 확인 and 문제 신고');
const rep = /report: (\{.*\})/.exec(out);
const r = rep ? JSON.parse(rep[1]) : null;
ok(r && r.hasPiano && r.sys.includes('MeloFi') && r.sys.includes('OS'), `report:info lists the errors and system (${rep?.[1]})`);

if (fails) { console.log('--- electron output ---\n' + out.slice(-3000) + '\n--- log ---\n' + log.slice(-3000)); }
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(fails ? 1 : 0);
