// More sampled instruments so songs of many genres can be matched: extra pianos, electric and FM
// keys, harpsichords, church and transistor organs, a large freepats synth set, bells and world
// colours. Everything here is CC0 / CC BY / CC Sampling Plus and downloads straight from its
// original GitHub repository (raw.githubusercontent.com); nothing is bundled.
//
// Merged into LIBS by tools/build-instruments.mjs; every entry passes tools/check-pitch.mjs.
import { vcslMap } from './vcsl-map.mjs';

const VCSL = { maker: 'Versilian Studios (VCSL)', license: 'CC0', url: 'https://github.com/sgossner/VCSL', strings: false };
const VC = 'VCSL-master/_melofi/';
const N = '([A-G]#?-?\\d)'; // VCSL note name

// freepats.github.io: one repository per instrument, CC0, branch main
const fp = (repo, sfz, maker = 'FreePats project') => ({
  maker, license: 'CC0', url: `https://github.com/freepats/${repo}`, strings: false, sfz: `${repo}-main/${sfz}`,
});
const SSO = {
  maker: 'Sonatina Symphonic Orchestra (Mattias Westlund), SFZ by peastman', license: 'CC Sampling Plus 1.0',
  url: 'https://github.com/peastman/sso', strings: false,
};
const SS = 'sso-master/Sonatina Symphonic Orchestra/';
const SSO_ORGAN = { ...SSO, maker: 'St. Stephen\'s organ recorded by Nicholas Appleton · Sonatina Symphonic Orchestra (peastman)' };
const CAVE = { maker: 'Karoryfer Samples (Caveman Cosmonaut)', license: 'CC0', url: 'https://github.com/sfzinstruments/karoryfer.caveman-cosmonaut', strings: false };
const CV = 'karoryfer.caveman-cosmonaut-master/_melofi/';
const cave = (stem, file, release = 0.3) => (blobs) => vcslMap(blobs, 'Samples/', new RegExp(`^${stem}_([a-g]b?\\d)\\.wav$`), { release, file });
const GS = { maker: 'Greg Sullivan · SFZ by kinwie', license: 'CC BY 3.0', url: 'https://github.com/sfzinstruments/GregSullivan.E-Pianos', strings: false };

