// The guided tour's lessons: 13 lessons from the first look at the screen to exporting a song.
// A step: { sel(S) -> element to light up, title, body, demo: { kind, ... } (an animation in
// tourfx.js that acts the step out), prep(S), wait(S) -> true once done, next }.
// Text is marked with N_() and translated where it is shown (tour.js, tourfx.js).
import { STEP, pattern, notesOf } from '../model.js';
import { TEMPLATES } from '../templates.js';
import { N_ } from '../../i18n/i18n.js';

const chan = (S, re) => S.proj.channels.find((c) => re.test(c.name));
const row = (S, re) => { const c = chan(S, re); return c && document.querySelector(`.rack-row[data-ch="${c.id}"]`); };
const stepsOn = (S, re, idx) => { const c = chan(S, re); if (!c) return false; const l = notesOf(pattern(S.proj), c.id); return idx.every((i) => l.some((n) => n.t === i * STEP)); };
const $ = (sel) => () => document.querySelector(sel);
// lessons that need the basic beat (kick, clap, hat, snare, piano) start from it if it isn't there
const basic = (S) => { if (!chan(S, /kick/i) || !chan(S, /piano/i)) S.setProject(TEMPLATES.basic.make()); };
const strip = (S, re) => { const c = chan(S, re); return c && document.querySelector(`.mx-strip[data-id="${c.id}"]`); };
const key = (keys, show) => ({ kind: 'key', keys, show });
const DONE = { kind: 'done' };

