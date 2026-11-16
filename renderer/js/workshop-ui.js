// 창작마당: share what you made in the piano window or MeloFi Studio, and hear what others made.
// One page over the window, the same in both (host.where tells which). docs/workshop.md has the design
// and where each layout pattern comes from. All network calls go through the main process (workshop.js).
//   둘러보기   kind tabs and one sort control over a dense list (Splice), genre and tag counts in a
//              rail (BOOTH category counts), result count above (Steam), numbered pages
//   작품       a hero with cover, title and a waveform you click to seek (SoundCloud); below, the
//              description and comments on the left, a 260 px rail with the actions, the file list
//              with sizes and an info table on the right (Steam item page, itch.io); 신고 a quiet link
//   내 작품    one table with the numbers per work (Image-Line forum's topic table)
//   올리기     title, files, description, genre, tags, cover, visibility, in itch.io's upload order
import { t, tdyn, locale, onLangChange } from '../i18n/i18n.js';
import { el, icon, holdKeys, openAccountCenter } from './accounts-ui.js';
import { openFirstRun, appHost, setupProgress } from './firstrun.js';

const W = async (op, payload) => {
  try { return await window.melofi.workshop(op, payload); } catch (e) { return { ok: false, error: 'ipc', message: String(e?.message || e) }; }
};
const ACC = (op, payload) => window.melofi.account(op, payload);
const imp = (p) => import(new URL(p, import.meta.url).href);

export const GENRES = () => [
  ['piano', t('피아노 솔로')], ['classical', t('클래식')], ['pop', t('팝')], ['ballad', t('발라드')], ['jazz', t('재즈')],
  ['lofi', t('로파이')], ['electronic', t('일렉트로닉')], ['hiphop', t('힙합')], ['rock', t('록')], ['game', t('게임·애니')],
  ['film', t('영화·드라마')], ['practice', t('연습·커버')], ['etc', t('기타')],
];
const genreName = (g) => (GENRES().find(([k]) => k === g) || [, t('기타')])[1];
const KINDS = () => [['', t('전체')], ['audio', t('오디오')], ['midi', 'MIDI'], ['project', t('Studio 프로젝트')]];
const kindName = (k) => ({ audio: t('오디오'), midi: 'MIDI', project: t('Studio 프로젝트') })[k] || k;
const SORTS = () => [['new', t('최신순')], ['popular:week', t('인기순 · 이번 주')], ['popular:month', t('인기순 · 이번 달')], ['popular:', t('인기순 · 전체')], ['liked', t('좋아요순')]];
const REASONS = () => [['spam', t('스팸·광고')], ['copyright', t('저작권 침해')], ['offensive', t('불쾌한 내용')], ['personal', t('개인정보 노출')], ['broken', t('파일이 열리지 않음')], ['other', t('기타')]];