export const MORE_LIBS = {
  // ---------------- acoustic pianos ----------------
  osiris: {
    order: 7, name: 'Osiris Upright', model: '업라이트 피아노', maker: 'sfzinstruments (Osiris Piano)',
    license: 'CC0', url: 'https://github.com/sfzinstruments/Osiris_Piano',
    tags: ['kpop', 'pop', 'jpop'], use: '가까이서 녹음한 자연스러운 업라이트, 어쿠스틱 팝·로파이',
    sfz: 'Osiris_Piano-main/Programs/01-natural.sfz',
    filter: (r) => r.group === '11', // mic A only (the three mic sets would stack on the same keys)
  },
  kawai: {
    ...VCSL, strings: true, order: 7.1, name: 'Kawai Grand', model: '가와이 그랜드',
    tags: ['kpop', 'pop', 'jpop'], use: '부드럽고 둥근 그랜드, 발라드 반주',
    sfz: `${VC}kawai.sfz`,
    // four dynamics on 36 notes are ~470 MB of WAV: the soft and loud layers keep it near 230 MB
    gen: (blobs) => vcslMap(blobs, 'Chordophones/Zithers/Grand Piano, Kawai/Sustains/', new RegExp(`^GPiano_sus_${N}_v(\\d)_rr1_Player\\.wav$`), { layers: ['2', '4'], c3: true, release: 0.5, file: 'kawai' }),
  },
  uprightyamaha: {
    ...VCSL, strings: true, order: 7.2, name: 'Yamaha Upright', model: '야마하 업라이트',
    tags: ['pop', 'jpop'], use: '집에서 치는 듯한 따뜻한 업라이트, 포크·인디',
    sfz: `${VC}uprightyamaha.sfz`,
    gen: (blobs) => vcslMap(blobs, 'Chordophones/Zithers/Upright Piano, Yamaha/Sustains/', new RegExp(`^Upright1_Sus_${N}_vl(\\d)_rr\\d\\.wav$`), { c3: true, release: 0.45, file: 'uprightyamaha' }),
  },
  uprightkw: {
    ...fp('upright-piano-KW', 'UprightPianoKW-20220221.sfz'), strings: true, order: 7.3, name: 'Upright Piano KW', model: '업라이트 피아노 (KW)',
    tags: ['pop', 'jpop'], use: '밝고 또렷한 업라이트, 동요·인디 팝',
  },
  honkytonk: {
    ...fp('old-piano-FB', 'PianoFB 20200401.sfz'), strings: true, order: 7.4, name: 'Old Piano FB', model: '혼키통크 피아노',
    tags: ['pop'], use: '조율이 살짝 어긋난 낡은 피아노, 래그타임·서부 영화 분위기',
  },

  // ---------------- electric & FM keys ----------------
  cp80: {
    ...GS, order: 9.1, family: 'keys', name: 'Yamaha CP80', model: '일렉트릭 그랜드',
    tags: ['kpop', 'pop', 'jpop'], use: '80년대 발라드, 시티팝의 반짝이는 일렉트릭 그랜드',
    sfz: 'GregSullivan.E-Pianos-master/CP80/CP80.sfz',
  },
  pianet: {
    ...GS, order: 9.2, family: 'keys', name: 'Hohner Pianet T', model: '피아넷',
    tags: ['pop', 'jpop'], use: '60년대 비트 팝, 인디 록의 통통 튀는 건반',
    sfz: 'GregSullivan.E-Pianos-master/Pianet T/Pianet T.sfz',
  },
  fmpiano: {
    ...VCSL, order: 9.3, family: 'keys', name: 'TX81Z FM Piano', model: 'FM 일렉 피아노',
    tags: ['kpop', 'jpop', 'pop'], use: '80년대 발라드·시티팝의 DX 계열 FM 피아노',
    sfz: `${VC}fmpiano.sfz`,
    gen: (blobs) => vcslMap(blobs, 'Electrophones/TX81Z/FM Piano/', new RegExp(`^FMPiano_${N}_vl(\\d)\\.wav$`), { release: 0.35, file: 'fmpiano' }),
  },
  tx81zpiano: {
    ...VCSL, order: 9.4, family: 'keys', name: 'TX81Z Piano 1', model: 'FM 피아노',
    tags: ['jpop', 'kpop'], use: '레트로 게임·신스팝의 디지털 피아노',
    sfz: `${VC}tx81zpiano.sfz`,
    gen: (blobs) => vcslMap(blobs, 'Electrophones/TX81Z/Piano 1/', new RegExp(`^Piano 1_${N}_vl(\\d)\\.wav$`), { c3: true, release: 0.35, file: 'tx81zpiano' }),
  },
  fmpiano1: {
    ...fp('fm-piano1', 'FM-Piano1 20190916.sfz'), order: 9.5, family: 'keys', name: 'FM Piano 1', model: 'FM 일렉 피아노 (벨)',
    tags: ['kpop', 'pop', 'jpop'], use: '80년대 발라드, R&B의 맑은 FM 일렉 피아노',
  },
  fmpiano2: {
    ...fp('fm-piano2', 'FM-Piano2 20161112.sfz'), order: 9.6, family: 'keys', name: 'FM Piano 2', model: 'FM 일렉 피아노 (부드러운)',
    tags: ['pop', 'jpop'], use: '시티팝, 퓨전 재즈의 부드러운 FM 건반',
  },
  celesta: {
    ...SSO, maker: 'stamperadam (freesound) · Sonatina Symphonic Orchestra (peastman)', license: 'CC0',
    order: 9.7, family: 'keys', name: 'Celesta', model: '첼레스타',
    tags: ['jpop', 'kpop'], use: '겨울 노래, 동화 같은 OST의 오르골 같은 건반',
    sfz: `${SS}Percussion/Celeste.sfz`,
  },
  squidotron: {
    order: 9.8, family: 'keys', name: 'Squidotron', model: '멜로트론풍 건반', maker: 'Karoryfer Samples (Squidpipes)',
    license: 'CC0', url: 'https://github.com/sfzinstruments/karoryfer.squidpipes', strings: false,
    tags: ['pop', 'jpop'], use: '사이키델릭, 인디 팝의 멜로트론 같은 관악 건반',
    sfz: 'karoryfer.squidpipes-master/Programs/02-squidotron.sfz',
    filter: (r) => /long_clean/.test(r.file), // the clean long notes; the dirty layer is a crossfade we can't do
    shift: 12, // the program plays the pipes an octave below their pitch
  },
  harpsienglish: {
    ...VCSL, order: 11.1, family: 'keys', name: 'English Harpsichord', model: '영국식 하프시코드',
    tags: ['jpop'], use: '바로크풍 팝, 게임 음악의 밝은 하프시코드',
    sfz: `${VC}harpsienglish.sfz`,
    gen: (blobs) => vcslMap(blobs, 'Chordophones/Zithers/Harpsichord, English/Sustains/Normal/', new RegExp(`^ZuckermannKitHarpsi_Normal_Sus_${N}_rr1\\.wav$`), { c3: true, release: 0.35, file: 'harpsienglish' }),
  },
  harpsilute: {
    ...VCSL, order: 11.2, family: 'keys', name: 'Harpsichord Lute Stop', model: '하프시코드 (류트 스톱)',
    tags: ['jpop'], use: '류트처럼 짧고 부드러운 하프시코드, 중세풍 판타지',
    sfz: `${VC}harpsilute.sfz`,
    gen: (blobs) => vcslMap(blobs, 'Chordophones/Zithers/Harpsichord, English/Sustains/Lute/', new RegExp(`^ZuckermannKitHarpsi_Lute_Sus_${N}_rr1\\.wav$`), { c3: true, release: 0.3, file: 'harpsilute' }),
  },
  harpsiflemish: {
    ...VCSL, order: 11.3, family: 'keys', name: 'Flemish Harpsichord', model: '플랑드르 하프시코드',
    tags: ['jpop'], use: '묵직한 8피트 하프시코드, 클래식·바로크 편곡',
    sfz: `${VC}harpsiflemish.sfz`,
    gen: (blobs) => vcslMap(blobs, 'Chordophones/Zithers/Harpsichord, Flemish/Sustains/Low/', new RegExp(`^HarpsiRH_Low_Far_${N}_rr1\\.wav$`), { c3: true, release: 0.35, file: 'harpsiflemish' }),
  },
  harpsiitalian: {
    ...VCSL, order: 11.4, family: 'keys', name: 'Italian Harpsichord', model: '이탈리아 하프시코드',
    tags: ['jpop'], use: '날카롭고 화사한 하프시코드, 게임 음악',
    sfz: `${VC}harpsiitalian.sfz`,
    gen: (blobs) => vcslMap(blobs, 'Chordophones/Zithers/Harpsichord, Italian/Sustains/stop1/', new RegExp(`^Harpsichord_stop1_${N}_1\\.wav$`), { c3: true, release: 0.35, file: 'harpsiitalian' }),
  },
  harpsibaroque: {
    ...VCSL, order: 11.5, family: 'keys', name: 'Baroque Harpsichord', model: '바로크 하프시코드',
    tags: ['jpop'], use: '건반마다 녹음한 풍성한 하프시코드, 클래식 편곡',
    sfz: `${VC}harpsibaroque.sfz`,
    gen: (blobs) => vcslMap(blobs, 'Chordophones/Zithers/Harpsichord, Unk/Sustains/', new RegExp(`^Harpsi4_Sus_Main_${N}_rr1\\.wav$`), { c3: true, release: 0.35, file: 'harpsibaroque' }),
  },

  // ---------------- organs ----------------
  organquiet: {
    ...VCSL, order: 50.1, family: 'organ', name: 'Pipe Organ (Soft)', model: '파이프 오르간 (여린 스톱)',
    tags: ['jpop', 'pop'], use: '조용한 예배당 분위기, 잔잔한 엔딩',
    sfz: `${VC}organquiet.sfz`,
    gen: (blobs) => vcslMap(blobs, 'Aerophones/Edge-blown Aerophones/Pipe Organ/Quiet/', new RegExp(`^NT5_Man3Quiet_${N}_rr1\\.wav$`), { c3: true, release: 0.5, file: 'organquiet' }),
  },
  churchdiapason: {
    ...SSO_ORGAN, order: 50.2, family: 'organ', name: 'Church Organ Diapason 8\'', model: '교회 오르간 (디아파손)',
    tags: ['jpop', 'pop'], use: '찬송가, 웅장한 교회 오르간의 기본 음색',
    sfz: `${SS}Organ/Great - Open Diapason 8ft.sfz`,
  },
  churchstopped: {
    ...SSO_ORGAN, order: 50.3, family: 'organ', name: 'Church Organ Stopped Diapason', model: '교회 오르간 (부드러운 플루트)',
    tags: ['jpop'], use: '부드럽고 둥근 오르간, 성가대 반주',
    sfz: `${SS}Organ/Great - Stopped Diapason 8ft.sfz`,
  },
  churchoboe: {
    ...SSO_ORGAN, order: 50.4, family: 'organ', name: 'Church Organ Oboe 8\'', model: '교회 오르간 (리드)',
    tags: ['jpop'], use: '오보에처럼 콧소리 나는 리드 스톱 멜로디',
    sfz: `${SS}Organ/Swell - Oboe 8ft.sfz`,
  },
  churchgamba: {
    ...SSO_ORGAN, order: 50.5, family: 'organ', name: 'Church Organ Gamba 8\'', model: '교회 오르간 (현 음색)',
    tags: ['jpop'], use: '현악기처럼 가는 오르간 패드',
    sfz: `${SS}Organ/Swell - Gamba 8ft.sfz`,
  },
  churchflute4: {
    ...SSO_ORGAN, order: 50.6, family: 'organ', name: 'Church Organ Flute 4\'', model: '교회 오르간 (플루트 4\')',
    tags: ['jpop'], use: '한 옥타브 위로 맑게 울리는 오르간 플루트',
    sfz: `${SS}Organ/Great - Flute 4ft.sfz`,
    shift: 12, // a 4' stop sounds an octave up: mapped at its real pitch
  },
  renorgan: {
    ...VCSL, order: 50.7, family: 'organ', name: 'Renaissance Organ 8\'', model: '르네상스 오르간',
    tags: ['jpop'], use: '작은 포지티브 오르간, 중세·판타지 게임 음악',
    sfz: `${VC}renorgan.sfz`,
    gen: (blobs) => vcslMap(blobs, "Aerophones/Edge-blown Aerophones/Renaissance Organ/8'/", new RegExp(`^RenOrgan_8foot_Room_${N}_rr1\\.wav$`), { c3: true, release: 0.4, file: 'renorgan' }),
  },
  renorganfull: {
    ...VCSL, order: 50.8, family: 'organ', name: 'Renaissance Organ Full', model: '르네상스 오르간 (풀 스톱)',
    tags: ['jpop'], use: '모든 스톱을 연 밝은 소형 오르간',
    sfz: `${VC}renorganfull.sfz`,
    gen: (blobs) => vcslMap(blobs, 'Aerophones/Edge-blown Aerophones/Renaissance Organ/Full/', new RegExp(`^RenOrgan_Full_Room_${N}_rr1\\.wav$`), { c3: true, release: 0.4, file: 'renorganfull' }),
  },
  accordion: {
    ...fp('button-accordion-HN', 'PRESET Button Accordion HN tuned.sfz'), order: 52, family: 'organ', name: 'Button Accordion', model: '아코디언',
    tags: ['pop', 'jpop'], use: '샹송, 탱고, 유럽 거리 음악 분위기',
  },

  // ---------------- synthesizers ----------------
  unitraviolin: {
    ...CAVE, order: 23, family: 'synth', name: 'Unitra Strings', model: '빈티지 신스 스트링',
    tags: ['pop', 'jpop'], use: '70년대 스트링 머신 같은 얇은 현 음색',
    sfz: `${CV}unitraviolin.sfz`, gen: cave('violin', 'unitraviolin', 0.5),
  },
  unitrabrass: {
    ...CAVE, order: 23.2, family: 'synth', name: 'Unitra Trumpet', model: '빈티지 신스 브라스',
    tags: ['pop', 'jpop'], use: '버즈가 강한 레트로 신스 리드',
    sfz: `${CV}unitrabrass.sfz`, gen: cave('trompette', 'unitrabrass'),
  },
  unitrareed: {
    ...CAVE, order: 23.3, family: 'synth', name: 'Unitra Clarinet', model: '빈티지 신스 리드 (클라리넷)',
    tags: ['pop'], use: '속이 빈 사각파 같은 칩튠풍 리드',
    sfz: `${CV}unitrareed.sfz`, gen: cave('clarinet', 'unitrareed'),
  },
  coworgan: {
    order: 23.4, family: 'synth', name: 'Cowsynth', model: '백파이프 신스', maker: 'Karoryfer Samples (Cowsynth)',
    license: 'CC0', url: 'https://github.com/sfzinstruments/karoryfer.cowsynth', strings: false,
    tags: ['pop'], use: '백파이프를 오실레이터로 쓴 거친 신스 리드 (Lonely Organ)',
    sfz: 'karoryfer.cowsynth-master/cowsynth_lonely_organ.sfz',
    shift: 12, // the program maps the pipes an octave below their pitch
  },
  synstrings1: {
    ...fp('synth-strings-1', 'SynthStrings1 20200528.sfz'), order: 24, family: 'synth', name: 'Synth Strings 1', model: '신스 스트링',
    tags: ['kpop', 'pop', 'jpop'], use: '80년대 신스팝, 뉴웨이브의 스트링 패드',
  },
  synstrings2: {
    ...fp('synth-strings-2', 'SynthStrings2 20200528.sfz'), order: 24.1, family: 'synth', name: 'Synth Strings 2', model: '신스 스트링 (밝은)',
    tags: ['kpop', 'pop', 'jpop'], use: '디스코·시티팝의 밝은 스트링 머신',
  },
  synbrass1: {
    ...fp('synth-brass-1', 'SynthBrass1 20210426.sfz'), order: 24.2, family: 'synth', name: 'Synth Brass 1', model: '신스 브라스 (굵은)',
    tags: ['kpop', 'pop', 'jpop'], use: '80년대 팝의 굵은 신스 브라스 리프',
  },
  synbrass2: {
    ...fp('synth-brass-2', 'SynthBrass2 20240610.sfz'), order: 24.3, family: 'synth', name: 'Synth Brass 2', model: '신스 브라스 (밝은)',
    tags: ['kpop', 'pop'], use: '신스웨이브, 레트로 댄스곡의 브라스 히트',
  },
  crystal: {
    ...fp('synth-crystal', 'SynthCrystal 20190812.sfz'), order: 24.4, family: 'synth', name: 'Crystal', model: '크리스털 (FX 9)',
    tags: ['jpop', 'kpop'], use: '반짝이는 종소리 같은 신스, 몽환적인 인트로',
  },
  fifths: {
    ...fp('synth-fifths', 'SynthFifths 20200519.sfz'), order: 24.5, family: 'synth', name: 'Fifths Lead', model: '5도 리드',
    tags: ['kpop', 'pop'], use: '5도를 겹친 두꺼운 리드, EDM·록 리프',
  },
  squarelead: {
    ...fp('synth-square', 'SynthSquare 20200512.sfz'), order: 24.6, family: 'synth', name: 'Square Lead', model: '스퀘어 리드',
    tags: ['kpop', 'jpop', 'pop'], use: '칩튠, 게임 음악, 신스팝의 사각파 리드',
  },
  soundtrack: {
    ...fp('synth-soundtrack', 'SynthSoundtrack 20200521.sfz'), order: 24.7, family: 'synth', name: 'Soundtrack', model: '사운드트랙 패드 (FX 2)',
    tags: ['jpop', 'pop'], use: '영화·게임 OST의 넓게 퍼지는 패드',
  },
  scifi: {
    ...fp('synth-scifi', 'SynthSciFi 20200517.sfz'), order: 24.8, family: 'synth', name: 'Sci-Fi', model: 'SF 효과 신스 (FX 8)',
    tags: ['jpop'], use: '우주·SF 분위기의 일렁이는 신스',
  },
  goblins: {
    ...fp('synth-goblins', 'SynthGoblins 20200612.sfz'), order: 24.9, family: 'synth', name: 'Goblins', model: '고블린 패드 (FX 7)',
    tags: ['jpop'], use: '어둡고 기묘한 판타지 패드',
  },
  basslead: {
    ...fp('synth-bass-lead', 'SynthBassLead 20200522.sfz'), order: 25, family: 'synth', name: 'Bass & Lead', model: '베이스+리드',
    tags: ['kpop', 'pop'], use: '낮게는 베이스, 높게는 리드로 쓰는 굵은 톱니파',
  },
  padbowed: {
    ...fp('synth-pad-bowed', 'SynthPadBowed 20190719.sfz'), order: 25.1, family: 'synth', name: 'Bowed Pad', model: '보우드 패드',
    tags: ['jpop', 'kpop'], use: '활로 켠 듯 천천히 차오르는 유리 패드',
    filter: (r) => /L\.flac$/.test(r.file), // left/right halves panned apart; one channel keeps one voice per key
  },
  padchoir: {
    ...fp('synth-pad-choir', 'SynthPadChoir 20200516.sfz'), order: 25.2, family: 'synth', name: 'Choir Pad', model: '콰이어 패드',
    tags: ['kpop', 'jpop', 'pop'], use: '보컬처럼 숨 쉬는 신스 패드, 발라드 후렴 뒤',
  },
  newage: {
    ...fp('new-age', 'NewAge 20190730.sfz'), order: 25.3, family: 'synth', name: 'New Age', model: '뉴에이지 패드',
    tags: ['jpop', 'kpop'], use: '벨과 패드가 섞인 몽환적인 뉴에이지 음색',
  },
  sweeppad: {
    ...fp('sweep-pad', 'SweepPad 20190813.sfz'), order: 25.4, family: 'synth', name: 'Sweep Pad', model: '스윕 패드',
    tags: ['kpop', 'pop'], use: '필터가 천천히 열리는 신스웨이브 패드',
  },
  calliope2: {
    ...fp('synth-calliope', 'SynthCalliope 20200512.sfz'), order: 25.5, family: 'synth', name: 'Calliope Lead', model: '칼리오페 리드',
    tags: ['jpop', 'pop'], use: '숨소리 섞인 피리 같은 신스 리드',
  },

  // ---------------- synth bass ----------------
  synbass1: {
    ...fp('synth-bass-1', 'SynthBass1 20190723.sfz'), order: 33.1, family: 'bass', name: 'Synth Bass 1', model: '신스 베이스 (펑키)',
    tags: ['kpop', 'pop', 'jpop'], use: '80년대 신스팝·펑크의 탄력 있는 베이스',
  },
  synbass2: {
    ...fp('synth-bass-2', 'SynthBass2 20210405.sfz'), order: 33.2, family: 'bass', name: 'Synth Bass 2', model: '신스 베이스 (묵직한)',
    tags: ['kpop', 'pop'], use: '하우스, 댄스곡의 묵직한 신스 베이스',
  },

  // ---------------- bells, glass, mallets ----------------
  tubularbells: {
    ...fp('tubular-bells1', 'TubularBells 20241130.sfz'), order: 77.1, family: 'mallets', name: 'Tubular Bells', model: '튜블러 벨',
    tags: ['jpop', 'kpop'], use: '웅장한 엔딩, 크리스마스·교회 종소리',
  },
  tubularbells2: {
    ...VCSL, order: 77.2, family: 'mallets', name: 'Tubular Bells (VCSL)', model: '튜블러 벨 (부드러운)',
    tags: ['jpop'], use: '오케스트라 편곡의 차임 종소리',
    sfz: `${VC}tubularbells2.sfz`,
    gen: (blobs) => vcslMap(blobs, 'Idiophones/Struck Idiophones/Tubular Bells 2/', new RegExp(`^TB_hit_${N}_v(\\d)_1\\.wav$`), { layers: ['2', '4'], release: 1.5, file: 'tubularbells2' }),
  },
  chimes: {
    ...SSO, order: 77.3, family: 'mallets', name: 'Orchestral Chimes', model: '오케스트라 차임',
    tags: ['jpop', 'kpop'], use: '영화음악의 클라이맥스, 결혼식 종소리',
    sfz: `${SS}Percussion/Chimes.sfz`,
    shift: 12, // strike tone measured an octave above SSO's mapping
  },
  glassharp: {
    ...fp('glass', 'Glass-20191227.sfz'), order: 77.4, family: 'mallets', name: 'Glass', model: '유리잔 (두드림)',
    tags: ['jpop', 'kpop'], use: '유리잔을 두드린 맑은 소리, 로파이·앰비언트',
  },
  wineglass: {
    ...VCSL, order: 77.5, family: 'mallets', name: 'Wine Glasses', model: '글라스 하프 (문지름)',
    tags: ['jpop'], use: '와인잔 테두리를 문지른 신비로운 지속음',
    sfz: `${VC}wineglass.sfz`,
    gen: (blobs) => vcslMap(blobs, 'Idiophones/Friction Idiophones/Wine Glasses/Sustains/Slow/', new RegExp(`^glass\\d_${N}_Slow_\\d_Main\\.wav$`), { c3: true, release: 1, file: 'wineglass' }),
    retune: true,
  },
  timpani: {
    ...fp('timpani', 'Timpani 20240809.sfz'), order: 78, family: 'mallets', name: 'Timpani', model: '팀파니',
    tags: ['jpop', 'kpop'], use: '오케스트라 OST의 웅장한 북 소리와 롤',
  },

  // ---------------- world ----------------
  balafon: {
    ...VCSL, order: 102, family: 'world', name: 'Balafon', model: '발라폰 (아프리카 실로폰)',
    tags: ['pop'], use: '아프로비트, 월드 뮤직의 나무 실로폰',
    sfz: `${VC}balafon.sfz`,
    gen: (blobs) => vcslMap(blobs, 'Idiophones/Struck Idiophones/Balafon/Traditional Mallet/', new RegExp(`^EthnicXylo_tradM_${N}_vl(\\d)_rr1_Mid\\.wav$`), { c3: true, release: 0.4, file: 'balafon' }),
    retune: true,
  },
  mbira: {
    ...VCSL, order: 102.1, family: 'world', name: 'Mbira', model: '음비라 (짐바브웨)',
    tags: ['pop', 'jpop'], use: '칼림바보다 낮고 따뜻한 엄지 피아노, 아프로 팝',
    sfz: `${VC}mbira.sfz`,
    gen: (blobs) => vcslMap(blobs, 'Idiophones/Plucked Idiophones/Mbira dzaVadzimu Nyamaropa, Zimbabwe, Low B/', new RegExp(`^MBira4_pluck_Main_${N}_\\d+_50_100_rr\\d\\.wav$`), { c3: true, release: 0.6, file: 'mbira' }),
    retune: true,
  },
  hang: {
    ...fp('hang-D-minor', 'Hang-D-minor 20220330.sfz'), order: 102.2, family: 'world', name: 'Hang Drum', model: '행드럼 (D 단조)',
    tags: ['jpop', 'pop'], use: '명상·앰비언트의 둥근 금속 울림',
  },
  psaltery: {
    ...VCSL, order: 102.3, family: 'world', name: 'Plucked Psaltery', model: '프살터리 (뜯기)',
    tags: ['jpop'], use: '중세풍 판타지, 동화 같은 현 뜯는 소리',
    sfz: `${VC}psaltery.sfz`,
    gen: (blobs) => vcslMap(blobs, 'Chordophones/Zithers/Psaltery, Bowed and Plucked/Pluck/', new RegExp(`^BowedPsaltery_${N}_Main_Pluck_rr\\d\\.wav$`), { c3: true, release: 0.8, file: 'psaltery' }),
    retune: true,
  },
  bowedpsaltery: {
    ...VCSL, order: 102.4, family: 'world', name: 'Bowed Psaltery', model: '프살터리 (활)',
    tags: ['jpop'], use: '활로 켜는 맑고 가는 지속음, 판타지 OST',
    sfz: `${VC}bowedpsaltery.sfz`,
    gen: (blobs) => vcslMap(blobs, 'Chordophones/Zithers/Psaltery, Bowed and Plucked/LongBow/', new RegExp(`^BowedPsaltery_${N}_Main_LongBow_rr\\d\\.wav$`), { c3: true, release: 0.5, file: 'bowedpsaltery' }),
    retune: true,
  },

  // ---------------- winds & guitars ----------------
  ocarina: {
    ...fp('ocarina1', 'Ocarina 20241002.sfz'), order: 67, family: 'winds', name: 'Ocarina', model: '오카리나',
    tags: ['jpop'], use: '게임 음악, 소박한 동화풍 멜로디',
  },
  nylonguitar: {
    ...fp('spanish-classical-guitar', 'SpanishClassicalGuitar-20190618.sfz'), order: 23.5, family: 'guitar', name: 'Spanish Classical Guitar', model: '클래식 기타 (나일론)',
    tags: ['kpop', 'pop', 'jpop'], use: '보사노바, 어쿠스틱 발라드의 나일론 기타',
  },
  ukulele: {
    ...fp('ukulele1', 'Ukulele 20260811.sfz'), order: 24.5, family: 'guitar', name: 'Ukulele', model: '우쿨렐레',
    tags: ['kpop', 'pop', 'jpop'], use: '밝고 산뜻한 어쿠스틱 팝, 하와이안',
  },
};

