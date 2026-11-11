'use strict';
const { contextBridge, ipcRenderer, webUtils, webFrame } = require('electron');

// every window's uncaught errors go to the local log (main: crashlog.js). The page's errors are only
// seen from the page's own world, so a small listener is put there; it hands plain strings over.
{
  const send = (m) => { try { ipcRenderer.send('log:error', { kind: String(m?.kind || 'error'), message: String(m?.message || ''), source: String(m?.source || ''), line: +m?.line || 0, stack: String(m?.stack || '') }); } catch { /* closing */ } };
  contextBridge.exposeInMainWorld('__melofiLogError', send);
  webFrame.executeJavaScript(`(() => {
    const send = window.__melofiLogError;
    if (!send) return;
    window.addEventListener('error', (e) => {
      if (!(e instanceof ErrorEvent)) return; // a failed <img>/<script> load, not an exception
      send({ kind: 'error', message: e.message, source: e.filename, line: e.lineno, stack: e.error && e.error.stack || '' });
    });
    window.addEventListener('unhandledrejection', (e) => {
      const r = e.reason;
      send({ kind: 'rejection', message: (r && r.message) || String(r), stack: (r && r.stack) || '' });
    });
  })()`).catch(() => {});
}

let bootDone = false;
ipcRenderer.once('boot:done', () => { bootDone = true; });

