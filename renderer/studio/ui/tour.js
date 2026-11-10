// Guided tour for beginners: one thing at a time. Each step lights up a part of the screen,
// says what it is and, where it makes sense, asks you to try it — the tour moves on by itself
// once you have. Three chapters: first beat, chords & melody, song & mix.
import { h } from './dom.js';
import { STEP, pattern, notesOf } from '../model.js';
import { TEMPLATES } from '../templates.js';

const chan = (S, re) => S.proj.channels.find((c) => re.test(c.name));
const row = (S, re) => { const c = chan(S, re); return c && document.querySelector(`.rack-row[data-ch="${c.id}"]`); };
const stepsOn = (S, re, idx) => { const c = chan(S, re); if (!c) return false; const l = notesOf(pattern(S.proj), c.id); return idx.every((i) => l.some((n) => n.t === i * STEP)); };

export const CHAPTERS = [
  {
    id: 'beat', name: '첫 비트 만들기', steps: [
      { title: '작곡 스튜디오에 오신 걸 환영해요', body: '5분이면 첫 비트를 만들 수 있어요. 화면에서 밝게 표시된 곳을 따라 진행해 보세요. 연습용 새 프로젝트로 시작합니다. 작업 중이던 프로젝트는 자동 저장돼요.',
        prep: (S) => S.setProject(TEMPLATES.basic.make()) },
      { sel: () => document.querySelector('.st-rack'), title: '채널 랙', body: '줄마다 악기가 하나씩 배정되어 있어요. 위에서부터 킥(쿵), 클랩(짝), 하이햇(칙), 스네어(탁), 피아노 순이에요. 오른쪽의 16개 작은 칸이 한 마디입니다.' },
      { sel: (S) => row(S, /kick/i)?.querySelector('.steps'), title: '킥 찍기', body: '킥 줄의 1, 5, 9, 13번째 칸을 눌러 보세요. 한 마디에 ‘쿵’ 소리가 네 번 들어가는 가장 기본적인 댄스 리듬이에요.',
        wait: (S) => stepsOn(S, /kick/i, [0, 4, 8, 12]) },
      { sel: () => document.querySelector('[data-tour=play]'), title: '들어 보기', body: '재생 버튼이나 Space 키를 눌러 보세요. 같은 키를 누르면 정지합니다.', wait: (S) => S.transport.playing },
      { sel: (S) => row(S, /clap/i)?.querySelector('.steps'), title: '박수 넣기', body: '클랩 줄의 5번째와 13번째 칸을 눌러요. 2박과 4박에 박수가 들어가면 리듬이 한결 살아나요. 재생 중에도 자유롭게 바꿀 수 있어요.',
        wait: (S) => stepsOn(S, /clap/i, [4, 12]) },
      { sel: (S) => row(S, /hat/i)?.querySelector('.steps'), title: '하이햇', body: '하이햇 줄의 1, 3, 5, 7… 칸을 한 칸씩 건너뛰며 켜 보세요. 칸을 누른 채 옆으로 드래그하면 여러 칸을 한 번에 입력할 수 있어요.',
        wait: (S) => { const c = chan(S, /hat/i); return c && notesOf(pattern(S.proj), c.id).length >= 6; } },
      { sel: () => document.querySelector('[data-tour=bpm]'), title: '빠르기 바꾸기', body: '템포(BPM)를 조절해 보세요. 80 안팎은 느긋하고, 120~130은 신나는 댄스곡 빠르기예요.',
        prep: (S) => { S.tourBpm = S.proj.bpm; }, wait: (S) => S.proj.bpm !== S.tourBpm },
      { sel: () => document.querySelector('.rack-foot .seg'), title: '세기 조절', body: '‘세기’를 누르면 칸별로 조절 막대가 나타나요. 하이햇 막대 높이를 들쭉날쭉하게 맞추면 사람이 직접 연주한 듯 자연스러워집니다. 다 봤으면 ‘스텝’으로 돌아오세요.' },
      { title: '첫 비트 완성', body: '잘하셨어요. 다음 단계에서는 피아노로 코드와 멜로디를 넣어 볼게요.', next: 'notes' },
    ],
  },
  {
    id: 'notes', name: '코드와 멜로디', steps: [
      { sel: (S) => row(S, /piano/i)?.querySelector('.cname'), title: '피아노 롤 열기', body: '피아노 줄의 이름을 누르면 오른쪽에 피아노 롤이 열립니다.',
        wait: (S) => S.tab === 'roll' && chan(S, /piano/i)?.id === S.proj.selected },
      { sel: () => document.querySelector('.st-pane.roll canvas'), title: '피아노 롤', body: '가로는 시간, 세로는 음높이를 뜻해요. 빈 곳을 누르면 음이 생기고, 누른 채 오른쪽으로 끌면 길이가 늘어나요. 오른쪽 클릭으로 지울 수 있어요.' },
      { sel: () => document.querySelector('[data-tour=scale]'), title: '스케일 정하기', body: '스케일을 선택하면 잘 어울리는 음만 밝게 표시돼요. 처음이라면 ‘C’와 ‘메이저’를 선택해 보세요. 옆의 ‘고정’을 켜두면 어울리지 않는 음은 아예 입력되지 않아요.',
        wait: (S) => !!S.proj.scale },
      { sel: () => document.querySelector('[data-tour=tool-chord]'), title: '코드 도구', body: '‘코드’ 도구를 누르면 클릭 한 번으로 화음 전체가 입력돼요. 스케일에 맞는 화음이 자동으로 골라집니다.', wait: (S) => S.roll.tool === 'chord' },
      { sel: () => document.querySelector('.st-pane.roll canvas'), title: '코드 진행 만들기', body: '마디마다 다른 높이로 코드를 하나씩 찍어 보세요. 도-라-파-솔 순서(1-6-4-5)는 수많은 팝송에서 쓰이는 코드 진행이에요.',
        wait: (S) => { const c = chan(S, /piano/i); return c && notesOf(pattern(S.proj), c.id).length >= 9; } },
      { sel: () => document.querySelector('[data-tour=tools]'), title: '도구 메뉴', body: '코드를 그대로 쓰거나, ‘도구’에서 아르페지오(한 음씩 펼치기)·스트럼(기타처럼 긁기)·휴머나이즈(사람 느낌)를 적용해 보세요. 선택한 음에만 적용되며, 아무것도 선택하지 않으면 전체에 적용돼요.' },
      { sel: () => document.querySelector('[data-tour=keys]'), title: '건반으로 연주', body: '‘건반’을 누르면 화면 하단에 건반이 나타나요. 마우스로 누르거나 키보드 A S D F… 키로 연주할 수 있어요.', wait: (S) => S.keysOpen },
      { sel: () => document.querySelector('[data-tour=rec]'), title: '연주를 녹음하기', body: '녹음(●)을 켜고 재생하면서 건반을 치면 연주한 그대로 패턴에 기록돼요. 박자에서 살짝 벗어나도 스냅에 맞춰 정렬됩니다.' },
      { title: '멜로디까지 완성', body: '이제 마지막 단계예요. 패턴을 배치해 하나의 곡으로 완성하고 소리를 다듬어 볼게요.', next: 'song' },
    ],
  },
  {
    id: 'song', name: '곡으로 엮고 다듬기', steps: [
      { sel: () => document.querySelector('[data-tab=playlist]'), title: '플레이리스트', body: '‘플레이리스트’ 탭을 누르세요. 여기서 패턴들을 시간 순서대로 늘어놓으며 곡을 만듭니다.', wait: (S) => S.tab === 'playlist' },
      { sel: () => document.querySelector('.st-pane.playlist canvas'), title: '패턴 놓기', body: '트랙의 빈 곳을 누르면 현재 패턴이 놓여요. 두 개 이상 이어 붙여 보세요. 클립을 끌어 위치를 옮기거나, 오른쪽 끝을 끌어 길이를 늘릴 수 있어요.',
        wait: (S) => S.proj.playlist.clips.length >= 2 },
      { sel: () => document.querySelector('[data-tour=mode]'), title: '곡 전체 듣기', body: '‘곡’을 누르면 패턴 하나가 아니라 플레이리스트 전체가 재생돼요.', wait: (S) => S.proj.mode === 'song' },
      { sel: () => document.querySelector('[data-tab=mixer]'), title: '믹서', body: '‘믹서’ 탭으로 이동하세요. 채널별로 음량과 좌우 균형, 이펙트를 조절할 수 있어요.', wait: (S) => S.tab === 'mixer' },
      { sel: (S) => { const c = chan(S, /piano/i); return c && document.querySelector(`.mx-strip[data-id="${c.id}"] .mx-add`); }, title: '이펙트 넣기', body: '피아노 칸의 ‘+ 이펙트’를 누르고 ‘리버브’를 선택해 보세요. 공간감이 더해져 소리가 한결 부드러워집니다.',
        wait: (S) => chan(S, /piano/i)?.fx.some((f) => f.type === 'reverb') },
      { sel: () => document.querySelector('.mx-ed'), title: '이펙트 조절', body: '하단의 노브를 위아래로 끌어 값을 조절해요. 노브를 오른쪽 클릭해 ‘자동화 클립’을 만들면 곡이 진행되는 동안 값이 자연스럽게 바뀌도록 할 수 있어요.' },
      { sel: () => document.querySelector('[data-tour=file]'), title: '저장하고 내보내기', body: '‘파일’ 메뉴에서 프로젝트를 저장하고 WAV나 MP3 파일로 내보내세요. ‘DAW로 보내기’로 다른 작곡 프로그램에 넘길 수도 있어요.' },
      { title: '수고했어요', body: '기본 과정이 모두 끝났습니다. ‘새 프로젝트’에서 케이팝·트랩·로파이 템플릿으로 시작하거나, 왼쪽 ‘브라우저’에서 샘플을 불러와 보세요. 튜토리얼은 위쪽 ‘튜토리얼’ 버튼으로 언제든 다시 볼 수 있어요.' },
    ],
  },
];

