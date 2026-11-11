'use strict';
// The language in the main process (native dialogs, window titles, error and progress messages).
// Same rules and tables as the windows (renderer/i18n/core.mjs, docs/i18n.md): t('저장') -> 'Save'.
// The language comes from `lang` in settings.json ('system' follows app.getLocale()); main.js calls
// setPref() again whenever a window saves a new `lang`.
const fs = require('fs');
const path = require('path');

let core = null;
try { core = require('./renderer/i18n/core.mjs'); } catch (e) { console.warn('[i18n] core not loaded:', e.message); }

const I = core ? core.createI18n() : null;
let tablesLoaded = false;
const merged = {}; // every English table in one object, handed to the windows at start (boot())
function loadTables() {
  if (tablesLoaded || !I) return;
  tablesLoaded = true;
  const dir = path.join(__dirname, 'renderer', 'i18n', 'en');
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try { const o = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); Object.assign(merged, o); I.addTable(o); } catch (e) { console.warn('[i18n]', f, e.message); }
  }
}

let pref = 'system';
function locale() { try { return require('electron').app.getLocale(); } catch { return 'ko'; } }
function setPref(p) {
  pref = p === 'ko' || p === 'en' ? p : 'system';
  if (!I) return 'ko';
  const l = core.resolveLang(pref, locale());
  if (l === 'en') loadTables();
  I.setLang(l);
  return l;
}
// read the saved choice (called once the app is ready, when getLocale() is known)
function init(settingsFile) {
  let s = {};
  try { s = JSON.parse(fs.readFileSync(settingsFile, 'utf8')) || {}; } catch { /* first run */ }
  return setPref(s.lang);
}

const fill = (s, p) => (core ? core.josa(core.fill(String(s), p)) : String(s));
// what a window needs before its first paint: the choice, and the tables when it is English
function boot() {
  const l = I ? I.lang : 'ko';
  if (l === 'en') loadTables();
  return { pref, lang: l, table: l === 'en' ? merged : null };
}

module.exports = {
  init,
  boot,
  setPref,
  t: (ko, params) => (I ? I.t(ko, params) : fill(ko, params)),
  tc: (ctx, ko, params) => (I ? I.tc(ctx, ko, params) : fill(ko, params)),
  tdyn: (s) => (I ? I.tdyn(s) : String(s ?? '')),
  lang: () => (I ? I.lang : 'ko'),
  pref: () => pref,
};
