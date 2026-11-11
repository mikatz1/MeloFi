// Unit checks for the language core (renderer/i18n/core.mjs): plurals, Korean particles, patterns.
//   node tools/test-i18n.mjs
import { createI18n, josa, resolveLang } from '../renderer/i18n/core.mjs';

const I = createI18n();
I.addTable({
  '{name}을(를) 불러오지 못했습니다: {err}': "Couldn't load {name}: {err}",
  '{n}개 채널': '{n} {n|channel|channels}',
  '보통': 'Normal',
  'touch::보통': 'Medium',
  '{name} · {k}단': '{name} · staff {k}',
});
let bad = 0;
const eq = (a, b) => { if (a !== b) { bad++; console.log(`FAIL ${JSON.stringify(a)} != ${JSON.stringify(b)}`); } else console.log(`ok   ${a}`); };

// Korean (no table needed): the particle follows the word in front
eq(I.t('{n}을(를) 열었습니다.', { n: '피아노' }), '피아노를 열었습니다.');
eq(I.t('"{n}"을(를) 열었습니다.', { n: '드럼' }), '"드럼"을 열었습니다.');
eq(I.t('{n}(으)로 연주합니다', { n: '오르간' }), '오르간으로 연주합니다');
eq(I.t('{n}(으)로 연주합니다', { n: '기타' }), '기타로 연주합니다');
eq(I.t('{n}(으)로 연주합니다', { n: '마디 1' }), '마디 1로 연주합니다'); // 일: ㄹ
eq(josa('MP3(으)로 저장'), 'MP3로 저장'); // read in English: 쓰리
eq(josa('0.3.2이(가) 있어요'), '0.3.2가 있어요');
eq(I.t('{n}개 채널', { n: 3 }), '3개 채널');
eq(I.tc('touch', '보통'), '보통');

I.setLang('en');
eq(I.t('{n}개 채널', { n: 1 }), '1 channel');
eq(I.t('{n}개 채널', { n: 4 }), '4 channels');
eq(I.t('보통'), 'Normal');
eq(I.tc('touch', '보통'), 'Medium');
eq(I.tc('other', '보통'), 'Normal'); // a context without its own entry falls back
eq(I.t('없는 문장'), '없는 문장'); // missing: the Korean, and listed
eq(String(I.missing.has('없는 문장')), 'true');
// text made elsewhere (main process, Python): exact or as a pattern, particle written out or not
eq(I.tdyn('모델을(를) 불러오지 못했습니다: oom'), "Couldn't load 모델: oom");
eq(I.tdyn('피아노를 불러오지 못했습니다: oom'), "Couldn't load 피아노: oom");
eq(I.tdyn('Grand Piano · 2단'), 'Grand Piano · staff 2');

eq(resolveLang('system', 'ko-KR'), 'ko');
eq(resolveLang('system', 'en-US'), 'en');
eq(resolveLang('system', 'ja'), 'en');
eq(resolveLang('ko', 'en-US'), 'ko');

console.log(bad ? `${bad} failed` : 'all passed');
process.exitCode = bad ? 1 : 0;
