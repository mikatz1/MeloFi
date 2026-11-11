// Instruments whose samples are not loose files on GitHub: archives (zip / 7z / tar.xz / tar.bz2)
// and SoundFont presets, downloaded by the app from the original publisher and unpacked or
// converted on the user's PC (lib/install-source.js). Nothing is re-hosted. See docs/archive-import.md.
//
// Each entry is a normal LIBS entry for tools/build-instruments.mjs plus two hooks:
//   prepare(id)        puts an SFZ program and its samples under instruments/_dl/<root>/ for the build
//   sourceFor(files)   the manifest's `source` block: where the app gets each sample from
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import sf2 from '../lib/sf2.js';
import unpack from '../lib/unpack/index.js';
import zip from '../lib/unpack/zip.js';
import wav from '../lib/wav.js';
import { readSfz } from './sfz.mjs';
import { fetchLib } from './fetch-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DL = path.join(ROOT, 'instruments', '_dl');
const ARC = path.join(DL, '_archives');
const H = { 'User-Agent': 'MeloFi-build' };

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const sha256File = (f) => { const h = crypto.createHash('sha256'); const fd = fs.openSync(f, 'r'); const b = Buffer.alloc(1 << 22); let n; while ((n = fs.readSync(fd, b, 0, b.length)) > 0) h.update(b.subarray(0, n)); fs.closeSync(fd); return h.digest('hex'); };

// download a publisher's file once into instruments/_dl/_archives (checked against the pinned hash)
async function ensureFile(src) {
  const dst = path.join(ARC, src.file);
  if (!fs.existsSync(dst)) {
    fs.mkdirSync(ARC, { recursive: true });
    console.log(`  downloading ${src.url}`);
    const r = await fetch(src.url, { headers: H });
    if (!r.ok) throw new Error(`${r.status} ${src.url}`);
    const out = fs.createWriteStream(dst + '.part');
    for await (const c of r.body) out.write(c);
    await new Promise((res) => out.end(res));
    fs.renameSync(dst + '.part', dst);
  }
  const size = fs.statSync(dst).size;
  const h = sha256File(dst);
  if (src.sha256 && h !== src.sha256) throw new Error(`${src.file}: sha256 ${h} differs from the pinned ${src.sha256} — the publisher changed the file`);
  if (!src.sha256) console.log(`  ${src.file}: sha256 ${h} (pin it in tools/libs-archive.mjs)`);
  return { file: dst, size, sha256: h };
}

// one file, or one file cut into parts (split release assets): reads [a, b) of the whole
async function rangeReader(urls) {
  const list = [].concat(urls);
  const parts = [];
  for (const url of list) {
    const head = await fetch(url, { method: 'HEAD', headers: H });
    if (!head.ok) throw new Error(`${head.status} ${url}`);
    parts.push({ url, size: +head.headers.get('content-length') });
  }
  const one = async (url, a, b) => {
    for (let k = 0; ; k++) {
      try {
        const r = await fetch(url, { headers: { ...H, Range: `bytes=${a}-${b - 1}` } });
        if (r.status !== 206) throw new Error(`no range support (${r.status}) at ${url}`);
        return Buffer.from(await r.arrayBuffer());
      } catch (e) { if (k >= 3) throw e; await new Promise((res) => setTimeout(res, 1000 * (k + 1))); }
    }
  };
  const read = async (a, b) => {
    const out = [];
    let base = 0;
    for (const part of parts) {
      const lo = Math.max(a, base), hi = Math.min(b, base + part.size);
      if (lo < hi) out.push(await one(part.url, lo - base, hi - base));
      base += part.size;
    }
    return Buffer.concat(out);
  };
  return { size: parts.reduce((t, x) => t + x.size, 0), parts, read };
}

// GitHub release assets (one zip, or a zip split as name.zip.001, .002, …)
const releaseUrls = (repo, tag, assets) => [].concat(assets).map((n) => `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(n)}`);

