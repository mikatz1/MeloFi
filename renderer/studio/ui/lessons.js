// The guided tour's lessons, in the order of Image-Line's official "Learn FL Studio" course (13
// lessons), so someone following an FL Studio video can do the same thing here, with the same keys.
// A step: { sel(S) -> element to light up, title, body, prep(S), wait(S) -> true once done, next }.
import { STEP, pattern, notesOf } from '../model.js';
import { TEMPLATES } from '../templates.js';

const chan = (S, re) => S.proj.channels.find((c) => re.test(c.name));
const row = (S, re) => { const c = chan(S, re); return c && document.querySelector(`.rack-row[data-ch="${c.id}"]`); };
const stepsOn = (S, re, idx) => { const c = chan(S, re); if (!c) return false; const l = notesOf(pattern(S.proj), c.id); return idx.every((i) => l.some((n) => n.t === i * STEP)); };
const $ = (sel) => () => document.querySelector(sel);
// lessons that need the basic beat (kick, clap, hat, snare, piano) start from it if it isn't there
const basic = (S) => { if (!chan(S, /kick/i) || !chan(S, /piano/i)) S.setProject(TEMPLATES.basic.make()); };
const strip = (S, re) => { const c = chan(S, re); return c && document.querySelector(`.mx-strip[data-id="${c.id}"]`); };

