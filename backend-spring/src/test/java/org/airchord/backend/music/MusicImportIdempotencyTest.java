package org.airchord.backend.music;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.airchord.backend.web.BackendApiException;
import org.springframework.web.multipart.MultipartFile;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.*;

/** 模拟消息重投及“歌单已写、数据库尚未标记成功”时的文件恢复。 */
class MusicImportIdempotencyTest {
    @TempDir Path root;

    @Test
    void repeatedDeliveryDoesNotAddSecondPlaylistEntryAndCanRestoreMissingFile() throws Exception {
        Path staged = Files.writeString(root.resolve("private-upload"), "audio sample");
        Path musicRoot = root.resolve("public-music");
        LocalMusicService music = new LocalMusicService(musicRoot.toString(), 1024, "local", 2,
                path -> { throw new IllegalArgumentException("unsupported sample"); });
        String trackId = "song-00000000000000000000000000000001";

        music.addStagedTrack(staged, "sample.mp3", trackId);
        music.addStagedTrack(staged, "sample.mp3", trackId);
        assertThat(trackCount(musicRoot)).isEqualTo(1);

        Files.delete(musicRoot.resolve(trackId + ".mp3"));
        music.addStagedTrack(staged, "sample.mp3", trackId);
        assertThat(trackCount(musicRoot)).isEqualTo(1);
        assertThat(Files.readString(musicRoot.resolve(trackId + ".mp3"))).isEqualTo("audio sample");
    }

    @Test
    void oversizedUploadIsRejectedBeforeReadingItsBody() throws Exception {
        LocalMusicService music = new LocalMusicService(root.resolve("music").toString(), 50L * 1024 * 1024,
                "local", 2, path -> { throw new IllegalArgumentException(); });
        MultipartFile audio = mock(MultipartFile.class);
        when(audio.isEmpty()).thenReturn(false);
        when(audio.getSize()).thenReturn(50L * 1024 * 1024 + 1);
        assertThatThrownBy(() -> music.validateUpload(audio))
                .isInstanceOfSatisfying(BackendApiException.class,
                        ex -> assertThat(ex.statusCode()).isEqualTo(413));
        verify(audio, never()).getInputStream();
    }

    private int trackCount(Path musicRoot) throws Exception {
        JsonNode playlist = JsonMapper.builder().build().readTree(musicRoot.resolve("playlist.json").toFile());
        return playlist.path("tracks").size();
    }
}
