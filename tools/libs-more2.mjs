// Second batch of sampled instruments for parts the test songs (rhythm-game J-core / artcore /
// electro swing / orchestral, Blue Archive-style J-pop) use and MeloFi lacked: orchestral brass and
// wind sections, string tremolo, muted trumpet, soprano sax, sitar, shehnai, mandolin, toy
// glockenspiel, music box, folk harp, chromatic harmonica, more bass guitars.
// Every library downloads straight from its original GitHub repository (raw.githubusercontent.com);
// nothing is bundled. Licences checked on each repository's LICENSE / README.
//
// Merged into LIBS by tools/build-instruments.mjs; every entry passes tools/check-pitch.mjs.
import { vcslMap, vcslMulti } from './vcsl-map.mjs';

const VSCO = { maker: 'Versilian Studios (VSCO 2 CE)', license: 'CC0', url: 'https://github.com/sgossner/VSCO-2-CE', strings: false };
const VS = 'VSCO-2-CE-master/_melofi/';
const VCSL = { maker: 'Versilian Studios (VCSL)', license: 'CC0', url: 'https://github.com/sgossner/VCSL', strings: false };
const VC = 'VCSL-master/_melofi/';
const N = '([A-G]#?-?\\d)'; // VCSL / VSCO note name

const SSO = {
  maker: 'Sonatina Symphonic Orchestra (Mattias Westlund), SFZ by peastman', license: 'CC Sampling Plus 1.0',
  url: 'https://github.com/peastman/sso', strings: false,
};
const SS = 'sso-master/Sonatina Symphonic Orchestra/';
// SSO's performance programs stack the same samples in two or three groups that a sampler
// crossfades with the mod wheel (xfin/xfout on CC1); we play the plain sample once
const once = () => { const seen = new Set(); return (r) => { const k = `${r.file}|${r.lo}|${r.hi}|${r.lv}`; if (seen.has(k)) return false; seen.add(k); return true; }; };

// SSO's woodwind solo programs point at Samples/<name>/, but the repository keeps those recordings
// only under Samples-looped/<Name>/ (file names carry the note; mapped at the named pitch, as the program does)
const ssoLooped = (blobs, dir, stem, opts) => vcslMap(blobs, `Sonatina Symphonic Orchestra/Samples-looped/${dir}/`, new RegExp(`^${stem}-([a-g]#?\\d)\\.wav$`), opts);

const GM = { maker: 'Dr. Narayan Bhagawan Raikar · Discord SFZ GM Bank', license: 'CC0', url: 'https://github.com/sfzinstruments/Discord-SFZ-GM-Bank', strings: false };
const GMD = 'Discord-SFZ-GM-Bank-master/Discord GM/Melodic/';
const GT = {
  maker: 'Tobias Marberger (G-Town Church Sampling Project), SFZ by S. Christian Collins', license: 'CC Sampling Plus 1.0',
  url: 'https://github.com/sfzinstruments/GTownChurchSamplingProject', strings: false,
};
const GTD = 'GTownChurchSamplingProject-master/G-Town Church Sampling Project/';
const OPEN = {
  maker: 'Open Samples (Jeffrey Brice, Portland Community College Sonic Arts)',
  license: 'Open Samples Permissive Use License v2 (free use; non-commercial redistribution only, no resale, no AI training)',
  url: 'https://github.com/pumodi/open-samples', strings: false,
};

// VSCO 2 CE string sections stacked across the keyboard (as tools/libs-pop.mjs builds its strings)
const sec = (part, stem) => ({
  cello: { dir: `Strings/Cello Section/${part.cello}/`, re: new RegExp(`^${stem.cello}_([A-G]#?\\d)_v(\\d)_(?:1|RR1)\\.wav$`), hi: 52 },
  viola: { dir: `Strings/Viola Section/${part.viola}/`, re: new RegExp(`^${stem.viola}_([A-G]#?\\d)_v(\\d)_(?:1|rr1)\\.wav$`), lo: 53, hi: 62 },
  violin: { dir: `Strings/Violin Section/${part.violin}/`, re: new RegExp(`^${stem.violin}_([A-G]#?\\d)_v(\\d)(?:_rr1)?\\.wav$`), lo: 63 },
});

