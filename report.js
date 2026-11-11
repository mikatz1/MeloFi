'use strict';
// 문제 신고: builds a report from the local log and the system info, and only on the user's click
// either saves it as a .txt in Documents/MeloFi or opens a pre-filled GitHub issue in the browser.
// Nothing is sent by MeloFi itself; names, the user folder and e-mail addresses are blanked out.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crashlog = require('./crashlog.js');
const i18n = require('./i18n-main.js');
const { t } = i18n;

const ISSUES = 'https://github.com/mikatz1/MeloFi/issues/new';
const URL_MAX = 7000; // browsers and GitHub cut longer links

function scrubber() {
  const home = os.homedir();
  let user = '';
  try { user = os.userInfo().username; } catch { /* no user info */ }
  const host = os.hostname();
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rules = [];
  if (home) rules.push([new RegExp(esc(home).replace(/\\\\/g, '[\\\\/]'), 'gi'), '~']);
  rules.push([/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '<email>']);
  rules.push([/(token|key|secret|password|authorization)(["'\s:=]+)[^\s"',;]+/gi, '$1$2<hidden>']);
  if (user && user.length > 2) rules.push([new RegExp(`\\b${esc(user)}\\b`, 'g'), '<user>']); // case kept: 'user' in paths stays
  if (host && host.length > 2) rules.push([new RegExp(`\\b${esc(host)}\\b`, 'g'), '<pc>']);
  return (s) => rules.reduce((t, [re, to]) => t.replace(re, to), String(s));
}

async function systemInfo({ app, screen }) {
  const info = {
    MeloFi: app.getVersion(),
    Electron: process.versions.electron,
    Chrome: process.versions.chrome,
    OS: `${os.version?.() || process.platform} (${os.release()}) ${process.arch}`,
    CPU: `${os.cpus()[0]?.model?.trim() || '?'} × ${os.cpus().length}`,
    RAM: `${Math.round(os.totalmem() / 2 ** 30)} GB`,
  };
  info[t('언어')] = app.getLocale();
  try {
    const ds = screen.getAllDisplays();
    info[i18n.tc('report', '화면')] = ds.map((d) => `${d.size.width}×${d.size.height} @${d.scaleFactor}x`).join(', ');
  } catch { /* before ready */ }
  try {
    const g = await Promise.race([app.getGPUInfo('basic'), new Promise((r) => setTimeout(() => r(null), 1500))]);
    const dev = g?.gpuDevice?.find((d) => d.active) || g?.gpuDevice?.[0];
    if (dev) info.GPU = `vendor 0x${(dev.vendorId || 0).toString(16)} device 0x${(dev.deviceId || 0).toString(16)}${dev.driverVersion ? ` · driver ${dev.driverVersion}` : ''}`;
    const st = app.getGPUFeatureStatus?.();
    if (st) info.WebGL2 = st.webgl2;
  } catch { /* no GPU info */ }
  return info;
}

async function collect(deps) {
  const scrub = scrubber();
  const system = await systemInfo(deps);
  const errors = crashlog.recent(20).map(scrub);
  return { system, errors, logDir: crashlog.dir() };
}

function compose({ system, errors, description, logTail = '' }) {
  const sys = Object.entries(system).map(([k, v]) => `- ${k}: ${v}`).join('\n');
  return [
    `## ${t('무슨 일이 있었나요')}`,
    (description || '').trim() || t('(설명 없음)'),
    '',
    `## ${t('시스템')}`,
    sys,
    '',
    `## ${t('최근 오류 ({n})', { n: errors.length })}`,
    errors.length ? '```\n' + errors.join('\n') + '\n```' : t('(기록된 오류 없음)'),
    ...(logTail ? ['', `## ${t('로그 (마지막 부분)')}`, '```\n' + logTail + '\n```'] : []),
    '',
  ].join('\n');
}

function stamp() {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

async function save(deps, description, dir) {
  const scrub = scrubber();
  const { system, errors } = await collect(deps);
  let tail = '';
  try { tail = scrub(fs.readFileSync(crashlog.file(), 'utf8').split('\n').slice(-300).join('\n').trim()); } catch { /* no log yet */ }
  const text = compose({ system, errors, description: scrub(description), logTail: tail });
  await fsp.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${t('MeloFi 문제 신고')} ${stamp()}.txt`);
  await fsp.writeFile(file, '﻿' + text.replace(/\n/g, '\r\n'));
  return file;
}

// the issue page link; the newest errors are kept and older ones dropped until it fits
function issueUrl({ system, errors, description }) {
  const title = (description || '').trim().split('\n')[0].slice(0, 70) || i18n.tc('issue', '문제 신고');
  let list = errors.map((e) => e.split('\n').slice(0, 8).join('\n'));
  for (;;) {
    const body = compose({ system, errors: list, description });
    const url = `${ISSUES}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
    if (url.length <= URL_MAX || !list.length) return url.length <= URL_MAX ? url : url.slice(0, URL_MAX).replace(/%[0-9A-F]?$/i, '');
    list = list.slice(1);
  }
}

function register(ipcMain, deps) {
  const { shell, defaultDir } = deps;
  ipcMain.handle('report:info', () => collect(deps));
  ipcMain.handle('report:save', async (_e, description) => {
    const file = await save(deps, String(description || '').slice(0, 5000), defaultDir());
    shell.showItemInFolder(file);
    return file;
  });
  ipcMain.handle('report:github', async (_e, description) => {
    const scrub = scrubber();
    const { system, errors } = await collect(deps);
    await shell.openExternal(issueUrl({ system, errors, description: scrub(String(description || '').slice(0, 3000)) }));
    return true;
  });
  ipcMain.handle('report:openLogs', async () => { const d = crashlog.dir(); if (d) { await fsp.mkdir(d, { recursive: true }); await shell.openPath(d); } return true; });
}

module.exports = { register, compose, issueUrl, scrubber, ISSUES };
