"""FastAPI entrypoint for the lightweight read-only blog API."""

from __future__ import annotations

import asyncio
import hmac
import ipaddress
import secrets
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from urllib.parse import quote

from fastapi import Depends, FastAPI, File, Form, Query, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from .article_service import ArticleNotFoundError, ArticleService
from .admin_models import (
    AdminPasswordResetRequest,
    AdminUser,
    AdminUserCreateRequest,
    AdminUserPageResponse,
    AdminUserUpdateRequest,
    RegistrationSetting,
    RegistrationSettingRequest,
)
from .auth_models import AuthUser, AuthUserResponse, CsrfResponse, LoginRequest, RegisterRequest
from .auth_service import AdminUserRecord, AuthError, AuthService, ROLE_ADMIN, UserRecord
from .chatter_service import ChatterNotFoundError, ChatterService
from .chatter_models import ChatterDetail, ChatterPageResponse
from .chatter_editor_service import ChatterEditorService
from .comment_models import Comment, CommentCreateRequest, CommentPageResponse, CommentStatusRequest
from .comment_service import CommentError, CommentService, TARGET_ARTICLE, TARGET_CHATTER
from .config import Settings
from .content_models import ContentSearchPageResponse
from .content_service import (
    ContentStorageError,
    ContentStore,
    DatabaseArticleEditorService,
    DatabaseArticleService,
    DatabaseChatterEditorService,
    DatabaseChatterService,
    to_search_page,
)
from .editor_models import EditorArticleDetail, EditorArticlePageResponse
from .editor_service import ArticleEditorService, EditorError
from .historical_service import HistoricalTodayService
from .guestbook_service import GuestbookError, GuestbookService
from .local_music_service import LocalMusicService
from .music_models import MusicPlaylistResponse, MusicTrackUrlResponse
from .music_service import MusicService, MusicServiceError
from .models import ArticleDetail, ArticlePageResponse, HistoricalTodayResponse
from .rate_limit import InMemoryRateLimiter, RateLimitError, RateLimitRule


settings = Settings.from_environment()
if settings.content_storage not in {"files", "database"}:
    raise ValueError("CONTENT_STORAGE must be 'files' or 'database'")
content_store = (
    ContentStore(settings.auth_database_path, settings.article_content_dir, settings.chatter_content_dir)
    if settings.content_storage == "database"
    else None
)
article_service = DatabaseArticleService(content_store) if content_store is not None else ArticleService(settings.article_content_dir)
chatter_service = DatabaseChatterService(content_store) if content_store is not None else ChatterService(settings.chatter_content_dir)
historical_service = HistoricalTodayService(settings.wikipedia_on_this_day_url)
auth_service = (
    AuthService(settings.auth_database_path, settings.auth_session_timeout_seconds, settings.auth_registration_enabled)
    if settings.auth_enabled
    else None
)
rate_limiter = InMemoryRateLimiter(
    enabled=settings.rate_limit_enabled,
    max_keys=settings.rate_limit_max_keys,
)
editor_service = (
    DatabaseArticleEditorService(content_store)
    if settings.editor_enabled and content_store is not None
    else ArticleEditorService(settings.article_content_dir) if settings.editor_enabled else None
)
chatter_editor_service = (
    DatabaseChatterEditorService(content_store)
    if settings.editor_enabled and content_store is not None
    else ChatterEditorService(settings.chatter_content_dir) if settings.editor_enabled else None
)
comment_service = (
    CommentService(
        settings.auth_database_path,
        article_service,
        chatter_service,
        settings.comments_max_length,
    )
    if settings.auth_enabled and settings.comments_enabled
    else None
)
guestbook_service = (
    GuestbookService(settings.auth_database_path, settings.comments_max_length)
    if settings.auth_enabled and settings.comments_enabled
    else None
)
if settings.music_source == "local":
    music_service = LocalMusicService(settings.music_content_dir)
elif settings.music_source == "netease":
    music_service = MusicService(settings)
else:
    raise ValueError("MUSIC_SOURCE must be 'local' or 'netease'")


@asynccontextmanager
async def lifespan(_: FastAPI):
    if auth_service is not None:
        auth_service.initialize_users(
            admin_username=settings.auth_admin_username,
            admin_password=settings.auth_admin_password,
            user_username=settings.auth_user_username,
            user_password=settings.auth_user_password,
        )
    # Warm the in-memory cache once after the server starts so the first browser request is fast.
    await asyncio.to_thread(historical_service.get_today)
    yield


app = FastAPI(title="Your Space API", docs_url=None, redoc_url=None, lifespan=lifespan)
app.mount("/articles", StaticFiles(directory=settings.article_content_dir), name="articles")
app.mount("/chatter", StaticFiles(directory=settings.chatter_content_dir), name="chatter")
app.mount("/music", StaticFiles(directory=settings.music_content_dir), name="music")
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.cors_allowed_origins),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Accept", "Content-Type", "X-XSRF-TOKEN"],
    expose_headers=["Retry-After", "X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset"],
    max_age=3600,
)


@app.exception_handler(ArticleNotFoundError)
async def article_not_found(request: Request, exception: ArticleNotFoundError) -> JSONResponse:
    return _error_response(
        status_code=404,
        code="ARTICLE_NOT_FOUND",
        message=str(exception),
        path=request.url.path,
    )


