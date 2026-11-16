'use strict';
// Accounts (main process). MeloFi has no account server of its own: people sign in with Discord
// and/or GitHub.
//   Discord  browser sign-in (OAuth code + PKCE) back to http://127.0.0.1:53682/discord; MeloFi
//            Helper (the support bot's small HTTPS endpoint) swaps the code for a token, since
//            Discord wants the client secret for that. Gives: joining the MeloFi Discord server
//            and posting 문제 신고 to the bug forum through the Helper.
//   GitHub   device sign-in (a code typed on github.com, no secret, no Helper). Gives: projects
//            saved as secret gists on the person's own GitHub, shared by link.
// Tokens never reach the page: they are kept here, encrypted with the OS (safeStorage), in
// userData/account.json. The Helper keeps nothing.
const path = require('node:path');
const fsp = require('node:fs/promises');
const http = require('node:http');
const crypto = require('node:crypto');
const { safeStorage, shell } = require('electron');
const { t } = require('./i18n-main.js');

// Public ids (not secrets). An environment variable overrides each, for testing.
const CONF = {
  helper: process.env.MELOFI_HELPER || 'https://melofi-helper.duckdns.org', // MeloFi Helper (melofi-bot/api.py)
  discordId: process.env.MELOFI_DISCORD_ID || '1570379006015045673', // MeloFi Helper's application id
  githubId: process.env.MELOFI_GITHUB_ID || 'Ov23liOwuggVRZcQ9CQB', // the MeloFi GitHub OAuth app's client id
};
const LOOPBACK_PORT = 53682;
const DISCORD_REDIRECT = `http://127.0.0.1:${LOOPBACK_PORT}/discord`;
const DISCORD_SCOPE = 'identify guilds.join';
const GIST_FILE = 'project.melofi.json';
const GIST_PREFIX = 'MeloFi: ';

const fail = (code, message) => Object.assign(new Error(message), { code });

let app = null;
let state = null; // { discord: { token, refresh, expires, user } | null, github: { token, user } | null }
let pending = null; // the sign-in in progress: { kind, cancel() }

const FILE = () => path.join(app.getPath('userData'), 'account.json');
const enc = (s) => (s && safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(s).toString('base64') : null);
const dec = (s) => { try { return s && safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(s, 'base64')) : null; } catch { return null; } };

async function load() {
  if (state) return state;
  state = { discord: null, github: null };
  // headless tests (tools/e2e/workshop-run.mjs): accounts against a local stand-in for GitHub/Discord
  if (process.env.MELOFI_SHOT && process.env.MELOFI_TEST_ACCOUNT) {
    try { Object.assign(state, JSON.parse(process.env.MELOFI_TEST_ACCOUNT)); } catch { /* */ }
    return state;
  }
  try {
    const s = JSON.parse(await fsp.readFile(FILE(), 'utf8'));
    if (s.discord?.token && dec(s.discord.token)) state.discord = { ...s.discord, token: dec(s.discord.token), refresh: dec(s.discord.refresh) };
    if (s.github?.token && dec(s.github.token)) state.github = { ...s.github, token: dec(s.github.token) };
  } catch { /* first run, or the old e-mail account file: start signed out */ }
  return state;
}

async function save() {
  if (process.env.MELOFI_SHOT && process.env.MELOFI_TEST_ACCOUNT) return; // (tests keep nothing)
  const out = {
    discord: state.discord && { ...state.discord, token: enc(state.discord.token), refresh: enc(state.discord.refresh) },
    github: state.github && { ...state.github, token: enc(state.github.token) },
  };
  await fsp.mkdir(path.dirname(FILE()), { recursive: true });
  await fsp.writeFile(FILE(), JSON.stringify(out));
}

async function fetchJson(url, opts = {}, offlineText = t('인터넷 연결을 확인해 주세요.')) {
  let r;
  try {
    r = await fetch(url, { ...opts, signal: opts.signal || AbortSignal.timeout(20000) });
  } catch (e) {
    if (e?.name === 'AbortError' && opts.signal?.aborted) throw fail('cancelled', t('취소했어요.'));
    throw fail('offline', offlineText);
  }
  const data = r.status === 204 ? {} : await r.json().catch(() => ({}));
  return { r, data };
}

