// 창작마당 and the account center, headless, end to end:
//   fake GitHub + Discord (fake-github.mjs)  <-  the real Helper index (helper/workshop.py)  <-  MeloFi
// The app is signed in as GitHub user "alice" (MELOFI_TEST_ACCOUNT); "bob" has two works already,
// with a Discord user's like and comment. tools/e2e/workshop-e2e.js then uses the piano window and the
// studio (dark and white) like a person would and writes screenshots to <tmp>/shots.
//   node tools/e2e/workshop-run.mjs          (needs python with aiohttp)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { startFake } from './fake-github.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const UD = path.join(os.tmpdir(), 'melofi-workshop-e2e');
fs.rmSync(UD, { recursive: true, force: true });
const SHOTS = path.join(UD, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

// ---- test media ----
function wav(seconds = 3, rate = 22050) {
  const n = seconds * rate, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const env = Math.min(1, i / 2000) * Math.exp(-((i % rate) / rate) * 3);
    b.writeInt16LE(Math.round(Math.sin(2 * Math.PI * [262, 330, 392][Math.floor(i / rate) % 3] * i / rate) * env * 12000), 44 + i * 2);
  }
  return b;
}
function midi() {
  const ev = [0x00, 0x90, 60, 90, 0x60, 0x80, 60, 0, 0x00, 0x90, 64, 90, 0x60, 0x80, 64, 0, 0x00, 0xff, 0x2f, 0x00];
  const trk = Buffer.from(ev);
  const h = Buffer.from([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0, 96]);
  const th = Buffer.alloc(8); th.write('MTrk', 0); th.writeUInt32BE(trk.length, 4);
  return Buffer.concat([h, th, trk]);
}
function png(w = 96, h = 96, [r, g, b] = [52, 92, 110]) {
  const crc = (buf) => { let c = ~0; for (const x of buf) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (type, data) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3, s = (x + y) % 24 < 12 ? 1 : 0.8; raw[o] = r * s; raw[o + 1] = g * s; raw[o + 2] = b * s; }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ---- servers ----
const fake = await startFake();
const port = 18500 + (process.pid % 400);
const py = spawn(process.env.PYTHON || 'python', [path.join(ROOT, 'helper/workshop.py'), '--port', String(port), '--db', path.join(UD, 'workshop.sqlite')], {
  env: { ...process.env, GITHUB_API: fake.base, DISCORD_API: `${fake.base}/discord`, PYTHONIOENCODING: 'utf-8' }, stdio: ['ignore', 'pipe', 'pipe'],
});
let pyErr = '';
py.stderr.on('data', (d) => { pyErr += d; });
await new Promise((res, rej) => { py.stdout.on('data', (d) => { if (String(d).includes('workshop on')) res(); }); py.on('exit', () => rej(new Error('helper did not start\n' + pyErr))); });
const H = `http://127.0.0.1:${port}`;
const hcall = async (method, url, body, tok, prov = 'github') => (await fetch(H + url, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}`, 'x-melofi-provider': prov }, body: body ? JSON.stringify(body) : undefined })).json();
const gist = async (tok, files, pub = true) => (await (await fetch(`${fake.base}/gists`, { method: 'POST', headers: { authorization: `Bearer ${tok}` }, body: JSON.stringify({ public: pub, description: 'MeloFi 창작마당: x', files }) })).json()).id;

// bob: an audio + MIDI piano piece with a cover, and a studio project
const w1 = await gist('gh-bob', {
  'melofi-workshop.json': { content: JSON.stringify({ v: 1, title: '비 오는 날의 에튀드', description: '창밖에 비가 와서 즉흥으로 쳐 봤어요.\n페달을 길게 썼어요.', tags: ['piano', 'rain', 'improv'], genre: 'piano', app: 'piano', length: 3, files: [{ name: 'audio.wav.b64', role: 'audio', type: 'audio/wav', size: 132344, label: 'take-01.wav' }, { name: 'song.mid.b64', role: 'midi', type: 'audio/midi', size: 42, label: 'take-01.mid' }], cover: 'cover.jpg.b64' }) },
  'audio.wav.b64': { content: wav().toString('base64') }, 'song.mid.b64': { content: midi().toString('base64') }, 'cover.jpg.b64': { content: png().toString('base64') },
});
const proj = fs.readFileSync(path.join(ROOT, 'tools/e2e/fixtures/v2-composer2-lofi.mfproj'), 'utf8');
const w2 = await gist('gh-bob', {
  'melofi-workshop.json': { content: JSON.stringify({ v: 1, title: 'Late Night Lofi Loop', description: '', tags: ['lofi', 'beat'], genre: 'lofi', app: 'studio', bpm: 78, files: [{ name: 'project.melofi.json', role: 'project', type: 'application/json', size: proj.length, label: 'Lofi' }] }) },
  'project.melofi.json': { content: proj },
});
for (const id of [w1, w2]) await hcall('POST', '/workshop/items', { gist: id }, 'gh-bob');
await hcall('POST', `/workshop/items/${w1}/like`, { on: true }, 'dc-carol', 'discord');
await hcall('POST', `/workshop/items/${w1}/comments`, { text: '빗소리랑 잘 어울려요. 두 번째 마디 화음이 좋네요.' }, 'dc-carol', 'discord');

// a recording in the piano's recording folder (the upload test picks it)
const REC = path.join(UD, 'recs');
fs.mkdirSync(REC, { recursive: true });
fs.writeFileSync(path.join(REC, 'MeloFi_20261112_2210.wav'), wav(4));
fs.writeFileSync(path.join(REC, 'MeloFi_20261112_2210.mid'), midi());

// ---- the app ----
const electron = path.join(ROOT, 'node_modules/.bin', process.platform === 'win32' ? 'electron.cmd' : 'electron');
const env = {
  ...process.env, MELOFI_SHOT: SHOTS, MELOFI_SCRIPT: path.join(ROOT, 'tools/e2e/workshop-e2e.js'), MELOFI_USERDATA: path.join(UD, 'userdata'),
  MELOFI_HELPER: H, MELOFI_GITHUB_API: fake.base, MELOFI_GIST_RAW: `${fake.base}/raw`,
  MELOFI_TEST_ACCOUNT: JSON.stringify({ github: { token: 'gh-alice', user: { id: 101, name: 'Alice Kim', handle: 'alice' } } }),
  MELOFI_WS_REC: REC, MELOFI_WS_SEED: JSON.stringify({ w1, w2 }),
};
// the script reads MELOFI_WS_* through a file next to the shots (the page has no process.env)
fs.writeFileSync(path.join(SHOTS, 'seed.json'), JSON.stringify({ rec: REC, w1, w2, fake: fake.base }));
let out = '';
const code = await new Promise((resolve) => {
  const child = spawn(electron, ['.'], { cwd: ROOT, env, shell: process.platform === 'win32' });
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const timer = setTimeout(() => { child.kill(); resolve('timeout'); }, 10 * 60 * 1000);
  child.on('exit', (c) => { clearTimeout(timer); resolve(c); });
});
py.kill();
fake.server.close();
const m = out.match(/E2E-BEGIN\n([\s\S]*?)\nE2E-END/);
const lines = m ? m[1].split('\n').map((l) => l.replace(/^\[[^\]]+\] /, '')) : [];
if (!m) console.log(out.slice(-4000));
for (const l of lines) console.log(l);
const fails = lines.filter((l) => l.startsWith('FAIL')).length;
console.log(`\n${lines.length - fails} pass, ${fails} fail (exit ${code}) · screenshots: ${SHOTS}`);
process.exitCode = fails || !m ? 1 : 0;
