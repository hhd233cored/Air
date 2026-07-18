"""Request and response models for public article and chatter comments."""

from __future__ import annotations

from pydantic import BaseModel, Field


class CommentAuthor(BaseModel):
    id: int
    username: str
    avatarUrl: str | None = None


class Comment(BaseModel):
    id: int
    targetType: str
    targetId: str
    parentId: int | None = None
    content: str
    status: str
    author: CommentAuthor
    createdAt: str
    updatedAt: str


class CommentPageResponse(BaseModel):
    content: list[Comment]
    page: int
    size: int
    totalElements: int
    totalPages: int


class CommentCreateRequest(BaseModel):
    content: str = Field(min_length=1, max_length=5000)
    parentId: int | None = Field(default=None, ge=1)


class CommentStatusRequest(BaseModel):
    status: str = Field(pattern="^(VISIBLE|HIDDEN|DELETED)$")
