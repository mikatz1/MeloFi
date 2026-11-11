// Appends to docs/missing-instruments.md every valid part of a matching run (tools/e2e/timbre-songs.js)
// whose best MeloFi match is under 90 %: the list another agent uses to find real free instruments
// (sampled libraries, not synthesised) that would fit. A part already listed for the same song, stem
// and seconds is not repeated; a re-run after new instruments arrived adds a line with the new score.
//   node tools/e2e/missing-report.mjs <timbre-songs log> [--run "<label>"]
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '..', '..');
const FILE = path.join(ROOT, 'docs', 'missing-instruments.md');
const log = fs.readFileSync(process.argv[2], 'utf8');
const label = process.argv.includes('--run') ? process.argv[process.argv.indexOf('--run') + 1] : new Date().toISOString().slice(0, 16).replace('T', ' ');
const songs = log.split(/\r?\n/).filter((l) => l.includes('TSONG ')).map((l) => JSON.parse(l.slice(l.indexOf('TSONG ') + 6)));

const AST_KO = { piano: '피아노', epiano: '일렉트릭 피아노', organ: '오르간', harpsichord: '하프시코드', synth: '신스', guitar_ac: '어쿠스틱 기타', guitar_el: '일렉 기타', plucked: '발현악기', harp: '하프', bass: '일렉 베이스', upright: '콘트라베이스', strings: '현악 합주', violin: '바이올린', cello: '첼로', pizzicato: '피치카토', brass: '금관', sax: '색소폰', flute: '플루트', clarinet: '클라리넷·목관', mallet: '건반 타악기', bell: '벨', harmonica: '하모니카·아코디언', choir: '합창', voice: '노래', drums_ac: '어쿠스틱 드럼', drums_el: '전자 드럼' };
const STEM_KO = { vocals: '리드 보컬', backing: '코러스', drums: '드럼', bass: '베이스', guitar: '기타', piano: '피아노', other: '그 밖의 악기' };

// a rough style from what the recognition heard over the whole song, and the tempo
function genre(s) {
  const v = s.vote || {}, tot = Object.values(v).reduce((a, x) => a + x, 0) || 1, f = (k) => (v[k] || 0) / tot;
  const el = f('drums_el') + f('synth'), orch = f('strings') + f('violin') + f('cello') + f('brass') + f('choir') + f('harp'), band = f('guitar_el') + f('drums_ac') + f('bass');
  const fast = (s.bpm || 120) >= 160;
  if (orch > 0.25 && el > 0.2) return '심포닉 일렉트로닉 (리듬게임 계열)';
  if (orch > 0.25) return '오케스트라 · 시네마틱';
  if (el > 0.35) return fast ? '하드코어 · 하이템포 일렉트로닉 (리듬게임 계열)' : '일렉트로닉 · EDM';
  if (band > 0.3) return fast ? '록 · 메탈' : '록 · 밴드';
  if (f('voice') > 0.2) return 'J-POP · 보컬 팝';
  return '팝';
}

// the measured sound in words
function sound(d, kind, stem) {
  if (!d) return '측정 불가';
  if (stem === 'drums') return `드럼 키트(${kind || '드럼'} 계열에 가장 가까움): 킥 · 스네어 · 하이햇의 타격음, 스펙트럼과 감쇠로 비교`;
  const bits = [];
  bits.push(d.attack > 0.06 ? `느린 어택(${Math.round(d.attack * 1000)}ms, 활·관악기·패드처럼 부풀며 시작)` : `빠른 어택(${Math.round(d.attack * 1000)}ms)`);
  if (d.decay320 != null) bits.push(d.decay320 > -6 ? '긴 서스테인' : d.decay320 > -18 ? `중간 감쇠(0.32초에 ${d.decay320}dB)` : `빠른 감쇠(0.32초에 ${d.decay320}dB, 뜯거나 치는 소리)`);
  bits.push(d.bright > -14 ? '밝고 배음이 많음' : d.bright > -26 ? '밝기 중간' : '어둡고 배음이 적음');
  if (d.hollow) bits.push('홀수 배음 위주(속 빈 소리: 클라리넷·스퀘어파 계열)');
  bits.push(d.noise > -12 ? '숨·활·찌그러짐 잡음 많음' : d.noise > -25 ? '약간의 잡음' : '깨끗한 음');
  bits.push(`중심 음역 MIDI ${d.pitch}`);
  return `${kind ? `${kind} 계열에 가장 가까움; ` : ''}${bits.join(', ')}`;
}

