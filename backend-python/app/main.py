"""FastAPI entrypoint for the lightweight read-only blog API."""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from .article_service import ArticleNotFoundError, ArticleService
from .chatter_service import ChatterNotFoundError, ChatterService
from .chatter_models import ChatterDetail, ChatterPageResponse
from .config import Settings
from .historical_service import HistoricalTodayService
from .local_music_service import LocalMusicService
from .music_models import MusicPlaylistResponse, MusicTrackUrlResponse
from .music_service import MusicService, MusicServiceError
from .models import ArticleDetail, ArticlePageResponse, HistoricalTodayResponse


settings = Settings.from_environment()
article_service = ArticleService(settings.article_content_dir)
chatter_service = ChatterService(settings.chatter_content_dir)
historical_service = HistoricalTodayService(settings.wikipedia_on_this_day_url)
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
    allow_methods=["GET", "OPTIONS"],
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
