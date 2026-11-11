'use strict';
// Updates from the GitHub releases (mikatz1/MeloFi, pre-releases included).
// Quiet check at start and every few hours; nothing is downloaded until the user presses 받기, and
// nothing is installed until they press 지금 다시 시작 (autoInstallOnAppQuit is off).
// The controller takes the updater as an argument so tests can drive it with a fake one.

const START_DELAY = 20 * 1000;
const { t } = require('./i18n-main.js');
const EVERY = 4 * 60 * 60 * 1000;

const OFFLINE = /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_NETWORK_CHANGED|ERR_CONNECTION|ERR_ADDRESS_UNREACHABLE|ERR_PROXY|ERR_TIMED_OUT|net::/i;
const isOffline = (err) => OFFLINE.test(`${err?.code || ''} ${err?.message || err}`);

// 1.2.10 > 1.2.9, 0.3.0 > 0.3.0-beta.1
function newer(a, b) {
  const parse = (v) => { const [core, pre] = String(v).replace(/^v/, '').split('-'); return { n: core.split('.').map((x) => +x || 0), pre }; };
  const x = parse(a), y = parse(b);
  for (let i = 0; i < 3; i++) if ((x.n[i] || 0) !== (y.n[i] || 0)) return (x.n[i] || 0) > (y.n[i] || 0);
  if (!x.pre !== !y.pre) return !x.pre;
  return (x.pre || '') > (y.pre || '');
}

function createUpdateController({ updater, currentVersion, isPackaged = true, enabled = () => true, broadcast = () => {}, log = () => {}, timers = { setTimeout, setInterval, clearInterval, clearTimeout } }) {
  let state = { phase: 'idle', current: currentVersion };
  let tick = null, first = null;
  const set = (patch) => { state = { current: currentVersion, ...patch }; broadcast(state); return state; };

  if (updater) {
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowPrerelease = true;
    updater.allowDowngrade = false;
    updater.logger = { info() {}, debug() {}, warn: (m) => log('info', `updater: ${m}`), error: (m) => log('info', `updater: ${String(m).split('\n')[0]}`) };
    // an 'error' event with no listener would throw; failures are handled where the promise rejects
    updater.on('error', () => {});
    updater.on('download-progress', (p) => {
      if (state.phase === 'downloading') set({ phase: 'downloading', version: state.version, percent: Math.max(0, Math.min(100, Math.round(p?.percent || 0))) });
    });
    updater.on('update-downloaded', (info) => set({ phase: 'ready', version: info?.version || state.version }));
  }

  async function check({ manual = false } = {}) {
    if (!updater) return set({ phase: manual ? 'error' : 'idle', manual, message: t('업데이트를 확인할 수 없어요') });
    if (['checking', 'downloading', 'ready'].includes(state.phase)) return state;
    if (state.phase === 'available') { if (manual) broadcast({ ...state, manual: true }); return state; }
    if (!isPackaged) return set({ phase: manual ? 'dev' : 'idle', manual });
    const prev = state;
    if (manual) set({ phase: 'checking', manual });
    try {
      const r = await updater.checkForUpdates();
      const v = r?.updateInfo?.version;
      const found = v && r.isUpdateAvailable !== false && newer(v, currentVersion);
      if (found) return set({ phase: 'available', version: v, manual });
      return set({ phase: manual ? 'latest' : 'idle', manual });
    } catch (err) {
      log('info', `update check failed: ${String(err?.message || err).split('\n')[0]}`);
      if (!manual) { state = prev.phase === 'checking' ? { phase: 'idle', current: currentVersion } : prev; return state; } // quiet: nothing shown
      return set({ phase: 'error', manual, offline: isOffline(err), message: isOffline(err) ? t('인터넷에 연결되지 않았어요') : t('업데이트를 확인하지 못했어요') });
    }
  }

  async function download() {
    if (state.phase !== 'available' && !(state.phase === 'error' && state.version)) return state;
    const version = state.version;
    set({ phase: 'downloading', version, percent: 0 });
    try {
      await updater.downloadUpdate();
      if (state.phase === 'downloading') set({ phase: 'ready', version }); // (when the event did not come first)
    } catch (err) {
      log('warn', `update download failed: ${String(err?.message || err).split('\n')[0]}`);
      set({ phase: 'error', version, retry: true, offline: isOffline(err), message: isOffline(err) ? t('인터넷에 연결되지 않았어요') : t('받지 못했어요') });
    }
    return state;
  }

  // only ever called from the user's click
  function restart() {
    if (state.phase !== 'ready') return false;
    log('info', `installing ${state.version}`);
    // silent NSIS install into the same folder, then MeloFi starts again
    timers.setTimeout(() => updater.quitAndInstall(true, true), 50);
    return true;
  }

  function start() {
    stop();
    const quiet = () => { if (enabled() && ['idle', 'latest', 'error', 'dev'].includes(state.phase)) check(); };
    first = timers.setTimeout(quiet, START_DELAY);
    tick = timers.setInterval(quiet, EVERY);
  }
  function stop() { if (first) timers.clearTimeout(first); if (tick) timers.clearInterval(tick); first = tick = null; }
  // the notice's ×: a found update stays found (the menu item brings it back), anything else clears
  function dismiss() {
    if (state.phase === 'error' && state.version) state = { phase: 'available', current: currentVersion, version: state.version };
    else if (['latest', 'error', 'dev'].includes(state.phase)) state = { phase: 'idle', current: currentVersion };
    return state;
  }

  return { check, download, restart, start, stop, dismiss, state: () => state };
}

// main.js: the real updater, the IPC the notice and the menus use, and the timer
function register(ipcMain, { app, BrowserWindow, settingsFile, log, quiet = false }) {
  const fs = require('node:fs');
  let updater = null;
  try { updater = require('electron-updater').autoUpdater; } catch (err) { log('warn', `electron-updater not available: ${err.message}`); }
  const enabled = () => { try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')).updateCheck !== false; } catch { return true; } };
  const ctl = createUpdateController({
    updater, currentVersion: app.getVersion(), isPackaged: app.isPackaged, enabled, log,
    broadcast: (s) => { for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('update:state', s); },
  });
  ipcMain.handle('update:state', () => ctl.state());
  ipcMain.handle('update:check', () => ctl.check({ manual: true }));
  ipcMain.handle('update:download', () => ctl.download());
  ipcMain.handle('update:restart', () => ctl.restart());
  ipcMain.handle('update:dismiss', () => ctl.dismiss());
  if (!quiet) ctl.start();
  return ctl;
}

module.exports = { register, createUpdateController, newer, isOffline, START_DELAY, EVERY };
