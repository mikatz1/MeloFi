```markdown
# MeloFi

컴퓨터 키보드로 연주하는 Electron 기반 가상 피아노 앱입니다.

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

> 💡 MIDI 건반의 CC64(댐퍼), CC66(소스테누토), CC67(소프트) 페달을 지원합니다.

---

## 🎼 악보 기능 및 연습

### 악보 불러오기 & 연주

- **지원 포맷**: MuseScore(`.mscz`, `.mscx`), MusicXML(`.mxl`, `.musicxml`), MIDI(`.mid`) — 창에 끌어다 놓기 지원
- **자동 분석**: 피아노 파트를 찾아 오른손/왼손으로 나누고 반복, 도돌이표, 붙임줄, 잇단음표, 템포, 셈여림, 페달을 반영합니다.
- **정확한 박자**: 샘플러 안에서 샘플 단위로 예약되어 재생 박자가 흔들리지 않습니다. 추출한 파트는 MIDI 파일로 저장할 수 있습니다.
- **보기 옵션**: 노트가 위에서 내려오는 모드, 오른손/왼손 색 지정, 처음 재생할 때 곡 제목·작곡가 타이틀 카드, 최근 연 악보 목록

### 연습 모드

악보 막대의 **연습** 버튼으로 시작합니다.

- 고른 손(오른손/왼손/양손)은 직접 치고, 나머지는 자동으로 연주됩니다.
- 맞는 건반을 맞는 타이밍에 쳐야 판정됩니다: PERFECT(±50ms), GREAT(±100ms), GOOD(±150ms), MISS
- 정확도에 따라 S, A, B, C, D, F 등급이 매겨집니다.

### 고화질 영상 내보내기

**파일 > 고화질 영상 내보내기** (4K / 1440p / 1080p, 30 / 60fps)

- 실시간 녹화가 아니라 소리는 OfflineAudioContext에서, 화면은 한 프레임씩 렌더링하여 WebCodecs(H.264 + AAC)로 MP4를 만듭니다.
- 음이 아무리 많은 곡도 끊기거나 밀리지 않습니다.

---

## 🎨 화면

- **테마 8종**: Midnight, Ember, 벚꽃, Aurora, 첫눈, 먹(번지는 먹물), 아케이드(8비트), Mono — 배경 이미지에서 색을 뽑아 만드는 커스텀 테마도 있습니다.
- **시각 효과**: 저음에 맞춰 배경이 일렁이고 건반에 빛이 비칩니다. 노트가 내려오는 모드에서는 충격파, 페달 빛기둥, 큰 화음 플래시가 더해집니다.
- **방송 모드**: 디스코드 등 화면 공유에 맞게 파티클을 줄이고 노트를 두껍게 그립니다. 창 크기를 1280×720 / 1600×900 / 1920×1080 또는 직접 입력한 크기로 맞출 수 있습니다.
- **녹화**: MP4, MP3, WAV, MIDI, FL Studio용(MIDI + WAV)

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
| Maestro Concert Grand (Yamaha CF-3) | Mats Helgesson | 자유 배포 |
| Headroom Piano (Yamaha C3) | Bengt Nilsson | CC BY 4.0 |
| jRhodes3d (Rhodes Mark I) | Jeff Learman | CC BY-NC 4.0 |
| Scarypiano | Karoryfer Samples | CC0 |
| Wurlitzer EP200 | Greg Sullivan, SFZ: kinwie | CC BY 3.0 |
| Harpsichord, TX81Z Clavisynth, Concert Harp | Versilian Studios ([VCSL](https://github.com/sgossner/VCSL)) | CC0 |
| Shinyguitar, Black And Green Guitars, Growlybass | Karoryfer Samples | CC0 |
| Double Bass (pizzicato) | D. Smolken | CC0 |

- VCSL을 제외한 SFZ 매핑은 [sfzinstruments](https://github.com/sfzinstruments) 저장소의 리소스를 활용했습니다.
- 테스트용 악보는 MuseScore 테스트 모음에서 가져왔습니다(`tools/fixtures/README.md`, GPL-3.0).
