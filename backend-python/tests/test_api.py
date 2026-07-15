from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from fastapi.testclient import TestClient

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "backend-python"))

from app.article_service import ArticleService  # noqa: E402
from app.historical_service import HistoricalTodayService  # noqa: E402
import app.historical_service as historical_module  # noqa: E402
import app.main as main  # noqa: E402


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
