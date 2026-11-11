// Instruments picked for current K-pop, Western pop and J-pop production (see docs/instruments.md
// for the survey behind the list). Everything here is CC0 / CC BY / Unlicense and downloads
// straight from its original GitHub repository; nothing is bundled.
//
// tags: which charts the sound is common in — kpop, pop, jpop. use: one line for the download center.
import { vcslMap, vcslMulti, kitMap, oneShot } from './vcsl-map.mjs';

const VSCO = { maker: 'Versilian Studios (VSCO 2 CE)', license: 'CC0', url: 'https://github.com/sgossner/VSCO-2-CE', strings: false };
const VCSL = { maker: 'Versilian Studios (VCSL)', license: 'CC0', url: 'https://github.com/sgossner/VCSL', strings: false };
const VS = 'VSCO-2-CE-master/_melofi/';
const VC = 'VCSL-master/_melofi/';

// VSCO 2 CE and VCSL name notes with C3 = middle C; checked per instrument with tools/check-pitch.mjs
const sec = (part, stem) => ({
  cello: { dir: `Strings/Cello Section/${part.cello}/`, re: new RegExp(`^${stem.cello}_([A-G]#?\\d)_v(\\d)_(?:1|RR1)\\.wav$`), hi: 52 },
  viola: { dir: `Strings/Viola Section/${part.viola}/`, re: new RegExp(`^${stem.viola}_([A-G]#?\\d)_v(\\d)_(?:1|rr1)\\.wav$`), lo: 53, hi: 62 },
  violin: { dir: `Strings/Violin Section/${part.violin}/`, re: new RegExp(`^${stem.violin}_([A-G]#?\\d)_v(\\d)(?:_rr1)?\\.wav$`), lo: 63 },
});

