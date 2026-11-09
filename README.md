# MeloFi

컴퓨터 키보드로 치는 가상 피아노. Electron 앱.

## 실행

```
npm install
npm start
```

설치 파일(Windows): `npm run dist` → `dist/MeloFi Setup <버전>.exe`

## 악기

앱에는 기본 피아노(Splendid Grand) 하나만 들어 있다. 나머지는 사운드 > 악기 또는 설정 > 사운드에서 **다운로드**를 누르면
원작자의 GitHub 저장소에서 필요한 샘플만 바로 내려받는다(사용자 데이터 폴더의 `instruments/`). 받다가 끊겨도 이어서 받는다.

| 분류 | 악기 |
|---|---|
| 피아노 | Splendid Grand(기본), Salamander, Maestro, Headroom, jRhodes3d, Scarypiano |
| 건반 | Wurlitzer EP200, 하프시코드 |
| 신디사이저 | TX81Z Clavisynth |
| 현악기 | 콘서트 하프 |
| 기타 | 어쿠스틱(Shinyguitar), 일렉(Green Guitar) |
| 베이스 | 일렉(Growlybass), 콘트라베이스 피치카토 |

`manifest.json`에는 매핑과 함께 샘플마다 원본 저장소의 경로(`source`)가 적혀 있다.

### 음원 다시 만들기

```
npm run build:instruments            # 전부
node tools/build-instruments.mjs harp  # 하나만
```

필요한 샘플을 GitHub에서 `instruments/_dl/`로 받아(`tools/fetch-lib.mjs`) 무손실 FLAC으로 옮기고 매핑을 `manifest.json`으로 만든다. ffmpeg가 PATH에 있어야 한다.
VCSL처럼 SFZ가 없는 라이브러리는 파일 이름에서 매핑을 만든다(`tools/vcsl-map.mjs`). 새로 만든 매핑은 `node tools/check-pitch.mjs <id>`로 음높이를 확인한다.

## 소리 처리

- 피치 변환은 Chromium 기본(선형 보간) 대신 `renderer/js/sampler-worklet.js`의 32탭 Kaiser windowed-sinc 보간. 샘플 원음 높이와 같은 건반은 보간 없이 그대로 재생.
- 메모리에는 현재 타건 세기에 쓰는 벨로시티 레이어만 올린다(MIDI 건반이 연결되면 전 구간에 고르게).
- 댐퍼 페달(Space)을 밟으면 88현 공명 IR을 통과한 소리가 섞인다(믹서 > 페달 공명).

## 건반

| 키 | 동작 |
|---|---|
| A S D F G H J K L ; ' | 도 레 미 파 솔 라 시 도 … (W E T Y U O P는 검은 건반) |
| Z / X 누른 채 | 한 옥타브 아래 / 위 |
| ← → / ↑ ↓ | 반음 이동 / 옥타브 이동 |
| 1 – 9 | 터치 세기 |
| Space | 댐퍼 페달 |
| 왼쪽 Ctrl | 소스테누토 페달 (누를 때 잡고 있던 음만 유지) |
| 왼쪽 Shift | 소프트 페달 |
| F1 – F10 | 도움말, 녹화, 키 매핑, 믹서, 전체 화면, 메트로놈, 페달 고정, 악보 재생/정지, 설정 |

MIDI 건반의 CC64/66/67(댐퍼/소스테누토/소프트)도 받는다.

## 악보 불러오기

파일 > 악보 열기, 또는 창에 끌어다 놓기. `.mscz` `.mscx`(MuseScore), `.mxl` `.musicxml`(MusicXML), `.mid`.
피아노 파트를 찾아 오른손/왼손 줄로 나누고, 반복·도돌이 괄호·붙임줄·잇단음표·템포·셈여림·페달을 반영한다.
재생은 샘플러 안에서 샘플 단위로 예약되므로 박자가 흔들리지 않는다. 추출한 파트는 MIDI로 저장할 수 있다.

처음 재생할 때 곡 제목과 작곡가를 짧은 타이틀 카드로 보여준다(설정 > 화면 > 악보에서 끔).
설정에서 노트가 위에서 내려오게 바꿀 수 있고, 오른손/왼손 색을 고를 수 있다. 최근에 연 악보는 파일 > 최근 악보.

### 연습

악보 막대의 **연습**: 고른 손(오른손/왼손/양손)은 직접 치고 나머지는 자동으로 연주된다.
타이밍으로 PERFECT(±50ms) / GREAT(±100ms) / GOOD(±150ms) / MISS를 매기고, 정확도로 S·A·B·C·D·F 등급을 준다.
맞는 건반을 맞는 때에 쳐야 판정된다.

### 고화질 영상

파일 > 고화질 영상 내보내기(4K/1440p/1080p, 30/60fps). 실시간 녹화가 아니라 소리는 OfflineAudioContext에서,
화면은 한 프레임씩 그려 WebCodecs(H.264 + AAC)로 MP4를 만든다. 아무리 빽빽한 곡도 끊기거나 밀리지 않는다.

## 아이콘

`renderer/assets/icon.svg`가 원본. 고친 뒤 `npx electron tools/make-icon.js`로 `icon.png`/`icon.ico`를 다시 만든다.

## 음원 출처

| 악기 | 원작자 | 라이선스 |
|---|---|---|
| Splendid Grand (Steinway) | AKAI, SFZ: kinwie | Public Domain |
| Salamander Grand (Yamaha C5) | Alexander Holm | CC BY 3.0 |
| Maestro Concert Grand (Yamaha CF-3) | Mats Helgesson | 작가 허락 하에 무료 배포 |
| Headroom Piano (Yamaha C3) | Bengt Nilsson | CC BY 4.0 |
| jRhodes3d (Rhodes Mark I) | Jeff Learman | 샘플 CC BY-NC 4.0 (비상업) |
| Scarypiano | Karoryfer Samples | CC0 |

| Wurlitzer EP200 | Greg Sullivan, SFZ: kinwie | CC BY 3.0 |
| Harpsichord (French), TX81Z Clavisynth, Concert Harp | Versilian Studios ([VCSL](https://github.com/sgossner/VCSL)) | CC0 |
| Shinyguitar, Black And Green Guitars, Growlybass | Karoryfer Samples | CC0 |
| Double Bass (pizzicato) | D. Smolken | CC0 |

VCSL을 뺀 SFZ 매핑은 [sfzinstruments](https://github.com/sfzinstruments) 저장소에서 받았다. 테스트용 악보와 비교 대상은 MuseScore 테스트 모음(`tools/fixtures/README.md`).
