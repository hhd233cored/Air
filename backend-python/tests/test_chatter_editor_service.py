from __future__ import annotations

import json
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "backend-python"))

from app.chatter_editor_service import ChatterEditorService  # noqa: E402


def test_chatter_editor_creates_updates_and_deletes_entry(tmp_path: Path) -> None:
    service = ChatterEditorService(tmp_path)
    created = service.create_entry(
        slug="first-thought",
        status="PUBLISHED",
        published_at=None,
        content_markdown="# A thought\n\nKeep this moment.",
    )

    assert created.slug == "first-thought"
    assert created.preview.startswith("A thought")
    assert json.loads((tmp_path / "index.json").read_text(encoding="utf-8"))[0]["slug"] == "first-thought"

    updated = service.update_entry(
        "first-thought",
        new_slug="second-thought",
        status="DRAFT",
        published_at=None,
        content_markdown="Updated thought.",
    )
    assert updated.slug == "second-thought"
    assert updated.status == "DRAFT"
    assert json.loads((tmp_path / "index.json").read_text(encoding="utf-8")) == []

    service.delete_entry("second-thought")
    assert not (tmp_path / "second-thought").exists()