@app.exception_handler(ChatterNotFoundError)
async def chatter_not_found(request: Request, exception: ChatterNotFoundError) -> JSONResponse:
    return _error_response(
        status_code=404,
        code="CHATTER_NOT_FOUND",
        message=str(exception),
        path=request.url.path,
    )


@app.exception_handler(RequestValidationError)
async def invalid_request(request: Request, exception: RequestValidationError) -> JSONResponse:
    return _error_response(
        status_code=400,
        code="BAD_REQUEST",
        message="Invalid request parameters",
        path=request.url.path,
    )


@app.exception_handler(Exception)
async def unexpected_error(request: Request, exception: Exception) -> JSONResponse:
    return _error_response(
        status_code=500,
        code="INTERNAL_ERROR",
        message="Unexpected server error",
        path=request.url.path,
    )


@app.exception_handler(MusicServiceError)
async def music_error(request: Request, exception: MusicServiceError) -> JSONResponse:
    return _error_response(exception.status_code, exception.code, exception.message, request.url.path)


@app.exception_handler(EditorError)
async def editor_error(request: Request, exception: EditorError) -> JSONResponse:
    return _error_response(exception.status_code, exception.code, str(exception), request.url.path)


@app.exception_handler(ContentStorageError)
async def content_storage_error(request: Request, exception: ContentStorageError) -> JSONResponse:
    return _error_response(exception.status_code, exception.code, str(exception), request.url.path)


@app.exception_handler(AuthError)
async def auth_error(request: Request, exception: AuthError) -> JSONResponse:
    messages = {
        "AUTH_INVALID_CREDENTIALS": "用户名或密码错误",
        "AUTH_REQUIRED": "请先登录",
        "AUTH_FORBIDDEN": "当前账号没有执行此操作的权限",
        "CSRF_INVALID": "安全令牌无效或已缺失",
        "AUTH_DISABLED": "鉴权服务未启用",
        "AUTH_REGISTRATION_DISABLED": "公开注册未开启",
        "AUTH_INVALID_USERNAME": "用户名格式无效",
        "AUTH_WEAK_PASSWORD": "密码至少需要 8 个字符",
        "AUTH_USERNAME_TAKEN": "用户名已被注册",
    }
    return _error_response(
        exception.status_code,
        exception.code,
        messages.get(exception.code, str(exception)),
        request.url.path,
    )


@app.exception_handler(RateLimitError)
async def rate_limit_error(request: Request, exception: RateLimitError) -> JSONResponse:
    response = _error_response(
        status_code=429,
        code="RATE_LIMITED",
        message="请求过于频繁，请稍后再试",
        path=request.url.path,
    )
    response.headers["Retry-After"] = str(exception.retry_after)
    response.headers["X-RateLimit-Limit"] = str(exception.limit)
    response.headers["X-RateLimit-Remaining"] = "0"
    response.headers["X-RateLimit-Reset"] = str(exception.reset_after)
    return response


@app.exception_handler(CommentError)
async def comment_error(request: Request, exception: CommentError) -> JSONResponse:
    return _error_response(exception.status_code, exception.code, str(exception), request.url.path)


@app.exception_handler(GuestbookError)
async def guestbook_error(request: Request, exception: GuestbookError) -> JSONResponse:
    return _error_response(exception.status_code, exception.code, str(exception), request.url.path)


CSRF_COOKIE_NAME = "XSRF-TOKEN"
CSRF_HEADER_NAME = "X-XSRF-TOKEN"


def _request_ip(request: Request) -> str:
    """Return a client key without blindly trusting spoofable proxy headers."""

    peer = request.client.host if request.client else "unknown"
    if not settings.rate_limit_trust_proxy_headers or peer not in settings.trusted_proxy_ips:
        return peer

    cloudflare_ip = request.headers.get("CF-Connecting-IP", "").strip()
    forwarded_for = request.headers.get("X-Forwarded-For", "").split(",", 1)[0].strip()
    candidate = cloudflare_ip or forwarded_for
    if not candidate:
        return peer
    try:
        return str(ipaddress.ip_address(candidate))
    except ValueError:
        return peer


def _check_rate(bucket: str, identifier: str, limit: int, window_seconds: int) -> None:
    if not settings.rate_limit_enabled:
        return
    rate_limiter.check(
        bucket,
        identifier,
        RateLimitRule(limit=limit, window_seconds=window_seconds),
    )


def _check_ip_rate(request: Request, bucket: str, limit: int, window_seconds: int) -> None:
    _check_rate(bucket, _request_ip(request), limit, window_seconds)


def _check_user_rate(user: UserRecord, bucket: str, limit: int, window_seconds: int) -> None:
    _check_rate(bucket, str(user.id), limit, window_seconds)


def rate_limit_csrf(request: Request) -> None:
    _check_ip_rate(
        request,
        "csrf",
        settings.rate_limit_csrf_ip_max,
        settings.rate_limit_csrf_ip_window_seconds,
    )


def rate_limit_login_ip(request: Request) -> None:
    _check_ip_rate(
        request,
        "login-ip",
        settings.rate_limit_login_ip_max,
        settings.rate_limit_login_ip_window_seconds,
    )


def rate_limit_register_ip(request: Request) -> None:
    _check_ip_rate(
        request,
        "register-ip",
        settings.rate_limit_register_ip_max,
        settings.rate_limit_register_ip_window_seconds,
    )


