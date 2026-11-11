'use strict';
// Crash and error log, kept on this PC only (userData/logs). Nothing here touches the network.
// melofi.log rotates to melofi.1.log … melofi.3.log at 512 KB. Writes are synchronous so the line
// is on disk even when the process dies right after.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const MAX_BYTES = 512 * 1024;
const KEEP = 3;
const PER_SESSION = 400; // renderer entries per run, so a loop of errors cannot fill the disk

let dir = null, file = null, version = '?', count = 0;
const recentKeys = new Map(); // message -> last time, to fold repeats
const tags = new WeakMap(); // webContents -> 'piano' | 'studio' | …

const osLabel = () => `${process.platform} ${os.release()} ${process.arch}`;
const ts = () => {
  const d = new Date(), p = (n, l = 2) => String(n).padStart(l, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
};

function rotate() {
  try {
    if (fs.statSync(file).size < MAX_BYTES) return;
  } catch { return; }
  for (let i = KEEP; i >= 1; i--) {
    const from = i === 1 ? file : path.join(dir, `melofi.${i - 1}.log`);
    try { fs.renameSync(from, path.join(dir, `melofi.${i}.log`)); } catch { /* not there yet */ }
  }
}

function write(level, where, message, stack) {
  if (!file) return;
  try {
    rotate();
    let line = `${ts()} v${version} ${osLabel()} [${where}] ${level}: ${String(message).replace(/\s+$/, '')}\n`;
    if (stack) line += String(stack).split('\n').map((l) => `    ${l.trim()}`).filter((l) => l.trim()).join('\n') + '\n';
    fs.appendFileSync(file, line);
  } catch { /* the log must never take the app down */ }
}

// level: 'error' | 'crash' | 'warn' | 'info'
function log(level, where, message, stack) {
  // the same message again within 10 s is folded into the first one
  const key = `${where}|${message}`;
  const now = Date.now();
  if (now - (recentKeys.get(key) || 0) < 10000) return;
  recentKeys.set(key, now);
  if (recentKeys.size > 500) recentKeys.clear();
  write(level, where, message, stack);
}

function tagOf(wc) {
  if (!wc) return 'main';
  if (tags.has(wc)) return tags.get(wc);
  try {
    const u = new URL(wc.getURL());
    const page = u.pathname.split('/').pop().replace(/\.html$/, '');
    return page === 'index' ? (u.searchParams.has('studio') ? 'studio' : 'piano') : page || 'window';
  } catch { return 'window'; }
}

// one window's renderer errors (sent by preload.js) and its console.error lines
function tagContents(wc, tag) { if (wc && tag) tags.set(wc, tag); }
function watchContents(wc) {
  wc.on('console-message', (e) => {
    const level = e.level ?? e.params?.level;
    if (level !== 'error' && level !== 3) return;
    const msg = String(e.message ?? e.params?.message ?? '');
    if (/^Uncaught/.test(msg)) return; // preload.js reports those, with the stack
    if (count++ > PER_SESSION) return;
    const src = e.sourceId ?? e.params?.sourceId;
    const ln = e.lineNumber ?? e.params?.lineNumber;
    log('console', tagOf(wc), msg.slice(0, 2000) + (src ? ` (${String(src).split('/').pop()}:${ln})` : ''));
  });
}

function init({ app, ipcMain }) {
  version = app.getVersion();
  dir = path.join(app.getPath('userData'), 'logs');
  file = path.join(dir, 'melofi.log');
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* read-only profile: no log */ }
  write('info', 'main', `start · Electron ${process.versions.electron} · Chrome ${process.versions.chrome}`);

  process.on('uncaughtException', (err) => log('crash', 'main', `uncaughtException: ${err?.message || err}`, err?.stack));
  process.on('unhandledRejection', (r) => log('error', 'main', `unhandledRejection: ${r?.message || r}`, r?.stack));

  app.on('render-process-gone', (_e, wc, d) => {
    if (d.reason === 'clean-exit') return;
    log('crash', tagOf(wc), `render process gone: ${d.reason} (exit ${d.exitCode})`);
  });
  app.on('child-process-gone', (_e, d) => {
    if (d.reason === 'clean-exit') return;
    log('crash', d.type === 'GPU' ? 'gpu' : `child:${d.type}`, `${d.type} process gone: ${d.reason} (exit ${d.exitCode})${d.name ? ` · ${d.name}` : ''}`);
  });
  app.on('web-contents-created', (_e, wc) => watchContents(wc));

  ipcMain.on('log:error', (e, m = {}) => {
    if (count++ > PER_SESSION) return;
    const where = tagOf(e.sender);
    const at = m.source ? ` (${String(m.source).split('/').pop()}:${m.line || 0})` : '';
    log('error', where, `${m.kind === 'rejection' ? 'unhandledrejection: ' : ''}${String(m.message || '').slice(0, 2000)}${at}`, m.stack ? String(m.stack).slice(0, 6000) : '');
  });
}

// the last `n` entries (newest last) across the current and the previous file, info lines left out
function recent(n = 30) {
  if (!dir) return [];
  const text = [path.join(dir, 'melofi.1.log'), file].map((f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } }).join('');
  const entries = [];
  for (const line of text.split('\n')) {
    if (/^\d{4}-\d\d-\d\d /.test(line)) entries.push(line);
    else if (line.trim() && entries.length) entries[entries.length - 1] += `\n${line}`;
  }
  return entries.filter((e) => !/\] info: /.test(e.split('\n')[0])).slice(-n);
}

module.exports = { init, log, tagContents, tagOf, recent, osLabel, dir: () => dir, file: () => file };
