// A small stand-in for the parts of GitHub and Discord that 창작마당 uses, for headless tests
// (tools/e2e/workshop-run.mjs). Gists live in memory. Tokens are fixed:
//   gh-alice / gh-bob  GitHub users 101 / 102      dc-carol  Discord user 9001
// Routes: /user, /gists (GET list, POST), /gists/:id (GET, PATCH, DELETE), /raw/:login/:id/raw/:file,
// /discord/users/@me
import http from 'node:http';
import crypto from 'node:crypto';

const USERS = { 'gh-alice': { id: 101, login: 'alice', name: 'Alice Kim' }, 'gh-bob': { id: 102, login: 'bob', name: null } };
const DISCORD = { 'dc-carol': { id: '9001', username: 'carol', global_name: 'Carol' } };

export function startFake(port = 0) {
  const gists = new Map();
  let base = '';
  const view = (g, full = true) => ({
    id: g.id, public: g.public, description: g.description, html_url: `https://gist.github.com/${g.owner.login}/${g.id}`,
    owner: { id: g.owner.id, login: g.owner.login }, created_at: g.created, updated_at: g.updated,
    files: Object.fromEntries(Object.entries(g.files).map(([n, c]) => [n, {
      filename: n, size: Buffer.byteLength(c), raw_url: `${base}/raw/${g.owner.login}/${g.id}/raw/${n}`,
      ...(full ? { content: c.length > 1e6 ? c.slice(0, 1e6) : c, truncated: c.length > 1e6 } : {}),
    }])),
  });
  const server = http.createServer(async (req, res) => {
    res.setHeader('access-control-allow-origin', '*'); // the test page reads gists too
    res.setHeader('access-control-allow-headers', 'authorization, content-type');
    res.setHeader('access-control-allow-methods', 'GET, POST, PATCH, DELETE');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(body === undefined ? '' : JSON.stringify(body)); };
    const tok = (req.headers.authorization || '').replace(/^Bearer /, '');
    const u = new URL(req.url, 'http://x');
    let body = null;
    if (req.method === 'POST' || req.method === 'PATCH') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { return send(400, { message: 'bad json' }); }
    }
    const me = USERS[tok];
    let m;
    if (u.pathname === '/discord/users/@me') return DISCORD[tok] ? send(200, DISCORD[tok]) : send(401, { message: '401: Unauthorized' });
    if (u.pathname === '/user') return me ? send(200, me) : send(401, { message: 'Bad credentials' });
    if ((m = u.pathname.match(/^\/raw\/([^/]+)\/([0-9a-f]+)\/raw\/([^/]+)$/))) {
      const g = gists.get(m[2]);
      if (!g || g.owner.login !== m[1] || g.files[m[3]] == null) { res.writeHead(404); return res.end('404: Not Found'); }
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end(g.files[m[3]]);
    }
    if (u.pathname === '/gists' && req.method === 'GET') {
      if (!me) return send(401, { message: 'Requires authentication' });
      const page = +(u.searchParams.get('page') || 1), per = +(u.searchParams.get('per_page') || 30);
      const mine = [...gists.values()].filter((g) => g.owner.id === me.id).reverse();
      return send(200, mine.slice((page - 1) * per, page * per).map((g) => view(g, false)));
    }
    if (u.pathname === '/gists' && req.method === 'POST') {
      if (!me) return send(401, { message: 'Requires authentication' });
      const id = crypto.randomBytes(16).toString('hex');
      const now = new Date().toISOString();
      const files = Object.fromEntries(Object.entries(body.files || {}).filter(([, f]) => f && f.content != null).map(([n, f]) => [n, f.content]));
      gists.set(id, { id, public: !!body.public, description: body.description || '', owner: me, files, created: now, updated: now });
      return send(201, view(gists.get(id)));
    }
    if ((m = u.pathname.match(/^\/gists\/([0-9a-f]+)$/))) {
      const g = gists.get(m[1]);
      if (!g) return send(404, { message: 'Not Found' });
      if (req.method === 'GET') return (g.public || (me && me.id === g.owner.id)) ? send(200, view(g)) : send(404, { message: 'Not Found' });
      if (!me || me.id !== g.owner.id) return send(404, { message: 'Not Found' });
      if (req.method === 'DELETE') { gists.delete(g.id); return send(204); }
      if (req.method === 'PATCH') {
        if (body.description != null) g.description = body.description;
        for (const [n, f] of Object.entries(body.files || {})) { if (f === null) delete g.files[n]; else g.files[n] = f.content; }
        g.updated = new Date().toISOString();
        return send(200, view(g));
      }
    }
    send(404, { message: 'Not Found' });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => {
    base = `http://127.0.0.1:${server.address().port}`;
    resolve({ server, base, gists });
  }));
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const { base } = await startFake(+(process.argv[2] || 0));
  console.log(base);
}