// ---------- MeloFi Helper ----------
async function helper(method, url, body, who = 'discord') {
  if (!CONF.helper) throw fail('no_helper', t('MeloFi Helper 주소가 아직 설정되지 않았어요.'));
  const headers = { 'content-type': 'application/json' };
  if (who) {
    const tok = who === 'github' ? state.github?.token : await discordToken();
    if (!tok) throw fail('login_required', t('로그인이 필요해요.'));
    headers.authorization = `Bearer ${tok}`;
    headers['x-melofi-provider'] = who;
  }
  const { r, data } = await fetchJson(CONF.helper.replace(/\/+$/, '') + url, { method, headers, body: body ? JSON.stringify(body) : undefined },
    t('MeloFi Helper에 연결할 수 없어요. 잠시 뒤 다시 시도해 주세요.'));
  if (!r.ok) {
    if (r.status === 401 && who) { state[who] = null; await save(); }
    throw fail(data.error || (r.status === 404 ? 'no_route' : 'helper'), data.message || t('MeloFi Helper 오류 ({status})', { status: r.status }));
  }
  return data;
}

// ---------- Discord ----------
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// The page the browser lands on after Discord. The answer is held until the sign-in (and joining the
// server) is really done, so the page says what happened. Same look as the app: dark, the MeloFi mark.
function resultPage(ok, title, text) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const mark = '<svg viewBox="56 48 144 168" aria-hidden="true"><rect x="74" y="88" width="26" height="104" rx="13"/><rect x="115" y="56" width="26" height="136" rx="13"/><rect x="156" y="110" width="26" height="82" rx="13"/><rect class="l" x="64" y="200" width="128" height="9" rx="4.5"/></svg>';
  return `<!doctype html><html lang="${require('./i18n-main.js').lang()}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MeloFi</title><style>
html,body{margin:0;height:100%;background:#0f1013;color:#d8d5ce;font:14px/1.6 "Segoe UI","Malgun Gothic",system-ui,sans-serif}
main{min-height:100%;display:grid;place-items:center;padding:24px;box-sizing:border-box}
.card{width:100%;max-width:400px;padding:30px 30px 26px;background:#15161a;border:1px solid #25262c;border-radius:6px}
.brand{display:flex;align-items:center;gap:9px;margin-bottom:26px;color:#f2efe8;font-weight:600;letter-spacing:.2px}
.brand svg{width:20px;height:22px;fill:#d8d5ce}.brand .l{fill:#e0a440}
.state{display:flex;align-items:center;gap:8px;margin:0 0 6px;font-size:16px;font-weight:600;color:#f2efe8}
.state i{width:8px;height:8px;border-radius:50%;background:${ok ? '#8fcf7d' : '#e5786c'}}
p{margin:0;color:#8b8983}.foot{margin-top:24px;padding-top:14px;border-top:1px solid #25262c;font-size:12px;color:#5d5c58}
</style></head><body><main><div class="card"><div class="brand">${mark}MeloFi</div>
<div class="state"><i></i>${esc(title)}</div><p>${esc(text)}</p>
<div class="foot">${esc(t('이 탭은 닫아도 돼요.'))}</div></div></main></body></html>`;
}

