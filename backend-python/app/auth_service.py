"""SQLite-backed users and server-side sessions for the Python API."""

from __future__ import annotations

import hashlib
import re
import secrets
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

from pwdlib import PasswordHash


ROLE_USER = "USER"
ROLE_ADMIN = "ADMIN"
VALID_ROLES = {ROLE_USER, ROLE_ADMIN}
USERNAME_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$")


class AuthError(Exception):
    def __init__(self, code: str, message: str, status_code: int = 401) -> None:
        super().__init__(message)
        self.code = code
        self.status_code = status_code


@dataclass(frozen=True)
class UserRecord:
    id: int
    username: str
    role: str
    enabled: bool
    avatar_present: bool = False
    avatar_version: str | None = None


@dataclass(frozen=True)
class AdminUserRecord:
    id: int
    username: str
    role: str
    enabled: bool
    avatar_present: bool
    avatar_version: str | None
    created_at: str
    updated_at: str


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _format_timestamp(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _parse_timestamp(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


class AuthService:
    def __init__(self, database_path: Path, session_timeout_seconds: int, registration_enabled: bool = True) -> None:
        self.database_path = database_path.resolve()
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        self.session_timeout = timedelta(seconds=session_timeout_seconds)
        self.password_hash = PasswordHash.recommended()
        self.initialize_schema()
        self.initialize_settings(registration_enabled)

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database_path, timeout=5)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 5000")
        return connection

    def initialize_schema(self) -> None:
        with self._connect() as connection:
            connection.execute("PRAGMA journal_mode = WAL")
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT NOT NULL COLLATE NOCASE UNIQUE,
                    password_hash TEXT NOT NULL,
                    role TEXT NOT NULL CHECK (role IN ('USER', 'ADMIN')),
                    enabled INTEGER NOT NULL DEFAULT 1,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    avatar_data BLOB NULL,
                    avatar_content_type TEXT NULL,
                    avatar_updated_at TEXT NULL
                );

                CREATE TABLE IF NOT EXISTS sessions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    token_hash TEXT NOT NULL UNIQUE,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    expires_at TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    last_seen_at TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
                CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

                CREATE TABLE IF NOT EXISTS auth_settings (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                """
            )
            self._ensure_column(connection, "users", "avatar_data", "BLOB NULL")
            self._ensure_column(connection, "users", "avatar_content_type", "TEXT NULL")
            self._ensure_column(connection, "users", "avatar_updated_at", "TEXT NULL")

    def initialize_settings(self, registration_enabled: bool) -> None:
        now = _format_timestamp(_utc_now())
        with self._connect() as connection:
            connection.execute(
                """
                INSERT OR IGNORE INTO auth_settings (key, value, updated_at)
                VALUES ('registration_enabled', ?, ?)
                """,
                ("1" if registration_enabled else "0", now),
            )

    def is_registration_enabled(self) -> bool:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT value FROM auth_settings WHERE key = 'registration_enabled'"
            ).fetchone()
        if row is None:
            return True
        return str(row["value"]).lower() in {"1", "true", "yes", "on"}

    def set_registration_enabled(self, enabled: bool) -> bool:
        now = _format_timestamp(_utc_now())
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO auth_settings (key, value, updated_at)
                VALUES ('registration_enabled', ?, ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
                """,
                ("1" if enabled else "0", now),
            )
        return enabled

    @staticmethod
    def _ensure_column(
        connection: sqlite3.Connection,
        table: str,
        column: str,
        definition: str,
    ) -> None:
        columns = {
            str(row[1])
            for row in connection.execute(f"PRAGMA table_info({table})").fetchall()
        }
        if column not in columns:
            connection.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")

    def initialize_users(
        self,
        *,
        admin_username: str,
        admin_password: str,
        user_username: str = "",
        user_password: str = "",
    ) -> None:
        if admin_username or admin_password:
            self._ensure_bootstrap_user(admin_username, admin_password, ROLE_ADMIN)
        if user_username or user_password:
            self._ensure_bootstrap_user(user_username, user_password, ROLE_USER)

    def _ensure_bootstrap_user(self, username: str, password: str, role: str) -> None:
        normalized_username = self._validate_username(username)
        if not password:
            raise ValueError(f"Password is required for AUTH_{role}_USERNAME")
        if len(password) < 8:
            raise ValueError(f"Password for {normalized_username} must contain at least 8 characters")
        with self._connect() as connection:
            existing = connection.execute(
                "SELECT id FROM users WHERE username = ?",
                (normalized_username,),
            ).fetchone()
            if existing is not None:
                return
            now = _format_timestamp(_utc_now())
            connection.execute(
                """
                INSERT INTO users (username, password_hash, role, enabled, created_at, updated_at)
                VALUES (?, ?, ?, 1, ?, ?)
                """,
                (normalized_username, self.password_hash.hash(password), role, now, now),
            )

    def register(self, username: str, password: str) -> tuple[UserRecord, str, datetime]:
        normalized_username = self._validate_username(username)
        if len(password) < 8:
            raise AuthError("AUTH_WEAK_PASSWORD", "密码至少需要 8 个字符", 400)
        now = _format_timestamp(_utc_now())
        try:
            with self._connect() as connection:
                cursor = connection.execute(
                    """
                    INSERT INTO users (username, password_hash, role, enabled, created_at, updated_at)
                    VALUES (?, ?, ?, 1, ?, ?)
                    """,
                    (normalized_username, self.password_hash.hash(password), ROLE_USER, now, now),
                )
                user_id = int(cursor.lastrowid)
        except sqlite3.IntegrityError as exc:
            raise AuthError("AUTH_USERNAME_TAKEN", "用户名已被注册", 409) from exc

        user = UserRecord(user_id, normalized_username, ROLE_USER, True, False)
        token, expires_at = self.create_session(user.id)
        return user, token, expires_at

    def authenticate(self, username: str, password: str) -> tuple[UserRecord, str, datetime]:
        normalized_username = self._validate_username(username)
        with self._connect() as connection:
            row = connection.execute(
                "SELECT id, username, password_hash, role, enabled, avatar_data, avatar_updated_at FROM users WHERE username = ?",
                (normalized_username,),
            ).fetchone()
        if row is None or not row["enabled"]:
            raise AuthError("AUTH_INVALID_CREDENTIALS", "用户名或密码错误", 401)
        try:
            password_valid = self.password_hash.verify(password, row["password_hash"])
        except Exception:
            password_valid = False
        if not password_valid:
            raise AuthError("AUTH_INVALID_CREDENTIALS", "用户名或密码错误", 401)
        user = UserRecord(
            int(row["id"]),
            str(row["username"]),
            str(row["role"]),
            bool(row["enabled"]),
            row["avatar_data"] is not None,
            str(row["avatar_updated_at"]) if row["avatar_updated_at"] else None,
        )
        token, expires_at = self.create_session(user.id)
        return user, token, expires_at

    def create_session(self, user_id: int) -> tuple[str, datetime]:
        token = secrets.token_urlsafe(32)
        now = _utc_now()
        expires_at = now + self.session_timeout
        with self._connect() as connection:
            self._delete_expired_sessions(connection, now)
            connection.execute(
                """
                INSERT INTO sessions (token_hash, user_id, expires_at, created_at, last_seen_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    self._hash_token(token),
                    user_id,
                    _format_timestamp(expires_at),
                    _format_timestamp(now),
                    _format_timestamp(now),
                ),
            )
        return token, expires_at

    def get_user_by_session(self, token: str | None) -> UserRecord | None:
        if not token:
            return None
        now = _utc_now()
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT u.id, u.username, u.role, u.enabled, u.avatar_data, u.avatar_updated_at, s.expires_at
                FROM sessions s
                JOIN users u ON u.id = s.user_id
                WHERE s.token_hash = ?
                """,
                (self._hash_token(token),),
            ).fetchone()
            if row is None:
                return None
            if _parse_timestamp(str(row["expires_at"])) <= now or not row["enabled"]:
                connection.execute("DELETE FROM sessions WHERE token_hash = ?", (self._hash_token(token),))
                return None
            connection.execute(
                "UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?",
                (_format_timestamp(now), self._hash_token(token)),
            )
        return UserRecord(
            int(row["id"]),
            str(row["username"]),
            str(row["role"]),
            bool(row["enabled"]),
            row["avatar_data"] is not None,
            str(row["avatar_updated_at"]) if row["avatar_updated_at"] else None,
        )

    def get_user_by_id(self, user_id: int) -> UserRecord | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT id, username, role, enabled, avatar_data, avatar_updated_at FROM users WHERE id = ?",
                (user_id,),
            ).fetchone()
        if row is None:
            return None
        return UserRecord(
            int(row["id"]),
            str(row["username"]),
            str(row["role"]),
            bool(row["enabled"]),
            row["avatar_data"] is not None,
            str(row["avatar_updated_at"]) if row["avatar_updated_at"] else None,
        )

    def list_admin_users(
        self,
        *,
        page: int,
        size: int,
        query: str | None = None,
        role: str | None = None,
        enabled: bool | None = None,
    ) -> tuple[list[AdminUserRecord], int]:
        normalized_role = role.upper() if role else None
        if normalized_role is not None and normalized_role not in VALID_ROLES:
            raise AuthError("AUTH_INVALID_ROLE", "Unsupported user role", 400)

        clauses: list[str] = []
        values: list[object] = []
        if query and query.strip():
            clauses.append("username LIKE ? COLLATE NOCASE")
            values.append(f"%{query.strip()}%")
        if normalized_role is not None:
            clauses.append("role = ?")
            values.append(normalized_role)
        if enabled is not None:
            clauses.append("enabled = ?")
            values.append(1 if enabled else 0)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""

        with self._connect() as connection:
            total = int(connection.execute(f"SELECT COUNT(*) FROM users {where}", values).fetchone()[0])
            rows = connection.execute(
                f"""
                SELECT id, username, role, enabled, avatar_data, avatar_updated_at, created_at, updated_at
                FROM users
                {where}
                ORDER BY created_at DESC, id DESC
                LIMIT ? OFFSET ?
                """,
                (*values, size, page * size),
            ).fetchall()
        return [self._to_admin_record(row) for row in rows], total

    def get_admin_user(self, user_id: int) -> AdminUserRecord | None:
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT id, username, role, enabled, avatar_data, avatar_updated_at, created_at, updated_at
                FROM users WHERE id = ?
                """,
                (user_id,),
            ).fetchone()
        return self._to_admin_record(row) if row is not None else None

    def create_admin_user(
        self,
        *,
        username: str,
        password: str,
        role: str,
        enabled: bool,
    ) -> AdminUserRecord:
        normalized_username = self._validate_username(username)
        normalized_role = role.upper()
        if normalized_role not in VALID_ROLES:
            raise AuthError("AUTH_INVALID_ROLE", "Unsupported user role", 400)
        self._validate_password(password)
        now = _format_timestamp(_utc_now())
        try:
            with self._connect() as connection:
                cursor = connection.execute(
                    """
                    INSERT INTO users (username, password_hash, role, enabled, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        normalized_username,
                        self.password_hash.hash(password),
                        normalized_role,
                        1 if enabled else 0,
                        now,
                        now,
                    ),
                )
                user_id = int(cursor.lastrowid)
        except sqlite3.IntegrityError as exc:
            raise AuthError("AUTH_USERNAME_TAKEN", "Username is already taken", 409) from exc

        created = self.get_admin_user(user_id)
        if created is None:
            raise AuthError("AUTH_USER_NOT_FOUND", "User was not created", 500)
        return created

    def update_admin_user(
        self,
        *,
        user_id: int,
        actor_id: int,
        role: str | None = None,
        enabled: bool | None = None,
    ) -> AdminUserRecord:
        current = self.get_admin_user(user_id)
        if current is None:
            raise AuthError("AUTH_USER_NOT_FOUND", "User not found", 404)
        normalized_role = role.upper() if role else None
        if normalized_role is not None and normalized_role not in VALID_ROLES:
            raise AuthError("AUTH_INVALID_ROLE", "Unsupported user role", 400)
        next_role = normalized_role or current.role
        next_enabled = current.enabled if enabled is None else enabled

        if actor_id == user_id and (next_role != current.role or next_enabled != current.enabled):
            raise AuthError("AUTH_SELF_PROTECTED", "You cannot change your own role or enabled state", 403)
        if current.role == ROLE_ADMIN and current.enabled and (next_role != ROLE_ADMIN or not next_enabled):
            with self._connect() as connection:
                active_admins = int(
                    connection.execute(
                        "SELECT COUNT(*) FROM users WHERE role = ? AND enabled = 1",
                        (ROLE_ADMIN,),
                    ).fetchone()[0]
                )
            if active_admins <= 1:
                raise AuthError("AUTH_LAST_ADMIN", "The last enabled administrator cannot be disabled or demoted", 409)

        now = _format_timestamp(_utc_now())
        with self._connect() as connection:
            connection.execute(
                "UPDATE users SET role = ?, enabled = ?, updated_at = ? WHERE id = ?",
                (next_role, 1 if next_enabled else 0, now, user_id),
            )
            if next_role != current.role or next_enabled != current.enabled:
                self._delete_user_sessions(connection, user_id)

        updated = self.get_admin_user(user_id)
        if updated is None:
            raise AuthError("AUTH_USER_NOT_FOUND", "User not found", 404)
        return updated

    def reset_admin_password(self, *, user_id: int, password: str) -> AdminUserRecord:
        self._validate_password(password)
        if self.get_admin_user(user_id) is None:
            raise AuthError("AUTH_USER_NOT_FOUND", "User not found", 404)
        now = _format_timestamp(_utc_now())
        with self._connect() as connection:
            connection.execute(
                "UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?",
                (self.password_hash.hash(password), now, user_id),
            )
            self._delete_user_sessions(connection, user_id)
        updated = self.get_admin_user(user_id)
        if updated is None:
            raise AuthError("AUTH_USER_NOT_FOUND", "User not found", 404)
        return updated

    def delete_user_sessions(self, user_id: int) -> None:
        with self._connect() as connection:
            self._delete_user_sessions(connection, user_id)

    @staticmethod
    def _delete_user_sessions(connection: sqlite3.Connection, user_id: int) -> None:
        connection.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))

    def update_avatar(self, user_id: int, data: bytes, content_type: str) -> UserRecord:
        now = _format_timestamp(_utc_now())
        with self._connect() as connection:
            connection.execute(
                """
                UPDATE users
                SET avatar_data = ?, avatar_content_type = ?, avatar_updated_at = ?, updated_at = ?
                WHERE id = ?
                """,
                (sqlite3.Binary(data), content_type, now, now, user_id),
            )
        user = self.get_user_by_id(user_id)
        if user is None:
            raise AuthError("AUTH_REQUIRED", "Authentication is required", 401)
        return user

    def delete_avatar(self, user_id: int) -> UserRecord:
        now = _format_timestamp(_utc_now())
        with self._connect() as connection:
            connection.execute(
                """
                UPDATE users
                SET avatar_data = NULL, avatar_content_type = NULL, avatar_updated_at = NULL, updated_at = ?
                WHERE id = ?
                """,
                (now, user_id),
            )
        user = self.get_user_by_id(user_id)
        if user is None:
            raise AuthError("AUTH_REQUIRED", "Authentication is required", 401)
        return user

    def get_avatar(self, user_id: int) -> tuple[bytes, str] | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT avatar_data, avatar_content_type FROM users WHERE id = ?",
                (user_id,),
            ).fetchone()
        if row is None or row["avatar_data"] is None or not row["avatar_content_type"]:
            return None
        return bytes(row["avatar_data"]), str(row["avatar_content_type"])

    def delete_session(self, token: str | None) -> None:
        if not token:
            return
        with self._connect() as connection:
            connection.execute("DELETE FROM sessions WHERE token_hash = ?", (self._hash_token(token),))

    @staticmethod
    def _delete_expired_sessions(connection: sqlite3.Connection, now: datetime) -> None:
        connection.execute("DELETE FROM sessions WHERE expires_at <= ?", (_format_timestamp(now),))

    @staticmethod
    def _hash_token(token: str) -> str:
        return hashlib.sha256(token.encode("utf-8")).hexdigest()

    @staticmethod
    def _validate_username(username: str) -> str:
        normalized = username.strip()
        if not USERNAME_PATTERN.fullmatch(normalized):
            raise AuthError("AUTH_INVALID_USERNAME", "用户名只能包含字母、数字、点、下划线和连字符", 400)
        return normalized

    @staticmethod
    def _validate_password(password: str) -> None:
        if len(password) < 8:
            raise AuthError("AUTH_WEAK_PASSWORD", "Password must contain at least 8 characters", 400)
        if len(password) > 256:
            raise AuthError("AUTH_WEAK_PASSWORD", "Password is too long", 400)

    @staticmethod
    def _to_admin_record(row: sqlite3.Row) -> AdminUserRecord:
        return AdminUserRecord(
            id=int(row["id"]),
            username=str(row["username"]),
            role=str(row["role"]),
            enabled=bool(row["enabled"]),
            avatar_present=row["avatar_data"] is not None,
            avatar_version=str(row["avatar_updated_at"]) if row["avatar_updated_at"] else None,
            created_at=str(row["created_at"]),
            updated_at=str(row["updated_at"]),
        )
