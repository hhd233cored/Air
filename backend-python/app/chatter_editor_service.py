"""Local-only editor service for Markdown chatter entries."""

from __future__ import annotations

import json
import re
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .chatter_service import build_preview
from .chatter_models import ChatterDetail, ChatterPageResponse, ChatterSummary
from .editor_service import EditorArticleConflictError, EditorArticleNotFoundError, EditorError


VALID_STATUSES = {"DRAFT", "PUBLISHED", "ARCHIVED"}
SLUG_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _slug_from_content(content: str) -> str:
    first_line = next((line.strip() for line in content.splitlines() if line.strip()), "")
    slug = re.sub(r"[^a-z0-9]+", "-", first_line.lower()).strip("-")
    if slug:
        return slug[:80].strip("-")
    return f"chatter-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:6]}"


def _normalize_slug(value: str) -> str:
    slug = value.strip().lower()
    if not SLUG_PATTERN.fullmatch(slug):
        raise EditorError("INVALID_SLUG", "Slug must contain lowercase letters, numbers and single hyphens only")
    return slug


def _parse_timestamp(value: str | None) -> str | None:
    if value is None or not value.strip():
        return None
    candidate = value.strip()
    try:
        datetime.fromisoformat(candidate.replace("Z", "+00:00"))
    except ValueError as exc:
        raise EditorError("INVALID_TIMESTAMP", "publishedAt must be an ISO timestamp") from exc
    return candidate


