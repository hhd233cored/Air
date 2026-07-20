"""Response models for the unified article/chatter search endpoint."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class ContentSearchResult(BaseModel):
    model_config = ConfigDict(extra="ignore")

    contentType: str
    id: str
    slug: str
    title: str | None
    preview: str
    summary: str | None
    coverUrl: str | None
    tags: list[str]
    status: str
    publishedAt: str | None
    createdAt: str | None
    updatedAt: str | None


class ContentSearchPageResponse(BaseModel):
    content: list[ContentSearchResult]
    page: int
    size: int
    totalElements: int
    totalPages: int