// ---------------- archives ----------------
// a: { url, file, format, sha256, size, sfz (path of the program inside the archive), remote (zip only:
//      fetch just the entries the program needs with Range requests, at build time as in the app) }
function archive(key, a, cfg) {
  const root = `arc-${key}`;
  const base = path.join(DL, root);
  const indexFile = path.join(base, '.melofi-zip.json');
  return {
    strings: false, ...cfg,
    sfz: a.stereo ? `${root}/_melofi/${key}.sfz` : `${root}/${a.sfz}`,
    // a program may name samples its archive doesn't contain (Salamander's ALL.sfz): leave those regions out
    filter: (r) => fs.existsSync(r.file) && (cfg.filter ? cfg.filter(r) : true),
    async prepare() {
      await fetchOrUnpack();
      if (a.stereo) mergeStereo(base, a, cfg, key);
    },
    async sourceFor(files) {
      const merged = a.stereo ? JSON.parse(fs.readFileSync(path.join(base, '_melofi', 'stereo.json'), 'utf8')) : {};
      // the app falls back to the whole archive when a host refuses Range, and checks it against this
      // (GitHub release assets carry no published hash; every sample made from them is still checked)
      if (!a.sha256 && !a.release) throw new Error(`${key}: pin the archive's sha256 in tools/libs-archive.mjs first`);
      const info = a.remote ? JSON.parse(fs.readFileSync(indexFile, 'utf8')) : null;
      const out = { kind: 'archive', ...(info?.parts?.length > 1 ? { parts: info.parts } : { url: a.url || info?.parts[0].url }), format: a.format,
        size: info ? info.parts.reduce((t, x) => t + x.size, 0) : a.size, sha256: a.sha256 || null, files: {}, sha: {} };
      const entries = [];
      for (const [name, rel] of Object.entries(files)) {
        out.sha[name] = sha256(wav.playable(fs.readFileSync(path.join(base, rel)))); // as the app writes it (AIFF -> WAV)
        if (merged[rel]) { out.files[name] = { stereo: merged[rel].files, frames: merged[rel].frames }; entries.push(...merged[rel].files); }
        else { out.files[name] = rel; entries.push(rel); }
      }
      if (a.remote) {
        const index = info.entries;
        out.zip = {};
        let bytes = 0;
        for (const e of entries) { out.zip[e] = index[e]; bytes += index[e][1]; }
        out.bytes = bytes;
      } else out.bytes = a.size;
      return out;
    },
  };
  async function fetchOrUnpack() {
    {
      if (a.remote) {
        // zip on a host with Range support: central directory, then the program, then its samples
        const rr = await rangeReader(a.release ? releaseUrls(a.release.repo, a.release.tag, a.release.assets) : a.url);
        if (a.size && rr.size !== a.size) throw new Error(`${a.url}: size ${rr.size}, expected ${a.size} — the publisher changed the file`);
        if (a.sfzFrom) {
          // the program lives in the library's git tree, its audio in the release zip: put the program
          // where its relative sample paths point into the unpacked zip
          const { base: tree } = await fetchLib(a.sfzFrom.repo, []);
          fs.mkdirSync(path.dirname(path.join(base, a.sfz)), { recursive: true });
          const text = fs.readFileSync(path.join(tree, a.sfzFrom.path), 'utf8');
          fs.writeFileSync(path.join(base, a.sfz), a.sfzFrom.transform ? a.sfzFrom.transform(text) : text);
        }
        const entries = await zip.listZip(rr.read, rr.size);
        const byName = new Map(entries.map((e) => [e.name, e]));
        const index = fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, 'utf8')).entries || {} : {};
        const get = async (name) => {
          const e = byName.get(name);
          if (!e) throw new Error(`${name} not in ${a.url}`);
          const dst = path.join(base, name);
          if (!index[name]) {
            const local = await rr.read(e.off, e.off + 30);
            const start = e.off + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
            index[name] = [start, e.csize, e.size, e.method, e.crc];
          }
          if (!fs.existsSync(dst)) {
            const [start] = index[name];
            const data = zip.inflateEntry(e, await rr.read(start, start + e.csize));
            fs.mkdirSync(path.dirname(dst), { recursive: true });
            fs.writeFileSync(dst, data);
          }
        };
        for (const e of entries) if (/\.(sfz|sfzh|txt)$/i.test(e.name)) await get(e.name);
        const need = [...new Set(readSfz(path.join(base, a.sfz), { cc: cfg.cc, vars: cfg.vars }).map((r) => path.relative(base, r.file).split(path.sep).join('/')))];
        let n = 0;
        const list = need.filter((f) => byName.has(f));
        await Promise.all(Array.from({ length: 6 }, async () => { while (n < list.length) await get(list[n++]); }));
        fs.writeFileSync(indexFile, JSON.stringify({ parts: rr.parts, entries: index }));
        return;
      }
      const f = await ensureFile(a);
      if (f.size !== a.size) throw new Error(`${a.file}: size ${f.size}, expected ${a.size}`);
      if (!fs.existsSync(path.join(base, a.sfz))) {
        // unpack everything with MeloFi's own extractor (the same code the app runs)
        const names = unpack.extractAll(f.file, a.format, base);
        console.log(`  unpacked ${names.length} files from ${a.file}`);
      }
    }
  }
}

// Programs that pan a left and a right mono file onto the same key (MeloFi plays one region per
// note): join each pair into one stereo file, bit for bit. Their loops start at different points,
// so pick a common loop start (same end) where both channels continue smoothly — sample value and
// slope both match — keeping at least a second of loop. Writes _melofi/<key>.sfz + stereo.json.
function mergeStereo(base, a, cfg, key) {
  const outDir = path.join(base, '_melofi');
  fs.mkdirSync(outDir, { recursive: true });
  const regs = readSfz(path.join(base, a.sfz), { cc: cfg.cc, vars: cfg.vars });
  const groups = new Map();
  for (const r of regs) {
    const m = a.stereo.exec(path.basename(r.file));
    const k = `${r.lo}-${r.hi}-${r.lv}-${r.hv}`;
    if (!groups.has(k)) groups.set(k, {});
    groups.get(k)[m ? m[2] : 'M'] = r;
  }
  const map = {}, lines = [`// ${key}: left/right files of ${a.sfz} joined into stereo files by tools/libs-archive.mjs`];
  for (const g of groups.values()) {
    const L = g.L, R = g.R;
    if (!L || !R) throw new Error(`${key}: unpaired channel ${(L || R || g.M).file}`);
    const lb = fs.readFileSync(L.file), rb = fs.readFileSync(R.file);
    const lw = wav.parseWav(lb), rw = wav.parseWav(rb);
    const n = Math.min(lw.frames, rw.frames);
    const merged = wav.interleaveWavs(lb, rb, n);
    let loop = null;
    if (L.loop && R.loop) {
      const lf = wav.channelFloats(lw), rf = wav.channelFloats(rw);
      const e = Math.min(L.loop[1], R.loop[1], n - 1);
      const meanStep = (x, from) => { let s = 0; for (let i = from + 1; i < e; i++) s += Math.abs(x[i] - x[i - 1]); return s / Math.max(1, e - from - 1) + 1e-9; };
      const mL = meanStep(lf, L.loop[0]), mR = meanStep(rf, R.loop[0]);
      const minLen = Math.min(lw.rate, Math.floor((e - Math.max(L.loop[0], R.loop[0])) / 2));
      let best = -1, bestCost = Infinity;
      for (let s = Math.max(L.loop[0], R.loop[0], 1); s <= e - minLen; s++) {
        const c = Math.abs(lf[s] - lf[e]) / mL + Math.abs(rf[s] - rf[e]) / mR
          + Math.abs((lf[s] - lf[s - 1]) - (lf[e] - lf[e - 1])) / mL + Math.abs((rf[s] - rf[s - 1]) - (rf[e] - rf[e - 1])) / mR;
        if (c < bestCost) { bestCost = c; best = s; }
      }
      loop = [best, e];
    }
    const name = path.basename(L.file).replace(a.stereo, '$1') + '.wav';
    const rel = `_melofi/${name}`;
    fs.writeFileSync(path.join(base, rel), merged);
    map[rel] = { files: [L, R].map((r) => path.relative(base, r.file).split(path.sep).join('/')), frames: n, loop };
    const ops = [`sample=${name}`, `lokey=${L.lo}`, `hikey=${L.hi}`, `pitch_keycenter=${L.center}`, `lovel=${L.lv}`, `hivel=${L.hv}`,
      `tune=${L.tune}`, `volume=${+(20 * Math.log10(L.gain)).toFixed(3)}`, `ampeg_release=${L.release}`];
    if (L.attack) ops.push(`ampeg_attack=${L.attack}`);
    if (loop) ops.push('loop_mode=loop_continuous', `loop_start=${loop[0]}`, `loop_end=${loop[1]}`);
    lines.push(`<region> ${ops.join(' ')}`);
  }
  fs.writeFileSync(path.join(outDir, `${key}.sfz`), lines.join('\n') + '\n');
  fs.writeFileSync(path.join(outDir, 'stereo.json'), JSON.stringify(map));
}

