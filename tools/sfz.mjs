// Minimal SFZ reader: enough of SFZ v2 + ARIA preprocessor to pull a playable
// region list out of the libraries MeloFi ships. Not a general sampler.
import fs from 'node:fs';
import path from 'node:path';

const NOTE = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

export function noteNum(v) {
  if (v == null) return undefined;
  const s = String(v).trim();
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  const m = /^([a-gA-G])([#b]?)(-?\d+)$/.exec(s);
  if (!m) return undefined;
  let n = NOTE[m[1].toLowerCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  return n + (parseInt(m[3], 10) + 1) * 12;
}

function stripComments(t) {
  return t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, '');
}

// Sequential preprocessor: #define and #include may appear anywhere, even mid-line,
// and a later #define changes what later text expands to.
function preprocess(file, rootDir, vars, depth = 0) {
  if (depth > 16) throw new Error('include depth');
  const text = stripComments(fs.readFileSync(file, 'utf8'));
  const re = /#define\s+\$(\w+)\s+(\S+)|#include\s+"([^"]+)"/g;
  let out = '';
  let last = 0;
  let m;
  const subst = (s) => {
    if (!s.includes('$')) return s;
    const names = Object.keys(vars).sort((a, b) => b.length - a.length);
    let r = '';
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '$') {
        const rest = s.slice(i + 1);
        const hit = names.find((n) => rest.startsWith(n));
        if (hit) { r += vars[hit]; i += hit.length; continue; }
      }
      r += s[i];
    }
    return r;
  };
  while ((m = re.exec(text))) {
    out += subst(text.slice(last, m.index));
    if (m[1]) vars[m[1]] = subst(m[2]);
    else out += '\n' + preprocess(path.join(rootDir, subst(m[3])), rootDir, vars, depth + 1) + '\n';
    last = re.lastIndex;
  }
  out += subst(text.slice(last));
  return out;
}

function parseOpcodes(text) {
  // Returns [{header, ops:{}}] in order.
  const re = /<(\w+)>|([A-Za-z0-9_]+)=/g;
  const marks = [];
  let m;
  while ((m = re.exec(text))) marks.push({ i: m.index, end: re.lastIndex, header: m[1], key: m[2] });
  const blocks = [];
  let cur = null;
  for (let k = 0; k < marks.length; k++) {
    const mk = marks[k];
    if (mk.header) { cur = { header: mk.header, ops: {} }; blocks.push(cur); continue; }
    if (!cur) { cur = { header: 'control', ops: {} }; blocks.push(cur); }
    const stop = k + 1 < marks.length ? marks[k + 1].i : text.length;
    let raw = text.slice(mk.end, stop);
    raw = raw.split(/\r?\n/)[0];
    const val = /sample$|label/.test(mk.key) ? raw.trim() : raw.trim().split(/\s+/)[0] ?? '';
    cur.ops[mk.key] = val;
  }
  return blocks;
}

