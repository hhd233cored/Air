from __future__ import annotations

import asyncio
import json
import sys
from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path

from fastapi.testclient import TestClient

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "backend-python"))

from app.article_service import ArticleService  # noqa: E402
from app.chatter_service import ChatterService  # noqa: E402
from app.config import Settings  # noqa: E402
from app.historical_service import HistoricalTodayService  # noqa: E402
from app.local_music_service import LocalMusicService  # noqa: E402
from app.music_service import MusicService  # noqa: E402
from app.auth_service import AuthService  # noqa: E402
import app.historical_service as historical_module  # noqa: E402
import app.local_music_service as local_music_module  # noqa: E402
import app.main as main  # noqa: E402
import app.music_service as music_module  # noqa: E402


def write_article(root: Path, slug: str, *, published: str, title: str, tags: list[str], cover: str | None = None) -> None:
    folder = root / slug
    folder.mkdir(parents=True)
    metadata = {
        "id": f"id-{slug}",
        "slug": slug,
        "title": title,
        "summary": f"Summary of {title}",
        "tags": tags,
        "status": "PUBLISHED",
        "publishedAt": published,
        "createdAt": published,
        "updatedAt": published,
        "cover": cover,
    }
    (folder / "article.json").write_text(json.dumps(metadata), encoding="utf-8")
    (folder / "article.md").write_text(f"# {title}\n\nContent", encoding="utf-8")
    if cover:
        (folder / cover).write_text("cover", encoding="utf-8")


def test_article_service_filters_sorts_and_paginates(tmp_path: Path) -> None:
    write_article(tmp_path, "older", published="2026-07-13T12:00:00Z", title="Older", tags=["notes"])
    write_article(tmp_path, "newer", published="2026-07-14T12:00:00Z", title="Newer", tags=["Notes", "Personal"])
    draft = tmp_path / "draft"
    draft.mkdir()
    (draft / "article.json").write_text(
        json.dumps({"slug": "draft", "title": "Draft", "status": "DRAFT"}),
        encoding="utf-8",
    )

    service = ArticleService(tmp_path)
    page = service.list_published(0, 1, "notes")

    assert page.totalElements == 2
    assert page.totalPages == 2
    assert [article.slug for article in page.content] == ["newer"]
    assert service.list_published(1, 1, None).content[0].slug == "older"


def test_article_detail_and_cover_url(tmp_path: Path) -> None:
    write_article(
        tmp_path,
        "sample",
        published="2026-07-14T12:00:00Z",
        title="Sample",
        tags=["notes"],
        cover="cover.svg",
    )

    article = ArticleService(tmp_path).get_published("SAMPLE")

    assert article.contentMarkdown.startswith("# Sample")
    assert article.coverUrl == "/articles/sample/cover.svg"


def write_chatter(
    root: Path,
    slug: str,
    *,
    published: str,
    body: str,
    status: str = "PUBLISHED",
    metadata_slug: str | None = None,
) -> None:
    folder = root / slug
    folder.mkdir(parents=True)
    metadata = {
        "id": f"chatter-{slug}",
        "slug": metadata_slug or slug,
        "status": status,
        "publishedAt": published,
        "createdAt": published,
        "updatedAt": published,
    }
    (folder / "chatter.json").write_text(json.dumps(metadata), encoding="utf-8")
    (folder / "chatter.md").write_text(body, encoding="utf-8")


def test_chatter_service_filters_sorts_paginates_and_generates_preview(tmp_path: Path) -> None:
    write_chatter(
        tmp_path,
        "older",
        published="2026-07-14T12:00:00Z",
        body="# Older\n\nA [small](https://example.test) note.",
    )
    write_chatter(
        tmp_path,
        "newer",
        published="2026-07-16T12:00:00Z",
        body="慢一点，**事情**仍然会发生。",
    )
    write_chatter(
        tmp_path,
        "draft",
        published="2026-07-17T12:00:00Z",
        body="Not public",
        status="DRAFT",
    )
    write_chatter(
        tmp_path,
        "mismatch",
        published="2026-07-18T12:00:00Z",
        body="Invalid folder",
        metadata_slug="different-slug",
    )

    service = ChatterService(tmp_path)
    page = service.list_published(0, 1)

    assert page.totalElements == 2
    assert page.totalPages == 2
    assert [entry.slug for entry in page.content] == ["newer"]
    assert page.content[0].preview == "慢一点，事情仍然会发生。"
    assert service.list_published(1, 1).content[0].slug == "older"


