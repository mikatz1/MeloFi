"""창작마당 (MeloFi creative workshop) index for MeloFi Helper.

Why it is built this way (docs/workshop.md has the long version):
- The files of a work never touch this VM. Each work is a public gist on the author's own GitHub,
  made by the app with the author's token: a manifest (melofi-workshop.json) plus the audio, MIDI,
  project and cover, binary files stored as base64 text. Players and downloads read
  gist.githubusercontent.com directly, so the free e2-micro's 1 GB of monthly egress only carries
  small JSON lists.
- This module keeps only the index: which gists are works, their title, tags and genre (copied from
  the manifest when the work is registered), likes, comments, reports and play/download counts, in
  one SQLite file. Deleting a work removes its row; DELETE /workshop/me removes everything a person
  left here.
- Identity is the app's existing sign-in: a Discord or GitHub token in the Authorization header, checked
  with that service on every write (the same `who` the rest of the Helper uses). Publishing needs
  GitHub (the files live there); liking, commenting and reporting work with either account.
- Nothing is public unless the author chooses 창작마당 공개 in the app. A work shared by link only is a
  secret gist and is never registered here.

Wiring into api.py (two lines, see docs/workshop.md):
    from workshop import Workshop
    self.workshop = Workshop(os.getenv("WORKSHOP_DB", "workshop.sqlite"), self.http, who=self.who, alert=...)
    app.add_routes(self.workshop.routes())
Standalone, for tests: python workshop.py --port 8099 --db x.sqlite (who() asks GITHUB_API / DISCORD_API).
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import json
import logging
import os
import re
import sqlite3
import secrets
import time
import unicodedata
from collections import defaultdict, deque

import aiohttp
from aiohttp import web

log = logging.getLogger("melofi-bot.workshop")

GITHUB_API = os.getenv("GITHUB_API", "https://api.github.com").rstrip("/")
DISCORD_API = os.getenv("DISCORD_API", "https://discord.com/api/v10").rstrip("/")

MANIFEST = "melofi-workshop.json"
PAGE = 24
HIDE_AFTER = 3  # distinct reporters before a work is hidden until a moderator looks at it
GENRES = {
    "piano", "classical", "pop", "ballad", "jazz", "lofi", "electronic", "hiphop",
    "rock", "game", "film", "practice", "etc",
}
KINDS = {"audio", "midi", "project"}
ROLE_TYPES = {"audio": ("audio/mpeg", "audio/ogg", "audio/mp4", "audio/wav"), "midi": ("audio/midi",),
              "project": ("application/json",), "cover": ("image/jpeg", "image/png", "image/webp")}

SCHEMA = """
create table if not exists items (
  id text primary key,            -- the gist id
  owner_id text not null,         -- GitHub user id
  owner_login text not null,
  owner_name text not null,
  title text not null,
  description text not null default '',
  tags text not null default '[]',
  genre text not null default 'etc',
  app text not null default 'piano',
  kinds text not null default '[]',
  files text not null default '[]',
  cover text,
  length real,
  bpm real,
  created real not null,
  updated real not null,
  hidden integer not null default 0, -- 1 = hidden after reports, 2 = hidden by a moderator
  downloads integer not null default 0,
  plays integer not null default 0
);
create table if not exists likes (item text not null, user text not null, at real not null, primary key (item, user));
create table if not exists comments (
  id integer primary key autoincrement, item text not null, user text not null, name text not null,
  provider text not null, text text not null, at real not null
);
create table if not exists reports (
  item text not null, user text not null, reason text not null, text text not null, at real not null,
  primary key (item, user)
);
create table if not exists profiles (
  user text primary key,          -- provider:id
  pid text not null unique,       -- a random public id (avatar URLs), never the account id
  nick text not null,
  nick_key text not null unique,  -- the nickname folded for uniqueness
  bio text not null default '',
  avatar text not null default '', -- '' | 'discord' | 'github' | 'upload'
  avatar_url text not null default '',
  avatar_img blob,
  updated real not null
);
create index if not exists items_created on items (created);
create index if not exists likes_at on likes (item, at);
create index if not exists comments_item on comments (item, at);
"""

REASONS = {"spam", "copyright", "offensive", "personal", "broken", "other"}

# nicknames: 2-20 letters, digits, '_', '-' or '.', no spaces; some words are kept for the team
NICK_RE = re.compile(r"^[0-9A-Za-z\uac00-\ud7a3\u3131-\u318e_.\-]{2,20}$")
RESERVED = {"melofi", "admin", "administrator", "mod", "moderator", "staff", "system", "official", "helper",
            "운영자", "관리자", "운영진", "멜로파이", "공식", "시스템"}
AVATAR_MAX = 24 * 1024  # an uploaded avatar: a small JPEG made by the app (96 x 96)


def nick_key(n: str) -> str:
    return unicodedata.normalize("NFKC", n).casefold().replace("_", "").replace("-", "").replace(".", "")


def nick_problem(n: str) -> str | None:
    if not NICK_RE.match(n):
        return "bad"
    k = nick_key(n)
    if len(k) < 2:
        return "bad"
    if any(k == r or k.startswith(r) for r in RESERVED):
        return "reserved"
    return None


class Fail(Exception):
    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


_recent: dict[str, deque] = defaultdict(deque)


def limited(key: str, limit: int, window: float = 3600) -> bool:
    q = _recent[key]
    now = time.monotonic()
    while q and now - q[0] > window:
        q.popleft()
    if len(q) >= limit:
        return True
    q.append(now)
    return False


def clean_line(s, n: int) -> str:
    return " ".join(str(s or "").split())[:n]


def clean_text(s, n: int) -> str:
    s = str(s or "").replace("\r\n", "\n").strip()
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s[:n]


def clean_tags(tags) -> list[str]:
    out: list[str] = []
    for t in tags if isinstance(tags, list) else []:
        t = re.sub(r"[\s#,]+", "", str(t)).lower()[:24]
        if t and t not in out:
            out.append(t)
    return out[:8]


class Workshop:
    def __init__(self, db_path: str, http: aiohttp.ClientSession | None = None, who=None, alert=None) -> None:
        self.db = sqlite3.connect(db_path, isolation_level=None, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.executescript("pragma journal_mode=wal;" + SCHEMA)
        self.http = http
        self._who = who
        self.alert = alert  # async (title: str, text: str) -> None, posts to the moderators' channel

    # ---------- routes ----------
    def routes(self) -> list:
        return [
            web.get("/workshop/items", self.list_items),
            web.post("/workshop/items", self.publish),
            web.get("/workshop/items/{id}", self.get_item),
            web.delete("/workshop/items/{id}", self.remove_item),
            web.post("/workshop/items/{id}/like", self.like),
            web.get("/workshop/items/{id}/comments", self.list_comments),
            web.post("/workshop/items/{id}/comments", self.add_comment),
            web.delete("/workshop/comments/{cid}", self.remove_comment),
            web.post("/workshop/items/{id}/report", self.report),
            web.post("/workshop/items/{id}/count", self.count),
            web.get("/workshop/mine", self.mine),
            web.delete("/workshop/me", self.forget_me),
            web.get("/workshop/nick", self.check_nick),
            web.get("/workshop/profile", self.get_profile),
            web.put("/workshop/profile", self.put_profile),
            web.get("/workshop/avatar/{pid}", self.avatar),
        ]

    # ---------- people ----------
    async def who(self, request: web.Request, required: bool = True) -> dict | None:
        if not request.headers.get("Authorization"):
            if required:
                raise Fail(401, "login_required", "로그인이 필요합니다.")
            return None
        if self._who:
            try:
                return await self._who(request)
            except Exception as e:  # the Helper's own Fail
                if hasattr(e, "status"):
                    raise Fail(e.status, e.code, e.message)
                raise
        return await self._who_default(request)

    async def _who_default(self, request: web.Request) -> dict:
        auth = request.headers.get("Authorization", "")
        if not auth.startswith("Bearer ") or len(auth) < 12:
            raise Fail(401, "login_required", "로그인이 필요합니다.")
        token = auth[7:]
        if request.headers.get("X-MeloFi-Provider", "discord") == "github":
            async with self.http.get(f"{GITHUB_API}/user", headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"}) as r:
                if r.status != 200:
                    raise Fail(401, "login_required", "GitHub 로그인이 만료되었습니다.")
                u = await r.json()
            return {"provider": "github", "id": str(u["id"]), "name": u.get("login", ""), "token": token}
        async with self.http.get(f"{DISCORD_API}/users/@me", headers={"Authorization": f"Bearer {token}"}) as r:
            if r.status != 200:
                raise Fail(401, "login_required", "디스코드 로그인이 만료되었습니다.")
            u = await r.json()
        return {"provider": "discord", "id": str(u["id"]), "name": u.get("global_name") or u.get("username", ""), "token": token}

    @staticmethod
    def key(u: dict) -> str:
        return f"{u['provider']}:{u['id']}"

    # ---------- helpers ----------
    def row(self, item_id: str):
        return self.db.execute("select * from items where id = ?", (item_id,)).fetchone()

    # ---------- profiles ----------
    def profile_row(self, user_key: str):
        return self.db.execute("select * from profiles where user = ?", (user_key,)).fetchone()

    @staticmethod
    def avatar_of(pr) -> str:
        if not pr or not pr["avatar"]:
            return ""
        if pr["avatar"] == "upload":
            return f"/workshop/avatar/{pr['pid']}?v={int(pr['updated'])}"
        return pr["avatar_url"]

    def person(self, user_key: str, fallback: str) -> dict:
        pr = self.profile_row(user_key)
        return {"nick": pr["nick"] if pr else "", "avatar": self.avatar_of(pr), "name": (pr["nick"] if pr else "") or fallback}

    def public(self, r, me: dict | None = None) -> dict:
        likes = self.db.execute("select count(*) from likes where item = ?", (r["id"],)).fetchone()[0]
        comments = self.db.execute("select count(*) from comments where item = ?", (r["id"],)).fetchone()[0]
        out = {
            "id": r["id"],
            "owner": {"login": r["owner_login"], **self.person(f"github:{r['owner_id']}", r["owner_name"])},
            "title": r["title"], "description": r["description"],
            "tags": json.loads(r["tags"]), "genre": r["genre"], "app": r["app"],
            "kinds": json.loads(r["kinds"]), "files": json.loads(r["files"]), "cover": r["cover"],
            "length": r["length"], "bpm": r["bpm"],
            "created": r["created"], "updated": r["updated"],
            "likes": likes, "comments": comments, "downloads": r["downloads"], "plays": r["plays"],
        }
        if r["hidden"]:
            out["hidden"] = r["hidden"]
        if me is not None:
            out["mine"] = me["provider"] == "github" and me["id"] == r["owner_id"]
            out["liked"] = bool(self.db.execute("select 1 from likes where item = ? and user = ?", (r["id"], self.key(me))).fetchone())
            out["reported"] = bool(self.db.execute("select 1 from reports where item = ? and user = ?", (r["id"], self.key(me))).fetchone())
        return out

    def visible(self, item_id: str, me: dict | None = None):
        r = self.row(item_id)
        if not r:
            raise Fail(404, "not_found", "작품을 찾을 수 없습니다.")
        if r["hidden"] and not (me and me["provider"] == "github" and me["id"] == r["owner_id"]):
            raise Fail(404, "not_found", "작품을 찾을 수 없습니다.")
        return r

    async def handle(self, fn):
        try:
            return await fn()
        except Fail as e:
            return web.json_response({"error": e.code, "message": e.message}, status=e.status)

    @staticmethod
    async def body(request: web.Request) -> dict:
        if request.content_length and request.content_length > 48 * 1024:
            raise Fail(413, "too_large", "요청이 너무 큽니다.")
        try:
            data = await request.json()
        except Exception:
            raise Fail(400, "bad_json", "요청 형식이 올바르지 않습니다.")
        if not isinstance(data, dict):
            raise Fail(400, "bad_json", "요청 형식이 올바르지 않습니다.")
        return data

    # ---------- browse ----------
    async def list_items(self, request: web.Request) -> web.Response:
        async def run():
            q = request.query
            me = await self.who(request, required=False) if request.headers.get("Authorization") else None
            sort = q.get("sort", "new")
            period = {"week": 7, "month": 30, "year": 365}.get(q.get("period", ""), 0)
            page = max(0, min(200, int(q.get("page", "0") or 0)))
            where, args = ["hidden = 0"], []
            if q.get("tag"):
                where.append("exists (select 1 from json_each(items.tags) where value = ?)")
                args.append(clean_tags([q["tag"]])[0] if clean_tags([q["tag"]]) else "")
            if q.get("genre") in GENRES:
                where.append("genre = ?")
                args.append(q["genre"])
            if q.get("kind") in KINDS:
                where.append("exists (select 1 from json_each(items.kinds) where value = ?)")
                args.append(q["kind"])
            if q.get("app") in ("piano", "studio"):
                where.append("app = ?")
                args.append(q["app"])
            if q.get("owner"):
                where.append("owner_login = ? collate nocase")
                args.append(clean_line(q["owner"], 40))
            for word in clean_line(q.get("q", ""), 60).split()[:5]:
                like = "%" + word.replace("%", "").replace("_", "") + "%"
                where.append("(title like ? or description like ? or tags like ? or owner_login like ? or owner_name like ?"
                             " or exists (select 1 from profiles where profiles.user = 'github:' || items.owner_id and profiles.nick like ?))")
                args += [like] * 6
            w = " and ".join(where)
            total = self.db.execute(f"select count(*) from items where {w}", args).fetchone()[0]
            if sort == "popular":
                since = time.time() - period * 86400 if period else 0
                order = ("(select count(*) from likes where likes.item = items.id and likes.at >= ?) * 3"
                         " + downloads + plays * 0.2 desc, created desc")
                rows = self.db.execute(f"select * from items where {w} order by {order} limit ? offset ?",
                                       [*args, since, PAGE, page * PAGE]).fetchall()
            elif sort == "liked":
                rows = self.db.execute(f"select * from items where {w} order by (select count(*) from likes where likes.item = items.id) desc, created desc limit ? offset ?",
                                       [*args, PAGE, page * PAGE]).fetchall()
            else:
                rows = self.db.execute(f"select * from items where {w} order by created desc limit ? offset ?", [*args, PAGE, page * PAGE]).fetchall()
            tags = self.db.execute(
                "select value as tag, count(*) as n from items, json_each(items.tags) where hidden = 0 group by value order by n desc, value limit 30"
            ).fetchall()
            genres = self.db.execute("select genre, count(*) as n from items where hidden = 0 group by genre").fetchall()
            return web.json_response({
                "items": [self.public(r, me) for r in rows], "total": total, "page": page, "pageSize": PAGE,
                "tags": [{"tag": t["tag"], "n": t["n"]} for t in tags],
                "genres": {g["genre"]: g["n"] for g in genres},
            })
        return await self.handle(run)

    async def get_item(self, request: web.Request) -> web.Response:
        async def run():
            me = await self.who(request, required=False)
            return web.json_response(self.public(self.visible(request.match_info["id"], me), me))
        return await self.handle(run)

    async def mine(self, request: web.Request) -> web.Response:
        async def run():
            me = await self.who(request)
            if me["provider"] != "github":
                return web.json_response({"items": []})
            rows = self.db.execute("select * from items where owner_id = ? order by created desc", (me["id"],)).fetchall()
            return web.json_response({"items": [self.public(r, me) for r in rows]})
        return await self.handle(run)

    # ---------- publish ----------
    async def publish(self, request: web.Request) -> web.Response:
        """Registers (or refreshes) a gist as a work. The manifest in the gist is the source of truth."""
        async def run():
            me = await self.who(request)
            if me["provider"] != "github":
                raise Fail(403, "github_required", "창작마당에 올리려면 GitHub 로그인이 필요합니다.")
            if limited(f"pub:{me['id']}", 20):
                raise Fail(429, "slow_down", "잠시 뒤 다시 올려 주십시오.")
            b = await self.body(request)
            gid = str(b.get("gist", ""))
            if not re.fullmatch(r"[0-9a-f]{20,40}", gid):
                raise Fail(400, "bad_gist", "Gist 번호가 올바르지 않습니다.")
            async with self.http.get(f"{GITHUB_API}/gists/{gid}", headers={"Authorization": request.headers["Authorization"], "Accept": "application/vnd.github+json"}) as r:
                if r.status != 200:
                    raise Fail(404, "not_found", "Gist를 찾을 수 없습니다.")
                g = await r.json()
            if str((g.get("owner") or {}).get("id")) != me["id"]:
                raise Fail(403, "not_owner", "내 Gist만 올릴 수 있습니다.")
            if not g.get("public"):
                raise Fail(400, "not_public", "공개 Gist만 창작마당에 올릴 수 있습니다.")
            f = (g.get("files") or {}).get(MANIFEST)
            if not f:
                raise Fail(400, "not_work", "창작마당 작품이 아닙니다.")
            try:
                m = json.loads(f.get("content") or "{}")
            except ValueError:
                raise Fail(400, "bad_manifest", "작품 정보를 읽지 못했습니다.")
            title = clean_line(m.get("title"), 80)
            if not title:
                raise Fail(400, "no_title", "제목이 필요합니다.")
            gist_files = g.get("files") or {}
            files, kinds = [], []
            for x in (m.get("files") or [])[:6]:
                name, role = str(x.get("name", "")), str(x.get("role", ""))
                if role not in KINDS or name not in gist_files:
                    continue
                typ = str(x.get("type", ""))
                if typ not in ROLE_TYPES[role]:
                    typ = ROLE_TYPES[role][0]
                files.append({"name": name, "role": role, "type": typ, "size": int(x.get("size") or 0),
                              "label": clean_line(x.get("label"), 60)})
                if role not in kinds:
                    kinds.append(role)
            if not files:
                raise Fail(400, "no_files", "올릴 파일이 없습니다.")
            cover = m.get("cover") if m.get("cover") in gist_files else None
            genre = m.get("genre") if m.get("genre") in GENRES else "etc"
            app = m.get("app") if m.get("app") in ("piano", "studio") else "piano"
            num = lambda v, hi: float(v) if isinstance(v, (int, float)) and 0 < v < hi else None  # noqa: E731
            now = time.time()
            old = self.row(gid)
            owner = g.get("owner") or {}
            self.db.execute(
                """insert into items (id, owner_id, owner_login, owner_name, title, description, tags, genre, app, kinds, files, cover, length, bpm, created, updated)
                   values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                   on conflict(id) do update set owner_login=excluded.owner_login, owner_name=excluded.owner_name, title=excluded.title,
                     description=excluded.description, tags=excluded.tags, genre=excluded.genre, app=excluded.app, kinds=excluded.kinds,
                     files=excluded.files, cover=excluded.cover, length=excluded.length, bpm=excluded.bpm, updated=excluded.updated""",
                (gid, me["id"], owner.get("login", me["name"]), clean_line(m.get("author") or owner.get("login", ""), 40),
                 title, clean_text(m.get("description"), 2000), json.dumps(clean_tags(m.get("tags")), ensure_ascii=False),
                 genre, app, json.dumps(kinds), json.dumps(files, ensure_ascii=False), cover,
                 num(m.get("length"), 36000), num(m.get("bpm"), 1000), now, now),
            )
            if not old:
                log.info("창작마당 새 작품: %s (%s)", title, owner.get("login"))
            return web.json_response(self.public(self.row(gid), me), status=200 if old else 201)
        return await self.handle(run)

    async def remove_item(self, request: web.Request) -> web.Response:
        async def run():
            me = await self.who(request)
            r = self.row(request.match_info["id"])
            if not r:
                return web.json_response({"ok": True})
            if not (me["provider"] == "github" and me["id"] == r["owner_id"]):
                raise Fail(403, "not_owner", "내 작품만 내릴 수 있습니다.")
            self.drop(r["id"])
            return web.json_response({"ok": True})
        return await self.handle(run)

    def drop(self, item_id: str) -> None:
        for t in ("likes", "comments", "reports"):
            self.db.execute(f"delete from {t} where item = ?", (item_id,))
        self.db.execute("delete from items where id = ?", (item_id,))

    # ---------- likes / counts ----------
    async def like(self, request: web.Request) -> web.Response:
        async def run():
            me = await self.who(request)
            r = self.visible(request.match_info["id"], me)
            if limited(f"like:{self.key(me)}", 200):
                raise Fail(429, "slow_down", "잠시 뒤 다시 시도해 주십시오.")
            on = bool((await self.body(request)).get("on", True))
            if on:
                self.db.execute("insert or ignore into likes values (?,?,?)", (r["id"], self.key(me), time.time()))
            else:
                self.db.execute("delete from likes where item = ? and user = ?", (r["id"], self.key(me)))
            return web.json_response(self.public(r, me))
        return await self.handle(run)

    async def count(self, request: web.Request) -> web.Response:
        async def run():
            r = self.visible(request.match_info["id"])
            what = (await self.body(request)).get("what")
            if what not in ("play", "download"):
                raise Fail(400, "bad_count", "잘못된 요청입니다.")
            peer = request.headers.get("X-Forwarded-For", request.remote or "").split(",")[0].strip()
            # one count per address, work and kind a day; a replay or a double click is not counted twice
            if not limited(f"count:{peer}:{r['id']}:{what}", 1, 86400):
                col = "plays" if what == "play" else "downloads"
                self.db.execute(f"update items set {col} = {col} + 1 where id = ?", (r["id"],))
            return web.json_response({"ok": True})
        return await self.handle(run)

    # ---------- comments ----------
    def comment_out(self, c, me: dict | None, owner_id: str) -> dict:
        mine = bool(me) and c["user"] == self.key(me)
        owner = bool(me) and me["provider"] == "github" and me["id"] == owner_id
        who = self.person(c["user"], c["name"])
        return {"id": c["id"], "name": who["name"], "avatar": who["avatar"], "provider": c["provider"], "text": c["text"], "at": c["at"],
                "mine": mine, "canDelete": mine or owner, "byOwner": c["user"] == f"github:{owner_id}"}

    async def list_comments(self, request: web.Request) -> web.Response:
        async def run():
            me = await self.who(request, required=False)
            r = self.visible(request.match_info["id"], me)
            rows = self.db.execute("select * from comments where item = ? order by at asc limit 500", (r["id"],)).fetchall()
            return web.json_response({"comments": [self.comment_out(c, me, r["owner_id"]) for c in rows]})
        return await self.handle(run)

    async def add_comment(self, request: web.Request) -> web.Response:
        async def run():
            me = await self.who(request)
            r = self.visible(request.match_info["id"], me)
            if limited(f"cm:{self.key(me)}", 30):
                raise Fail(429, "slow_down", "댓글은 한 시간에 30개까지 쓸 수 있습니다.")
            text = clean_text((await self.body(request)).get("text"), 1000)
            if not text:
                raise Fail(400, "empty", "댓글이 비어 있습니다.")
            cur = self.db.execute("insert into comments (item, user, name, provider, text, at) values (?,?,?,?,?,?)",
                                  (r["id"], self.key(me), clean_line(me.get("name"), 40) or "?", me["provider"], text, time.time()))
            c = self.db.execute("select * from comments where id = ?", (cur.lastrowid,)).fetchone()
            return web.json_response(self.comment_out(c, me, r["owner_id"]), status=201)
        return await self.handle(run)

    async def remove_comment(self, request: web.Request) -> web.Response:
        async def run():
            me = await self.who(request)
            c = self.db.execute("select * from comments where id = ?", (request.match_info["cid"],)).fetchone()
            if not c:
                return web.json_response({"ok": True})
            r = self.row(c["item"])
            if not (c["user"] == self.key(me) or (r and me["provider"] == "github" and me["id"] == r["owner_id"])):
                raise Fail(403, "not_yours", "내 댓글이나 내 작품의 댓글만 지울 수 있습니다.")
            self.db.execute("delete from comments where id = ?", (c["id"],))
            return web.json_response({"ok": True})
        return await self.handle(run)

    # ---------- reports ----------
    async def report(self, request: web.Request) -> web.Response:
        async def run():
            me = await self.who(request)
            r = self.visible(request.match_info["id"], me)
            if limited(f"rep:{self.key(me)}", 10):
                raise Fail(429, "slow_down", "잠시 뒤 다시 시도해 주십시오.")
            b = await self.body(request)
            reason = b.get("reason") if b.get("reason") in REASONS else "other"
            text = clean_text(b.get("text"), 1000)
            self.db.execute("insert or replace into reports values (?,?,?,?,?)", (r["id"], self.key(me), reason, text, time.time()))
            n = self.db.execute("select count(*) from reports where item = ?", (r["id"],)).fetchone()[0]
            if n >= HIDE_AFTER and r["hidden"] == 0:
                self.db.execute("update items set hidden = 1 where id = ?", (r["id"],))
            if self.alert:
                try:
                    await self.alert(
                        f"창작마당 신고: {r['title']}",
                        f"사유: {reason} · 신고 {n}건{' · 자동으로 숨김' if n >= HIDE_AFTER else ''}\n"
                        f"작품: https://gist.github.com/{r['owner_login']}/{r['id']}\n"
                        f"작성자: {r['owner_login']}\n신고자: {me['provider']} {me.get('name', '')}\n\n{text}",
                    )
                except Exception as e:  # the report is kept even when Discord is down
                    log.warning("신고 알림 실패: %s", e)
            return web.json_response({"ok": True, "reports": n})
        return await self.handle(run)

    # ---------- moderation (bot slash commands call these) ----------
    def set_hidden(self, item_id: str, hidden: bool) -> bool:
        cur = self.db.execute("update items set hidden = ? where id = ?", (2 if hidden else 0, item_id))
        if not hidden:
            self.db.execute("delete from reports where item = ?", (item_id,))
        return cur.rowcount > 0

    # ---------- profile endpoints ----------
    async def check_nick(self, request: web.Request) -> web.Response:
        """Is this nickname free? (the person's own nickname counts as free)"""
        async def run():
            peer = request.headers.get("X-Forwarded-For", request.remote or "").split(",")[0].strip()
            if limited(f"nick:{peer}", 240):
                raise Fail(429, "slow_down", "잠시 뒤 다시 시도해 주십시오.")
            n = str(request.query.get("name", "")).strip()
            why = nick_problem(n)
            if why:
                return web.json_response({"ok": False, "reason": why})
            me = await self.who(request, required=False)
            r = self.db.execute("select user from profiles where nick_key = ?", (nick_key(n),)).fetchone()
            if r and not (me and r["user"] == self.key(me)):
                return web.json_response({"ok": False, "reason": "taken"})
            return web.json_response({"ok": True})
        return await self.handle(run)

    def profile_out(self, pr) -> dict:
        if not pr:
            return {"nick": "", "bio": "", "avatar": "", "avatarUrl": ""}
        return {"nick": pr["nick"], "bio": pr["bio"], "avatar": pr["avatar"], "avatarUrl": self.avatar_of(pr)}

    async def get_profile(self, request: web.Request) -> web.Response:
        async def run():
            me = await self.who(request)
            return web.json_response(self.profile_out(self.profile_row(self.key(me))))
        return await self.handle(run)

    async def put_profile(self, request: web.Request) -> web.Response:
        async def run():
            me = await self.who(request)
            if limited(f"prof:{self.key(me)}", 30):
                raise Fail(429, "slow_down", "잠시 뒤 다시 시도해 주십시오.")
            b = await self.body(request)
            nick = str(b.get("nick", "")).strip()
            why = nick_problem(nick)
            if why:
                raise Fail(400, f"nick_{why}", "쓸 수 없는 닉네임입니다.")
            k = self.key(me)
            other = self.db.execute("select user from profiles where nick_key = ?", (nick_key(nick),)).fetchone()
            if other and other["user"] != k:
                raise Fail(409, "nick_taken", "이미 쓰고 있는 닉네임입니다.")
            bio = clean_line(b.get("bio"), 80)
            avatar = b.get("avatar") if b.get("avatar") in ("", "discord", "github", "upload") else ""
            old = self.profile_row(k)
            url, img = "", None
            if avatar == "github":
                if me["provider"] != "github":
                    raise Fail(400, "bad_avatar", "GitHub 사진은 GitHub로 로그인했을 때만 쓸 수 있습니다.")
                url = f"https://avatars.githubusercontent.com/u/{me['id']}?s=96"
            elif avatar == "discord":
                url = str(b.get("avatarUrl", ""))
                if me["provider"] != "discord" or not re.fullmatch(rf"https://cdn\.discordapp\.com/avatars/{me['id']}/[0-9a-zA-Z_]{{6,40}}\.(png|webp|jpg)(\?size=\d+)?", url):
                    raise Fail(400, "bad_avatar", "디스코드 사진 주소가 올바르지 않습니다.")
            elif avatar == "upload":
                if b.get("image"):
                    try:
                        img = base64.b64decode(str(b["image"]), validate=True)
                    except ValueError:
                        raise Fail(400, "bad_avatar", "이미지를 읽지 못했습니다.")
                    if len(img) > AVATAR_MAX or not img.startswith(b"\xff\xd8\xff"):
                        raise Fail(400, "bad_avatar", "작은 JPEG 이미지만 쓸 수 있습니다.")
                elif old and old["avatar"] == "upload":
                    img = old["avatar_img"]
                else:
                    raise Fail(400, "bad_avatar", "이미지가 없습니다.")
            self.db.execute(
                """insert into profiles (user, pid, nick, nick_key, bio, avatar, avatar_url, avatar_img, updated) values (?,?,?,?,?,?,?,?,?)
                   on conflict(user) do update set nick=excluded.nick, nick_key=excluded.nick_key, bio=excluded.bio,
                     avatar=excluded.avatar, avatar_url=excluded.avatar_url, avatar_img=excluded.avatar_img, updated=excluded.updated""",
                (k, old["pid"] if old else secrets.token_hex(8), nick, nick_key(nick), bio, avatar, url, img, time.time()))
            return web.json_response(self.profile_out(self.profile_row(k)))
        return await self.handle(run)

    async def avatar(self, request: web.Request) -> web.Response:
        r = self.db.execute("select avatar_img from profiles where pid = ? and avatar = 'upload'", (request.match_info["pid"],)).fetchone()
        if not r or not r["avatar_img"]:
            return web.Response(status=404)
        return web.Response(body=r["avatar_img"], content_type="image/jpeg", headers={"Cache-Control": "public, max-age=86400"})

    # ---------- privacy ----------
    async def forget_me(self, request: web.Request) -> web.Response:
        """Removes every like, comment and report the person left, and (GitHub) every work they registered.
        The gists themselves stay on their GitHub; the app offers to delete those too."""
        async def run():
            me = await self.who(request)
            k = self.key(me)
            n = 0
            for t in ("likes", "comments", "reports", "profiles"):
                n += self.db.execute(f"delete from {t} where user = ?", (k,)).rowcount
            if me["provider"] == "github":
                for r in self.db.execute("select id from items where owner_id = ?", (me["id"],)).fetchall():
                    self.drop(r["id"])
                    n += 1
            return web.json_response({"ok": True, "removed": n})
        return await self.handle(run)


# ---------- standalone (tests, local development) ----------
async def _main(port: int, db: str) -> None:
    http = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=20))
    alerts: list = []

    async def alert(title: str, text: str) -> None:
        alerts.append({"title": title, "text": text})

    ws = Workshop(db, http, alert=alert)
    app = web.Application(client_max_size=64 * 1024)
    app.add_routes(ws.routes())

    async def health(_r):
        return web.json_response({"ok": True, "alerts": alerts})

    async def hide(r):  # what a moderator command does
        return web.json_response({"ok": ws.set_hidden(r.match_info["id"], r.query.get("on", "1") == "1")})

    app.add_routes([web.get("/health", health), web.post("/test/hide/{id}", hide)])
    runner = web.AppRunner(app, access_log=None)
    await runner.setup()
    await web.TCPSite(runner, "127.0.0.1", port).start()
    print(f"workshop on 127.0.0.1:{port}", flush=True)
    await asyncio.Event().wait()


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--port", type=int, default=8099)
    p.add_argument("--db", default="workshop.sqlite")
    a = p.parse_args()
    logging.basicConfig(level=logging.INFO)
    asyncio.run(_main(a.port, a.db))
