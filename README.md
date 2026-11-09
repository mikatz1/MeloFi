# MeloFi

컴퓨터 키보드로 치는 가상 피아노. Electron 앱.

## 실행

```
npm install
npm start
```

## 음원 다시 만들기

`instruments/<id>/` 안의 음원은 `instruments/_dl/`에 받아 둔 SFZ 원본에서 만든다.
원본 FLAC을 그대로 복사하고(무손실, 길이 그대로), SFZ 매핑만 `manifest.json`으로 옮긴다. ffmpeg가 PATH에 있어야 한다.

```
npm run build:instruments
```

`_dl/`은 다시 빌드할 때만 필요하다. 지워도 앱은 돌아간다.

## 소리 처리

- 피치 변환은 Chromium 기본(선형 보간) 대신 `renderer/js/sampler-worklet.js`의 32탭 Kaiser windowed-sinc 보간. 샘플 원음 높이와 같은 건반은 보간 없이 그대로 재생.
- 메모리에는 현재 타건 세기에 쓰는 벨로시티 레이어만 올린다(MIDI 건반이 연결되면 전 구간에 고르게).
- 댐퍼 페달(Space)을 밟으면 88현 공명 IR을 통과한 소리가 섞인다(믹서 > 페달 공명).

## 악보 불러오기

파일 > 악보 열기, 또는 창에 끌어다 놓기. `.mscz` `.mscx`(MuseScore), `.mxl` `.musicxml`(MusicXML), `.mid`.
피아노 파트를 찾아 오른손/왼손 줄로 나누고, 반복·도돌이 괄호·붙임줄·잇단음표·템포·셈여림·페달을 반영한다.
재생은 샘플러 안에서 샘플 단위로 예약되므로 박자가 흔들리지 않는다. 추출한 파트는 MIDI로 저장할 수 있다.

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

SFZ 매핑은 모두 [sfzinstruments](https://github.com/sfzinstruments) 저장소에서 받았다.