// ================= second batch: guitars, basses, horns, more strings and percussion =================
const VSCO = { maker: 'Versilian Studios (VSCO 2 CE)', license: 'CC0', url: 'https://github.com/sgossner/VSCO-2-CE', strings: false };
const VS = 'VSCO-2-CE-master/_melofi/';
const FSBS = 'electric guitar recorded by FSBS · FreePats project';
const PASTA = { maker: 'Karoryfer Samples (Pastabass, Squier Bass VI)', license: 'CC0', url: 'https://github.com/sfzinstruments/karoryfer.pastabass', strings: false };
const CYB = { maker: 'Karoryfer Samples (String Cyborgs)', license: 'CC0', url: 'https://github.com/sfzinstruments/karoryfer.string-cyborgs', strings: false };

Object.assign(MORE_LIBS, {
  // ---------------- electric guitars & basses ----------------
  egclean: {
    ...fp('electric-guitar-FSBS-clean', 'EGuitarFSBS-clean bridge 20260807.sfz', FSBS), order: 21.1, family: 'guitar', name: 'FSBS Clean Guitar', model: '일렉 기타 (클린 앰프)',
    tags: ['kpop', 'pop', 'jpop'], use: '펑크 커팅, 시티팝 아르페지오의 맑은 일렉 기타',
  },
  egjazz: {
    ...fp('electric-guitar-FSBS-jazz', 'EGuitarFSBS-jazz bridge 20260807.sfz', FSBS), order: 21.2, family: 'guitar', name: 'FSBS Jazz Guitar', model: '재즈 기타',
    tags: ['pop', 'jpop'], use: '재즈, 보사노바, 네오소울의 둥근 일렉 기타',
  },
  egdirect: {
    ...fp('electric-guitar-FSBS-direct', 'EGuitarFSBS-direct bridge 20220911.sfz', FSBS), order: 21.3, family: 'guitar', name: 'FSBS DI Guitar', model: '일렉 기타 (다이렉트)',
    tags: ['pop'], use: '앰프를 거치지 않은 담백한 일렉 기타, 리듬 기타',
  },
  egdist1: {
    ...fp('electric-guitar-FSBS-dist1', 'EGuitarFSBS-dist1 bridge 20220911.sfz', FSBS), order: 21.4, family: 'guitar', name: 'FSBS Overdrive Guitar', model: '일렉 기타 (오버드라이브)',
    tags: ['kpop', 'pop', 'jpop'], use: '록 발라드, 밴드 사운드의 크런치 기타',
  },
  egdist2: {
    ...fp('electric-guitar-FSBS-dist2', 'EGuitarFSBS-dist2 bridge 20220911.sfz', FSBS), order: 21.5, family: 'guitar', name: 'FSBS Distortion Guitar', model: '일렉 기타 (디스토션)',
    tags: ['kpop', 'jpop', 'pop'], use: '록, 메탈, 애니송의 강한 디스토션 기타',
  },
  bassvi: {
    ...PASTA, order: 32.6, family: 'bass', name: 'Bass VI (Roundwound)', model: '베이스 VI',
    tags: ['pop', 'jpop'], use: '서프 록, 서부 영화풍의 쨍한 6현 베이스',
    sfz: 'karoryfer.pastabass-master/spaghetti.sfz',
    shift: -12, // measured an octave below the program's mapping
  },
  bassviflat: {
    ...PASTA, order: 32.7, family: 'bass', name: 'Bass VI (Flatwound)', model: '베이스 VI (플랫와운드)',
    tags: ['pop', 'jpop'], use: '60년대 팝, 레트로 소울의 둥근 핑거 베이스',
    sfz: 'karoryfer.pastabass-master/fetuccine.sfz',
    shift: -12,
  },
  fingerbassyr: {
    ...fp('electric-bass-YR', 'FingerBassYR 20190930.sfz'), order: 32.8, family: 'bass', name: 'Finger Bass YR', model: '일렉 베이스 (핑거)',
    tags: ['kpop', 'pop', 'jpop'], use: '발라드, 팝 밴드의 부드러운 핑거 베이스',
  },
  pickbassyr: {
    ...fp('electric-bass-YR', 'PickedBassYR 20190930.sfz'), order: 32.9, family: 'bass', name: 'Picked Bass YR', model: '일렉 베이스 (피크)',
    tags: ['kpop', 'jpop', 'pop'], use: '록, 애니송의 또렷한 피크 베이스',
  },
  latelybass: {
    ...fp('lately-bass', 'LatelyBass 20240409.sfz'), order: 33.3, family: 'bass', name: 'Lately Bass', model: '신스 베이스 (레이틀리)',
    tags: ['kpop', 'pop', 'jpop'], use: '80년대 R&B, 시티팝의 통통 튀는 FM 베이스',
  },

  // ---------------- winds & brass ----------------
  weresax: {
    order: 66.1, family: 'winds', name: 'Weresax Alto', model: '알토 색소폰 (부드러운)', maker: 'Karoryfer Samples (Weresax)',
    license: 'CC0', url: 'https://github.com/sfzinstruments/karoryfer.weresax', strings: false,
    tags: ['kpop', 'pop', 'jpop'], use: '재즈 발라드, R&B의 부드러운 알토 색소폰',
    sfz: 'karoryfer.weresax-master/Programs/Sax.sfz',
    filter: (r) => /_cnd\.wav$/.test(r.file), // condenser mic (the dynamic mic set doubles every note)
  },
  baritonesax: {
    order: 66.2, family: 'winds', name: 'Bear Sax', model: '바리톤 색소폰', maker: 'Karoryfer Samples (Bear Sax)',
    license: 'CC0', url: 'https://github.com/sfzinstruments/karoryfer.bear-sax', strings: false,
    tags: ['pop', 'jpop'], use: '스카, 펑크, 빅밴드의 굵고 낮은 색소폰',
    sfz: 'karoryfer.bear-sax-master/_melofi/baritonesax.sfz',
    gen: (blobs) => vcslMap(blobs, 'Samples/', /^([a-g]b?\d)_looped_(p|f)\.wav$/, { layers: ['p', 'f'], shift: 12, release: 0.25, file: 'baritonesax' }),
  },
  wartuba: {
    order: 84, family: 'brass', name: 'War Tuba', model: '튜바', maker: 'Karoryfer Samples (War Tuba)',
    license: 'CC0', url: 'https://github.com/sfzinstruments/karoryfer.war-tuba', strings: false,
    tags: ['pop', 'jpop'], use: '브라스 밴드, 행진곡, 익살스러운 저음',
    sfz: 'karoryfer.war-tuba-master/Programs/2-solo-poly.sfz',
  },
  tuba: {
    ...VSCO, order: 84.1, family: 'brass', name: 'Tuba', model: '튜바 (오케스트라)',
    tags: ['jpop'], use: '오케스트라 OST의 묵직한 금관 저음',
    sfz: `${VS}tuba.sfz`,
    gen: (blobs) => vcslMap(blobs, 'Brass/Tuba/sus/', /^Tuba3_sus_([A-G]#?\d)_v(\d)_rr1_Mid\.wav$/, { c3: true, release: 0.3, file: 'tuba' }),
  },
  bassoon: {
    ...VSCO, order: 65.1, family: 'winds', name: 'Bassoon', model: '바순',
    tags: ['jpop'], use: '익살스럽거나 따뜻한 목관 저음, 동화풍 OST',
    sfz: `${VS}bassoon.sfz`,
    gen: (blobs) => vcslMap(blobs, 'Woodwinds/Bassoon/vib/', /^PSBassoon_([A-G]#?\d)_v(\d)_1\.wav$/, { c3: true, release: 0.25, file: 'bassoon' }),
  },
  ixoxflute: {
    order: 63.1, family: 'winds', name: 'Ixox Flute', model: '플루트 (솔로)', maker: 'Ixox',
    license: 'CC BY 4.0', url: 'https://github.com/sfzinstruments/Ixox.Flute', strings: false,
    tags: ['kpop', 'jpop', 'pop'], use: '숨결이 살아 있는 솔로 플루트 멜로디',
    sfz: 'Ixox.Flute-master/Ixox Flute.sfz',
  },

  // ---------------- strings ----------------
  viola: {
    ...VSCO, order: 37, family: 'strings', name: 'Viola Section', model: '비올라 앙상블',
    tags: ['kpop', 'jpop'], use: '현악 편곡의 중음역, 따뜻한 대선율',
    sfz: `${VS}viola.sfz`,
    gen: (blobs) => vcslMap(blobs, 'Strings/Viola Section/susvib/', /^ViolaEns_susvib_([A-G]#?\d)_v(\d)_1\.wav$/, { c3: true, release: 0.5, file: 'viola' }),
  },

  // ---------------- synths from processed string recordings ----------------
  blackheart: {
    ...CYB, order: 26, family: 'synth', name: 'Blackheart', model: '어두운 신스 (스트링 사이보그)',
    tags: ['kpop', 'pop'], use: '어둡고 거친 신스 리드, 신스웨이브·다크 팝',
    sfz: 'karoryfer.string-cyborgs-master/Programs/blackheart_one.sfz',
  },
  ironface: {
    ...CYB, order: 26.1, family: 'synth', name: 'Ironface', model: '금속성 신스 (스트링 사이보그)',
    tags: ['kpop', 'pop'], use: '금속성 버즈가 있는 신스 베이스·리드',
    sfz: 'karoryfer.string-cyborgs-master/Programs/ironface_clean.sfz',
    shift: -12, // measured an octave below the program's mapping
  },
  zinc: {
    ...CYB, order: 26.2, family: 'synth', name: 'Zinc', model: '맑은 신스 (스트링 사이보그)',
    tags: ['kpop', 'pop', 'jpop'], use: '현을 신스로 만든 밝은 패드·리드',
    sfz: 'karoryfer.string-cyborgs-master/Programs/zinc_one_voice.sfz',
    shift: -12,
  },

  // ---------------- world ----------------
  zither: {
    order: 103, family: 'world', name: 'Hungarian Zither', model: '헝가리 치터 (citera)', maker: 'sfzinstruments (hungarian_zither)',
    license: 'CC0', url: 'https://github.com/sfzinstruments/hungarian_zither', strings: false,
    tags: ['jpop'], use: '동유럽 민속, 판타지 게임의 반짝이는 현',
    sfz: 'hungarian_zither-main/Programs/hungarian_zither_mel_strings_poly.sfz',
    shift: 24, retune: true, // the program transposes with a controller our reader ignores
  },
  cithara: {
    order: 103.1, family: 'world', name: 'Cithara Barbarica', model: '고대 리라 (키타라)', maker: 'sfzinstruments (Cithara Barbarica)',
    license: 'CC0', url: 'https://github.com/sfzinstruments/Cithara-Barbarica', strings: false,
    tags: ['jpop'], use: '고대·중세풍 판타지 OST의 리라 소리',
    sfz: 'Cithara-Barbarica-main/Programs/02-cithara_barbarica_finger.sfz',
    shift: 12, retune: true, // mapped an octave below the sample names
  },

  // ---------------- percussion kits ----------------
  worldperc: {
    ...fp('world-percussion', 'WorldPercussion 20200905.sfz'), order: 45, family: 'drums', kit: true, name: 'World Percussion', model: '월드 퍼커션',
    tags: ['kpop', 'pop', 'jpop'], use: '카혼, 봉고, 콩가, 다르부카, 셰이커 같은 손 타악기',
    keys: { 48: 'Cajon Bass', 49: 'Cajon Slap', 50: 'Cajon Tone', 51: 'Bongo Low', 52: 'Bongo High', 53: 'Bongo Mute', 54: 'Egg Shaker Slow', 55: 'Egg Shaker Fast', 56: 'Egg Shaker Soft', 57: 'Tambourine', 58: 'Tambourine Fast', 59: 'Hand Clap', 60: 'Claves', 61: 'Castanets', 62: 'Conga', 63: 'Low Conga', 64: 'High Conga', 65: 'Muted Conga', 66: 'Muted Low Conga', 67: 'Maracas 1', 68: 'Maracas 2', 69: 'Darbuka Doum', 70: 'Darbuka Tek', 71: 'Darbuka Pa' },
  },
  synthperc: {
    ...fp('synthesizer-percussion', 'SynthesizerPercussion-20220718.sfz'), order: 45.1, family: 'drums', kit: true, name: 'Synthesizer Percussion', model: '신스 드럼',
    tags: ['kpop', 'pop', 'jpop'], use: '80년대 신스팝의 전자 드럼과 신스 톰',
    keys: { 48: 'Kick 1', 49: 'Kick 2', 50: 'Snare 1', 51: 'Snare 2', 52: 'Closed Hat 1', 53: 'Closed Hat 2', 54: 'Open Hat', 55: 'Cymbal 1', 56: 'Cymbal 2', 57: 'Low Tom 1', 58: 'Low Tom 2', 59: 'Mid Tom 1', 60: 'Mid Tom 2', 61: 'High Tom 1', 62: 'High Tom 2', 63: 'Clap', 64: 'Shaker', 65: 'Long Shaker', 66: 'Claves' },
  },
});
