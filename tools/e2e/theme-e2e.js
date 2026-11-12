// Studio themes (dark / white): screenshots of every main pane in both themes, and a contrast check of
// the white theme. Every visible text (and input / select value) is compared with the colour behind it,
// read from computed styles; the white theme fails under 4.5:1 (3:1 for large text). The dark theme's
// numbers are only reported (it keeps the colours it always had).
//   MELOFI_SHOT=<out> MELOFI_SCRIPT=tools/e2e/theme-e2e.js MELOFI_USERDATA=<tmp dir> npx electron .
// Screenshots: <out>/dark-<pane>.png and <out>/white-<pane>.png
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let errs = [];
window.addEventListener('error', (e) => errs.push(e.message + ' @' + (e.filename || '').split('/').pop() + ':' + e.lineno));
window.addEventListener('unhandledrejection', (e) => errs.push('rej ' + String(e.reason?.stack || e.reason).split('\n').slice(0, 2).join(' ')));
const A = window.__melofi;
const api = window.melofi;
for (let i = 0; i < 150 && !A?.engine?.inst; i++) await sleep(100);
const imp = (p) => import(new URL(p, location.href).href);
const R = [];
async function check(name, fn) {
  errs = [];
  const t0 = performance.now();
  try {
    const note = await fn();
    await sleep(40);
    R.push(`${errs.length ? 'FAIL' : 'PASS'} ${name}${note ? ` (${note})` : ''}${errs.length ? ' :: ' + [...new Set(errs)].slice(0, 3).join(' | ') : ''} [${Math.round(performance.now() - t0)}ms]`);
  } catch (e) {
    R.push(`FAIL ${name} :: ${String(e?.message || e).split('\n').slice(0, 220).join('\n    ')}${errs.length ? ' | ' + errs.slice(0, 3).join(' | ') : ''}`);
  }
}
window.confirm = () => false; window.alert = () => {}; window.prompt = () => null;

// ---- contrast of every visible text against what is behind it (computed styles) ----
function contrastScan(min = 4.5) {
  const rgba = (s) => {
    let m = /^rgba?\(([^)]+)\)$/.exec(s);
    if (m) { const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p[3] ?? 1]; }
    m = /^color\(srgb ([^)]+)\)$/.exec(s); // color-mix() results
    if (m) { const p = m[1].split(/[\s/]+/).filter(Boolean).map(Number); return [p[0] * 255, p[1] * 255, p[2] * 255, p[3] ?? 1]; }
    return null;
  };
  const over = (top, under) => { const a = top[3]; return [0, 1, 2].map((i) => top[i] * a + under[i] * (1 - a)).concat(1); };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const hex = (c) => '#' + c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  // the colour behind an element: its own and its ancestors' backgrounds, composited
  const behind = (el) => {
    const layers = [];
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (+cs.opacity < 1) return null;                         // dimmed on purpose (disabled, past steps)
      const bg = rgba(cs.backgroundColor) || [0, 0, 0, 0];
      if (bg[3] === 0 && cs.backgroundImage !== 'none' && e !== el) return null; // a gradient we cannot read
      if (bg[3] > 0) layers.push(bg);
      if (bg[3] >= 1) break;
    }
    let c = [0, 0, 0, 1];
    for (let i = layers.length - 1; i >= 0; i--) c = over(layers[i], c);
    return c;
  };
  const shown = (el) => { if (!el.isConnected || el.closest('[hidden], template, script, style, canvas')) return false; if (!el.getClientRects().length) return false; const cs = getComputedStyle(el); return cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const bad = [];
  let n = 0;
  const test = (el, text) => {
    if (el.closest(':disabled, [aria-disabled=true]')) return;
    const cs = getComputedStyle(el);
    const fg = rgba(cs.color), bg = behind(el);
    if (!fg || !bg || fg[3] === 0) return;
    n++;
    const r = ratio(over(fg, bg), bg);
    const size = parseFloat(cs.fontSize), large = size >= 24 || (size >= 18.6 && +cs.fontWeight >= 700);
    if (r < (large ? 3 : min)) bad.push(`${r.toFixed(2)} ${hex(over(fg, bg))} on ${hex(bg)} ${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${String(el.className).trim().replace(/\s+/g, '.')} "${text.slice(0, 40)}"`);
  };
  const seen = new Set();
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let t = w.nextNode(); t; t = w.nextNode()) {
    const s = t.nodeValue.trim(), el = t.parentElement;
    if (!s || !el || seen.has(el) || !shown(el)) continue;
    seen.add(el); test(el, s);
  }
  for (const el of document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]), select, textarea')) if (shown(el) && (el.value || '').trim()) test(el, el.value);
  return { n, bad: [...new Set(bad)] };
}

