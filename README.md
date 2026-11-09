```markdown
# MeloFi

컴퓨터 키보드로 연주하는 Electron 기반 가상 피아노 앱입니다.

---

## 🚀 빠른 시작

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
원작자의 GitHub 저장소에서 필요한 샘플만 내려받으며(`instruments/` 폴더), 네트워크가 끊겨도 이어서 받습니다.

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

* **고품질 피치 변환**: Chromium 기본 선형 보간 대신 32탭 Kaiser windowed-sinc 보간(`renderer/js/sampler-worklet.js`)을 사용합니다. 원음과 동일한 음높이는 보간 없이 출력됩니다.
* **메모리 최적화**: 현재 타건 세기에 해당하는 벨로시티 레이어만 메모리에 로드합니다. (MIDI 건반 연결 시 전체 구간 로드)
* **공명 효과**: 댐퍼 페달(Space) 사용 시 88현 공명 IR을 통과한 소리를 믹서로 조합합니다.

---

## ⌨️ 건반 조작법

| 키 | 동작 |
| --- | --- |
| **A S D F G H J K L ; '** | 흰 건반 (`W E T Y U O P`는 검은 건반) |
| **Z / X** (누른 채) | 한 옥타브 아래 / 위 |
| **← → / ↑ ↓** | 반음 이동 / 옥타브 이동 |
| **1 ~ 9** | 터치 세기 조절 |
| **Space** | 댐퍼 페달 |
| **왼쪽 Ctrl** | 소스테누토 페달 (누르는 시점에 잡힌 음만 유지) |
| **왼쪽 Shift** | 소프트 페달 |
| **F1 ~ F10** | 주요 메뉴 (도움말, 녹화, 키 매핑, 믹서, 메트로놈, 페달 고정, 악보 재생 등) |

> 💡 MIDI 건반의 CC64(댐퍼), CC66(소스테누토), CC67(소프트) 페달 컨트롤을 지원합니다.

---

## 🎼 악보 기능 및 연습

### 악보 불러오기 & 연주

* **지원 포맷**: MuseScore(`.mscz`, `.mscx`), MusicXML(`.mxl`, `.musicxml`), MIDI(`.mid`) (드래그 앤 드롭 지원)
* **자동 분석**: 피아노 파트를 찾아 오른손/왼손 줄로 나누며 반복, 도돌이표, 붙임줄, 잇단음표, 템포, 셈여림, 페달을 정확히 반영합니다.
* **타이머 연주**: 샘플러 내부에서 샘플 단위로 예약되어 재생 박자가 흔들리지 않습니다. 추출한 파트는 MIDI 파일로 저장 가능합니다.

### 연습 모드

악보 막대의 **연습** 버튼으로 시작합니다.

* 고른 손(오른손/왼손/양손)은 직접 치고, 나머지 손은 자동으로 연주됩니다.
* 타이밍 판정: PERFECT(±50ms), GREAT(±100ms), GOOD(±150ms), MISS
* 종합 정확도에 따라 S, A, B, C, D, F 등급이 부여됩니다.

### 고화질 영상 내보내기

파일 > 고화질 영상 내보내기(4K/1440p/1080p, 30/60fps)

* OfflineAudioContext에서 소리를 생성하고, 화면은 한 프레임씩 렌더링하여 WebCodecs(H.264 + AAC) 기반 MP4를 만듭니다.
* 아무리 음수가 많은 복잡한 곡도 렌더링 중 딜레이가 발생하지 않습니다.

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
| Harpsichord, TX81Z, Concert Harp | Versilian Studios ([VCSL](https://github.com/sgossner/VCSL)) | CC0 |
| Shinyguitar, Green Guitar, Growlybass | Karoryfer Samples | CC0 |
| Double Bass (pizzicato) | D. Smolken | CC0 |

* VCSL을 제외한 SFZ 매핑은 [sfzinstruments](https://github.com/sfzinstruments) 저장소의 리소스를 활용했습니다.

```

<ElicitationsGroup message="추가로 프로젝트 문서나 GitHub 설정에 필요한 작업이 있으신가요?">
  <Elicitation label="뱃지(Badge) 추가" query="README 상단에 빌드 상태, 라이선스, Electron 버전 뱃지를 추가해 줘."/>
  <Elicitation label="영문 README 생성" query="이 내용을 그대로 영어 README.md로 번역해 줘."/>
  <Elicitation label="기여 가이드 작성" query="GitHub 프로젝트용 CONTRIBUTING.md 가이드 작성을 도와줘."/>
</ElicitationsGroup>

```
