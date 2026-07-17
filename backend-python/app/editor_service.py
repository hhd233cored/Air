"""Local file editor service for articles.

This service is intentionally separate from the public read-only service. It is
only mounted when EDITOR_ENABLED=true and should be bound to loopback.
"""

from __future__ import annotations

import json
import re
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from fastapi import UploadFile

from .editor_models import EditorArticleDetail, EditorArticlePageResponse, EditorArticleSummary


ALLOWED_COVER_EXTENSIONS = {".svg", ".png", ".jpg", ".jpeg", ".webp"}
ALLOWED_ASSET_EXTENSIONS = ALLOWED_COVER_EXTENSIONS | {".gif"}
VALID_STATUSES = {"DRAFT", "PUBLISHED", "ARCHIVED"}
SLUG_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


class EditorError(Exception):
    def __init__(self, code: str, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.code = code
        self.status_code = status_code


class EditorArticleNotFoundError(EditorError):
    def __init__(self, slug: str) -> None:
        super().__init__("EDITOR_ARTICLE_NOT_FOUND", f"Editor article not found: {slug}", 404)


class EditorArticleConflictError(EditorError):
    def __init__(self, slug: str) -> None:
        super().__init__("EDITOR_ARTICLE_EXISTS", f"Article slug already exists: {slug}", 409)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _normalize_slug(value: str) -> str:
    slug = value.strip().lower()
    if not SLUG_PATTERN.fullmatch(slug):
        raise EditorError("INVALID_SLUG", "Slug must contain lowercase letters, numbers and single hyphens only")
    return slug


def slug_from_title(title: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "-", title.strip().lower()).strip("-")
    if normalized:
        return normalized[:80].strip("-")
    return f"article-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:6]}"


def _parse_tags(value: str | None) -> list[str]:
    if not value:
        return []
    raw = value.strip()
    if raw.startswith("["):
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise EditorError("INVALID_TAGS", "Tags must be comma-separated text or a JSON array") from exc
        if not isinstance(parsed, list):
            raise EditorError("INVALID_TAGS", "Tags must be a JSON array")
        return list(dict.fromkeys(str(item).strip() for item in parsed if str(item).strip()))
    return list(dict.fromkeys(item.strip() for item in raw.split(",") if item.strip()))


def _parse_optional_timestamp(value: str | None, field: str) -> str | None:
    if value is None or not value.strip():
        return None
    candidate = value.strip()
    try:
        datetime.fromisoformat(candidate.replace("Z", "+00:00"))
    except ValueError as exc:
        raise EditorError("INVALID_TIMESTAMP", f"{field} must be an ISO timestamp") from exc
    return candidate


def _safe_filename(filename: str | None, allowed: set[str]) -> str:
    original = Path(filename or "").name
    cleaned = re.sub(r"[^A-Za-z0-9._-]", "-", original).strip(".")
    extension = Path(cleaned).suffix.lower()
    if not cleaned or extension not in allowed:
        raise EditorError("INVALID_FILE", "Unsupported or unsafe image filename")
    return cleaned


class ArticleEditorService:
    def __init__(self, articles_root: Path) -> None:
        self.articles_root = articles_root.resolve()
        self.articles_root.mkdir(parents=True, exist_ok=True)

    def list_articles(self, page: int, size: int) -> EditorArticlePageResponse:
        articles = sorted(self._read_metadata(), key=self._sort_key, reverse=True)
        start = min(page * size, len(articles))
        end = min(start + size, len(articles))
        total_pages = 0 if not articles else (len(articles) + size - 1) // size
        return EditorArticlePageResponse(
            content=[self._to_summary(item) for item in articles[start:end]],
            page=page,
            size=size,
            totalElements=len(articles),
            totalPages=total_pages,
        )

    def get_article(self, slug: str) -> EditorArticleDetail:
        metadata = self._find_metadata(slug)
        folder = self._folder(metadata["slug"])
        content_path = folder / "article.md"
        if not content_path.is_file():
            raise EditorArticleNotFoundError(slug)
        try:
            markdown = content_path.read_text(encoding="utf-8")
        except OSError as exc:
            raise EditorArticleNotFoundError(slug) from exc
        return EditorArticleDetail(**self._to_summary(metadata).model_dump(), contentMarkdown=markdown)

    async def create_article(
        self,
        *,
        title: str,
        slug: str | None,
        summary: str | None,
        tags: str | None,
        status: str | None,
        published_at: str | None,
        content_markdown: str,
        cover: UploadFile,
        assets: Iterable[UploadFile] = (),
    ) -> EditorArticleDetail:
        clean_title = title.strip()
        if not clean_title:
            raise EditorError("INVALID_TITLE", "Title is required")
        clean_slug = _normalize_slug(slug) if slug and slug.strip() else slug_from_title(clean_title)
        folder = self._folder(clean_slug)
        if folder.exists():
            raise EditorArticleConflictError(clean_slug)
        cover_name = _safe_filename(cover.filename, ALLOWED_COVER_EXTENSIONS)
        metadata = self._make_metadata(
            clean_slug, clean_title, summary, tags, status, published_at, cover_name, None,
        )
        await self._write_article(folder, metadata, content_markdown, cover, cover_name, assets)
        self.rebuild_index()
        return self.get_article(clean_slug)

    async def update_article(
        self,
        slug: str,
        *,
        title: str,
        new_slug: str | None,
        summary: str | None,
        tags: str | None,
        status: str | None,
        published_at: str | None,
        content_markdown: str,
        cover: UploadFile | None,
        assets: Iterable[UploadFile] = (),
    ) -> EditorArticleDetail:
        current = self._find_metadata(slug)
        current_slug = current["slug"]
        clean_title = title.strip()
        if not clean_title:
            raise EditorError("INVALID_TITLE", "Title is required")
        clean_slug = _normalize_slug(new_slug) if new_slug and new_slug.strip() else current_slug
        old_folder = self._folder(current_slug)
        target_folder = self._folder(clean_slug)
        if clean_slug != current_slug and target_folder.exists():
            raise EditorArticleConflictError(clean_slug)

        cover_name = current.get("cover")
        if cover is not None and cover.filename:
            cover_name = _safe_filename(cover.filename, ALLOWED_COVER_EXTENSIONS)
        if not cover_name or not (old_folder / cover_name).is_file() and cover is None:
            raise EditorError("COVER_REQUIRED", "A cover image is required")

        metadata = self._make_metadata(
            clean_slug, clean_title, summary, tags, status, published_at, cover_name,
            current,
        )
        if clean_slug != current_slug:
            old_folder.rename(target_folder)
            old_folder = target_folder
        if cover is None and cover_name and cover_name != current.get("cover"):
            raise EditorError("COVER_REQUIRED", "A cover image is required")
        await self._write_article(old_folder, metadata, content_markdown, cover, cover_name, assets)
        self.rebuild_index()
        return self.get_article(clean_slug)

    def delete_article(self, slug: str) -> None:
        metadata = self._find_metadata(slug)
        folder = self._folder(metadata["slug"])
        if not folder.is_dir():
            raise EditorArticleNotFoundError(slug)

        # Move first, then remove the moved directory. This prevents a partially
        # deleted article from being exposed if the directory operation fails.
        temporary = self.articles_root / f".{metadata['slug']}.delete-{uuid.uuid4().hex}"
        folder.rename(temporary)
        try:
            shutil.rmtree(temporary)
        except OSError:
            # Keep the moved directory available for manual recovery and report
            # a normal editor error instead of silently losing the index update.
            raise EditorError("EDITOR_DELETE_FAILED", "Could not remove the article directory", 500)
        self.rebuild_index()

    def rebuild_index(self) -> None:
        public_articles = []
        for metadata in self._read_metadata():
            if metadata.get("status", "").upper() != "PUBLISHED":
                continue
            public_articles.append(self._to_summary(metadata).model_dump())
        public_articles.sort(key=lambda item: item.get("publishedAt") or item.get("createdAt") or "", reverse=True)
        temporary = self.articles_root / f"index.json.tmp-{uuid.uuid4().hex}"
        temporary.write_text(json.dumps(public_articles, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        temporary.replace(self.articles_root / "index.json")

    def _make_metadata(
        self,
        slug: str,
        title: str,
        summary: str | None,
        tags: str | None,
        status: str | None,
        published_at: str | None,
        cover: str | None,
        current: dict[str, Any] | None,
    ) -> dict[str, Any]:
        clean_status = (status or (current or {}).get("status") or "DRAFT").strip().upper()
        if clean_status not in VALID_STATUSES:
            raise EditorError("INVALID_STATUS", "Status must be DRAFT, PUBLISHED or ARCHIVED")
        existing_published = (current or {}).get("publishedAt")
        clean_published = _parse_optional_timestamp(published_at, "publishedAt")
        if clean_status == "PUBLISHED" and not clean_published:
            clean_published = existing_published or _now()
        if clean_status != "PUBLISHED" and current is None:
            clean_published = None
        now = _now()
        return {
            "id": (current or {}).get("id") or str(uuid.uuid4()),
            "slug": slug,
            "title": title,
            "summary": summary.strip() if summary and summary.strip() else None,
            "tags": _parse_tags(tags) if tags is not None else list((current or {}).get("tags") or []),
            "status": clean_status,
            "publishedAt": clean_published,
            "createdAt": (current or {}).get("createdAt") or now,
            "updatedAt": now,
            "cover": cover,
        }

    async def _write_article(
        self,
        folder: Path,
        metadata: dict[str, Any],
        content_markdown: str,
        cover: UploadFile | None,
        cover_name: str | None,
        assets: Iterable[UploadFile],
    ) -> None:
        folder.mkdir(parents=True, exist_ok=True)
        assets_dir = folder / "assets"
        assets_dir.mkdir(parents=True, exist_ok=True)
        if cover is not None and cover_name:
            await self._copy_upload(cover, folder / cover_name, ALLOWED_COVER_EXTENSIONS)
        if cover_name and not (folder / cover_name).is_file():
            raise EditorError("COVER_REQUIRED", "A cover image is required")
        for asset in assets:
            if not asset.filename:
                continue
            filename = _safe_filename(asset.filename, ALLOWED_ASSET_EXTENSIONS)
            await self._copy_upload(asset, assets_dir / filename, ALLOWED_ASSET_EXTENSIONS)
        markdown_path = folder / "article.md"
        metadata_path = folder / "article.json"
        markdown_temp = folder / f"article.md.tmp-{uuid.uuid4().hex}"
        metadata_temp = folder / f"article.json.tmp-{uuid.uuid4().hex}"
        markdown_temp.write_text(content_markdown or "", encoding="utf-8")
        metadata_temp.write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        markdown_temp.replace(markdown_path)
        metadata_temp.replace(metadata_path)

    async def _copy_upload(self, upload: UploadFile, destination: Path, allowed: set[str]) -> None:
        _safe_filename(upload.filename, allowed)
        temporary = destination.with_name(f".{destination.name}.tmp-{uuid.uuid4().hex}")
        try:
            with temporary.open("wb") as output:
                while chunk := await upload.read(1024 * 1024):
                    output.write(chunk)
            temporary.replace(destination)
        finally:
            if temporary.exists():
                temporary.unlink()

    def _read_metadata(self) -> list[dict[str, Any]]:
        if not self.articles_root.is_dir():
            return []
        result: list[dict[str, Any]] = []
        for folder in self.articles_root.iterdir():
            if not folder.is_dir():
                continue
            metadata_path = folder / "article.json"
            if not metadata_path.is_file():
                continue
            try:
                raw = json.loads(metadata_path.read_text(encoding="utf-8"))
                if not isinstance(raw, dict) or not isinstance(raw.get("slug"), str):
                    continue
                if raw["slug"].strip().lower() != folder.name.lower():
                    continue
                if not isinstance(raw.get("title"), str) or not raw["title"].strip():
                    continue
                raw["slug"] = raw["slug"].strip().lower()
                raw["status"] = str(raw.get("status") or "DRAFT").upper()
                raw["tags"] = [str(tag).strip() for tag in raw.get("tags") or [] if str(tag).strip()]
                result.append(raw)
            except (OSError, TypeError, ValueError, json.JSONDecodeError):
                continue
        return result

    def _find_metadata(self, slug: str) -> dict[str, Any]:
        normalized = slug.strip().lower()
        for metadata in self._read_metadata():
            if metadata["slug"] == normalized:
                return metadata
        raise EditorArticleNotFoundError(slug)

    def _to_summary(self, metadata: dict[str, Any]) -> EditorArticleSummary:
        folder = self._folder(metadata["slug"])
        cover = metadata.get("cover")
        cover_path = (folder / cover).resolve() if isinstance(cover, str) and cover else None
        if cover_path is not None:
            try:
                cover_path.relative_to(folder)
            except ValueError:
                cover_path = None
        return EditorArticleSummary(
            id=str(metadata["id"]) if metadata.get("id") is not None else None,
            slug=metadata["slug"],
            title=metadata["title"],
            summary=metadata.get("summary") if isinstance(metadata.get("summary"), str) else None,
            coverUrl=f"/articles/{metadata['slug']}/{cover}" if cover_path and cover_path.is_file() else None,
            tags=list(metadata.get("tags") or []),
            status=str(metadata.get("status") or "DRAFT").upper(),
            publishedAt=metadata.get("publishedAt"),
            createdAt=metadata.get("createdAt"),
            updatedAt=metadata.get("updatedAt"),
        )

    def _folder(self, slug: str) -> Path:
        folder = (self.articles_root / slug).resolve()
        try:
            folder.relative_to(self.articles_root)
        except ValueError as exc:
            raise EditorError("INVALID_PATH", "Article path is outside the content directory") from exc
        return folder

    @staticmethod
    def _sort_key(metadata: dict[str, Any]) -> str:
        return str(metadata.get("updatedAt") or metadata.get("publishedAt") or metadata.get("createdAt") or "")
