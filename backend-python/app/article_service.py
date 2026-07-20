"""Read published articles from one-folder-per-article content storage."""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .models import ArticleDetail, ArticlePageResponse, ArticleSummary
from .markdown_io import read_markdown

logger = logging.getLogger(__name__)


class ArticleNotFoundError(Exception):
    def __init__(self, slug: str) -> None:
        super().__init__(f"Article not found: {slug}")
        self.slug = slug


@dataclass(frozen=True)
class ArticleMetadata:
    id: str | None
    slug: str
    title: str
    summary: str | None
    tags: tuple[str, ...]
    status: str
    published_at: str | None
    created_at: str | None
    updated_at: str | None
    cover: str | None
    published_sort: datetime | None
    created_sort: datetime | None


def _normalize_slug(value: str | None) -> str:
    return (value or "").strip().lower()


def _normalize_tag(value: str | None) -> str | None:
    if value is None or not value.strip():
        return None
    return value.strip().lower()


def _parse_timestamp(value: Any, field: str, path: Path) -> tuple[str | None, datetime | None]:
    if value is None or value == "":
        return None, None
    if not isinstance(value, str):
        raise ValueError(f"{field} must be an ISO timestamp")
    normalized = value.replace("Z", "+00:00")
    parsed = datetime.fromisoformat(normalized)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return value, parsed