// ---------------- SoundFont presets ----------------
// s: { url, file, sha256, size, bank, program }
function soundfont(key, s, cfg) {
  const root = `sf2-${key}`;
  const base = path.join(DL, root);
  const planFile = path.join(base, 'plan.json');
  return {
    strings: false, ...cfg,
    sfz: `${root}/${key}.sfz`,
    async prepare() {
      const f = await ensureFile(s);
      const fd = fs.openSync(f.file, 'r');
      const read = (a, b) => { const buf = Buffer.alloc(Math.min(b, f.size) - a); fs.readSync(fd, buf, 0, buf.length, a); return buf; };
      try {
        const sf = await sf2.readSf2(read, f.size);
        const plan = s.premix ? sf2.premixPreset(sf, s.bank, s.program) : sf2.planPreset(sf, s.bank, s.program);
        if (plan.layers > 1) throw new Error(`${key}: preset ${s.bank}:${s.program} sounds ${plan.layers} zones at once — MeloFi plays one region per note, so it would not sound as designed`);
        fs.rmSync(base, { recursive: true, force: true });
        fs.mkdirSync(base, { recursive: true });
        const specs = {};
        const out = new Map();
        plan.files.forEach((spec, i) => {
          const name = `${String(i).padStart(4, '0')}.wav`;
          const { wav, loop, scale } = sf2.renderFile(spec, sf.smpl.off, sf.sm24?.off ?? null, (off, len) => read(off, off + len));
          fs.writeFileSync(path.join(base, name), wav);
          const { key: _k, name: sampleName, ...rest } = spec;
          specs[name] = { ...rest, sample: sampleName, sha256: sha256(wav) };
          out.set(spec.key, { name, loop, scale });
        });
        const lines = [`// ${plan.name} — bank ${s.bank} program ${s.program} of ${s.file}, converted by tools/libs-archive.mjs`];
        for (const r of plan.regions) {
          const o = out.get(r.file);
          const ops = [`sample=${o.name}`, `lokey=${r.lo}`, `hikey=${r.hi}`, `pitch_keycenter=${r.center}`, `lovel=${r.lv}`, `hivel=${r.hv}`,
            `tune=${+r.tune.toFixed(2)}`, `volume=${+(20 * Math.log10(r.gain / o.scale)).toFixed(3)}`, `ampeg_release=${+r.release.toFixed(3)}`]; // a premix scaled down to avoid clipping gets it back here
          if (r.attack > 0.02) ops.push(`ampeg_attack=${+r.attack.toFixed(3)}`);
          if (o.loop) ops.push('loop_mode=loop_continuous', `loop_start=${o.loop[0]}`, `loop_end=${o.loop[1]}`);
          lines.push(`<region> ${ops.join(' ')}`);
        }
        fs.writeFileSync(path.join(base, `${key}.sfz`), lines.join('\n') + '\n');
        const ranges = sf2.rangesFor(sf, plan.files).map(([a, b]) => [a, b, sha256(read(a, b))]);
        fs.writeFileSync(planFile, JSON.stringify({ smpl: sf.smpl.off, sm24: sf.sm24?.off ?? null, ranges, specs, size: f.size, sha256: f.sha256 }));
      } finally { fs.closeSync(fd); }
    },
    async sourceFor(files) {
      const p = JSON.parse(fs.readFileSync(planFile, 'utf8'));
      const used = {};
      for (const [name, wav] of Object.entries(files)) used[name] = p.specs[wav];
      // only the ranges the kept files need
      const need = sf2.rangesFor({ smpl: { off: p.smpl }, sm24: p.sm24 == null ? null : { off: p.sm24 } }, Object.values(used));
      const ranges = p.ranges.filter(([a, b]) => need.some(([x, y]) => x < b && y > a));
      return { kind: 'sf2', url: s.url, size: p.size, sha256: p.sha256, smpl: p.smpl, sm24: p.sm24, bytes: ranges.reduce((t, [a, b]) => t + b - a, 0), ranges, files: used };
    },
  };
}

// ---------------- light drum kits ----------------
// Multi-mic kits are 1-1.5 GB because every hit is stored once per microphone, with many velocity
// layers. MeloFi plays one region per note, so per key we keep one microphone — the drum's own
// close mic, or the overheads for cymbals and anything without one — and at most `layers`
// velocity layers spread over the range (always the softest and the loudest). The samples kept are
// the originals, untouched; there are just fewer of them. Round robins are already reduced to the
// first by the SFZ reader. The result is written as an SFZ program next to the library and built
// like any GitHub library.
//   k: { repo, program, mic(r, key) -> rank (lower = preferred, Infinity = never), layers }
export function pickLight(regions, mic, layers) {
  const byKey = new Map();
  for (const r of regions) { const k = `${r.lo}-${r.hi}`; if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(r); }
  const out = [];
  for (const list of byKey.values()) {
    // the preferred microphone: lowest rank, then lowest group number as a tie-break
    let best = null;
    for (const r of list) {
      const rank = mic(r, r.lo);
      if (!Number.isFinite(rank)) continue;
      const g = parseInt(r.group ?? '0', 10) || 0;
      if (!best || rank < best.rank || (rank === best.rank && g < best.g)) best = { rank, g, group: r.group, dir: path.dirname(r.file) };
    }
    if (!best) continue;
    const same = list.filter((r) => mic(r, r.lo) === best.rank && r.group === best.group);
    const bands = [...new Set(same.map((r) => r.lv))].sort((a, b) => a - b);
    const keep = bands.length <= layers ? new Set(bands)
      : new Set(Array.from({ length: layers }, (_, i) => bands[Math.round((i * (bands.length - 1)) / (layers - 1))]));
    const seen = new Set();
    for (const r of same) {
      if (!keep.has(r.lv) || seen.has(r.lv)) continue; // one region per kept layer
      seen.add(r.lv);
      out.push(r);
    }
  }
  return out;
}

