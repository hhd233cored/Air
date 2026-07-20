"""SQLite-backed content storage for articles and chatter.

The same SQLite file used by authentication/comments is used here.  Markdown
is kept in the database while cover and asset files remain in their existing
public folders so the static frontend can continue serving them.
"""

from __future__ import annotations

import json
import re
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from fastapi import UploadFile

from .article_service import ArticleNotFoundError
from .chatter_models import ChatterDetail, ChatterPageResponse, ChatterSummary
from .chatter_service import ChatterNotFoundError, build_preview
from .content_models import ContentSearchPageResponse, ContentSearchResult
from .editor_models import EditorArticleDetail, EditorArticlePageResponse, EditorArticleSummary
from .editor_service import (
    ALLOWED_ASSET_EXTENSIONS,
    ALLOWED_COVER_EXTENSIONS,
    EditorArticleConflictError,
    EditorArticleNotFoundError,
    EditorError,
    VALID_STATUSES,
    _normalize_slug,
    _parse_optional_timestamp,
    _safe_filename,
    slug_from_title,
)
from .markdown_io import normalize_markdown, write_markdown
from .models import ArticleDetail, ArticlePageResponse, ArticleSummary


ARTICLE = "ARTICLE"
CHATTER = "CHATTER"


class ContentStorageError(Exception):
    def __init__(self, code: str, message: str, status_code: int = 503) -> None:
        super().__init__(message)
        self.code = code
        self.status_code = status_code


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _tags(value: Any) -> list[str]:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            value = []
    if not isinstance(value, list):
        return []
    return list(dict.fromkeys(str(item).strip() for item in value if str(item).strip()))


def _json_tags(value: Any) -> str:
    return json.dumps(_tags(value), ensure_ascii=False)


