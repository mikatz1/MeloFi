// Live check of the 창작마당 profile endpoints on MeloFi Helper, without signing in (nothing is
// written): the nickname rules answer as they should, the profile needs a sign-in, a bad token is
// refused, an unknown avatar id is 404, a too-large body is refused, and no answer carries an account id.
//   node tools/check-live-profile.mjs [https://melofi-helper.duckdns.org]
const H = (process.argv[2] || 'https://melofi-helper.duckdns.org').replace(/\/+$/, '');
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) pass++; else fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${name}${extra ? ` (${extra})` : ''}`); };
const get = async (p, headers = {}) => { const r = await fetch(H + p, { headers, signal: AbortSignal.timeout(15000) }); return { status: r.status, text: await r.text() }; };
const json = (t) => { try { return JSON.parse(t); } catch { return null; } };

let r = await get('/workshop/nick?name=' + encodeURIComponent('creator_' + Date.now().toString(36).slice(-5)));
ok(r.status === 200 && json(r.text)?.ok === true, 'a free nickname', r.text);
r = await get('/workshop/nick?name=a');
ok(json(r.text)?.reason === 'bad', 'too short is bad', r.text);
r = await get('/workshop/nick?name=' + encodeURIComponent('has space'));
ok(json(r.text)?.reason === 'bad', 'spaces are bad', r.text);
r = await get('/workshop/nick?name=' + encodeURIComponent('운영자'));
ok(json(r.text)?.reason === 'reserved', 'reserved word', r.text);
r = await get('/workshop/nick?name=MeloFi_official');
ok(json(r.text)?.reason === 'reserved', 'reserved prefix', r.text);
r = await get('/workshop/profile');
ok(r.status === 401, 'profile needs a sign-in', `${r.status}`);
r = await get('/workshop/profile', { authorization: 'Bearer not-a-real-token-123456', 'x-melofi-provider': 'github' });
ok(r.status === 401, 'a bad GitHub token is refused', `${r.status}`);
r = await fetch(H + '/workshop/profile', { method: 'PUT', headers: { 'content-type': 'application/json', authorization: 'Bearer not-a-real-token-123456', 'x-melofi-provider': 'discord' }, body: JSON.stringify({ nick: 'x_test' }), signal: AbortSignal.timeout(15000) });
ok(r.status === 401, 'writing without a real sign-in is refused', `${r.status}`);
r = await fetch(H + '/workshop/profile', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nick: 'x', image: 'A'.repeat(200 * 1024) }), signal: AbortSignal.timeout(15000) });
ok(r.status === 413 || r.status === 401, 'a 200 KB body is refused', `${r.status}`);
r = await get('/workshop/avatar/0000000000000000');
ok(r.status === 404, 'unknown avatar id is 404', `${r.status}`);
r = await get('/workshop/items?sort=new');
ok(r.status === 200 && Array.isArray(json(r.text)?.items), 'the works list still answers');
ok(!/"(owner_id|user|discord_id|token)"/.test(r.text), 'no account ids in the list');
console.log(`\n${pass} pass, ${fail} fail · ${H}`);
process.exitCode = fail ? 1 : 0;