export const MORE2_LIBS = {
  // ---------------- orchestral sections (epic J-core, artcore, game OST) ----------------
  trumpets: {
    ...SSO, order: 80.1, family: 'brass', name: 'Trumpet Section', model: '트럼펫 섹션',
    tags: ['jpop', 'kpop'], use: '오케스트라 OST, 아트코어의 웅장한 트럼펫 합주',
    sfz: `${SS}Brass - Performance/Trumpets Sustain.sfz`, filter: once(),
  },
  horns: {
    ...SSO, order: 81.1, family: 'brass', name: 'Horn Section', model: '호른 섹션',
    tags: ['jpop'], use: '영화·게임 OST의 장대한 호른 합주',
    sfz: `${SS}Brass - Performance/Horns Sustain.sfz`, filter: once(),
  },
  trombones: {
    ...SSO, order: 82.1, family: 'brass', name: 'Trombone Section', model: '트롬본 섹션',
    tags: ['jpop'], use: '묵직한 오케스트라 저음 브라스, 에픽 하드코어의 브라스 히트',
    sfz: `${SS}Brass - Performance/Trombones Sustain.sfz`, filter: once(),
  },
  stringstrem: {
    ...VSCO, order: 34.5, family: 'strings', name: 'String Tremolo', model: '스트링 트레몰로',
    tags: ['jpop', 'kpop'], use: '긴장감 있는 오케스트라 OST, 심포닉 하드코어의 떨리는 현악',
    sfz: `${VS}stringstrem.sfz`,
    gen: (blobs) => {
      const s = sec({ cello: 'trem', viola: 'trem', violin: 'Trem' }, { cello: 'trem', viola: 'Violas_trem', violin: 'VlnEns_Trem' });
      return vcslMulti(blobs, [{ ...s.cello, layers: ['1', '2'] }, { ...s.viola, layers: ['1', '2'] }, { ...s.violin, layers: ['1', '2'] }], { c3: true, release: 0.5, file: 'stringstrem' });
    },
  },
  piccolo: {
    ...SSO, order: 63.2, family: 'winds', name: 'Piccolo', model: '피콜로',
    tags: ['jpop'], use: '행진곡, 오케스트라 OST의 가장 높은 목관 멜로디',
    // the program points at Samples/piccolo/, but the repository keeps these under Samples-looped/Piccolo/
    sfz: 'sso-master/_melofi/piccolo.sfz',
    gen: (blobs) => vcslMap(blobs, 'Sonatina Symphonic Orchestra/Samples-looped/Piccolo/', /^piccolo-([a-g]#?\d)\.wav$/, { shift: 12, release: 0.55, file: 'piccolo' }), // named an octave below how it sounds, as the program maps it
  },
  altoflute: {
    ...SSO, order: 63.3, family: 'winds', name: 'Alto Flute', model: '알토 플루트',
    tags: ['jpop'], use: '부드럽고 어두운 플루트, 몽환적인 OST',
    sfz: 'sso-master/_melofi/altoflute.sfz',
    gen: (blobs) => ssoLooped(blobs, 'Alto Flute', 'alto_flute', { release: 0.5, file: 'altoflute' }),
  },
  englishhorn: {
    ...SSO, order: 64.1, family: 'winds', name: 'English Horn', model: '잉글리시 호른',
    tags: ['jpop'], use: '쓸쓸한 오보에 계열 솔로, 서정적인 게임 OST',
    sfz: 'sso-master/_melofi/englishhorn.sfz',
    gen: (blobs) => ssoLooped(blobs, 'Cor Anglais', 'cor_anglais', { release: 0.4, file: 'englishhorn' }),
  },
  bassclarinet: {
    ...SSO, order: 65.2, family: 'winds', name: 'Bass Clarinet', model: '베이스 클라리넷',
    tags: ['jpop'], use: '오케스트라의 낮은 목관, 장난스럽거나 으스스한 베이스 라인',
    sfz: 'sso-master/_melofi/bassclarinet.sfz',
    gen: (blobs) => ssoLooped(blobs, 'Bass Clarinet', 'bass_clarinet', { release: 0.4, file: 'bassclarinet' }),
  },
  crotales: {
    ...SSO, order: 77.6, family: 'mallets', name: 'Crotales', model: '크로탈 (앤티크 심벌)',
    tags: ['jpop'], use: '반짝이는 고음 종소리, 판타지 OST의 장식음',
    sfz: `${SS}Percussion/Crotales.sfz`,
  },
  largechorus: {
    ...SSO, maker: 'Sonatina Symphonic Orchestra (Mattias Westlund), loops by Signal Experiments',
    order: 89.1, family: 'vocal', name: 'Large Chorus', model: '대합창 (아)',
    tags: ['jpop'], use: '심포닉 하드코어, 보스전 OST의 웅장한 대합창',
    sfz: `${SS}Chorus - Performance/Large Chorus.sfz`, filter: once(),
  },

  // ---------------- jazz / electro swing ----------------
  mutedtrumpet: {
    ...VSCO, order: 80.2, family: 'brass', name: 'Muted Trumpet (Harmon)', model: '뮤트 트럼펫 (하몬)',
    tags: ['pop', 'jpop'], use: '일렉트로 스윙, 재즈의 와우 하몬 뮤트 트럼펫',
    sfz: `${VS}mutedtrumpet.sfz`,
    gen: (blobs) => vcslMap(blobs, 'Brass/Trumpet/harmonM-sus/', new RegExp(`^Sum_SHTrumpet_harmonM-sus_${N}_v(\\d)_rr1\\.wav$`), { c3: true, release: 0.25, file: 'mutedtrumpet' }),
  },
  sopranosax: {
    order: 66.3, family: 'winds', name: 'MTG Soprano Sax', model: '소프라노 색소폰', maker: 'Music Technology Group (UPF), SFZ by sfzinstruments',
    license: 'CC BY 4.0', url: 'https://github.com/sfzinstruments/MTG.SoloSax', strings: false,
    tags: ['pop', 'jpop'], use: '스무드 재즈, 시티팝의 맑은 소프라노 색소폰',
    sfz: 'MTG.SoloSax-master/MTG Solo Saxophones/MTG Soprano Sax.sfz',
    // breath and key noises (sop_b_*, sop_k_*) are mapped over whole octaves and would win over the notes
    filter: (r) => !/sop_[bk]_\d/.test(r.file || ''),
  },

  // ---------------- cute / J-pop colours ----------------
  musicbox: {
    ...OPEN, order: 9.9, family: 'keys', name: 'Music Box', model: '오르골',
    tags: ['jpop', 'kpop'], use: '자장가, 귀여운 J-pop·퓨처 베이스 인트로의 오르골',
    sfz: 'open-samples-main/_melofi/musicbox.sfz',
    retune: true, // the comb sits about a quarter-tone sharp of A440 in places
    // AB pair recorded as separate mono files: the left one
    gen: (blobs) => vcslMap(blobs, 'MusicBoxes/Samples/hardDriveMusicBox/', /^musicBox_([A-G]b?\d)_L-001\.wav$/, { release: 1.2, file: 'musicbox' }),
  },
  toyglock: {
    ...GT, order: 72.1, family: 'mallets', name: 'Toy Glockenspiel', model: '장난감 글로켄슈필',
    tags: ['jpop', 'kpop'], use: '귀여운 J-pop, 동요풍 반주의 장난감 철금',
    sfz: `${GTD}Toy_Glockenspiel.sfz`,
    filter: (r) => r.lv === 1 && r.label !== 'Glissandos', // the second velocity group repeats the same samples
    retune: true, // a toy: bars a few tens of cents apart
    shift: 36, // the program maps each bar three octaves below where it rings (f0 checked by spectrum: nothing below the +3 oct partial)
  },

  // ---------------- plucked & world ----------------
  mandolin: {
    ...GT, order: 24.6, family: 'guitar', name: 'Mandolin', model: '만돌린',
    tags: ['pop', 'jpop'], use: '포크, 이탈리아풍·판타지 게임 음악의 트레몰로 없는 만돌린',
    sfz: `${GTD}Mandolin.sfz`,
    filter: (r) => r.lv === 1,
  },
  folkharp: {
    ...VCSL, maker: 'Versilian Studios (VCSL, Etherealwinds Harp)', order: 13.1, family: 'strings', name: 'Folk Harp', model: '포크 하프 (켈틱)',
    tags: ['jpop'], use: '켈틱·판타지 RPG 음악의 맑은 레버 하프',
    sfz: `${VC}folkharp.sfz`,
    gen: (blobs) => vcslMap(blobs, 'Chordophones/Composite Chordophones/Folk Harp/', new RegExp(`^EWHarp_Normal_${N}_v(\\d)_RR1\\.wav$`), { layers: ['2', '3'], c3: true, release: 0.8, file: 'folkharp' }),
  },
  sitar: {
    ...GM, order: 102.5, family: 'world', name: 'Sitar', model: '시타르',
    tags: ['pop'], use: '인도풍 사이키델릭, 오리엔탈 EDM의 시타르',
    sfz: `${GMD}105-Sitar/Sitar.sfz`,
  },
  shehnai: {
    ...GM, order: 102.6, family: 'world', name: 'Shehnai', model: '셰나이 (인도 피리)',
    tags: ['pop'], use: '인도 결혼식 음악, 오리엔탈 리드의 날카로운 겹리드 피리',
    // the original program writes "Sample=" (capital S), which our reader skips: same mapping, rewritten
    sfz: `${GMD}112-Shanai/_melofi_shehnai.sfz`,
    gen: () => {
      const white = [0, 2, 4, 5, 7, 9, 11];
      let text = '// generated from Shanai.sfz (Discord SFZ GM Bank)\n<global>\nampeg_attack=0.01\nampeg_release=0.15\noffset=100\n';
      for (let i = 0; i < 22; i++) {
        const c = 48 + 12 * Math.floor(i / 7) + white[i % 7]; // the program's c1 sounds C3 (checked: two octaves up)
        const hi = i === 21 ? 108 : c + (white[(i + 1) % 7] - white[i % 7] + 12) % 12 - 1;
        text += `<region> pitch_keycenter=${c} lokey=${i === 0 ? 36 : c} hikey=${hi} sample=Shn${String(i + 1).padStart(2, '0')}.flac\n`;
      }
      return [{ name: 'Discord GM/Melodic/112-Shanai/_melofi_shehnai.sfz', text }];
    },
  },
  chromharmonica: {
    ...VCSL, order: 62.1, family: 'winds', name: 'Chromatic Harmonica', model: '크로매틱 하모니카',
    tags: ['pop', 'jpop'], use: '재즈·샹송, 쓸쓸한 영화 음악의 크로매틱 하모니카',
    sfz: `${VC}chromharmonica.sfz`,
    gen: (blobs) => vcslMap(blobs, 'Aerophones/Free Aerophones/Harmonica-Hohner-Super64/Sustains/Normal/', new RegExp(`^Hohner-Super64_Normal _${N}\\.wav$`), { c3: true, release: 0.15, file: 'chromharmonica' }),
  },

  // ---------------- bass guitars ----------------
  swagbass: {
    order: 32.4, family: 'bass', name: 'Swagbass', model: '일렉 베이스 (둥근)', maker: 'Karoryfer Samples (Swagbass)',
    license: 'CC0', url: 'https://github.com/sfzinstruments/karoryfer.swagbass', strings: false,
    tags: ['kpop', 'pop', 'jpop'], use: '둥글고 따뜻한 일렉 베이스, R&B·시티팝',
    sfz: 'karoryfer.swagbass-master/swagbass_clean.sfz',
  },
  darkblackbass: {
    order: 32.45, family: 'bass', name: 'Dark Black 5-String', model: '5현 베이스', maker: 'Karoryfer Samples (Black And Blue Basses)',
    license: 'CC0', url: 'https://github.com/sfzinstruments/karoryfer.black-and-blue-basses', strings: false,
    tags: ['kpop', 'pop', 'jpop'], use: '록·J-pop 밴드 사운드의 단단한 5현 베이스',
    sfz: 'karoryfer.black-and-blue-basses-main/Programs/05-darkblack_pluck.sfz',
    shift: -12, // mapped like bass notation (an octave above how it sounds); f0 checked by spectrum
  },

  // ---------------- sampled hardware synths (publicsamples / Modular Samples, public domain) ----------------
  minichorus: {
    order: 26.3, family: 'synth', name: 'Minilogue Chorus Poly', model: '아날로그 폴리 신스 (코러스)', maker: 'Modular Samples (publicsamples), Korg Minilogue',
    license: 'Public Domain (Unlicense)', url: 'https://github.com/publicsamples/Korg-Minilogue', strings: false,
    tags: ['jpop', 'kpop', 'pop'], use: '시티팝·신스팝의 코러스 걸린 아날로그 폴리 코드',
    sfz: 'Korg-Minilogue-main/SFZ/Free Chorus.sfz',
  },
  minibell: {
    order: 26.4, family: 'synth', name: 'Minilogue Door Bell', model: '아날로그 벨 신스', maker: 'Modular Samples (publicsamples), Korg Minilogue',
    license: 'Public Domain (Unlicense)', url: 'https://github.com/publicsamples/Korg-Minilogue', strings: false,
    tags: ['jpop', 'kpop'], use: '퓨처 베이스·J-pop의 맑은 신스 벨 아르페지오',
    sfz: 'Korg-Minilogue-main/SFZ/Door Bell.sfz',
    filter: (r) => r.lv === 1 || r.lv === 96, // two of the four velocity recordings (each is ~1 MB a note)
    // the patch rings a fifth below each key it was recorded on (partials 2:3:4 over the note 19 semitones down;
    // strongest at the octave above it) — checked by spectrum, so each sample moves down to the key it sounds
    shift: -7,
  },
};