contextBridge.exposeInMainWorld('melofi', {
  listInstruments: () => ipcRenderer.invoke('instruments:list'),
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (s) => ipcRenderer.invoke('settings:save', s),
  i18nBoot: () => ipcRenderer.sendSync('i18n:boot'),
  onSettingsChanged: (cb) => ipcRenderer.on('settings:changed', (_e, p) => cb(p)),
  bootProgress: (m) => ipcRenderer.send('boot:progress', m),
  bootReady: () => ipcRenderer.send('boot:ready'),
  onBootProgress: (cb) => ipcRenderer.on('boot:progress', (_e, m) => cb(m)),
  openStudioWindow: (cmd) => ipcRenderer.invoke('studio:openWindow', cmd),
  // boot:done can come before the page's script is listening (its modules wait for the language)
  onBootDone: (cb) => { if (bootDone) cb(); else ipcRenderer.once('boot:done', () => cb()); },
  startShow: () => ipcRenderer.invoke('start:show'),
  startChoose: (target) => ipcRenderer.invoke('start:choose', target),
  splashResize: (w, h) => ipcRenderer.invoke('splash:resize', w, h),
  quitApp: () => ipcRenderer.invoke('app:quit'),
  openInstrumentPicker: (opts) => ipcRenderer.invoke('picker:open', opts),
  openKeysWindow: () => ipcRenderer.invoke('keys:open'),
  setZoom: (f) => webFrame.setZoomFactor(Math.max(0.5, Math.min(2, +f || 1))),
  closeKeysWindow: () => ipcRenderer.invoke('keys:close'),
  // headless tests only (main registers these when MELOFI_SHOT is set)
  testEval: (which, code) => ipcRenderer.invoke('test:eval', which, code),
  testShot: (which, name) => ipcRenderer.invoke('test:shot', which, name),
  keysNote: (m) => ipcRenderer.send('keys:note', m),
  onKeysNote: (cb) => ipcRenderer.on('keys:note', (_e, m) => cb(m)),
  onKeysClosed: (cb) => ipcRenderer.on('keys:closed', () => cb()),
  onPickerChosen: (cb) => ipcRenderer.on('picker:chosen', (_e, m) => cb(m)),
  onPickerStore: (cb) => ipcRenderer.on('picker:store', () => cb()),
  pickerOptions: () => ipcRenderer.invoke('picker:options'),
  pickerChoose: (id) => ipcRenderer.invoke('picker:choose', id),
  pickerOpenStore: () => ipcRenderer.invoke('picker:store'),
  onPickerSetup: (cb) => ipcRenderer.on('picker:setup', (_e, o) => cb(o)),
  studioTakeCommand: () => ipcRenderer.invoke('studio:takeCommand'),
  onStudioCommand: (cb) => ipcRenderer.on('studio:command', (_e, c) => cb(c)),
  focusMainWindow: () => ipcRenderer.invoke('win:focusMain'),
  envInfo: () => ipcRenderer.invoke('env:info'),
  pickFolder: (cur) => ipcRenderer.invoke('dialog:pickFolder', cur),
  showItem: (p) => ipcRenderer.invoke('shell:showItem', p),
  openFolder: (p) => ipcRenderer.invoke('shell:openFolder', p),
  pickBackground: () => ipcRenderer.invoke('bg:pick'),
  pickScore: () => ipcRenderer.invoke('score:pick'),
  relaunch: () => ipcRenderer.invoke('app:relaunch'),
  toggleFullscreen: () => ipcRenderer.invoke('win:toggleFullscreen'),
  setFullscreen: (on) => ipcRenderer.invoke('win:setFullscreen', on),
  setWindowSize: (w, h) => ipcRenderer.invoke('win:setSize', w, h),
  studioSave: (json, name, p) => ipcRenderer.invoke('studio:save', json, name, p),
  studioOpen: () => ipcRenderer.invoke('studio:open'),
  studioOpenMidi: () => ipcRenderer.invoke('studio:openMidi'),
  studioAutosave: (json) => ipcRenderer.invoke('studio:autosave', json),
  studioAutoload: () => ipcRenderer.invoke('studio:autoload'),
  onFullscreen: (cb) => ipcRenderer.on('win:fullscreen', (_e, on) => cb(on)),
  saveRecording: (payload) => ipcRenderer.invoke('recording:save', payload),
  downloadInstrument: (id) => ipcRenderer.invoke('instruments:download', id),
  cancelDownload: (id) => ipcRenderer.invoke('instruments:cancel', id),
  removeInstrument: (id) => ipcRenderer.invoke('instruments:remove', id),
  onInstrumentProgress: (cb) => ipcRenderer.on('instruments:progress', (_e, p) => cb(p)),
  openScorePath: (p) => ipcRenderer.invoke('score:openPath', p),
  recentScores: () => ipcRenderer.invoke('score:recent'),
  renderOpen: (o) => ipcRenderer.invoke('render:open', o),
  renderWrite: (id, data, pos) => ipcRenderer.invoke('render:write', id, data, pos),
  renderClose: (id, keep) => ipcRenderer.invoke('render:close', id, keep),
  clearRecentScores: () => ipcRenderer.invoke('score:clearRecent'),
  dawList: () => ipcRenderer.invoke('daw:list'),
  mediaPut: (name, data) => ipcRenderer.invoke('media:put', name, data),
  vstStatus: () => ipcRenderer.invoke('vst:status'),
  vstScan: (folders) => ipcRenderer.invoke('vst:scan', folders),
  vstLoad: (a) => ipcRenderer.invoke('vst:load', a),
  vstUnload: (slot) => ipcRenderer.invoke('vst:unload', slot),
  vstEditor: (slot) => ipcRenderer.invoke('vst:editor', slot),
  vstGetState: (slot) => ipcRenderer.invoke('vst:getState', slot),
  vstGain: (slot, g) => ipcRenderer.invoke('vst:gain', slot, g),
  vstAllOff: (slot) => ipcRenderer.invoke('vst:allOff', slot),
  vstNote: (m) => ipcRenderer.send('vst:note', m),
  vstRender: (a) => ipcRenderer.invoke('vst:render', a),
  stemsStatus: () => ipcRenderer.invoke('stems:status'),
  stemsSetup: (opts) => ipcRenderer.invoke('stems:setup', opts), // { mode: 'install' | 'reinstall' | 'update' }
  stemsRun: (payload) => ipcRenderer.invoke('stems:run', payload),
  stemsCancel: () => ipcRenderer.invoke('stems:cancel'),
  stemsGpu: () => ipcRenderer.invoke('stems:gpu'),
  stemsCached: (payload) => ipcRenderer.invoke('stems:cached', payload),
  stemsInstruments: (dir) => ipcRenderer.invoke('stems:instruments', dir),
  stemsAddInstruments: () => ipcRenderer.invoke('stems:addInstruments'),
  stemsSetToken: (t) => ipcRenderer.invoke('stems:setToken', t),
  stemsRead: (file) => ipcRenderer.invoke('stems:read', file),
  onStemsLog: (cb) => { const f = (_e, t) => cb(t); ipcRenderer.on('stems:log', f); return () => ipcRenderer.removeListener('stems:log', f); },
  onStemsProgress: (cb) => { const f = (_e, p) => cb(p); ipcRenderer.on('stems:progress', f); return () => ipcRenderer.removeListener('stems:progress', f); },
  vocalStatus: (opts) => ipcRenderer.invoke('vocal:status', opts),
  vocalSetup: () => ipcRenderer.invoke('vocal:setup'),
  vocalInstall: (id) => ipcRenderer.invoke('vocal:install', id),
  vocalCancel: () => ipcRenderer.invoke('vocal:cancel'),
  vocalRemove: (id) => ipcRenderer.invoke('vocal:remove', id),
  vocalLicense: (id) => ipcRenderer.invoke('vocal:license', id),
  // { voice, notes: [{t, d, n, syl}] (seconds), speaker? } -> { ok, wav, seconds, sr, use, credit }
  vocalRender: (payload) => ipcRenderer.invoke('vocal:render', payload),
  // { path } or { name, data }, notes?: [{t, d, n}], language? -> { ok, text, syllables, notes: [syl] }
  vocalLyrics: (payload) => ipcRenderer.invoke('vocal:lyrics', payload),
  vocalCheck: (payload) => ipcRenderer.invoke('vocal:check', payload),
  onVocalProgress: (cb) => { const f = (_e, p) => cb(p); ipcRenderer.on('vocal:progress', f); return () => ipcRenderer.removeListener('vocal:progress', f); },
  mediaGet: (hash) => ipcRenderer.invoke('media:get', hash),
  mediaPickFiles: (opts) => ipcRenderer.invoke('media:pickFiles', opts),
  mediaPickFolder: () => ipcRenderer.invoke('media:pickFolder'),
  mediaAllowRoots: (list) => ipcRenderer.invoke('media:allowRoots', list),
  mediaList: (dir) => ipcRenderer.invoke('media:list', dir),
  mediaRead: (p) => ipcRenderer.invoke('media:read', p),
  studioOpenPath: (p) => ipcRenderer.invoke('studio:openPath', p),
  studioRecent: () => ipcRenderer.invoke('studio:recent'),
  studioVersions: () => ipcRenderer.invoke('studio:versions'),
  studioVersion: (name) => ipcRenderer.invoke('studio:version', name),
  dawWrite: (payload) => ipcRenderer.invoke('daw:write', payload),
  dawOpen: (id, file) => ipcRenderer.invoke('daw:open', { id, file }),
  dawOpenFolder: (dir) => ipcRenderer.invoke('daw:openFolder', dir),
  dawDrag: (files) => ipcRenderer.send('daw:drag', files),
  account: (op, payload) => ipcRenderer.invoke('account', op, payload),
  updateState: () => ipcRenderer.invoke('update:state'),
  updateCheck: () => ipcRenderer.invoke('update:check'),
  updateDownload: () => ipcRenderer.invoke('update:download'),
  updateRestart: () => ipcRenderer.invoke('update:restart'),
  updateDismiss: () => ipcRenderer.invoke('update:dismiss'),
  onUpdateState: (cb) => ipcRenderer.on('update:state', (_e, s) => cb(s)),
  reportInfo: () => ipcRenderer.invoke('report:info'),
  reportSave: (text) => ipcRenderer.invoke('report:save', text),
  reportGithub: (text) => ipcRenderer.invoke('report:github', text),
  openLogs: () => ipcRenderer.invoke('report:openLogs'),
  pathForFile: (f) => { try { return webUtils.getPathForFile(f) || ''; } catch { return ''; } },
});
