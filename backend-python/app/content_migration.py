"""Migrate file-based articles and chatter into the shared SQLite database.

Run from the project root with ``python -m app.content_migration`` after the
environment has been loaded by the accompanying PowerShell script.
"""

from __future__ import annotations

import argparse
import json
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .config import Settings
from .content_service import ARTICLE, CHATTER, ContentStore, _tags
from .editor_service import VALID_STATUSES
from .markdown_io import read_markdown


@dataclass(frozen=True)
class SourceRecord:
    content_id: str
    content_type: str
    slug: str
    title: str | None
    summary: str | None
    tags: list[str]
    markdown: str
    cover: str | None
    status: str
    published_at: str | None
    created_at: str
    updated_at: str


def _read_timestamp(raw: Any, fallback: str) -> str:
    return str(raw).strip() if raw else fallback


def scan_root(root: Path, content_type: str) -> tuple[list[SourceRecord], list[str]]:
    records: list[SourceRecord] = []
    errors: list[str] = []
    metadata_name = "article.json" if content_type == ARTICLE else "chatter.json"
    markdown_name = "article.md" if content_type == ARTICLE else "chatter.md"
    if not root.is_dir():
        return records, errors

    for folder in sorted(root.iterdir(), key=lambda item: item.name):
        if not folder.is_dir() or folder.name.startswith("."):
            continue
        metadata_path = folder / metadata_name
        markdown_path = folder / markdown_name
        if not metadata_path.is_file() or not markdown_path.is_file():
            continue
        try:
            raw = json.loads(metadata_path.read_text(encoding="utf-8"))
            if not isinstance(raw, dict):
                raise ValueError("metadata must be an object")
            slug = str(raw.get("slug") or "").strip().lower()
            if not slug or slug != folder.name.lower():
                raise ValueError("folder name and slug must match")
            status = str(raw.get("status") or "DRAFT").upper()
            if status not in VALID_STATUSES:
                raise ValueError("status must be DRAFT, PUBLISHED or ARCHIVED")
            markdown = read_markdown(markdown_path)
            created = _read_timestamp(raw.get("createdAt"), _read_timestamp(raw.get("publishedAt"), "1970-01-01T00:00:00Z"))
            updated = _read_timestamp(raw.get("updatedAt"), created)
            records.append(SourceRecord(
                content_id=str(raw.get("id") or f"{content_type.lower()}-{uuid.uuid4().hex}"),
                content_type=content_type,
                slug=slug,
                title=str(raw.get("title") or "") if content_type == ARTICLE else None,
                summary=raw.get("summary") if content_type == ARTICLE and isinstance(raw.get("summary"), str) else None,
                tags=_tags(raw.get("tags") or []),
                markdown=markdown,
                cover=str(raw.get("cover") or "") or None if content_type == ARTICLE else None,
                status=status,
                published_at=str(raw.get("publishedAt")).strip() if raw.get("publishedAt") else None,
                created_at=created,
                updated_at=updated,
            ))
            if content_type == ARTICLE and not raw.get("title"):
                raise ValueError("article title is required")
        except (OSError, ValueError, TypeError, json.JSONDecodeError) as exc:
            errors.append(f"{metadata_path}: {exc}")
    return records, errors


def migrate(settings: Settings, dry_run: bool = False) -> int:
    articles, article_errors = scan_root(settings.article_content_dir, ARTICLE)
    chatter, chatter_errors = scan_root(settings.chatter_content_dir, CHATTER)
    errors = article_errors + chatter_errors
    print(f"扫描文章: {len(articles)} 条；说说: {len(chatter)} 条")
    if errors:
        for error in errors:
            print(f"错误: {error}")
        raise RuntimeError("存在无效内容，迁移已中止")
    records = articles + chatter
    duplicate_keys = {(record.content_type, record.slug) for record in records}
    if len(duplicate_keys) != len(records):
        raise RuntimeError("文章或说说存在重复的 type + slug")
    if dry_run:
        print("DryRun: 未写入数据库")
        return 0

    store = ContentStore(settings.auth_database_path, settings.article_content_dir, settings.chatter_content_dir)
    with store.connect() as connection:
        for record in records:
            store.upsert_on_connection(
                connection,
                content_id=record.content_id,
                content_type=record.content_type,
                slug=record.slug,
                title=record.title,
                summary=record.summary,
                tags=record.tags,
                content_markdown=record.markdown,
                cover_path=record.cover,
                status=record.status,
                published_at=record.published_at,
                created_at=record.created_at,
                updated_at=record.updated_at,
            )
        # Rebuild once at the end so rerunning the migration cannot leave stale
        # FTS rows when a source record's ID changed.
        connection.execute("DELETE FROM content_search")
        connection.execute(
            """INSERT INTO content_search(content_id, content_type, slug, title, summary, tags, content_markdown)
               SELECT id, content_type, slug, COALESCE(title, ''), COALESCE(summary, ''),
                      tags_json, content_markdown FROM content_items WHERE deleted_at IS NULL"""
        )
        fts_count = int(connection.execute("SELECT COUNT(*) FROM content_search").fetchone()[0])
        article_count = int(connection.execute("SELECT COUNT(*) FROM content_items WHERE content_type = 'ARTICLE' AND deleted_at IS NULL").fetchone()[0])
        chatter_count = int(connection.execute("SELECT COUNT(*) FROM content_items WHERE content_type = 'CHATTER' AND deleted_at IS NULL").fetchone()[0])
    print(f"迁移完成：文章 {article_count} 条，说说 {chatter_count} 条，FTS 索引 {fts_count} 条")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Migrate file content into SQLite")
    parser.add_argument("--dry-run", action="store_true", help="只检查，不写入数据库")
    args = parser.parse_args()
    return migrate(Settings.from_environment(), dry_run=args.dry_run)


if __name__ == "__main__":
    raise SystemExit(main())
