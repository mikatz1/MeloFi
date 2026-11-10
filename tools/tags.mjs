// Genre tags and a one-line use for the instruments that predate tools/libs-pop.mjs.
// The build copies these into each manifest; `node tools/tags.mjs` updates built manifests in place.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const TAGS = {
  splendid: [['kpop', 'pop', 'jpop'], '발라드, 피아노 반주의 기본'],
  salamander: [['kpop', 'pop', 'jpop'], '밝고 또렷한 그랜드 피아노'],
  maestro: [['kpop', 'pop', 'jpop'], '클래식 공연장 느낌의 그랜드'],
  headroom: [['pop', 'jpop'], '가까이서 녹음한 부드러운 그랜드'],
  rhodes: [['kpop', 'pop', 'jpop'], 'R&B, 네오소울, 로파이의 일렉트릭 피아노'],
  scary: [['pop'], '빈티지하고 거친 업라이트'],
  wurlitzer: [['pop', 'kpop'], '레트로 팝, 소울의 따뜻한 EP'],
  harpsichord: [['jpop'], '바로크풍 편곡, 게임 음악'],
  synth: [['jpop', 'kpop'], '80년대풍 FM 건반'],
  harp: [['jpop', 'kpop'], '인트로의 글리산도, 몽환적인 반주'],
  organ: [['jpop'], '웅장한 엔딩, 교회 분위기'],
  tenorsax: [['pop', 'jpop'], '재즈풍 팝의 굵은 색소폰'],
  recorder: [['jpop'], '소박한 동요풍 멜로디'],
  harmonica: [['pop'], '포크, 컨트리 팝'],
  vibraphone: [['jpop', 'pop'], '재즈풍, 시티팝의 부드러운 말렛'],
  marimba: [['pop', 'kpop'], '트로피컬 하우스, 밝은 팝의 리프'],
  glockenspiel: [['kpop', 'jpop'], '반짝이는 멜로디 겹치기'],
  xylophone: [['jpop', 'kpop'], '경쾌하고 장난스러운 리프'],
  cello: [['kpop', 'jpop'], '발라드의 낮은 현악 멜로디'],
  acousticdrums: [['pop', 'jpop'], '밴드 사운드, 라이브 느낌의 드럼'],
  acoustic: [['kpop', 'pop', 'jpop'], '어쿠스틱 팝의 통기타'],
  electric: [['jpop', 'pop'], '밴드 사운드의 일렉 기타'],
  ebass: [['jpop', 'pop', 'kpop'], '밴드 사운드의 일렉 베이스'],
  upright: [['pop', 'jpop'], '재즈풍 팝의 콘트라베이스'],
  otamatone: [['jpop'], '익살스러운 밈 멜로디'],
  synlead: [['kpop', 'pop', 'jpop'], '신스팝의 리드 멜로디'],
  synpad: [['kpop', 'pop', 'jpop'], '배경에 깔리는 따뜻한 패드'],
  synbass: [['kpop', 'pop', 'jpop'], '신스팝, 디스코의 신디 베이스'],
  synbrass: [['kpop', 'jpop'], '80년대풍 신스 브라스'],
  synpluck: [['kpop', 'pop', 'jpop'], '트로피컬·퓨처 베이스의 플럭'],
  drums808: [['kpop', 'pop', 'jpop'], '힙합, 케이팝의 기본 드럼 머신'],
  drums909: [['kpop', 'pop'], '하우스, 댄스곡의 드럼 머신'],
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'instruments');
  for (const [id, [tags, use]] of Object.entries(TAGS)) {
    const f = path.join(root, id, 'manifest.json');
    if (!fs.existsSync(f)) continue;
    const m = JSON.parse(fs.readFileSync(f, 'utf8'));
    fs.writeFileSync(f, JSON.stringify({ ...m, tags, use }));
  }
  console.log('tagged', Object.keys(TAGS).length);
}
