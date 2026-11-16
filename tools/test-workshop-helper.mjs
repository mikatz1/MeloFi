// The 창작마당 index (helper/workshop.py) against the fake GitHub/Discord: publish, list, search, likes,
// comments, reports (auto-hide), counts, removal and forget-me. Needs python with aiohttp.
//   node tools/test-workshop-helper.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFake } from './e2e/fake-github.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fake = await startFake();
const db = path.join(os.tmpdir(), `melofi-ws-${process.pid}.sqlite`);
const port = 18000 + (process.pid % 1000);
const py = spawn(process.env.PYTHON || 'python', [path.join(ROOT, 'helper/workshop.py'), '--port', String(port), '--db', db], {
  env: { ...process.env, GITHUB_API: fake.base, DISCORD_API: `${fake.base}/discord` }, stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise((r) => py.stdout.on('data', (d) => { if (String(d).includes('workshop on')) r(); }));
const H = `http://127.0.0.1:${port}`;
let pass = 0, failN = 0;
const ok = (c, name) => { if (c) pass++; else { failN++; console.log('FAIL', name); } };
const call = async (method, url, body, tok, prov = 'github') => {
  const r = await fetch(H + url, { method, headers: { 'content-type': 'application/json', ...(tok ? { authorization: `Bearer ${tok}`, 'x-melofi-provider': prov } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};
const gist = async (tok, pub, manifest, extra = {}) => {
  const r = await fetch(`${fake.base}/gists`, { method: 'POST', headers: { authorization: `Bearer ${tok}` }, body: JSON.stringify({ public: pub, description: 'x', files: { 'melofi-workshop.json': { content: JSON.stringify(manifest) }, 'audio.mp3.b64': { content: 'AAAA' }, ...extra } }) });
  return (await r.json()).id;
};
const man = (title, o = {}) => ({ v: 1, title, description: 'd', tags: ['Piano', '#lofi'], genre: 'lofi', app: 'piano', files: [{ name: 'audio.mp3.b64', role: 'audio', type: 'audio/mpeg', size: 3 }], ...o });

try {
  const g1 = await gist('gh-alice', true, man('Rain Etude'));
  const g2 = await gist('gh-alice', true, man('Night Jazz', { genre: 'jazz', tags: ['jazz'] }));
  const g3 = await gist('gh-bob', true, man('Bob Song', { genre: 'pop', tags: ['pop', 'piano'] }));
  const gSecret = await gist('gh-alice', false, man('Secret'));
  let r = await call('POST', '/workshop/items', { gist: g1 }, 'gh-alice');
  ok(r.status === 201 && r.data.title === 'Rain Etude' && r.data.tags.join() === 'piano,lofi' && r.data.mine === true, 'publish');
  ok((await call('POST', '/workshop/items', { gist: g2 }, 'gh-alice')).status === 201, 'publish 2');
  ok((await call('POST', '/workshop/items', { gist: g3 }, 'gh-bob')).status === 201, 'publish 3');
  ok((await call('POST', '/workshop/items', { gist: g3 }, 'gh-alice')).status === 403, 'not owner');
  ok((await call('POST', '/workshop/items', { gist: gSecret }, 'gh-alice')).data.error === 'not_public', 'secret gist refused');
  ok((await call('POST', '/workshop/items', { gist: g1 }, 'dc-carol', 'discord')).data.error === 'github_required', 'discord cannot publish');
  ok((await call('POST', '/workshop/items', { gist: g1 })).status === 401, 'login required');
  r = await call('GET', '/workshop/items');
  ok(r.data.total === 3 && r.data.items[0].title === 'Bob Song', 'list newest');
  ok(r.data.tags.find((t) => t.tag === 'piano')?.n === 2, 'tag counts');
  ok((await call('GET', '/workshop/items?tag=jazz')).data.total === 1, 'tag filter');
  ok((await call('GET', '/workshop/items?genre=pop')).data.items[0]?.id === g3, 'genre filter');
  ok((await call('GET', '/workshop/items?q=rain')).data.total === 1, 'search');
  ok((await call('GET', '/workshop/items?owner=alice')).data.total === 2, 'owner filter');
  // likes and popular
  ok((await call('POST', `/workshop/items/${g2}/like`, { on: true }, 'dc-carol', 'discord')).data.likes === 1, 'like');
  await call('POST', `/workshop/items/${g2}/like`, { on: true }, 'gh-bob');
  ok((await call('GET', '/workshop/items?sort=popular&period=week')).data.items[0].id === g2, 'popular');
  r = await call('GET', `/workshop/items/${g2}`, null, 'dc-carol', 'discord');
  ok(r.data.liked === true && r.data.mine === false, 'liked flag');
  ok((await call('POST', `/workshop/items/${g2}/like`, { on: false }, 'dc-carol', 'discord')).data.likes === 1, 'unlike');
  // comments
  r = await call('POST', `/workshop/items/${g1}/comments`, { text: '  좋아요\n\n\n\n잘 들었어요 ' }, 'dc-carol', 'discord');
  ok(r.status === 201 && r.data.text === '좋아요\n\n잘 들었어요' && r.data.name === 'Carol', 'comment');
  const cid = r.data.id;
  r = await call('GET', `/workshop/items/${g1}/comments`, null, 'gh-alice');
  ok(r.data.comments.length === 1 && r.data.comments[0].canDelete && !r.data.comments[0].mine, 'owner can delete');
  ok(!JSON.stringify(r.data).includes('9001'), 'no discord id exposed');
  ok((await call('DELETE', `/workshop/comments/${cid}`, null, 'gh-bob')).status === 403, 'others cannot delete');
  ok((await call('DELETE', `/workshop/comments/${cid}`, null, 'gh-alice')).status === 200, 'owner deletes');
  // counts
  await call('POST', `/workshop/items/${g1}/count`, { what: 'play' });
  await call('POST', `/workshop/items/${g1}/count`, { what: 'play' });
  ok((await call('GET', `/workshop/items/${g1}`)).data.plays === 1, 'play counted once a day');
  // reports: hidden after three
  await call('POST', `/workshop/items/${g3}/report`, { reason: 'spam', text: 'ad' }, 'dc-carol', 'discord');
  await call('POST', `/workshop/items/${g3}/report`, { reason: 'spam' }, 'gh-alice');
  ok((await call('GET', '/workshop/items')).data.total === 3, 'two reports keep it');
  // a third reporter (bob reporting his own work counts too; the rule is distinct people)
  r = await call('POST', `/workshop/items/${g3}/report`, { reason: 'other' }, 'gh-bob');
  ok(r.data.reports === 3, 'third report');
  ok((await call('GET', '/workshop/items')).data.total === 2, 'hidden after three reports');
  ok((await call('GET', `/workshop/items/${g3}`)).status === 404, 'hidden item 404 for others');
  ok((await call('GET', `/workshop/items/${g3}`, null, 'gh-bob')).data.hidden === 1, 'owner still sees it');
  const health = await (await fetch(`${H}/health`)).json();
  ok(health.alerts.length === 3 && health.alerts[2].text.includes('자동으로 숨김'), 'moderator alerts');
  await fetch(`${H}/test/hide/${g3}?on=0`, { method: 'POST' });
  ok((await call('GET', '/workshop/items')).data.total === 3, 'moderator restores');
  // profiles: nickname check, reserved words, taken, avatar kinds, shown on works and comments
  const nick = async (n, tok, prov) => (await call('GET', `/workshop/nick?name=${encodeURIComponent(n)}`, null, tok, prov)).data;
  ok((await nick('a')).reason === 'bad' && (await nick('has space')).reason === 'bad' && (await nick('x'.repeat(21))).reason === 'bad', 'nick: length and characters');
  ok((await nick('MeloFi_official')).reason === 'reserved' && (await nick('운영자1')).reason === 'reserved', 'nick: reserved');
  ok((await nick('피아노치는앨리스')).ok === true, 'nick: Korean ok');
  r = await call('PUT', '/workshop/profile', { nick: '피아노치는앨리스', bio: '  밤에 \n 치는 피아노  ', avatar: 'github' }, 'gh-alice');
  ok(r.status === 200 && r.data.bio === '밤에 치는 피아노' && r.data.avatarUrl.startsWith('https://avatars.githubusercontent.com/u/101'), 'profile saved');
  ok((await nick('피아노치는앨리스', 'gh-alice')).ok === true, 'own nick counts as free');
  ok((await nick('피아노치는앨리스')).reason === 'taken' && (await nick('피아노-치는.앨리스')).reason === 'taken', 'nick taken (folded)');
  ok((await call('PUT', '/workshop/profile', { nick: '피아노치는앨리스' }, 'gh-bob')).data.error === 'nick_taken', 'second owner refused');
  ok((await call('PUT', '/workshop/profile', { nick: 'carol', avatar: 'discord', avatarUrl: 'https://cdn.discordapp.com/avatars/1234/abcdef1234.png' }, 'dc-carol', 'discord')).data.error === 'bad_avatar', 'someone else\'s discord picture refused');
  ok((await call('PUT', '/workshop/profile', { nick: 'carol', avatar: 'discord', avatarUrl: 'https://cdn.discordapp.com/avatars/9001/abcdef1234.png?size=96' }, 'dc-carol', 'discord')).status === 200, 'own discord picture');
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]).toString('base64');
  ok((await call('PUT', '/workshop/profile', { nick: 'bob_beats', avatar: 'upload', image: Buffer.from('notajpeg').toString('base64') }, 'gh-bob')).data.error === 'bad_avatar', 'non-JPEG upload refused');
  r = await call('PUT', '/workshop/profile', { nick: 'bob_beats', avatar: 'upload', image: jpeg }, 'gh-bob');
  ok(r.status === 200 && r.data.avatarUrl.startsWith('/workshop/avatar/'), 'upload avatar');
  const av = await fetch(H + r.data.avatarUrl);
  ok(av.status === 200 && av.headers.get('content-type') === 'image/jpeg' && !r.data.avatarUrl.includes('102'), 'avatar served by a public id, not the account id');
  ok((await call('PUT', '/workshop/profile', { nick: 'bob_beats', avatar: 'upload' }, 'gh-bob')).status === 200, 'keep the uploaded picture');
  r = await call('GET', '/workshop/items?q=앨리스');
  ok(r.data.total === 2 && r.data.items.every((x) => x.owner.name === '피아노치는앨리스' && x.owner.nick === '피아노치는앨리스'), 'works show the nickname, search finds it');
  await call('POST', `/workshop/items/${g2}/comments`, { text: '닉네임 확인' }, 'dc-carol', 'discord');
  r = await call('GET', `/workshop/items/${g2}/comments`);
  ok(r.data.comments.at(-1).name === 'carol' && r.data.comments.at(-1).avatar.includes('cdn.discordapp.com'), 'comments show nickname and picture');
  ok((await call('GET', '/workshop/profile', null, 'gh-alice')).data.nick === '피아노치는앨리스', 'get own profile');

  // mine, removal, forget-me
  ok((await call('GET', '/workshop/mine', null, 'gh-alice')).data.items.length === 2, 'mine');
  ok((await call('DELETE', `/workshop/items/${g1}`, null, 'gh-bob')).status === 403, 'remove not owner');
  ok((await call('DELETE', `/workshop/items/${g1}`, null, 'gh-alice')).status === 200, 'remove');
  await call('POST', `/workshop/items/${g3}/comments`, { text: 'hi' }, 'dc-carol', 'discord');
  await call('POST', `/workshop/items/${g2}/like`, { on: true }, 'dc-carol', 'discord');
  r = await call('DELETE', '/workshop/me', null, 'dc-carol', 'discord');
  ok(r.data.removed >= 2, 'forget me (discord)');
  ok((await call('GET', `/workshop/items/${g3}/comments`)).data.comments.length === 0, 'comments gone');
  r = await call('DELETE', '/workshop/me', null, 'gh-alice');
  ok((await call('GET', '/workshop/items?owner=alice')).data.total === 0, 'forget me (github) drops listings');
  ok((await call('GET', '/workshop/profile', null, 'gh-alice')).data.nick === '' && (await nick('피아노치는앨리스')).ok === true, 'forget me frees the profile and nickname');
} finally {
  py.kill();
  fake.server.close();
  setTimeout(() => { try { fs.rmSync(db, { force: true }); fs.rmSync(db + '-wal', { force: true }); fs.rmSync(db + '-shm', { force: true }); } catch { /* */ } }, 300);
}
console.log(`${pass} pass, ${failN} fail`);
process.exitCode = failN ? 1 : 0;