function waitForRedirect(expectState) {
  let server = null, timer = null, done = null, held = null;
  const finish = (ok, title, text) => {
    if (!held) return;
    held.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    held.end(resultPage(ok, title, text));
    held = null;
    server?.close();
  };
  const p = new Promise((resolve, reject) => {
    done = (err, code) => { clearTimeout(timer); if (err) { finish(false, t('로그인하지 못했어요'), err.message); server?.close(); reject(err); } else resolve(code); };
    server = http.createServer((req, res) => {
      const u = new URL(req.url, DISCORD_REDIRECT);
      if (u.pathname !== '/discord') { res.writeHead(404).end(); return; }
      if (held) { res.writeHead(409).end(); return; }
      held = res;
      if (u.searchParams.get('state') === expectState && u.searchParams.get('code')) done(null, u.searchParams.get('code'));
      else if (u.searchParams.get('error')) done(fail('cancelled', t('디스코드 로그인을 취소했어요.')));
      else done(fail('bad_request', t('로그인을 마치지 못했어요. MeloFi에서 다시 시도해 주세요.')));
    });
    server.on('error', () => done(fail('port_busy', t('로그인에 쓰는 포트 {port}를 다른 프로그램이 쓰고 있어요.', { port: LOOPBACK_PORT }))));
    server.listen(LOOPBACK_PORT, '127.0.0.1');
    timer = setTimeout(() => done(fail('timeout', t('로그인 시간이 지났어요. 다시 시도해 주세요.'))), 5 * 60 * 1000);
  });
  return { promise: p, finish, cancel: () => done(fail('cancelled', t('취소했어요.'))) };
}
async function discordUser(token) {
  const { r, data } = await fetchJson('https://discord.com/api/v10/users/@me', { headers: { authorization: `Bearer ${token}` } });
  if (!r.ok) throw fail('login_required', t('디스코드 로그인이 만료됐어요. 다시 로그인해 주세요.'));
  return { id: data.id, name: data.global_name || data.username, handle: data.username, avatar: data.avatar ? `https://cdn.discordapp.com/avatars/${data.id}/${data.avatar}.png?size=96` : null };
}

function keepDiscord(tok, user) {
  state.discord = { token: tok.access_token, refresh: tok.refresh_token || null, expires: Date.now() + (tok.expires_in || 604800) * 1000, user };
}

// a token that is good for at least another hour, refreshed through the Helper when needed
async function discordToken() {
  const d = state.discord;
  if (!d) return null;
  if (d.expires - Date.now() > 3600e3 || !d.refresh) return d.token;
  try {
    keepDiscord(await helper('POST', '/discord/refresh', { refresh_token: d.refresh }, null), d.user);
    await save();
  } catch (e) {
    if (e.code !== 'offline' && e.code !== 'no_helper') { state.discord = null; await save(); }
    throw e;
  }
  return state.discord.token;
}

async function loginDiscord() {
  if (!CONF.discordId) throw fail('no_helper', t('디스코드 로그인이 아직 준비되지 않았어요.'));
  if (!CONF.helper) throw fail('no_helper', t('MeloFi Helper 주소가 아직 설정되지 않았어요.'));
  pending?.cancel();
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const st = b64url(crypto.randomBytes(16));
  const wait = waitForRedirect(st);
  pending = { kind: 'discord', cancel: wait.cancel };
  const q = new URLSearchParams({ client_id: CONF.discordId, response_type: 'code', redirect_uri: DISCORD_REDIRECT, scope: DISCORD_SCOPE, state: st, code_challenge: challenge, code_challenge_method: 'S256' });
  await shell.openExternal(`https://discord.com/oauth2/authorize?${q}`);
  try {
    const code = await wait.promise;
    const tok = await helper('POST', '/discord/token', { code, redirect_uri: DISCORD_REDIRECT, code_verifier: verifier }, null);
    keepDiscord(tok, await discordUser(tok.access_token));
    // Discord sign-in means being on the MeloFi server: join it now (or confirm), or don't sign in
    try {
      const j = await helper('POST', '/join', {}, 'discord');
      state.discord.guild = { name: j.guild, url: j.url };
    } catch (e) {
      state.discord = null;
      throw fail(e.code, e.code === 'banned' ? e.message : t('MeloFi 디스코드 서버에 참여하지 못해 로그인하지 않았어요. {why}', { why: e.message }));
    }
    await save();
    wait.finish(true, t('로그인했어요'), t('{name} 님, MeloFi 디스코드 서버에 참여했어요. MeloFi로 돌아가 주세요.', { name: state.discord.user.name }));
  } catch (e) {
    wait.finish(false, t('로그인하지 못했어요'), e.message);
    throw e;
  } finally { if (pending?.kind === 'discord') pending = null; }
}

// ---------- GitHub ----------
const GH = (process.env.MELOFI_SHOT && process.env.MELOFI_GITHUB_API) || 'https://api.github.com';
const ghHeaders = (auth = true) => ({
  accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28',
  ...(auth && state.github ? { authorization: `Bearer ${state.github.token}` } : {}),
});

