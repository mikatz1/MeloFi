// Checks MeloFi's MuseScore reader against MuseScore's own playback-model tests
// (event counts, note durations under tempo changes / rit. / tremolo, dynamics with hairpins).
//   node tools/test-playback.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMParser } from 'linkedom';

globalThis.DOMParser = DOMParser;
const here = path.dirname(fileURLToPath(import.meta.url));
const { parseMscx } = await import('../renderer/js/score/mscx.js');
const load = (name) => parseMscx(fs.readFileSync(path.join(here, 'fixtures', 'playback', `${name}.mscx`), 'utf8'), name);
const all = (song) => song.lines.flatMap((l) => l.notes).sort((a, b) => a.t - b.t || a.n - b.n);
const starts = (song) => new Set(all(song).map((n) => Math.round(n.t * 1e6))).size;

let ok = 0, total = 0;
const check = (label, pass, detail = '') => { total++; if (pass) ok++; console.log(`${pass ? 'ok  ' : 'FAIL'} ${label}${detail ? '  ' + detail : ''}`); };

for (const [name, want] of [['single_measure_repeat', 41], ['multi_measure_repeat', 33], ['dal_segno_al_fine', 36], ['da_capo_al_coda', 44], ['repeat_with_2_voltas', 28]]) {
  const got = starts(load(name));
  check(`${name}: ${want} events`, got === want, `got ${got}`);
}

// note durations (µs) with tempo marks, rit. and eighth-note tremolo over tied notes
{
  const q = (tempo) => 500000 / (tempo / 120);
  const rit = [100, 95, 90, 85, 80, 75, 70, 65];
  const want = [
    2 * q(100) + 4 * q(10) + 2 * q(100),
    rit.reduce((s, t) => s + q(t), 0),
    ...[100, 100, 100, 100, 10, 10, 10, 10, 10, 10, 10, 10, 100, 100, 100, 100].map((t) => q(t) * 0.5),
    ...rit.flatMap((t) => [q(t) * 0.5, q(t) * 0.5]),
    2 * q(100) + 4 * q(10) + 2 * q(100),
    rit.reduce((s, t) => s + q(t), 0),
  ];
  const got = all(load('tempo_changes_during_notes')).map((n) => n.d * 1e6);
  const bad = want.map((w, i) => [i, w, got[i]]).filter(([, w, g]) => g == null || Math.abs(w - g) > 2000);
  check(`tempo_changes_during_notes: ${want.length} durations within 2 ms`, got.length === want.length && !bad.length,
    `got ${got.length} notes${bad.length ? `, first mismatch #${bad[0][0]}: want ${(bad[0][1] / 1000).toFixed(1)}ms got ${bad[0][2] == null ? '-' : (bad[0][2] / 1000).toFixed(1)}ms` : ''}`);
}

// dynamics: p at 0 and 4q, f at 8q and 12q, pp at 16q (120 bpm: a quarter is 0.5 s)
{
  const notes = all(load('dynamics'));
  const at = (q) => notes.find((n) => Math.abs(n.t - q * 0.5) < 1e-3)?.v;
  const want = [[0, 49], [4, 49], [8, 96], [12, 96], [16, 33]];
  const got = want.map(([q]) => at(q));
  check('dynamics: p, p, f, f, pp at beats 0/4/8/12/16', want.every(([, v], i) => got[i] === v), `got ${got.join(', ')}`);
  const mid = at(6);
  check('dynamics: crescendo p→f halfway is between', mid > 49 && mid < 96, `beat 6 velocity ${mid}`);
}

console.log(`\n${ok}/${total} checks pass`);
