// 처음 설정 (renderer/js/firstrun.js), headless, on one scratch userData across several launches:
//   1 new install    the start card opens the setup; every step is walked (theme white, mic blocked,
//                    signed-in accounts, profile with an uploaded picture, extras); the app closes at 추가 설치
//   2 relaunch       it resumes at 추가 설치; 나중에 마저 하기 → the choice screen offers 설정 마무리하기;
//                    that reopens it; 마무리 → MeloFi 시작하기
//   3 relaunch       finished: straight to the choice screen, no 설정 마무리하기
//   4 existing user  settings from before the setup existed: not forced, 설정 마무리하기 offered
//   5 piano window   the setup as a sheet in dark and white; menu entry; account center link
// Uses the fake GitHub/Discord and the real Helper index (helper/workshop.py) like workshop-run.mjs.
//   node tools/e2e/firstrun-run.mjs        (screenshots in %TEMP%\melofi-firstrun-e2e\shots)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFake } from './fake-github.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BASE = path.join(os.tmpdir(), 'melofi-firstrun-e2e');
fs.rmSync(BASE, { recursive: true, force: true });
const SHOTS = path.join(BASE, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

const fake = await startFake();
const port = 18900 + (process.pid % 90);
const py = spawn(process.env.PYTHON || 'python', [path.join(ROOT, 'helper/workshop.py'), '--port', String(port), '--db', path.join(BASE, 'workshop.sqlite')], {
  env: { ...process.env, GITHUB_API: fake.base, DISCORD_API: `${fake.base}/discord`, PYTHONIOENCODING: 'utf-8' }, stdio: ['ignore', 'pipe', 'pipe'],
});
await new Promise((res, rej) => { py.stdout.on('data', (d) => { if (String(d).includes('workshop on')) res(); }); py.on('exit', () => rej(new Error('helper did not start'))); });
// someone already uses the nickname the test tries first
await fetch(`http://127.0.0.1:${port}/workshop/profile`, { method: 'PUT', headers: { 'content-type': 'application/json', authorization: 'Bearer gh-bob', 'x-melofi-provider': 'github' }, body: JSON.stringify({ nick: 'keys' }) });

const account = {
  github: { token: 'gh-alice', user: { id: 101, name: 'Alice Kim', handle: 'alice' } },
  discord: { token: 'dc-carol', refresh: null, expires: Date.now() + 30 * 864e5, user: { id: '9001', name: 'Carol', handle: 'carol', avatar: null }, guild: { name: 'MeloFi | Support KR', url: '' } },
};
const electron = path.join(ROOT, 'node_modules/.bin', process.platform === 'win32' ? 'electron.cmd' : 'electron');
const results = [];
async function launch(name, { ud, splash = null, piano = null, settings = undefined }) {
  if (settings !== undefined) { fs.mkdirSync(ud, { recursive: true }); fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify(settings)); }
  fs.writeFileSync(path.join(SHOTS, 'mode.json'), JSON.stringify({ run: name }));
  const env = {
    ...process.env, MELOFI_SHOT: SHOTS, MELOFI_USERDATA: ud, MELOFI_HELPER: `http://127.0.0.1:${port}`, MELOFI_GITHUB_API: fake.base, MELOFI_GIST_RAW: `${fake.base}/raw`,
    MELOFI_TEST_ACCOUNT: JSON.stringify(account),
    ...(splash ? { MELOFI_SPLASH_TEST: '1', MELOFI_SPLASH_SCRIPT: path.join(ROOT, 'tools/e2e', splash) } : {}),
    ...(piano ? { MELOFI_SCRIPT: path.join(ROOT, 'tools/e2e', piano) } : {}),
  };
  let out = '';
  const code = await new Promise((resolve) => {
    const child = spawn(electron, ['.'], { cwd: ROOT, env, shell: process.platform === 'win32' });
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const timer = setTimeout(() => { child.kill(); resolve('timeout'); }, 5 * 60 * 1000);
    child.on('exit', (c) => { clearTimeout(timer); resolve(c); });
  });
  const m = out.match(/E2E-BEGIN\n([\s\S]*?)\nE2E-END/);
  if (!m) { results.push(`FAIL ${name}: no results (exit ${code})`); console.log(out.slice(-3000)); return; }
  for (const l of m[1].split('\n')) results.push(`${l.replace(/^\[[^\]]+\] /, '')}`.replace(/^(PASS|FAIL) /, `$1 [${name}] `));
}

const UD = path.join(BASE, 'ud-new');
try {
  await launch('1 new install', { ud: UD, splash: 'firstrun-splash.js' });
  await launch('2 resume', { ud: UD, splash: 'firstrun-splash.js' });
  await launch('3 finished', { ud: UD, splash: 'firstrun-splash.js' });
  await launch('4 existing user', { ud: path.join(BASE, 'ud-old'), splash: 'firstrun-splash.js', settings: { keyPreset: 'zigzag', volume: 0.8, recDir: '' } });
  await launch('5 piano window', { ud: path.join(BASE, 'ud-app'), piano: 'firstrun-e2e.js', settings: { keyPreset: 'piano', volume: 0.8 } });
} finally {
  py.kill();
  fake.server.close();
}
for (const l of results) console.log(l);
const fails = results.filter((l) => l.startsWith('FAIL')).length;
console.log(`\n${results.length - fails} pass, ${fails} fail · screenshots: ${SHOTS}`);
process.exitCode = fails ? 1 : 0;