export class Tour {
  constructor(studio) {
    this.S = studio;
    this.ch = null;
    this.i = 0;
    this.spot = h('div', { class: 'tour-spot', hidden: true });
    this.tip = h('div', { class: 'tour-tip', hidden: true });
    document.body.append(this.spot, this.tip);
    window.addEventListener('resize', () => this.place());
  }

  get active() { return !!this.ch; }

  start(id = 'beat') {
    this.ch = CHAPTERS.find((c) => c.id === id) || CHAPTERS[0];
    this.go(0);
  }

  stop() {
    this.ch = null;
    clearInterval(this.poll);
    this.spot.hidden = this.tip.hidden = true;
    this.S.app.settings.set({ studioTourSeen: true });
  }

  go(i) {
    clearInterval(this.poll);
    clearTimeout(this.auto);
    this.i = i;
    const st = this.ch.steps[i];
    if (!st) return this.stop();
    st.prep?.(this.S);
    this.done = false;
    this.render();
    // wait for the user to do it, then move on
    if (st.wait) this.poll = setInterval(() => {
      if (!this.ch || this.done) return;
      this.place();
      if (st.wait(this.S)) {
        this.done = true;
        clearInterval(this.poll);
        this.render();
        this.auto = setTimeout(() => this.go(this.i + 1), 900);
      }
    }, 250);
    else this.poll = setInterval(() => this.place(), 400);
  }

