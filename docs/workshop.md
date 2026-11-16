# 창작마당 (Workshop) and the account center

What people make in the piano window or in MeloFi Studio can be shared, found, played, liked,
commented on, downloaded or opened in Studio, from inside the app. This file covers the design,
where the layout patterns come from, and how to run and deploy it.

## Pieces

| Where | File | What it does |
|---|---|---|
| main | `workshop.js` | IPC `workshop`: publish/edit/delete works as gists, read the files, talk to the Helper index |
| main | `account.js` | sign-in (unchanged in kind); exports `internal` for workshop.js; test-only env overrides |
| renderer | `renderer/js/workshop-ui.js` | the 창작마당 page (browse, work, my works, upload), its player, the menu entries |
| renderer | `renderer/js/accounts-ui.js` | the account center (start card, piano window, Studio), `holdKeys` |
| Helper | `helper/workshop.py` | the index: list/search, likes, comments, reports, counts, forget-me (SQLite) |
| tests | `tools/test-workshop-helper.mjs` | the index against a fake GitHub/Discord (36 checks) |
| tests | `tools/e2e/workshop-run.mjs` + `workshop-e2e.js` | the whole thing headless in both windows and both themes (23 checks, screenshots) |

## Backend: why it is built this way

Rules it had to follow: no account server of our own (see the account notes in memory), free,
private unless the person chooses otherwise, and the VM (GCP e2-micro, 1 GB of egress a month free)
must not carry audio.

- **Files live on the author's GitHub.** A work is a gist made with the author's own token (the
  `gist` scope MeloFi already asks for): `melofi-workshop.json` (title, description, tags, genre,
  app, length, BPM, file list) plus `audio.<ext>.b64`, `song.mid.b64`, `project.melofi.json` and
  `cover.jpg.b64`. Gists hold text only, so binary files are stored as base64. All of them together
  can be up to 9 MB before base64 (a 192 kbps MP3 of about 6 minutes).
- **Reading costs nothing.** Players, covers and downloads fetch
  `gist.githubusercontent.com/<login>/<id>/raw/<file>`. That isn't the REST API, so it uses no
  API quota and needs no sign-in, and none of it passes through the VM.
- **The Helper keeps only the index**, in one SQLite file next to the bot: which public gists are
  works, plus their title, tags, genre, likes, comments, reports and play/download counts. A list
  page is about 10 KB of JSON.
  - When a work is registered (`POST /workshop/items {gist}`), the Helper reads the gist with the
    author's token. It checks that the token's owner owns the gist, that the gist is public and
    that it has a manifest. The manifest stays the source of truth: editing a work re-registers it.
- **Identity** is the existing sign-in. On every write the Helper checks the bearer token with
  GitHub or Discord, the same way `/report` already does. Publishing needs GitHub, because the files
  live there. Liking, commenting and reporting work with either account; GitHub wins when both are
  connected, so a person stays one identity. Comment lists show a display name and the service,
  never a Discord id.
- **Private by default.**
  - Nothing is public until someone uploads.
  - The upload form defaults to **링크가 있는 사람만** (link only). That makes a *secret* gist, which
    is never sent to the Helper and has no likes or comments. People open it through 링크로 열기.
  - **창작마당에 공개** makes a public gist and lists it.
  - GitHub can't change a gist's visibility later, and the form says so. To change it, delete the
    work and upload it again.
  - Online projects (the existing 내 프로젝트, secret gists) are untouched. Works are kept out of
    that list.
- **Moderation.**
  - 신고 asks for a reason: spam, copyright, offensive, personal information, broken or other.
  - Each report goes to the moderators' channel through `alert`.
  - After 3 different people report a work, it is hidden until a moderator acts. Its author still
    sees it, marked 신고로 숨겨짐.
  - `Workshop.set_hidden(id, bool)` is what a bot command calls. Restoring a work also clears its
    reports.
- **Forget me.** 계정 › 활동 기록 › 기록 지우기 (`DELETE /workshop/me`) removes the person's likes,
  comments and reports, and takes their works off the list. The gists stay on their GitHub; 내 작품 ›
  지우기 deletes those.
- **Limits** (per person per hour): 20 publishes, 200 likes, 30 comments, 10 reports. A play or
  download counts once a day per address and work.

Not done, deliberately: storing files on the VM (egress, disk), Discord-only publishing (it would need
somewhere other than GitHub to keep the files), timed comments on the waveform.

## Deploying the Helper part

Deployed on 2026-11-13 at the user's word: `workshop.py` next to `api.py` in `~/melofi-bot` on the VM,
db `workshop.sqlite`. Not yet deployed: the profile endpoints added for 처음 설정 (docs/firstrun.md);
copy `helper/workshop.py` again and restart. The original recipe:


1. Copy `helper/workshop.py` next to `api.py` on the VM (`melofi-bot/`).
2. In `api.py` `HelperApi.start()`, after the routes:
   ```python
   from workshop import Workshop
   self.workshop = Workshop(os.getenv("WORKSHOP_DB", "workshop.sqlite"), self.http, who=self.who,
                            alert=lambda title, text: self.alert(self.guild(), title, None, None, text, []))
   app.add_routes(self.workshop.routes())
   ```
   (`alert` must be an `async (title, text)`. Wrap `send_alert` in the shape that bot.py uses.)
   `who()` for GitHub returns the login as `name`; that is what comments show.
