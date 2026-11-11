// Second batch of archive / SoundFont instruments (see docs/archive-import.md and tools/libs-archive.mjs):
// more analog and hybrid synth pads, leads, plucks and bells from publicsamples (GitHub release zips,
// fetched by Range), and sampled voices, harmonica, bandoneon, violin and bells from the two General
// MIDI SoundFonts MeloFi already reads (MuseScore_General.sf2, GeneralUser GS). Nothing is re-hosted.
//
// Licences read on 2026-11-12: every publicsamples repository below has the same Unlicense-style
// public-domain LICENSE (Roland-HS-80, Fender-Chroma-Polaris, Akai-AX80, Ensoniq-ESQ1, Roland-Jupiter-4,
// Kawai-K3, Novation-Ultranova, Roland-JX-3P, Korg-Z1); MuseScore_General presets used are FluidR3 material
// (MuseScore_General_Sample_Sources.csv lists no other source for them; MIT); GeneralUser GS License v2.0.
import { archive, soundfont, gm } from './libs-archive.mjs';

// publicsamples: SFZ program from the git tree, audio (AIFF / WAV) from the release zip.
// prefix: where the program is placed so its relative sample paths point into the unpacked zip;
// transform: rewrites the program's paths where the zip's folder names differ from the tree's.
const ps = (key, repo, tag, assets, sfzPath, prefix, cfg, transform) => archive(key, {
  release: { repo: `publicsamples/${repo}`, tag, assets }, format: 'zip', remote: true,
  sfz: `${prefix}${sfzPath}`, sfzFrom: { repo: `publicsamples/${repo}`, path: sfzPath, ...(transform ? { transform } : {}) },
}, {
  maker: 'Modular Samples (publicsamples)', license: 'Public Domain', url: `https://github.com/publicsamples/${repo}`, strings: false, ...cfg,
  credit: `${cfg.name} — Modular Samples / Richard Taylor. Public domain. https://github.com/publicsamples/${repo}`,
});
const parts = (stem, n) => Array.from({ length: n }, (_, i) => `${stem}.${String(i + 1).padStart(3, '0')}`);
const CHROMA = parts('Audio.zip', 4), AX80 = parts('Audio.zip', 2), ESQ1 = parts('Audio.zip', 2);
const JP4PADS = parts('Pads.zip', 4), NOVA = parts('NovationUltraNova.zip', 6), JX3P = parts('RolandJX-3P.zip', 3), Z1 = parts('KorgZ1.zip', 5);
const polAudio = (t) => t.replace(/PolAudio\//g, 'Audio/'); // Chroma programs name the folder PolAudio, the zip Audio
const novaAudio = (t) => t.replace(/UNAudio\//g, 'NovationUltraNova/Audio/');
const z1Dirs = (t) => t.replace(/-SAMPLES\//g, '/'); // "Slow Bell-SAMPLES/" in the programs is "Slow Bell/" in the zip
const k3 = (dir) => (t) => t.replace(/\.\.\/Audio\/([^/\r\n]*?)-SAMPLES\//g, `../../${dir}/$1/`);
// every second key: long multi-second samples on all 61 keys would pass 300 MB; the build fills the gaps
const everyOther = (r) => r.center % 2 === 0;

// GeneralUser GS 2 (as in tools/libs-archive.mjs)
const GU = {
  url: 'https://raw.githubusercontent.com/mrbumpy409/GeneralUser-GS/97049183643d5fc5a9322a69c5b09efb667c6c3a/GeneralUser-GS.sf2',
  file: 'GeneralUser-GS.sf2', size: 32319396, sha256: '9575028c7a1f589f5770fccc8cff2734566af40cd26ed836944e9a5152688cfe',
};
const gu = (key, program, cfg) => soundfont(key, { ...GU, bank: 0, program }, {
  maker: 'S. Christian Collins (GeneralUser GS 2)', license: 'GeneralUser GS License v2.0', url: 'https://github.com/mrbumpy409/GeneralUser-GS', ...cfg,
  credit: `${cfg.name} — GeneralUser GS 2.0.3 by S. Christian Collins. GeneralUser GS License v2.0: free to use, modify and include in software. https://github.com/mrbumpy409/GeneralUser-GS`,
});

// Left out after planning: presets that sound two or three zones per note, which MeloFi's
// one-region-per-note sampler can't play as designed — MuseScore Choir Aahs (52: unlinked left/right
// recordings), Harmonica (22), Bandoneon (23); GeneralUser Concert Choir (52) and Voice Oohs (53).
// MuseScore Tubular Bells (14) is one C7 sample stretched over the keyboard, too thin to add.
//
// Pitch: the programs map each sample to the key sent to the hardware. Where a spectrum (several notes
// across the range, after the attack) shows the strongest partial an octave or two away from that key on
// at least three of four notes by 6 dB or more, `shift` maps the sample at the pitch it sounds (sub-oscillator
// or 16'/32' footage: HS-80 Vs Pad / Wide Open, ESQ-1 Detuned Pad, JX-3P Slow One −12; Z1 Slow Bell −24;
// Chroma Fritz Pad +12, recorded an octave above its key). Patches where it changes across the range are
// left as played: Jupiter-4 Romans Pad (−12 low, −24 high), HS-80 Chicken Plucker, AX80 Grit Lead,
// UltraNova Aaaaaah! (sub-octave a few dB louder on some notes only), K3 Gentle Pad (chorused, at the key).
export const ARCHIVE2_LIBS = {
  // ---------------- analog / hybrid synth pads (slow filter, chorus) ----------------
  hs80vspad: ps('hs80vspad', 'Roland-HS-80', '1.0', 'Audio.zip', 'SFZ/Vs Pad.sfz', '',
    { order: 25.8, family: 'synth', name: 'HS-80 Vs Pad', model: 'Roland HS-80 패드 (코러스)', tags: ['kpop', 'pop', 'jpop'], use: '주노 계열의 코러스 걸린 아날로그 패드, 80년대 J-pop', shift: -12 }),
  hs80wideopen: ps('hs80wideopen', 'Roland-HS-80', '1.0', 'Audio.zip', 'SFZ/Wide Open.sfz', '',
    { order: 25.81, family: 'synth', name: 'HS-80 Wide Open', model: 'Roland HS-80 패드 (필터 열림)', tags: ['pop', 'jpop'], use: '필터가 활짝 열린 밝은 아날로그 패드', shift: -12 }),
  chromafritzpad: ps('chromafritzpad', 'Fender-Chroma-Polaris', '1.0', CHROMA, 'SFZ/FritzPad.sfz', '',
    { order: 25.82, family: 'synth', name: 'Chroma Polaris Fritz Pad', model: 'Chroma Polaris 패드', tags: ['pop', 'jpop'], use: '부드럽게 부풀어 오르는 빈티지 아날로그 패드', shift: 12 }, polAudio),
  ax80wiseoldpad: ps('ax80wiseoldpad', 'Akai-AX80', 'v1.0', AX80, 'SFZ/WiseOldPad.sfz', '',
    { order: 25.83, family: 'synth', name: 'AX80 Wise Old Pad', model: 'Akai AX80 패드', tags: ['pop', 'jpop'], use: '느리게 열리는 따뜻한 아날로그 패드, 신스웨이브' }),
  esq1detunedpad: ps('esq1detunedpad', 'Ensoniq-ESQ1', '1.0', ESQ1, 'SFZ/Detuned Pad .sfz', '',
    { order: 25.84, family: 'synth', name: 'ESQ-1 Detuned Pad', model: 'Ensoniq ESQ-1 패드 (디튠)', tags: ['kpop', 'pop', 'jpop'], use: '디튠으로 넓게 퍼지는 80년대 하이브리드 패드', shift: -12 }),
  jp4romanspad: ps('jp4romanspad', 'Roland-Jupiter-4', '1.0', JP4PADS, 'SFZ/JP4 Romans Pad.sfz', 'Pads/',
    { order: 25.85, family: 'synth', name: 'Jupiter-4 Romans Pad', model: 'Roland Jupiter-4 패드', tags: ['pop', 'jpop'], use: '두텁고 따뜻한 빈티지 폴리 신스 패드' }),
  k3gentlepad: ps('k3gentlepad', 'Kawai-K3', '1.0', 'Pad.zip', 'SFZ/Pad/Gentle Pad.sfz', '',
    { order: 25.86, family: 'synth', name: 'K3 Gentle Pad', model: 'Kawai K3 패드', tags: ['kpop', 'pop', 'jpop'], use: '디지털 웨이브에 아날로그 필터를 단 잔잔한 패드' }, k3('Pad')),
  novalush: ps('novalush', 'Novation-Ultranova', '1.0', NOVA, 'SFZ/Lush.sfz', '',
    { order: 25.87, family: 'synth', name: 'UltraNova Lush', model: 'Novation UltraNova 패드', tags: ['kpop', 'jpop'], use: '풍성한 현대 신스 패드, EDM·트랜스의 배경', filter: everyOther }, novaAudio),
  jx3pslowone: ps('jx3pslowone', 'Roland-JX-3P', '1.0', JX3P, 'SFZ/SlowOne.sfz', 'RolandJX-3P/',
    { order: 25.88, family: 'synth', name: 'JX-3P Slow One', model: 'Roland JX-3P 패드 (느린 어택)', tags: ['pop', 'jpop'], use: '천천히 부풀어 오르는 80년대 패드', shift: -12 }),
  // ---------------- saw leads ----------------
  ax80gritlead: ps('ax80gritlead', 'Akai-AX80', 'v1.0', AX80, 'SFZ/GritLead.sfz', '',
    { order: 25.9, family: 'synth', name: 'AX80 Grit Lead', model: 'Akai AX80 리드', tags: ['jpop'], use: '거친 톱니파 아날로그 리드, 하드코어·EDM 멜로디' }),
  chromaempiricist: ps('chromaempiricist', 'Fender-Chroma-Polaris', '1.0', CHROMA, 'SFZ/Empiricist Lead.sfz', '',
    { order: 25.91, family: 'synth', name: 'Chroma Polaris Empiricist Lead', model: 'Chroma Polaris 리드', tags: ['pop', 'jpop'], use: '길게 끄는 밝은 아날로그 리드' }, polAudio),
  // ---------------- plucks ----------------
  hs80plucker: ps('hs80plucker', 'Roland-HS-80', '1.0', 'Audio.zip', 'SFZ/Chicken Plucker.sfz', '',
    { order: 25.92, family: 'synth', name: 'HS-80 Chicken Plucker', model: 'Roland HS-80 플럭', tags: ['kpop', 'pop', 'jpop'], use: '레조넌스 필터로 톡 튀는 아날로그 플럭, 아르페지오' }),
  ax80easypluck: ps('ax80easypluck', 'Akai-AX80', 'v1.0', AX80, 'SFZ/EasyPluck.sfz', '',
    { order: 25.93, family: 'synth', name: 'AX80 Easy Pluck', model: 'Akai AX80 플럭', tags: ['jpop', 'kpop'], use: '짧게 끊기는 아날로그 플럭, 빠른 아르페지오' }),
  // ---------------- synth bells ----------------
  k3belles: ps('k3belles', 'Kawai-K3', '1.0', 'Bells.zip', 'SFZ/Bells/Belles.sfz', '',
    { order: 25.94, family: 'synth', name: 'K3 Belles', model: 'Kawai K3 벨', tags: ['jpop', 'kpop'], use: '디지털 웨이브의 맑은 신스 벨' }, k3('Bells')),
  z1slowbell: ps('z1slowbell', 'Korg-Z1', '1.0', Z1, 'SFZ/Slow Bell.sfz', '',
    { order: 25.95, family: 'synth', name: 'Z1 Slow Bell', model: 'Korg Z1 벨 패드', tags: ['jpop'], use: '천천히 울리는 벨 패드, 몽환적인 배경', shift: -24 }, z1Dirs),
  // ---------------- voice-like synth ----------------
  novaaah: ps('novaaah', 'Novation-Ultranova', '1.0', NOVA, 'SFZ/Aaaaaah!.sfz', '',
    { order: 25.96, family: 'synth', name: 'UltraNova Aaaaaah!', model: 'Novation UltraNova 보이스 패드 ("아")', tags: ['jpop', 'kpop'], use: '모음 "아"처럼 들리는 신스 보이스 패드', filter: everyOther }, novaAudio),

  // ---------------- sampled voices (wordless vowels) ----------------
  msgvoiceoohs: gm('msgvoiceoohs', 53, { order: 90.2, family: 'vocal', name: 'Voice Oohs (FluidR3)', model: '보이스 "우"', tags: ['jpop', 'kpop', 'pop'], use: '부드러운 "우" 보이스, 발라드·R&B의 코러스' }),
  msgsynthvoice: gm('msgsynthvoice', 54, { order: 90.3, family: 'vocal', name: 'Synth Voice (FluidR3)', model: '신스 보이스', tags: ['jpop'], use: '모음 소리 같은 신스 보이스, 보컬 찹 대용' }),
  gusynthvoice: gu('gusynthvoice', 54, { order: 90.6, family: 'vocal', name: 'Synth Vox Aahs (GeneralUser)', model: '신스 보이스 "아"', tags: ['jpop'], use: '신스로 다듬은 "아" 모음, 일렉트로닉 곡의 보이스' }),
  // ---------------- violin ----------------
  msgslowviolin: gm('msgslowviolin', 40, { order: 36.3, family: 'strings', name: 'Slow Violin (FluidR3)', model: '바이올린 (느린 어택)', tags: ['jpop'], use: '천천히 들어오는 레가토 바이올린 선율' }, 8),
};
