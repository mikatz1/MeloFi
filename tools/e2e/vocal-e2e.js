// Singing voices, end to end inside the app (headless):
//   MELOFI_SHOT=out MELOFI_SCRIPT=tools/e2e/vocal-e2e.js MELOFI_USERDATA=out/ud npx electron .
// userData needs the analysis engine (stems-engine) with the vocal components. Voices that are not
// installed yet are skipped, except Yoko (49 MB), which the test installs through the app itself
// (after first checking that cancelling a download works).
// Checks: every installed voice sings a short phrase in each language it supports, audible and on
// pitch (tools/vocal/check_sing.py: within 50 cents on at least 3 of 4 notes); lyrics recognition
// returns the sung text and puts the right syllable on most notes; the Studio vocal tab renders and
// sings a channel onto an audio track.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let errs = [];
window.addEventListener('error', (e) => errs.push(e.message + ' @' + (e.filename || '').split('/').pop() + ':' + e.lineno));
const origErr = console.error; console.error = (...a) => { errs.push('console.error ' + a.map((x) => (x && x.message ? `${x.name}: ${x.message}` : String(x))).join(' ').slice(0, 200)); origErr(...a); };
window.addEventListener('unhandledrejection', (e) => errs.push('rej ' + String(e.reason?.stack || e.reason).split('\n').slice(0, 2).join(' ')));
const A = window.__melofi;
for (let i = 0; i < 150 && !A?.engine?.inst; i++) await sleep(100);
const R = [];
const imp = (p) => import(new URL(p, location.href).href);
async function check(name, fn) {
  errs = [];
  const t = performance.now();
  try {
    const note = await fn();
    await sleep(60);
    R.push(`${errs.length ? 'FAIL' : 'PASS'} ${name}${note ? ` (${note})` : ''}${errs.length ? ' :: ' + [...new Set(errs)].slice(0, 4).join(' | ') : ''} [${Math.round((performance.now() - t) / 1000)}s]`);
  } catch (e) {
    R.push(`FAIL ${name} :: ${String(e?.message || e).split('\n').slice(0, 3).join(' ')}${errs.length ? ' | ' + errs.slice(0, 3).join(' | ') : ''} [${Math.round((performance.now() - t) / 1000)}s]`);
  }
}
window.confirm = () => true; window.alert = () => {};
const M = window.melofi;
const V = await imp('studio/vocal.js');

// Twinkle twinkle (C C G G A A G), one octave per voice range; syllables per language
const MELODY = [0, 0, 7, 7, 9, 9, 7];
const BEATS = [1, 1, 1, 1, 1, 1, 2];
const LYRICS = { ko: '반짝반짝 작은별', ja: 'きらきら ひかる', en: 'twinkle twinkle little star' };
const BASE = { male: 55, female: 67 };
const phrase = (base, q = 0.45) => {
  let t = 0.6;
  return MELODY.map((m, i) => { const n = [t, BEATS[i] * q * 0.95, base + m, 100]; t += BEATS[i] * q; return n; });
};

let st;
await check('vocal: status', async () => {
  st = await V.voices(true);
  if (!st.engine) throw new Error('analysis engine missing in this userData');
  return `${st.voices.length} voices · ready: ${st.voices.filter((v) => v.ready).map((v) => v.id).join(', ') || 'none'} · lyrics ${st.lyrics ? 'on' : 'off'} · components ${st.componentsMissing ? 'missing' : 'ok'}`;
});

await check('vocal: voices labelled (gender, licence, size)', async () => {
  const bad = st.voices.filter((v) => !['male', 'female'].includes(v.gender) || !['commercial', 'noncommercial', 'unverified'].includes(v.use) || !(v.bytes > 1e6) || !v.note);
  if (bad.length) throw new Error(`incomplete: ${bad.map((v) => v.id)}`);
  const men = st.voices.filter((v) => v.gender === 'male').length, women = st.voices.filter((v) => v.gender === 'female').length;
  if (men < 2 || women < 2) throw new Error(`${men} male / ${women} female`);
  for (const v of st.voices) { const t = await M.vocalLicense(v.id); if (!t || t.length < 200) throw new Error(`no licence text for ${v.id}`); }
  return `${men} male, ${women} female; licence text for all`;
});

const yoko = st?.voices.find((v) => v.id === 'yoko');
if (yoko && !yoko.installed) {
  await check('vocal: download can be cancelled', async () => {
    const seen = [];
    const off = M.onVocalProgress((m) => { if (m.id === 'yoko') seen.push(m); });
    const p = M.vocalInstall('yoko');
    for (let i = 0; i < 100 && !seen.some((m) => m.done > 0); i++) await sleep(100);
    await M.vocalCancel();
    const r = await p;
    off();
    if (r.ok || !r.cancelled) throw new Error(`not cancelled: ${JSON.stringify(r)}`);
    if ((await V.voices(true)).voices.find((v) => v.id === 'yoko').installed) throw new Error('half a voice left installed');
    return `cancelled after ${seen.length} progress messages`;
  });
  await check('vocal: install Yoko through the app', async () => {
    const r = await M.vocalInstall('yoko');
    if (!r.ok) throw new Error(r.message);
    st = await V.voices(true);
    if (!st.voices.find((v) => v.id === 'yoko').installed) throw new Error('not installed after ok');
  });
}