def test_chatter_detail_returns_markdown_without_cover(tmp_path: Path) -> None:
    write_chatter(tmp_path, "sample", published="2026-07-16T12:00:00Z", body="## Markdown body\n\nContent")

    chatter = ChatterService(tmp_path).get_published("SAMPLE")

    assert chatter.contentMarkdown == "## Markdown body\n\nContent"
    assert not hasattr(chatter, "coverUrl")


def test_chatter_api_contract_and_not_found(tmp_path: Path, monkeypatch) -> None:
    write_chatter(tmp_path, "sample", published="2026-07-16T12:00:00Z", body="A sample chatter.")
    monkeypatch.setattr(main, "chatter_service", ChatterService(tmp_path))
    client = TestClient(main.app)

    response = client.get("/api/v1/chatter?size=10")
    assert response.status_code == 200
    assert response.json()["content"][0]["slug"] == "sample"
    assert "coverUrl" not in response.json()["content"][0]

    detail = client.get("/api/v1/chatter/sample")
    assert detail.status_code == 200
    assert detail.json()["contentMarkdown"] == "A sample chatter."

    missing = client.get("/api/v1/chatter/missing")
    assert missing.status_code == 404
    assert missing.json()["code"] == "CHATTER_NOT_FOUND"


def test_api_contract_and_not_found(tmp_path: Path, monkeypatch) -> None:
    write_article(tmp_path, "sample", published="2026-07-14T12:00:00Z", title="Sample", tags=[])
    monkeypatch.setattr(main, "article_service", ArticleService(tmp_path))
    client = TestClient(main.app)

    assert client.get("/api/v1/health").json() == {"status": "UP"}
    response = client.get("/api/v1/articles?size=10")
    assert response.status_code == 200
    assert response.json()["content"][0]["slug"] == "sample"

    missing = client.get("/api/v1/articles/missing")
    assert missing.status_code == 404
    assert missing.json()["code"] == "ARTICLE_NOT_FOUND"


def test_auth_login_me_logout_and_csrf(tmp_path: Path, monkeypatch) -> None:
    service = AuthService(tmp_path / "auth.sqlite3", session_timeout_seconds=3600)
    service.initialize_users(admin_username="admin", admin_password="admin-password")
    monkeypatch.setattr(main, "auth_service", service)
    monkeypatch.setattr(
        main,
        "settings",
        replace(
            main.settings,
            auth_enabled=True,
            auth_csrf_enabled=True,
            auth_registration_enabled=True,
            auth_cookie_secure=False,
            auth_cookie_name="test_session",
        ),
    )
    client = TestClient(main.app)

    csrf = client.get("/api/v1/auth/csrf")
    assert csrf.status_code == 200
    token = csrf.json()["token"]
    assert client.cookies.get("XSRF-TOKEN") == token

    registered = client.post(
        "/api/v1/auth/register",
        json={"username": "new-reader", "password": "reader-password"},
        headers={"X-XSRF-TOKEN": token},
    )
    assert registered.status_code == 201
    assert registered.json()["user"]["role"] == "USER"
    client.post("/api/v1/auth/logout", headers={"X-XSRF-TOKEN": token})

    missing_csrf = client.post(
        "/api/v1/auth/login",
        json={"username": "admin", "password": "admin-password"},
    )
    assert missing_csrf.status_code == 403
    assert missing_csrf.json()["code"] == "CSRF_INVALID"

    logged_in = client.post(
        "/api/v1/auth/login",
        json={"username": "admin", "password": "admin-password"},
        headers={"X-XSRF-TOKEN": token},
    )
    assert logged_in.status_code == 200
    assert logged_in.json()["user"]["role"] == "ADMIN"
    assert client.get("/api/v1/auth/me").json()["user"]["username"] == "admin"

    logged_out = client.post("/api/v1/auth/logout", headers={"X-XSRF-TOKEN": token})
    assert logged_out.status_code == 204
    assert client.get("/api/v1/auth/me").status_code == 401


