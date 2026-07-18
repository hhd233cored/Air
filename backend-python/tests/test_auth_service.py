from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "backend-python"))

from app.auth_service import AuthError, AuthService, ROLE_ADMIN, ROLE_USER


def make_service(tmp_path: Path) -> AuthService:
    service = AuthService(tmp_path / "auth.sqlite3", session_timeout_seconds=3600)
    service.initialize_users(
        admin_username="admin",
        admin_password="admin-password",
        user_username="reader",
        user_password="reader-password",
    )
    return service


def test_sqlite_schema_and_bootstrap_store_only_argon2_hash(tmp_path: Path) -> None:
    service = make_service(tmp_path)

    with sqlite3.connect(service.database_path) as connection:
        users = connection.execute(
            "SELECT username, password_hash, role FROM users ORDER BY username"
        ).fetchall()

    assert [(row[0], row[2]) for row in users] == [("admin", ROLE_ADMIN), ("reader", ROLE_USER)]
    assert all(str(row[1]).startswith("$argon2") for row in users)
    assert all("admin-password" not in str(row[1]) for row in users)


def test_existing_bootstrap_account_is_not_overwritten(tmp_path: Path) -> None:
    service = make_service(tmp_path)
    service.initialize_users(
        admin_username="admin",
        admin_password="a-different-password",
        user_username="reader",
        user_password="a-different-password",
    )

    admin, _, _ = service.authenticate("admin", "admin-password")
    assert admin.role == ROLE_ADMIN
    with pytest.raises(AuthError) as error:
        service.authenticate("admin", "a-different-password")
    assert error.value.code == "AUTH_INVALID_CREDENTIALS"


def test_session_can_be_read_and_deleted(tmp_path: Path) -> None:
    service = make_service(tmp_path)
    user, token, _ = service.authenticate("reader", "reader-password")

    current = service.get_user_by_session(token)
    assert current == user

    service.delete_session(token)
    assert service.get_user_by_session(token) is None


def test_invalid_credentials_are_rejected(tmp_path: Path) -> None:
    service = make_service(tmp_path)
    with pytest.raises(AuthError) as error:
        service.authenticate("reader", "wrong-password")
    assert error.value.status_code == 401
    assert error.value.code == "AUTH_INVALID_CREDENTIALS"


def test_public_registration_creates_user_role_and_session(tmp_path: Path) -> None:
    service = AuthService(tmp_path / "auth.sqlite3", session_timeout_seconds=3600)

    user, token, _ = service.register("new-reader", "reader-password")

    assert user.role == ROLE_USER
    assert service.get_user_by_session(token) == user

    with pytest.raises(AuthError) as error:
        service.register("new-reader", "another-password")
    assert error.value.code == "AUTH_USERNAME_TAKEN"


def test_public_registration_rejects_short_password(tmp_path: Path) -> None:
    service = AuthService(tmp_path / "auth.sqlite3", session_timeout_seconds=3600)
    with pytest.raises(AuthError) as error:
        service.register("short-password", "1234567")
    assert error.value.code == "AUTH_WEAK_PASSWORD"
    assert error.value.status_code == 400


def test_registration_setting_is_persistent(tmp_path: Path) -> None:
    database = tmp_path / "auth.sqlite3"
    service = AuthService(database, session_timeout_seconds=3600, registration_enabled=False)

    assert service.is_registration_enabled() is False
    service.set_registration_enabled(True)
    assert service.is_registration_enabled() is True

    reloaded = AuthService(database, session_timeout_seconds=3600, registration_enabled=False)
    assert reloaded.is_registration_enabled() is True


def test_existing_users_table_is_upgraded_with_avatar_columns(tmp_path: Path) -> None:
    database = tmp_path / "legacy.sqlite3"
    with sqlite3.connect(database) as connection:
        connection.execute(
            """
            CREATE TABLE users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL,
                enabled INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )

    service = AuthService(database, session_timeout_seconds=3600)
    with sqlite3.connect(database) as connection:
        columns = {row[1] for row in connection.execute("PRAGMA table_info(users)")}
    assert {"avatar_data", "avatar_content_type", "avatar_updated_at"}.issubset(columns)
    assert service.get_avatar(1) is None


def test_admin_user_management_filters_updates_and_revokes_sessions(tmp_path: Path) -> None:
    service = make_service(tmp_path)
    reader, reader_token, _ = service.authenticate("reader", "reader-password")

    created = service.create_admin_user(
        username="new-admin",
        password="new-password",
        role=ROLE_ADMIN,
        enabled=True,
    )
    assert created.username == "new-admin"
    users, total = service.list_admin_users(page=0, size=20, role=ROLE_ADMIN, enabled=True)
    assert total == 2
    assert {user.username for user in users} == {"admin", "new-admin"}

    updated = service.update_admin_user(
        user_id=reader.id,
        actor_id=1,
        role=ROLE_USER,
        enabled=False,
    )
    assert updated.enabled is False
    assert service.get_user_by_session(reader_token) is None

    with pytest.raises(AuthError) as error:
        service.update_admin_user(user_id=1, actor_id=999, enabled=False)
    assert error.value.code == "AUTH_LAST_ADMIN"

    admin, admin_token, _ = service.authenticate("admin", "admin-password")
    assert service.get_user_by_session(admin_token) == admin
    service.reset_admin_password(user_id=admin.id, password="changed-password")
    assert service.get_user_by_session(admin_token) is None
    service.authenticate("admin", "changed-password")
