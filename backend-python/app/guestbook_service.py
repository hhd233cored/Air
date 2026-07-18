"""SQLite-backed guestbook messages."""

from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

from .auth_service import ROLE_ADMIN, UserRecord
from .comment_models import Comment, CommentAuthor, CommentPageResponse


GUESTBOOK_TARGET_ID = "main"


class GuestbookError(Exception):
    def __init__(self, code: str, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.code = code
        self.status_code = status_code


def _timestamp() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


class GuestbookService:
    def __init__(self, database_path: Path, max_length: int = 1000) -> None:
        self.database_path = database_path.resolve()
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
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
                CREATE TABLE IF NOT EXISTS guestbook_messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    content TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'VISIBLE'
                        CHECK (status IN ('VISIBLE', 'DELETED')),
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_guestbook_messages_status
                    ON guestbook_messages(status, created_at);
                CREATE INDEX IF NOT EXISTS idx_guestbook_messages_user
                    ON guestbook_messages(user_id, created_at);
                """
            )

    def list_public(self, page: int, size: int) -> CommentPageResponse:
        with self._connect() as connection:
            total = connection.execute(
                "SELECT COUNT(*) FROM guestbook_messages WHERE status = 'VISIBLE'",
            ).fetchone()[0]
            rows = connection.execute(
                """
                SELECT m.*, u.username, u.avatar_data, u.avatar_updated_at
                FROM guestbook_messages m
                JOIN users u ON u.id = m.user_id
                WHERE m.status = 'VISIBLE'
                ORDER BY m.created_at ASC, m.id ASC
                LIMIT ? OFFSET ?
                """,
                (size, page * size),
            ).fetchall()
        return CommentPageResponse(
            content=[self._to_model(row) for row in rows],
            page=page,
            size=size,
            totalElements=int(total),
            totalPages=0 if not total else (int(total) + size - 1) // size,
        )

    def create(self, user: UserRecord, content: str) -> Comment:
        normalized_content = content.strip()
        if not normalized_content:
            raise GuestbookError("GUESTBOOK_EMPTY", "Message content cannot be empty", 400)
        if len(normalized_content) > self.max_length:
            raise GuestbookError("GUESTBOOK_TOO_LONG", "Message content is too long", 400)

        now = _timestamp()
        with self._connect() as connection:
            cursor = connection.execute(
                """
                INSERT INTO guestbook_messages
                    (user_id, content, status, created_at, updated_at)
                VALUES (?, ?, 'VISIBLE', ?, ?)
                """,
                (user.id, normalized_content, now, now),
            )
            message_id = int(cursor.lastrowid)
            row = connection.execute(
                """
                SELECT m.*, u.username, u.avatar_data, u.avatar_updated_at
                FROM guestbook_messages m
                JOIN users u ON u.id = m.user_id
                WHERE m.id = ?
                """,
                (message_id,),
            ).fetchone()
        return self._to_model(row)

    def delete(self, message_id: int, user: UserRecord) -> None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT user_id FROM guestbook_messages WHERE id = ? AND status = 'VISIBLE'",
                (message_id,),
            ).fetchone()
            if row is None:
                raise GuestbookError("GUESTBOOK_NOT_FOUND", "Message not found", 404)
            if user.role != ROLE_ADMIN and int(row["user_id"]) != user.id:
                raise GuestbookError("AUTH_FORBIDDEN", "You cannot delete this message", 403)
            connection.execute(
                "UPDATE guestbook_messages SET status = 'DELETED', updated_at = ? WHERE id = ?",
                (_timestamp(), message_id),
            )

    @staticmethod
    def _to_model(row: sqlite3.Row) -> Comment:
        avatar_url = None
        if row["avatar_data"] is not None:
            version = quote(str(row["avatar_updated_at"] or "1"), safe="")
            avatar_url = f"/api/v1/users/{int(row['user_id'])}/avatar?v={version}"
        return Comment(
            id=int(row["id"]),
            targetType="GUESTBOOK",
            targetId=GUESTBOOK_TARGET_ID,
            parentId=None,
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