async function gh(method, url, body, auth = true) {
  if (auth && !state.github) throw fail('github_required', t('GitHub로 로그인하면 온라인에 저장할 수 있어요.'));
  const { r, data } = await fetchJson(GH + url, { method, headers: { ...ghHeaders(auth), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) {
    if (r.status === 401 && auth) { state.github = null; await save(); throw fail('github_required', t('GitHub 로그인이 만료됐어요. 다시 로그인해 주세요.')); }
    if (r.status === 404) throw fail('not_found', t('찾을 수 없어요. 링크가 맞는지, 삭제되지 않았는지 확인해 주세요.'));
    if (r.status === 403 || r.status === 429) throw fail('slow_down', t('GitHub 요청이 너무 많아요. 잠시 뒤 다시 시도해 주세요.'));
    throw fail('github', data.message ? `GitHub: ${data.message}` : t('GitHub 오류 ({status})', { status: r.status }));
  }
  return data;
}

// step 1: get a code for the person to type on github.com/login/device
async function githubStart() {
  if (!CONF.githubId) throw fail('no_github', t('GitHub 로그인이 아직 준비되지 않았어요.'));
  pending?.cancel();
  const { r, data } = await fetchJson('https://github.com/login/device/code', {
    method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: CONF.githubId, scope: 'gist' }),
  });
  if (!r.ok || !data.device_code) throw fail('github', t('GitHub 로그인을 시작하지 못했어요.'));
  const ctl = new AbortController();
  pending = { kind: 'github', device: data, cancel: () => ctl.abort(), signal: ctl.signal };
  return { code: data.user_code, url: data.verification_uri, expires: Date.now() + data.expires_in * 1000 };
}

// step 2: wait until the person has typed the code (or cancelled, or it ran out)
async function githubWait() {
  const p = pending;
  if (p?.kind !== 'github') throw fail('cancelled', t('취소했어요.'));
  let interval = (p.device.interval || 5) * 1000;
  const until = Date.now() + p.device.expires_in * 1000;
  try {
    while (Date.now() < until) {
      await new Promise((res) => setTimeout(res, interval));
      if (p.signal.aborted) throw fail('cancelled', t('취소했어요.'));
      const { data } = await fetchJson('https://github.com/login/oauth/access_token', {
        method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, signal: p.signal,
        body: JSON.stringify({ client_id: CONF.githubId, device_code: p.device.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }),
      });
      if (data.access_token) {
        state.github = { token: data.access_token, user: null };
        const u = await gh('GET', '/user');
        state.github.user = { id: u.id, name: u.name || u.login, handle: u.login, avatar: `https://avatars.githubusercontent.com/u/${u.id}?s=96` };
        await save();
        return;
      }
      if (data.error === 'slow_down') interval += 5000;
      else if (data.error === 'access_denied') throw fail('cancelled', t('GitHub 로그인을 취소했어요.'));
      else if (data.error && data.error !== 'authorization_pending') throw fail('github', t('GitHub 로그인을 마치지 못했어요. 다시 시도해 주세요.'));
    }
    throw fail('timeout', t('코드 입력 시간이 지났어요. 다시 시도해 주세요.'));
  } finally { if (pending === p) pending = null; }
}