class ArticleService:
    def __init__(self, articles_root: Path) -> None:
        self.articles_root = articles_root

    def list_published(self, page: int, size: int, tag: str | None, q: str | None = None) -> ArticlePageResponse:
        normalized_tag = _normalize_tag(tag)
        normalized_query = q.strip().lower() if q and q.strip() else None
        articles = [
            article
            for article in self._read_metadata()
            if article.status == "PUBLISHED"
            and (
                normalized_tag is None
                or normalized_tag in {_normalize_tag(article_tag) for article_tag in article.tags}
            )
            and (
                normalized_query is None
                or normalized_query in "\n".join((article.title, article.summary or "", " ".join(article.tags), self._read_body_for_query(article))).lower()
            )
        ]
        articles.sort(
            key=lambda article: (
                article.published_sort is not None,
                article.published_sort or datetime.min.replace(tzinfo=timezone.utc),
                article.created_sort is not None,
                article.created_sort or datetime.min.replace(tzinfo=timezone.utc),
            ),
            reverse=True,
        )

        start = min(page * size, len(articles))
        end = min(start + size, len(articles))
        total_pages = 0 if not articles else (len(articles) + size - 1) // size
        return ArticlePageResponse(
            content=[self._to_summary(article) for article in articles[start:end]],
            page=page,
            size=size,
            totalElements=len(articles),
            totalPages=total_pages,
        )

    def get_published(self, slug: str) -> ArticleDetail:
        metadata = next(
            (
                article
                for article in self._read_metadata()
                if article.status == "PUBLISHED"
                and _normalize_slug(article.slug) == _normalize_slug(slug)
            ),
            None,
        )
        if metadata is None:
            raise ArticleNotFoundError(slug)

        folder = self._folder_for(metadata)
        content_path = (folder / "article.md").resolve()
        if not self._is_inside(content_path, folder) or not content_path.is_file():
            raise ArticleNotFoundError(slug)
        try:
            markdown = read_markdown(content_path)
        except OSError as exc:
            logger.warning("Could not read article content for %s: %s", slug, exc)
            raise ArticleNotFoundError(slug) from exc

        summary = self._to_summary(metadata)
        return ArticleDetail(**summary.model_dump(), contentMarkdown=markdown)

    def _read_body_for_query(self, metadata: ArticleMetadata) -> str:
        if not metadata.slug:
            return ""
        path = (self.articles_root / _normalize_slug(metadata.slug) / "article.md").resolve()
        folder = (self.articles_root / _normalize_slug(metadata.slug)).resolve()
        if not self._is_inside(path, folder) or not path.is_file():
            return ""
        try:
            return read_markdown(path)
        except OSError:
            return ""

    def _read_metadata(self) -> list[ArticleMetadata]:
        if not self.articles_root.is_dir():
            return []
        result: list[ArticleMetadata] = []
        try:
            folders = list(self.articles_root.iterdir())
        except OSError as exc:
            logger.warning("Could not scan article directory %s: %s", self.articles_root, exc)
            return []

        for folder in folders:
            if not folder.is_dir():
                continue
            metadata_path = folder / "article.json"
            if not metadata_path.is_file():
                continue
            try:
                raw = json.loads(metadata_path.read_text(encoding="utf-8"))
                metadata = self._parse_metadata(raw, metadata_path)
                if _normalize_slug(metadata.slug) != _normalize_slug(folder.name):
                    logger.warning("Skipping article with mismatched folder and slug: %s", metadata_path)
                    continue
                result.append(metadata)
            except (OSError, ValueError, TypeError, json.JSONDecodeError) as exc:
                logger.warning("Skipping invalid article metadata %s: %s", metadata_path, exc)
        return result

    def _parse_metadata(self, raw: Any, path: Path) -> ArticleMetadata:
        if not isinstance(raw, dict):
            raise ValueError("metadata must be an object")
        slug = raw.get("slug")
        title = raw.get("title")
        if not isinstance(slug, str) or not slug.strip():
            raise ValueError("slug is required")
        if not isinstance(title, str) or not title.strip():
            raise ValueError("title is required")

        published_at, published_sort = _parse_timestamp(raw.get("publishedAt"), "publishedAt", path)
        created_at, created_sort = _parse_timestamp(raw.get("createdAt"), "createdAt", path)
        updated_at, _ = _parse_timestamp(raw.get("updatedAt"), "updatedAt", path)
        raw_tags = raw.get("tags") or []
        if not isinstance(raw_tags, list):
            raise ValueError("tags must be an array")
        tags = tuple(
            tag.strip()
            for tag in raw_tags
            if isinstance(tag, str) and tag.strip()
        )
        return ArticleMetadata(
            id=str(raw["id"]) if raw.get("id") is not None else None,
            slug=slug.strip(),
            title=title,
            summary=raw.get("summary") if isinstance(raw.get("summary"), str) else None,
            tags=tags,
            status=str(raw.get("status") or "").upper(),
            published_at=published_at,
            created_at=created_at,
            updated_at=updated_at,
            cover=raw.get("cover") if isinstance(raw.get("cover"), str) else None,
            published_sort=published_sort,
            created_sort=created_sort,
        )

    def _to_summary(self, metadata: ArticleMetadata) -> ArticleSummary:
        return ArticleSummary(
            id=metadata.id,
            slug=metadata.slug,
            title=metadata.title,
            summary=metadata.summary,
            coverUrl=self._cover_url(metadata),
            tags=list(dict.fromkeys(
                normalized for normalized in (_normalize_tag(tag) for tag in metadata.tags)
                if normalized is not None
            )),
            status=metadata.status,
            publishedAt=metadata.published_at,
            createdAt=metadata.created_at,
            updatedAt=metadata.updated_at,
        )

    def _folder_for(self, metadata: ArticleMetadata) -> Path:
        return (self.articles_root / _normalize_slug(metadata.slug)).resolve()

    def _cover_url(self, metadata: ArticleMetadata) -> str | None:
        if not metadata.cover or not metadata.cover.strip():
            return None
        folder = self._folder_for(metadata)
        cover_path = (folder / metadata.cover).resolve()
        if not self._is_inside(cover_path, folder) or not cover_path.is_file():
            return None
        relative_cover = metadata.cover.replace("\\", "/").lstrip("/")
        return f"/articles/{_normalize_slug(metadata.slug)}/{relative_cover}"

    @staticmethod
    def _is_inside(path: Path, parent: Path) -> bool:
        try:
            path.relative_to(parent)
            return True
        except ValueError:
            return False
