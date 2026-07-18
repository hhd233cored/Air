from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "backend-python"))

from app.article_service import ArticleService  # noqa: E402
from app.auth_service import AuthService  # noqa: E402
from app.chatter_service import ChatterService  # noqa: E402
from app.comment_service import CommentError, CommentService  # noqa: E402


def write_article(root: Path, slug: str) -> None:
    folder = root / slug
    folder.mkdir(parents=True)
    metadata = {
        "id": f"article-{slug}",
        "slug": slug,
        "title": slug,
        "status": "PUBLISHED",
        "publishedAt": "2026-07-18T00:00:00Z",
        "createdAt": "2026-07-18T00:00:00Z",
    }
    (folder / "article.json").write_text(json.dumps(metadata), encoding="utf-8")
    (folder / "article.md").write_text("# Article", encoding="utf-8")


def write_chatter(root: Path, slug: str) -> None:
    folder = root / slug
    folder.mkdir(parents=True)
    metadata = {
        "id": f"chatter-{slug}",
        "slug": slug,
        "status": "PUBLISHED",
        "publishedAt": "2026-07-18T00:00:00Z",
        "createdAt": "2026-07-18T00:00:00Z",
    }
    (folder / "chatter.json").write_text(json.dumps(metadata), encoding="utf-8")
    (folder / "chatter.md").write_text("A small note", encoding="utf-8")


def make_service(tmp_path: Path) -> tuple[CommentService, AuthService]:
    articles = tmp_path / "articles"
    chatter = tmp_path / "chatter"
    write_article(articles, "first-note")
    write_chatter(chatter, "slow-down")
    auth = AuthService(tmp_path / "auth.sqlite3", session_timeout_seconds=3600)
    auth.initialize_users(admin_username="admin", admin_password="admin-password")
    user, _, _ = auth.register("reader", "reader-password")
    service = CommentService(
        auth.database_path,
        ArticleService(articles),
        ChatterService(chatter),
        max_length=1000,
    )
    return service, auth


def test_comments_are_public_immediately_and_support_one_reply(tmp_path: Path) -> None:
    service, auth = make_service(tmp_path)
    user = auth.authenticate("reader", "reader-password")[0]

    first = service.create("ARTICLE", "first-note", user, "First comment")
    reply = service.create("ARTICLE", "first-note", user, "A reply", first.id)

    page = service.list_public("ARTICLE", "first-note", 0, 20)
    assert [comment.id for comment in page.content] == [first.id, reply.id]
    assert reply.parentId == first.id
    assert page.content[0].author.username == "reader"


def test_nested_replies_and_missing_targets_are_rejected(tmp_path: Path) -> None:
    service, auth = make_service(tmp_path)
    user = auth.authenticate("reader", "reader-password")[0]
    first = service.create("CHATTER", "slow-down", user, "First")
    reply = service.create("CHATTER", "slow-down", user, "Reply", first.id)

    with pytest.raises(CommentError) as nested:
        service.create("CHATTER", "slow-down", user, "Nested", reply.id)
    assert nested.value.code == "COMMENT_INVALID_PARENT"

    with pytest.raises(CommentError) as missing:
        service.list_public("ARTICLE", "missing", 0, 20)
    assert missing.value.code == "COMMENT_TARGET_NOT_FOUND"


def test_avatar_binary_is_stored_and_removed_from_user_record(tmp_path: Path) -> None:
    auth = AuthService(tmp_path / "auth.sqlite3", session_timeout_seconds=3600)
    auth.initialize_users(admin_username="admin", admin_password="admin-password")
    user = auth.authenticate("admin", "admin-password")[0]
    updated = auth.update_avatar(user.id, b"\x89PNG\r\n\x1a\nimage", "image/png")

    assert updated.avatar_present is True
    assert auth.get_avatar(user.id) == (b"\x89PNG\r\n\x1a\nimage", "image/png")
    cleared = auth.delete_avatar(user.id)
    assert cleared.avatar_present is False
    assert auth.get_avatar(user.id) is None
