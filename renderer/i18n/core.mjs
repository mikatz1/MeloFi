// i18n-ignore-file (the particle forms below are data)
// The language core shared by every window and by the main process (i18n-main.js). No DOM, no I/O:
// it gets the English tables handed to it. The Korean source text is the key (docs/i18n.md):
//   t('저장')                         -> '저장' or 'Save'
//   t('{n}개 채널', { n })             -> '3개 채널' or '3 channels' (en: '{n} {n|channel|channels}')
//   t('"{name}"을(를) 열었습니다.', …)   -> Korean particles follow the word in front: "피아노"를 / "기타"를
//   tc('touch', '보통')                -> the same Korean word meaning different things: key 'touch::보통'
//   tdyn(text)                        -> text made elsewhere (main process, Python): exact entry first,
//                                        then the entries with {placeholders} as patterns

// ---- Korean particles: 을(를), 이(가), 은(는), 과(와), (으)로, (이)라 pick the right form ----
// The final consonant (받침) of the word in front decides. Quotes and brackets right before the
// particle are skipped ("피아노"를). Digits and Latin letters are read the Korean way (1 일 -> 을,
// 2 이 -> 를; "…l/m/n" end in a consonant).
const DIGIT_JONG = { 0: 21, 1: 8, 2: 0, 3: 16, 4: 0, 5: 0, 6: 1, 7: 8, 8: 8, 9: 0 }; // 영 일 이 삼 사 오 육 칠 팔 구
const EN_DIGIT_JONG = { 0: 0, 1: 4, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 4, 8: 19, 9: 4 }; // 제로 원 투 쓰리 포 파이브 식스 세븐 에잇 나인
function jongOf(ch) {
  const c = ch.charCodeAt(0);
  if (c >= 0xac00 && c <= 0xd7a3) return (c - 0xac00) % 28; // 0: no final consonant, 8: ㄹ
  if (ch >= '0' && ch <= '9') return DIGIT_JONG[ch];
  const l = ch.toLowerCase();
  if (l === 'l') return 8;
  if (l === 'm' || l === 'n') return 4;
  return 0;
}
const PARTICLES = [
  // [written form, after a final consonant, after none, ㄹ counts as none]
  ['을(를)', '을', '를'], ['를(을)', '을', '를'],
  ['이(가)', '이', '가'], ['가(이)', '이', '가'],
  ['은(는)', '은', '는'], ['는(은)', '은', '는'],
  ['과(와)', '과', '와'], ['와(과)', '과', '와'],
  ['(으)로', '으로', '로', true], ['으로(로)', '으로', '로', true],
  ['(이)라', '이라', '라'], ['이(라)', '이라', '라'],
];
const PARTICLE_RE = new RegExp(`([^\\s"'“”‘’「」『』()\\[\\]])([\"'”’」』)\\]]*)(${PARTICLES.map(([w]) => w.replace(/[()]/g, '\\$&')).join('|')})`, 'g');
export function josa(s) {
  if (!s || s.indexOf('(') < 0) return s;
  return s.replace(PARTICLE_RE, (_m, ch, close, form, at, all) => {
    const p = PARTICLES.find(([w]) => w === form);
    // a digit after Latin letters is read in English: MP3 (쓰리) -> MP3로, F1 (원) -> F1을
    const j = ch >= '0' && ch <= '9' && /[A-Za-z]/.test(all[at - 1] || '') ? EN_DIGIT_JONG[ch] : jongOf(ch);
    const hard = p[3] ? j !== 0 && j !== 8 : j !== 0;
    return ch + close + (hard ? p[1] : p[2]);
  });
}

// ---- placeholders: {name}; English plurals: {n|one|other} ----
const PH_RE = /\{(\w+)(?:\|([^|{}]*)\|([^|{}]*))?\}/g;
export function fill(s, params) {
  if (!params || s.indexOf('{') < 0) return s;
  return s.replace(PH_RE, (m, k, one, other) => {
    if (!(k in params)) return m;
    const v = params[k];
    if (one !== undefined) return Number(v) === 1 ? one : other;
    return v == null ? '' : String(v);
  });
}
export const placeholders = (s) => [...new Set([...String(s).matchAll(PH_RE)].filter((m) => m[2] === undefined).map((m) => m[1]))].sort();

