from __future__ import annotations

import asyncio
import io
import json
import sys
from pathlib import Path

from fastapi import UploadFile

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "backend-python"))

from app.chatter_editor_service import ChatterEditorService  # noqa: E402


def upload(name: str, content: bytes) -> UploadFile:
    return UploadFile(file=io.BytesIO(content), filename=name)


def test_chatter_editor_creates_updates_and_deletes_entry(tmp_path: Path) -> None:
    service = ChatterEditorService(tmp_path)
    created = asyncio.run(service.create_entry(
        slug="first-thought",
        status="PUBLISHED",
        published_at=None,
        content_markdown="# A thought\n\nKeep this moment.",
    ))

    assert created.slug == "first-thought"
    assert created.preview.startswith("A thought")
    assert json.loads((tmp_path / "index.json").read_text(encoding="utf-8"))[0]["slug"] == "first-thought"

    updated = asyncio.run(service.update_entry(
        "first-thought",
        new_slug="second-thought",
        status="DRAFT",
        published_at=None,
        content_markdown="Updated thought.",
    ))
    assert updated.slug == "second-thought"
    assert updated.status == "DRAFT"
    assert json.loads((tmp_path / "index.json").read_text(encoding="utf-8")) == []

    service.delete_entry("second-thought")
    assert not (tmp_path / "second-thought").exists()


def test_chatter_editor_saves_assets_and_preserves_them_on_update(tmp_path: Path) -> None:
    service = ChatterEditorService(tmp_path)
    created = asyncio.run(service.create_entry(
        slug="image-thought",
        status="DRAFT",
        published_at=None,
        content_markdown="![note.png](/chatter/image-thought/assets/note.png)",
        assets=[upload("note.png", b"image")],
    ))

    assert created.slug == "image-thought"
    assert (tmp_path / "image-thought" / "assets" / "note.png").read_bytes() == b"image"

    asyncio.run(service.update_entry(
        "image-thought",
        new_slug=None,
        status="DRAFT",
        published_at=None,
        content_markdown="Updated body",
    ))
    assert (tmp_path / "image-thought" / "assets" / "note.png").read_bytes() == b"image"