def rate_limit_comment_ip(request: Request) -> None:
    _check_ip_rate(
        request,
        "comment-ip",
        settings.rate_limit_comment_ip_max,
        settings.rate_limit_comment_ip_window_seconds,
    )


def rate_limit_guestbook_ip(request: Request) -> None:
    _check_ip_rate(
        request,
        "guestbook-ip",
        settings.rate_limit_guestbook_ip_max,
        settings.rate_limit_guestbook_ip_window_seconds,
    )


def rate_limit_admin_ip(request: Request) -> None:
    _check_ip_rate(
        request,
        "admin-ip",
        settings.rate_limit_admin_max,
        settings.rate_limit_admin_window_seconds,
    )


def _require_auth_enabled() -> AuthService:
    if auth_service is None:
        raise AuthError("AUTH_DISABLED", "Authentication is disabled", 404)
    return auth_service


def _to_auth_user(user: UserRecord) -> AuthUser:
    avatar_url = None
    if user.avatar_present:
        version = quote(user.avatar_version or "1", safe="")
        avatar_url = f"/api/v1/users/{user.id}/avatar?v={version}"
    return AuthUser(
        id=user.id,
        username=user.username,
        role=user.role,
        avatarUrl=avatar_url,
    )


def _to_admin_user(user: AdminUserRecord) -> AdminUser:
    avatar_url = None
    if user.avatar_present:
        version = quote(user.avatar_version or "1", safe="")
        avatar_url = f"/api/v1/users/{user.id}/avatar?v={version}"
    return AdminUser(
        id=user.id,
        username=user.username,
        role=user.role,  # type: ignore[arg-type]
        enabled=user.enabled,
        avatarUrl=avatar_url,
        createdAt=user.created_at,
        updatedAt=user.updated_at,
    )


def _set_csrf_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=CSRF_COOKIE_NAME,
        value=token,
        max_age=settings.auth_session_timeout_seconds,
        httponly=False,
        secure=settings.auth_cookie_secure,
        samesite=settings.auth_cookie_samesite,
        path="/",
    )


def _set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=settings.auth_cookie_name,
        value=token,
        max_age=settings.auth_session_timeout_seconds,
        httponly=True,
        secure=settings.auth_cookie_secure,
        samesite=settings.auth_cookie_samesite,
        path="/",
    )


def _clear_session_cookie(response: Response) -> None:
    response.delete_cookie(key=settings.auth_cookie_name, path="/")


def require_csrf(request: Request, _: None = Depends(rate_limit_csrf)) -> None:
    if not settings.auth_enabled or not settings.auth_csrf_enabled:
        return
    cookie_token = request.cookies.get(CSRF_COOKIE_NAME, "")
    header_token = request.headers.get(CSRF_HEADER_NAME, "")
    if not cookie_token or not header_token or not hmac.compare_digest(cookie_token, header_token):
        raise AuthError("CSRF_INVALID", "CSRF token is missing or invalid", 403)


def require_current_user(request: Request) -> UserRecord:
    service = _require_auth_enabled()
    token = request.cookies.get(settings.auth_cookie_name)
    if not token:
        raise AuthError("AUTH_REQUIRED", "Authentication is required", 401)
    user = service.get_user_by_session(token)
    if user is None:
        raise AuthError("AUTH_REQUIRED", "Authentication is required", 401)
    return user


def require_admin(user: UserRecord = Depends(require_current_user)) -> UserRecord:
    if user.role != ROLE_ADMIN:
        raise AuthError("AUTH_FORBIDDEN", "Administrator role is required", 403)
    return user


def require_editor_admin(user: UserRecord = Depends(require_current_user)) -> UserRecord:
    if not settings.editor_enabled:
        raise EditorError("EDITOR_DISABLED", "Local article editor is disabled", 404)
    if user.role != ROLE_ADMIN:
        raise AuthError("AUTH_FORBIDDEN", "Administrator role is required", 403)
    return user


@app.get("/api/v1/auth/csrf", response_model=CsrfResponse)
def get_csrf_token(
    request: Request,
    response: Response,
    _: None = Depends(rate_limit_csrf),
) -> CsrfResponse:
    _require_auth_enabled()
    token = request.cookies.get(CSRF_COOKIE_NAME) or secrets.token_urlsafe(32)
    _set_csrf_cookie(response, token)
    response.headers["Cache-Control"] = "no-store"
    return CsrfResponse(token=token)


@app.post("/api/v1/auth/login", response_model=AuthUserResponse)
def login(
    payload: LoginRequest,
    response: Response,
    _: None = Depends(require_csrf),
    __: None = Depends(rate_limit_login_ip),
) -> AuthUserResponse:
    _check_rate(
        "login-username",
        payload.username.strip().lower(),
        settings.rate_limit_login_username_max,
        settings.rate_limit_login_username_window_seconds,
    )
    service = _require_auth_enabled()
    user, session_token, _ = service.authenticate(payload.username, payload.password)
    _set_session_cookie(response, session_token)
    return AuthUserResponse(user=_to_auth_user(user))


