"""Response models used by the local-only article editor."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class EditorArticleSummary(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str | None
    slug: str
    title: str
    summary: str | None
    coverUrl: str | None
    tags: list[str]
    status: str
    publishedAt: str | None
    createdAt: str | None
    updatedAt: str | None
    coverColor: str | None = None


class EditorArticleDetail(EditorArticleSummary):
    contentMarkdown: str


class EditorArticlePageResponse(BaseModel):
    content: list[EditorArticleSummary]
    page: int
    size: int
    totalElements: int
    totalPages: int
