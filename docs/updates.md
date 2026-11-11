# 업데이트 · 오류 기록 · 문제 신고

## 새 버전 내는 법 (자동 업데이트가 찾을 수 있게)

1. `package.json`의 `version`을 올린다 (예: 0.2.3).
2. `npm run dist` → `dist/`에 세 파일이 생긴다.
   - `MeloFi-Setup-0.2.3.exe` (이름에 공백 없음: GitHub가 공백을 `.`으로 바꿔 `latest.yml`과 어긋나는 것을 막음)
   - `MeloFi-Setup-0.2.3.exe.blockmap` (차등 다운로드용)
   - `latest.yml`
3. GitHub 릴리스(mikatz1/MeloFi, pre-release 표시 그대로 가능)에 **세 파일 모두** 올린다.
   `latest.yml`이 없는 릴리스는 앱이 조용히 건너뛴다 (예전 릴리스들이 그렇다).

토큰이 있으면 `npx electron-builder --win nsis --publish always`로 바로 올려도 된다 (`GH_TOKEN` 필요).

## 앱에서

- 시작 20초 뒤, 그 뒤 4시간마다 조용히 확인. 인터넷이 없으면 아무것도 안 뜬다.
- 새 버전이 있으면 오른쪽 아래 "새 버전 0.2.3이 있어요 · 받기" → 받는 중 % → "다시 시작하면 적용돼요 · 지금 다시 시작".
  누르기 전에는 받지도, 설치하지도 않는다 (`autoDownload`, `autoInstallOnAppQuit` 모두 끔).
- 메뉴: 피아노 `설정` 메뉴 끝, Studio `파일 ▾` 끝에 `업데이트 확인` · `시작할 때 업데이트 확인` · `문제 신고…`.
- 서명: 지금은 인증서가 없어서 electron-builder가 `app-update.yml`에 `publisherName`을 쓰지 않고,
  electron-updater는 그 경우 서명 검사를 건너뛴다. 나중에 코드 서명을 붙이면 별도 설정 없이 검사가 켜진다.

## 오류 기록 (이 PC에만)

`%APPDATA%\MeloFi\logs\melofi.log` (512 KB마다 `melofi.1.log` … `melofi.3.log`로 넘김).
메인 프로세스 예외·거부된 Promise, 모든 창(피아노·Studio·시작 카드·악기 선택·화면 건반)의 오류와 `console.error`,
렌더러·GPU 프로세스 충돌. 줄마다 시각, 버전, OS, 창 이름. 같은 줄이 10초 안에 반복되면 한 번만 쓴다.

## 문제 신고

보이는 내용(설명, 시스템 정보, 최근 오류 20개)만 담긴다. 사용자 폴더 경로·사용자 이름·PC 이름·이메일·토큰 모양 문자열은 가린다.
- `파일로 저장`: `문서\MeloFi\MeloFi 문제 신고 <시각>.txt` (로그 마지막 300줄 포함), 탐색기에서 보여 줌.
- `GitHub 이슈로`: 내용이 채워진 이슈 작성 페이지를 브라우저로 연다. 올리기는 사용자가 거기서 직접 누른다.

## 테스트

```
node tools/test-app-infra.mjs     # 업데이트 흐름(가짜 updater, 네트워크 없음) + 신고 문구
node tools/test-errorlog.mjs      # 화면 없이 앱을 띄워 피아노·Studio 창 오류가 로그에 남는지
```