def _is_inside(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
        return True
    except ValueError:
        return False


class ContentStore:
    """Low-level content table and FTS5 access."""

    def __init__(self, database_path: Path, article_root: Path, chatter_root: Path) -> None:
        self.database_path = database_path.resolve()
        self.article_root = article_root.resolve()
        self.chatter_root = chatter_root.resolve()
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        self.article_root.mkdir(parents=True, exist_ok=True)
        self.chatter_root.mkdir(parents=True, exist_ok=True)
        self.initialize_schema()

    def connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database_path, timeout=5)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 5000")
        return connection

    def initialize_schema(self) -> None:
        with self.connect() as connection:
            connection.execute("PRAGMA journal_mode = WAL")
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS content_items (
                    id TEXT PRIMARY KEY,
                    content_type TEXT NOT NULL CHECK (content_type IN ('ARTICLE', 'CHATTER')),
                    slug TEXT NOT NULL,
                    title TEXT NULL,
                    summary TEXT NULL,
                    tags_json TEXT NOT NULL DEFAULT '[]',
                    content_markdown TEXT NOT NULL,
                    cover_path TEXT NULL,
                    status TEXT NOT NULL CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
                    published_at TEXT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    deleted_at TEXT NULL,
                    UNIQUE(content_type, slug)
                );

                CREATE INDEX IF NOT EXISTS idx_content_type_status_published
                    ON content_items(content_type, status, published_at);
                CREATE INDEX IF NOT EXISTS idx_content_type_updated
                    ON content_items(content_type, updated_at);
                """
            )
            try:
                connection.execute(
                    """CREATE VIRTUAL TABLE IF NOT EXISTS content_search USING fts5(
                        content_id UNINDEXED,
                        content_type UNINDEXED,
                        slug UNINDEXED,
                        title,
                        summary,
                        tags,
                        content_markdown,
                        tokenize='unicode61'
                    )"""
                )
            except sqlite3.OperationalError as exc:
                raise ContentStorageError(
                    "CONTENT_FTS5_UNAVAILABLE",
                    "SQLite FTS5 is required for database content storage",
                    500,
                ) from exc

    def upsert(
        self,
        *,
        content_id: str,
        content_type: str,
        slug: str,
        title: str | None,
        summary: str | None,
        tags: Any,
        content_markdown: str,
        cover_path: str | None,
        status: str,
        published_at: str | None,
        created_at: str,
        updated_at: str,
    ) -> None:
        normalized_type = content_type.upper()
        if normalized_type not in {ARTICLE, CHATTER}:
            raise ContentStorageError("CONTENT_INVALID_TYPE", "Unsupported content type", 400)
        if status.upper() not in VALID_STATUSES:
            raise ContentStorageError("CONTENT_INVALID_STATUS", "Unsupported content status", 400)
        with self.connect() as connection:
            self.upsert_on_connection(
                connection,
                content_id=content_id,
                content_type=normalized_type,
                slug=slug,
                title=title,
                summary=summary,
                tags=tags,
                content_markdown=normalize_markdown(content_markdown),
                cover_path=cover_path,
                status=status.upper(),
                published_at=published_at,
                created_at=created_at,
                updated_at=updated_at,
            )

    def upsert_on_connection(
        self,
        connection: sqlite3.Connection,
        *,
        content_id: str,
        content_type: str,
        slug: str,
        title: str | None,
        summary: str | None,
        tags: Any,
        content_markdown: str,
        cover_path: str | None,
        status: str,
        published_at: str | None,
        created_at: str,
        updated_at: str,
    ) -> None:
        connection.execute(
            """
                INSERT INTO content_items
                    (id, content_type, slug, title, summary, tags_json, content_markdown,
                     cover_path, status, published_at, created_at, updated_at, deleted_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
                ON CONFLICT(content_type, slug) DO UPDATE SET
                    id = excluded.id,
                    title = excluded.title,
                    summary = excluded.summary,
                    tags_json = excluded.tags_json,
                    content_markdown = excluded.content_markdown,
                    cover_path = excluded.cover_path,
                    status = excluded.status,
                    published_at = excluded.published_at,
                    created_at = excluded.created_at,
                    updated_at = excluded.updated_at,
                    deleted_at = NULL
                """,
            (
                content_id, content_type, slug, title, summary, _json_tags(tags),
                normalize_markdown(content_markdown), cover_path, status, published_at, created_at, updated_at,
            ),
        )
        self._refresh_fts(connection, content_id)

    def soft_delete(self, content_type: str, slug: str) -> None:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT id FROM content_items WHERE content_type = ? AND slug = ? AND deleted_at IS NULL",
                (content_type, slug),
            ).fetchone()
            if row is None:
                raise EditorArticleNotFoundError(slug)
            connection.execute(
                "UPDATE content_items SET deleted_at = ?, updated_at = ? WHERE id = ?",
                (_now(), _now(), row["id"]),
            )
            connection.execute("DELETE FROM content_search WHERE content_id = ?", (row["id"],))

    def remove_slug_row(self, content_type: str, slug: str) -> None:
        """Remove the old unique-key row after a permitted draft slug change."""
        with self.connect() as connection:
            row = connection.execute(
                "SELECT id FROM content_items WHERE content_type = ? AND slug = ?",
                (content_type, slug),
            ).fetchone()
            if row is not None:
                connection.execute("DELETE FROM content_search WHERE content_id = ?", (row["id"],))
                connection.execute("DELETE FROM content_items WHERE id = ?", (row["id"],))

    def find(self, content_type: str, slug: str, include_deleted: bool = False) -> sqlite3.Row | None:
        where_deleted = "" if include_deleted else " AND deleted_at IS NULL"
        with self.connect() as connection:
            return connection.execute(
                f"SELECT * FROM content_items WHERE content_type = ? AND lower(slug) = lower(?) {where_deleted}",
                (content_type, slug),
            ).fetchone()

    def list_rows(
        self,
        content_type: str,
        page: int,
        size: int,
        *,
        public: bool,
        tag: str | None = None,
        query: str | None = None,
    ) -> tuple[list[sqlite3.Row], int]:
        with self.connect() as connection:
            rows = connection.execute(
                "SELECT * FROM content_items WHERE content_type = ? AND deleted_at IS NULL",
                (content_type,),
            ).fetchall()

        filtered: list[sqlite3.Row] = []
        normalized_tag = tag.strip().lower() if tag and tag.strip() else None
        normalized_query = query.strip().lower() if query and query.strip() else None
        for row in rows:
            if public and row["status"] != "PUBLISHED":
                continue
            if normalized_tag and normalized_tag not in {item.lower() for item in _tags(row["tags_json"])}:
                continue
            if normalized_query:
                searchable = "\n".join(
                    str(row[key] or "") for key in ("title", "summary", "tags_json", "content_markdown")
                ).lower()
                if normalized_query not in searchable and normalized_query not in str(row["id"]).lower():
                    continue
            filtered.append(row)

        if public:
            filtered.sort(key=lambda row: (row["published_at"] is not None, row["published_at"] or "", row["created_at"] or ""), reverse=True)
        else:
            filtered.sort(key=lambda row: (row["updated_at"] or "", row["created_at"] or ""), reverse=True)
        total = len(filtered)
        start = min(page * size, total)
        return filtered[start:start + size], total

    def search_rows(
        self,
        query: str,
        content_type: str,
        page: int,
        size: int,
    ) -> tuple[list[sqlite3.Row], int]:
        if not query.strip():
            raise ContentStorageError("CONTENT_EMPTY_QUERY", "Search query cannot be empty", 400)
        normalized_type = content_type.upper()
        if normalized_type not in {ARTICLE, CHATTER, "ALL"}:
            raise ContentStorageError("CONTENT_INVALID_TYPE", "type must be ARTICLE, CHATTER or ALL", 400)
        wanted_types = {ARTICLE, CHATTER} if normalized_type == "ALL" else {normalized_type}
        match_ids: set[str] = set()
        safe_match = '"' + query.replace('"', '""').strip() + '"'
        try:
            with self.connect() as connection:
                match_ids = {str(row["content_id"]) for row in connection.execute("SELECT content_id FROM content_search WHERE content_search MATCH ?", (safe_match,)).fetchall()}
        except sqlite3.OperationalError:
            match_ids = set()

        with self.connect() as connection:
            rows = connection.execute(
                "SELECT * FROM content_items WHERE deleted_at IS NULL AND status = 'PUBLISHED'",
            ).fetchall()
        needle = query.strip().lower()
        filtered = [
            row for row in rows
            if row["content_type"] in wanted_types
            and (
                row["id"] in match_ids
                or needle in "\n".join(str(row[key] or "") for key in ("title", "summary", "tags_json", "content_markdown")).lower()
            )
        ]
        filtered.sort(key=lambda row: (row["published_at"] is not None, row["published_at"] or "", row["created_at"] or ""), reverse=True)
        total = len(filtered)
        start = min(page * size, total)
        return filtered[start:start + size], total

    def has_comments(self, content_type: str, slug: str) -> bool:
        try:
            with self.connect() as connection:
                row = connection.execute(
                    "SELECT 1 FROM comments WHERE target_type = ? AND target_id = ? LIMIT 1",
                    (content_type, slug),
                ).fetchone()
                return row is not None
        except sqlite3.OperationalError:
            return False

    def _refresh_fts(self, connection: sqlite3.Connection, content_id: str) -> None:
        row = connection.execute("SELECT * FROM content_items WHERE id = ?", (content_id,)).fetchone()
        connection.execute("DELETE FROM content_search WHERE content_id = ?", (content_id,))
        if row is not None and row["deleted_at"] is None:
            connection.execute(
                "INSERT INTO content_search(content_id, content_type, slug, title, summary, tags, content_markdown) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (row["id"], row["content_type"], row["slug"], row["title"] or "", row["summary"] or "", " ".join(_tags(row["tags_json"])), row["content_markdown"]),
            )

    def rebuild_fts(self) -> int:
        with self.connect() as connection:
            connection.execute("DELETE FROM content_search")
            connection.execute(
                """INSERT INTO content_search(content_id, content_type, slug, title, summary, tags, content_markdown)
                   SELECT id, content_type, slug, COALESCE(title, ''), COALESCE(summary, ''),
                          tags_json, content_markdown FROM content_items WHERE deleted_at IS NULL"""
            )
            return int(connection.execute("SELECT COUNT(*) FROM content_search").fetchone()[0])

    def media_folder(self, content_type: str, slug: str) -> Path:
        root = self.article_root if content_type == ARTICLE else self.chatter_root
        folder = (root / slug).resolve()
        if not _is_inside(folder, root):
            raise EditorError("INVALID_PATH", "Content path is outside the content directory")
        return folder


def _article_summary(store: ContentStore, row: sqlite3.Row, editor: bool = False) -> ArticleSummary | EditorArticleSummary:
    cover = _cover_url(store, row) if row["content_type"] == ARTICLE else None
    model = EditorArticleSummary if editor else ArticleSummary
    return model(
        id=str(row["id"]), slug=row["slug"], title=row["title"] or "", summary=row["summary"],
        coverUrl=cover, tags=_tags(row["tags_json"]), status=row["status"],
        publishedAt=row["published_at"], createdAt=row["created_at"], updatedAt=row["updated_at"],
    )


def _cover_url(store: ContentStore, row: sqlite3.Row) -> str | None:
    cover = str(row["cover_path"] or "").replace("\\", "/").lstrip("/")
    if not cover or row["content_type"] != ARTICLE:
        return None
    folder = store.media_folder(ARTICLE, row["slug"])
    path = (folder / cover).resolve()
    if not _is_inside(path, folder) or not path.is_file():
        return None
    return f"/articles/{row['slug']}/{cover}"


def _page(page: int, size: int, total: int) -> int:
    return 0 if not total else (total + size - 1) // size


class DatabaseArticleService:
    def __init__(self, store: ContentStore) -> None:
        self.store = store

    def list_published(self, page: int, size: int, tag: str | None = None, q: str | None = None) -> ArticlePageResponse:
        rows, total = self.store.list_rows(ARTICLE, page, size, public=True, tag=tag, query=q)
        return ArticlePageResponse(content=[_article_summary(self.store, row) for row in rows], page=page, size=size, totalElements=total, totalPages=_page(page, size, total))

    def get_published(self, slug: str) -> ArticleDetail:
        row = self.store.find(ARTICLE, slug)
        if row is None or row["status"] != "PUBLISHED":
            raise ArticleNotFoundError(slug)
        summary = _article_summary(self.store, row)
        return ArticleDetail(**summary.model_dump(), contentMarkdown=row["content_markdown"])


class DatabaseChatterService:
    def __init__(self, store: ContentStore) -> None:
        self.store = store

    def list_published(self, page: int, size: int, q: str | None = None) -> ChatterPageResponse:
        rows, total = self.store.list_rows(CHATTER, page, size, public=True, query=q)
        return ChatterPageResponse(content=[self._summary(row) for row in rows], page=page, size=size, totalElements=total, totalPages=_page(page, size, total))

    def get_published(self, slug: str) -> ChatterDetail:
        row = self.store.find(CHATTER, slug)
        if row is None or row["status"] != "PUBLISHED":
            raise ChatterNotFoundError(slug)
        summary = self._summary(row)
        return ChatterDetail(**summary.model_dump(), contentMarkdown=row["content_markdown"])

    @staticmethod
    def _summary(row: sqlite3.Row) -> ChatterSummary:
        return ChatterSummary(id=str(row["id"]), slug=row["slug"], preview=build_preview(row["content_markdown"]), status=row["status"], publishedAt=row["published_at"], createdAt=row["created_at"], updatedAt=row["updated_at"])


class DatabaseArticleEditorService:
    def __init__(self, store: ContentStore) -> None:
        self.store = store

    def list_articles(self, page: int, size: int, q: str | None = None) -> EditorArticlePageResponse:
        rows, total = self.store.list_rows(ARTICLE, page, size, public=False, query=q)
        return EditorArticlePageResponse(content=[_article_summary(self.store, row, True) for row in rows], page=page, size=size, totalElements=total, totalPages=_page(page, size, total))

    def get_article(self, slug: str) -> EditorArticleDetail:
        row = self.store.find(ARTICLE, slug)
        if row is None:
            raise EditorArticleNotFoundError(slug)
        summary = _article_summary(self.store, row, True)
        return EditorArticleDetail(**summary.model_dump(), contentMarkdown=row["content_markdown"])

    async def create_article(self, *, title: str, slug: str | None, summary: str | None, tags: str | None, status: str | None, published_at: str | None, content_markdown: str, cover: UploadFile, assets: Iterable[UploadFile] = ()) -> EditorArticleDetail:
        clean_title = title.strip()
        if not clean_title:
            raise EditorError("INVALID_TITLE", "Title is required")
        clean_slug = _normalize_slug(slug) if slug and slug.strip() else slug_from_title(clean_title)
        if self.store.find(ARTICLE, clean_slug, include_deleted=True) is not None or self.store.media_folder(ARTICLE, clean_slug).exists():
            raise EditorArticleConflictError(clean_slug)
        cover_name = _safe_filename(cover.filename, ALLOWED_COVER_EXTENSIONS)
        status_value, published = self._status(status, published_at)
        now = _now()
        folder = self.store.media_folder(ARTICLE, clean_slug)
        folder.mkdir(parents=True, exist_ok=True)
        await self._save_upload(cover, folder / cover_name, ALLOWED_COVER_EXTENSIONS)
        await self._save_assets(folder, assets)
        content_id = f"article-{uuid.uuid4().hex}"
        self.store.upsert(content_id=content_id, content_type=ARTICLE, slug=clean_slug, title=clean_title, summary=summary.strip() if summary else None, tags=tags or [], content_markdown=content_markdown, cover_path=cover_name, status=status_value, published_at=published, created_at=now, updated_at=now)
        self._write_backup(folder, {"id": content_id, "slug": clean_slug, "title": clean_title, "summary": summary, "tags": _tags(tags or []), "status": status_value, "publishedAt": published, "createdAt": now, "updatedAt": now, "cover": cover_name}, content_markdown, "article")
        return self.get_article(clean_slug)

    async def update_article(self, slug: str, *, title: str, new_slug: str | None, summary: str | None, tags: str | None, status: str | None, published_at: str | None, content_markdown: str, cover: UploadFile | None, assets: Iterable[UploadFile] = ()) -> EditorArticleDetail:
        current = self.store.find(ARTICLE, slug)
        if current is None:
            raise EditorArticleNotFoundError(slug)
        clean_title = title.strip()
        if not clean_title:
            raise EditorError("INVALID_TITLE", "Title is required")
        current_slug = current["slug"]
        clean_slug = _normalize_slug(new_slug) if new_slug and new_slug.strip() else current_slug
        if clean_slug != current_slug:
            if current["status"] != "DRAFT" or self.store.has_comments(ARTICLE, current_slug):
                raise EditorError("CONTENT_SLUG_IMMUTABLE", "Published, archived or commented content cannot change its slug", 409)
            if self.store.find(ARTICLE, clean_slug, include_deleted=True) is not None or self.store.media_folder(ARTICLE, clean_slug).exists():
                raise EditorArticleConflictError(clean_slug)
        folder = self.store.media_folder(ARTICLE, current_slug)
        target = self.store.media_folder(ARTICLE, clean_slug)
        if clean_slug != current_slug:
            folder.rename(target)
            folder = target
            self.store.remove_slug_row(ARTICLE, current_slug)
        cover_name = str(current["cover_path"] or "")
        if cover is not None and cover.filename:
            cover_name = _safe_filename(cover.filename, ALLOWED_COVER_EXTENSIONS)
            await self._save_upload(cover, folder / cover_name, ALLOWED_COVER_EXTENSIONS)
        if not cover_name or not (folder / cover_name).is_file():
            raise EditorError("COVER_REQUIRED", "A cover image is required")
        await self._save_assets(folder, assets)
        status_value, published = self._status(status, published_at, current)
        updated = _now()
        self.store.upsert(content_id=str(current["id"]), content_type=ARTICLE, slug=clean_slug, title=clean_title, summary=summary.strip() if summary else None, tags=tags or current["tags_json"], content_markdown=content_markdown, cover_path=cover_name, status=status_value, published_at=published, created_at=str(current["created_at"]), updated_at=updated)
        self._write_backup(folder, {"id": current["id"], "slug": clean_slug, "title": clean_title, "summary": summary, "tags": _tags(tags or current["tags_json"]), "status": status_value, "publishedAt": published, "createdAt": current["created_at"], "updatedAt": updated, "cover": cover_name}, content_markdown, "article")
        return self.get_article(clean_slug)

    def delete_article(self, slug: str) -> None:
        self.store.soft_delete(ARTICLE, slug)

    @staticmethod
    def _status(status: str | None, published_at: str | None, current: sqlite3.Row | None = None) -> tuple[str, str | None]:
        value = (status or (current["status"] if current is not None else "DRAFT")).strip().upper()
        if value not in VALID_STATUSES:
            raise EditorError("INVALID_STATUS", "Status must be DRAFT, PUBLISHED or ARCHIVED")
        published = _parse_optional_timestamp(published_at, "publishedAt")
        if value == "PUBLISHED" and not published:
            published = (current["published_at"] if current is not None else None) or _now()
        return value, published

    async def _save_assets(self, folder: Path, assets: Iterable[UploadFile]) -> None:
        asset_folder = folder / "assets"
        for asset in assets:
            if asset is not None and asset.filename:
                asset_folder.mkdir(parents=True, exist_ok=True)
                name = _safe_filename(asset.filename, ALLOWED_ASSET_EXTENSIONS)
                await self._save_upload(asset, asset_folder / name, ALLOWED_ASSET_EXTENSIONS)

    @staticmethod
    async def _save_upload(upload: UploadFile, destination: Path, allowed: set[str]) -> None:
        _safe_filename(upload.filename, allowed)
        temporary = destination.with_name(f".{destination.name}.tmp-{uuid.uuid4().hex}")
        try:
            with temporary.open("wb") as output:
                await upload.seek(0)
                while chunk := await upload.read(1024 * 1024):
                    output.write(chunk)
            temporary.replace(destination)
        finally:
            if temporary.exists():
                temporary.unlink()

    @staticmethod
    def _write_backup(folder: Path, metadata: dict[str, Any], markdown: str, kind: str) -> None:
        markdown_path = folder / f"{kind}.md"
        metadata_path = folder / f"{kind}.json"
        markdown_temp = folder / f".{kind}.md.tmp-{uuid.uuid4().hex}"
        metadata_temp = folder / f".{kind}.json.tmp-{uuid.uuid4().hex}"
        try:
            write_markdown(markdown_temp, markdown)
            metadata_temp.write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            markdown_temp.replace(markdown_path)
            metadata_temp.replace(metadata_path)
        finally:
            if markdown_temp.exists():
                markdown_temp.unlink()
            if metadata_temp.exists():
                metadata_temp.unlink()


class DatabaseChatterEditorService:
    def __init__(self, store: ContentStore) -> None:
        self.store = store

    def list_entries(self, page: int, size: int, q: str | None = None) -> ChatterPageResponse:
        rows, total = self.store.list_rows(CHATTER, page, size, public=False, query=q)
        return ChatterPageResponse(content=[self._summary(row) for row in rows], page=page, size=size, totalElements=total, totalPages=_page(page, size, total))

    def get_entry(self, slug: str) -> ChatterDetail:
        row = self.store.find(CHATTER, slug)
        if row is None:
            raise EditorArticleNotFoundError(slug)
        summary = self._summary(row)
        return ChatterDetail(**summary.model_dump(), contentMarkdown=row["content_markdown"])

    async def create_entry(self, *, slug: str | None, status: str | None, published_at: str | None, content_markdown: str, assets: Iterable[UploadFile] = ()) -> ChatterDetail:
        if not content_markdown.strip():
            raise EditorError("INVALID_CONTENT", "Chatter content is required")
        clean_slug = _normalize_slug(slug) if slug and slug.strip() else self._slug_from_content(content_markdown)
        if self.store.find(CHATTER, clean_slug, include_deleted=True) is not None:
            raise EditorArticleConflictError(clean_slug)
        status_value, published = self._status(status, published_at)
        now = _now()
        content_id = f"chatter-{uuid.uuid4().hex}"
        self.store.upsert(content_id=content_id, content_type=CHATTER, slug=clean_slug, title=None, summary=None, tags=[], content_markdown=content_markdown, cover_path=None, status=status_value, published_at=published, created_at=now, updated_at=now)
        folder = self.store.media_folder(CHATTER, clean_slug)
        folder.mkdir(parents=True, exist_ok=True)
        await self._save_assets(folder, assets)
        self._write_backup(folder, {"id": content_id, "slug": clean_slug, "status": status_value, "publishedAt": published, "createdAt": now, "updatedAt": now}, content_markdown)
        return self.get_entry(clean_slug)

    async def update_entry(self, slug: str, *, new_slug: str | None, status: str | None, published_at: str | None, content_markdown: str, assets: Iterable[UploadFile] = ()) -> ChatterDetail:
        if not content_markdown.strip():
            raise EditorError("INVALID_CONTENT", "Chatter content is required")
        current = self.store.find(CHATTER, slug)
        if current is None:
            raise EditorArticleNotFoundError(slug)
        current_slug = current["slug"]
        clean_slug = _normalize_slug(new_slug) if new_slug and new_slug.strip() else current_slug
        if clean_slug != current_slug:
            if current["status"] != "DRAFT" or self.store.has_comments(CHATTER, current_slug):
                raise EditorError("CONTENT_SLUG_IMMUTABLE", "Published, archived or commented content cannot change its slug", 409)
            if self.store.find(CHATTER, clean_slug, include_deleted=True) is not None:
                raise EditorArticleConflictError(clean_slug)
        old = self.store.media_folder(CHATTER, current_slug)
        target = self.store.media_folder(CHATTER, clean_slug)
        if clean_slug != current_slug and old.exists():
            old.rename(target)
            self.store.remove_slug_row(CHATTER, current_slug)
        folder = target if clean_slug != current_slug else old
        folder.mkdir(parents=True, exist_ok=True)
        await self._save_assets(folder, assets)
        status_value, published = self._status(status, published_at, current)
        updated = _now()
        self.store.upsert(content_id=str(current["id"]), content_type=CHATTER, slug=clean_slug, title=None, summary=None, tags=[], content_markdown=content_markdown, cover_path=None, status=status_value, published_at=published, created_at=str(current["created_at"]), updated_at=updated)
        self._write_backup(folder, {"id": current["id"], "slug": clean_slug, "status": status_value, "publishedAt": published, "createdAt": current["created_at"], "updatedAt": updated}, content_markdown)
        return self.get_entry(clean_slug)

    def delete_entry(self, slug: str) -> None:
        self.store.soft_delete(CHATTER, slug)

    @staticmethod
    def _summary(row: sqlite3.Row) -> ChatterSummary:
        return ChatterSummary(id=str(row["id"]), slug=row["slug"], preview=build_preview(row["content_markdown"]), status=row["status"], publishedAt=row["published_at"], createdAt=row["created_at"], updatedAt=row["updated_at"])

    @staticmethod
    def _status(status: str | None, published_at: str | None, current: sqlite3.Row | None = None) -> tuple[str, str | None]:
        value = (status or (current["status"] if current is not None else "DRAFT")).strip().upper()
        if value not in VALID_STATUSES:
            raise EditorError("INVALID_STATUS", "Status must be DRAFT, PUBLISHED or ARCHIVED")
        published = _parse_optional_timestamp(published_at, "publishedAt")
        if value == "PUBLISHED" and not published:
            published = (current["published_at"] if current is not None else None) or _now()
        return value, published

    async def _save_assets(self, folder: Path, assets: Iterable[UploadFile]) -> None:
        asset_folder = folder / "assets"
        for asset in assets:
            if asset is not None and asset.filename:
                asset_folder.mkdir(parents=True, exist_ok=True)
                name = _safe_filename(asset.filename, ALLOWED_ASSET_EXTENSIONS)
                await self._save_upload(asset, asset_folder / name, ALLOWED_ASSET_EXTENSIONS)

    @staticmethod
    async def _save_upload(upload: UploadFile, destination: Path, allowed: set[str]) -> None:
        _safe_filename(upload.filename, allowed)
        temporary = destination.with_name(f".{destination.name}.tmp-{uuid.uuid4().hex}")
        try:
            with temporary.open("wb") as output:
                await upload.seek(0)
                while chunk := await upload.read(1024 * 1024):
                    output.write(chunk)
            temporary.replace(destination)
        finally:
            if temporary.exists():
                temporary.unlink()

    @staticmethod
    def _slug_from_content(content: str) -> str:
        first = next((line.strip() for line in content.splitlines() if line.strip()), "")
        slug = re.sub(r"[^a-z0-9]+", "-", first.lower()).strip("-")
        return slug[:80].strip("-") or f"chatter-{uuid.uuid4().hex[:12]}"

    @staticmethod
    def _write_backup(folder: Path, metadata: dict[str, Any], markdown: str) -> None:
        markdown_path = folder / "chatter.md"
        metadata_path = folder / "chatter.json"
        markdown_temp = folder / f".chatter.md.tmp-{uuid.uuid4().hex}"
        metadata_temp = folder / f".chatter.json.tmp-{uuid.uuid4().hex}"
        try:
            write_markdown(markdown_temp, markdown)
            metadata_temp.write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            markdown_temp.replace(markdown_path)
            metadata_temp.replace(metadata_path)
        finally:
            if markdown_temp.exists():
                markdown_temp.unlink()
            if metadata_temp.exists():
                metadata_temp.unlink()


def to_search_page(store: ContentStore, query: str, content_type: str, page: int, size: int) -> ContentSearchPageResponse:
    rows, total = store.search_rows(query, content_type, page, size)
    results: list[ContentSearchResult] = []
    for row in rows:
        results.append(ContentSearchResult(
            contentType=row["content_type"], id=str(row["id"]), slug=row["slug"],
            title=row["title"], preview=build_preview(row["content_markdown"]), summary=row["summary"],
            coverUrl=_cover_url(store, row), tags=_tags(row["tags_json"]), status=row["status"],
            publishedAt=row["published_at"], createdAt=row["created_at"], updatedAt=row["updated_at"],
        ))
    return ContentSearchPageResponse(content=results, page=page, size=size, totalElements=total, totalPages=_page(page, size, total))
