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


def _boolean(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None or not value.strip():
        return default
    normalized = value.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise ValueError(f"{name} must be a boolean")


def _duration_seconds(name: str, default: str) -> int:
    value = os.getenv(name, default).strip().lower()
    if not value:
        value = default
    units = {"s": 1, "m": 60, "h": 60 * 60, "d": 60 * 60 * 24}
    has_suffix = value[-1:] in units
    suffix = value[-1] if has_suffix else "s"
    number = value[:-1] if has_suffix else value
    try:
        seconds = int(number) * units[suffix]
    except ValueError as exc:
        raise ValueError(f"{name} must be a duration such as 7d, 12h or 3600s") from exc
    if seconds <= 0:
        raise ValueError(f"{name} must be greater than zero")
    return seconds


def _same_site(value: str) -> str:
    normalized = value.strip().lower()
    if normalized not in {"lax", "strict", "none"}:
        raise ValueError("AUTH_COOKIE_SAMESITE must be lax, strict or none")
    return normalized


def _csv(value: str) -> tuple[str, ...]:
    return tuple(item.strip() for item in value.split(",") if item.strip())


@dataclass(frozen=True)
class Settings:
    server_port: int
    auth_enabled: bool
    auth_database_path: Path
    auth_admin_username: str
    auth_admin_password: str
    auth_user_username: str
    auth_user_password: str
    auth_session_timeout_seconds: int
    auth_cookie_name: str
    auth_cookie_secure: bool
    auth_cookie_samesite: str
    auth_csrf_enabled: bool
    auth_registration_enabled: bool
    auth_avatar_max_bytes: int
    rate_limit_enabled: bool
    rate_limit_max_keys: int
    rate_limit_login_ip_max: int
    rate_limit_login_ip_window_seconds: int
    rate_limit_login_username_max: int
    rate_limit_login_username_window_seconds: int
    rate_limit_register_ip_max: int
    rate_limit_register_ip_window_seconds: int
    rate_limit_comment_ip_max: int
    rate_limit_comment_ip_window_seconds: int
    rate_limit_comment_user_max: int
    rate_limit_comment_user_window_seconds: int
    rate_limit_guestbook_ip_max: int
    rate_limit_guestbook_ip_window_seconds: int
    rate_limit_guestbook_user_max: int
    rate_limit_guestbook_user_window_seconds: int
    rate_limit_avatar_user_max: int
    rate_limit_avatar_user_window_seconds: int
    rate_limit_admin_max: int
    rate_limit_admin_window_seconds: int
    rate_limit_csrf_ip_max: int
    rate_limit_csrf_ip_window_seconds: int
    rate_limit_trust_proxy_headers: bool
    trusted_proxy_ips: tuple[str, ...]
    comments_enabled: bool
    comments_max_length: int
    content_storage: str
    editor_enabled: bool
    article_content_dir: Path
    chatter_content_dir: Path
    music_source: str
    music_content_dir: Path
    music_max_upload_bytes: int
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
            auth_enabled=_boolean("AUTH_ENABLED", True),
            auth_database_path=_resolve_path(
                os.getenv("AUTH_DATABASE_PATH", "./backend-python/data/auth.sqlite3"),
                project_root,
            ),
            auth_admin_username=os.getenv("AUTH_ADMIN_USERNAME", "").strip(),
            auth_admin_password=os.getenv("AUTH_ADMIN_PASSWORD", ""),
            auth_user_username=os.getenv("AUTH_USER_USERNAME", "").strip(),
            auth_user_password=os.getenv("AUTH_USER_PASSWORD", ""),
            auth_session_timeout_seconds=_duration_seconds("AUTH_SESSION_TIMEOUT", "7d"),
            auth_cookie_name=os.getenv("AUTH_COOKIE_NAME", "air_session").strip() or "air_session",
            auth_cookie_secure=_boolean("AUTH_COOKIE_SECURE", False),
            auth_cookie_samesite=_same_site(os.getenv("AUTH_COOKIE_SAMESITE", "lax")),
            auth_csrf_enabled=_boolean("AUTH_CSRF_ENABLED", True),
            auth_registration_enabled=_boolean("AUTH_REGISTRATION_ENABLED", True),
            auth_avatar_max_bytes=int(os.getenv("AUTH_AVATAR_MAX_BYTES", "2097152")),
            rate_limit_enabled=_boolean("RATE_LIMIT_ENABLED", True),
            rate_limit_max_keys=int(os.getenv("RATE_LIMIT_MAX_KEYS", "10000")),
            rate_limit_login_ip_max=int(os.getenv("RATE_LIMIT_LOGIN_IP_MAX", "5")),
            rate_limit_login_ip_window_seconds=_duration_seconds("RATE_LIMIT_LOGIN_IP_WINDOW", "60s"),
            rate_limit_login_username_max=int(os.getenv("RATE_LIMIT_LOGIN_USERNAME_MAX", "10")),
            rate_limit_login_username_window_seconds=_duration_seconds("RATE_LIMIT_LOGIN_USERNAME_WINDOW", "10m"),
            rate_limit_register_ip_max=int(os.getenv("RATE_LIMIT_REGISTER_IP_MAX", "3")),
            rate_limit_register_ip_window_seconds=_duration_seconds("RATE_LIMIT_REGISTER_IP_WINDOW", "1h"),
            rate_limit_comment_ip_max=int(os.getenv("RATE_LIMIT_COMMENT_IP_MAX", "20")),
            rate_limit_comment_ip_window_seconds=_duration_seconds("RATE_LIMIT_COMMENT_IP_WINDOW", "60s"),
            rate_limit_comment_user_max=int(os.getenv("RATE_LIMIT_COMMENT_USER_MAX", "10")),
            rate_limit_comment_user_window_seconds=_duration_seconds("RATE_LIMIT_COMMENT_USER_WINDOW", "60s"),
            rate_limit_guestbook_ip_max=int(os.getenv("RATE_LIMIT_GUESTBOOK_IP_MAX", "10")),
            rate_limit_guestbook_ip_window_seconds=_duration_seconds("RATE_LIMIT_GUESTBOOK_IP_WINDOW", "1h"),
            rate_limit_guestbook_user_max=int(os.getenv("RATE_LIMIT_GUESTBOOK_USER_MAX", "3")),
            rate_limit_guestbook_user_window_seconds=_duration_seconds("RATE_LIMIT_GUESTBOOK_USER_WINDOW", "1h"),
            rate_limit_avatar_user_max=int(os.getenv("RATE_LIMIT_AVATAR_USER_MAX", "5")),
            rate_limit_avatar_user_window_seconds=_duration_seconds("RATE_LIMIT_AVATAR_USER_WINDOW", "1h"),
            rate_limit_admin_max=int(os.getenv("RATE_LIMIT_ADMIN_MAX", "60")),
            rate_limit_admin_window_seconds=_duration_seconds("RATE_LIMIT_ADMIN_WINDOW", "60s"),
            rate_limit_csrf_ip_max=int(os.getenv("RATE_LIMIT_CSRF_IP_MAX", "30")),
            rate_limit_csrf_ip_window_seconds=_duration_seconds("RATE_LIMIT_CSRF_IP_WINDOW", "60s"),
            rate_limit_trust_proxy_headers=_boolean("RATE_LIMIT_TRUST_PROXY_HEADERS", False),
            trusted_proxy_ips=_csv(os.getenv("TRUSTED_PROXY_IPS", "127.0.0.1")),
            comments_enabled=_boolean("COMMENTS_ENABLED", True),
            comments_max_length=int(os.getenv("COMMENTS_MAX_LENGTH", "1000")),
            content_storage=os.getenv("CONTENT_STORAGE", "files").strip().lower() or "files",
            editor_enabled=_boolean("EDITOR_ENABLED"),
            article_content_dir=_resolve_path(
                os.getenv("ARTICLE_CONTENT_DIR", "./public/articles"),
                project_root,
            ),
            chatter_content_dir=_resolve_path(
                os.getenv("CHATTER_CONTENT_DIR", "./public/chatter"),
                project_root,
            ),
            music_source=os.getenv("MUSIC_SOURCE", "local").strip().lower() or "local",
            music_content_dir=_resolve_path(
                os.getenv("MUSIC_CONTENT_DIR", "./music"),
                project_root,
            ),
            music_max_upload_bytes=int(os.getenv("MUSIC_MAX_UPLOAD_BYTES", str(50 * 1024 * 1024))),
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
