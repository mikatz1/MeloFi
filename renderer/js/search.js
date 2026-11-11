// i18n-ignore-file: search words in both languages are data, not UI
// Instrument search that works in Korean and English alike: "브라스" and "brass", "바이올린" and
// "violin", "케이팝" and "k-pop" all find the same things. Also Korean initial consonants
// ("ㅂㄹㅅ" -> 브라스), and several words at once ("케이팝 베이스").

const FAMILY = {
  piano: '피아노 piano grand 그랜드',
  keys: '건반 키보드 keys keyboard ep 일렉트릭피아노 electric piano',
  organ: '오르간 organ',
  synth: '신디사이저 신스 synth synthesizer 신디',
  strings: '현악기 스트링 strings 현악',
  brass: '금관악기 브라스 brass horn 관악기',
  winds: '목관악기 관악기 리드 woodwind winds reed 우드윈드',
  vocal: '보컬 목소리 합창 코러스 vocal voice choir chorus',
  guitar: '기타 guitar',
  bass: '베이스 bass 저음',
  mallets: '말렛 벨 타악기 mallet mallets bell bells percussion',
  world: '민속악기 동양 국악 전통 world ethnic asian traditional oriental',
  drums: '드럼 퍼커션 타악기 비트 drum drums kit percussion beat',
  fx: '효과음 사운드이펙트 sfx fx effect effects sound',
};

const GENRE = {
  kpop: '케이팝 k팝 kpop k-pop korean 한국',
  pop: '팝 팝송 pop 서양 western billboard 빌보드',
  jpop: '제이팝 j팝 jpop j-pop 일본 japanese anime 애니 애니메이션',
};

// per instrument: Korean spellings of English names and English words for Korean ones
const INST = {
  splendid: '스플렌디드 그랜드 스타인웨이 steinway',
  salamander: '살라만더 야마하 yamaha',
  maestro: '마에스트로 야마하 yamaha concert 콘서트',
  headroom: '헤드룸 야마하 yamaha',
  rhodes: '로즈 로데스 rhodes 로즈피아노 electric piano 일렉피아노',
  scary: '스케어리 스케어리피아노 업라이트 upright',
  wurlitzer: '워리처 우리처 wurli 일렉피아노',
  harpsichord: '하프시코드 쳄발로 harpsichord cembalo',
  synth: '클라비신스 tx81z fm',
  harp: '하프 harp',
  organ: '파이프오르간 pipe church 교회',
  tenorsax: '테너색소폰 색소폰 tenor sax saxophone',
  recorder: '리코더 recorder',
  harmonica: '하모니카 harmonica',
  vibraphone: '비브라폰 vibraphone vibes',
  marimba: '마림바 marimba',
  glockenspiel: '글로켄슈필 글로켄 철금 glockenspiel glock',
  xylophone: '실로폰 목금 xylophone xylo',
  cello: '첼로 cello',
  acousticdrums: '어쿠스틱드럼 드럼세트 리얼드럼 acoustic drums kit live',
  acoustic: '어쿠스틱기타 통기타 acoustic guitar steel',
  electric: '일렉기타 전기기타 electric guitar',
  ebass: '일렉베이스 베이스기타 electric bass guitar',
  upright: '콘트라베이스 더블베이스 업라이트베이스 double bass contrabass upright pizzicato 피치카토',
  otamatone: '오타마톤 otamatone',
  contrabass: '콘트라베이스 더블베이스 contrabass double bass upright arco',
  clavinet: '클라비넷 클라비 clavinet clav funk',
  oohs: '보이스 우 합창 콰이어 코러스 voice oohs ooh choir chorus',
  chorus: '혼성합창 합창 콰이어 코러스 아 패드 mixed chorus choir aahs ensemble pad',
  calliope: '칼리오페 휘슬 calliope whistle steam',
  brightness: '브라이트니스 패드 brightness pad glass shimmer',
  siren: '사이렌 휘슬 siren whistle',
  oceandrum: '오션드럼 파도 바다 바람 ocean drum waves sea wind seashore',
  cymbalswell: '리버스심벌 심벌 스웰 reverse cymbal swell riser',
  fretnoise: '스크래치 프렛노이즈 scratch fret noise turntable',
  synlead: '리드 쏘 saw lead',
  synpad: '패드 pad warm',
  synbass: '신디베이스 신스베이스 synth bass',
  synbrass: '신스브라스 synth brass',
  synpluck: '플럭 pluck 퓨처베이스 future bass',
  drums808: '808 드럼머신 drum machine tr808',
  drums909: '909 드럼머신 drum machine tr909 house 하우스',
  strings: '스트링앙상블 현악합주 오케스트라 string ensemble orchestra violin viola cello 바이올린 비올라',
  stringsstac: '스타카토 스피카토 staccato spiccato 오케스트라 orchestra',
  stringspizz: '피치카토 pizzicato pizz 오케스트라 orchestra',
  violin: '바이올린 솔로바이올린 violin fiddle',
  trumpet: '트럼펫 trumpet',
  brassstab: '브라스스탭 브라스히트 brass stab hit section 트롬본 트럼펫 trombone trumpet',
  horn: '호른 프렌치호른 french horn',
  trombone: '트롬본 trombone',
  flute: '플루트 플룻 flute',
  clarinet: '클라리넷 clarinet',
  oboe: '오보에 oboe',
  altosax: '알토색소폰 색소폰 alto sax saxophone',
  vocal: '보컬 아 목소리 ah aah vowel voice 보이스',
  cleanguitar: '클린기타 일렉기타 clean electric guitar 커팅 cutting',
  banjo: '밴조 반조 banjo country 컨트리',
  fingerbass: '핑거베이스 일렉베이스 finger bass electric',
  kalimba: '칼림바 엄지피아노 kalimba thumb piano mbira',
  handbells: '핸드벨 핸드차임 종 bells chimes christmas 크리스마스 캐럴',
  steeldrum: '스틸드럼 스틸팬 steel drum steelpan tropical 트로피컬',
  dantranh: '단짠 단트란 가야금 고토 쟁 zither gayageum koto guzheng dan tranh',
  erhu: '얼후 해금 이호 erhu haegeum fiddle',
  handperc: '핸드퍼커션 박수 탬버린 셰이커 콩가 봉고 카우벨 클랩 hand percussion clap tambourine shaker conga bongo cowbell latin 라틴',
  snaps: '핑거스냅 스냅 박수 손뼉 finger snap clap body percussion',
  supersaw: '슈퍼쏘 슈퍼소 supersaw edm trance 트랜스 drop 드롭',
  sub808: '808베이스 팔공팔 서브베이스 808 bass sub trap 트랩 hiphop 힙합',
  reese: '리스베이스 reese bass dnb phonk 퐁크',
  fmep: 'fm피아노 디엑스 dx7 dx ep electric piano 시티팝 citypop',
  fmbell: 'fm벨 벨 bell dx',
  chip: '칩튠 8비트 게임 chiptune 8bit game square',
  drawbar: '드로바오르간 해먼드 drawbar hammond b3 gospel 가스펠',
  choir: '콰이어 합창 코러스 choir chorus aah',
  logdrum: '로그드럼 아마피아노 log drum amapiano afrobeats 아프로비츠',
  drumstrap: '트랩드럼 트랩 trap 808 hihat 하이햇 hiphop 힙합',
};

