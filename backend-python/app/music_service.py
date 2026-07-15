"""Server-side adapter for the NetEase Cloud Music OpenAPI."""

from __future__ import annotations

import json
import logging
import threading
import time
from dataclasses import dataclass
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from .config import Settings
from .music_models import MusicPlaylistResponse, MusicTrackResponse, MusicTrackUrlResponse

logger = logging.getLogger(__name__)


class MusicServiceError(Exception):
    def __init__(self, code: str, message: str, status_code: int = 502) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


@dataclass(frozen=True)
class CachedPlaylist:
    expires_at: float
    value: MusicPlaylistResponse


@dataclass(frozen=True)
class CachedTrackUrl:
    expires_at: float
    value: MusicTrackUrlResponse


class MusicService:
    playlist_endpoint = "/openapi/music/basic/playlist/song/list/get/v3"
    song_detail_endpoint = "/openapi/music/basic/song/detail/get/v2"
    anonymous_login_endpoint = "/openapi/music/basic/oauth2/login/anonymous"
    playlist_cache_ttl = 5 * 60
    fallback_url_cache_ttl = 60

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._playlist_cache: CachedPlaylist | None = None
        self._playlist_track_ids: set[str] = set()
        self._track_url_cache: dict[str, CachedTrackUrl] = {}
        self._lock = threading.Lock()
        self._token_lock = threading.Lock()
        self._access_token = settings.netease_music_access_token.strip()

    def get_playlist(self) -> MusicPlaylistResponse:
        cached = self._playlist_cache
        if cached and cached.expires_at > time.time():
            return cached.value

        with self._lock:
            cached = self._playlist_cache
            if cached and cached.expires_at > time.time():
                return cached.value
            self._ensure_configured()
            payload = self._request(
                self.playlist_endpoint,
                {
                    "playlistId": self.settings.netease_music_playlist_id,
                    "limit": "500",
                    "offset": "0",
                    "qualityFlag": "true",
                },
            )
            if not isinstance(payload, list):
                raise MusicServiceError("MUSIC_INVALID_RESPONSE", "网易云歌单接口返回格式异常", 502)
            tracks = [self._parse_track(item) for item in payload if isinstance(item, dict)]
            self._playlist_track_ids = {track.id for track in tracks if track.id}
            result = MusicPlaylistResponse(
                playlistId=self.settings.netease_music_playlist_id,
                source="netease",
                tracks=tracks,
                available=True,
                message=None,
            )
            self._playlist_cache = CachedPlaylist(time.time() + self.playlist_cache_ttl, result)
            return result

    def get_track_url(self, track_id: str) -> MusicTrackUrlResponse:
        normalized_id = track_id.strip()
        if not normalized_id:
            raise MusicServiceError("MUSIC_INVALID_TRACK", "Song ID is required", 400)
        if normalized_id not in self._playlist_track_ids:
            # Do not expose a general-purpose upstream URL proxy. A direct URL
            # request first loads the configured playlist and then checks membership.
            self.get_playlist()
        if normalized_id not in self._playlist_track_ids:
            raise MusicServiceError("MUSIC_TRACK_NOT_IN_PLAYLIST", "歌曲不在当前歌单中", 404)
        cached = self._track_url_cache.get(normalized_id)
        if cached and cached.expires_at > time.time():
            return cached.value

        self._ensure_configured()
        biz_content: dict[str, str] = {
            "songId": normalized_id,
            "withUrl": "true",
            "trialScene": "playlist_trial",
            "sourceId": self.settings.netease_music_playlist_id,
            "sourceType": "playlist",
        }
        if self.settings.netease_music_bitrate is not None:
            biz_content["bitrate"] = str(self.settings.netease_music_bitrate)
        data = self._request(self.song_detail_endpoint, biz_content, allow_null=True)
        if not isinstance(data, dict):
            return MusicTrackUrlResponse(
                id=normalized_id,
                playUrl=None,
                expiresAt=None,
                durationMs=None,
                canPlay=False,
                message="歌曲没有可用的播放资源",
            )

        play_url = self._normalize_url(data.get("playUrl"))
        expires_at = self._as_int(data.get("playUrlExpireTime"))
        free_trial = data.get("freeTrialPrivilege") or {}
        can_play = bool(data.get("playFlag")) or bool(
            isinstance(free_trial, dict)
            and free_trial.get("resConsumable")
            and free_trial.get("userConsumable")
        )
        result = MusicTrackUrlResponse(
            id=str(data.get("id") or normalized_id),
            playUrl=play_url,
            expiresAt=expires_at,
            durationMs=self._as_int(data.get("duration")),
            canPlay=can_play and bool(play_url),
            message=None if play_url else "当前歌曲不可播放或未开通试听权限",
        )
        ttl = self.fallback_url_cache_ttl
        if expires_at:
            ttl = max(1, min(ttl, int(expires_at / 1000 - time.time() - 30)))
        self._track_url_cache[normalized_id] = CachedTrackUrl(time.time() + ttl, result)
        return result

    def _ensure_configured(self) -> None:
        missing = [
            name
            for name, value in (
                ("NETEASE_MUSIC_APP_ID", self.settings.netease_music_app_id),
                ("NETEASE_MUSIC_APP_SECRET", self.settings.netease_music_app_secret),
            )
            if not value and not (name == "NETEASE_MUSIC_APP_SECRET" and self._access_token)
        ]
        if missing:
            raise MusicServiceError(
                "MUSIC_NOT_CONFIGURED",
                f"NetEase Music API credentials are missing: {', '.join(missing)}",
                503,
            )

    def _get_access_token(self) -> str:
        if self._access_token:
            return self._access_token

        with self._token_lock:
            if self._access_token:
                return self._access_token
            payload = self._request(
                self.anonymous_login_endpoint,
                {"clientId": self.settings.netease_music_app_id},
                allow_null=False,
                access_token="",
            )
            token = payload.get("accessToken") if isinstance(payload, dict) else None
            if not isinstance(token, str) or not token:
                raise MusicServiceError("MUSIC_ANONYMOUS_LOGIN_FAILED", "网易云游客 token 获取失败", 502)
            self._access_token = token
            return token

    def _request(
        self,
        path: str,
        biz_content: dict[str, str],
        allow_null: bool = False,
        access_token: str | None = None,
    ) -> object:
        if access_token is None:
            access_token = self._get_access_token()
        params = {
            "bizContent": json.dumps(biz_content, ensure_ascii=False, separators=(",", ":")),
            "appId": self.settings.netease_music_app_id,
            "signType": self.settings.netease_music_sign_type,
            "device": self.settings.netease_music_device_json,
            "timestamp": str(int(time.time() * 1000)),
        }
        if access_token:
            params["accessToken"] = access_token
        if self.settings.netease_music_app_secret:
            params["appSecret"] = self.settings.netease_music_app_secret
        request = Request(
            f"{self.settings.netease_music_api_base_url}{path}?{urlencode(params)}",
            headers={
                "Accept": "application/json",
                "User-Agent": "Air-personal-site/1.0",
            },
            method="GET",
        )
        try:
            with urlopen(request, timeout=20) as response:
                root = json.loads(response.read().decode("utf-8"))
        except Exception as exc:
            logger.warning("NetEase Music API request failed: %s", exc)
            raise MusicServiceError("MUSIC_UPSTREAM_UNAVAILABLE", "网易云音乐服务暂时不可用", 502) from exc

        if not isinstance(root, dict) or root.get("code") != 200:
            message = root.get("message") if isinstance(root, dict) else None
            raise MusicServiceError("MUSIC_UPSTREAM_ERROR", str(message or "网易云音乐接口返回错误"), 502)
        sub_code = root.get("subCode")
        data = root.get("data")
        if sub_code not in (None, "200", 200) and not allow_null:
            raise MusicServiceError("MUSIC_RESOURCE_UNAVAILABLE", str(root.get("message") or "歌单资源不可用"), 404)
        return data

    def _parse_track(self, item: dict[str, object]) -> MusicTrackResponse:
        artists = item.get("artists")
        artist_items = artists if isinstance(artists, list) else []
        artist_names = [
            artist.get("name")
            for artist in artist_items
            if isinstance(artist, dict) and isinstance(artist.get("name"), str)
        ]
        free_trial = item.get("freeTrialPrivilege") or {}
        can_play = bool(item.get("playFlag")) or bool(
            isinstance(free_trial, dict)
            and free_trial.get("resConsumable")
            and free_trial.get("userConsumable")
        )
        album = item.get("album")
        return MusicTrackResponse(
            id=str(item.get("id") or ""),
            title=str(item.get("name") or "未命名歌曲"),
            artist="、".join(artist_names) or "未知艺人",
            album=album.get("name") if isinstance(album, dict) and isinstance(album.get("name"), str) else None,
            coverUrl=self._normalize_url(item.get("coverImgUrl")),
            durationMs=item.get("duration") if isinstance(item.get("duration"), int) else None,
            canPlay=can_play,
            freeTrial=bool(item.get("freeTrialFlag")),
        )

    @staticmethod
    def _normalize_url(value: object) -> str | None:
        if not isinstance(value, str) or not value:
            return None
        # The official examples sometimes return HTTP image URLs. Upgrade them
        # when the blog itself is served over HTTPS to avoid mixed-content blocks.
        return value.replace("http://", "https://", 1)

    @staticmethod
    def _as_int(value: object) -> int | None:
        if isinstance(value, bool):
            return None
        if isinstance(value, int):
            return value
        if isinstance(value, str) and value.strip().isdigit():
            return int(value.strip())
        return None