@app.post("/api/v1/auth/register", response_model=AuthUserResponse, status_code=201)
def register(
    payload: RegisterRequest,
    response: Response,
    _: None = Depends(require_csrf),
    __: None = Depends(rate_limit_register_ip),
) -> AuthUserResponse:
    service = _require_auth_enabled()
    if not service.is_registration_enabled():
        raise AuthError("AUTH_REGISTRATION_DISABLED", "公开注册未开启", 404)
    user, session_token, _ = service.register(payload.username, payload.password)
    _set_session_cookie(response, session_token)
    return AuthUserResponse(user=_to_auth_user(user))


@app.post("/api/v1/auth/logout", status_code=204)
def logout(request: Request, response: Response, _: None = Depends(require_csrf)) -> Response:
    service = _require_auth_enabled()
    token = request.cookies.get(settings.auth_cookie_name)
    if token:
        service.delete_session(token)
    _clear_session_cookie(response)
    response.status_code = 204
    return response


@app.get("/api/v1/auth/me", response_model=AuthUserResponse)
def current_user(user: UserRecord = Depends(require_current_user)) -> AuthUserResponse:
    return AuthUserResponse(user=_to_auth_user(user))


def _require_admin_user_record(user_id: int) -> AdminUserRecord:
    record = _require_auth_enabled().get_admin_user(user_id)
    if record is None:
        raise AuthError("AUTH_USER_NOT_FOUND", "User not found", 404)
    return record


@app.get("/api/v1/admin/users", response_model=AdminUserPageResponse)
def list_admin_users(
    query: str | None = Query(default=None, max_length=64),
    role: str | None = Query(default=None),
    enabled: bool | None = Query(default=None),
    page: int = Query(default=0, ge=0),
    size: int = Query(default=20, ge=1, le=100),
    _: UserRecord = Depends(require_admin),
) -> AdminUserPageResponse:
    users, total = _require_auth_enabled().list_admin_users(
        page=page,
        size=size,
        query=query,
        role=role,
        enabled=enabled,
    )
    return AdminUserPageResponse(
        content=[_to_admin_user(user) for user in users],
        page=page,
        size=size,
        totalElements=total,
        totalPages=0 if not total else (total + size - 1) // size,
    )


@app.post("/api/v1/admin/users", response_model=AdminUser, status_code=201)
def create_admin_user(
    payload: AdminUserCreateRequest,
    actor: UserRecord = Depends(require_admin),
    __: None = Depends(require_csrf),
    ___: None = Depends(rate_limit_admin_ip),
) -> AdminUser:
    _check_user_rate(
        actor,
        "admin-user",
        settings.rate_limit_admin_max,
        settings.rate_limit_admin_window_seconds,
    )
    user = _require_auth_enabled().create_admin_user(
        username=payload.username,
        password=payload.password,
        role=payload.role,
        enabled=payload.enabled,
    )
    return _to_admin_user(user)


@app.patch("/api/v1/admin/users/{user_id}", response_model=AdminUser)
def update_admin_user(
    user_id: int,
    payload: AdminUserUpdateRequest,
    actor: UserRecord = Depends(require_admin),
    _: None = Depends(require_csrf),
    __: None = Depends(rate_limit_admin_ip),
) -> AdminUser:
    _check_user_rate(
        actor,
        "admin-user",
        settings.rate_limit_admin_max,
        settings.rate_limit_admin_window_seconds,
    )
    user = _require_auth_enabled().update_admin_user(
        user_id=user_id,
        actor_id=actor.id,
        role=payload.role,
        enabled=payload.enabled,
    )
    return _to_admin_user(user)


@app.post("/api/v1/admin/users/{user_id}/reset-password", response_model=AdminUser)
def reset_admin_password(
    user_id: int,
    payload: AdminPasswordResetRequest,
    actor: UserRecord = Depends(require_admin),
    __: None = Depends(require_csrf),
    ___: None = Depends(rate_limit_admin_ip),
) -> AdminUser:
    _check_user_rate(
        actor,
        "admin-user",
        settings.rate_limit_admin_max,
        settings.rate_limit_admin_window_seconds,
    )
    user = _require_auth_enabled().reset_admin_password(user_id=user_id, password=payload.password)
    return _to_admin_user(user)


@app.get("/api/v1/admin/settings/registration", response_model=RegistrationSetting)
def get_registration_setting(_: UserRecord = Depends(require_admin)) -> RegistrationSetting:
    return RegistrationSetting(enabled=_require_auth_enabled().is_registration_enabled())


@app.patch("/api/v1/admin/settings/registration", response_model=RegistrationSetting)
def update_registration_setting(
    payload: RegistrationSettingRequest,
    actor: UserRecord = Depends(require_admin),
    __: None = Depends(require_csrf),
    ___: None = Depends(rate_limit_admin_ip),
) -> RegistrationSetting:
    _check_user_rate(
        actor,
        "admin-user",
        settings.rate_limit_admin_max,
        settings.rate_limit_admin_window_seconds,
    )
    enabled = _require_auth_enabled().set_registration_enabled(payload.enabled)
    return RegistrationSetting(enabled=enabled)


def _validate_avatar(data: bytes, content_type: str | None) -> str:
    signatures = (
        (b"\x89PNG\r\n\x1a\n", "image/png"),
        (b"\xff\xd8\xff", "image/jpeg"),
    )
    for signature, media_type in signatures:
        if data.startswith(signature):
            return media_type
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    raise AuthError("AUTH_INVALID_AVATAR", "Only PNG, JPEG and WebP avatars are supported", 400)


