# 처음 설정 (first-run setup)

The first time MeloFi opens after an install, the start card shows the setup instead of the choice
between the piano and Studio. Everything important can be done there once:

| # | Step | What it does | Done when |
|---|---|---|---|
| 1 | 언어·테마·키 배치 | language (system / 한국어 / English), Studio theme dark or white (the setup itself follows it at once), key layout | 다음 |
| 2 | 마이크와 MIDI | 마이크 확인 (getUserMedia), MIDI 장치 찾기 (Web MIDI, live list) | the mic or a MIDI device works |
| 3 | 디스코드 로그인 | browser sign-in; joining the MeloFi server is part of it (account.js refuses the sign-in if joining fails); shows the server joined | signed in |
| 4 | GitHub 연결 | device code, copy-and-open, mm:ss countdown, 새 코드 받기 when it runs out | connected |
| 5 | 창작마당 프로필 | nickname checked 400 ms after typing (쓸 수 있어요 / 이미 누가 쓰고 있어요 + ideas / 운영진용), picture (the account's own, an upload made 96 px JPEG, or none), one-line intro, default visibility of uploads (link only by default), live preview card | saved |
| 6 | 추가 설치 | AI 분석 엔진 (about 5 GB, 10–30 min, 6 GB free), VB-CABLE for Discord로 연주 보내기 (1.3 MB, Windows admin prompt, donationware notice), 시작할 때 업데이트 확인 | 다음 |
| 7 | 마무리 | each step done / skipped / not done, with 지금 하기 for the others; MeloFi 시작하기 | finished |

Notifications: MeloFi sends none, so there is no notification step (the devices step says so).

## Rules

- **Skip anything.** 건너뛰기 marks a step skipped, not done. Any step in the rail can be opened directly.
- **Progress is saved after every step** in `settings.firstRun` (`{ v, at, marks: {step: 'done'|'skipped'}, finished, left }`).
  - If the app closes midway, the next launch resumes at the same step.
  - 나중에 마저 하기 sets `left`. The setup isn't forced after that, but the choice screen offers **설정 마무리하기 · n단계 남음**.
- **Existing users** have settings from before the setup existed and no `firstRun`. They are never forced; they get the same 설정 마무리하기 button.
- **Re-open it later** from:
  - 파일 › 처음 설정… in the piano window and in Studio (the menu shows how many steps are left);
  - 계정 › 처음 설정 다시 열기.
  - In those windows it opens as a sheet.
- **Steps check themselves off** when their real event happens: an account already signed in counts as done.

## Permissions on Windows

Windows does not ask per app for the microphone. One switch decides for every desktop app: Settings >
Privacy & security > Microphone > "Let desktop apps access your microphone".

- The setup tests access only when 마이크 확인 is pressed, with one line saying what the mic is for.
- When access is blocked, it says where the switch is and opens `ms-settings:privacy-microphone` (`firstrun.js`, main).
- This follows Apple's HIG (ask when the feature needs it, a specific purpose sentence) and Microsoft's guidance (link to the privacy settings page when access is denied).
- MIDI devices need no permission in Electron. The step lists them and follows devices plugged in or out.

## Profile backend

The Helper index (`helper/workshop.py`) has new endpoints:

- `GET /workshop/nick?name=`: free / taken / reserved / bad. Your own nickname counts as free.
- `GET` and `PUT /workshop/profile`.
- `GET /workshop/avatar/<public id>`: uploaded pictures. The public id is random, never the account id.

How profiles work:

- A profile belongs to the identity that likes and comments: GitHub when connected, otherwise Discord.
- Nicknames are unique after folding: case, NFKC, and `_ - .` ignored.
- Reserved words (melofi, admin, 운영자, 관리자 …) are refused.
- An uploaded picture must be a JPEG of at most 24 KB, which the app makes at 96 px.
- Works and comments show the nickname in place of the account name, and search finds nicknames.
- 기록 지우기 (forget-me) removes the profile too.

**Deploy:** these endpoints are not on the VM yet. Copy `helper/workshop.py` there again and restart.
- Until then, the app checks the nickname's format only.
- It keeps the profile in `userData/workshop-profile.json` and sends it the next time 창작마당 opens (`workshop.js`, `pushPending`).

## Where the patterns come from

| Pattern | From |
|---|---|
| Step list on the left with done / skipped / current marks, any step clickable; reopen later as a checklist with what's left | VS Code Get Started walkthroughs (steps stay checked; completion events), Notion's "Getting started" page |
| Footer: 이전, a quiet 건너뛰기, "단계 n / 7", one amber primary on the right | Discord server onboarding (Back / Skip, a step counter) |
| Nickname status line under the field, checked shortly after typing; separate "taken" and "not allowed" states; suggestions | Discord username field |
| Live preview card next to the profile form | Discord profile settings |
| Mic pre-check: one sentence naming the feature, a single button, then the Windows settings path and a button to that page | Apple HIG (permission requests), Microsoft Learn (ms-settings:privacy-microphone) |
| Downloads as rows with size, time and disk space; moving on while it installs | Steam download rows |
| Device check inside the step (does it work, which devices) | FL Studio audio settings status, Ableton's audio/MIDI preferences |
| Finish screen listing what was done and skipped, each with a way back | VS Code walkthrough, Notion getting-started checklist |

Not taken: Steam Deck's no-skip linear flow, Figma's role questions (MeloFi has nothing to tailor by role).

## Tests

```
node tools/e2e/firstrun-run.mjs     # 5 launches on scratch userData, 21 checks, screenshots in %TEMP%\melofi-firstrun-e2e\shots
node tools/test-workshop-helper.mjs # the index incl. profiles (53)
```
