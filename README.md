# MeloFi

컴퓨터 키보드로 연주하는 Electron 기반 가상 피아노 앱입니다. 악보 재생, 고화질 영상 내보내기, 패턴 기반 작곡 스튜디오까지 한 앱에서 다룹니다.

---

## ⬇️ 다운로드

[Releases](https://github.com/mikatz1/MeloFi/releases)에서 `MeloFi-Setup-<버전>.exe`를 받아 실행하세요. (Windows 10/11, 64비트)

> 코드 서명이 없어 처음 실행할 때 SmartScreen 경고가 뜰 수 있습니다. **추가 정보 → 실행**을 누르면 됩니다.

---

## 🚀 빠른 시작 (소스에서 실행)

```bash
# 설치 및 실행
npm install
npm start

# Windows 설치 파일 빌드 (dist/MeloFi Setup <버전>.exe 생성)
npm run dist
```

---

## 🎹 악기 구성 및 다운로드

앱에는 기본 피아노(**Splendid Grand**) 하나가 포함되어 있으며, 나머지는 **사운드 > 악기** 또는 **설정 > 사운드** 메뉴에서 다운로드할 수 있습니다.
원작자의 GitHub 저장소에서 필요한 샘플만 내려받으며(사용자 데이터 폴더의 `instruments/`), 네트워크가 끊겨도 이어서 받습니다.

| 분류 | 악기명 |
| --- | --- |
| **피아노** | Splendid Grand (기본), Salamander, Maestro, Headroom, jRhodes3d, Scarypiano |
| **건반** | Wurlitzer EP200, 하프시코드 |
| **오르간** | 파이프 오르간 |
| **신디사이저** | TX81Z Clavisynth, 리드, 패드, 신디 베이스, 신디 브라스, 플럭, 오타마톤 |
| **현악기** | 콘서트 하프, 첼로 |
| **관악기** | 테너 색소폰, 알토 리코더, 하모니카 |
| **기타** | 어쿠스틱(Shinyguitar), 일렉(Green Guitar) |
| **베이스** | 일렉(Growlybass), 콘트라베이스 피치카토 |
| **말렛 타악기** | 비브라폰, 마림바, 글로켄슈필, 실로폰 |
| **드럼** | 드럼 머신 808·909 계열, 어쿠스틱 드럼(Sam's Sonor Kit) |

신디사이저 6종과 드럼 머신 2종은 MeloFi가 자체 패치로 직접 합성하므로 내려받을 파일이 없고, 설치하는 순간 바로 만들어집니다. 모든 악기는 음높이 검사(`tools/check-pitch.mjs`)를 거쳤습니다.

--- | --- |
| **피아노** | Splendid Grand (기본), Salamander, Maestro, Headroom, jRhodes3d, Scarypiano |
| **건반** | Wurlitzer EP200, 하프시코드 |
| **신디사이저** | TX81Z Clavisynth |
| **현악기** | 콘서트 하프 |
| **기타** | 어쿠스틱(Shinyguitar), 일렉(Green Guitar) |
| **베이스** | 일렉(Growlybass), 콘트라베이스 피치카토 |

---

## 🔊 소리 처리 엔진

- **고품질 피치 변환**: Chromium 기본 선형 보간 대신 32탭 Kaiser windowed-sinc 보간(`renderer/js/sampler-worklet.js`)을 사용합니다. 원음과 같은 음높이는 보간 없이 그대로 출력됩니다.
- **무손실 음원**: 모든 샘플을 FLAC 원본 길이 그대로 사용합니다.
- **메모리 최적화**: 현재 타건 세기에 해당하는 벨로시티 레이어만 메모리에 올립니다. (MIDI 건반 연결 시 전 구간 로드)
- **공명 효과**: 댐퍼 페달(Space)을 밟으면 88현 공명 IR을 통과한 소리가 섞입니다. (믹서 > 페달 공명)

---

## ⌨️ 건반 조작법

| 키 | 동작 |
| --- | --- |
| **A S D F G H J K L ; '** | 흰 건반 (`W E T Y U O P`는 검은 건반) |
| **Z / X** (누른 채) | 한 옥타브 아래 / 위 |
| **← → / ↑ ↓** | 반음 이동 / 옥타브 이동 |
| **1 ~ 9** | 터치 세기 조절 |
| **Space** | 댐퍼 페달 |
| **왼쪽 Ctrl** | 소스테누토 페달 (누르는 순간 잡고 있던 음만 유지) |
| **왼쪽 Shift** | 소프트 페달 |
| **F1 ~ F10** | 도움말, 녹화, 키 매핑, 믹서, 전체 화면, 메트로놈, 페달 고정, 악보 재생/정지, 설정 |
| **F12** | 작곡 스튜디오 열기 / 닫기 |

> 💡 MIDI 건반의 CC64(댐퍼), CC66(소스테누토), CC67(소프트) 페달을 지원합니다.

---

## 🎼 악보 기능

### 악보 불러오기 & 연주

- **지원 포맷**: MuseScore(`.mscz`, `.mscx`), MusicXML(`.mxl`, `.musicxml`), MIDI(`.mid`) — 창에 끌어다 놓기 지원
- **자동 분석**: 피아노 파트를 찾아 오른손/왼손으로 나누고 반복, 도돌이표, 붙임줄, 잇단음표, 템포, 셈여림, 페달을 반영합니다.
- **정확한 박자**: 샘플러 안에서 샘플 단위로 예약되어 재생 박자가 흔들리지 않습니다. 추출한 파트는 MIDI 파일로 저장할 수 있습니다.
- **보기 옵션**: 노트가 위에서 내려오는 모드, 오른손/왼손 색 지정, 처음 재생할 때 곡 제목·작곡가 타이틀 카드, 최근 연 악보 목록

### 고화질 영상 내보내기

**녹화 > 고화질 영상 내보내기** (4K / 1440p / 1080p, 30 / 60fps)

- 실시간 녹화가 아니라 소리는 OfflineAudioContext에서, 화면은 한 프레임씩 렌더링하여 WebCodecs(H.264 + AAC)로 MP4를 만듭니다.
- 음이 아무리 많은 곡도 끊기거나 밀리지 않습니다.

---

## 🎛️ 작곡 스튜디오 (F12)

FL Studio처럼 **패턴을 만들고 플레이리스트에 배치해 곡을 쌓는** 작곡 화면입니다. 상단의 **MeloFi Studio 열기** 버튼이나 F12를 누르면 피아노와 별도의 창으로 열립니다. 두 창의 설정은 함께 저장되고, MIDI 건반은 마지막으로 쓴 창에서 연주됩니다. 단축키와 도구는 FL Studio와 같고, 처음 열면 FL Studio 공식 강좌(Learn FL Studio)와 같은 순서의 **13강 투어**(F1)가 화면을 하나씩 짚어 가며 안내합니다. 화면 건반(Ctrl+Shift+K)과 악기 선택(F8)은 별도 창으로 뜹니다. FL Studio와의 흐름·단축키·화면 유사도 측정은 [`docs/fl-workflow-comparison.md`](docs/fl-workflow-comparison.md), 기능 비교는 [`docs/fl-comparison.md`](docs/fl-comparison.md), 설계 문서는 [`docs/studio.md`](docs/studio.md)에 있습니다.

**시작하기**
- 템플릿: 빈 프로젝트, 기본 비트, 케이팝 댄스, 힙합·트랩, 로파이, 발라드, 시티팝
- 화면 건반(마우스·PC 키보드·MIDI), 하단 힌트 바, 최근 프로젝트, 5분마다 자동 저장 기록

**리듬 (채널 랙)**
- 스텝 시퀀서, 스텝 그래프(세기·팬·피치), 2·4·8칸 채우기, 무작위 리듬
- 채널별 스윙·그루브 템플릿, 스텝 반복 길이(폴리리듬), 채널 아르페지에이터
- 채널 종류: 악기, 편집 신스(프리셋 13개), 샘플(원샷), 슬라이서(루프 자르기), 오디오 트랙, VST3 악기, 보컬

**멜로디·화음 (피아노 롤)**
- 스케일 표시와 고정, 코드 도구(스케일 화음 자동), 슬라이드 노트(글라이드)
- 아르페지오, 스트럼, 휴머나이즈, 퀀타이즈(강도·길이), 레가토, 노트 자르기·붙이기, 뒤집기
- 노트별 세기·팬·미세 피치, 녹음 전 1마디 카운트인, 방금 연주한 것 패턴에 넣기, 탭 템포

**곡 구성 (플레이리스트)**
- 패턴·오디오·자동화 클립, 자르기 도구, 고유 패턴으로 만들기, 트랙 이름·음소거·솔로
- 오디오 클립: 프로젝트 템포에 맞추기(피치 유지 타임 스트레치), 페이드, 게인, 노멀라이즈·거꾸로·무음 자르기
- 마커, 반복 구간, 마디 단위 템포 변화, 라이브 모드(트랙×패턴 그리드)
- 마이크 녹음, 샘플 브라우저(내 폴더에서 끌어다 놓기)

**믹싱·마스터링**
- 채널·버스·마스터 이펙트 체인: EQ, 컴프레서, 필터, 디스토션, 코러스, 딜레이, 리버브, 스테레오 폭, 사이드체인, 리미터
- 이펙트 프리셋(보컬 리버브, 킥 펀치, 로파이, 808 진하게, 마스터 기본…)
- 모든 노브를 우클릭해 자동화 클립을 만들거나 MIDI 컨트롤러에 연결
- 마스터 라우드니스(LUFS)와 스펙트럼

**AI·보컬·플러그인**
- AI로 음원 분리 · MIDI 변환: WAV·MP3·MP4 등을 이 PC의 오픈소스 모델로 악기별(보컬·코러스·드럼·베이스·기타·피아노·나머지)로 나누고 박자·템포·음표를 읽습니다. 분리한 트랙으로 프로젝트를 만들거나, 구간마다 알아본 악기 후보 중에서 골라 MIDI로 바꿀 수 있습니다.
- 보컬 채널: 멜로디에 가사(히라가나·가타카나)를 붙여 NNSVS 오픈소스 가창 합성기로 부르게 하고, 결과를 오디오 트랙으로 올립니다. 엔진은 앱에서 설치 (Python 3.10~3.12, Microsoft C++ Build Tools 필요), 보이스 모델은 처음 부를 때 받습니다.
- VST3 악기: 설치된 VST3 플러그인을 채널로 불러와 플러그인 창으로 편집합니다. 실시간 재생은 MeloFi VST Host(JUCE 보조 프로그램)가 직접 소리를 내고, 내보내기·굳히기는 오프라인으로 정확히 렌더해 믹서를 거칩니다. 빌드: `native/vsthost` (CMake + Visual Studio Build Tools).

**내보내기·연동**
- WAV(24·16비트)·MP3, 반복 구간만, 떨어지는 노트 영상(실제 믹스 소리), 오디오로 굳히기
- MIDI 가져오기·내보내기, DAW로 보내기(스템·믹스·MIDI·REAPER 프로젝트, MIDI 클럭 출력)
- MeloFi 계정으로 온라인 저장·공유 (서버는 `npm run server`, [`server/`](server))
- 단축키 설정

---

## 🎨 화면

- **테마 12종**: Midnight, Ember, 벚꽃, Aurora, 첫눈, 먹(번지는 먹물), 아케이드(8비트), 신스웨이브, 심해, 우주, 고대비, Mono — 테마마다 건반 디자인과 파티클이 함께 바뀝니다. 배경 이미지에서 색을 뽑아 만드는 커스텀 테마도 있습니다.
- **배경 이미지**: 직접 고른 이미지 또는 코드로 그린 샘플 배경 5종(저녁 산, 밤의 도시, 성운, 안개 숲, 노을 바다 · 모두 CC0)
- **오디오 스펙트럼**: 배경에 주파수 막대를 깔 수 있습니다. 모양(막대·블록·점·좌우 대칭), 위치, 막대 수, 높이, 색, 불투명도, 부드러움, 최고점 표시를 고를 수 있고 내보낸 영상에도 그려집니다.
- **시각 효과**: 저음에 맞춰 배경이 일렁이고 건반에 빛이 비칩니다. 노트가 내려오는 모드에서는 충격파, 페달 빛기둥, 큰 화음 플래시가 더해집니다.
- **방송 모드**: 디스코드 등 화면 공유에 맞게 파티클을 줄이고 노트를 두껍게 그립니다. 창 크기를 1280×720 / 1600×900 / 1920×1080 또는 직접 입력한 크기로 맞출 수 있습니다.
- **녹화**: MP4, MP3, WAV, MIDI, FL Studio용(MIDI + WAV)

---

## 🧭 메뉴 구성

| 메뉴 | 들어 있는 기능 |
| --- | --- |
| **파일** | 악보 열기, 최근 악보, 새 작곡 프로젝트, 작곡 프로젝트 열기, 녹화 폴더 열기, 종료 |
| **악보** | 재생/일시정지, 처음으로, 파트 선택, 떨어지는 노트 효과, 손별 색 구분, 타이틀 카드, MIDI로 저장 |
| **작곡** | 작곡 스튜디오, 새로 만들기/열기/저장, MIDI 가져오기·내보내기, WAV 내보내기 |
| **녹화** | 녹화 시작/정지, 녹화 형식, 영상 해상도, 고화질 영상 내보내기, 저장 위치 |
| **사운드** | 악기(다운로드 포함), 타건 세기, 페달 고정·방식, 메트로놈, 템포, 박자, MIDI 건반, 사운드 믹서 |
| **화면** | 전체화면, 방송 모드, 창 크기, 테마, 배경 이미지, 오디오 스펙트럼, 노트 색·굵기, 파티클, 비주얼라이저, 건반 표시·확대, GPU 가속 |
| **설정** | 설정, 키 매핑, 키 배치, 도움말 |

---

## 🛠️ 개발 및 음원 빌드

### 음원 생성 (ffmpeg 필요)

```bash
# 전체 음원 재생성
npm run build:instruments

# 특정 악기만 재생성
node tools/build-instruments.mjs harp

# 음높이 검증
node tools/check-pitch.mjs <id>
```

필요한 샘플을 GitHub에서 `instruments/_dl/`로 받아(`tools/fetch-lib.mjs`) 무손실 FLAC으로 옮기고 매핑을 `manifest.json`으로 만듭니다. VCSL처럼 SFZ가 없는 라이브러리는 파일 이름에서 매핑을 만듭니다(`tools/vcsl-map.mjs`).

### 테스트

```bash
node tools/test-repeats.mjs    # 반복·도돌이표 재생 순서 (MuseScore 테스트 69개)
node tools/test-playback.mjs   # 템포·셈여림·트레몰로
node tools/test-musicxml.mjs   # MusicXML 읽기 비교
```

### 아이콘 재생성

`renderer/assets/icon.svg` 수정 후 실행:

```bash
npx electron tools/make-icon.js
```

---

## 📜 음원 출처 및 라이선스

| 악기 | 원작자 | 라이선스 |
| --- | --- | --- |
| Splendid Grand (Steinway) | AKAI, SFZ: kinwie | Public Domain |
| Salamander Grand (Yamaha C5) | Alexander Holm | CC BY 3.0 |
| Maestro Concert Grand (Yamaha CF-3) | Mats Helgesson | 작가 허락 하에 무료 배포 |
| Headroom Piano (Yamaha C3) | Bengt Nilsson | CC BY 4.0 |
| jRhodes3d (Rhodes Mark I) | Jeff Learman | 샘플 CC BY-NC 4.0 (비상업) |
| Scarypiano | Karoryfer Samples | CC0 |
| Wurlitzer EP200 | Greg Sullivan, SFZ: kinwie | CC BY 3.0 |
| Harpsichord, TX81Z Clavisynth, Concert Harp | Versilian Studios ([VCSL](https://github.com/sgossner/VCSL)) | CC0 |
| Shinyguitar, Black And Green Guitars, Growlybass | Karoryfer Samples | CC0 |
| Double Bass (pizzicato) | D. Smolken | CC0 |
| Pipe Organ, Tenor Saxophone, Alto Recorder, Harmonica, Vibraphone, Marimba, Glockenspiel, Xylophone | Versilian Studios ([VCSL](https://github.com/sgossner/VCSL)) | CC0 |
| Cello | Karoryfer Samples & Bigcat Instruments | CC0 |
| Sam's Sonor Kit (어쿠스틱 드럼) | Sam Greene, SFZ: kinwie | CC BY-SA 4.0 |
| 신디사이저 6종, 드럼 머신 808·909 계열 | MeloFi 자체 합성 | CC0 |

- VCSL을 제외한 SFZ 매핑은 [sfzinstruments](https://github.com/sfzinstruments) 저장소의 리소스를 활용했습니다.
- 테스트용 악보는 MuseScore 테스트 모음에서 가져왔습니다(`tools/fixtures/README.md`, GPL-3.0).
