"""Request and response models for administrator user management."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


UserRole = Literal["USER", "ADMIN"]


class AdminUser(BaseModel):
    id: int
    username: str
    role: UserRole
    enabled: bool
    avatarUrl: str | None = None
    createdAt: str
    updatedAt: str


class AdminUserPageResponse(BaseModel):
    content: list[AdminUser]
    page: int
    size: int
    totalElements: int
    totalPages: int


class AdminUserCreateRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=8, max_length=256)
    role: UserRole = "USER"
    enabled: bool = True


class AdminUserUpdateRequest(BaseModel):
    role: UserRole | None = None
    enabled: bool | None = None


class AdminPasswordResetRequest(BaseModel):
    password: str = Field(min_length=8, max_length=256)


class RegistrationSetting(BaseModel):
    enabled: bool


class RegistrationSettingRequest(BaseModel):
    enabled: bool
