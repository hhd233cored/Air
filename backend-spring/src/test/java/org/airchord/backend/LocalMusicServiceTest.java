package org.airchord.backend;

import org.airchord.backend.music.LocalMusicService;
import org.junit.jupiter.api.Test;

import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;

/** 本地音乐格式转换在临时目录上运行，避免改动仓库现有 music 文件。 */
class LocalMusicServiceTest {
    @Test
    void emptyLocalPlaylistHasStableResponseShape() throws Exception {
        Path fixtureDirectory = Path.of(getClass().getResource("/music-fixture/playlist.json").toURI()).getParent();
        var result = new LocalMusicService(fixtureDirectory.toString(), 50 * 1024 * 1024L, "local").getPlaylist();
        assertThat(result.playlistId()).isEqualTo("local");
        assertThat(result.source()).isEqualTo("local");
        assertThat(result.tracks()).isEmpty();
        assertThat(result.available()).isFalse();
        assertThat(result.message()).isNotBlank();
    }
}
