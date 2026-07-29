"""Public response models with stable field names for the frontend API."""

from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field


class ArticleSummary(BaseModel):
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


class ArticleDetail(ArticleSummary):
    contentMarkdown: str


class ArticlePageResponse(BaseModel):
    content: list[ArticleSummary]
    page: int
    size: int
    totalElements: int
    totalPages: int


class HistoricalTodayEventPart(BaseModel):
    text: str
    href: str | None = None


class HistoricalTodayEvent(BaseModel):
    year: int | None
    text: str
    parts: list[HistoricalTodayEventPart] = Field(default_factory=list)
    yearHref: str | None = None


class HistoricalTodayResponse(BaseModel):
    date: date
    fetchedAt: datetime
    available: bool
    events: list[HistoricalTodayEvent]
