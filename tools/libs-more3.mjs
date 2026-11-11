// Third batch from GitHub git trees, for the parts of the test songs whose best match stayed under
// 90% (docs/missing-instruments.md): more piano recordings (bright close-miked Steinway, a home
// upright, the Sonatina grand), bells, solo violins with vibrato, a plucked strumstick, and electronic / acoustic kits with hard kicks and claps.
// Every library downloads straight from its original GitHub repository (raw.githubusercontent.com);
// nothing is bundled. Licences read on each repository's LICENSE / README on 2026-11-12.
//
// Merged into LIBS by tools/build-instruments.mjs; pitched entries checked with tools/check-pitch.mjs.
import path from 'node:path';
import { vcslMap } from './vcsl-map.mjs';
import { lightKit } from './libs-archive.mjs';

const VCSL = { maker: 'Versilian Studios (VCSL)', license: 'CC0', url: 'https://github.com/sgossner/VCSL', strings: false };
const VC = 'VCSL-master/_melofi/';
const N = '([A-G]#?-?\\d)'; // VCSL note name
const SSO = {
  maker: 'Sonatina Symphonic Orchestra (Mattias Westlund), SFZ by peastman', license: 'CC Sampling Plus 1.0',
  url: 'https://github.com/peastman/sso', strings: false,
};
const SS = 'sso-master/Sonatina Symphonic Orchestra/';
// SSO's performance programs stack the same sample in groups a sampler crossfades on CC1; play it once
const once = () => { const seen = new Set(); return (r) => { const k = `${r.file}|${r.lo}|${r.hi}|${r.lv}`; if (seen.has(k)) return false; seen.add(k); return true; }; };

// Stargate sample pack (stargatedaw/stargate-sample-pack, CC0 1.0 — LICENSE in the repository; every
// sample was contributed under CC0, the freesound ones are CC0 uploads). One-shots only; the kits
// are mapped here on General MIDI drum keys.
const SG = {
  maker: 'Stargate DAW sample pack (fugue-state-audio, freesound CC0 contributors)', license: 'CC0',
  url: 'https://github.com/stargatedaw/stargate-sample-pack', strings: false, family: 'drums', kit: true,
};
const SGP = 'stargate-sample-pack/';
const kitSfz = (name, map) => () => [{
  name: `_melofi/${name}.sfz`,
  text: `// ${name}: one-shots of the Stargate sample pack on General MIDI drum keys (tools/libs-more3.mjs)\n<control>\ndefault_path=../\n<global>\nampeg_release=0.3\n`
    + Object.entries(map).map(([key, file]) => `<region> lokey=${key} hikey=${key} pitch_keycenter=${key} lovel=1 hivel=127 sample=${SGP}${file}\n`).join(''),
}];
const fsa = (kit) => ({
  35: `fugue-state-audio/drums/kicks/${kit}-kick.wav`, 36: `fugue-state-audio/drums/kicks/${kit}-kick.wav`,
  38: `fugue-state-audio/drums/snares/${kit}-snare.wav`, 40: `fugue-state-audio/drums/snares/${kit}-snare.wav`,
  39: `fugue-state-audio/drums/claps/${kit}-clap.wav`,
  42: `fugue-state-audio/drums/hihats/${kit}-hatclsd.wav`, 44: `fugue-state-audio/drums/hihats/${kit}-hatclsd.wav`,
  46: `fugue-state-audio/drums/hihats/${kit}-hatopen.wav`,
  41: `fugue-state-audio/drums/toms/${kit}-lotom.wav`, 43: `fugue-state-audio/drums/toms/${kit}-lotom.wav`,
  45: `fugue-state-audio/drums/toms/${kit}-midtom.wav`, 47: `fugue-state-audio/drums/toms/${kit}-midtom.wav`,
  48: `fugue-state-audio/drums/toms/${kit}-hitom.wav`, 50: `fugue-state-audio/drums/toms/${kit}-hitom.wav`,
});

