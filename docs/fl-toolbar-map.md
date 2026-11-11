# Studio top toolbar: FL Studio 2025 vs MeloFi, one to one

Sources (read 2026-11-12, Image-Line FL Studio online manual; the pages are not version-stamped):
- https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/toolbar_panels.htm
- …/html/menu_file.htm, menu_edit.htm, menu_add.htm, menu_patterns.htm, menu_view.htm, menu_options.htm, menu_tools.htm, menu_help.htm

What the manual states vs. what is from the default screen layout:
- Stated: the panel set (menu bar, title + hint bar, transport & recording, song position, window shortcut icons,
  monitor volume & pitch, global snap, pattern selector, time panel, output, CPU & memory, online news), the menu
  contents, F-keys (F5 playlist, F6 channel rack, F7 piano roll, F8 plugin picker, F9 mixer, Alt+F8 browser,
  F1 help), that the tempo display's right-click menu has Tap, and that panels can be reordered in toolbar edit mode.
- Not stated as an order on the page: the left-to-right placement. The order below is FL's default layout on screen
  (menu + hint at the far left, transport in the middle, shortcut icons to the right, output / master at the end).

## Left to right

| # | FL Studio 2025 | MeloFi before | MeloFi now |
|---|----------------|---------------|------------|
| 1 | Menu bar: FILE EDIT ADD PATTERNS VIEW OPTIONS TOOLS HELP | only `파일 ▾`, `창 ▾`, `튜토리얼` buttons at the right end | menu bar at the far left: 파일 편집 추가 패턴 보기 옵션 도구 도움말 (hover moves between open menus, like a native menu bar) |
| 2 | Title + hint bar under the menu (project name, hint for the control under the mouse) | project name field at the left; hint text in the footer | second line under the menu: project name field + hint text (the footer keeps the status line) |
| 3 | PAT / SONG switch | `PAT SONG 라이브` segment after the name | PAT / SONG stacked like FL, 라이브 under them |
| 4 | Play / Stop / Record | ▶ ■ ● | same, right after PAT/SONG |
| 5 | Tempo display (right-click: Tap, nudge, half speed) | `BPM` field + `탭` button | tempo LCD + small 탭; right-click opens 탭 / ½ / ×2 / 박자표 |
| 6 | Song position (time panel, B:S:T or m:s) | `1:1:1` box | position LCD with `마디:박:스텝` caption |
| 7 | Recording switches (metronome, countdown before recording, …) | `마이크`, `메트로놈` buttons | 메트로놈, 카운트 (녹음 전 1마디), 마이크 녹음, 화면 건반 as one recording group |
| 8 | Pattern selector (F4 next empty, F2 rename) | pattern `<select>` | pattern selector, same place after the recording group |
| 9 | Global snap | `스냅` select | snap select after the pattern selector |
| — | (swing lives in the channel rack in FL) | `스윙` slider in the toolbar | 스윙 moves to the channel rack header (pattern bar), like FL's rack swing |
| — | (time signature: PATTERNS > Set time signature) | `박자` select in the toolbar | 패턴 메뉴 > 박자 (4/4 3/4 6/8 5/4 7/8) and the tempo right-click menu |
| — | (undo / redo: EDIT menu, Ctrl+Z / Ctrl+Y) | ↶ ↷ buttons | 편집 메뉴: 실행 취소, 다시 실행, 실행 기록… (keys unchanged) |
| 10 | CPU & memory panel | — | not added (MeloFi has no reliable CPU figure to show) |
| 11 | Window shortcut icons: playlist F5, piano roll F7, channel rack F6, mixer F9, browser Alt+F8, plugin picker F8 | tabs in the right pane; `F5 / F6 …` listed in the footer | icon buttons in FL's order: 플레이리스트 F5, 피아노 롤 F7, 채널 랙 F6, 믹서 F9, 브라우저 Alt+F8, 플러그인 피커 F8, then 라이브 Ctrl+F8 (MeloFi's own) |
| 12 | Monitor volume + master pitch | master volume only in the mixer | master volume slider at the right end (same value as the mixer's master fader). MeloFi has no master pitch: not added |
| 13 | Output panel (oscilloscope / peak meter) | meters only in the mixer | stereo-sum peak meter next to the master volume |
| 14 | Online news | — | not added (MeloFi has no news feed) |

## Menus (FL item → MeloFi command it maps to)

- **파일** (FILE): 새 프로젝트 (템플릿)… · Loop Starter… · 열기… Ctrl+O · 최근 프로젝트 · 자동 저장 기록… · 저장 Ctrl+S ·
  다른 이름으로 저장… Ctrl+Shift+S · ─ · 가져오기: MIDI 가져오기…, AI로 음원 분리 · MIDI 변환… · ─ · 내보내기: 오디오 (WAV·FLAC·MP3·OGG)…,
  MIDI Ctrl+Shift+M, 영상…, DAW로 보내기 (스템) · 마스터링… Ctrl+Shift+B · ─ · 클라우드 항목 3개.
- **편집** (EDIT): 실행 취소 Ctrl+Z · 다시 실행 Ctrl+Y · 실행 기록…
- **추가** (ADD): 채널 (플러그인 피커) F8 · 샘플 채널 (오디오 파일)… · 오디오 클립… · 오토메이션 클립… · 패턴 F4 · 플레이리스트 트랙.
- **패턴** (PATTERNS): 새 패턴 F4 · 이름 바꾸기 F2 · 복제 · 삭제 · 채널별로 패턴 나누기 · 박자 (4/4 …).
- **보기** (VIEW): 창: 플레이리스트 F5, 피아노 롤 F7, 채널 랙 F6, 믹서 F9, 브라우저 Alt+F8, 라이브 Ctrl+F8, 화면 건반 Ctrl+Shift+K ·
  창 배치 (각 창 떼어내기 / 붙이기, 모두 떼어내기, 모두 붙이기) · 화면 꾸미기…
- **옵션** (OPTIONS): 메트로놈 Ctrl+M · 녹음 전 카운트 Ctrl+P · 반복 구간 Ctrl+Shift+L · 단축키 설정…
- **도구** (TOOLS): Riff Machine… · Randomize… Alt+R · 퀀타이즈… Alt+Q · 방금 연주한 것 패턴에 넣기 (FL: Score logger) ·
  마이크 녹음 (FL: One-click audio recording) · 피아노 롤 도구 전체 (아르페지오, 스트럼, Humanize …).
- **도움말** (HELP): 튜토리얼 13개 강의 (F1 = 첫 강의) · 단축키 목록.

Every command that was on the old toolbar is either still on the toolbar or in the menu named above, and every
keyboard shortcut is unchanged. The right-pane tabs (피아노 롤 / 플레이리스트 / 믹서 / 라이브) stay as they were.
