"""Public music response models used by the frontend player."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


class MusicTrackResponse(BaseModel):
    id: str
    title: str
    artist: str
    album: str | None
    coverUrl: str | None
    durationMs: int | None
    canPlay: bool
    freeTrial: bool


class MusicPlaylistResponse(BaseModel):
    playlistId: str
    source: Literal["local", "netease"]
    tracks: list[MusicTrackResponse]
    available: bool
    message: str | None


class MusicTrackUrlResponse(BaseModel):
    id: str
    playUrl: str | None
    expiresAt: int | None
    durationMs: int | None
    canPlay: bool
    message: str | None