// what kind of real instrument would fit, from the recognition and the measured sound
function wish(row) {
  const d = row.desc || {}, top = (row.astTop?.[0] || '').split(' ')[0];
  const sus = d.decay320 != null && d.decay320 > -6, slow = d.attack > 0.06, bright = d.bright > -14, noisy = d.noise > -12;
  const base = {
    synth: sus ? (bright ? '디튠된 톱니파 신스 리드/슈퍼쏘 (밝은 필터, 긴 서스테인)' : '아날로그 신스 패드 (느린 필터, 코러스)') : '신스 플럭/아르페지오 (짧은 감쇠, 레조넌스 필터)',
    piano: '그랜드 피아노 (다른 녹음 · 밝은 팝 피아노 또는 업라이트)', epiano: '일렉트릭 피아노 (로즈/와이어리/DX 계열 다른 녹음)', organ: '오르간 (해먼드 드로바·로터리 또는 파이프)',
    guitar_el: noisy ? '디스토션 일렉 기타 (파워코드·리드, 앰프 시뮬)' : '클린/크런치 일렉 기타 (싱글코일)', guitar_ac: '어쿠스틱 기타 (스틸 스트링 스트럼·핑거)',
    strings: slow ? '스트링 앙상블 레가토 (오케스트라 섹션)' : '스트링 스타카토/스피카토 앙상블', violin: '솔로 바이올린 레가토 (비브라토)', cello: '솔로 첼로 레가토',
    brass: bright ? '브라스 섹션 (트럼펫+트롬본 스탭·포르테)' : '프렌치 호른 섹션', sax: '색소폰 (테너/알토, 팝·재즈 톤)', flute: '플루트·피콜로', clarinet: '클라리넷·오보에',
    choir: '합창 (아·우 모음, 남녀 혼성)', voice: '보컬 찹·보이스 샘플 (가사 없는 모음)', bass: '일렉 베이스 (핑거·피크·슬랩)', upright: '콘트라베이스 (재즈 피치카토)',
    mallet: '말렛 (마림바·비브라폰·글로켄)', bell: '벨 (튜블러·차임·뮤직박스)', plucked: '발현악기 (만돌린·우쿨렐레·하프)', harp: '콘서트 하프', harpsichord: '하프시코드', harmonica: '하모니카·아코디언',
    drums_el: '일렉트로닉 드럼 키트 (하드코어 킥·클랩)', drums_ac: '어쿠스틱 드럼 키트 (록·팝)',
  }[top] || `${row.bestKind || '선율 악기'} 계열의 다른 샘플`;
  return base;
}

const songsDone = songs.filter((s) => s.rows);
let out = fs.existsSync(FILE) ? fs.readFileSync(FILE, 'utf8') : `# 매칭 90% 미만 파트 · MeloFi에 없을 가능성이 큰 악기

음색 매칭(docs/timbre-matching.md)에서 최고 일치도가 90%에 못 미친 유효 파트(곡에서 꾸준히 연주되는 것; 한두 번만 들리는 잡음성 파트는 뺌)를 매칭을 돌릴 때마다 덧붙입니다. 인터넷에서 실제 무료 악기(샘플 라이브러리)를 찾아 넣을 때 쓰는 목록이에요. 합성으로 만들지 않습니다.

\`node tools/e2e/missing-report.mjs <timbre-songs 로그>\`로 덧붙입니다. 같은 곡 · 스템 · 구간은 다시 적지 않고, 악기가 새로 들어온 뒤 다시 돌리면 새 점수를 한 줄 더합니다.

| 실행 | 곡 | 스템 · 파트 | 구간(초) | AST 상위 3 | 음색 특징 | 현재 최고 후보 · 점수 | 추정 장르 | 이런 악기가 있으면 맞을 것 |
|---|---|---|---|---|---|---|---|---|
`;
let added = 0;
for (const s of songsDone) for (const row of s.rows) {
  if (row.stray || row.vocal || row.acc >= 90 || !row.best) continue;
  const key = `| ${s.name} | ${STEM_KO[row.stem] || row.stem} · ${row.bars} | ${row.sec[0]}~${row.sec[1]} |`;
  const line = `| ${label} ${key} ${(row.astTop || []).map((x) => { const [c, p] = x.split(' '); return `${AST_KO[c] || c} ${p}`; }).join(', ')} | ${sound(row.desc, row.bestKind, row.stem)} | ${row.bestName} (${row.bestKind}) ${row.acc}% | ${genre(s)} | ${wish(row)} |`;
  const prev = out.split('\n').filter((l) => l.includes(key));
  if (prev.some((l) => l.includes(`) ${row.acc}% |`))) continue;
  out = out.trimEnd() + '\n' + line + '\n';
  added++;
}
fs.writeFileSync(FILE, out);
console.log(`${added} parts added to docs/missing-instruments.md`);