@app.put("/api/v1/auth/me/avatar", response_model=AuthUserResponse)
async def upload_avatar(
    avatar: UploadFile = File(...),
    user: UserRecord = Depends(require_current_user),
    _: None = Depends(require_csrf),
) -> AuthUserResponse:
    _check_user_rate(
        user,
        "avatar-user",
        settings.rate_limit_avatar_user_max,
        settings.rate_limit_avatar_user_window_seconds,
    )
    if not settings.auth_enabled:
        raise AuthError("AUTH_DISABLED", "Authentication is disabled", 404)
    data = await avatar.read(settings.auth_avatar_max_bytes + 1)
    if not data:
        raise AuthError("AUTH_INVALID_AVATAR", "Avatar file is empty", 400)
    if len(data) > settings.auth_avatar_max_bytes:
        raise AuthError("AUTH_AVATAR_TOO_LARGE", "Avatar file is too large", 413)
    content_type = _validate_avatar(data, avatar.content_type)
    updated = _require_auth_enabled().update_avatar(user.id, data, content_type)
    return AuthUserResponse(user=_to_auth_user(updated))


@app.delete("/api/v1/auth/me/avatar", response_model=AuthUserResponse)
def remove_avatar(
    user: UserRecord = Depends(require_current_user),
    _: None = Depends(require_csrf),
) -> AuthUserResponse:
    _check_user_rate(
        user,
        "avatar-user",
        settings.rate_limit_avatar_user_max,
        settings.rate_limit_avatar_user_window_seconds,
    )
    updated = _require_auth_enabled().delete_avatar(user.id)
    return AuthUserResponse(user=_to_auth_user(updated))


@app.put("/api/v1/admin/users/{user_id}/avatar", response_model=AdminUser)
async def upload_admin_avatar(
    user_id: int,
    avatar: UploadFile = File(...),
    actor: UserRecord = Depends(require_admin),
    __: None = Depends(require_csrf),
    ___: None = Depends(rate_limit_admin_ip),
) -> AdminUser:
    _check_user_rate(
        actor,
        "avatar-admin",
        settings.rate_limit_admin_max,
        settings.rate_limit_admin_window_seconds,
    )
    _require_admin_user_record(user_id)
    data = await avatar.read(settings.auth_avatar_max_bytes + 1)
    if not data:
        raise AuthError("AUTH_INVALID_AVATAR", "Avatar file is empty", 400)
    if len(data) > settings.auth_avatar_max_bytes:
        raise AuthError("AUTH_AVATAR_TOO_LARGE", "Avatar file is too large", 413)
    content_type = _validate_avatar(data, avatar.content_type)
    _require_auth_enabled().update_avatar(user_id, data, content_type)
    return _to_admin_user(_require_admin_user_record(user_id))


@app.delete("/api/v1/admin/users/{user_id}/avatar", response_model=AdminUser)
def remove_admin_avatar(
    user_id: int,
    actor: UserRecord = Depends(require_admin),
    __: None = Depends(require_csrf),
    ___: None = Depends(rate_limit_admin_ip),
) -> AdminUser:
    _check_user_rate(
        actor,
        "avatar-admin",
        settings.rate_limit_admin_max,
        settings.rate_limit_admin_window_seconds,
    )
    _require_admin_user_record(user_id)
    _require_auth_enabled().delete_avatar(user_id)
    return _to_admin_user(_require_admin_user_record(user_id))


@app.get("/api/v1/users/{user_id}/avatar")
def get_user_avatar(user_id: int) -> Response:
    avatar = _require_auth_enabled().get_avatar(user_id)
    if avatar is None:
        return Response(status_code=404)
    data, content_type = avatar
    return Response(
        content=data,
        media_type=content_type,
        headers={
            "Cache-Control": "public, max-age=86400",
            "X-Content-Type-Options": "nosniff",
        },
    )


@app.get("/api/v1/health")
def health() -> dict[str, str]:
    return {"status": "UP"}


@app.get("/api/v1/articles", response_model=ArticlePageResponse)
def list_articles(
    page: int = Query(default=0, ge=0),
    size: int = Query(default=10, ge=1, le=50),
    tag: str | None = Query(default=None),
    q: str | None = Query(default=None, max_length=100),
) -> ArticlePageResponse:
    return article_service.list_published(page, size, tag, q)


@app.get("/api/v1/articles/{slug}", response_model=ArticleDetail)
def get_article(slug: str) -> ArticleDetail:
    return article_service.get_published(slug)


@app.get("/api/v1/search", response_model=ContentSearchPageResponse)
def search_content(
    q: str = Query(..., min_length=1, max_length=100),
    type: str = Query(default="ALL"),
    page: int = Query(default=0, ge=0),
    size: int = Query(default=10, ge=1, le=50),
) -> ContentSearchPageResponse:
    if content_store is None:
        raise ContentStorageError("CONTENT_STORAGE_DATABASE_REQUIRED", "Search requires CONTENT_STORAGE=database", 503)
    if not q.strip():
        raise ContentStorageError("CONTENT_EMPTY_QUERY", "Search query cannot be empty", 400)
    return to_search_page(content_store, q, type, page, size)


def _get_comment_service() -> CommentService:
    if not settings.comments_enabled or comment_service is None:
        raise CommentError("COMMENTS_DISABLED", "Comments are disabled", 404)
    return comment_service


