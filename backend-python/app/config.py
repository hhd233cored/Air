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


def _optional_int(name: str) -> int | None:
    value = os.getenv(name, "").strip()
    if not value:
        return None
    try:
        return int(value)
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer") from exc


@dataclass(frozen=True)
class Settings:
    server_port: int
    article_content_dir: Path
    music_source: str
    music_content_dir: Path
    cors_allowed_origins: tuple[str, ...]
    wikipedia_on_this_day_url: str
    netease_music_api_base_url: str
    netease_music_playlist_id: str
    netease_music_app_id: str
    netease_music_sign_type: str
    netease_music_access_token: str
    netease_music_app_secret: str
    netease_music_device_json: str
    netease_music_bitrate: int | None

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
            music_source=os.getenv("MUSIC_SOURCE", "local").strip().lower() or "local",
            music_content_dir=_resolve_path(
                os.getenv("MUSIC_CONTENT_DIR", "./music"),
                project_root,
            ),
            cors_allowed_origins=origins,
            wikipedia_on_this_day_url=os.getenv(
                "WIKIPEDIA_ON_THIS_DAY_URL",
                "https://api.wikimedia.org/feed/v1/wikipedia/zh/onthisday/all",
            ).rstrip("/"),
            netease_music_api_base_url=os.getenv(
                "NETEASE_MUSIC_API_BASE_URL",
                "https://openapi.music.163.com",
            ).rstrip("/"),
            netease_music_playlist_id=os.getenv("NETEASE_MUSIC_PLAYLIST_ID", "17434435787"),
            netease_music_app_id=os.getenv("NETEASE_MUSIC_APP_ID", ""),
            netease_music_sign_type=os.getenv("NETEASE_MUSIC_SIGN_TYPE", "RSA_SHA256"),
            netease_music_access_token=os.getenv("NETEASE_MUSIC_ACCESS_TOKEN", ""),
            netease_music_app_secret=os.getenv("NETEASE_MUSIC_APP_SECRET", ""),
            netease_music_device_json=os.getenv(
                "NETEASE_MUSIC_DEVICE_JSON",
                '{"deviceType":"web","os":"web","appVer":"1.0","channel":"personal-site","model":"browser","deviceId":"air"}',
            ),
            netease_music_bitrate=_optional_int("NETEASE_MUSIC_BITRATE"),
        )
