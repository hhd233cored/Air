"""Read local audio metadata and expose safe media URLs."""

from __future__ import annotations

import base64
import json
import uuid
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import quote

try:
    from mutagen import File as mutagen_file
except ImportError:  # Keep the API importable before optional runtime install.
    mutagen_file = None

from .music_models import MusicPlaylistResponse, MusicTrackResponse, MusicTrackUrlResponse
from .music_service import MusicServiceError


@dataclass(frozen=True)
class LocalTrack:
    id: str
    path: Path
    title: str
    artist: str
    album: str | None
    duration_ms: int | None
    cover: bytes | None
    cover_mime: str | None


class LocalMusicService:
    allowed_audio_extensions = {".mp3", ".m4a", ".aac", ".wav", ".ogg", ".flac", ".webm"}

    def __init__(self, content_dir: Path) -> None:
        self.content_dir = content_dir.resolve()
        self.playlist_file = self.content_dir / "playlist.json"
        self._catalog_cache: tuple[int, tuple[LocalTrack, ...]] | None = None

    def get_playlist(self) -> MusicPlaylistResponse:
        tracks = self._get_catalog()
        return MusicPlaylistResponse(
            playlistId="local",
            source="local",
            tracks=[self._to_summary(track) for track in tracks],
            available=bool(tracks),
            message=None if tracks else "本地歌单暂时没有可播放歌曲",
        )

    def add_track(self, filename: str, data: bytes) -> MusicPlaylistResponse:
        """Store an uploaded audio file and add it to the local playlist."""

        original_name = Path(filename or "").name
        suffix = Path(original_name).suffix.lower()
        if suffix not in self.allowed_audio_extensions:
            allowed = ", ".join(sorted(self.allowed_audio_extensions))
            raise MusicServiceError(
                "LOCAL_MUSIC_UNSUPPORTED_FORMAT",
                f"Only these audio formats are supported: {allowed}",
                400,
            )
        if not data:
            raise MusicServiceError("LOCAL_MUSIC_EMPTY_FILE", "Audio file is empty", 400)

        display_name = Path(original_name).stem.strip() or "Uploaded song"
        track_id = f"song-{uuid.uuid4().hex[:16]}"
        self.content_dir.mkdir(parents=True, exist_ok=True)
        target = self.content_dir / f"{track_id}{suffix}"
        target.write_bytes(data)

        try:
            try:
                playlist = self._read_playlist()
            except MusicServiceError as error:
                if error.code != "LOCAL_MUSIC_PLAYLIST_NOT_FOUND":
                    raise
                playlist = {"id": "local", "title": "Local playlist", "tracks": []}
            raw_tracks = playlist.get("tracks", [])
            if not isinstance(raw_tracks, list):
                raise MusicServiceError("LOCAL_MUSIC_INVALID_PLAYLIST", "Playlist tracks must be an array", 502)
            raw_tracks.append({"id": track_id, "name": display_name})
            playlist["tracks"] = raw_tracks
            self._write_playlist(playlist)
        except Exception:
            target.unlink(missing_ok=True)
            raise

        self._catalog_cache = None
        return self.get_playlist()

    def remove_track(self, track_id: str) -> MusicPlaylistResponse:
        """Remove a playlist entry and delete its audio file when safe."""

        track = self._find_track(track_id)
        if track is None:
            raise MusicServiceError("LOCAL_MUSIC_TRACK_NOT_FOUND", "Track does not exist in the local playlist", 404)

        playlist = self._read_playlist()
        raw_tracks = playlist.get("tracks", [])
        if not isinstance(raw_tracks, list):
            raise MusicServiceError("LOCAL_MUSIC_INVALID_PLAYLIST", "Playlist tracks must be an array", 502)
        remaining = [
            item for item in raw_tracks
            if not isinstance(item, dict) or str(item.get("id") or "").strip() != track_id
        ]
        if len(remaining) == len(raw_tracks):
            raise MusicServiceError("LOCAL_MUSIC_TRACK_NOT_FOUND", "Track does not exist in the local playlist", 404)

        shared = any(item.id != track.id and item.path == track.path for item in self._get_catalog())
        playlist["tracks"] = remaining
        self._write_playlist(playlist)
        if not shared:
            try:
                track.path.unlink(missing_ok=True)
            except OSError as exc:
                raise MusicServiceError("LOCAL_MUSIC_DELETE_FAILED", "Audio file could not be deleted", 500) from exc

        self._catalog_cache = None
        return self.get_playlist()

    def get_track_url(self, track_id: str) -> MusicTrackUrlResponse:
        track = self._find_track(track_id)
        if track is None:
            raise MusicServiceError("LOCAL_MUSIC_TRACK_NOT_FOUND", "本地歌单中不存在这首歌曲", 404)
        return MusicTrackUrlResponse(
            id=track.id,
            playUrl=self._media_url(track.path),
            expiresAt=None,
            durationMs=track.duration_ms,
            canPlay=True,
            message=None,
        )

    def get_track_cover(self, track_id: str) -> tuple[bytes, str]:
        track = self._find_track(track_id)
        if track is None:
            raise MusicServiceError("LOCAL_MUSIC_TRACK_NOT_FOUND", "本地歌单中不存在这首歌曲", 404)
        if not track.cover:
            raise MusicServiceError("LOCAL_MUSIC_COVER_NOT_FOUND", "歌曲没有内嵌封面", 404)
        return track.cover, track.cover_mime or "image/jpeg"

    def _get_catalog(self) -> tuple[LocalTrack, ...]:
        playlist = self._read_playlist()
        try:
            playlist_mtime = self.playlist_file.stat().st_mtime_ns
        except OSError as exc:
            raise MusicServiceError("LOCAL_MUSIC_PLAYLIST_NOT_FOUND", "本地歌单文件不存在", 404) from exc
        if self._catalog_cache and self._catalog_cache[0] == playlist_mtime:
            return self._catalog_cache[1]

        raw_tracks = playlist.get("tracks", [])
        if not isinstance(raw_tracks, list):
            raise MusicServiceError("LOCAL_MUSIC_INVALID_PLAYLIST", "本地歌单 tracks 必须是数组", 502)

        audio_files = [
            path for path in self.content_dir.rglob("*")
            if path.is_file() and path.suffix.lower() in self.allowed_audio_extensions and path != self.playlist_file
        ]
        by_stem = {self._normalize(path.stem): path for path in audio_files}
        metadata_cache: dict[Path, LocalTrack] = {}
        tracks: list[LocalTrack] = []

        for item in raw_tracks:
            if not isinstance(item, dict):
                continue
            track_id = str(item.get("id") or "").strip()
            name = str(item.get("name") or "").strip()
            if not track_id or not name:
                continue
            path = self._locate_audio(track_id, name, audio_files, by_stem, metadata_cache)
            if path is None:
                continue
            track = metadata_cache.get(path)
            if track is None:
                track = self._read_track_metadata(track_id, path, name)
                metadata_cache[path] = track
            elif track.id != track_id:
                track = LocalTrack(
                    id=track_id,
                    path=track.path,
                    title=track.title,
                    artist=track.artist,
                    album=track.album,
                    duration_ms=track.duration_ms,
                    cover=track.cover,
                    cover_mime=track.cover_mime,
                )
            tracks.append(track)

        result = tuple(tracks)
        self._catalog_cache = (playlist_mtime, result)
        return result

    def _locate_audio(
        self,
        track_id: str,
        name: str,
        audio_files: list[Path],
        by_stem: dict[str, Path],
        metadata_cache: dict[Path, LocalTrack],
    ) -> Path | None:
        direct = by_stem.get(self._normalize(track_id))
        if direct:
            return direct
        by_name = by_stem.get(self._normalize(name))
        if by_name:
            return by_name

        normalized_name = self._normalize(name)
        for path in audio_files:
            metadata = metadata_cache.get(path)
            if metadata is None:
                metadata = self._read_track_metadata("__lookup__", path, path.stem)
                metadata_cache[path] = metadata
            if self._normalize(metadata.title) == normalized_name:
                return path
        return None

    def _read_track_metadata(self, track_id: str, path: Path, fallback_title: str) -> LocalTrack:
        title = fallback_title or path.stem
        artist = "未知艺人"
        album: str | None = None
        duration_ms: int | None = None
        cover: bytes | None = None
        cover_mime: str | None = None

        if mutagen_file is not None:
            try:
                audio = mutagen_file(path, easy=False)
            except Exception:
                audio = None
            if audio is not None:
                tags = getattr(audio, "tags", None) or {}
                title = self._tag_value(tags, ("TIT2", "©nam", "title", "TITLE")) or title
                artist = self._tag_value(tags, ("TPE1", "©ART", "artist", "ARTIST")) or artist
                album = self._tag_value(tags, ("TALB", "©alb", "album", "ALBUM"))
                length = getattr(getattr(audio, "info", None), "length", None)
                if isinstance(length, (int, float)) and length > 0:
                    duration_ms = round(length * 1000)
                cover, cover_mime = self._extract_cover(audio, tags)

        # Some MP3 files expose normal ID3 metadata through mutagen but do not
        # expose the APIC frame consistently. Keep a small stdlib fallback so
        # an embedded cover is still available without requiring ffmpeg.
        if cover is None:
            cover, cover_mime = self._extract_id3_cover(path)

        return LocalTrack(
            id=track_id,
            path=path,
            title=title,
            artist=artist,
            album=album,
            duration_ms=duration_ms,
            cover=cover,
            cover_mime=cover_mime,
        )

    def _find_track(self, track_id: str) -> LocalTrack | None:
        normalized_id = track_id.strip()
        if not normalized_id:
            raise MusicServiceError("LOCAL_MUSIC_INVALID_TRACK", "Song ID is required", 400)
        return next((track for track in self._get_catalog() if track.id == normalized_id), None)

    def _read_playlist(self) -> dict[str, object]:
        if not self.playlist_file.is_file():
            raise MusicServiceError("LOCAL_MUSIC_PLAYLIST_NOT_FOUND", "本地歌单文件不存在", 404)
        try:
            value = json.loads(self.playlist_file.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise MusicServiceError("LOCAL_MUSIC_INVALID_PLAYLIST", "本地歌单 JSON 无法读取", 502) from exc
        if not isinstance(value, dict):
            raise MusicServiceError("LOCAL_MUSIC_INVALID_PLAYLIST", "本地歌单必须是 JSON 对象", 502)
        return value

    def _write_playlist(self, playlist: dict[str, object]) -> None:
        self.playlist_file.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.playlist_file.with_name(f".{self.playlist_file.name}.{uuid.uuid4().hex}.tmp")
        try:
            temporary.write_text(
                json.dumps(playlist, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            temporary.replace(self.playlist_file)
        except OSError as exc:
            temporary.unlink(missing_ok=True)
            raise MusicServiceError("LOCAL_MUSIC_PLAYLIST_WRITE_FAILED", "Playlist could not be written", 500) from exc

    def _to_summary(self, track: LocalTrack) -> MusicTrackResponse:
        return MusicTrackResponse(
            id=track.id,
            title=track.title,
            artist=track.artist,
            album=track.album,
            coverUrl=f"/api/v1/music/tracks/{quote(track.id, safe='')}/cover" if track.cover else None,
            durationMs=track.duration_ms,
            canPlay=True,
            freeTrial=False,
        )

    def _media_url(self, path: Path) -> str:
        relative = path.relative_to(self.content_dir).as_posix()
        return "/music/" + quote(relative, safe="/")

    @staticmethod
    def _normalize(value: str) -> str:
        return "".join(value.casefold().split())

    @staticmethod
    def _tag_value(tags: object, keys: tuple[str, ...]) -> str | None:
        if not hasattr(tags, "get"):
            return None
        for key in keys:
            value = tags.get(key)
            if value is None:
                continue
            if hasattr(value, "text"):
                value = value.text
            if isinstance(value, (list, tuple)):
                value = value[0] if value else None
            if isinstance(value, bytes):
                value = value.decode("utf-8", errors="replace")
            if value is not None:
                text = str(value).strip()
                if text:
                    return text
        return None

    @staticmethod
    def _extract_cover(audio: object, tags: object) -> tuple[bytes | None, str | None]:
        if hasattr(tags, "getall"):
            for frame in tags.getall("APIC"):
                if getattr(frame, "data", None):
                    return frame.data, getattr(frame, "mime", None) or "image/jpeg"

        pictures = getattr(audio, "pictures", None) or []
        if pictures:
            picture = pictures[0]
            if getattr(picture, "data", None):
                return picture.data, getattr(picture, "mime", None) or "image/jpeg"

        if hasattr(tags, "get"):
            covers = tags.get("covr")
            if isinstance(covers, (list, tuple)) and covers:
                cover = covers[0]
                data = bytes(cover)
                mime = "image/png" if "png" in str(getattr(cover, "imageformat", "")).lower() else "image/jpeg"
                return data, mime

            encoded = tags.get("metadata_block_picture")
            if isinstance(encoded, (list, tuple)) and encoded:
                try:
                    from mutagen.flac import Picture

                    picture = Picture(base64.b64decode(encoded[0]))
                    return picture.data, picture.mime or "image/jpeg"
                except Exception:
                    pass
        return None, None

    @classmethod
    def _extract_id3_cover(cls, path: Path) -> tuple[bytes | None, str | None]:
        """Read an APIC frame as a fallback for MP3 files with unusual tags."""
        if path.suffix.lower() != ".mp3":
            return None, None

        try:
            with path.open("rb") as stream:
                header = stream.read(10)
                if len(header) != 10 or header[:3] != b"ID3":
                    return None, None
                version = header[3]
                tag_size = cls._decode_syncsafe(header[6:10])
                if version < 3 or tag_size <= 0 or tag_size > 32 * 1024 * 1024:
                    return None, None
                tag = stream.read(tag_size)
        except OSError:
            return None, None

        offset = 0
        while offset + 10 <= len(tag):
            frame_id = tag[offset : offset + 4]
            if not frame_id.strip(b"\x00"):
                break
            frame_size_bytes = tag[offset + 4 : offset + 8]
            frame_size = (
                cls._decode_syncsafe(frame_size_bytes)
                if version >= 4
                else int.from_bytes(frame_size_bytes, "big")
            )
            frame_start = offset + 10
            frame_end = frame_start + frame_size
            if frame_size <= 0 or frame_end > len(tag):
                break
            if frame_id == b"APIC":
                cover = cls._parse_apic(tag[frame_start:frame_end])
                if cover:
                    return cover
            offset = frame_end
        return None, None

    @staticmethod
    def _decode_syncsafe(value: bytes) -> int:
        if len(value) != 4:
            return 0
        return ((value[0] & 0x7F) << 21) | ((value[1] & 0x7F) << 14) | ((value[2] & 0x7F) << 7) | (value[3] & 0x7F)

    @classmethod
    def _parse_apic(cls, payload: bytes) -> tuple[bytes, str] | None:
        if len(payload) < 4:
            return None

        encoding = payload[0]
        mime_end = payload.find(b"\x00", 1)
        if mime_end < 0 or mime_end + 2 >= len(payload):
            return None

        mime = payload[1:mime_end].decode("ascii", errors="ignore").strip().lower()
        description_start = mime_end + 2  # MIME terminator + picture type byte.
        if encoding in (1, 2):
            description_end = payload.find(b"\x00\x00", description_start)
            image_start = description_end + 2 if description_end >= 0 else -1
        else:
            description_end = payload.find(b"\x00", description_start)
            image_start = description_end + 1 if description_end >= 0 else -1
        if image_start < 0 or image_start >= len(payload):
            return None

        image = payload[image_start:]
        detected_mime = cls._detect_image_mime(image)
        if detected_mime is None:
            return None
        return image, mime if mime.startswith("image/") else detected_mime

    @staticmethod
    def _detect_image_mime(data: bytes) -> str | None:
        if data.startswith(b"\xFF\xD8\xFF"):
            return "image/jpeg"
        if data.startswith(b"\x89PNG\r\n\x1a\n"):
            return "image/png"
        if data.startswith((b"GIF87a", b"GIF89a")):
            return "image/gif"
        if data.startswith(b"RIFF") and data[8:12] == b"WEBP":
            return "image/webp"
        return None
