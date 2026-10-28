package org.airchord.backend.music;

import java.util.List;

/** 音乐 JSON DTO 与现有播放器字段保持一致。 */
public final class MusicDtos {
    private MusicDtos() { }
    public record Track(String id, String title, String artist, String album, String coverUrl,
                        Long durationMs, boolean canPlay, boolean freeTrial) { }
    public record Playlist(String playlistId, String source, List<Track> tracks, boolean available, String message) { }
    public record TrackUrl(String id, String playUrl, Long expiresAt, Long durationMs, boolean canPlay, String message) { }
    public record Cover(byte[] bytes, String contentType) { }
}