// ---- the language itself ----
// pref: 'ko' | 'en' | 'system'; system: Korean when the OS / app locale is Korean, English otherwise
export const LANGS = ['system', 'ko', 'en'];
export const resolveLang = (pref, locale) => (pref === 'ko' || pref === 'en' ? pref : /^ko\b/i.test(String(locale || '')) ? 'ko' : 'en');

export function createI18n() {
  let lang = 'ko';
  const en = new Map();       // Korean text -> English
  let patterns = null;        // [regex, english, names] for tdyn, built on first use
  const missing = new Set();  // keys asked for in English without an entry (shown in tests)
  const listeners = new Set();

  function addTable(obj) {
    for (const [k, v] of Object.entries(obj || {})) if (k && typeof v === 'string' && !k.startsWith('//')) en.set(k, v);
    patterns = null;
  }
  function look(key, ko) {
    if (lang === 'ko') return null;
    const v = en.get(key);
    if (v != null) return v;
    if (key !== ko) { const w = en.get(ko); if (w != null) return w; }
    if (/[가-힣]/.test(key)) missing.add(key);
    return null;
  }
  function t(ko, params) {
    if (ko == null) return '';
    ko = String(ko);
    const v = look(ko, ko);
    return v != null ? fill(v, params) : josa(fill(ko, params));
  }
  function tc(ctx, ko, params) {
    ko = String(ko);
    const v = look(`${ctx}::${ko}`, ko);
    return v != null ? fill(v, params) : josa(fill(ko, params));
  }
  // a string that was made somewhere else in Korean (main process, Python, a saved message)
  function tdyn(s, quiet = false) {
    if (s == null || lang === 'ko') return s == null ? '' : String(s);
    s = String(s);
    const exact = en.get(s);
    if (exact != null) return exact;
    if (!/[가-힣]/.test(s)) return s;
    if (!patterns) {
      patterns = [];
      for (const [k, v] of en) {
        if (k.indexOf('{') < 0 || k.includes('::')) continue;
        const names = [];
        const src = k.replace(/[.*+?^$()[\]\\|]/g, '\\$&').replace(/\{(\w+)(?:\|[^{}]*)?\}/g, (_m, a) => { names.push(a); return '(.+?)'; });
        // the particle notations accept either form: 을(를) matches 을 or 를
        // (or still written out, when the sender did not resolve it)
        const src2 = src.replace(/을\\\(를\\\)|를\\\(을\\\)/g, '(?:을\\(를\\)|을|를)').replace(/이\\\(가\\\)|가\\\(이\\\)/g, '(?:이\\(가\\)|이|가)').replace(/은\\\(는\\\)|는\\\(은\\\)/g, '(?:은\\(는\\)|은|는)').replace(/과\\\(와\\\)|와\\\(과\\\)/g, '(?:과\\(와\\)|과|와)').replace(/\\\(으\\\)로/g, '(?:\\(으\\)로|으로|로)');
        try { patterns.push([new RegExp(`^${src2}$`), v, names]); } catch { /* not a usable pattern */ }
      }
      patterns.sort((a, b) => b[0].source.length - a[0].source.length);
    }
    for (const [re, v, names] of patterns) {
      const m = re.exec(s);
      if (m) {
        const p = {};
        names.forEach((n, i) => { p[n] = m[i + 1]; });
        // a value that is itself Korean text with an entry is translated too (stage names etc.)
        for (const n of names) { const x = en.get(p[n]); if (x != null) p[n] = x; }
        return fill(v, p);
      }
    }
    if (!quiet) missing.add(s);
    return s;
  }
  return {
    t, tc, tdyn, addTable,
    has: (k) => en.has(k),
    get lang() { return lang; },
    setLang(l) {
      const nl = l === 'en' ? 'en' : 'ko';
      if (nl === lang) return false;
      lang = nl;
      for (const fn of listeners) { try { fn(lang); } catch (e) { console.error(e); } }
      return true;
    },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    missing,
    table: en,
  };
}