const fmtTime = (s) => (s == null || !isFinite(s) ? '' : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`);
const fmtDate = (sec) => (sec ? new Date(sec * 1000).toLocaleDateString(locale(), { year: 'numeric', month: '2-digit', day: '2-digit' }) : '');
const fmtAgo = (sec) => {
  const d = (Date.now() / 1000 - sec) / 86400;
  if (d < 1 / 24) return t('방금');
  if (d < 1) return t('{n}시간 전', { n: Math.floor(d * 24) });
  if (d < 7) return t('{n}일 전', { n: Math.floor(d) });
  return fmtDate(sec);
};
const fmtSize = (n) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
const fileLabel = (f) => f.label || ({ audio: t('오디오'), midi: 'MIDI', project: t('Studio 프로젝트') })[f.role];
const fileExt = (f) => (f.role === 'project' ? 'mfproj' : f.role === 'midi' ? 'mid' : (f.name.match(/^audio\.(\w+)\.b64$/) || [, 'mp3'])[1]);
const SVG = {
  play: '<svg viewBox="0 0 16 16"><path d="M5 3.2v9.6L12.6 8z"/></svg>',
  pause: '<svg viewBox="0 0 16 16"><path d="M4.5 3h2.6v10H4.5zM8.9 3h2.6v10H8.9z"/></svg>',
  heart: '<svg viewBox="0 0 16 16" class="ln"><path d="M8 13.4S2.2 9.9 2.2 6a2.9 2.9 0 0 1 5.8-.9A2.9 2.9 0 0 1 13.8 6c0 3.9-5.8 7.4-5.8 7.4z"/></svg>',
  mark: '<svg viewBox="56 48 144 168"><rect x="74" y="88" width="26" height="104" rx="13"/><rect x="115" y="56" width="26" height="136" rx="13"/><rect x="156" y="110" width="26" height="82" rx="13"/></svg>',
};
const svg = (k, cls = 'mfw-svg') => { const s = el('span', { class: cls }); s.innerHTML = SVG[k]; return s; };

const CSS = `
.mfw { --w-line: var(--line, #24252b); --w-line-2: var(--line-2, #30323a); --w-dim: var(--dim, #8b8983); --w-faint: var(--dim, #8b8983);
  position: fixed; inset: var(--bar-h, 32px) 0 0 0; z-index: 36; display: grid; grid-template-rows: 40px 1fr auto; background: var(--panel, #131418);
  color: var(--text, #d8d5ce); font: 12.5px/1.45 var(--ui, sans-serif); user-select: none; }
body.fs .mfw { top: 0; }
.mfw button { font: inherit; color: inherit; }
.mfw-svg { display: inline-flex; width: 14px; height: 14px; }
.mfw-svg svg { width: 100%; height: 100%; fill: currentColor; }
.mfw-svg svg.ln { fill: none; stroke: currentColor; stroke-width: 1.3; }
.mfw-head { display: flex; align-items: stretch; gap: 0; padding: 0 8px 0 14px; border-bottom: 1px solid var(--w-line); background: var(--panel-2, #191a1f); }
.mfw-head h2 { display: flex; align-items: center; margin: 0 18px 0 0; font-size: 13px; font-weight: 600; color: var(--s-head, #ece9e2); white-space: nowrap; }
.mfw-tabs { display: flex; }
.mfw-tabs button { padding: 0 12px; background: none; border: 0; border-bottom: 2px solid transparent; color: var(--w-dim); }
.mfw-tabs button:hover { color: var(--text, #d8d5ce); }
.mfw-tabs button.on { color: var(--s-head, #ece9e2); border-bottom-color: var(--accent, #e0a440); }
.mfw-head .sp { flex: 1; }
.mfw-head .tools { display: flex; align-items: center; gap: 6px; }
.mfw-in { height: 26px; padding: 0 8px; background: var(--s-input, #0f1014); border: 1px solid var(--w-line-2); border-radius: 2px; color: var(--text, #d8d5ce); outline: none; user-select: text; min-width: 0; }
.mfw-in:focus { border-color: var(--accent, #e0a440); }
.mfw-in.search { width: 240px; }
textarea.mfw-in { height: auto; padding: 6px 8px; resize: vertical; line-height: 1.5; font: inherit; }
select.mfw-in { padding-right: 22px; }
.mfw-b { height: 26px; padding: 0 12px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; white-space: nowrap;
  background: var(--s-ctl, #0f1013); border: 1px solid var(--w-line-2); border-radius: 2px; }
.mfw-b:hover:not(:disabled) { border-color: var(--s-ctl-hover-line, #43454e); }
.mfw-b:focus-visible, .mfw-tabs button:focus-visible, .mfw-row:focus-visible { outline: 1px solid var(--accent, #e0a440); outline-offset: -1px; }
.mfw-b.pri { background: var(--accent, #e0a440); border-color: var(--accent, #e0a440); color: #111; font-weight: 600; }
.mfw-b.wide { width: 100%; }
.mfw-b:disabled { opacity: .5; }
.mfw-b.on { color: var(--accent-ink, #e0a440); border-color: var(--accent, #e0a440); }
.mfw-link { padding: 0; background: none; border: 0; color: var(--w-dim); text-decoration: underline; text-underline-offset: 2px; }
.mfw-link:hover { color: var(--text, #d8d5ce); }
.mfw-who { display: inline-flex; align-items: center; gap: 7px; height: 26px; padding: 0 10px 0 4px; background: none; border: 1px solid var(--w-line-2); border-radius: 13px; }
.mfw-who i { display: grid; place-items: center; width: 18px; height: 18px; border-radius: 50%; background: var(--s-raised, #22232a); color: var(--w-dim); font-style: normal; font-weight: 700; font-size: 10px; }
.mfw-who.in i { background: var(--accent, #e0a440); color: #1b1308; }
.mfw-x { width: 26px; height: 26px; margin-left: 4px; }
.mfw-body { min-height: 0; overflow: auto; }
.mfw-body::-webkit-scrollbar { width: 10px; } .mfw-body::-webkit-scrollbar-thumb { background: var(--s-scroll, #2a2b31); border: 2px solid var(--panel, #131418); border-radius: 5px; }
.mfw-msg { padding: 48px 20px; text-align: center; color: var(--w-dim); }
.mfw-msg b { display: block; margin-bottom: 4px; color: var(--text, #d8d5ce); font-weight: 600; }
.mfw-msg .mfw-b { margin-top: 12px; }
.mfw-note { margin: 0; min-height: 18px; color: var(--w-dim); font-size: 12px; }
.mfw-note.err { color: var(--err, #e5786c); }

/* browse */
.mfw-browse { display: grid; grid-template-columns: 208px 1fr; min-height: 100%; }
.mfw-rail { border-right: 1px solid var(--w-line); padding: 12px 0 20px; background: var(--panel-2, #191a1f); }
.mfw-rail h4 { margin: 10px 14px 4px; font-size: 11px; font-weight: 600; color: var(--w-dim); }
.mfw-rail h4:first-child { margin-top: 0; }
.mfw-rail button { display: flex; width: 100%; justify-content: space-between; gap: 8px; padding: 3px 14px; background: none; border: 0; text-align: left; color: var(--text, #d8d5ce); }
.mfw-rail button span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mfw-rail button small { color: var(--w-dim); font-variant-numeric: tabular-nums; }
.mfw-rail button:hover { background: var(--s-row-hover, #1b1c22); }
.mfw-rail button.on { color: var(--accent-ink, #e0a440); }
.mfw-rail .none { padding: 3px 14px; color: var(--w-faint); }
.mfw-main { min-width: 0; padding: 0 18px 20px; }
.mfw-bar { position: sticky; top: 0; z-index: 2; display: flex; align-items: center; gap: 10px; height: 44px; background: var(--panel, #131418); border-bottom: 1px solid var(--w-line); }
.mfw-seg { display: inline-flex; }
.mfw-seg button { height: 26px; padding: 0 10px; margin-left: -1px; background: var(--s-ctl, #0f1013); border: 1px solid var(--w-line-2); color: var(--w-dim); white-space: nowrap; }
.mfw-seg button:first-child { margin-left: 0; border-radius: 2px 0 0 2px; } .mfw-seg button:last-child { border-radius: 0 2px 2px 0; }
.mfw-seg button.on { position: relative; z-index: 1; background: var(--text, #d8d5ce); border-color: var(--text, #d8d5ce); color: var(--s-on-text, #0b0b0b); }
.mfw-bar .count { margin-left: auto; color: var(--w-dim); font-variant-numeric: tabular-nums; white-space: nowrap; }
.mfw-bar select { width: auto; }
.mfw-filters { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 8px 0 0; }
.mfw-chip { display: inline-flex; align-items: center; gap: 4px; height: 22px; padding: 0 4px 0 8px; border: 1px solid var(--w-line-2); border-radius: 11px; background: none; color: var(--text, #d8d5ce); font-size: 11.5px; }
.mfw-chip b { font-weight: 400; color: var(--w-dim); }
.mfw-chip .rm { width: 16px; height: 16px; display: grid; place-items: center; color: var(--w-dim); }
.mfw-list { margin-top: 6px; }
.mfw-lh, .mfw-row { display: grid; grid-template-columns: 44px minmax(0, 1fr) 64px 56px 64px 92px; align-items: center; column-gap: 12px; }
.mfw-lh { height: 28px; color: var(--w-dim); font-size: 11px; border-bottom: 1px solid var(--w-line); }
.mfw-lh .r, .mfw-row .r { text-align: right; font-variant-numeric: tabular-nums; }
.mfw-row { min-height: 56px; padding: 6px 0; border-bottom: 1px solid var(--s-row-line, #1b1c21); cursor: default; }
.mfw-row:hover { background: var(--s-row-hover, #1b1c22); }
.mfw-row .r { color: var(--w-dim); }
.mfw-row .t { min-width: 0; }
.mfw-row .t b { display: block; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mfw-row .t small { display: block; color: var(--w-dim); font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mfw-row .t small .tg { color: var(--w-faint); margin-left: 6px; }
.mfw-row .lk { display: inline-flex; align-items: center; justify-content: flex-end; gap: 4px; }
.mfw-art { position: relative; width: 44px; height: 44px; border-radius: 2px; overflow: hidden; background: var(--s-raised, #22232a); }
.mfw-art img { width: 100%; height: 100%; object-fit: cover; display: block; }
.mfw-art .ph { position: absolute; inset: 0; display: grid; place-items: center; color: var(--w-faint); }
.mfw-art .ph .mfw-svg { width: 45%; height: 45%; }
.mfw-art .pl { position: absolute; inset: 0; display: grid; place-items: center; background: rgba(0,0,0,.45); border: 0; color: #fff; opacity: 0; }
.mfw-row:hover .mfw-art .pl, .mfw-art .pl.on, .mfw-art .pl:focus-visible { opacity: 1; }
.mfw-art .pl:disabled { display: none; }
.mfw-pages { display: flex; align-items: center; justify-content: center; gap: 4px; padding: 16px 0 0; }
.mfw-pages button { min-width: 28px; height: 26px; padding: 0 6px; background: none; border: 1px solid transparent; border-radius: 2px; color: var(--w-dim); font-variant-numeric: tabular-nums; }
.mfw-pages button.on { border-color: var(--w-line-2); color: var(--text, #d8d5ce); }
.mfw-pages button:hover:not(:disabled) { color: var(--text, #d8d5ce); }

/* one work */
.mfw-item { max-width: 1120px; margin: 0 auto; padding: 12px 20px 28px; }
.mfw-back { margin-bottom: 10px; }
.mfw-hero { display: grid; grid-template-columns: 148px 1fr; gap: 18px; padding-bottom: 16px; border-bottom: 1px solid var(--w-line); }
.mfw-hero .mfw-art { width: 148px; height: 148px; }
.mfw-hero .mfw-art .ph .mfw-svg { width: 34%; height: 34%; }
.mfw-hero h1 { margin: 2px 0 2px; font-size: 18px; font-weight: 600; color: var(--s-head, #ece9e2); user-select: text; }
.mfw-hero .by { color: var(--w-dim); }
.mfw-hero .by button { padding: 0; background: none; border: 0; color: var(--text, #d8d5ce); }
.mfw-hero .by button:hover { text-decoration: underline; }
.mfw-badge { display: inline-block; margin-left: 8px; padding: 0 6px; border: 1px solid var(--w-line-2); border-radius: 2px; font-size: 11px; line-height: 17px; color: var(--w-dim); vertical-align: 1px; }
.mfw-badge.warn { border-color: var(--err, #e5786c); color: var(--err, #e5786c); }
.mfw-wave { display: grid; grid-template-columns: 36px 1fr auto; align-items: center; gap: 10px; margin-top: 18px; }
.mfw-wave .big { width: 36px; height: 36px; border-radius: 50%; border: 0; background: var(--accent, #e0a440); color: #111; display: grid; place-items: center; }
.mfw-wave .big:disabled { background: var(--s-raised, #22232a); color: var(--w-faint); }
.mfw-wave canvas { width: 100%; height: 56px; display: block; }
.mfw-wave .tm { font: 11.5px var(--mono, monospace); color: var(--w-dim); min-width: 84px; text-align: right; }
.mfw-wave .none { color: var(--w-faint); font-size: 12px; }
.mfw-cols { display: grid; grid-template-columns: minmax(0, 1fr) 260px; gap: 28px; padding-top: 16px; }
.mfw-desc { white-space: pre-wrap; line-height: 1.65; color: var(--s-body, #c9c6bf); user-select: text; margin: 0 0 12px; }
.mfw-desc.empty { color: var(--w-faint); }
.mfw-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 20px; }
.mfw-h3 { display: flex; align-items: baseline; gap: 8px; margin: 0 0 8px; padding-top: 12px; border-top: 1px solid var(--w-line); font-size: 12.5px; font-weight: 600; }
.mfw-h3 small { color: var(--w-dim); font-weight: 400; }
.mfw-cform { display: grid; grid-template-columns: 1fr auto; gap: 8px; align-items: end; margin-bottom: 10px; }
.mfw-cform textarea { height: 54px; }
.mfw-c { padding: 9px 0; border-bottom: 1px solid var(--s-row-line, #1b1c21); }
.mfw-c .hd { display: flex; align-items: baseline; gap: 8px; }
.mfw-c .hd b { font-weight: 600; }
.mfw-c .hd small { color: var(--w-faint); }
.mfw-c .hd .mfw-link { margin-left: auto; font-size: 11.5px; }
.mfw-c p { margin: 2px 0 0; white-space: pre-wrap; user-select: text; color: var(--s-body, #c9c6bf); }
.mfw-side { display: grid; gap: 8px; align-content: start; }
.mfw-like { display: flex; gap: 8px; }
.mfw-like .mfw-b { flex: 1; }
.mfw-files { border: 1px solid var(--w-line); border-radius: 2px; }
.mfw-files div { display: grid; grid-template-columns: 1fr auto auto; align-items: center; gap: 8px; padding: 6px 6px 6px 10px; }
.mfw-files div + div { border-top: 1px solid var(--s-row-line, #1b1c21); }
.mfw-files small { color: var(--w-faint); font-variant-numeric: tabular-nums; }
.mfw-files .mfw-b { height: 22px; padding: 0 8px; font-size: 11.5px; }
.mfw-info { width: 100%; border-collapse: collapse; margin-top: 4px; }
.mfw-info th { width: 84px; padding: 4px 0; text-align: left; vertical-align: top; color: var(--w-dim); font-weight: 400; }
.mfw-info td { padding: 4px 0; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.mfw-info td button { padding: 0; background: none; border: 0; color: var(--text, #d8d5ce); text-align: left; }
.mfw-info td button:hover { text-decoration: underline; }
.mfw-quiet { display: flex; flex-wrap: wrap; gap: 4px 14px; padding-top: 8px; border-top: 1px solid var(--w-line); font-size: 11.5px; }

/* mine */
.mfw-mine { max-width: 1120px; margin: 0 auto; padding: 14px 20px 28px; }
.mfw-mine .top { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.mfw-mine .top p { margin: 0; color: var(--w-dim); flex: 1; }
.mfw-tbl { width: 100%; border-collapse: collapse; }
.mfw-tbl th { height: 28px; text-align: left; font-weight: 400; color: var(--w-dim); font-size: 11px; border-bottom: 1px solid var(--w-line); padding: 0 10px 0 0; }
.mfw-tbl td { height: 44px; border-bottom: 1px solid var(--s-row-line, #1b1c21); padding: 0 10px 0 0; font-variant-numeric: tabular-nums; }
.mfw-tbl td.n, .mfw-tbl th.n { text-align: right; width: 64px; }
.mfw-tbl td.t b { font-weight: 600; }
.mfw-tbl td.a { text-align: right; white-space: nowrap; width: 1%; }
.mfw-tbl td.a .mfw-b { height: 22px; padding: 0 8px; font-size: 11.5px; margin-left: 4px; }
.mfw-tbl tr:hover td { background: var(--s-row-hover, #1b1c22); }

/* upload */
.mfw-up { max-width: 920px; margin: 0 auto; padding: 16px 20px 28px; display: grid; grid-template-columns: minmax(0, 1fr) 200px; gap: 28px; }
.mfw-up h3 { grid-column: 1 / -1; margin: 0; font-size: 14px; font-weight: 600; color: var(--s-head, #ece9e2); }
.mfw-f { display: grid; grid-template-columns: 100px minmax(0, 1fr); align-items: start; gap: 6px 14px; padding: 8px 0; }
.mfw-f + .mfw-f { border-top: 1px solid var(--s-row-line, #1b1c21); }
.mfw-f > label { padding-top: 5px; color: var(--w-dim); }
.mfw-f .hint { grid-column: 2; margin-top: -2px; color: var(--w-faint); font-size: 11.5px; }
.mfw-src { display: grid; gap: 0; border: 1px solid var(--w-line); border-radius: 2px; max-height: 196px; overflow: auto; }
.mfw-src label { display: grid; grid-template-columns: 16px 1fr auto auto; align-items: center; gap: 8px; padding: 6px 10px; }
.mfw-src label + label { border-top: 1px solid var(--s-row-line, #1b1c21); }
.mfw-src label small { color: var(--w-faint); font-variant-numeric: tabular-nums; }
.mfw-src label:hover { background: var(--s-row-hover, #1b1c22); }
.mfw-src .grp { padding: 6px 10px 2px; color: var(--w-faint); font-size: 11px; }
.mfw-picked { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; align-items: center; }
.mfw-radio { display: grid; gap: 6px; }
.mfw-radio label { display: grid; grid-template-columns: 16px 1fr; gap: 2px 8px; align-items: start; }
.mfw-radio label small { grid-column: 2; color: var(--w-faint); font-size: 11.5px; }
.mfw-chk { display: flex; align-items: flex-start; gap: 8px; }
.mfw-tagin { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; min-height: 26px; padding: 2px 4px; background: var(--s-input, #0f1014); border: 1px solid var(--w-line-2); border-radius: 2px; }
.mfw-tagin:focus-within { border-color: var(--accent, #e0a440); }
.mfw-tagin input { flex: 1; min-width: 90px; height: 20px; border: 0; background: none; outline: none; color: inherit; user-select: text; }
.mfw-cover { display: grid; gap: 8px; align-content: start; }
.mfw-cover .mfw-art { width: 200px; height: 200px; }
.mfw-cover .mfw-art .ph .mfw-svg { width: 30%; height: 30%; }
.mfw-cover .row { display: flex; gap: 6px; }
.mfw-cover .row .mfw-b { flex: 1; }
.mfw-cover small { color: var(--w-faint); font-size: 11.5px; }
.mfw-go { display: flex; align-items: center; gap: 8px; padding-top: 12px; border-top: 1px solid var(--w-line); }
.mfw-go .mfw-note { flex: 1; }

/* the player along the bottom */
.mfw-player { display: grid; grid-template-columns: 30px 32px minmax(120px, 260px) 1fr auto 26px; align-items: center; gap: 10px; height: 48px; padding: 0 10px 0 14px; border-top: 1px solid var(--w-line); background: var(--panel-2, #191a1f); }
.mfw-player .pp { width: 30px; height: 30px; border-radius: 50%; border: 0; display: grid; place-items: center; background: var(--text, #d8d5ce); color: var(--s-on-text, #0b0b0b); }
.mfw-player .mfw-art { width: 32px; height: 32px; }
.mfw-player .nm { min-width: 0; }
.mfw-player .nm b { display: block; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mfw-player .nm small { display: block; color: var(--w-dim); font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mfw-player .bar { height: 18px; position: relative; }
.mfw-player .bar::before { content: ""; position: absolute; left: 0; right: 0; top: 8px; height: 2px; background: var(--w-line-2); }
.mfw-player .bar i { position: absolute; left: 0; top: 8px; height: 2px; background: var(--accent, #e0a440); }
.mfw-player .tm { font: 11.5px var(--mono, monospace); color: var(--w-dim); }

/* small dialogs (report, open by link) */
.mfw-dlg { position: fixed; inset: 0; z-index: 40; display: grid; place-items: center; background: var(--s-scrim, rgba(4,4,6,.62)); }
.mfw-dlg .box { width: min(440px, calc(100vw - 32px)); display: grid; gap: 10px; padding: 14px 16px; background: var(--panel, #131418); border: 1px solid var(--w-line-2, #30323a); border-radius: 3px; box-shadow: 0 12px 40px var(--s-shadow, #000a); }
.mfw-dlg h3 { margin: 0; font-size: 13px; font-weight: 600; color: var(--s-head, #ece9e2); }
.mfw-dlg p { margin: 0; color: var(--w-dim, #8b8983); }
.mfw-dlg .row { display: flex; justify-content: flex-end; gap: 6px; }
.mfw-dlg .mfw-radio { grid-template-columns: 1fr 1fr; }
`;

let styled = false;
function style() { if (styled) return; styled = true; document.head.append(el('style', {}, CSS)); }

// ---------- covers: loaded once per work, kept as data URLs ----------
const covers = new Map();
function art(item, { play = null, size = '' } = {}) {
  const box = el('div', { class: `mfw-art ${size}` });
  const ph = el('div', { class: 'ph' }, svg('mark'));
  box.append(ph);
  if (item?.cover && item.owner?.login) {
    const key = `${item.id}:${item.updated}`;
    const put = (url) => { if (url) { ph.remove(); box.prepend(el('img', { src: url, alt: '' })); } };
    if (covers.has(key)) put(covers.get(key));
    else W('cover', { login: item.owner.login, id: item.id, name: item.cover }).then((r) => { covers.set(key, r.ok ? r.data : null); if (r.ok) put(r.data); });
  } else if (item?.coverUrl) { ph.remove(); box.prepend(el('img', { src: item.coverUrl, alt: '' })); }
  if (play) box.append(play);
  return box;
}

// ---------- audio: decode for the waveform, play with an <audio> ----------
async function decodePeaks(bytes, bins = 720) {
  const ctx = new OfflineAudioContext(1, 1, 44100);
  const buf = await ctx.decodeAudioData(bytes.slice().buffer);
  const ch = [...Array(buf.numberOfChannels)].map((_, i) => buf.getChannelData(i));
  const per = Math.max(1, Math.floor(buf.length / bins));
  const peaks = new Float32Array(bins);
  for (let b = 0; b < bins; b++) {
    let m = 0;
    const s0 = b * per, s1 = Math.min(buf.length, s0 + per);
    for (const d of ch) for (let s = s0; s < s1; s += 4) { const v = Math.abs(d[s]); if (v > m) m = v; }
    peaks[b] = m;
  }
  return { peaks, duration: buf.duration, buffer: buf };
}

class Player {
  constructor(page) {
    this.page = page;
    this.audio = new Audio();
    this.item = null;
    this.data = new Map(); // item id -> { url, peaks, duration }
    this.el = el('div', { class: 'mfw-player', hidden: true });
    this.audio.addEventListener('timeupdate', () => this.tick());
    this.audio.addEventListener('play', () => this.paint());
    this.audio.addEventListener('pause', () => this.paint());
    this.audio.addEventListener('ended', () => this.paint());
  }
  audioFile(item) { return (item.files || []).find((f) => f.role === 'audio'); }
  async load(item) {
    if (this.data.has(item.id)) return this.data.get(item.id);
    const f = this.audioFile(item);
    if (!f) return null;
    const r = await W('file', { login: item.owner.login, id: item.id, name: f.name });
    if (!r.ok) throw new Error(r.message);
    const bytes = r.data;
    const url = URL.createObjectURL(new Blob([bytes], { type: f.type || 'audio/mpeg' }));
    let wave = null;
    try { wave = await decodePeaks(bytes); } catch { wave = null; }
    const d = { url, peaks: wave?.peaks || null, duration: wave?.duration || item.length || 0 };
    this.data.set(item.id, d);
    return d;
  }
  playing(item) { return this.item?.id === item?.id && !this.audio.paused; }
  async toggle(item) {
    if (this.item?.id === item.id) { if (this.audio.paused) this.audio.play(); else this.audio.pause(); return; }
    this.audio.pause();
    this.item = item;
    this.el.hidden = false;
    this.paint(t('불러오는 중…'));
    try {
      const d = await this.load(item);
      if (this.item?.id !== item.id) return;
      this.audio.src = d.url;
      await this.audio.play();
      if (!item.unlisted) W('count', { id: item.id, what: 'play' });
    } catch (e) { this.paint(tdyn(e.message)); }
  }
  seek(item, frac) {
    if (this.item?.id !== item.id) return this.toggle(item).then(() => { if (this.audio.duration) this.audio.currentTime = frac * this.audio.duration; });
    if (this.audio.duration) this.audio.currentTime = frac * this.audio.duration;
  }
  stop() { this.audio.pause(); this.audio.removeAttribute('src'); this.item = null; this.el.hidden = true; }
  tick() {
    const p = this.audio.duration ? this.audio.currentTime / this.audio.duration : 0;
    const i = this.el.querySelector('.bar i'); if (i) i.style.width = `${p * 100}%`;
    const tm = this.el.querySelector('.tm'); if (tm) tm.textContent = `${fmtTime(this.audio.currentTime)} / ${fmtTime(this.audio.duration)}`;
    this.page.onTime?.(this.item, p);
  }
  paint(note = '') {
    const it = this.item;
    if (!it) return;
    const bar = el('div', { class: 'bar', onpointerdown: (e) => { const r = bar.getBoundingClientRect(); this.seek(it, Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))); } }, el('i'));
    this.el.replaceChildren(
      el('button', { class: 'pp', type: 'button', 'aria-label': this.audio.paused ? t('재생') : t('일시 정지'), onclick: () => this.toggle(it) }, svg(this.audio.paused ? 'play' : 'pause')),
      art(it),
      el('div', { class: 'nm' }, el('b', {}, it.title), el('small', {}, note || it.owner?.name || it.owner?.login || '')),
      bar,
      el('span', { class: 'tm' }, ''),
      el('button', { class: 'x', type: 'button', 'aria-label': t('닫기'), onclick: () => this.stop() }));
    this.tick();
    this.page.onPlayState?.();
  }
}

// ---------- the page ----------
let page = null;

// host: { where: 'piano'|'studio', app } (app = the App; app.studio is the studio when where === 'studio')
export function openWorkshop(host, view = 'browse', arg = null) {
  style();
  if (!page) page = new Workshop(host);
  page.host = host;
  page.open(view, arg);
  return page;
}
export const workshopPage = () => page;

class Workshop {
  constructor(host) {
    this.host = host;
    this.q = { sort: 'new', kind: '', genre: '', tag: '', owner: '', q: '', page: 0 };
    this.view = 'browse';
    this.player = new Player(this);
    this.tabs = el('div', { class: 'mfw-tabs', role: 'tablist' });
    this.search = el('input', { class: 'mfw-in search', type: 'search', placeholder: t('제목, 태그, 작성자 검색') });
    this.search.addEventListener('keydown', (e) => { if (e.key === 'Enter') { this.q = { ...this.q, q: this.search.value.trim(), page: 0 }; this.go('browse'); } });
    this.whoBtn = el('button', { class: 'mfw-who', type: 'button', onclick: () => openAccountCenter({ openWorkshop: (w) => this.open(w), openSetup: () => openSetupFor(this.host) }) });
    this.body = el('div', { class: 'mfw-body' });
    this.el = el('section', { class: 'mfw', role: 'dialog', 'aria-label': t('창작마당'), hidden: true },
      el('div', { class: 'mfw-head' },
        this.titleEl = el('h2', {}, t('창작마당')),
        this.tabs,
        el('span', { class: 'sp' }),
        el('div', { class: 'tools' },
          this.search,
          el('button', { class: 'mfw-b', type: 'button', onclick: () => this.openByLink() }, t('링크로 열기')),
          this.whoBtn,
          el('button', { class: 'x mfw-x', type: 'button', 'aria-label': t('닫기'), title: t('닫기 (Esc)'), onclick: () => this.close() }))),
      this.body,
      this.player.el);
    document.body.append(this.el);
    onLangChange(() => { if (!this.el.hidden) { this.titleEl.textContent = t('창작마당'); this.search.placeholder = t('제목, 태그, 작성자 검색'); this.render(); } });
  }

  get studio() { return this.host.where === 'studio' ? this.host.app?.studio : null; }

  async open(view = 'browse', arg = null) {
    if (this.el.hidden) {
      this.el.hidden = false;
      this.release = holdKeys(this.el, () => this.escape());
    }
    const s = await W('status');
    this.st = s.ok ? s.data : { github: null, discord: null, actor: null };
    this.paintWho();
    this.go(view, arg);
  }
  close() {
    this.player.stop();
    this.el.hidden = true;
    this.release?.();
    this.release = null;
  }
  escape() {
    const dlg = document.querySelector('.mfw-dlg');
    if (dlg) { dlg.remove(); return; }
    if (this.view === 'item') return this.go(this.back || 'browse');
    this.close();
  }
  paintWho() {
    const u = this.st?.github || this.st?.discord;
    const i = el('i');
    if (u) i.textContent = (u.name || u.handle || '?').trim().charAt(0).toUpperCase(); else i.append(icon('person'));
    this.whoBtn.className = `mfw-who${u ? ' in' : ''}`;
    this.whoBtn.replaceChildren(i, u ? (u.name || u.handle) : t('로그인'));
    this.whoBtn.title = t('계정');
  }

  go(view, arg = null) {
    if (view !== 'item' && view !== 'edit') this.back = view;
    this.view = view;
    this.arg = arg;
    this.body.scrollTop = 0;
    this.render();
  }

  render() {
    const tab = (k, label) => el('button', { type: 'button', role: 'tab', 'aria-selected': String(this.view === k), class: this.view === k || (k === 'browse' && this.view === 'item' && this.back === 'browse') || (k === 'mine' && this.view === 'edit') ? 'on' : '', onclick: () => this.go(k) }, label);
    this.tabs.replaceChildren(tab('browse', t('둘러보기')), tab('mine', t('내 작품')), tab('upload', t('올리기')));
    this.search.hidden = this.view !== 'browse';
    if (this.view === 'browse') this.renderBrowse();
    else if (this.view === 'item') this.renderItem(this.arg);
    else if (this.view === 'mine') this.renderMine();
    else if (this.view === 'upload') this.renderUpload(null);
    else if (this.view === 'edit') this.renderUpload(this.arg);
  }

  msg(title, text, action = null) {
    this.body.replaceChildren(el('div', { class: 'mfw-msg' }, el('b', {}, title), text ? el('div', {}, text) : null, action));
  }

  // ---------- 둘러보기 ----------
  async renderBrowse() {
    const q = this.q;
    const [sort, period] = q.sort.split(':');
    const my = this.loadGen = (this.loadGen || 0) + 1;
    if (!this.listData) this.msg(t('불러오는 중…'), '');
    const r = await W('list', { sort, period, kind: q.kind, genre: q.genre, tag: q.tag, owner: q.owner, q: q.q, page: q.page });
    if (my !== this.loadGen || this.view !== 'browse') return;
    if (!r.ok) {
      this.listData = null;
      return this.msg(t('창작마당에 연결하지 못했어요'), tdyn(r.message), el('button', { class: 'mfw-b', type: 'button', onclick: () => this.renderBrowse() }, t('다시 시도')));
    }
    this.listData = r.data;
    const d = r.data;
    const set = (patch) => { this.q = { ...this.q, ...patch, page: patch.page ?? 0 }; this.renderBrowse(); };

    const rail = el('aside', { class: 'mfw-rail' },
      el('h4', {}, t('장르')),
      el('button', { type: 'button', class: !q.genre ? 'on' : '', onclick: () => set({ genre: '' }) }, el('span', {}, t('모든 장르'))),
      ...GENRES().filter(([k]) => d.genres?.[k]).map(([k, name]) => el('button', { type: 'button', class: q.genre === k ? 'on' : '', onclick: () => set({ genre: q.genre === k ? '' : k }) }, el('span', {}, name), el('small', {}, d.genres[k]))),
      el('h4', {}, t('많이 쓰인 태그')),
      ...(d.tags?.length ? d.tags.slice(0, 24).map((x) => el('button', { type: 'button', class: q.tag === x.tag ? 'on' : '', onclick: () => set({ tag: q.tag === x.tag ? '' : x.tag }) }, el('span', {}, `#${x.tag}`), el('small', {}, x.n))) : [el('div', { class: 'none' }, t('아직 없어요'))]));

    const sortSel = el('select', { class: 'mfw-in', 'aria-label': t('정렬'), onchange: (e) => set({ sort: e.target.value }) }, ...SORTS().map(([k, label]) => el('option', { value: k }, label)));
    sortSel.value = q.sort;
    const chips = [];
    const chip = (label, value, clear) => chips.push(el('span', { class: 'mfw-chip' }, el('b', {}, label), value, el('button', { class: 'mfw-link rm', type: 'button', 'aria-label': t('필터 빼기'), onclick: clear }, '×')));
    if (q.q) chip(t('검색'), q.q, () => { this.search.value = ''; set({ q: '' }); });
    if (q.owner) chip(t('작성자'), q.owner, () => set({ owner: '' }));
    if (q.genre) chip(t('장르'), genreName(q.genre), () => set({ genre: '' }));
    if (q.tag) chip(t('태그'), `#${q.tag}`, () => set({ tag: '' }));
    if (chips.length > 1) chips.push(el('button', { class: 'mfw-link', type: 'button', onclick: () => { this.search.value = ''; set({ q: '', owner: '', genre: '', tag: '' }); } }, t('필터 모두 지우기')));

    const rows = d.items.map((it) => this.listRow(it));
    const pages = Math.ceil(d.total / d.pageSize);
    const main = el('div', { class: 'mfw-main' },
      el('div', { class: 'mfw-bar' },
        el('div', { class: 'mfw-seg', role: 'group', 'aria-label': t('종류') }, ...KINDS().map(([k, label]) => el('button', { type: 'button', class: q.kind === k ? 'on' : '', onclick: () => set({ kind: k }) }, label))),
        sortSel,
        el('span', { class: 'count' }, t('작품 {n}개', { n: d.total }))),
      chips.length ? el('div', { class: 'mfw-filters' }, ...chips) : null,
      d.items.length
        ? el('div', { class: 'mfw-list' },
          el('div', { class: 'mfw-lh' }, el('span'), el('span', {}, t('제목')), el('span', { class: 'r' }, t('길이')), el('span', { class: 'r' }, 'BPM'), el('span', { class: 'r' }, t('좋아요')), el('span', { class: 'r' }, t('올린 날'))),
          ...rows)
        : el('div', { class: 'mfw-msg' },
          el('b', {}, chips.length ? t('조건에 맞는 작품이 없어요') : t('아직 올라온 작품이 없어요')),
          chips.length ? null : el('button', { class: 'mfw-b pri', type: 'button', onclick: () => this.go('upload') }, t('첫 작품 올리기'))),
      pages > 1 ? el('div', { class: 'mfw-pages' },
        el('button', { type: 'button', disabled: q.page === 0, 'aria-label': t('이전 쪽'), onclick: () => set({ page: q.page - 1 }) }, '‹'),
        ...[...Array(pages).keys()].filter((p) => p === 0 || p === pages - 1 || Math.abs(p - q.page) <= 2).flatMap((p, i, arr) => [
          i && p - arr[i - 1] > 1 ? el('span', { class: 'mfw-faint' }, '…') : null,
          el('button', { type: 'button', class: p === q.page ? 'on' : '', onclick: () => set({ page: p }) }, String(p + 1))]),
        el('button', { type: 'button', disabled: q.page >= pages - 1, 'aria-label': t('다음 쪽'), onclick: () => set({ page: q.page + 1 }) }, '›')) : null);
    this.body.replaceChildren(el('div', { class: 'mfw-browse' }, rail, main));
  }

  listRow(it) {
    const hasAudio = (it.files || []).some((f) => f.role === 'audio');
    const pl = el('button', { class: `pl${this.player.playing(it) ? ' on' : ''}`, type: 'button', disabled: !hasAudio, 'aria-label': t('재생'),
      onclick: (e) => { e.stopPropagation(); this.player.toggle(it); } }, svg(this.player.playing(it) ? 'pause' : 'play'));
    const kinds = (it.kinds || []).map(kindName).join(' · ');
    const row = el('div', { class: 'mfw-row', tabindex: '0', role: 'button', 'data-id': it.id, onclick: () => this.go('item', it),
      onkeydown: (e) => { if (e.key === 'Enter') this.go('item', it); } },
      art(it, { play: pl }),
      el('div', { class: 't' }, el('b', {}, it.title),
        el('small', {}, `${it.owner.name || it.owner.login} · ${genreName(it.genre)} · ${kinds}`, it.tags?.length ? el('span', { class: 'tg' }, it.tags.slice(0, 4).map((x) => `#${x}`).join(' ')) : null)),
      el('span', { class: 'r' }, fmtTime(it.length) || '-'),
      el('span', { class: 'r' }, it.bpm ? String(Math.round(it.bpm)) : '-'),
      el('span', { class: 'r lk' }, svg('heart'), String(it.likes)),
      el('span', { class: 'r' }, fmtAgo(it.created)));
    return row;
  }
  onPlayState() {
    for (const b of this.body.querySelectorAll('.mfw-row')) {
      const it = this.listData?.items.find((x) => x.id === b.dataset.id);
      const pl = b.querySelector('.pl');
      if (it && pl) { const on = this.player.playing(it); pl.classList.toggle('on', on); pl.replaceChildren(svg(on ? 'pause' : 'play')); }
    }
    this.paintBig?.();
  }

  // ---------- 작품 ----------
  async renderItem(it0) {
    this.msg(t('불러오는 중…'), '');
    let it = it0;
    if (!it0.unlisted) {
      const r = await W('item', { id: it0.id });
      if (this.view !== 'item' || this.arg !== it0) return;
      if (!r.ok) return this.msg(t('작품을 열지 못했어요'), tdyn(r.message), el('button', { class: 'mfw-b', type: 'button', onclick: () => this.go(this.back || 'browse') }, t('목록으로')));
      it = r.data;
    }
    this.cur = it;
    const files = it.files || [];
    const audioF = files.find((f) => f.role === 'audio');
    const openable = files.find((f) => f.role === 'project') || files.find((f) => f.role === 'midi');

    // hero: cover, title, the waveform
    const canvas = el('canvas', { 'aria-label': t('파형. 누르면 그 위치로 이동해요') });
    const big = el('button', { class: 'big', type: 'button', disabled: !audioF, 'aria-label': t('재생'), onclick: () => this.player.toggle(it) }, svg('play'));
    const tm = el('span', { class: 'tm' }, fmtTime(it.length));
    this.paintBig = () => { const on = this.player.playing(it); big.replaceChildren(svg(on ? 'pause' : 'play')); big.setAttribute('aria-label', on ? t('일시 정지') : t('재생')); };
    let peaks = null, frac = 0;
    const draw = () => {
      const w = canvas.clientWidth, h = canvas.clientHeight, dpr = devicePixelRatio || 1;
      if (!w) return;
      canvas.width = w * dpr; canvas.height = h * dpr;
      const g = canvas.getContext('2d');
      g.scale(dpr, dpr);
      const cs = getComputedStyle(this.el);
      const on = cs.getPropertyValue('--accent').trim() || '#e0a440', off = cs.getPropertyValue('--line-2').trim() || '#30323a';
      const n = Math.floor(w / 3);
      for (let i = 0; i < n; i++) {
        const v = peaks ? peaks[Math.floor(i / n * peaks.length)] : 0.04;
        const bh = Math.max(2, Math.min(1, v * 1.15) * (h - 4));
        g.fillStyle = i / n < frac ? on : off;
        g.fillRect(i * 3, (h - bh) / 2, 2, bh);
      }
    };
    this.onTime = (p, f) => { if (p?.id === it.id) { frac = f; draw(); tm.textContent = `${fmtTime(this.player.audio.currentTime)} / ${fmtTime(this.player.audio.duration || it.length)}`; } };
    canvas.addEventListener('pointerdown', (e) => { const r = canvas.getBoundingClientRect(); this.player.seek(it, (e.clientX - r.left) / r.width); });
    if (audioF) this.player.load(it).then((d) => { peaks = d?.peaks; if (d?.duration && !it.length) tm.textContent = fmtTime(d.duration); draw(); }).catch(() => {});
    requestAnimationFrame(draw);
    new ResizeObserver(draw).observe(canvas);

    const hero = el('div', { class: 'mfw-hero' },
      art(it),
      el('div', {},
        el('h1', {}, it.title),
        el('div', { class: 'by' }, t('만든 사람'), ' ', el('button', { type: 'button', onclick: () => { this.q = { ...this.q, owner: it.owner.login, page: 0 }; this.go('browse'); } }, it.owner.name || it.owner.login),
          el('span', { class: 'mfw-badge' }, it.app === 'studio' ? 'MeloFi Studio' : t('피아노')),
          it.unlisted ? el('span', { class: 'mfw-badge' }, t('링크 공유')) : null,
          it.hidden ? el('span', { class: 'mfw-badge warn' }, t('신고로 숨겨짐')) : null),
        audioF ? el('div', { class: 'mfw-wave' }, big, canvas, tm)
          : el('div', { class: 'mfw-wave' }, big, el('span', { class: 'none' }, t('오디오 없이 MIDI와 프로젝트만 있어요. Studio에서 열어 들어 보세요.')), el('span'))));

    // left: description, tags, comments
    const left = el('div', {},
      el('p', { class: `mfw-desc${it.description ? '' : ' empty'}` }, it.description || t('설명이 없어요.')),
      it.tags?.length ? el('div', { class: 'mfw-tags' }, ...it.tags.map((x) => el('button', { class: 'mfw-chip', type: 'button', onclick: () => { this.q = { ...this.q, tag: x, page: 0 }; this.go('browse'); } }, `#${x}`))) : null,
      it.unlisted ? el('p', { class: 'mfw-note' }, t('링크로만 공유한 작품이라 좋아요와 댓글이 없어요.')) : this.comments(it));

    // right rail: actions, files, info, quiet links
    const like = el('button', { class: `mfw-b${it.liked ? ' on' : ''}`, type: 'button', disabled: it.unlisted, 'aria-pressed': String(!!it.liked), onclick: async () => {
      if (!this.st?.actor) return this.needLogin(t('좋아요를 누르려면 디스코드나 GitHub로 로그인해 주세요.'));
      const r = await W('like', { id: it.id, on: !it.liked });
      if (!r.ok) return this.toast(r.message, true);
      Object.assign(it, { liked: r.data.liked, likes: r.data.likes });
      like.classList.toggle('on', it.liked); like.setAttribute('aria-pressed', String(it.liked));
      like.replaceChildren(svg('heart'), it.liked ? t('좋아요 취소') : t('좋아요'), el('small', {}, ` ${it.likes}`));
    } }, svg('heart'), it.liked ? t('좋아요 취소') : t('좋아요'), el('small', {}, ` ${it.likes ?? 0}`));
    const side = el('div', { class: 'mfw-side' },
      openable ? el('button', { class: 'mfw-b pri wide', type: 'button', onclick: () => this.openInStudio(it, openable) }, openable.role === 'project' ? t('Studio에서 열기') : t('MIDI를 Studio에서 열기')) : null,
      el('div', { class: 'mfw-like' }, like),
      it.mine ? el('div', { class: 'mfw-like' },
        el('button', { class: 'mfw-b', type: 'button', onclick: () => this.go('edit', it) }, t('고치기')),
        el('button', { class: 'mfw-b', type: 'button', onclick: () => this.remove(it) }, t('지우기'))) : null,
      el('div', { class: 'mfw-files' }, ...files.map((f) => el('div', {},
        el('span', {}, fileLabel(f), fileLabel(f).toLowerCase().endsWith(`.${fileExt(f)}`) ? null : el('small', {}, ` .${fileExt(f)}`)),
        el('small', {}, fmtSize(f.size)),
        el('button', { class: 'mfw-b', type: 'button', onclick: () => this.download(it, f) }, t('받기'))))),
      el('table', { class: 'mfw-info' }, el('tbody', {},
        ...[[t('만든 사람'), el('button', { type: 'button', onclick: () => { this.q = { ...this.q, owner: it.owner.login, page: 0 }; this.go('browse'); } }, `${it.owner.name || it.owner.login}`)],
          [t('장르'), genreName(it.genre)],
          [t('종류'), (it.kinds || []).map(kindName).join(', ')],
          [t('길이'), fmtTime(it.length) || '-'],
          ['BPM', it.bpm ? String(Math.round(it.bpm)) : '-'],
          [t('올린 날'), fmtDate(it.created)],
          it.updated - it.created > 60 ? [t('고친 날'), fmtDate(it.updated)] : null,
          it.unlisted ? null : [t('재생'), String(it.plays ?? 0)],
          it.unlisted ? null : [t('내려받기'), String(it.downloads ?? 0)],
        ].filter(Boolean).map(([k, v]) => el('tr', {}, el('th', {}, k), el('td', {}, v))))),
      el('div', { class: 'mfw-quiet' },
        el('button', { class: 'mfw-link', type: 'button', onclick: () => this.copyLink(it) }, t('링크 복사')),
        el('button', { class: 'mfw-link', type: 'button', onclick: () => W('openLink', { login: it.owner.login, id: it.id }) }, t('GitHub에서 보기')),
        it.mine || it.unlisted ? null : el('button', { class: 'mfw-link', type: 'button', onclick: (e) => this.report(it, e.currentTarget) }, it.reported ? t('신고함') : t('신고'))),
      this.note = el('p', { class: 'mfw-note', role: 'status' }));

    this.body.replaceChildren(el('div', { class: 'mfw-item' },
      el('button', { class: 'mfw-link mfw-back', type: 'button', onclick: () => this.go(this.back || 'browse') }, `‹ ${this.back === 'mine' ? t('내 작품') : t('둘러보기')}`),
      hero, el('div', { class: 'mfw-cols' }, left, side)));
  }

  comments(it) {
    const box = el('div', {});
    const list = el('div', {});
    const head = el('h3', { class: 'mfw-h3' }, t('댓글'), el('small', {}, String(it.comments ?? 0)));
    const ta = el('textarea', { class: 'mfw-in', maxlength: '1000', placeholder: this.st?.actor ? t('감상을 남겨 주세요') : t('댓글을 쓰려면 로그인해 주세요'), disabled: !this.st?.actor });
    const send = el('button', { class: 'mfw-b', type: 'button', disabled: !this.st?.actor, onclick: async () => {
      if (!ta.value.trim()) return;
      send.disabled = true;
      const r = await W('comment', { id: it.id, text: ta.value });
      send.disabled = false;
      if (!r.ok) return this.toast(r.message, true);
      ta.value = '';
      load();
    } }, t('댓글 쓰기'));
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send.click(); });
    const load = async () => {
      const r = await W('comments', { id: it.id });
      if (!r.ok) { list.replaceChildren(el('p', { class: 'mfw-note err' }, tdyn(r.message))); return; }
      head.querySelector('small').textContent = String(r.data.comments.length);
      list.replaceChildren(...(r.data.comments.length ? r.data.comments.slice().reverse().map((c) => el('div', { class: 'mfw-c' },
        el('div', { class: 'hd' }, el('b', {}, c.name), c.byOwner ? el('span', { class: 'mfw-badge' }, t('작성자')) : null, el('small', {}, `${c.provider === 'github' ? 'GitHub' : 'Discord'} · ${fmtAgo(c.at)}`),
          c.canDelete ? el('button', { class: 'mfw-link', type: 'button', onclick: async () => { if (!confirm(t('이 댓글을 지울까요?'))) return; const d = await W('uncomment', { cid: c.id }); if (!d.ok) return this.toast(d.message, true); load(); } }, t('지우기')) : null),
        el('p', {}, c.text))) : [el('p', { class: 'mfw-note' }, t('첫 댓글을 남겨 보세요.'))]));
    };
    load();
    box.append(head, el('div', { class: 'mfw-cform' }, ta, send), list);
    return box;
  }

  needLogin(text) {
    this.dialog(t('로그인이 필요해요'), text, [[t('닫기'), null], [t('계정 열기'), () => openAccountCenter({ openWorkshop: (w) => this.open(w), openSetup: () => openSetupFor(this.host) }), true]]);
  }
  toast(text, err = false) {
    if (this.note?.isConnected) { this.note.textContent = tdyn(text); this.note.classList.toggle('err', err); }
    else this.host.app?.ui?.toast?.(tdyn(text), { err });
  }
  copyLink(it) {
    const url = `https://gist.github.com/${it.owner.login}/${it.id}`;
    navigator.clipboard?.writeText(url).catch(() => {});
    this.toast(t('링크를 복사했어요. 받은 사람은 창작마당의 링크로 열기에 붙여넣으면 돼요.'));
  }
  async download(it, f) {
    const base = it.title.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'MeloFi';
    const r = await W('download', { login: it.owner.login, id: it.id, name: f.name, suggest: `${base}.${fileExt(f)}` });
    if (!r.ok) return this.toast(r.message, true);
    if (r.data) this.toast(t('저장했어요 · {file}', { file: r.data }));
  }

  // the studio opens it here; the piano window hands it to the studio window
  async openInStudio(it, f) {
    const job = { login: it.owner.login, id: it.id, name: f.name, role: f.role, title: it.title, owner: it.owner.name || it.owner.login, unlisted: !!it.unlisted };
    if (this.studio) {
      const ok = await openWorkInStudio(this.studio, job);
      if (ok) this.close();
      return;
    }
    await window.melofi.openStudioWindow({ workshop: job });
    this.toast(t('Studio 창에서 열었어요.'));
  }

  async remove(it) {
    if (!confirm(t('"{title}"을(를) 지울까요? 내 GitHub의 Gist도 함께 지워지고, 좋아요와 댓글도 사라져요. 되돌릴 수 없어요.', { title: it.title }))) return;
    const r = await W('remove', { id: it.id });
    if (!r.ok) return this.toast(r.message, true);
    this.listData = null;
    this.go('mine');
    this.host.app?.ui?.toast?.(t('작품을 지웠어요.'));
  }

  dialog(title, text, buttons, extra = null) {
    document.querySelector('.mfw-dlg')?.remove();
    const d = el('div', { class: 'mfw-dlg', role: 'dialog', 'aria-label': title, onpointerdown: (e) => { if (e.target === d) d.remove(); } });
    d.append(el('div', { class: 'box' }, el('h3', {}, title), text ? el('p', {}, text) : null, extra,
      el('div', { class: 'row' }, ...buttons.map(([label, fn, pri]) => el('button', { class: `mfw-b${pri ? ' pri' : ''}`, type: 'button', onclick: async () => { if (fn && (await fn()) === false) return; d.remove(); } }, label)))));
    this.el.append(d);
    d.querySelector('input, textarea, .pri')?.focus();
    return d;
  }

  report(it, link = null) {
    if (!this.st?.actor) return this.needLogin(t('신고하려면 디스코드나 GitHub로 로그인해 주세요.'));
    const radios = el('div', { class: 'mfw-radio' }, ...REASONS().map(([k, label], i) => el('label', {}, el('input', { type: 'radio', name: 'mfw-reason', value: k, checked: i === 0 }), label)));
    const ta = el('textarea', { class: 'mfw-in', rows: '3', maxlength: '1000', placeholder: t('자세한 내용 (선택)') });
    const note = el('p', { class: 'mfw-note', role: 'status' });
    this.dialog(t('작품 신고'), t('운영진이 확인해요. 여러 사람이 신고하면 확인 전까지 목록에서 숨겨져요.'), [[t('취소'), null], [t('신고하기'), async () => {
      const reason = radios.querySelector('input:checked')?.value || 'other';
      const r = await W('report', { id: it.id, reason, text: ta.value });
      if (!r.ok) { note.textContent = tdyn(r.message); note.classList.add('err'); return false; }
      it.reported = true;
      if (link) link.textContent = t('신고함');
      this.toast(t('신고를 받았어요. 고마워요.'));
      return true;
    }, true]], el('div', { style: 'display:grid;gap:8px' }, radios, ta, note));
  }

  openByLink() {
    const inp = el('input', { class: 'mfw-in', placeholder: 'https://gist.github.com/…', style: 'width:100%' });
    const note = el('p', { class: 'mfw-note', role: 'status' });
    const go = async () => {
      note.textContent = t('불러오는 중…'); note.classList.remove('err');
      const r = await W('byLink', { link: inp.value });
      if (!r.ok) { note.textContent = tdyn(r.message); note.classList.add('err'); return false; }
      this.back = this.view === 'item' ? this.back : this.view;
      this.go('item', r.data);
      return true;
    };
    const d = this.dialog(t('링크로 열기'), t('받은 창작마당 작품 링크를 붙여넣어 주세요. 링크로만 공유한 작품도 열려요.'), [[t('취소'), null], [t('열기'), go, true]], el('div', { style: 'display:grid;gap:6px' }, inp, note));
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') go().then((ok) => { if (ok) d.remove(); }); });
    inp.focus();
  }

  // ---------- 내 작품 ----------
  async renderMine() {
    if (!this.st?.github) {
      return this.msg(t('작품을 올리려면 GitHub를 연결해 주세요'), t('작품 파일은 내 GitHub에 저장되고, MeloFi에는 목록 정보만 남아요. 둘러보기와 듣기는 로그인 없이도 돼요.'),
        el('button', { class: 'mfw-b pri', type: 'button', onclick: () => openAccountCenter({ openWorkshop: (w) => this.open(w), openSetup: () => openSetupFor(this.host) }) }, t('계정 열기')));
    }
    this.msg(t('불러오는 중…'), '');
    const r = await W('mine');
    if (this.view !== 'mine') return;
    if (!r.ok) return this.msg(t('내 작품을 불러오지 못했어요'), tdyn(r.message), el('button', { class: 'mfw-b', type: 'button', onclick: () => this.renderMine() }, t('다시 시도')));
    const works = r.data;
    const asItem = (w) => w.item || { id: w.id, owner: { login: w.login, name: this.st.github.name }, title: w.title, unlisted: true };
    const openW = async (w) => {
      if (w.item) return this.go('item', w.item);
      const b = await W('byLink', { link: w.id });
      if (!b.ok) return this.msg(t('작품을 열지 못했어요'), tdyn(b.message));
      this.go('item', b.data);
    };
    const editW = async (w) => {
      if (w.item) return this.go('edit', w.item);
      const b = await W('byLink', { link: w.id });
      if (b.ok) this.go('edit', b.data);
    };
    this.body.replaceChildren(el('div', { class: 'mfw-mine' },
      el('div', { class: 'top' },
        el('p', {}, t('GitHub {who} 계정에 저장된 작품이에요. 링크 공유 작품은 목록에 나오지 않아요.', { who: `@${this.st.github.handle}` })),
        el('button', { class: 'mfw-b pri', type: 'button', onclick: () => this.go('upload') }, t('새 작품 올리기'))),
      works.length ? el('table', { class: 'mfw-tbl' },
        el('thead', {}, el('tr', {}, el('th', {}, t('제목')), el('th', {}, t('공개 범위')), el('th', { class: 'n' }, t('좋아요')), el('th', { class: 'n' }, t('댓글')), el('th', { class: 'n' }, t('재생')), el('th', { class: 'n' }, t('내려받기')), el('th', {}, t('올린 날')), el('th', {}))),
        el('tbody', {}, ...works.map((w) => el('tr', {},
          el('td', { class: 't' }, el('b', {}, w.title), w.hidden ? el('span', { class: 'mfw-badge warn' }, t('신고로 숨겨짐')) : null),
          el('td', {}, w.visibility === 'public' ? (w.listed ? t('창작마당 공개') : t('공개 (목록 등록 안 됨)')) : t('링크 공유')),
          el('td', { class: 'n' }, w.listed ? String(w.likes) : '-'),
          el('td', { class: 'n' }, w.listed ? String(w.comments) : '-'),
          el('td', { class: 'n' }, w.listed ? String(w.plays) : '-'),
          el('td', { class: 'n' }, w.listed ? String(w.downloads) : '-'),
          el('td', {}, fmtDate(w.created / 1000)),
          el('td', { class: 'a' },
            el('button', { class: 'mfw-b', type: 'button', onclick: () => { this.back = 'mine'; openW(w); } }, t('보기')),
            el('button', { class: 'mfw-b', type: 'button', onclick: () => { this.back = 'mine'; editW(w); } }, t('고치기')),
            el('button', { class: 'mfw-b', type: 'button', onclick: () => this.copyLink(asItem(w)) }, t('링크 복사')),
            el('button', { class: 'mfw-b', type: 'button', onclick: () => this.remove(asItem(w)) }, t('지우기')))))))
        : el('div', { class: 'mfw-msg' }, el('b', {}, t('아직 올린 작품이 없어요')), el('div', {}, this.host.where === 'studio' ? t('지금 열린 프로젝트를 올려 보세요.') : t('녹음한 연주를 올려 보세요.')))));
  }

  // ---------- 올리기 / 고치기 ----------
  async renderUpload(editing) {
    if (!this.st?.github) return this.renderMine();
    let man = null;
    if (editing) {
      const r = await W('manifest', { login: editing.owner.login, id: editing.id });
      if (!r.ok) return this.msg(t('작품 정보를 읽지 못했어요'), tdyn(r.message));
      man = r.data;
    }
    const S = this.studio;
    const where = this.host.where;
    const form = { tags: [...(man?.tags || [])], cover: undefined, coverUrl: null };
    const title = el('input', { class: 'mfw-in', maxlength: '80', value: man?.title || (S ? S.proj.name : '') });
    const desc = el('textarea', { class: 'mfw-in', rows: '5', maxlength: '2000' });
    desc.value = man?.description || '';
    const genre = el('select', { class: 'mfw-in' }, ...GENRES().map(([k, name]) => el('option', { value: k }, name)));
    genre.value = man?.genre || (where === 'piano' ? 'piano' : 'etc');
    const note = el('p', { class: 'mfw-note', role: 'status' });

    // tags: Enter or a comma adds one, up to 8
    const tagIn = el('input', { placeholder: t('입력 후 Enter'), maxlength: '24' });
    const tagBox = el('div', { class: 'mfw-tagin', onclick: () => tagIn.focus() });
    const paintTags = () => tagBox.replaceChildren(...form.tags.map((x) => el('span', { class: 'mfw-chip' }, `#${x}`, el('button', { class: 'mfw-link rm', type: 'button', 'aria-label': t('태그 빼기'), onclick: () => { form.tags = form.tags.filter((y) => y !== x); paintTags(); } }, '×'))), tagIn);
    const addTag = () => { const v = tagIn.value.replace(/[\s#,]+/g, '').toLowerCase().slice(0, 24); if (v && !form.tags.includes(v) && form.tags.length < 8) form.tags.push(v); tagIn.value = ''; paintTags(); tagIn.focus(); };
    tagIn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(); } else if (e.key === 'Backspace' && !tagIn.value && form.tags.length) { form.tags.pop(); paintTags(); tagIn.focus(); } });
    paintTags();

    // visibility (only when publishing; GitHub cannot change it later)
    const vis = el('div', { class: 'mfw-radio' },
      el('label', {}, el('input', { type: 'radio', name: 'mfw-vis', value: 'link', checked: this.host.app?.settings?.get?.('workshopVisibility') !== 'public' }), t('링크가 있는 사람만'), el('small', {}, t('목록에 나오지 않아요. 링크를 받은 사람만 듣고 내려받을 수 있어요.'))),
      el('label', {}, el('input', { type: 'radio', name: 'mfw-vis', value: 'public', checked: this.host.app?.settings?.get?.('workshopVisibility') === 'public' }), t('창작마당에 공개'), el('small', {}, t('누구나 찾아 듣고, 내려받고, 댓글을 달 수 있어요.'))));

    // files
    const src = { audio: null, midi: null }; // piano: { name, type, data }
    const want = { project: true, audio: true, midi: false }; // studio
    let filesBlock;
    const replace = el('input', { type: 'checkbox' });
    if (where === 'studio' && S) {
      const hasMedia = Object.keys(S.proj.media || {}).length > 0;
      const chk = (k, label, sub) => { const c = el('input', { type: 'checkbox', checked: want[k], onchange: () => { want[k] = c.checked; } }); return el('label', {}, c, el('span', {}, label), el('small', {}, sub), el('span')); };
      filesBlock = el('div', {},
        el('div', { class: 'mfw-src' },
          chk('project', t('Studio 프로젝트'), S.proj.name),
          chk('audio', t('오디오 (MP3로 렌더링)'), t('올릴 때 렌더링해요')),
          chk('midi', 'MIDI', t('모든 채널의 노트'))),
        hasMedia ? el('div', { class: 'hint', style: 'margin-top:6px' }, t('오디오 클립과 샘플 파일은 프로젝트에 함께 올라가지 않아요. 렌더링한 오디오에는 들어가요.')) : null);
    } else {
      const list = el('div', { class: 'mfw-src' }, el('div', { class: 'grp' }, t('불러오는 중…')));
      const picked = el('div', { class: 'mfw-picked' });
      const paintPicked = () => picked.replaceChildren(
        ...['audio', 'midi'].filter((k) => src[k]).map((k) => el('span', { class: 'mfw-chip' }, el('b', {}, k === 'audio' ? t('오디오') : 'MIDI'), src[k].name, el('button', { class: 'mfw-link rm', type: 'button', 'aria-label': t('빼기'), onclick: () => { src[k] = null; paintPicked(); paintList(); } }, '×'))),
        el('button', { class: 'mfw-b', type: 'button', onclick: async () => {
          const r = await W('pickFile', { kinds: ['audio', 'midi'] });
          if (!r.ok) { note.textContent = tdyn(r.message); note.classList.add('err'); return; }
          if (r.data) { src[r.data.type === 'audio/midi' ? 'midi' : 'audio'] = r.data; paintPicked(); paintList(); }
        } }, t('다른 파일…')));
      let recs = [];
      const paintList = () => {
        const dir = this.host.app?.settings?.get?.('recDir') || '';
        list.replaceChildren(...(recs.length ? recs.map((f) => {
          const k = f.type === 'audio/midi' ? 'midi' : 'audio';
          const c = el('input', { type: 'checkbox', checked: src[k]?.path === f.path, onchange: async () => {
            if (!c.checked) { src[k] = null; paintPicked(); return; }
            const r = await W('readRecording', { dir, file: f.path });
            if (!r.ok) { c.checked = false; note.textContent = tdyn(r.message); note.classList.add('err'); return; }
            src[k] = { ...r.data, path: f.path };
            paintPicked(); paintList();
          } });
          return el('label', {}, c, el('span', {}, f.name), el('small', {}, fmtSize(f.size)), el('small', {}, fmtDate(f.time / 1000)));
        }) : [el('div', { class: 'grp' }, t('녹음 폴더에 오디오나 MIDI 파일이 없어요. 녹음하거나 다른 파일을 골라 주세요.'))]));
      };
      W('recordings', { dir: this.host.app?.settings?.get?.('recDir') || '' }).then((r) => { recs = r.ok ? r.data : []; paintList(); });
      paintPicked();
      filesBlock = el('div', {}, list, picked, el('div', { class: 'hint', style: 'margin-top:6px' }, t('오디오 하나와 MIDI 하나까지 고를 수 있어요. WAV는 MP3로 바꿔서 올려요.')));
    }

    // cover: a square image, made 500 x 500 JPEG here
    const coverBox = el('div', {});
    const paintCover = () => coverBox.replaceChildren(art(form.coverUrl ? { coverUrl: form.coverUrl } : form.cover === null || !editing ? null : editing));
    const pickCover = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true, onchange: async () => {
      const f = pickCover.files[0];
      if (!f) return;
      try { const c = await squareJpeg(f); form.cover = c; form.coverUrl = c.url; paintCover(); } catch { note.textContent = t('이미지를 읽지 못했어요.'); note.classList.add('err'); }
      pickCover.value = '';
    } });
    paintCover();

    const agree = el('input', { type: 'checkbox', checked: !!editing });
    const goBtn = el('button', { class: 'mfw-b pri', type: 'button' }, editing ? t('고친 내용 저장') : t('올리기'));
    const field = (label, ctl, hint = null) => el('div', { class: 'mfw-f' }, el('label', {}, label), ctl, hint ? el('div', { class: 'hint' }, hint) : null);

    goBtn.addEventListener('click', async () => {
      note.classList.remove('err');
      const fail = (m) => { note.textContent = tdyn(m); note.classList.add('err'); goBtn.disabled = false; };
      if (!title.value.trim()) return fail(t('제목을 적어 주세요.'));
      if (!agree.checked) return fail(t('직접 만들었거나 올려도 되는 작품인지 확인해 주세요.'));
      goBtn.disabled = true;
      let files, length = man?.length || null, bpm = man?.bpm || null;
      try {
        if (!editing || replace.checked) {
          ({ files, length, bpm } = where === 'studio' && S ? await studioFiles(S, want, (m) => { note.textContent = m; }) : await pianoFiles(src, (m) => { note.textContent = m; }));
          if (!files.length) return fail(t('올릴 파일을 하나 이상 골라 주세요.'));
        }
      } catch (e) { return fail(e?.message || String(e)); }
      note.textContent = t('GitHub에 올리는 중…');
      const r = await W('publish', {
        id: editing?.id || null,
        visibility: vis.querySelector('input:checked')?.value || 'link',
        meta: { title: title.value, description: desc.value, tags: form.tags, genre: genre.value, app: man?.app || where, length, bpm },
        files, cover: form.cover === undefined ? undefined : form.cover && { type: 'image/jpeg', data: form.cover.data },
      });
      goBtn.disabled = false;
      if (!r.ok) return fail(r.message);
      covers.clear();
      this.listData = null;
      if (r.data.indexError) this.host.app?.ui?.toast?.(t('GitHub에는 올렸지만 창작마당 목록에 넣지 못했어요: {why}. 내 작품에서 다시 시도할 수 있어요.', { why: tdyn(r.data.indexError) }), { err: true, ms: 6000 });
      else this.host.app?.ui?.toast?.(editing ? t('고친 내용을 저장했어요.') : r.data.visibility === 'public' ? t('창작마당에 올렸어요.') : t('올렸어요. 링크를 복사해 보내 주세요.'));
      const open = r.data.item || (await W('byLink', { link: r.data.id })).data;
      this.back = 'mine';
      if (open) this.go('item', open); else this.go('mine');
    });

    this.body.replaceChildren(el('div', { class: 'mfw-up' },
      el('h3', {}, editing ? t('작품 고치기') : where === 'studio' ? t('Studio 프로젝트 올리기') : t('연주 올리기')),
      el('div', {},
        field(t('제목'), title),
        editing
          ? field(t('파일'), el('div', {}, el('label', { class: 'mfw-chk' }, replace, el('span', {}, t('파일도 새로 바꾸기'))), el('div', { class: 'replace', hidden: true }, filesBlock)),
            t('지금 파일: {list}', { list: (man.files || []).map(fileLabel).join(', ') }))
          : field(t('파일'), filesBlock),
        field(t('설명'), desc),
        field(t('장르'), genre),
        field(t('태그'), tagBox, t('8개까지 넣을 수 있어요. 악기, 분위기, 원곡 이름처럼 검색에 도움이 될 말을 적어 주세요.')),
        editing ? field(t('공개 범위'), el('div', {}, man && editing.unlisted ? t('링크 공유') : t('창작마당 공개')), t('공개 범위는 올린 뒤에 바꿀 수 없어요. 바꾸려면 지우고 다시 올려 주세요.'))
          : field(t('공개 범위'), vis, t('올린 뒤에는 바꿀 수 없어요. 파일은 내 GitHub 공개 Gist나 비공개 Gist로 저장돼요.')),
        field('', el('label', { class: 'mfw-chk' }, agree, el('span', {}, t('직접 만들었거나 올려도 되는 작품이에요. 다른 사람의 곡을 연주했다면 설명에 원곡을 적어 주세요.')))),
        el('div', { class: 'mfw-go' }, note, el('button', { class: 'mfw-b', type: 'button', onclick: () => this.go(editing ? 'mine' : this.back || 'browse') }, t('취소')), goBtn)),
      el('div', { class: 'mfw-cover' },
        coverBox,
        el('div', { class: 'row' },
          el('button', { class: 'mfw-b', type: 'button', onclick: () => pickCover.click() }, t('이미지 고르기')),
          el('button', { class: 'mfw-b', type: 'button', onclick: () => { form.cover = null; form.coverUrl = null; paintCover(); } }, t('빼기'))),
        el('small', {}, t('정사각형으로 잘라서 올려요. 이미지가 없으면 기본 표지가 보여요.')),
        pickCover)));
    replace.addEventListener('change', () => { this.body.querySelector('.replace').hidden = !replace.checked; });
  }
}

// ---------- making the files ----------
async function squareJpeg(file) {
  const bmp = await createImageBitmap(file);
  const s = Math.min(bmp.width, bmp.height), N = 500;
  const c = new OffscreenCanvas(N, N);
  c.getContext('2d').drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, N, N);
  const blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.86 });
  return { data: new Uint8Array(await blob.arrayBuffer()), url: URL.createObjectURL(blob) };
}

// piano: the chosen recording (WAV becomes MP3, the size limit is 9 MB) and MIDI
async function pianoFiles(src, say) {
  const files = [];
  let length = null;
  if (src.audio) {
    let { data, type } = src.audio;
    try {
      const ctx = new OfflineAudioContext(1, 1, 44100);
      const buf = await ctx.decodeAudioData(new Uint8Array(data).slice().buffer);
      length = buf.duration;
      if (type === 'audio/wav') {
        say(t('MP3로 바꾸는 중…'));
        const { mp3 } = await imp('./recorder.js');
        const L = buf.getChannelData(0), R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
        data = await mp3({ left: L, right: R, rate: buf.sampleRate }, 192);
        type = 'audio/mpeg';
      }
    } catch { throw new Error(t('오디오 파일을 읽지 못했어요.')); }
    files.push({ role: 'audio', type, data: new Uint8Array(data), label: src.audio.name });
  }
  if (src.midi) files.push({ role: 'midi', type: 'audio/midi', data: new Uint8Array(src.midi.data), label: src.midi.name });
  return { files, length, bpm: null };
}

// studio: the project as it is now, its MP3 render and its MIDI
async function studioFiles(S, want, say) {
  const io = await imp('../studio/io.js');
  const proj = JSON.parse(JSON.stringify(S.proj));
  delete proj.cloudId;
  const files = [];
  let length = null;
  if (want.project) files.push({ role: 'project', type: 'application/json', data: JSON.stringify(proj), label: proj.name });
  if (want.audio) {
    const mix = await io.renderMix(proj, { onProgress: (stage, p) => say(stage === 'load' ? t('악기를 준비하는 중… {p}%', { p: Math.round(p * 100) }) : t('렌더링하는 중…')) });
    say(t('MP3로 바꾸는 중…'));
    const { mp3 } = await imp('./recorder.js');
    files.push({ role: 'audio', type: 'audio/mpeg', data: await mp3(mix, 192), label: `${proj.name}.mp3` });
    length = mix.left.length / mix.rate;
  }
  if (want.midi) files.push({ role: 'midi', type: 'audio/midi', data: io.projectToMidi(proj, (id) => S.isKit(id)), label: `${proj.name}.mid` });
  return { files, length, bpm: proj.bpm || null };
}

// opens a work's project (or its MIDI as a new project) in the studio; also the studio window's command
export async function openWorkInStudio(S, job) {
  const ui = S.app?.ui;
  try {
    if (job.role === 'project') {
      const r = await W('projectText', { login: job.login, id: job.id });
      if (!r.ok) throw new Error(r.message);
      const { migrate } = await imp('../studio/model.js');
      const proj = migrate(JSON.parse(r.data));
      delete proj.cloudId;
      proj.name = job.title;
      S.setProject(proj);
    } else {
      const r = await W('file', { login: job.login, id: job.id, name: job.name });
      if (!r.ok) throw new Error(r.message);
      const io = await imp('../studio/io.js');
      S.setProject(io.midiToProject(new Uint8Array(r.data), job.title));
    }
    if (!job.unlisted) W('count', { id: job.id, what: 'download' });
    ui?.toast?.(t('창작마당에서 "{title}"을(를) 열었어요 · {owner}', { title: job.title, owner: job.owner }));
    return true;
  } catch (e) {
    ui?.toast?.(t('열지 못했어요: {why}', { why: tdyn(e.message) }), { err: true });
    return false;
  }
}

// 처음 설정 from the piano window or the studio (js/firstrun.js)
export const openSetupFor = (host) => host.app && openFirstRun(appHost(host.app));
function setupHint(host) {
  const p = host.app?.settings ? setupProgress(host.app.settings.v) : null;
  return p && !p.finished && p.left ? t('{n}단계 남음', { n: p.left }) : '';
}

// the menu entries, the same in the piano's 파일 menu and the studio's 파일 popup
export function workshopMenuItems(host) {
  return [
    { group: t('창작마당') },
    { label: t('창작마당 둘러보기…'), act: () => openWorkshop(host, 'browse') },
    { label: host.where === 'studio' ? t('이 프로젝트 올리기…') : t('연주 올리기…'), act: () => openWorkshop(host, 'upload') },
    { label: t('계정…'), act: () => openAccountCenter({ openWorkshop: (w) => openWorkshop(host, w), openSetup: () => openSetupFor(host) }) },
    { label: t('처음 설정…'), hint: setupHint(host), act: () => openSetupFor(host) },
  ];
}
