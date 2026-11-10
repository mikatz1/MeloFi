// MeloFi online service: accounts, online project storage and share links for the composer.
// Plain Node (24+), no dependencies: node:http + node:sqlite + node:crypto.
//
//   node server/index.mjs                      (port 8787, data in server/data/)
//   PORT=… MELOFI_DATA=… MELOFI_OPERATOR=… MELOFI_CONTACT=… node server/index.mjs
//
// Passwords: scrypt with a per-user salt. Sessions: random tokens; only their SHA-256 is stored.
// Consents: every agreement is stored with the document version and time, including changes to
// the optional marketing consent. Deleting an account removes the user, their projects and
// sessions; the consent log keeps only an anonymous hash so a withdrawal can still be proven.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { documents } from './consent.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = +(process.env.PORT || 8787);
const DATA = process.env.MELOFI_DATA || path.join(HERE, 'data');
const MAX_PROJECT = 5 * 1024 * 1024; // bytes of project JSON
const MAX_PROJECTS = 200; // per account
const SESSION_DAYS = 30;

fs.mkdirSync(DATA, { recursive: true });
const db = new DatabaseSync(path.join(DATA, 'melofi.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, nickname TEXT NOT NULL,
    salt TEXT NOT NULL, hash TEXT NOT NULL, marketing INTEGER NOT NULL DEFAULT 0,
    created INTEGER NOT NULL, last_login INTEGER
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created INTEGER NOT NULL, expires INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL, data TEXT NOT NULL, size INTEGER NOT NULL,
    share TEXT UNIQUE, created INTEGER NOT NULL, updated INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS projects_user ON projects(user_id, updated DESC);
  CREATE TABLE IF NOT EXISTS consents (
    id INTEGER PRIMARY KEY AUTOINCREMENT, subject TEXT NOT NULL, kind TEXT NOT NULL,
    version TEXT NOT NULL, agreed INTEGER NOT NULL, at INTEGER NOT NULL
  );
`);

const now = () => Date.now();
const id = (n = 12) => crypto.randomBytes(n).toString('base64url');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const subjectOf = (userId) => sha(`melofi-consent:${userId}`); // consent rows outlive the account

function hashPassword(pw, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  return { salt, hash };
}
function checkPassword(pw, salt, hash) {
  const a = Buffer.from(hashPassword(pw, salt).hash, 'hex'), b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---- tiny rate limit for sign-up / login (per IP, sliding minute) ----
const hits = new Map();
function limited(ip, key, max) {
  const k = `${key}:${ip}`, t = now();
  const list = (hits.get(k) || []).filter((x) => t - x < 60000);
  list.push(t);
  hits.set(k, list);
  return list.length > max;
}
setInterval(() => { const t = now(); for (const [k, l] of hits) if (!l.some((x) => t - x < 60000)) hits.delete(k); }, 60000).unref();

// ---- http helpers ----
class Fail extends Error { constructor(status, code, msg) { super(msg || code); this.status = status; this.code = code; } }

function send(res, status, body, headers = {}) {
  const isText = typeof body === 'string';
  res.writeHead(status, {
    'content-type': isText ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    ...headers,
  });
  res.end(isText ? body : JSON.stringify(body));
}

async function readJson(req, limit = MAX_PROJECT + 64 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new Fail(413, 'too_large', '파일이 너무 큽니다.');
    chunks.push(c);
  }
  if (!size) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Fail(400, 'bad_json'); }
}

function auth(req) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  if (!m) throw new Fail(401, 'login_required');
  const s = db.prepare('SELECT user_id, expires FROM sessions WHERE token_hash = ?').get(sha(m[1]));
  if (!s || s.expires < now()) throw new Fail(401, 'login_required');
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(s.user_id);
  if (!u) throw new Fail(401, 'login_required');
  return { user: u, tokenHash: sha(m[1]) };
}

const publicUser = (u) => ({ id: u.id, email: u.email, nickname: u.nickname, marketing: !!u.marketing, created: u.created });

function newSession(userId) {
  const token = id(32);
  db.prepare('INSERT INTO sessions (token_hash, user_id, created, expires) VALUES (?, ?, ?, ?)').run(sha(token), userId, now(), now() + SESSION_DAYS * 864e5);
  return token;
}

function logConsent(userId, kind, version, agreed) {
  db.prepare('INSERT INTO consents (subject, kind, version, agreed, at) VALUES (?, ?, ?, ?, ?)').run(subjectOf(userId), kind, version, agreed ? 1 : 0, now());
}

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
function cleanName(s, max = 40) { return String(s || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, max); }

// ---- routes ----
const routes = [];
const route = (method, pattern, fn) => routes.push({ method, re: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), fn });

route('GET', '/api/health', () => ({ ok: true }));
route('GET', '/api/consents', () => documents());

route('POST', '/api/signup', async (req, ip) => {
  if (limited(ip, 'signup', 5)) throw new Fail(429, 'slow_down', '잠시 후 다시 시도해 주세요.');
  const b = await readJson(req, 16 * 1024);
  const email = String(b.email || '').trim().toLowerCase();
  const password = String(b.password || '');
  const nickname = cleanName(b.nickname, 24);
  const docs = documents();
  const c = b.consents || {};
  if (!EMAIL.test(email)) throw new Fail(400, 'bad_email', '이메일 주소를 확인해 주세요.');
  if (password.length < 8 || password.length > 200) throw new Fail(400, 'bad_password', '비밀번호는 8자 이상이어야 합니다.');
  if (!nickname) throw new Fail(400, 'bad_nickname', '닉네임을 입력해 주세요.');
  for (const [kind, d] of Object.entries(docs)) {
    if (d.required && c[kind] !== d.version) throw new Fail(400, 'consent_required', '필수 항목에 모두 동의해야 가입할 수 있습니다.');
  }
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw new Fail(409, 'email_taken', '이미 가입된 이메일입니다.');
  const uid = id(9);
  const { salt, hash } = hashPassword(password);
  const marketing = c.marketing === docs.marketing.version;
  db.prepare('INSERT INTO users (id, email, nickname, salt, hash, marketing, created, last_login) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(uid, email, nickname, salt, hash, marketing ? 1 : 0, now(), now());
  for (const [kind, d] of Object.entries(docs)) logConsent(uid, kind, d.version, kind === 'marketing' ? marketing : true);
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(uid);
  return { token: newSession(uid), user: publicUser(u) };
});

route('POST', '/api/login', async (req, ip) => {
  if (limited(ip, 'login', 10)) throw new Fail(429, 'slow_down', '잠시 후 다시 시도해 주세요.');
  const b = await readJson(req, 16 * 1024);
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(String(b.email || '').trim().toLowerCase());
  if (!u || !checkPassword(String(b.password || ''), u.salt, u.hash)) throw new Fail(401, 'bad_login', '이메일 또는 비밀번호가 맞지 않습니다.');
  db.prepare('UPDATE users SET last_login = ? WHERE id = ?').run(now(), u.id);
  return { token: newSession(u.id), user: publicUser(u) };
});

route('POST', '/api/logout', (req) => {
  const { tokenHash } = auth(req);
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
  return { ok: true };
});

route('GET', '/api/me', (req) => publicUser(auth(req).user));

route('PATCH', '/api/me', async (req) => {
  const { user } = auth(req);
  const b = await readJson(req, 16 * 1024);
  if (b.nickname != null) {
    const n = cleanName(b.nickname, 24);
    if (!n) throw new Fail(400, 'bad_nickname', '닉네임을 입력해 주세요.');
    db.prepare('UPDATE users SET nickname = ? WHERE id = ?').run(n, user.id);
  }
  if (b.marketing != null && !!b.marketing !== !!user.marketing) {
    db.prepare('UPDATE users SET marketing = ? WHERE id = ?').run(b.marketing ? 1 : 0, user.id);
    logConsent(user.id, 'marketing', documents().marketing.version, !!b.marketing);
  }
  if (b.newPassword != null) {
    if (!checkPassword(String(b.password || ''), user.salt, user.hash)) throw new Fail(401, 'bad_password', '현재 비밀번호가 맞지 않습니다.');
    if (String(b.newPassword).length < 8) throw new Fail(400, 'bad_password', '비밀번호는 8자 이상이어야 합니다.');
    const { salt, hash } = hashPassword(String(b.newPassword));
    db.prepare('UPDATE users SET salt = ?, hash = ? WHERE id = ?').run(salt, hash, user.id);
  }
  return publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(user.id));
});

// everything we hold about the account, as one JSON file (right of access)
route('GET', '/api/me/export', (req) => {
  const { user } = auth(req);
  const projects = db.prepare('SELECT id, name, data, share, created, updated FROM projects WHERE user_id = ?').all(user.id)
    .map((p) => ({ ...p, data: JSON.parse(p.data) }));
  const consents = db.prepare('SELECT kind, version, agreed, at FROM consents WHERE subject = ? ORDER BY at').all(subjectOf(user.id));
  return { account: { ...publicUser(user), lastLogin: user.last_login }, consents, projects };
});

route('DELETE', '/api/me', async (req) => {
  const { user } = auth(req);
  const b = await readJson(req, 16 * 1024);
  if (!checkPassword(String(b.password || ''), user.salt, user.hash)) throw new Fail(401, 'bad_password', '비밀번호가 맞지 않습니다.');
  logConsent(user.id, 'withdrawal', 'account', false);
  db.prepare('DELETE FROM users WHERE id = ?').run(user.id); // sessions and projects cascade
  return { ok: true };
});

// ---- projects ----
function checkProject(b) {
  const name = cleanName(b.name, 80) || '제목 없음';
  if (!b.data || typeof b.data !== 'object') throw new Fail(400, 'bad_project');
  const data = JSON.stringify(b.data);
  if (data.length > MAX_PROJECT) throw new Fail(413, 'too_large', '프로젝트가 너무 큽니다 (5MB까지).');
  return { name, data };
}
const listRow = (p) => ({ id: p.id, name: p.name, size: p.size, share: p.share, created: p.created, updated: p.updated });

route('GET', '/api/projects', (req) => {
  const { user } = auth(req);
  return db.prepare('SELECT id, name, size, share, created, updated FROM projects WHERE user_id = ? ORDER BY updated DESC').all(user.id).map(listRow);
});

route('POST', '/api/projects', async (req) => {
  const { user } = auth(req);
  const { name, data } = checkProject(await readJson(req));
  const n = db.prepare('SELECT COUNT(*) AS n FROM projects WHERE user_id = ?').get(user.id).n;
  if (n >= MAX_PROJECTS) throw new Fail(400, 'too_many', `온라인 프로젝트는 ${MAX_PROJECTS}개까지 저장할 수 있습니다.`);
  const pid = id(9);
  db.prepare('INSERT INTO projects (id, user_id, name, data, size, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?)').run(pid, user.id, name, data, data.length, now(), now());
  return listRow(db.prepare('SELECT * FROM projects WHERE id = ?').get(pid));
});

function own(req, pid) {
  const { user } = auth(req);
  const p = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(pid, user.id);
  if (!p) throw new Fail(404, 'not_found', '프로젝트를 찾을 수 없습니다.');
  return p;
}

route('GET', '/api/projects/:pid', (req, ip, { pid }) => { const p = own(req, pid); return { ...listRow(p), data: JSON.parse(p.data) }; });

route('PUT', '/api/projects/:pid', async (req, ip, { pid }) => {
  own(req, pid);
  const { name, data } = checkProject(await readJson(req));
  db.prepare('UPDATE projects SET name = ?, data = ?, size = ?, updated = ? WHERE id = ?').run(name, data, data.length, now(), pid);
  return listRow(db.prepare('SELECT * FROM projects WHERE id = ?').get(pid));
});

route('DELETE', '/api/projects/:pid', (req, ip, { pid }) => { own(req, pid); db.prepare('DELETE FROM projects WHERE id = ?').run(pid); return { ok: true }; });

// turn the share link on (a fresh code) or off
route('POST', '/api/projects/:pid/share', async (req, ip, { pid }) => {
  own(req, pid);
  const b = await readJson(req, 1024);
  const code = b.on === false ? null : id(8);
  db.prepare('UPDATE projects SET share = ? WHERE id = ?').run(code, pid);
  return listRow(db.prepare('SELECT * FROM projects WHERE id = ?').get(pid));
});

// anyone with the code can open a shared project (read only)
route('GET', '/api/shared/:code', (req, ip, { code }) => {
  const p = db.prepare('SELECT p.name, p.data, p.updated, u.nickname FROM projects p JOIN users u ON u.id = p.user_id WHERE p.share = ?').get(code);
  if (!p) throw new Fail(404, 'not_found', '공유가 꺼졌거나 없는 링크입니다.');
  return { name: p.name, owner: p.nickname, updated: p.updated, data: JSON.parse(p.data) };
});

// a small landing page for a share link opened in a browser
route('GET', '/s/:code', (req, ip, { code }) => {
  const p = db.prepare('SELECT p.name, u.nickname FROM projects p JOIN users u ON u.id = p.user_id WHERE p.share = ?').get(code);
  const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
  const body = p
    ? `<h1>${esc(p.name)}</h1><p>${esc(p.nickname)} 님이 공유한 MeloFi 작곡 프로젝트입니다.</p><p>MeloFi에서 <b>작곡 › 공유 코드로 열기</b>를 누르고 아래 코드를 넣으세요.</p><code>${esc(code)}</code>`
    : '<h1>열 수 없는 링크</h1><p>공유가 꺼졌거나 없는 프로젝트입니다.</p>';
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>MeloFi</title><style>body{font:15px/1.6 system-ui,"Malgun Gothic",sans-serif;max-width:520px;margin:12vh auto;padding:0 20px;color:#222}h1{font-size:22px;margin:0 0 8px}code{display:inline-block;padding:6px 10px;border:1px solid #ccc;border-radius:4px;font-size:18px;letter-spacing:1px}</style>${body}`;
});

