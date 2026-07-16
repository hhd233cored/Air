"""Read published chatter entries from one-folder-per-entry storage."""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .chatter_models import ChatterDetail, ChatterPageResponse, ChatterSummary

logger = logging.getLogger(__name__)

_IMAGE_RE = re.compile(r"!\[[^]]*\]\([^)]*\)")
_LINK_RE = re.compile(r"\[([^]]+)\]\([^)]*\)")
_MARKDOWN_RE = re.compile(r"[`*_~>#]| ")


class ChatterNotFoundError(Exception):
    def __init__(self, slug: str) -> None:
        super().__init__(f"Chatter not found: {slug}")
        self.slug = slug


@dataclass(frozen=True)
class ChatterMetadata:
    id: str | None
    slug: str
    status: str
    published_at: str | None
    created_at: str | None
    updated_at: str | None
    published_sort: datetime | None
    created_sort: datetime | None


@dataclass(frozen=True)
class ChatterRecord:
    metadata: ChatterMetadata
    content_markdown: str


def _normalize_slug(value: str | None) -> str:
    return (value or "").strip().lower()


def _parse_timestamp(value: Any, field: str) -> tuple[str | None, datetime | None]:
    if value is None or value == "":
        return None, None
    if not isinstance(value, str):
        raise ValueError(f"{field} must be an ISO timestamp")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return value, parsed


def build_preview(markdown: str, limit: int = 160) -> str:
    """Convert a Markdown body into a short plain-text preview."""

    text = _IMAGE_RE.sub("", markdown)
    text = _LINK_RE.sub(r"\1", text)
    lines = []
    for line in text.splitlines():
        cleaned = re.sub(r"^\s*(?:[-*+]\s+|\d+[.)]\s+|>\s*)", "", line)
        cleaned = _MARKDOWN_RE.sub("", cleaned).strip()
        if cleaned:
            lines.append(cleaned)
    preview = " ".join(lines)
    if len(preview) <= limit:
        return preview
    return f"{preview[: max(0, limit - 1)].rstrip()}…"


class ChatterService:
    def __init__(self, chatter_root: Path) -> None:
        self.chatter_root = chatter_root.resolve()

    def list_published(self, page: int, size: int) -> ChatterPageResponse:
        records = [record for record in self._read_records() if record.metadata.status == "PUBLISHED"]
        records.sort(
            key=lambda record: (
                record.metadata.published_sort is not None,
                record.metadata.published_sort or datetime.min.replace(tzinfo=timezone.utc),
                record.metadata.created_sort is not None,
                record.metadata.created_sort or datetime.min.replace(tzinfo=timezone.utc),
            ),
            reverse=True,
        )
        start = min(page * size, len(records))
        end = min(start + size, len(records))
        total_pages = 0 if not records else (len(records) + size - 1) // size
        return ChatterPageResponse(
            content=[self._to_summary(record) for record in records[start:end]],
            page=page,
            size=size,
            totalElements=len(records),
            totalPages=total_pages,
        )

    def get_published(self, slug: str) -> ChatterDetail:
        normalized_slug = _normalize_slug(slug)
        record = next(
            (
                item
                for item in self._read_records()
                if item.metadata.status == "PUBLISHED"
                and _normalize_slug(item.metadata.slug) == normalized_slug
            ),
            None,
        )
        if record is None:
            raise ChatterNotFoundError(slug)
        summary = self._to_summary(record)
        return ChatterDetail(**summary.model_dump(), contentMarkdown=record.content_markdown)

    def _read_records(self) -> list[ChatterRecord]:
        if not self.chatter_root.is_dir():
            return []
        try:
            folders = list(self.chatter_root.iterdir())
        except OSError as exc:
            logger.warning("Could not scan chatter directory %s: %s", self.chatter_root, exc)
            return []

        records: list[ChatterRecord] = []
        for folder in folders:
            if not folder.is_dir():
                continue
            metadata_path = folder / "chatter.json"
            content_path = folder / "chatter.md"
            if not metadata_path.is_file() or not content_path.is_file():
                continue
            try:
                raw = json.loads(metadata_path.read_text(encoding="utf-8"))
                metadata = self._parse_metadata(raw)
                if _normalize_slug(metadata.slug) != _normalize_slug(folder.name):
                    logger.warning("Skipping chatter with mismatched folder and slug: %s", metadata_path)
                    continue
                if not self._is_inside(content_path.resolve(), folder.resolve()):
                    continue
                content = content_path.read_text(encoding="utf-8")
                records.append(ChatterRecord(metadata=metadata, content_markdown=content))
            except (OSError, ValueError, TypeError, json.JSONDecodeError) as exc:
                logger.warning("Skipping invalid chatter %s: %s", metadata_path, exc)
        return records

    def _parse_metadata(self, raw: Any) -> ChatterMetadata:
        if not isinstance(raw, dict):
            raise ValueError("metadata must be an object")
        slug = raw.get("slug")
        if not isinstance(slug, str) or not slug.strip():
            raise ValueError("slug is required")
        published_at, published_sort = _parse_timestamp(raw.get("publishedAt"), "publishedAt")
        created_at, created_sort = _parse_timestamp(raw.get("createdAt"), "createdAt")
        updated_at, _ = _parse_timestamp(raw.get("updatedAt"), "updatedAt")
        return ChatterMetadata(
            id=str(raw["id"]) if raw.get("id") is not None else None,
            slug=slug.strip(),
            status=str(raw.get("status") or "").upper(),
            published_at=published_at,
            created_at=created_at,
            updated_at=updated_at,
            published_sort=published_sort,
            created_sort=created_sort,
        )

    @staticmethod
    def _to_summary(record: ChatterRecord) -> ChatterSummary:
        metadata = record.metadata
        return ChatterSummary(
            id=metadata.id,
            slug=metadata.slug,
            preview=build_preview(record.content_markdown),
            status=metadata.status,
            publishedAt=metadata.published_at,
            createdAt=metadata.created_at,
            updatedAt=metadata.updated_at,
        )

    @staticmethod
    def _is_inside(path: Path, parent: Path) -> bool:
        try:
            path.relative_to(parent)
            return True
        except ValueError:
            return False
