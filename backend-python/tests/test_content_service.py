from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[2]
import sys

sys.path.insert(0, str(PROJECT_ROOT / "backend-python"))

from app.content_service import (  # noqa: E402
    ARTICLE,
    CHATTER,
    ContentStore,
    DatabaseArticleService,
    DatabaseChatterService,
    to_search_page,
)
from app import main  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402


def store(tmp_path: Path) -> ContentStore:
    return ContentStore(tmp_path / "auth.sqlite3", tmp_path / "articles", tmp_path / "chatter")


def test_database_content_public_reads_and_search(tmp_path: Path) -> None:
    content = store(tmp_path)
    content.upsert(
        content_id="article-1",
        content_type=ARTICLE,
        slug="first-note",
        title="First note",
        summary="A quiet website",
        tags=["notes", "中文"],
        content_markdown="# 网站笔记\n\nSQLite search body",
        cover_path=None,
        status="PUBLISHED",
        published_at="2026-07-18T12:00:00Z",
        created_at="2026-07-18T12:00:00Z",
        updated_at="2026-07-18T12:00:00Z",
    )
    content.upsert(
        content_id="article-draft",
        content_type=ARTICLE,
        slug="draft",
        title="Draft",
        summary=None,
        tags=[],
        content_markdown="private",
        cover_path=None,
        status="DRAFT",
        published_at=None,
        created_at="2026-07-19T12:00:00Z",
        updated_at="2026-07-19T12:00:00Z",
    )
    content.upsert(
        content_id="chatter-1",
        content_type=CHATTER,
        slug="slow-down",
        title=None,
        summary=None,
        tags=[],
        content_markdown="慢一点，今天也值得记录。",
        cover_path=None,
        status="PUBLISHED",
        published_at="2026-07-17T12:00:00Z",
        created_at="2026-07-17T12:00:00Z",
        updated_at="2026-07-17T12:00:00Z",
    )

    article = DatabaseArticleService(content).list_published(0, 10, q="SQLite")
    assert article.totalElements == 1
    assert article.content[0].slug == "first-note"
    assert DatabaseArticleService(content).get_published("FIRST-NOTE").contentMarkdown.startswith("# 网站")
    assert DatabaseArticleService(content).list_published(0, 10).totalElements == 1
    assert DatabaseChatterService(content).list_published(0, 10).content[0].slug == "slow-down"

    search = to_search_page(content, "中文", "ALL", 0, 10)
    assert search.totalElements == 1
    assert search.content[0].contentType == ARTICLE


def test_database_content_soft_delete_and_slug_lookup(tmp_path: Path) -> None:
    content = store(tmp_path)
    content.upsert(
        content_id="article-1", content_type=ARTICLE, slug="to-delete", title="Delete me",
        summary=None, tags=[], content_markdown="body", cover_path=None, status="PUBLISHED",
        published_at="2026-07-18T12:00:00Z", created_at="2026-07-18T12:00:00Z", updated_at="2026-07-18T12:00:00Z",
    )
    content.soft_delete(ARTICLE, "to-delete")
    assert DatabaseArticleService(content).list_published(0, 10).totalElements == 0
    with pytest.raises(Exception):
        DatabaseArticleService(content).get_published("to-delete")


def test_fts5_is_present(tmp_path: Path) -> None:
    content = store(tmp_path)
    with content.connect() as connection:
        row = connection.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'content_search'",
        ).fetchone()
    assert row is not None


def test_database_mode_api_contract(tmp_path: Path, monkeypatch) -> None:
    content = store(tmp_path)
    content.upsert(
        content_id="article-1", content_type=ARTICLE, slug="api-article", title="API article",
        summary="Searchable", tags=["api"], content_markdown="# Body", cover_path=None,
        status="PUBLISHED", published_at="2026-07-18T12:00:00Z", created_at="2026-07-18T12:00:00Z",
        updated_at="2026-07-18T12:00:00Z",
    )
    content.upsert(
        content_id="chatter-1", content_type=CHATTER, slug="api-chatter", title=None, summary=None,
        tags=[], content_markdown="A chatter body", cover_path=None, status="PUBLISHED",
        published_at="2026-07-17T12:00:00Z", created_at="2026-07-17T12:00:00Z",
        updated_at="2026-07-17T12:00:00Z",
    )
    monkeypatch.setattr(main, "content_store", content)
    monkeypatch.setattr(main, "article_service", DatabaseArticleService(content))
    monkeypatch.setattr(main, "chatter_service", DatabaseChatterService(content))
    client = TestClient(main.app)

    assert client.get("/api/v1/articles?size=10").json()["content"][0]["slug"] == "api-article"
    assert client.get("/api/v1/articles/api-article").json()["contentMarkdown"] == "# Body"
    assert client.get("/api/v1/chatter?size=10").json()["content"][0]["slug"] == "api-chatter"
    assert client.get("/api/v1/search?q=Search&type=ARTICLE").json()["totalElements"] == 1