function sfzLines(regions, fromDir) {
  const lines = [];
  for (const r of regions) {
    lines.push('<region>');
    lines.push(`lokey=${r.lo} hikey=${r.hi} pitch_keycenter=${r.center} lovel=${r.lv} hivel=${r.hv}`);
    lines.push(`tune=${+r.tune.toFixed(2)} volume=${+(20 * Math.log10(r.gain)).toFixed(3)} ampeg_release=${+r.release.toFixed(3)} offset=${r.offsetSamples || 0}`);
    if (r.attack) lines.push(`ampeg_attack=${r.attack}`);
    lines.push(`group=${r.group ?? 0}`);
    lines.push(`sample=${path.relative(fromDir, r.file).split(path.sep).join('/')}`); // last on its line (may contain spaces)
  }
  return lines;
}

async function treeSizes(repo, branch) {
  const r = await fetch(`https://api.github.com/repos/${repo}/git/trees/${branch}?recursive=1`, { headers: H });
  if (!r.ok) return null;
  return new Map((await r.json()).tree.map((x) => [x.path, x.size || 0]));
}

function lightKit(key, k, cfg) {
  const top = `${k.repo.split('/')[1]}-${k.branch}`;
  return {
    strings: false, kit: true, family: 'drums', ...cfg,
    url: cfg.url || `https://github.com/${k.repo}`,
    sfz: `${top}/_melofi/${key}.sfz`,
    async prepare() {
      const { base } = await fetchLib(k.repo, []); // text files only
      const regs = readSfz(path.join(base, k.program), { cc: k.cc, vars: k.vars }).filter((r) => r.hi >= 0 && r.lo <= 127);
      const light = pickLight(regs, k.mic, k.layers ?? 4);
      const dir = path.join(base, '_melofi');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${key}.sfz`), [`// ${cfg.name}: light build of ${k.program} by tools/libs-archive.mjs — one microphone per key, at most ${k.layers ?? 4} velocity layers`, ...sfzLines(light, dir)].join('\n') + '\n');
      const sizes = await treeSizes(k.repo, k.branch);
      const files = [...new Set(light.map((r) => path.relative(base, r.file).split(path.sep).join('/')))];
      const all = [...new Set(regs.map((r) => path.relative(base, r.file).split(path.sep).join('/')))];
      if (sizes) {
        const mb = (list) => (list.reduce((s, f) => s + (sizes.get(f) || 0), 0) / 1e6).toFixed(0);
        console.log(`  ${key}: ${files.length} of ${all.length} files in ${k.program} (${mb(files)} MB of ${mb(all)} MB)`);
      }
      await fetchLib(k.repo, [`_melofi/${key}.sfz`]); // the audio those regions use
    },
  };
}

// ---------------- sources ----------------

const MSG = {
  url: 'https://ftp.osuosl.org/pub/musescore/soundfont/MuseScore_General/MuseScore_General.sf2',
  file: 'MuseScore_General.sf2', size: 215614036, sha256: 'ee51d2c4b1525e70f19a45909c4fd7a2e26d91d115fa89dbf5a6bc413d8b9bf3',
};
// MuseScore_General_License.md: "The acknowledgements and copyright notices above must be included in any derivative work."
const MSG_NOTICE = 'MuseScore_General.sf2 0.2 (MIT). FluidR3 by Frank Wen, Copyright (c) 2000-2002, 2008; mono conversion (FluidR3Mono) by Michael Cowgill, Copyright (c) 2014-17; adaptation for MuseScore_General.sf2 by S. Christian Collins, Copyright (c) 2018-19. https://ftp.osuosl.org/pub/musescore/soundfont/MuseScore_General/';
const gm = (key, program, cfg, bank = 0) => soundfont(key, { ...MSG, bank, program }, {
  maker: 'MuseScore General (Frank Wen · Michael Cowgill · S. Christian Collins)', license: 'MIT',
  url: 'https://ftp.osuosl.org/pub/musescore/soundfont/MuseScore_General/', ...cfg,
  credit: `${cfg.name} — ${MSG_NOTICE}`,
});

const FP = 'https://freepats.zenvoid.org';
const fp = (key, a, cfg) => archive(key, a, { url: a.page, ...cfg, credit: `${cfg.name} — ${cfg.maker}. ${cfg.license}. ${a.page}` });

const ORGANS = 'Strix SoundFont Team · FreePats (setBfree)';
const STEREO_LR = /^(.*?)([LR])\.wav$/i;