3. Optional bot command for moderators: `/창작마당 숨기기 <gist id>` → `api.workshop.set_hidden(id, True)`.
4. `client_max_size` stays 64 KB: no request to the index is bigger than a comment.
5. Restart the service. `GET /workshop/items` should answer `{"items": [], ...}`.

Until then the app shows 창작마당에 연결하지 못했어요 on 둘러보기. Link-only works, 내 작품 and
uploads still work, because they only need GitHub. A public upload says that it reached GitHub
but not the list, and it can be registered again later.

## Layout: patterns and where they come from

Checked against the live pages where possible. Steam item pages and SoundCloud/BandLab didn't render
for a fetch, so those are from knowledge.

| Pattern | Taken from | Where in MeloFi |
|---|---|---|
| Dense list rows with art, title, sub-line with tags, then fixed numeric columns (length, BPM, likes, date) and play on the art | Splice sound search | 둘러보기 list (`.mfw-row`, 44 px art, 56 px rows) |
| Kind tabs above the results (All / Samples / MIDI / Presets) | Splice type tabs, itch.io category tabs | 전체 · 오디오 · MIDI · Studio 프로젝트 segment |
| One sort control that includes the time window ("Most Popular (One Week)") | Steam Workshop browse | 최신순 / 인기순 · 이번 주 / 이번 달 / 전체 / 좋아요순 |
| Result count above the list | Steam Workshop ("373,451 entries matching filters") | 작품 N개 at the right of the bar |
| Category list with counts in brackets | BOOTH browse ("Music (Other)(10,892)") | the left rail: 장르 and 많이 쓰인 태그 with counts |
| Active filters as removable chips plus "Clear all filters" | Splice filter bar | chips under the bar, 필터 모두 지우기 |
| Numbered pages | Steam Workshop, BOOTH | ‹ 1 2 3 … › |
| Item hero: square art, title, author, a big play button and the waveform as the scrubber | SoundCloud track page | 작품 hero, click the waveform to seek |
| Two columns: description and comments on the left, a narrow rail with actions, stats, files on the right | Steam Workshop item page | `.mfw-cols`, 260 px rail |
| A labelled info table (Status, Category, Author, Tags…) | itch.io game page | 만든 사람, 장르, 종류, 길이, BPM, 올린 날, 고친 날, 재생, 내려받기 |
| File list with sizes and a download per file | itch.io downloads, Steam file size block | `.mfw-files` |
| Report as a quiet link away from the main actions | itch.io footer, Steam's small report flag | 링크 복사 · GitHub에서 보기 · 신고 under the rail |
| Comment box above the list, newest first | SoundCloud comments | 댓글 |
| A primary action that opens the work in the app | BandLab "Fork" / open in Studio | Studio에서 열기 (amber, the only filled button) |
| A persistent player bar along the bottom | SoundCloud | `.mfw-player` |
| Upload form order: title, files, description, genre and tags (limited), cover, visibility | itch.io "Create new project" | 올리기 form, 8 tags, cover on the right |
| My uploads as a table with numbers per row | Image-Line forum topic table (Topic / Replies / Views / Last post) | 내 작품 |
| Structured genre/BPM fields instead of "Title \| 120bpm \| House" | the Image-Line song-exchange threads show why | genre select, BPM/length stored per work |

House rules kept: no gradients, no emoji or icon fonts (only line SVGs and the services' own marks),
2 px radii, one amber accent with one filled button per view, the app's tokens, so the Studio white
theme recolours everything.

## Account center

One layout in three places: the start card, the piano window (파일 › 계정…) and Studio (파일 ›
창작마당 › 계정…, plus the old 계정 연결 entry).

- **Profile:** avatar, name, which accounts are connected, and **모두 로그아웃**.
- **연결된 계정:** GitHub and Discord in the same row shape.
- **저장과 공유:** online projects (count) and 창작마당 (public / link-only counts).
- **활동 기록:** 기록 지우기.
- **Footer:** how to revoke access on GitHub/Discord.

Every row uses the same four-column grid: mark (20) | name (96) | state (1fr) | action (120). Every
action button is the same 120 x 26 px and lines up on one right edge. The e2e test measures this.
Studio's online-projects sheet no longer has its own 계정 연결 tab. Without GitHub it shows the
reason and a **계정 열기** button.

## Running the tests

```
node tools/test-workshop-helper.mjs        # Helper index, needs python + aiohttp
node tools/e2e/workshop-run.mjs            # app headless; screenshots in %TEMP%\melofi-workshop-e2e\shots
```
The e2e signs the app in as a fake GitHub user (`MELOFI_TEST_ACCOUNT`, only honoured when
`MELOFI_SHOT` is set). It points `MELOFI_GITHUB_API` / `MELOFI_GIST_RAW` / `MELOFI_HELPER` at local
stand-ins, so nothing reaches GitHub or Discord.

## Known gaps

- Not tried against the real GitHub API yet. Gist size limits for a ~9 MB base64 file are
  GitHub's to decide; if creation fails for big files, lower `MAX_TOTAL` in `workshop.js`.
- Raw gist URLs can be cached by GitHub's CDN for a few minutes after an edit.
- MIDI-only works have no in-page preview; they open in Studio.