  render() {
    const st = this.ch.steps[this.i], n = this.ch.steps.length;
    const next = st.next ? CHAPTERS.find((c) => c.id === st.next) : null;
    this.tip.replaceChildren(
      h('div', { class: 'tt-head' }, h('small', {}, `${this.ch.name} · ${this.i + 1} / ${n}`), h('button', { class: 'x', title: '투어 끝내기', onclick: () => this.stop() })),
      h('b', {}, st.title),
      h('p', {}, st.body),
      st.wait ? h('p', { class: `tt-do${this.done ? ' ok' : ''}` }, this.done ? '잘했어요!' : '직접 해 보세요. 하면 자동으로 넘어가요.') : null,
      h('div', { class: 'row' },
        this.i > 0 ? h('button', { class: 'btn sm ghost', onclick: () => this.go(this.i - 1) }, '이전') : null,
        h('span', { class: 'sp' }),
        next ? h('button', { class: 'btn sm primary', onclick: () => this.start(next.id) }, `다음 장: ${next.name}`)
          : h('button', { class: `btn sm ${st.wait && !this.done ? 'ghost' : 'primary'}`, onclick: () => this.go(this.i + 1) }, st.wait && !this.done ? '건너뛰기' : this.i === n - 1 ? '끝내기' : '다음')));
    this.tip.hidden = false;
    this.place();
  }

  place() {
    if (!this.ch) return;
    const st = this.ch.steps[this.i];
    const el = st?.sel?.(this.S);
    const tip = this.tip, W = innerWidth, H = innerHeight;
    if (!el || !el.getBoundingClientRect().width) {
      this.spot.hidden = true;
      tip.classList.add('center');
      tip.style.left = `${(W - tip.offsetWidth) / 2}px`; tip.style.top = `${H * 0.28}px`;
      return;
    }
    tip.classList.remove('center');
    const r = el.getBoundingClientRect(), pad = 6;
    Object.assign(this.spot.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
    this.spot.hidden = false;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let x = r.right + 14, y = r.top;
    if (x + tw > W - 10) { x = r.left - tw - 14; }
    if (x < 10) { x = Math.min(W - tw - 10, Math.max(10, r.left)); y = r.bottom + 14; if (y + th > H - 10) y = r.top - th - 14; }
    tip.style.left = `${Math.max(10, x)}px`;
    tip.style.top = `${Math.max(10, Math.min(H - th - 10, y))}px`;
  }
}
