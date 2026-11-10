// Audio analysis (runs in a worker): tempo and beats, key, chords per bar, bass and melody
// lines, drum patterns, song sections and loudness — from a mono signal at 22.05 kHz.
// The result is compact enough to hand to Claude for an arrangement.
//   postMessage({ samples: Float32Array, rate, tempo? }) -> { type: 'progress', p } … { type: 'done', result }

const N = 4096, HOP = 512;
const PC = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// ---------- FFT (radix-2, in place) ----------
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

const hz2midi = (f) => 69 + 12 * Math.log2(f / 440);
const midi2hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

function analyze(x, sr, progress, tempoHint) {
  const frames = Math.max(1, Math.floor((x.length - N) / HOP));
  const binHz = sr / N, nb = N / 2;
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  const re = new Float32Array(N), im = new Float32Array(N);
  let prevMag = new Float32Array(nb);
  const flux = new Float32Array(frames);
  const bands = { kick: new Float32Array(frames), snare: new Float32Array(frames), hat: new Float32Array(frames) };
  const chroma = Array.from({ length: frames }, () => new Float32Array(12));
  const bass = new Float32Array(frames), mel = new Float32Array(frames), melConf = new Float32Array(frames);
  const rms = new Float32Array(frames), centroid = new Float32Array(frames);
  const band = (lo, hi) => [Math.max(1, Math.floor(lo / binHz)), Math.min(nb - 1, Math.ceil(hi / binHz))];
  const [kb0, kb1] = band(40, 120), [sb0, sb1] = band(1500, 4000), [sl0, sl1] = band(150, 350), [hb0, hb1] = band(7000, 10500);
  // pitch-class map for the chroma range (110 Hz – 3 kHz: below that a 5 Hz bin is wider than a
  // semitone, and the bass would swamp the harmony)
  const pcOf = new Int8Array(nb).fill(-1);
  for (let b = 1; b < nb; b++) { const f = b * binHz; if (f >= 110 && f <= 3000) pcOf[b] = ((Math.round(hz2midi(f)) % 12) + 12) % 12; }
  for (let fr = 0; fr < frames; fr++) {
    const o = fr * HOP;
    let e = 0;
    for (let i = 0; i < N; i++) { const s = x[o + i] || 0; re[i] = s * win[i]; im[i] = 0; e += s * s; }
    rms[fr] = Math.sqrt(e / N);
    fft(re, im);
    const mag = new Float32Array(nb);
    let fl = 0, cs = 0, ms = 0;
    for (let b = 1; b < nb; b++) {
      const m = Math.sqrt(re[b] * re[b] + im[b] * im[b]);
      mag[b] = m;
      const lm = Math.log1p(m * 10), lp = Math.log1p(prevMag[b] * 10);
      if (lm > lp) fl += lm - lp;
      cs += m * b * binHz; ms += m;
    }
    // chroma from spectral peaks only (less smearing between neighbouring semitones)
    // A peak sitting on the 3rd, 5th or 6th harmonic of a stronger peak below is mostly overtone
    // (a G chord on a saw lead otherwise shows an F# from B×3 and D×5), so it counts for little.
    const isPeak = (b) => b > 1 && b < nb - 1 && mag[b] > mag[b - 1] && mag[b] >= mag[b + 1];
    const fundAt = (b, h) => { const c = b / h; let m = 0; for (let k = Math.floor(c - 1); k <= Math.ceil(c + 1); k++) if (isPeak(k)) m = Math.max(m, mag[k]); return m; };
    for (let b = 2; b < nb - 1; b++) {
      if (pcOf[b] < 0 || !isPeak(b)) continue;
      let w = 1;
      for (const h of [3, 5, 6]) if (fundAt(b, h) > mag[b] * 0.7) { w = 0.15; break; }
      chroma[fr][pcOf[b]] += mag[b] * w;
    }
    flux[fr] = fl; centroid[fr] = ms ? cs / ms : 0;
    const bsum = (a, z) => { let s = 0, s0 = 0; for (let b = a; b <= z; b++) { const d = Math.log1p(mag[b] * 10) - Math.log1p(prevMag[b] * 10); if (d > 0) s += d; s0 += mag[b]; } return s; };
    bands.kick[fr] = bsum(kb0, kb1); bands.snare[fr] = bsum(sb0, sb1) + 0.5 * bsum(sl0, sl1); bands.hat[fr] = bsum(hb0, hb1);
    // bass: harmonic sum over E1–G3, so the fundamental wins over its own 2nd/3rd harmonic (an E bass
    // otherwise reads as B); melody: harmonic-sum pitch 200–1200 Hz
    const magAt = (f) => { const c = f / binHz, a = Math.floor(c); return a + 1 < nb ? Math.max(mag[a], mag[a + 1], mag[a - 1] || 0) : 0; };
    let bq = 0, bm = 0;
    for (let m = 28; m <= 55; m++) {
      const f = midi2hz(m);
      const s = magAt(f) + 0.8 * magAt(2 * f) + 0.6 * magAt(3 * f) + 0.45 * magAt(4 * f);
      if (s > bm) { bm = s; bq = m; }
    }
    bass[fr] = bm > 0 ? bq : 0;
    let best = 0, bf = 0;
    for (let m = 55; m <= 86; m += 0.5) {
      const f = midi2hz(m);
      let s = 0;
      for (let h = 1; h <= 5; h++) { const b = Math.round((f * h) / binHz); if (b < nb) s += mag[b] / h; }
      if (s > best) { best = s; bf = m; }
    }
    mel[fr] = bf; melConf[fr] = best;
    prevMag = mag;
    if (fr % 400 === 0) progress(0.1 + 0.6 * (fr / frames));
  }
  const fps = sr / HOP;

  // ---------- tempo: autocorrelation of the onset envelope ----------
  // The beat lives in the kick and snare; hats mostly mark the subdivision. Envelopes are smoothed a
  // little (~70 ms) so swung or loose hits still line up, and detrended so loudness changes don't count.
  const unit = (a) => { let m = 0; for (const v of a) if (v > m) m = v; m = m || 1; return a.map((v) => v / m); };
  const detrend = (a) => { const t = smoothNorm(a, Math.round(fps)); return a.map((v, i) => Math.max(0, v - t[i])); };
  const kick = unit(smoothNorm(bands.kick, 1)), snare = unit(smoothNorm(bands.snare, 1));
  const full = detrend(smoothNorm(flux, 3));
  const drumEnv = detrend(smoothNorm(kick.map((v, i) => v + snare[i]), 3));
  // drums present when the low/mid drum onsets carry a fair share of all onsets
  const share = drumEnv.reduce((a, v) => a + v, 0) / (unit(full).reduce((a, v) => a + v, 0) + 1e-9);
  const env = share > 0.25 ? drumEnv : full;
  const acfOf = (e) => { const z = e.reduce((a, v) => a + v * v, 0) / e.length || 1; return (lag) => { const a = Math.floor(lag), fr = lag - a; let s0 = 0, s1 = 0; for (let i = a + 1; i < e.length; i++) { s0 += e[i] * e[i - a]; s1 += e[i] * e[i - a - 1]; } return ((s0 * (1 - fr) + s1 * fr) / Math.max(1, e.length - a)) / z; }; };
  const acf = acfOf(env);
  const L = (b) => (60 * fps) / b;
  // comb: a beat period is right when one beat, two beats and a bar all repeat (this rules out the
  // 3:4 and 2:3 neighbours an onset autocorrelation alone tends to pick)
  const comb = (b) => acf(L(b)) + acf(2 * L(b)) + acf(4 * L(b));
  let best = 120, bestScore = -1;
  for (let b = 60; b <= 190; b += 0.5) {
    const w = Math.exp(-0.5 * Math.pow(Math.log2(b / 110) / 1.2, 2));
    const sc = comb(b) * w;
    if (sc > bestScore) { bestScore = sc; best = b; }
  }
  // half or double time: the backbeat decides. At the written tempo the snare repeats every two beats
  // but not every beat; at double time it repeats every four.
  const sAcf = acfOf(detrend(smoothNorm(snare, 3)));
  const backbeat = (b) => sAcf(2 * L(b)) - sAcf(L(b));
  if (share > 0.25) {
    const cands = [best / 2, best, best * 2].filter((b) => b >= 55 && b <= 200);
    const scored = cands.map((b) => [b, backbeat(b)]).sort((p, q) => q[1] - p[1]);
    if (scored[0][1] > 0.05 && scored[0][1] > backbeat(best) + 0.03) best = scored[0][0];
  }
  if (self.debug) self.debug.tempo = { drums: env === drumEnv, share, acf: (b) => comb(b), backbeat, best };
  let bpm = tempoHint || best;
  // refine (sub-frame) around the estimate
  {
    let bs = -1, bb = bpm;
    for (let b = bpm * 0.97; b <= bpm * 1.03; b += 0.05) { const sc = comb(b); if (sc > bs) { bs = sc; bb = b; } }
    bpm = bb;
  }
  bpm = Math.round(bpm * 2) / 2;
  progress(0.75);

  // ---------- beats: dynamic programming (Ellis 2007) ----------
  const period = (60 / bpm) * fps;
  const score = new Float32Array(env.length), back = new Int32Array(env.length).fill(-1);
  for (let i = 0; i < env.length; i++) {
    let bs = 0, bi = -1;
    for (let p = Math.round(i - 2 * period); p <= i - period / 2; p++) {
      if (p < 0) continue;
      const pen = -Math.pow(Math.log((i - p) / period), 2) * 6;
      if (score[p] + pen > bs) { bs = score[p] + pen; bi = p; }
    }
    score[i] = env[i] + bs; back[i] = bi;
  }
  let end = 0;
  for (let i = Math.max(0, env.length - Math.round(period * 2)); i < env.length; i++) if (score[i] > score[end]) end = i;
  const beats = [];
  for (let i = end; i >= 0; i = back[i]) { beats.push(i / fps); if (back[i] < 0) break; }
  beats.reverse();
  // downbeat: which beat phase (of 4) has the strongest low-end onsets
  const kickEnv = smoothNorm(bands.kick, 1);
  // ...plus where the harmony moves: bass and chords change on the downbeat far more often than on beat 2 or 4
  const phaseScore = [0, 0, 0, 0];
  const beatChroma = beats.map((t, i) => {
    const a = Math.round(t * fps), z = Math.max(a + 1, Math.round((beats[i + 1] ?? t + 60 / bpm) * fps));
    const c = new Float32Array(12); const bh = new Float32Array(12);
    for (let f = a; f < z && f < frames; f++) { const s = chroma[f].reduce((p, q) => p + q, 0) || 1; for (let k = 0; k < 12; k++) c[k] += chroma[f][k] / s; if (bass[f]) bh[bass[f] % 12] += rms[f]; }
    return { c, b: bh.indexOf(Math.max(...bh)) };
  });
  const kAt = beats.map((t) => kickEnv[Math.min(kickEnv.length - 1, Math.round(t * fps))] || 0);
  const kMax = Math.max(...kAt) || 1;
  beats.forEach((_, i) => {
    let change = 0;
    if (i > 0) { change = (beatChroma[i].b !== beatChroma[i - 1].b ? 0.5 : 0) + 0.5 * (1 - corr(beatChroma[i].c, beatChroma[i - 1].c)); }
    phaseScore[i % 4] += kAt[i] / kMax + 1.5 * change;
  });
  const phase = phaseScore.indexOf(Math.max(...phaseScore));
  const barStarts = beats.filter((_, i) => i % 4 === phase);
  progress(0.8);

  // ---------- key (Krumhansl–Schmuckler) ----------
  const total = new Float32Array(12);
  for (const c of chroma) { const s = c.reduce((a, b) => a + b, 0) || 1; for (let k = 0; k < 12; k++) total[k] += c[k] / s; }
  const MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const MIN = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
  const ksScore = {};
  for (let r = 0; r < 12; r++) for (const [mode, prof] of [['major', MAJ], ['minor', MIN]]) ksScore[`${r}${mode}`] = corr(total, prof.map((_, k) => prof[(k - r + 12) % 12]));

  // ---------- per bar: chords, bass, drums, energy ----------
  const frameAt = (t) => Math.min(frames - 1, Math.max(0, Math.round(t * fps)));
  const TEMPL = [];
  for (let r = 0; r < 12; r++) {
    for (const [q, iv] of [['', [0, 4, 7]], ['m', [0, 3, 7]], ['7', [0, 4, 7, 10]], ['maj7', [0, 4, 7, 11]], ['m7', [0, 3, 7, 10]], ['sus4', [0, 5, 7]], ['add9', [0, 2, 4, 7]], ['dim', [0, 3, 6]]]) {
      const v = new Float32Array(12); for (const i of iv) v[(r + i) % 12] = 1;
      TEMPL.push({ name: PC[r] + q, root: r, v, bias: q === '' || q === 'm' ? 0.03 : 0 });
    }
  }
  const bars = [];
  for (let b = 0; b < barStarts.length; b++) {
    const t0 = barStarts[b], t1 = barStarts[b + 1] ?? t0 + (240 / bpm);
    const f0 = frameAt(t0), f1 = Math.max(f0 + 1, frameAt(t1));
    const step = (t1 - t0) / 16;
    // bass note per beat
    const bassNotes = [];
    for (let q = 0; q < 4; q++) {
      const fa = frameAt(t0 + q * 4 * step), fz = Math.max(fa + 1, frameAt(t0 + (q + 1) * 4 * step));
      const hist = new Map();
      for (let f = fa; f < fz; f++) if (bass[f]) { const n = Math.round(bass[f]); hist.set(n, (hist.get(n) || 0) + rms[f]); }
      const top = [...hist].sort((p, q2) => q2[1] - p[1])[0];
      bassNotes.push(top ? top[0] : null);
    }
    // Chords follow the harmonic rhythm: a new chord where the bass moves (pop often changes every
    // beat or two), half bars when there is no clear bass.
    const starts = [0];
    if (bassNotes.some((n) => n != null)) { for (let q = 1; q < 4; q++) if (bassNotes[q] != null && bassNotes[q - 1] != null && bassNotes[q] % 12 !== bassNotes[q - 1] % 12) starts.push(q); }
    else starts.push(2);
    const label = (a, z) => {
      const c = new Float32Array(12), bh = new Float32Array(12);
      for (let f = a; f < z; f++) { const s = chroma[f].reduce((p, q) => p + q, 0) || 1; for (let k = 0; k < 12; k++) c[k] += chroma[f][k] / s; if (bass[f]) bh[bass[f] % 12] += rms[f]; }
      // the bass note votes too: a chord whose root is in the bass is far more likely (Em7 over an F bass is not)
      const bt = bh.reduce((p, q) => p + q, 0), bpc = bt ? bh.indexOf(Math.max(...bh)) : -1, bconf = bt ? Math.max(...bh) / bt : 0;
      let best = null, bs = -Infinity;
      for (const T of TEMPL) {
        let sc = corr(c, T.v) + T.bias;
        if (bpc >= 0) sc += bconf * (T.root === bpc ? 0.35 : T.v[bpc] ? 0.08 : -0.15);
        if (sc > bs) { bs = sc; best = T; }
      }
      return best.name;
    };
    const chords = [], chordBeats = [];
    starts.forEach((q, i) => {
      const qz = starts[i + 1] ?? 4;
      const name = label(frameAt(t0 + q * 4 * step), Math.max(frameAt(t0 + q * 4 * step) + 1, frameAt(t0 + qz * 4 * step)));
      if (chords[chords.length - 1] !== name) { chords.push(name); chordBeats.push(q); }
    });
    // 16 steps: drums per band
    const drum = (envArr) => {
      const e = smoothNorm(envArr, 0), out = [];
      const thr = 0.35;
      for (let s = 0; s < 16; s++) { const f = frameAt(t0 + s * step); let m = 0; for (let k = -1; k <= 1; k++) m = Math.max(m, e[f + k] || 0); out.push(m > thr ? 1 : 0); }
      return out.join('');
    };
    let er = 0, ec = 0; for (let f = f0; f < f1; f++) { er += rms[f]; ec += centroid[f]; }
    bars.push({ bar: b + 1, time: +t0.toFixed(2), chords, chord_beats: chordBeats, bass: bassNotes, kick: drum(bands.kick), snare: drum(bands.snare), hat: drum(bands.hat),
      energy: +(20 * Math.log10((er / (f1 - f0)) + 1e-6)).toFixed(1), brightness: Math.round(ec / (f1 - f0)) });
  }
  progress(0.9);

  // ---------- key: the pitch profile, checked against which scale holds the detected chords ----------
  // (overtones alone can tip the profile to a neighbouring key; the chords and the home chord settle it)
  const seq = bars.flatMap((b) => b.chords.flatMap((c, i) => Array((b.chord_beats[i + 1] ?? 4) - b.chord_beats[i]).fill(c)))
    .map((c) => { const m = /^([A-G]#?)(.*)$/.exec(c); return m ? { r: PC.indexOf(m[1]), q: m[2] } : null; }).filter(Boolean);
  const DEG = { 0: 'M', 2: 'm', 4: 'm', 5: 'M', 7: 'M', 9: 'm', 11: 'd' }; // triads of the major scale
  const isMin = (q) => q === 'm' || q === 'm7';
  let key = { root: 0, mode: 'major', score: -Infinity };
  for (let r = 0; r < 12; r++) for (const mode of ['major', 'minor']) {
    const home = mode === 'major' ? r : (r + 3) % 12;
    let fit = 0, tonic = 0;
    for (const c of seq) {
      const want = DEG[(c.r - home + 12) % 12];
      if (want) fit += c.q === 'sus4' || c.q === 'dim' ? 0.7 : (want === 'm') === isMin(c.q) ? 1 : 0.35;
      if (c.r === r && (mode === 'minor' ? isMin(c.q) : c.q === '' || c.q === 'maj7')) tonic++;
    }
    const n = seq.length || 1;
    const first = seq[0] && seq[0].r === r && (mode === 'minor' ? isMin(seq[0].q) : seq[0].q === '' || seq[0].q === 'maj7') ? 0.15 : 0;
    const s = ksScore[`${r}${mode}`] + fit / n + 0.6 * (tonic / n) + first;
    if (s > key.score) key = { root: r, mode, score: s };
  }

  // ---------- melody: segmented notes on a 16th grid (confident frames only) ----------
  const conf = [...melConf].sort((a, b) => a - b)[Math.floor(frames * 0.6)] || 0;
  const melody = [];
  const stepSec = 60 / bpm / 4, t00 = barStarts[0] ?? 0;
  // median of the confident pitches around each frame, so a note survives vibrato and noise
  const med = new Float32Array(frames);
  for (let fr = 0; fr < frames; fr++) {
    if (melConf[fr] <= conf) continue;
    const w = [];
    for (let k = -4; k <= 4; k++) if (melConf[fr + k] > conf) w.push(mel[fr + k]);
    w.sort((a, b) => a - b);
    med[fr] = w[w.length >> 1];
  }
  let cur = null;
  for (let fr = 0; fr < frames; fr++) {
    const t = fr / fps;
    const n = med[fr] ? Math.round(med[fr]) : null;
    if (cur && n === cur.n) { cur.end = t; continue; }
    if (cur && cur.end - cur.start > stepSec * 0.8) melody.push(cur);
    cur = n ? { n, start: t, end: t } : null;
  }
  const melNotes = melody.map((m) => ({ s: Math.round((m.start - t00) / stepSec), d: Math.max(1, Math.round((m.end - m.start) / stepSec)), n: m.n })).filter((m) => m.s >= 0).slice(0, 600);

  // ---------- sections: changes in harmony + energy between bars ----------
  const feat = bars.map((b) => [b.energy / 10, b.brightness / 2000, ...[...b.kick].map(Number).slice(0, 4), ...chordVec(b.chords[0])]);
  const nov = feat.map((f, i) => (i < 2 || i > feat.length - 3 ? 0 : dist(avg(feat.slice(i - 2, i)), avg(feat.slice(i, i + 2)))));
  const cut = [0];
  const thr2 = [...nov].sort((a, b) => a - b)[Math.floor(nov.length * 0.85)] || 0;
  nov.forEach((v, i) => { if (v >= thr2 && v > 0 && i - cut[cut.length - 1] >= 4) cut.push(i); });
  const sections = cut.map((c, i) => {
    const e = cut[i + 1] ?? bars.length;
    const seg = bars.slice(c, e);
    return { start_bar: c + 1, end_bar: e, energy: +(seg.reduce((s, b) => s + b.energy, 0) / (seg.length || 1)).toFixed(1), chords: [...new Set(seg.flatMap((b) => b.chords))].slice(0, 8) };
  });
  progress(1);
  return {
    duration: +(x.length / sr).toFixed(2),
    bpm, beats: beats.length, first_downbeat: +(barStarts[0] ?? 0).toFixed(3),
    key: `${PC[key.root]} ${key.mode}`, key_root: key.root, key_mode: key.mode,
    bars, sections, melody: melNotes,
  };
}

function smoothNorm(a, r) {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) { let s = 0, n = 0; for (let k = -r; k <= r; k++) { const v = a[i + k]; if (v !== undefined) { s += v; n++; } } out[i] = s / n; }
  const sorted = [...out].sort((p, q) => p - q), hi = sorted[Math.floor(sorted.length * 0.98)] || 1, mean = out.reduce((p, q) => p + q, 0) / out.length;
  for (let i = 0; i < out.length; i++) out[i] = Math.max(0, (out[i] - mean) / (hi - mean || 1));
  return out;
}
function corr(a, b) {
  const n = a.length, ma = a.reduce((p, q) => p + q, 0) / n, mb = b.reduce((p, q) => p + q, 0) / n;
  let s = 0, sa = 0, sb = 0;
  for (let i = 0; i < n; i++) { s += (a[i] - ma) * (b[i] - mb); sa += (a[i] - ma) ** 2; sb += (b[i] - mb) ** 2; }
  return s / Math.sqrt(sa * sb || 1);
}
function chordVec(name) { const v = new Array(12).fill(0); const r = PC.findIndex((p) => name?.startsWith(p) && !(p.length === 1 && name[1] === '#')); if (r >= 0) v[r] = 1; return v; }
const avg = (list) => list[0].map((_, k) => list.reduce((s, f) => s + f[k], 0) / list.length);
const dist = (a, b) => Math.sqrt(a.reduce((s, v, k) => s + (v - b[k]) ** 2, 0));

self.onmessage = (e) => {
  const { samples, rate, tempo } = e.data;
  try {
    const result = analyze(samples, rate, (p) => self.postMessage({ type: 'progress', p }), tempo);
    self.postMessage({ type: 'done', result });
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err.message || err) });
  }
};