export const CHAPTERS = [
  {
    id: 'workspace', name: N_('화면 둘러보기'), goal: N_('작업 화면의 구성과 창을 여는 키를 알아봐요.'), steps: [
      { title: N_('MeloFi Studio에 오신 걸 환영해요'), demo: { kind: 'welcome' }, body: N_('13개 강의로 첫 비트 작성부터 파일 내보내기까지 차근차근 안내해 드려요. 강의마다 애니메이션 예시가 먼저 나오고, 화면에서 밝게 표시된 부분을 직접 해 보면 다음 단계로 넘어가요. 연습용 새 프로젝트로 진행되며, 작업 중이던 프로젝트는 자동으로 저장돼요.'),
        prep: (S) => S.setProject(TEMPLATES.basic.make()) },
      { sel: $('.st-tool'), title: N_('툴바'), demo: key(['Space'], N_('재생 / 정지')), body: N_('왼쪽 위는 메뉴(파일·편집·추가·패턴·보기·옵션·도구·도움말), 그 옆은 PAT/SONG 전환, 재생·정지·녹음, 템포(BPM), 메트로놈이에요. 오른쪽 아이콘은 창 바로가기예요. Space는 재생/정지, L은 PAT/SONG 전환 단축키예요.') },
      { sel: $('.st-rack'), title: N_('채널 랙 (F6)'), demo: { kind: 'steps', on: [0, 4, 8, 12], label: 'Kick' }, body: N_('악기와 드럼 소리가 한 줄씩 들어가는 곳이에요. 오른쪽 칸을 눌러 비트를 찍고, F6을 누르면 언제든 돌아올 수 있어요.') },
      { sel: $('[data-l=browser]'), title: N_('브라우저 (Alt+F8)'), demo: { kind: 'browser' }, body: N_('Alt+F8이나 ‘브라우저’ 버튼을 눌러 보세요. 왼쪽에 샘플과 루프를 찾아 끌어다 쓸 수 있는 브라우저가 열려요.'), prep: (S) => { if (S.browserOpen) S.setLeft('browser'); }, wait: (S) => S.leftTab === 'browser' },
      { sel: $('.st-bcol'), title: N_('브라우저 닫기'), demo: { kind: 'browser', close: true }, body: N_('Alt+F8을 한 번 더 누르면 브라우저가 닫혀요.'), wait: (S) => S.leftTab === 'rack' },
      { sel: $('[data-tab=roll]'), title: N_('피아노 롤 (F7)'), demo: key(['F7'], N_('피아노 롤')), body: N_('F7을 눌러 피아노 롤을 열어 보세요. 멜로디와 코드를 그리는 곳이에요.'), prep: (S) => S.setTab('mixer'), wait: (S) => S.tab === 'roll' },
      { sel: $('[data-tab=playlist]'), title: N_('플레이리스트 (F5)'), demo: key(['F5'], N_('플레이리스트')), body: N_('F5를 눌러 보세요. 패턴과 오디오를 시간 순서대로 배치해 곡을 완성하는 곳이에요.'), wait: (S) => S.tab === 'playlist' },
      { sel: $('[data-tab=mixer]'), title: N_('믹서 (F9)'), demo: key(['F9'], N_('믹서')), body: N_('F9를 눌러 보세요. 채널별 음량과 이펙트를 조절하는 곳이에요. F8을 누르면 플러그인 피커(악기 선택 창)가 열려요.'), wait: (S) => S.tab === 'mixer' },
      { sel: $('.st-hint'), title: N_('힌트 바'), demo: { kind: 'layout' }, body: N_('버튼 위에 마우스를 올리면 메뉴 아래 힌트 바에 설명과 단축키가 표시돼요. 처음 보는 기능은 힌트 바를 먼저 확인해 보세요.') },
      { title: N_('1강 끝'), demo: DONE, body: N_('다음 강의에서는 채널 랙으로 첫 비트를 만들어 볼게요.'), next: 'beat' },
    ],
  },
  {
    id: 'beat', name: N_('채널 랙으로 비트 만들기'), goal: N_('킥·클랩·하이햇으로 한 마디짜리 기본 비트를 찍어 봐요.'), steps: [
      { title: N_('첫 비트 만들기'), demo: { kind: 'play' }, body: N_('킥, 클랩, 하이햇, 스네어, 피아노가 설정된 기본 프로젝트로 시작해요. 한 마디는 16칸이며, 4칸이 한 박자예요.'), prep: (S) => { S.setProject(TEMPLATES.basic.make()); S.setLeft('rack'); } },
      { sel: (S) => row(S, /kick/i)?.querySelector('.steps'), title: N_('킥 찍기'), demo: { kind: 'steps', on: [0, 4, 8, 12], label: N_('Kick · 1, 5, 9, 13번째 칸') }, body: N_('킥 트랙의 1, 5, 9, 13번째 칸을 눌러 보세요. 한 마디에 쿵 소리가 네 번 들어가는 댄스 리듬이에요.'),
        wait: (S) => stepsOn(S, /kick/i, [0, 4, 8, 12]) },
      { sel: $('[data-tour=play]'), title: N_('들어 보기'), demo: { kind: 'play' }, body: N_('Space를 눌러 재생하고, 다시 누르면 멈춰요.'), wait: (S) => S.transport.playing },
      { sel: (S) => row(S, /clap/i)?.querySelector('.steps'), title: N_('클랩'), demo: { kind: 'steps', on: [4, 12], color: '#7fb0ff', label: N_('Clap · 5, 13번째 칸 (2박과 4박)') }, body: N_('클랩 트랙의 5, 13번째 칸을 눌러 2박과 4박에 박수를 넣어 보세요. 재생 중에도 자유롭게 바꿀 수 있어요.'),
        wait: (S) => stepsOn(S, /clap/i, [4, 12]) },
      { sel: (S) => row(S, /hat/i)?.querySelector('.steps'), title: N_('하이햇'), demo: { kind: 'stepsDrag' }, body: N_('하이햇 줄을 누른 채 옆으로 드래그하면 여러 칸이 한꺼번에 켜져요. 6칸 이상 채워 보세요.'),
        wait: (S) => { const c = chan(S, /hat/i); return c && notesOf(pattern(S.proj), c.id).length >= 6; } },
      { sel: (S) => row(S, /hat/i)?.querySelector('.steps'), title: N_('오른쪽 클릭으로 끄기'), demo: { kind: 'stepsDrag', erase: true }, body: N_('칸을 우클릭하면 꺼져요. 우클릭한 채 옆으로 드래그하면 여러 칸을 한 번에 지울 수 있어요.') },
      { sel: $('.rack-foot .seg'), title: 'Graph editor (Ctrl+K)', demo: { kind: 'velocity' }, body: N_('Ctrl+K를 누르면 칸마다 벨로시티 막대가 나타나요. 하이햇 막대를 들쭉날쭉하게 맞추면 훨씬 자연스러워져요. 한 번 더 누르면 닫혀요.') },
      { sel: $('[data-tour=bpm]'), title: N_('템포'), demo: { kind: 'tempo' }, body: N_('BPM을 바꿔 보세요. 80 안팎은 느긋하고, 120~130은 댄스곡 빠르기예요.'), prep: (S) => { S.tourBpm = S.proj.bpm; }, wait: (S) => S.proj.bpm !== S.tourBpm },
      { title: N_('2강 끝'), demo: DONE, body: N_('이제 피아노 롤에서 멜로디와 코드를 넣어 볼게요.'), next: 'roll' },
    ],
  },
  {
    id: 'roll', name: N_('피아노 롤로 멜로디'), goal: N_('노트를 찍어 스케일과 코드로 멜로디를 만들어 봐요.'), steps: [
      { sel: (S) => row(S, /piano/i)?.querySelector('.cname'), title: N_('피아노 롤 열기'), demo: key(['F7'], N_('피아노 롤')), body: N_('피아노 채널 이름을 누르면 해당 채널의 피아노 롤이 열려요.'), prep: basic,
        wait: (S) => S.tab === 'roll' && chan(S, /piano/i)?.id === S.proj.selected },
      { sel: $('.st-pane.roll canvas'), title: N_('노트 그리기'), demo: { kind: 'rollDraw' }, body: N_('가로축은 시간, 세로축은 음높이예요. 빈 곳을 클릭하면 노트가 생성되고, 끝을 드래그하면 길이가 조절되며, 우클릭하면 지워져요.') },
      { sel: $('[data-tour=roll-tools]'), title: N_('도구 (P · B · D · T · C · E)'), demo: { kind: 'tools' }, body: N_('Draw(P), Paint(B), Delete(D), Mute(T), Slice(C), Select(E). 단축키 하나로 도구를 전환해요. B를 눌러 Paint 도구를 사용해 보세요.'),
        wait: (S) => S.roll.tool === 'paint' },
      { sel: $('[data-tour=scale]'), title: N_('스케일 강조'), demo: { kind: 'scale' }, body: N_('키와 스케일을 고르면 어울리는 음만 밝게 표시돼요. ‘C’와 ‘메이저’를 골라 보세요.'), wait: (S) => !!S.proj.scale },
      { sel: $('[data-tour=tool-chord]'), title: 'Stamp (H)', demo: { kind: 'chord' }, body: N_('H를 누르거나 ‘Stamp’ 도구를 선택하면 클릭 한 번으로 코드 전체를 입력할 수 있어요.'), wait: (S) => S.roll.tool === 'chord' },
      { sel: $('.st-pane.roll canvas'), title: N_('코드 진행'), demo: { kind: 'progression' }, body: N_('마디마다 다른 높이로 코드를 찍어 보세요. 1-6-4-5(도-라-파-솔) 진행은 수많은 팝송에 쓰여요.'),
        wait: (S) => { const c = chan(S, /piano/i); return c && notesOf(pattern(S.proj), c.id).length >= 9; } },
      { sel: $('[data-tour=tools]'), title: 'Riff Machine · Randomize', demo: { kind: 'riff' }, body: N_('‘도구’ 메뉴의 Riff Machine은 코드 진행 → 아르페지오 → 그루브 → 변형 순서로 리프를 자동 생성해 줘요. Alt+R(Randomize)은 지정한 스케일 안에서 노트를 무작위로 생성해요. Arpeggiate(Alt+A), Strum(Alt+S), 퀀타이즈(Ctrl+Alt+Q) 기능도 제공돼요.') },
      { sel: $('.st-pane.roll canvas'), title: 'Ghost channels (Alt+V)', demo: { kind: 'ghost' }, body: N_('다른 채널의 노트가 가이드로 반투명하게 비쳐 보여서 음을 맞추기 편해요. Alt+V로 켜고 끌 수 있어요.') },
      { title: N_('3강 끝'), demo: DONE, body: N_('다음은 오디오 루프를 겹쳐 쌓는 방법이에요.'), next: 'loops' },
    ],
  },
  {
    id: 'loops', name: N_('오디오 루프 겹치기'), goal: N_('루프를 끌어다 놓고 여러 트랙에 쌓아 배열해 봐요.'), steps: [
      { sel: $('[data-l=browser]'), title: N_('브라우저 열기'), demo: { kind: 'browser' }, body: N_('Alt+F8이나 ‘브라우저’를 눌러 보세요.'), prep: (S) => { basic(S); if (S.browserOpen) S.setLeft('browser'); }, wait: (S) => S.leftTab === 'browser' },
      { sel: $('.br-loops'), title: N_('MeloFi 루프'), demo: { kind: 'dragDrop' }, body: N_('‘MeloFi 루프’에서 장르를 골라 파트를 클릭하면 미리 들을 수 있어요. 드럼·베이스·코드·멜로디 루프가 지금 프로젝트의 키와 템포로 만들어져요. 내 샘플 폴더를 추가해 내 루프를 써도 돼요.') },
      { sel: $('.st-browser'), title: N_('끌어다 놓기'), demo: { kind: 'dragDrop' }, body: N_('루프를 플레이리스트로 끌어오면 오디오 클립, 채널 랙으로 끌어오면 샘플 채널이 돼요. 파일 탐색기에서 바로 끌어와도 돼요.'),
        wait: (S) => S.proj.playlist.clips.some((c) => c.kind === 'audio') || S.proj.channels.some((c) => c.kind === 'sample') },
      { sel: $('.br-loops'), title: N_('더 쌓기'), demo: { kind: 'layers' }, body: N_('다른 파트도 ‘넣기’를 누르거나 끌어다 놓아 보세요. 루프가 빈 트랙에 차례로 들어가요.'), wait: (S) => new Set(S.proj.playlist.clips.filter((c) => c.kind === 'audio').map((c) => c.track)).size >= 2 },
      { sel: $('[data-tab=playlist]'), title: N_('겹쳐 쌓기'), demo: { kind: 'layers' }, body: N_('플레이리스트(F5)에서 클립을 다른 트랙에 나란히 두면 동시에 재생돼요. 드럼 루프 위에 베이스나 신스 루프를 올려 보세요.') },
      { title: N_('4강 끝'), demo: DONE, body: N_('다음은 장르만 고르면 바로 루프를 만들어 주는 Loop Starter예요.'), next: 'starter' },
    ],
  },
  {
    id: 'starter', name: N_('Loop Starter로 아이디어'), goal: N_('원하는 장르를 선택해 곡의 틀을 잡고, 마음에 들지 않는 파트만 교체해 보세요.'), steps: [
      { sel: $('[data-tour=file]'), title: 'Loop Starter', demo: { kind: 'starter' }, body: N_('‘파일’ 메뉴의 ‘Loop Starter…’에서 장르를 골라 보세요. 드럼·베이스·코드·멜로디 루프가 무작위 키와 템포로 만들어져 플레이리스트에 차례로 놓여요.'),
        wait: (S) => /^Loop Starter/.test(S.proj.name) && S.proj.playlist.clips.filter((c) => c.kind === 'audio').length >= 4 },
      { sel: $('[data-tour=play]'), title: N_('들어 보기'), demo: { kind: 'layers' }, body: N_('Space를 눌러 들어 보세요. 마음에 들지 않으면 Loop Starter를 다시 고르면 다른 키와 템포로 새로 만들어요.'), wait: (S) => S.transport.playing },
      { sel: $('.st-pane.playlist canvas'), prep: (S) => { S.setTab('playlist'); S.tourMedia = Object.keys(S.proj.media).length; }, title: N_('루프 바꾸기'), demo: { kind: 'starter', still: 0.9 }, body: N_('변경하고 싶은 파트의 클립 제목 줄을 우클릭하고 ‘루프 바꾸기 (셔플)’를 선택하세요. 해당 파트만 다른 변형 패턴으로 교체돼요.'),
        wait: (S) => Object.keys(S.proj.media).length > S.tourMedia },
      { title: N_('5강 끝'), demo: DONE, body: N_('이제 플레이리스트에서 곡으로 편곡해 볼게요.'), next: 'arrange' },
    ],
  },
  {
    id: 'arrange', name: N_('플레이리스트에서 편곡'), goal: N_('패턴을 배치하고 복제·자르기로 곡의 전체 구조를 완성해요.'), steps: [
      { sel: $('[data-tab=playlist]'), title: N_('플레이리스트 (F5)'), demo: key(['F5'], N_('플레이리스트')), body: N_('F5를 눌러 보세요.'), prep: basic, wait: (S) => S.tab === 'playlist' },
      { sel: $('[data-tour=pl-tools]'), title: N_('페인트 도구 (B)'), demo: key(['B'], 'Paint'), body: N_('B를 누르세요. 드래그만 하면 패턴이 연속으로 이어 붙어요.'), wait: (S) => S.playlist.tool === 'paint' },
      { sel: $('.st-pane.playlist canvas'), title: N_('패턴 칠하기'), demo: { kind: 'paintClips' }, body: N_('트랙 하나를 왼쪽에서 오른쪽으로 끌어 패턴을 네 번 이상 이어 붙여 보세요.'), prep: (S) => { S.tourClips = S.proj.playlist.clips.length; },
        wait: (S) => S.proj.playlist.clips.length >= S.tourClips + 3 },
      { sel: $('[data-tour=pl-tools]'), title: N_('선택하고 복제 (E · Ctrl+B)'), demo: { kind: 'select' }, body: N_('Select(E)로 여러 클립을 드래그하여 선택한 뒤 Ctrl+B를 누르면 뒤이어 바로 복제돼요. Draw 도구에서는 Ctrl+드래그로 선택할 수 있어요.') },
      { sel: $('[data-tour=pl-tools]'), title: N_('자르기 · 뮤트 (C · T)'), demo: { kind: 'sliceMute' }, body: N_('C로 클립을 분할하고, T로 원하는 클립만 뮤트해요. 우클릭하면 삭제되고, 클립 제목 줄을 우클릭하면 상세 메뉴가 열려요.') },
      { sel: $('[data-tour=mode]'), title: N_('SONG 모드 (L)'), demo: { kind: 'songmode' }, body: N_('L을 눌러 SONG 모드로 바꾸면 플레이리스트 전체가 재생돼요. PAT 모드는 지금 패턴만 반복해요.'), prep: (S) => { if (S.proj.mode === 'song') S.setMode('pattern'); }, wait: (S) => S.proj.mode === 'song' },
      { title: N_('6강 끝'), demo: DONE, body: N_('이제 새 악기를 불러오는 방법을 알아볼게요.'), next: 'plugins' },
    ],
  },
  {
    id: 'plugins', name: N_('악기 플러그인'), goal: N_('악기와 신스 프리셋을 불러와 소리를 디자인해 봐요.'), steps: [
      { sel: $('[data-tour=add-channel]'), title: N_('악기 추가 (F8)'), demo: { kind: 'picker' }, body: N_('‘+ 채널’ → ‘악기…’를 누르거나 F8을 누르면 플러그인 피커(악기 선택 창)가 열려요. 마음에 드는 악기를 골라 보세요.'), prep: (S) => { basic(S); S.setLeft('rack'); S.tourCh = S.proj.channels.length; },
        wait: (S) => S.proj.channels.length > S.tourCh },
      { sel: $('[data-tour=add-channel]'), title: N_('MeloFi 신스 프리셋'), demo: { kind: 'picker', preset: true }, body: N_('플러그인 피커의 ‘MeloFi 신스 프리셋’에서 베이스·리드·패드·플럭·FX별 신스 사운드를 탐색해 보세요. 프리셋을 선택한 뒤 취향에 맞게 파라미터를 조절하면 돼요.') },
      { sel: $('.st-rack'), title: N_('채널 설정'), demo: { kind: 'channelWin' }, body: N_('채널 이름을 더블클릭하면 채널 설정 창이 열려요. 작업 중 항상 띄워 둘 수 있으며, 엔벨로프·필터·아르페지에이터를 설정할 수 있어요.') },
      { sel: $('[data-tour=add-channel]'), title: N_('신스와 VST'), demo: { kind: 'picker' }, body: N_('‘+ 채널’에는 직접 소리를 만드는 신시사이저와 외부 VST3 악기를 불러오는 메뉴도 있어요.') },
      { title: N_('7강 끝'), demo: DONE, body: N_('이제 믹서에서 이펙트를 적용하는 방법을 알아볼게요.'), next: 'mixer' },
    ],
  },
  {
    id: 'mixer', name: N_('믹서와 이펙트'), goal: N_('이펙트, 센드, 사이드체인으로 밸런스를 잡고 소리를 정돈해요.'), steps: [
      { sel: $('[data-tab=mixer]'), title: N_('믹서 (F9)'), demo: key(['F9'], N_('믹서')), body: N_('F9를 눌러 믹서를 열어 보세요.'), prep: basic, wait: (S) => S.tab === 'mixer' },
      { sel: (S) => strip(S, /piano/i)?.querySelector('.mx-add'), title: N_('이펙트 넣기'), demo: { kind: 'fx' }, body: N_('피아노 채널의 ‘+ 이펙트’에서 ‘리버브’를 골라 보세요.'), wait: (S) => chan(S, /piano/i)?.fx.some((f) => f.type === 'reverb') },
      { sel: $('.mx-ed'), title: N_('이펙트 조절'), demo: { kind: 'knob' }, body: N_('하단 노브를 위아래로 드래그해 수치를 조절해요. 더블클릭하면 초기값으로 리셋돼요.') },
      { sel: $('.mx-addbus'), title: N_('믹서 트랙과 센드'), demo: { kind: 'sends' }, body: N_('‘+ 믹서 트랙’으로 트랙을 만든 뒤 채널의 ‘+ 센드’로 소리를 보낼 수 있어요. 센드는 여러 개 만들 수 있어요.') },
      { sel: $('.mx-row'), title: N_('사이드체인'), demo: { kind: 'sidechain' }, body: N_('베이스나 패드에 ‘사이드체인’ 이펙트를 걸고 ‘따라갈 채널’을 킥으로 지정하면, 킥이 울릴 때마다 소리가 살짝 줄어들어요. 댄스 음악의 펌핑 효과예요.') },
      { title: N_('8강 끝'), demo: DONE, body: N_('다음은 시간에 따라 값이 바뀌는 오토메이션이에요.'), next: 'auto' },
    ],
  },
  {
    id: 'auto', name: N_('오토메이션'), goal: N_('노브 값을 곡 진행에 맞춰 자동으로 변하게 만들어 봐요.'), steps: [
      { sel: $('[data-tab=mixer]'), title: N_('노브 고르기'), demo: { kind: 'knob' }, body: N_('믹서(F9)에서 원하는 노브를 우클릭하고 ‘Create automation clip’을 고르세요.'), prep: basic,
        wait: (S) => S.proj.playlist.clips.some((c) => c.kind === 'auto') },
      { sel: $('.st-pane.playlist canvas'), title: N_('곡선 그리기'), demo: { kind: 'automation' }, body: N_('플레이리스트에 오토메이션 클립이 생성되었어요. 클립 내부를 클릭해 포인트를 추가하고, 드래그하여 변화 곡선을 조절해 보세요.'), prep: (S) => S.setTab('playlist') },
      { sel: $('[data-tour=add-auto]'), title: N_('다른 방법'), demo: { kind: 'automation', still: 0.9 }, body: N_('‘+ 오토메이션’에서 볼륨·팬·이펙트 항목을 직접 골라 만들 수도 있어요.') },
      { title: N_('9강 끝'), demo: DONE, body: N_('다음은 마이크나 악기 소리를 녹음해 볼게요.'), next: 'audio' },
    ],
  },
  {
    id: 'audio', name: N_('오디오 녹음'), goal: N_('마이크로 오디오를 녹음하고 음정을 보정해 봐요.'), steps: [
      { sel: $('[data-tab=mixer]'), title: N_('믹서 열기'), demo: key(['F9'], N_('믹서')), body: N_('F9로 믹서를 여세요.'), prep: basic, wait: (S) => S.tab === 'mixer' },
      { sel: $('.mx-arm'), title: N_('녹음 대기 (●)'), demo: { kind: 'arm' }, body: N_('녹음할 트랙의 ● 버튼을 눌러 녹음 대기 상태로 설정하세요. 버튼을 우클릭하면 입력 장치(마이크·오디오 인터페이스)를 선택할 수 있어요.'),
        wait: (S) => S.proj.channels.some((c) => c.arm) },
      { sel: $('[data-tour=rec]'), title: N_('녹음 (R)'), demo: { kind: 'record' }, body: N_('R을 누르면 재생과 함께 녹음이 시작되고, 다시 누르면 정지돼요. 녹음된 파일은 플레이리스트에 오디오 클립으로 추가돼요.') },
      { sel: $('.mx-row'), title: 'Pitcher · Newtone', demo: { kind: 'pitch' }, body: N_('실시간 보정은 트랙에 ‘Pitcher’ 이펙트를 추가하고 키와 스케일을 지정하세요(보정 속도를 0에 가깝게 하면 오토튠 효과). 녹음된 보컬은 클립 메뉴의 ‘Newtone으로 음정 편집’에서 노트를 이동해 음정과 길이를 수정할 수 있어요.') },
      { title: N_('10강 끝'), demo: DONE, body: N_('다음은 MIDI 건반으로 연주를 녹음해 볼게요.'), next: 'midi', prep: (S) => { for (const c of S.proj.channels) c.arm = false; } },
    ],
  },
  {
    id: 'midi', name: N_('MIDI 녹음'), goal: N_('건반 연주를 패턴에 실시간으로 기록하고 박자에 맞춰 정렬해요.'), steps: [
      { sel: $('[data-tour=keys]'), title: N_('건반 준비'), demo: { kind: 'keyboard' }, body: N_('MIDI 건반을 연결하면 바로 연주할 수 있어요. 건반이 없다면 Ctrl+Shift+K로 화면 건반 창을 띄우세요.'), prep: (S) => { basic(S); const c = chan(S, /piano/i); if (c) S.select(c.id); },
        wait: (S) => S.keysOpen },
      { sel: $('[data-tour=metro]'), title: N_('메트로놈과 카운트 (Ctrl+M · Ctrl+P)'), demo: { kind: 'metro' }, body: N_('Ctrl+M으로 메트로놈을 켜세요. Ctrl+P를 누르면 녹음 시작 전 한 마디 예비 박을 세어 줘요.'), wait: (S) => S.transport.metro },
      { sel: $('[data-tour=rec]'), title: N_('녹음 (R)'), demo: { kind: 'keyboard' }, body: N_('R을 누른 뒤 건반을 연주해 보세요. 연주한 노트가 현재 선택된 채널의 패턴에 기록돼요.'), wait: (S) => S.transport.recording },
      { sel: $('.st-pane.roll canvas'), title: N_('퀀타이즈 (Ctrl+Alt+Q)'), demo: { kind: 'quantize' }, body: N_('박자가 맞지 않는 경우 피아노 롤에서 Ctrl+Alt+Q를 눌러 퀀타이즈를 적용하세요.') },
      { title: N_('11강 끝'), demo: DONE, body: N_('이제 완성된 프로젝트를 파일로 내보내는 방법을 알아볼게요.'), next: 'export' },
    ],
  },
  {
    id: 'export', name: N_('내보내기'), goal: N_('완성한 곡을 오디오·MIDI·스템 파일로 저장해 봐요.'), steps: [
      { sel: $('[data-tour=file]'), title: 'WAV · MP3 (Ctrl+R · Ctrl+Shift+R)', demo: { kind: 'export' }, body: N_('Ctrl+R은 WAV, Ctrl+Shift+R은 MP3, Ctrl+Shift+M은 MIDI 파일 내보내기 단축키예요.') },
      { sel: $('[data-tour=file]'), title: N_('스템과 영상'), demo: { kind: 'stems' }, body: N_('‘파일’ 메뉴의 ‘DAW로 보내기’는 채널별 스템 파일로 저장해 다른 작곡 프로그램으로 옮길 수 있게 해 줘요. ‘영상으로 내보내기’도 있어요.') },
      { title: N_('12강 끝'), demo: DONE, body: N_('마지막으로 화면을 취향에 맞게 꾸며 볼게요.'), next: 'look' },
    ],
  },
  {
    id: 'look', name: N_('화면 꾸미기'), goal: N_('크기·색·창 배치를 내 작업 방식에 맞춰요.'), steps: [
      { sel: $('[data-tour=windows]'), title: N_('화면 꾸미기'), demo: { kind: 'look' }, body: N_('‘보기’ 메뉴의 ‘화면 꾸미기…’에서 화면 크기, 강조 색, 트랙과 피아노 롤 줄 높이를 바꿔 보세요.'), wait: (S) => !!S.app.settings.get('studioLook') },
      { sel: $('[data-tour=windows]'), title: N_('창 배치'), demo: { kind: 'windows' }, body: N_('‘보기’ 메뉴나 탭 더블클릭으로 피아노 롤·플레이리스트·믹서를 독립된 플로팅 창으로 분리할 수 있어요. ‘모두 떼어내기 (작업 창 배치)’를 선택해 보세요. 설정한 배치는 앱을 재실행해도 유지돼요.'),
        wait: (S) => Object.keys(S.floating || {}).length > 0 },
      { sel: $('.st-split'), title: N_('패널 너비'), demo: { kind: 'resize' }, body: N_('채널 랙 경계를 드래그해 너비를 조정하면 설정이 저장돼요. 피아노 롤과 플레이리스트 높이는 Alt+스크롤 휠로 조절해요.') },
      { sel: $('[data-tour=options]'), title: N_('단축키'), demo: key(['Ctrl', 'S'], N_('저장')), body: N_('‘옵션’ 메뉴의 ‘단축키 설정…’에서 원하는 키로 바꿀 수 있어요.') },
      { title: N_('모든 강의를 마쳤어요'), demo: DONE, body: N_('수고하셨어요. 템플릿이나 Loop Starter로 새 곡을 시작해 보세요. 창은 ‘창 → 모두 붙이기’로 되돌릴 수 있고, 튜토리얼은 F1이나 위쪽 ‘튜토리얼’ 버튼으로 언제든 다시 볼 수 있어요.') },
    ],
  },
];