export const CHAPTERS = [
  {
    id: 'workspace', name: '화면 둘러보기', steps: [
      { title: 'MeloFi Studio에 오신 걸 환영해요', body: 'FL Studio 공식 강좌(Learn FL Studio) 순서에 맞춘 13개 강의를 준비했어요. 화면의 하이라이트를 따라 진행해 보세요. 연습용 새 프로젝트로 시작하며, 작업 중인 프로젝트는 자동으로 저장돼요.',
        prep: (S) => S.setProject(TEMPLATES.basic.make()) },
      { sel: $('.st-tool'), title: '툴바', body: '맨 위에서 패턴/곡 전환, 재생·정지·녹음, 템포(BPM), 메트로놈을 조절해요. FL Studio처럼 Space는 재생/정지, L은 패턴/곡 전환이에요.' },
      { sel: $('.st-rack'), title: '채널 랙 (F6)', body: '악기와 드럼 소리가 한 줄씩 들어가는 곳이에요. 오른쪽 칸을 눌러 비트를 찍고, F6을 누르면 언제든 돌아올 수 있어요.' },
      { sel: $('[data-l=browser]'), title: '브라우저 (Alt+F8)', body: 'Alt+F8이나 ‘브라우저’를 눌러 보세요. 왼쪽 끝에 내 컴퓨터의 샘플과 루프를 찾아 끌어다 쓸 수 있는 브라우저가 열려요.', prep: (S) => { if (S.browserOpen) S.setLeft('browser'); }, wait: (S) => S.leftTab === 'browser' },
      { sel: $('.st-bcol'), title: '브라우저 닫기', body: 'FL Studio처럼 Alt+F8을 한 번 더 누르면 브라우저가 닫혀요.', wait: (S) => S.leftTab === 'rack' },
      { sel: $('[data-tab=roll]'), title: '피아노 롤 (F7)', body: 'F7을 눌러 피아노 롤을 열어 보세요. 멜로디와 코드를 그리는 곳이에요.', prep: (S) => S.setTab('mixer'), wait: (S) => S.tab === 'roll' },
      { sel: $('[data-tab=playlist]'), title: '플레이리스트 (F5)', body: 'F5를 눌러 보세요. 패턴과 오디오를 시간 순서대로 배치해 곡을 완성하는 곳이에요.', wait: (S) => S.tab === 'playlist' },
      { sel: $('[data-tab=mixer]'), title: '믹서 (F9)', body: 'F9를 눌러 보세요. 채널별 음량과 이펙트를 조절하는 곳이에요. F8을 누르면 플러그인 피커(악기 선택 창)가 열려요.', wait: (S) => S.tab === 'mixer' },
      { sel: $('.st-foot .hint'), title: '힌트 바', body: '버튼에 마우스를 올리면 이곳에 설명과 단축키가 나타나요. FL Studio의 힌트 바와 같은 역할이에요.' },
      { title: '1강 끝', body: '다음 강의에서는 채널 랙으로 첫 비트를 만들어 볼게요.', next: 'beat' },
    ],
  },
  {
    id: 'beat', name: '채널 랙으로 비트 만들기', steps: [
      { title: '첫 비트 만들기', body: '킥·클랩·하이햇·스네어·피아노가 들어 있는 기본 프로젝트로 시작해요.', prep: (S) => { S.setProject(TEMPLATES.basic.make()); S.setLeft('rack'); } },
      { sel: (S) => row(S, /kick/i)?.querySelector('.steps'), title: '킥 찍기', body: '킥 줄의 1, 5, 9, 13번째 칸을 눌러 보세요. 한 마디에 ‘쿵’이 네 번 들어가는 기본 댄스 리듬(포 온 더 플로어)이에요.',
        wait: (S) => stepsOn(S, /kick/i, [0, 4, 8, 12]) },
      { sel: $('[data-tour=play]'), title: '들어 보기', body: 'Space를 눌러 재생하고, 다시 누르면 멈춰요.', wait: (S) => S.transport.playing },
      { sel: (S) => row(S, /clap/i)?.querySelector('.steps'), title: '클랩', body: '클랩 줄의 5, 13번째 칸을 눌러 2박과 4박에 박수를 넣어 보세요. 재생 중에도 수정할 수 있어요.',
        wait: (S) => stepsOn(S, /clap/i, [4, 12]) },
      { sel: (S) => row(S, /hat/i)?.querySelector('.steps'), title: '하이햇', body: '하이햇 줄을 누른 채 옆으로 드래그하면 여러 칸이 한꺼번에 켜져요. 6칸 이상 채워 보세요.',
        wait: (S) => { const c = chan(S, /hat/i); return c && notesOf(pattern(S.proj), c.id).length >= 6; } },
      { sel: (S) => row(S, /hat/i)?.querySelector('.steps'), title: '오른쪽 클릭으로 끄기', body: 'FL Studio처럼 칸을 우클릭하면 꺼져요. 우클릭한 채 옆으로 드래그하면 여러 칸을 한 번에 지울 수 있어요.' },
      { sel: $('.rack-foot .seg'), title: 'Graph editor (Ctrl+K)', body: 'Ctrl+K를 누르면 칸마다 벨로시티 막대가 나타나요. 하이햇 막대를 들쭉날쭉하게 맞추면 훨씬 자연스러워져요. 한 번 더 누르면 닫혀요.' },
      { sel: $('[data-tour=bpm]'), title: '템포', body: 'BPM을 바꿔 보세요. 80 안팎은 느긋하고, 120~130은 댄스곡 빠르기예요.', prep: (S) => { S.tourBpm = S.proj.bpm; }, wait: (S) => S.proj.bpm !== S.tourBpm },
      { title: '2강 끝', body: '이제 피아노 롤에서 멜로디와 코드를 넣어 볼게요.', next: 'roll' },
    ],
  },
  {
    id: 'roll', name: '피아노 롤로 멜로디', steps: [
      { sel: (S) => row(S, /piano/i)?.querySelector('.cname'), title: '피아노 롤 열기', body: '피아노 줄 이름을 누르면 해당 채널의 피아노 롤이 열려요.', prep: basic,
        wait: (S) => S.tab === 'roll' && chan(S, /piano/i)?.id === S.proj.selected },
      { sel: $('.st-pane.roll canvas'), title: '노트 그리기', body: '가로는 시간, 세로는 음높이예요. 빈 곳을 클릭하면 노트가 생기고, 끝을 끌면 길이 조절, 우클릭하면 지워져요.' },
      { sel: $('[data-tour=roll-tools]'), title: '도구 (P · B · D · T · C · E)', body: 'FL Studio와 같은 도구와 키예요. Draw(P), Paint(B), Delete(D), Mute(T), Slice(C), Select(E). B를 눌러 Paint 도구로 바꿔 보세요.',
        wait: (S) => S.roll.tool === 'paint' },
      { sel: $('[data-tour=scale]'), title: '스케일 강조', body: '키와 스케일을 고르면 어울리는 음만 밝게 표시돼요. ‘C’와 ‘메이저’를 골라 보세요.', wait: (S) => !!S.proj.scale },
      { sel: $('[data-tour=tool-chord]'), title: 'Stamp (H)', body: 'H를 누르거나 ‘Stamp’ 도구를 고르면 클릭 한 번으로 화음을 통째로 입력할 수 있어요.', wait: (S) => S.roll.tool === 'chord' },
      { sel: $('.st-pane.roll canvas'), title: '코드 진행', body: '마디마다 다른 높이로 코드를 찍어 보세요. 1-6-4-5(도-라-파-솔) 진행은 수많은 팝송에 쓰여요.',
        wait: (S) => { const c = chan(S, /piano/i); return c && notesOf(pattern(S.proj), c.id).length >= 9; } },
      { sel: $('[data-tour=tools]'), title: 'Riff Machine · Randomize', body: '‘도구’ 메뉴의 Riff Machine은 코드 진행 → 아르페지오 → 리듬 → 변형 순서로 한 단계씩 리프를 만들어요. Alt+R(Randomize)은 스케일 안에서 노트를 바로 랜덤 생성해요. Arpeggiate(Alt+A), Strum(Alt+S), 퀀타이즈(Ctrl+Alt+Q)도 FL과 같아요.' },
      { sel: $('.st-pane.roll canvas'), title: 'Ghost channels (Alt+V)', body: '다른 채널의 노트가 흐리게 비쳐 서로 맞추기 쉬워요. Alt+V로 켜고 끌 수 있어요.' },
      { title: '3강 끝', body: '다음은 오디오 루프를 겹쳐 쌓는 방법이에요.', next: 'loops' },
    ],
  },
  {
    id: 'loops', name: '오디오 루프 겹치기', steps: [
      { sel: $('[data-l=browser]'), title: '브라우저 열기', body: 'Alt+F8이나 ‘브라우저’를 눌러 보세요.', prep: (S) => { basic(S); if (S.browserOpen) S.setLeft('browser'); }, wait: (S) => S.leftTab === 'browser' },
      { sel: $('.br-loops'), title: 'MeloFi 루프', body: '‘MeloFi 루프’에서 장르를 골라 파트를 클릭하면 미리 들을 수 있어요. 드럼·베이스·코드·멜로디 루프가 지금 프로젝트의 키와 템포로 만들어져요. 내 샘플 폴더를 추가해 내 루프를 써도 돼요.' },
      { sel: $('.st-browser'), title: '끌어다 놓기', body: '루프를 플레이리스트로 끌어오면 오디오 클립, 채널 랙으로 끌어오면 샘플 채널이 돼요. 파일 탐색기에서 바로 끌어와도 돼요.',
        wait: (S) => S.proj.playlist.clips.some((c) => c.kind === 'audio') || S.proj.channels.some((c) => c.kind === 'sample') },
      { sel: $('.br-loops'), title: '더 쌓기', body: '다른 파트도 ‘넣기’를 누르거나 끌어다 놓아 보세요. 루프가 빈 트랙에 차례로 들어가요.', wait: (S) => new Set(S.proj.playlist.clips.filter((c) => c.kind === 'audio').map((c) => c.track)).size >= 2 },
      { sel: $('[data-tab=playlist]'), title: '겹쳐 쌓기', body: '플레이리스트(F5)에서 클립을 다른 트랙에 나란히 두면 동시에 재생돼요. 드럼 루프 위에 베이스나 신스 루프를 올려 보세요.' },
      { title: '4강 끝', body: '다음은 장르만 고르면 바로 루프를 만들어 주는 Loop Starter예요.', next: 'starter' },
    ],
  },
  {
    id: 'starter', name: 'Loop Starter로 아이디어', steps: [
      { sel: $('[data-tour=file]'), title: 'Loop Starter', body: '‘파일’ 메뉴의 ‘Loop Starter…’에서 장르를 골라 보세요. 드럼·베이스·코드·멜로디 루프가 랜덤 키와 템포로 만들어져 플레이리스트에 차례로 놓여요.',
        wait: (S) => /^Loop Starter/.test(S.proj.name) && S.proj.playlist.clips.filter((c) => c.kind === 'audio').length >= 4 },
      { sel: $('[data-tour=play]'), title: '들어 보기', body: 'Space를 눌러 들어 보세요. 마음에 들지 않으면 Loop Starter를 다시 고르면 다른 키와 템포로 새로 만들어요.', wait: (S) => S.transport.playing },
      { sel: $('.st-pane.playlist canvas'), prep: (S) => { S.setTab('playlist'); S.tourMedia = Object.keys(S.proj.media).length; }, title: '루프 바꾸기', body: '마음에 들지 않는 파트는 클립 제목 줄을 우클릭하고 ‘루프 바꾸기 (셔플)’를 고르세요. 그 파트만 다른 변형으로 바뀌어요.',
        wait: (S) => Object.keys(S.proj.media).length > S.tourMedia },
      { title: '5강 끝', body: '이제 플레이리스트에서 곡으로 편곡해 볼게요.', next: 'arrange' },
    ],
  },
  {
    id: 'arrange', name: '플레이리스트에서 편곡', steps: [
      { sel: $('[data-tab=playlist]'), title: '플레이리스트 (F5)', body: 'F5를 눌러 보세요.', prep: basic, wait: (S) => S.tab === 'playlist' },
      { sel: $('[data-tour=pl-tools]'), title: '페인트 도구 (B)', body: 'B를 누르세요. 드래그만 하면 패턴이 연속으로 이어 붙어요.', wait: (S) => S.playlist.tool === 'paint' },
      { sel: $('.st-pane.playlist canvas'), title: '패턴 칠하기', body: '트랙 하나를 왼쪽에서 오른쪽으로 끌어 패턴을 네 번 이상 이어 붙여 보세요.', prep: (S) => { S.tourClips = S.proj.playlist.clips.length; },
        wait: (S) => S.proj.playlist.clips.length >= S.tourClips + 3 },
      { sel: $('[data-tour=pl-tools]'), title: '선택하고 복제 (E · Ctrl+B)', body: 'Select(E)로 여러 클립을 지정하고 Ctrl+B를 누르면 바로 뒤에 복제돼요. Draw 도구에서는 Ctrl+드래그로 선택해요.' },
      { sel: $('[data-tour=pl-tools]'), title: '자르기 · 뮤트 (C · T)', body: 'C로 클립을 자르고, T로 특정 클립을 뮤트할 수 있어요. 우클릭하면 지워지고, 클립 제목 줄을 우클릭하면 메뉴가 열려요.' },
      { sel: $('[data-tour=mode]'), title: 'SONG 모드 (L)', body: 'L을 눌러 SONG 모드로 바꾸면 플레이리스트 전체가 재생돼요. PAT 모드는 지금 패턴만 반복해요.', prep: (S) => { if (S.proj.mode === 'song') S.setMode('pattern'); }, wait: (S) => S.proj.mode === 'song' },
      { title: '6강 끝', body: '다음은 새 악기(제너레이터)를 불러오는 방법이에요.', next: 'plugins' },
    ],
  },
  {
    id: 'plugins', name: '악기 플러그인', steps: [
      { sel: $('[data-tour=add-channel]'), title: '악기 추가 (F8)', body: '‘+ 채널’ → ‘악기…’를 누르거나 F8을 누르면 플러그인 피커(악기 선택 창)가 열려요. 마음에 드는 악기를 골라 보세요.', prep: (S) => { basic(S); S.setLeft('rack'); S.tourCh = S.proj.channels.length; },
        wait: (S) => S.proj.channels.length > S.tourCh },
      { sel: $('[data-tour=add-channel]'), title: 'MeloFi 신스 프리셋', body: '플러그인 피커의 ‘MeloFi 신스 프리셋’에는 베이스·리드·패드·플럭·FX로 나뉜 신스 소리가 있어요. FL Studio의 FLEX처럼 프리셋을 골라 쓰면 돼요.' },
      { sel: $('.st-rack'), title: '채널 설정', body: '채널 이름을 더블클릭하면 채널 설정 창이 떠요. FL의 플러그인 창처럼 작업하면서 열어 둘 수 있고, 엔벨로프·필터·아르페지에이터를 여기서 조절해요.' },
      { sel: $('[data-tour=add-channel]'), title: '신스와 VST', body: '‘+ 채널’에는 직접 소리를 만드는 신시사이저와 외부 VST3 악기를 불러오는 메뉴도 있어요.' },
      { title: '7강 끝', body: '다음은 믹서에서 이펙트를 적용하는 방법이에요.', next: 'mixer' },
    ],
  },
  {
    id: 'mixer', name: '믹서와 이펙트', steps: [
      { sel: $('[data-tab=mixer]'), title: '믹서 (F9)', body: 'F9를 누르세요.', prep: basic, wait: (S) => S.tab === 'mixer' },
      { sel: (S) => strip(S, /piano/i)?.querySelector('.mx-add'), title: '이펙트 넣기', body: '피아노 채널의 ‘+ 이펙트’에서 ‘리버브’를 골라 보세요.', wait: (S) => chan(S, /piano/i)?.fx.some((f) => f.type === 'reverb') },
      { sel: $('.mx-ed'), title: '이펙트 조절', body: '아래 노브를 드래그해 값을 조절해요. 더블클릭하면 초기화돼요.' },
      { sel: $('.mx-addbus'), title: '믹서 트랙과 센드', body: '‘+ 믹서 트랙’으로 Insert 트랙을 만든 뒤 채널의 ‘+ 센드’로 소리를 보낼 수 있어요. FL Studio처럼 센드는 여러 개 만들 수 있어요.' },
      { sel: $('.mx-row'), title: '사이드체인', body: '베이스나 패드에 ‘사이드체인’ 이펙트를 걸고 ‘따라갈 채널’을 킥으로 지정하면, 킥이 울릴 때마다 소리가 살짝 줄어들어요. 댄스 음악의 펌핑 효과예요.' },
      { title: '8강 끝', body: '다음은 시간에 따라 값이 바뀌는 오토메이션이에요.', next: 'auto' },
    ],
  },
  {
    id: 'auto', name: '오토메이션', steps: [
      { sel: $('[data-tab=mixer]'), title: '노브 고르기', body: '믹서(F9)에서 원하는 노브를 우클릭하고 ‘Create automation clip’을 고르세요.', prep: basic,
        wait: (S) => S.proj.playlist.clips.some((c) => c.kind === 'auto') },
      { sel: $('.st-pane.playlist canvas'), title: '곡선 그리기', body: '플레이리스트에 오토메이션 클립이 생겼어요. 클립 안을 클릭하면 포인트가 생기고, 드래그해서 곡선을 조절할 수 있어요.', prep: (S) => S.setTab('playlist') },
      { sel: $('[data-tour=add-auto]'), title: '다른 방법', body: '‘+ 오토메이션’에서 볼륨·팬·이펙트 항목을 직접 골라 만들 수도 있어요.' },
      { title: '9강 끝', body: '다음은 마이크나 악기 소리를 녹음해 볼게요.', next: 'audio' },
    ],
  },
  {
    id: 'audio', name: '오디오 녹음', steps: [
      { sel: $('[data-tab=mixer]'), title: '믹서 열기', body: 'F9로 믹서를 여세요.', prep: basic, wait: (S) => S.tab === 'mixer' },
      { sel: $('.mx-arm'), title: '녹음 대기 (●)', body: '녹음할 트랙의 ● 버튼을 눌러 대기 상태로 만드세요. 버튼을 우클릭하면 입력 장치(마이크·오디오 인터페이스)를 선택할 수 있어요.',
        wait: (S) => S.proj.channels.some((c) => c.arm) },
      { sel: $('[data-tour=rec]'), title: '녹음 (R)', body: 'R을 누르면 재생과 함께 녹음이 시작되고, 다시 누르면 멈춰요. 녹음본은 플레이리스트에 오디오 클립으로 추가돼요.' },
      { sel: $('.mx-row'), title: 'Pitcher · Newtone', body: '실시간으로는 트랙에 ‘Pitcher’ 이펙트를 넣고 키와 스케일을 지정하세요(보정 속도를 0에 가깝게 하면 오토튠 효과). 녹음한 보컬은 클립 메뉴의 ‘Newtone으로 음정 편집’에서 노트를 끌어 음정과 길이를 고칠 수 있어요.' },
      { title: '10강 끝', body: '다음은 MIDI 건반으로 연주를 녹음해 볼게요.', next: 'midi', prep: (S) => { for (const c of S.proj.channels) c.arm = false; } },
    ],
  },
  {
    id: 'midi', name: 'MIDI 녹음', steps: [
      { sel: $('[data-tour=keys]'), title: '건반 준비', body: 'MIDI 건반을 연결하면 바로 연주할 수 있어요. 건반이 없다면 Ctrl+Shift+K로 화면 건반 창을 띄우세요.', prep: (S) => { basic(S); const c = chan(S, /piano/i); if (c) S.select(c.id); },
        wait: (S) => S.keysOpen },
      { sel: $('[data-tour=metro]'), title: '메트로놈과 카운트 (Ctrl+M · Ctrl+P)', body: 'Ctrl+M으로 메트로놈을 켜세요. Ctrl+P를 누르면 녹음 시작 전 한 마디를 세어 줘요.', wait: (S) => S.transport.metro },
      { sel: $('[data-tour=rec]'), title: '녹음 (R)', body: 'R을 누르고 연주해 보세요. 연주한 노트가 현재 선택된 채널의 패턴에 기록돼요.', wait: (S) => S.transport.recording },
      { sel: $('.st-pane.roll canvas'), title: '퀀타이즈 (Ctrl+Alt+Q)', body: '박자가 어긋났다면 피아노 롤에서 Ctrl+Alt+Q를 눌러 퀀타이즈해 보세요.' },
      { title: '11강 끝', body: '다음은 완성된 곡을 파일로 내보내 볼게요.', next: 'export' },
    ],
  },
  {
    id: 'export', name: '내보내기', steps: [
      { sel: $('[data-tour=file]'), title: 'WAV · MP3 (Ctrl+R · Ctrl+Shift+R)', body: 'FL Studio 단축키와 같아요. Ctrl+R은 WAV, Ctrl+Shift+R은 MP3, Ctrl+Shift+M은 MIDI 파일로 내보내요.' },
      { sel: $('[data-tour=file]'), title: '스템과 영상', body: '‘파일’ 메뉴의 ‘DAW로 보내기’는 채널별 스템 파일로 추출해 다른 작곡 프로그램으로 옮길 수 있게 해 줘요. ‘영상으로 내보내기’도 있어요.' },
      { title: '12강 끝', body: '마지막으로 화면을 취향에 맞게 꾸며 볼게요.', next: 'look' },
    ],
  },
  {
    id: 'look', name: '화면 꾸미기', steps: [
      { sel: $('[data-tour=file]'), title: '화면 꾸미기', body: '‘파일’ 메뉴의 ‘화면 꾸미기…’에서 화면 크기, 강조 색, 트랙과 피아노 롤 줄 높이를 조절해 보세요.', wait: (S) => !!S.app.settings.get('studioLook') },
      { sel: $('[data-tour=windows]'), title: '창 배치', body: '‘창’ 메뉴나 탭 더블클릭으로 피아노 롤·플레이리스트·믹서를 떼어 내 떠 있는 창으로 쓸 수 있어요. ‘모두 떼어내기 (FL 기본 배치)’를 골라 보세요. 배치는 다음에 열 때도 그대로예요.',
        wait: (S) => Object.keys(S.floating || {}).length > 0 },
      { sel: $('.st-split'), title: '패널 너비', body: '채널 랙 경계를 드래그해 너비를 맞추면 다음 실행 때도 유지돼요. 피아노 롤과 플레이리스트 높이는 Alt+휠로 조절해요.' },
      { sel: $('[data-tour=file]'), title: '단축키', body: '‘파일’ 메뉴의 ‘단축키 설정…’에서 키를 바꿀 수 있어요. 기본 배열은 FL Studio와 같아요.' },
      { title: '모든 강의를 마쳤어요', body: '수고하셨어요. 템플릿이나 Loop Starter로 새 곡 작업을 시작해 보세요. 창은 ‘창 → 모두 붙이기’로 되돌릴 수 있고, 튜토리얼은 F1이나 상단 ‘튜토리얼’ 버튼으로 언제든 다시 볼 수 있어요.' },
    ],
  },
];
