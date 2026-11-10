// Turns the downloaded SFZ libraries in instruments/_dl into app-ready packs:
//   instruments/<id>/manifest.json + s/<n>.flac
// Samples stay lossless and full length; every velocity layer is kept.
//
//   node tools/build-instruments.mjs            (all)
//   node tools/build-instruments.mjs splendid   (one)
//
// Needs ffmpeg/ffprobe on PATH (dev time only; the app itself doesn't).
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readSfz } from './sfz.mjs';
import { fetchLib } from './fetch-lib.mjs';
import { vcslMap } from './vcsl-map.mjs';
import { POP_LIBS } from './libs-pop.mjs';
import { TAGS } from './tags.mjs';
import { retune } from './retune.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DL = path.join(ROOT, 'instruments', '_dl');

export const LIBS = {
  splendid: {
    order: 1, name: 'Splendid Grand', model: 'Steinway', maker: 'AKAI · SFZ by kinwie',
    license: 'Public Domain', url: 'https://github.com/sfzinstruments/SplendidGrandPiano',
    sfz: 'SplendidGrandPiano-master/Splendid Grand Piano.sfz',
  },
  salamander: {
    order: 2, name: 'Salamander Grand', model: 'Yamaha C5', maker: 'Alexander Holm',
    license: 'CC BY 3.0', url: 'https://github.com/sfzinstruments/SalamanderGrandPiano',
    sfz: 'SalamanderGrandPiano-master/Salamander Grand Piano V3.sfz',
  },
  maestro: {
    order: 3, name: 'Maestro Concert Grand', model: 'Yamaha CF-3', maker: 'Mats Helgesson',
    license: 'Freeware (author permission)', url: 'https://github.com/sfzinstruments/MatsHelgesson.MaestroConcertGrandPiano',
    sfz: 'MatsHelgesson.MaestroConcertGrandPiano-master/Maestro Concert Grand.sfz',
  },
  headroom: {
    order: 4, name: 'Headroom Piano', model: 'Yamaha C3', maker: 'Bengt Nilsson',
    license: 'CC BY 4.0', url: 'https://github.com/sfzinstruments/BengtNilsson.HeadroomPiano',
    sfz: 'BengtNilsson.HeadroomPiano-master/Headroom Piano (NoFX).sfz',
    filter: (r) => r.group === '1', // close mics
  },
  rhodes: {
    order: 5, name: 'jRhodes3d', model: 'Rhodes Mark I Stage 73', maker: 'Jeff Learman',
    license: 'CC BY-NC 4.0 (samples)', url: 'https://github.com/sfzinstruments/jlearman.jRhodes3d',
    sfz: 'jlearman.jRhodes3d-master/jRhodes3d-st-no-xfade.sfz', strings: false,
  },
  scary: {
    order: 6, name: 'Scarypiano', model: 'Processed upright', maker: 'Karoryfer Samples',
    license: 'CC0', url: 'https://github.com/sfzinstruments/karoryfer.scarypiano',
    sfz: 'karoryfer.scarypiano-master/Programs/Scarypiano.sfz',
    filter: (r) => !(r.lv === 1 && r.hv === 127), // drop the always-on "scarier" stacks
  },
  // ---- beyond the piano (fetched with tools/fetch-lib.mjs when built) ----
  wurlitzer: {
    order: 10, family: 'keys', name: 'Wurlitzer EP200', model: '전자 피아노', maker: 'Greg Sullivan · SFZ by kinwie',
    license: 'CC BY 3.0', url: 'https://github.com/sfzinstruments/GregSullivan.E-Pianos',
    sfz: 'GregSullivan.E-Pianos-master/Wurlitzer EP200/Wurlitzer EP200.sfz', strings: false,
  },
  harpsichord: {
    order: 11, family: 'keys', name: 'Harpsichord', model: '프렌치 하프시코드', maker: 'Versilian Studios (VCSL)',
    license: 'CC0', url: 'https://github.com/sgossner/VCSL', strings: false,
    sfz: 'VCSL-master/_melofi/harpsichord.sfz',
    gen: (blobs) => vcslMap(blobs, 'Chordophones/Zithers/Harpsichord, French/Sustains/', /^Harpsi2_Normal_([A-G]#?-?\d)_rr1_Main\.wav$/, { c3: true, release: 0.35, file: 'harpsichord' }),
  },
  synth: {
    // the patch sounds an octave above the key it was sampled from (checked with tools/check-pitch.mjs)
    order: 12, family: 'synth', name: 'TX81Z Clavisynth', model: 'FM 신디사이저', maker: 'Versilian Studios (VCSL)',
    license: 'CC0', url: 'https://github.com/sgossner/VCSL', strings: false,
    sfz: 'VCSL-master/_melofi/clavisynth.sfz',
    gen: (blobs) => vcslMap(blobs, 'Electrophones/TX81Z/Clavisynth/', /^Clavisynth_([A-G]#?-?\d)_vl(\d)\.wav$/, { c3: true, shift: 12, release: 0.3, file: 'clavisynth' }),
  },
  harp: {
    order: 13, family: 'strings', name: 'Concert Harp', model: '하프', maker: 'Versilian Studios (VCSL)',
    license: 'CC0', url: 'https://github.com/sgossner/VCSL', strings: false,
    sfz: 'VCSL-master/_melofi/harp.sfz',
    gen: (blobs) => vcslMap(blobs, 'Chordophones/Composite Chordophones/Concert Harp/', /^KSHarp_([A-G]#?-?\d)_(p|mf|f)\d\.wav$/, { layers: ['p', 'mf', 'f'], release: 0.8, file: 'harp' }),
  },
  // ---- for the studio: winds, mallets, organ, strings, acoustic drums ----
  // (VCSL names these with C3 = middle C; every mapping checked with tools/check-pitch.mjs)
  organ: {
    order: 50, family: 'organ', name: 'Pipe Organ', model: '파이프 오르간', maker: 'Versilian Studios (VCSL)',
    license: 'CC0', url: 'https://github.com/sgossner/VCSL', strings: false,
    sfz: 'VCSL-master/_melofi/organ.sfz',
    gen: (blobs) => vcslMap(blobs, 'Aerophones/Edge-blown Aerophones/Pipe Organ/Loud/', /^Rode_Man3Open_([A-G]#?-?\d)\.wav$/, { release: 0.5, file: 'organ' }),
  },
  tenorsax: {
    order: 60, family: 'winds', name: 'Tenor Saxophone', model: '테너 색소폰', maker: 'Versilian Studios (VCSL)',
    license: 'CC0', url: 'https://github.com/sgossner/VCSL', strings: false,
    sfz: 'VCSL-master/_melofi/tenorsax.sfz',
    gen: (blobs) => vcslMap(blobs, 'Aerophones/Reed Aerophones/Tenor Saxophone/Non-Vibrato/', /^BrettTenor_NV_Main_([A-G]#?-?\d)_vl(\d)_rr1\.wav$/, { release: 0.25, file: 'tenorsax', c3: true }),
  },
  recorder: {
    order: 61, family: 'winds', name: 'Alto Recorder', model: '리코더', maker: 'Versilian Studios (VCSL)',
    license: 'CC0', url: 'https://github.com/sgossner/VCSL', strings: false,
    sfz: 'VCSL-master/_melofi/recorder.sfz',
    gen: (blobs) => vcslMap(blobs, 'Aerophones/Edge-blown Aerophones/Baroque Alto Recorder/Sustain/', /^AltRecorder_Sus_([A-G]#?-?\d)_rr1_Main\.wav$/, { release: 0.15, file: 'recorder', c3: true }),
  },
  harmonica: {
    order: 62, family: 'winds', name: 'Harmonica', model: '하모니카', maker: 'Versilian Studios (VCSL)',
    license: 'CC0', url: 'https://github.com/sgossner/VCSL', strings: false,
    sfz: 'VCSL-master/_melofi/harmonica.sfz',
    gen: (blobs) => vcslMap(blobs, 'Aerophones/Free Aerophones/Harmonica-Hohner-Special20-C/Sustains/Normal/', /^Hohner-Special20_Normal_([A-G]#?-?\d)\.wav$/, { release: 0.15, file: 'harmonica', c3: true }),
  },
  vibraphone: {
    order: 70, family: 'mallets', name: 'Vibraphone', model: '비브라폰', maker: 'Versilian Studios (VCSL)',
    license: 'CC0', url: 'https://github.com/sgossner/VCSL', strings: false,
    sfz: 'VCSL-master/_melofi/vibraphone.sfz',
    gen: (blobs) => vcslMap(blobs, 'Idiophones/Struck Idiophones/Vibraphone/Hard Mallets/', /^Vibes_hard_([A-G]#?-?\d)_v(\d)_rr1_Main\.wav$/, { release: 0.8, file: 'vibraphone', c3: true }),
  },
  marimba: {
    order: 71, family: 'mallets', name: 'Marimba', model: '마림바', maker: 'Versilian Studios (VCSL)',
    license: 'CC0', url: 'https://github.com/sgossner/VCSL', strings: false,
    sfz: 'VCSL-master/_melofi/marimba.sfz',
    gen: (blobs) => vcslMap(blobs, 'Idiophones/Struck Idiophones/Marimba/', /^Marimba_hit_Outrigger_([A-G]#?-?\d)_(soft|med|loud)_01\.wav$/, { layers: ['soft', 'med', 'loud'], release: 0.4, file: 'marimba', c3: true }),
  },
  glockenspiel: {
    order: 72, family: 'mallets', name: 'Glockenspiel', model: '글로켄슈필', maker: 'Versilian Studios (VCSL)',
    license: 'CC0', url: 'https://github.com/sgossner/VCSL', strings: false,
    sfz: 'VCSL-master/_melofi/glockenspiel.sfz',
    gen: (blobs) => vcslMap(blobs, 'Idiophones/Struck Idiophones/Glockenspiel/', /^glock_loud_([A-G]#?-?\d)_01\.wav$/, { release: 0.8, file: 'glockenspiel', c3: true }),
  },
  xylophone: {
    order: 73, family: 'mallets', name: 'Xylophone', model: '실로폰', maker: 'Versilian Studios (VCSL)',
    license: 'CC0', url: 'https://github.com/sgossner/VCSL', strings: false,
    sfz: 'VCSL-master/_melofi/xylophone.sfz',
    gen: (blobs) => vcslMap(blobs, 'Idiophones/Struck Idiophones/Xylophone/Hard Mallets/', /^Xylo_Hard_([A-G]#?-?\d)_(pp|ff)_01_far\.wav$/, { layers: ['pp', 'ff'], release: 0.3, file: 'xylophone', c3: true }),
  },
  cello: {
    order: 32, family: 'strings', name: 'Cello', model: '첼로', maker: 'Karoryfer Samples & Bigcat Instruments',
    license: 'CC0', url: 'https://github.com/sfzinstruments/karoryfer-bigcat.cello',
    sfz: 'karoryfer-bigcat.cello-master/Programs/01- Bowed (velocity layer).sfz', strings: false,
    filter: (r) => r.lo < 84, // noises parked on the top keys
    shift: 12, // mapped an octave low (lowest key C1; a cello's lowest string is C2) — checked by spectrum
  },
  acousticdrums: {
    order: 42, family: 'drums', name: "Sam's Sonor Kit", model: '어쿠스틱 드럼', maker: 'Sam Greene · SFZ by kinwie',
    license: 'CC BY-SA 4.0', url: 'https://github.com/sfzinstruments/SamsSonor',
    sfz: 'SamsSonor-master/SamsSonor.sfz', strings: false, kit: true,
  },
  acoustic: {
    order: 20, family: 'guitar', name: 'Shinyguitar Acoustic', model: '어쿠스틱 기타', maker: 'Karoryfer Samples',
    license: 'CC0', url: 'https://github.com/sfzinstruments/karoryfer.shinyguitar',
    sfz: 'karoryfer.shinyguitar-master/Programs/main.sfz', strings: false,
    cc: { 100: 127 }, // Blend all the way to the mic'd acoustic signal rather than the pickup
    vars: { sample_dir: '../Samples' }, // normally set by the bank file
    filter: (r) => !(r.lv === 1 && r.hv === 127), // fret / release noises
  },
  electric: {
    order: 21, family: 'guitar', name: 'Green Guitar', model: '일렉 기타', maker: 'Karoryfer Samples',
    license: 'CC0', url: 'https://github.com/sfzinstruments/karoryfer.black-and-green-guitars',
    sfz: 'karoryfer.black-and-green-guitars-main/Programs/04-green_twang.sfz', strings: false,
  },
  ebass: {
    order: 30, family: 'bass', name: 'Growlybass', model: '일렉 베이스', maker: 'Karoryfer Samples',
    license: 'CC0', url: 'https://github.com/sfzinstruments/karoryfer.growlybass',
    sfz: 'karoryfer.growlybass-master/growlybass_clean.sfz', strings: false,
    filter: (r) => !/scrape/i.test(r.file), // string scrapes parked on the top keys
    shift: -12, // mapped like bass notation (an octave above how it sounds); MeloFi plays sounding pitch
  },
  upright: {
    order: 31, family: 'bass', name: 'Double Bass Pizz', model: '콘트라베이스 피치카토', maker: 'D. Smolken',
    license: 'CC0', url: 'https://github.com/sfzinstruments/dsmolken.double-bass',
    sfz: 'dsmolken.double-bass-master/d_smolken_rubner_bass_pizz.sfz', strings: false,
    filter: (r) => !(r.lv === 1 && r.hv === 127),
  },
};

Object.assign(LIBS, POP_LIBS);

function run(cmd, args) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { windowsHide: true });
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (c) => (c === 0 ? res({ out, err }) : rej(new Error(err.slice(-600)))));
  });
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } }));
}

// Make key ranges contiguous inside each velocity layer (fills gaps at the extremes).
export function respanKeys(regions) {
  const byLayer = new Map();
  for (const r of regions) { const k = `${r.lv}-${r.hv}`; if (!byLayer.has(k)) byLayer.set(k, []); byLayer.get(k).push(r); }
  const out = [];
  for (const list of byLayer.values()) {
    list.sort((a, b) => a.lo - b.lo);
    list.forEach((r, i) => {
      const lo = i === 0 ? Math.min(r.lo, 21) : Math.max(r.lo, list[i - 1].hi + 1);
      const hi = i === list.length - 1 ? Math.max(r.hi, 108) : Math.max(r.hi, list[i + 1].lo - 1);
      out.push({ ...r, lo, hi });
    });
  }
  return out;
}

// Velocity bands must tile 1..127 with no holes.
// drum kits: every key has its own velocity layers; tile each key's bands to 1..127 separately
export function tileVelocityPerKey(regions) {
  const byKey = new Map();
  for (const r of regions) { const k = `${r.lo}-${r.hi}`; if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(r); }
  return [...byKey.values()].flatMap((list) => tileVelocity(list));
}

export function tileVelocity(regions) {
  const bands = [...new Set(regions.map((r) => r.lv))].sort((a, b) => a - b);
  const hiOf = new Map(regions.map((r) => [r.lv, r.hv]));
  const remap = new Map();
  bands.forEach((lv, i) => remap.set(lv, [i === 0 ? 1 : lv, i === bands.length - 1 ? 127 : Math.max(hiOf.get(lv), bands[i + 1] - 1)]));
  return regions.map((r) => { const [lv, hv] = remap.get(r.lv); return { ...r, lv, hv }; });
}

async function probe(file) {
  const { out } = await run('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=sample_rate,channels,duration_ts,duration', '-of', 'json', file]);
  const s = JSON.parse(out).streams[0];
  return { rate: +s.sample_rate, ch: +s.channels, dur: +s.duration };
}

async function peakDb(file) {
  const { err } = await run('ffmpeg', ['-hide_banner', '-i', file, '-af', 'volumedetect', '-f', 'null', '-']);
  const m = /max_volume: (-?[\d.]+) dB/.exec(err);
  return m ? parseFloat(m[1]) : 0;
}

async function build(id) {
  const cfg = LIBS[id];
  const sfzPath = path.join(DL, cfg.sfz);
  const repo = cfg.url.replace('https://github.com/', '');
  {
    // pull the library (text + the audio this program uses) from GitHub
    const program = path.relative(path.join(DL, cfg.sfz.split('/')[0]), sfzPath).split(path.sep).join('/');
    await fetchLib(repo, [program], cfg.gen, { cc: cfg.cc, vars: cfg.vars });
  }
  if (!fs.existsSync(sfzPath)) { console.log(`skip ${id}: ${cfg.sfz} not downloaded`); return; }

  let regions = readSfz(sfzPath, { cc: cfg.cc, vars: cfg.vars }).filter((r) => r.hi >= 0 && r.lo <= 127);
  if (cfg.filter) regions = regions.filter(cfg.filter);
  if (cfg.shift) regions = regions.map((r) => ({ ...r, lo: r.lo + cfg.shift, hi: r.hi + cfg.shift, center: r.center + cfg.shift }));
  regions = cfg.kit ? tileVelocityPerKey(regions) : tileVelocity(respanKeys(regions));

  const outDir = path.join(ROOT, 'instruments', id);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(outDir, 's'), { recursive: true });

  const files = [...new Set(regions.map((r) => r.file))].sort();
  const info = new Map();
  let bytes = 0, seconds = 0;
  await pool(files, 8, async (file, n) => {
    const name = `${String(n).padStart(4, '0')}.flac`;
    const dst = path.join(outDir, 's', name);
    if (file.toLowerCase().endsWith('.flac')) fs.copyFileSync(file, dst);
    else await run('ffmpeg', ['-hide_banner', '-y', '-i', file, '-c:a', 'flac', '-compression_level', '8', dst]);
    const pr = await probe(dst);
    info.set(file, { name, ...pr });
    bytes += fs.statSync(dst).size;
    seconds += pr.dur * pr.ch;
  });

  // Level: middle C at velocity ~96 peaks near -14 dBFS, so chords have headroom
  // and the safety limiter almost never has to work.
  const ref = regions.find((r) => 60 >= r.lo && 60 <= r.hi && 96 >= r.lv && 96 <= r.hv) || regions[0];
  const pk = await peakDb(path.join(outDir, 's', info.get(ref.file).name));
  const norm = Math.pow(10, (-14 - (pk + 20 * Math.log10(ref.gain))) / 20);

  const samples = {};
  for (const f of files) { const i = info.get(f); samples[`s/${i.name}`] = { rate: i.rate, ch: i.ch, dur: +i.dur.toFixed(3) }; }

  const top = cfg.sfz.split('/')[0];
  const branch = top.slice(top.lastIndexOf('-') + 1);
  const srcFiles = {};
  let srcBytes = 0;
  for (const f of files) {
    srcFiles[`s/${info.get(f).name}`] = path.relative(path.join(DL, top), f).split(path.sep).join('/');
    srcBytes += fs.statSync(f).size;
  }
  const manifest = {
    name: cfg.name, model: cfg.model, maker: cfg.maker, license: cfg.license, url: cfg.url, order: cfg.order,
    credit: `${cfg.name} — ${cfg.maker}. ${cfg.license}. ${cfg.url}`,
    gain: +norm.toFixed(5),
    strings: cfg.strings !== false,
    samples,
    family: cfg.family || 'piano',
    tags: cfg.tags || TAGS[id]?.[0] || [],
    use: cfg.use || TAGS[id]?.[1] || '',
    ...(cfg.keys ? { keys: cfg.keys } : {}),
    source: { repo, branch, archive: `https://codeload.github.com/${repo}/zip/refs/heads/${branch}`, root: top, bytes: srcBytes, files: srcFiles },
    regions: regions
      .sort((a, b) => a.lo - b.lo || a.lv - b.lv)
      .map((r) => ({
        s: `s/${info.get(r.file).name}`, lo: r.lo, hi: r.hi, c: r.center, t: Math.round(r.tune * 10) / 10,
        lv: r.lv, hv: r.hv, g: +r.gain.toFixed(5), r: +r.release.toFixed(3), off: r.offsetSamples || 0,
      })),
  };
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest));
  if (cfg.retune) retune(id);
  const layers = new Set(regions.map((r) => r.lv)).size;
  console.log(`${id}: ${layers} layers, ${files.length} samples, ${(bytes / 1e6).toFixed(0)} MB FLAC, ${(seconds / 60).toFixed(1)} ch-min audio, gain ${manifest.gain}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const only = process.argv.slice(2);
  for (const id of Object.keys(LIBS)) if (!only.length || only.includes(id)) await build(id);
}
