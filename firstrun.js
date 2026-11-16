'use strict';
// 처음 설정 (renderer/js/firstrun.js), main-process side: the few things a page cannot do itself.
// Windows decides microphone access for all desktop apps with one switch (Settings > Privacy &
// security > Microphone > "Let desktop apps access your microphone"); there is no per-app prompt, so
// the setup can only test access and open that page.
const { shell } = require('electron');

const PAGES = {
  microphone: 'ms-settings:privacy-microphone',
  sound: 'ms-settings:sound',
};

function register(ipcMain) {
  ipcMain.handle('firstrun:openSettings', async (_e, which) => {
    const url = PAGES[which];
    if (!url || process.platform !== 'win32') return false;
    try { await shell.openExternal(url); return true; } catch { return false; }
  });
}

module.exports = { register, PAGES };
