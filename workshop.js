'use strict';
// 창작마당 (the creative workshop), main process. docs/workshop.md explains the design.
//   files     a work is a gist on the author's own GitHub: melofi-workshop.json (the manifest) plus the
//             audio, MIDI, project and cover. Binary files are kept as base64 text (gists hold text).
//             Players and downloads read gist.githubusercontent.com, no API quota and nothing on the VM.
//   index     MeloFi Helper keeps the list of public works, likes, comments, reports and counts
//             (helper/workshop.py). Works shared by link only are secret gists and never reach it.
//   identity  the app's own sign-in (account.js): GitHub to publish, GitHub or Discord to like, comment
//             and report. Tokens stay in the main process, as with the rest of the account code.
const path = require('node:path');
const fsp = require('node:fs/promises');
const { internal: A } = require('./account.js');
const { t } = require('./i18n-main.js');

const MANIFEST = 'melofi-workshop.json';
const PROJECT_FILE = 'project.melofi.json'; // the same name as online projects, so 열기 works on either
const RAW = (process.env.MELOFI_SHOT && process.env.MELOFI_GIST_RAW) || 'https://gist.githubusercontent.com';
const DESC = 'MeloFi 창작마당: '; // i18n-ignore (the gist description, the same in every language)
const MAX_TOTAL = 9 * 1024 * 1024; // all files of one work, before base64
const MAX_COVER = 400 * 1024;
const FILE_NAMES = { audio: (ext) => `audio.${ext}.b64`, midi: () => 'song.mid.b64', project: () => PROJECT_FILE };
const AUDIO_EXT = { 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/wav': 'wav' };
const GENRES = ['piano', 'classical', 'pop', 'ballad', 'jazz', 'lofi', 'electronic', 'hiphop', 'rock', 'game', 'film', 'practice', 'etc'];

const fail = A.fail;
let app = null, dialog = null, BrowserWindow = null;

// the identity for likes, comments and reports: GitHub when connected (the same one that publishes), else Discord
const actor = () => (A.state.github ? 'github' : A.state.discord ? 'discord' : null);
const needActor = () => { const w = actor(); if (!w) throw fail('login_required', t('디스코드나 GitHub로 로그인해 주세요.')); return w; };
const needGithub = () => { if (!A.state.github) throw fail('github_required', t('작품을 올리려면 GitHub 연결이 필요해요. 파일이 내 GitHub에 저장돼요.')); };
const q = (o) => Object.entries(o).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
const okId = (id) => { const s = String(id || ''); if (!/^[0-9a-f]{20,40}$/i.test(s)) throw fail('bad_id', t('작품을 찾을 수 없어요.')); return s; };
const okLogin = (s) => { const v = String(s || ''); if (!/^[A-Za-z0-9-]{1,40}$/.test(v)) throw fail('bad_id', t('작품을 찾을 수 없어요.')); return v; };
const okName = (s) => { const v = String(s || ''); if (!/^[\w.-]{1,80}$/.test(v)) throw fail('bad_id', t('파일을 찾을 수 없어요.')); return v; };

// ---------- raw files (no API quota) ----------
const cache = new Map(); // url -> Buffer | string, the last few files
function remember(k, v) { cache.delete(k); cache.set(k, v); while (cache.size > 24) cache.delete(cache.keys().next().value); return v; }

async function raw(login, id, name, as = 'buffer') {
  const url = `${RAW}/${okLogin(login)}/${okId(id)}/raw/${okName(name)}`;
  const key = `${as}:${url}`;
  if (cache.has(key)) return remember(key, cache.get(key));
  let r;
  try { r = await fetch(url, { signal: AbortSignal.timeout(60000) }); } catch { throw fail('offline', t('인터넷 연결을 확인해 주세요.')); }
  if (r.status === 404) throw fail('not_found', t('파일을 찾을 수 없어요. 작성자가 지웠을 수 있어요.'));
  if (!r.ok) throw fail('github', t('파일을 받지 못했어요 ({status}).', { status: r.status }));
  const text = await r.text();
  const out = as === 'text' ? text : name.endsWith('.b64') ? Buffer.from(text, 'base64') : Buffer.from(text, 'utf8');
  return remember(key, out);
}

// ---------- publishing ----------
function cleanMeta(m = {}) {
  const line = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
  const tags = [];
  for (const x of Array.isArray(m.tags) ? m.tags : []) {
    const v = String(x).replace(/[\s#,]+/g, '').toLowerCase().slice(0, 24);
    if (v && !tags.includes(v)) tags.push(v);
  }
  const num = (v, hi) => (Number.isFinite(+v) && +v > 0 && +v < hi ? Math.round(+v * 100) / 100 : null);
  const title = line(m.title, 80);
  if (!title) throw fail('no_title', t('제목을 적어 주세요.'));
  return {
    title,
    description: String(m.description || '').replace(/\r\n/g, '\n').trim().slice(0, 2000),
    tags: tags.slice(0, 8),
    genre: GENRES.includes(m.genre) ? m.genre : 'etc',
    app: m.app === 'studio' ? 'studio' : 'piano',
    length: num(m.length, 36000),
    bpm: num(m.bpm, 1000),
  };
}

// files: [{ role: 'audio'|'midi'|'project', type, data: Uint8Array | string, label }]
// cover: { type, data } to set, null to remove, undefined to keep
function gistFiles(files, cover, old) {
  const out = {}, list = [];
  let total = 0;
  const seen = new Set();
  for (const f of files || []) {
    if (!FILE_NAMES[f.role] || seen.has(f.role)) continue;
    seen.add(f.role);
    let content, size, type;
    if (f.role === 'project') {
      content = typeof f.data === 'string' ? f.data : Buffer.from(f.data).toString('utf8');
      try { JSON.parse(content); } catch { throw fail('bad_file', t('프로젝트 파일을 읽지 못했어요.')); }
      size = Buffer.byteLength(content); type = 'application/json';
    } else {
      const buf = Buffer.from(f.data);
      size = buf.length;
      type = f.role === 'midi' ? 'audio/midi' : (AUDIO_EXT[f.type] ? f.type : 'audio/mpeg');
      if (f.role === 'midi' && buf.subarray(0, 4).toString('latin1') !== 'MThd') throw fail('bad_file', t('MIDI 파일이 아니에요.'));
      content = buf.toString('base64');
    }
    total += size;
    const name = FILE_NAMES[f.role](AUDIO_EXT[type]);
    out[name] = { content };
    list.push({ name, role: f.role, type, size, label: String(f.label || '').slice(0, 60) });
  }
  if (total > MAX_TOTAL) throw fail('too_large', t('파일이 너무 커요. 모두 합쳐 9 MB까지 올릴 수 있어요.'));
  let coverName = old?.cover || null;
  if (cover === null) { if (coverName) out[coverName] = null; coverName = null; }
  else if (cover) {
    const buf = Buffer.from(cover.data);
    if (buf.length > MAX_COVER) throw fail('too_large', t('표지 이미지가 너무 커요.'));
    if (coverName && coverName !== 'cover.jpg.b64') out[coverName] = null;
    coverName = 'cover.jpg.b64';
    out[coverName] = { content: buf.toString('base64') };
  }
  // files of the old version that this one no longer has
  for (const f of old?.files || []) if (!list.some((x) => x.name === f.name) && !out[f.name]) out[f.name] = null;
  return { out, list, coverName };
}

async function readManifest(login, id) {
  try { return JSON.parse(await raw(login, id, MANIFEST, 'text')); } catch (e) {
    if (e.code) throw e;
    throw fail('bad_manifest', t('작품 정보를 읽지 못했어요.'));
  }
}

// publish a new work, or (id) change one of mine. visibility: 'public' (listed in 창작마당) | 'link'
async function publish({ id, visibility = 'link', meta, files, cover }) {
  needGithub();
  const m = cleanMeta(meta);
  const me = A.state.github.user;
  let old = null, g = null;
  if (id) {
    g = await A.gh('GET', `/gists/${okId(id)}`);
    if (String(g.owner?.id) !== String(me.id)) throw fail('not_owner', t('내 작품만 고칠 수 있어요.'));
    try { old = JSON.parse(g.files?.[MANIFEST]?.content || 'null'); } catch { old = null; }
    if (!old) throw fail('not_work', t('창작마당 작품이 아니에요.'));
    visibility = g.public ? 'public' : 'link'; // GitHub cannot change a gist's visibility afterwards
  }
  // on a change, files not sent again stay as they were
  const keep = id && !files ? old.files.map((f) => ({ ...f, keep: true })) : null;
  const { out, list, coverName } = gistFiles(keep ? [] : files, cover, keep ? { ...old, files: [] } : old);
  const fileList = keep || list;
  if (!fileList.length) throw fail('no_files', t('올릴 파일을 하나 이상 골라 주세요.'));
  const manifest = {
    v: 1, ...m, author: me.name || me.handle, files: fileList.map(({ keep: _k, ...f }) => f), cover: coverName,
    created: old?.created || new Date().toISOString(), updated: new Date().toISOString(),
  };
  out[MANIFEST] = { content: JSON.stringify(manifest, null, 1) };
  const body = { description: DESC + m.title, files: out };
  g = id ? await A.gh('PATCH', `/gists/${id}`, body) : await A.gh('POST', '/gists', { ...body, public: visibility === 'public' });
  cache.clear();
  let item = null, indexError = null;
  if (g.public) {
    try { item = await A.helper('POST', '/workshop/items', { gist: g.id }, 'github'); } catch (e) { indexError = e.message; }
  }
  return { id: g.id, link: g.html_url, login: g.owner?.login || me.handle, visibility: g.public ? 'public' : 'link', item, indexError };
}

// ---------- my works: every gist with a manifest, with the index's numbers for the public ones ----------
async function mine() {
  needGithub();
  const out = [];
  for (let page = 1; page <= 5; page++) {
    const list = await A.gh('GET', `/gists?per_page=100&page=${page}`);
    for (const g of list) {
      if (!g.files?.[MANIFEST]) continue;
      out.push({
        id: g.id, login: g.owner?.login || A.state.github.user.handle, link: g.html_url, visibility: g.public ? 'public' : 'link',
        title: (g.description || '').startsWith(DESC) ? g.description.slice(DESC.length) : (g.description || t('이름 없음')),
        updated: Date.parse(g.updated_at), created: Date.parse(g.created_at),
      });
    }
    if (list.length < 100) break;
  }
  let index = [];
  try { index = (await A.helper('GET', '/workshop/mine', null, 'github')).items || []; } catch { /* Helper away: the list still shows */ }
  for (const w of out) {
    const it = index.find((x) => x.id === w.id);
    if (it) Object.assign(w, { listed: true, likes: it.likes, comments: it.comments, plays: it.plays, downloads: it.downloads, hidden: it.hidden || 0, item: it });
  }
  return out.sort((a, b) => b.created - a.created);
}

// a work opened from its link (any gist with a manifest; link-only works are read this way too)
async function byLink({ link }) {
  const m = String(link || '').trim().match(/([0-9a-f]{20,40})(?:[/?#].*)?$/i);
  if (!m) throw fail('bad_link', t('창작마당 작품 링크를 붙여넣어 주세요.'));
  const g = await A.gh('GET', `/gists/${m[1]}`, null, !!A.state.github);
  if (!g.files?.[MANIFEST]) throw fail('not_work', t('창작마당 작품 링크가 아니에요.'));
  const man = JSON.parse(g.files[MANIFEST].content || '{}');
  let item = null;
  if (g.public) { try { item = await A.helper('GET', `/workshop/items/${g.id}`, null, actor()); } catch { item = null; } }
  return item || {
    id: g.id, owner: { login: g.owner?.login || '', name: man.author || g.owner?.login || '' }, title: man.title || '', description: man.description || '',
    tags: man.tags || [], genre: man.genre || 'etc', app: man.app || 'piano', kinds: [...new Set((man.files || []).map((f) => f.role))],
    files: man.files || [], cover: man.cover || null, length: man.length || null, bpm: man.bpm || null,
    created: Date.parse(man.created || g.created_at) / 1000, updated: Date.parse(man.updated || g.updated_at) / 1000,
    unlisted: !g.public, mine: !!A.state.github && String(g.owner?.id) === String(A.state.github.user?.id),
  };
}

// ---------- the piano's recordings folder ----------
const REC_EXT = { '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.mid': 'audio/midi', '.midi': 'audio/midi' };
const recRoot = (dir) => path.resolve(dir || path.join(app.getPath('documents'), 'MeloFi'));
async function recordings({ dir }) {
  const root = recRoot(dir), out = [];
  const walk = async (d, depth) => {
    let ents = [];
    try { ents = await fsp.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory() && depth < 1) await walk(p, depth + 1);
      else if (e.isFile() && REC_EXT[path.extname(e.name).toLowerCase()]) {
        const st = await fsp.stat(p).catch(() => null);
        if (st) out.push({ path: p, name: e.name, size: st.size, time: st.mtimeMs, type: REC_EXT[path.extname(e.name).toLowerCase()] });
      }
    }
  };
  await walk(root, 0);
  return out.sort((a, b) => b.time - a.time).slice(0, 40);
}
async function readRecording({ dir, file }) {
  const root = recRoot(dir), p = path.resolve(String(file || ''));
  if (!p.startsWith(root + path.sep) || !REC_EXT[path.extname(p).toLowerCase()]) throw fail('bad_file', t('녹음 폴더의 파일만 고를 수 있어요.'));
  const st = await fsp.stat(p);
  if (st.size > MAX_TOTAL) throw fail('too_large', t('파일이 너무 커요. 모두 합쳐 9 MB까지 올릴 수 있어요.'));
  return { name: path.basename(p), type: REC_EXT[path.extname(p).toLowerCase()], data: await fsp.readFile(p) };
}

// ---------- 창작마당 profile: nickname, one-line intro, picture ----------
// Kept by the Helper (helper/workshop.py, /workshop/profile). When the Helper does not have those
// endpoints yet (an older deploy) or cannot be reached, the profile waits in userData/workshop-profile.json
// and goes up the next time 창작마당 is opened.
const PENDING = () => path.join(app.getPath('userData'), 'workshop-profile.json');
const NICK_RE = /^[0-9A-Za-z\uac00-\ud7a3\u3131-\u318e_.\-]{2,20}$/;
const RESERVED = ['melofi', 'admin', 'administrator', 'mod', 'moderator', 'staff', 'system', 'official', 'helper', '운영자', '관리자', '운영진', '멜로파이', '공식', '시스템'];  // i18n-ignore (names, the same as helper/workshop.py)
const nickKey = (n) => String(n).normalize('NFKC').toLowerCase().replace(/[_.-]/g, '');
function nickProblem(n) {
  if (!NICK_RE.test(n) || nickKey(n).length < 2) return 'bad';
  const k = nickKey(n);
  return RESERVED.some((r) => k === r || k.startsWith(r)) ? 'reserved' : null;
}
const later = (e) => ['no_route', 'offline', 'no_helper'].includes(e?.code);
async function readPending() { try { return JSON.parse(await fsp.readFile(PENDING(), 'utf8')); } catch { return null; } }

function cleanProfile(p = {}) {
  const nick = String(p.nick || '').trim();
  const why = nickProblem(nick);
  if (why) throw fail(`nick_${why}`, why === 'reserved' ? t('운영진용으로 남겨 둔 이름이에요.') : t('닉네임은 2~20자 한글, 영문, 숫자와 _ - . 만 쓸 수 있어요.'));
  const avatar = ['', 'discord', 'github', 'upload'].includes(p.avatar) ? p.avatar : '';
  const out = { nick, bio: String(p.bio || '').replace(/\s+/g, ' ').trim().slice(0, 80), avatar };
  if (avatar === 'discord') {
    if (actor() !== 'discord' || !A.state.discord?.user?.avatar) throw fail('bad_avatar', t('디스코드 프로필 사진이 없어요.'));
    out.avatarUrl = A.state.discord.user.avatar;
  }
  if (avatar === 'github' && actor() !== 'github') throw fail('bad_avatar', t('GitHub를 연결하면 GitHub 사진을 쓸 수 있어요.'));
  if (avatar === 'upload' && p.image) {
    const img = Buffer.from(p.image);
    if (img.length > 24 * 1024 || img[0] !== 0xff || img[1] !== 0xd8) throw fail('bad_avatar', t('이미지를 읽지 못했어요.'));
    out.image = img.toString('base64');
  }
  return out;
}
// A profile belongs to the identity that likes and comments (actor(): GitHub when connected, else
// Discord), so the picture can be that account's own picture, an upload, or none.

async function pushPending() {
  const p = await readPending();
  if (!p || !actor()) return null;
  try {
    const r = await A.helper('PUT', '/workshop/profile', p, actor());
    await fsp.rm(PENDING(), { force: true });
    return r;
  } catch (e) { if (!later(e)) await fsp.rm(PENDING(), { force: true }); return null; }
}

const ops = {
  status: async () => (pushPending().catch(() => null), {
    github: A.state.github?.user || null, discord: A.state.discord?.user || null,
    actor: actor(), avatars: { discord: A.state.discord?.user?.avatar || null, github: A.state.github?.user?.avatar || null }, helper: !!require('./account.js').CONF.helper, genres: GENRES,
  }),
  list: (o) => A.helper('GET', `/workshop/items?${q({ sort: o.sort, period: o.period, tag: o.tag, genre: o.genre, kind: o.kind, app: o.app, owner: o.owner, q: o.q, page: o.page })}`, null, null),
  item: ({ id }) => A.helper('GET', `/workshop/items/${okId(id)}`, null, actor()),
  byLink,
  cover: async ({ login, id, name }) => `data:image/jpeg;base64,${(await raw(login, id, name)).toString('base64')}`,
  file: async ({ login, id, name }) => { const b = await raw(login, id, name); return new Uint8Array(b.buffer, b.byteOffset, b.length); },
  projectText: ({ login, id }) => raw(login, id, PROJECT_FILE, 'text'),
  manifest: ({ login, id }) => readManifest(login, id),
  count: ({ id, what }) => A.helper('POST', `/workshop/items/${okId(id)}/count`, { what }, null).catch(() => null),
  download: async ({ login, id, name, suggest }, e) => {
    const data = await raw(login, id, name);
    const win = BrowserWindow.fromWebContents(e.sender);
    const safe = String(suggest || name.replace(/\.b64$/, '')).replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 120) || 'melofi';
    const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('downloads'), safe) });
    if (r.canceled || !r.filePath) return null;
    await fsp.writeFile(r.filePath, data);
    ops.count({ id, what: 'download' });
    return r.filePath;
  },
  like: ({ id, on }) => A.helper('POST', `/workshop/items/${okId(id)}/like`, { on: !!on }, needActor()),
  comments: ({ id }) => A.helper('GET', `/workshop/items/${okId(id)}/comments`, null, actor()),
  comment: ({ id, text }) => A.helper('POST', `/workshop/items/${okId(id)}/comments`, { text }, needActor()),
  uncomment: ({ cid }) => A.helper('DELETE', `/workshop/comments/${Number(cid) | 0}`, null, needActor()),
  report: ({ id, reason, text }) => A.helper('POST', `/workshop/items/${okId(id)}/report`, { reason, text }, needActor()),
  publish,
  mine,
  remove: async ({ id }) => {
    needGithub();
    await A.helper('DELETE', `/workshop/items/${okId(id)}`, null, 'github').catch((e) => { if (e.code !== 'not_found' && e.code !== 'offline' && e.code !== 'no_helper') throw e; });
    await A.gh('DELETE', `/gists/${id}`).catch((e) => { if (e.code !== 'not_found') throw e; });
    cache.clear();
    return true;
  },
  // everything this person left in the 창작마당 index (likes, comments, reports, listings);
  // the gists stay on their GitHub unless they also delete the works
  forget: async () => {
    let removed = 0;
    for (const who of ['github', 'discord']) {
      if (!A.state[who]) continue;
      removed += (await A.helper('DELETE', '/workshop/me', null, who)).removed || 0;
    }
    return { removed };
  },
  recordings,
  readRecording,
  pickFile: async ({ kinds = ['audio', 'midi'] }, e) => {
    const ext = [...(kinds.includes('audio') ? ['mp3', 'ogg', 'm4a', 'wav'] : []), ...(kinds.includes('midi') ? ['mid', 'midi'] : [])];
    const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), { properties: ['openFile'], filters: [{ name: t('오디오·MIDI'), extensions: ext }] });
    if (r.canceled || !r.filePaths[0]) return null;
    const p = r.filePaths[0];
    const st = await fsp.stat(p);
    if (st.size > MAX_TOTAL) throw fail('too_large', t('파일이 너무 커요. 모두 합쳐 9 MB까지 올릴 수 있어요.'));
    return { name: path.basename(p), type: REC_EXT[path.extname(p).toLowerCase()] || 'audio/mpeg', data: await fsp.readFile(p) };
  },
  checkNick: async ({ name }) => {
    const n = String(name || '').trim();
    const why = nickProblem(n);
    if (why) return { ok: false, reason: why };
    try { return await A.helper('GET', `/workshop/nick?name=${encodeURIComponent(n)}`, null, actor()); } catch (e) {
      if (later(e)) return { ok: true, unchecked: true }; // checked again when the profile goes up
      throw e;
    }
  },
  profile: async () => {
    const pending = await readPending();
    if (pending) return { ...pending, image: undefined, avatarUrl: pending.avatarUrl || '', pending: true };
    if (!actor()) return { nick: '', bio: '', avatar: '', avatarUrl: '' };
    try { return await A.helper('GET', '/workshop/profile', null, actor()); } catch (e) { if (later(e)) return { nick: '', bio: '', avatar: '', avatarUrl: '', unreachable: true }; throw e; }
  },
  saveProfile: async (p) => {
    if (!actor()) throw fail('login_required', t('디스코드나 GitHub로 로그인해 주세요.'));
    const body = cleanProfile(p);
    try {
      const r = await A.helper('PUT', '/workshop/profile', body, actor());
      await fsp.rm(PENDING(), { force: true });
      return r;
    } catch (e) {
      if (!later(e)) throw e;
      await fsp.writeFile(PENDING(), JSON.stringify(body));
      return { ...body, image: undefined, pending: true };
    }
  },
  openLink: async ({ login, id }) => { await require('electron').shell.openExternal(`https://gist.github.com/${okLogin(login)}/${okId(id)}`); return true; },
};

function register(ipcMain, deps) {
  ({ app, dialog, BrowserWindow } = deps);
  ipcMain.handle('workshop', async (e, op, payload) => {
    await A.load();
    if (!ops[op]) return { ok: false, error: 'bad_op', message: op };
    try {
      return { ok: true, data: await ops[op](payload || {}, e) };
    } catch (err) {
      return { ok: false, error: err.code || 'error', message: err.message };
    }
  });
}

module.exports = { register, GENRES };