// ---------- projects as secret gists ----------
const gistId = (s) => { const m = String(s || '').trim().match(/([0-9a-f]{20,40})(?:[/?#].*)?$/i); return m ? m[1] : ''; };

async function gistProject(id, auth) {
  const g = await gh('GET', `/gists/${id}`, null, auth);
  const f = g.files?.[GIST_FILE];
  if (!f) throw fail('not_melofi', t('MeloFi 프로젝트가 담긴 링크가 아니에요.'));
  let text = f.content;
  if (f.truncated) { // the API cuts big files; the raw link has all of it
    const { r, data } = await fetchJson(f.raw_url);
    if (!r.ok) throw fail('github', t('프로젝트를 받지 못했어요.'));
    return { g, data };
  }
  return { g, data: JSON.parse(text) };
}

const nameOf = (g) => (g.description || '').startsWith(GIST_PREFIX) ? g.description.slice(GIST_PREFIX.length) : (g.description || t('이름 없음'));
const gistLink = (g) => g.html_url || `https://gist.github.com/${g.owner?.login || ''}/${g.id}`;

const ops = {
  state: async () => ({
    discord: state.discord ? { ...state.discord.user, guild: state.discord.guild?.name || null } : null, // guild: the MeloFi server it joined
    github: state.github?.user || null,
    signedIn: !!(state.discord || state.github),
    ready: { discord: !!(CONF.discordId && CONF.helper), github: !!CONF.githubId, helper: !!CONF.helper },
    pending: pending?.kind || null,
  }),
  loginDiscord: async () => { await loginDiscord(); return ops.state(); },
  githubStart: () => githubStart(),
  githubWait: async () => { await githubWait(); return ops.state(); },
  cancel: async () => { pending?.cancel(); pending = null; return true; },
  // forgets the sign-in on this PC; taking the permission back is done on Discord / GitHub
  logout: async ({ provider }) => {
    for (const k of provider ? [provider] : ['discord', 'github']) state[k] = null;
    await save();
    return ops.state();
  },
  openGithubApps: async () => { await shell.openExternal('https://github.com/settings/applications'); return true; },
  // links the account screens show (the device page, a gist, the Discord server or a report)
  openUrl: async ({ url }) => {
    let u;
    try { u = new URL(String(url)); } catch { throw fail('bad_link', 'bad url'); }
    const ok = u.protocol === 'discord:' || (u.protocol === 'https:' && /(^|\.)(github\.com|discord\.com|vb-audio\.com)$/.test(u.hostname)); // vb-audio: the virtual cable guide (vmic)
    if (!ok) throw fail('bad_link', 'bad url');
    await shell.openExternal(u.href);
    return true;
  },
  // opens the MeloFi Discord server (joining again first, if the person left it)
  openServer: async () => {
    const j = await helper('POST', '/join', {}, 'discord');
    await shell.openExternal(j.url);
    return j;
  },

  projects: async () => {
    const out = [];
    for (let page = 1; page <= 5; page++) {
      const list = await gh('GET', `/gists?per_page=100&page=${page}`);
      for (const g of list) if (g.files?.[GIST_FILE] && !g.files['melofi-workshop.json']) out.push({ id: g.id, name: nameOf(g), updated: Date.parse(g.updated_at), size: g.files[GIST_FILE].size || 0, link: gistLink(g) });
      if (list.length < 100) break;
    }
    return out.sort((a, b) => b.updated - a.updated);
  },
  saveProject: async ({ id, name, data }) => {
    const body = { description: GIST_PREFIX + String(name || t('이름 없음')).slice(0, 120), files: { [GIST_FILE]: { content: JSON.stringify(data) } } };
    const g = id ? await gh('PATCH', `/gists/${encodeURIComponent(id)}`, body) : await gh('POST', '/gists', { ...body, public: false });
    return { id: g.id, link: gistLink(g) };
  },
  loadProject: async ({ id }) => { const { g, data } = await gistProject(encodeURIComponent(id), true); return { name: nameOf(g), data }; },
  removeProject: ({ id }) => gh('DELETE', `/gists/${encodeURIComponent(id)}`),
  // a gist link (or just its id) someone shared; no sign-in needed
  shared: async ({ code }) => {
    const id = gistId(code);
    if (!id) throw fail('bad_link', t('Gist 링크를 붙여넣어 주세요.'));
    const { g, data } = await gistProject(id, !!state.github);
    return { name: nameOf(g), owner: g.owner?.login || '', data };
  },
};

// 문제 신고 → the Discord bug forum through the Helper (report.js)
async function helperReport({ title, text }) {
  await load();
  const who = state.discord ? 'discord' : state.github ? 'github' : null;
  if (!who) throw fail('login_required', t('디스코드나 GitHub로 로그인하면 바로 올릴 수 있어요.'));
  return helper('POST', '/report', { title, text }, who);
}

function register(ipcMain, deps) {
  app = deps.app;
  ipcMain.handle('account', async (_e, op, payload) => {
    await load();
    if (!ops[op]) return { ok: false, error: 'bad_op', message: op };
    try {
      return { ok: true, data: await ops[op](payload || {}) };
    } catch (err) {
      return { ok: false, error: err.code || 'error', message: err.message };
    }
  });
}

// workshop.js (창작마당) builds on the same sign-in, Helper and GitHub calls
const internal = { load, helper, gh, fetchJson, fail, get state() { return state; }, GIST_FILE };

module.exports = { register, helperReport, gistId, resultPage, CONF, internal };
