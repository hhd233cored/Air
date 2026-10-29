"""One-time, additive copy of the local Python SQLite data into the Java PostgreSQL DB.

Run from any directory with Python 3 and Docker Desktop available:
  python backend-spring/scripts/migrate_python_sqlite.py          # preflight only
  python backend-spring/scripts/migrate_python_sqlite.py --apply  # backup + import

The source is read through SQLite's online backup API. PostgreSQL is backed up
before the import. Existing target rows are never replaced, except auth_settings.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SOURCE = ROOT / "backend-python" / "data" / "auth.sqlite3"
DEFAULT_BACKUP_ROOT = ROOT / "backend-spring" / "target"
TABLES = ("users", "content_items", "comments", "guestbook_messages", "auth_settings")


class Jsonb(str):
    """A JSON string to cast to PostgreSQL jsonb after SQL quoting."""


def run(command: list[str], *, input_bytes: bytes | None = None) -> bytes:
    result = subprocess.run(command, input=input_bytes, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode:
        message = result.stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"{' '.join(command[:3])} failed: {message[-2000:]}")
    return result.stdout


def psql(container: str, sql: str) -> str:
    command = [
        "docker", "exec", "-i", container, "sh", "-c",
        'exec psql -X -q -A -t -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"',
    ]
    return run(command, input_bytes=sql.encode("utf-8")).decode("utf-8").strip()


def query_rows(container: str, select: str) -> list[dict]:
    output = psql(container, f"SELECT row_to_json(row_data) FROM ({select}) row_data;\n")
    return [json.loads(line) for line in output.splitlines() if line]


def target_rows(container: str) -> dict[str, list[dict]]:
    return {
        "users": query_rows(container, "SELECT id, username FROM users"),
        "content_items": query_rows(container, "SELECT id, content_type, slug FROM content_items"),
        "comments": query_rows(container, "SELECT id FROM comments"),
        "guestbook_messages": query_rows(container, "SELECT id FROM guestbook_messages"),
        "auth_settings": query_rows(container, "SELECT key, value FROM auth_settings"),
    }


def source_rows(path: Path) -> dict[str, list[dict]]:
    uri = "file:" + str(path.resolve()).replace("\\", "/") + "?mode=ro"
    with sqlite3.connect(uri, uri=True) as connection:
        connection.row_factory = sqlite3.Row
        if connection.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise RuntimeError("SQLite integrity_check failed")
        if connection.execute("PRAGMA foreign_key_check").fetchone() is not None:
            raise RuntimeError("SQLite foreign_key_check failed")
        rows = {
            table: [dict(row) for row in connection.execute(f'SELECT * FROM "{table}"')]
            for table in TABLES
        }
    if any(not str(user["password_hash"]).startswith("$argon2id$") for user in rows["users"]):
        raise RuntimeError("A source user password is not an Argon2id hash")
    if any(len(user["username"]) > 64 for user in rows["users"]):
        raise RuntimeError("A source username exceeds PostgreSQL's limit")
    for item in rows["content_items"]:
        if len(item["id"]) > 80 or len(item["slug"]) > 180:
            raise RuntimeError("A source content ID or slug exceeds PostgreSQL's limit")
        tags = json.loads(item["tags_json"])
        if not isinstance(tags, list) or any(not isinstance(tag, str) for tag in tags):
            raise RuntimeError("A source content item's tags are not a string array")
    content_targets = {(item["content_type"], item["slug"]) for item in rows["content_items"]}
    if any((comment["target_type"], comment["target_id"]) not in content_targets
           for comment in rows["comments"]):
        raise RuntimeError("A source comment refers to content absent from SQLite")
    return rows


def check_conflicts(source: dict[str, list[dict]], target: dict[str, list[dict]]) -> None:
    checks = (
        ("user ID", {row["id"] for row in source["users"]}, {row["id"] for row in target["users"]}),
        ("username", {row["username"].casefold() for row in source["users"]},
         {row["username"].casefold() for row in target["users"]}),
        ("content ID", {row["id"] for row in source["content_items"]},
         {row["id"] for row in target["content_items"]}),
        ("content type/slug", {(row["content_type"], row["slug"]) for row in source["content_items"]},
         {(row["content_type"], row["slug"]) for row in target["content_items"]}),
        ("comment ID", {row["id"] for row in source["comments"]},
         {row["id"] for row in target["comments"]}),
        ("guestbook ID", {row["id"] for row in source["guestbook_messages"]},
         {row["id"] for row in target["guestbook_messages"]}),
    )
    for name, incoming, existing in checks:
        if incoming & existing:
            raise RuntimeError(f"Target already contains one or more source {name} values; no rows imported")


def sql_value(value: object) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, bytes):
        return f"decode('{value.hex()}', 'hex')"
    if isinstance(value, Jsonb):
        return sql_value(str(value)) + "::jsonb"
    if not isinstance(value, str):
        raise TypeError(f"Unsupported SQL value type: {type(value).__name__}")
    if "\x00" in value:
        raise ValueError("PostgreSQL text cannot contain a NUL byte")
    return "'" + value.replace("'", "''") + "'"


def insert(table: str, columns: tuple[str, ...], values: tuple[object, ...]) -> str:
    return f"INSERT INTO {table} ({', '.join(columns)}) VALUES ({', '.join(map(sql_value, values))});"


def import_sql(source: dict[str, list[dict]]) -> str:
    sys.path.insert(0, str(ROOT / "backend-python"))
    from app.chatter_service import build_preview

    sql = ["BEGIN;", "SET LOCAL standard_conforming_strings = on;", "SET LOCAL lock_timeout = '5s';"]
    for row in source["users"]:
        sql.append(insert("users", (
            "id", "username", "password_hash", "role", "enabled", "avatar_data",
            "avatar_content_type", "avatar_updated_at", "created_at", "updated_at",
        ), (
            row["id"], row["username"], row["password_hash"], row["role"], bool(row["enabled"]),
            row["avatar_data"], row["avatar_content_type"], row["avatar_updated_at"],
            row["created_at"], row["updated_at"],
        )))
    for row in source["content_items"]:
        sql.append(insert("content_items", (
            "id", "content_type", "slug", "title", "summary", "preview", "cover_path",
            "cover_color", "tags", "status", "content_markdown", "published_at",
            "created_at", "updated_at", "deleted_at",
        ), (
            row["id"], row["content_type"], row["slug"], row["title"], row["summary"],
            build_preview(row["content_markdown"]), row["cover_path"], row["cover_color"],
            Jsonb(row["tags_json"]), row["status"], row["content_markdown"],
            row["published_at"], row["created_at"], row["updated_at"], row["deleted_at"],
        )))
    for row in source["comments"]:
        sql.append(insert("comments", (
            "id", "target_type", "target_id", "user_id", "parent_id", "content",
            "status", "created_at", "updated_at",
        ), (
            row["id"], row["target_type"], row["target_id"], row["user_id"], None,
            row["content"], row["status"], row["created_at"], row["updated_at"],
        )))
    for row in source["comments"]:
        if row["parent_id"] is not None:
            sql.append(f"UPDATE comments SET parent_id = {sql_value(row['parent_id'])} WHERE id = {sql_value(row['id'])};")
    for row in source["guestbook_messages"]:
        sql.append(insert("guestbook_messages", (
            "id", "user_id", "content", "status", "created_at", "updated_at",
        ), (
            row["id"], row["user_id"], row["content"], row["status"],
            row["created_at"], row["updated_at"],
        )))
    for row in source["auth_settings"]:
        sql.append(insert("auth_settings", ("key", "value", "updated_at"), (
            row["key"], row["value"], row["updated_at"],
        )).removesuffix(";") + " ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at;")
    for table in ("users", "comments", "guestbook_messages"):
        sql.append(f"SELECT setval(pg_get_serial_sequence('{table}', 'id'), (SELECT max(id) FROM {table}), true);")
    sql.extend(("COMMIT;", "SELECT 'MIGRATION_OK';"))
    return "\n".join(sql) + "\n"


def save_source_snapshot(source_path: Path, destination: Path) -> None:
    uri = "file:" + str(source_path.resolve()).replace("\\", "/") + "?mode=ro"
    with sqlite3.connect(uri, uri=True) as source, sqlite3.connect(destination) as target:
        source.backup(target)


def save_postgres_backup(container: str, destination: Path) -> None:
    command = ["docker", "exec", container, "sh", "-c",
               'exec pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB"']
    with destination.open("wb") as output:
        result = subprocess.run(command, stdout=output, stderr=subprocess.PIPE)
    if result.returncode or destination.stat().st_size == 0:
        raise RuntimeError("PostgreSQL backup failed: " + result.stderr.decode("utf-8", errors="replace")[-2000:])


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as data:
        for chunk in iter(lambda: data.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify(source: dict[str, list[dict]], before: dict[str, list[dict]],
           after: dict[str, list[dict]], container: str) -> None:
    for table in ("users", "content_items", "comments", "guestbook_messages"):
        if len(after[table]) != len(before[table]) + len(source[table]):
            raise RuntimeError(f"Post-import {table} count mismatch")
    for row in source["auth_settings"]:
        actual = next((item for item in after["auth_settings"] if item["key"] == row["key"]), None)
        if actual is None or actual["value"] != row["value"]:
            raise RuntimeError("Post-import auth setting mismatch")
    hash_queries = (
        ("users", "SELECT id, md5(password_hash) AS digest, md5(avatar_data) AS avatar_digest, "
         "octet_length(avatar_data) AS avatar_size FROM users",
         "password_hash"),
        ("content_items", "SELECT id, md5(content_markdown) AS digest FROM content_items", "content_markdown"),
        ("comments", "SELECT id, md5(content) AS digest FROM comments", "content"),
        ("guestbook_messages", "SELECT id, md5(content) AS digest FROM guestbook_messages", "content"),
    )
    for table, query, column in hash_queries:
        actual = {row["id"]: row for row in query_rows(container, query)}
        for row in source[table]:
            expected = hashlib.md5(row[column].encode("utf-8")).hexdigest()
            if row["id"] not in actual or actual[row["id"]]["digest"] != expected:
                raise RuntimeError(f"Post-import {table} content checksum mismatch")
            if table == "users":
                size = len(row["avatar_data"]) if row["avatar_data"] is not None else None
                if actual[row["id"]]["avatar_size"] != size:
                    raise RuntimeError("Post-import avatar size mismatch")
                avatar_digest = (hashlib.md5(row["avatar_data"]).hexdigest()
                                 if row["avatar_data"] is not None else None)
                if actual[row["id"]]["avatar_digest"] != avatar_digest:
                    raise RuntimeError("Post-import avatar checksum mismatch")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--container", default="backend-spring-postgres-1")
    parser.add_argument("--apply", action="store_true", help="Back up both databases, then import")
    args = parser.parse_args()

    if not args.source.is_file():
        raise RuntimeError("Source SQLite database does not exist")
    app_state = subprocess.run(["docker", "inspect", "-f", "{{.State.Running}}", "backend-spring-app-1"],
                               capture_output=True, text=True)
    if app_state.returncode == 0 and app_state.stdout.strip() == "true":
        raise RuntimeError("Stop the Java app before migrating; leave PostgreSQL running")
    source = source_rows(args.source)
    before = target_rows(args.container)
    check_conflicts(source, before)
    summary = {"source": {table: len(source[table]) for table in TABLES},
               "target_before": {table: len(before[table]) for table in TABLES}}
    if not args.apply:
        print(json.dumps({"status": "PREFLIGHT_OK", **summary}, ensure_ascii=False))
        return

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup_dir = DEFAULT_BACKUP_ROOT / f"python-sqlite-migration-{stamp}"
    backup_dir.mkdir(parents=True, exist_ok=False)
    source_backup = backup_dir / "source.sqlite3"
    target_backup = backup_dir / "target-before.dump"
    save_source_snapshot(args.source, source_backup)
    source = source_rows(source_backup)
    check_conflicts(source, before)
    save_postgres_backup(args.container, target_backup)
    if psql(args.container, import_sql(source)).splitlines()[-1] != "MIGRATION_OK":
        raise RuntimeError("PostgreSQL did not confirm the migration")
    after = target_rows(args.container)
    verify(source, before, after, args.container)
    report = {
        "status": "VERIFIED", **summary,
        "target_after": {table: len(after[table]) for table in TABLES},
        "source_backup": str(source_backup), "source_sha256": sha256(source_backup),
        "target_backup": str(target_backup), "target_backup_sha256": sha256(target_backup),
        "omitted": ["Python sessions", "SQLite FTS index", "media files", "article metrics (not in source DB)"],
    }
    (backup_dir / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, ValueError, sqlite3.Error, subprocess.SubprocessError) as error:
        print(f"Migration stopped: {error}", file=sys.stderr)
        raise SystemExit(1)
