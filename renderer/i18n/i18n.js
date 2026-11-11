// The language of every window (piano, MeloFi Studio, start card, instrument picker, on-screen keys).
// Korean source text is the key; see core.mjs for t / tc / tdyn and docs/i18n.md for the rules.
//
// The setting is `lang` in settings.json: 'system' (default), 'ko' or 'en'. 'system' means Korean on
// a Korean OS and English anywhere else. Changing it in one window reaches the others through the
// usual settings:changed broadcast; each window then re-renders (onLangChange).
import { createI18n, resolveLang, LANGS, josa, fill } from './core.mjs';

const I = createI18n();
// first of the listeners: the static text is swapped before the windows re-render their own parts
I.onChange(() => { if (typeof document !== 'undefined') translateDom(document, true); });
const HAS_WIN = typeof window !== 'undefined';
const HAS_DOC = typeof document !== 'undefined';

// one table per area of the app, so separate pieces of work don't collide in one file
export const EN_FILES = ['piano', 'studio', 'studio-panels', 'studio-ai', 'sound', 'main', 'instruments'];

let pref = 'system';
let loaded = null;
const sysLocale = () => (typeof navigator !== 'undefined' && (navigator.languages?.[0] || navigator.language)) || 'ko';

function loadTables() {
  if (!loaded) {
    loaded = Promise.all(EN_FILES.map((f) => fetch(new URL(`en/${f}.json`, import.meta.url)).then((r) => (r.ok ? r.json() : null)).then((o) => I.addTable(o)).catch((e) => console.warn('i18n table', f, e?.message || e))));
  }
  return loaded;
}

export const t = I.t;
// marks Korean text for translation where it is defined (a table built at import time) without
// translating it there: the place that shows it calls t(value). Returns the text unchanged.
export const N_ = (s) => s;
export const tc = I.tc;
export const tdyn = I.tdyn;
export { josa, fill, LANGS };
export const lang = () => I.lang;
export const isEn = () => I.lang === 'en';
export const langPref = () => pref;
export const missing = I.missing;
export const hasEntry = I.has;
// Intl locale for dates and numbers
export const locale = () => (I.lang === 'en' ? 'en-US' : 'ko-KR');
// re-render when the language changes; returns an unsubscribe function
export const onLangChange = (fn) => I.onChange(fn);

export async function setLangPref(p) {
  pref = LANGS.includes(p) ? p : 'system';
  const l = resolveLang(pref, sysLocale());
  if (l === 'en') await loadTables();
  if (HAS_DOC) document.documentElement.lang = l;
  I.setLang(l);
  return l;
}

// The three choices as a menu shows them. The language names stay in their own language.
export const langChoices = () => [['system', t('시스템 설정 따르기')], ['ko', '한국어'], ['en', 'English']]; // i18n-ignore (each language in its own)

// A table of Korean source strings (renderer/js/strings.js) read through t() on every access, so
// T.menu.file is '파일' or 'File' depending on the language at that moment.
export function localize(obj) {
  const cache = new WeakMap();
  const wrap = (o) => {
    let p = cache.get(o);
    if (p) return p;
    p = new Proxy(o, {
      get(target, k, r) {
        const v = Reflect.get(target, k, r);
        if (typeof v === 'string') return t(v);
        if (v && typeof v === 'object') return wrap(v);
        return v;
      },
    });
    cache.set(o, p);
    return p;
  };
  return wrap(obj);
}

// ---- static markup (the .html files, panes built once) ----
// Text nodes and the title / placeholder / aria-label attributes that hold Korean with an English
// entry are swapped; the Korean is remembered so switching back restores it. Content the user
// typed (inputs, textareas, contenteditable) and anything under [data-i18n-skip] is left alone.
const HANGUL = /[가-힣]/;
const textOrig = new WeakMap(); // Text -> { ko, en }
const attrOrig = new WeakMap(); // Element -> { [attr]: { ko, en } }
const ATTRS = ['title', 'placeholder', 'aria-label', 'data-tip', 'alt'];
function swap(str) {
  const core = str.trim();
  if (!core || !HANGUL.test(core)) return null;
  const tr = I.tdyn(core, true); // stale text about to be re-rendered is not a missing entry
  return tr === core ? null : str.replace(core, tr);
}
// switching: back to Korean also reverts English set in another language session (text that was
// built with t() before the switch and is not re-rendered), through the table read backwards
let reverse = null;
function backToKo(str) {
  const core = str.trim();
  if (!core || !/[A-Za-z]/.test(core)) return null;
  if (!reverse) { reverse = new Map(); for (const [k, v] of I.table) if (!k.includes('::') && !k.includes('{') && !reverse.has(v)) reverse.set(v, k); }
  const ko = reverse.get(core);
  return ko == null ? null : str.replace(core, ko);
}
export function translateDom(root = HAS_DOC ? document : null, switching = false) {
  if (!root || !HAS_DOC) return;
  const en = I.lang === 'en';
  if (root === document) {
    const tt = document.querySelector('title');
    if (tt) translateDom(tt, switching);
    root = document.body;
    if (!root) return;
  }
  const skip = (el) => !!el?.closest?.('[data-i18n-skip], textarea, [contenteditable="true"], script, style');
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = root; n; n = walker.nextNode()) {
    if (n.nodeType === 3) {
      const rec = textOrig.get(n);
      if (en) {
        if (rec && n.nodeValue === rec.en) continue;
        const s = swap(n.nodeValue);
        if (s != null && !skip(n.parentElement)) { textOrig.set(n, { ko: n.nodeValue, en: s }); n.nodeValue = s; }
      } else if (rec && n.nodeValue === rec.en) { n.nodeValue = rec.ko; textOrig.delete(n); } else if (switching && !rec && !skip(n.parentElement)) { const k = backToKo(n.nodeValue); if (k != null) n.nodeValue = k; }
    } else if (n.nodeType === 1) {
      let recs = attrOrig.get(n);
      for (const a of ATTRS) {
        const v = n.getAttribute(a);
        if (v == null) continue;
        const rec = recs?.[a];
        if (en) {
          if (rec && v === rec.en) continue;
          const s = swap(v);
          if (s != null && !skip(n)) { if (!recs) attrOrig.set(n, (recs = {})); recs[a] = { ko: v, en: s }; n.setAttribute(a, s); }
        } else if (rec && v === rec.en) { n.setAttribute(a, rec.ko); delete recs[a]; } else if (switching && !rec && !skip(n)) { const k = backToKo(v); if (k != null) n.setAttribute(a, k); }
      }
    }
  }
}

// ---- boot: the saved choice, before anything renders ----
// One synchronous call to main (preload: i18n:boot) gives the choice and, for English, the tables,
// so no module has to wait (a top-level await here would hold every window's scripts back).
if (HAS_WIN && window.melofi) {
  let b = null;
  try { b = window.melofi.i18nBoot?.(); } catch { /* older preload: Korean until loaded */ }
  pref = LANGS.includes(b?.pref) ? b.pref : 'system';
  if (b?.table) { I.addTable(b.table); loaded = Promise.resolve(); }
  const l = resolveLang(pref, sysLocale());
  if (HAS_DOC) document.documentElement.lang = l;
  if (l === 'en' && !b?.table) setLangPref(pref).catch((e) => console.warn('i18n', e));
  else I.setLang(l);
  // changed in another window
  window.melofi.onSettingsChanged?.((p) => { if (p && 'lang' in p) setLangPref(p.lang); });
  if (HAS_DOC && document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => translateDom(document), { once: true });
  // tests and the console
  window.__i18n = { t, tc, tdyn, lang, setLangPref, missing, translateDom, table: I.table };
}
