"""Generate cover colors for file-backed article metadata and index.json."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any

from .config import Settings
from .cover_color import extract_cover_color


RASTER_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}


def _read_metadata(path: Path) -> dict[str, Any] | None:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, TypeError, ValueError, json.JSONDecodeError):
        return None
    return value if isinstance(value, dict) else None


def _write_json(path: Path, value: Any) -> None:
    temporary = path.with_name(f".{path.name}.tmp-{os.getpid()}")
    try:
        temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        temporary.replace(path)
    finally:
        if temporary.exists():
            temporary.unlink()


def build_cover_colors(root: Path) -> int:
    root = root.resolve()
    if not root.is_dir():
        raise FileNotFoundError(f"Article directory was not found: {root}")
    if any(path.is_file() and path.suffix.lower() in RASTER_EXTENSIONS for path in root.rglob("*")):
        try:
            import PIL  # noqa: F401
        except ImportError as exc:
            raise RuntimeError("Pillow is required to extract PNG/JPG/WebP cover colors") from exc

    index: list[dict[str, Any]] = []
    processed = 0
    for folder in sorted(root.iterdir(), key=lambda item: item.name):
        if not folder.is_dir() or folder.name.startswith("."):
            continue
        metadata_path = folder / "article.json"
        metadata = _read_metadata(metadata_path)
        if metadata is None or str(metadata.get("slug") or "").lower() != folder.name.lower():
            continue

        cover_name = str(metadata.get("cover") or "").strip()
        cover_path = (folder / cover_name).resolve() if cover_name else None
        if cover_path is not None:
            try:
                cover_path.relative_to(folder.resolve())
            except ValueError:
                cover_path = None

        color = extract_cover_color(cover_path) if cover_path and cover_path.is_file() else None
        metadata["coverColor"] = color
        _write_json(metadata_path, metadata)
        index.append({
            "id": metadata.get("id"),
            "slug": metadata.get("slug"),
            "title": metadata.get("title", ""),
            "summary": metadata.get("summary"),
            "coverUrl": f"/articles/{folder.name}/{cover_name}" if cover_path and cover_path.is_file() else None,
            "coverColor": color,
            "tags": list(metadata.get("tags") or []),
            "status": metadata.get("status", "DRAFT"),
            "publishedAt": metadata.get("publishedAt"),
            "createdAt": metadata.get("createdAt"),
            "updatedAt": metadata.get("updatedAt"),
        })
        processed += 1

    index.sort(key=lambda item: (item.get("publishedAt") is not None, item.get("publishedAt") or ""), reverse=True)
    _write_json(root / "index.json", index)
    return processed


def main() -> int:
    parser = argparse.ArgumentParser(description="Extract article cover colors during content preparation")
    parser.add_argument("--root", type=Path, help="Article content directory; defaults to ARTICLE_CONTENT_DIR")
    args = parser.parse_args()
    root = args.root.resolve() if args.root else Settings.from_environment().article_content_dir
    count = build_cover_colors(root)
    print(f"Generated cover colors for {count} article(s) in {root}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