route('GET', '/privacy', () => {
  const d = documents();
  const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
  const sec = (x) => `<h2>${esc(x.title)}</h2>${(x.table || []).map(([k, v]) => `<p><b>${esc(k)}</b> ${esc(v)}</p>`).join('')}${x.body.map((t) => `<p>${esc(t)}</p>`).join('')}`;
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>MeloFi 개인정보 처리 안내</title><style>body{font:15px/1.7 system-ui,"Malgun Gothic",sans-serif;max-width:680px;margin:6vh auto;padding:0 20px;color:#222}h2{font-size:17px;margin-top:28px}</style><h1>MeloFi 개인정보 처리 안내</h1>${sec(d.privacy)}${sec(d.marketing)}${sec(d.terms)}`;
});

// ---- server ----
export function start(port = PORT) {
  const server = http.createServer(async (req, res) => {
    const ip = req.socket.remoteAddress || '';
    if (req.method === 'OPTIONS') return send(res, 204, '');
    const url = new URL(req.url, 'http://x');
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = r.re.exec(url.pathname);
      if (!m) continue;
      try {
        return send(res, 200, await r.fn(req, ip, m.groups || {}));
      } catch (e) {
        if (e instanceof Fail) return send(res, e.status, { error: e.code, message: e.message });
        console.error(e);
        return send(res, 500, { error: 'server', message: '서버에서 문제가 생겼습니다.' });
      }
    }
    send(res, 404, { error: 'not_found' });
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const s = await start();
  setInterval(() => db.prepare('DELETE FROM sessions WHERE expires < ?').run(now()), 3600e3).unref();
  console.log(`MeloFi server on http://localhost:${s.address().port}  (data: ${DATA})`);
}