def _get_guestbook_service() -> GuestbookService:
    if not settings.comments_enabled or guestbook_service is None:
        raise GuestbookError("COMMENTS_DISABLED", "Comments are disabled", 404)
    return guestbook_service


@app.get("/api/v1/articles/{slug}/comments", response_model=CommentPageResponse)
def list_article_comments(
    slug: str,
    page: int = Query(default=0, ge=0),
    size: int = Query(default=20, ge=1, le=100),
) -> CommentPageResponse:
    return _get_comment_service().list_public(TARGET_ARTICLE, slug, page, size)


@app.post("/api/v1/articles/{slug}/comments", response_model=Comment, status_code=201)
def create_article_comment(
    slug: str,
    payload: CommentCreateRequest,
    user: UserRecord = Depends(require_current_user),
    _: None = Depends(require_csrf),
    __: None = Depends(rate_limit_comment_ip),
) -> Comment:
    _check_user_rate(
        user,
        "comment-user",
        settings.rate_limit_comment_user_max,
        settings.rate_limit_comment_user_window_seconds,
    )
    return _get_comment_service().create(
        TARGET_ARTICLE,
        slug,
        user,
        payload.content,
        payload.parentId,
    )


@app.get("/api/v1/guestbook/messages", response_model=CommentPageResponse)
def list_guestbook_messages(
    page: int = Query(default=0, ge=0),
    size: int = Query(default=20, ge=1, le=100),
) -> CommentPageResponse:
    return _get_guestbook_service().list_public(page, size)


@app.post("/api/v1/guestbook/messages", response_model=Comment, status_code=201)
def create_guestbook_message(
    payload: CommentCreateRequest,
    user: UserRecord = Depends(require_current_user),
    _: None = Depends(require_csrf),
    __: None = Depends(rate_limit_guestbook_ip),
) -> Comment:
    _check_user_rate(
        user,
        "guestbook-user",
        settings.rate_limit_guestbook_user_max,
        settings.rate_limit_guestbook_user_window_seconds,
    )
    return _get_guestbook_service().create(user, payload.content)


@app.delete("/api/v1/guestbook/messages/{message_id}", status_code=204)
def delete_guestbook_message(
    message_id: int,
    user: UserRecord = Depends(require_current_user),
    _: None = Depends(require_csrf),
    __: None = Depends(rate_limit_guestbook_ip),
) -> Response:
    _check_user_rate(
        user,
        "guestbook-user",
        settings.rate_limit_guestbook_user_max,
        settings.rate_limit_guestbook_user_window_seconds,
    )
    _get_guestbook_service().delete(message_id, user)
    return Response(status_code=204)


def _get_editor_service() -> ArticleEditorService:
    if not settings.editor_enabled or editor_service is None:
        raise EditorError("EDITOR_DISABLED", "Local article editor is disabled", 404)
    return editor_service


@app.get("/api/v1/editor/articles", response_model=EditorArticlePageResponse)
def list_editor_articles(
    page: int = Query(default=0, ge=0),
    size: int = Query(default=20, ge=1, le=100),
    q: str | None = Query(default=None, max_length=100),
    _: UserRecord = Depends(require_editor_admin),
) -> EditorArticlePageResponse:
    return _get_editor_service().list_articles(page, size, q)


@app.get("/api/v1/editor/articles/{slug}", response_model=EditorArticleDetail)
def get_editor_article(
    slug: str,
    _: UserRecord = Depends(require_editor_admin),
) -> EditorArticleDetail:
    return _get_editor_service().get_article(slug)


@app.post("/api/v1/editor/articles", response_model=EditorArticleDetail, status_code=201)
async def create_editor_article(
    title: str = Form(...),
    slug: str | None = Form(default=None),
    summary: str | None = Form(default=None),
    tags: str | None = Form(default=None),
    status: str = Form(default="DRAFT"),
    publishedAt: str | None = Form(default=None),
    contentMarkdown: str = Form(default=""),
    cover: UploadFile = File(...),
    assets: list[UploadFile] | None = File(default=None),
    actor: UserRecord = Depends(require_editor_admin),
    __: None = Depends(require_csrf),
    ___: None = Depends(rate_limit_admin_ip),
) -> EditorArticleDetail:
    _check_user_rate(
        actor,
        "editor-user",
        settings.rate_limit_admin_max,
        settings.rate_limit_admin_window_seconds,
    )
    return await _get_editor_service().create_article(
        title=title,
        slug=slug,
        summary=summary,
        tags=tags,
        status=status,
        published_at=publishedAt,
        content_markdown=contentMarkdown,
        cover=cover,
        assets=assets or [],
    )


@app.put("/api/v1/editor/articles/{slug}", response_model=EditorArticleDetail)
async def update_editor_article(
    slug: str,
    title: str = Form(...),
    newSlug: str | None = Form(default=None),
    summary: str | None = Form(default=None),
    tags: str | None = Form(default=None),
    status: str | None = Form(default=None),
    publishedAt: str | None = Form(default=None),
    contentMarkdown: str = Form(default=""),
    cover: UploadFile | None = File(default=None),
    assets: list[UploadFile] | None = File(default=None),
    actor: UserRecord = Depends(require_editor_admin),
    __: None = Depends(require_csrf),
    ___: None = Depends(rate_limit_admin_ip),
) -> EditorArticleDetail:
    _check_user_rate(
        actor,
        "editor-user",
        settings.rate_limit_admin_max,
        settings.rate_limit_admin_window_seconds,
    )
    return await _get_editor_service().update_article(
        slug,
        title=title,
        new_slug=newSlug,
        summary=summary,
        tags=tags,
        status=status,
        published_at=publishedAt,
        content_markdown=contentMarkdown,
        cover=cover,
        assets=assets or [],
    )


