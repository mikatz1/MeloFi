// Renders renderer/assets/icon.svg into icon.png (256) and icon.ico (16-256).
//   npx electron tools/make-icon.js
'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const ASSETS = path.join(__dirname, '..', 'renderer', 'assets');
const SIZES = [16, 24, 32, 48, 64, 128, 256];

app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(ASSETS, 'icon.svg'), 'utf8');
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html,<html><body></body></html>');
  const pngs = await win.webContents.executeJavaScript(`(async () => {
    const svg = ${JSON.stringify(svg)};
    const img = new Image();
    img.src = 'data:image/svg+xml;base64,' + btoa(svg);
    await img.decode();
    const out = {};
    for (const s of ${JSON.stringify(SIZES)}) {
      const c = document.createElement('canvas'); c.width = c.height = s;
      const x = c.getContext('2d'); x.imageSmoothingQuality = 'high';
      x.drawImage(img, 0, 0, s, s);
      out[s] = c.toDataURL('image/png').split(',')[1];
    }
    return out;
  })()`);
  const bufs = SIZES.map((s) => Buffer.from(pngs[s], 'base64'));
  fs.writeFileSync(path.join(ASSETS, 'icon.png'), bufs[SIZES.indexOf(256)]);

  // ICO with PNG-compressed entries
  const head = Buffer.alloc(6 + 16 * SIZES.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(SIZES.length, 4);
  let off = head.length;
  SIZES.forEach((s, i) => {
    const e = 6 + i * 16;
    head.writeUInt8(s >= 256 ? 0 : s, e); head.writeUInt8(s >= 256 ? 0 : s, e + 1);
    head.writeUInt8(0, e + 2); head.writeUInt8(0, e + 3);
    head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(bufs[i].length, e + 8); head.writeUInt32LE(off, e + 12);
    off += bufs[i].length;
  });
  fs.writeFileSync(path.join(ASSETS, 'icon.ico'), Buffer.concat([head, ...bufs]));
  console.log('icon.png + icon.ico written');
  app.quit();
});
