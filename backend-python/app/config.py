"""Environment-backed configuration for the lightweight API."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]


def _resolve_path(value: str, base: Path) -> Path:
    path = Path(value).expanduser()
    if not path.is_absolute():
        path = base / path
    return path.resolve()


@dataclass(frozen=True)
class Settings:
    server_port: int
    article_content_dir: Path
    cors_allowed_origins: tuple[str, ...]
    wikipedia_on_this_day_url: str

    @classmethod
    def from_environment(cls, project_root: Path = PROJECT_ROOT) -> "Settings":
        origins = tuple(
            origin.strip()
            for origin in os.getenv(
                "CORS_ALLOWED_ORIGINS",
                "http://localhost:3000,http://127.0.0.1:3000",
            ).split(",")
            if origin.strip()
        )
        return cls(
            server_port=int(os.getenv("SERVER_PORT", "8080")),
            article_content_dir=_resolve_path(
                os.getenv("ARTICLE_CONTENT_DIR", "./public/articles"),
                project_root,
            ),
            cors_allowed_origins=origins,
            wikipedia_on_this_day_url=os.getenv(
                "WIKIPEDIA_ON_THIS_DAY_URL",
                "https://api.wikimedia.org/feed/v1/wikipedia/zh/onthisday/all",
            ).rstrip("/"),
        )