@app.delete("/api/v1/editor/articles/{slug}", status_code=204)
def delete_editor_article(
    slug: str,
    actor: UserRecord = Depends(require_editor_admin),
    __: None = Depends(require_csrf),
    ___: None = Depends(rate_limit_admin_ip),
) -> Response:
    _check_user_rate(
        actor,
        "editor-user",
        settings.rate_limit_admin_max,
        settings.rate_limit_admin_window_seconds,
    )
    _get_editor_service().delete_article(slug)
    return Response(status_code=204)


def _get_editor_chatter_service() -> ChatterEditorService:
    if not settings.editor_enabled or chatter_editor_service is None:
        raise EditorError("EDITOR_DISABLED", "Local article editor is disabled", 404)
    return chatter_editor_service


@app.get("/api/v1/editor/chatter", response_model=ChatterPageResponse)
def list_editor_chatter(
    page: int = Query(default=0, ge=0),
    size: int = Query(default=50, ge=1, le=100),
    q: str | None = Query(default=None, max_length=100),
    _: UserRecord = Depends(require_editor_admin),
) -> ChatterPageResponse:
    return _get_editor_chatter_service().list_entries(page, size, q)


@app.get("/api/v1/editor/chatter/{slug}", response_model=ChatterDetail)
def get_editor_chatter(
    slug: str,
    _: UserRecord = Depends(require_editor_admin),
) -> ChatterDetail:
    return _get_editor_chatter_service().get_entry(slug)


@app.post("/api/v1/editor/chatter", response_model=ChatterDetail, status_code=201)
async def create_editor_chatter(
    slug: str | None = Form(default=None),
    status: str = Form(default="DRAFT"),
    publishedAt: str | None = Form(default=None),
    contentMarkdown: str = Form(default=""),
    assets: list[UploadFile] | None = File(default=None),
    actor: UserRecord = Depends(require_editor_admin),
    __: None = Depends(require_csrf),
    ___: None = Depends(rate_limit_admin_ip),
) -> ChatterDetail:
    _check_user_rate(
        actor,
        "editor-user",
        settings.rate_limit_admin_max,
        settings.rate_limit_admin_window_seconds,
    )
    return await _get_editor_chatter_service().create_entry(
        slug=slug,
        status=status,
        published_at=publishedAt,
        content_markdown=contentMarkdown,
        assets=assets or [],
    )


@app.put("/api/v1/editor/chatter/{slug}", response_model=ChatterDetail)
async def update_editor_chatter(
    slug: str,
    newSlug: str | None = Form(default=None),
    status: str | None = Form(default=None),
    publishedAt: str | None = Form(default=None),
    contentMarkdown: str = Form(default=""),
    assets: list[UploadFile] | None = File(default=None),
    actor: UserRecord = Depends(require_editor_admin),
    __: None = Depends(require_csrf),
    ___: None = Depends(rate_limit_admin_ip),
) -> ChatterDetail:
    _check_user_rate(
        actor,
        "editor-user",
        settings.rate_limit_admin_max,
        settings.rate_limit_admin_window_seconds,
    )
    return await _get_editor_chatter_service().update_entry(
        slug,
        new_slug=newSlug,
        status=status,
        published_at=publishedAt,
        content_markdown=contentMarkdown,
        assets=assets or [],
    )


@app.delete("/api/v1/editor/chatter/{slug}", status_code=204)
def delete_editor_chatter(
    slug: str,
    actor: UserRecord = Depends(require_editor_admin),
    __: None = Depends(require_csrf),
    ___: None = Depends(rate_limit_admin_ip),
) -> Response:
    _check_user_rate(
        actor,
        "editor-user",
        settings.rate_limit_admin_max,
        settings.rate_limit_admin_window_seconds,
    )
    _get_editor_chatter_service().delete_entry(slug)
    return Response(status_code=204)


@app.get("/api/v1/chatter", response_model=ChatterPageResponse)
def list_chatter(
    page: int = Query(default=0, ge=0),
    size: int = Query(default=10, ge=1, le=50),
    q: str | None = Query(default=None, max_length=100),
) -> ChatterPageResponse:
    return chatter_service.list_published(page, size, q)


@app.get("/api/v1/chatter/{slug}", response_model=ChatterDetail)
def get_chatter(slug: str) -> ChatterDetail:
    return chatter_service.get_published(slug)


@app.get("/api/v1/chatter/{slug}/comments", response_model=CommentPageResponse)
def list_chatter_comments(
    slug: str,
    page: int = Query(default=0, ge=0),
    size: int = Query(default=20, ge=1, le=100),
) -> CommentPageResponse:
    return _get_comment_service().list_public(TARGET_CHATTER, slug, page, size)