def test_admin_user_api_requires_role_csrf_and_returns_safe_fields(tmp_path: Path, monkeypatch) -> None:
    service = AuthService(tmp_path / "auth.sqlite3", session_timeout_seconds=3600)
    service.initialize_users(
        admin_username="admin",
        admin_password="admin-password",
        user_username="reader",
        user_password="reader-password",
    )
    monkeypatch.setattr(main, "auth_service", service)
    monkeypatch.setattr(
        main,
        "settings",
        replace(
            main.settings,
            auth_enabled=True,
            auth_csrf_enabled=True,
            auth_cookie_secure=False,
            auth_cookie_name="test_admin_session",
        ),
    )

    admin_client = TestClient(main.app)
    admin_csrf = admin_client.get("/api/v1/auth/csrf").json()["token"]
    admin_login = admin_client.post(
        "/api/v1/auth/login",
        json={"username": "admin", "password": "admin-password"},
        headers={"X-XSRF-TOKEN": admin_csrf},
    )
    assert admin_login.status_code == 200

    listed = admin_client.get("/api/v1/admin/users?size=20")
    assert listed.status_code == 200
    assert listed.json()["totalElements"] == 2
    assert "password_hash" not in listed.text
    assert "sessions" not in listed.text

    registration = admin_client.get("/api/v1/admin/settings/registration")
    assert registration.status_code == 200
    assert registration.json()["enabled"] is True
    registration_update = admin_client.patch(
        "/api/v1/admin/settings/registration",
        json={"enabled": False},
        headers={"X-XSRF-TOKEN": admin_csrf},
    )
    assert registration_update.status_code == 200
    assert registration_update.json()["enabled"] is False

    created = admin_client.post(
        "/api/v1/admin/users",
        json={"username": "created-user", "password": "created-password", "role": "USER", "enabled": True},
        headers={"X-XSRF-TOKEN": admin_csrf},
    )
    assert created.status_code == 201
    created_id = created.json()["id"]
    assert created.json()["role"] == "USER"

    avatar = admin_client.put(
        f"/api/v1/admin/users/{created_id}/avatar",
        files={"avatar": ("avatar.png", b"\x89PNG\r\n\x1a\n", "image/png")},
        headers={"X-XSRF-TOKEN": admin_csrf},
    )
    assert avatar.status_code == 200
    assert avatar.json()["avatarUrl"]

    updated = admin_client.patch(
        f"/api/v1/admin/users/{created_id}",
        json={"enabled": False},
        headers={"X-XSRF-TOKEN": admin_csrf},
    )
    assert updated.status_code == 200
    assert updated.json()["enabled"] is False

    reader_client = TestClient(main.app)
    reader_csrf = reader_client.get("/api/v1/auth/csrf").json()["token"]
    reader_login = reader_client.post(
        "/api/v1/auth/login",
        json={"username": "reader", "password": "reader-password"},
        headers={"X-XSRF-TOKEN": reader_csrf},
    )
    assert reader_login.status_code == 200
    assert reader_client.get("/api/v1/admin/users").status_code == 403
    assert reader_client.post(
        "/api/v1/admin/users",
        json={"username": "blocked", "password": "blocked-password", "role": "USER"},
        headers={"X-XSRF-TOKEN": reader_csrf},
    ).status_code == 403


class FakeWikimediaResponse:
    status = 200

    def __init__(self, body: bytes) -> None:
        self.body = body

    def __enter__(self) -> "FakeWikimediaResponse":
        return self

    def __exit__(self, *args) -> None:
        return None

    def read(self) -> bytes:
        return self.body


def test_historical_today_is_cached_for_the_current_hour(monkeypatch) -> None:
    calls = 0

    def fake_urlopen(request, timeout):
        nonlocal calls
        calls += 1
        return FakeWikimediaResponse(
            json.dumps({"events": [{"year": 1789, "text": "A historical event"}]}).encode()
        )

    monkeypatch.setattr(historical_module, "urlopen", fake_urlopen)
    service = HistoricalTodayService("https://example.test/onthisday/all")

    first = service.get_today()
    second = service.get_today()

    assert calls == 1
    assert first.available is True
    assert first.events[0].year == 1789
    assert first.events[0].text == "A historical event"
    assert second == first


def test_application_lifespan_warms_historical_cache(monkeypatch) -> None:
    calls = 0

    def fake_get_today():
        nonlocal calls
        calls += 1

    monkeypatch.setattr(main.historical_service, "get_today", fake_get_today)

    async def run_lifespan():
        async with main.lifespan(main.app):
            pass

    asyncio.run(run_lifespan())
    assert calls == 1


class FakeMusicResponse:
    def __init__(self, body: dict) -> None:
        self.body = json.dumps(body).encode()

    def __enter__(self) -> "FakeMusicResponse":
        return self

    def __exit__(self, *args) -> None:
        return None

    def read(self) -> bytes:
        return self.body


def make_music_settings(monkeypatch, *, access_token: str = "") -> Settings:
    monkeypatch.setenv("NETEASE_MUSIC_APP_ID", "test-app")
    monkeypatch.setenv("NETEASE_MUSIC_APP_SECRET", "test-secret")
    monkeypatch.setenv("NETEASE_MUSIC_ACCESS_TOKEN", access_token)
    monkeypatch.setenv("NETEASE_MUSIC_PLAYLIST_ID", "17434435787")
    return Settings.from_environment(PROJECT_ROOT)


