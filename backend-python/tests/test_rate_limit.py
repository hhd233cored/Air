from __future__ import annotations

import sys
from pathlib import Path

import pytest
from dataclasses import replace
from fastapi.testclient import TestClient
from starlette.requests import Request

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "backend-python"))

from app.rate_limit import InMemoryRateLimiter, RateLimitError, RateLimitRule  # noqa: E402
from app.auth_service import AuthService  # noqa: E402
import app.main as main  # noqa: E402


def test_sliding_window_rejects_and_reports_retry_after() -> None:
    now = [100.0]
    limiter = InMemoryRateLimiter(clock=lambda: now[0])
    rule = RateLimitRule(limit=2, window_seconds=10)

    limiter.check("login-ip", "127.0.0.1", rule)
    limiter.check("login-ip", "127.0.0.1", rule)

    with pytest.raises(RateLimitError) as error:
        limiter.check("login-ip", "127.0.0.1", rule)

    assert error.value.limit == 2
    assert error.value.retry_after == 10

    now[0] = 110.1
    limiter.check("login-ip", "127.0.0.1", rule)


def test_rate_limit_keys_are_independent() -> None:
    limiter = InMemoryRateLimiter()
    rule = RateLimitRule(limit=1, window_seconds=60)

    limiter.check("register-ip", "127.0.0.1", rule)
    limiter.check("register-ip", "192.0.2.1", rule)

    with pytest.raises(RateLimitError):
        limiter.check("register-ip", "127.0.0.1", rule)

    # A separate bucket is not affected by the register bucket.
    limiter.check("login-ip", "127.0.0.1", rule)


def test_disabled_limiter_does_not_reject() -> None:
    limiter = InMemoryRateLimiter(enabled=False)
    rule = RateLimitRule(limit=1, window_seconds=60)

    limiter.check("login-ip", "127.0.0.1", rule)
    limiter.check("login-ip", "127.0.0.1", rule)


def test_login_returns_429_without_affecting_public_get(tmp_path: Path, monkeypatch) -> None:
    service = AuthService(tmp_path / "auth.sqlite3", session_timeout_seconds=3600)
    service.initialize_users(admin_username="admin", admin_password="admin-password")
    monkeypatch.setattr(main, "auth_service", service)
    monkeypatch.setattr(main, "rate_limiter", InMemoryRateLimiter())
    monkeypatch.setattr(
        main,
        "settings",
        replace(
            main.settings,
            auth_enabled=True,
            auth_csrf_enabled=True,
            auth_cookie_secure=False,
            auth_cookie_name="test_rate_limit_session",
            rate_limit_enabled=True,
            rate_limit_login_ip_max=1,
            rate_limit_login_ip_window_seconds=60,
            rate_limit_login_username_max=100,
            rate_limit_login_username_window_seconds=60,
            rate_limit_csrf_ip_max=100,
            rate_limit_csrf_ip_window_seconds=60,
        ),
    )
    client = TestClient(main.app)
    token = client.get("/api/v1/auth/csrf").json()["token"]
    headers = {"X-XSRF-TOKEN": token}

    assert client.post(
        "/api/v1/auth/login",
        json={"username": "admin", "password": "admin-password"},
        headers=headers,
    ).status_code == 200
    limited = client.post(
        "/api/v1/auth/login",
        json={"username": "admin", "password": "admin-password"},
        headers=headers,
    )

    assert limited.status_code == 429
    assert limited.json()["code"] == "RATE_LIMITED"
    assert limited.headers["retry-after"] == "60"
    assert client.get("/api/v1/health").status_code == 200


def test_proxy_headers_are_used_only_for_trusted_peer(monkeypatch) -> None:
    request = Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/",
            "headers": [(b"cf-connecting-ip", b"198.51.100.8")],
            "client": ("127.0.0.1", 1234),
        }
    )
    monkeypatch.setattr(
        main,
        "settings",
        replace(
            main.settings,
            rate_limit_trust_proxy_headers=True,
            trusted_proxy_ips=("127.0.0.1",),
        ),
    )
    assert main._request_ip(request) == "198.51.100.8"

    monkeypatch.setattr(
        main,
        "settings",
        replace(main.settings, rate_limit_trust_proxy_headers=False),
    )
    assert main._request_ip(request) == "127.0.0.1"