@app.post("/api/v1/chatter/{slug}/comments", response_model=Comment, status_code=201)
def create_chatter_comment(
    slug: str,
    payload: CommentCreateRequest,
    user: UserRecord = Depends(require_current_user),
    _: None = Depends(require_csrf),
    __: None = Depends(rate_limit_comment_ip),
) -> Comment:
    _check_user_rate(
        user,
        "comment-user",
        settings.rate_limit_comment_user_max,
        settings.rate_limit_comment_user_window_seconds,
    )
    return _get_comment_service().create(
        TARGET_CHATTER,
        slug,
        user,
        payload.content,
        payload.parentId,
    )


@app.delete("/api/v1/comments/{comment_id}", status_code=204)
def delete_comment(
    comment_id: int,
    user: UserRecord = Depends(require_current_user),
    _: None = Depends(require_csrf),
    __: None = Depends(rate_limit_comment_ip),
) -> Response:
    _check_user_rate(
        user,
        "comment-user",
        settings.rate_limit_comment_user_max,
        settings.rate_limit_comment_user_window_seconds,
    )
    _get_comment_service().delete(comment_id, user)
    return Response(status_code=204)


@app.get("/api/v1/admin/comments", response_model=CommentPageResponse)
def list_admin_comments(
    status: str | None = Query(default=None),
    page: int = Query(default=0, ge=0),
    size: int = Query(default=50, ge=1, le=100),
    _: UserRecord = Depends(require_admin),
) -> CommentPageResponse:
    return _get_comment_service().list_admin(status, page, size)


@app.patch("/api/v1/admin/comments/{comment_id}", response_model=Comment)
def update_admin_comment(
    comment_id: int,
    payload: CommentStatusRequest,
    actor: UserRecord = Depends(require_admin),
    __: None = Depends(require_csrf),
    ___: None = Depends(rate_limit_admin_ip),
) -> Comment:
    _check_user_rate(
        actor,
        "admin-comment",
        settings.rate_limit_admin_max,
        settings.rate_limit_admin_window_seconds,
    )
    return _get_comment_service().update_status(comment_id, payload.status)


@app.get("/api/v1/historical-today", response_model=HistoricalTodayResponse)
def historical_today() -> HistoricalTodayResponse:
    return historical_service.get_today()


@app.get("/api/v1/music/playlist", response_model=MusicPlaylistResponse)
def music_playlist() -> MusicPlaylistResponse:
    return music_service.get_playlist()


@app.get("/api/v1/admin/music/tracks", response_model=MusicPlaylistResponse)
def admin_music_playlist(_: UserRecord = Depends(require_admin)) -> MusicPlaylistResponse:
    if not isinstance(music_service, LocalMusicService):
        raise MusicServiceError("LOCAL_MUSIC_SOURCE_REQUIRED", "Local music management is only available in local mode", 409)
    return music_service.get_playlist()


@app.post("/api/v1/admin/music/tracks", response_model=MusicPlaylistResponse, status_code=201)
async def upload_admin_music(
    audio: UploadFile = File(...),
    actor: UserRecord = Depends(require_admin),
    __: None = Depends(require_csrf),
    ___: None = Depends(rate_limit_admin_ip),
) -> MusicPlaylistResponse:
    _check_user_rate(
        actor,
        "admin-music-upload",
        settings.rate_limit_admin_max,
        settings.rate_limit_admin_window_seconds,
    )
    if not isinstance(music_service, LocalMusicService):
        raise MusicServiceError("LOCAL_MUSIC_SOURCE_REQUIRED", "Local music management is only available in local mode", 409)
    data = await audio.read(settings.music_max_upload_bytes + 1)
    if not data:
        raise MusicServiceError("LOCAL_MUSIC_EMPTY_FILE", "Audio file is empty", 400)
    if len(data) > settings.music_max_upload_bytes:
        raise MusicServiceError("LOCAL_MUSIC_FILE_TOO_LARGE", "Audio file is too large", 413)
    return music_service.add_track(audio.filename or "", data)


@app.delete("/api/v1/admin/music/tracks/{track_id}", response_model=MusicPlaylistResponse)
def delete_admin_music(
    track_id: str,
    actor: UserRecord = Depends(require_admin),
    __: None = Depends(require_csrf),
    ___: None = Depends(rate_limit_admin_ip),
) -> MusicPlaylistResponse:
    _check_user_rate(
        actor,
        "admin-music-delete",
        settings.rate_limit_admin_max,
        settings.rate_limit_admin_window_seconds,
    )
    if not isinstance(music_service, LocalMusicService):
        raise MusicServiceError("LOCAL_MUSIC_SOURCE_REQUIRED", "Local music management is only available in local mode", 409)
    return music_service.remove_track(track_id)


@app.get("/api/v1/music/tracks/{track_id}/url", response_model=MusicTrackUrlResponse)
def music_track_url(track_id: str) -> MusicTrackUrlResponse:
    return music_service.get_track_url(track_id)


@app.get("/api/v1/music/tracks/{track_id}/cover")
def music_track_cover(track_id: str) -> Response:
    if not isinstance(music_service, LocalMusicService):
        raise MusicServiceError("MUSIC_COVER_UNAVAILABLE", "当前音乐来源没有本地内嵌封面", 404)
    content, media_type = music_service.get_track_cover(track_id)
    return Response(
        content=content,
        media_type=media_type,
        headers={"Cache-Control": "public, max-age=86400"},
    )


def _error_response(status_code: int, code: str, message: str, path: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={
            "code": code,
            "message": message,
            "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "path": path,
            "details": {},
        },
    )