class ChatterEditorService:
    def __init__(self, chatter_root: Path) -> None:
        self.chatter_root = chatter_root.resolve()
        self.chatter_root.mkdir(parents=True, exist_ok=True)

    def list_entries(self, page: int, size: int) -> ChatterPageResponse:
        entries = sorted(self._read_entries(), key=self._sort_key, reverse=True)
        start = min(page * size, len(entries))
        end = min(start + size, len(entries))
        total_pages = 0 if not entries else (len(entries) + size - 1) // size
        return ChatterPageResponse(
            content=[self._to_summary(entry) for entry in entries[start:end]],
            page=page,
            size=size,
            totalElements=len(entries),
            totalPages=total_pages,
        )

    def get_entry(self, slug: str) -> ChatterDetail:
        entry = self._find_entry(slug)
        return ChatterDetail(**self._to_summary(entry).model_dump(), contentMarkdown=entry["contentMarkdown"])

    def create_entry(
        self,
        *,
        slug: str | None,
        status: str | None,
        published_at: str | None,
        content_markdown: str,
    ) -> ChatterDetail:
        content = content_markdown or ""
        if not content.strip():
            raise EditorError("INVALID_CONTENT", "Chatter content is required")
        clean_slug = _normalize_slug(slug) if slug and slug.strip() else _slug_from_content(content)
        folder = self._folder(clean_slug)
        if folder.exists():
            raise EditorArticleConflictError(clean_slug)
        metadata = self._make_metadata(clean_slug, status, published_at, None)
        self._write_entry(folder, metadata, content)
        self.rebuild_index()
        return self.get_entry(clean_slug)

    def update_entry(
        self,
        slug: str,
        *,
        new_slug: str | None,
        status: str | None,
        published_at: str | None,
        content_markdown: str,
    ) -> ChatterDetail:
        current = self._find_entry(slug)
        content = content_markdown or ""
        if not content.strip():
            raise EditorError("INVALID_CONTENT", "Chatter content is required")
        current_slug = current["slug"]
        clean_slug = _normalize_slug(new_slug) if new_slug and new_slug.strip() else current_slug
        target = self._folder(clean_slug)
        if clean_slug != current_slug and target.exists():
            raise EditorArticleConflictError(clean_slug)
        metadata = self._make_metadata(clean_slug, status, published_at, current)
        folder = self._folder(current_slug)
        if clean_slug != current_slug:
            folder.rename(target)
            folder = target
        self._write_entry(folder, metadata, content)
        self.rebuild_index()
        return self.get_entry(clean_slug)

    def delete_entry(self, slug: str) -> None:
        entry = self._find_entry(slug)
        folder = self._folder(entry["slug"])
        temporary = self.chatter_root / f".{entry['slug']}.delete-{uuid.uuid4().hex}"
        folder.rename(temporary)
        try:
            shutil.rmtree(temporary)
        except OSError as exc:
            raise EditorError("EDITOR_DELETE_FAILED", "Could not remove the chatter directory", 500) from exc
        self.rebuild_index()

    def rebuild_index(self) -> None:
        entries = [self._to_summary(entry).model_dump() for entry in self._read_entries() if entry["status"] == "PUBLISHED"]
        entries.sort(key=lambda item: item.get("publishedAt") or item.get("createdAt") or "", reverse=True)
        temporary = self.chatter_root / f"index.json.tmp-{uuid.uuid4().hex}"
        temporary.write_text(json.dumps(entries, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        temporary.replace(self.chatter_root / "index.json")

    def _make_metadata(
        self,
        slug: str,
        status: str | None,
        published_at: str | None,
        current: dict[str, Any] | None,
    ) -> dict[str, Any]:
        clean_status = (status or (current or {}).get("status") or "DRAFT").strip().upper()
        if clean_status not in VALID_STATUSES:
            raise EditorError("INVALID_STATUS", "Status must be DRAFT, PUBLISHED or ARCHIVED")
        published = _parse_timestamp(published_at)
        if clean_status == "PUBLISHED" and not published:
            published = (current or {}).get("publishedAt") or _now()
        return {
            "id": (current or {}).get("id") or f"chatter-{uuid.uuid4().hex}",
            "slug": slug,
            "status": clean_status,
            "publishedAt": published,
            "createdAt": (current or {}).get("createdAt") or _now(),
            "updatedAt": _now(),
        }

    def _write_entry(self, folder: Path, metadata: dict[str, Any], content: str) -> None:
        folder.mkdir(parents=True, exist_ok=True)
        content_temp = folder / f"chatter.md.tmp-{uuid.uuid4().hex}"
        metadata_temp = folder / f"chatter.json.tmp-{uuid.uuid4().hex}"
        content_temp.write_text(content, encoding="utf-8")
        metadata_temp.write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        content_temp.replace(folder / "chatter.md")
        metadata_temp.replace(folder / "chatter.json")

    def _read_entries(self) -> list[dict[str, Any]]:
        entries: list[dict[str, Any]] = []
        if not self.chatter_root.is_dir():
            return entries
        for folder in self.chatter_root.iterdir():
            if not folder.is_dir():
                continue
            metadata_path = folder / "chatter.json"
            content_path = folder / "chatter.md"
            if not metadata_path.is_file() or not content_path.is_file():
                continue
            try:
                raw = json.loads(metadata_path.read_text(encoding="utf-8"))
                content = content_path.read_text(encoding="utf-8")
                if not isinstance(raw, dict) or not isinstance(raw.get("slug"), str):
                    continue
                if raw["slug"].strip().lower() != folder.name.lower():
                    continue
                raw["slug"] = raw["slug"].strip().lower()
                raw["status"] = str(raw.get("status") or "DRAFT").upper()
                raw["contentMarkdown"] = content
                entries.append(raw)
            except (OSError, ValueError, TypeError, json.JSONDecodeError):
                continue
        return entries

    def _find_entry(self, slug: str) -> dict[str, Any]:
        normalized = slug.strip().lower()
        for entry in self._read_entries():
            if entry["slug"] == normalized:
                return entry
        raise EditorArticleNotFoundError(slug)

    def _to_summary(self, entry: dict[str, Any]) -> ChatterSummary:
        return ChatterSummary(
            id=str(entry["id"]) if entry.get("id") is not None else None,
            slug=entry["slug"],
            preview=build_preview(entry.get("contentMarkdown") or ""),
            status=entry["status"],
            publishedAt=entry.get("publishedAt"),
            createdAt=entry.get("createdAt"),
            updatedAt=entry.get("updatedAt"),
        )

    def _folder(self, slug: str) -> Path:
        folder = (self.chatter_root / slug).resolve()
        try:
            folder.relative_to(self.chatter_root)
        except ValueError as exc:
            raise EditorError("INVALID_PATH", "Chatter path is outside the content directory") from exc
        return folder

    @staticmethod
    def _sort_key(entry: dict[str, Any]) -> str:
        return str(entry.get("updatedAt") or entry.get("publishedAt") or entry.get("createdAt") or "")