const takes = {};
for (const v of (st?.voices || []).filter((x) => x.ready)) {
  for (const lang of v.langs) {
    await check(`sing: ${v.id} (${lang})`, async () => {
      const notes = phrase(BASE[v.gender]);
      const r = await V.singNotes({ notes, syllables: LYRICS[lang], voice: v.id });
      if (!r.ok) throw new Error(r.message);
      const c = await M.vocalCheck({ wav: r.wav, notes: notes.map(([t, d, n]) => ({ t, d, n })) });
      takes[`${v.id}:${lang}`] = { wav: r.wav, notes };
      const info = `${r.seconds}s, ${c.rms_db} dB, peak ${c.peak}, pitch ${c.notes_on_pitch} (median ${c.cents_median} cents)`;
      if (!c.ok) throw new Error(`not audible or off pitch: ${info} ${JSON.stringify(c.per_note)}`);
      return info;
    });
  }
}

// lyrics recognition on a sung take (as the AI window would on a separated vocal stem)
const score = (got, want) => got.filter((s, i) => s === want[i]).length;
if (st?.lyrics) {
  for (const [key, want] of [['hanami:ko', [...'반짝반짝작은별']], ['ritsu:ja', ['き', 'ら', 'き', 'ら', 'ひ', 'か', 'る']], ['pjs:ja', ['き', 'ら', 'き', 'ら', 'ひ', 'か', 'る']]]) {
    if (!takes[key]) continue;
    await check(`lyrics: ${key}`, async () => {
      const { wav, notes } = takes[key];
      const r = await V.recognizeLyrics({ name: 'take.wav', data: wav, notes });
      if (!r.ok) throw new Error(r.message);
      if (!r.text?.trim()) throw new Error('no text');
      // placement: a syllable (not a hold or a gap) on every note that should start one;
      // text: how many of those syllables are the ones sung (Whisper may mishear a vowel)
      const placed = r.notes.filter((s, i) => s && s !== '+' && want[i]).length;
      const hit = score(r.notes, want);
      const info = `"${r.text}" (${r.language}) · notes ${r.notes.join(' ')} · placed ${placed}/${want.length}, text ${hit}/${want.length}`;
      if (placed < Math.ceil(want.length * 0.85) || hit < Math.ceil(want.length * 0.4)) throw new Error(`lyrics off: ${info}`);
      return info;
    });
  }
} else R.push('SKIP lyrics: components not installed');

// the Studio vocal tab and singing a channel
A.settings.set({ studioTourSeen: true });
const S = A.studio;
const { TEMPLATES } = await imp('studio/templates.js');
const { PPQ } = await imp('studio/model.js');
let ch;
await check('studio: vocal channel tab', async () => {
  await S.open(); await sleep(400);
  S.setProject(TEMPLATES.empty.make()); await sleep(150);
  ch = S.rack.addVocal();
  const ready = st.voices.find((v) => v.ready && v.langs.includes('ko')) || st.voices.find((v) => v.ready);
  const p = S.proj;
  p.bpm = 120;
  const pat = p.patterns[0];
  let t = 0;
  // half beats: the 8-beat tune fits the 1-bar pattern
  pat.notes[ch.id] = MELODY.map((m, i) => { const n = { t, d: BEATS[i] * PPQ / 2 - 4, n: (ready?.gender === 'male' ? 55 : 67) + m, v: 100 }; t += BEATS[i] * PPQ / 2; return n; });
  S.edit(() => { ch.vocal = { voice: ready?.id, lyrics: ready?.langs.includes('ko') ? LYRICS.ko : LYRICS.ja }; });
  S.channelSheet.show(ch.id, 'vocal'); await sleep(2500);
  const body = S.channelSheet.body;
  const rows = body.querySelectorAll('.vo-row').length, cells = body.querySelectorAll('.vo-cell').length;
  if (rows !== st.voices.length) throw new Error(`${rows} voice rows`);
  if (cells !== MELODY.length) throw new Error(`${cells} note cells`);
  const nc = [...body.querySelectorAll('.vo-row .ai-nc')].map((e) => e.textContent);
  if (!nc.length) throw new Error('no licence badges');
  const first = body.querySelector('.vo-cell input')?.value;
  return `${rows} voices, ${cells} notes, first syllable "${first}", badges: ${[...new Set(nc)].join(', ')}`;
});
await check('studio: sing the channel', async () => {
  if (!st.voices.some((v) => v.ready)) return 'no voice ready: skipped';
  const r = await S.sing(ch);
  if (!r.ok) throw new Error(r.message);
  const audio = S.proj.channels.find((c) => c.kind === 'audio' && c.name.includes('(노래)'));
  if (!audio) throw new Error('no audio track');
  if (!S.proj.channels.find((c) => c.id === ch.id).mute) throw new Error('vocal channel not muted');
  await sleep(1500);
  const bar = S.statusEl?.textContent || '';
  if (/불러오지 못했/.test(bar)) throw new Error(`status: ${bar}`);
  S.channelSheet.show(ch.id, 'vocal'); await sleep(1500);
  const cells = S.channelSheet.body.querySelectorAll('.vo-cell').length;
  if (cells !== MELODY.length) throw new Error(`after singing the tab shows ${cells} notes`);
  return `${r.seconds}s on "${audio.name}", tab still shows ${cells} notes`;
});

console.log('E2E-BEGIN\n' + R.join('\n') + '\nE2E-END');
return [100];