// opts.cc: { [cc]: value } overrides the program's own CC defaults (e.g. pick a mic position)
export function readSfz(file, opts = {}) {
  const rootDir = path.dirname(file);
  const vars = { ...(opts.vars || {}) }; // opts.vars: values a host would #define (e.g. sample_dir)
  const text = preprocess(file, rootDir, vars);
  const blocks = parseOpcodes(text);

  const cc = new Array(512).fill(0);
  let defaultPath = '';
  let noteOffset = 0;
  let swDefault;
  let g = {}, ma = {}, gr = {};
  const regions = [];

  for (const b of blocks) {
    const h = b.header;
    for (const [k, v] of Object.entries(opts.cc || {})) cc[+k] = v;
    if (h === 'control') {
      for (const [k, v] of Object.entries(b.ops)) {
        let mm;
        if (k === 'default_path') defaultPath = v.replace(/\\/g, '/');
        else if ((mm = /^set_cc(\d+)$/.exec(k))) cc[+mm[1]] = parseFloat(v);
        else if ((mm = /^set_hdcc(\d+)$/.exec(k))) cc[+mm[1]] = parseFloat(v) * 127;
        else if (k === 'note_offset') noteOffset += parseInt(v, 10);
        else if (k === 'octave_offset') noteOffset += 12 * parseInt(v, 10);
      }
    } else if (h === 'global') { g = { ...b.ops }; ma = {}; gr = {}; }
    else if (h === 'master') { ma = { ...b.ops }; gr = {}; }
    else if (h === 'group') { gr = { ...b.ops }; }
    else if (h === 'region') { regions.push({ ...g, ...ma, ...gr, ...b.ops }); }
    // <curve>, <effect>, <midi> ... ignored
    if (h === 'global' || h === 'master' || h === 'group') {
      if (b.ops.sw_default) swDefault = noteNum(b.ops.sw_default);
    }
  }

  const out = [];
  for (const r of regions) {
    if (!r.sample || r.sample.startsWith('*')) continue;
    if (r.trigger && r.trigger !== 'attack' && r.trigger !== 'first') continue;
    if (r.seq_position && parseInt(r.seq_position, 10) > 1) continue;
    if (r.lorand && parseFloat(r.lorand) > 0) continue;
    if (r.pitch_keytrack === '0') continue;
    if (r.sw_last != null && swDefault != null && noteNum(r.sw_last) !== swDefault) continue;

    // CC gates evaluated at the instrument's default controller values.
    let ok = true;
    let amp = 1;
    let rel = parseFloat(r.ampeg_release ?? '0.3');
    let offsetSamples = parseInt(r.offset ?? '0', 10) || 0;
    for (const [k, v] of Object.entries(r)) {
      let mm;
      if ((mm = /^locc(\d+)$/.exec(k)) && cc[+mm[1]] < parseFloat(v)) ok = false;
      else if ((mm = /^hicc(\d+)$/.exec(k)) && cc[+mm[1]] > parseFloat(v)) ok = false;
      else if ((mm = /^amplitude_oncc(\d+)$/.exec(k)) && +mm[1] !== 7 && +mm[1] !== 10) amp *= (cc[+mm[1]] / 127) * (parseFloat(v) / 100);
      else if ((mm = /^ampeg_release_oncc(\d+)$/.exec(k))) rel += parseFloat(v) * (cc[+mm[1]] / 127);
      else if ((mm = /^offset_oncc(\d+)$/.exec(k))) offsetSamples += Math.round(parseFloat(v) * (cc[+mm[1]] / 127));
    }
    if (!ok || amp <= 0.0001) continue;
    if (r.amplitude != null) amp *= parseFloat(r.amplitude) / 100;

    let lo = noteNum(r.lokey), hi = noteNum(r.hikey), center = noteNum(r.pitch_keycenter);
    const key = noteNum(r.key);
    if (key != null) { lo ??= key; hi ??= key; center ??= key; }
    lo ??= 0; hi ??= 127;
    center ??= (lo === hi ? lo : 60);

    const db = ['volume', 'group_volume', 'master_volume', 'global_volume']
      .reduce((s, k) => s + (r[k] != null ? parseFloat(r[k]) : 0), 0);
    const tune = (parseFloat(r.tune ?? '0') || 0) + 100 * (parseFloat(r.transpose ?? '0') || 0);

    out.push({
      file: path.resolve(rootDir, (defaultPath + r.sample).replace(/\\/g, '/')),
      lo: lo + noteOffset, hi: hi + noteOffset, center: center + noteOffset,
      lv: parseInt(r.lovel ?? '1', 10), hv: parseInt(r.hivel ?? '127', 10),
      tune, gain: amp * Math.pow(10, db / 20), release: Math.max(0.05, rel), offsetSamples,
      group: r.group, label: r.group_label || r.master_label || '',
    });
  }
  return out;
}
