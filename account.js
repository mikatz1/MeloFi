'use strict';
// Online account (main process): talks to the MeloFi server (server/index.mjs) on behalf of the
// page. The login token never reaches the page: it is kept here, encrypted with the OS
// (safeStorage) in userData/account.json.
const path = require('node:path');
const fsp = require('node:fs/promises');
const { safeStorage, shell } = require('electron');

function register(ipcMain, { app }) {
  const FILE = () => path.join(app.getPath('userData'), 'account.json');
  // a development build talks to a server on this computer; a release build needs an address
  const DEFAULT_SERVER = process.env.MELOFI_SERVER || (app.isPackaged ? '' : 'http://localhost:8787');
  let state = null; // { server, token, user }

  async function load() {
    if (state) return state;
    state = { server: DEFAULT_SERVER, token: null, user: null };
    try {
      const s = JSON.parse(await fsp.readFile(FILE(), 'utf8'));
      state.server = s.server ?? DEFAULT_SERVER;
      state.user = s.user || null;
      if (s.token && safeStorage.isEncryptionAvailable()) state.token = safeStorage.decryptString(Buffer.from(s.token, 'base64'));
    } catch { /* first run */ }
    return state;
  }

  async function save() {
    const token = state.token && safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(state.token).toString('base64') : null;
    await fsp.mkdir(path.dirname(FILE()), { recursive: true });
    await fsp.writeFile(FILE(), JSON.stringify({ server: state.server, token, user: state.user }));
  }

  async function call(method, url, body, authed = true) {
    if (!state.server) throw Object.assign(new Error('서버 주소가 설정되지 않았습니다.'), { code: 'no_server' });
    const headers = { 'content-type': 'application/json' };
    if (authed) {
      if (!state.token) throw Object.assign(new Error('로그인이 필요합니다.'), { code: 'login_required' });
      headers.authorization = `Bearer ${state.token}`;
    }
    let r;
    try {
      r = await fetch(state.server.replace(/\/+$/, '') + url, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
    } catch {
      throw Object.assign(new Error('서버에 연결할 수 없습니다.'), { code: 'offline' });
    }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (r.status === 401 && authed) { state.token = null; state.user = null; await save(); }
      throw Object.assign(new Error(data.message || `서버 오류 (${r.status})`), { code: data.error || 'server' });
    }
    return data;
  }

  const ops = {
    state: async () => ({ server: state.server, user: state.user, signedIn: !!state.token }),
    setServer: async ({ url }) => {
      const u = String(url || '').trim();
      if (u && !/^https?:\/\/[^\s]+$/i.test(u)) throw Object.assign(new Error('http:// 또는 https://로 시작하는 주소를 넣어 주세요.'), { code: 'bad_url' });
      state.server = u.replace(/\/+$/, '');
      await save();
      return ops.state();
    },
    consents: () => call('GET', '/api/consents', null, false),
    openPolicy: async () => { if (state.server) await shell.openExternal(`${state.server}/privacy`); return true; },
    signup: async (p) => { const r = await call('POST', '/api/signup', p, false); state.token = r.token; state.user = r.user; await save(); return r.user; },
    login: async (p) => { const r = await call('POST', '/api/login', p, false); state.token = r.token; state.user = r.user; await save(); return r.user; },
    logout: async () => { try { await call('POST', '/api/logout'); } catch { /* already gone */ } state.token = null; state.user = null; await save(); return true; },
    me: async () => { state.user = await call('GET', '/api/me'); await save(); return state.user; },
    update: async (p) => { state.user = await call('PATCH', '/api/me', p); await save(); return state.user; },
    exportData: async () => {
      const data = await call('GET', '/api/me/export');
      const dir = path.join(app.getPath('documents'), 'MeloFi');
      await fsp.mkdir(dir, { recursive: true });
      const file = path.join(dir, `MeloFi 계정 데이터 ${new Date().toISOString().slice(0, 10)}.json`);
      await fsp.writeFile(file, JSON.stringify(data, null, 2));
      return file;
    },
    deleteAccount: async ({ password }) => { await call('DELETE', '/api/me', { password }); state.token = null; state.user = null; await save(); return true; },
    projects: () => call('GET', '/api/projects'),
    saveProject: ({ id, name, data }) => (id ? call('PUT', `/api/projects/${encodeURIComponent(id)}`, { name, data }) : call('POST', '/api/projects', { name, data })),
    loadProject: ({ id }) => call('GET', `/api/projects/${encodeURIComponent(id)}`),
    removeProject: ({ id }) => call('DELETE', `/api/projects/${encodeURIComponent(id)}`),
    share: ({ id, on }) => call('POST', `/api/projects/${encodeURIComponent(id)}/share`, { on }),
    // a pasted code or a whole link (…/s/CODE)
    shared: ({ code }) => { const c = String(code || '').trim().split(/[/?#]/).filter(Boolean).pop() || ''; return call('GET', `/api/shared/${encodeURIComponent(c)}`, null, false); },
  };

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

module.exports = { register };
