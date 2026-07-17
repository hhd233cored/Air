"""FastAPI entrypoint for the lightweight read-only blog API."""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI, File, Form, Query, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from .article_service import ArticleNotFoundError, ArticleService
from .chatter_service import ChatterNotFoundError, ChatterService
from .chatter_models import ChatterDetail, ChatterPageResponse
from .chatter_editor_service import ChatterEditorService
from .config import Settings
from .editor_models import EditorArticleDetail, EditorArticlePageResponse
from .editor_service import ArticleEditorService, EditorError
from .historical_service import HistoricalTodayService
from .local_music_service import LocalMusicService
from .music_models import MusicPlaylistResponse, MusicTrackUrlResponse
from .music_service import MusicService, MusicServiceError
from .models import ArticleDetail, ArticlePageResponse, HistoricalTodayResponse


settings = Settings.from_environment()
article_service = ArticleService(settings.article_content_dir)
chatter_service = ChatterService(settings.chatter_content_dir)
historical_service = HistoricalTodayService(settings.wikipedia_on_this_day_url)
editor_service = ArticleEditorService(settings.article_content_dir) if settings.editor_enabled else None
chatter_editor_service = ChatterEditorService(settings.chatter_content_dir) if settings.editor_enabled else None
if settings.music_source == "local":
    music_service = LocalMusicService(settings.music_content_dir)
elif settings.music_source == "netease":
    music_service = MusicService(settings)
else:
    raise ValueError("MUSIC_SOURCE must be 'local' or 'netease'")


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Warm the in-memory cache once after the server starts so the first browser request is fast.
    await asyncio.to_thread(historical_service.get_today)
    yield


app = FastAPI(title="Your Space Read-only API", docs_url=None, redoc_url=None, lifespan=lifespan)
app.mount("/music", StaticFiles(directory=settings.music_content_dir), name="music")
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.cors_allowed_origins),
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Accept", "Content-Type"],
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


@app.get("/api/v1/health")
def health() -> dict[str, str]:
    return {"status": "UP"}


@app.get("/api/v1/articles", response_model=ArticlePageResponse)
def list_articles(
    page: int = Query(default=0, ge=0),
    size: int = Query(default=10, ge=1, le=50),
    tag: str | None = Query(default=None),
) -> ArticlePageResponse:
    return article_service.list_published(page, size, tag)


@app.get("/api/v1/articles/{slug}", response_model=ArticleDetail)
def get_article(slug: str) -> ArticleDetail:
    return article_service.get_published(slug)


def _get_editor_service() -> ArticleEditorService:
    if not settings.editor_enabled or editor_service is None:
        raise EditorError("EDITOR_DISABLED", "Local article editor is disabled", 404)
    return editor_service


@app.get("/api/v1/editor/articles", response_model=EditorArticlePageResponse)
def list_editor_articles(
    page: int = Query(default=0, ge=0),
    size: int = Query(default=20, ge=1, le=100),
) -> EditorArticlePageResponse:
    return _get_editor_service().list_articles(page, size)


@app.get("/api/v1/editor/articles/{slug}", response_model=EditorArticleDetail)
def get_editor_article(slug: str) -> EditorArticleDetail:
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
) -> EditorArticleDetail:
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
) -> EditorArticleDetail:
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
def delete_editor_article(slug: str) -> Response:
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
) -> ChatterPageResponse:
    return _get_editor_chatter_service().list_entries(page, size)


@app.get("/api/v1/editor/chatter/{slug}", response_model=ChatterDetail)
def get_editor_chatter(slug: str) -> ChatterDetail:
    return _get_editor_chatter_service().get_entry(slug)


@app.post("/api/v1/editor/chatter", response_model=ChatterDetail, status_code=201)
def create_editor_chatter(
    slug: str | None = Form(default=None),
    status: str = Form(default="DRAFT"),
    publishedAt: str | None = Form(default=None),
    contentMarkdown: str = Form(default=""),
) -> ChatterDetail:
    return _get_editor_chatter_service().create_entry(
        slug=slug,
        status=status,
        published_at=publishedAt,
        content_markdown=contentMarkdown,
    )


@app.put("/api/v1/editor/chatter/{slug}", response_model=ChatterDetail)
def update_editor_chatter(
    slug: str,
    newSlug: str | None = Form(default=None),
    status: str | None = Form(default=None),
    publishedAt: str | None = Form(default=None),
    contentMarkdown: str = Form(default=""),
) -> ChatterDetail:
    return _get_editor_chatter_service().update_entry(
        slug,
        new_slug=newSlug,
        status=status,
        published_at=publishedAt,
        content_markdown=contentMarkdown,
    )


@app.delete("/api/v1/editor/chatter/{slug}", status_code=204)
def delete_editor_chatter(slug: str) -> Response:
    _get_editor_chatter_service().delete_entry(slug)
    return Response(status_code=204)


@app.get("/api/v1/chatter", response_model=ChatterPageResponse)
def list_chatter(
    page: int = Query(default=0, ge=0),
    size: int = Query(default=10, ge=1, le=50),
) -> ChatterPageResponse:
    return chatter_service.list_published(page, size)


@app.get("/api/v1/chatter/{slug}", response_model=ChatterDetail)
def get_chatter(slug: str) -> ChatterDetail:
    return chatter_service.get_published(slug)


@app.get("/api/v1/historical-today", response_model=HistoricalTodayResponse)
def historical_today() -> HistoricalTodayResponse:
    return historical_service.get_today()


@app.get("/api/v1/music/playlist", response_model=MusicPlaylistResponse)
def music_playlist() -> MusicPlaylistResponse:
    return music_service.get_playlist()


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
