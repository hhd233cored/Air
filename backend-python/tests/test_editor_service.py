from __future__ import annotations

import asyncio
import io
import json
import sys
from pathlib import Path

from fastapi import UploadFile

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "backend-python"))

from app.editor_service import ArticleEditorService, EditorArticleConflictError, EditorError


def upload(name: str, content: bytes) -> UploadFile:
    return UploadFile(file=io.BytesIO(content), filename=name)


def test_editor_creates_article_cover_assets_and_index(tmp_path: Path) -> None:
    service = ArticleEditorService(tmp_path)
    article = asyncio.run(service.create_article(
        title="A quiet corner",
        slug=None,
        summary="A short summary",
        tags="notes, personal",
        status="PUBLISHED",
        published_at=None,
        content_markdown="![A note](/articles/a-quiet-corner/assets/note.png)",
        cover=upload("cover.png", b"cover"),
        assets=[upload("note.png", b"asset")],
    ))

    folder = tmp_path / article.slug
    assert article.slug == "a-quiet-corner"
    assert article.coverUrl == "/articles/a-quiet-corner/cover.png"
    assert (folder / "article.md").read_text(encoding="utf-8").startswith("![A note]")
    assert (folder / "cover.png").read_bytes() == b"cover"
    assert (folder / "assets" / "note.png").read_bytes() == b"asset"
    assert json.loads((tmp_path / "index.json").read_text(encoding="utf-8"))[0]["slug"] == article.slug


def test_editor_lists_drafts_and_rejects_duplicate_slugs(tmp_path: Path) -> None:
    service = ArticleEditorService(tmp_path)
    asyncio.run(service.create_article(
        title="Draft",
        slug="draft",
        summary=None,
        tags=None,
        status="DRAFT",
        published_at=None,
        content_markdown="Draft body",
        cover=upload("cover.jpg", b"cover"),
    ))

    page = service.list_articles(0, 10)
    assert page.totalElements == 1
    assert page.content[0].status == "DRAFT"
    assert json.loads((tmp_path / "index.json").read_text(encoding="utf-8")) == []

    try:
        asyncio.run(service.create_article(
            title="Duplicate",
            slug="draft",
            summary=None,
            tags=None,
            status="DRAFT",
            published_at=None,
            content_markdown="Duplicate",
            cover=upload("cover.jpg", b"cover"),
        ))
    except EditorError as error:
        assert isinstance(error, EditorArticleConflictError)
    else:
        raise AssertionError("duplicate slug should fail")


def test_editor_update_preserves_existing_assets(tmp_path: Path) -> None:
    service = ArticleEditorService(tmp_path)
    created = asyncio.run(service.create_article(
        title="Editable",
        slug="editable",
        summary=None,
        tags=None,
        status="DRAFT",
        published_at=None,
        content_markdown="Body",
        cover=upload("cover.webp", b"cover"),
        assets=[upload("keep.jpg", b"keep")],
    ))

    updated = asyncio.run(service.update_article(
        created.slug,
        title="Edited",
        new_slug="edited",
        summary="Updated",
        tags="updated",
        status="PUBLISHED",
        published_at=None,
        content_markdown="Updated body",
        cover=None,
    ))

    assert updated.slug == "edited"
    assert (tmp_path / "edited" / "assets" / "keep.jpg").read_bytes() == b"keep"
    assert not (tmp_path / "editable").exists()


def test_editor_delete_removes_article_and_rebuilds_index(tmp_path: Path) -> None:
    service = ArticleEditorService(tmp_path)
    asyncio.run(service.create_article(
        title="To remove",
        slug="to-remove",
        summary=None,
        tags=None,
        status="PUBLISHED",
        published_at=None,
        content_markdown="Body",
        cover=upload("cover.png", b"cover"),
    ))

    service.delete_article("to-remove")

    assert not (tmp_path / "to-remove").exists()
    assert json.loads((tmp_path / "index.json").read_text(encoding="utf-8")) == []
