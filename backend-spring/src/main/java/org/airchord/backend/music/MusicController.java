package org.airchord.backend.music;

import org.airchord.backend.music.MusicDtos.Cover;
import org.airchord.backend.music.MusicDtos.Playlist;
import org.airchord.backend.music.MusicDtos.TrackUrl;
import org.airchord.backend.music.MusicImportDtos.Accepted;
import org.airchord.backend.music.MusicImportDtos.Status;
import org.airchord.backend.auth.AuthPrincipal;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.time.Duration;
import java.net.URI;
import java.util.UUID;

/** 本地音乐公开播放路由及管理员歌单管理路由。 */
@RestController
@RequestMapping("/api/v1")
public class MusicController {
    private final LocalMusicService music;
    private final MusicImportService imports;
    public MusicController(LocalMusicService music, MusicImportService imports) {
        this.music = music;
        this.imports = imports;
    }

    @GetMapping("/music/playlist") public Playlist playlist() { return music.getPlaylist(); }
    @GetMapping("/music/tracks/{id}/url") public TrackUrl trackUrl(@PathVariable String id) { return music.trackUrl(id); }
    @GetMapping("/music/tracks/{id}/cover") public ResponseEntity<byte[]> cover(@PathVariable String id) {
        Cover cover = music.trackCover(id);
        return ResponseEntity.ok().contentType(org.springframework.http.MediaType.parseMediaType(cover.contentType()))
                .cacheControl(CacheControl.maxAge(Duration.ofDays(1)).cachePublic()).body(cover.bytes());
    }
    @GetMapping("/admin/music/tracks") public Playlist adminPlaylist() { return music.getPlaylist(); }
    @PostMapping("/admin/music/tracks") public ResponseEntity<Playlist> add(@RequestParam("audio") MultipartFile audio) {
        return ResponseEntity.status(201).body(music.addTrack(audio));
    }
    @DeleteMapping("/admin/music/tracks/{id}") public Playlist remove(@PathVariable String id) { return music.removeTrack(id); }

    /** 异步入口只负责接受任务；播放器继续使用既有的同步歌单接口。 */
    @PostMapping("/admin/music/import-jobs")
    public ResponseEntity<Accepted> importTrack(@RequestParam("audio") MultipartFile audio,
                                                @AuthenticationPrincipal AuthPrincipal admin) {
        Accepted accepted = imports.accept(audio, admin.id());
        return ResponseEntity.accepted()
                .location(URI.create("/api/v1/admin/music/import-jobs/" + accepted.id()))
                .body(accepted);
    }

    @GetMapping("/admin/music/import-jobs/{id}")
    public Status importStatus(@PathVariable UUID id) { return imports.status(id); }
}