const { TEMPLATES } = await imp('studio/templates.js');
const theme = await imp('studio/ui/theme.js');
const S = A.studio;
A.settings.set({ studioTourSeen: true });
const shot = (name) => api.testShot?.('piano', name);
const closePops = () => { document.querySelectorAll('.st-pop, .st-ask').forEach((x) => x.remove()); };
const lowest = { dark: [], white: [] };
let scanned = 0;
const scan = (th, where) => { const r = contrastScan(); scanned += r.n; for (const b of r.bad) lowest[th].push(`${where}: ${b}`); };

await S.open(); await sleep(500);
const proj = (TEMPLATES.lofi || TEMPLATES.basic).make(); // a song with notes, clips and steps
S.setProject(proj); await sleep(200);
const darkPalette = { ...theme.studioPalette() };

for (const th of ['dark', 'white']) {
  await check(`${th}: switch`, async () => {
    S.setTheme(th); await sleep(150);
    if (theme.studioTheme() !== th) throw new Error(`theme ${theme.studioTheme()}`);
    const P = theme.studioPalette();
    if (P.theme !== th) throw new Error('palette not refreshed');
    if (th === 'dark' && (P.bg !== '#101115' || P.playhead !== '#e0a440' || P.noteA0 !== 0.55 || P.noteLine !== '')) throw new Error(`dark palette changed: ${P.bg} ${P.playhead} ${P.noteA0}`);
    if (th === 'white' && (P.bg === darkPalette.bg || P.row === darkPalette.row)) throw new Error('white palette is the dark one');
    const ink = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim();
    if (th === 'dark' && ink !== '#0d0e12') throw new Error(`dark --ink ${ink}`);
    return `bg ${P.bg}`;
  });
  await check(`${th}: panes`, async () => {
    const pat = S.proj.patterns.find((p) => p.id === S.proj.current) || S.proj.patterns[0];
    const ch = [...S.proj.channels].sort((a, b) => (pat.notes[b.id] || []).length - (pat.notes[a.id] || []).length)[0];
    S.proj.selected = ch.id; S.renderAll();
    const notes = S.roll.list || [];
    S.roll.sel = new Set(notes.slice(0, 3));
    S.setTab('roll'); await sleep(120);
    S.transport.play(); await sleep(700);
    S.roll.draw(); scan(th, 'roll'); await shot(`${th}-roll`);
    S.setTab('playlist'); S.proj.mode = 'song'; await sleep(500); S.playlist.draw(); scan(th, 'playlist'); await shot(`${th}-playlist`);
    S.transport.stop(); S.roll.sel = new Set();
    for (const t of ['mixer', 'live']) { S.setTab(t); await sleep(250); scan(th, t); await shot(`${th}-${t}`); }
    S.setTab('roll');
    S.setLeft('browser'); await sleep(250); scan(th, 'browser'); await shot(`${th}-browser`); S.setLeft('browser'); await sleep(60);
    // the on-screen keyboard is its own window and takes the studio's theme
    if (!S.keysOpen) S.toggleKeys();
    await sleep(1200); let kt;
    for (let i = 0; i < 30 && kt !== (th === 'white' ? 'white' : null); i++) { await sleep(150); kt = await api.testEval('keys', 'document.documentElement.dataset.studioTheme || null').catch(() => undefined); }
    if (kt !== (th === 'white' ? 'white' : null)) throw new Error(`keys window theme ${kt}`);
    await sleep(300); await api.testShot('keys', `${th}-keys`); S.toggleKeys(); await sleep(200);
  });
  await check(`${th}: menus and dialogs`, async () => {
    const b = document.querySelector('.st-tool .mb[data-menu="options"]');
    S.openMenu('options', b); await sleep(100); scan(th, 'options menu'); await shot(`${th}-options-menu`); closePops(); await sleep(30);
    S.rack.addMenu(200, 200); await sleep(80); scan(th, 'context menu'); closePops();
    S.lookSheet(); await sleep(150); scan(th, 'look sheet'); await shot(`${th}-look-sheet`); closePops(); await sleep(30);
  });
  await check(`${th}: plugin windows`, async () => {
    const sheets = [];
    for (const kind of ['synth', 'sampler', 'sample', 'drums']) { const c = S.proj.channels.find((x) => x.kind === kind); if (c) sheets.push(c); }
    if (!sheets.length) sheets.push(S.proj.channels[0]);
    for (const [i, c] of sheets.entries()) {
      S.channelSheet.show(c.id); await sleep(200);
      for (const tb of [...(S.channelSheet.el?.querySelectorAll('.tabs button, [data-tab]') || [])]) { tb.click(); await sleep(60); scan(th, `channel ${c.kind} tab`); }
      if (i === 0) await shot(`${th}-channel`);
      S.channelSheet.hide?.() ?? S.channelSheet.close?.();
    }
    S.riffWizard.open(); await sleep(200); scan(th, 'riff machine'); await shot(`${th}-riff`); S.riffWizard.close();
    return `${sheets.length} channels`;
  });
  await check(`${th}: mastering, AI and other windows`, async () => {
    await S.mastering.show(); S.transport.play(); await sleep(800); scan(th, 'mastering'); await shot(`${th}-mastering`); S.transport.stop(); S.mastering.hide?.() ?? S.mastering.close?.();
    await S.aiSheet.show(); await sleep(250); scan(th, 'ai'); await shot(`${th}-ai`); S.aiSheet.hide?.() ?? S.aiSheet.close?.();
    await S.dawSheet.show(); await sleep(200); scan(th, 'daw'); S.dawSheet.hide?.() ?? S.dawSheet.close?.();
    await S.cloudSheet.show('account'); await sleep(200); scan(th, 'cloud'); S.cloudSheet.hide?.() ?? S.cloudSheet.close?.();
    closePops();
  });
  await check(`${th}: tour`, async () => {
    const { CHAPTERS } = await imp('studio/ui/lessons.js');
    S.tour.start(CHAPTERS[0].id); await sleep(500); scan(th, 'tour'); await shot(`${th}-tour`);
    S.tour.go(Math.min(3, CHAPTERS[0].steps.length - 1)); await sleep(600); scan(th, 'tour step'); await shot(`${th}-tour-step`);
    S.tour.stop();
  });
  if (th === 'white') {
    await check('white: text contrast >= 4.5:1', async () => {
      const list = [...new Set(lowest.white)];
      if (list.length) throw new Error(`${list.length} texts too close to their background\n` + list.slice(0, 200).join('\n'));
      return `${scanned} texts checked in both themes`;
    });
  }
}
await check('dark: low-contrast texts it always had (report only)', () => `${new Set(lowest.dark).size}`);
await check('closing the studio takes the theme off the page', async () => {
  S.setTheme('white'); await sleep(50);
  S.close(); await sleep(150);
  if (document.documentElement.dataset.studioTheme) throw new Error('still themed after close');
  await S.open(); await sleep(300);
  if (theme.studioTheme() !== 'white') throw new Error('not back on open');
  S.setTheme('dark'); await sleep(50);
  if (document.documentElement.dataset.studioTheme) throw new Error('dark should leave no attribute');
});
await check('setting persists as studioLook.theme', async () => {
  S.setTheme('white');
  if (A.settings.get('studioLook')?.theme !== 'white') throw new Error(JSON.stringify(A.settings.get('studioLook')));
  S.setTheme('dark');
  if (A.settings.get('studioLook')?.theme !== 'dark') throw new Error('dark not saved');
});

console.log('E2E-BEGIN\n' + R.join('\n') + '\nE2E-END');
return [];