export const MORE3_LIBS = {
  // ---------------- pianos (bright pop grand, upright, different recordings) ----------------
  steinwayb: {
    ...VCSL, strings: true, order: 7.3, family: 'piano', name: 'Steinway B (close)', model: '스타인웨이 B 그랜드 (근접 마이크)',
    tags: ['kpop', 'pop', 'jpop'], use: '가까이서 녹음한 밝고 또렷한 그랜드, 팝·J-pop 반주',
    sfz: `${VC}steinwayb.sfz`,
    // the loudest of three dynamics only: all three are 770 MB of WAV, one is ~260 MB.
    // Named with A0 = the lowest key (unlike most VCSL folders): check-pitch reads −12 with the C3 reading
    gen: (blobs) => vcslMap(blobs, 'Chordophones/Zithers/Grand Piano, Steinway B/Sus/', new RegExp(`^JHPiano_Sus_Close_${N}_vl(4)_rr1\\.wav$`), { release: 0.5, file: 'steinwayb' }),
  },
  knightupright: {
    ...VCSL, strings: true, order: 7.4, family: 'piano', name: 'Knight Upright', model: '나이트 업라이트 피아노',
    tags: ['pop', 'jpop'], use: '방 안에서 치는 듯한 소박한 업라이트, 인디·로파이',
    sfz: `${VC}knightupright.sfz`,
    // the louder of two dynamics (both: 365 MB of WAV); names put the dynamic before the note
    gen: (blobs) => vcslMap(blobs, 'Chordophones/Zithers/Upright Piano, Knight/Sustains/', new RegExp(`^(?=Player_vl\\d_rr1_${N}\\.wav$)Player_vl(2)_rr1_`), { c3: true, release: 0.45, file: 'knightupright' }),
  },
  ssogrand: {
    ...SSO, strings: true, order: 7.6, family: 'piano', name: 'Sonatina Grand', model: '그랜드 피아노 (오케스트라 홀)',
    tags: ['pop', 'jpop'], use: '홀 울림이 있는 그랜드, 게임·애니 OST의 피아노',
    // the repository's program points at Samples/Grand<dyn> <note>.flac, the files are Samples/Grand Piano/<dyn> <note>.flac
    // (C3 = middle C naming); three of the four dynamics
    sfz: 'sso-master/_melofi/ssogrand.sfz',
    gen: (blobs) => vcslMap(blobs, 'Sonatina Symphonic Orchestra/Samples/Grand Piano/', new RegExp(`^(?=(?:PP|Mp|FF) ${N}\\.flac$)(PP|Mp|FF) `), { layers: ['PP', 'Mp', 'FF'], c3: true, release: 0.5, file: 'ssogrand' }),
  },
  // ---------------- bells ----------------
  tubularglock: {
    ...VCSL, order: 77.5, family: 'mallets', name: 'Tubular Glockenspiel', model: '튜블러 글로켄슈필 (종)',
    tags: ['jpop', 'kpop'], use: '맑게 오래 울리는 작은 종, 크리스마스·동화풍 멜로디',
    // file names count octaves from the instrument's lowest (A0 = its A6): measured by spectrum, +60 from the C3 reading
    sfz: `${VC}tubularglock.sfz`,
    gen: (blobs) => vcslMap(blobs, 'Idiophones/Struck Idiophones/Tubular Glockenspiel/', /^([A-G]#?\d)_(quiet|medium|loud)1\.wav$/, { layers: ['quiet', 'medium', 'loud'], c3: true, shift: 60, release: 1.5, file: 'tubularglock' }),
  },
  tubularbells3: {
    ...VCSL, order: 77.6, family: 'mallets', name: 'Tubular Bells (VCSL 1)', model: '튜블러 벨 (차임)',
    tags: ['jpop'], use: '교회 종 같은 차임, 웅장한 OST의 클라이맥스',
    // named with C3 = middle C (C3-F4 = the orchestral chime range C4-F5); autocorrelation agrees
    sfz: `${VC}tubularbells3.sfz`,
    gen: (blobs) => vcslMap(blobs, 'Idiophones/Struck Idiophones/Tubular Bells 1/', /^chimes_([A-G]#?\d)_(pp|p|f|ff)_rr\d\.wav$/, { layers: ['pp', 'p', 'f', 'ff'], c3: true, release: 1.5, file: 'tubularbells3' }),
  },
  // ---------------- solo violin with vibrato ----------------
  // the repository's programs point at lower-case folders (Samples/violin/) that exist only with a capital
  // letter, so the sustain samples are mapped here straight from the folders
  ssoviolin1: {
    ...SSO, order: 36.1, family: 'strings', name: 'Solo Violin 1 (Sonatina)', model: '바이올린 (비브라토)',
    tags: ['jpop', 'kpop'], use: '비브라토가 살아 있는 독주 바이올린, 애니 OST·발라드 선율',
    sfz: 'sso-master/_melofi/ssoviolin1.sfz',
    gen: (blobs) => vcslMap(blobs, 'Sonatina Symphonic Orchestra/Samples/Violin/', /^violin-([a-g]#?\d)\.wav$/, { release: 0.35, file: 'ssoviolin1' }),
  },
  ssoviolin2: {
    ...SSO, order: 36.2, family: 'strings', name: 'Solo Violin 2 (Sonatina)', model: '바이올린 (비브라토, 반음마다)',
    tags: ['jpop', 'kpop'], use: '반음마다 녹음한 비브라토 독주 바이올린, 감성적인 간주',
    sfz: 'sso-master/_melofi/ssoviolin2.sfz',
    // arco with vibrato, every semitone; named with C3 = middle C (lowest file g2 = the open G string)
    gen: (blobs) => vcslMap(blobs, 'Sonatina Symphonic Orchestra/Samples/Violin 2/', /^violin_arco_vib_([a-g]#?\d)\.wav$/, { c3: true, release: 0.35, file: 'ssoviolin2' }),
  },
  // ---------------- plucked strings ----------------
  strumstick: {
    ...VCSL, order: 23.8, family: 'guitar', name: 'Strumstick', model: '스트럼스틱 (덜시머류 발현악기)',
    tags: ['jpop'], use: '만돌린·우쿨렐레처럼 맑게 튕기는 소리, 포크·게임 BGM',
    sfz: `${VC}strumstick.sfz`,
    gen: (blobs) => vcslMap(blobs, 'Chordophones/Composite Chordophones/Strumstick/Finger/', /^Strumstick_Finger_Str\d_Main_([A-G]#?\d)_vl(\d)_rr\d\.wav$/, { c3: true, release: 0.4, file: 'strumstick' }),
  },
  // ---------------- electronic kits (hard kicks, claps) ----------------
  sgdistkit: {
    ...SG, order: 43.1, name: 'Distorted Electro Kit', model: '일렉트로닉 드럼 (디스토션)',
    tags: ['jpop', 'kpop'], use: '찌그러진 킥과 클랩, 하드코어·EDM 비트',
    sfz: 'stargate-sample-pack-main/_melofi/sgdistkit.sfz',
    gen: kitSfz('sgdistkit', { ...fsa('distkit'), 49: 'fugue-state-audio/drums/cymbals/distkit-crash.wav', 51: 'fugue-state-audio/drums/cymbals/distkit-ride.wav',
      56: 'fugue-state-audio/drums/percussion/distkit-cowbell.wav', 75: 'fugue-state-audio/drums/percussion/distkit-claves.wav' }),
  },
  sgx0xkit: {
    ...SG, order: 43.2, name: 'Processed x0x Kit', model: '일렉트로닉 드럼 (x0x 계열)',
    tags: ['jpop', 'kpop', 'pop'], use: '드럼머신 계열의 단단한 킥·스네어, 일렉트로 팝·하우스',
    sfz: 'stargate-sample-pack-main/_melofi/sgx0xkit.sfz',
    gen: kitSfz('sgx0xkit', { ...fsa('x0xproc1'), 37: 'fugue-state-audio/drums/percussion/x0xproc1-rimshot.wav',
      49: 'fugue-state-audio/drums/cymbals/x0xproc1-crash.wav', 51: 'fugue-state-audio/drums/cymbals/x0xproc1-ride.wav' }),
  },
  sgsynthkit: {
    ...SG, order: 43.3, name: 'Synth Kit', model: '일렉트로닉 드럼 (신스)',
    tags: ['jpop', 'kpop'], use: '합성한 듯한 킥과 스네어, 칩·일렉트로닉 리듬게임 곡',
    sfz: 'stargate-sample-pack-main/_melofi/sgsynthkit.sfz',
    gen: kitSfz('sgsynthkit', { ...fsa('synthkit'), 49: 'fugue-state-audio/drums/cymbals/synthkit-crash.wav', 51: 'fugue-state-audio/drums/cymbals/synthkit-ride.wav' }),
  },
  sghardkit: {
    ...SG, order: 43.4, name: 'Hardstyle Kit', model: '일렉트로닉 드럼 (하드스타일 킥)',
    tags: ['jpop'], use: '하드스타일·하드코어의 거친 킥과 클랩',
    sfz: 'stargate-sample-pack-main/_melofi/sghardkit.sfz',
    gen: kitSfz('sghardkit', {
      35: 'freesound/drums/kick/192512__nabz871__knife-party-like-kick.wav', 36: 'freesound/drums/kick/348785__arctis__hardstyle-rawstyle-kick-8.wav',
      37: 'freesound/drums/rimshot/455640__uberproduktion__fd808a-rimshot.wav', 38: 'freesound/drums/snare/387186__alexiero-1__ai-snare-20.wav',
      39: 'freesound/drums/clap/448221__toxicfilmzsrsounds__hip-hop-clap.wav', 40: 'freesound/drums/clap/509526__synthnisse__claps.wav',
      42: 'freesound/drums/cymbal/closed/439766__twentytwentymusic__electronic-closed-hat-9.wav', 44: 'freesound/drums/cymbal/closed/439766__twentytwentymusic__electronic-closed-hat-9.wav',
      46: 'freesound/drums/cymbal/open/439820__twentytwentymusic__electronic-open-hat-7.wav', 49: 'freesound/drums/cymbal/crash/140153__stomachache__analog-cymbal.wav',
      41: 'fugue-state-audio/drums/toms/distkit-lotom.wav', 45: 'fugue-state-audio/drums/toms/distkit-midtom.wav', 48: 'fugue-state-audio/drums/toms/distkit-hitom.wav',
    }),
  },
  // ---------------- acoustic rock kit ----------------
  // Karoryfer Big Rusty Drums (CC0): a 1980s Polish kit; light build as for virtuositylight (one mic per key, ≤4 layers)
  bigrusty: lightKit('bigrusty', {
    repo: 'sfzinstruments/karoryfer.big-rusty-drums', branch: 'main', program: 'Programs/02-basic.sfz', layers: 4,
    mic: (r) => {
      const f = r.file.split(path.sep).join('/');
      const cymbal = /\/Samples\/(crash|china|ride|splash)/.test(f);
      const mic = f.split('/').slice(-2, -1)[0]; // Samples/<drum>/<articulation>/<mic>/<file>
      if (mic === 'kick' || mic === 'top' || mic === 'cl') return cymbal ? 1 : 0; // the drum's own close mic
      if (mic === 'oh') return cymbal ? 0 : 1; // overheads for the cymbals
      return Infinity; // snare bottom, bleed into other drums' mics
    },
  }, { order: 42.6, name: 'Big Rusty Drums (light)', model: '어쿠스틱 드럼 (록)', maker: 'Karoryfer Samples', license: 'CC0',
    tags: ['pop', 'jpop'], use: '크고 묵직한 80년대 록 드럼', url: 'https://github.com/sfzinstruments/karoryfer.big-rusty-drums' }),
};
