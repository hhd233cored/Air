"""Public response models for the read-only chatter API."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class ChatterSummary(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str | None
    slug: str
    preview: str
    status: str
    publishedAt: str | None
    createdAt: str | None
    updatedAt: str | None


class ChatterDetail(ChatterSummary):
    contentMarkdown: str


class ChatterPageResponse(BaseModel):
    content: list[ChatterSummary]
    page: int
    size: int
    totalElements: int
    totalPages: int
