'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('melofi', {
  listInstruments: () => ipcRenderer.invoke('instruments:list'),
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (s) => ipcRenderer.invoke('settings:save', s),
  envInfo: () => ipcRenderer.invoke('env:info'),
  pickFolder: (cur) => ipcRenderer.invoke('dialog:pickFolder', cur),
  showItem: (p) => ipcRenderer.invoke('shell:showItem', p),
  openFolder: (p) => ipcRenderer.invoke('shell:openFolder', p),
  pickBackground: () => ipcRenderer.invoke('bg:pick'),
  pickScore: () => ipcRenderer.invoke('score:pick'),
  relaunch: () => ipcRenderer.invoke('app:relaunch'),
  toggleFullscreen: () => ipcRenderer.invoke('win:toggleFullscreen'),
  setFullscreen: (on) => ipcRenderer.invoke('win:setFullscreen', on),
  onFullscreen: (cb) => ipcRenderer.on('win:fullscreen', (_e, on) => cb(on)),
  saveRecording: (payload) => ipcRenderer.invoke('recording:save', payload),
});