// GitHub release zip + SFZ from the repository's git tree
const ps = (key, repo, assets, sfzPath, prefix, cfg) => archive(key, {
  release: { repo: `publicsamples/${repo}`, tag: '1.0', assets }, format: 'zip', remote: true,
  sfz: `${prefix}${sfzPath}`, sfzFrom: { repo: `publicsamples/${repo}`, path: sfzPath },
}, {
  maker: 'Modular Samples (publicsamples)', license: 'Public Domain', url: `https://github.com/publicsamples/${repo}`, strings: false, ...cfg,
  credit: `${cfg.name} — Modular Samples / Richard Taylor. Public domain. https://github.com/publicsamples/${repo}`,
});
const meta = (key, inst, tag, asset, cfg) => archive(key, {
  release: { repo: 'facebookincubator/Meta-open-sound', tag, assets: asset }, format: 'zip', remote: true, sfz: `${inst}.sfz`,
  sfzFrom: {
    repo: 'facebookincubator/Meta-open-sound', path: `systems/instruments/${inst}/${inst}.sfz`,
    transform: (t) => {
      const cut = t.search(/<master>\s*lochan=2\b/);
      return (cut > 0 ? t.slice(0, cut) : t).replace(/default_path=ogg\//, 'default_path=').replace(/\.ogg\b/g, '.wav');
    },
  },
}, {
  maker: 'Meta Open Sound', license: 'CC0', url: 'https://github.com/facebookincubator/Meta-open-sound', strings: false, ...cfg,
  credit: `${cfg.name} — Meta Open Sound (facebookincubator/Meta-open-sound). CC0 1.0.`,
});
const GU = {
  url: 'https://raw.githubusercontent.com/mrbumpy409/GeneralUser-GS/97049183643d5fc5a9322a69c5b09efb667c6c3a/GeneralUser-GS.sf2',
  file: 'GeneralUser-GS.sf2', size: 32319396, sha256: '9575028c7a1f589f5770fccc8cff2734566af40cd26ed836944e9a5152688cfe',
};
const gu = (key, program, cfg, premix = false) => soundfont(key, { ...GU, bank: 0, program, premix }, {
  maker: 'S. Christian Collins (GeneralUser GS 2)', license: 'GeneralUser GS License v2.0', url: 'https://github.com/mrbumpy409/GeneralUser-GS', ...cfg,
  credit: `${cfg.name} — GeneralUser GS 2.0.3 by S. Christian Collins. GeneralUser GS License v2.0: free to use, modify and include in software. https://github.com/mrbumpy409/GeneralUser-GS`,
});

export const ARCHIVE_LIBS = {
  // ---- FreePats archives (freepats.zenvoid.org) ----
  // licence pages checked 2026-11-12: Organ/electric-organ.html (CC0 1.0), Ethnic/jaw-harp.html (CC0 1.0),
  // Guitar/steel-acoustic-guitar.html (GPL-3.0-or-later with the FreePats sample exception; the readme in the
  // archive carries Gary Campion's permission and the exception text)
  drawbarorgan: fp('drawbarorgan', {
    page: `${FP}/Organ/electric-organ.html`, url: `${FP}/Organ/DrawbarOrganEmulation/DrawbarOrganEmulation-SFZ-20190712.tar.xz`,
    file: 'DrawbarOrganEmulation-SFZ-20190712.tar.xz', format: 'tar.xz', size: 6042972, sha256: 'e2da18b0a4d13be7020037e18e4a719387433357e7603d0773990e794dcf5d0f',
    sfz: 'DrawbarOrganEmulation-SFZ-20190712/DrawbarOrganEmulation-20190712.sfz',
  }, { order: 51.1, family: 'organ', name: 'Drawbar Organ Emulation', model: '드로바 오르간', maker: 'Roberto · FreePats (setBfree)', license: 'CC0',
    tags: ['pop', 'jpop'], use: '재즈·가스펠·레트로 팝의 해먼드식 오르간' }),
  percorgan: fp('percorgan', {
    page: `${FP}/Organ/electric-organ.html`, url: `${FP}/Organ/PercussiveOrganEmulation/PercussiveOrganEmulation-SFZ-20190715.tar.xz`,
    file: 'PercussiveOrganEmulation-SFZ-20190715.tar.xz', format: 'tar.xz', size: 12423412, sha256: 'c4841f2e7f352692cf14a85a96bd1f40a9ea7a9e2a9ce3512606885d000978c8',
    sfz: 'PercussiveOrganEmulation-SFZ-20190715/PercussiveOrganEmulation-20190715.sfz', stereo: STEREO_LR,
  }, { order: 51.2, family: 'organ', name: 'Percussive Organ Emulation', model: '퍼커시브 오르간', maker: ORGANS, license: 'CC0',
    tags: ['pop', 'jpop'], use: '퍼커션이 걸린 또렷한 오르간, 펑크·소울 반주' }),
  rockorgan: fp('rockorgan', {
    page: `${FP}/Organ/electric-organ.html`, url: `${FP}/Organ/RockOrganEmulation/RockOrganEmulation-SFZ-20190715.tar.xz`,
    file: 'RockOrganEmulation-SFZ-20190715.tar.xz', format: 'tar.xz', size: 12576272, sha256: '07321d9498dc31982c44ea9483919df3f426e3d392a15bb2947b0e3fe247f718',
    sfz: 'RockOrganEmulation-SFZ-20190715/RockOrganEmulation-20190715.sfz', stereo: STEREO_LR,
  }, { order: 51.3, family: 'organ', name: 'Rock Organ Emulation', model: '록 오르간', maker: ORGANS, license: 'CC0',
    tags: ['pop', 'kpop', 'jpop'], use: '록·밴드 사운드의 거친 오르간' }),
  steelguitar: fp('steelguitar', {
    page: `${FP}/Guitar/steel-acoustic-guitar.html`, url: `${FP}/Guitar/FSS-SteelStringGuitar/FSS-SteelStringGuitar-SFZ-20200521.tar.xz`,
    file: 'FSS-SteelStringGuitar-SFZ-20200521.tar.xz', format: 'tar.xz', size: 13130512, sha256: '720b55c5ad4dcfb9f788ab13a0bda834cbfd7b3214df2ca90648c58951e41777',
    sfz: 'FSS-SteelStringGuitar-SFZ-20200521/FSS-SteelStringGuitar-20200521.sfz',
  }, { order: 20.1, family: 'guitar', name: 'FSS Steel String Guitar', model: '스틸 기타', maker: 'Gary Campion (FlameStudios) · FreePats',
    license: 'GPL-3.0+ (sample exception)', tags: ['kpop', 'pop', 'jpop'], use: '어쿠스틱 발라드·포크의 스틸 현 기타' }),
  jawharp: fp('jawharp', {
    page: `${FP}/Ethnic/jaw-harp.html`, url: `${FP}/Ethnic/JawHarp/JawHarp-SFZ-20200606.tar.bz2`,
    file: 'JawHarp-SFZ-20200606.tar.bz2', format: 'tar.bz2', size: 1913467, sha256: '8f635c9bf279774cd34dd5a336b63a6e652015f3514253f7be53467d67e5b90c',
    sfz: 'JawHarp-SFZ-20200606/JawHarp-20200606.sfz',
  }, { order: 104, family: 'world', name: 'Jaw Harp', model: '구금 (입 하프)', maker: 'Eugene Vlaskin · FreePats', license: 'CC0',
    tags: [], use: '시베리아·민속풍의 띠옹 하는 울림' }),

  // ---- Versilian Studios: Etherealwinds Harp II CE (versilian-studios.com/etherealwinds-harp/, CC BY 4.0) ----
  // a 215 MB zip on a host with Range support: only the program's samples (round robin 1) are fetched
  harp2: archive('harp2', {
    url: 'https://versilian-studios.com/Distro/EWHarp2CE_SFZ-Raw.zip', file: 'EWHarp2CE_SFZ-Raw.zip', format: 'zip', size: 214789274,
    sha256: '18b78e3c309f5fb6097e1af04482f61a86bab5d9c4d2403f4adfa8bc684af578', remote: true, sfz: 'Harp_Normal.sfz',
  }, { order: 13.1, family: 'strings', name: 'Etherealwinds Harp II CE', model: '하프', maker: 'Etherealwinds · Versilian Studios', license: 'CC BY 4.0',
    url: 'https://versilian-studios.com/etherealwinds-harp/', tags: ['kpop', 'pop', 'jpop'], use: '발라드·OST의 맑은 하프 아르페지오',
    credit: 'Etherealwinds Harp II: Community Edition — Etherealwinds / Versilian Studios. CC BY 4.0. https://versilian-studios.com/etherealwinds-harp/' }),

  // ---- MuseScore_General.sf2 presets (MIT; sample sources checked in MuseScore_General_Sample_Sources.csv:
  // all below are FluidR3 / S. Christian Collins) — fetched by byte range, ~0.05-6 MB each.
  // Left out because they sound several zones per note, which MeloFi's one-region-per-note sampler can't play
  // as designed: FM Electric Piano (5), Music Box (10), Chiffer Lead (83), Charang (84), Solo Vox (85),
  // Metal Pad (93), Halo Pad (94), Atmosphere (99), Echo Drops (102). ----
  koto: gm('koto', 107, { order: 105, family: 'world', name: 'Koto', model: '고토 (일본 쟁)', tags: ['jpop'], use: '일본풍 OST·화풍 J-pop의 현' }),
  shamisen: gm('shamisen', 106, { order: 105.1, family: 'world', name: 'Shamisen', model: '샤미센', tags: ['jpop'], use: '일본 민요·와록의 튕기는 현' }),
  shakuhachi: gm('shakuhachi', 77, { order: 67.1, family: 'winds', name: 'Shakuhachi', model: '샤쿠하치 (퉁소)', tags: ['jpop'], use: '숨소리 섞인 동양풍 대나무 피리' }),
  taiko: gm('taiko', 116, { order: 105.3, family: 'world', name: 'Taiko Drum', model: '타이코 북', tags: ['jpop'], use: '일본 북, 웅장한 OST의 큰 북' }),
  panflute: gm('panflute', 75, { order: 67.3, family: 'winds', name: 'Pan Flute', model: '팬플루트', tags: ['jpop'], use: '안데스·뉴에이지의 숨결 섞인 피리' }),
  gmbagpipe: gm('gmbagpipe', 109, { order: 67.4, family: 'winds', name: 'Bagpipe (GM)', model: '백파이프', tags: [], use: '켈트풍 드론과 선율' }),
  gmcelesta: gm('gmcelesta', 8, { order: 9.71, family: 'keys', name: 'Celesta (GM)', model: '첼레스타', tags: ['jpop'], use: '반짝이는 종소리 같은 건반' }),
  harmonium: gm('harmonium', 20, { order: 52.1, family: 'organ', name: 'Reed Organ', model: '하모니움 (리드 오르간)', tags: [], use: '찬송·민속풍의 풍금' }),
  gmaccordion: gm('gmaccordion', 21, { order: 52.2, family: 'organ', name: 'Accordion (GM)', model: '아코디언', tags: [], use: '프렌치·탱고풍 아코디언' }),
  churchorgan: gm('churchorgan', 19, { order: 50.9, family: 'organ', name: 'Church Organ', model: '교회 오르간 (풀 스톱)', tags: [], use: '웅장한 파이프 오르간 화음' }),
  clav: gm('clav', 7, { order: 13.1, family: 'keys', name: 'Clavinet (sampled)', model: '클라비넷', tags: ['pop', 'kpop'], use: '펑크 리듬의 톡 쏘는 건반' }),
  tineep: gm('tineep', 4, { order: 9.01, family: 'keys', name: 'Tine Electric Piano', model: '전자 피아노 (틴)', tags: ['kpop', 'pop', 'jpop'], use: '발라드·R&B의 둥근 전자 피아노' }),
  warmpad: gm('warmpad', 89, { order: 25.64, family: 'synth', name: 'Warm Pad', model: '웜 패드', tags: ['kpop', 'pop', 'jpop'], use: '발라드 뒤에 까는 따뜻한 패드' }),
  polysynth: gm('polysynth', 90, { order: 25.65, family: 'synth', name: 'Polysynth', model: '폴리신스', tags: ['kpop', 'pop'], use: '80년대풍 신스 코드' }),
  // ---- drum kits ----
  // Salamander Drumkit (Alexander Holm, CC BY-SA 3.0 — the readme adds that music made with it is not
  // bound by share-alike). The original is a 360 MB tar-in-7z on linuxaudio.org (no Range use possible:
  // one solid stream); the app keeps only the ~60 samples the program uses (overheads, round robin 1).
  salamanderkit: archive('salamanderkit', {
    url: 'https://download.linuxaudio.org/musical-instrument-libraries/sfz/salamander_drumkit_v1.tar.7z', file: 'salamander_drumkit_v1.tar.7z',
    format: 'tar.7z', size: 359607308, sha256: 'a576ff79fcc33b53d8a373f459277e6727bd4e68d5383b9d69b1d9e0ec585329', sfz: 'salamander_drumkit_v1/ALL.sfz',
  }, { order: 42.1, family: 'drums', kit: true, name: 'Salamander Drumkit', model: '어쿠스틱 드럼 (오버헤드)', maker: 'Alexander Holm', license: 'CC BY-SA 3.0',
    url: 'https://archive.org/details/SalamanderDrumkit', tags: ['pop', 'jpop'], use: '자작 버치 드럼의 자연스러운 룸 사운드',
    credit: 'Salamander Drumkit — Alexander Holm. CC BY-SA 3.0 (music made with it may be licensed at will). http://download.linuxaudio.org/musical-instrument-libraries/sfz/' }),

  // light builds of GitHub-hosted multi-mic kits: one microphone per key, at most four velocity layers
  virtuositylight: lightKit('virtuositylight', {
    repo: 'sfzinstruments/virtuosity_drums', branch: 'master', program: 'Programs/01-basic-kit.sfz', layers: 4,
    // the kick and snare through their own close mics, percussion through its close mic, the rest through the overheads
    mic: (r) => {
      const f = r.file.split(path.sep).join('/');
      if (/\/Samples\/kickmic\/kick\//.test(f) || /\/Samples\/snaremic\/snare\//.test(f) || /\/Samples\/perc\/close\//.test(f)) return 0;
      if (/\/Samples\/(perc\/)?oh\//.test(f)) return 1;
      return Infinity; // one drum's bleed into another drum's mic
    },
  }, { order: 42.2, name: 'Virtuosity Drums (light)', model: '어쿠스틱 드럼 + 퍼커션', maker: 'Versilian Studios · Karoryfer Samples', license: 'CC0',
    tags: ['kpop', 'pop', 'jpop'], use: '밴드·발라드용 어쿠스틱 드럼, 라틴 퍼커션까지' }),
  nakeddrums: lightKit('nakeddrums', {
    repo: 'sfzinstruments/WilkinsonAudio.NakedDrums', branch: 'master', program: 'Wilkinson Audio/Naked Drums/Stereo/Naked Drums CR.sfz', layers: 4,
    // close mics (kick in, snare top, toms, hi-hat, ride); crashes, splashes and the china through the overheads
    mic: (r, key) => {
      const n = path.basename(r.file);
      const cymbal = [49, 52, 55, 57].includes(key);
      if (/^-?CloseRoom_/.test(n)) return 3;
      if (/^-?OH_/.test(n)) return cymbal ? 0 : 2;
      return cymbal ? Infinity : 0;
    },
  }, { order: 42.3, name: 'Naked Drums (light)', model: '어쿠스틱 드럼 (클로즈 마이크)', maker: 'Wilkinson Audio', license: 'CC BY 4.0',
    tags: ['kpop', 'pop'], use: '건조하고 단단한 팝·록 드럼' }),
  // AVL Drumkits (Glen MacArthur, CC BY-SA 3.0): one mono mix per hit, 5 layers — small already, kept whole
  avlblackpearl: lightKit('avlblackpearl', {
    repo: 'studiorack/avl-drumkits', branch: 'main', program: 'Black_Pearl_5pc.sfz', layers: 5, mic: () => 0,
  }, { order: 42.4, name: 'AVL Black Pearl', model: '어쿠스틱 드럼 (펄)', maker: 'Glen MacArthur (AVL Drumkits)', license: 'CC BY-SA 3.0',
    tags: ['pop'], use: '록·팝용 펄 드럼 세트', url: 'https://github.com/studiorack/avl-drumkits' }),
  avlredzeppelin: lightKit('avlredzeppelin', {
    repo: 'studiorack/avl-drumkits', branch: 'main', program: 'Red_Zeppelin_5pc.sfz', layers: 5, mic: () => 0,
  }, { order: 42.5, name: 'AVL Red Zeppelin', model: '어쿠스틱 드럼 (러딕)', maker: 'Glen MacArthur (AVL Drumkits)', license: 'CC BY-SA 3.0',
    tags: ['pop'], use: '70년대 록 느낌의 러딕 드럼 세트', url: 'https://github.com/studiorack/avl-drumkits' }),
  // ---- GitHub release assets: SFZ program from the git tree, audio from the release zip (Range) ----
  // publicsamples / Modular Samples (Richard Taylor): every repo's LICENSE is an Unlicense-style
  // public-domain dedication (read 2026-11-12 in Roland-Juno-6, -SH-2, -JD-800, -JX-8p). The samples are
  // AIFF; the app rewrites them as WAV (same samples, byte order only).
  junopad: ps('junopad', 'Roland-Juno-6', 'Audio.zip', 'SFZ/Open Pad.sfz', 'juno6/',
    { order: 25.7, family: 'synth', name: 'Juno-6 Open Pad', model: 'Roland Juno-6 패드', tags: ['kpop', 'pop', 'jpop'], use: '시티팝·신스웨이브의 넓은 주노 패드' }),
  junopulsebass: ps('junopulsebass', 'Roland-Juno-6', 'Audio.zip', 'SFZ/Pulse Bass.sfz', 'juno6/',
    { order: 33.4, family: 'bass', name: 'Juno-6 Pulse Bass', model: 'Roland Juno-6 베이스', tags: ['kpop', 'pop', 'jpop'], use: '80년대풍 펄스 신스 베이스' }),
  junosawbass: ps('junosawbass', 'Roland-Juno-6', 'Audio.zip', 'SFZ/Saw Bass split.sfz', 'juno6/',
    { order: 33.5, family: 'bass', name: 'Juno-6 Saw Bass', model: 'Roland Juno-6 베이스', tags: ['pop', 'jpop'], use: '단단한 톱니파 신스 베이스' }),
  junopluck: ps('junopluck', 'Roland-Juno-6', 'Audio.zip', 'SFZ/Rich pluck.sfz', 'juno6/',
    { order: 25.71, family: 'synth', name: 'Juno-6 Rich Pluck', model: 'Roland Juno-6 플럭', tags: ['kpop', 'pop'], use: '아르페지오에 쓰는 통통 튀는 플럭' }),
  sh2rezzysaw: ps('sh2rezzysaw', 'Roland-SH-2', 'RolandSH-2.zip', 'SFZ/Rezzy Saw Vel.sfz', 'sh2/',
    { order: 25.72, family: 'synth', name: 'SH-2 Rezzy Saw', model: 'Roland SH-2 리드/베이스', tags: ['pop'], use: '레조넌스 걸린 아날로그 모노 톱니파' }),
  sh2wowbass: ps('sh2wowbass', 'Roland-SH-2', 'RolandSH-2.zip', 'SFZ/Wow Bass.sfz', 'sh2/',
    { order: 33.6, family: 'bass', name: 'SH-2 Wow Bass', model: 'Roland SH-2 베이스', tags: ['pop'], use: '필터가 열리는 아날로그 베이스' }),
  sh2pwm: ps('sh2pwm', 'Roland-SH-2', 'RolandSH-2.zip', 'SFZ/Short PWM.sfz', 'sh2/',
    { order: 25.73, family: 'synth', name: 'SH-2 Short PWM', model: 'Roland SH-2 리드', tags: ['jpop'], use: '짧은 펄스폭 변조 신스음' }),
  jd800lead: ps('jd800lead', 'Roland-JD-800', ['jd800.zip.001', 'jd800.zip.002'], 'SFZ/Roland Jd-800 Bright Lead.sfz', 'jd800/',
    { order: 25.74, family: 'synth', name: 'JD-800 Bright Lead', model: 'Roland JD-800 리드', tags: ['jpop'], use: '90년대 디지털 신스 리드' }),
  jd800digi: ps('jd800digi', 'Roland-JD-800', ['jd800.zip.001', 'jd800.zip.002'], 'SFZ/Roland Jd-800 JDdigi.sfz', 'jd800/',
    { order: 25.75, family: 'synth', name: 'JD-800 Digi', model: 'Roland JD-800 벨/키', tags: ['jpop', 'kpop'], use: '반짝이는 90년대 디지털 키' }),
  jd800pluck: ps('jd800pluck', 'Roland-JD-800', ['jd800.zip.001', 'jd800.zip.002'], 'SFZ/Roland Jd-800 Multi-pluck.sfz', 'jd800/',
    { order: 25.76, family: 'synth', name: 'JD-800 Multi-pluck', model: 'Roland JD-800 플럭', tags: ['jpop'], use: '겹친 디지털 플럭' }),
  jx8ppad: ps('jx8ppad', 'Roland-JX-8p', ['Audio.zip.001', 'Audio.zip.002', 'Audio.zip.003'], 'SFZ/Dark Pad Chorus.sfz', '',
    { order: 25.77, family: 'synth', name: 'JX-8P Dark Pad', model: 'Roland JX-8P 패드', tags: ['kpop', 'pop', 'jpop'], use: '80년대 J-pop의 코러스 걸린 어두운 패드' }),

  // Meta Open Sound (facebookincubator/Meta-open-sound, CC0 1.0 — LICENSE in the repo and in each
  // instrument folder): the git tree holds lossy OGG previews; the lossless 24-bit WAVs are release zips.
  // The tree's SFZ maps are used with their paths pointed at the WAVs, MIDI channel 1 only (channels 2-7
  // are per-string duplicates).
  metasteel: meta('metasteel', 'meta-steel-guitar', 'meta-steel-guitar-v1.0.0', 'meta-open-sound-meta-steel-guitar-wav.zip',
    { order: 20.2, family: 'guitar', name: 'Meta Steel Guitar', model: '스틸 기타 (어쿠스틱)', tags: ['kpop', 'pop', 'jpop'], use: '6줄 모두 녹음한 스틸 기타, J-pop 스트로크' }),
  metanylon: meta('metanylon', 'meta-nylon-guitar', 'meta-nylon-guitar-v1.0.0', 'meta-open-sound-meta-nylon-guitar-wav.zip',
    { order: 23.6, family: 'guitar', name: 'Meta Nylon Guitar', model: '나일론 기타', tags: ['kpop', 'pop', 'jpop'], use: '보사노바·발라드의 나일론 기타' }),
  metapiano: meta('metapiano', 'meta-piano', 'meta-piano-v1.0.0', 'meta-open-sound-meta-piano-wav.zip',
    { order: 7.5, family: 'piano', name: 'Meta Piano', model: '업라이트 피아노', tags: ['pop'], use: '따뜻한 업라이트 피아노' }),

  // GeneralUser GS 2 (S. Christian Collins, github.com/mrbumpy409/GeneralUser-GS, commit-pinned): licence v2.0
  // allows use without restriction, in software too. The author can't vouch for every sample's origin, so
  // only parts MeloFi has no dedicated library for: slap and fretless bass, orchestra hit. Slap Bass 2 (37) layers
  // looped zones per note, which can't be premixed, so it is left out like the layered MuseScore presets.
  guslapbass: gu('guslapbass', 36, { order: 33.7, family: 'bass', name: 'Slap Bass (GeneralUser)', model: '슬랩 베이스', tags: ['kpop', 'jpop'], use: '펑크·시티팝의 슬랩 베이스' }),
  // Orchestra Hit stacks two one-shot hits (one an octave and a quarter-tone lower): rendered into one file per key
  // range exactly as an SF2 synth sums them (lib/sf2.js premixPreset)
  guorchhit: gu('guorchhit', 55, { order: 81.1, family: 'brass', name: 'Orchestra Hit (GeneralUser)', model: '오케스트라 히트', tags: ['jpop', 'kpop'], use: '80년대 팝·J-core의 오케스트라 히트' }, true),
  gufretless: gu('gufretless', 35, { order: 33.9, family: 'bass', name: 'Fretless Bass (GeneralUser)', model: '프렛리스 베이스', tags: ['pop', 'jpop'], use: '미끄러지는 프렛리스 베이스, 퓨전·발라드' }),
};


export { archive, soundfont, lightKit, releaseUrls, gm, fp, FP, MSG, MSG_NOTICE };