// words in the descriptions, in both languages: whichever appears, the other is searchable too
const PAIRS = [
  ['시티팝', 'city pop|citypop'], ['발라드', 'ballad'], ['힙합', 'hip hop|hiphop'], ['트랩', 'trap'], ['로파이', 'lofi|lo-fi'],
  ['애니메이션', 'anime|animation'], ['게임', 'game'], ['재즈', 'jazz'], ['펑크', 'funk'], ['디스코', 'disco'], ['컨트리', 'country'],
  ['밴드', 'band'], ['하우스', 'house'], ['댄스', 'dance'], ['오케스트라', 'orchestra|orchestral'], ['영화', 'film|movie|cinematic'],
  ['캐럴', 'carol|christmas'], ['겨울', 'winter'], ['여름', 'summer'], ['트로피컬', 'tropical'], ['드럼', 'drum|drums'], ['베이스', 'bass'],
  ['기타', 'guitar'], ['피아노', 'piano'], ['신스', 'synth'], ['소울', 'soul'], ['가스펠', 'gospel'], ['포크', 'folk'],
  ['리프', 'riff'], ['멜로디', 'melody'], ['코러스', 'chorus'], ['후렴', 'hook'], ['인트로', 'intro'], ['패드', 'pad'],
  ['아르페지오', 'arpeggio'], ['솔로', 'solo'], ['반주', 'accompaniment'], ['동요', 'children'], ['바로크', 'baroque'],
  ['네오소울', 'neo soul'], ['퍼포먼스', 'performance'], ['이디엠', 'edm'], ['알앤비', 'r&b|rnb'], ['사운드트랙', 'ost|soundtrack'],
];
const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PAIR_RE = PAIRS.map(([ko, en]) => [ko, en.split('|'), new RegExp(`(^|[^a-z0-9&])(${en.split('|').map(esc).join('|')})(?=$|[^a-z0-9&])`, 'i')]);
const withPairs = (raw) => raw + ' ' + PAIR_RE.filter(([ko, , re]) => raw.includes(ko) || re.test(raw)).map(([ko, en]) => `${ko} ${en.join(' ')}`).join(' ');

const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
// NFC, not NFKC: NFKC would turn typed initial consonants (ㅂ) into a different jamo block
export const norm = (s) => String(s || '').normalize('NFC').toLowerCase().replace(/[\s\-_.·'"’()/]+/g, '');
const chosung = (s) => [...s].map((ch) => { const c = ch.charCodeAt(0) - 0xac00; return c >= 0 && c < 11172 ? CHO[Math.floor(c / 588)] : ch; }).join('');
const isCho = (s) => /^[ㄱ-ㅎ]+$/.test(s);

// one searchable string per instrument (built once per list)
export function haystack(i, T) {
  const raw = [i.id, i.name, i.model, i.use, i.maker, T.families?.[i.family], FAMILY[i.family], INST[i.id],
    ...(i.tags || []).map((g) => GENRE[g])].filter(Boolean).join(' ');
  // keep words apart for the multi-word AND, but also a squashed form so "string ensemble" matches "stringensemble"
  const words = withPairs(raw).normalize('NFC').toLowerCase().split(/\s+/).map(norm).filter(Boolean);
  const flat = words.join('|');
  return { flat, cho: chosung(flat), squashed: norm(withPairs(raw)) };
}

// every space-separated part of the query must match somewhere
export function matches(query, hay) {
  const parts = String(query || '').trim().split(/\s+/).map(norm).filter(Boolean);
  return parts.every((p) => (isCho(p) ? hay.cho.includes(p) : hay.flat.includes(p) || hay.squashed.includes(p)));
}