def test_music_service_gets_and_caches_anonymous_token(monkeypatch) -> None:
    calls: list[str] = []

    def fake_urlopen(request, timeout):
        calls.append(request.full_url)
        if "oauth2/login/anonymous" in request.full_url:
            return FakeMusicResponse({"code": 200, "data": {"accessToken": "anonymous-token"}})
        return FakeMusicResponse({
            "code": 200,
            "subCode": "200",
            "data": [{
                "id": "song-1",
                "name": "Example song",
                "artists": [{"name": "Example artist"}],
                "duration": 1234,
                "coverImgUrl": "http://example.test/cover.jpg",
                "playFlag": True,
            }],
        })

    monkeypatch.setattr(music_module, "urlopen", fake_urlopen)
    service = MusicService(make_music_settings(monkeypatch))

    first = service.get_playlist()
    second = service.get_playlist()

    assert len(calls) == 2
    assert first == second
    assert first.tracks[0].artist == "Example artist"
    assert first.tracks[0].coverUrl == "https://example.test/cover.jpg"
    assert "accessToken=anonymous-token" in calls[1]


def test_music_service_fetches_trial_play_url_and_caches_it(monkeypatch) -> None:
    calls = 0

    def fake_urlopen(request, timeout):
        nonlocal calls
        calls += 1
        if "playlist/song/list/get/v3" in request.full_url:
            return FakeMusicResponse({
                "code": 200,
                "subCode": "200",
                "data": [{"id": "song-1", "name": "Example song", "artists": []}],
            })
        return FakeMusicResponse({
            "code": 200,
            "subCode": "200",
            "data": {
                "id": "song-1",
                "duration": 60000,
                "playFlag": False,
                "playUrl": "https://example.test/song.mp3",
                "playUrlExpireTime": 4102444800000,
                "freeTrialPrivilege": {"resConsumable": True, "userConsumable": True},
            },
        })

    monkeypatch.setattr(music_module, "urlopen", fake_urlopen)
    service = MusicService(make_music_settings(monkeypatch, access_token="direct-token"))

    first = service.get_track_url("song-1")
    second = service.get_track_url("song-1")

    assert calls == 2
    assert first == second
    assert first.canPlay is True
    assert first.playUrl == "https://example.test/song.mp3"


def test_local_music_service_reads_embedded_metadata_and_cover(tmp_path: Path, monkeypatch) -> None:
    (tmp_path / "songs").mkdir()
    (tmp_path / "songs" / "song-01.mp3").write_bytes(b"not-real-audio")

    class Frame:
        def __init__(self, text: str) -> None:
            self.text = [text]

    class FakeAudio:
        tags = {"TIT2": Frame("Embedded title"), "TPE1": Frame("Embedded artist"), "TALB": Frame("Embedded album")}
        info = type("Info", (), {"length": 120.0})()
        pictures = [type("Picture", (), {"data": b"embedded-cover", "mime": "image/jpeg"})()]

    monkeypatch.setattr(local_music_module, "mutagen_file", lambda path, easy=False: FakeAudio())
    (tmp_path / "playlist.json").write_text(json.dumps({
        "id": "local",
        "tracks": [{
            "id": "song-01",
            "name": "定位名称",
        }],
    }), encoding="utf-8")

    service = LocalMusicService(tmp_path)
    playlist = service.get_playlist()
    url = service.get_track_url("song-01")

    assert playlist.source == "local"
    assert playlist.available is True
    assert playlist.tracks[0].title == "Embedded title"
    assert playlist.tracks[0].artist == "Embedded artist"
    assert playlist.tracks[0].album == "Embedded album"
    assert playlist.tracks[0].durationMs == 120000
    assert playlist.tracks[0].coverUrl == "/api/v1/music/tracks/song-01/cover"
    assert url.playUrl == "/music/songs/song-01.mp3"
    assert url.canPlay is True
    assert service.get_track_cover("song-01") == (b"embedded-cover", "image/jpeg")


def test_local_music_api_uses_the_same_frontend_contract(tmp_path: Path, monkeypatch) -> None:
    (tmp_path / "song.mp3").write_bytes(b"not-real-audio")
    (tmp_path / "playlist.json").write_text(json.dumps({
        "tracks": [{"id": "song", "name": "Song"}],
    }), encoding="utf-8")
    monkeypatch.setattr(main, "music_service", LocalMusicService(tmp_path))
    client = TestClient(main.app)

    playlist = client.get("/api/v1/music/playlist")
    track_url = client.get("/api/v1/music/tracks/song/url")

    assert playlist.status_code == 200
    assert playlist.json()["source"] == "local"
    assert track_url.status_code == 200
    assert track_url.json()["playUrl"] == "/music/song.mp3"
