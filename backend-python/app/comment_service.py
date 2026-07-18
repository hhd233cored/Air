"""SQLite comment storage shared by the public API and local editor."""

from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

from .article_service import ArticleNotFoundError, ArticleService
from .auth_service import ROLE_ADMIN, UserRecord
from .chatter_service import ChatterNotFoundError, ChatterService
from .comment_models import Comment, CommentAuthor, CommentPageResponse


COMMENT_VISIBLE = "VISIBLE"
COMMENT_HIDDEN = "HIDDEN"
COMMENT_DELETED = "DELETED"
COMMENT_STATUSES = {COMMENT_VISIBLE, COMMENT_HIDDEN, COMMENT_DELETED}
TARGET_ARTICLE = "ARTICLE"
TARGET_CHATTER = "CHATTER"
TARGET_TYPES = {TARGET_ARTICLE, TARGET_CHATTER}


class CommentError(Exception):
    def __init__(self, code: str, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.code = code
        self.status_code = status_code


class CommentTargetNotFoundError(CommentError):
    def __init__(self, target_type: str, slug: str) -> None:
        super().__init__(
            "COMMENT_TARGET_NOT_FOUND",
            f"Comment target not found: {target_type}/{slug}",
            404,
        )


def _timestamp() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


class CommentService:
    def __init__(
        self,
        database_path: Path,
        article_service: ArticleService,
        chatter_service: ChatterService,
        max_length: int = 1000,
    ) -> None:
        self.database_path = database_path.resolve()
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        self.article_service = article_service
        self.chatter_service = chatter_service
        self.max_length = max(1, max_length)
        self.initialize_schema()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database_path, timeout=5)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 5000")
        return connection

    def initialize_schema(self) -> None:
        with self._connect() as connection:
            connection.execute("PRAGMA journal_mode = WAL")
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS comments (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    target_type TEXT NOT NULL CHECK (target_type IN ('ARTICLE', 'CHATTER')),
                    target_id TEXT NOT NULL,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    parent_id INTEGER NULL REFERENCES comments(id) ON DELETE CASCADE,
                    content TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'VISIBLE'
                        CHECK (status IN ('VISIBLE', 'HIDDEN', 'DELETED')),
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_comments_target
                    ON comments(target_type, target_id, status, created_at);
                CREATE INDEX IF NOT EXISTS idx_comments_user
                    ON comments(user_id, created_at);
                """
            )

    def _resolve_target(self, target_type: str, slug: str) -> str:
        normalized_type = target_type.upper()
        if normalized_type == TARGET_ARTICLE:
            try:
                article = self.article_service.get_published(slug)
            except ArticleNotFoundError as exc:
                raise CommentTargetNotFoundError(normalized_type, slug) from exc
            return article.slug
        if normalized_type == TARGET_CHATTER:
            try:
                chatter = self.chatter_service.get_published(slug)
            except ChatterNotFoundError as exc:
                raise CommentTargetNotFoundError(normalized_type, slug) from exc
            return chatter.slug
        raise CommentError("COMMENT_INVALID_TARGET", "Unsupported comment target", 400)

    def list_public(self, target_type: str, slug: str, page: int, size: int) -> CommentPageResponse:
        target_id = self._resolve_target(target_type, slug)
        with self._connect() as connection:
            total = connection.execute(
                """
                SELECT COUNT(*) FROM comments
                WHERE target_type = ? AND target_id = ? AND status = 'VISIBLE'
                  AND (parent_id IS NULL OR EXISTS (
                      SELECT 1 FROM comments parent
                      WHERE parent.id = comments.parent_id AND parent.status = 'VISIBLE'
                  ))
                """,
                (target_type.upper(), target_id),
            ).fetchone()[0]
            rows = connection.execute(
                """
                SELECT c.*, u.username, u.avatar_data, u.avatar_updated_at
                FROM comments c JOIN users u ON u.id = c.user_id
                WHERE c.target_type = ? AND c.target_id = ? AND c.status = 'VISIBLE'
                  AND (c.parent_id IS NULL OR EXISTS (
                      SELECT 1 FROM comments parent
                      WHERE parent.id = c.parent_id AND parent.status = 'VISIBLE'
                  ))
                ORDER BY c.created_at ASC, c.id ASC
                LIMIT ? OFFSET ?
                """,
                (target_type.upper(), target_id, size, page * size),
            ).fetchall()
        return CommentPageResponse(
            content=[self._to_model(row) for row in rows],
            page=page,
            size=size,
            totalElements=int(total),
            totalPages=0 if not total else (int(total) + size - 1) // size,
        )

    def create(
        self,
        target_type: str,
        slug: str,
        user: UserRecord,
        content: str,
        parent_id: int | None = None,
    ) -> Comment:
        normalized_type = target_type.upper()
        target_id = self._resolve_target(normalized_type, slug)
        normalized_content = content.strip()
        if not normalized_content:
            raise CommentError("COMMENT_EMPTY", "Comment content cannot be empty", 400)
        if len(normalized_content) > self.max_length:
            raise CommentError("COMMENT_TOO_LONG", "Comment content is too long", 400)

        now = _timestamp()
        with self._connect() as connection:
            if parent_id is not None:
                parent = connection.execute(
                    "SELECT target_type, target_id, parent_id, status FROM comments WHERE id = ?",
                    (parent_id,),
                ).fetchone()
                if parent is None:
                    raise CommentError("COMMENT_INVALID_PARENT", "Parent comment does not exist", 400)
                if (
                    parent["status"] != COMMENT_VISIBLE
                    or
                    parent["target_type"] != normalized_type
                    or parent["target_id"] != target_id
                    or parent["parent_id"] is not None
                ):
                    raise CommentError("COMMENT_INVALID_PARENT", "Only one reply level is supported", 400)
            cursor = connection.execute(
                """
                INSERT INTO comments
                    (target_type, target_id, user_id, parent_id, content, status, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, 'VISIBLE', ?, ?)
                """,
                (normalized_type, target_id, user.id, parent_id, normalized_content, now, now),
            )
            comment_id = int(cursor.lastrowid)
            row = connection.execute(
                """
                SELECT c.*, u.username, u.avatar_data, u.avatar_updated_at
                FROM comments c JOIN users u ON u.id = c.user_id WHERE c.id = ?
                """,
                (comment_id,),
            ).fetchone()
        return self._to_model(row)

    def delete(self, comment_id: int, user: UserRecord) -> None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT user_id FROM comments WHERE id = ?",
                (comment_id,),
            ).fetchone()
            if row is None:
                raise CommentError("COMMENT_NOT_FOUND", "Comment not found", 404)
            if user.role != ROLE_ADMIN and int(row["user_id"]) != user.id:
                raise CommentError("AUTH_FORBIDDEN", "You cannot delete this comment", 403)
            connection.execute(
                "UPDATE comments SET status = 'DELETED', updated_at = ? WHERE id = ?",
                (_timestamp(), comment_id),
            )

    def list_admin(self, status: str | None, page: int, size: int) -> CommentPageResponse:
        normalized_status = status.upper() if status else None
        if normalized_status is not None and normalized_status not in COMMENT_STATUSES:
            raise CommentError("COMMENT_INVALID_STATUS", "Unsupported comment status", 400)
        where = "WHERE c.status = ?" if normalized_status else ""
        values: tuple[object, ...] = (normalized_status,) if normalized_status else ()
        with self._connect() as connection:
            total = connection.execute(
                f"SELECT COUNT(*) FROM comments c {where}", values,
            ).fetchone()[0]
            rows = connection.execute(
                f"""
                SELECT c.*, u.username, u.avatar_data, u.avatar_updated_at FROM comments c JOIN users u ON u.id = c.user_id
                {where} ORDER BY c.created_at DESC, c.id DESC LIMIT ? OFFSET ?
                """,
                (*values, size, page * size),
            ).fetchall()
        return CommentPageResponse(
            content=[self._to_model(row) for row in rows],
            page=page,
            size=size,
            totalElements=int(total),
            totalPages=0 if not total else (int(total) + size - 1) // size,
        )

    def update_status(self, comment_id: int, status: str) -> Comment:
        normalized_status = status.upper()
        if normalized_status not in COMMENT_STATUSES:
            raise CommentError("COMMENT_INVALID_STATUS", "Unsupported comment status", 400)
        with self._connect() as connection:
            connection.execute(
                "UPDATE comments SET status = ?, updated_at = ? WHERE id = ?",
                (normalized_status, _timestamp(), comment_id),
            )
            row = connection.execute(
                """
                SELECT c.*, u.username, u.avatar_data, u.avatar_updated_at FROM comments c JOIN users u ON u.id = c.user_id
                WHERE c.id = ?
                """,
                (comment_id,),
            ).fetchone()
        if row is None:
            raise CommentError("COMMENT_NOT_FOUND", "Comment not found", 404)
        return self._to_model(row)

    @staticmethod
    def _to_model(row: sqlite3.Row) -> Comment:
        avatar_url = None
        if row["avatar_data"] is not None:
            version = quote(str(row["avatar_updated_at"] or "1"), safe="")
            avatar_url = f"/api/v1/users/{int(row['user_id'])}/avatar?v={version}"
        return Comment(
            id=int(row["id"]),
            targetType=str(row["target_type"]),
            targetId=str(row["target_id"]),
            parentId=int(row["parent_id"]) if row["parent_id"] is not None else None,
            content=str(row["content"]),
            status=str(row["status"]),
            author=CommentAuthor(
                id=int(row["user_id"]),
                username=str(row["username"]),
                avatarUrl=avatar_url,
            ),
            createdAt=str(row["created_at"]),
            updatedAt=str(row["updated_at"]),
        )
