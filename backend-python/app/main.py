"""FastAPI entrypoint for the lightweight read-only blog API."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import FastAPI, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .article_service import ArticleNotFoundError, ArticleService
from .config import Settings
from .historical_service import HistoricalTodayService
from .models import ArticleDetail, ArticlePageResponse, HistoricalTodayResponse


settings = Settings.from_environment()
article_service = ArticleService(settings.article_content_dir)
historical_service = HistoricalTodayService(settings.wikipedia_on_this_day_url)

app = FastAPI(title="Your Space Read-only API", docs_url=None, redoc_url=None)
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


@app.get("/api/v1/historical-today", response_model=HistoricalTodayResponse)
def historical_today() -> HistoricalTodayResponse:
    return historical_service.get_today()


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