export const POP_LIBS = {
  // ---------------- strings ----------------
  strings: {
    ...VSCO, order: 33, family: 'strings', name: 'String Ensemble', model: '스트링 앙상블',
    tags: ['kpop', 'pop', 'jpop'], use: '발라드, 후렴 뒤에 까는 현악 패드',
    sfz: `${VS}strings.sfz`,
    gen: (blobs) => {
      const s = sec({ cello: 'susvib', viola: 'susvib', violin: 'susVib' }, { cello: 'susvib', viola: 'ViolaEns_susvib', violin: 'VlnEns_susVib' });
      return vcslMulti(blobs, [{ ...s.cello, layers: ['1', '3'] }, { ...s.viola, layers: ['1', '2'] }, { ...s.violin, layers: ['1', '2'] }], { c3: true, release: 0.6, file: 'strings' });
    },
  },
  stringsstac: {
    ...VSCO, order: 34, family: 'strings', name: 'String Staccato', model: '스트링 스타카토',
    tags: ['kpop', 'pop', 'jpop'], use: '댄스곡의 짧게 끊는 현악 리듬',
    sfz: `${VS}stringsstac.sfz`,
    gen: (blobs) => {
      const s = sec({ cello: 'spic', viola: 'spic', violin: 'Spic' }, { cello: 'spic', viola: 'Violas_spic', violin: 'VlnEns_Spic' });
      return vcslMulti(blobs, [{ ...s.cello, layers: ['1', '2'] }, { ...s.viola, layers: ['1', '2'] }, { ...s.violin, re: /^VlnEns_Spic_([A-G]#?\d)_v(\d)_rr1\.wav$/, layers: ['1', '2'] }], { c3: true, release: 0.2, file: 'stringsstac' });
    },
  },
  stringspizz: {
    ...VSCO, order: 35, family: 'strings', name: 'String Pizzicato', model: '스트링 피치카토',
    tags: ['kpop', 'jpop'], use: '귀엽고 통통 튀는 반주',
    sfz: `${VS}stringspizz.sfz`,
    gen: (blobs) => {
      const s = sec({ cello: 'pizzT', viola: 'pizz', violin: 'Pizz' }, { cello: 'pizzT', viola: 'ViolaEns_pizz', violin: 'VlnEns_Pizz' });
      return vcslMulti(blobs, [{ ...s.cello, layers: ['1', '2'] }, { ...s.viola, layers: ['1', '2'] }, { ...s.violin, re: /^VlnEns_Pizz_([A-G]#?\d)_v(\d)_rr1\.wav$/, layers: ['1', '2'] }], { c3: true, release: 0.3, file: 'stringspizz' });
    },
  },
  violin: {
    ...VSCO, order: 36, family: 'strings', name: 'Solo Violin', model: '바이올린',
    tags: ['kpop', 'jpop'], use: '애니메이션 OST, 발라드 간주의 멜로디',
    sfz: `${VS}violin.sfz`,
    gen: (blobs) => vcslMap(blobs, 'Strings/Solo Violin/Arco Vib/', /^LLVln_ArcoVib_([A-G]#?\d)_(p|f)\.wav$/, { layers: ['p', 'f'], release: 0.4, file: 'violin' }),
  },

  // ---------------- brass ----------------
  trumpet: {
    ...VSCO, order: 80, family: 'brass', name: 'Trumpet', model: '트럼펫',
    tags: ['kpop', 'pop', 'jpop'], use: '펑키한 팝, 시티팝의 브라스 라인',
    sfz: `${VS}trumpet.sfz`,
    gen: (blobs) => vcslMap(blobs, 'Brass/Trumpet/susvib/', /^Sum_SHTrumpet_susvib_([A-G]#?\d)_v(\d)_rr1\.wav$/, { c3: true, release: 0.25, file: 'trumpet' }),
  },
  brassstab: {
    ...VSCO, order: 81, family: 'brass', name: 'Brass Stabs', model: '브라스 스탭',
    tags: ['kpop', 'pop', 'jpop'], use: '케이팝 퍼포먼스곡의 짧고 강한 브라스 히트',
    sfz: `${VS}brassstab.sfz`,
    gen: (blobs) => vcslMulti(blobs, [
      { dir: 'Brass/Tenor Trombone/stac/', re: /^tenortbn_stac_([A-G]#?\d)_v(\d)_rr1\.wav$/, hi: 57, layers: ['1', '2', '3'] },
      { dir: 'Brass/Trumpet/stac/', re: /^Sum_SHTrumpet_stac_([A-G]#?\d)_v(\d)_rr1\.wav$/, lo: 58, layers: ['1', '2', '3'] },
    ], { c3: true, release: 0.15, file: 'brassstab' }),
  },
  horn: {
    ...VSCO, order: 82, family: 'brass', name: 'French Horn', model: '프렌치 호른',
    tags: ['jpop', 'kpop'], use: '웅장한 애니메이션 OST, 영화풍 편곡',
    sfz: `${VS}horn.sfz`,
    gen: (blobs) => vcslMap(blobs, 'Brass/F Horn/sus/', /^MOHorn_sus_([A-G]#?\d)_v(\d)_1\.wav$/, { c3: true, release: 0.4, file: 'horn' }),
  },
  trombone: {
    ...VSCO, order: 83, family: 'brass', name: 'Trombone', model: '트롬본',
    tags: ['pop', 'jpop'], use: '스카, 재즈풍 팝의 낮은 브라스',
    sfz: `${VS}trombone.sfz`,
    gen: (blobs) => vcslMap(blobs, 'Brass/Tenor Trombone/sus/', /^tenortbn_sus_([A-G]#?\d)_v(\d)_1\.wav$/, { c3: true, release: 0.3, file: 'trombone' }),
  },

  // ---------------- woodwinds ----------------
  flute: {
    ...VSCO, order: 63, family: 'winds', name: 'Flute', model: '플루트',
    tags: ['kpop', 'pop', 'jpop'], use: '힙합·케이팝에서 자주 쓰는 플루트 루프',
    sfz: `${VS}flute.sfz`,
    gen: (blobs) => vcslMap(blobs, 'Woodwinds/Flute/susvib/', /^LDFlute_susvib_([A-G]#?\d)_v1_1\.wav$/, { c3: true, release: 0.25, file: 'flute' }),
  },
  clarinet: {
    ...VSCO, order: 64, family: 'winds', name: 'Clarinet', model: '클라리넷',
    tags: ['jpop'], use: '잔잔한 OST, 동화 같은 분위기',
    sfz: `${VS}clarinet.sfz`,
    gen: (blobs) => vcslMap(blobs, 'Woodwinds/Clarinet/susLong/', /^DCClar_susLong_([A-G]#?\d)_v(\d)_rr1_sum\.wav$/, { c3: true, release: 0.25, file: 'clarinet' }),
  },
  oboe: {
    ...VSCO, order: 65, family: 'winds', name: 'Oboe', model: '오보에',
    tags: ['jpop'], use: '애니메이션 OST의 서정적인 멜로디',
    sfz: `${VS}oboe.sfz`,
    gen: (blobs) => vcslMap(blobs, 'Woodwinds/Oboe/Vib/', /^Oboe_Vib_([A-G]#?\d)_v(\d)_Main\.wav$/, { layers: ['1', '3'], c3: true, release: 0.25, file: 'oboe' }),
  },
  altosax: {
    order: 66, family: 'winds', name: 'Alto Saxophone', model: '알토 색소폰', maker: 'Music Technology Group (UPF)',
    license: 'CC BY 4.0', url: 'https://github.com/sfzinstruments/MTG.SoloSax', strings: false,
    tags: ['kpop', 'pop', 'jpop'], use: '시티팝, R&B 팝의 색소폰 솔로',
    sfz: 'MTG.SoloSax-master/MTG Solo Saxophones/MTG Alto Sax.sfz',
  },

  // ---------------- voice ----------------
  vocal: {
    order: 90, family: 'vocal', name: 'Vocal "Ah"', model: '보컬 아', maker: 'Karoryfer Samples (Hadzi-Fia)',
    license: 'CC0', url: 'https://github.com/sfzinstruments/legato_vocal_tutorial', strings: false,
    tags: ['kpop', 'pop', 'jpop'], use: '코러스, 보컬 찹, 몽환적인 배경 보컬',
    sfz: 'legato_vocal_tutorial-main/_melofi/vocal.sfz',
    gen: (blobs) => vcslMap(blobs, 'Samples/vowel_sustain/a/', /^vowel_a_([a-g]b?\d)\.wav$/, { release: 0.35, file: 'vocal', shift: -12 }),
  },

  // ---------------- guitars & bass ----------------
  cleanguitar: {
    order: 22, family: 'guitar', name: 'Emily Clean Guitar', model: '일렉 기타 (클린)', maker: 'Karoryfer Samples',
    license: 'CC0', url: 'https://github.com/sfzinstruments/karoryfer.emilyguitar', strings: false,
    tags: ['kpop', 'pop', 'jpop'], use: '커팅, 아르페지오 같은 맑은 일렉 기타',
    sfz: 'karoryfer.emilyguitar-master/emily_clean.sfz',
    filter: (r) => !(r.lv === 1 && r.hv === 127) && !/noise|release/i.test(r.file),
  },
  banjo: {
    order: 24, family: 'guitar', name: 'Ganjo', model: '밴조', maker: 'sfzinstruments',
    license: 'CC0', url: 'https://github.com/sfzinstruments/ganjo', strings: false,
    tags: ['pop'], use: '컨트리 팝에서 돌아온 밴조',
    sfz: 'ganjo-main/ganjo.sfz', retune: true, // recorded about 40 cents sharp
  },
  fingerbass: {
    order: 32.5, family: 'bass', name: 'Fashionbass', model: '핑거 베이스', maker: 'Karoryfer Samples',
    license: 'CC0', url: 'https://github.com/sfzinstruments/karoryfer.fashionbass', strings: false,
    tags: ['kpop', 'pop', 'jpop'], use: '밴드 사운드와 펑크·디스코 팝의 베이스',
    sfz: 'karoryfer.fashionbass-master/fashionbass_clean.sfz',
    filter: (r) => !/noise|release/i.test(r.file),
  },

  // ---------------- added for General MIDI scores: parts MeloFi had no instrument for ----------------
  chorus: {
    order: 89, family: 'vocal', name: 'Mixed Chorus', model: '혼성 합창 (아)',
    maker: 'Sonatina Symphonic Orchestra (Mattias Westlund), loops by Signal Experiments', license: 'CC Sampling Plus 1.0',
    url: 'https://github.com/peastman/sso', strings: false,
    tags: ['kpop', 'jpop', 'pop'], use: '후렴 뒤에 깔리는 웅장한 합창 패드 (여성·남성 혼성 \'아\')',
    sfz: 'sso-master/Sonatina Symphonic Orchestra/Chorus - Performance/Mixed Chorus.sfz',
  },
  contrabass: {
    ...VSCO, order: 39, family: 'strings', name: 'Solo Contrabass', model: '콘트라베이스 (활)',
    tags: ['jpop', 'kpop'], use: '오케스트라 편곡과 OST의 깊은 저음을 받치는 콘트라베이스 아르코',
    sfz: `${VS}contrabass.sfz`,
    gen: (blobs) => vcslMap(blobs, 'Strings/Solo Contrabass/SusVib/', /^BKCtbss_SusVib_([A-G]#?\d)_v(\d)_rr1\.wav$/, { c3: true, layers: ['1', '3'], release: 0.5, file: 'contrabass' }),
  },
  siren: {
    ...VCSL, order: 96, family: 'fx', name: 'Siren Whistle', model: '사이렌',
    tags: ['kpop', 'pop'], use: 'EDM·하드코어 빌드업에 쓰는 사이렌 휘슬 효과음',
    sfz: `${VC}siren.sfz`,
    gen: (blobs) => oneShot(blobs, 'Aerophones/Free Aerophones/Siren/', ['Main_SirenWhistle-005.wav', 'Main_SirenWhistle-008.wav'], { release: 0.3, file: 'siren' }),
  },
  oceandrum: {
    ...VCSL, order: 97, family: 'fx', name: 'Ocean Drum', model: '파도 소리',
    tags: ['jpop', 'pop'], use: '파도·바람처럼 흐르는 앰비언트 효과음 (오션 드럼)',
    sfz: `${VC}oceandrum.sfz`,
    gen: (blobs) => oneShot(blobs, 'Membranophones/Other Membranophones/Ocean Drum/', ['OceanDrum_Sus_2_Mid.wav', 'OceanDrum_Sus_1_Mid.wav'], { release: 0.8, file: 'oceandrum' }),
  },
  cymbalswell: {
    ...VCSL, order: 98, family: 'fx', name: 'Cymbal Swell', model: '리버스 심벌',
    tags: ['kpop', 'pop', 'jpop'], use: '후렴 직전에 차오르는 리버스 심벌 스웰',
    sfz: `${VC}cymbalswell.sfz`,
    gen: (blobs) => oneShot(blobs, 'Idiophones/Struck Idiophones/Suspended Cymbal 1/', ['susCymb1_cresc_2s.wav', 'susCymb1_cresc_1.5s.wav'], { release: 0.2, file: 'cymbalswell' }),
  },

  // ---------------- mallets, bells, plucked ----------------
  kalimba: {
    ...VCSL, order: 74, family: 'mallets', name: 'Kalimba', model: '칼림바',
    tags: ['kpop', 'pop', 'jpop'], use: '로파이, 트로피컬 하우스의 맑은 음색',
    sfz: `${VC}kalimba.sfz`,
    gen: (blobs) => vcslMap(blobs, 'Idiophones/Plucked Idiophones/Kalimba, Tanzania/', /^MBira3_pluck_Main_([A-G]#?\d)_k\d+(?:alt)?_50_100_rr\d\.wav$/, { c3: true, release: 0.6, file: 'kalimba' }),
    retune: true, // a hand-tuned kalimba, 30–50 cents sharp
  },
  handbells: {
    ...VCSL, order: 75, family: 'mallets', name: 'Hand Chimes', model: '핸드벨',
    tags: ['kpop', 'pop', 'jpop'], use: '겨울 노래, 캐럴 느낌의 반짝이는 벨',
    sfz: `${VC}handbells.sfz`,
    gen: (blobs) => vcslMap(blobs, 'Idiophones/Struck Idiophones/Hand Chimes/', /^sus_([A-G]#?\d)_r01_main\.wav$/, { c3: true, release: 1, file: 'handbells' }),
  },
  steeldrum: {
    order: 76, family: 'mallets', name: 'jSteelDrum', model: '스틸 드럼', maker: 'Jeff Learman',
    license: 'Unlicense', url: 'https://github.com/sfzinstruments/jlearman.SteelDrum', strings: false,
    tags: ['pop', 'kpop'], use: '트로피컬 하우스, 여름 노래',
    sfz: 'jlearman.SteelDrum-main/jSteelDrum-noxfade.sfz',
  },

  // ---------------- world (East Asian colours used in K-pop / J-pop) ----------------
  dantranh: {
    ...VCSL, order: 100, family: 'world', name: 'Dan Tranh', model: '단짠 (가야금·고토 계열 현악기)',
    tags: ['kpop', 'jpop'], use: '가야금이나 고토 느낌이 필요한 동양풍 편곡',
    sfz: `${VC}dantranh.sfz`,
    gen: (blobs) => vcslMap(blobs, 'Chordophones/Zithers/Dan Tranh/Normal/', /^([A-G]#?\d)_(mf|f|ff)_1\.wav$/, { layers: ['mf', 'f', 'ff'], c3: true, release: 0.8, file: 'dantranh' }),
    retune: true,
  },
  erhu: {
    order: 101, family: 'world', name: 'Erhu', model: '얼후 (해금과 같은 계열)', maker: 'sfzinstruments',
    license: 'CC0', url: 'https://github.com/sfzinstruments/aliexpress-erhu', strings: false,
    tags: ['kpop', 'jpop'], use: '해금처럼 애절한 현 소리',
    sfz: 'aliexpress-erhu-main/_melofi/erhu.sfz',
    // mapped from the file names: the library's own SFZ maps every note two octaves low and
    // transposes back with a controller
    gen: (blobs) => vcslMap(blobs, 'Samples/sus/', /^erhu_([a-g]b?\d)_sus_rr1\.wav$/, { release: 0.3, file: 'erhu', shift: -12 }),
  },

  // ---------------- percussion ----------------
  handperc: {
    ...VCSL, order: 43, family: 'drums', name: 'Hand Percussion', model: '핸드 퍼커션', kit: true,
    tags: ['kpop', 'pop', 'jpop'], use: '박수, 핑거 스냅, 셰이커, 탬버린, 콩가',
    sfz: `${VC}handperc.sfz`,
    gen: (blobs) => kitMap(blobs, [
      { key: 39, dir: 'Idiophones/Struck Idiophones/Claps/', re: /^SoloClap_vl(\d)\.wav$/ },
      { key: 54, dir: 'Idiophones/Struck Idiophones/Tambourine 1/', re: /^Tamb1_Hit_v(\d)_rr1_Mid\.wav$/ },
      { key: 56, dir: 'Idiophones/Struck Idiophones/Cowbells/', re: /^Cowbell1_Hit_v(\d)_rr1_Mid\.wav$/, layers: ['2', '3', '4'] },
      { key: 60, dir: 'Membranophones/Struck Membranophones/Bongos/', re: /^BongoH_Hit1_v(\d)_rr1_Mid\.wav$/ },
      { key: 61, dir: 'Membranophones/Struck Membranophones/Bongos/', re: /^BongoL_Hit1_v(\d)_rr1_Mid\.wav$/ },
      { key: 62, dir: 'Membranophones/Struck Membranophones/Conga/', re: /^Conga_HitFM_v(\d)_rr1_Sum\.wav$/ },
      { key: 63, dir: 'Membranophones/Struck Membranophones/Conga/', re: /^Conga_HitN_v(\d)_rr1_Sum\.wav$/ },
      { key: 64, dir: 'Membranophones/Struck Membranophones/Conga/', re: /^Tumba_HitN_v(\d)_rr1_Sum\.wav$/ },
      { key: 67, dir: 'Idiophones/Struck Idiophones/Agogo Bells/', re: /^Agogo_High_v(\d)_rr1_Mid\.wav$/ },
      { key: 68, dir: 'Idiophones/Struck Idiophones/Agogo Bells/', re: /^Agogo_Low_v(\d)_rr1_Mid\.wav$/ },
      { key: 69, dir: 'Idiophones/Struck Idiophones/Cabasa/', re: /^Cabasa1_Hit_rr1_Mid\.wav$/ },
      { key: 70, dir: 'Idiophones/Struck Idiophones/Shaker, Small/', re: /^Mid_Shaker_Slap_rr1\.wav$/ },
      { key: 73, dir: 'Idiophones/Struck Idiophones/Guiro/', re: /^Guiro_Hit_rr1_Mid\.wav$/ },
      { key: 74, dir: 'Idiophones/Struck Idiophones/Guiro/', re: /^Guiro_Med_rr1_Mid\.wav$/ },
      { key: 75, dir: 'Idiophones/Struck Idiophones/Claves/', re: /^Claves1_Hit_v(\d)_rr1_Mid\.wav$/ },
      { key: 76, dir: 'Idiophones/Struck Idiophones/Woodblock/', re: /^wood_click_(pp|mp|ff)(?:_rr1)?\.wav$/, layers: ['pp', 'mp', 'ff'] },
      { key: 80, dir: 'Idiophones/Struck Idiophones/Triangles/', re: /^Triangle1_HitM_v(\d)_rr2_Mid\.wav$/ },
      { key: 81, dir: 'Idiophones/Struck Idiophones/Triangles/', re: /^Triangle1_Hit_v(\d)_rr1_Mid\.wav$/ },
      { key: 82, dir: 'Idiophones/Struck Idiophones/Shaker, Small/', re: /^Mid_ShakerDouble_Down_rr1\.wav$/ },
      { key: 83, dir: 'Idiophones/Struck Idiophones/Sleigh Bells/', re: /^Sleighbells_Hit_rr1_Mid\.wav$/ },
    ], { file: 'handperc' }),
  },
  snaps: {
    order: 44, family: 'drums', name: 'Body Percussion', model: '핑거 스냅·박수', kit: true,
    maker: 'sfzinstruments (body_percussion)', license: 'CC0', url: 'https://github.com/sfzinstruments/body_percussion', strings: false,
    tags: ['kpop', 'pop', 'jpop'], use: '팝 비트의 핑거 스냅과 맨손 박수',
    keys: { 37: 'Snap R', 38: 'Snap L', 39: 'Hand Clap', 40: 'Finger Clap' },
    sfz: 'body_percussion-main/_melofi/snaps.sfz',
    gen: (blobs) => kitMap(blobs, [
      { key: 37, dir: 'Samples/body/', re: /^snap_r_rr1\.wav$/ },
      { key: 38, dir: 'Samples/body/', re: /^snap_l_rr1\.wav$/ },
      { key: 39, dir: 'Samples/body/', re: /^handclap_vl(\d)_rr1\.wav$/ },
      { key: 40, dir: 'Samples/body/', re: /^fingerclap_vl(\d)_rr1\.wav$/ },
    ], { file: 'snaps' }),
  },
};
